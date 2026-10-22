/**
 * Shared mapping from MCP short names to CampfireService calls.
 *
 * HTTP, the remote MCP adapter, and the CLI all dispatch through this so the
 * acting actor always comes from the resolved token or process identity, never
 * from a client-supplied actor id.
 */
import { Unauthorized, ValidationError } from "../domain/errors.js";
import type { ContextBudget } from "../domain/context-policy.js";
import type { ActorRef, ArtifactType, FindingEvidenceRelation, ParticipantRole } from "../domain/types.js";
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
  "recall_workspace",
  "project_handoff_packet",
  "list_decisions",
  "list_findings",
  "list_tasks",
  "list_artifacts",
  "get_decision",
  "get_finding",
  "get_task",
  "get_artifact",
  "get_activity",
  "list_workspace_participants",
  "get_record_history",
  "join_workspace",
  "invite_workspace",
  "issue_enrollment_invitation",
  "revoke_enrollment_invitation",
  "enroll_owned_agent",
  "register_agent_session",
  "create_goal",
  "update_goal",
  "add_finding",
  "correct_finding",
  "withdraw_finding",
  "cite_finding_evidence",
  "remove_finding_evidence",
  "add_decision",
  "cite_decision_basis",
  "remove_decision_basis",
  "accept_decision",
  "retire_decision",
  "create_task",
  "update_task",
  "add_artifact",
  "create_human",
  "create_agent",
  "issue_token",
  "revoke_token",
  "end_agent_session",
  "propose_action",
  "review_action",
  "cancel_action",
  "reserve_action_execution",
  "record_action_outcome",
  "get_action_proposal",
  "list_action_proposals",
  "list_action_receipts",
] as const;

export type CampfireHttpMethod = (typeof CAMPFIRE_HTTP_METHODS)[number];

// Only these methods can write a Sprint 019 domain event and enqueue a webhook.
// Keep this list aligned with writeOutbox calls in the sync and async services.
const DELIVERY_ELIGIBLE_METHODS: ReadonlySet<CampfireHttpMethod> = new Set([
  "update_workspace",
  "update_goal",
  "add_finding",
  "add_decision",
  "accept_decision",
  "update_task",
  "add_artifact",
]);

export function isDeliveryEligibleMethod(method: CampfireHttpMethod): boolean {
  return DELIVERY_ELIGIBLE_METHODS.has(method);
}

const WORKSPACE_STATUSES = ["active", "completed", "archived"] as const;
const GOAL_STATUSES = ["active", "completed", "abandoned"] as const;
const TASK_STATUSES = ["open", "in_progress", "blocked", "completed"] as const;
const DECISION_STATUSES = ["proposed", "accepted", "superseded"] as const;
const FINDING_CURRENTNESS = ["current", "superseded", "withdrawn", "all"] as const;
const EVIDENCE_RELATIONS = ["supports", "contradicts"] as const;
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

/** Recall query text is not trimmed. An empty string still reaches the service. */
function rawString(params: Record<string, unknown>, field: string): string {
  const value = params[field];
  if (typeof value !== "string") {
    throw new ValidationError(value === undefined ? `Missing required ${field}` : `${field} must be a string`, {
      field,
    });
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

const HISTORY_OBJECT_TYPES = ["task", "decision", "finding", "artifact"] as const;

function participantsOption(params: Record<string, unknown>): "omit" | undefined {
  if (!Object.prototype.hasOwnProperty.call(params, "participants") || params.participants === undefined) {
    return undefined;
  }
  if (params.participants === "omit") return "omit";
  throw new ValidationError("participants must be omit", { field: "participants", value: params.participants });
}

/** Present numbers reach the service so authorization runs before the range check. */
function passthroughLimit(params: Record<string, unknown>): number | undefined {
  if (!Object.prototype.hasOwnProperty.call(params, "limit") || params.limit === undefined || params.limit === null) {
    return undefined;
  }
  if (typeof params.limit !== "number" || !Number.isFinite(params.limit)) {
    throw new ValidationError("limit must be a number", { field: "limit", value: params.limit });
  }
  return params.limit;
}

/** Empty and malformed cursors stay strings so a non-participant is not told the cursor is bad first. */
function passthroughCursor(params: Record<string, unknown>): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(params, "cursor") || params.cursor === undefined || params.cursor === null) {
    return undefined;
  }
  if (typeof params.cursor !== "string") {
    throw new ValidationError("cursor must be a string", { field: "cursor" });
  }
  return params.cursor;
}

function passthroughOwner(params: Record<string, unknown>): string | undefined {
  if (
    !Object.prototype.hasOwnProperty.call(params, "humanOwnerId") ||
    params.humanOwnerId === undefined ||
    params.humanOwnerId === null
  ) {
    return undefined;
  }
  if (typeof params.humanOwnerId !== "string") {
    throw new ValidationError("humanOwnerId must be a string", { field: "humanOwnerId" });
  }
  return params.humanOwnerId;
}

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

