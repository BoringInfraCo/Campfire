/**
 * Bundled counterpart of migrations/0014_workspace_create_request.sql.
 * Fresh and existing SQLite databases get the table from ensureWorkspaceCreateRequest.
 * D1 gets it from migrateD1. The unique index makes a concurrent duplicate request id fail
 * closed into the replay path. The row stores no token and no secret.
 */
export const V14_SQL = `
CREATE TABLE IF NOT EXISTS workspace_create_requests (
  actor_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  request_id TEXT NOT NULL,
  body_digest TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_create_request
  ON workspace_create_requests(actor_id, actor_type, request_id);
`.trim();

export function isWorkspaceCreateRequestConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error && typeof error.code === "string" ? error.code : "";
  const message = "message" in error && typeof error.message === "string" ? error.message : "";
  const constraint = code.startsWith("SQLITE_CONSTRAINT")
    || /unique constraint failed/i.test(message)
    || /primary key/i.test(message)
    || /already exists/i.test(message);
  return constraint && (message.includes("workspace_create_requests") || message.includes("idx_workspace_create_request"));
}
