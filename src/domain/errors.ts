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
  | "RateLimited"
  | "InvitationLimitReached"
  | "InvitationAlreadyIssued"
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

export class RateLimited extends CampfireError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("RateLimited", message, details);
  }
}

/** A workspace already holds the maximum number of active enrollment invitations. Carries no secrets. */
export class InvitationLimitReached extends CampfireError {
  constructor(limit: number, activeInvitations: ReadonlyArray<{ invitationId: string; expiresAt: string; createdAt: string }>) {
    super(
      "InvitationLimitReached",
      `This workspace already has ${limit} active invitations, which is the limit. Revoke one of the active invitations (or wait for it to expire) and try again.`,
      { limit, activeInvitations: activeInvitations.map(({ invitationId, expiresAt, createdAt }) => ({ invitationId, expiresAt, createdAt })) },
    );
  }
}

/**
 * A retried issue request reused a request id that already produced an invitation. The secret is
 * never stored, so it cannot be shown again. Carries no secret and no secret hash.
 */
export class InvitationAlreadyIssued extends CampfireError {
  constructor(invitation: { invitationId: string; createdAt: string; expiresAt: string; status: "active" | "expired" | "consumed" | "revoked" }) {
    super(
      "InvitationAlreadyIssued",
      `An invitation (${invitation.invitationId}) was already issued for this request, but its link cannot be shown again. ${invitation.status === "active" ? "Revoke it and issue a new invitation with a new request id." : `It is ${invitation.status}; issue a new invitation with a new request id.`}`,
      { invitationId: invitation.invitationId, createdAt: invitation.createdAt, expiresAt: invitation.expiresAt, status: invitation.status },
    );
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
