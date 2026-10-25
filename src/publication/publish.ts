/**
 * SHR-001 publication orchestrator.
 *
 * Preflight → lock local writes → snapshot at one append tip → enroll a fresh
 * hosted owner namespace → one atomic import → verify the hosted graph as the
 * owner and each owner agent → re-check the local tip → cut the local profile
 * over to the hosted endpoint. Every stage is persisted before the next one,
 * so a lost response or crash resumes the same request instead of creating a
 * second workspace.
 */
import { existsSync } from "node:fs";
import { Conflict, ValidationError } from "../domain/errors.js";
import {
  PUBLICATION_STATES,
  type PublicationCounts,
  type PublicationEnrollmentInput,
  type PublicationImportReceipt,
  type PublicationReceipt,
  type PublicationSnapshot,
  type PublicationState,
} from "../domain/publication.js";
import { canonicalEndpoint } from "../bootstrap/endpoint.js";
import {
  defaultHarnessConfigPath,
  assertConnectionCompatible,
  prepareConnection,
  type SupportedHarness,
} from "../bootstrap/connect.js";
import { loadAnyProfile, readOperatorAgentToken } from "../bootstrap/profile.js";
import { loadRemoteProfile } from "../bootstrap/remote-profile.js";
import { generateRawToken, hashToken } from "../service/tokens.js";
import { campfireHttpCall } from "../http/client.js";
import { enrollPublication, importPublication } from "./client.js";
import { randomHex, randomRecoverySecret, sha256Hex } from "./digest.js";
import { persistPublishedProfile } from "./profile-cutover.js";
import { inspectPublicationSource, readWorkspaceSnapshot, assertSnapshotWithinLimits } from "./snapshot.js";
import {
  acquirePublicationLock,
  markPublicationCutover,
  readPublicationLock,
  readPublicationState,
  releasePublicationLock,
  savePublicationState,
  updatePublicationReceipt,
  type PublicationLock,
} from "./state.js";

export interface PublishInput {
  endpoint: string;
  databasePath: string;
  localUrl: string;
  ownerHumanId: string;
  ownerHumanName: string;
  packageVersion: string;
  workspaceId?: string;
  allowLoopbackHttp?: boolean;
  connect?: boolean;
  dryRun?: boolean;
  rehearsalCode?: string;
  env?: NodeJS.ProcessEnv;
  now?: () => string;
  mcpCommand?: string;
}

export interface PublishResult {
  receipt: PublicationReceipt;
  snapshot?: PublicationSnapshot;
  alreadyPublished?: boolean;
  warnings: string[];
}

function now(input: PublishInput): string {
  return (input.now ?? (() => new Date().toISOString()))();
}

function assert(condition: unknown, message: string, field: string): asserts condition {
  if (!condition) throw new ValidationError(message, { field, nextAction: "inspect_publication_state" });
}

function stateRank(state: PublicationState): number {
  return PUBLICATION_STATES.indexOf(state);
}

function receiptFor(input: {
  publicationId: string;
  endpoint: string;
  databasePath: string;
  workspaceId: string;
  workspaceName: string;
  packageVersion: string;
  schemaVersion: number;
  sourceTip: number;
  digest: string;
  counts: PublicationCounts;
  owner: { humanId: string; displayName: string };
  agents: Array<{ id: string; name: string; harness: "codex" | "opencode" }>;
  state: PublicationState;
  nextAction: string;
  organizationId?: string;
  teamId?: string;
  importedAt?: string;
  verifiedAt?: string;
  cutOverAt?: string;
}): PublicationReceipt {
  return {
    version: 1,
    kind: "workspace_publication",
    publicationId: input.publicationId,
    state: input.state,
    endpoint: input.endpoint,
    workspaceId: input.workspaceId,
    workspaceName: input.workspaceName,
    sourceDatabasePath: input.databasePath,
    sourcePackageVersion: input.packageVersion,
    sourceSchemaVersion: input.schemaVersion,
    sourceTip: input.sourceTip,
    snapshotDigest: input.digest,
    counts: input.counts,
    owner: input.owner,
    agents: input.agents,
    ...(input.organizationId === undefined ? {} : { organizationId: input.organizationId }),
    ...(input.teamId === undefined ? {} : { teamId: input.teamId }),
    ...(input.importedAt === undefined ? {} : { importedAt: input.importedAt }),
    ...(input.verifiedAt === undefined ? {} : { verifiedAt: input.verifiedAt }),
    ...(input.cutOverAt === undefined ? {} : { cutOverAt: input.cutOverAt }),
    nextAction: input.nextAction,
  };
}

