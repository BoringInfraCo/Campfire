/**
 * D1 implementation of the CampfireStore boundary.
 *
 * Async counterpart to `src/store/sqlite-store.ts` (better-sqlite3, sync).
 * Same tables/columns/ordering, same mapping semantics; only the driver
 * differs (`env.DB.prepare/bind/all/run/batch/exec`). The local SQLite path
 * is untouched — D1 lives alongside it for Workers.
 *
 * Layering (AGENTS.md invariant 7): domain/service depend on the store
 * boundary, never on D1 details. No new domain entities.
 */
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
  CampfireStore,
  DecisionPatch,
  GoalPatch,
  TaskPatch,
  WorkspacePatch,
} from "../store/store.js";
import type {
  DomainEventRecord,
  WebhookDeliveryCounts,
  WebhookDeliveryRecord,
  WebhookDeliveryStatus,
} from "../domain/events.js";
import type { D1Database, D1PreparedStatement } from "./d1-types.js";
import { CAMPFIRE_D1_SCHEMA_SQL } from "./schema.js";
import { issueEnrollmentStatements, revokeEnrollmentStatements, provisionEnrollmentStatements, provisionOwnedAgentStatements,
  mapEnrollmentInvitation, mapOwnedAgentEnrollment, type EnrollmentStatement, type EnrollmentInvitationRow, type OwnedAgentEnrollmentRow } from "../store/enrollment-sql.js";

/** Async mirror of `CampfireStore`: identical shape, Promise returns. */
export type AsyncCampfireStore = Omit<
  {
    [K in keyof CampfireStore]: CampfireStore[K] extends (...args: infer A) => infer R
      ? (...args: A) => Promise<Awaited<R>>
      : never;
  },
  "transaction" | "close"
