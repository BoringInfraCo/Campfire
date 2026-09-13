/**
 * Persistence boundary.
 *
 * The domain/service layer depends on this interface only. The SQLite
 * implementation lives in `sqlite-store.ts`. Keeping this explicit avoids
 * leaking storage details into collaboration semantics (AGENTS.md invariant 7).
 */
import type {
  ActorRef,
  ActorToken,
  Agent,
  AgentSession,
  Artifact,
  Contribution,
  Decision,
  Finding,
  Goal,
  Human,
  Organization,
  ParticipantRole,
  Task,
  Team,
  Workspace,
  WorkspaceInvite,
  WorkspaceParticipant,
  WorkspaceStatus,
  GoalStatus,
  TaskStatus,
  DecisionStatus,
} from "../domain/types.js";

export interface WorkspacePatch {
  name?: string;
  description?: string;
  status?: WorkspaceStatus;
  updatedAt: string;
}

export interface GoalPatch {
  title?: string;
  description?: string;
  status?: GoalStatus;
  updatedAt: string;
}

export interface TaskPatch {
  title?: string;
  description?: string;
  status?: TaskStatus;
  assignee?: ActorRef | null;
  updatedAt: string;
}

export interface DecisionPatch {
  summary?: string;
  rationale?: string;
  status?: DecisionStatus;
  approvedBy?: ActorRef | null;
  updatedAt: string;
}

export interface CampfireStore {
  // --- identity ---
  createOrganization(organization: Organization): void;
  getOrganization(id: string): Organization | undefined;

  createTeam(team: Team): void;
  getTeam(id: string): Team | undefined;

  createHuman(human: Human): void;
  getHuman(id: string): Human | undefined;
  listHumans(teamId: string): Human[];
  countHumans(): number;

  createAgent(agent: Agent): void;
  getAgent(id: string): Agent | undefined;
  listAgents(teamId: string): Agent[];

  createAgentSession(session: AgentSession): void;
  getAgentSession(id: string): AgentSession | undefined;
  endAgentSession(id: string, endedAt: string): void;
  listAgentSessions(workspaceId: string): AgentSession[];

  // --- workspaces ---
  createWorkspace(workspace: Workspace): void;
  getWorkspace(id: string): Workspace | undefined;
  updateWorkspace(id: string, patch: WorkspacePatch): void;
  listWorkspaces(): Workspace[];
  listWorkspacesForActor(actor: ActorRef): Workspace[];

  addParticipant(participant: WorkspaceParticipant): void;
  getParticipant(workspaceId: string, actor: ActorRef): WorkspaceParticipant | undefined;
  listParticipants(workspaceId: string): WorkspaceParticipant[];
  updateParticipantRole(workspaceId: string, actor: ActorRef, role: ParticipantRole): void;

  // --- contribution objects ---
  createGoal(goal: Goal): void;
  getGoal(id: string): Goal | undefined;
  getGoalForWorkspace(workspaceId: string): Goal | undefined;
  updateGoal(id: string, patch: GoalPatch): void;

  createTask(task: Task): void;
  getTask(id: string): Task | undefined;
  listTasks(workspaceId: string): Task[];
  updateTask(id: string, patch: TaskPatch): void;

  createFinding(finding: Finding): void;
  getFinding(id: string): Finding | undefined;
  listFindings(workspaceId: string): Finding[];

  createDecision(decision: Decision): void;
  getDecision(id: string): Decision | undefined;
  listDecisions(workspaceId: string): Decision[];
  updateDecision(id: string, patch: DecisionPatch): void;

  createArtifact(artifact: Artifact): void;
  getArtifact(id: string): Artifact | undefined;
  listArtifacts(workspaceId: string): Artifact[];

  // --- activity / provenance ---
  createContribution(contribution: Contribution): void;
  getContribution(id: string): Contribution | undefined;
  listContributions(workspaceId: string): Contribution[];

  // --- actor tokens (hashes only) ---
  createActorToken(token: ActorToken): void;
  getActorTokenByHash(tokenHash: string): ActorToken | undefined;
  revokeActorToken(id: string, revokedAt: string): void;

  // --- workspace invites ---
  createInvite(invite: WorkspaceInvite): void;
  getOpenInvite(workspaceId: string, actor: ActorRef): WorkspaceInvite | undefined;
  consumeInvite(id: string, consumedAt: string): void;
  listInvites(workspaceId: string): WorkspaceInvite[];

  // --- infrastructure ---
  transaction<T>(fn: () => T): T;
  close(): void;
}
