/**
 * SQL for RCL-001 recall.
 *
 * SQLite and D1 execute these strings unchanged. The normalization expression
 * matches `normalizeRecallText` in `src/domain/recall.ts` for the rcl-1 rule:
 * ASCII A-Z casefold, whitespace codes 9/10/11/12/13 become spaces, sixteen
 * non-overlapping double-space collapses, then trim of ASCII spaces.
 * Text match uses `instr`, not `LIKE`, so `%` and `_` stay literal.
 * Artifact URI, metadata, contribution payload, and evidence notes are absent.
 */
import type { RecallSectionName } from "../domain/recall.js";
import type { ActorType } from "../domain/types.js";
import { RECALL_SPACE_COLLAPSE_PASSES } from "../domain/recall.js";
import { ValidationError } from "../domain/errors.js";
import type { SqlStatement } from "./context-queries.js";

export type { SqlStatement };

export interface RecallPageQuery {
  normalizedQuery: string;
  limit: number;
  after?: { tier: number; at: string; id: string };
}

export interface RecallCandidate {
  kind: "task" | "finding" | "decision" | "artifact";
  id: string;
  tier: number;
  recency: string;
  primaryText: string;
  secondaryText?: string;
  lifecycle: string;
  predecessorId?: string;
  successorId?: string;
  createdByActorId: string;
  createdByActorType: ActorType;
  agentSessionId?: string;
  createdAt: string;
}

export interface RecallPage {
  items: RecallCandidate[];
  total: number;
  hasMore: boolean;
}

export interface RecallGoalRow {
  id: string;
  title: string;
  description?: string;
  status: "active" | "completed" | "abandoned";
  matched: boolean;
}

interface RecallHitRow {
  kind: string;
  id: string;
  tier: number | bigint | string;
  recency: string;
  primary_text: string;
  secondary_text: string | null;
  lifecycle: string;
  predecessor_id: string | null;
  successor_id: string | null;
  created_by_actor_id: string;
  created_by_actor_type: string;
  agent_session_id: string | null;
  created_at: string;
}

function branch(
  kind: RecallCandidate["kind"],
  table: string,
  where: string,
  recency: string,
  primary: string,
  secondary: string,
  lifecycle: string,
  predecessor = "NULL",
  successor = "NULL",
) {
  return { kind, table, where, recency, primary, secondary, lifecycle, predecessor, successor };
}

/**
 * The two decision branches, declared once.
 *
 * The decision set is the union of exactly these two branches, so "every
 * decision this query matches" cannot drift from "every decision a section hit
 * can return". Declaring them once is what keeps that true on both engines.
 */
const DECISION_CURRENT = branch(
  "decision", "decisions", "status IN ('proposed', 'accepted')",
  "updated_at", "summary", "rationale", "status", "predecessor_id", "successor_id",
);
const DECISION_HISTORICAL = branch(
  "decision", "decisions", "status = 'superseded'",
  "updated_at", "summary", "rationale", "status", "predecessor_id", "successor_id",
);
const DECISION_BRANCHES = [DECISION_CURRENT, DECISION_HISTORICAL] as const;

const SECTIONS: Record<
  RecallSectionName,
  Array<{
    kind: RecallCandidate["kind"];
    table: string;
    where: string;
    recency: string;
    primary: string;
    secondary: string;
    lifecycle: string;
    predecessor: string;
    successor: string;
  }>
> = {
  current: [
    branch("task", "tasks", "status IN ('open', 'in_progress', 'blocked')", "updated_at", "title", "description", "status"),
    branch("finding", "findings", "currentness = 'current'", "created_at", "summary", "detail", "currentness", "predecessor_id", "successor_id"),
    DECISION_CURRENT,
  ],
  historical: [
    branch("task", "tasks", "status = 'completed'", "updated_at", "title", "description", "status"),
    branch("finding", "findings", "currentness IN ('superseded', 'withdrawn')", "created_at", "summary", "detail", "currentness", "predecessor_id", "successor_id"),
    DECISION_HISTORICAL,
  ],
  artifacts: [
    branch("artifact", "artifacts", "1 = 1", "created_at", "title", "type", "type"),
  ],
};

function asciiLowerSql(expression: string): string {
  let sql = expression;
  for (let code = 65; code <= 90; code += 1) {
    const upper = String.fromCharCode(code);
    const lower = String.fromCharCode(code + 32);
    sql = `replace(${sql}, '${upper}', '${lower}')`;
  }
  return sql;
}

/** Shared with the domain normalizer. Exported so tests can compare both sides. */
export function recallNormSql(expression: string): string {
  let sql = asciiLowerSql(`coalesce(${expression}, '')`);
  for (const code of [9, 10, 11, 12, 13]) {
    sql = `replace(${sql}, char(${code}), ' ')`;
  }
  for (let pass = 0; pass < RECALL_SPACE_COLLAPSE_PASSES; pass += 1) {
    sql = `replace(${sql}, '  ', ' ')`;
  }
  return `trim(${sql})`;
}

