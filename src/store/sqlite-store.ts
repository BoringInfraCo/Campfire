import Database from "better-sqlite3";
import { applyMigrations } from "./migrations.js";
import { issueEnrollmentStatements, revokeEnrollmentStatements, provisionEnrollmentStatements, provisionOwnedAgentStatements,
  mapEnrollmentInvitation, mapOwnedAgentEnrollment, type EnrollmentStatement, type EnrollmentInvitationRow, type OwnedAgentEnrollmentRow } from "./enrollment-sql.js";
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
import type {
  DomainEventRecord,
  WebhookDeliveryCounts,
  WebhookDeliveryRecord,
  WebhookDeliveryStatus,
} from "../domain/events.js";
import type { CampfireStore, DecisionPatch, GoalPatch, TaskPatch, WorkspacePatch } from "./store.js";
import {
  contributionsBeforeSql,
  contributionsSinceSql,
  countByStatusSql,
  countContributionsPageSql,
  countContributionsSinceSql,
  countDecisionsSql,
  countRowsSql,
  countTasksSql,
  pageArtifactsSql,
  pageContributionsSql,
  pageDecisionsSql,
  pageFindingsSql,
  pageTasksSql,
  recentContributionsSql,
  takeLimitPlusOne,
  type ObjectPage,
} from "./context-queries.js";

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
  append_position: number | bigint | string;
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

interface DomainEventRow {
  id: string;
  spec_version: string;
  type: string;
  occurred_at: string;
  workspace_id: string;
  actor_id: string;
  actor_type: string;
  subject_type: string;
  subject_id: string;
  summary: string;
  data: string;
  body: string;
  contribution_id: string;
  agent_session_id: string | null;
  on_behalf_of_actor_id: string | null;
  on_behalf_of_actor_type: string | null;
  created_at: string;
}

interface WebhookDeliveryRow {
  id: string;
  event_id: string;
  bridge_id: string;
  status: string;
  attempt_count: number;
  next_attempt_at: string | null;
  claimed_at: string | null;
  claim_token: string | null;
  last_error: string | null;
  delivered_at: string | null;
  config_fingerprint: string | null;
  created_at: string;
  updated_at: string;
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
    appendPosition: Number(row.append_position),
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

function mapDomainEvent(row: DomainEventRow): DomainEventRecord {
  const event: DomainEventRecord = {
    id: row.id,
    specVersion: row.spec_version as DomainEventRecord["specVersion"],
    type: row.type as DomainEventRecord["type"],
    occurredAt: row.occurred_at,
    workspaceId: row.workspace_id,
    actor: {
      actorId: row.actor_id,
      actorType: row.actor_type as DomainEventRecord["actor"]["actorType"],
    },
    subjectType: row.subject_type as DomainEventRecord["subjectType"],
    subjectId: row.subject_id,
    summary: row.summary,
    data: JSON.parse(row.data) as Record<string, unknown>,
    body: row.body,
    contributionId: row.contribution_id,
    createdAt: row.created_at,
  };
  if (row.agent_session_id !== null) event.agentSessionId = row.agent_session_id;
  if (row.on_behalf_of_actor_id !== null && row.on_behalf_of_actor_type !== null) {
    event.onBehalfOf = {
      actorId: row.on_behalf_of_actor_id,
      actorType: "human",
    };
  }
  return event;
}

function mapWebhookDelivery(row: WebhookDeliveryRow): WebhookDeliveryRecord {
  const delivery: WebhookDeliveryRecord = {
    id: row.id,
    eventId: row.event_id,
    bridgeId: row.bridge_id,
    status: row.status as WebhookDeliveryStatus,
    attemptCount: row.attempt_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.next_attempt_at !== null) delivery.nextAttemptAt = row.next_attempt_at;
  if (row.claimed_at !== null) delivery.claimedAt = row.claimed_at;
  if (row.claim_token !== null) delivery.claimToken = row.claim_token;
  if (row.last_error !== null) delivery.lastError = row.last_error;
  if (row.delivered_at !== null) delivery.deliveredAt = row.delivered_at;
  if (row.config_fingerprint !== null) delivery.configFingerprint = row.config_fingerprint;
  return delivery;
}

function deliveryIsClaimable(row: WebhookDeliveryRow, now: string, leaseBefore: string): boolean {
  if (row.status === "pending") {
    return row.next_attempt_at === null || row.next_attempt_at <= now;
  }
  if (row.status === "delivering") {
    return row.claimed_at !== null && row.claimed_at <= leaseBefore;
  }
  return false;
}

function emptyDeliveryCounts(): WebhookDeliveryCounts {
  return { pending: 0, delivering: 0, delivered: 0, exhausted: 0 };
}

interface RankedRow {
  id: string;
  context_rank: number | bigint | string;
  updated_at?: string | null;
  created_at?: string | null;
}

function readCount(row: { count?: number | bigint | string | null } | undefined): number {
  if (row === undefined || row.count === undefined || row.count === null) return 0;
  return Number(row.count);
}

function rankedPage<TRow extends RankedRow, T>(
  rows: readonly TRow[],
  limit: number,
  total: number,
  mapRow: (row: TRow) => T,
): ObjectPage<T> {
  const page = takeLimitPlusOne(rows, limit);
  const last = page.items[page.items.length - 1];
  return {
    items: page.items.map(mapRow),
    total,
    hasMore: page.hasMore,
    ...(page.hasMore && last
      ? { next: { rank: Number(last.context_rank), at: last.updated_at ?? last.created_at ?? "", id: last.id } }
      : {}),
  };
}

/** The inner LIMIT keeps the newest rows; chronological order puts the extra oldest row first. */
function newestChronologicalWindow<T>(rows: readonly T[], limit: number): { items: T[]; hasMore: boolean } {
  const page = takeLimitPlusOne([...rows].reverse(), limit);
  return { items: [...page.items].reverse(), hasMore: page.hasMore };
}

const CONTRIBUTION_INSERT_SQL = `INSERT INTO contributions (
  id, workspace_id, actor_id, actor_type, agent_session_id, action, object_type, object_id, payload, append_position, created_at
) VALUES (
  ?, ?, ?, ?, ?, ?, ?, ?, ?,
  (SELECT COALESCE(MAX(append_position), 0) + 1 FROM contributions WHERE workspace_id = ?),
  ?
)`;

const APPEND_POSITION_ATTEMPTS = 3;

/** Only a lost race on the per-workspace position is retried. Other constraints propagate. */
function isAppendPositionConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error && typeof error.code === "string" ? error.code : "";
  const message = "message" in error && typeof error.message === "string" ? error.message : "";
  const constraint = code.startsWith("SQLITE_CONSTRAINT") || /unique constraint failed/i.test(message);
  return constraint && (message.includes("append_position") || message.includes("idx_contributions_workspace_position"));
}

