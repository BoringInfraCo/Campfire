/**
 * ACT-001 GitHub workflow_run ingress application service.
 *
 * Adapter verifies bytes; this module applies operator source authority,
 * reservation correlation, dedup, and one atomic Finding+Artifact follow-up.
 * Core makes no GitHub network call.
 */
import { actionTargetKey } from "../domain/action-proposal.js";
import { Conflict, Unauthorized } from "../domain/errors.js";
import type { IdSource } from "../domain/ids.js";
import type { QualifyingMutation } from "../domain/event-qualify.js";
import type { DomainEventSubjectType } from "../domain/events.js";
import type {
  ActorRef,
  Artifact,
  ContributionAction,
  ContributionObjectType,
  Finding,
  FindingEvidence,
} from "../domain/types.js";
import {
  classifyGithubPayload,
  findingSummaryForObservation,
  githubAttemptKey,
  githubRunArtifactUrl,
  githubSemanticKey,
  parseGithubJsonBody,
  sha256HexBytes,
  SIGNED_OBSERVATION_DETAIL,
  verifyGithubSignature,
  type NormalizedGithubWorkflowRun,
} from "../integrations/github-workflow-run.js";
import {
  classifySourceAuthority,
  sourceAuthorityFingerprint,
  type GithubSourceBinding,
} from "../integrations/github-source-config.js";
import { bridgeFromEnv, definedData, planOutbox, resolveOnBehalfOf } from "./outbox.js";
import type { ActorContext } from "./authorization.js";
import type { CampfireStore } from "../store/store.js";
import type { AsyncCampfireStore } from "../worker/d1-store.js";
import type {
  GithubIngressDeliveryRecord,
  GithubIngressReceiptRecord,
  GithubSourceBindingRecord,
} from "../store/action-proposal-records.js";

const DAY_MS = 24 * 3_600_000;
const FUTURE_SKEW_MS = 5 * 60_000;
const DELIVERY_ID = /^[\x20-\x7E]{1,128}$/;

/**
 * Contract §5.2 phrases correlation as `run_attempt == expectedAttempt + 1`.
 * Frozen Step-0 semantics (STEP0 §2, `frozen-cases.md`): `expectedAttempt` IS
 * the next attempt — the failed attempt 1 freezes `expectedAttempt: 2`, and
 * the retry completion carries `run_attempt: 2`. The `+1` is relative to the
 * original failed attempt and is already folded into the frozen target, so
 * the correlation check is equality (`expectedAttempt === runAttempt`).
 * Do NOT add another increment here; Step-0 fixtures pin attempt 2 == 2.
 */
export const STEP0_EXPECTED_ATTEMPT_IS_NEXT_ATTEMPT = true as const;

export type GithubIngressOutcome = "accepted" | "duplicate" | "ignored" | "pong";

export interface GithubIngressResponse {
  status: number;
  body: { ok: true; result: { outcome: GithubIngressOutcome } } | { ok: false; error: string; message: string };
}

export interface GithubIngressRequest {
  sourceId: string;
  eventName: string | undefined;
  deliveryId: string | undefined;
  signatureHeader: string | undefined;
  rawBody: Uint8Array;
}

export interface GithubIngressDeps {
  clock: () => string;
  idSource: IdSource;
  webhookEnv?: Record<string, string | undefined>;
}

function jsonOk(outcome: GithubIngressOutcome): GithubIngressResponse {
  return { status: 200, body: { ok: true, result: { outcome } } };
}

function jsonErr(status: number, error: string, message: string): GithubIngressResponse {
  return { status, body: { ok: false, error, message } };
}

function isConstraintError(error: unknown): boolean {
  if (error instanceof Conflict) return true;
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error && typeof error.code === "string" ? error.code : "";
  const message = "message" in error && typeof error.message === "string" ? error.message : "";
  return (
    code.startsWith("SQLITE_CONSTRAINT") ||
    /unique constraint failed/i.test(message) ||
    /unique constraint/i.test(message) ||
    /primary key/i.test(message)
  );
}

function deliveryAck(
  existing: GithubIngressDeliveryRecord,
  payloadDigest: string,
): GithubIngressResponse {
  if (existing.payloadDigest !== payloadDigest) {
    return jsonErr(409, "Conflict", "Conflicting delivery");
  }
  return jsonOk("duplicate");
}

function receiptAck(existing: GithubIngressReceiptRecord, event: NormalizedGithubWorkflowRun): GithubIngressResponse {
  if (existing.conclusion !== event.conclusion) {
    return jsonErr(409, "Conflict", "Conflicting conclusion");
  }
  return jsonOk("duplicate");
}