const TIER_SQL = `CASE
  WHEN norm_primary = ? THEN 0
  WHEN norm_secondary = ? THEN 1
  WHEN instr(norm_primary, ?) = 1 THEN 2
  WHEN instr(norm_secondary, ?) = 1 THEN 3
  WHEN instr(norm_primary, ?) > 1 THEN 4
  WHEN instr(norm_secondary, ?) > 1 THEN 5
  ELSE NULL
END`;

function assertSection(section: string): RecallSectionName {
  if (section === "current" || section === "historical" || section === "artifacts") return section;
  throw new ValidationError("Unknown recall section", { field: "section", section });
}

function assertQuery(normalizedQuery: string): string {
  if (typeof normalizedQuery !== "string" || normalizedQuery.length === 0) {
    throw new ValidationError("query must not be empty", { field: "query" });
  }
  return normalizedQuery;
}

type RecallBranch = (typeof SECTIONS)[RecallSectionName][number];

function unionSqlForBranches(branches: readonly RecallBranch[]): { sql: string } {
  const parts = branches.map((entry) => {
    const predecessor = entry.predecessor === "NULL" ? "NULL" : entry.predecessor;
    const successor = entry.successor === "NULL" ? "NULL" : entry.successor;
    return `SELECT
      '${entry.kind}' AS kind,
      id,
      ${recallNormSql(entry.primary)} AS norm_primary,
      ${recallNormSql(entry.secondary)} AS norm_secondary,
      ${entry.recency} AS recency,
      ${entry.primary} AS primary_text,
      ${entry.secondary} AS secondary_text,
      ${entry.lifecycle} AS lifecycle,
      ${predecessor} AS predecessor_id,
      ${successor} AS successor_id,
      created_by_actor_id,
      created_by_actor_type,
      agent_session_id,
      created_at
    FROM ${entry.table}
    WHERE workspace_id = ? AND ${entry.where}`;
  });
  return { sql: parts.join("\nUNION ALL\n") };
}

function rankedSql(
  branches: readonly RecallBranch[],
  workspaceId: string,
  normalizedQuery: string,
): { sql: string; params: unknown[] } {
  const union = unionSqlForBranches(branches);
  const params: unknown[] = branches.map(() => workspaceId);
  for (let index = 0; index < 6; index += 1) params.push(normalizedQuery);
  return {
    sql: `WITH normalized AS (
      ${union.sql}
    )
    SELECT
      kind, id, recency, primary_text, secondary_text, lifecycle,
      predecessor_id, successor_id, created_by_actor_id, created_by_actor_type,
      agent_session_id, created_at,
      ${TIER_SQL} AS tier
    FROM normalized`,
    params,
  };
}

export function recallSectionSql(
  workspaceId: string,
  section: RecallSectionName,
  query: RecallPageQuery,
): SqlStatement {
  assertSection(section);
  const normalized = assertQuery(query.normalizedQuery);
  if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 50) {
    throw new ValidationError("limit must be an integer from 1 to 50", { field: "limit", limit: query.limit });
  }
  const ranked = rankedSql(SECTIONS[section], workspaceId, normalized);
  const params = [...ranked.params];
  const where = ["ranked.tier IS NOT NULL"];
  if (query.after !== undefined) {
    where.push("(ranked.tier > ? OR (ranked.tier = ? AND (ranked.recency < ? OR (ranked.recency = ? AND ranked.id > ?))))");
    params.push(query.after.tier, query.after.tier, query.after.at, query.after.at, query.after.id);
  }
  params.push(query.limit + 1);
  return {
    sql: `SELECT kind, id, tier, recency, primary_text, secondary_text, lifecycle,
      predecessor_id, successor_id, created_by_actor_id, created_by_actor_type,
      agent_session_id, created_at
    FROM (
      ${ranked.sql}
    ) AS ranked
    WHERE ${where.join(" AND ")}
    ORDER BY ranked.tier ASC, ranked.recency DESC, ranked.id ASC
    LIMIT ?`,
    params,
  };
}

export function countRecallSectionSql(
  workspaceId: string,
  section: RecallSectionName,
  normalizedQuery: string,
): SqlStatement {
  assertSection(section);
  const ranked = rankedSql(SECTIONS[section], workspaceId, assertQuery(normalizedQuery));
  return {
    sql: `SELECT COUNT(*) AS count FROM (
      ${ranked.sql}
    ) AS ranked
    WHERE ranked.tier IS NOT NULL`,
    params: ranked.params,
  };
}

export interface RecallDecisionSetQuery {
  normalizedQuery: string;
  limit: number;
}

export interface RecallDecisionMember {
  id: string;
  tier: number;
  summary: string;
  rationale?: string;
  lifecycle: string;
  predecessorId?: string;
  successorId?: string;
  createdByActorId: string;
  createdByActorType: ActorType;
  agentSessionId?: string;
  createdAt: string;
}

export interface RecallDecisionSetPage {
  members: RecallDecisionMember[];
  total: number;
  hasMore: boolean;
}

/**
 * Every decision the same normalized query matches, current and historical, in
 * rcl-1 order. Independent of the section `limit` and `cursor`: paging a
 * section never changes the set, which is the point of the set.
 */
