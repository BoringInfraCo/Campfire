/**
 * FAC-001 shared attention SQL (phase A0: constants only, no execution).
 * SQLite and D1 will execute the same strings. Every statement is
 * workspace-scoped with bound params and is run only after authorization.
 * SQL order selects which at most S rows are scanned; the pure core re-sorts
 * by parsed time (A2.4). No new index, no schema change (F7).
 * Memory-health inputs are reused from memory-health-queries.ts (not redefined).
 */
import type {
  AttentionDecisionRow,
  AttentionProposalRow,
  AttentionSnapshot,
  AttentionSnapshotRequest,
  AttentionSourceScan,
  AttentionTaskRow,
} from "../domain/attention.js";
import { ATTENTION_SCAN_CEILING } from "../domain/attention.js";
import type { MemoryHealthRows } from "../domain/memory-health.js";
import type { SqlStatement } from "./context-queries.js";

export {
  MEMORY_HEALTH_TIP_SQL as ATTENTION_TIP_SQL,
  MEMORY_HEALTH_DECISIONS_SQL,
  MEMORY_HEALTH_FINDINGS_SQL,
  MEMORY_HEALTH_TASKS_SQL,
  MEMORY_HEALTH_PROPOSALS_SQL,
} from "./memory-health-queries.js";

/** Params, in order, for each ATTENTION_*_SQL below. */
export const ATTENTION_SCAN_LIMIT_PARAM = "S (100) bound last";

/** assigned_blocked_task (only when canTaskUpdate). params: workspaceId, actorId, actorType, S. */
export const ATTENTION_ASSIGNED_BLOCKED_SQL = `/* attention */ SELECT id, title, updated_at FROM tasks
  WHERE workspace_id = ? AND status = 'blocked' AND assignee_actor_id = ? AND assignee_actor_type = ?
  ORDER BY updated_at DESC, id ASC LIMIT ?`;
export const ATTENTION_ASSIGNED_BLOCKED_COUNT_SQL = `/* attention */ SELECT COUNT(*) AS n FROM tasks
  WHERE workspace_id = ? AND status = 'blocked' AND assignee_actor_id = ? AND assignee_actor_type = ?`;

/** assigned_open_task (you, or team if demoted). params: workspaceId, actorId, actorType, S. */
export const ATTENTION_ASSIGNED_OPEN_SQL = `/* attention */ SELECT id, title, updated_at FROM tasks
  WHERE workspace_id = ? AND status = 'open' AND assignee_actor_id = ? AND assignee_actor_type = ?
  ORDER BY updated_at DESC, id ASC LIMIT ?`;
export const ATTENTION_ASSIGNED_OPEN_COUNT_SQL = `/* attention */ SELECT COUNT(*) AS n FROM tasks
  WHERE workspace_id = ? AND status = 'open' AND assignee_actor_id = ? AND assignee_actor_type = ?`;

/** unassigned_blocked_task (mirrors mapTask: unassigned when either assignee column is null, A2.9). params: workspaceId, S. */
export const ATTENTION_UNASSIGNED_BLOCKED_SQL = `/* attention */ SELECT id, title, updated_at FROM tasks
  WHERE workspace_id = ? AND status = 'blocked' AND (assignee_actor_id IS NULL OR assignee_actor_type IS NULL)
  ORDER BY updated_at DESC, id ASC LIMIT ?`;
export const ATTENTION_UNASSIGNED_BLOCKED_COUNT_SQL = `/* attention */ SELECT COUNT(*) AS n FROM tasks
  WHERE workspace_id = ? AND status = 'blocked' AND (assignee_actor_id IS NULL OR assignee_actor_type IS NULL)`;

/**
 * team_blocked_task: blocked, assignee present, and NOT (caller can task:update AND assignee is caller).
 * params: workspaceId, canTaskUpdate (0|1), actorId, actorType, S.
 */
export const ATTENTION_TEAM_BLOCKED_SQL = `/* attention */ SELECT id, title, updated_at FROM tasks
  WHERE workspace_id = ? AND status = 'blocked' AND assignee_actor_id IS NOT NULL AND assignee_actor_type IS NOT NULL
    AND NOT (? = 1 AND assignee_actor_id = ? AND assignee_actor_type = ?)
  ORDER BY updated_at DESC, id ASC LIMIT ?`;
export const ATTENTION_TEAM_BLOCKED_COUNT_SQL = `/* attention */ SELECT COUNT(*) AS n FROM tasks
  WHERE workspace_id = ? AND status = 'blocked' AND assignee_actor_id IS NOT NULL AND assignee_actor_type IS NOT NULL
    AND NOT (? = 1 AND assignee_actor_id = ? AND assignee_actor_type = ?)`;

/** proposed decisions; reason (actionable vs team) is chosen by canDecisionUpdate in the core. params: workspaceId, S. */
export const ATTENTION_PROPOSED_DECISIONS_SQL = `/* attention */ SELECT id, summary, updated_at FROM decisions
  WHERE workspace_id = ? AND status = 'proposed'
  ORDER BY updated_at DESC, id ASC LIMIT ?`;
export const ATTENTION_PROPOSED_DECISIONS_COUNT_SQL = `/* attention */ SELECT COUNT(*) AS n FROM decisions
  WHERE workspace_id = ? AND status = 'proposed'`;

/** action_proposal_awaiting_review. NOT run when the workspace is not active (F13 skip). params: workspaceId, S. */
export const ATTENTION_AWAITING_REVIEW_SQL = `/* attention */ SELECT id, updated_at, expires_at FROM action_proposals
  WHERE workspace_id = ? AND status = 'proposed'
  ORDER BY updated_at DESC, id ASC LIMIT ?`;
