/**
 * Sprint 001 authorization policy.
 *
 * Membership is per workspace and per actor identity. Humans and agents are
 * distinct principals: an agent does not inherit its human owner's
 * participation or role (AGENTS.md invariant 2). Authorization is evaluated
 * here, before any state is retrieved across the Campfire boundary
 * (AGENTS.md invariant 4).
 */
import type { Authorizer, Operation, ActorContext } from "./authorization.js";
import type { CampfireStore } from "../store/store.js";
import {
  ActorNotFound,
  ParticipantRequired,
  SessionNotFound,
  Unauthorized,
  WorkspaceNotFound,
} from "../domain/errors.js";

const VIEWER_WRITE_OPERATIONS: ReadonlySet<Operation> = new Set<Operation>([
  "workspace:write",
  "goal:create",
  "goal:update",
  "finding:create",
  "decision:create",
  "decision:update",
  "task:create",
  "task:update",
  "artifact:attach",
  "participant:add",
]);

function logAuthz(entry: {
  allow: boolean;
  actorId: string;
  operation: Operation;
  workspaceId?: string;
  reason?: string;
}): void {
  process.stderr.write(`${JSON.stringify({ event: "authz", ...entry })}\n`);
}

export function createSimpleAuthorizer(store: CampfireStore): Authorizer {
  return {
    assertAllowed(ctx: ActorContext, operation: Operation, workspaceId?: string): void {
      try {
        evaluate(store, ctx, operation, workspaceId);
        logAuthz({ allow: true, actorId: ctx.actor.actorId, operation, workspaceId });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        logAuthz({
          allow: false,
          actorId: ctx.actor.actorId,
          operation,
          workspaceId,
          reason,
        });
        throw error;
      }
    },
  };
}

function evaluate(
  store: CampfireStore,
  ctx: ActorContext,
  operation: Operation,
  workspaceId: string | undefined,
): void {
  const { actor } = ctx;

  const identity = actor.actorType === "human" ? store.getHuman(actor.actorId) : store.getAgent(actor.actorId);
  if (identity === undefined) {
    throw new ActorNotFound(actor.actorId);
  }

  if (ctx.agentSessionId !== undefined) {
    const session = store.getAgentSession(ctx.agentSessionId);
    if (session === undefined) {
      throw new SessionNotFound(ctx.agentSessionId);
    }
    if (session.agentId !== actor.actorId) {
      throw new Unauthorized(
        `Agent session ${ctx.agentSessionId} does not belong to actor ${actor.actorId}`,
      );
    }
    // Ended sessions can no longer authorize work. Check before any
    // workspace-scoped decision so a stale session cannot cross the boundary
    // (AGENTS.md invariant 4).
    if (session.endedAt !== undefined) {
      throw new Unauthorized(`Agent session ${ctx.agentSessionId} has ended`);
    }
    if (workspaceId !== undefined && session.workspaceId !== workspaceId) {
      throw new Unauthorized(
        `Agent session ${ctx.agentSessionId} belongs to workspace ${session.workspaceId}, not ${workspaceId}`,
      );
    }
  }

  if (operation === "workspace:list") {
    return;
  }

  const targetWorkspaceId = workspaceId ?? "";

  if (operation === "workspace:join") {
    // Invite consumption is enforced in the service so this policy stays small:
    // actor exists (above) and the workspace exists. Same-team is not enough.
    const workspace = store.getWorkspace(targetWorkspaceId);
    if (workspace === undefined) {
      throw new WorkspaceNotFound(targetWorkspaceId);
    }
    return;
  }

  if (operation === "session:register") {
    if (actor.actorType !== "agent") {
      throw new Unauthorized("Only agent identities may register an agent session");
    }
    if (store.getWorkspace(targetWorkspaceId) === undefined) {
      throw new WorkspaceNotFound(targetWorkspaceId);
    }
    if (store.getParticipant(targetWorkspaceId, actor) === undefined) {
      throw new ParticipantRequired(
        `Actor ${actor.actorId} is not a participant of workspace ${targetWorkspaceId}`,
      );
    }
    return;
  }

  const participant = store.getParticipant(targetWorkspaceId, actor);
  // Distinguish "workspace does not exist" from "not a participant". Only
  // existence is checked here; no workspace state is returned before the
  // authorization decision (AGENTS.md invariant 4).
  if (participant === undefined && store.getWorkspace(targetWorkspaceId) === undefined) {
    throw new WorkspaceNotFound(targetWorkspaceId);
  }
  if (participant === undefined) {
    throw new ParticipantRequired(
      `Actor ${actor.actorId} is not a participant of workspace ${targetWorkspaceId}`,
    );
  }

  if (operation === "invite:create") {
    if (participant.role !== "owner" && participant.role !== "member") {
      throw new Unauthorized(
        `Role ${participant.role} may not invite to workspace ${targetWorkspaceId}`,
      );
    }
    return;
  }

  if (participant.role === "viewer" && VIEWER_WRITE_OPERATIONS.has(operation)) {
    throw new Unauthorized(
      `Viewer ${actor.actorId} may not perform ${operation} in workspace ${targetWorkspaceId}`,
    );
  }
}
