/**
 * ACT-001 application service (asynchronous D1 path).
 *
 * Layering (AGENTS.md invariant 7): interface adapters call the eight
 * `*_action_*` methods, which enforce authorization, domain rules, and guarded
 * persistence. Core makes no provider network call and stores no credential.
 *
 * Concurrency: every mutation rechecks authority, lifecycle, revision,
 * digest, evidence snapshot, and configuration inside the commit transaction
 * and applies state through a guarded conditional write. A check followed by
 * an unguarded write is never sufficient.
 */
import type { ActorContext } from "./authorization.js";
import type { AsyncAuthorizer } from "../worker/async-authorizer.js";
import type { AsyncCampfireStore } from "../worker/d1-store.js";
import {
  ACTION_EVIDENCE_MAX_REFS,
  ACTION_INTENT_MAX_BYTES,
  ACTION_MAX_PAGE_SIZE,
  ACTION_DEFAULT_PAGE_SIZE,
  ACTION_PAGE_MAX_BYTES,
  ACTION_PROJECTION_MAX_BYTES,
  ACTION_REASON_MAX_CHARS,
  ACTION_RECEIPT_MAX_BYTES,
  ACTION_PROPOSAL_INTENT_VERSION,
  ACTION_PROPOSAL_KIND,
  actionIntentDigest,
  actionTargetKey,
  assertActionTransition,
  assertReceiptAllowed,
  canonicalIntentEnvelope,
  encodeIntentEnvelopeStorage,
  normalizeActionProviderRef,
  normalizeActionReason,
  normalizeActionTarget,
  normalizeActionExecutor,
  outcomeStatus,
  utf8Bytes,
  type ActionEvidenceSnapshot,
  type ActionProposal,
  type ActionReceipt,
  type ActionSubmissionOutcome,
  type SignedObservationRef,
} from "../domain/action-proposal.js";
import type { IdSource } from "../domain/ids.js";
import {
  ActionProposalNotFound,
  ActorNotFound,
  ArtifactNotFound,
  Conflict,
  CrossWorkspaceReference,
  FindingNotFound,
  InvalidTransition,
  ParticipantRequired,
  TaskNotFound,
  Unauthorized,
  ValidationError,
  WorkspaceNotFound,
} from "../domain/errors.js";
import type { ContributionAction, ContributionObjectType } from "../domain/types.js";
import { toContextSlice } from "../domain/context-policy.js";
import type {
  ActionProposalPage,
  ActionProposalView,
  ActionReceiptPage,
  CancelActionInput,
  GetActionProposalInput,
  ListActionProposalsInput,
  ListActionReceiptsInput,
  ProposeActionInput,
  RecordActionOutcomeInput,
  ReserveActionInput,
  ReviewActionInput,
} from "./service.js";
export interface AsyncActionProposalHost {
  store: AsyncCampfireStore;
  authorizer: AsyncAuthorizer;
  idSource: IdSource;
  clock: () => string;
  requireAgentSession(ctx: ActorContext): Promise<void>;
  record(
    ctx: ActorContext,
    workspaceId: string,
    action: ContributionAction,
    objectType: ContributionObjectType,
    objectId: string,
    payload: Record<string, unknown> | undefined,
    createdAt: string,
  ): Promise<string>;
}

const ACTION_METHODS = {
  propose: "propose_action",
  review: "review_action",
  cancel: "cancel_action",
  reserve: "reserve_action_execution",
  report: "record_action_outcome",
} as const;

function isConstraintError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error && typeof error.code === "string" ? error.code : "";
  const message = "message" in error && typeof error.message === "string" ? error.message : "";
  return code.startsWith("SQLITE_CONSTRAINT") ||
    /unique constraint failed/i.test(message) ||
    /unique constraint/i.test(message) ||
    /primary key/i.test(message) ||
    /already exists/i.test(message);
}

function assertRequestKey(value: unknown): string {
  if (typeof value !== "string" || !/^[\x20-\x7E]{1,128}$/.test(value)) {
    throw new ValidationError("requestKey must be 1-128 printable ASCII characters", { field: "requestKey" });
  }
  return value;
}

function assertPageLimit(value: number | undefined): number {
  const limit = value ?? ACTION_DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(limit) || limit < 1 || limit > ACTION_MAX_PAGE_SIZE) {
    throw new ValidationError(`limit must be an integer from 1 to ${ACTION_MAX_PAGE_SIZE}`, {
      field: "limit",
      limit: value,
    });
  }
  return limit;
}

interface ActionCursor {
  q: "proposals" | "receipts";
  w: string;
  at: string;
  id: string;
}

function encodeActionCursor(cursor: ActionCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeActionCursor(token: string, workspaceId: string, q: ActionCursor["q"]): { at: string; id: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  } catch {
    throw new ValidationError("Cursor is not a valid action cursor", { field: "cursor" });
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new ValidationError("Cursor is not a valid action cursor", { field: "cursor" });
  }
  const cursor = parsed as Partial<ActionCursor>;
  if (cursor.q !== q || cursor.w !== workspaceId || typeof cursor.at !== "string" || typeof cursor.id !== "string") {
    throw new ValidationError("Cursor is not valid for this workspace and query", { field: "cursor" });
  }
  return { at: cursor.at, id: cursor.id };
}

async function readProposalInWorkspace(store: AsyncCampfireStore, workspaceId: string, proposalId: string): Promise<ActionProposal> {
  const proposal = await store.getActionProposal(proposalId);
  // Same-workspace records only. A foreign id reads as not found so no
  // workspace membership or record content leaks across the boundary.
  if (proposal === undefined || proposal.workspaceId !== workspaceId) {
    throw new ActionProposalNotFound(proposalId);
  }
  return proposal;
}

async function requireActiveWorkspace(host: AsyncActionProposalHost, workspaceId: string): Promise<void> {
  const workspace = await host.store.getWorkspace(workspaceId);
  if (workspace === undefined) {
    throw new WorkspaceNotFound(workspaceId);
  }
  // Closed workspaces stay readable and accept no new ACT-001 mutations.
  if (workspace.status !== "active") {
    throw new InvalidTransition(`Workspace ${workspaceId} is ${workspace.status}; action proposals require an active workspace`, {
      recoveryCode: "workspace_not_active",
      workspaceId,
      status: workspace.status,
      recovery: "Reopen the workspace before proposing, reviewing, reserving, or reporting an action.",
    });
  }
}

async function requireParticipant(host: AsyncActionProposalHost, ctx: ActorContext, workspaceId: string): Promise<void> {
  if (await host.store.getParticipant(workspaceId, ctx.actor) === undefined) {
    throw new ParticipantRequired(`Actor ${ctx.actor.actorId} is not a participant of workspace ${workspaceId}`);
  }
}