function timestampAdmissible(now: string, providerTimestamp: string): boolean {
  const nowMs = Date.parse(now);
  const providerMs = Date.parse(providerTimestamp);
  if (!Number.isFinite(nowMs) || !Number.isFinite(providerMs)) return false;
  if (nowMs - providerMs > DAY_MS) return false;
  if (providerMs - nowMs > FUTURE_SKEW_MS) return false;
  return true;
}

function integrationCtx(source: GithubSourceBinding): ActorContext {
  return {
    actor: { actorId: source.agentId, actorType: "agent" },
    agentSessionId: source.sessionId,
  };
}

function integrationAvailable(input: {
  workspace: { status: string } | undefined;
  participant: { role: string } | undefined;
  session: { agentId: string; workspaceId: string; endedAt?: string } | undefined;
  agent: { id: string } | undefined;
  source: GithubSourceBinding;
}): boolean {
  if (input.workspace === undefined || input.workspace.status !== "active") return false;
  if (input.agent === undefined) return false;
  if (input.participant === undefined || input.participant.role === "viewer") return false;
  if (input.session === undefined) return false;
  if (input.session.agentId !== input.source.agentId) return false;
  if (input.session.workspaceId !== input.source.workspaceId) return false;
  if (input.session.endedAt !== undefined) return false;
  return true;
}

interface FollowUp {
  binding?: GithubSourceBindingRecord;
  delivery: GithubIngressDeliveryRecord;
  receipt: GithubIngressReceiptRecord;
  artifact: Artifact;
  finding: Finding;
  evidence: FindingEvidence;
  ctx: ActorContext;
  now: string;
}

function buildFollowUp(input: {
  source: GithubSourceBinding;
  event: NormalizedGithubWorkflowRun;
  payloadDigest: string;
  deliveryId: string;
  fingerprint: string;
  existingBinding: GithubSourceBindingRecord | undefined;
  proposalId: string;
  reservationId: string;
  now: string;
  idSource: IdSource;
}): FollowUp {
  const ctx = integrationCtx(input.source);
  const actor: ActorRef = ctx.actor;
  const artifactId = input.idSource("artifact");
  const findingId = input.idSource("finding");
  const evidenceId = input.idSource("findingEvidence");
  const artifact: Artifact = {
    id: artifactId,
    workspaceId: input.source.workspaceId,
    type: "report",
    title: `GitHub Actions run ${input.event.runId} attempt ${input.event.runAttempt}`,
    uriOrPath: githubRunArtifactUrl(input.source.repositoryName, input.event.runId),
    createdBy: actor,
    agentSessionId: ctx.agentSessionId,
    createdAt: input.now,
  };
  const finding: Finding = {
    id: findingId,
    workspaceId: input.source.workspaceId,
    summary: findingSummaryForObservation(input.event.runAttempt, input.event.conclusion),
    detail: SIGNED_OBSERVATION_DETAIL,
    sourceArtifactId: artifactId,
    currentness: "current",
    createdBy: actor,
    agentSessionId: ctx.agentSessionId,
    createdAt: input.now,
  };
  const evidence: FindingEvidence = {
    id: evidenceId,
    workspaceId: input.source.workspaceId,
    findingId,
    artifactId,
    relation: "supports",
    note: SIGNED_OBSERVATION_DETAIL,
    createdBy: actor,
    agentSessionId: ctx.agentSessionId,
    createdAt: input.now,
  };
  const delivery: GithubIngressDeliveryRecord = {
    sourceId: input.source.sourceId,
    deliveryId: input.deliveryId,
    payloadDigest: input.payloadDigest,
    receivedAt: input.now,
  };
  const receipt: GithubIngressReceiptRecord = {
    workspaceId: input.source.workspaceId,
    attemptKey: githubAttemptKey({
      repositoryId: input.event.repositoryId,
      workflowId: input.event.workflowId,
      runId: input.event.runId,
      attempt: input.event.runAttempt,
    }),
    semanticKey: githubSemanticKey({
      repositoryId: input.event.repositoryId,
      workflowId: input.event.workflowId,
      runId: input.event.runId,
      attempt: input.event.runAttempt,
      conclusion: input.event.conclusion,
    }),
    provider: "github",
    repositoryId: input.event.repositoryId,
    workflowId: input.event.workflowId,
    runId: input.event.runId,
    attempt: input.event.runAttempt,
    conclusion: input.event.conclusion,
    eventKind: "workflow_run.completed",
    payloadDigest: input.payloadDigest,
    providerTimestamp: input.event.providerTimestamp,
    receivedAt: input.now,
    sourceId: input.source.sourceId,
    proposalId: input.proposalId,
    reservationId: input.reservationId,
    findingId,
    artifactId,
  };
  const binding: GithubSourceBindingRecord | undefined =
    input.existingBinding === undefined
      ? {
          sourceId: input.source.sourceId,
          workspaceId: input.source.workspaceId,
          repositoryId: input.source.repositoryId,
          repositoryName: input.source.repositoryName,
          workflowId: input.source.workflowId,
          actionKind: input.source.actionKind,
          integrationAgentId: input.source.agentId,
          authorityFingerprint: input.fingerprint,
          firstUsedAt: input.now,
        }
      : undefined;
  return { binding, delivery, receipt, artifact, finding, evidence, ctx, now: input.now };
}

