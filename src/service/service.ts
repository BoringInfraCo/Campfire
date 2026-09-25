/**
 * Application service contract.
 *
 * The MCP layer and CLI depend on this interface, never on storage details.
 * Handlers stay thin: validate, call the service, serialize the result.
 */
import type { ActorContext } from "./authorization.js";
import type {
  ActorRef,
  Agent,
  AgentSession,
  Artifact,
  ArtifactType,
  Contribution,
  Decision,
  DecisionStatus,
  Finding,
  Goal,
  Human,
  ParticipantRole,
  Task,
  TaskStatus,
  Workspace,
  WorkspaceInvite,
  WorkspaceParticipant,
  WorkspaceStatus,
} from "../domain/types.js";

export interface CreateWorkspaceInput {
  teamId: string;
  name: string;
  description?: string;
}

export interface UpdateWorkspaceInput {
  workspaceId: string;
  status: WorkspaceStatus;
}

export interface JoinWorkspaceInput {
  workspaceId: string;
  /** Ignored once membership is invite-only; role comes from the invite. */
  role?: ParticipantRole;
}

export interface RegisterAgentSessionInput {
  agentId: string;
  /** Ignored unless it matches `agents.human_id`; mismatch is Unauthorized. */
  humanId?: string;
  workspaceId: string;
  harness: string;
}

export interface CreateHumanInput {
  teamId: string;
  displayName: string;
  externalIdentity?: string;
}

export interface CreateHumanResult {
  human: Human;
  token: string;
}

export interface CreateAgentInput {
  teamId: string;
  humanId: string;
  name: string;
  harness: string;
  model?: string;
}

export interface CreateAgentResult {
  agent: Agent;
  token: string;
}

export interface IssuedToken {
  token: string;
  actor: ActorRef;
}

export interface InviteToWorkspaceInput {
  workspaceId: string;
  actor: ActorRef;
  role: ParticipantRole;
}

export interface CreateGoalInput {
  workspaceId: string;
  title: string;
  description?: string;
}

export interface UpdateGoalInput {
  goalId: string;
  title?: string;
  description?: string;
  status?: Goal["status"];
}

export interface AddFindingInput {
  workspaceId: string;
  summary: string;
  detail?: string;
  confidence?: number;
  sourceArtifactId?: string;
}

export interface AddDecisionInput {
  workspaceId: string;
  summary: string;
  rationale?: string;
  status?: DecisionStatus;
}

export interface CreateTaskInput {
  workspaceId: string;
  title: string;
  description?: string;
  assignee?: ActorRef;
}

export interface UpdateTaskInput {
  taskId: string;
  status?: TaskStatus;
  title?: string;
  description?: string;
  /** `null` clears the assignee. Omit to leave the current assignee unchanged. */
  assignee?: ActorRef | null;
}

export interface AddArtifactInput {
  workspaceId: string;
  type: ArtifactType;
  title: string;
  uriOrPath: string;
  metadata?: Record<string, unknown>;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  description?: string;
  status: string;
  goalTitle?: string;
  openTaskCount: number;
  updatedAt: string;
}

export interface ParticipantView {
  actor: ActorRef;
  name: string;
  role: ParticipantRole;
  harness?: string;
  humanOwnerId?: string;
  joinedAt: string;
}

/** Full current-state projection returned by `get_workspace`. */
export interface WorkspaceView {
  workspace: Workspace;
  goal?: Goal;
  participants: ParticipantView[];
  tasks: Task[];
  findings: Finding[];
  decisions: Decision[];
  artifacts: Artifact[];
  activity: Contribution[];
  provenanceSummary: string[];
}

/** Short summary of a superseded decision in the orientation projection. */
export interface SupersededDecisionSummary {
  id: string;
  summary: string;
  updatedAt: string;
}

