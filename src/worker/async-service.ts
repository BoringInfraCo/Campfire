/**
 * Async Campfire application service for Workers/D1.
 *
 * Mechanical async port of `src/service/campfire-service.ts`: identical
 * orchestration, authorization, domain rules, and provenance semantics
 * (AGENTS.md invariant 5). Storage stays behind the async store boundary
 * (AGENTS.md invariant 7). No new domain entities.
 */
import type { ActorContext } from "../service/authorization.js";
import { ENROLLMENT_HARNESSES, buildEnrollmentPlan, buildOwnedAgentPlan, invitationView, normalizeEnrollOwnedAgentInput, normalizeInvitationLookup, normalizeIssueEnrollmentInput, normalizeRedeemEnrollmentInput, revocationReceipt, type EnrollmentInvitation, type EnrollmentReceipt, type OwnedAgentEnrollmentRecord, type OwnedAgentReceipt } from "../domain/enrollment.js";
import type { EnrollmentInvitationView, EnrollmentRevocationReceipt, EnrollOwnedAgentInput, IssueEnrollmentInvitationInput, IssuedEnrollmentInvitation, RedeemEnrollmentInput, RevokeEnrollmentInvitationInput } from "../domain/enrollment.js";
import { createAsyncAuthorizer, type AsyncAuthorizer } from "./async-authorizer.js";
import { assembleWorkspaceContext } from "../service/context-assembly.js";
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
  type ListWorkspaceObjectsInput,
  type JoinWorkspaceInput,
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
} from "../service/service.js";
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
import { generateRawTokenWeb as generateRawToken, hashTokenWeb as hashTokenAsync } from "./crypto.js";
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
import {
  assertDecisionTransition,
  assertTaskTransition,
  assertWorkspaceTransition,
} from "../domain/lifecycle.js";
import type { GoalPatch, TaskPatch } from "../store/store.js";
import type { AsyncCampfireStore } from "./d1-store.js";
import type { QualifyingMutation } from "../domain/event-qualify.js";
import type { DomainEventSubjectType } from "../domain/events.js";
import { bridgeFromEnv, definedData, planOutbox, resolveOnBehalfOf } from "../service/outbox.js";

export interface AsyncCampfireServiceOptions {
  store: AsyncCampfireStore;
  idSource?: IdSource;
  clock?: () => string;
  /** Operator webhook env. Defaults to process.env. A bad bridge does not fail the mutation. */
  webhookEnv?: Record<string, string | undefined>;
}

/**
 * Async mirror of `CampfireService`: identical operations, Promise returns.
 * The Worker fetch handler depends on this, never on D1 details.
 */
export interface AsyncCampfireService {
  issueEnrollmentInvitation(ctx: ActorContext, input: IssueEnrollmentInvitationInput): Promise<IssuedEnrollmentInvitation>;
  getEnrollmentInvitation(ctx: ActorContext, input: RevokeEnrollmentInvitationInput): Promise<EnrollmentInvitationView>;
  revokeEnrollmentInvitation(ctx: ActorContext, input: RevokeEnrollmentInvitationInput): Promise<EnrollmentRevocationReceipt>;
  redeemEnrollment(secret: string, input: RedeemEnrollmentInput): Promise<EnrollmentReceipt>;
  enrollOwnedAgent(ctx: ActorContext, input: EnrollOwnedAgentInput): Promise<OwnedAgentReceipt>;
  checkReadiness(ctx: ActorContext, input: CheckReadinessInput): Promise<ReadinessStatus>;
  createWorkspace(ctx: ActorContext, input: CreateWorkspaceInput): Promise<Workspace>;
  updateWorkspace(ctx: ActorContext, input: UpdateWorkspaceInput): Promise<Workspace>;
  listWorkspaces(ctx: ActorContext): Promise<WorkspaceSummary[]>;
  getWorkspace(ctx: ActorContext, workspaceId: string): Promise<WorkspaceView>;
  getWorkspaceContext(
    ctx: ActorContext,
    workspaceId: string,
    options?: { since?: string; budget?: Partial<import("../domain/context-policy.js").ContextBudget> },
  ): Promise<WorkspaceContext>;
  getWorkspaceChanges(ctx: ActorContext, input: GetWorkspaceChangesInput): Promise<WorkspaceCatchUp>;
  listDecisionsPage(ctx: ActorContext, input: ListWorkspaceObjectsInput): Promise<WorkspaceObjectPage<Decision>>;
  getDecisionInWorkspace(ctx: ActorContext, workspaceId: string, decisionId: string): Promise<Decision>;
  listFindingsPage(ctx: ActorContext, input: ListWorkspaceObjectsInput): Promise<WorkspaceObjectPage<Finding>>;
  getFindingInWorkspace(ctx: ActorContext, workspaceId: string, findingId: string): Promise<Finding>;
  listTasksPage(ctx: ActorContext, input: ListWorkspaceObjectsInput): Promise<WorkspaceObjectPage<Task>>;
  getTaskInWorkspace(ctx: ActorContext, workspaceId: string, taskId: string): Promise<Task>;
  listArtifactsPage(ctx: ActorContext, input: ListWorkspaceObjectsInput): Promise<WorkspaceObjectPage<Artifact>>;
  getArtifactInWorkspace(ctx: ActorContext, workspaceId: string, artifactId: string): Promise<Artifact>;
  getActivity(ctx: ActorContext, input: GetActivityInput): Promise<ActivityPage>;
  createHuman(ctx: ActorContext | undefined, input: CreateHumanInput): Promise<{ human: Human; token: string }>;
  createAgent(ctx: ActorContext, input: CreateAgentInput): Promise<{ agent: Agent; token: string }>;
  issueToken(ctx: ActorContext, actor: ActorRef): Promise<{ token: string; actor: ActorRef }>;
  revokeToken(ctx: ActorContext, rawToken: string): Promise<{ revokedTokenId: string; actor: ActorRef }>;
  resolveToken(rawToken: string): Promise<ActorRef>;
  joinWorkspace(ctx: ActorContext, input: JoinWorkspaceInput): Promise<WorkspaceParticipant>;
  inviteToWorkspace(ctx: ActorContext, input: InviteToWorkspaceInput): Promise<WorkspaceInvite>;
  registerAgentSession(ctx: ActorContext, input: RegisterAgentSessionInput): Promise<AgentSession>;
  endAgentSession(ctx: ActorContext, sessionId: string): Promise<void>;
  createGoal(ctx: ActorContext, input: CreateGoalInput): Promise<Goal>;
  updateGoal(ctx: ActorContext, input: UpdateGoalInput): Promise<Goal>;
  addFinding(ctx: ActorContext, input: AddFindingInput): Promise<Finding>;
  addDecision(ctx: ActorContext, input: AddDecisionInput): Promise<Decision>;
  acceptDecision(ctx: ActorContext, decisionId: string): Promise<Decision>;
  createTask(ctx: ActorContext, input: CreateTaskInput): Promise<Task>;
  updateTask(ctx: ActorContext, input: UpdateTaskInput): Promise<Task>;
  addArtifact(ctx: ActorContext, input: AddArtifactInput): Promise<Artifact>;
  close(): void;
}

function assertNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new ValidationError(`${field} must not be empty`, { field });
  }
}

export function createAsyncCampfireService(options: AsyncCampfireServiceOptions): AsyncCampfireService {
  const store = options.store;
  const idSource: IdSource = options.idSource ?? ((kind) => createId(kind));
  const clock: () => string = options.clock ?? nowIso;
  const authorizer: AsyncAuthorizer = createAsyncAuthorizer(store);
  const webhookEnv = options.webhookEnv ?? process.env;

  async function assertEnrollmentOwner(ctx: ActorContext, workspaceId: string): Promise<Workspace> {
    (await authorizer.assertAllowed(ctx, "workspace:read", workspaceId));
    const workspace = (await store.getWorkspace(workspaceId));
    if (ctx.actor.actorType !== "human" || (await store.getParticipant(workspaceId, ctx.actor))?.role !== "owner" || workspace === undefined) {
      throw new Unauthorized("Only a human workspace owner may administer enrollment invitations", { recoveryCode: "owner_required" });
    }
    return workspace;
  }

  async function assertInvitationUsable(invitation: EnrollmentInvitation | undefined, invitationId: string, now: string): Promise<EnrollmentInvitation> {
    if (invitation === undefined || invitation.id !== invitationId || invitation.revokedAt !== undefined || invitation.expiresAt <= now) {
      throw new Unauthorized("Invalid enrollment invitation", { recoveryCode: "invalid_enrollment_invitation" });
    }
    const workspace = (await store.getWorkspace(invitation.workspaceId));
    const issuer = (await store.getHuman(invitation.issuedByHumanId));
    const participant = (await store.getParticipant(invitation.workspaceId, { actorId: invitation.issuedByHumanId, actorType: "human" }));
    if (workspace?.status !== "active" || workspace.teamId !== invitation.teamId || issuer?.teamId !== invitation.teamId || participant?.role !== "owner") {
      throw new Unauthorized("Invalid enrollment invitation", { recoveryCode: "invalid_enrollment_invitation" });
    }
    return invitation;
  }

  async function replayEnrollment(invitation: EnrollmentInvitation, input: ReturnType<typeof normalizeRedeemEnrollmentInput>, digest: string): Promise<EnrollmentReceipt> {
    if (invitation.requestId !== input.requestId || invitation.requestDigest !== digest || invitation.receipt === undefined) {
      throw new Conflict("Invitation was claimed by a different enrollment request", { recoveryCode: "invitation_already_claimed" });
    }
    const receipt = invitation.receipt;
    const prepared = [
      { hash: input.humanTokenHash, id: receipt.human.id, type: "human" },
      ...input.agents.map((agent) => ({ hash: agent.tokenHash, id: receipt.agents.find((entry) => entry.harness === agent.harness)?.id, type: "agent" })),
    ];
    for (const expected of prepared) {
      const token = (await store.getActorTokenByHash(expected.hash));
      if (token === undefined || token.revokedAt !== undefined || token.actor.actorId !== expected.id || token.actor.actorType !== expected.type) {
        throw new Unauthorized("Enrollment credentials no longer authorize recovery", { recoveryCode: "enrollment_credentials_revoked" });
      }
    }
    return receipt;
  }

  async function replayOwnedAgent(record: OwnedAgentEnrollmentRecord, input: ReturnType<typeof normalizeEnrollOwnedAgentInput>, digest: string): Promise<OwnedAgentReceipt> {
    if (record.requestId !== input.requestId || record.requestDigest !== digest || record.tokenHash !== input.tokenHash) {
      throw new Conflict("This harness already has an enrolled agent; reconnect that identity", { recoveryCode: "agent_already_enrolled" });
    }
    const token = (await store.getActorTokenByHash(input.tokenHash));
    if (token === undefined || token.revokedAt !== undefined || token.actor.actorType !== "agent" || token.actor.actorId !== record.receipt.agent.id) {
      throw new Unauthorized("Agent credentials no longer authorize recovery", { recoveryCode: "enrollment_credentials_revoked" });
    }
    return record.receipt;
  }


  async function record(
    ctx: ActorContext,
    workspaceId: string,
    action: ContributionAction,
    objectType: ContributionObjectType,
    objectId: string,
    payload: Record<string, unknown> | undefined,
    createdAt: string,
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

  async function behalfOf(ctx: ActorContext, workspaceId: string) {
    if (ctx.actor.actorType !== "agent" || ctx.agentSessionId === undefined) return undefined;
    return resolveOnBehalfOf(ctx.actor, workspaceId, await store.getAgentSession(ctx.agentSessionId));
  }

  async function writeOutbox(
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
  ): Promise<void> {
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
    await store.createDomainEvent(planned.event);
    if (planned.delivery !== undefined) await store.createWebhookDelivery(planned.delivery);
  }

  async function resolveParticipant(participant: WorkspaceParticipant): Promise<ParticipantView> {
    const { actor, role, joinedAt } = participant;
    if (actor.actorType === "human") {
      const human = await store.getHuman(actor.actorId);
      return { actor, name: human?.displayName ?? actor.actorId, role, joinedAt };
    }
    const agent = await store.getAgent(actor.actorId);
    return {
      actor,
      name: agent?.name ?? actor.actorId,
      role,
      harness: agent?.harness,
      humanOwnerId: agent?.humanId,
      joinedAt,
    };
  }

  async function actorName(actor: ActorRef): Promise<string> {
    if (actor.actorType === "human") {
      return (await store.getHuman(actor.actorId))?.displayName ?? actor.actorId;
    }
    return (await store.getAgent(actor.actorId))?.name ?? actor.actorId;
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

  async function mintToken(actor: ActorRef, createdAt: string): Promise<string> {
    const raw = generateRawToken();
    await store.createActorToken({
      id: idSource("token"),
      actor,
      tokenHash: await hashTokenAsync(raw),
      createdAt,
    });
    return raw;
  }

  async function requireActor(actor: ActorRef): Promise<Human | Agent> {
    const identity =
      actor.actorType === "human"
        ? await store.getHuman(actor.actorId)
        : await store.getAgent(actor.actorId);
    if (identity === undefined) {
      throw new ActorNotFound(actor.actorId);
    }
    return identity;
  }

  // Agents must act through a registered session for writes so provenance
  // can record which session produced the state (AGENTS.md invariant 5).
  async function requireAgentSession(ctx: ActorContext): Promise<void> {
    if (ctx.actor.actorType === "agent" && ctx.agentSessionId === undefined) {
      throw new Unauthorized(`Agent ${ctx.actor.actorId} must act through a registered agent session`);
    }
  }

  async function requireAssigneeInWorkspace(workspaceId: string, assignee: ActorRef): Promise<void> {
    await requireActor(assignee);
    if ((await store.getParticipant(workspaceId, assignee)) === undefined) {
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

  // --- Sprint 008 orientation derivation (async mirror) ---------------------
  // Identical attention model to `campfire-service.ts`; only authorization is
  // awaited. The Viewer consumes this projection and never recomputes it.

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

  async function deriveOrientation(
    ctx: ActorContext,
    workspaceId: string,
    tasks: Task[],
    decisions: Decision[],
  ): Promise<{
    needsYou: AttentionItem[];
    needsAttention: AttentionItem[];
    currentWork: CurrentWork;
    suggestedNextAction: SuggestedNextAction;
  }> {
    // Authorization is evaluated through the existing policy only; no new rule.
    const canActDecision = await authorizer.canAct(ctx, "decision:update", workspaceId);
    const canActTask = await authorizer.canAct(ctx, "task:update", workspaceId);

    const proposed = decisions
      .filter((decision) => decision.status === "proposed")
      .sort(compareByUpdatedThenId);
    const accepted = decisions.filter((decision) => decision.status === "accepted");

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

  async function requireReadableWorkspace(ctx: ActorContext, workspaceId: string): Promise<Workspace> {
    await authorizer.assertAllowed(ctx, "workspace:read", workspaceId);
    const workspace = await store.getWorkspace(workspaceId);
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
    async issueEnrollmentInvitation(ctx, rawInput) {
      const input = normalizeIssueEnrollmentInput(rawInput);
      const workspace = (await assertEnrollmentOwner(ctx, input.workspaceId));
      if (workspace.status !== "active") throw new Conflict("Enroll teammates only into active workspaces", { recoveryCode: "workspace_not_active" });
      const now = clock();
      const secret = generateRawToken().replace(/^cft_/, "cfe_");
      const invitation: EnrollmentInvitation = { id: `ein_${idSource("invite")}`, workspaceId: workspace.id, teamId: workspace.teamId, issuedByHumanId: ctx.actor.actorId, secretHash: (await hashTokenAsync(secret)), createdAt: now, expiresAt: new Date(Date.parse(now) + input.expiresInHours * 3_600_000).toISOString(), permittedHarnesses: [...ENROLLMENT_HARNESSES] };
      const contribution: Omit<Contribution, "appendPosition"> = { id: idSource("contribution"), workspaceId: workspace.id, actor: ctx.actor, action: "create", objectType: "enrollment_invitation", objectId: invitation.id, payload: { expiresAt: invitation.expiresAt, role: "member" }, createdAt: now };
      if (!(await store.createEnrollmentInvitation(invitation, contribution))) throw new Unauthorized("Workspace owner authority changed before invitation issuance", { recoveryCode: "owner_required" });
      return { version: 1, kind: "enrollment_invitation", invitationId: invitation.id, secret, workspace: { id: workspace.id, name: workspace.name, teamId: workspace.teamId }, expiresAt: invitation.expiresAt, permittedHarnesses: [...invitation.permittedHarnesses] };
    },

    async getEnrollmentInvitation(ctx, rawInput) {
      const input = normalizeInvitationLookup(rawInput);
      (await assertEnrollmentOwner(ctx, input.workspaceId));
      const invitation = (await store.getEnrollmentInvitation(input.invitationId));
      if (invitation === undefined || invitation.workspaceId !== input.workspaceId) throw new Unauthorized("Invitation is unavailable in this workspace", { recoveryCode: "invalid_enrollment_invitation" });
      return invitationView(invitation);
    },

    async revokeEnrollmentInvitation(ctx, rawInput) {
      const input = normalizeInvitationLookup(rawInput);
      (await assertEnrollmentOwner(ctx, input.workspaceId));
      const invitation = (await store.getEnrollmentInvitation(input.invitationId));
      if (invitation === undefined || invitation.workspaceId !== input.workspaceId) throw new Unauthorized("Invitation is unavailable in this workspace", { recoveryCode: "invalid_enrollment_invitation" });
      if (invitation.revokedAt !== undefined) return revocationReceipt(invitation);
      const now = clock();
      const contribution: Omit<Contribution, "appendPosition"> = { id: idSource("contribution"), workspaceId: input.workspaceId, actor: ctx.actor, action: "update", objectType: "enrollment_invitation", objectId: invitation.id, payload: { revokedAt: now }, createdAt: now };
      if (!(await store.revokeEnrollmentInvitation({ invitationId: invitation.id, workspaceId: input.workspaceId, actor: ctx.actor, revokedAt: now, contribution }))) throw new Unauthorized("Workspace owner authority changed before invitation revocation", { recoveryCode: "owner_required" });
      return revocationReceipt({ ...invitation, revokedAt: now });
    },

    async redeemEnrollment(secret, rawInput) {
      const input = normalizeRedeemEnrollmentInput(rawInput);
      if (typeof secret !== "string" || !/^cfe_[a-f0-9]{32}$/.test(secret)) throw new Unauthorized("Invalid enrollment invitation", { recoveryCode: "invalid_enrollment_invitation" });
      const now = clock();
      const secretHash = (await hashTokenAsync(secret));
      const digest = (await hashTokenAsync(JSON.stringify(input)));
      const invitation = (await assertInvitationUsable((await store.getEnrollmentInvitationByHash(secretHash)), input.invitationId, now));
      if (input.agents.some((agent) => !invitation.permittedHarnesses.includes(agent.harness))) throw new ValidationError("Selected harness is not permitted for enrollment", { field: "agents" });
      if (invitation.consumedAt !== undefined) return (await replayEnrollment(invitation, input, digest));
      for (const tokenHash of [input.humanTokenHash, ...input.agents.map((agent) => agent.tokenHash)]) {
        if ((await store.getActorTokenByHash(tokenHash)) !== undefined) {
          const winner = await assertInvitationUsable(await store.getEnrollmentInvitationByHash(secretHash), input.invitationId, clock());
          if (winner.consumedAt !== undefined) return await replayEnrollment(winner, input, digest);
          throw new Conflict("Prepared credentials are already registered", { recoveryCode: "credential_conflict" });
        }
      }
      const workspace = (await store.getWorkspace(invitation.workspaceId))!;
      const plan = buildEnrollmentPlan(invitation, workspace, input, digest, now, idSource);
      if ((await store.provisionEnrollment(plan))) return plan.receipt;
      const winner = (await assertInvitationUsable((await store.getEnrollmentInvitationByHash(secretHash)), input.invitationId, clock()));
      if (winner.consumedAt !== undefined) return (await replayEnrollment(winner, input, digest));
      throw new Conflict("Enrollment was not committed; retry the same prepared request", { recoveryCode: "enrollment_retry_required" });
    },

    async enrollOwnedAgent(ctx, rawInput) {
      const input = normalizeEnrollOwnedAgentInput(rawInput);
      (await authorizer.assertAllowed(ctx, "workspace:read", input.workspaceId));
      const human = ctx.actor.actorType === "human" ? (await store.getHuman(ctx.actor.actorId)) : undefined;
      const participant = (await store.getParticipant(input.workspaceId, ctx.actor));
      const workspace = (await store.getWorkspace(input.workspaceId));
      if (human === undefined || (participant?.role !== "owner" && participant?.role !== "member") || workspace?.status !== "active" || human.teamId !== workspace.teamId) throw new Unauthorized("A human owner or member is required to enroll their own agent", { recoveryCode: "human_membership_required" });
      const digest = (await hashTokenAsync(JSON.stringify({ humanId: human.id, ...input })));
      const existing = (await store.getOwnedAgentEnrollment(input.workspaceId, human.id, input.harness));
      if (existing !== undefined) return (await replayOwnedAgent(existing, input, digest));
      if ((await store.getActorTokenByHash(input.tokenHash)) !== undefined) {
        const winner = await store.getOwnedAgentEnrollment(input.workspaceId, human.id, input.harness);
        if (winner !== undefined) return await replayOwnedAgent(winner, input, digest);
        throw new Conflict("Prepared credentials are already registered", { recoveryCode: "credential_conflict" });
      }
      const plan = buildOwnedAgentPlan(human, input, digest, clock(), idSource);
      if ((await store.provisionOwnedAgent(plan))) return plan.record.receipt;
      const winner = (await store.getOwnedAgentEnrollment(input.workspaceId, human.id, input.harness));
      if (winner !== undefined) return (await replayOwnedAgent(winner, input, digest));
      throw new Conflict("Agent enrollment was not committed; retry the same prepared request", { recoveryCode: "enrollment_retry_required" });
    },

    async checkReadiness(ctx: ActorContext, input: CheckReadinessInput): Promise<ReadinessStatus> {
      assertNonEmpty(input.workspaceId, "workspaceId");
      await authorizer.assertAllowed({ actor: ctx.actor }, "workspace:read", input.workspaceId);
      if (ctx.agentSessionId !== undefined) {
        try {
          await authorizer.assertAllowed(ctx, "workspace:read", input.workspaceId);
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

    async createWorkspace(ctx: ActorContext, input: CreateWorkspaceInput): Promise<Workspace> {
      if (await store.getTeam(input.teamId) === undefined) {
        throw new TeamNotFound(input.teamId);
      }
      // There is no workspace-scoped operation for creation, so reuse the
      // actor-existence check from `workspace:list` (no workspace yet exists).
      await authorizer.assertAllowed(ctx, "workspace:list");
      // Work cannot be created across teams: the acting identity must belong
      // to the team the workspace is created in.
      const acting = await requireActor(ctx.actor);
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

      await store.transaction(async () => {
        await store.createWorkspace(workspace);
        await store.addParticipant(participant);
        await record(ctx, workspace.id, "create", "workspace", workspace.id, { name: workspace.name }, now);
        await record(ctx, workspace.id, "join", "participant", ctx.actor.actorId, { role: "owner" }, now);
      });
      return workspace;
    },

    async updateWorkspace(ctx: ActorContext, input: UpdateWorkspaceInput): Promise<Workspace> {
      await authorizer.assertAllowed(ctx, "workspace:write", input.workspaceId);
      await requireAgentSession(ctx);
      const workspace = await store.getWorkspace(input.workspaceId);
      if (workspace === undefined) {
        throw new WorkspaceNotFound(input.workspaceId);
      }
      assertWorkspaceTransition(workspace.status, input.status);
      const now = clock();
      const onBehalfOf = await behalfOf(ctx, input.workspaceId);
      await store.transaction(async () => {
        await store.updateWorkspace(input.workspaceId, { status: input.status, updatedAt: now });
        const contributionId = await record(
          ctx,
          input.workspaceId,
          "update",
          "workspace",
          input.workspaceId,
          { status: input.status },
          now,
        );
        await writeOutbox(ctx, {
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
      const updated = await store.getWorkspace(input.workspaceId);
      if (updated === undefined) {
        throw new WorkspaceNotFound(input.workspaceId);
      }
      return updated;
    },

    async listWorkspaces(ctx: ActorContext): Promise<WorkspaceSummary[]> {
      await authorizer.assertAllowed(ctx, "workspace:list");
      const workspaces = await store.listWorkspacesForActor(ctx.actor);
      return Promise.all(
        workspaces.map(async (workspace) => {
          const goal = await store.getGoalForWorkspace(workspace.id);
          const tasks = await store.listTasks(workspace.id);
          const openTaskCount = tasks.filter((task) => task.status !== "completed").length;
          return {
            id: workspace.id,
            name: workspace.name,
            description: workspace.description,
            status: workspace.status,
            goalTitle: goal?.title,
            openTaskCount,
            updatedAt: workspace.updatedAt,
          };
        }),
      );
    },

    async getWorkspace(ctx: ActorContext, workspaceId: string): Promise<WorkspaceView> {
      await authorizer.assertAllowed(ctx, "workspace:read", workspaceId);
      const workspace = await store.getWorkspace(workspaceId);
      if (workspace === undefined) {
        throw new WorkspaceNotFound(workspaceId);
      }
      const activity = await store.listContributions(workspaceId);
      const participants = await store.listParticipants(workspaceId);
      const [tasks, findings, decisions, artifacts] = await Promise.all([
        store.listTasks(workspaceId),
        store.listFindings(workspaceId),
        store.listDecisions(workspaceId),
        store.listArtifacts(workspaceId),
      ]);
      const goal = await store.getGoalForWorkspace(workspaceId);
      const names = await Promise.all(activity.map((c) => actorName(c.actor)));
      return {
        workspace,
        goal,
        participants: await Promise.all(participants.map((p) => resolveParticipant(p))),
        tasks,
        findings,
        decisions,
        artifacts,
        activity,
        provenanceSummary: activity.map((contribution, i) =>
          describeContribution(contribution, names[i] ?? contribution.actor.actorId),
        ),
      };
    },

    async getWorkspaceContext(
      ctx: ActorContext,
      workspaceId: string,
      options?: { since?: string; budget?: Partial<ContextBudget> },
    ): Promise<WorkspaceContext> {
      const workspace = await requireReadableWorkspace(ctx, workspaceId);
      const budget = resolveContextBudget(options?.budget);

      const decisionCounts = await store.countObjectsByStatus("decisions", workspaceId);
      const acceptedCount = statusCount(decisionCounts, "accepted");
      const proposedCount = statusCount(decisionCounts, "proposed");
      const supersededCount = statusCount(decisionCounts, "superseded");
      const decisionLimits = decisionFetchLimits(budget.decisions, {
        accepted: acceptedCount,
        proposed: proposedCount,
      });
      const acceptedPage =
        decisionLimits.accepted > 0
          ? await store.pageDecisions(workspaceId, { limit: decisionLimits.accepted, statuses: ["accepted"] })
          : { items: [] as Decision[], hasMore: false, total: 0 };
      const proposedPage =
        decisionLimits.proposed > 0
          ? await store.pageDecisions(workspaceId, { limit: decisionLimits.proposed, statuses: ["proposed"] })
          : { items: [] as Decision[], hasMore: false, total: 0 };
      const decisionItems = [...acceptedPage.items, ...proposedPage.items].sort(compareDecisionKeyset);
      const decisionTotal = acceptedCount + proposedCount + supersededCount;
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

      const taskCounts = await store.countObjectsByStatus("tasks", workspaceId);
      const blockedCount = statusCount(taskCounts, "blocked");
      const taskPage = await store.pageTasks(workspaceId, { limit: budget.tasks });
      const taskTotal = await store.countTasks(workspaceId);
      const blockerTotal = await store.countTasks(workspaceId, ["blocked"]);
      const blockerPage =
        blockedCount === 0
          ? { items: [] as Task[], hasMore: false, total: blockerTotal }
          : await store.pageTasks(workspaceId, { limit: budget.blockers, statuses: ["blocked"] });

      const findingTotal = await store.countObjects("findings", workspaceId);
      const findingPage = await store.pageFindings(workspaceId, { limit: budget.findings });
      const artifactTotal = await store.countObjects("artifacts", workspaceId);
      const artifactPage = await store.pageArtifacts(workspaceId, { limit: budget.artifacts });

      const provenanceWindow = await store.listRecentContributionWindow(workspaceId, ORIENTATION_PROVENANCE_LIMIT);
      const provenance = provenanceWindow.items;
      const contributionTotal = await store.countObjects("contributions", workspaceId);
      const provenanceSummary: string[] = [];
      for (const contribution of provenance) {
        provenanceSummary.push(describeContribution(contribution, await actorName(contribution.actor)));
      }

      const changeWindow = await store.listRecentContributionWindow(workspaceId, ORIENTATION_CHANGE_LOOKAHEAD);
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

      const participantRows = await store.listParticipants(workspaceId);
      const participants = [];
      for (const participant of participantRows) {
        participants.push(await resolveParticipant(participant));
      }
      const goal = await store.getGoalForWorkspace(workspaceId);
      const orientation = await deriveOrientation(ctx, workspaceId, taskPage.items, decisionItems);
      const alignment = deriveRecordedAlignment(decisionItems, taskPage.items, {
        proposedDecisions: proposedCount,
        acceptedDecisions: acceptedCount,
      });

      let since: SinceProjection | undefined;
      if (options?.since !== undefined) {
        const window = await store.listContributionsSince(workspaceId, options.since, ORIENTATION_PROVENANCE_LIMIT);
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

      const findingNext = pageNextCursor("finding", workspaceId, findingPage);
      const taskNext = pageNextCursor("task", workspaceId, taskPage);
      const blockerNext = pageNextCursor("task", workspaceId, blockerPage);
      const artifactNext = pageNextCursor("artifact", workspaceId, artifactPage);
      return assembleWorkspaceContext({
        workspace,
        ...(goal === undefined ? {} : { goal }),
        participants,
        generatedAt: clock(),
        budget,
        orientationCursor,
        decisions: { items: decisionItems, total: decisionTotal, ...(decisionNext === undefined ? {} : { nextCursor: decisionNext }) },
        findings: { items: findingPage.items, total: findingTotal, ...(findingNext === undefined ? {} : { nextCursor: findingNext }) },
        tasks: { items: taskPage.items, total: taskTotal, ...(taskNext === undefined ? {} : { nextCursor: taskNext }) },
        blockers: { items: blockerPage.items, total: blockerTotal, ...(blockerNext === undefined ? {} : { nextCursor: blockerNext }) },
        artifacts: { items: artifactPage.items, total: artifactTotal, ...(artifactNext === undefined ? {} : { nextCursor: artifactNext }) },
        recentChanges: { items: selectedChanges, total: contributionTotal },
        provenance,
        provenanceTotal: contributionTotal,
        provenanceSummary,
        needsYou: orientation.needsYou,
        needsAttention: orientation.needsAttention,
        currentWork: orientation.currentWork,
        suggestedNextAction: orientation.suggestedNextAction,
        alignment,
        ...(since === undefined ? {} : { since }),
      });
    },

    async getWorkspaceChanges(ctx: ActorContext, input: GetWorkspaceChangesInput): Promise<WorkspaceCatchUp> {
      await requireReadableWorkspace(ctx, input.workspaceId);
      const cursor = decodeContextCursor(input.after);
      assertCursorWorkspace(cursor, input.workspaceId);
      if (cursor.kind !== "contribution") {
        throw new ValidationError("Cursor is not a contribution cursor", { field: "after" });
      }
      const limit = clampPageLimit(input.limit, DEFAULT_CONTEXT_BUDGET.recentChanges);
      // tip 0 is not frozen. Pin the append high-water mark and do not raise it,
      // or a row written between pages joins this run and the next one skips or repeats it.
      const tip = cursor.tip === 0 ? await store.maxAppendPosition(input.workspaceId) : cursor.tip;
      const origin = { occurredAt: cursor.originOccurredAt, id: cursor.originId, position: cursor.originPosition };

      let high: Contribution[] = [];
      let highHasMore = false;
      let normal: Contribution[] = [];
      let normalHasMore = false;
      if (cursor.phase === "high") {
        const highPage = await store.pageContributions(
          input.workspaceId,
          pageContributionQuery(limit, "high", cursor.position, tip),
        );
        high = highPage.items;
        highHasMore = highPage.hasMore;
        if (!highHasMore) {
          const room = limit - high.length;
          if (room > 0) {
            const normalPage = await store.pageContributions(
              input.workspaceId,
              pageContributionQuery(room, "normal", cursor.originPosition, tip),
            );
            normal = normalPage.items;
            normalHasMore = normalPage.hasMore;
          } else {
            // A full material page still has to learn whether normal rows remain.
            // limit 1 returns the row itself, so existence is not the same as hasMore.
            const probe = await store.pageContributions(
              input.workspaceId,
              pageContributionQuery(1, "normal", cursor.originPosition, tip),
            );
            normalHasMore = probe.items.length > 0 || probe.hasMore;
          }
        }
      } else {
        const normalPage = await store.pageContributions(
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
      const highCount = await store.pageContributions(
        input.workspaceId,
        pageContributionQuery(1, "high", cursor.originPosition, tip),
      );
      const normalCount = await store.pageContributions(
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

    async listDecisionsPage(ctx: ActorContext, input: ListWorkspaceObjectsInput): Promise<WorkspaceObjectPage<Decision>> {
      await authorizer.assertAllowed(ctx, "workspace:read", input.workspaceId);
      const limit = clampPageLimit(input.limit, DEFAULT_CONTEXT_BUDGET.decisions);
      const statuses = decisionStatuses(input.status);
      const after = objectAfter(input.cursor, input.workspaceId, "decision");
      const page = await store.pageDecisions(input.workspaceId, {
        limit,
        ...(after === undefined ? {} : { after }),
        ...(statuses === undefined ? {} : { statuses }),
      });
      const total = await store.countDecisions(input.workspaceId, statuses);
      return finishObjectPage(input.workspaceId, page.items, total, pageNextCursor("decision", input.workspaceId, page));
    },

    async getDecisionInWorkspace(ctx: ActorContext, workspaceId: string, decisionId: string): Promise<Decision> {
      await authorizer.assertAllowed(ctx, "workspace:read", workspaceId);
      return readInWorkspace(await store.getDecision(decisionId), workspaceId, decisionId, (id) => new DecisionNotFound(id));
    },

    async listFindingsPage(ctx: ActorContext, input: ListWorkspaceObjectsInput): Promise<WorkspaceObjectPage<Finding>> {
      await authorizer.assertAllowed(ctx, "workspace:read", input.workspaceId);
      rejectObjectStatus(input.status);
      const limit = clampPageLimit(input.limit, DEFAULT_CONTEXT_BUDGET.findings);
      const after = objectAfter(input.cursor, input.workspaceId, "finding");
      const page = await store.pageFindings(input.workspaceId, { limit, ...(after === undefined ? {} : { after }) });
      const total = await store.countObjects("findings", input.workspaceId);
      return finishObjectPage(input.workspaceId, page.items, total, pageNextCursor("finding", input.workspaceId, page));
    },

    async getFindingInWorkspace(ctx: ActorContext, workspaceId: string, findingId: string): Promise<Finding> {
      await authorizer.assertAllowed(ctx, "workspace:read", workspaceId);
      return readInWorkspace(await store.getFinding(findingId), workspaceId, findingId, (id) => new FindingNotFound(id));
    },

    async listTasksPage(ctx: ActorContext, input: ListWorkspaceObjectsInput): Promise<WorkspaceObjectPage<Task>> {
      await authorizer.assertAllowed(ctx, "workspace:read", input.workspaceId);
      const limit = clampPageLimit(input.limit, DEFAULT_CONTEXT_BUDGET.tasks);
      const statuses = taskStatuses(input.status);
      const after = objectAfter(input.cursor, input.workspaceId, "task");
      const page = await store.pageTasks(input.workspaceId, {
        limit,
        ...(after === undefined ? {} : { after }),
        ...(statuses === undefined ? {} : { statuses }),
      });
      const total = await store.countTasks(input.workspaceId, statuses);
      return finishObjectPage(input.workspaceId, page.items, total, pageNextCursor("task", input.workspaceId, page));
    },

    async getTaskInWorkspace(ctx: ActorContext, workspaceId: string, taskId: string): Promise<Task> {
      await authorizer.assertAllowed(ctx, "workspace:read", workspaceId);
      return readInWorkspace(await store.getTask(taskId), workspaceId, taskId, (id) => new TaskNotFound(id));
    },

    async listArtifactsPage(ctx: ActorContext, input: ListWorkspaceObjectsInput): Promise<WorkspaceObjectPage<Artifact>> {
      await authorizer.assertAllowed(ctx, "workspace:read", input.workspaceId);
      rejectObjectStatus(input.status);
      const limit = clampPageLimit(input.limit, DEFAULT_CONTEXT_BUDGET.artifacts);
      const after = objectAfter(input.cursor, input.workspaceId, "artifact");
      const page = await store.pageArtifacts(input.workspaceId, { limit, ...(after === undefined ? {} : { after }) });
      const total = await store.countObjects("artifacts", input.workspaceId);
      return finishObjectPage(input.workspaceId, page.items, total, pageNextCursor("artifact", input.workspaceId, page));
    },

    async getArtifactInWorkspace(ctx: ActorContext, workspaceId: string, artifactId: string): Promise<Artifact> {
      await authorizer.assertAllowed(ctx, "workspace:read", workspaceId);
      return readInWorkspace(await store.getArtifact(artifactId), workspaceId, artifactId, (id) => new ArtifactNotFound(id));
    },

    async getActivity(ctx: ActorContext, input: GetActivityInput): Promise<ActivityPage> {
      await authorizer.assertAllowed(ctx, "activity:read", input.workspaceId);
      if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1)) {
        throw new ValidationError("limit must be a positive integer", {
          field: "limit",
          limit: input.limit,
        });
      }
      const beforeId = resolveActivityBefore(input.workspaceId, input.before);
      if (input.limit === undefined) {
        const all = await store.listContributions(input.workspaceId);
        let remaining = all;
        if (beforeId !== undefined) {
          const index = all.findIndex((contribution) => contribution.id === beforeId);
          if (index === -1) throw unknownBefore(beforeId);
          remaining = all.slice(0, index);
        }
        return { items: remaining, total: all.length, truncated: false };
      }
      if (beforeId === undefined) {
        const window = await store.listRecentContributionWindow(input.workspaceId, input.limit);
        const nextBefore = window.hasMore ? window.items[0]?.id : undefined;
        return {
          items: window.items,
          total: window.total,
          truncated: window.hasMore,
          ...(nextBefore === undefined ? {} : { nextBefore }),
        };
      }
      const window = await store.listContributionsBefore(input.workspaceId, beforeId, input.limit);
      if (!window.found) throw unknownBefore(beforeId);
      const nextBefore = window.hasMore ? window.items[0]?.id : undefined;
      return {
        items: window.items,
        total: window.total,
        truncated: window.hasMore,
        ...(nextBefore === undefined ? {} : { nextBefore }),
      };
    },

    async createHuman(ctx: ActorContext | undefined, input: CreateHumanInput): Promise<{ human: Human; token: string }> {
      assertNonEmpty(input.displayName, "displayName");
      // Bootstrap check comes first so a blank database reports the team
      // problem from the same place whether or not humans exist yet. The
      // team must still exist; `bootstrap` creates org+team before the first
      // human so this never blocks a supported init flow.
      const isBootstrap = await store.countHumans() === 0;
      if (await store.getTeam(input.teamId) === undefined) {
        throw new TeamNotFound(input.teamId);
      }

      if (isBootstrap) {
        // Bootstrap: the first human may be created without a prior token.
      } else {
        if (ctx === undefined || ctx.actor.actorType !== "human") {
          throw new Unauthorized("A human actor on the team is required to create another human");
        }
        const acting = await store.getHuman(ctx.actor.actorId);
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
      await store.transaction(async () => {
        await store.createHuman(human);
        token = await mintToken(actor, now);
      });
      return { human, token };
    },

    async createAgent(ctx: ActorContext, input: CreateAgentInput): Promise<{ agent: Agent; token: string }> {
      assertNonEmpty(input.name, "name");
      assertNonEmpty(input.harness, "harness");
      if (ctx.actor.actorType !== "human") {
        throw new Unauthorized("Only a human may create an agent");
      }
      const acting = await store.getHuman(ctx.actor.actorId);
      if (acting === undefined) {
        throw new ActorNotFound(ctx.actor.actorId);
      }
      if (input.humanId !== ctx.actor.actorId) {
        throw new Unauthorized("Agents must be created by their owning human");
      }
      if (await store.getTeam(input.teamId) === undefined) {
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
      await store.transaction(async () => {
        await store.createAgent(agent);
        token = await mintToken(actor, now);
      });
      return { agent, token };
    },

    async issueToken(ctx: ActorContext, actor: ActorRef): Promise<{ token: string; actor: ActorRef }> {
      if (ctx.actor.actorType !== "human") {
        throw new Unauthorized("Only a human may issue an actor token");
      }
      const acting = await store.getHuman(ctx.actor.actorId);
      if (acting === undefined) {
        throw new ActorNotFound(ctx.actor.actorId);
      }
      await requireActor(actor);
      if (actor.actorType === "human") {
        if (actor.actorId !== ctx.actor.actorId) {
          throw new Unauthorized("A human may only issue a token for themselves");
        }
      } else {
        const agent = await store.getAgent(actor.actorId);
        if (agent === undefined) {
          throw new ActorNotFound(actor.actorId);
        }
        if (agent.humanId !== ctx.actor.actorId) {
          throw new Unauthorized("A human may only issue a token for an agent they own");
        }
      }
      const now = clock();
      const token = await mintToken(actor, now);
      return { token, actor };
    },

    async resolveToken(rawToken: string): Promise<ActorRef> {
      const record = await store.getActorTokenByHash(await hashTokenAsync(rawToken));
      if (record === undefined || record.revokedAt !== undefined) {
        throw new Unauthorized("Invalid or revoked token");
      }
      return record.actor;
    },

    async revokeToken(ctx: ActorContext, rawToken: string): Promise<{ revokedTokenId: string; actor: ActorRef }> {
      if (ctx.actor.actorType !== "human") {
        throw new Unauthorized("Only a human may revoke an actor token");
      }
      const acting = await store.getHuman(ctx.actor.actorId);
      if (acting === undefined) {
        throw new ActorNotFound(ctx.actor.actorId);
      }
      const record = await store.getActorTokenByHash(await hashTokenAsync(rawToken));
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
        const agent = await store.getAgent(record.actor.actorId);
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
      await store.revokeActorToken(record.id, now);
      return { revokedTokenId: record.id, actor: record.actor };
    },

    async joinWorkspace(ctx: ActorContext, input: JoinWorkspaceInput): Promise<WorkspaceParticipant> {
      await authorizer.assertAllowed(ctx, "workspace:join", input.workspaceId);
      if (await store.getWorkspace(input.workspaceId) === undefined) {
        throw new WorkspaceNotFound(input.workspaceId);
      }
      const existing = await store.getParticipant(input.workspaceId, ctx.actor);
      if (existing !== undefined) {
        return existing;
      }
      const invite = await store.getOpenInvite(input.workspaceId, ctx.actor);
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
      await store.transaction(async () => {
        await store.consumeInvite(invite.id, now);
        await store.addParticipant(participant);
        await record(
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

    async inviteToWorkspace(ctx: ActorContext, input: InviteToWorkspaceInput): Promise<WorkspaceInvite> {
      await authorizer.assertAllowed(ctx, "invite:create", input.workspaceId);
      const workspace = await store.getWorkspace(input.workspaceId);
      if (workspace === undefined) {
        throw new WorkspaceNotFound(input.workspaceId);
      }
      const invitee = await requireActor(input.actor);
      // Workspaces are team-scoped: inviting a cross-team actor would leak
      // workspace context across team boundaries.
      if (invitee.teamId !== workspace.teamId) {
        throw new Unauthorized(
          `Actor ${input.actor.actorId} belongs to team ${invitee.teamId}, not ${workspace.teamId}`,
        );
      }
      if (await store.getParticipant(input.workspaceId, input.actor) !== undefined) {
        throw new Conflict(
          `Actor ${input.actor.actorId} is already a participant of workspace ${input.workspaceId}`,
        );
      }
      if (await store.getOpenInvite(input.workspaceId, input.actor) !== undefined) {
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
      await store.transaction(async () => {
        await store.createInvite(invite);
        await record(
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

    async registerAgentSession(ctx: ActorContext, input: RegisterAgentSessionInput): Promise<AgentSession> {
      await authorizer.assertAllowed(ctx, "session:register", input.workspaceId);
      if (ctx.actor.actorType !== "agent" || ctx.actor.actorId !== input.agentId) {
        throw new Unauthorized(
          `Actor ${ctx.actor.actorId} may not register a session for ${input.agentId}`,
        );
      }
      const agent = await store.getAgent(input.agentId);
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
      if (await store.getParticipant(input.workspaceId, ctx.actor) === undefined) {
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
      await store.transaction(async () => {
        await store.createAgentSession(session);
        await record(
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

    async endAgentSession(ctx: ActorContext, sessionId: string): Promise<void> {
      const session = await store.getAgentSession(sessionId);
      if (session === undefined) {
        throw new SessionNotFound(sessionId);
      }
      if (session.agentId !== ctx.actor.actorId && session.humanId !== ctx.actor.actorId) {
        throw new Unauthorized(`Actor ${ctx.actor.actorId} may not end session ${sessionId}`);
      }
      await authorizer.assertAllowed(ctx, "session:end", session.workspaceId);
      const now = clock();
      await store.transaction(async () => {
        await store.endAgentSession(sessionId, now);
        await record(ctx, session.workspaceId, "update", "agent_session", sessionId, { endedAt: now }, now);
      });
    },

    async createGoal(ctx: ActorContext, input: CreateGoalInput): Promise<Goal> {
      await authorizer.assertAllowed(ctx, "goal:create", input.workspaceId);
      await requireAgentSession(ctx);
      assertNonEmpty(input.title, "Goal title");
      const existing = await store.getGoalForWorkspace(input.workspaceId);
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
      await store.transaction(async () => {
        await store.createGoal(goal);
        await record(ctx, input.workspaceId, "create", "goal", goal.id, { title: goal.title }, now);
      });
      return goal;
    },

    async updateGoal(ctx: ActorContext, input: UpdateGoalInput): Promise<Goal> {
      const goal = await store.getGoal(input.goalId);
      if (goal === undefined) {
        throw new GoalNotFound(input.goalId);
      }
      await authorizer.assertAllowed(ctx, "goal:update", goal.workspaceId);
      await requireAgentSession(ctx);

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
        const current = await store.getGoalForWorkspace(goal.workspaceId);
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

      const onBehalfOf = await behalfOf(ctx, goal.workspaceId);
      await store.transaction(async () => {
        await store.updateGoal(input.goalId, patch);
        const contributionId = await record(ctx, goal.workspaceId, "update", "goal", input.goalId, payload, now);
        if (input.status !== undefined) {
          await writeOutbox(ctx, {
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
      const updated = await store.getGoal(input.goalId);
      if (updated === undefined) {
        throw new GoalNotFound(input.goalId);
      }
      return updated;
    },

    async addFinding(ctx: ActorContext, input: AddFindingInput): Promise<Finding> {
      await authorizer.assertAllowed(ctx, "finding:create", input.workspaceId);
      await requireAgentSession(ctx);
      assertNonEmpty(input.summary, "Finding summary");
      if (input.sourceArtifactId !== undefined) {
        const artifact = await store.getArtifact(input.sourceArtifactId);
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
      };
      const onBehalfOf = await behalfOf(ctx, input.workspaceId);
      await store.transaction(async () => {
        await store.createFinding(finding);
        const contributionId = await record(
          ctx,
          input.workspaceId,
          "create",
          "finding",
          finding.id,
          { summary: finding.summary },
          now,
        );
        await writeOutbox(ctx, {
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

    async addDecision(ctx: ActorContext, input: AddDecisionInput): Promise<Decision> {
      await authorizer.assertAllowed(ctx, "decision:create", input.workspaceId);
      await requireAgentSession(ctx);
      assertNonEmpty(input.summary, "Decision summary");
      // Decisions are always created proposed; acceptance is an explicit
      // transition through acceptDecision so approval provenance is kept.
      if (input.status !== undefined && input.status !== "proposed") {
        throw new ValidationError("Decisions must be created as proposed; use acceptDecision to accept", {
          field: "status",
          value: input.status,
        });
      }
      const now = clock();
      const status = "proposed" as const;
      const decision: Decision = {
        ...provenance(ctx, now),
        id: idSource("decision"),
        workspaceId: input.workspaceId,
        summary: input.summary,
        rationale: input.rationale,
        status,
        updatedAt: now,
      };
      const onBehalfOf = await behalfOf(ctx, input.workspaceId);
      await store.transaction(async () => {
        await store.createDecision(decision);
        const contributionId = await record(
          ctx,
          input.workspaceId,
          "create",
          "decision",
          decision.id,
          { summary: decision.summary, status },
          now,
        );
        await writeOutbox(ctx, {
          mutation: { kind: "decision.created", status },
          occurredAt: now,
          workspaceId: input.workspaceId,
          subjectType: "decision",
          subjectId: decision.id,
          summary: decision.summary,
          data: { summary: decision.summary, status, rationale: decision.rationale },
          contributionId,
          ...(onBehalfOf !== undefined ? { onBehalfOf } : {}),
        });
      });
      return decision;
    },

    async acceptDecision(ctx: ActorContext, decisionId: string): Promise<Decision> {
      const decision = await store.getDecision(decisionId);
      if (decision === undefined) {
        throw new DecisionNotFound(decisionId);
      }
      await authorizer.assertAllowed(ctx, "decision:update", decision.workspaceId);
      await requireAgentSession(ctx);
      assertDecisionTransition(decision.status, "accepted");
      const now = clock();
      const onBehalfOf = await behalfOf(ctx, decision.workspaceId);
      await store.transaction(async () => {
        await store.updateDecision(decisionId, { status: "accepted", approvedBy: ctx.actor, updatedAt: now });
        const contributionId = await record(
          ctx,
          decision.workspaceId,
          "update",
          "decision",
          decisionId,
          { status: "accepted" },
          now,
        );
        await writeOutbox(ctx, {
          mutation: { kind: "decision.updated", from: decision.status, to: "accepted" },
          occurredAt: now,
          workspaceId: decision.workspaceId,
          subjectType: "decision",
          subjectId: decisionId,
          summary: decision.summary,
          data: { summary: decision.summary, status: "accepted", previousStatus: decision.status },
          contributionId,
          ...(onBehalfOf !== undefined ? { onBehalfOf } : {}),
        });
      });
      const updated = await store.getDecision(decisionId);
      if (updated === undefined) {
        throw new DecisionNotFound(decisionId);
      }
      return updated;
    },

    async createTask(ctx: ActorContext, input: CreateTaskInput): Promise<Task> {
      await authorizer.assertAllowed(ctx, "task:create", input.workspaceId);
      await requireAgentSession(ctx);
      assertNonEmpty(input.title, "Task title");
      if (input.assignee !== undefined) {
        await requireAssigneeInWorkspace(input.workspaceId, input.assignee);
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
      await store.transaction(async () => {
        await store.createTask(task);
        await record(ctx, input.workspaceId, "create", "task", task.id, { title: task.title }, now);
      });
      return task;
    },

    async updateTask(ctx: ActorContext, input: UpdateTaskInput): Promise<Task> {
      const task = await store.getTask(input.taskId);
      if (task === undefined) {
        throw new TaskNotFound(input.taskId);
      }
      await authorizer.assertAllowed(ctx, "task:update", task.workspaceId);
      await requireAgentSession(ctx);

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
        await requireAssigneeInWorkspace(task.workspaceId, input.assignee);
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

      const onBehalfOf = await behalfOf(ctx, task.workspaceId);
      await store.transaction(async () => {
        await store.updateTask(input.taskId, patch);
        const contributionId = await record(ctx, task.workspaceId, "update", "task", input.taskId, payload, now);
        if (input.status !== undefined) {
          await writeOutbox(ctx, {
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
      const updated = await store.getTask(input.taskId);
      if (updated === undefined) {
        throw new TaskNotFound(input.taskId);
      }
      return updated;
    },

    async addArtifact(ctx: ActorContext, input: AddArtifactInput): Promise<Artifact> {
      await authorizer.assertAllowed(ctx, "artifact:attach", input.workspaceId);
      await requireAgentSession(ctx);
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
      const onBehalfOf = await behalfOf(ctx, input.workspaceId);
      await store.transaction(async () => {
        await store.createArtifact(artifact);
        const contributionId = await record(
          ctx,
          input.workspaceId,
          "create",
          "artifact",
          artifact.id,
          { title: artifact.title, type: artifact.type },
          now,
        );
        await writeOutbox(ctx, {
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
      void store.close();
    },
  };
}
