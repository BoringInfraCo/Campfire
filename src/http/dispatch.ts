/**
 * Shared mapping from MCP short names to CampfireService calls.
 *
 * HTTP, the remote MCP adapter, and the CLI all dispatch through this so the
 * acting actor always comes from the resolved token or process identity, never
 * from a client-supplied actor id.
 */
import { Unauthorized, ValidationError } from "../domain/errors.js";
import type { ContextBudget } from "../domain/context-policy.js";
import type { ActorRef, ArtifactType, ParticipantRole } from "../domain/types.js";
import type { ActorContext } from "../service/authorization.js";
import type { CampfireService, ListWorkspaceObjectsInput } from "../service/service.js";

import { normalizeIssueEnrollmentInput, normalizeInvitationLookup, normalizeEnrollOwnedAgentInput } from "../domain/enrollment.js";

export const CAMPFIRE_HTTP_METHODS = [
  "preflight",
  "whoami",
  "list_workspaces",
  "create_workspace",
  "update_workspace",
  "get_workspace",
  "get_workspace_context",
  "get_workspace_changes",
  "list_decisions",
  "list_findings",
  "list_tasks",
  "list_artifacts",
  "get_decision",
  "get_finding",
  "get_task",
  "get_artifact",
  "get_activity",
  "join_workspace",
  "invite_workspace",
  "issue_enrollment_invitation",
  "revoke_enrollment_invitation",
  "enroll_owned_agent",
  "register_agent_session",
  "create_goal",
  "update_goal",
  "add_finding",
  "add_decision",
  "accept_decision",
  "create_task",
  "update_task",
  "add_artifact",
  "create_human",
  "create_agent",
  "issue_token",
  "revoke_token",
  "end_agent_session",
] as const;

export type CampfireHttpMethod = (typeof CAMPFIRE_HTTP_METHODS)[number];

const WORKSPACE_STATUSES = ["active", "completed", "archived"] as const;
const GOAL_STATUSES = ["active", "completed", "abandoned"] as const;
const TASK_STATUSES = ["open", "in_progress", "blocked", "completed"] as const;
const DECISION_STATUSES = ["proposed", "accepted", "superseded"] as const;
const PARTICIPANT_ROLES = ["owner", "member", "agent", "viewer"] as const;
const ACTOR_TYPES = ["human", "agent"] as const;
const ARTIFACT_TYPES = [
  "file",
  "pull_request",
  "commit",
  "log",
  "trace",
  "document",
  "deployment",
  "screenshot",
  "report",
  "other",
] as const;

export function isCampfireHttpMethod(value: string): value is CampfireHttpMethod {
  return (CAMPFIRE_HTTP_METHODS as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(params: Record<string, unknown>, field: string): string {
  const value = params[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(`Missing required ${field}`, { field });
  }
  return value;
}

function optionalStr(params: Record<string, unknown>, field: string): string | undefined {
  const value = params[field];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new ValidationError(`${field} must be a string`, { field });
  }
  if (value.trim().length === 0) {
    return undefined;
  }
  return value;
}

function optionalNum(params: Record<string, unknown>, field: string): number | undefined {
  const value = params[field];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ValidationError(`${field} must be a number`, { field, value });
  }
  return value;
}

const CONTEXT_BUDGET_KEYS = ["goals", "decisions", "findings", "tasks", "blockers", "artifacts", "recentChanges"] as const;

function optionalContextBudget(params: Record<string, unknown>): Partial<ContextBudget> | undefined {
  if (params.budget === undefined) return undefined;
  if (!isRecord(params.budget)) {
    throw new ValidationError("budget must be an object of numbers", { field: "budget" });
  }
  const budget: Partial<ContextBudget> = {};
  for (const [key, value] of Object.entries(params.budget)) {
    if (!(CONTEXT_BUDGET_KEYS as readonly string[]).includes(key) || typeof value !== "number" || !Number.isFinite(value)) {
      throw new ValidationError("budget must be an object of numbers", { field: "budget", key });
    }
    budget[key as keyof ContextBudget] = value;
  }
  return budget;
}

function objectListInput(params: Record<string, unknown>): ListWorkspaceObjectsInput {
  const input: ListWorkspaceObjectsInput = { workspaceId: str(params, "workspaceId") };
  const limit = optionalInt(params, "limit");
  if (limit !== undefined) input.limit = limit;
  const cursor = optionalStr(params, "cursor");
  if (cursor !== undefined) input.cursor = cursor;
  const status = optionalStr(params, "status");
  if (status !== undefined) input.status = status;
  return input;
}

function optionalInt(params: Record<string, unknown>, field: string): number | undefined {
  const value = optionalNum(params, field);
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value)) {
    throw new ValidationError(`${field} must be an integer`, { field, value });
  }
  return value;
}