/**
 * Compact orientation projection returned by `get_workspace_context`.
 *
 * Ordered for an incoming agent: goal, proposed+accepted decisions, open tasks,
 * findings, artifacts, then capped recent provenance. `get_workspace` remains
 * the full inspector (Sprint 003).
 */
export const ORIENTATION_PROVENANCE_LIMIT = 20;

/** The kind of work an attention item points at. */
export type AttentionKind = "task" | "decision";

/** Why an item is surfaced; labels are stable across surfaces (Sprint 008). */
export type AttentionReason =
  | "proposed_decision_actionable"
  | "assigned_blocked_task"
  | "assigned_open_task"
  | "team_proposed_decision"
  | "unassigned_blocked_task"
  | "team_blocked_task"
  | "team_open_task";

/** One authorization-aware orientation item for a cold entrant. */
export interface AttentionItem {
  kind: AttentionKind;
  id: string;
  summary: string;
  status: string;
  reason: AttentionReason;
  assignee?: ActorRef;
}

/** The live state of the work, independent of who may act on it. */
export interface CurrentWork {
  inProgressTasks: Task[];
  blockedTasks: Task[];
  acceptedDecisions: Decision[];
}

/**
 * A rule-based orientation hint. Never an instruction to execute: `orientationHint`
 * is always true and no surface dispatches it (Sprint 008).
 */
export interface SuggestedNextAction {
  kind: "task" | "decision" | "none";
  id?: string;
  summary: string;
  reason: AttentionReason | "none";
  orientationHint: true;
}

export type RecordedAlignmentStatus = "open" | "established" | "unspecified";

/**
 * Recorded alignment boundary (Sprint 009).
 *
 * Describes what the workspace has recorded as proposed, accepted, or
 * unspecified. It is not permission to execute and it does not prove
 * agreement. Superseded decisions never establish the boundary. Blocked
 * tasks stay independently unresolved: the projection does not claim that
 * a proposal causes a block.
 */
export interface RecordedAlignment {
  status: RecordedAlignmentStatus;
  proposedDecisionIds: string[];
  acceptedDecisionIds: string[];
  unresolvedBlockedTaskIds: string[];
}

/** Contributions strictly after a caller-supplied cursor, capped for orientation. */
export interface SinceProjection {
  cursor: string;
  items: Contribution[];
  truncated: boolean;
}

export interface WorkspaceContext {
  workspace: Workspace;
  goal?: Goal;
  participants: ParticipantView[];
  proposedDecisions: Decision[];
  acceptedDecisions: Decision[];
  supersededDecisions: SupersededDecisionSummary[];
  openTasks: Task[];
  findings: Finding[];
  artifacts: Artifact[];
  /** Most recent contributions, chronological, capped at ORIENTATION_PROVENANCE_LIMIT. */
  provenance: Contribution[];
  provenanceTotal: number;
  provenanceTruncated: boolean;
  /** Items the caller is authorized to act on outside Campfire. */
  needsYou: AttentionItem[];
  /** Team-level items the caller cannot act on directly. */
  needsAttention: AttentionItem[];
  currentWork: CurrentWork;
  suggestedNextAction: SuggestedNextAction;
  /** Recorded boundary derived from decision and task status. Not permission to execute. */
  alignment: RecordedAlignment;
  /** Reused `describeContribution` narrative over the full activity list. */
  provenanceSummary: string[];
  /** Present only when the caller supplied a `since` cursor. */
  since?: SinceProjection;
}

export interface ActivityPage {
  items: Contribution[];
  total: number;
  truncated: boolean;
  nextBefore?: string;
}

export interface CheckReadinessInput {
  workspaceId: string;
}

export interface ReadinessStatus {
  ready: true;
  workspaceId: string;
  actor: ActorRef;
  sessionId?: string;
}

export interface GetActivityInput {
  workspaceId: string;
  limit?: number;
  /** Contribution id: return items strictly older than this contribution. */
  before?: string;
}

