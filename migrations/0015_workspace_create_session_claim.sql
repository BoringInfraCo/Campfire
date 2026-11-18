-- One session chosen by a retryable create_workspace for an agent and workspace.
-- Direct register_agent_session is not limited by this row. The row stores no token.
CREATE TABLE IF NOT EXISTS workspace_create_session_claims (
  agent_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (agent_id, workspace_id)
);
