-- SES-001 A2 (Cycle 2): owner-shared session watch. One share record per session:
-- who shared it, when, and when it was revoked. No terminal text, prompt, path, or
-- secret is stored. A re-share replaces shared_by/shared_at and clears revoked_at.
CREATE TABLE IF NOT EXISTS agent_session_shares (
  session_id TEXT PRIMARY KEY REFERENCES agent_sessions(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  shared_by TEXT NOT NULL,
  shared_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_session_shares_workspace
  ON agent_session_shares(workspace_id, revoked_at);
CREATE INDEX IF NOT EXISTS idx_contributions_agent_session
  ON contributions(workspace_id, agent_session_id, append_position);
