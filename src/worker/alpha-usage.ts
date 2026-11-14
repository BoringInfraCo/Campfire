/**
 * CLO-001 operating budgets for published Cloud alpha teams.
 *
 * A conditional D1 upsert is the admission point for each metered call. Edge
 * rate limits are useful against bursts, but cannot enforce a team-wide cap
 * across locations or simultaneous agents. Counters intentionally contain no
 * workspace content, bearer token, IP address, or request parameters.
 */
import type { ActorRef } from "../domain/types.js";
import type { AsyncCampfireStore } from "./d1-store.js";
import type { D1Database } from "./d1-types.js";

export type AlphaUsageCategory = "write" | "invitation" | "read";
export type AlphaUsageVerdict = "allowed" | "limited" | "stopped" | "unavailable";

/** Conservative invited-alpha defaults; a later plan needs measured usage. */
export const ALPHA_DAILY_LIMITS: Readonly<Record<AlphaUsageCategory, number>> = {
  write: 300,
  invitation: 20,
  read: 3_000,
};

const FREE_READS = new Set(["preflight", "whoami", "list_workspaces"]);
const SAFETY_WRITES = new Set([
  "revoke_enrollment_invitation",
  "revoke_token",
  "end_agent_session",
  "cancel_action",
]);
const CONTENT_READS = new Set([
  "get_workspace", "get_workspace_context", "get_workspace_changes",
  "recall_workspace", "get_memory_health", "get_workspace_attention", "project_handoff_packet", "list_decisions",
  "list_findings", "list_tasks", "list_artifacts", "get_decision",
  "get_finding", "get_task", "get_artifact", "get_activity",
  "list_workspace_participants", "get_record_history", "get_action_proposal",
  "list_action_proposals", "list_action_receipts",
  // SES-001 observations. A heartbeat is not a canonical workspace write.
  "list_agent_sessions", "report_agent_session_runtime",
]);

export function alphaUsageCategory(method: string): AlphaUsageCategory | undefined {
  if (FREE_READS.has(method) || SAFETY_WRITES.has(method)) return undefined;
  if (CONTENT_READS.has(method)) return "read";
  if (method === "issue_enrollment_invitation" || method === "invite_workspace") return "invitation";
  // Every new HTTP method is metered as a write until deliberately classified.
  return "write";
}

function dayBucket(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid alpha usage clock");
  return `${date.toISOString().slice(0, 10)}T00:00:00.000Z`;
}

async function actorTeam(store: AsyncCampfireStore, actor: ActorRef): Promise<string | undefined> {
  return actor.actorType === "human"
    ? (await store.getHuman(actor.actorId))?.teamId
    : (await store.getAgent(actor.actorId))?.teamId;
}

/** Only publication-imported teams are subject to the alpha switch and caps. */
async function isPublishedAlphaTeam(db: D1Database, teamId: string): Promise<boolean> {
  const row = await db.prepare(
    `SELECT 1 AS published FROM workspace_publications AS p
     JOIN workspaces AS w ON w.id = p.workspace_id
     WHERE w.team_id = ? LIMIT 1`,
  ).bind(teamId).first<{ published: number }>();
  return row !== null;
}

export interface AlphaUsageOptions {
  db: D1Database;
  store: AsyncCampfireStore;
  /** Exact "1" permits expensive writes. All other values stop them. */
  expensiveWritesEnabled: boolean;
  now?: () => string;
  limits?: Readonly<Record<AlphaUsageCategory, number>>;
}

export async function checkAlphaUsage(
  options: AlphaUsageOptions | undefined,
  actor: ActorRef,
  method: string,
): Promise<AlphaUsageVerdict> {
  if (options === undefined) return "allowed"; // local/test handlers need no hosted budget
  const category = alphaUsageCategory(method);
  if (category === undefined) return "allowed";
  try {
    const teamId = await actorTeam(options.store, actor);
    if (teamId === undefined || !(await isPublishedAlphaTeam(options.db, teamId))) return "allowed";
    if (category !== "read" && !options.expensiveWritesEnabled) return "stopped";
    const at = (options.now ?? (() => new Date().toISOString()))();
    const max = (options.limits ?? ALPHA_DAILY_LIMITS)[category];
    if (!Number.isInteger(max) || max < 1) return "unavailable";
    const row = await options.db.prepare(
      `INSERT INTO alpha_usage_buckets (team_id, category, window_start, used, updated_at)
       VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(team_id, category, window_start) DO UPDATE
       SET used = alpha_usage_buckets.used + 1, updated_at = excluded.updated_at
       WHERE alpha_usage_buckets.used < ?
       RETURNING used`,
    ).bind(teamId, category, dayBucket(at), at, max).first<{ used: number }>();
    return row === null ? "limited" : "allowed";
  } catch {
    // A missing migration or failed D1 call must never bypass a Cloud cap.
    return "unavailable";
  }
}