> & {
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

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

/** Apply the Campfire schema to a D1 database (idempotent). */
export async function migrateD1(db: D1Database): Promise<void> {
  await db.exec(CAMPFIRE_D1_SCHEMA_SQL);
}

export function createD1Store(db: D1Database): AsyncCampfireStore {
  let txnDepth = 0;
  let dirty = false;
  // Batch commits the state change, Contribution, and domain event atomically; no network inside the transaction.
  const buffered: D1PreparedStatement[] = [];

  function assertReadable(): void {
    if (txnDepth > 0 && dirty) {
      throw new Error("D1 transaction cannot read uncommitted writes");
    }
  }

  async function first<T>(query: string, ...params: unknown[]): Promise<T | undefined> {
    assertReadable();
    const row = await db.prepare(query).bind(...params).first<T>();
    return row ?? undefined;
  }

  async function all<T>(query: string, ...params: unknown[]): Promise<T[]> {
    assertReadable();
    const result = await db.prepare(query).bind(...params).all<T>();
    return result.results;
  }

  async function run(
    query: string,
    ...params: unknown[]
  ): Promise<{ success: boolean; meta?: { changes?: number } }> {
    const statement = db.prepare(query).bind(...params);
    if (txnDepth > 0) {
      buffered.push(statement);
      dirty = true;
      return { success: true };
    }
    return statement.run();
  }

  async function runNow(
    query: string,
    ...params: unknown[]
  ): Promise<{ success: boolean; meta?: { changes?: number } }> {
    return db.prepare(query).bind(...params).run();
  }

  async function executeEnrollment(statements: EnrollmentStatement[]): Promise<boolean> {
    // This operation owns its complete atomic batch. Letting an outer buffer
    // defer it would break its claim result and could split administrative state.
    if (txnDepth !== 0) throw new Error("Enrollment provisioning cannot nest inside a buffered D1 transaction");
    const results = await db.batch(statements.map((statement) => db.prepare(statement.sql).bind(...statement.values)));
    const claim = results[0] as { success?: boolean; meta?: { changes?: number } } | undefined;
    if (claim?.success !== true) throw new Error("Enrollment persistence failed");
    return claim.meta?.changes === 1;
  }

  return {
    async createOrganization(organization) {
      await run("INSERT INTO organizations (id, name, created_at) VALUES (?, ?, ?)",
        organization.id, organization.name, organization.createdAt);
    },

    async getOrganization(id) {
      const row = await first<OrganizationRow>("SELECT * FROM organizations WHERE id = ?", id);
      return row ? mapOrganization(row) : undefined;
    },

    async createTeam(team) {
      await run("INSERT INTO teams (id, organization_id, name, created_at) VALUES (?, ?, ?, ?)",
        team.id, team.organizationId, team.name, team.createdAt);
    },

    async getTeam(id) {
      const row = await first<TeamRow>("SELECT * FROM teams WHERE id = ?", id);
      return row ? mapTeam(row) : undefined;
    },

    async createHuman(human) {
      await run(
        "INSERT INTO humans (id, team_id, display_name, external_identity, created_at) VALUES (?, ?, ?, ?, ?)",
        human.id, human.teamId, human.displayName, human.externalIdentity ?? null, human.createdAt);
    },

    async getHuman(id) {
      const row = await first<HumanRow>("SELECT * FROM humans WHERE id = ?", id);
      return row ? mapHuman(row) : undefined;
    },

    async listHumans(teamId) {
      return (await all<HumanRow>("SELECT * FROM humans WHERE team_id = ? ORDER BY created_at", teamId)).map(mapHuman);
    },

    async countHumans() {
      const row = await first<{ count: number }>("SELECT COUNT(*) AS count FROM humans");
      return row?.count ?? 0;
    },

    async createAgent(agent) {
      await run(
        "INSERT INTO agents (id, team_id, human_id, name, harness, model, instance_metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        agent.id, agent.teamId, agent.humanId ?? null, agent.name, agent.harness,
        agent.model ?? null,
        agent.instanceMetadata === undefined ? null : JSON.stringify(agent.instanceMetadata),
        agent.createdAt);
    },

    async getAgent(id) {
      const row = await first<AgentRow>("SELECT * FROM agents WHERE id = ?", id);
      return row ? mapAgent(row) : undefined;
    },

    async listAgents(teamId) {
      return (await all<AgentRow>("SELECT * FROM agents WHERE team_id = ? ORDER BY created_at", teamId)).map(mapAgent);
    },

    async createAgentSession(session) {
      await run(
        "INSERT INTO agent_sessions (id, agent_id, human_id, workspace_id, harness, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        session.id, session.agentId, session.humanId, session.workspaceId,
        session.harness, session.startedAt, session.endedAt ?? null);
    },

    async getAgentSession(id) {
      const row = await first<AgentSessionRow>("SELECT * FROM agent_sessions WHERE id = ?", id);
      return row ? mapAgentSession(row) : undefined;
    },

    async endAgentSession(id, endedAt) {
      await run("UPDATE agent_sessions SET ended_at = ? WHERE id = ?", endedAt, id);
    },

    async listAgentSessions(workspaceId) {
      return (await all<AgentSessionRow>(
        "SELECT * FROM agent_sessions WHERE workspace_id = ? ORDER BY started_at", workspaceId)).map(mapAgentSession);
    },

    async createWorkspace(workspace) {
      await run(
        "INSERT INTO workspaces (id, team_id, name, description, status, created_by_actor_id, created_by_actor_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        workspace.id, workspace.teamId, workspace.name, workspace.description ?? null,
        workspace.status, workspace.createdBy.actorId, workspace.createdBy.actorType,
        workspace.createdAt, workspace.updatedAt);
    },

    async getWorkspace(id) {
      const row = await first<WorkspaceRow>("SELECT * FROM workspaces WHERE id = ?", id);
      return row ? mapWorkspace(row) : undefined;
    },

    async updateWorkspace(id, patch: WorkspacePatch) {
      const sets = ["updated_at = ?"];
      const values: unknown[] = [patch.updatedAt];
      if (patch.name !== undefined) { sets.push("name = ?"); values.push(patch.name); }
      if (patch.description !== undefined) { sets.push("description = ?"); values.push(patch.description); }
      if (patch.status !== undefined) { sets.push("status = ?"); values.push(patch.status); }
      values.push(id);
      await run(`UPDATE workspaces SET ${sets.join(", ")} WHERE id = ?`, ...values);
    },

    async listWorkspaces() {
      return (await all<WorkspaceRow>("SELECT * FROM workspaces ORDER BY created_at")).map(mapWorkspace);
    },

    async listWorkspacesForActor(actor) {
      return (await all<WorkspaceRow>(
        `SELECT w.* FROM workspaces w
         JOIN workspace_participants p ON p.workspace_id = w.id
         WHERE p.actor_id = ? AND p.actor_type = ?
         ORDER BY w.created_at`,
        actor.actorId, actor.actorType)).map(mapWorkspace);
    },

    async addParticipant(participant) {
      await run(
        "INSERT INTO workspace_participants (workspace_id, actor_id, actor_type, role, joined_at) VALUES (?, ?, ?, ?, ?)",
        participant.workspaceId, participant.actor.actorId, participant.actor.actorType,
        participant.role, participant.joinedAt);
    },

    async getParticipant(workspaceId, actor) {
      const row = await first<ParticipantRow>(
        "SELECT * FROM workspace_participants WHERE workspace_id = ? AND actor_id = ? AND actor_type = ?",
        workspaceId, actor.actorId, actor.actorType);
      return row ? mapParticipant(row) : undefined;
    },

    async listParticipants(workspaceId) {
      return (await all<ParticipantRow>(
        "SELECT * FROM workspace_participants WHERE workspace_id = ? ORDER BY joined_at", workspaceId)).map(mapParticipant);
    },

    async updateParticipantRole(workspaceId, actor, role) {
      await run(
        "UPDATE workspace_participants SET role = ? WHERE workspace_id = ? AND actor_id = ? AND actor_type = ?",
        role, workspaceId, actor.actorId, actor.actorType);
    },

    async createGoal(goal) {
      await run(
        "INSERT INTO goals (id, workspace_id, title, description, status, created_by_actor_id, created_by_actor_type, agent_session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        goal.id, goal.workspaceId, goal.title, goal.description ?? null, goal.status,
        goal.createdBy.actorId, goal.createdBy.actorType, goal.agentSessionId ?? null,
        goal.createdAt, goal.updatedAt);
    },

    async getGoal(id) {
      const row = await first<GoalRow>("SELECT * FROM goals WHERE id = ?", id);
      return row ? mapGoal(row) : undefined;
    },

    async getGoalForWorkspace(workspaceId) {
      const active = await first<GoalRow>(
        `SELECT * FROM goals WHERE workspace_id = ? AND status = 'active'
         ORDER BY updated_at DESC, created_at DESC, rowid DESC LIMIT 1`, workspaceId);
      if (active !== undefined) return mapGoal(active);
      const row = await first<GoalRow>(
        `SELECT * FROM goals WHERE workspace_id = ?
         ORDER BY updated_at DESC, created_at DESC, rowid DESC LIMIT 1`, workspaceId);
      return row ? mapGoal(row) : undefined;
    },

    async updateGoal(id, patch: GoalPatch) {
      const sets = ["updated_at = ?"];
      const values: unknown[] = [patch.updatedAt];
      if (patch.title !== undefined) { sets.push("title = ?"); values.push(patch.title); }
      if (patch.description !== undefined) { sets.push("description = ?"); values.push(patch.description); }
      if (patch.status !== undefined) { sets.push("status = ?"); values.push(patch.status); }
      values.push(id);
      await run(`UPDATE goals SET ${sets.join(", ")} WHERE id = ?`, ...values);
    },

    async createTask(task) {
      await run(
        "INSERT INTO tasks (id, workspace_id, title, description, status, assignee_actor_id, assignee_actor_type, created_by_actor_id, created_by_actor_type, agent_session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        task.id, task.workspaceId, task.title, task.description ?? null, task.status,
        task.assignee?.actorId ?? null, task.assignee?.actorType ?? null,
        task.createdBy.actorId, task.createdBy.actorType, task.agentSessionId ?? null,
        task.createdAt, task.updatedAt);
    },

    async getTask(id) {
      const row = await first<TaskRow>("SELECT * FROM tasks WHERE id = ?", id);
      return row ? mapTask(row) : undefined;
    },

    async listTasks(workspaceId) {
      return (await all<TaskRow>(
        "SELECT * FROM tasks WHERE workspace_id = ? ORDER BY created_at, rowid", workspaceId)).map(mapTask);
    },

    async updateTask(id, patch: TaskPatch) {
      const sets = ["updated_at = ?"];
      const values: unknown[] = [patch.updatedAt];
      if (patch.title !== undefined) { sets.push("title = ?"); values.push(patch.title); }
      if (patch.description !== undefined) { sets.push("description = ?"); values.push(patch.description); }
      if (patch.status !== undefined) { sets.push("status = ?"); values.push(patch.status); }
      if (patch.assignee !== undefined) {
        sets.push("assignee_actor_id = ?", "assignee_actor_type = ?");
        if (patch.assignee === null) values.push(null, null);
        else values.push(patch.assignee.actorId, patch.assignee.actorType);
      }
      values.push(id);
      await run(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`, ...values);
    },

    async createFinding(finding) {
      await run(
        "INSERT INTO findings (id, workspace_id, summary, detail, confidence, source_artifact_id, created_by_actor_id, created_by_actor_type, agent_session_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        finding.id, finding.workspaceId, finding.summary, finding.detail ?? null,
        finding.confidence ?? null, finding.sourceArtifactId ?? null,
        finding.createdBy.actorId, finding.createdBy.actorType,
        finding.agentSessionId ?? null, finding.createdAt);
    },

    async getFinding(id) {
      const row = await first<FindingRow>("SELECT * FROM findings WHERE id = ?", id);
      return row ? mapFinding(row) : undefined;
    },

    async listFindings(workspaceId) {
      return (await all<FindingRow>(
        "SELECT * FROM findings WHERE workspace_id = ? ORDER BY created_at, rowid", workspaceId)).map(mapFinding);
    },

    async createDecision(decision) {
      await run(
        "INSERT INTO decisions (id, workspace_id, summary, rationale, status, approved_by_actor_id, approved_by_actor_type, created_by_actor_id, created_by_actor_type, agent_session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        decision.id, decision.workspaceId, decision.summary, decision.rationale ?? null,
        decision.status, decision.approvedBy?.actorId ?? null, decision.approvedBy?.actorType ?? null,
        decision.createdBy.actorId, decision.createdBy.actorType,
        decision.agentSessionId ?? null, decision.createdAt, decision.updatedAt);
    },

    async getDecision(id) {
      const row = await first<DecisionRow>("SELECT * FROM decisions WHERE id = ?", id);
      return row ? mapDecision(row) : undefined;
    },

    async listDecisions(workspaceId) {
      return (await all<DecisionRow>(
        "SELECT * FROM decisions WHERE workspace_id = ? ORDER BY created_at, rowid", workspaceId)).map(mapDecision);
    },

    async updateDecision(id, patch) {
      const sets = ["updated_at = ?"];
      const values: unknown[] = [patch.updatedAt];
      if (patch.summary !== undefined) { sets.push("summary = ?"); values.push(patch.summary); }
      if (patch.rationale !== undefined) { sets.push("rationale = ?"); values.push(patch.rationale); }
      if (patch.status !== undefined) { sets.push("status = ?"); values.push(patch.status); }
      if (patch.approvedBy !== undefined) {
        sets.push("approved_by_actor_id = ?", "approved_by_actor_type = ?");
        if (patch.approvedBy === null) values.push(null, null);
        else values.push(patch.approvedBy.actorId, patch.approvedBy.actorType);
      }
      values.push(id);
      await run(`UPDATE decisions SET ${sets.join(", ")} WHERE id = ?`, ...values);
    },

    async createArtifact(artifact) {
      await run(
        "INSERT INTO artifacts (id, workspace_id, type, title, uri_or_path, metadata, created_by_actor_id, created_by_actor_type, agent_session_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        artifact.id, artifact.workspaceId, artifact.type, artifact.title, artifact.uriOrPath,
        artifact.metadata === undefined ? null : JSON.stringify(artifact.metadata),
        artifact.createdBy.actorId, artifact.createdBy.actorType,
        artifact.agentSessionId ?? null, artifact.createdAt);
    },

    async getArtifact(id) {
      const row = await first<ArtifactRow>("SELECT * FROM artifacts WHERE id = ?", id);
      return row ? mapArtifact(row) : undefined;
    },

    async listArtifacts(workspaceId) {
      return (await all<ArtifactRow>(
        "SELECT * FROM artifacts WHERE workspace_id = ? ORDER BY created_at, rowid", workspaceId)).map(mapArtifact);
    },

    async createContribution(contribution) {
      await run(
        "INSERT INTO contributions (id, workspace_id, actor_id, actor_type, agent_session_id, action, object_type, object_id, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        contribution.id, contribution.workspaceId, contribution.actor.actorId,
        contribution.actor.actorType, contribution.agentSessionId ?? null,
        contribution.action, contribution.objectType, contribution.objectId,
        contribution.payload === undefined ? null : JSON.stringify(contribution.payload),
        contribution.createdAt);
    },

    async getContribution(id) {
      const row = await first<ContributionRow>("SELECT * FROM contributions WHERE id = ?", id);
      return row ? mapContribution(row) : undefined;
    },

    async listContributions(workspaceId) {
      return (await all<ContributionRow>(
        "SELECT * FROM contributions WHERE workspace_id = ? ORDER BY created_at, rowid", workspaceId)).map(mapContribution);
    },

    async createActorToken(token) {
      await run(
        "INSERT INTO actor_tokens (id, actor_id, actor_type, token_hash, created_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?)",
        token.id, token.actor.actorId, token.actor.actorType,
        token.tokenHash, token.createdAt, token.revokedAt ?? null);
    },

    async getActorTokenByHash(tokenHash) {
      const row = await first<ActorTokenRow>(
        "SELECT * FROM actor_tokens WHERE token_hash = ?", tokenHash);
      return row ? mapActorToken(row) : undefined;
    },

    async revokeActorToken(id, revokedAt) {
      await run("UPDATE actor_tokens SET revoked_at = ? WHERE id = ?", revokedAt, id);
    },

    async createInvite(invite) {
      await run(
        "INSERT INTO workspace_invites (id, workspace_id, actor_id, actor_type, role, invited_by_actor_id, invited_by_actor_type, created_at, consumed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        invite.id, invite.workspaceId, invite.actor.actorId, invite.actor.actorType,
        invite.role, invite.invitedBy.actorId, invite.invitedBy.actorType,
        invite.createdAt, invite.consumedAt ?? null);
    },

    async getOpenInvite(workspaceId, actor) {
      const row = await first<WorkspaceInviteRow>(
        `SELECT * FROM workspace_invites
         WHERE workspace_id = ? AND actor_id = ? AND actor_type = ? AND consumed_at IS NULL
         ORDER BY created_at, rowid LIMIT 1`,
        workspaceId, actor.actorId, actor.actorType);
      return row ? mapWorkspaceInvite(row) : undefined;
    },

    async consumeInvite(id, consumedAt) {
      await run("UPDATE workspace_invites SET consumed_at = ? WHERE id = ?", consumedAt, id);
    },

    async listInvites(workspaceId) {
      return (await all<WorkspaceInviteRow>(
        "SELECT * FROM workspace_invites WHERE workspace_id = ? ORDER BY created_at, rowid", workspaceId)).map(mapWorkspaceInvite);
    },

    async createEnrollmentInvitation(invitation, contribution) {
      return executeEnrollment(issueEnrollmentStatements(invitation, contribution, globalThis.crypto.randomUUID()));
    },
    async getEnrollmentInvitation(id) {
      const row = await first<EnrollmentInvitationRow>("SELECT * FROM enrollment_invitations WHERE id = ?", id);
      return row === undefined ? undefined : mapEnrollmentInvitation(row);
    },
    async getEnrollmentInvitationByHash(secretHash) {
      const row = await first<EnrollmentInvitationRow>("SELECT * FROM enrollment_invitations WHERE secret_hash = ?", secretHash);
      return row === undefined ? undefined : mapEnrollmentInvitation(row);
    },
    async revokeEnrollmentInvitation(input) {
      return executeEnrollment(revokeEnrollmentStatements(input, globalThis.crypto.randomUUID()));
    },
    async provisionEnrollment(plan) {
      return executeEnrollment(provisionEnrollmentStatements(plan, globalThis.crypto.randomUUID()));
    },
    async getOwnedAgentEnrollment(workspaceId, humanId, harness) {
      const row = await first<OwnedAgentEnrollmentRow>("SELECT * FROM managed_agent_slots WHERE workspace_id = ? AND human_id = ? AND harness = ?", workspaceId, humanId, harness);
      return row === undefined ? undefined : mapOwnedAgentEnrollment(row);
    },
    async provisionOwnedAgent(plan) {
      return executeEnrollment(provisionOwnedAgentStatements(plan, globalThis.crypto.randomUUID()));
    },

    async createDomainEvent(event) {
      await run(
        "INSERT INTO domain_events (id, spec_version, type, occurred_at, workspace_id, actor_id, actor_type, subject_type, subject_id, summary, data, body, contribution_id, agent_session_id, on_behalf_of_actor_id, on_behalf_of_actor_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        event.id, event.specVersion, event.type, event.occurredAt, event.workspaceId,
        event.actor.actorId, event.actor.actorType, event.subjectType, event.subjectId,
        event.summary, JSON.stringify(event.data), event.body, event.contributionId,
        event.agentSessionId ?? null, event.onBehalfOf?.actorId ?? null,
        event.onBehalfOf?.actorType ?? null, event.createdAt);
    },

    async getDomainEvent(id) {
      const row = await first<DomainEventRow>("SELECT * FROM domain_events WHERE id = ?", id);
      return row ? mapDomainEvent(row) : undefined;
    },

    async listDomainEventsForWorkspace(workspaceId) {
      return (await all<DomainEventRow>(
        "SELECT * FROM domain_events WHERE workspace_id = ? ORDER BY occurred_at, rowid", workspaceId)).map(mapDomainEvent);
    },

    // Operational delivery state, not Contributions.
    async createWebhookDelivery(delivery) {
      await run(
        "INSERT INTO webhook_deliveries (id, event_id, bridge_id, status, attempt_count, next_attempt_at, claimed_at, claim_token, last_error, delivered_at, config_fingerprint, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        delivery.id, delivery.eventId, delivery.bridgeId, delivery.status, delivery.attemptCount,
        delivery.nextAttemptAt ?? null, delivery.claimedAt ?? null, delivery.claimToken ?? null,
        delivery.lastError ?? null, delivery.deliveredAt ?? null, delivery.configFingerprint ?? null,
        delivery.createdAt, delivery.updatedAt);
    },

    async getWebhookDelivery(id) {
      const row = await first<WebhookDeliveryRow>("SELECT * FROM webhook_deliveries WHERE id = ?", id);
      return row ? mapWebhookDelivery(row) : undefined;
    },

    async listWebhookDeliveries() {
      return (await all<WebhookDeliveryRow>(
        "SELECT * FROM webhook_deliveries ORDER BY created_at, rowid")).map(mapWebhookDelivery);
    },

    async countWebhookDeliveries() {
      const rows = await all<{ status: string; count: number }>(
        "SELECT status, COUNT(*) AS count FROM webhook_deliveries GROUP BY status");
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

    async listDueWebhookDeliveries(input) {
      return (await all<WebhookDeliveryRow>(
        `SELECT * FROM webhook_deliveries
         WHERE bridge_id = ?
           AND config_fingerprint = ?
           AND (
             (status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
             OR (status = 'delivering' AND claimed_at IS NOT NULL AND claimed_at <= ?)
           )
         ORDER BY created_at, rowid`,
        input.bridgeId, input.configFingerprint, input.now, input.leaseBefore)).map(mapWebhookDelivery);
    },

    async claimWebhookDelivery(id, input) {
      const row = await first<WebhookDeliveryRow>("SELECT * FROM webhook_deliveries WHERE id = ?", id);
      if (
        row === undefined ||
        row.config_fingerprint !== input.configFingerprint ||
        !deliveryIsClaimable(row, input.now, input.leaseBefore)
      ) {
        return undefined;
      }
      const result = await runNow(
        `UPDATE webhook_deliveries
         SET status = 'delivering', claim_token = ?, claimed_at = ?, updated_at = ?
         WHERE id = ?
           AND (
             (status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
             OR (status = 'delivering' AND claimed_at IS NOT NULL AND claimed_at <= ?)
           )
           AND (claim_token IS NULL OR claim_token = ?)
           AND config_fingerprint = ?`,
        input.claimToken, input.now, input.now, id, input.now, input.leaseBefore, row.claim_token,
        input.configFingerprint);
      if (result.meta?.changes !== 1) return undefined;
      const updated = await first<WebhookDeliveryRow>("SELECT * FROM webhook_deliveries WHERE id = ?", id);
      return updated ? mapWebhookDelivery(updated) : undefined;
    },

    async markWebhookDeliveryDelivered(id, claimToken, deliveredAt) {
      const result = await runNow(
        `UPDATE webhook_deliveries
         SET status = 'delivered', delivered_at = ?, attempt_count = attempt_count + 1,
             claim_token = NULL, next_attempt_at = NULL, last_error = NULL, updated_at = ?
         WHERE id = ? AND claim_token = ? AND status = 'delivering'`,
        deliveredAt, deliveredAt, id, claimToken);
      return result.meta?.changes === 1;
    },

    async markWebhookDeliveryRetry(id, claimToken, input) {
      const result = await runNow(
        `UPDATE webhook_deliveries
         SET status = ?, attempt_count = ?, next_attempt_at = ?, last_error = ?,
             claim_token = NULL, claimed_at = NULL, updated_at = ?
         WHERE id = ? AND claim_token = ? AND status = 'delivering'`,
        input.status, input.attemptCount,
        input.status === "exhausted" ? null : (input.nextAttemptAt ?? null),
        input.lastError ?? null, input.updatedAt, id, claimToken);
      return result.meta?.changes === 1;
    },

    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      const outer = txnDepth === 0;
      txnDepth += 1;
      try {
        const result = await fn();
        if (outer && buffered.length > 0) {
          const statements = buffered.splice(0, buffered.length);
          dirty = false;
          await db.batch(statements);
        }
        return result;
      } catch (error) {
        buffered.length = 0;
        dirty = false;
        throw error;
      } finally {
        txnDepth -= 1;
      }
    },

    async close(): Promise<void> {
      // D1 connections are managed by the runtime; nothing to close.
    },
  };
}