function selectionError(message: string): never {
  throw new ValidationError(message, { field: "workspaceId", nextAction: "select_local_workspace" });
}

function resolveLocalWorkspace(input: PublishInput): string {
  if (input.workspaceId !== undefined && input.workspaceId.trim().length > 0) return input.workspaceId;
  const profile = loadAnyProfile(input.env);
  if (profile?.mode === "remote") {
    // A remote profile may resume a cut_over receipt or a verified cutover
    // repair; it never selects a different local database.
    if (profile.workspaceId.trim().length > 0) return profile.workspaceId;
    throw new ValidationError("This profile is already hosted; local publication is not available", {
      field: "profile",
      nextAction: "use_remote_profile",
    });
  }
  if (profile?.workspaceId !== undefined) return profile.workspaceId;
  selectionError("No local workspace is selected; pass --workspace <id>");
}

function existingStateFor(input: PublishInput, endpoint: string, workspaceId: string): PublicationReceipt | undefined {
  const state = readPublicationState(input.env);
  if (state === undefined) return undefined;
  if (state.receipt.endpoint !== endpoint) {
    throw new Conflict("A publication receipt exists for a different hosted endpoint", {
      field: "publication",
      nextAction: "inspect_publication_state",
    });
  }
  if (state.receipt.workspaceId !== workspaceId) {
    throw new Conflict("A publication receipt exists for a different local workspace", {
      field: "publication",
      nextAction: "inspect_publication_state",
    });
  }
  return state.receipt;
}

interface VerificationInput {
  endpoint: string;
  workspaceId: string;
  snapshot: PublicationSnapshot;
  humanToken: string;
  agentTokens: Record<string, string>;
}

/**
 * A committed publication may already contain extra `register_session`
 * contributions from an older verifier attempt. They are allowed only after
 * the frozen source prefix, only for an owner agent. Everything in the source
 * prefix must match byte-for-byte by id and order.
 */
export function assertHostedActivityPrefix(
  snapshot: PublicationSnapshot,
  activity: Array<{
    id: string;
    appendPosition?: unknown;
    action?: string;
    objectType?: string;
    actor?: { actorId?: string };
  }>,
  ownerAgentIds: ReadonlySet<string>,
): void {
  const ordered = [...activity].sort((a, b) =>
    (typeof a.appendPosition === "number" ? a.appendPosition : 0) -
    (typeof b.appendPosition === "number" ? b.appendPosition : 0));
  assert(ordered.length >= snapshot.contributions.length, "Hosted contribution history is shorter than the source", "verification.contributions");
  for (let index = 0; index < snapshot.contributions.length; index += 1) {
    assert(ordered[index]?.id === snapshot.contributions[index]!.id, "Hosted contribution ids do not match", "verification.contributions");
  }
  assert(ordered[snapshot.contributions.length - 1]?.appendPosition === snapshot.source.contributionTip,
    "Hosted contribution source tip does not match", "verification.contributions");
  for (const extra of ordered.slice(snapshot.contributions.length)) {
    assert(extra.action === "register_session" && extra.objectType === "agent_session" &&
      extra.actor?.actorId !== undefined && ownerAgentIds.has(extra.actor.actorId),
      "Hosted contribution history changed after import", "verification.contributions");
  }
}