async function requireHumanOwner(host: AsyncActionProposalHost, ctx: ActorContext, workspaceId: string): Promise<void> {
  // An agent's role named `owner` never passes a human-only check. The
  // acting principal type is evaluated first, then the workspace role.
  if (ctx.actor.actorType !== "human") {
    throw new Unauthorized("Only a human workspace owner may review or cancel an action proposal", {
      recoveryCode: "human_review_required",
    });
  }
  const participant = await host.store.getParticipant(workspaceId, ctx.actor);
  if (participant?.role !== "owner") {
    throw new Unauthorized("Only a human workspace owner may review or cancel an action proposal", {
      recoveryCode: "owner_required",
    });
  }
}

function requireDesignatedExecutor(ctx: ActorContext, proposal: ActionProposal): void {
  if (ctx.actor.actorId !== proposal.executor.actorId || ctx.actor.actorType !== proposal.executor.actorType) {
    throw new Unauthorized(
      `Only the designated executor ${proposal.executor.actorType} ${proposal.executor.actorId} may perform this step`,
      { recoveryCode: "executor_required" },
    );
  }
}

async function requireLiveSession(host: AsyncActionProposalHost, ctx: ActorContext, workspaceId: string): Promise<void> {
  if (ctx.actor.actorType !== "agent") return;
  if (ctx.agentSessionId === undefined) {
    throw new Unauthorized(`Agent ${ctx.actor.actorId} must act through a registered agent session`);
  }
  const session = await host.store.getAgentSession(ctx.agentSessionId);
  if (session === undefined || session.agentId !== ctx.actor.actorId || session.workspaceId !== workspaceId) {
    throw new Unauthorized(`Agent session ${ctx.agentSessionId} does not authorize workspace ${workspaceId}`);
  }
  if (session.endedAt !== undefined) {
    throw new Unauthorized(`Agent session ${ctx.agentSessionId} has ended`);
  }
}

/** Rechecks that run inside the commit transaction, before any buffered write. */
async function recheckCommitAuthority(
  host: AsyncActionProposalHost,
  ctx: ActorContext,
  workspaceId: string,
  allowedRoles: ReadonlyArray<"owner" | "member" | "agent">,
): Promise<void> {
  await requireActiveWorkspace(host, workspaceId);
  const participant = await host.store.getParticipant(workspaceId, ctx.actor);
  if (participant === undefined) {
    throw new ParticipantRequired(`Actor ${ctx.actor.actorId} is not a participant of workspace ${workspaceId}`);
  }
  if (!allowedRoles.includes(participant.role as "owner" | "member" | "agent")) {
    throw new Unauthorized(`Role ${participant.role} may not perform this action step`, {
      recoveryCode: "role_required",
    });
  }
  await requireLiveSession(host, ctx, workspaceId);
}

function normalizeSourceAuthorityRevision(raw: unknown): string {
  if (raw === undefined) return "none";
  if (typeof raw !== "string" || raw.length < 1 || raw.length > 128) {
    throw new ValidationError("sourceAuthorityRevision must be 1-128 characters", { field: "sourceAuthorityRevision" });
  }
  return raw;
}

function normalizeExpiresAt(raw: string | undefined, now: string): string {
  const fallback = new Date(Date.parse(now) + 24 * 3_600_000).toISOString();
  const value = raw ?? fallback;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new ValidationError("expiresAt must be an ISO timestamp", { field: "expiresAt" });
  }
  if (parsed <= Date.parse(now)) {
    throw new ValidationError("expiresAt must be after creation", { field: "expiresAt" });
  }
  if (parsed > Date.parse(now) + 24 * 3_600_000) {
    throw new ValidationError("expiresAt must be at most 24 hours after creation", { field: "expiresAt" });
  }
  return new Date(parsed).toISOString();
}

function dedupeSorted(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort();
}

interface CitedState {
  taskId: string;
  findingIds: string[];
  artifactIds: string[];
  task: { id: string; status: string; updatedAt: string };
  findings: { id: string; currentness: string }[];
  artifacts: { id: string }[];
}

async function readCitedState(host: AsyncActionProposalHost, workspaceId: string, taskId: string, findingIds: string[], artifactIds: string[]): Promise<CitedState> {
  const findings = dedupeSorted(findingIds);
  const artifacts = dedupeSorted(artifactIds);
  if (findings.length + artifacts.length < 1) {
    throw new ValidationError("At least one cited finding or artifact is required", { field: "findingIds" });
  }
  if (findings.length + artifacts.length > ACTION_EVIDENCE_MAX_REFS) {
    throw new ValidationError(`At most ${ACTION_EVIDENCE_MAX_REFS} finding/artifact references are allowed`, {
      field: "findingIds",
    });
  }
  const task = await host.store.getTask(taskId);
  if (task === undefined) {
    throw new TaskNotFound(taskId);
  }
  if (task.workspaceId !== workspaceId) {
    throw new CrossWorkspaceReference(`Task ${taskId} is not in workspace ${workspaceId}`);
  }
  const findingSnapshots: { id: string; currentness: string }[] = [];
  for (const id of findings) {
    const finding = await host.store.getFinding(id);
    if (finding === undefined) {
      throw new FindingNotFound(id);
    }
    if (finding.workspaceId !== workspaceId) {
      throw new CrossWorkspaceReference(`Finding ${id} is not in workspace ${workspaceId}`);
    }
    findingSnapshots.push({ id, currentness: finding.currentness ?? "current" });
  }
  const artifactSnapshots: { id: string }[] = [];
  for (const id of artifacts) {
    const artifact = await host.store.getArtifact(id);
    if (artifact === undefined) {
      throw new ArtifactNotFound(id);
    }
    if (artifact.workspaceId !== workspaceId) {
      throw new CrossWorkspaceReference(`Artifact ${id} is not in workspace ${workspaceId}`);
    }
    artifactSnapshots.push({ id });
  }
  return {
    taskId,
    findingIds: findings,
    artifactIds: artifacts,
    task: { id: task.id, status: task.status, updatedAt: task.updatedAt },
    findings: findingSnapshots,
    artifacts: artifactSnapshots,
  };
}

function buildEvidenceSnapshot(
  digest: string,
  revision: number,
  capturedAt: string,
  cited: CitedState,
): ActionEvidenceSnapshot {
  return {
    task: cited.task,
    findings: cited.findings,
    artifacts: cited.artifacts,
    intentDigest: digest,
    revision,
    capturedAt,
  };
}