function recordContribution(
  store: { createContribution: CampfireStore["createContribution"] },
  ctx: ActorContext,
  workspaceId: string,
  action: ContributionAction,
  objectType: ContributionObjectType,
  objectId: string,
  payload: Record<string, unknown> | undefined,
  createdAt: string,
  idSource: IdSource,
): string {
  const id = idSource("contribution");
  store.createContribution({
    id,
    workspaceId,
    actor: ctx.actor,
    agentSessionId: ctx.agentSessionId,
    action,
    objectType,
    objectId,
    payload,
    createdAt,
  });
  return id;
}

function enqueueOutbox(
  store: CampfireStore | AsyncCampfireStore,
  ctx: ActorContext,
  input: {
    mutation: QualifyingMutation;
    occurredAt: string;
    workspaceId: string;
    subjectType: DomainEventSubjectType;
    subjectId: string;
    summary: string;
    data: Record<string, unknown>;
    contributionId: string;
    onBehalfOf?: { actorId: string; actorType: "human" };
  },
  idSource: IdSource,
  webhookEnv: Record<string, string | undefined> | undefined,
): { event: ReturnType<typeof planOutbox> } {
  const planned = planOutbox({
    mutation: input.mutation,
    eventId: idSource("domainEvent"),
    deliveryId: idSource("webhookDelivery"),
    occurredAt: input.occurredAt,
    workspaceId: input.workspaceId,
    actor: ctx.actor,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    summary: input.summary,
    data: definedData(input.data),
    contributionId: input.contributionId,
    ...(ctx.agentSessionId !== undefined ? { agentSessionId: ctx.agentSessionId } : {}),
    ...(input.onBehalfOf !== undefined ? { onBehalfOf: input.onBehalfOf } : {}),
    bridge: bridgeFromEnv(webhookEnv ?? {}),
  });
  return { event: planned };
}

async function verifyAndClassify(
  source: GithubSourceBinding,
  request: GithubIngressRequest,
): Promise<
  | { ok: false; response: GithubIngressResponse }
  | { ok: true; payloadDigest: string; kind: ReturnType<typeof classifyGithubPayload> }
> {
  const signed = await verifyGithubSignature(source.secret, request.rawBody, request.signatureHeader);
  if (!signed) return { ok: false, response: jsonErr(401, "Unauthorized", "Invalid signature") };
  const payloadDigest = await sha256HexBytes(request.rawBody);
  const parsed = parseGithubJsonBody(request.rawBody);
  if (!parsed.ok) return { ok: false, response: jsonErr(400, "ValidationError", "Malformed payload") };
  const kind = classifyGithubPayload(request.eventName ?? "", parsed.value);
  return { ok: true, payloadDigest, kind };
}

function requireDeliveryId(deliveryId: string | undefined): string | GithubIngressResponse {
  if (deliveryId === undefined || !DELIVERY_ID.test(deliveryId)) {
    return jsonErr(400, "ValidationError", "Malformed payload");
  }
  return deliveryId;
}