async function verifyHosted(input: VerificationInput): Promise<void> {
  const call = <T>(token: string, method: string, params: Record<string, unknown> = {}) =>
    campfireHttpCall<T>({ baseUrl: input.endpoint, token, method, params });
  const who = await call<{ actor: { actorId: string; actorType: string } }>(input.humanToken, "whoami");
  assert(who.actor.actorType === "human" && who.actor.actorId === input.snapshot.owner.humanId, "Hosted owner identity does not match the source owner", "verification.owner");
  const view = await call<{
    workspace: { id: string; name: string; status: string };
    goal?: { id: string; title: string; status: string };
    participants: Array<{ actor: { actorId: string; actorType: string }; role: string; joinedAt: string }>;
    tasks: Array<{ id: string; status: string }>;
    findings: Array<{ id: string; currentness?: string; predecessorId?: string; successorId?: string; evidence?: Array<{ id: string; relation: string }> }>;
    decisions: Array<{ id: string; status: string; predecessorId?: string; successorId?: string; citations?: Array<{ id: string }> }>;
    artifacts: Array<{ id: string }>;
    activity: Array<{ id: string; appendPosition?: number }>;
  }>(input.humanToken, "get_workspace", { workspaceId: input.workspaceId });
  assert(view.workspace.id === input.snapshot.workspace.id, "Hosted workspace id does not match", "verification.workspace");
  assert(view.workspace.name === input.snapshot.workspace.name, "Hosted workspace name does not match", "verification.workspace");
  assert(view.workspace.status === input.snapshot.workspace.status, "Hosted workspace status does not match", "verification.workspace");

  const participantKey = (row: { actor: { actorId: string; actorType: string }; role: string }) => `${row.actor.actorType}:${row.actor.actorId}:${row.role}`;
  const expectedParticipants = new Set(input.snapshot.participants.map((row) => `${row.actorType}:${row.actorId}:${row.role}`));
  const actualParticipants = new Set(view.participants.map(participantKey));
  assert(expectedParticipants.size === actualParticipants.size &&
    [...expectedParticipants].every((key) => actualParticipants.has(key)), "Hosted participant set does not match", "verification.participants");

  const sourceGoal = input.snapshot.goals[0];
  if (sourceGoal === undefined) assert(view.goal === undefined, "Hosted workspace has an unexpected goal", "verification.goal");
  else {
    assert(view.goal?.id === sourceGoal.id && view.goal.title === sourceGoal.title && view.goal.status === sourceGoal.status,
      "Hosted goal does not match", "verification.goal");
  }

  const ids = (rows: Array<{ id: string }>) => rows.map((row) => row.id).sort().join(",");
  assert(ids(view.tasks) === ids(input.snapshot.tasks), "Hosted task ids do not match", "verification.tasks");
  assert(view.tasks.every((row) => input.snapshot.tasks.find((source) => source.id === row.id)?.status === row.status),
    "Hosted task state does not match", "verification.tasks");
  assert(ids(view.findings) === ids(input.snapshot.findings), "Hosted finding ids do not match", "verification.findings");
  for (const hosted of view.findings) {
    const source = input.snapshot.findings.find((row) => row.id === hosted.id)!;
    assert((hosted.currentness ?? "current") === source.currentness, "Hosted finding currentness does not match", "verification.findings");
    assert(hosted.predecessorId === source.predecessorId && hosted.successorId === source.successorId,
      "Hosted finding correction links do not match", "verification.findings");
    assert(ids(hosted.evidence ?? []) === ids(input.snapshot.findingEvidence.filter((row) => row.findingId === source.id)),
      "Hosted finding evidence does not match", "verification.findings");
  }
  assert(ids(view.decisions) === ids(input.snapshot.decisions), "Hosted decision ids do not match", "verification.decisions");
  for (const hosted of view.decisions) {
    const source = input.snapshot.decisions.find((row) => row.id === hosted.id)!;
    assert(hosted.status === source.status, "Hosted decision status does not match", "verification.decisions");
    assert(hosted.predecessorId === source.predecessorId && hosted.successorId === source.successorId,
      "Hosted decision links do not match", "verification.decisions");
    assert(ids(hosted.citations ?? []) === ids(input.snapshot.decisionCitations.filter((row) => row.decisionId === source.id)),
      "Hosted decision citations do not match", "verification.decisions");
  }
  assert(ids(view.artifacts) === ids(input.snapshot.artifacts), "Hosted artifact ids do not match", "verification.artifacts");
  const ownerAgentIds = new Set(input.snapshot.agents
    .filter((agent) => agent.humanId === input.snapshot.owner.humanId)
    .map((agent) => agent.id));
  assertHostedActivityPrefix(input.snapshot, view.activity, ownerAgentIds);

  for (const agent of input.snapshot.agents.filter((row) => input.agentTokens[row.harness] !== undefined)) {
    const agentWho = await call<{ actor: { actorId: string; actorType: string } }>(input.agentTokens[agent.harness]!, "whoami");
    assert(agentWho.actor.actorType === "agent" && agentWho.actor.actorId === agent.id,
      "Hosted agent identity does not match", "verification.agents");
    const agentView = await call<{ findings: Array<{ id: string }> }>(input.agentTokens[agent.harness]!, "get_workspace", { workspaceId: input.workspaceId });
    assert(ids(agentView.findings) === ids(input.snapshot.findings), "Hosted agent cannot read the complete finding set", "verification.agents");
  }
  for (const session of input.snapshot.sessions.filter((row) => row.endedAt === undefined)) {
    const agent = input.snapshot.agents.find((row) => row.id === session.agentId);
    const token = agent === undefined ? undefined : input.agentTokens[agent.harness];
    if (token === undefined) continue;
    const ready = await call<{ workspaceId: string; actor: { actorId: string }; sessionId?: string }>(token, "preflight", {
      workspaceId: input.workspaceId,
      agentSessionId: session.id,
    });
    assert(ready.workspaceId === input.workspaceId && ready.actor.actorId === session.agentId && ready.sessionId === session.id,
      "Hosted active session does not match", "verification.sessions");
  }

}