async function requireExecutorParticipant(host: AsyncActionProposalHost, proposal: ActionProposal): Promise<void> {
  const participant = await host.store.getParticipant(proposal.workspaceId, proposal.executor);
  if (participant === undefined || participant.role === "viewer") {
    throw new InvalidTransition("The designated executor no longer holds dispatch authority in this workspace", {
      recoveryCode: "executor_authority_lost",
      recovery: "Propose a new action with a current workspace participant as executor.",
    });
  }
}

async function requireReviewAuthority(host: AsyncActionProposalHost, proposal: ActionProposal): Promise<void> {
  // The approver must still be a human workspace owner when dispatch is
  // reserved; a removed or demoted approver invalidates dispatch.
  if (proposal.review === undefined) {
    throw new InvalidTransition("Reservation requires a recorded human approval", {
      recoveryCode: "approval_required",
    });
  }
  if (proposal.review.actor.actorType !== "human") {
    throw new InvalidTransition("Reservation requires a human approval", {
      recoveryCode: "approval_required",
    });
  }
  const participant = await host.store.getParticipant(proposal.workspaceId, proposal.review.actor);
  if (participant?.role !== "owner") {
    throw new InvalidTransition("The approver no longer holds human owner authority in this workspace", {
      recoveryCode: "approver_authority_lost",
      recovery: "Propose a new action and record a fresh human approval.",
    });
  }
}

/** Operator source authority recheck (ACT-001 dispatch gate): when the
 * workspace has a persisted operator source binding, a proposal that claims
 * no revision ("none") or a revision referencing no bound source cannot
 * reserve — the source was disabled, rebound, or never authorized this
 * intent. With no binding the revision stays opaque for compatibility. */
const SOURCE_REVISION_PREFIX = "ACT001-SOURCE-V1";

function sourceRevisionMatchesBinding(
  revision: string,
  bindings: ReadonlyArray<{ sourceId: string; authorityFingerprint: string }>,
): boolean {
  if (
    revision === SOURCE_REVISION_PREFIX ||
    revision.startsWith(`${SOURCE_REVISION_PREFIX}:`) ||
    revision.startsWith(`${SOURCE_REVISION_PREFIX}#`)
  ) {
    return true;
  }
  return bindings.some((binding) =>
    revision === binding.sourceId ||
    revision === binding.authorityFingerprint ||
    revision.startsWith(`${binding.sourceId}#`) ||
    revision.startsWith(`${binding.sourceId}:`)
  );
}

function requireSourceAuthorityAtReserve(
  bindings: ReadonlyArray<{ sourceId: string; authorityFingerprint: string }>,
  proposal: ActionProposal,
): void {
  if (bindings.length === 0) return;
  if (
    proposal.sourceAuthorityRevision !== "none" &&
    sourceRevisionMatchesBinding(proposal.sourceAuthorityRevision, bindings)
  ) {
    return;
  }
  throw new InvalidTransition("The operator source binding for this workspace changed, is disabled, or never authorized this intent; dispatch is prevented", {
    recoveryCode: "source_authority_mismatch",
    recovery: "Propose a new action citing the current operator source authority and record a fresh human approval.",
  });
}

/** The approval-time digest recomputed from live state. Equality means the
 * cited task/evidence versions, executor, expiry, and source revision are
 * unchanged since the proposal was recorded. */
async function currentDigestFor(host: AsyncActionProposalHost, proposal: ActionProposal): Promise<string> {
  const cited = await readCitedState(host, proposal.workspaceId, proposal.taskId, proposal.findingIds, proposal.artifactIds);
  const envelope = canonicalIntentEnvelope({
    target: proposal.target,
    executor: proposal.executor,
    expiresAt: proposal.expiresAt,
    reason: proposal.reason,
    task: cited.task,
    findings: cited.findings,
    artifacts: cited.artifacts,
    sourceAuthorityRevision: proposal.sourceAuthorityRevision,
  });
  return actionIntentDigest(envelope);
}

async function requireUndisturbedApproval(host: AsyncActionProposalHost, proposal: ActionProposal): Promise<void> {
  if (await currentDigestFor(host, proposal) !== proposal.intentDigest) {
    throw new Conflict("Cited task, evidence, executor, or expiry changed since the proposal; a new proposal and fresh approval are required", {
      recoveryCode: "evidence_changed",
      recovery: "Propose a new action citing the current task and evidence versions.",
    });
  }
}

async function latestReceipt(host: AsyncActionProposalHost, proposal: ActionProposal): Promise<ActionReceipt | undefined> {
  const page = await host.store.pageActionReceipts(proposal.workspaceId, proposal.id, { limit: 1 });
  return page.items[0];
}

async function signedObservations(
  host: AsyncActionProposalHost,
  proposal: ActionProposal,
): Promise<SignedObservationRef[]> {
  const rows = await host.store.listGithubIngressReceiptsForProposal(proposal.workspaceId, proposal.id);
  return rows.map((row) => ({
    findingId: row.findingId,
    artifactId: row.artifactId,
    conclusion: row.conclusion,
    attempt: row.attempt,
    receivedAt: row.receivedAt,
  }));
}

function assertProjectionBounds(view: ActionProposalView): void {
  const bytes = utf8Bytes(JSON.stringify(view));
  if (bytes > ACTION_PROJECTION_MAX_BYTES) {
    throw new ValidationError(`Action proposal projection exceeds ${ACTION_PROJECTION_MAX_BYTES} bytes`, {
      field: "proposal",
    });
  }
}

function fitPage<T extends { id: string }>(items: readonly T[]): { items: T[]; trimmed: boolean } {
  let kept = [...items];
  while (kept.length > 1 && utf8Bytes(JSON.stringify(kept)) > ACTION_PAGE_MAX_BYTES) {
    kept = kept.slice(0, kept.length - 1);
  }
  // A single oversize row is dropped rather than emitting an over-budget
  // page. total/returned/truncated stay honest and the row remains readable
  // through get_action_proposal.
  if (kept.length === 1 && utf8Bytes(JSON.stringify(kept)) > ACTION_PAGE_MAX_BYTES) {
    return { items: [], trimmed: true };
  }
  return { items: kept, trimmed: kept.length < items.length };
}

function replayStored<T>(stored: { inputDigest: string; resultJson: string }, inputDigest: string): T {
  if (stored.inputDigest !== inputDigest) {
    throw new Conflict("This requestKey was already used with different input; use a new requestKey", {
      recoveryCode: "request_key_conflict",
      recovery: "Retry with a fresh requestKey, or replay the exact original input.",
    });
  }
  return JSON.parse(stored.resultJson) as T;
}