export interface CampfireService {
  checkReadiness(ctx: ActorContext, input: CheckReadinessInput): ReadinessStatus;
  createWorkspace(ctx: ActorContext, input: CreateWorkspaceInput): Workspace;
  updateWorkspace(ctx: ActorContext, input: UpdateWorkspaceInput): Workspace;
  listWorkspaces(ctx: ActorContext): WorkspaceSummary[];
  getWorkspace(ctx: ActorContext, workspaceId: string): WorkspaceView;
  getWorkspaceContext(
    ctx: ActorContext,
    workspaceId: string,
    options?: { since?: string },
  ): WorkspaceContext;
  getActivity(ctx: ActorContext, input: GetActivityInput): ActivityPage;

  createHuman(ctx: ActorContext | undefined, input: CreateHumanInput): CreateHumanResult;
  createAgent(ctx: ActorContext, input: CreateAgentInput): CreateAgentResult;
  issueToken(ctx: ActorContext, actor: ActorRef): IssuedToken;
  revokeToken(ctx: ActorContext, rawToken: string): { revokedTokenId: string; actor: ActorRef };
  resolveToken(rawToken: string): ActorRef;

  joinWorkspace(ctx: ActorContext, input: JoinWorkspaceInput): WorkspaceParticipant;
  inviteToWorkspace(ctx: ActorContext, input: InviteToWorkspaceInput): WorkspaceInvite;
  registerAgentSession(ctx: ActorContext, input: RegisterAgentSessionInput): AgentSession;
  endAgentSession(ctx: ActorContext, sessionId: string): void;

  createGoal(ctx: ActorContext, input: CreateGoalInput): Goal;
  updateGoal(ctx: ActorContext, input: UpdateGoalInput): Goal;

  addFinding(ctx: ActorContext, input: AddFindingInput): Finding;
  addDecision(ctx: ActorContext, input: AddDecisionInput): Decision;
  acceptDecision(ctx: ActorContext, decisionId: string): Decision;
  createTask(ctx: ActorContext, input: CreateTaskInput): Task;
  updateTask(ctx: ActorContext, input: UpdateTaskInput): Task;
  addArtifact(ctx: ActorContext, input: AddArtifactInput): Artifact;

  close(): void;
}

/** Same recency order as the orientation projection: updatedAt, then id. */
function compareByUpdatedThenId(
  a: { updatedAt: string; id: string },
  b: { updatedAt: string; id: string },
): number {
  if (a.updatedAt < b.updatedAt) return -1;
  if (a.updatedAt > b.updatedAt) return 1;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/**
 * Recorded alignment from current Decision and Task status only.
 *
 * Superseded decisions are ignored: they neither open nor establish the
 * boundary, and they are omitted from both id lists. A proposal keeps the
 * boundary `open` even when accepted decisions also exist. Blocked tasks are
 * listed on their own; nothing here links a proposal to a block.
 */
export function deriveRecordedAlignment(
  decisions: readonly Decision[],
  tasks: readonly Task[],
): RecordedAlignment {
  const proposedDecisionIds = decisions
    .filter((decision) => decision.status === "proposed")
    .sort(compareByUpdatedThenId)
    .map((decision) => decision.id);
  const acceptedDecisionIds = decisions
    .filter((decision) => decision.status === "accepted")
    .sort(compareByUpdatedThenId)
    .map((decision) => decision.id);
  const unresolvedBlockedTaskIds = tasks
    .filter((task) => task.status === "blocked")
    .sort(compareByUpdatedThenId)
    .map((task) => task.id);

  let status: RecordedAlignmentStatus;
  if (proposedDecisionIds.length > 0) {
    status = "open";
  } else if (acceptedDecisionIds.length > 0) {
    status = "established";
  } else {
    status = "unspecified";
  }

  return {
    status,
    proposedDecisionIds,
    acceptedDecisionIds,
    unresolvedBlockedTaskIds,
  };
}