function createSqliteStore(db: Database.Database): CampfireStore {
  function contributionAnchor(
    workspaceId: string,
    contributionId: string,
  ): { occurredAt: string; rowid: number } | undefined {
    const row = db
      .prepare("SELECT rowid AS entry_rowid, workspace_id, created_at FROM contributions WHERE id = ?")
      .get(contributionId) as { entry_rowid: number; workspace_id: string; created_at: string } | undefined;
    if (row === undefined || row.workspace_id !== workspaceId) return undefined;
    return { occurredAt: row.created_at, rowid: Number(row.entry_rowid) };
  }

  function executeEnrollment(statements: EnrollmentStatement[]): boolean {
    const run = db.transaction(() => {
      let claimed = false;
      for (const [index, statement] of statements.entries()) {
        const result = db.prepare(statement.sql).run(...statement.values);
        if (index === 0) claimed = result.changes === 1;
      }
      return claimed;
    });
    for (let attempt = 0; attempt < APPEND_POSITION_ATTEMPTS; attempt += 1) {
      try {
        return run.immediate();
      } catch (error) {
        if (!isAppendPositionConflict(error) || attempt === APPEND_POSITION_ATTEMPTS - 1) throw error;
      }
    }
    return false;
  }
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
      const params = [
        contribution.id,
        contribution.workspaceId,
        contribution.actor.actorId,
        contribution.actor.actorType,
        contribution.agentSessionId ?? null,
        contribution.action,
        contribution.objectType,
        contribution.objectId,
        contribution.payload === undefined ? null : JSON.stringify(contribution.payload),
        contribution.workspaceId,
        contribution.createdAt,
      ];
      // The position subquery runs with the insert, including inside a transaction.
      // A JavaScript read would be wrong under D1, and a unique collision is retried.
      const insert = db.prepare(CONTRIBUTION_INSERT_SQL);
      for (let attempt = 0; attempt < APPEND_POSITION_ATTEMPTS; attempt += 1) {
        try {
          insert.run(...params);
          return;
        } catch (error) {
          if (!isAppendPositionConflict(error) || attempt === APPEND_POSITION_ATTEMPTS - 1) throw error;
        }
      }
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

    maxAppendPosition(workspaceId) {
      const row = db
        .prepare(
          "SELECT COALESCE(MAX(append_position), 0) AS append_position FROM contributions WHERE workspace_id = ?",
        )
        .get(workspaceId) as { append_position: number | bigint | string | null } | undefined;
      return Number(row?.append_position ?? 0);
    },

    countObjectsByStatus(kind, workspaceId) {
      const statement = countByStatusSql(kind, workspaceId);
      const rows = db.prepare(statement.sql).all(...statement.params) as Array<{ status: string; count: number | bigint | string }>;
      return rows.map((row) => ({ status: row.status, count: Number(row.count) }));
    },

    countObjects(kind, workspaceId) {
      const statement = countRowsSql(kind, workspaceId);
      return readCount(db.prepare(statement.sql).get(...statement.params) as { count: number } | undefined);
    },

    pageDecisions(workspaceId, query) {
      const listed = pageDecisionsSql(workspaceId, query);
      const counted = countDecisionsSql(workspaceId, query.statuses);
      const rows = db.prepare(listed.sql).all(...listed.params) as Array<DecisionRow & RankedRow>;
      const total = readCount(db.prepare(counted.sql).get(...counted.params) as { count: number } | undefined);
      return rankedPage(rows, query.limit, total, mapDecision);
    },

    countDecisions(workspaceId, statuses) {
      const statement = countDecisionsSql(workspaceId, statuses);
      return readCount(db.prepare(statement.sql).get(...statement.params) as { count: number } | undefined);
    },

    pageTasks(workspaceId, query) {
      const listed = pageTasksSql(workspaceId, query);
      const counted = countTasksSql(workspaceId, query.statuses);
      const rows = db.prepare(listed.sql).all(...listed.params) as Array<TaskRow & RankedRow>;
      const total = readCount(db.prepare(counted.sql).get(...counted.params) as { count: number } | undefined);
      return rankedPage(rows, query.limit, total, mapTask);
    },

    countTasks(workspaceId, statuses) {
      const statement = countTasksSql(workspaceId, statuses);
      return readCount(db.prepare(statement.sql).get(...statement.params) as { count: number } | undefined);
    },

    pageFindings(workspaceId, query) {
      const listed = pageFindingsSql(workspaceId, query);
      const counted = countRowsSql("findings", workspaceId);
      const rows = db.prepare(listed.sql).all(...listed.params) as Array<FindingRow & RankedRow>;
      const total = readCount(db.prepare(counted.sql).get(...counted.params) as { count: number } | undefined);
      return rankedPage(rows, query.limit, total, mapFinding);
    },

    pageArtifacts(workspaceId, query) {
      const listed = pageArtifactsSql(workspaceId, query);
      const counted = countRowsSql("artifacts", workspaceId);
      const rows = db.prepare(listed.sql).all(...listed.params) as Array<ArtifactRow & RankedRow>;
      const total = readCount(db.prepare(counted.sql).get(...counted.params) as { count: number } | undefined);
      return rankedPage(rows, query.limit, total, mapArtifact);
    },

    pageContributions(workspaceId, query) {
      const listed = pageContributionsSql(workspaceId, query);
      const counted = countContributionsPageSql(workspaceId, query);
      const rows = db.prepare(listed.sql).all(...listed.params) as ContributionRow[];
      const total = readCount(db.prepare(counted.sql).get(...counted.params) as { count: number } | undefined);
      const page = takeLimitPlusOne(rows, query.limit);
      const last = page.items[page.items.length - 1];
      return {
        items: page.items.map(mapContribution),
        total,
        hasMore: page.hasMore,
        ...(page.hasMore && last ? { next: { rank: 0, at: last.created_at, id: last.id } } : {}),
      };
    },

    listRecentContributionWindow(workspaceId, limit) {
      const listed = recentContributionsSql(workspaceId, limit);
      const rows = db.prepare(listed.sql).all(...listed.params) as ContributionRow[];
      const total = this.countObjects("contributions", workspaceId);
      return { items: rows.map(mapContribution), total, hasMore: total > rows.length };
    },

    listContributionsSince(workspaceId, contributionId, limit) {
      const anchor = contributionAnchor(workspaceId, contributionId);
      if (anchor === undefined) return { found: false, items: [], total: 0, hasMore: false };
      const listed = contributionsSinceSql(workspaceId, anchor, limit);
      const counted = countContributionsSinceSql(workspaceId, anchor);
      const rows = db.prepare(listed.sql).all(...listed.params) as ContributionRow[];
      const total = readCount(db.prepare(counted.sql).get(...counted.params) as { count: number } | undefined);
      const page = newestChronologicalWindow(rows, limit);
      return { found: true, items: page.items.map(mapContribution), total, hasMore: page.hasMore };
    },

    listContributionsBefore(workspaceId, contributionId, limit) {
      const anchor = contributionAnchor(workspaceId, contributionId);
      if (anchor === undefined) return { found: false, items: [], total: 0, hasMore: false };
      const listed = contributionsBeforeSql(workspaceId, anchor, limit);
      const rows = db.prepare(listed.sql).all(...listed.params) as ContributionRow[];
      const total = this.countObjects("contributions", workspaceId);
      const page = newestChronologicalWindow(rows, limit);
      return { found: true, items: page.items.map(mapContribution), total, hasMore: page.hasMore };
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

    createEnrollmentInvitation(invitation, contribution) {
      return executeEnrollment(issueEnrollmentStatements(invitation, contribution, globalThis.crypto.randomUUID()));
    },
    getEnrollmentInvitation(id) {
      const row = db.prepare("SELECT * FROM enrollment_invitations WHERE id = ?").get(id) as EnrollmentInvitationRow | undefined;
      return row === undefined ? undefined : mapEnrollmentInvitation(row);
    },
    getEnrollmentInvitationByHash(secretHash) {
      const row = db.prepare("SELECT * FROM enrollment_invitations WHERE secret_hash = ?").get(secretHash) as EnrollmentInvitationRow | undefined;
      return row === undefined ? undefined : mapEnrollmentInvitation(row);
    },
    revokeEnrollmentInvitation(input) {
      return executeEnrollment(revokeEnrollmentStatements(input, globalThis.crypto.randomUUID()));
    },
    provisionEnrollment(plan) {
      return executeEnrollment(provisionEnrollmentStatements(plan, globalThis.crypto.randomUUID()));
    },
    getOwnedAgentEnrollment(workspaceId, humanId, harness) {
      const row = db.prepare("SELECT * FROM managed_agent_slots WHERE workspace_id = ? AND human_id = ? AND harness = ?")
        .get(workspaceId, humanId, harness) as OwnedAgentEnrollmentRow | undefined;
      return row === undefined ? undefined : mapOwnedAgentEnrollment(row);
    },
    provisionOwnedAgent(plan) {
      return executeEnrollment(provisionOwnedAgentStatements(plan, globalThis.crypto.randomUUID()));
    },

    // --- domain events ---
    createDomainEvent(event) {
      db.prepare(
        "INSERT INTO domain_events (id, spec_version, type, occurred_at, workspace_id, actor_id, actor_type, subject_type, subject_id, summary, data, body, contribution_id, agent_session_id, on_behalf_of_actor_id, on_behalf_of_actor_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        event.id,
        event.specVersion,
        event.type,
        event.occurredAt,
        event.workspaceId,
        event.actor.actorId,
        event.actor.actorType,
        event.subjectType,
        event.subjectId,
        event.summary,
        JSON.stringify(event.data),
        event.body,
        event.contributionId,
        event.agentSessionId ?? null,
        event.onBehalfOf?.actorId ?? null,
        event.onBehalfOf?.actorType ?? null,
        event.createdAt,
      );
    },

    getDomainEvent(id) {
      const row = db.prepare("SELECT * FROM domain_events WHERE id = ?").get(id) as DomainEventRow | undefined;
      return row ? mapDomainEvent(row) : undefined;
    },

    listDomainEventsForWorkspace(workspaceId) {
      const rows = db
        .prepare("SELECT * FROM domain_events WHERE workspace_id = ? ORDER BY occurred_at, rowid")
        .all(workspaceId) as DomainEventRow[];
      return rows.map(mapDomainEvent);
    },

    // Operational delivery state, not Contributions.
    createWebhookDelivery(delivery) {
      db.prepare(
        "INSERT INTO webhook_deliveries (id, event_id, bridge_id, status, attempt_count, next_attempt_at, claimed_at, claim_token, last_error, delivered_at, config_fingerprint, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        delivery.id,
        delivery.eventId,
        delivery.bridgeId,
        delivery.status,
        delivery.attemptCount,
        delivery.nextAttemptAt ?? null,
        delivery.claimedAt ?? null,
        delivery.claimToken ?? null,
        delivery.lastError ?? null,
        delivery.deliveredAt ?? null,
        delivery.configFingerprint ?? null,
        delivery.createdAt,
        delivery.updatedAt,
      );
    },

    getWebhookDelivery(id) {
      const row = db.prepare("SELECT * FROM webhook_deliveries WHERE id = ?").get(id) as
        | WebhookDeliveryRow
        | undefined;
      return row ? mapWebhookDelivery(row) : undefined;
    },

    listWebhookDeliveries() {
      const rows = db
        .prepare("SELECT * FROM webhook_deliveries ORDER BY created_at, rowid")
        .all() as WebhookDeliveryRow[];
      return rows.map(mapWebhookDelivery);
    },

    countWebhookDeliveries() {
      const rows = db
        .prepare("SELECT status, COUNT(*) AS count FROM webhook_deliveries GROUP BY status")
        .all() as Array<{ status: string; count: number }>;
      const counts = emptyDeliveryCounts();
      for (const row of rows) {
        if (
          row.status === "pending" ||
          row.status === "delivering" ||
          row.status === "delivered" ||
          row.status === "exhausted"
        ) {
          counts[row.status] = row.count;
        }
      }
      return counts;
    },

    listDueWebhookDeliveries(input) {
      const rows = db
        .prepare(
          `SELECT * FROM webhook_deliveries
           WHERE bridge_id = ?
             AND config_fingerprint = ?
             AND (
               (status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
               OR (status = 'delivering' AND claimed_at IS NOT NULL AND claimed_at <= ?)
             )
           ORDER BY created_at, rowid`,
        )
        .all(input.bridgeId, input.configFingerprint, input.now, input.leaseBefore) as WebhookDeliveryRow[];
      return rows.map(mapWebhookDelivery);
    },

    claimWebhookDelivery(id, input) {
      const claim = db.transaction(() => {
        const row = db.prepare("SELECT * FROM webhook_deliveries WHERE id = ?").get(id) as
          | WebhookDeliveryRow
          | undefined;
        if (
          row === undefined ||
          row.config_fingerprint !== input.configFingerprint ||
          !deliveryIsClaimable(row, input.now, input.leaseBefore)
        ) {
          return undefined;
        }
        const info = db
          .prepare(
            `UPDATE webhook_deliveries
             SET status = 'delivering', claim_token = ?, claimed_at = ?, updated_at = ?
             WHERE id = ? AND claim_token IS NOT DISTINCT FROM ?
               AND config_fingerprint = ?`,
          )
          .run(input.claimToken, input.now, input.now, id, row.claim_token, input.configFingerprint);
        if (info.changes !== 1) return undefined;
        const updated = db.prepare("SELECT * FROM webhook_deliveries WHERE id = ?").get(id) as
          | WebhookDeliveryRow
          | undefined;
        return updated ? mapWebhookDelivery(updated) : undefined;
      });
      return claim();
    },

    markWebhookDeliveryDelivered(id, claimToken, deliveredAt) {
      const info = db
        .prepare(
          `UPDATE webhook_deliveries
           SET status = 'delivered', delivered_at = ?, attempt_count = attempt_count + 1,
               claim_token = NULL, next_attempt_at = NULL, last_error = NULL, updated_at = ?
           WHERE id = ? AND claim_token = ? AND status = 'delivering'`,
        )
        .run(deliveredAt, deliveredAt, id, claimToken);
      return info.changes === 1;
    },

    markWebhookDeliveryRetry(id, claimToken, input) {
      const info = db
        .prepare(
          `UPDATE webhook_deliveries
           SET status = ?, attempt_count = ?, next_attempt_at = ?, last_error = ?,
               claim_token = NULL, claimed_at = NULL, updated_at = ?
           WHERE id = ? AND claim_token = ? AND status = 'delivering'`,
        )
        .run(
          input.status,
          input.attemptCount,
          input.status === "exhausted" ? null : (input.nextAttemptAt ?? null),
          input.lastError ?? null,
          input.updatedAt,
          id,
          claimToken,
        );
      return info.changes === 1;
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

export interface SqliteStoreOptions {
  observeQuery?: (sql: string) => void;
}

export function openSqliteStore(databasePath: string, options?: SqliteStoreOptions): CampfireStore {
  const db = new Database(databasePath);
  db.pragma("foreign_keys = ON");
  if (!db.memory) {
    db.pragma("journal_mode = WAL");
  }
  applyMigrations(db);
  if (options?.observeQuery !== undefined) {
    const observeQuery = options.observeQuery;
    const prepare = db.prepare.bind(db);
    db.prepare = ((sql: string) => {
      observeQuery(sql);
      return prepare(sql);
    }) as Database.Database["prepare"];
  }
  return createSqliteStore(db);
}

export function openInMemoryStore(options?: SqliteStoreOptions): CampfireStore {
  return openSqliteStore(":memory:", options);
}

/** Read-only open for operator inspection. Does not migrate or take the write lock. */
export function openReadonlySqliteStore(databasePath: string): CampfireStore {
  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  return createSqliteStore(db);
}