export async function ingestGithubWorkflowRun(
  store: CampfireStore,
  source: GithubSourceBinding,
  request: GithubIngressRequest,
  deps: GithubIngressDeps,
): Promise<GithubIngressResponse> {
  if (request.sourceId !== source.sourceId) {
    return jsonErr(404, "ValidationError", "Unknown source");
  }
  const verified = await verifyAndClassify(source, request);
  if (!verified.ok) return verified.response;
  if (verified.kind.kind === "ping") return jsonOk("pong");
  if (verified.kind.kind === "ignored") return jsonOk("ignored");
  if (verified.kind.kind === "malformed") return jsonErr(400, "ValidationError", "Malformed payload");

  const deliveryId = requireDeliveryId(request.deliveryId);
  if (typeof deliveryId !== "string") return deliveryId;
  const event = verified.kind.event;
  const payloadDigest = verified.payloadDigest;
  const now = deps.clock();
  const fingerprint = await sourceAuthorityFingerprint(source);

  const existingBinding = store.getGithubSourceBinding(source.sourceId);
  if (existingBinding !== undefined) {
    // Fingerprint enforcement: a used source id cannot be rebound. Equality
    // covers workspace/target/kind/agent; a fingerprint mismatch on top of
    // equality is only a session renewal, so persist the rotated fingerprint
    // and keep the binding. See `classifySourceAuthority` and
    // STEP0_EXPECTED_ATTEMPT_IS_NEXT_ATTEMPT-adjacent authority rules.
    const verdict = classifySourceAuthority(existingBinding, source, fingerprint);
    if (verdict === "rebinding-conflict") {
      return jsonErr(409, "Conflict", "Source binding conflict");
    }
    if (verdict === "session-rotation") {
      store.updateGithubSourceBindingFingerprint(source.sourceId, fingerprint);
      existingBinding.authorityFingerprint = fingerprint;
    }
  }
  const existingDelivery = store.getGithubIngressDelivery(source.sourceId, deliveryId);
  if (existingDelivery !== undefined) return deliveryAck(existingDelivery, payloadDigest);

  const matchesConfiguredTarget =
    event.repositoryId === source.repositoryId &&
    event.repositoryName === source.repositoryName &&
    event.workflowId === source.workflowId;

  const attemptKey = githubAttemptKey({
    repositoryId: event.repositoryId,
    workflowId: event.workflowId,
    runId: event.runId,
    attempt: event.runAttempt,
  });
  const existingReceipt = store.getGithubIngressReceiptByAttempt(source.workspaceId, attemptKey);
  if (existingReceipt !== undefined) return receiptAck(existingReceipt, event);

  if (!timestampAdmissible(now, event.providerTimestamp)) {
    return jsonErr(400, "ValidationError", "Inadmissible timestamp");
  }

  const reservation = matchesConfiguredTarget
    ? store.getActionTargetReservation(
        source.workspaceId,
        actionTargetKey({
          repositoryId: event.repositoryId,
          repositoryName: event.repositoryName,
          workflowId: event.workflowId,
          runId: event.runId,
          commitSha: event.headSha,
          expectedAttempt: event.runAttempt,
        }),
      )
    : undefined;
  const proposal = reservation === undefined ? undefined : store.getActionProposal(reservation.proposalId);
  // STEP0_EXPECTED_ATTEMPT_IS_NEXT_ATTEMPT: `expectedAttempt` freezes the next
  // attempt (failed 1 → expected 2), so equality with the completion's
  // `runAttempt` implements the contract §5.2 `run_attempt == expectedAttempt
  // + 1` intent. See module note and `frozen-cases.md`.
  const correlated =
    proposal !== undefined &&
    proposal.workspaceId === source.workspaceId &&
    proposal.reservation !== undefined &&
    proposal.target.repositoryId === event.repositoryId &&
    proposal.target.workflowId === event.workflowId &&
    proposal.target.runId === event.runId &&
    proposal.target.commitSha === event.headSha &&
    proposal.target.expectedAttempt === event.runAttempt;

  if (!correlated) {
    try {
      persistBindingAndDelivery(store, source, existingBinding, fingerprint, deliveryId, payloadDigest, now);
    } catch (error) {
      if (!isConstraintError(error)) throw error;
    }
    return jsonOk("ignored");
  }

  const workspace = store.getWorkspace(source.workspaceId);
  const agent = store.getAgent(source.agentId);
  const participant = store.getParticipant(source.workspaceId, { actorId: source.agentId, actorType: "agent" });
  const session = store.getAgentSession(source.sessionId);
  if (!integrationAvailable({ workspace, participant, session, agent, source })) {
    return jsonErr(503, "Unauthorized", "Integration unavailable");
  }

  const followUp = buildFollowUp({
    source,
    event,
    payloadDigest,
    deliveryId,
    fingerprint,
    existingBinding,
    proposalId: proposal.id,
    reservationId: reservation!.reservationId,
    now,
    idSource: deps.idSource,
  });
  const sessionRow = session;
  try {
    store.transaction(() => {
      commitFollowUp(store, followUp, deps, sessionRow);
    });
  } catch (error) {
    if (error instanceof Unauthorized) return jsonErr(503, "Unauthorized", "Integration unavailable");
    return recoverAfterRace(store, source, deliveryId, payloadDigest, source.workspaceId, attemptKey, event, error);
  }
  return jsonOk("accepted");
}

