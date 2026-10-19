/**
 * SQL for CTX-001 pages.
 *
 * SQLite and D1 execute these strings unchanged. Limits are bound parameters.
 * Status lists are checked against the domain enums before they are interpolated
 * as placeholders, never as raw text.
 */
import { ValidationError } from "../domain/errors.js";
import { MAX_PAGE_SIZE, MAX_RECORD_HISTORY_PAGE_SIZE, type HistoryObjectType } from "../domain/context-policy.js";
import type { ActorType, Contribution, DecisionStatus, FindingCurrentness, ParticipantRole, TaskStatus } from "../domain/types.js";

export const DECISION_RANK_SQL = "CASE status WHEN 'accepted' THEN 0 WHEN 'proposed' THEN 1 ELSE 2 END";
export const TASK_RANK_SQL = "CASE status WHEN 'blocked' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'open' THEN 2 ELSE 3 END";
export const FINDING_RANK_SQL = "CASE WHEN source_artifact_id IS NULL OR source_artifact_id = '' THEN 1 ELSE 0 END";
export const ARTIFACT_RANK_SQL =
  "CASE WHEN EXISTS (SELECT 1 FROM findings AS finding_ref WHERE finding_ref.workspace_id = artifacts.workspace_id AND finding_ref.source_artifact_id = artifacts.id) THEN 0 ELSE 1 END";

/**
 * Mirrors `contributionMateriality` in the domain policy.
 * Wrapped in CASE so a missing status is 0, not NULL. `json_extract(...) IN (...)`
 * is NULL when the key is absent, and `NOT NULL` would drop the row from both pages.
 */
export const HIGH_MATERIAL_SQL = `(CASE WHEN (
  (object_type = 'finding' AND action = 'create')
  OR (object_type = 'finding' AND json_extract(payload, '$.changeType') IN ('finding.corrected', 'finding.withdrawn'))
  OR (object_type = 'decision' AND json_extract(payload, '$.changeType') IN ('decision.superseded', 'decision.rejected'))
  OR (object_type = 'artifact' AND action = 'create')
  OR (object_type = 'goal' AND action IN ('create', 'update'))
  OR (object_type = 'decision' AND action = 'update' AND json_extract(payload, '$.status') = 'accepted')
  OR (object_type = 'task' AND action = 'update' AND json_extract(payload, '$.status') IN ('blocked', 'completed', 'in_progress', 'open'))
) THEN 1 ELSE 0 END = 1)`;

export interface SqlStatement {
  sql: string;
  params: unknown[];
}

export interface ObjectPageQuery {
  limit: number;
  after?: { rank: number; at: string; id: string };
}

export interface ObjectPage<T> {
  items: T[];
  total: number;
  hasMore: boolean;
  /** Keyset of the last returned row. Set when `hasMore` is true. */
  next?: { rank: number; at: string; id: string };
}

export interface ContributionPageQuery {
  limit: number;
  /** Exclusive lower bound. Omit or 0 to start at the beginning. */
  afterPosition?: number;
  /** Inclusive upper bound of one frozen catch-up run. Omit or 0 for no tip. */
  throughPosition?: number;
  materiality?: "high" | "normal";
}

export interface ContributionWindow {
  found: boolean;
  items: Contribution[];
  total: number;
  hasMore: boolean;
}

const DECISION_STATUSES: readonly DecisionStatus[] = ["proposed", "accepted", "superseded"];
const TASK_STATUSES: readonly TaskStatus[] = ["open", "in_progress", "blocked", "completed"];

export function assertPageLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw new ValidationError(`limit must be an integer from 1 to ${MAX_PAGE_SIZE}`, { field: "limit", limit });
  }
  return limit;
}

export function takeLimitPlusOne<T>(rows: readonly T[], limit: number): { items: T[]; hasMore: boolean } {
  if (rows.length > limit) {
    return { items: rows.slice(0, limit), hasMore: true };
  }
  return { items: [...rows], hasMore: false };
}

export function countByStatusSql(table: "decisions" | "tasks", workspaceId: string): SqlStatement {
  return {
    sql: `SELECT status AS status, COUNT(*) AS count FROM ${table} WHERE workspace_id = ? GROUP BY status`,
    params: [workspaceId],
  };
}

export function countRowsSql(table: "findings" | "artifacts" | "contributions", workspaceId: string): SqlStatement {
  return {
    sql: `SELECT COUNT(*) AS count FROM ${table} WHERE workspace_id = ?`,
    params: [workspaceId],
  };
}

