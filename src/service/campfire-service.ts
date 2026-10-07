/**
 * Campfire application service.
 *
 * Orchestrates authorization, domain rules, and persistence. Every meaningful
 * mutation writes exactly one append-only contribution in the same transaction
 * as the object write so provenance cannot be lost or separated from the state
 * it explains (AGENTS.md invariant 5). Storage details stay behind
 * `CampfireStore` (AGENTS.md invariant 7).
 */
import type { ActorContext, Authorizer } from "./authorization.js";
import { ENROLLMENT_HARNESSES, buildEnrollmentPlan, buildOwnedAgentPlan, invitationView, normalizeEnrollOwnedAgentInput, normalizeInvitationLookup, normalizeIssueEnrollmentInput, normalizeRedeemEnrollmentInput, revocationReceipt, type EnrollmentInvitation, type EnrollmentReceipt, type OwnedAgentEnrollmentRecord, type OwnedAgentReceipt } from "../domain/enrollment.js";
import { createSimpleAuthorizer } from "./simple-authorizer.js";
import { assembleWorkspaceContext } from "./context-assembly.js";
import { createCorrectionActions } from "./correction-actions.js";
import { attachCitations, attachEvidence } from "./correction-read.js";
import {
  affectedObjectIds,
  assertCursorWorkspace,
  assembleCatchUp,
  clampPageLimit,
  compareDecisionKeyset,
  CONTEXT_SCHEMA_VERSION,
  contributionCursor,
  decodeContextCursor,
  decisionFetchLimits,
  decisionRank,
  DEFAULT_CONTEXT_BUDGET,
  encodeContextCursor,
  genesisContributionCursor,
  objectCursor,
  ORIENTATION_CHANGE_LOOKAHEAD,
  selectRecentChanges,
  toContextSlice,
  type ContextBudget,
} from "../domain/context-policy.js";
import {
  deriveRecordedAlignment,
  ORIENTATION_PROVENANCE_LIMIT,
  type ActivityPage,
  type AddArtifactInput,
  type AddDecisionInput,
  type AddFindingInput,
  type AttentionItem,
  type AttentionReason,
  type CampfireService,
  type CheckReadinessInput,
  type CreateAgentInput,
  type CreateGoalInput,
  type CreateHumanInput,
  type CreateTaskInput,
  type CreateWorkspaceInput,
  type CurrentWork,
  type GetActivityInput,
  type GetWorkspaceChangesInput,
  type InviteToWorkspaceInput,
  type JoinWorkspaceInput,
  type ListWorkspaceObjectsInput,
  type ParticipantView,
  type ReadinessStatus,
  type RegisterAgentSessionInput,
  type SinceProjection,
  type SuggestedNextAction,
  type UpdateGoalInput,
  type UpdateTaskInput,
  type UpdateWorkspaceInput,
  type WorkspaceCatchUp,
  type WorkspaceContext,
  type WorkspaceObjectPage,
  type WorkspaceSummary,
  type WorkspaceView,
} from "./service.js";
import type {
  ActorRef,
  Agent,
  AgentSession,
  Artifact,
  Contribution,
  ContributionAction,
  ContributionObjectType,
  Decision,
  DecisionStatus,
  Finding,
  Goal,
  Human,
  Task,
  TaskStatus,
  Workspace,
  WorkspaceInvite,
  WorkspaceParticipant,
} from "../domain/types.js";
import { generateRawToken, hashToken } from "./tokens.js";
import { createId, nowIso } from "../domain/ids.js";
import type { IdSource } from "../domain/ids.js";
import {
  ActorNotFound,
  ArtifactNotFound,
  Conflict,
  CrossWorkspaceReference,
  DecisionNotFound,
  FindingNotFound,
  GoalNotFound,
  ParticipantRequired,
  SessionNotFound,
  TaskNotFound,
  TeamNotFound,
  Unauthorized,
  ValidationError,
  WorkspaceNotFound,
} from "../domain/errors.js";
import { normalizeArtifactUri } from "../domain/artifacts.js";
import { assertTaskTransition, assertWorkspaceTransition } from "../domain/lifecycle.js";
import { assertFindingCurrentness } from "../store/context-queries.js";
import type { CampfireStore, GoalPatch, TaskPatch } from "../store/store.js";
import type { QualifyingMutation } from "../domain/event-qualify.js";
import type { DomainEventSubjectType } from "../domain/events.js";
import { bridgeFromEnv, definedData, planOutbox, resolveOnBehalfOf } from "./outbox.js";

export interface CampfireServiceOptions {
  store: CampfireStore;
  idSource?: IdSource;
  clock?: () => string;
  /** Operator webhook env. Defaults to process.env. A bad bridge does not fail the mutation. */
  webhookEnv?: Record<string, string | undefined>;
}

function assertNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new ValidationError(`${field} must not be empty`, { field });
  }
}