export function recallDecisionSetSql(workspaceId: string, query: RecallDecisionSetQuery): SqlStatement {
  const normalized = assertQuery(query.normalizedQuery);
  if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 50) {
    throw new ValidationError("limit must be an integer from 1 to 50", { field: "limit", limit: query.limit });
  }
  const ranked = rankedSql(DECISION_BRANCHES, workspaceId, normalized);
  return {
    sql: `SELECT id, tier, primary_text, secondary_text, lifecycle,
      predecessor_id, successor_id, created_by_actor_id, created_by_actor_type,
      agent_session_id, created_at
    FROM (
      ${ranked.sql}
    ) AS ranked
    WHERE ranked.tier IS NOT NULL
    ORDER BY ranked.tier ASC, ranked.recency DESC, ranked.id ASC
    LIMIT ?`,
    params: [...ranked.params, query.limit + 1],
  };
}

export function countRecallDecisionSetSql(workspaceId: string, normalizedQuery: string): SqlStatement {
  const ranked = rankedSql(DECISION_BRANCHES, workspaceId, assertQuery(normalizedQuery));
  return {
    sql: `SELECT COUNT(*) AS count FROM (
      ${ranked.sql}
    ) AS ranked
    WHERE ranked.tier IS NOT NULL`,
    params: ranked.params,
  };
}

export function mapRecallDecisionMemberRow(row: {
  id: string;
  tier: number | bigint | string;
  primary_text: string;
  secondary_text: string | null;
  lifecycle: string;
  predecessor_id: string | null;
  successor_id: string | null;
  created_by_actor_id: string;
  created_by_actor_type: string;
  agent_session_id: string | null;
  created_at: string;
}): RecallDecisionMember {
  const actorType = row.created_by_actor_type === "human" || row.created_by_actor_type === "agent"
    ? row.created_by_actor_type
    : undefined;
  if (actorType === undefined) {
    throw new ValidationError("Recall decision row has an unknown actor type", { field: "actorType" });
  }
  const rationale = row.secondary_text ?? undefined;
  return {
    id: row.id,
    tier: Number(row.tier),
    summary: row.primary_text,
    ...(rationale === undefined || rationale.length === 0 ? {} : { rationale }),
    lifecycle: row.lifecycle,
    ...(row.predecessor_id ? { predecessorId: row.predecessor_id } : {}),
    ...(row.successor_id ? { successorId: row.successor_id } : {}),
    createdByActorId: row.created_by_actor_id,
    createdByActorType: actorType,
    ...(row.agent_session_id ? { agentSessionId: row.agent_session_id } : {}),
    createdAt: row.created_at,
  };
}

export function recallGoalSql(workspaceId: string, normalizedQuery: string): SqlStatement {
  const normalized = assertQuery(normalizedQuery);
  return {
    sql: `SELECT id, title, description, status,
      CASE WHEN ${TIER_SQL} IS NOT NULL THEN 1 ELSE 0 END AS matched
    FROM (
      SELECT id, title, description, status,
        ${recallNormSql("title")} AS norm_primary,
        ${recallNormSql("description")} AS norm_secondary
      FROM goals
      WHERE workspace_id = ?
      LIMIT 1
    ) AS goal_norm`,
    params: [normalized, normalized, normalized, normalized, normalized, normalized, workspaceId],
  };
}

/** One bound value through the same expression, for the parity test. */
export function recallNormalizeValueSql(): SqlStatement {
  return { sql: `SELECT ${recallNormSql("?")} AS norm`, params: [] };
}

export function mapRecallHitRow(row: RecallHitRow): RecallCandidate {
  const kind = row.kind;
  if (kind !== "task" && kind !== "finding" && kind !== "decision" && kind !== "artifact") {
    throw new ValidationError("Recall row has an unknown kind", { field: "kind" });
  }
  const actorType = row.created_by_actor_type === "human" || row.created_by_actor_type === "agent"
    ? row.created_by_actor_type
    : undefined;
  if (actorType === undefined) {
    throw new ValidationError("Recall row has an unknown actor type", { field: "actorType" });
  }
  const secondary = row.secondary_text ?? undefined;
  return {
    kind,
    id: row.id,
    tier: Number(row.tier),
    recency: row.recency,
    primaryText: row.primary_text,
    ...(secondary === undefined || secondary.length === 0 ? {} : { secondaryText: secondary }),
    lifecycle: row.lifecycle,
    ...(row.predecessor_id ? { predecessorId: row.predecessor_id } : {}),
    ...(row.successor_id ? { successorId: row.successor_id } : {}),
    createdByActorId: row.created_by_actor_id,
    createdByActorType: actorType,
    ...(row.agent_session_id ? { agentSessionId: row.agent_session_id } : {}),
    createdAt: row.created_at,
  };
}

export function mapRecallGoalRow(row: {
  id: string;
  title: string;
  description: string | null;
  status: string;
  matched: number | bigint | string;
}): RecallGoalRow | undefined {
  if (row.status !== "active" && row.status !== "completed" && row.status !== "abandoned") return undefined;
  return {
    id: row.id,
    title: row.title,
    ...(row.description ? { description: row.description } : {}),
    status: row.status,
    matched: Number(row.matched) === 1,
  };
}