function persistBindingAndDelivery(
  store: CampfireStore,
  source: GithubSourceBinding,
  existingBinding: GithubSourceBindingRecord | undefined,
  fingerprint: string,
  deliveryId: string,
  payloadDigest: string,
  now: string,
): void {
  store.transaction(() => {
    if (existingBinding === undefined) {
      store.createGithubSourceBinding({
        sourceId: source.sourceId,
        workspaceId: source.workspaceId,
        repositoryId: source.repositoryId,
        repositoryName: source.repositoryName,
        workflowId: source.workflowId,
        actionKind: source.actionKind,
        integrationAgentId: source.agentId,
        authorityFingerprint: fingerprint,
        firstUsedAt: now,
      });
    }
    store.createGithubIngressDelivery({
      sourceId: source.sourceId,
      deliveryId,
      payloadDigest,
      receivedAt: now,
    });
  });
}

function recheckIntegrationAuthorityInTxn(
  store: Pick<CampfireStore, "getWorkspace" | "getAgent" | "getParticipant" | "getAgentSession">,
  followUp: FollowUp,
): void {
  const workspaceId = followUp.artifact.workspaceId;
  const actor = followUp.ctx.actor;
  const workspace = store.getWorkspace(workspaceId);
  const agent = store.getAgent(actor.actorId);
  const participant = store.getParticipant(workspaceId, actor);
  const session = followUp.ctx.agentSessionId === undefined
    ? undefined
    : store.getAgentSession(followUp.ctx.agentSessionId);
  if (
    workspace === undefined || workspace.status !== "active" ||
    agent === undefined ||
    participant === undefined || participant.role === "viewer" ||
    session === undefined || session.agentId !== actor.actorId ||
    session.workspaceId !== workspaceId || session.endedAt !== undefined
  ) {
    throw new Unauthorized("Integration unavailable");
  }
}

async function recheckIntegrationAuthorityInTxnAsync(
  store: Pick<AsyncCampfireStore, "getWorkspace" | "getAgent" | "getParticipant" | "getAgentSession">,
  followUp: FollowUp,
): Promise<void> {
  const workspaceId = followUp.artifact.workspaceId;
  const actor = followUp.ctx.actor;
  const workspace = await store.getWorkspace(workspaceId);
  const agent = await store.getAgent(actor.actorId);
  const participant = await store.getParticipant(workspaceId, actor);
  const session = followUp.ctx.agentSessionId === undefined
    ? undefined
    : await store.getAgentSession(followUp.ctx.agentSessionId);
  if (
    workspace === undefined || workspace.status !== "active" ||
    agent === undefined ||
    participant === undefined || participant.role === "viewer" ||
    session === undefined || session.agentId !== actor.actorId ||
    session.workspaceId !== workspaceId || session.endedAt !== undefined
  ) {
    throw new Unauthorized("Integration unavailable");
  }
}

function commitFollowUp(
  store: CampfireStore,
  followUp: FollowUp,
  deps: GithubIngressDeps,
  session: { agentId: string; humanId: string; workspaceId: string } | undefined,
): void {
  // In-txn authority recheck: the participant/session/workspace reads above
  // ran before the transaction, so a removal, demotion, session end, or
  // workspace close landing in between must fail the commit instead of
  // recording ingress follow-ups through a stale read.
  recheckIntegrationAuthorityInTxn(store, followUp);
  if (followUp.binding !== undefined) store.createGithubSourceBinding(followUp.binding);
  store.createGithubIngressDelivery(followUp.delivery);
  store.createArtifact(followUp.artifact);
  store.createFinding(followUp.finding);
  store.insertFindingEvidence(followUp.evidence);
  const onBehalfOf = resolveOnBehalfOf(followUp.ctx.actor, followUp.artifact.workspaceId, session);
  const artifactContributionId = recordContribution(
    store,
    followUp.ctx,
    followUp.artifact.workspaceId,
    "create",
    "artifact",
    followUp.artifact.id,
    { title: followUp.artifact.title, type: followUp.artifact.type, observation: "signed_github_workflow_run" },
    followUp.now,
    deps.idSource,
  );
  const artifactOutbox = enqueueOutbox(
    store,
    followUp.ctx,
    {
      mutation: { kind: "artifact.created" },
      occurredAt: followUp.now,
      workspaceId: followUp.artifact.workspaceId,
      subjectType: "artifact",
      subjectId: followUp.artifact.id,
      summary: followUp.artifact.title,
      data: { title: followUp.artifact.title, type: followUp.artifact.type, uriOrPath: followUp.artifact.uriOrPath },
      contributionId: artifactContributionId,
      ...(onBehalfOf !== undefined ? { onBehalfOf } : {}),
    },
    deps.idSource,
    deps.webhookEnv,
  ).event;
  if (artifactOutbox !== undefined) {
    store.createDomainEvent(artifactOutbox.event);
    if (artifactOutbox.delivery !== undefined) store.createWebhookDelivery(artifactOutbox.delivery);
  }
  const findingContributionId = recordContribution(
    store,
    followUp.ctx,
    followUp.finding.workspaceId,
    "create",
    "finding",
    followUp.finding.id,
    { summary: followUp.finding.summary, observation: "signed_github_workflow_run", conclusion: followUp.receipt.conclusion },
    followUp.now,
    deps.idSource,
  );
  const findingOutbox = enqueueOutbox(
    store,
    followUp.ctx,
    {
      mutation: { kind: "finding.created" },
      occurredAt: followUp.now,
      workspaceId: followUp.finding.workspaceId,
      subjectType: "finding",
      subjectId: followUp.finding.id,
      summary: followUp.finding.summary,
      data: {
        summary: followUp.finding.summary,
        sourceArtifactId: followUp.finding.sourceArtifactId,
        observation: "signed_github_workflow_run",
        conclusion: followUp.receipt.conclusion,
      },
      contributionId: findingContributionId,
      ...(onBehalfOf !== undefined ? { onBehalfOf } : {}),
    },
    deps.idSource,
    deps.webhookEnv,
  ).event;
  if (findingOutbox !== undefined) {
    store.createDomainEvent(findingOutbox.event);
    if (findingOutbox.delivery !== undefined) store.createWebhookDelivery(findingOutbox.delivery);
  }
  recordContribution(
    store,
    followUp.ctx,
    followUp.finding.workspaceId,
    "update",
    "finding",
    followUp.finding.id,
    { summary: `supports ${followUp.artifact.id}`, artifactId: followUp.artifact.id, relation: "supports" },
    followUp.now,
    deps.idSource,
  );
  store.createGithubIngressReceipt(followUp.receipt);
}

