/**
 * SES-001 session attachment and operational reports.
 *
 * SQLite applies this as schema version 11, guarded so a fresh `schema.sql`
 * that already has the column does not fail the ALTER. D1 migration
 * `migrations/0012_agent_session_runtime.sql` is the same change for a
 * database created from `0001`. Runtime rows are not part of a publication
 * snapshot.
 */

export const SESSION_TASK_COLUMN_SQL =
  "ALTER TABLE agent_sessions ADD COLUMN task_id TEXT";

export const SESSION_RUNTIME_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS agent_session_runtime_reports (
  session_id TEXT PRIMARY KEY REFERENCES agent_sessions(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  task_id TEXT NOT NULL REFERENCES tasks(id),
  state TEXT NOT NULL,
  origin TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  reported_at TEXT NOT NULL,
  expires_at TEXT,
  exit_code INTEGER,
  failure_kind TEXT
);
CREATE INDEX IF NOT EXISTS idx_session_runtime_workspace
  ON agent_session_runtime_reports(workspace_id, reported_at);
`.trim();