function preparePublishedConnections(input: {
  snapshot: PublicationSnapshot;
  endpoint: string;
  agentTokens: Record<string, string>;
  env: NodeJS.ProcessEnv;
  localUrl: string;
  mcpCommand: string;
}): string[] {
  const warnings: string[] = [];
  for (const agent of input.snapshot.agents) {
    const token = input.agentTokens[agent.harness];
    if (token === undefined || (agent.harness !== "codex" && agent.harness !== "opencode")) continue;
    const harness = agent.harness as SupportedHarness;
    const configPath = defaultHarnessConfigPath(harness, input.env);
    try {
      const localToken = readOperatorAgentToken(input.env, harness);
      const configExists = existsSync(configPath);
      if (configExists && localToken === undefined) {
        warnings.push(`The ${harness} config already exists but its local credential is unavailable; run campfire connect --harness ${harness} to rebind it explicitly.`);
        continue;
      }
      if (configExists) {
        assertConnectionCompatible({ harness, configPath, url: input.localUrl, agentToken: localToken! });
      }
      prepareConnection({
        harness,
        configPath,
        mcpCommand: input.mcpCommand,
        url: input.endpoint,
        agentToken: token,
        workspaceId: input.snapshot.workspace.id,
      });
    } catch {
      warnings.push(`The ${harness} connection was not rewritten; run campfire connect --harness ${harness} to finish rebinding.`);
    }
  }
  return warnings;
}

