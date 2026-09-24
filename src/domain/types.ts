/**
 * Campfire domain model (Sprint 001).
 *
 * These types are deliberately harness-independent. See AGENTS.md and
 * docs/ARCHITECTURE.md. Object provenance is modelled by `Provenance` and is
 * required on every meaningful contribution.
 */

export type ActorType = "human" | "agent";

/** A reference to a human or agent actor. Never collapses the actor type. */
export interface ActorRef {
  actorId: string;
  actorType: ActorType;
}

export type WorkspaceStatus = "active" | "completed" | "archived";
export type GoalStatus = "active" | "completed" | "abandoned";
export type TaskStatus = "open" | "in_progress" | "blocked" | "completed";
export type DecisionStatus = "proposed" | "accepted" | "superseded";
export type ParticipantRole = "owner" | "member" | "agent" | "viewer";

export type ArtifactType =
  | "file"
  | "pull_request"
  | "commit"
  | "log"
  | "trace"
  | "document"
  | "deployment"
  | "screenshot"
  | "report"
  | "other";

/** Who or what produced a contribution, in which session, and when. */
export interface Provenance {
  createdBy: ActorRef;
  /** Present when the contribution was produced through an agent session. */
  agentSessionId?: string;
  createdAt: string;
}

export interface Organization {
  id: string;
  name: string;
  createdAt: string;
}

export interface Team {
  id: string;
  organizationId: string;
  name: string;
  createdAt: string;
}

export interface Human {
  id: string;
  teamId: string;
  displayName: string;
  externalIdentity?: string;
  createdAt: string;
}

/**
 * An agent identity. Distinct from a model or a session. May be owned by a
 * human (`humanId`) or, later, by an organization.
 */
export interface Agent {
  id: string;
  teamId: string;
  humanId?: string;
  name: string;
  harness: string;
  model?: string;
  instanceMetadata?: Record<string, unknown>;
  createdAt: string;
}

/** A single run of an agent inside a workspace for a specific human. */
export interface AgentSession {
  id: string;
  agentId: string;
  humanId: string;
  workspaceId: string;
  harness: string;
  startedAt: string;
  endedAt?: string;
}

export interface Workspace {
  id: string;
  teamId: string;
  name: string;
  description?: string;
  status: WorkspaceStatus;
  createdBy: ActorRef;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceParticipant {
  workspaceId: string;
  actor: ActorRef;
  role: ParticipantRole;
  joinedAt: string;
}

export interface Goal extends Provenance {
  id: string;
  workspaceId: string;
  title: string;
  description?: string;
  status: GoalStatus;
  updatedAt: string;
}

export interface Task extends Provenance {
  id: string;
  workspaceId: string;
  title: string;
  description?: string;
  status: TaskStatus;
  assignee?: ActorRef;
  updatedAt: string;
}

export interface Finding extends Provenance {
  id: string;
  workspaceId: string;
  summary: string;
  detail?: string;
  confidence?: number;
  sourceArtifactId?: string;
}

export interface Decision extends Provenance {
  id: string;
  workspaceId: string;
  summary: string;
  rationale?: string;
  status: DecisionStatus;
  approvedBy?: ActorRef;
  updatedAt: string;
}

export interface Artifact extends Provenance {
  id: string;
  workspaceId: string;
  type: ArtifactType;
  title: string;
  uriOrPath: string;
  metadata?: Record<string, unknown>;
}

export type ContributionAction =
  | "create"
  | "update"
  | "join"
  | "register_session"
  | "read";

export type ContributionObjectType =
  | "workspace"
  | "goal"
  | "task"
  | "finding"
  | "decision"
  | "artifact"
  | "participant"
  | "agent_session"
  | "invite";

/** SHA-256 hash of a raw actor token. The secret itself is never persisted. */
export interface ActorToken {
  id: string;
  actor: ActorRef;
  tokenHash: string;
  createdAt: string;
  revokedAt?: string;
}

/** Invite-only workspace membership. Role is taken from the invite on consume. */
export interface WorkspaceInvite {
  id: string;
  workspaceId: string;
  actor: ActorRef;
  role: ParticipantRole;
  invitedBy: ActorRef;
  createdAt: string;
  consumedAt?: string;
}

/** Append-only record describing a meaningful mutation. */
export interface Contribution {
  id: string;
  workspaceId: string;
  actor: ActorRef;
  agentSessionId?: string;
  action: ContributionAction;
  objectType: ContributionObjectType;
  objectId: string;
  payload?: Record<string, unknown>;
  createdAt: string;
}
