/**
 * Async Campfire application service for Workers/D1.
 *
 * Mechanical async port of `src/service/campfire-service.ts`: identical
 * orchestration, authorization, domain rules, and provenance semantics
 * (AGENTS.md invariant 5). Storage stays behind the async store boundary
 * (AGENTS.md invariant 7). No new domain entities.
 */
import type { ActorContext } from "../service/authorization.js";
import { createAsyncAuthorizer, type AsyncAuthorizer } from "./async-authorizer.js";
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
  type InviteToWorkspaceInput,
  type JoinWorkspaceInput,
  type ParticipantView,
  type ReadinessStatus,
  type RegisterAgentSessionInput,
  type SinceProjection,
  type SuggestedNextAction,
  type UpdateGoalInput,
  type UpdateTaskInput,
  type UpdateWorkspaceInput,
  type WorkspaceContext,
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
  Finding,
  Goal,
  Human,
  Task,
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

export interface AsyncCampfireServiceOptions {
  store: AsyncCampfireStore;
  idSource?: IdSource;
  clock?: () => string;
}

/**
 * Async mirror of `CampfireService`: identical operations, Promise returns.
 * The Worker fetch handler depends on this, never on D1 details.
 */
export interface AsyncCampfireService {
  checkReadiness(ctx: ActorContext, input: CheckReadinessInput): Promise<ReadinessStatus>;
  createWorkspace(ctx: ActorContext, input: CreateWorkspaceInput): Promise<Workspace>;
  updateWorkspace(ctx: ActorContext, input: UpdateWorkspaceInput): Promise<Workspace>;
  listWorkspaces(ctx: ActorContext): Promise<WorkspaceSummary[]>;
  getWorkspace(ctx: ActorContext, workspaceId: string): Promise<WorkspaceView>;
  getWorkspaceContext(
    ctx: ActorContext,
    workspaceId: string,
    options?: { since?: string },
  ): Promise<WorkspaceContext>;
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