export async function publishWorkspace(input: PublishInput): Promise<PublishResult> {
  const env = input.env ?? process.env;
  const endpoint = canonicalEndpoint(input.endpoint, { allowLoopbackHttp: input.allowLoopbackHttp === true });
  const workspaceId = resolveLocalWorkspace(input);
  const existing = existingStateFor(input, endpoint, workspaceId);
  if (existing?.state === "cut_over") {
    // Repair a missing marker after a crash between the profile write and the
    // marker/receipt update. The local backup must not stay writable.
    markPublicationCutover({
      workspaceId: existing.workspaceId,
      publicationId: existing.publicationId,
      databasePath: existing.sourceDatabasePath,
      cutOverAt: existing.cutOverAt ?? now(input),
    }, env);
    return { receipt: existing, alreadyPublished: true, warnings: [] };
  }
  const remote = loadRemoteProfile(env);
  if (remote !== undefined && existing === undefined) {
    throw new ValidationError("This installation already uses a remote Campfire profile", {
      field: "profile",
      nextAction: "use_remote_profile",
    });
  }
  if (remote !== undefined && existing?.state === "verified") {
    // Crash window: the profile was written before the receipt advanced to
    // cut_over. Finish the same publication; never create another workspace.
    if (input.dryRun === true) return { receipt: existing, warnings: [] };
    acquirePublicationLock({
      workspaceId: existing.workspaceId,
      publicationId: existing.publicationId,
      databasePath: existing.sourceDatabasePath,
    }, env);
    const frozen = readPublicationState(env);
    if (frozen?.credentials === undefined) {
      throw new Conflict("Hosted publication is verified but its prepared credentials are missing; restore the private publication receipt", {
        field: "publication.credentials",
        nextAction: "restore_publication_receipt",
      });
    }
    persistPublishedProfile({
      url: remote.url,
      humanId: existing.owner.humanId,
      humanName: existing.owner.displayName,
      workspaceId: existing.workspaceId,
      workspaceName: remote.workspaceName ?? existing.workspaceName,
      ...(remote.goalTitle === undefined ? {} : { goalTitle: remote.goalTitle }),
      sourceDatabasePath: existing.sourceDatabasePath,
      humanToken: frozen.credentials.humanToken,
      agents: existing.agents.map((agent) => ({ ...agent, token: frozen.credentials!.agents[agent.harness]! })),
      // The stored endpoint was already accepted when the profile was written.
      allowLoopbackHttp: input.allowLoopbackHttp === true || remote.url === existing.endpoint,
    }, env);
    const receipt: PublicationReceipt = {
      ...existing,
      state: "cut_over",
      cutOverAt: now(input),
      nextAction: `campfire invite-teammate ${existing.workspaceId}`,
    };
    markPublicationCutover({
      workspaceId: receipt.workspaceId,
      publicationId: receipt.publicationId,
      databasePath: receipt.sourceDatabasePath,
      cutOverAt: receipt.cutOverAt!,
    }, env);
    updatePublicationReceipt(receipt, env);
    releasePublicationLock(receipt.publicationId, env);
    return { receipt, warnings: [] };
  }

  const inspection = inspectPublicationSource(input.databasePath, workspaceId, input.ownerHumanId);
  if (inspection.unsupported.length > 0) {
    throw new ValidationError("Workspace contains state this publication slice cannot preserve", {
      field: "unsupported",
      nextAction: "remove_unsupported_state",
      unsupported: inspection.unsupported,
    });
  }
  const localProfile = loadAnyProfile(env);
  const unpublishedOwnerAgents = localProfile?.mode !== "remote" && localProfile?.agents !== undefined
    ? localProfile.agents.filter((agent) => !inspection.agents.some((published) => published.id === agent.id && published.harness === agent.harness))
    : [];
  const sourceWarnings = unpublishedOwnerAgents.map((agent) =>
    `${agent.name} (${agent.harness}) is not a participant of this workspace and was not published; reconnect or enroll that harness separately.`);

  if (input.dryRun === true) {
    const activeLock = readPublicationLock(env);
    if (activeLock !== undefined && activeLock.databasePath === input.databasePath) {
      throw new Conflict("A real publication is active for this workspace; do not run a dry run concurrently", {
        field: "publication",
        nextAction: "wait_or_resume_publish",
      });
    }
    const snapshot = readWorkspaceSnapshot({
      databasePath: input.databasePath,
      workspaceId,
      ownerHumanId: input.ownerHumanId,
      packageVersion: input.packageVersion,
      exportedAt: now(input),
    });
    assertSnapshotWithinLimits(snapshot);
    if (existing !== undefined) return { receipt: existing, snapshot, warnings: sourceWarnings };
    const receipt = receiptFor({
      publicationId: `pub_${randomHex(16)}`,
      endpoint,
      databasePath: input.databasePath,
      workspaceId,
      workspaceName: snapshot.workspace.name,
      packageVersion: input.packageVersion,
      schemaVersion: snapshot.source.schemaVersion,
      sourceTip: snapshot.source.contributionTip,
      digest: snapshot.digest,
      counts: snapshot.counts,
      owner: { humanId: input.ownerHumanId, displayName: input.ownerHumanName },
      agents: inspection.agents.filter((agent) => agent.harness === "codex" || agent.harness === "opencode") as Array<{ id: string; name: string; harness: "codex" | "opencode" }>,
      state: "not_started",
      nextAction: `campfire publish --url ${endpoint}`,
    });
    savePublicationState({ version: 1, receipt }, env);
    return { receipt, snapshot, warnings: sourceWarnings };
  }

  const lock: PublicationLock = acquirePublicationLock({
    workspaceId,
    publicationId: existing?.publicationId ?? `pub_${randomHex(16)}`,
    databasePath: input.databasePath,
  }, env);

  try {
    let state = readPublicationState(env);
    if (state !== undefined && state.receipt.publicationId !== lock.publicationId) {
      throw new Conflict("A different publication owns the current lock", { field: "publication", nextAction: "inspect_publication_state" });
    }

    const snapshot = readWorkspaceSnapshot({
      databasePath: input.databasePath,
      workspaceId,
      ownerHumanId: input.ownerHumanId,
      packageVersion: input.packageVersion,
      exportedAt: now(input),
    });
    assertSnapshotWithinLimits(snapshot);
    assert(snapshot.source.contributionTip === inspection.sourceTip, "Local workspace changed before the snapshot was taken", "sourceTip");

    let receipt = state?.receipt;
    if (receipt === undefined) {
      const ownerAgents = inspection.agents
        .filter((agent) => agent.harness === "codex" || agent.harness === "opencode")
        .map((agent) => ({ ...agent, harness: agent.harness as "codex" | "opencode" }));
      receipt = receiptFor({
        publicationId: lock.publicationId,
        endpoint,
        databasePath: input.databasePath,
        workspaceId,
        workspaceName: snapshot.workspace.name,
        packageVersion: input.packageVersion,
        schemaVersion: snapshot.source.schemaVersion,
        sourceTip: snapshot.source.contributionTip,
        digest: snapshot.digest,
        counts: snapshot.counts,
        owner: { humanId: input.ownerHumanId, displayName: input.ownerHumanName },
        agents: ownerAgents,
        state: "not_started",
        nextAction: "enroll_hosted_owner",
      });
    } else {
      if (stateRank(receipt.state) >= stateRank("staged")) {
        const preparedAgents = receipt.agents.map((agent) => `${agent.id}:${agent.harness}`).sort().join(",");
        const sourceAgents = inspection.agents
          .filter((agent) => agent.harness === "codex" || agent.harness === "opencode")
          .map((agent) => `${agent.id}:${agent.harness}`).sort().join(",");
        if (preparedAgents !== sourceAgents) {
          throw new Conflict("The local owner agent set changed after hosted enrollment; start a new publication request", {
            field: "agents",
            nextAction: "resolve_source_change",
          });
        }
      }
      if (receipt.snapshotDigest !== snapshot.digest) {
        if (stateRank(receipt.state) >= stateRank("committed")) {
          throw new Conflict("The local workspace changed after the hosted import committed; the hosted copy is not cut over", {
            field: "source",
            nextAction: "resolve_source_change",
            localTip: snapshot.source.contributionTip,
            importedTip: receipt.sourceTip,
          });
        }
        receipt = { ...receipt, snapshotDigest: snapshot.digest, sourceTip: snapshot.source.contributionTip, counts: snapshot.counts };
      }
    }

    const agentTokens: Record<string, string> = { ...(state?.credentials?.agents ?? {}) };
    const rehearsalCode = input.rehearsalCode ?? state?.credentials?.rehearsalCode;
    let humanToken = state?.credentials?.humanToken;
    let recoverySecret = state?.credentials?.recoverySecret;
    if ((humanToken === undefined || recoverySecret === undefined) &&
        (receipt.state === "staged" || receipt.state === "committed" || receipt.state === "verified")) {
      throw new Conflict("Hosted publication already exists but its prepared credentials are missing; restore the original private publication receipt", {
        field: "publication.credentials",
        nextAction: "restore_publication_receipt",
      });
    }
    if (humanToken === undefined || recoverySecret === undefined) {
      humanToken = generateRawToken();
      recoverySecret = randomRecoverySecret();
    }
    for (const agent of receipt.agents) {
      if (agentTokens[agent.harness] === undefined) agentTokens[agent.harness] = generateRawToken();
    }
    savePublicationState({
      version: 1,
      receipt,
      credentials: {
        humanToken,
        agents: agentTokens,
        recoverySecret,
        ...(rehearsalCode === undefined ? {} : { rehearsalCode }),
      },
    }, env);

    if (receipt.organizationId === undefined || receipt.teamId === undefined) {
      const inputBody: PublicationEnrollmentInput = {
        requestId: receipt.publicationId,
        humanId: input.ownerHumanId,
        humanName: input.ownerHumanName,
        humanTokenHash: hashToken(humanToken),
        recoveryHash: hashToken(recoverySecret),
        agents: receipt.agents.map((agent) => ({
          id: agent.id,
          name: agent.name,
          harness: agent.harness,
          tokenHash: hashToken(agentTokens[agent.harness]!),
        })),
        workspaceName: snapshot.workspace.name,
        sourceWorkspaceId: snapshot.workspace.id,
        sourcePackageVersion: input.packageVersion,
        sourceSchemaVersion: snapshot.source.schemaVersion,
        deviceKeyHash: sha256Hex(`${input.ownerHumanId}:${receipt.publicationId}:${humanToken}`),
      };
      const enrolled = await enrollPublication({ endpoint, body: inputBody, ...(rehearsalCode === undefined ? {} : { rehearsalCode }) });
      receipt = {
        ...receipt,
        state: "staged",
        organizationId: enrolled.organization.id,
        teamId: enrolled.team.id,
        agents: enrolled.agents,
        nextAction: "import_snapshot",
      };
      updatePublicationReceipt(receipt, env);
    }

    if (receipt.importedAt === undefined) {
      let imported: PublicationImportReceipt;
      try {
        imported = await importPublication({
          endpoint,
          token: humanToken,
          body: { requestId: receipt.publicationId, digest: snapshot.digest, snapshot },
          ...(rehearsalCode === undefined ? {} : { rehearsalCode }),
        });
      } catch (error) {
        // A lost response may still have committed. The same request/digest is
        // idempotent; a different digest is a conflict at the server.
        if (error instanceof Conflict || (error instanceof Error && error.name === "Conflict")) {
          throw error;
        }
        throw new ValidationError("Publication import response was lost; retry the same command to resume the same request", {
          field: "publication",
          nextAction: "retry_publish",
        });
      }
      assert(imported.workspace.id === snapshot.workspace.id, "Hosted import created a different workspace", "import.workspace");
      assert(imported.digest === snapshot.digest, "Hosted import digest does not match", "import.digest");
      receipt = {
        ...receipt,
        state: "committed",
        importedAt: imported.importedAt,
        counts: imported.counts,
        teamId: imported.workspace.teamId,
        nextAction: "verify_hosted_workspace",
      };
      updatePublicationReceipt(receipt, env);
    }

    if (receipt.verifiedAt === undefined) {
      await verifyHosted({ endpoint, workspaceId, snapshot, humanToken, agentTokens });
      const recheck = readWorkspaceSnapshot({
        databasePath: input.databasePath,
        workspaceId,
        ownerHumanId: input.ownerHumanId,
        packageVersion: input.packageVersion,
        exportedAt: now(input),
      });
      if (recheck.digest !== snapshot.digest || recheck.source.contributionTip !== snapshot.source.contributionTip) {
        throw new Conflict("The local workspace changed during verification; the hosted copy remains staged", {
          field: "source",
          nextAction: "resolve_source_change",
        });
      }
      receipt = { ...receipt, state: "verified", verifiedAt: now(input), nextAction: "cut_over_local_profile" };
      updatePublicationReceipt(receipt, env);
    }

    const warnings: string[] = [...sourceWarnings];
    if (input.connect !== false) {
      warnings.push(...preparePublishedConnections({
        snapshot,
        endpoint,
        agentTokens,
        env,
        localUrl: input.localUrl,
        mcpCommand: input.mcpCommand ?? process.argv[1] ?? "campfire",
      }));
    }

    if (receipt.state !== "cut_over") {
      persistPublishedProfile({
        url: endpoint,
        humanId: input.ownerHumanId,
        humanName: input.ownerHumanName,
        workspaceId: snapshot.workspace.id,
        workspaceName: snapshot.workspace.name,
        ...(snapshot.goals[0] === undefined ? {} : { goalTitle: snapshot.goals[0].title }),
        sourceDatabasePath: input.databasePath,
        humanToken,
        agents: receipt.agents.map((agent) => ({ ...agent, token: agentTokens[agent.harness]! })),
        allowLoopbackHttp: input.allowLoopbackHttp === true,
      }, env);
      receipt = {
        ...receipt,
        state: "cut_over",
        cutOverAt: now(input),
        nextAction: `campfire invite-teammate ${snapshot.workspace.id}`,
      };
      // Marker before receipt: a crash here leaves a verified receipt and a
      // read-only backup, which the verified-resume branch repairs.
      markPublicationCutover({
        workspaceId: receipt.workspaceId,
        publicationId: receipt.publicationId,
        databasePath: receipt.sourceDatabasePath,
        cutOverAt: receipt.cutOverAt ?? now(input),
      }, env);
      updatePublicationReceipt(receipt, env);
    }

    releasePublicationLock(receipt.publicationId, env);
    return { receipt, snapshot, warnings };
  } catch (error) {
    // Before staging, nothing hosted exists; release the lock so the operator
    // can fix a local preflight problem. From staged onward the receipt is the
    // recovery point, so the lock stays until cutover or explicit abandonment.
    const current = readPublicationState(env)?.receipt;
    if (current === undefined || current.state === "not_started") releasePublicationLock(lock.publicationId, env);
    throw error;
  }
}

/** Human/JSON-safe projection: no credentials, no raw contribution payloads. */
export function publicationReceiptView(receipt: PublicationReceipt): PublicationReceipt {
  return { ...receipt, counts: receipt.counts };
}

export function publicationStateLabel(receipt: PublicationReceipt): string {
  return receipt.state.replace(/_/g, " ");
}

export function resolveDefaultPublishMcpCommand(): string {
  return process.argv[1] ?? "campfire";
}