function recoverAfterRace(
  store: CampfireStore,
  source: GithubSourceBinding,
  deliveryId: string,
  payloadDigest: string,
  workspaceId: string,
  attemptKey: string,
  event: NormalizedGithubWorkflowRun,
  error: unknown,
): GithubIngressResponse {
  if (!isConstraintError(error)) {
    return jsonErr(503, "InternalError", "Integration unavailable");
  }
  const delivery = store.getGithubIngressDelivery(source.sourceId, deliveryId);
  if (delivery !== undefined) return deliveryAck(delivery, payloadDigest);
  const receipt = store.getGithubIngressReceiptByAttempt(workspaceId, attemptKey);
  if (receipt !== undefined) return receiptAck(receipt, event);
  return jsonErr(409, "Conflict", "Conflicting delivery");
}

export async function ingestGithubWorkflowRunAsync(
  store: AsyncCampfireStore,
  source: GithubSourceBinding,
  request: GithubIngressRequest,
  deps: GithubIngressDeps,
): Promise<GithubIngressResponse> {
  if (request.sourceId !== source.sourceId) {
    return jsonErr(404, "ValidationError", "Unknown source");
  }
  const verified = await verifyAndClassify(source, request);
  if (!verified.ok) return verified.response;
  if (verified.kind.kind === "ping") return jsonOk("pong");
  if (verified.kind.kind === "ignored") return jsonOk("ignored");
  if (verified.kind.kind === "malformed") return jsonErr(400, "ValidationError", "Malformed payload");

  const deliveryId = requireDeliveryId(request.deliveryId);
  if (typeof deliveryId !== "string") return deliveryId;
  const event = verified.kind.event;
  const payloadDigest = verified.payloadDigest;
  const now = deps.clock();
  const fingerprint = await sourceAuthorityFingerprint(source);

  const existingBinding = await store.getGithubSourceBinding(source.sourceId);
  if (existingBinding !== undefined) {
    // Fingerprint enforcement (async mirror): rebinding conflicts; a
    // session-only fingerprint rotation updates the stored fingerprint.
    const verdict = classifySourceAuthority(existingBinding, source, fingerprint);
    if (verdict === "rebinding-conflict") {
      return jsonErr(409, "Conflict", "Source binding conflict");
    }
    if (verdict === "session-rotation") {
      await store.updateGithubSourceBindingFingerprint(source.sourceId, fingerprint);
      existingBinding.authorityFingerprint = fingerprint;
    }
  }
  const existingDelivery = await store.getGithubIngressDelivery(source.sourceId, deliveryId);
  if (existingDelivery !== undefined) return deliveryAck(existingDelivery, payloadDigest);

  const matchesConfiguredTarget =
    event.repositoryId === source.repositoryId &&
    event.repositoryName === source.repositoryName &&
    event.workflowId === source.workflowId;

  const attemptKey = githubAttemptKey({
    repositoryId: event.repositoryId,
    workflowId: event.workflowId,
    runId: event.runId,
    attempt: event.runAttempt,
  });
  const existingReceipt = await store.getGithubIngressReceiptByAttempt(source.workspaceId, attemptKey);
  if (existingReceipt !== undefined) return receiptAck(existingReceipt, event);

  if (!timestampAdmissible(now, event.providerTimestamp)) {
    return jsonErr(400, "ValidationError", "Inadmissible timestamp");
  }

  const reservation = matchesConfiguredTarget
    ? await store.getActionTargetReservation(
        source.workspaceId,
        actionTargetKey({
          repositoryId: event.repositoryId,
          repositoryName: event.repositoryName,
          workflowId: event.workflowId,
          runId: event.runId,
          commitSha: event.headSha,
          expectedAttempt: event.runAttempt,
        }),
      )
    : undefined;
  const proposal = reservation === undefined ? undefined : await store.getActionProposal(reservation.proposalId);
  // STEP0_EXPECTED_ATTEMPT_IS_NEXT_ATTEMPT: equality implements §5.2 intent.
  const correlated =
    proposal !== undefined &&
    proposal.workspaceId === source.workspaceId &&
    proposal.reservation !== undefined &&
    proposal.target.repositoryId === event.repositoryId &&
    proposal.target.workflowId === event.workflowId &&
    proposal.target.runId === event.runId &&
    proposal.target.commitSha === event.headSha &&
    proposal.target.expectedAttempt === event.runAttempt;

  if (!correlated) {
    try {
      await persistBindingAndDeliveryAsync(store, source, existingBinding, fingerprint, deliveryId, payloadDigest, now);
    } catch (error) {
      if (!isConstraintError(error)) throw error;
    }
    return jsonOk("ignored");
  }

  const workspace = await store.getWorkspace(source.workspaceId);
  const agent = await store.getAgent(source.agentId);
  const participant = await store.getParticipant(source.workspaceId, { actorId: source.agentId, actorType: "agent" });
  const session = await store.getAgentSession(source.sessionId);
  if (!integrationAvailable({ workspace, participant, session, agent, source })) {
    return jsonErr(503, "Unauthorized", "Integration unavailable");
  }

  const followUp = buildFollowUp({
    source,
    event,
    payloadDigest,
    deliveryId,
    fingerprint,
    existingBinding,
    proposalId: proposal.id,
    reservationId: reservation!.reservationId,
    now,
    idSource: deps.idSource,
  });
  try {
    await store.transaction(async () => {
      await commitFollowUpAsync(store, followUp, deps, session);
    });
  } catch (error) {
    if (error instanceof Unauthorized) return jsonErr(503, "Unauthorized", "Integration unavailable");
    return await recoverAfterRaceAsync(
      store,
      source,
      deliveryId,
      payloadDigest,
      source.workspaceId,
      attemptKey,
      event,
      error,
    );
  }
  return jsonOk("accepted");
}

