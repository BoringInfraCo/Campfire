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
}

export interface ActivityPage {
  items: Contribution[];
  total: number;
  truncated: boolean;
  nextBefore?: string;
}

export interface GetActivityInput {
  workspaceId: string;
  limit?: number;
  /** Contribution id: return items strictly older than this contribution. */
  before?: string;
}

export interface CampfireService {
  createWorkspace(ctx: ActorContext, input: CreateWorkspaceInput): Workspace;
  updateWorkspace(ctx: ActorContext, input: UpdateWorkspaceInput): Workspace;
  listWorkspaces(ctx: ActorContext): WorkspaceSummary[];
  getWorkspace(ctx: ActorContext, workspaceId: string): WorkspaceView;
  getWorkspaceContext(ctx: ActorContext, workspaceId: string): WorkspaceContext;
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