function findingEvidenceList(
  params: Record<string, unknown>,
): Array<{ artifactId: string; relation: FindingEvidenceRelation; note?: string }> | undefined {
  if (params.evidence === undefined) return undefined;
  if (!Array.isArray(params.evidence)) {
    throw new ValidationError("evidence must be an array", { field: "evidence" });
  }
  return params.evidence.map((item, index) => {
    if (!isRecord(item)) {
      throw new ValidationError("evidence item must be an object", { field: "evidence", index });
    }
    const artifactId = item.artifactId;
    const relation = item.relation;
    if (typeof artifactId !== "string" || artifactId.trim().length === 0) {
      throw new ValidationError("evidence.artifactId is required", { field: "artifactId", index });
    }
    if (typeof relation !== "string" || relation.trim().length === 0) {
      throw new ValidationError("evidence.relation is required", { field: "relation", index });
    }
    const checked = requireEnum(relation, EVIDENCE_RELATIONS, "relation");
    const note = item.note;
    if (note !== undefined && note !== null && typeof note !== "string") {
      throw new ValidationError("evidence.note must be a string", { field: "note", index });
    }
    return {
      artifactId,
      relation: checked,
      ...(typeof note === "string" && note.length > 0 ? { note } : {}),
    };
  });
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

function recallReadInput(params: Record<string, unknown>): {
  workspaceId: string;
  query: string;
  limit?: number;
  cursor?: string;
} {
  const input: { workspaceId: string; query: string; limit?: number; cursor?: string } = {
    workspaceId: str(params, "workspaceId"),
    query: rawString(params, "query"),
  };
  const limit = optionalInt(params, "limit");
  if (limit !== undefined) input.limit = limit;
  const cursor = optionalStr(params, "cursor");
  if (cursor !== undefined) input.cursor = cursor;
  return input;
}

const ACTION_REVIEW_DECISIONS = ["approve", "reject"] as const;
const ACTION_SUBMISSION_OUTCOMES = [
  "accepted",
  "definite_failure",
  "unknown",
  "reconciled_accepted",
  "reconciled_failure",
] as const;

function requireInt(params: Record<string, unknown>, field: string): number {
  const value = optionalInt(params, field);
  if (value === undefined) {
    throw new ValidationError(`Missing required ${field}`, { field });
  }
  return value;
}

function requireRecord(params: Record<string, unknown>, field: string): Record<string, unknown> {
  const value = params[field];
  if (!isRecord(value)) {
    throw new ValidationError(`${field} must be an object`, { field });
  }
  return value;
}

function optionalStringList(params: Record<string, unknown>, field: string): string[] | undefined {
  if (!Object.prototype.hasOwnProperty.call(params, field) || params[field] === undefined || params[field] === null) {
    return undefined;
  }
  if (!Array.isArray(params[field])) {
    throw new ValidationError(`${field} must be an array of strings`, { field });
  }
  return params[field].map((item, index) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new ValidationError(`${field} must be an array of strings`, { field, index });
    }
    return item;
  });
}

function actionTargetFrom(params: Record<string, unknown>): {
  repositoryId: string;
  repositoryName: string;
  workflowId: string;
  runId: string;
  commitSha: string;
  expectedAttempt: number;
} {
  const target = requireRecord(params, "target");
  return {
    repositoryId: str(target, "repositoryId"),
    repositoryName: str(target, "repositoryName"),
    workflowId: str(target, "workflowId"),
    runId: str(target, "runId"),
    commitSha: str(target, "commitSha"),
    expectedAttempt: requireInt(target, "expectedAttempt"),
  };
}

function actionExecutorFrom(params: Record<string, unknown>): ActorRef {
  const nested = requireRecord(params, "executor");
  return {
    actorId: str(nested, "actorId"),
    actorType: requireEnum(str(nested, "actorType"), ACTOR_TYPES, "executor.actorType"),
  };
}