  async function record(
    ctx: ActorContext,
    workspaceId: string,
    action: ContributionAction,
    objectType: ContributionObjectType,
    objectId: string,
    payload: Record<string, unknown> | undefined,
    createdAt: string,
  ): Promise<void> {
    await store.createContribution({
      id: idSource("contribution"),
      workspaceId,
      actor: ctx.actor,
      agentSessionId: ctx.agentSessionId,
      action,
      objectType,
      objectId,
      payload,
      createdAt,
    });
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

  function buildSince(activity: Contribution[], since: string): SinceProjection {
    const index = activity.findIndex((contribution) => contribution.id === since);
    if (index === -1) {
      throw new ValidationError(`Unknown contribution id for since: ${since}`, {
        field: "since",
        since,
      });
    }
    const after = activity.slice(index + 1);
    const truncated = after.length > ORIENTATION_PROVENANCE_LIMIT;
    const items = truncated ? after.slice(-ORIENTATION_PROVENANCE_LIMIT) : after;
    const newest = activity[activity.length - 1]?.id ?? since;
    return { cursor: newest, items, truncated };
  }

  return {
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
      await store.transaction(async () => {
        await store.updateWorkspace(input.workspaceId, { status: input.status, updatedAt: now });
        await record(ctx, input.workspaceId, "update", "workspace", input.workspaceId, { status: input.status }, now);
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
      options?: { since?: string },
    ): Promise<WorkspaceContext> {
      await authorizer.assertAllowed(ctx, "workspace:read", workspaceId);
      const workspace = await store.getWorkspace(workspaceId);
      if (workspace === undefined) {
        throw new WorkspaceNotFound(workspaceId);
      }
      const decisions = await store.listDecisions(workspaceId);
      const tasks = await store.listTasks(workspaceId);
      const activity = await store.listContributions(workspaceId);
      const provenance =
        activity.length > ORIENTATION_PROVENANCE_LIMIT
          ? activity.slice(-ORIENTATION_PROVENANCE_LIMIT)
          : activity;
      const [goal, participants, findings, artifacts] = await Promise.all([
        store.getGoalForWorkspace(workspaceId),
        store.listParticipants(workspaceId),
        store.listFindings(workspaceId),
        store.listArtifacts(workspaceId),
      ]);
      const orientation = await deriveOrientation(ctx, workspaceId, tasks, decisions);
      const names = await Promise.all(activity.map((contribution) => actorName(contribution.actor)));
      const context: WorkspaceContext = {
        workspace,
        goal,
        participants: await Promise.all(participants.map((p) => resolveParticipant(p))),
        proposedDecisions: decisions.filter((decision) => decision.status === "proposed"),
        acceptedDecisions: decisions.filter((decision) => decision.status === "accepted"),
        supersededDecisions: decisions
          .filter((decision) => decision.status === "superseded")
          .map((decision) => ({
            id: decision.id,
            summary: decision.summary,
            updatedAt: decision.updatedAt,
          })),
        openTasks: tasks.filter((task) => task.status !== "completed"),
        findings,
        artifacts,
        provenance,
        provenanceTotal: activity.length,
        provenanceTruncated: activity.length > ORIENTATION_PROVENANCE_LIMIT,
        needsYou: orientation.needsYou,
        needsAttention: orientation.needsAttention,
        currentWork: orientation.currentWork,
        suggestedNextAction: orientation.suggestedNextAction,
        alignment: deriveRecordedAlignment(decisions, tasks),
        provenanceSummary: activity.map((contribution, index) =>
          describeContribution(contribution, names[index] ?? contribution.actor.actorId),
        ),
      };
      if (options?.since !== undefined) {
        context.since = buildSince(activity, options.since);
      }
      return context;
    },

    async getActivity(ctx: ActorContext, input: GetActivityInput): Promise<ActivityPage> {
      await authorizer.assertAllowed(ctx, "activity:read", input.workspaceId);
      if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1)) {
        throw new ValidationError("limit must be a positive integer", {
          field: "limit",
          limit: input.limit,
        });
      }
      const all = await store.listContributions(input.workspaceId);
      let remaining = all;
      if (input.before !== undefined) {
        const index = all.findIndex((contribution) => contribution.id === input.before);
        if (index === -1) {
          throw new ValidationError(`Unknown contribution id for before: ${input.before}`, {
            field: "before",
            before: input.before,
          });
        }
        remaining = all.slice(0, index);
      }
      if (input.limit !== undefined && remaining.length > input.limit) {
        const items = remaining.slice(-input.limit);
        return {
          items,
          total: all.length,
          truncated: true,
          nextBefore: items[0]?.id,
        };
      }
      return {
        items: remaining,
        total: all.length,
        truncated: false,
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

      await store.transaction(async () => {
        await store.updateGoal(input.goalId, patch);
        await record(ctx, goal.workspaceId, "update", "goal", input.goalId, payload, now);
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
      await store.transaction(async () => {
        await store.createFinding(finding);
        await record(ctx, input.workspaceId, "create", "finding", finding.id, { summary: finding.summary }, now);
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
      await store.transaction(async () => {
        await store.createDecision(decision);
        await record(
          ctx,
          input.workspaceId,
          "create",
          "decision",
          decision.id,
          { summary: decision.summary, status },
          now,
        );
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
      await store.transaction(async () => {
        await store.updateDecision(decisionId, { status: "accepted", approvedBy: ctx.actor, updatedAt: now });
        await record(ctx, decision.workspaceId, "update", "decision", decisionId, { status: "accepted" }, now);
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

      await store.transaction(async () => {
        await store.updateTask(input.taskId, patch);
        await record(ctx, task.workspaceId, "update", "task", input.taskId, payload, now);
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
      await store.transaction(async () => {
        await store.createArtifact(artifact);
        await record(
          ctx,
          input.workspaceId,
          "create",
          "artifact",
          artifact.id,
          { title: artifact.title, type: artifact.type },
          now,
        );
      });
      return artifact;
    },

    close(): void {
      void store.close();
    },
  };
}
