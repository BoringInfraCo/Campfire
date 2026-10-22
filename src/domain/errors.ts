/**
 * Typed domain errors.
 *
 * Errors are explicit and actionable. Callers (MCP handlers, CLI, tests) can
 * branch on `code` instead of parsing prose. See AGENTS.md "Error Handling".
 */
export type CampfireErrorCode =
  | "ValidationError"
  | "WorkspaceNotFound"
  | "ActorNotFound"
  | "SessionNotFound"
  | "TeamNotFound"
  | "Unauthorized"
  | "ParticipantRequired"
  | "InvalidTransition"
  | "InvalidContribution"
  | "ArtifactNotFound"
  | "TaskNotFound"
  | "GoalNotFound"
  | "FindingNotFound"
  | "DecisionNotFound"
  | "CrossWorkspaceReference"
  | "Conflict"
  | "ActionProposalNotFound"
  | "ActionReceiptNotFound"
  | "RecallRestart";

export class CampfireError extends Error {
  readonly code: CampfireErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: CampfireErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = code;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends CampfireError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("ValidationError", message, details);
  }
}

export class WorkspaceNotFound extends CampfireError {
  constructor(workspaceId: string) {
    super("WorkspaceNotFound", `Workspace not found: ${workspaceId}`, { workspaceId });
  }
}

export class ActorNotFound extends CampfireError {
  constructor(actorId: string) {
    super("ActorNotFound", `Actor not found: ${actorId}`, { actorId });
  }
}

export class SessionNotFound extends CampfireError {
  constructor(sessionId: string) {
    super("SessionNotFound", `Agent session not found: ${sessionId}`, { sessionId });
  }
}

export class TeamNotFound extends CampfireError {
  constructor(teamId: string) {
    super("TeamNotFound", `Team not found: ${teamId}`, { teamId });
  }
}

export class Unauthorized extends CampfireError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("Unauthorized", message, details);
  }
}

export class ParticipantRequired extends CampfireError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("ParticipantRequired", message, details);
  }
}

export class InvalidTransition extends CampfireError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("InvalidTransition", message, details);
  }
}

export class InvalidContribution extends CampfireError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("InvalidContribution", message, details);
  }
}

export class ArtifactNotFound extends CampfireError {
  constructor(artifactId: string) {
    super("ArtifactNotFound", `Artifact not found: ${artifactId}`, { artifactId });
  }
}

export class TaskNotFound extends CampfireError {
  constructor(taskId: string) {
    super("TaskNotFound", `Task not found: ${taskId}`, { taskId });
  }
}

export class GoalNotFound extends CampfireError {
  constructor(goalId: string) {
    super("GoalNotFound", `Goal not found: ${goalId}`, { goalId });
  }
}

export class FindingNotFound extends CampfireError {
  constructor(findingId: string) {
    super("FindingNotFound", `Finding not found: ${findingId}`, { findingId });
  }
}

export class DecisionNotFound extends CampfireError {
  constructor(decisionId: string) {
    super("DecisionNotFound", `Decision not found: ${decisionId}`, { decisionId });
  }
}

export class CrossWorkspaceReference extends CampfireError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("CrossWorkspaceReference", message, details);
  }
}

export class Conflict extends CampfireError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("Conflict", message, details);
  }
}

export class ActionProposalNotFound extends CampfireError {
  constructor(proposalId: string) {
    super("ActionProposalNotFound", `Action proposal not found: ${proposalId}`, { proposalId });
  }
}

export class ActionReceiptNotFound extends CampfireError {
  constructor(receiptId: string) {
    super("ActionReceiptNotFound", `Action receipt not found: ${receiptId}`, { receiptId });
  }
}

/**
 * The recall cursor named a source position that is no longer the workspace tip.
 * Callers restart from the beginning. The error carries no query, excerpt, or count.
 */
export class RecallRestart extends CampfireError {
  constructor(workspaceId: string) {
    super("RecallRestart", "The workspace changed after this recall cursor was issued. Start recall again without a cursor.", {
      workspaceId,
      field: "cursor",
    });
  }
}