export function createCampfireService(options: CampfireServiceOptions): CampfireService {
  const store = options.store;
  const idSource: IdSource = options.idSource ?? ((kind) => createId(kind));
  const clock: () => string = options.clock ?? nowIso;
  const authorizer: Authorizer = createSimpleAuthorizer(store);
  const webhookEnv = options.webhookEnv ?? process.env;

  function assertEnrollmentOwner(ctx: ActorContext, workspaceId: string): Workspace {
    authorizer.assertAllowed(ctx, "workspace:read", workspaceId);
    const workspace = store.getWorkspace(workspaceId);
    if (ctx.actor.actorType !== "human" || store.getParticipant(workspaceId, ctx.actor)?.role !== "owner" || workspace === undefined) {
      throw new Unauthorized("Only a human workspace owner may administer enrollment invitations", { recoveryCode: "owner_required" });
    }
    return workspace;
  }

  function assertInvitationUsable(invitation: EnrollmentInvitation | undefined, invitationId: string, now: string): EnrollmentInvitation {
    if (invitation === undefined || invitation.id !== invitationId || invitation.revokedAt !== undefined || invitation.expiresAt <= now) {
      throw new Unauthorized("Invalid enrollment invitation", { recoveryCode: "invalid_enrollment_invitation" });
    }
    const workspace = store.getWorkspace(invitation.workspaceId);
    const issuer = store.getHuman(invitation.issuedByHumanId);
    const participant = store.getParticipant(invitation.workspaceId, { actorId: invitation.issuedByHumanId, actorType: "human" });
    if (workspace?.status !== "active" || workspace.teamId !== invitation.teamId || issuer?.teamId !== invitation.teamId || participant?.role !== "owner") {
      throw new Unauthorized("Invalid enrollment invitation", { recoveryCode: "invalid_enrollment_invitation" });
    }
    return invitation;
  }

  function replayEnrollment(invitation: EnrollmentInvitation, input: ReturnType<typeof normalizeRedeemEnrollmentInput>, digest: string): EnrollmentReceipt {
    if (invitation.requestId !== input.requestId || invitation.requestDigest !== digest || invitation.receipt === undefined) {
      throw new Conflict("Invitation was claimed by a different enrollment request", { recoveryCode: "invitation_already_claimed" });
    }
    const receipt = invitation.receipt;
    const prepared = [
      { hash: input.humanTokenHash, id: receipt.human.id, type: "human" },
      ...input.agents.map((agent) => ({ hash: agent.tokenHash, id: receipt.agents.find((entry) => entry.harness === agent.harness)?.id, type: "agent" })),
    ];
    for (const expected of prepared) {
      const token = store.getActorTokenByHash(expected.hash);
      if (token === undefined || token.revokedAt !== undefined || token.actor.actorId !== expected.id || token.actor.actorType !== expected.type) {
        throw new Unauthorized("Enrollment credentials no longer authorize recovery", { recoveryCode: "enrollment_credentials_revoked" });
      }
    }
    return receipt;
  }

  function replayOwnedAgent(record: OwnedAgentEnrollmentRecord, input: ReturnType<typeof normalizeEnrollOwnedAgentInput>, digest: string): OwnedAgentReceipt {
    if (record.requestId !== input.requestId || record.requestDigest !== digest || record.tokenHash !== input.tokenHash) {
      throw new Conflict("This harness already has an enrolled agent; reconnect that identity", { recoveryCode: "agent_already_enrolled" });
    }
    const token = store.getActorTokenByHash(input.tokenHash);
    if (token === undefined || token.revokedAt !== undefined || token.actor.actorType !== "agent" || token.actor.actorId !== record.receipt.agent.id) {
      throw new Unauthorized("Agent credentials no longer authorize recovery", { recoveryCode: "enrollment_credentials_revoked" });
    }
    return record.receipt;
  }

  function record(
    ctx: ActorContext,
    workspaceId: string,
    action: ContributionAction,
    objectType: ContributionObjectType,
    objectId: string,
    payload: Record<string, unknown> | undefined,
    createdAt: string,
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

  function behalfOf(ctx: ActorContext, workspaceId: string) {
    if (ctx.actor.actorType !== "agent" || ctx.agentSessionId === undefined) return undefined;
    return resolveOnBehalfOf(ctx.actor, workspaceId, store.getAgentSession(ctx.agentSessionId));
  }

  function writeOutbox(
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
  ): void {
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
      bridge: bridgeFromEnv(webhookEnv),
    });
    if (planned === undefined) return;
    store.createDomainEvent(planned.event);
    if (planned.delivery !== undefined) store.createWebhookDelivery(planned.delivery);
  }

  function resolveParticipant(participant: WorkspaceParticipant): ParticipantView {
    const { actor, role, joinedAt } = participant;
    if (actor.actorType === "human") {
      const human = store.getHuman(actor.actorId);
      return { actor, name: human?.displayName ?? actor.actorId, role, joinedAt };
    }
    const agent = store.getAgent(actor.actorId);
    return {
      actor,
      name: agent?.name ?? actor.actorId,
      role,
      harness: agent?.harness,
      humanOwnerId: agent?.humanId,
      joinedAt,
    };
  }

  function actorName(actor: ActorRef): string {
    if (actor.actorType === "human") {
      return store.getHuman(actor.actorId)?.displayName ?? actor.actorId;
    }
    return store.getAgent(actor.actorId)?.name ?? actor.actorId;
  }

  function describeContribution(contribution: Contribution, name: string): string {
    const payload = contribution.payload ?? {};
    const detail =
      typeof payload.summary === "string"
        ? payload.summary
        : typeof payload.title === "string"
          ? payload.title
          : typeof payload.status === "string"
            ? payload.status
            : undefined;

    if (typeof payload.changeType === "string" && typeof payload.reason === "string") {
      return `${name} ${payload.changeType} ${contribution.objectType} ${contribution.objectId}: ${payload.reason}`;
    }
    if (contribution.action === "join") {
      return `${name} joined ${contribution.objectType} ${contribution.objectId}`;
    }
    if (contribution.action === "register_session") {
      return `${name} registered ${contribution.objectType} ${contribution.objectId}`;
    }
    const verb = contribution.action === "update" ? "updated" : "contributed";
    const base = `${name} ${verb} ${contribution.objectType} ${contribution.objectId}`;
    return detail === undefined ? base : `${base}: ${detail}`;
  }

  function provenance(ctx: ActorContext, now: string): {
    createdBy: ActorRef;
    agentSessionId?: string;
    createdAt: string;
  } {
    return { createdBy: ctx.actor, agentSessionId: ctx.agentSessionId, createdAt: now };
  }

  function mintToken(actor: ActorRef, createdAt: string): string {
    const raw = generateRawToken();
    store.createActorToken({
      id: idSource("token"),
      actor,
      tokenHash: hashToken(raw),
      createdAt,
    });
    return raw;
  }

  function requireActor(actor: ActorRef): Human | Agent {
    const identity = actor.actorType === "human" ? store.getHuman(actor.actorId) : store.getAgent(actor.actorId);
    if (identity === undefined) {
      throw new ActorNotFound(actor.actorId);
    }
    return identity;
  }

  // Agents must act through a registered session for writes so provenance
  // can record which session produced the state (AGENTS.md invariant 5).
  function requireAgentSession(ctx: ActorContext): void {
    if (ctx.actor.actorType === "agent" && ctx.agentSessionId === undefined) {
      throw new Unauthorized(`Agent ${ctx.actor.actorId} must act through a registered agent session`);
    }
  }

  function requireAssigneeInWorkspace(workspaceId: string, assignee: ActorRef): void {
    requireActor(assignee);
    if (store.getParticipant(workspaceId, assignee) === undefined) {
      throw new ParticipantRequired(
        `Assignee ${assignee.actorId} is not a participant of workspace ${workspaceId}`,
      );
    }
  }

  function readinessFailure(workspaceId: string): Unauthorized {
    return new Unauthorized(
      `Agent has no active session for workspace ${workspaceId}; call register_agent_session first`,
      { workspaceId, nextAction: "register_agent_session" },
    );
  }

  // --- Sprint 008 orientation derivation -----------------------------------
  // One deterministic, authorization-aware attention model shared by every
  // surface. The Viewer consumes this projection and never recomputes it.

  function compareByUpdatedThenId(
    a: { updatedAt: string; id: string },
    b: { updatedAt: string; id: string },
  ): number {
    if (a.updatedAt < b.updatedAt) return -1;
    if (a.updatedAt > b.updatedAt) return 1;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  }

  function isAssignedTo(actor: ActorRef, assignee: ActorRef | undefined): boolean {
    return (
      assignee !== undefined &&
      assignee.actorId === actor.actorId &&
      assignee.actorType === actor.actorType
    );
  }

  function attentionItemFromTask(task: Task, reason: AttentionReason): AttentionItem {
    const item: AttentionItem = {
      kind: "task",
      id: task.id,
      summary: task.title,
      status: task.status,
      reason,
    };
    if (task.assignee !== undefined) {
      item.assignee = task.assignee;
    }
    return item;
  }

  function attentionItemFromDecision(decision: Decision, reason: AttentionReason): AttentionItem {
    return {
      kind: "decision",
      id: decision.id,
      summary: decision.summary,
      status: decision.status,
      reason,
    };
  }

  function deriveSuggestedNextAction(
    needsYou: AttentionItem[],
    needsAttention: AttentionItem[],
    tasks: Task[],
  ): SuggestedNextAction {
    const actionableDecision = needsYou.find(
      (item) => item.reason === "proposed_decision_actionable",
    );
    if (actionableDecision !== undefined) {
      return {
        kind: "decision",
        id: actionableDecision.id,
        summary: actionableDecision.summary,
        reason: "proposed_decision_actionable",
        orientationHint: true,
      };
    }
    const assignedBlocked = needsYou.find((item) => item.reason === "assigned_blocked_task");
    if (assignedBlocked !== undefined) {
      return {
        kind: "task",
        id: assignedBlocked.id,
        summary: assignedBlocked.summary,
        reason: "assigned_blocked_task",
        orientationHint: true,
      };
    }
    const assignedOpen = needsYou.find((item) => item.reason === "assigned_open_task");
    if (assignedOpen !== undefined) {
      return {
        kind: "task",
        id: assignedOpen.id,
        summary: assignedOpen.summary,
        reason: "assigned_open_task",
        orientationHint: true,
      };
    }
    const unassignedBlocked = needsAttention.find(
      (item) => item.reason === "unassigned_blocked_task",
    );
    if (unassignedBlocked !== undefined) {
      return {
        kind: "task",
        id: unassignedBlocked.id,
        summary: unassignedBlocked.summary,
        reason: "unassigned_blocked_task",
        orientationHint: true,
      };
    }
    const teamProposed = needsAttention.find((item) => item.reason === "team_proposed_decision");
    if (teamProposed !== undefined) {
      return {
        kind: "decision",
        id: teamProposed.id,
        summary: teamProposed.summary,
        reason: "team_proposed_decision",
        orientationHint: true,
      };
    }
    const oldestOpen = [...tasks]
      .filter((task) => task.status === "open")
      .sort(compareByUpdatedThenId)[0];
    if (oldestOpen !== undefined) {
      return {
        kind: "task",
        id: oldestOpen.id,
        summary: oldestOpen.title,
        reason: "team_open_task",
        orientationHint: true,
      };
    }
    return { kind: "none", summary: "", reason: "none", orientationHint: true };
  }

  function deriveOrientation(
    ctx: ActorContext,
    workspaceId: string,
    tasks: Task[],
    decisions: Decision[],
  ): {
    needsYou: AttentionItem[];
    needsAttention: AttentionItem[];
    currentWork: CurrentWork;
    suggestedNextAction: SuggestedNextAction;
  } {
    // Authorization is evaluated through the existing policy only; no new rule.
    const canActDecision = authorizer.canAct(ctx, "decision:update", workspaceId);
    const canActTask = authorizer.canAct(ctx, "task:update", workspaceId);

    const proposed = decisions
      .filter((decision) => decision.status === "proposed")
      .sort(compareByUpdatedThenId);
    // Sorted explicitly so the current-work panel and the alignment panel cannot
    // disagree. Unordered, this array inherited the orientation page's recency
    // tiebreak (newest-first) while deriveRecordedAlignment sorts oldest-first.
    // Order is presentation only: it never decides which decision is operative.
    const accepted = decisions
      .filter((decision) => decision.status === "accepted")
      .sort(compareByUpdatedThenId);

    const sortedTasks = [...tasks].sort(compareByUpdatedThenId);
    const inProgressTasks = sortedTasks.filter((task) => task.status === "in_progress");
    const blockedTasks = sortedTasks.filter((task) => task.status === "blocked");

    const actionableDecisions = canActDecision ? proposed : [];
    const teamProposed = canActDecision ? [] : proposed;

    const assignedBlocked: Task[] = [];
    const assignedOpen: Task[] = [];
    const unassignedBlocked: Task[] = [];
    const otherBlocked: Task[] = [];
    const demotedBlocked: Task[] = [];
    const demotedOpen: Task[] = [];

    for (const task of sortedTasks) {
      const mine = isAssignedTo(ctx.actor, task.assignee);
      if (task.status === "blocked") {
        if (mine) {
          (canActTask ? assignedBlocked : demotedBlocked).push(task);
        } else if (task.assignee === undefined) {
          unassignedBlocked.push(task);
        } else {
          otherBlocked.push(task);
        }
      } else if (task.status === "open" && mine) {
        (canActTask ? assignedOpen : demotedOpen).push(task);
      }
    }

    const needsYou: AttentionItem[] = [
      ...actionableDecisions.map((decision) =>
        attentionItemFromDecision(decision, "proposed_decision_actionable"),
      ),
      ...assignedBlocked.map((task) => attentionItemFromTask(task, "assigned_blocked_task")),
      ...assignedOpen.map((task) => attentionItemFromTask(task, "assigned_open_task")),
    ];

    const needsAttention: AttentionItem[] = [
      ...unassignedBlocked.map((task) =>
        attentionItemFromTask(task, "unassigned_blocked_task"),
      ),
      ...teamProposed.map((decision) =>
        attentionItemFromDecision(decision, "team_proposed_decision"),
      ),
      ...otherBlocked.map((task) => attentionItemFromTask(task, "team_blocked_task")),
      ...demotedBlocked.map((task) => attentionItemFromTask(task, "team_blocked_task")),
      ...demotedOpen.map((task) => attentionItemFromTask(task, "assigned_open_task")),
    ];

    return {
      needsYou,
      needsAttention,
      currentWork: { inProgressTasks, blockedTasks, acceptedDecisions: accepted },
      suggestedNextAction: deriveSuggestedNextAction(needsYou, needsAttention, tasks),
    };
  }

  function resolveContextBudget(override?: Partial<ContextBudget>): ContextBudget {
    const budget: ContextBudget = { ...DEFAULT_CONTEXT_BUDGET };
    if (override === undefined) return budget;
    for (const key of Object.keys(DEFAULT_CONTEXT_BUDGET) as (keyof ContextBudget)[]) {
      const value = override[key];
      if (value !== undefined) {
        budget[key] = clampPageLimit(value, DEFAULT_CONTEXT_BUDGET[key]);
      }
    }
    return budget;
  }

  function statusCount(rows: ReadonlyArray<{ status: string; count: number }>, status: string): number {
    return rows.find((row) => row.status === status)?.count ?? 0;
  }

  function requireReadableWorkspace(ctx: ActorContext, workspaceId: string): Workspace {
    authorizer.assertAllowed(ctx, "workspace:read", workspaceId);
    const workspace = store.getWorkspace(workspaceId);
    if (workspace === undefined) throw new WorkspaceNotFound(workspaceId);
    return workspace;
  }

  function pageContributionQuery(
    limit: number,
    materiality: "high" | "normal",
    afterPosition: number,
    tip: number,
  ): { limit: number; materiality: "high" | "normal"; afterPosition?: number; throughPosition?: number } {
    return {
      limit,
      materiality,
      ...(afterPosition > 0 ? { afterPosition } : {}),
      ...(tip > 0 ? { throughPosition: tip } : {}),
    };
  }

  function objectAfter(
    token: string | undefined,
    workspaceId: string,
    kind: "decision" | "task" | "finding" | "artifact",
  ): { rank: number; at: string; id: string } | undefined {
    if (token === undefined) return undefined;
    const cursor = decodeContextCursor(token);
    assertCursorWorkspace(cursor, workspaceId);
    if (cursor.kind !== kind) {
      throw new ValidationError(`Cursor is not a ${kind} cursor`, { field: "cursor", kind });
    }
    return { rank: cursor.rank, at: cursor.at, id: cursor.id };
  }

  function decisionStatuses(status: string | undefined): DecisionStatus[] | undefined {
    if (status === undefined) return undefined;
    if (status !== "proposed" && status !== "accepted" && status !== "superseded") {
      throw new ValidationError("Invalid decision status", { field: "status", status });
    }
    return [status];
  }

  function taskStatuses(status: string | undefined): TaskStatus[] | undefined {
    if (status === undefined) return undefined;
    if (status !== "open" && status !== "in_progress" && status !== "blocked" && status !== "completed") {
      throw new ValidationError("Invalid task status", { field: "status", status });
    }
    return [status];
  }

  function rejectObjectStatus(status: string | undefined): void {
    if (status !== undefined) {
      throw new ValidationError("status is not a filter for this object", { field: "status" });
    }
  }

  function pageNextCursor(
    kind: "decision" | "task" | "finding" | "artifact",
    workspaceId: string,
    page: { hasMore: boolean; next?: { rank: number; at: string; id: string } },
  ): string | undefined {
    if (!page.hasMore || page.next === undefined) return undefined;
    return objectCursor({ kind, workspaceId, rank: page.next.rank, at: page.next.at, id: page.next.id });
  }

  function finishObjectPage<T>(
    workspaceId: string,
    items: readonly T[],
    total: number,
    nextCursor?: string,
  ): WorkspaceObjectPage<T> {
    return { schemaVersion: CONTEXT_SCHEMA_VERSION, workspaceId, ...toContextSlice(items, total, nextCursor) };
  }

  function resolveActivityBefore(workspaceId: string, before: string | undefined): string | undefined {
    if (before === undefined) return undefined;
    if (!before.startsWith("cf1.")) return before;
    const cursor = decodeContextCursor(before);
    assertCursorWorkspace(cursor, workspaceId);
    if (cursor.kind !== "contribution") {
      throw new ValidationError("Cursor is not a contribution cursor", { field: "before" });
    }
    return cursor.id === "" ? undefined : cursor.id;
  }

  function unknownBefore(beforeId: string): ValidationError {
    return new ValidationError(`Unknown contribution id for before: ${beforeId}`, {
      field: "before",
      before: beforeId,
    });
  }

  function decorateFindings(findings: readonly Finding[]): Finding[] {
    if (findings.length === 0) return [];
    return attachEvidence(findings, store.listFindingEvidence(findings.map((finding) => finding.id)));
  }

  function decorateFinding(finding: Finding): Finding {
    return decorateFindings([finding])[0] ?? finding;
  }

  function decorateDecisions(decisions: readonly Decision[]): Decision[] {
    if (decisions.length === 0) return [];
    const ids = decisions.map((decision) => decision.id);
    return attachCitations(
      decisions,
      store.listDecisionCitations(ids),
      new Set(store.listStaleCitedFindingIds(ids)),
    );
  }

  function decorateDecision(decision: Decision): Decision {
    return decorateDecisions([decision])[0] ?? decision;
  }

  const corrections = createCorrectionActions({
    store,
    authorizer,
    idSource,
    clock,
    requireAgentSession,
    record,
    behalfOf,
    writeOutbox,
    decorateFinding,
    decorateDecision,
  });

  function readInWorkspace<T extends { workspaceId: string }>(
    row: T | undefined,
    workspaceId: string,
    id: string,
    missing: (objectId: string) => Error,
  ): T {
    if (row === undefined || row.workspaceId !== workspaceId) throw missing(id);
    return row;
  }

  return {
    issueEnrollmentInvitation(ctx, rawInput) {
      const input = normalizeIssueEnrollmentInput(rawInput);
      const workspace = assertEnrollmentOwner(ctx, input.workspaceId);
      if (workspace.status !== "active") throw new Conflict("Enroll teammates only into active workspaces", { recoveryCode: "workspace_not_active" });
      const now = clock();
      const secret = generateRawToken().replace(/^cft_/, "cfe_");
      const invitation: EnrollmentInvitation = { id: `ein_${idSource("invite")}`, workspaceId: workspace.id, teamId: workspace.teamId, issuedByHumanId: ctx.actor.actorId, secretHash: hashToken(secret), createdAt: now, expiresAt: new Date(Date.parse(now) + input.expiresInHours * 3_600_000).toISOString(), permittedHarnesses: [...ENROLLMENT_HARNESSES] };
      const contribution: Omit<Contribution, "appendPosition"> = { id: idSource("contribution"), workspaceId: workspace.id, actor: ctx.actor, action: "create", objectType: "enrollment_invitation", objectId: invitation.id, payload: { expiresAt: invitation.expiresAt, role: "member" }, createdAt: now };
      if (!store.createEnrollmentInvitation(invitation, contribution)) throw new Unauthorized("Workspace owner authority changed before invitation issuance", { recoveryCode: "owner_required" });
      return { version: 1, kind: "enrollment_invitation", invitationId: invitation.id, secret, workspace: { id: workspace.id, name: workspace.name, teamId: workspace.teamId }, expiresAt: invitation.expiresAt, permittedHarnesses: [...invitation.permittedHarnesses] };
    },

    getEnrollmentInvitation(ctx, rawInput) {
      const input = normalizeInvitationLookup(rawInput);
      assertEnrollmentOwner(ctx, input.workspaceId);
      const invitation = store.getEnrollmentInvitation(input.invitationId);
      if (invitation === undefined || invitation.workspaceId !== input.workspaceId) throw new Unauthorized("Invitation is unavailable in this workspace", { recoveryCode: "invalid_enrollment_invitation" });
      return invitationView(invitation);
    },

    revokeEnrollmentInvitation(ctx, rawInput) {
      const input = normalizeInvitationLookup(rawInput);
      assertEnrollmentOwner(ctx, input.workspaceId);
      const invitation = store.getEnrollmentInvitation(input.invitationId);
      if (invitation === undefined || invitation.workspaceId !== input.workspaceId) throw new Unauthorized("Invitation is unavailable in this workspace", { recoveryCode: "invalid_enrollment_invitation" });
      if (invitation.revokedAt !== undefined) return revocationReceipt(invitation);
      const now = clock();
      const contribution: Omit<Contribution, "appendPosition"> = { id: idSource("contribution"), workspaceId: input.workspaceId, actor: ctx.actor, action: "update", objectType: "enrollment_invitation", objectId: invitation.id, payload: { revokedAt: now }, createdAt: now };
      if (!store.revokeEnrollmentInvitation({ invitationId: invitation.id, workspaceId: input.workspaceId, actor: ctx.actor, revokedAt: now, contribution })) throw new Unauthorized("Workspace owner authority changed before invitation revocation", { recoveryCode: "owner_required" });
      return revocationReceipt({ ...invitation, revokedAt: now });
    },

    redeemEnrollment(secret, rawInput) {
      const input = normalizeRedeemEnrollmentInput(rawInput);
      if (typeof secret !== "string" || !/^cfe_[a-f0-9]{32}$/.test(secret)) throw new Unauthorized("Invalid enrollment invitation", { recoveryCode: "invalid_enrollment_invitation" });
      const now = clock();
      const secretHash = hashToken(secret);
      const digest = hashToken(JSON.stringify(input));
      const invitation = assertInvitationUsable(store.getEnrollmentInvitationByHash(secretHash), input.invitationId, now);
      if (input.agents.some((agent) => !invitation.permittedHarnesses.includes(agent.harness))) throw new ValidationError("Selected harness is not permitted for enrollment", { field: "agents" });
      if (invitation.consumedAt !== undefined) return replayEnrollment(invitation, input, digest);
      for (const tokenHash of [input.humanTokenHash, ...input.agents.map((agent) => agent.tokenHash)]) {
        if (store.getActorTokenByHash(tokenHash) !== undefined) {
          // An identical concurrent claim may have committed after the initial
          // invitation read. Recover its result instead of mislabeling its tokens.
          const winner = assertInvitationUsable(store.getEnrollmentInvitationByHash(secretHash), input.invitationId, clock());
          if (winner.consumedAt !== undefined) return replayEnrollment(winner, input, digest);
          throw new Conflict("Prepared credentials are already registered", { recoveryCode: "credential_conflict" });
        }
      }
      const workspace = store.getWorkspace(invitation.workspaceId)!;
      const plan = buildEnrollmentPlan(invitation, workspace, input, digest, now, idSource);
      if (store.provisionEnrollment(plan)) return plan.receipt;
      const winner = assertInvitationUsable(store.getEnrollmentInvitationByHash(secretHash), input.invitationId, clock());
      if (winner.consumedAt !== undefined) return replayEnrollment(winner, input, digest);
      throw new Conflict("Enrollment was not committed; retry the same prepared request", { recoveryCode: "enrollment_retry_required" });
    },

    enrollOwnedAgent(ctx, rawInput) {
      const input = normalizeEnrollOwnedAgentInput(rawInput);
      authorizer.assertAllowed(ctx, "workspace:read", input.workspaceId);
      const human = ctx.actor.actorType === "human" ? store.getHuman(ctx.actor.actorId) : undefined;
      const participant = store.getParticipant(input.workspaceId, ctx.actor);
      const workspace = store.getWorkspace(input.workspaceId);
      if (human === undefined || (participant?.role !== "owner" && participant?.role !== "member") || workspace?.status !== "active" || human.teamId !== workspace.teamId) throw new Unauthorized("A human owner or member is required to enroll their own agent", { recoveryCode: "human_membership_required" });
      const digest = hashToken(JSON.stringify({ humanId: human.id, ...input }));
      const existing = store.getOwnedAgentEnrollment(input.workspaceId, human.id, input.harness);
      if (existing !== undefined) return replayOwnedAgent(existing, input, digest);
      if (store.getActorTokenByHash(input.tokenHash) !== undefined) {
        const winner = store.getOwnedAgentEnrollment(input.workspaceId, human.id, input.harness);
        if (winner !== undefined) return replayOwnedAgent(winner, input, digest);
        throw new Conflict("Prepared credentials are already registered", { recoveryCode: "credential_conflict" });
      }
      const plan = buildOwnedAgentPlan(human, input, digest, clock(), idSource);
      if (store.provisionOwnedAgent(plan)) return plan.record.receipt;
      const winner = store.getOwnedAgentEnrollment(input.workspaceId, human.id, input.harness);
      if (winner !== undefined) return replayOwnedAgent(winner, input, digest);
      throw new Conflict("Agent enrollment was not committed; retry the same prepared request", { recoveryCode: "enrollment_retry_required" });
    },

    checkReadiness(ctx: ActorContext, input: CheckReadinessInput): ReadinessStatus {
      assertNonEmpty(input.workspaceId, "workspaceId");
      authorizer.assertAllowed({ actor: ctx.actor }, "workspace:read", input.workspaceId);
      if (ctx.agentSessionId !== undefined) {
        try {
          authorizer.assertAllowed(ctx, "workspace:read", input.workspaceId);
        } catch (error) {
          if (error instanceof SessionNotFound || error instanceof Unauthorized) {
            throw readinessFailure(input.workspaceId);
          }
          throw error;
        }
      }
      if (ctx.actor.actorType === "agent" && ctx.agentSessionId === undefined) {
        throw readinessFailure(input.workspaceId);
      }
      return ctx.agentSessionId === undefined
        ? { ready: true, workspaceId: input.workspaceId, actor: ctx.actor }
        : {
            ready: true,
            workspaceId: input.workspaceId,
            actor: ctx.actor,
            sessionId: ctx.agentSessionId,
          };
    },

    createWorkspace(ctx: ActorContext, input: CreateWorkspaceInput): Workspace {
      if (store.getTeam(input.teamId) === undefined) {
        throw new TeamNotFound(input.teamId);
      }
      // There is no workspace-scoped operation for creation, so reuse the
      // actor-existence check from `workspace:list` (no workspace yet exists).
      authorizer.assertAllowed(ctx, "workspace:list");
      // Work cannot be created across teams: the acting identity must belong
      // to the team the workspace is created in.
      const acting = requireActor(ctx.actor);
      if (acting.teamId !== input.teamId) {
        throw new Unauthorized(
          `Actor ${ctx.actor.actorId} belongs to team ${acting.teamId}, not ${input.teamId}`,
        );
      }

      const now = clock();
      const workspace: Workspace = {
        id: idSource("workspace"),
        teamId: input.teamId,
        name: input.name,
        description: input.description,
        status: "active",
        createdBy: ctx.actor,
        createdAt: now,
        updatedAt: now,
      };
      const participant: WorkspaceParticipant = {
        workspaceId: workspace.id,
        actor: ctx.actor,
        role: "owner",
        joinedAt: now,
      };

      store.transaction(() => {
        store.createWorkspace(workspace);
        store.addParticipant(participant);
        record(ctx, workspace.id, "create", "workspace", workspace.id, { name: workspace.name }, now);
        record(ctx, workspace.id, "join", "participant", ctx.actor.actorId, { role: "owner" }, now);
        // The Viewer is opened as the owning human. An agent-created workspace
        // is visible to that human without a second invite. This does not give
        // the agent the human's other workspaces.
        if (ctx.actor.actorType === "agent") {
          const agent = store.getAgent(ctx.actor.actorId);
          if (agent?.humanId !== undefined && agent.humanId.length > 0) {
            store.addParticipant({
              workspaceId: workspace.id,
              actor: { actorId: agent.humanId, actorType: "human" },
              role: "owner",
              joinedAt: now,
            });
            record(ctx, workspace.id, "join", "participant", agent.humanId, { role: "owner" }, now);
          }
        }
      });
      return workspace;
    },

    updateWorkspace(ctx: ActorContext, input: UpdateWorkspaceInput): Workspace {
      authorizer.assertAllowed(ctx, "workspace:write", input.workspaceId);
      requireAgentSession(ctx);
      const workspace = store.getWorkspace(input.workspaceId);
      if (workspace === undefined) {
        throw new WorkspaceNotFound(input.workspaceId);
      }
      assertWorkspaceTransition(workspace.status, input.status);
      const now = clock();
      const onBehalfOf = behalfOf(ctx, input.workspaceId);
      store.transaction(() => {
        store.updateWorkspace(input.workspaceId, { status: input.status, updatedAt: now });
        const contributionId = record(
          ctx,
          input.workspaceId,
          "update",
          "workspace",
          input.workspaceId,
          { status: input.status },
          now,
        );
        writeOutbox(ctx, {
          mutation: { kind: "workspace.updated", from: workspace.status, to: input.status },
          occurredAt: now,
          workspaceId: input.workspaceId,
          subjectType: "workspace",
          subjectId: input.workspaceId,
          summary: workspace.name,
          data: { name: workspace.name, status: input.status, previousStatus: workspace.status },
          contributionId,
          ...(onBehalfOf !== undefined ? { onBehalfOf } : {}),
        });
      });
      const updated = store.getWorkspace(input.workspaceId);
      if (updated === undefined) {
        throw new WorkspaceNotFound(input.workspaceId);
      }
      return updated;
    },

    listWorkspaces(ctx: ActorContext): WorkspaceSummary[] {
      authorizer.assertAllowed(ctx, "workspace:list");
      return store.listWorkspacesForActor(ctx.actor).map((workspace) => {
        const goal = store.getGoalForWorkspace(workspace.id);
        const openTaskCount = store
          .listTasks(workspace.id)
          .filter((task) => task.status !== "completed").length;
        return {
          id: workspace.id,
          name: workspace.name,
          description: workspace.description,
          status: workspace.status,
          goalTitle: goal?.title,
          openTaskCount,
          updatedAt: workspace.updatedAt,
        };
      });
    },

    getWorkspace(ctx: ActorContext, workspaceId: string): WorkspaceView {
      authorizer.assertAllowed(ctx, "workspace:read", workspaceId);
      const workspace = store.getWorkspace(workspaceId);
      if (workspace === undefined) {
        throw new WorkspaceNotFound(workspaceId);
      }
      const activity = store.listContributions(workspaceId);
      return {
        workspace,
        goal: store.getGoalForWorkspace(workspaceId),
        participants: store.listParticipants(workspaceId).map(resolveParticipant),
        tasks: store.listTasks(workspaceId),
        findings: decorateFindings(store.listFindings(workspaceId)),
        decisions: decorateDecisions(store.listDecisions(workspaceId)),
        artifacts: store.listArtifacts(workspaceId),
        activity,
        provenanceSummary: activity.map((contribution) => describeContribution(contribution, actorName(contribution.actor))),
      };
    },

    getWorkspaceContext(
      ctx: ActorContext,
      workspaceId: string,
      options?: { since?: string; budget?: Partial<ContextBudget> },
    ): WorkspaceContext {
      const workspace = requireReadableWorkspace(ctx, workspaceId);
      const budget = resolveContextBudget(options?.budget);

      const decisionCounts = store.countObjectsByStatus("decisions", workspaceId);
      const acceptedCount = statusCount(decisionCounts, "accepted");
      const proposedCount = statusCount(decisionCounts, "proposed");
      const supersededCount = statusCount(decisionCounts, "superseded");
      const decisionLimits = decisionFetchLimits(budget.decisions, {
        accepted: acceptedCount,
        proposed: proposedCount,
      });
      const acceptedPage =
        decisionLimits.accepted > 0
          ? store.pageDecisions(workspaceId, { limit: decisionLimits.accepted, statuses: ["accepted"] })
          : { items: [], hasMore: false, total: 0 };
      const proposedPage =
        decisionLimits.proposed > 0
          ? store.pageDecisions(workspaceId, { limit: decisionLimits.proposed, statuses: ["proposed"] })
          : { items: [], hasMore: false, total: 0 };
      const decisionItems = decorateDecisions([...acceptedPage.items, ...proposedPage.items].sort(compareDecisionKeyset));
      const decisionTotal = acceptedCount + proposedCount;
      const decisionNext =
        decisionItems.length < decisionTotal && !acceptedPage.hasMore
          ? (() => {
              const last = decisionItems[decisionItems.length - 1];
              return last === undefined
                ? undefined
                : objectCursor({
                    kind: "decision",
                    workspaceId,
                    rank: decisionRank(last.status),
                    at: last.updatedAt,
                    id: last.id,
                  });
            })()
          : undefined;

      const taskCounts = store.countObjectsByStatus("tasks", workspaceId);
      const blockedCount = statusCount(taskCounts, "blocked");
      const taskPage = store.pageTasks(workspaceId, { limit: budget.tasks });
      const taskTotal = store.countTasks(workspaceId);
      const blockerTotal = store.countTasks(workspaceId, ["blocked"]);
      const blockerPage =
        blockedCount === 0
          ? { items: [] as Task[], hasMore: false, total: blockerTotal }
          : store.pageTasks(workspaceId, { limit: budget.blockers, statuses: ["blocked"] });

      const findingTotal = store.countFindings(workspaceId, "current");
      const findingPage = store.pageFindings(workspaceId, { limit: budget.findings, currentness: "current" });
      const historicalFindings = store.countHistoricalFindings(workspaceId);
      const artifactTotal = store.countObjects("artifacts", workspaceId);
      const artifactPage = store.pageArtifacts(workspaceId, { limit: budget.artifacts });

      const provenanceWindow = store.listRecentContributionWindow(workspaceId, ORIENTATION_PROVENANCE_LIMIT);
      const provenance = provenanceWindow.items;
      const contributionTotal = store.countObjects("contributions", workspaceId);
      const provenanceSummary = provenance.map((contribution) =>
        describeContribution(contribution, actorName(contribution.actor)),
      );

      const changeWindow = store.listRecentContributionWindow(workspaceId, ORIENTATION_CHANGE_LOOKAHEAD);
      const selectedChanges = selectRecentChanges(changeWindow.items, budget.recentChanges, workspaceId);

      const newest = provenance[provenance.length - 1];
      const orientationCursor =
        newest === undefined
          ? encodeContextCursor(genesisContributionCursor(workspaceId))
          : encodeContextCursor(
              contributionCursor({
                workspaceId,
                occurredAt: newest.createdAt,
                id: newest.id,
                phase: "high",
                originOccurredAt: newest.createdAt,
                originId: newest.id,
                position: newest.appendPosition,
                originPosition: newest.appendPosition,
                tip: 0,
              }),
            );

      const participants = store.listParticipants(workspaceId).map(resolveParticipant);
      const goal = store.getGoalForWorkspace(workspaceId);
      const orientation = deriveOrientation(ctx, workspaceId, taskPage.items, decisionItems);
      const alignment = deriveRecordedAlignment(decisionItems, taskPage.items, {
        proposedDecisions: proposedCount,
        acceptedDecisions: acceptedCount,
      });

      let since: SinceProjection | undefined;
      if (options?.since !== undefined) {
        const window = store.listContributionsSince(workspaceId, options.since, ORIENTATION_PROVENANCE_LIMIT);
        if (!window.found) {
          throw new ValidationError(`Unknown contribution id for since: ${options.since}`, {
            field: "since",
            since: options.since,
          });
        }
        const last = window.items[window.items.length - 1];
        since = {
          cursor: last?.id ?? options.since,
          items: window.items,
          truncated: window.total > window.items.length,
        };
      }

      return assembleWorkspaceContext({
        workspace,
        ...(goal === undefined ? {} : { goal }),
        participants,
        generatedAt: clock(),
        budget,
        orientationCursor,
        decisions: { items: decisionItems, total: decisionTotal, ...(decisionNext === undefined ? {} : { nextCursor: decisionNext }) },
        findings: {
          items: decorateFindings(findingPage.items),
          total: findingTotal,
          ...(pageNextCursor("finding", workspaceId, findingPage) === undefined
            ? {}
            : { nextCursor: pageNextCursor("finding", workspaceId, findingPage) }),
        },
        tasks: {
          items: taskPage.items,
          total: taskTotal,
          ...(pageNextCursor("task", workspaceId, taskPage) === undefined
            ? {}
            : { nextCursor: pageNextCursor("task", workspaceId, taskPage) }),
        },
        blockers: {
          items: blockerPage.items,
          total: blockerTotal,
          ...(pageNextCursor("task", workspaceId, blockerPage) === undefined
            ? {}
            : { nextCursor: pageNextCursor("task", workspaceId, blockerPage) }),
        },
        artifacts: {
          items: artifactPage.items,
          total: artifactTotal,
          ...(pageNextCursor("artifact", workspaceId, artifactPage) === undefined
            ? {}
            : { nextCursor: pageNextCursor("artifact", workspaceId, artifactPage) }),
        },
        recentChanges: {
          items: selectedChanges,
          total: contributionTotal,
        },
        provenance,
        provenanceTotal: contributionTotal,
        provenanceSummary,
        needsYou: orientation.needsYou,
        needsAttention: orientation.needsAttention,
        currentWork: orientation.currentWork,
        suggestedNextAction: orientation.suggestedNextAction,
        alignment,
        historicalCounts: { findings: historicalFindings, decisions: supersededCount },
        ...(since === undefined ? {} : { since }),
      });
    },

    getWorkspaceChanges(ctx: ActorContext, input: GetWorkspaceChangesInput): WorkspaceCatchUp {
      requireReadableWorkspace(ctx, input.workspaceId);
      const cursor = decodeContextCursor(input.after);
      assertCursorWorkspace(cursor, input.workspaceId);
      if (cursor.kind !== "contribution") {
        throw new ValidationError("Cursor is not a contribution cursor", { field: "after" });
      }
      const limit = clampPageLimit(input.limit, DEFAULT_CONTEXT_BUDGET.recentChanges);
      // tip 0 is not frozen. Pin the append high-water mark and do not raise it,
      // or a row written between pages joins this run and the next one skips or repeats it.
      const tip = cursor.tip === 0 ? store.maxAppendPosition(input.workspaceId) : cursor.tip;
      const origin = { occurredAt: cursor.originOccurredAt, id: cursor.originId, position: cursor.originPosition };

      let high: Contribution[] = [];
      let highHasMore = false;
      let normal: Contribution[] = [];
      let normalHasMore = false;
      if (cursor.phase === "high") {
        const highPage = store.pageContributions(
          input.workspaceId,
          pageContributionQuery(limit, "high", cursor.position, tip),
        );
        high = highPage.items;
        highHasMore = highPage.hasMore;
        if (!highHasMore) {
          const room = limit - high.length;
          if (room > 0) {
            const normalPage = store.pageContributions(
              input.workspaceId,
              pageContributionQuery(room, "normal", cursor.originPosition, tip),
            );
            normal = normalPage.items;
            normalHasMore = normalPage.hasMore;
          } else {
            // A full material page still has to learn whether normal rows remain.
            // limit 1 returns the row itself, so existence is not the same as hasMore.
            const probe = store.pageContributions(
              input.workspaceId,
              pageContributionQuery(1, "normal", cursor.originPosition, tip),
            );
            normalHasMore = probe.items.length > 0 || probe.hasMore;
          }
        }
      } else {
        const normalPage = store.pageContributions(
          input.workspaceId,
          pageContributionQuery(limit, "normal", cursor.position, tip),
        );
        normal = normalPage.items;
        normalHasMore = normalPage.hasMore;
      }

      const assembled = assembleCatchUp({
        workspaceId: input.workspaceId,
        fromCursor: input.after,
        phase: cursor.phase,
        origin,
        tip,
        high,
        highHasMore,
        normal,
        normalHasMore,
      });
      const highCount = store.pageContributions(
        input.workspaceId,
        pageContributionQuery(1, "high", cursor.originPosition, tip),
      );
      const normalCount = store.pageContributions(
        input.workspaceId,
        pageContributionQuery(1, "normal", cursor.originPosition, tip),
      );
      return {
        schemaVersion: CONTEXT_SCHEMA_VERSION,
        workspaceId: input.workspaceId,
        fromCursor: input.after,
        toCursor: assembled.toCursor,
        changes: toContextSlice(assembled.items, highCount.total + normalCount.total, assembled.hasMore ? assembled.toCursor : undefined),
        affected: affectedObjectIds(assembled.items),
        generatedAt: clock(),
        ordering: "material-then-chronological",
      };
    },

    listDecisionsPage(ctx: ActorContext, input: ListWorkspaceObjectsInput): WorkspaceObjectPage<Decision> {
      authorizer.assertAllowed(ctx, "workspace:read", input.workspaceId);
      const limit = clampPageLimit(input.limit, DEFAULT_CONTEXT_BUDGET.decisions);
      const statuses = decisionStatuses(input.status);
      const after = objectAfter(input.cursor, input.workspaceId, "decision");
      const page = store.pageDecisions(input.workspaceId, {
        limit,
        ...(after === undefined ? {} : { after }),
        ...(statuses === undefined ? {} : { statuses }),
      });
      const total = store.countDecisions(input.workspaceId, statuses);
      return finishObjectPage(
        input.workspaceId,
        decorateDecisions(page.items),
        total,
        pageNextCursor("decision", input.workspaceId, page),
      );
    },

    getDecisionInWorkspace(ctx: ActorContext, workspaceId: string, decisionId: string): Decision {
      authorizer.assertAllowed(ctx, "workspace:read", workspaceId);
      return decorateDecision(readInWorkspace(store.getDecision(decisionId), workspaceId, decisionId, (id) => new DecisionNotFound(id)));
    },

    listFindingsPage(ctx: ActorContext, input: ListWorkspaceObjectsInput): WorkspaceObjectPage<Finding> {
      authorizer.assertAllowed(ctx, "workspace:read", input.workspaceId);
      rejectObjectStatus(input.status);
      const currentness = assertFindingCurrentness(input.currentness ?? "current");
      const limit = clampPageLimit(input.limit, DEFAULT_CONTEXT_BUDGET.findings);
      const after = objectAfter(input.cursor, input.workspaceId, "finding");
      const page = store.pageFindings(input.workspaceId, {
        limit,
        currentness,
        ...(after === undefined ? {} : { after }),
      });
      const total = store.countFindings(input.workspaceId, currentness);
      return finishObjectPage(
        input.workspaceId,
        decorateFindings(page.items),
        total,
        pageNextCursor("finding", input.workspaceId, page),
      );
    },

    getFindingInWorkspace(ctx: ActorContext, workspaceId: string, findingId: string): Finding {
      authorizer.assertAllowed(ctx, "workspace:read", workspaceId);
      return decorateFinding(readInWorkspace(store.getFinding(findingId), workspaceId, findingId, (id) => new FindingNotFound(id)));
    },

    listTasksPage(ctx: ActorContext, input: ListWorkspaceObjectsInput): WorkspaceObjectPage<Task> {
      authorizer.assertAllowed(ctx, "workspace:read", input.workspaceId);
      const limit = clampPageLimit(input.limit, DEFAULT_CONTEXT_BUDGET.tasks);
      const statuses = taskStatuses(input.status);
      const after = objectAfter(input.cursor, input.workspaceId, "task");
      const page = store.pageTasks(input.workspaceId, {
        limit,
        ...(after === undefined ? {} : { after }),
        ...(statuses === undefined ? {} : { statuses }),
      });
      const total = store.countTasks(input.workspaceId, statuses);
      return finishObjectPage(input.workspaceId, page.items, total, pageNextCursor("task", input.workspaceId, page));
    },

    getTaskInWorkspace(ctx: ActorContext, workspaceId: string, taskId: string): Task {
      authorizer.assertAllowed(ctx, "workspace:read", workspaceId);
      return readInWorkspace(store.getTask(taskId), workspaceId, taskId, (id) => new TaskNotFound(id));
    },

    listArtifactsPage(ctx: ActorContext, input: ListWorkspaceObjectsInput): WorkspaceObjectPage<Artifact> {
      authorizer.assertAllowed(ctx, "workspace:read", input.workspaceId);
      rejectObjectStatus(input.status);
      const limit = clampPageLimit(input.limit, DEFAULT_CONTEXT_BUDGET.artifacts);
      const after = objectAfter(input.cursor, input.workspaceId, "artifact");
      const page = store.pageArtifacts(input.workspaceId, { limit, ...(after === undefined ? {} : { after }) });
      const total = store.countObjects("artifacts", input.workspaceId);
      return finishObjectPage(input.workspaceId, page.items, total, pageNextCursor("artifact", input.workspaceId, page));
    },

    getArtifactInWorkspace(ctx: ActorContext, workspaceId: string, artifactId: string): Artifact {
      authorizer.assertAllowed(ctx, "workspace:read", workspaceId);
      return readInWorkspace(store.getArtifact(artifactId), workspaceId, artifactId, (id) => new ArtifactNotFound(id));
    },

    getActivity(ctx: ActorContext, input: GetActivityInput): ActivityPage {
      authorizer.assertAllowed(ctx, "activity:read", input.workspaceId);
      if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1)) {
        throw new ValidationError("limit must be a positive integer", {
          field: "limit",
          limit: input.limit,
        });
      }
      const beforeId = resolveActivityBefore(input.workspaceId, input.before);
      if (input.limit === undefined) {
        const all = store.listContributions(input.workspaceId);
        let remaining = all;
        if (beforeId !== undefined) {
          const index = all.findIndex((contribution) => contribution.id === beforeId);
          if (index === -1) throw unknownBefore(beforeId);
          remaining = all.slice(0, index);
        }
        return { items: remaining, total: all.length, truncated: false };
      }
      if (beforeId === undefined) {
        const window = store.listRecentContributionWindow(input.workspaceId, input.limit);
        const nextBefore = window.hasMore ? window.items[0]?.id : undefined;
        return {
          items: window.items,
          total: window.total,
          truncated: window.hasMore,
          ...(nextBefore === undefined ? {} : { nextBefore }),
        };
      }
      const window = store.listContributionsBefore(input.workspaceId, beforeId, input.limit);
      if (!window.found) throw unknownBefore(beforeId);
      const nextBefore = window.hasMore ? window.items[0]?.id : undefined;
      return {
        items: window.items,
        total: window.total,
        truncated: window.hasMore,
        ...(nextBefore === undefined ? {} : { nextBefore }),
      };
    },

    createHuman(ctx: ActorContext | undefined, input: CreateHumanInput): { human: Human; token: string } {
      assertNonEmpty(input.displayName, "displayName");
      // Bootstrap check comes first so a blank database reports the team
      // problem from the same place whether or not humans exist yet. The
      // team must still exist; `bootstrap` creates org+team before the first
      // human so this never blocks a supported init flow.
      const isBootstrap = store.countHumans() === 0;
      if (store.getTeam(input.teamId) === undefined) {
        throw new TeamNotFound(input.teamId);
      }

      if (isBootstrap) {
        // Bootstrap: the first human may be created without a prior token.
      } else {
        if (ctx === undefined || ctx.actor.actorType !== "human") {
          throw new Unauthorized("A human actor on the team is required to create another human");
        }
        const acting = store.getHuman(ctx.actor.actorId);
        if (acting === undefined) {
          throw new ActorNotFound(ctx.actor.actorId);
        }
        if (acting.teamId !== input.teamId) {
          throw new Unauthorized(
            `Human ${acting.id} belongs to team ${acting.teamId}, not ${input.teamId}`,
          );
        }
      }

      const now = clock();
      const human: Human = {
        id: idSource("human"),
        teamId: input.teamId,
        displayName: input.displayName,
        externalIdentity: input.externalIdentity,
        createdAt: now,
      };
      const actor: ActorRef = { actorId: human.id, actorType: "human" };
      let token = "";
      store.transaction(() => {
        store.createHuman(human);
        token = mintToken(actor, now);
      });
      return { human, token };
    },

    createAgent(ctx: ActorContext, input: CreateAgentInput): { agent: Agent; token: string } {
      assertNonEmpty(input.name, "name");
      assertNonEmpty(input.harness, "harness");
      if (ctx.actor.actorType !== "human") {
        throw new Unauthorized("Only a human may create an agent");
      }
      const acting = store.getHuman(ctx.actor.actorId);
      if (acting === undefined) {
        throw new ActorNotFound(ctx.actor.actorId);
      }
      if (input.humanId !== ctx.actor.actorId) {
        throw new Unauthorized("Agents must be created by their owning human");
      }
      if (store.getTeam(input.teamId) === undefined) {
        throw new TeamNotFound(input.teamId);
      }
      if (input.teamId !== acting.teamId) {
        throw new ValidationError("Agent teamId must match the owning human's team", {
          teamId: input.teamId,
          humanTeamId: acting.teamId,
        });
      }

      const now = clock();
      const agent: Agent = {
        id: idSource("agent"),
        teamId: input.teamId,
        humanId: input.humanId,
        name: input.name,
        harness: input.harness,
        model: input.model,
        createdAt: now,
      };
      const actor: ActorRef = { actorId: agent.id, actorType: "agent" };
      let token = "";
      store.transaction(() => {
        store.createAgent(agent);
        token = mintToken(actor, now);
      });
      return { agent, token };
    },

    issueToken(ctx: ActorContext, actor: ActorRef): { token: string; actor: ActorRef } {
      if (ctx.actor.actorType !== "human") {
        throw new Unauthorized("Only a human may issue an actor token");
      }
      const acting = store.getHuman(ctx.actor.actorId);
      if (acting === undefined) {
        throw new ActorNotFound(ctx.actor.actorId);
      }
      requireActor(actor);
      if (actor.actorType === "human") {
        if (actor.actorId !== ctx.actor.actorId) {
          throw new Unauthorized("A human may only issue a token for themselves");
        }
      } else {
        const agent = store.getAgent(actor.actorId);
        if (agent === undefined) {
          throw new ActorNotFound(actor.actorId);
        }
        if (agent.humanId !== ctx.actor.actorId) {
          throw new Unauthorized("A human may only issue a token for an agent they own");
        }
      }
      const now = clock();
      const token = mintToken(actor, now);
      return { token, actor };
    },

    resolveToken(rawToken: string): ActorRef {
      const record = store.getActorTokenByHash(hashToken(rawToken));
      if (record === undefined || record.revokedAt !== undefined) {
        throw new Unauthorized("Invalid or revoked token");
      }
      return record.actor;
    },

    revokeToken(ctx: ActorContext, rawToken: string): { revokedTokenId: string; actor: ActorRef } {
      if (ctx.actor.actorType !== "human") {
        throw new Unauthorized("Only a human may revoke an actor token");
      }
      const acting = store.getHuman(ctx.actor.actorId);
      if (acting === undefined) {
        throw new ActorNotFound(ctx.actor.actorId);
      }
      const record = store.getActorTokenByHash(hashToken(rawToken));
      if (record === undefined) {
        throw new Unauthorized("Invalid token");
      }
      // Mirror issueToken ownership: a human may revoke their own tokens or
      // tokens of agents they own, nothing else.
      if (record.actor.actorType === "human") {
        if (record.actor.actorId !== ctx.actor.actorId) {
          throw new Unauthorized("A human may only revoke a token for themselves");
        }
      } else {
        const agent = store.getAgent(record.actor.actorId);
        if (agent === undefined) {
          throw new ActorNotFound(record.actor.actorId);
        }
        if (agent.humanId !== ctx.actor.actorId) {
          throw new Unauthorized("A human may only revoke a token for an agent they own");
        }
      }
      if (record.revokedAt !== undefined) {
        return { revokedTokenId: record.id, actor: record.actor };
      }
      const now = clock();
      store.revokeActorToken(record.id, now);
      return { revokedTokenId: record.id, actor: record.actor };
    },

    joinWorkspace(ctx: ActorContext, input: JoinWorkspaceInput): WorkspaceParticipant {
      authorizer.assertAllowed(ctx, "workspace:join", input.workspaceId);
      if (store.getWorkspace(input.workspaceId) === undefined) {
        throw new WorkspaceNotFound(input.workspaceId);
      }
      const existing = store.getParticipant(input.workspaceId, ctx.actor);
      if (existing !== undefined) {
        return existing;
      }
      const invite = store.getOpenInvite(input.workspaceId, ctx.actor);
      if (invite === undefined) {
        throw new ParticipantRequired(
          `Actor ${ctx.actor.actorId} has no open invite to workspace ${input.workspaceId}`,
          { workspaceId: input.workspaceId, actorId: ctx.actor.actorId },
        );
      }
      // Joiner-supplied role is ignored; membership role comes from the invite.
      const now = clock();
      const role = invite.role;
      const participant: WorkspaceParticipant = {
        workspaceId: input.workspaceId,
        actor: ctx.actor,
        role,
        joinedAt: now,
      };
      store.transaction(() => {
        store.consumeInvite(invite.id, now);
        store.addParticipant(participant);
        record(
          ctx,
          input.workspaceId,
          "join",
          "participant",
          ctx.actor.actorId,
          { role, inviteId: invite.id },
          now,
        );
      });
      return participant;
    },

    inviteToWorkspace(ctx: ActorContext, input: InviteToWorkspaceInput): WorkspaceInvite {
      authorizer.assertAllowed(ctx, "invite:create", input.workspaceId);
      const workspace = store.getWorkspace(input.workspaceId);
      if (workspace === undefined) {
        throw new WorkspaceNotFound(input.workspaceId);
      }
      const invitee = requireActor(input.actor);
      // Workspaces are team-scoped: inviting a cross-team actor would leak
      // workspace context across team boundaries.
      if (invitee.teamId !== workspace.teamId) {
        throw new Unauthorized(
          `Actor ${input.actor.actorId} belongs to team ${invitee.teamId}, not ${workspace.teamId}`,
        );
      }
      if (store.getParticipant(input.workspaceId, input.actor) !== undefined) {
        throw new Conflict(
          `Actor ${input.actor.actorId} is already a participant of workspace ${input.workspaceId}`,
        );
      }
      if (store.getOpenInvite(input.workspaceId, input.actor) !== undefined) {
        throw new Conflict(
          `Actor ${input.actor.actorId} already has an open invite to workspace ${input.workspaceId}`,
        );
      }

      const now = clock();
      const invite: WorkspaceInvite = {
        id: idSource("invite"),
        workspaceId: input.workspaceId,
        actor: input.actor,
        role: input.role,
        invitedBy: ctx.actor,
        createdAt: now,
      };
      store.transaction(() => {
        store.createInvite(invite);
        record(
          ctx,
          input.workspaceId,
          "create",
          "invite",
          invite.id,
          {
            actorId: input.actor.actorId,
            actorType: input.actor.actorType,
            role: input.role,
          },
          now,
        );
      });
      return invite;
    },

    registerAgentSession(ctx: ActorContext, input: RegisterAgentSessionInput): AgentSession {
      authorizer.assertAllowed(ctx, "session:register", input.workspaceId);
      if (ctx.actor.actorType !== "agent" || ctx.actor.actorId !== input.agentId) {
        throw new Unauthorized(
          `Actor ${ctx.actor.actorId} may not register a session for ${input.agentId}`,
        );
      }
      const agent = store.getAgent(input.agentId);
      if (agent === undefined) {
        throw new ActorNotFound(input.agentId);
      }
      if (agent.humanId === undefined || agent.humanId.length === 0) {
        throw new ValidationError("Agent has no owning human", {
          field: "humanId",
          agentId: input.agentId,
        });
      }
      if (input.humanId !== undefined && input.humanId !== agent.humanId) {
        throw new Unauthorized(
          `Agent session humanId must be ${agent.humanId}, not ${input.humanId}`,
          { expected: agent.humanId, provided: input.humanId },
        );
      }
      // The authorizer already enforces this; repeated here so the service
      // contract does not depend on a particular policy implementation.
      if (store.getParticipant(input.workspaceId, ctx.actor) === undefined) {
        throw new ParticipantRequired(
          `Actor ${ctx.actor.actorId} is not a participant of workspace ${input.workspaceId}`,
        );
      }

      const humanId = agent.humanId;
      const now = clock();
      const session: AgentSession = {
        id: idSource("agentSession"),
        agentId: input.agentId,
        humanId,
        workspaceId: input.workspaceId,
        harness: input.harness,
        startedAt: now,
      };
      store.transaction(() => {
        store.createAgentSession(session);
        record(
          ctx,
          input.workspaceId,
          "register_session",
          "agent_session",
          session.id,
          { agentId: input.agentId, humanId, harness: input.harness },
          now,
        );
      });
      return session;
    },

    endAgentSession(ctx: ActorContext, sessionId: string): void {
      const session = store.getAgentSession(sessionId);
      if (session === undefined) {
        throw new SessionNotFound(sessionId);
      }
      if (session.agentId !== ctx.actor.actorId && session.humanId !== ctx.actor.actorId) {
        throw new Unauthorized(`Actor ${ctx.actor.actorId} may not end session ${sessionId}`);
      }
      authorizer.assertAllowed(ctx, "session:end", session.workspaceId);
      const now = clock();
      store.transaction(() => {
        store.endAgentSession(sessionId, now);
        record(ctx, session.workspaceId, "update", "agent_session", sessionId, { endedAt: now }, now);
      });
    },

    createGoal(ctx: ActorContext, input: CreateGoalInput): Goal {
      authorizer.assertAllowed(ctx, "goal:create", input.workspaceId);
      requireAgentSession(ctx);
      assertNonEmpty(input.title, "Goal title");
      const existing = store.getGoalForWorkspace(input.workspaceId);
      if (existing?.status === "active") {
        throw new Conflict("Workspace already has an active goal", {
          workspaceId: input.workspaceId,
          goalId: existing.id,
        });
      }
      const now = clock();
      const goal: Goal = {
        ...provenance(ctx, now),
        id: idSource("goal"),
        workspaceId: input.workspaceId,
        title: input.title,
        description: input.description,
        status: "active",
        updatedAt: now,
      };
      store.transaction(() => {
        store.createGoal(goal);
        record(ctx, input.workspaceId, "create", "goal", goal.id, { title: goal.title }, now);
      });
      return goal;
    },

    updateGoal(ctx: ActorContext, input: UpdateGoalInput): Goal {
      const goal = store.getGoal(input.goalId);
      if (goal === undefined) {
        throw new GoalNotFound(input.goalId);
      }
      authorizer.assertAllowed(ctx, "goal:update", goal.workspaceId);
      requireAgentSession(ctx);

      const hasFields =
        input.title !== undefined || input.description !== undefined || input.status !== undefined;
      if (!hasFields) {
        return goal;
      }
      if (input.title !== undefined) {
        assertNonEmpty(input.title, "Goal title");
      }
      // Reactivating an old goal while another goal is active would leave
      // two active goals; creation already rejects that with Conflict.
      if (input.status === "active" && goal.status !== "active") {
        const current = store.getGoalForWorkspace(goal.workspaceId);
        if (current !== undefined && current.id !== goal.id && current.status === "active") {
          throw new Conflict("Workspace already has an active goal", {
            workspaceId: goal.workspaceId,
            goalId: current.id,
          });
        }
      }

      const now = clock();
      const patch: GoalPatch = { updatedAt: now };
      const payload: Record<string, unknown> = {};
      if (input.title !== undefined) {
        patch.title = input.title;
        payload.title = input.title;
      }
      if (input.description !== undefined) {
        patch.description = input.description;
        payload.description = input.description;
      }
      if (input.status !== undefined) {
        patch.status = input.status;
        payload.status = input.status;
      }

      const onBehalfOf = behalfOf(ctx, goal.workspaceId);
      store.transaction(() => {
        store.updateGoal(input.goalId, patch);
        const contributionId = record(ctx, goal.workspaceId, "update", "goal", input.goalId, payload, now);
        if (input.status !== undefined) {
          writeOutbox(ctx, {
            mutation: { kind: "goal.updated", from: goal.status, to: input.status },
            occurredAt: now,
            workspaceId: goal.workspaceId,
            subjectType: "goal",
            subjectId: input.goalId,
            summary: patch.title ?? goal.title,
            data: {
              title: patch.title ?? goal.title,
              status: input.status,
              previousStatus: goal.status,
            },
            contributionId,
            ...(onBehalfOf !== undefined ? { onBehalfOf } : {}),
          });
        }
      });
      const updated = store.getGoal(input.goalId);
      if (updated === undefined) {
        throw new GoalNotFound(input.goalId);
      }
      return updated;
    },

    addFinding(ctx: ActorContext, input: AddFindingInput): Finding {
      authorizer.assertAllowed(ctx, "finding:create", input.workspaceId);
      requireAgentSession(ctx);
      assertNonEmpty(input.summary, "Finding summary");
      if (input.sourceArtifactId !== undefined) {
        const artifact = store.getArtifact(input.sourceArtifactId);
        if (artifact === undefined) {
          throw new ArtifactNotFound(input.sourceArtifactId);
        }
        if (artifact.workspaceId !== input.workspaceId) {
          throw new CrossWorkspaceReference(
            `Artifact ${input.sourceArtifactId} belongs to workspace ${artifact.workspaceId}, not ${input.workspaceId}`,
          );
        }
      }
      const now = clock();
      const finding: Finding = {
        ...provenance(ctx, now),
        id: idSource("finding"),
        workspaceId: input.workspaceId,
        summary: input.summary,
        detail: input.detail,
        confidence: input.confidence,
        sourceArtifactId: input.sourceArtifactId,
        currentness: "current",
      };
      const onBehalfOf = behalfOf(ctx, input.workspaceId);
      store.transaction(() => {
        store.createFinding(finding);
        const contributionId = record(
          ctx,
          input.workspaceId,
          "create",
          "finding",
          finding.id,
          { summary: finding.summary },
          now,
        );
        writeOutbox(ctx, {
          mutation: { kind: "finding.created" },
          occurredAt: now,
          workspaceId: input.workspaceId,
          subjectType: "finding",
          subjectId: finding.id,
          summary: finding.summary,
          data: {
            summary: finding.summary,
            detail: finding.detail,
            confidence: finding.confidence,
            sourceArtifactId: finding.sourceArtifactId,
          },
          contributionId,
          ...(onBehalfOf !== undefined ? { onBehalfOf } : {}),
        });
      });
      return finding;
    },

    correctFinding(ctx, input) {
      return corrections.correctFinding(ctx, input);
    },

    withdrawFinding(ctx, input) {
      return corrections.withdrawFinding(ctx, input);
    },

    citeFindingEvidence(ctx, input) {
      return corrections.citeFindingEvidence(ctx, input);
    },

    removeFindingEvidence(ctx, input) {
      return corrections.removeFindingEvidence(ctx, input);
    },

    addDecision(ctx, input) {
      return corrections.addDecision(ctx, input);
    },

    acceptDecision(ctx, decisionId, options) {
      return corrections.acceptDecision(ctx, decisionId, options);
    },

    retireDecision(ctx, input) {
      return corrections.retireDecision(ctx, input);
    },

    citeDecisionBasis(ctx, input) {
      return corrections.citeDecisionBasis(ctx, input);
    },

    removeDecisionBasis(ctx, input) {
      return corrections.removeDecisionBasis(ctx, input);
    },

    createTask(ctx: ActorContext, input: CreateTaskInput): Task {
      authorizer.assertAllowed(ctx, "task:create", input.workspaceId);
      requireAgentSession(ctx);
      assertNonEmpty(input.title, "Task title");
      if (input.assignee !== undefined) {
        requireAssigneeInWorkspace(input.workspaceId, input.assignee);
      }
      const now = clock();
      const task: Task = {
        ...provenance(ctx, now),
        id: idSource("task"),
        workspaceId: input.workspaceId,
        title: input.title,
        description: input.description,
        status: "open",
        assignee: input.assignee,
        updatedAt: now,
      };
      store.transaction(() => {
        store.createTask(task);
        record(ctx, input.workspaceId, "create", "task", task.id, { title: task.title }, now);
      });
      return task;
    },

    updateTask(ctx: ActorContext, input: UpdateTaskInput): Task {
      const task = store.getTask(input.taskId);
      if (task === undefined) {
        throw new TaskNotFound(input.taskId);
      }
      authorizer.assertAllowed(ctx, "task:update", task.workspaceId);
      requireAgentSession(ctx);

      const hasFields =
        input.status !== undefined ||
        input.title !== undefined ||
        input.description !== undefined ||
        input.assignee !== undefined;
      if (!hasFields) {
        return task;
      }

      if (input.status !== undefined && input.status !== task.status) {
        assertTaskTransition(task.status, input.status);
      }
      if (input.assignee !== undefined && input.assignee !== null) {
        requireAssigneeInWorkspace(task.workspaceId, input.assignee);
      }

      const now = clock();
      const patch: TaskPatch = { updatedAt: now };
      const payload: Record<string, unknown> = {};
      if (input.title !== undefined) {
        patch.title = input.title;
        payload.title = input.title;
      }
      if (input.description !== undefined) {
        patch.description = input.description;
        payload.description = input.description;
      }
      if (input.status !== undefined) {
        patch.status = input.status;
        payload.status = input.status;
      }
      if (input.assignee !== undefined) {
        patch.assignee = input.assignee;
        payload.assignee = input.assignee;
      }

      const onBehalfOf = behalfOf(ctx, task.workspaceId);
      store.transaction(() => {
        store.updateTask(input.taskId, patch);
        const contributionId = record(ctx, task.workspaceId, "update", "task", input.taskId, payload, now);
        if (input.status !== undefined) {
          writeOutbox(ctx, {
            mutation: { kind: "task.updated", from: task.status, to: input.status },
            occurredAt: now,
            workspaceId: task.workspaceId,
            subjectType: "task",
            subjectId: input.taskId,
            summary: patch.title ?? task.title,
            data: {
              title: patch.title ?? task.title,
              status: input.status,
              previousStatus: task.status,
            },
            contributionId,
            ...(onBehalfOf !== undefined ? { onBehalfOf } : {}),
          });
        }
      });
      const updated = store.getTask(input.taskId);
      if (updated === undefined) {
        throw new TaskNotFound(input.taskId);
      }
      return updated;
    },

    addArtifact(ctx: ActorContext, input: AddArtifactInput): Artifact {
      authorizer.assertAllowed(ctx, "artifact:attach", input.workspaceId);
      requireAgentSession(ctx);
      assertNonEmpty(input.title, "Artifact title");
      const uriOrPath = normalizeArtifactUri(input.uriOrPath);
      const now = clock();
      const artifact: Artifact = {
        ...provenance(ctx, now),
        id: idSource("artifact"),
        workspaceId: input.workspaceId,
        type: input.type,
        title: input.title,
        uriOrPath,
        metadata: input.metadata,
      };
      const onBehalfOf = behalfOf(ctx, input.workspaceId);
      store.transaction(() => {
        store.createArtifact(artifact);
        const contributionId = record(
          ctx,
          input.workspaceId,
          "create",
          "artifact",
          artifact.id,
          { title: artifact.title, type: artifact.type },
          now,
        );
        writeOutbox(ctx, {
          mutation: { kind: "artifact.created" },
          occurredAt: now,
          workspaceId: input.workspaceId,
          subjectType: "artifact",
          subjectId: artifact.id,
          summary: artifact.title,
          data: { title: artifact.title, type: artifact.type, uriOrPath: artifact.uriOrPath },
          contributionId,
          ...(onBehalfOf !== undefined ? { onBehalfOf } : {}),
        });
      });
      return artifact;
    },

    close(): void {
      store.close();
    },
  };
}