function keysetAfter(rankSql: string, timeColumn: string): string {
  return `((${rankSql}) > ? OR ((${rankSql}) = ? AND (${timeColumn} < ? OR (${timeColumn} = ? AND id > ?))))`;
}

function statusesClause(column: string, statuses: readonly string[]): { sql: string; params: string[] } {
  return {
    sql: `${column} IN (${statuses.map(() => "?").join(", ")})`,
    params: [...statuses],
  };
}

function assertDecisionStatuses(statuses: readonly DecisionStatus[] | undefined): DecisionStatus[] | undefined {
  if (statuses === undefined) return undefined;
  if (statuses.length === 0) {
    throw new ValidationError("statuses must not be empty", { field: "status" });
  }
  for (const status of statuses) {
    if (!DECISION_STATUSES.includes(status)) {
      throw new ValidationError("Invalid decision status", { field: "status", status });
    }
  }
  return [...statuses];
}

function assertTaskStatuses(statuses: readonly TaskStatus[] | undefined): TaskStatus[] | undefined {
  if (statuses === undefined) return undefined;
  if (statuses.length === 0) {
    throw new ValidationError("statuses must not be empty", { field: "status" });
  }
  for (const status of statuses) {
    if (!TASK_STATUSES.includes(status)) {
      throw new ValidationError("Invalid task status", { field: "status", status });
    }
  }
  return [...statuses];
}

export function pageDecisionsSql(
  workspaceId: string,
  query: ObjectPageQuery & { statuses?: DecisionStatus[] },
): SqlStatement {
  const limit = assertPageLimit(query.limit);
  const statuses = assertDecisionStatuses(query.statuses);
  const params: unknown[] = [workspaceId];
  const where = ["workspace_id = ?"];
  if (statuses !== undefined) {
    const clause = statusesClause("status", statuses);
    where.push(clause.sql);
    params.push(...clause.params);
  }
  if (query.after !== undefined) {
    where.push(keysetAfter(DECISION_RANK_SQL, "updated_at"));
    params.push(query.after.rank, query.after.rank, query.after.at, query.after.at, query.after.id);
  }
  params.push(limit + 1);
  return {
    sql: `SELECT *, (${DECISION_RANK_SQL}) AS context_rank FROM decisions WHERE ${where.join(" AND ")} ORDER BY (${DECISION_RANK_SQL}) ASC, updated_at DESC, id ASC LIMIT ?`,
    params,
  };
}

export function countDecisionsSql(workspaceId: string, statuses?: DecisionStatus[]): SqlStatement {
  const checked = assertDecisionStatuses(statuses);
  if (checked === undefined) {
    return { sql: "SELECT COUNT(*) AS count FROM decisions WHERE workspace_id = ?", params: [workspaceId] };
  }
  const clause = statusesClause("status", checked);
  return {
    sql: `SELECT COUNT(*) AS count FROM decisions WHERE workspace_id = ? AND ${clause.sql}`,
    params: [workspaceId, ...clause.params],
  };
}

export function pageTasksSql(workspaceId: string, query: ObjectPageQuery & { statuses?: TaskStatus[] }): SqlStatement {
  const limit = assertPageLimit(query.limit);
  const statuses = assertTaskStatuses(query.statuses);
  const params: unknown[] = [workspaceId];
  const where = ["workspace_id = ?"];
  if (statuses !== undefined) {
    const clause = statusesClause("status", statuses);
    where.push(clause.sql);
    params.push(...clause.params);
  }
  if (query.after !== undefined) {
    where.push(keysetAfter(TASK_RANK_SQL, "updated_at"));
    params.push(query.after.rank, query.after.rank, query.after.at, query.after.at, query.after.id);
  }
  params.push(limit + 1);
  return {
    sql: `SELECT *, (${TASK_RANK_SQL}) AS context_rank FROM tasks WHERE ${where.join(" AND ")} ORDER BY (${TASK_RANK_SQL}) ASC, updated_at DESC, id ASC LIMIT ?`,
    params,
  };
}

export function countTasksSql(workspaceId: string, statuses?: TaskStatus[]): SqlStatement {
  const checked = assertTaskStatuses(statuses);
  if (checked === undefined) {
    return { sql: "SELECT COUNT(*) AS count FROM tasks WHERE workspace_id = ?", params: [workspaceId] };
  }
  const clause = statusesClause("status", checked);
  return {
    sql: `SELECT COUNT(*) AS count FROM tasks WHERE workspace_id = ? AND ${clause.sql}`,
    params: [workspaceId, ...clause.params],
  };
}

