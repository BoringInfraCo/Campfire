/**
 * Async Sprint 001 authorization policy for Workers/D1.
 *
 * Mechanical async port of `src/service/simple-authorizer.ts`: identical
 * rules, identical errors, identical logging shape. Authorization is still
 * evaluated before any state crosses the Campfire boundary (AGENTS.md
 * invariant 4); only the store driver is async.
 */
import type { ActorContext, Operation } from "../service/authorization.js";
import type { AsyncCampfireStore } from "./d1-store.js";
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

export interface AsyncAuthorizer {
  assertAllowed(ctx: ActorContext, operation: Operation, workspaceId?: string): Promise<void>;
  /**
   * Boolean form of `assertAllowed` for projections that must label attention
   * without throwing. Evaluates the same policy and never logs (Sprint 008).
   */
  canAct(ctx: ActorContext, operation: Operation, workspaceId?: string): Promise<boolean>;
}

function logAuthz(entry: {
  allow: boolean;
  actorId: string;
  operation: Operation;
  workspaceId?: string;
  reason?: string;
}): void {
  // console.error works in Workers and keeps the same observability shape.
  console.error(JSON.stringify({ event: "authz", ...entry }));
}

export function createAsyncAuthorizer(store: AsyncCampfireStore): AsyncAuthorizer {
  return {
    async assertAllowed(ctx: ActorContext, operation: Operation, workspaceId?: string): Promise<void> {
      try {
        await evaluate(store, ctx, operation, workspaceId);
        logAuthz({ allow: true, actorId: ctx.actor.actorId, operation, workspaceId });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        logAuthz({ allow: false, actorId: ctx.actor.actorId, operation, workspaceId, reason });
        throw error;
      }
    },

    async canAct(ctx: ActorContext, operation: Operation, workspaceId?: string): Promise<boolean> {
      try {
        await evaluate(store, ctx, operation, workspaceId);
        return true;
      } catch {
        // Boolean projection helper: no logAuthz entry, no thrown error.
        return false;
      }
    },
  };
}

async function evaluate(
  store: AsyncCampfireStore,
  ctx: ActorContext,
  operation: Operation,
  workspaceId: string | undefined,
): Promise<void> {
  const { actor } = ctx;

  const identity =
    actor.actorType === "human" ? await store.getHuman(actor.actorId) : await store.getAgent(actor.actorId);
  if (identity === undefined) {
    throw new ActorNotFound(actor.actorId);
  }

  if (ctx.agentSessionId !== undefined) {
    const session = await store.getAgentSession(ctx.agentSessionId);
    if (session === undefined) {
      throw new SessionNotFound(ctx.agentSessionId);
    }
    if (session.agentId !== actor.actorId) {
      throw new Unauthorized(
        `Agent session ${ctx.agentSessionId} does not belong to actor ${actor.actorId}`,
      );
    }
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
    const workspace = await store.getWorkspace(targetWorkspaceId);
    if (workspace === undefined) {
      throw new WorkspaceNotFound(targetWorkspaceId);
    }
    return;
  }

  if (operation === "session:register") {
    if (actor.actorType !== "agent") {
      throw new Unauthorized("Only agent identities may register an agent session");
    }
    if ((await store.getWorkspace(targetWorkspaceId)) === undefined) {
      throw new WorkspaceNotFound(targetWorkspaceId);
    }
    if ((await store.getParticipant(targetWorkspaceId, actor)) === undefined) {
      throw new ParticipantRequired(
        `Actor ${actor.actorId} is not a participant of workspace ${targetWorkspaceId}`,
      );
    }
    return;
  }

  const participant = await store.getParticipant(targetWorkspaceId, actor);
  if (participant === undefined && (await store.getWorkspace(targetWorkspaceId)) === undefined) {
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