async function persistBindingAndDeliveryAsync(
  store: AsyncCampfireStore,
  source: GithubSourceBinding,
  existingBinding: GithubSourceBindingRecord | undefined,
  fingerprint: string,
  deliveryId: string,
  payloadDigest: string,
  now: string,
): Promise<void> {
  await store.transaction(async () => {
    if (existingBinding === undefined) {
      await store.createGithubSourceBinding({
        sourceId: source.sourceId,
        workspaceId: source.workspaceId,
        repositoryId: source.repositoryId,
        repositoryName: source.repositoryName,
        workflowId: source.workflowId,
        actionKind: source.actionKind,
        integrationAgentId: source.agentId,
        authorityFingerprint: fingerprint,
        firstUsedAt: now,
      });
    }
    await store.createGithubIngressDelivery({
      sourceId: source.sourceId,
      deliveryId,
      payloadDigest,
      receivedAt: now,
    });
  });
}

async function commitFollowUpAsync(
  store: AsyncCampfireStore,
  followUp: FollowUp,
  deps: GithubIngressDeps,
  session: { agentId: string; humanId: string; workspaceId: string } | undefined,
): Promise<void> {
  // In-txn authority recheck (async mirror): a removal, demotion, session
  // end, or workspace close landing between the pre-check and this commit
  // must fail instead of recording follow-ups through a stale read.
  await recheckIntegrationAuthorityInTxnAsync(store, followUp);
  if (followUp.binding !== undefined) await store.createGithubSourceBinding(followUp.binding);
  await store.createGithubIngressDelivery(followUp.delivery);
  await store.createArtifact(followUp.artifact);
  await store.createFinding(followUp.finding);
  await store.insertFindingEvidence(followUp.evidence);
  const onBehalfOf = resolveOnBehalfOf(followUp.ctx.actor, followUp.artifact.workspaceId, session);
  const artifactContributionId = await recordContributionAsync(
    store,
    followUp.ctx,
    followUp.artifact.workspaceId,
    "create",
    "artifact",
    followUp.artifact.id,
    { title: followUp.artifact.title, type: followUp.artifact.type, observation: "signed_github_workflow_run" },
    followUp.now,
    deps.idSource,
  );
  const artifactOutbox = enqueueOutbox(
    store,
    followUp.ctx,
    {
      mutation: { kind: "artifact.created" },
      occurredAt: followUp.now,
      workspaceId: followUp.artifact.workspaceId,
      subjectType: "artifact",
      subjectId: followUp.artifact.id,
      summary: followUp.artifact.title,
      data: { title: followUp.artifact.title, type: followUp.artifact.type, uriOrPath: followUp.artifact.uriOrPath },
      contributionId: artifactContributionId,
      ...(onBehalfOf !== undefined ? { onBehalfOf } : {}),
    },
    deps.idSource,
    deps.webhookEnv,
  ).event;
  if (artifactOutbox !== undefined) {
    await store.createDomainEvent(artifactOutbox.event);
    if (artifactOutbox.delivery !== undefined) await store.createWebhookDelivery(artifactOutbox.delivery);
  }
  const findingContributionId = await recordContributionAsync(
    store,
    followUp.ctx,
    followUp.finding.workspaceId,
    "create",
    "finding",
    followUp.finding.id,
    { summary: followUp.finding.summary, observation: "signed_github_workflow_run", conclusion: followUp.receipt.conclusion },
    followUp.now,
    deps.idSource,
  );
  const findingOutbox = enqueueOutbox(
    store,
    followUp.ctx,
    {
      mutation: { kind: "finding.created" },
      occurredAt: followUp.now,
      workspaceId: followUp.finding.workspaceId,
      subjectType: "finding",
      subjectId: followUp.finding.id,
      summary: followUp.finding.summary,
      data: {
        summary: followUp.finding.summary,
        sourceArtifactId: followUp.finding.sourceArtifactId,
        observation: "signed_github_workflow_run",
        conclusion: followUp.receipt.conclusion,
      },
      contributionId: findingContributionId,
      ...(onBehalfOf !== undefined ? { onBehalfOf } : {}),
    },
    deps.idSource,
    deps.webhookEnv,
  ).event;
  if (findingOutbox !== undefined) {
    await store.createDomainEvent(findingOutbox.event);
    if (findingOutbox.delivery !== undefined) await store.createWebhookDelivery(findingOutbox.delivery);
  }
  await recordContributionAsync(
    store,
    followUp.ctx,
    followUp.finding.workspaceId,
    "update",
    "finding",
    followUp.finding.id,
    { summary: `supports ${followUp.artifact.id}`, artifactId: followUp.artifact.id, relation: "supports" },
    followUp.now,
    deps.idSource,
  );
  await store.createGithubIngressReceipt(followUp.receipt);
}