export type FindingCurrentnessFilter = FindingCurrentness | "all";

export function assertFindingCurrentness(value: string): FindingCurrentnessFilter {
  if (value === "current" || value === "superseded" || value === "withdrawn" || value === "all") return value;
  throw new ValidationError("currentness must be current, superseded, withdrawn, or all", {
    field: "currentness",
    value,
  });
}

export function pageFindingsSql(
  workspaceId: string,
  query: ObjectPageQuery & { currentness?: FindingCurrentnessFilter },
): SqlStatement {
  const limit = assertPageLimit(query.limit);
  const params: unknown[] = [workspaceId];
  const where = ["workspace_id = ?"];
  if (query.currentness !== undefined && query.currentness !== "all") {
    where.push("currentness = ?");
    params.push(query.currentness);
  }
  if (query.after !== undefined) {
    where.push(keysetAfter(FINDING_RANK_SQL, "created_at"));
    params.push(query.after.rank, query.after.rank, query.after.at, query.after.at, query.after.id);
  }
  params.push(limit + 1);
  return {
    sql: `SELECT *, (${FINDING_RANK_SQL}) AS context_rank FROM findings WHERE ${where.join(" AND ")} ORDER BY (${FINDING_RANK_SQL}) ASC, created_at DESC, id ASC LIMIT ?`,
    params,
  };
}

export function countFindingsSql(workspaceId: string, currentness?: FindingCurrentnessFilter): SqlStatement {
  if (currentness === undefined || currentness === "all") {
    return countRowsSql("findings", workspaceId);
  }
  return {
    sql: "SELECT COUNT(*) AS count FROM findings WHERE workspace_id = ? AND currentness = ?",
    params: [workspaceId, currentness],
  };
}

export function countHistoricalFindingsSql(workspaceId: string): SqlStatement {
  return {
    sql: "SELECT COUNT(*) AS count FROM findings WHERE workspace_id = ? AND currentness IN ('superseded', 'withdrawn')",
    params: [workspaceId],
  };
}

export function pageArtifactsSql(workspaceId: string, query: ObjectPageQuery): SqlStatement {
  const limit = assertPageLimit(query.limit);
  const params: unknown[] = [workspaceId];
  const where = ["artifacts.workspace_id = ?"];
  if (query.after !== undefined) {
    where.push(keysetAfter(ARTIFACT_RANK_SQL, "artifacts.created_at"));
    params.push(query.after.rank, query.after.rank, query.after.at, query.after.at, query.after.id);
  }
  params.push(limit + 1);
  return {
    sql: `SELECT artifacts.*, (${ARTIFACT_RANK_SQL}) AS context_rank FROM artifacts WHERE ${where.join(" AND ")} ORDER BY (${ARTIFACT_RANK_SQL}) ASC, artifacts.created_at DESC, artifacts.id ASC LIMIT ?`,
    params,
  };
}

