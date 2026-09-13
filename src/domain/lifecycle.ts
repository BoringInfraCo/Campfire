/**
 * Explicit lifecycle transitions.
 *
 * Invalid transitions are rejected rather than silently normalized. See
 * AGENTS.md "Lifecycle" and docs/ARCHITECTURE.md section 17.
 */
import { InvalidTransition } from "./errors.js";
import type { DecisionStatus, TaskStatus, WorkspaceStatus } from "./types.js";

const TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  open: ["in_progress", "completed", "blocked"],
  in_progress: ["blocked", "completed", "open"],
  blocked: ["in_progress", "completed", "open"],
  completed: ["open"],
};

const DECISION_TRANSITIONS: Record<DecisionStatus, readonly DecisionStatus[]> = {
  proposed: ["accepted", "superseded"],
  accepted: ["superseded"],
  superseded: [],
};

const WORKSPACE_TRANSITIONS: Record<WorkspaceStatus, readonly WorkspaceStatus[]> = {
  active: ["completed", "archived"],
  completed: ["archived", "active"],
  archived: [],
};

function assertTransition<T extends string>(
  current: T,
  next: T,
  transitions: Record<T, readonly T[]>,
  kind: string,
): void {
  if (current === next) return;
  if (!transitions[current].includes(next)) {
    throw new InvalidTransition(`Invalid ${kind} transition: ${current} -> ${next}`, {
      kind,
      from: current,
      to: next,
    });
  }
}

export function assertTaskTransition(current: TaskStatus, next: TaskStatus): void {
  assertTransition(current, next, TASK_TRANSITIONS, "task");
}

export function assertDecisionTransition(current: DecisionStatus, next: DecisionStatus): void {
  assertTransition(current, next, DECISION_TRANSITIONS, "decision");
}

export function assertWorkspaceTransition(current: WorkspaceStatus, next: WorkspaceStatus): void {
  assertTransition(current, next, WORKSPACE_TRANSITIONS, "workspace");
}

export function canTransition<T extends string>(
  current: T,
  next: T,
  transitions: Record<T, readonly T[]>,
): boolean {
  return current === next || transitions[current].includes(next);
}

export const taskTransitions = TASK_TRANSITIONS;
export const decisionTransitions = DECISION_TRANSITIONS;
export const workspaceTransitions = WORKSPACE_TRANSITIONS;
