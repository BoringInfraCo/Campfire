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
import { createSimpleAuthorizer } from "./simple-authorizer.js";
import {
  ORIENTATION_PROVENANCE_LIMIT,
  type ActivityPage,
  type AddArtifactInput,
  type AddDecisionInput,
  type AddFindingInput,
  type CampfireService,
  type CreateAgentInput,
  type CreateGoalInput,
  type CreateHumanInput,
  type CreateTaskInput,
  type CreateWorkspaceInput,
  type GetActivityInput,
  type InviteToWorkspaceInput,
  type JoinWorkspaceInput,
  type ParticipantView,
  type RegisterAgentSessionInput,
  type UpdateGoalInput,
  type UpdateTaskInput,
  type UpdateWorkspaceInput,
  type WorkspaceContext,
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
  Finding,
  Goal,
  Human,
  Task,
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
import type { CampfireStore, GoalPatch, TaskPatch } from "../store/store.js";

export interface CampfireServiceOptions {
  store: CampfireStore;
  idSource?: IdSource;
  clock?: () => string;
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

  function record(
    ctx: ActorContext,
    workspaceId: string,
    action: ContributionAction,
    objectType: ContributionObjectType,
    objectId: string,
    payload: Record<string, unknown> | undefined,
    createdAt: string,
  ): void {
    store.createContribution({
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

  return {
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
      });
      return workspace;
    },

    updateWorkspace(ctx: ActorContext, input: UpdateWorkspaceInput): Workspace {
      authorizer.assertAllowed(ctx, "workspace:write", input.workspaceId);
      const workspace = store.getWorkspace(input.workspaceId);
      if (workspace === undefined) {
        throw new WorkspaceNotFound(input.workspaceId);
      }
      assertWorkspaceTransition(workspace.status, input.status);
      const now = clock();
      store.transaction(() => {
        store.updateWorkspace(input.workspaceId, { status: input.status, updatedAt: now });
        record(ctx, input.workspaceId, "update", "workspace", input.workspaceId, { status: input.status }, now);
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
        findings: store.listFindings(workspaceId),
        decisions: store.listDecisions(workspaceId),
        artifacts: store.listArtifacts(workspaceId),
        activity,
        provenanceSummary: activity.map((contribution) => describeContribution(contribution, actorName(contribution.actor))),
      };
    },

    getWorkspaceContext(ctx: ActorContext, workspaceId: string): WorkspaceContext {
      authorizer.assertAllowed(ctx, "workspace:read", workspaceId);
      const workspace = store.getWorkspace(workspaceId);
      if (workspace === undefined) {
        throw new WorkspaceNotFound(workspaceId);
      }
      const decisions = store.listDecisions(workspaceId);
      const activity = store.listContributions(workspaceId);
      const provenance =
        activity.length > ORIENTATION_PROVENANCE_LIMIT
          ? activity.slice(-ORIENTATION_PROVENANCE_LIMIT)
          : activity;
      return {
        workspace,
        goal: store.getGoalForWorkspace(workspaceId),
        participants: store.listParticipants(workspaceId).map(resolveParticipant),
        proposedDecisions: decisions.filter((decision) => decision.status === "proposed"),
        acceptedDecisions: decisions.filter((decision) => decision.status === "accepted"),
        supersededDecisions: decisions
          .filter((decision) => decision.status === "superseded")
          .map((decision) => ({
            id: decision.id,
            summary: decision.summary,
            updatedAt: decision.updatedAt,
          })),
        openTasks: store.listTasks(workspaceId).filter((task) => task.status !== "completed"),
        findings: store.listFindings(workspaceId),
        artifacts: store.listArtifacts(workspaceId),
        provenance,
        provenanceTotal: activity.length,
        provenanceTruncated: activity.length > ORIENTATION_PROVENANCE_LIMIT,
      };
    },

    getActivity(ctx: ActorContext, input: GetActivityInput): ActivityPage {
      authorizer.assertAllowed(ctx, "activity:read", input.workspaceId);
      if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1)) {
        throw new ValidationError("limit must be a positive integer", {
          field: "limit",
          limit: input.limit,
        });
      }
      const all = store.listContributions(input.workspaceId);
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

      store.transaction(() => {
        store.updateGoal(input.goalId, patch);
        record(ctx, goal.workspaceId, "update", "goal", input.goalId, payload, now);
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
      };
      store.transaction(() => {
        store.createFinding(finding);
        record(ctx, input.workspaceId, "create", "finding", finding.id, { summary: finding.summary }, now);
      });
      return finding;
    },

    addDecision(ctx: ActorContext, input: AddDecisionInput): Decision {
      authorizer.assertAllowed(ctx, "decision:create", input.workspaceId);
      requireAgentSession(ctx);
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
      store.transaction(() => {
        store.createDecision(decision);
        record(
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

    acceptDecision(ctx: ActorContext, decisionId: string): Decision {
      const decision = store.getDecision(decisionId);
      if (decision === undefined) {
        throw new DecisionNotFound(decisionId);
      }
      authorizer.assertAllowed(ctx, "decision:update", decision.workspaceId);
      requireAgentSession(ctx);
      assertDecisionTransition(decision.status, "accepted");
      const now = clock();
      store.transaction(() => {
        store.updateDecision(decisionId, { status: "accepted", approvedBy: ctx.actor, updatedAt: now });
        record(ctx, decision.workspaceId, "update", "decision", decisionId, { status: "accepted" }, now);
      });
      const updated = store.getDecision(decisionId);
      if (updated === undefined) {
        throw new DecisionNotFound(decisionId);
      }
      return updated;
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

      store.transaction(() => {
        store.updateTask(input.taskId, patch);
        record(ctx, task.workspaceId, "update", "task", input.taskId, payload, now);
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
      store.transaction(() => {
        store.createArtifact(artifact);
        record(
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
      store.close();
    },
  };
}