function requireEnum<T extends string>(value: string, allowed: readonly T[], field: string): T {
  if ((allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new ValidationError(`Invalid ${field}: expected ${allowed.join("|")}`, { field, value });
}

function optionalEnum<T extends string>(
  params: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
): T | undefined {
  const value = optionalStr(params, field);
  if (value === undefined) {
    return undefined;
  }
  return requireEnum(value, allowed, field);
}

function actorRefFrom(params: Record<string, unknown>, field = "actor"): ActorRef | undefined {
  const nested = params[field];
  if (isRecord(nested)) {
    const actorId = nested.actorId;
    const actorType = nested.actorType;
    if (typeof actorId !== "string" || actorId.trim().length === 0) {
      throw new ValidationError(`${field}.actorId is required`, { field });
    }
    if (actorType !== "human" && actorType !== "agent") {
      throw new ValidationError(`${field}.actorType must be human|agent`, { field, actorType });
    }
    return { actorId, actorType };
  }
  const actorId = optionalStr(params, "actorId");
  const actorType = optionalStr(params, "actorType");
  if (actorId === undefined && actorType === undefined) {
    return undefined;
  }
  if (actorId === undefined || actorType === undefined) {
    throw new ValidationError("actorId and actorType are required together", {
      field: "actorId",
    });
  }
  return { actorId, actorType: requireEnum(actorType, ACTOR_TYPES, "actorType") };
}

function requireActorRef(params: Record<string, unknown>): ActorRef {
  const actor = actorRefFrom(params);
  if (actor === undefined) {
    throw new ValidationError("actorId and actorType are required", { field: "actorId" });
  }
  return actor;
}

function optionalMetadata(params: Record<string, unknown>): Record<string, unknown> | undefined {
  const value = params.metadata;
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new ValidationError("metadata must be an object", { field: "metadata" });
  }
  return value;
}

/** Dispatch a short-name method. `ctx.actor` is the authenticated principal. */
export function dispatchCampfireMethod(
  service: CampfireService,
  ctx: ActorContext,
  method: string,
  params: Record<string, unknown> = {},
): unknown {
  if (!isCampfireHttpMethod(method)) {
    throw new ValidationError(`Unknown method: ${method}`, { field: "method", method });
  }

  switch (method) {
    case "preflight":
      return service.checkReadiness(ctx, { workspaceId: str(params, "workspaceId") });
    case "whoami":
      return { actor: ctx.actor, sessionId: ctx.agentSessionId };
    case "list_workspaces":
      return service.listWorkspaces(ctx);
    case "create_workspace":
      return service.createWorkspace(ctx, {
        teamId: str(params, "teamId"),
        name: str(params, "name"),
        description: optionalStr(params, "description"),
      });
    case "update_workspace":
      return service.updateWorkspace(ctx, {
        workspaceId: str(params, "workspaceId"),
        status: requireEnum(str(params, "status"), WORKSPACE_STATUSES, "status"),
      });
    case "get_workspace":
      return service.getWorkspace(ctx, str(params, "workspaceId"));
    case "get_workspace_context": {
      const options: { since?: string; budget?: Partial<ContextBudget> } = {};
      const since = optionalStr(params, "since");
      if (since !== undefined) options.since = since;
      const budget = optionalContextBudget(params);
      if (budget !== undefined) options.budget = budget;
      return service.getWorkspaceContext(ctx, str(params, "workspaceId"), options);
    }
    case "get_workspace_changes": {
      const input: { workspaceId: string; after: string; limit?: number } = {
        workspaceId: str(params, "workspaceId"),
        after: str(params, "after"),
      };
      const limit = optionalInt(params, "limit");
      if (limit !== undefined) input.limit = limit;
      return service.getWorkspaceChanges(ctx, input);
    }
    case "list_decisions":
      return service.listDecisionsPage(ctx, objectListInput(params));
    case "list_findings":
      return service.listFindingsPage(ctx, objectListInput(params));
    case "list_tasks":
      return service.listTasksPage(ctx, objectListInput(params));
    case "list_artifacts":
      return service.listArtifactsPage(ctx, objectListInput(params));
    case "get_decision":
      return service.getDecisionInWorkspace(ctx, str(params, "workspaceId"), str(params, "decisionId"));
    case "get_finding":
      return service.getFindingInWorkspace(ctx, str(params, "workspaceId"), str(params, "findingId"));
    case "get_task":
      return service.getTaskInWorkspace(ctx, str(params, "workspaceId"), str(params, "taskId"));
    case "get_artifact":
      return service.getArtifactInWorkspace(ctx, str(params, "workspaceId"), str(params, "artifactId"));
    case "get_activity": {
      const query: { workspaceId: string; limit?: number; before?: string } = {
        workspaceId: str(params, "workspaceId"),
      };
      const limit = optionalInt(params, "limit");
      if (limit !== undefined) query.limit = limit;
      const before = optionalStr(params, "before");
      if (before !== undefined) query.before = before;
      return service.getActivity(ctx, query);
    }
    case "join_workspace":
      // Role, if supplied, is ignored by the service; invite supplies the role.
      return service.joinWorkspace(ctx, { workspaceId: str(params, "workspaceId") });
    case "issue_enrollment_invitation":
      return service.issueEnrollmentInvitation(ctx, normalizeIssueEnrollmentInput(params));
    case "revoke_enrollment_invitation":
      return service.revokeEnrollmentInvitation(ctx, normalizeInvitationLookup(params));
    case "enroll_owned_agent":
      return service.enrollOwnedAgent(ctx, normalizeEnrollOwnedAgentInput(params));
    case "invite_workspace":
      return service.inviteToWorkspace(ctx, {
        workspaceId: str(params, "workspaceId"),
        actor: requireActorRef(params),
        role: requireEnum(str(params, "role"), PARTICIPANT_ROLES, "role") as ParticipantRole,
      });
    case "register_agent_session": {
      const agentId =
        optionalStr(params, "agentId") ??
        (ctx.actor.actorType === "agent" ? ctx.actor.actorId : undefined);
      if (agentId === undefined) {
        throw new ValidationError("agentId is required", { field: "agentId" });
      }
      if (ctx.actor.actorType === "agent" && agentId !== ctx.actor.actorId) {
        throw new Unauthorized(
          `Agent ${ctx.actor.actorId} may not register a session for ${agentId}`,
        );
      }
      const input: { agentId: string; workspaceId: string; harness: string; humanId?: string } = {
        agentId,
        workspaceId: str(params, "workspaceId"),
        harness: str(params, "harness"),
      };
      const humanId = optionalStr(params, "humanId");
      if (humanId !== undefined) input.humanId = humanId;
      return service.registerAgentSession(ctx, input);
    }
    case "create_goal":
      return service.createGoal(ctx, {
        workspaceId: str(params, "workspaceId"),
        title: str(params, "title"),
        description: optionalStr(params, "description"),
      });
    case "update_goal":
      return service.updateGoal(ctx, {
        goalId: str(params, "goalId"),
        title: optionalStr(params, "title"),
        description: optionalStr(params, "description"),
        status: optionalEnum(params, "status", GOAL_STATUSES),
      });
    case "add_finding":
      return service.addFinding(ctx, {
        workspaceId: str(params, "workspaceId"),
        summary: str(params, "summary"),
        detail: optionalStr(params, "detail"),
        confidence: optionalNum(params, "confidence"),
        sourceArtifactId: optionalStr(params, "sourceArtifactId"),
      });
    case "add_decision":
      return service.addDecision(ctx, {
        workspaceId: str(params, "workspaceId"),
        summary: str(params, "summary"),
        rationale: optionalStr(params, "rationale"),
        status: optionalEnum(params, "status", DECISION_STATUSES),
      });
    case "accept_decision":
      return service.acceptDecision(ctx, str(params, "decisionId"));
    case "create_task":
      return service.createTask(ctx, {
        workspaceId: str(params, "workspaceId"),
        title: str(params, "title"),
        description: optionalStr(params, "description"),
        assignee: actorRefFrom(params, "assignee"),
      });
    case "update_task": {
      const assignee = params.assignee === null ? null : actorRefFrom(params, "assignee");
      return service.updateTask(ctx, {
        taskId: str(params, "taskId"),
        status: optionalEnum(params, "status", TASK_STATUSES),
        title: optionalStr(params, "title"),
        description: optionalStr(params, "description"),
        assignee,
      });
    }
    case "add_artifact":
      return service.addArtifact(ctx, {
        workspaceId: str(params, "workspaceId"),
        type: requireEnum(str(params, "type"), ARTIFACT_TYPES, "type") as ArtifactType,
        title: str(params, "title"),
        uriOrPath: str(params, "uriOrPath"),
        metadata: optionalMetadata(params),
      });
    case "create_human":
      return service.createHuman(ctx, {
        teamId: str(params, "teamId"),
        displayName: optionalStr(params, "displayName") ?? str(params, "name"),
        externalIdentity: optionalStr(params, "externalIdentity"),
      });
    case "create_agent":
      return service.createAgent(ctx, {
        teamId: str(params, "teamId"),
        humanId: str(params, "humanId"),
        name: str(params, "name"),
        harness: str(params, "harness"),
        model: optionalStr(params, "model"),
      });
    case "issue_token":
      return service.issueToken(ctx, requireActorRef(params));
    case "revoke_token": {
      const target = optionalStr(params, "token") ?? optionalStr(params, "revokeToken");
      if (target === undefined) {
        throw new ValidationError("Missing required token", { field: "token" });
      }
      return service.revokeToken(ctx, target);
    }
    case "end_agent_session":
      service.endAgentSession(ctx, str(params, "sessionId"));
      return { ok: true };
    default: {
      const exhaustive: never = method;
      throw new ValidationError(`Unknown method: ${exhaustive}`, { field: "method" });
    }
  }
}
