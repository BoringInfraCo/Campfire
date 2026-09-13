import Database from "better-sqlite3";
import { applyMigrations } from "./migrations.js";
import type {
  ActorType,
  ActorToken,
  Agent,
  AgentSession,
  Artifact,
  ArtifactType,
  Contribution,
  ContributionAction,
  ContributionObjectType,
  Decision,
  DecisionStatus,
  Finding,
  Goal,
  GoalStatus,
  Human,
  Organization,
  ParticipantRole,
  Provenance,
  Task,
  TaskStatus,
  Team,
  Workspace,
  WorkspaceInvite,
  WorkspaceParticipant,
  WorkspaceStatus,
} from "../domain/types.js";
import type { CampfireStore, DecisionPatch, GoalPatch, TaskPatch, WorkspacePatch } from "./store.js";

interface OrganizationRow {
  id: string;
  name: string;
  created_at: string;
}

interface TeamRow {
  id: string;
  organization_id: string;
  name: string;
  created_at: string;
}

interface HumanRow {
  id: string;
  team_id: string;
  display_name: string;
  external_identity: string | null;
  created_at: string;
}

interface AgentRow {
  id: string;
  team_id: string;
  human_id: string | null;
  name: string;
  harness: string;
  model: string | null;
  instance_metadata: string | null;
  created_at: string;
}

interface AgentSessionRow {
  id: string;
  agent_id: string;
  human_id: string;
  workspace_id: string;
  harness: string;
  started_at: string;
  ended_at: string | null;
}

interface WorkspaceRow {
  id: string;
  team_id: string;
  name: string;
  description: string | null;
  status: string;
  created_by_actor_id: string;
  created_by_actor_type: string;
  created_at: string;
  updated_at: string;
}

interface ParticipantRow {
  workspace_id: string;
  actor_id: string;
  actor_type: string;
  role: string;
  joined_at: string;
}

interface GoalRow {
  id: string;
  workspace_id: string;
  title: string;
  description: string | null;
  status: string;
  created_by_actor_id: string;
  created_by_actor_type: string;
  agent_session_id: string | null;
  created_at: string;
  updated_at: string;
}

interface TaskRow {
  id: string;
  workspace_id: string;
  title: string;
  description: string | null;
  status: string;
  assignee_actor_id: string | null;
  assignee_actor_type: string | null;
  created_by_actor_id: string;
  created_by_actor_type: string;
  agent_session_id: string | null;
  created_at: string;
  updated_at: string;
}

interface FindingRow {
  id: string;
  workspace_id: string;
  summary: string;
  detail: string | null;
  confidence: number | null;
  source_artifact_id: string | null;
  created_by_actor_id: string;
  created_by_actor_type: string;
  agent_session_id: string | null;
  created_at: string;
}

interface DecisionRow {
  id: string;
  workspace_id: string;
  summary: string;
  rationale: string | null;
  status: string;
  approved_by_actor_id: string | null;
  approved_by_actor_type: string | null;
  created_by_actor_id: string;
  created_by_actor_type: string;
  agent_session_id: string | null;
  created_at: string;
  updated_at: string;
}

interface ArtifactRow {
  id: string;
  workspace_id: string;
  type: string;
  title: string;
  uri_or_path: string;
  metadata: string | null;
  created_by_actor_id: string;
  created_by_actor_type: string;
  agent_session_id: string | null;
  created_at: string;
}

interface ContributionRow {
  id: string;
  workspace_id: string;
  actor_id: string;
  actor_type: string;
  agent_session_id: string | null;
  action: string;
  object_type: string;
  object_id: string;
  payload: string | null;
  created_at: string;
}

interface ActorTokenRow {
  id: string;
  actor_id: string;
  actor_type: string;
  token_hash: string;
  created_at: string;
  revoked_at: string | null;
}

interface WorkspaceInviteRow {
  id: string;
  workspace_id: string;
  actor_id: string;
  actor_type: string;
  role: string;
  invited_by_actor_id: string;
  invited_by_actor_type: string;
  created_at: string;
  consumed_at: string | null;
}