async function recordContributionAsync(
  store: AsyncCampfireStore,
  ctx: ActorContext,
  workspaceId: string,
  action: ContributionAction,
  objectType: ContributionObjectType,
  objectId: string,
  payload: Record<string, unknown> | undefined,
  createdAt: string,
  idSource: IdSource,
): Promise<string> {
  const id = idSource("contribution");
  await store.createContribution({
    id,
    workspaceId,
    actor: ctx.actor,
    agentSessionId: ctx.agentSessionId,
    action,
    objectType,
    objectId,
    payload,
    createdAt,
  });
  return id;
}

async function recoverAfterRaceAsync(
  store: AsyncCampfireStore,
  source: GithubSourceBinding,
  deliveryId: string,
  payloadDigest: string,
  workspaceId: string,
  attemptKey: string,
  event: NormalizedGithubWorkflowRun,
  error: unknown,
): Promise<GithubIngressResponse> {
  if (!isConstraintError(error)) {
    return jsonErr(503, "InternalError", "Integration unavailable");
  }
  const delivery = await store.getGithubIngressDelivery(source.sourceId, deliveryId);
  if (delivery !== undefined) return deliveryAck(delivery, payloadDigest);
  const receipt = await store.getGithubIngressReceiptByAttempt(workspaceId, attemptKey);
  if (receipt !== undefined) return receiptAck(receipt, event);
  return jsonErr(409, "Conflict", "Conflicting delivery");
}

export function githubIngressPathSourceId(path: string): string | undefined {
  const match = /^\/v1\/integrations\/github\/([^/]+)$/.exec(path);
  if (match === null) return undefined;
  const sourceId = match[1];
  if (sourceId === undefined || sourceId.length === 0) return undefined;
  return decodeURIComponent(sourceId);
}
