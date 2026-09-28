/**
 * Closed Sprint 019 vocabulary.
 *
 * A mutation emits one event or none. No-op updates and transitions outside
 * the vocabulary are not events. A blocked task that completes emits only
 * `task.completed`.
 */
import type { CampfireEventType } from "./events.js";
import type { DecisionStatus, GoalStatus, TaskStatus, WorkspaceStatus } from "./types.js";

export type QualifyingMutation =
  | { kind: "finding.created" }
  | { kind: "decision.created"; status: DecisionStatus }
  | { kind: "decision.updated"; from: DecisionStatus; to: DecisionStatus }
  | { kind: "task.updated"; from: TaskStatus; to: TaskStatus }
  | { kind: "goal.updated"; from: GoalStatus; to: GoalStatus }
  | { kind: "artifact.created" }
  | { kind: "workspace.updated"; from: WorkspaceStatus; to: WorkspaceStatus };

export function eventTypeForMutation(mutation: QualifyingMutation): CampfireEventType | undefined {
  switch (mutation.kind) {
    case "finding.created":
      return "finding.recorded";
    case "artifact.created":
      return "artifact.attached";
    case "decision.created":
      return mutation.status === "proposed" ? "decision.proposed" : undefined;
    case "decision.updated":
      return mutation.from === "proposed" && mutation.to === "accepted" ? "decision.accepted" : undefined;
    case "task.updated":
      if (mutation.from === mutation.to) return undefined;
      // Completion wins when a blocked task moves straight to completed.
      if (mutation.to === "completed") return "task.completed";
      if (mutation.to === "blocked") return "task.blocked";
      return undefined;
    case "goal.updated":
      return mutation.from !== "completed" && mutation.to === "completed" ? "goal.completed" : undefined;
    case "workspace.updated":
      return mutation.from !== "completed" && mutation.to === "completed"
        ? "workspace.completed"
        : undefined;
    default: {
      const _exhaustive: never = mutation;
      return _exhaustive;
    }
  }
}