export function createAsyncActionProposalActions(host: AsyncActionProposalHost) {
  async function storedReplay<T>(
    ctx: ActorContext,
    workspaceId: string,
    method: string,
    requestKey: string,
    inputDigest: string,
  ): Promise<T | undefined> {
    const stored = await host.store.getActionMutationReceipt(
      workspaceId,
      ctx.actor.actorId,
      ctx.actor.actorType,
      method,
      requestKey,
    );
    if (stored === undefined) return undefined;
    return replayStored<T>(stored, inputDigest);
  }

  async function commitReplayOrConflict<T>(
    error: unknown,
    ctx: ActorContext,
    workspaceId: string,
    method: string,
    requestKey: string,
    inputDigest: string,
    fallback: () => T | Promise<T>,
  ): Promise<T> {
    // A mapped Conflict (e.g. request_key_conflict from a raced mutation
    // receipt) still replays when the stored input matches, so equal input
    // never conflicts on overlapping D1 writers.
    const stored = await host.store.getActionMutationReceipt(
      workspaceId,
      ctx.actor.actorId,
      ctx.actor.actorType,
      method,
      requestKey,
    ).catch(() => undefined);
    if (stored !== undefined && stored.inputDigest === inputDigest) {
      return JSON.parse(stored.resultJson) as T;
    }
    if (error instanceof Conflict) throw error;
    if (!isConstraintError(error)) throw error;
    return fallback();
  }

  return {
    async propose_action(ctx: ActorContext, input: ProposeActionInput): Promise<ActionProposalView> {
      const requestKey = assertRequestKey(input.requestKey);
      await host.authorizer.assertAllowed(ctx, "action:propose", input.workspaceId);
      await host.requireAgentSession(ctx);
      await requireActiveWorkspace(host, input.workspaceId);
      await requireParticipant(host, ctx, input.workspaceId);

      let target: ActionProposal["target"];
      let executor: ActionProposal["executor"];
      let reason: string;
      try {
        target = normalizeActionTarget(input.target);
        executor = normalizeActionExecutor(input.executor);
        reason = normalizeActionReason(input.reason);
      } catch (error) {
        throw new ValidationError(error instanceof Error ? error.message : "Invalid action intent", {
          field: "target",
        });
      }
      const sourceAuthorityRevision = normalizeSourceAuthorityRevision(input.sourceAuthorityRevision);
      const now = host.clock();
      const expiresAt = normalizeExpiresAt(input.expiresAt, now);
      // The executor must be an existing non-viewer participant. Execution
      // rights do not follow from sharing a human owner.
      const executorIdentity = executor.actorType === "human"
        ? await host.store.getHuman(executor.actorId)
        : await host.store.getAgent(executor.actorId);
      if (executorIdentity === undefined) {
        throw new ActorNotFound(executor.actorId);
      }
      const executorParticipant = await host.store.getParticipant(input.workspaceId, executor);
      if (executorParticipant === undefined) {
        throw new ParticipantRequired(`Executor ${executor.actorId} is not a participant of workspace ${input.workspaceId}`);
      }
      if (executorParticipant.role === "viewer") {
        throw new Unauthorized(`Executor ${executor.actorId} holds a viewer role and may not dispatch`, {
          recoveryCode: "executor_required",
        });
      }
      const cited = await readCitedState(host, input.workspaceId, input.taskId, input.findingIds ?? [], input.artifactIds ?? []);
      const normalized = {
        method: ACTION_METHODS.propose,
        workspaceId: input.workspaceId,
        target,
        executor,
        expiresAt,
        reason,
        taskId: cited.taskId,
        findingIds: cited.findingIds,
        artifactIds: cited.artifactIds,
        sourceAuthorityRevision,
      };
      const inputDigest = actionIntentDigest(JSON.stringify(normalized));
      const replayed = await storedReplay<ActionProposalView>(ctx, input.workspaceId, ACTION_METHODS.propose, requestKey, inputDigest);
      if (replayed !== undefined) return replayed;

      const envelope = canonicalIntentEnvelope({
        target,
        executor,
        expiresAt,
        reason,
        task: cited.task,
        findings: cited.findings,
        artifacts: cited.artifacts,
        sourceAuthorityRevision,
      });
      if (utf8Bytes(envelope) > ACTION_INTENT_MAX_BYTES) {
        throw new ValidationError(`Action intent exceeds ${ACTION_INTENT_MAX_BYTES} bytes`, { field: "target" });
      }
      const intentDigest = actionIntentDigest(envelope);
      const targetKey = actionTargetKey(target);
      const id = host.idSource("actionProposal");
      const proposal: ActionProposal = {
        id,
        workspaceId: input.workspaceId,
        kind: ACTION_PROPOSAL_KIND,
        intentVersion: ACTION_PROPOSAL_INTENT_VERSION,
        target,
        executor,
        intentDigest,
        expiresAt,
        reason,
        taskId: cited.taskId,
        findingIds: cited.findingIds,
        artifactIds: cited.artifactIds,
        sourceAuthorityRevision,
        proposedBy: { actorId: ctx.actor.actorId, actorType: ctx.actor.actorType },
        status: "proposed",
        revision: 1,
        createdAt: now,
        updatedAt: now,
      };
      if (ctx.agentSessionId !== undefined) proposal.proposedSessionId = ctx.agentSessionId;
      const view: ActionProposalView = { proposal };
      assertProjectionBounds(view);
      const resultJson = JSON.stringify(view);

      try {
        await host.store.transaction(async () => {
          await recheckCommitAuthority(host, ctx, input.workspaceId, ["owner", "member", "agent"]);
          await host.store.createActionProposal(proposal, encodeIntentEnvelopeStorage(envelope), targetKey);
          await host.store.putActionMutationReceipt({
            workspaceId: input.workspaceId,
            actorId: ctx.actor.actorId,
            actorType: ctx.actor.actorType,
            method: ACTION_METHODS.propose,
            requestKey,
            inputDigest,
            resultJson,
            createdAt: now,
          });
          await host.record(ctx, input.workspaceId, "create", "action_proposal", id, {
            status: "proposed",
            revision: 1,
            intentDigest,
          }, now);
        });
      } catch (error) {
        return await commitReplayOrConflict<ActionProposalView>(error, ctx, input.workspaceId, ACTION_METHODS.propose, requestKey, inputDigest, () => {
          throw error;
        });
      }
      return view;
    },

    async review_action(ctx: ActorContext, input: ReviewActionInput): Promise<ActionProposalView> {
      const requestKey = assertRequestKey(input.requestKey);
      await host.authorizer.assertAllowed(ctx, "action:review", input.workspaceId);
      await host.requireAgentSession(ctx);
      await requireHumanOwner(host, ctx, input.workspaceId);
      await requireActiveWorkspace(host, input.workspaceId);
      const proposal = await readProposalInWorkspace(host.store, input.workspaceId, input.proposalId);
      if (input.decision !== "approve" && input.decision !== "reject") {
        throw new ValidationError("decision must be approve or reject", { field: "decision" });
      }
      let reason: string | undefined;
      if (input.reason !== undefined) {
        try {
          reason = normalizeActionReason(input.reason);
        } catch (error) {
          throw new ValidationError(error instanceof Error ? error.message : "Invalid reason", { field: "reason" });
        }
      }
      if (input.decision === "reject" && reason === undefined) {
        throw new ValidationError("Rejection requires a reason", { field: "reason" });
      }
      const normalized = {
        method: ACTION_METHODS.review,
        workspaceId: input.workspaceId,
        proposalId: input.proposalId,
        revision: input.revision,
        intentDigest: input.intentDigest,
        decision: input.decision,
        reason,
      };
      const inputDigest = actionIntentDigest(JSON.stringify(normalized));
      const replayed = await storedReplay<ActionProposalView>(ctx, input.workspaceId, ACTION_METHODS.review, requestKey, inputDigest);
      if (replayed !== undefined) return replayed;
      if (proposal.status !== "proposed") {
        throw new InvalidTransition(`Only a proposed action can be reviewed, not ${proposal.status}`, {
          recoveryCode: "invalid_action_transition",
          from: proposal.status,
        });
      }
      if (proposal.revision !== input.revision) {
        throw new Conflict(`Proposal revision ${input.revision} does not match current revision ${proposal.revision}; reread before reviewing`, {
          recoveryCode: "revision_mismatch",
        });
      }
      if (proposal.intentDigest !== input.intentDigest) {
        throw new Conflict("Intent digest does not match the recorded proposal; reread before reviewing", {
          recoveryCode: "digest_mismatch",
        });
      }

      const now = host.clock();
      if (input.decision === "approve") {
        if (Date.parse(now) > Date.parse(proposal.expiresAt)) {
          throw new InvalidTransition("Approval expired; dispatch is prevented. Propose a new action.", {
            recoveryCode: "approval_expired",
            recovery: "Propose a new action with a fresh expiry.",
          });
        }
        // Approval binds the live evidence versions, not just the recorded
        // digest: changed or withdrawn citations since proposal fail here.
        await requireUndisturbedApproval(host, proposal);
      }
      const nextStatus = input.decision === "approve" ? "approved" : "rejected";
      assertActionTransition(proposal.status, nextStatus);
      const updated: ActionProposal = {
        ...proposal,
        status: nextStatus,
        revision: proposal.revision + 1,
        updatedAt: now,
        review: {
          actor: { actorId: ctx.actor.actorId, actorType: ctx.actor.actorType },
          decision: input.decision === "approve" ? "approved" : "rejected",
          at: now,
          revision: proposal.revision + 1,
          intentDigest: proposal.intentDigest,
        },
      };
      if (ctx.agentSessionId !== undefined) updated.review!.sessionId = ctx.agentSessionId;
      if (reason !== undefined) updated.review!.reason = reason;
      const view: ActionProposalView = { proposal: updated, latestReceipt: await latestReceipt(host, proposal) };
      assertProjectionBounds(view);
      const resultJson = JSON.stringify(view);

      try {
        await host.store.transaction(async () => {
          // Human ownership is rechecked at commit: a demoted reviewer cannot
          // approve through a stale read. Evidence is rechecked too: a
          // finding/task correction landing between the pre-check and this
          // commit must fail approval (mirror reserve_action_execution).
          await recheckCommitAuthority(host, ctx, input.workspaceId, ["owner"]);
          await requireHumanOwner(host, ctx, input.workspaceId);
          if (input.decision === "approve") {
            await requireUndisturbedApproval(host, await readProposalInWorkspace(host.store, input.workspaceId, input.proposalId));
          }
          const claimed = await host.store.updateActionProposal(proposal.id, {
            status: nextStatus,
            revision: proposal.revision + 1,
            updatedAt: now,
            reviewActorId: ctx.actor.actorId,
            reviewActorType: ctx.actor.actorType,
            reviewSessionId: ctx.agentSessionId ?? null,
            reviewAt: now,
            reviewReason: reason ?? null,
            reviewRevision: proposal.revision + 1,
          }, { revision: proposal.revision, status: "proposed" });
          if (!claimed) {
            throw new Conflict("The proposal changed before this review could commit; reread and retry", {
              recoveryCode: "revision_mismatch",
            });
          }
          await host.store.putActionMutationReceipt({
            workspaceId: input.workspaceId,
            actorId: ctx.actor.actorId,
            actorType: ctx.actor.actorType,
            method: ACTION_METHODS.review,
            requestKey,
            inputDigest,
            resultJson,
            createdAt: now,
          });
          await host.record(ctx, input.workspaceId, "update", "action_proposal", proposal.id, {
            status: nextStatus,
            revision: proposal.revision + 1,
            intentDigest: proposal.intentDigest,
          }, now);
        });
      } catch (error) {
        return await commitReplayOrConflict<ActionProposalView>(error, ctx, input.workspaceId, ACTION_METHODS.review, requestKey, inputDigest, () => {
          throw error;
        });
      }
      return view;
    },

    async cancel_action(ctx: ActorContext, input: CancelActionInput): Promise<ActionProposalView> {
      const requestKey = assertRequestKey(input.requestKey);
      await host.authorizer.assertAllowed(ctx, "action:review", input.workspaceId);
      await host.requireAgentSession(ctx);
      await requireHumanOwner(host, ctx, input.workspaceId);
      await requireActiveWorkspace(host, input.workspaceId);
      const proposal = await readProposalInWorkspace(host.store, input.workspaceId, input.proposalId);
      let reason: string;
      try {
        reason = normalizeActionReason(input.reason);
      } catch (error) {
        throw new ValidationError(error instanceof Error ? error.message : "Invalid reason", { field: "reason" });
      }
      const normalized = {
        method: ACTION_METHODS.cancel,
        workspaceId: input.workspaceId,
        proposalId: input.proposalId,
        revision: input.revision,
        intentDigest: input.intentDigest,
        reason,
      };
      const inputDigest = actionIntentDigest(JSON.stringify(normalized));
      const replayed = await storedReplay<ActionProposalView>(ctx, input.workspaceId, ACTION_METHODS.cancel, requestKey, inputDigest);
      if (replayed !== undefined) return replayed;
      // Once reserved, cancellation cannot claim to stop external execution.
      if (proposal.status !== "proposed" && proposal.status !== "approved") {
        throw new InvalidTransition(`Only a proposed or approved action can be cancelled, not ${proposal.status}`, {
          recoveryCode: "invalid_action_transition",
          from: proposal.status,
          recovery: proposal.status === "dispatch_reserved"
            ? "The dispatch slot is already reserved; reconcile the outcome instead of cancelling."
            : "This proposal is terminal; propose a new action instead.",
        });
      }
      if (proposal.revision !== input.revision) {
        throw new Conflict(`Proposal revision ${input.revision} does not match current revision ${proposal.revision}; reread before cancelling`, {
          recoveryCode: "revision_mismatch",
        });
      }
      if (proposal.intentDigest !== input.intentDigest) {
        throw new Conflict("Intent digest does not match the recorded proposal; reread before cancelling", {
          recoveryCode: "digest_mismatch",
        });
      }

      const now = host.clock();
      assertActionTransition(proposal.status, "cancelled");
      const updated: ActionProposal = {
        ...proposal,
        status: "cancelled",
        revision: proposal.revision + 1,
        updatedAt: now,
        review: {
          actor: { actorId: ctx.actor.actorId, actorType: ctx.actor.actorType },
          decision: "cancelled",
          reason,
          at: now,
          revision: proposal.revision + 1,
          intentDigest: proposal.intentDigest,
        },
      };
      if (ctx.agentSessionId !== undefined) updated.review!.sessionId = ctx.agentSessionId;
      const view: ActionProposalView = { proposal: updated, latestReceipt: await latestReceipt(host, proposal) };
      assertProjectionBounds(view);
      const resultJson = JSON.stringify(view);

      try {
        await host.store.transaction(async () => {
          await recheckCommitAuthority(host, ctx, input.workspaceId, ["owner"]);
          await requireHumanOwner(host, ctx, input.workspaceId);
          const claimed = await host.store.updateActionProposal(proposal.id, {
            status: "cancelled",
            revision: proposal.revision + 1,
            updatedAt: now,
            reviewActorId: ctx.actor.actorId,
            reviewActorType: ctx.actor.actorType,
            reviewSessionId: ctx.agentSessionId ?? null,
            reviewAt: now,
            reviewReason: reason,
            reviewRevision: proposal.revision + 1,
          }, { revision: proposal.revision, status: proposal.status });
          if (!claimed) {
            throw new Conflict("The proposal changed before this cancellation could commit; reread and retry", {
              recoveryCode: "revision_mismatch",
            });
          }
          await host.store.putActionMutationReceipt({
            workspaceId: input.workspaceId,
            actorId: ctx.actor.actorId,
            actorType: ctx.actor.actorType,
            method: ACTION_METHODS.cancel,
            requestKey,
            inputDigest,
            resultJson,
            createdAt: now,
          });
          await host.record(ctx, input.workspaceId, "update", "action_proposal", proposal.id, {
            status: "cancelled",
            revision: proposal.revision + 1,
            intentDigest: proposal.intentDigest,
          }, now);
        });
      } catch (error) {
        return await commitReplayOrConflict<ActionProposalView>(error, ctx, input.workspaceId, ACTION_METHODS.cancel, requestKey, inputDigest, () => {
          throw error;
        });
      }
      return view;
    },

    async reserve_action_execution(ctx: ActorContext, input: ReserveActionInput): Promise<ActionProposalView> {
      const requestKey = assertRequestKey(input.requestKey);
      await host.authorizer.assertAllowed(ctx, "action:reserve", input.workspaceId);
      await host.requireAgentSession(ctx);
      await requireActiveWorkspace(host, input.workspaceId);
      const proposal = await readProposalInWorkspace(host.store, input.workspaceId, input.proposalId);
      requireDesignatedExecutor(ctx, proposal);
      const normalized = {
        method: ACTION_METHODS.reserve,
        workspaceId: input.workspaceId,
        proposalId: input.proposalId,
        revision: input.revision,
        intentDigest: input.intentDigest,
      };
      const inputDigest = actionIntentDigest(JSON.stringify(normalized));
      const replayed = await storedReplay<ActionProposalView>(ctx, input.workspaceId, ACTION_METHODS.reserve, requestKey, inputDigest);
      if (replayed !== undefined) return replayed;
      if (proposal.status !== "approved") {
        throw new InvalidTransition(`Only an approved action can reserve dispatch, not ${proposal.status}`, {
          recoveryCode: "invalid_action_transition",
          from: proposal.status,
          recovery: proposal.status === "proposed"
            ? "Record a human approval before reserving dispatch."
            : "This proposal cannot reserve dispatch; propose a new action instead.",
        });
      }
      if (proposal.revision !== input.revision) {
        throw new Conflict(`Proposal revision ${input.revision} does not match current revision ${proposal.revision}; reread before reserving`, {
          recoveryCode: "revision_mismatch",
        });
      }
      if (proposal.intentDigest !== input.intentDigest) {
        throw new Conflict("Intent digest does not match the recorded proposal; a mutated intent cannot reuse approval", {
          recoveryCode: "digest_mismatch",
          recovery: "Reread the proposal and reserve the exact approved digest, or propose a new action.",
        });
      }

      const now = host.clock();
      if (Date.parse(now) > Date.parse(proposal.expiresAt)) {
        throw new InvalidTransition("Approval expired before reservation; dispatch is prevented", {
          recoveryCode: "approval_expired",
          recovery: "Propose a new action with a fresh expiry and approval.",
        });
      }
      // Dispatch-time rechecks: evidence snapshot, configuration, and the
      // proposer/approver/executor authority must all still hold.
      await requireUndisturbedApproval(host, proposal);
      await requireExecutorParticipant(host, proposal);
      await requireReviewAuthority(host, proposal);
      requireSourceAuthorityAtReserve(await host.store.listGithubSourceBindings(proposal.workspaceId), proposal);
      const proposer = await host.store.getParticipant(proposal.workspaceId, proposal.proposedBy);
      if (proposer === undefined) {
        throw new InvalidTransition("The proposer no longer participates in this workspace", {
          recoveryCode: "proposer_authority_lost",
          recovery: "Propose a new action and record a fresh human approval.",
        });
      }

      const targetKey = actionTargetKey(proposal.target);
      const existing = await host.store.getActionTargetReservation(proposal.workspaceId, targetKey);
      if (existing !== undefined) {
        throw new Conflict(`Provider target ${targetKey} is already reserved by proposal ${existing.proposalId}`, {
          recoveryCode: "target_already_reserved",
          recovery: "A new provider run/attempt needs a new proposal and approval.",
        });
      }
      const reservationId = host.idSource("actionReservation");
      const snapshot = buildEvidenceSnapshot(
        proposal.intentDigest,
        proposal.revision + 1,
        now,
        await readCitedState(host, proposal.workspaceId, proposal.taskId, proposal.findingIds, proposal.artifactIds),
      );
      assertActionTransition(proposal.status, "dispatch_reserved");
      const updated: ActionProposal = {
        ...proposal,
        status: "dispatch_reserved",
        revision: proposal.revision + 1,
        updatedAt: now,
        reservation: {
          actor: { actorId: ctx.actor.actorId, actorType: ctx.actor.actorType },
          reservationId,
          evidenceSnapshot: snapshot,
          at: now,
          revision: proposal.revision + 1,
          intentDigest: proposal.intentDigest,
        },
      };
      if (ctx.agentSessionId !== undefined) updated.reservation!.sessionId = ctx.agentSessionId;
      const view: ActionProposalView = { proposal: updated };
      assertProjectionBounds(view);
      const resultJson = JSON.stringify(view);

      try {
        await host.store.transaction(async () => {
          // The executor's authority is rechecked at commit; a revoked
          // membership cannot reserve through a stale read.
          await recheckCommitAuthority(host, ctx, input.workspaceId, ["owner", "member", "agent"]);
          requireDesignatedExecutor(ctx, await readProposalInWorkspace(host.store, input.workspaceId, input.proposalId));
          await requireUndisturbedApproval(host, proposal);
          await requireExecutorParticipant(host, proposal);
          await requireReviewAuthority(host, proposal);
          requireSourceAuthorityAtReserve(await host.store.listGithubSourceBindings(proposal.workspaceId), proposal);
          const claimed = await host.store.updateActionProposal(proposal.id, {
            status: "dispatch_reserved",
            revision: proposal.revision + 1,
            updatedAt: now,
            reservationActorId: ctx.actor.actorId,
            reservationActorType: ctx.actor.actorType,
            reservationSessionId: ctx.agentSessionId ?? null,
            reservedAt: now,
            reservationId,
            reservationRevision: proposal.revision + 1,
            evidenceSnapshotJson: JSON.stringify(snapshot),
          }, { revision: proposal.revision, status: "approved" });
          if (!claimed) {
            throw new Conflict("The proposal changed before this reservation could commit; reread and retry", {
              recoveryCode: "revision_mismatch",
            });
          }
          try {
            await host.store.createActionTargetReservation({
              workspaceId: proposal.workspaceId,
              targetKey,
              proposalId: proposal.id,
              reservationId,
              reservedAt: now,
            });
          } catch (error) {
            if (isConstraintError(error)) {
              throw new Conflict(`Provider target ${targetKey} is already reserved`, {
                recoveryCode: "target_already_reserved",
                recovery: "A new provider run/attempt needs a new proposal and approval.",
              });
            }
            throw error;
          }
          await host.store.putActionMutationReceipt({
            workspaceId: input.workspaceId,
            actorId: ctx.actor.actorId,
            actorType: ctx.actor.actorType,
            method: ACTION_METHODS.reserve,
            requestKey,
            inputDigest,
            resultJson,
            createdAt: now,
          });
          await host.record(ctx, input.workspaceId, "update", "action_proposal", proposal.id, {
            status: "dispatch_reserved",
            revision: proposal.revision + 1,
            intentDigest: proposal.intentDigest,
            reservationId,
          }, now);
        });
      } catch (error) {
        return await commitReplayOrConflict<ActionProposalView>(error, ctx, input.workspaceId, ACTION_METHODS.reserve, requestKey, inputDigest, async () => {
          if (error instanceof Conflict) throw error;
          const target = await host.store.getActionTargetReservation(proposal.workspaceId, targetKey);
          if (target !== undefined && target.proposalId !== proposal.id) {
            throw new Conflict(`Provider target ${targetKey} is already reserved by proposal ${target.proposalId}`, {
              recoveryCode: "target_already_reserved",
              recovery: "A new provider run/attempt needs a new proposal and approval.",
            });
          }
          throw error;
        });
      }
      return view;
    },

    async record_action_outcome(ctx: ActorContext, input: RecordActionOutcomeInput): Promise<ActionReceipt> {
      const requestKey = assertRequestKey(input.requestKey);
      await host.authorizer.assertAllowed(ctx, "action:report", input.workspaceId);
      await host.requireAgentSession(ctx);
      await requireActiveWorkspace(host, input.workspaceId);
      const proposal = await readProposalInWorkspace(host.store, input.workspaceId, input.proposalId);
      requireDesignatedExecutor(ctx, proposal);
      let providerRef: ActionReceipt["providerRef"];
      try {
        providerRef = normalizeActionProviderRef(input.providerRef);
      } catch (error) {
        throw new ValidationError(error instanceof Error ? error.message : "Invalid provider reference", {
          field: "providerRef",
        });
      }
      const normalized = {
        method: ACTION_METHODS.report,
        workspaceId: input.workspaceId,
        proposalId: input.proposalId,
        revision: input.revision,
        intentDigest: input.intentDigest,
        outcome: input.outcome,
        providerRef,
        resolvesReceiptId: input.resolvesReceiptId,
      };
      const inputDigest = actionIntentDigest(JSON.stringify(normalized));
      const replayed = await storedReplay<ActionReceipt>(ctx, input.workspaceId, ACTION_METHODS.report, requestKey, inputDigest);
      if (replayed !== undefined) return replayed;
      // A retried submission report with the same receipt key replays the
      // recorded receipt instead of appending a duplicate. The scope includes
      // the recorder, so a different actor may reuse the key.
      const existingReceipt = await host.store.getActionReceiptByRequestKey(proposal.id, ctx.actor, requestKey);
      if (existingReceipt !== undefined) {
        throw new Conflict("This receipt key already recorded a different outcome; use a new requestKey", {
          recoveryCode: "request_key_conflict",
        });
      }

      try {
        assertReceiptAllowed(proposal.status, input.outcome, input.resolvesReceiptId);
      } catch (error) {
        if (error instanceof Error && (error as Error & { code?: string }).code === "InvalidTransition") {
          throw new InvalidTransition(error.message, {
            recoveryCode: "invalid_action_transition",
            from: proposal.status,
            recovery: "Contradictory terminal receipts are rejected; reconcile an unknown submission instead of overwriting it.",
          });
        }
        throw new ValidationError(error instanceof Error ? error.message : "Invalid outcome", { field: "outcome" });
      }
      if (proposal.revision !== input.revision) {
        throw new Conflict(`Proposal revision ${input.revision} does not match current revision ${proposal.revision}; reread before reporting`, {
          recoveryCode: "revision_mismatch",
        });
      }
      if (proposal.intentDigest !== input.intentDigest) {
        throw new Conflict("Intent digest does not match the recorded proposal", {
          recoveryCode: "digest_mismatch",
        });
      }
      if (proposal.reservation === undefined) {
        throw new InvalidTransition("No dispatch reservation is recorded for this proposal", {
          recoveryCode: "reservation_required",
        });
      }
      // Reconciliation resolves one recorded unknown receipt; the original
      // uncertainty is preserved, never overwritten.
      if (input.outcome === "reconciled_accepted" || input.outcome === "reconciled_failure") {
        const resolved = input.resolvesReceiptId === undefined
          ? undefined
          : await host.store.getActionReceipt(input.resolvesReceiptId);
        if (resolved === undefined || resolved.proposalId !== proposal.id || resolved.outcome !== "unknown") {
          throw new InvalidTransition("Reconciliation must cite the recorded unknown receipt for this proposal", {
            recoveryCode: "unknown_receipt_required",
          });
        }
      }
      const now = host.clock();
      const receipt: ActionReceipt = {
        id: host.idSource("actionReceipt"),
        proposalId: proposal.id,
        workspaceId: proposal.workspaceId,
        reservationId: proposal.reservation.reservationId,
        intentDigest: proposal.intentDigest,
        outcome: input.outcome,
        providerRef,
        recordedBy: { actorId: ctx.actor.actorId, actorType: ctx.actor.actorType },
        recordedAt: now,
        requestKey,
      };
      if (input.resolvesReceiptId !== undefined) receipt.resolvesReceiptId = input.resolvesReceiptId;
      if (ctx.agentSessionId !== undefined) receipt.recordedSessionId = ctx.agentSessionId;
      if (utf8Bytes(JSON.stringify(receipt)) > ACTION_RECEIPT_MAX_BYTES) {
        throw new ValidationError(`Action receipt exceeds ${ACTION_RECEIPT_MAX_BYTES} bytes`, { field: "providerRef" });
      }
      const nextStatus = outcomeStatus(input.outcome);
      assertActionTransition(proposal.status, nextStatus);
      const resultJson = JSON.stringify(receipt);

      try {
        await host.store.transaction(async () => {
          await recheckCommitAuthority(host, ctx, input.workspaceId, ["owner", "member", "agent"]);
          requireDesignatedExecutor(ctx, await readProposalInWorkspace(host.store, input.workspaceId, input.proposalId));
          const claimed = await host.store.updateActionProposal(proposal.id, {
            status: nextStatus,
            revision: proposal.revision + 1,
            updatedAt: now,
          }, { revision: proposal.revision, status: proposal.status });
          if (!claimed) {
            throw new Conflict("The proposal changed before this outcome could commit; reread and retry", {
              recoveryCode: "revision_mismatch",
            });
          }
          await host.store.createActionReceipt(receipt);
          await host.store.putActionMutationReceipt({
            workspaceId: input.workspaceId,
            actorId: ctx.actor.actorId,
            actorType: ctx.actor.actorType,
            method: ACTION_METHODS.report,
            requestKey,
            inputDigest,
            resultJson,
            createdAt: now,
          });
          await host.record(ctx, input.workspaceId, "create", "action_receipt", receipt.id, {
            outcome: input.outcome,
            revision: proposal.revision + 1,
            intentDigest: proposal.intentDigest,
            reservationId: receipt.reservationId,
          }, now);
        });
      } catch (error) {
        return await commitReplayOrConflict<ActionReceipt>(error, ctx, input.workspaceId, ACTION_METHODS.report, requestKey, inputDigest, () => {
          throw error;
        });
      }
      return receipt;
    },

    async get_action_proposal(ctx: ActorContext, input: GetActionProposalInput): Promise<ActionProposalView> {
      await host.authorizer.assertAllowed(ctx, "workspace:read", input.workspaceId);
      const proposal = await readProposalInWorkspace(host.store, input.workspaceId, input.proposalId);
      const observations = await signedObservations(host, proposal);
      const view: ActionProposalView = { proposal, latestReceipt: await latestReceipt(host, proposal) };
      if (observations[0] !== undefined) view.signedObservation = observations[0];
      assertProjectionBounds(view);
      return view;
    },

    async list_action_proposals(ctx: ActorContext, input: ListActionProposalsInput): Promise<ActionProposalPage> {
      await host.authorizer.assertAllowed(ctx, "workspace:read", input.workspaceId);
      const limit = assertPageLimit(input.limit);
      const after = input.cursor === undefined ? undefined : decodeActionCursor(input.cursor, input.workspaceId, "proposals");
      const page = await host.store.pageActionProposals(input.workspaceId, after === undefined ? { limit } : { limit, after });
      // Read pages carry at most 64 KiB. Long histories must not silently
      // expand a bounded read, so over-budget tails are trimmed into a cursor.
      const fitted = fitPage(page.items);
      const last = fitted.items[fitted.items.length - 1];
      const truncated = page.hasMore || fitted.trimmed;
      const nextCursor = truncated && last !== undefined
        ? encodeActionCursor({ q: "proposals", w: input.workspaceId, at: last.updatedAt, id: last.id })
        : page.next !== undefined
          ? encodeActionCursor({ q: "proposals", w: input.workspaceId, at: page.next.at, id: page.next.id })
          : undefined;
      return {
        schemaVersion: 1,
        workspaceId: input.workspaceId,
        ...toContextSlice(fitted.items, page.total, truncated ? nextCursor : undefined),
      };
    },

    async list_action_receipts(ctx: ActorContext, input: ListActionReceiptsInput): Promise<ActionReceiptPage> {
      await host.authorizer.assertAllowed(ctx, "workspace:read", input.workspaceId);
      // The proposal read keeps receipts workspace-scoped: a foreign
      // proposal id reads as not found and exposes no receipt content.
      const proposal = await readProposalInWorkspace(host.store, input.workspaceId, input.proposalId);
      const limit = assertPageLimit(input.limit);
      const after = input.cursor === undefined ? undefined : decodeActionCursor(input.cursor, input.workspaceId, "receipts");
      const page = await host.store.pageActionReceipts(
        input.workspaceId,
        input.proposalId,
        after === undefined ? { limit } : { limit, after },
      );
      const fitted = fitPage(page.items);
      const last = fitted.items[fitted.items.length - 1];
      const truncated = page.hasMore || fitted.trimmed;
      const nextCursor = truncated && last !== undefined
        ? encodeActionCursor({ q: "receipts", w: input.workspaceId, at: last.recordedAt, id: last.id })
        : page.next !== undefined
          ? encodeActionCursor({ q: "receipts", w: input.workspaceId, at: page.next.at, id: page.next.id })
          : undefined;
      const observations = await signedObservations(host, proposal);
      return {
        schemaVersion: 1,
        workspaceId: input.workspaceId,
        proposalId: input.proposalId,
        ...toContextSlice(fitted.items, page.total, truncated ? nextCursor : undefined),
        ...(observations.length > 0 ? { linkedObservations: observations } : {}),
      };
    },
  };
}

export type AsyncActionProposalActions = ReturnType<typeof createAsyncActionProposalActions>;
