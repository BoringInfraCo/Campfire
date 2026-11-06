-- SES-001: optional task attachment and the latest operational runtime report.
-- Runtime rows are not workspace records and are not published.
ALTER TABLE agent_sessions ADD COLUMN task_id TEXT;

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
