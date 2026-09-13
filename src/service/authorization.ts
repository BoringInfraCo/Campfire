/**
 * Authorization boundary.
 *
 * Authorization happens before retrieval: state must be filtered before it
 * crosses the Campfire boundary (AGENTS.md invariant 4). Sprint 001 uses
 * workspace membership plus simple roles; the interface is intentionally
 * broader than the current policy so the boundary stays real.
 */
import type { ActorRef } from "../domain/types.js";

export type Operation =
  | "workspace:list"
  | "workspace:read"
  | "workspace:write"
  | "workspace:join"
  | "participant:add"
  | "goal:create"
  | "goal:update"
  | "finding:create"
  | "decision:create"
  | "decision:update"
  | "task:create"
  | "task:update"
  | "artifact:attach"
  | "activity:read"
  | "session:register"
  | "session:end"
  | "invite:create";

/** The acting participant for a single request. */
export interface ActorContext {
  actor: ActorRef;
  /** Set when the request is executed through a registered agent session. */
  agentSessionId?: string;
}

export interface AuthorizationDecision {
  allow: boolean;
  reason: string;
}

export interface Authorizer {
  /**
   * Throws `Unauthorized` / `ParticipantRequired` when the actor may not
   * perform `operation` in `workspaceId`. Returns normally when allowed.
   */
  assertAllowed(ctx: ActorContext, operation: Operation, workspaceId?: string): void;
}