export const ATTENTION_AWAITING_REVIEW_COUNT_SQL = `/* attention */ SELECT COUNT(*) AS n FROM action_proposals
  WHERE workspace_id = ? AND status = 'proposed'`;

/** Goal/current work: no cue and no source in slice 1 (plan section 4). */

// --- shared statement plan and row assembly (SQLite and D1 execute the same strings) ---

export type AttentionScanKey =
  | "assignedBlocked"
  | "assignedOpen"
  | "unassignedBlocked"
  | "teamBlocked"
  | "proposedDecisions"
  | "awaitingReview";

export interface AttentionScanStatement {
  key: AttentionScanKey;
  list: SqlStatement;
  count: SqlStatement;
}

/**
 * The scans to run for one request, in a fixed order. Called only after
 * authorization. A scan the actor cannot receive (assigned blocked without
 * task:update) and the review scan in a non-active workspace are not planned.
 */
export function attentionScanStatements(workspaceId: string, req: AttentionSnapshotRequest): AttentionScanStatement[] {
  const { actorId, actorType } = req.who;
  const S = ATTENTION_SCAN_CEILING;
  const plan: AttentionScanStatement[] = [];
  if (req.canTaskUpdate) {
    plan.push({
      key: "assignedBlocked",
      list: { sql: ATTENTION_ASSIGNED_BLOCKED_SQL, params: [workspaceId, actorId, actorType, S] },
      count: { sql: ATTENTION_ASSIGNED_BLOCKED_COUNT_SQL, params: [workspaceId, actorId, actorType] },
    });
  }
  plan.push(
    {
      key: "assignedOpen",
      list: { sql: ATTENTION_ASSIGNED_OPEN_SQL, params: [workspaceId, actorId, actorType, S] },
      count: { sql: ATTENTION_ASSIGNED_OPEN_COUNT_SQL, params: [workspaceId, actorId, actorType] },
    },
    {
      key: "unassignedBlocked",
      list: { sql: ATTENTION_UNASSIGNED_BLOCKED_SQL, params: [workspaceId, S] },
      count: { sql: ATTENTION_UNASSIGNED_BLOCKED_COUNT_SQL, params: [workspaceId] },
    },
    {
      key: "teamBlocked",
      list: { sql: ATTENTION_TEAM_BLOCKED_SQL, params: [workspaceId, req.canTaskUpdate ? 1 : 0, actorId, actorType, S] },
      count: { sql: ATTENTION_TEAM_BLOCKED_COUNT_SQL, params: [workspaceId, req.canTaskUpdate ? 1 : 0, actorId, actorType] },
    },
    {
      key: "proposedDecisions",
      list: { sql: ATTENTION_PROPOSED_DECISIONS_SQL, params: [workspaceId, S] },
      count: { sql: ATTENTION_PROPOSED_DECISIONS_COUNT_SQL, params: [workspaceId] },
    },
  );
  if (req.includeReview) {
    plan.push({
      key: "awaitingReview",
      list: { sql: ATTENTION_AWAITING_REVIEW_SQL, params: [workspaceId, S] },
      count: { sql: ATTENTION_AWAITING_REVIEW_COUNT_SQL, params: [workspaceId] },
    });
  }
  return plan;
}

export interface AttentionTaskSqlRow { id: string; title: string; updated_at: string }
export interface AttentionDecisionSqlRow { id: string; summary: string; updated_at: string }
export interface AttentionProposalSqlRow { id: string; updated_at: string; expires_at: string }
export interface AttentionCountSqlRow { n: number | bigint | string }

export interface AttentionScanResult {
  key: AttentionScanKey;
  rows: readonly unknown[];
  count: AttentionCountSqlRow | undefined;
}

const EMPTY: AttentionSourceScan<never> = { total: 0, rows: [] };

function scanOf<R, T>(result: AttentionScanResult | undefined, map: (row: R) => T): AttentionSourceScan<T> {
  if (result === undefined) return EMPTY;
  const rows = (result.rows as R[]).slice(0, ATTENTION_SCAN_CEILING).map(map);
  return { total: Number(result.count?.n ?? 0), rows };
}

export interface AttentionTipSqlRow { id: string; created_at: string; append_position: number | bigint | string }

export function assembleAttentionSnapshot(input: {
  tip: AttentionTipSqlRow | undefined;
  memoryHealth: MemoryHealthRows;
  scans: readonly AttentionScanResult[];
}): AttentionSnapshot {
  const by = (key: AttentionScanKey) => input.scans.find((scan) => scan.key === key);
  const task = (row: AttentionTaskSqlRow): AttentionTaskRow => ({ id: row.id, title: row.title, updatedAt: row.updated_at });
  const decision = (row: AttentionDecisionSqlRow): AttentionDecisionRow => ({ id: row.id, summary: row.summary, updatedAt: row.updated_at });
  const proposal = (row: AttentionProposalSqlRow): AttentionProposalRow => ({ id: row.id, updatedAt: row.updated_at, expiresAt: row.expires_at });
  const review = by("awaitingReview");
  return {
    ...(input.tip === undefined
      ? {}
      : { tip: { id: input.tip.id, createdAt: input.tip.created_at, appendPosition: Number(input.tip.append_position) } }),
    memoryHealth: input.memoryHealth,
    assignedBlocked: scanOf(by("assignedBlocked"), task),
    assignedOpen: scanOf(by("assignedOpen"), task),
    unassignedBlocked: scanOf(by("unassignedBlocked"), task),
    teamBlocked: scanOf(by("teamBlocked"), task),
    proposedDecisions: scanOf(by("proposedDecisions"), decision),
    ...(review === undefined ? {} : { awaitingReview: scanOf(review, proposal) }),
  };
}
