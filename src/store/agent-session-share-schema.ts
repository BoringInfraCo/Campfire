import type { AgentSessionShare } from "../domain/session-watch.js";

/**
 * Bundled counterpart of migrations/0016_agent_session_shares.sql.
 * SQLite gets it from ensureAgentSessionShares, D1 from migrateD1. The row holds
 * identities and timestamps only: no terminal text, prompt, path, or secret.
 */
export const V16_SQL = `
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
`.trim();

export interface AgentSessionShareRow {
  session_id: string;
  workspace_id: string;
  shared_by: string;
  shared_at: string;
  revoked_at: string | null;
}

export function mapShare(row: AgentSessionShareRow): AgentSessionShare {
  return {
    sessionId: row.session_id,
    workspaceId: row.workspace_id,
    sharedBy: row.shared_by,
    sharedAt: row.shared_at,
    ...(row.revoked_at === null ? {} : { revokedAt: row.revoked_at }),
  };
}