function parseJson(value: string | null): Record<string, unknown> | undefined {
  if (value === null) return undefined;
  return JSON.parse(value) as Record<string, unknown>;
}

function provenanceOf(row: {
  created_by_actor_id: string;
  created_by_actor_type: string;
  agent_session_id: string | null;
  created_at: string;
}): Provenance {
  return {
    createdBy: {
      actorId: row.created_by_actor_id,
      actorType: row.created_by_actor_type as ActorType,
    },
    agentSessionId: row.agent_session_id ?? undefined,
    createdAt: row.created_at,
  };
}

function mapOrganization(row: OrganizationRow): Organization {
  return { id: row.id, name: row.name, createdAt: row.created_at };
}

function mapTeam(row: TeamRow): Team {
  return { id: row.id, organizationId: row.organization_id, name: row.name, createdAt: row.created_at };
}

function mapHuman(row: HumanRow): Human {
  return {
    id: row.id,
    teamId: row.team_id,
    displayName: row.display_name,
    externalIdentity: row.external_identity ?? undefined,
    createdAt: row.created_at,
  };
}

function mapAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    teamId: row.team_id,
    humanId: row.human_id ?? undefined,
    name: row.name,
    harness: row.harness,
    model: row.model ?? undefined,
    instanceMetadata: parseJson(row.instance_metadata),
    createdAt: row.created_at,
  };
}

function mapAgentSession(row: AgentSessionRow): AgentSession {
  return {
    id: row.id,
    agentId: row.agent_id,
    humanId: row.human_id,
    workspaceId: row.workspace_id,
    harness: row.harness,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? undefined,
  };
}

function mapWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    teamId: row.team_id,
    name: row.name,
    description: row.description ?? undefined,
    status: row.status as WorkspaceStatus,
    createdBy: {
      actorId: row.created_by_actor_id,
      actorType: row.created_by_actor_type as ActorType,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapParticipant(row: ParticipantRow): WorkspaceParticipant {
  return {
    workspaceId: row.workspace_id,
    actor: { actorId: row.actor_id, actorType: row.actor_type as ActorType },
    role: row.role as ParticipantRole,
    joinedAt: row.joined_at,
  };
}

function mapGoal(row: GoalRow): Goal {
  return {
    ...provenanceOf(row),
    id: row.id,
    workspaceId: row.workspace_id,
    title: row.title,
    description: row.description ?? undefined,
    status: row.status as GoalStatus,
    updatedAt: row.updated_at,
  };
}

function mapTask(row: TaskRow): Task {
  const assignee =
    row.assignee_actor_id !== null && row.assignee_actor_type !== null
      ? { actorId: row.assignee_actor_id, actorType: row.assignee_actor_type as ActorType }
      : undefined;
  return {
    ...provenanceOf(row),
    id: row.id,
    workspaceId: row.workspace_id,
    title: row.title,
    description: row.description ?? undefined,
    status: row.status as TaskStatus,
    assignee,
    updatedAt: row.updated_at,
  };
}

function mapFinding(row: FindingRow): Finding {
  return {
    ...provenanceOf(row),
    id: row.id,
    workspaceId: row.workspace_id,
    summary: row.summary,
    detail: row.detail ?? undefined,
    confidence: row.confidence ?? undefined,
    sourceArtifactId: row.source_artifact_id ?? undefined,
  };
}

function mapDecision(row: DecisionRow): Decision {
  const approvedBy =
    row.approved_by_actor_id !== null && row.approved_by_actor_type !== null
      ? { actorId: row.approved_by_actor_id, actorType: row.approved_by_actor_type as ActorType }
      : undefined;
  return {
    ...provenanceOf(row),
    id: row.id,
    workspaceId: row.workspace_id,
    summary: row.summary,
    rationale: row.rationale ?? undefined,
    status: row.status as DecisionStatus,
    approvedBy,
    updatedAt: row.updated_at,
  };
}

function mapArtifact(row: ArtifactRow): Artifact {
  return {
    ...provenanceOf(row),
    id: row.id,
    workspaceId: row.workspace_id,
    type: row.type as ArtifactType,
    title: row.title,
    uriOrPath: row.uri_or_path,
    metadata: parseJson(row.metadata),
  };
}

function mapContribution(row: ContributionRow): Contribution {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    actor: { actorId: row.actor_id, actorType: row.actor_type as ActorType },
    agentSessionId: row.agent_session_id ?? undefined,
    action: row.action as ContributionAction,
    objectType: row.object_type as ContributionObjectType,
    objectId: row.object_id,
    payload: parseJson(row.payload),
    createdAt: row.created_at,
  };
}

