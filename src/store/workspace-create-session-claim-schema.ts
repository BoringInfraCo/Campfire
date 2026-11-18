/**
 * Bundled counterpart of migrations/0015_workspace_create_session_claim.sql.
 * Fresh and existing SQLite databases get the table from ensureWorkspaceCreateSessionClaim.
 * D1 gets it from migrateD1. The primary key makes a concurrent retryable session claim fail
 * closed into the winning session. The row stores no token and no secret.
 */
export const V15_SQL = `
CREATE TABLE IF NOT EXISTS workspace_create_session_claims (
  agent_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (agent_id, workspace_id)
);
`.trim();

export function isWorkspaceCreateSessionClaimConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error && typeof error.code === "string" ? error.code : "";
  const message = "message" in error && typeof error.message === "string" ? error.message : "";
  const constraint = code.startsWith("SQLITE_CONSTRAINT")
    || /unique constraint failed/i.test(message)
    || /primary key/i.test(message)
    || /already exists/i.test(message);
  return constraint && message.includes("workspace_create_session_claims");
}