function actionProviderRefFrom(params: Record<string, unknown>): {
  repositoryId: string;
  workflowId: string;
  runId: string;
  attempt?: number;
  conclusion?: string;
} {
  const raw = requireRecord(params, "providerRef");
  const ref: {
    repositoryId: string;
    workflowId: string;
    runId: string;
    attempt?: number;
    conclusion?: string;
  } = {
    repositoryId: str(raw, "repositoryId"),
    workflowId: str(raw, "workflowId"),
    runId: str(raw, "runId"),
  };
  const attempt = optionalInt(raw, "attempt");
  if (attempt !== undefined) ref.attempt = attempt;
  const conclusion = optionalStr(raw, "conclusion");
  if (conclusion !== undefined) ref.conclusion = conclusion;
  return ref;
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
      const options: { since?: string; budget?: Partial<ContextBudget>; participants?: "omit" } = {};
      const since = optionalStr(params, "since");
      if (since !== undefined) options.since = since;
      const budget = optionalContextBudget(params);
      if (budget !== undefined) options.budget = budget;
      const participants = participantsOption(params);
      if (participants !== undefined) options.participants = participants;
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
    case "recall_workspace":
      return service.recallWorkspace(ctx, recallReadInput(params));
    case "project_handoff_packet":
      return service.projectHandoffPacket(ctx, {
        ...recallReadInput(params),
        recipient: {
          actorId: str(params, "recipientActorId"),
          actorType: requireEnum(str(params, "recipientActorType"), ACTOR_TYPES, "recipientActorType"),
        },
      });
    case "list_decisions":
      return service.listDecisionsPage(ctx, objectListInput(params));
    case "list_findings": {
      const input = objectListInput(params);
      const currentness = optionalEnum(params, "currentness", FINDING_CURRENTNESS);
      if (currentness !== undefined) Object.assign(input, { currentness });
      return service.listFindingsPage(ctx, input);
    }
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
    case "list_workspace_participants": {
      const input: { workspaceId: string; limit?: number; cursor?: string; humanOwnerId?: string } = {
        workspaceId: str(params, "workspaceId"),
      };
      const limit = passthroughLimit(params);
      if (limit !== undefined) input.limit = limit;
      const cursor = passthroughCursor(params);
      if (cursor !== undefined) input.cursor = cursor;
      const humanOwnerId = passthroughOwner(params);
      if (humanOwnerId !== undefined) input.humanOwnerId = humanOwnerId;
      return service.listWorkspaceParticipants(ctx, input);
    }
    case "get_record_history": {
      const input: { workspaceId: string; objectType: string; objectId: string; limit?: number; cursor?: string } = {
        workspaceId: str(params, "workspaceId"),
        objectType: requireEnum(str(params, "objectType"), HISTORY_OBJECT_TYPES, "objectType"),
        objectId: str(params, "objectId"),
      };
      const limit = passthroughLimit(params);
      if (limit !== undefined) input.limit = limit;
      const cursor = passthroughCursor(params);
      if (cursor !== undefined) input.cursor = cursor;
      return service.getRecordHistory(ctx, input);
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
    case "correct_finding": {
      const evidence = findingEvidenceList(params);
      return service.correctFinding(ctx, {
        findingId: str(params, "findingId"),
        summary: str(params, "summary"),
        detail: optionalStr(params, "detail"),
        confidence: optionalNum(params, "confidence"),
        sourceArtifactId: optionalStr(params, "sourceArtifactId"),
        reason: str(params, "reason"),
        ...(evidence === undefined ? {} : { evidence }),
      });
    }
    case "withdraw_finding":
      return service.withdrawFinding(ctx, {
        findingId: str(params, "findingId"),
        reason: str(params, "reason"),
      });
    case "cite_finding_evidence":
      return service.citeFindingEvidence(ctx, {
        findingId: str(params, "findingId"),
        artifactId: str(params, "artifactId"),
        relation: requireEnum(str(params, "relation"), EVIDENCE_RELATIONS, "relation"),
        note: optionalStr(params, "note"),
      });
    case "remove_finding_evidence":
      return service.removeFindingEvidence(ctx, { evidenceId: str(params, "evidenceId") });
    case "add_decision": {
      const input = {
        workspaceId: str(params, "workspaceId"),
        summary: str(params, "summary"),
        rationale: optionalStr(params, "rationale"),
        status: optionalEnum(params, "status", DECISION_STATUSES),
      };
      const replacesDecisionId = optionalStr(params, "replacesDecisionId");
      if (replacesDecisionId !== undefined) Object.assign(input, { replacesDecisionId });
      return service.addDecision(ctx, input);
    }
    case "cite_decision_basis":
      return service.citeDecisionBasis(ctx, {
        decisionId: str(params, "decisionId"),
        findingId: str(params, "findingId"),
        note: optionalStr(params, "note"),
      });
    case "remove_decision_basis":
      return service.removeDecisionBasis(ctx, { citationId: str(params, "citationId") });
    case "accept_decision": {
      const decisionId = str(params, "decisionId");
      const reason = optionalStr(params, "reason");
      if (reason === undefined) return service.acceptDecision(ctx, decisionId);
      return service.acceptDecision(ctx, decisionId, { reason });
    }
    case "retire_decision":
      return service.retireDecision(ctx, {
        decisionId: str(params, "decisionId"),
        reason: str(params, "reason"),
      });
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
    case "propose_action": {
      const input: {
        workspaceId: string;
        target: ReturnType<typeof actionTargetFrom>;
        executor: ActorRef;
        expiresAt?: string;
        reason: string;
        taskId: string;
        findingIds?: string[];
        artifactIds?: string[];
        sourceAuthorityRevision?: string;
        requestKey: string;
      } = {
        workspaceId: str(params, "workspaceId"),
        target: actionTargetFrom(params),
        executor: actionExecutorFrom(params),
        reason: str(params, "reason"),
        taskId: str(params, "taskId"),
        requestKey: str(params, "requestKey"),
      };
      const expiresAt = optionalStr(params, "expiresAt");
      if (expiresAt !== undefined) input.expiresAt = expiresAt;
      const findingIds = optionalStringList(params, "findingIds");
      if (findingIds !== undefined) input.findingIds = findingIds;
      const artifactIds = optionalStringList(params, "artifactIds");
      if (artifactIds !== undefined) input.artifactIds = artifactIds;
      const sourceAuthorityRevision = optionalStr(params, "sourceAuthorityRevision");
      if (sourceAuthorityRevision !== undefined) input.sourceAuthorityRevision = sourceAuthorityRevision;
      return service.propose_action(ctx, input);
    }
    case "review_action": {
      const input: {
        workspaceId: string;
        proposalId: string;
        revision: number;
        intentDigest: string;
        decision: "approve" | "reject";
        reason?: string;
        requestKey: string;
      } = {
        workspaceId: str(params, "workspaceId"),
        proposalId: str(params, "proposalId"),
        revision: requireInt(params, "revision"),
        intentDigest: str(params, "intentDigest"),
        decision: requireEnum(str(params, "decision"), ACTION_REVIEW_DECISIONS, "decision"),
        requestKey: str(params, "requestKey"),
      };
      const reason = optionalStr(params, "reason");
      if (reason !== undefined) input.reason = reason;
      return service.review_action(ctx, input);
    }
    case "cancel_action":
      return service.cancel_action(ctx, {
        workspaceId: str(params, "workspaceId"),
        proposalId: str(params, "proposalId"),
        revision: requireInt(params, "revision"),
        intentDigest: str(params, "intentDigest"),
        reason: str(params, "reason"),
        requestKey: str(params, "requestKey"),
      });
    case "reserve_action_execution":
      return service.reserve_action_execution(ctx, {
        workspaceId: str(params, "workspaceId"),
        proposalId: str(params, "proposalId"),
        revision: requireInt(params, "revision"),
        intentDigest: str(params, "intentDigest"),
        requestKey: str(params, "requestKey"),
      });
    case "record_action_outcome": {
      const input: {
        workspaceId: string;
        proposalId: string;
        revision: number;
        intentDigest: string;
        outcome: (typeof ACTION_SUBMISSION_OUTCOMES)[number];
        providerRef: ReturnType<typeof actionProviderRefFrom>;
        resolvesReceiptId?: string;
        requestKey: string;
      } = {
        workspaceId: str(params, "workspaceId"),
        proposalId: str(params, "proposalId"),
        revision: requireInt(params, "revision"),
        intentDigest: str(params, "intentDigest"),
        outcome: requireEnum(str(params, "outcome"), ACTION_SUBMISSION_OUTCOMES, "outcome"),
        providerRef: actionProviderRefFrom(params),
        requestKey: str(params, "requestKey"),
      };
      const resolvesReceiptId = optionalStr(params, "resolvesReceiptId");
      if (resolvesReceiptId !== undefined) input.resolvesReceiptId = resolvesReceiptId;
      return service.record_action_outcome(ctx, input);
    }
    case "get_action_proposal":
      return service.get_action_proposal(ctx, {
        workspaceId: str(params, "workspaceId"),
        proposalId: str(params, "proposalId"),
      });
    case "list_action_proposals": {
      const input: { workspaceId: string; limit?: number; cursor?: string } = {
        workspaceId: str(params, "workspaceId"),
      };
      const limit = optionalInt(params, "limit");
      if (limit !== undefined) input.limit = limit;
      const cursor = optionalStr(params, "cursor");
      if (cursor !== undefined) input.cursor = cursor;
      return service.list_action_proposals(ctx, input);
    }
    case "list_action_receipts": {
      const input: { workspaceId: string; proposalId: string; limit?: number; cursor?: string } = {
        workspaceId: str(params, "workspaceId"),
        proposalId: str(params, "proposalId"),
      };
      const limit = optionalInt(params, "limit");
      if (limit !== undefined) input.limit = limit;
      const cursor = optionalStr(params, "cursor");
      if (cursor !== undefined) input.cursor = cursor;
      return service.list_action_receipts(ctx, input);
    }
    default: {
      const exhaustive: never = method;
      throw new ValidationError(`Unknown method: ${exhaustive}`, { field: "method" });
    }
  }
}