function mapActorToken(row: ActorTokenRow): ActorToken {
  return {
    id: row.id,
    actor: { actorId: row.actor_id, actorType: row.actor_type as ActorType },
    tokenHash: row.token_hash,
    createdAt: row.created_at,
    revokedAt: row.revoked_at ?? undefined,
  };
}

function mapWorkspaceInvite(row: WorkspaceInviteRow): WorkspaceInvite {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    actor: { actorId: row.actor_id, actorType: row.actor_type as ActorType },
    role: row.role as ParticipantRole,
    invitedBy: {
      actorId: row.invited_by_actor_id,
      actorType: row.invited_by_actor_type as ActorType,
    },
    createdAt: row.created_at,
    consumedAt: row.consumed_at ?? undefined,
  };
}

function createSqliteStore(db: Database.Database): CampfireStore {
  return {
    // --- identity ---
    createOrganization(organization) {
      db.prepare("INSERT INTO organizations (id, name, created_at) VALUES (?, ?, ?)").run(
        organization.id,
        organization.name,
        organization.createdAt,
      );
    },

    getOrganization(id) {
      const row = db.prepare("SELECT * FROM organizations WHERE id = ?").get(id) as OrganizationRow | undefined;
      return row ? mapOrganization(row) : undefined;
    },

    createTeam(team) {
      db.prepare("INSERT INTO teams (id, organization_id, name, created_at) VALUES (?, ?, ?, ?)").run(
        team.id,
        team.organizationId,
        team.name,
        team.createdAt,
      );
    },

    getTeam(id) {
      const row = db.prepare("SELECT * FROM teams WHERE id = ?").get(id) as TeamRow | undefined;
      return row ? mapTeam(row) : undefined;
    },

    createHuman(human) {
      db.prepare(
        "INSERT INTO humans (id, team_id, display_name, external_identity, created_at) VALUES (?, ?, ?, ?, ?)",
      ).run(human.id, human.teamId, human.displayName, human.externalIdentity ?? null, human.createdAt);
    },

    getHuman(id) {
      const row = db.prepare("SELECT * FROM humans WHERE id = ?").get(id) as HumanRow | undefined;
      return row ? mapHuman(row) : undefined;
    },

    listHumans(teamId) {
      const rows = db.prepare("SELECT * FROM humans WHERE team_id = ? ORDER BY created_at").all(teamId) as HumanRow[];
      return rows.map(mapHuman);
    },

    countHumans() {
      const row = db.prepare("SELECT COUNT(*) AS count FROM humans").get() as { count: number };
      return row.count;
    },

    createAgent(agent) {
      db.prepare(
        "INSERT INTO agents (id, team_id, human_id, name, harness, model, instance_metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        agent.id,
        agent.teamId,
        agent.humanId ?? null,
        agent.name,
        agent.harness,
        agent.model ?? null,
        agent.instanceMetadata === undefined ? null : JSON.stringify(agent.instanceMetadata),
        agent.createdAt,
      );
    },

    getAgent(id) {
      const row = db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow | undefined;
      return row ? mapAgent(row) : undefined;
    },

    listAgents(teamId) {
      const rows = db.prepare("SELECT * FROM agents WHERE team_id = ? ORDER BY created_at").all(teamId) as AgentRow[];
      return rows.map(mapAgent);
    },

    createAgentSession(session) {
      db.prepare(
        "INSERT INTO agent_sessions (id, agent_id, human_id, workspace_id, harness, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(
        session.id,
        session.agentId,
        session.humanId,
        session.workspaceId,
        session.harness,
        session.startedAt,
        session.endedAt ?? null,
      );
    },

    getAgentSession(id) {
      const row = db.prepare("SELECT * FROM agent_sessions WHERE id = ?").get(id) as AgentSessionRow | undefined;
      return row ? mapAgentSession(row) : undefined;
    },

    endAgentSession(id, endedAt) {
      db.prepare("UPDATE agent_sessions SET ended_at = ? WHERE id = ?").run(endedAt, id);
    },

    listAgentSessions(workspaceId) {
      const rows = db
        .prepare("SELECT * FROM agent_sessions WHERE workspace_id = ? ORDER BY started_at")
        .all(workspaceId) as AgentSessionRow[];
      return rows.map(mapAgentSession);
    },

    // --- workspaces ---
    createWorkspace(workspace) {
      db.prepare(
        "INSERT INTO workspaces (id, team_id, name, description, status, created_by_actor_id, created_by_actor_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        workspace.id,
        workspace.teamId,
        workspace.name,
        workspace.description ?? null,
        workspace.status,
        workspace.createdBy.actorId,
        workspace.createdBy.actorType,
        workspace.createdAt,
        workspace.updatedAt,
      );
    },

    getWorkspace(id) {
      const row = db.prepare("SELECT * FROM workspaces WHERE id = ?").get(id) as WorkspaceRow | undefined;
      return row ? mapWorkspace(row) : undefined;
    },

    updateWorkspace(id, patch) {
      const sets = ["updated_at = ?"];
      const values: unknown[] = [patch.updatedAt];
      if (patch.name !== undefined) {
        sets.push("name = ?");
        values.push(patch.name);
      }
      if (patch.description !== undefined) {
        sets.push("description = ?");
        values.push(patch.description);
      }
      if (patch.status !== undefined) {
        sets.push("status = ?");
        values.push(patch.status);
      }
      values.push(id);
      db.prepare(`UPDATE workspaces SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    },

    listWorkspaces() {
      const rows = db.prepare("SELECT * FROM workspaces ORDER BY created_at").all() as WorkspaceRow[];
      return rows.map(mapWorkspace);
    },

    listWorkspacesForActor(actor) {
      const rows = db
        .prepare(
          `SELECT w.* FROM workspaces w
           JOIN workspace_participants p ON p.workspace_id = w.id
           WHERE p.actor_id = ? AND p.actor_type = ?
           ORDER BY w.created_at`,
        )
        .all(actor.actorId, actor.actorType) as WorkspaceRow[];
      return rows.map(mapWorkspace);
    },

    addParticipant(participant) {
      db.prepare(
        "INSERT INTO workspace_participants (workspace_id, actor_id, actor_type, role, joined_at) VALUES (?, ?, ?, ?, ?)",
      ).run(
        participant.workspaceId,
        participant.actor.actorId,
        participant.actor.actorType,
        participant.role,
        participant.joinedAt,
      );
    },

    getParticipant(workspaceId, actor) {
      const row = db
        .prepare("SELECT * FROM workspace_participants WHERE workspace_id = ? AND actor_id = ? AND actor_type = ?")
        .get(workspaceId, actor.actorId, actor.actorType) as ParticipantRow | undefined;
      return row ? mapParticipant(row) : undefined;
    },

    listParticipants(workspaceId) {
      const rows = db
        .prepare("SELECT * FROM workspace_participants WHERE workspace_id = ? ORDER BY joined_at")
        .all(workspaceId) as ParticipantRow[];
      return rows.map(mapParticipant);
    },

    updateParticipantRole(workspaceId, actor, role) {
      db.prepare(
        "UPDATE workspace_participants SET role = ? WHERE workspace_id = ? AND actor_id = ? AND actor_type = ?",
      ).run(role, workspaceId, actor.actorId, actor.actorType);
    },

    // --- contribution objects ---
    createGoal(goal) {
      db.prepare(
        "INSERT INTO goals (id, workspace_id, title, description, status, created_by_actor_id, created_by_actor_type, agent_session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        goal.id,
        goal.workspaceId,
        goal.title,
        goal.description ?? null,
        goal.status,
        goal.createdBy.actorId,
        goal.createdBy.actorType,
        goal.agentSessionId ?? null,
        goal.createdAt,
        goal.updatedAt,
      );
    },

    getGoal(id) {
      const row = db.prepare("SELECT * FROM goals WHERE id = ?").get(id) as GoalRow | undefined;
      return row ? mapGoal(row) : undefined;
    },

    getGoalForWorkspace(workspaceId) {
      const active = db
        .prepare(
          `SELECT * FROM goals WHERE workspace_id = ? AND status = 'active'
           ORDER BY updated_at DESC, created_at DESC, rowid DESC LIMIT 1`,
        )
        .get(workspaceId) as GoalRow | undefined;
      if (active !== undefined) {
        return mapGoal(active);
      }
      const row = db
        .prepare(
          `SELECT * FROM goals WHERE workspace_id = ?
           ORDER BY updated_at DESC, created_at DESC, rowid DESC LIMIT 1`,
        )
        .get(workspaceId) as GoalRow | undefined;
      return row ? mapGoal(row) : undefined;
    },

    updateGoal(id, patch) {
      const sets = ["updated_at = ?"];
      const values: unknown[] = [patch.updatedAt];
      if (patch.title !== undefined) {
        sets.push("title = ?");
        values.push(patch.title);
      }
      if (patch.description !== undefined) {
        sets.push("description = ?");
        values.push(patch.description);
      }
      if (patch.status !== undefined) {
        sets.push("status = ?");
        values.push(patch.status);
      }
      values.push(id);
      db.prepare(`UPDATE goals SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    },

    createTask(task) {
      db.prepare(
        "INSERT INTO tasks (id, workspace_id, title, description, status, assignee_actor_id, assignee_actor_type, created_by_actor_id, created_by_actor_type, agent_session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        task.id,
        task.workspaceId,
        task.title,
        task.description ?? null,
        task.status,
        task.assignee?.actorId ?? null,
        task.assignee?.actorType ?? null,
        task.createdBy.actorId,
        task.createdBy.actorType,
        task.agentSessionId ?? null,
        task.createdAt,
        task.updatedAt,
      );
    },

    getTask(id) {
      const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined;
      return row ? mapTask(row) : undefined;
    },

    listTasks(workspaceId) {
      const rows = db
        .prepare("SELECT * FROM tasks WHERE workspace_id = ? ORDER BY created_at, rowid")
        .all(workspaceId) as TaskRow[];
      return rows.map(mapTask);
    },

    updateTask(id, patch) {
      const sets = ["updated_at = ?"];
      const values: unknown[] = [patch.updatedAt];
      if (patch.title !== undefined) {
        sets.push("title = ?");
        values.push(patch.title);
      }
      if (patch.description !== undefined) {
        sets.push("description = ?");
        values.push(patch.description);
      }
      if (patch.status !== undefined) {
        sets.push("status = ?");
        values.push(patch.status);
      }
      if (patch.assignee !== undefined) {
        if (patch.assignee === null) {
          sets.push("assignee_actor_id = ?", "assignee_actor_type = ?");
          values.push(null, null);
        } else {
          sets.push("assignee_actor_id = ?", "assignee_actor_type = ?");
          values.push(patch.assignee.actorId, patch.assignee.actorType);
        }
      }
      values.push(id);
      db.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    },

    createFinding(finding) {
      db.prepare(
        "INSERT INTO findings (id, workspace_id, summary, detail, confidence, source_artifact_id, created_by_actor_id, created_by_actor_type, agent_session_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        finding.id,
        finding.workspaceId,
        finding.summary,
        finding.detail ?? null,
        finding.confidence ?? null,
        finding.sourceArtifactId ?? null,
        finding.createdBy.actorId,
        finding.createdBy.actorType,
        finding.agentSessionId ?? null,
        finding.createdAt,
      );
    },

    getFinding(id) {
      const row = db.prepare("SELECT * FROM findings WHERE id = ?").get(id) as FindingRow | undefined;
      return row ? mapFinding(row) : undefined;
    },

    listFindings(workspaceId) {
      const rows = db
        .prepare("SELECT * FROM findings WHERE workspace_id = ? ORDER BY created_at, rowid")
        .all(workspaceId) as FindingRow[];
      return rows.map(mapFinding);
    },

    createDecision(decision) {
      db.prepare(
        "INSERT INTO decisions (id, workspace_id, summary, rationale, status, approved_by_actor_id, approved_by_actor_type, created_by_actor_id, created_by_actor_type, agent_session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        decision.id,
        decision.workspaceId,
        decision.summary,
        decision.rationale ?? null,
        decision.status,
        decision.approvedBy?.actorId ?? null,
        decision.approvedBy?.actorType ?? null,
        decision.createdBy.actorId,
        decision.createdBy.actorType,
        decision.agentSessionId ?? null,
        decision.createdAt,
        decision.updatedAt,
      );
    },

    getDecision(id) {
      const row = db.prepare("SELECT * FROM decisions WHERE id = ?").get(id) as DecisionRow | undefined;
      return row ? mapDecision(row) : undefined;
    },

    listDecisions(workspaceId) {
      const rows = db
        .prepare("SELECT * FROM decisions WHERE workspace_id = ? ORDER BY created_at, rowid")
        .all(workspaceId) as DecisionRow[];
      return rows.map(mapDecision);
    },

    updateDecision(id, patch) {
      const sets = ["updated_at = ?"];
      const values: unknown[] = [patch.updatedAt];
      if (patch.summary !== undefined) {
        sets.push("summary = ?");
        values.push(patch.summary);
      }
      if (patch.rationale !== undefined) {
        sets.push("rationale = ?");
        values.push(patch.rationale);
      }
      if (patch.status !== undefined) {
        sets.push("status = ?");
        values.push(patch.status);
      }
      if (patch.approvedBy !== undefined) {
        if (patch.approvedBy === null) {
          sets.push("approved_by_actor_id = ?", "approved_by_actor_type = ?");
          values.push(null, null);
        } else {
          sets.push("approved_by_actor_id = ?", "approved_by_actor_type = ?");
          values.push(patch.approvedBy.actorId, patch.approvedBy.actorType);
        }
      }
      values.push(id);
      db.prepare(`UPDATE decisions SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    },

    createArtifact(artifact) {
      db.prepare(
        "INSERT INTO artifacts (id, workspace_id, type, title, uri_or_path, metadata, created_by_actor_id, created_by_actor_type, agent_session_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        artifact.id,
        artifact.workspaceId,
        artifact.type,
        artifact.title,
        artifact.uriOrPath,
        artifact.metadata === undefined ? null : JSON.stringify(artifact.metadata),
        artifact.createdBy.actorId,
        artifact.createdBy.actorType,
        artifact.agentSessionId ?? null,
        artifact.createdAt,
      );
    },

    getArtifact(id) {
      const row = db.prepare("SELECT * FROM artifacts WHERE id = ?").get(id) as ArtifactRow | undefined;
      return row ? mapArtifact(row) : undefined;
    },

    listArtifacts(workspaceId) {
      const rows = db
        .prepare("SELECT * FROM artifacts WHERE workspace_id = ? ORDER BY created_at, rowid")
        .all(workspaceId) as ArtifactRow[];
      return rows.map(mapArtifact);
    },

    // --- activity / provenance ---
    createContribution(contribution) {
      db.prepare(
        "INSERT INTO contributions (id, workspace_id, actor_id, actor_type, agent_session_id, action, object_type, object_id, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        contribution.id,
        contribution.workspaceId,
        contribution.actor.actorId,
        contribution.actor.actorType,
        contribution.agentSessionId ?? null,
        contribution.action,
        contribution.objectType,
        contribution.objectId,
        contribution.payload === undefined ? null : JSON.stringify(contribution.payload),
        contribution.createdAt,
      );
    },

    getContribution(id) {
      const row = db.prepare("SELECT * FROM contributions WHERE id = ?").get(id) as ContributionRow | undefined;
      return row ? mapContribution(row) : undefined;
    },

    listContributions(workspaceId) {
      const rows = db
        .prepare("SELECT * FROM contributions WHERE workspace_id = ? ORDER BY created_at, rowid")
        .all(workspaceId) as ContributionRow[];
      return rows.map(mapContribution);
    },

    // --- actor tokens (hashes only) ---
    createActorToken(token) {
      db.prepare(
        "INSERT INTO actor_tokens (id, actor_id, actor_type, token_hash, created_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(
        token.id,
        token.actor.actorId,
        token.actor.actorType,
        token.tokenHash,
        token.createdAt,
        token.revokedAt ?? null,
      );
    },

    getActorTokenByHash(tokenHash) {
      const row = db
        .prepare("SELECT * FROM actor_tokens WHERE token_hash = ?")
        .get(tokenHash) as ActorTokenRow | undefined;
      return row ? mapActorToken(row) : undefined;
    },

    revokeActorToken(id, revokedAt) {
      db.prepare("UPDATE actor_tokens SET revoked_at = ? WHERE id = ?").run(revokedAt, id);
    },

    // --- workspace invites ---
    createInvite(invite) {
      db.prepare(
        "INSERT INTO workspace_invites (id, workspace_id, actor_id, actor_type, role, invited_by_actor_id, invited_by_actor_type, created_at, consumed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        invite.id,
        invite.workspaceId,
        invite.actor.actorId,
        invite.actor.actorType,
        invite.role,
        invite.invitedBy.actorId,
        invite.invitedBy.actorType,
        invite.createdAt,
        invite.consumedAt ?? null,
      );
    },

    getOpenInvite(workspaceId, actor) {
      const row = db
        .prepare(
          `SELECT * FROM workspace_invites
           WHERE workspace_id = ? AND actor_id = ? AND actor_type = ? AND consumed_at IS NULL
           ORDER BY created_at, rowid LIMIT 1`,
        )
        .get(workspaceId, actor.actorId, actor.actorType) as WorkspaceInviteRow | undefined;
      return row ? mapWorkspaceInvite(row) : undefined;
    },

    consumeInvite(id, consumedAt) {
      db.prepare("UPDATE workspace_invites SET consumed_at = ? WHERE id = ?").run(consumedAt, id);
    },

    listInvites(workspaceId) {
      const rows = db
        .prepare("SELECT * FROM workspace_invites WHERE workspace_id = ? ORDER BY created_at, rowid")
        .all(workspaceId) as WorkspaceInviteRow[];
      return rows.map(mapWorkspaceInvite);
    },

    // --- infrastructure ---
    transaction(fn) {
      return db.transaction(fn)();
    },

    close() {
      db.close();
    },
  };
}

export function openSqliteStore(databasePath: string): CampfireStore {
  const db = new Database(databasePath);
  db.pragma("foreign_keys = ON");
  if (!db.memory) {
    db.pragma("journal_mode = WAL");
  }
  applyMigrations(db);
  return createSqliteStore(db);
}

export function openInMemoryStore(): CampfireStore {
  return openSqliteStore(":memory:");
}