function isPositiveInteger(value: number | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** Shared page filter. Position bounds apply only for positive integers. */
function contributionPageFilter(workspaceId: string, query: ContributionPageQuery): { where: string[]; params: unknown[] } {
  const params: unknown[] = [workspaceId];
  const where = ["workspace_id = ?"];
  if (query.materiality === "high") where.push(HIGH_MATERIAL_SQL);
  if (query.materiality === "normal") where.push(`NOT ${HIGH_MATERIAL_SQL}`);
  if (isPositiveInteger(query.afterPosition)) {
    where.push("append_position > ?");
    params.push(query.afterPosition);
  }
  if (isPositiveInteger(query.throughPosition)) {
    where.push("append_position <= ?");
    params.push(query.throughPosition);
  }
  return { where, params };
}

export function pageContributionsSql(workspaceId: string, query: ContributionPageQuery): SqlStatement {
  const limit = assertPageLimit(query.limit);
  const { where, params } = contributionPageFilter(workspaceId, query);
  params.push(limit + 1);
  return {
    sql: `SELECT * FROM contributions WHERE ${where.join(" AND ")} ORDER BY append_position ASC LIMIT ?`,
    params,
  };
}

export function countContributionsPageSql(workspaceId: string, query: ContributionPageQuery): SqlStatement {
  const { where, params } = contributionPageFilter(workspaceId, query);
  return { sql: `SELECT COUNT(*) AS count FROM contributions WHERE ${where.join(" AND ")}`, params };
}

export function recentContributionsSql(workspaceId: string, limit: number): SqlStatement {
  const checked = assertPageLimit(limit);
  return {
    sql: `SELECT * FROM (
      SELECT contributions.rowid AS entry_rowid, contributions.*
      FROM contributions WHERE workspace_id = ? ORDER BY created_at DESC, contributions.rowid DESC LIMIT ?
    ) AS recent_contributions ORDER BY created_at ASC, entry_rowid ASC`,
    params: [workspaceId, checked],
  };
}

/**
 * Newest `limit` rows strictly after the anchor, returned in activity order.
 * Activity is `created_at, rowid`. An id tie-break drops a later row when two
 * writes share a timestamp and the later id sorts first.
 */
export function contributionsSinceSql(
  workspaceId: string,
  anchor: { occurredAt: string; rowid: number },
  limit: number,
): SqlStatement {
  const checked = assertPageLimit(limit);
  return {
    sql: `SELECT * FROM (
      SELECT contributions.rowid AS entry_rowid, contributions.*
      FROM contributions
      WHERE workspace_id = ? AND (created_at > ? OR (created_at = ? AND contributions.rowid > ?))
      ORDER BY created_at DESC, contributions.rowid DESC
      LIMIT ?
    ) AS since_contributions ORDER BY created_at ASC, entry_rowid ASC`,
    params: [workspaceId, anchor.occurredAt, anchor.occurredAt, anchor.rowid, checked + 1],
  };
}

export function countContributionsSinceSql(workspaceId: string, anchor: { occurredAt: string; rowid: number }): SqlStatement {
  return {
    sql: `SELECT COUNT(*) AS count FROM contributions
      WHERE workspace_id = ? AND (created_at > ? OR (created_at = ? AND rowid > ?))`,
    params: [workspaceId, anchor.occurredAt, anchor.occurredAt, anchor.rowid],
  };
}

/** Newest `limit` rows strictly before the anchor, returned in activity order. */
export function contributionsBeforeSql(
  workspaceId: string,
  anchor: { occurredAt: string; rowid: number },
  limit: number,
): SqlStatement {
  const checked = assertPageLimit(limit);
  return {
    sql: `SELECT * FROM (
      SELECT contributions.rowid AS entry_rowid, contributions.*
      FROM contributions
      WHERE workspace_id = ? AND (created_at < ? OR (created_at = ? AND contributions.rowid < ?))
      ORDER BY created_at DESC, contributions.rowid DESC
      LIMIT ?
    ) AS before_contributions ORDER BY created_at ASC, entry_rowid ASC`,
    params: [workspaceId, anchor.occurredAt, anchor.occurredAt, anchor.rowid, checked + 1],
  };
}

export interface ListedParticipant {
  actor: { actorId: string; actorType: ActorType };
  name: string;
  role: ParticipantRole;
  harness?: string;
  humanOwnerId?: string;
  joinedAt: string;
  /** Agents only. True when `humanOwnerId` is a human participant of this workspace. */
  humanOwnerIsParticipant?: boolean;
}

export interface ParticipantPageQuery {
  limit: number;
  humanOwnerId?: string;
  after?: { actorType: "human" | "agent"; actorId: string };
}

export interface ParticipantObjectPage {
  items: ListedParticipant[];
  total: number;
  hasMore: boolean;
}

export interface RecordHistoryQuery {
  limit: number;
  objectType: HistoryObjectType;
  objectId: string;
  tip: number;
  beforePosition?: number;
}

export interface ParticipantPageRow {
  actor_id: string;
  actor_type: string;
  role: string;
  joined_at: string;
  name: string | null;
  harness: string | null;
  human_owner_id: string | null;
  human_owner_is_participant: number | bigint | string | null;
}

const PARTICIPANT_SELECT = `
  p.actor_id AS actor_id,
  p.actor_type AS actor_type,
  p.role AS role,
  p.joined_at AS joined_at,
  CASE WHEN p.actor_type = 'human' THEN h.display_name ELSE a.name END AS name,
  a.harness AS harness,
  a.human_id AS human_owner_id,
  CASE
    WHEN p.actor_type <> 'agent' THEN NULL
    WHEN EXISTS (
      SELECT 1 FROM workspace_participants AS owner
      WHERE owner.workspace_id = p.workspace_id
        AND owner.actor_type = 'human'
        AND owner.actor_id = a.human_id
    ) THEN 1
    ELSE 0
  END AS human_owner_is_participant`;

function participantFilter(workspaceId: string, humanOwnerId: string | undefined): { where: string[]; params: unknown[] } {
  const where = ["p.workspace_id = ?"];
  const params: unknown[] = [workspaceId];
  if (humanOwnerId !== undefined) {
    where.push("p.actor_type = 'agent' AND a.human_id = ?");
    params.push(humanOwnerId);
  }
  return { where, params };
}

export function pageParticipantsSql(workspaceId: string, query: ParticipantPageQuery): SqlStatement {
  const limit = assertPageLimit(query.limit);
  const filtered = participantFilter(workspaceId, query.humanOwnerId);
  const params = [...filtered.params];
  const where = [...filtered.where];
  if (query.after !== undefined) {
    where.push("(p.actor_type > ? OR (p.actor_type = ? AND p.actor_id > ?))");
    params.push(query.after.actorType, query.after.actorType, query.after.actorId);
  }
  params.push(limit + 1);
  return {
    sql: `SELECT ${PARTICIPANT_SELECT}
      FROM workspace_participants AS p
      LEFT JOIN humans AS h ON p.actor_type = 'human' AND h.id = p.actor_id
      LEFT JOIN agents AS a ON p.actor_type = 'agent' AND a.id = p.actor_id
      WHERE ${where.join(" AND ")}
      ORDER BY p.actor_type ASC, p.actor_id ASC
      LIMIT ?`,
    params,
  };
}

export function countParticipantsSql(workspaceId: string, humanOwnerId?: string): SqlStatement {
  const filtered = participantFilter(workspaceId, humanOwnerId);
  return {
    sql: `SELECT COUNT(*) AS count
      FROM workspace_participants AS p
      LEFT JOIN agents AS a ON p.actor_type = 'agent' AND a.id = p.actor_id
      WHERE ${filtered.where.join(" AND ")}`,
    params: filtered.params,
  };
}

export function mapListedParticipant(row: ParticipantPageRow): ListedParticipant {
  const actorType: ActorType = row.actor_type === "agent" ? "agent" : "human";
  const item: ListedParticipant = {
    actor: { actorId: row.actor_id, actorType },
    name: row.name !== null && row.name.length > 0 ? row.name : row.actor_id,
    role: row.role as ParticipantRole,
    joinedAt: row.joined_at,
  };
  if (actorType !== "agent") return item;
  if (row.harness !== null && row.harness.length > 0) item.harness = row.harness;
  if (row.human_owner_id !== null && row.human_owner_id.length > 0) item.humanOwnerId = row.human_owner_id;
  item.humanOwnerIsParticipant = Number(row.human_owner_is_participant) === 1;
  return item;
}

function assertHistoryObject(objectType: string): HistoryObjectType {
  if (objectType === "task" || objectType === "decision" || objectType === "finding" || objectType === "artifact") {
    return objectType;
  }
  throw new ValidationError("objectType must be task, decision, finding, or artifact", {
    field: "objectType",
    value: objectType,
  });
}

export function assertHistoryPageLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RECORD_HISTORY_PAGE_SIZE) {
    throw new ValidationError(`limit must be an integer from 1 to ${MAX_RECORD_HISTORY_PAGE_SIZE}`, {
      field: "limit",
      limit,
    });
  }
  return limit;
}

export function pageRecordHistorySql(workspaceId: string, query: RecordHistoryQuery): SqlStatement {
  const limit = assertHistoryPageLimit(query.limit);
  const objectType = assertHistoryObject(query.objectType);
  const params: unknown[] = [workspaceId, objectType, query.objectId, query.tip];
  const where = ["workspace_id = ?", "object_type = ?", "object_id = ?", "append_position <= ?"];
  if (query.beforePosition !== undefined) {
    where.push("append_position < ?");
    params.push(query.beforePosition);
  }
  params.push(limit + 1);
  return {
    sql: `SELECT * FROM contributions WHERE ${where.join(" AND ")} ORDER BY append_position DESC LIMIT ?`,
    params,
  };
}

export function countRecordHistorySql(
  workspaceId: string,
  query: Pick<RecordHistoryQuery, "objectType" | "objectId" | "tip">,
): SqlStatement {
  const objectType = assertHistoryObject(query.objectType);
  return {
    sql: `SELECT COUNT(*) AS count FROM contributions
      WHERE workspace_id = ? AND object_type = ? AND object_id = ? AND append_position <= ?`,
    params: [workspaceId, objectType, query.objectId, query.tip],
  };
}
