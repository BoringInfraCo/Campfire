-- Sprint 020 expiring enrollment capabilities and managed connection slots.
CREATE TABLE IF NOT EXISTS enrollment_invitations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  team_id TEXT NOT NULL REFERENCES teams(id),
  issued_by_human_id TEXT NOT NULL REFERENCES humans(id),
  secret_hash TEXT NOT NULL UNIQUE,
  permitted_harnesses TEXT NOT NULL CHECK (json_valid(permitted_harnesses)),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  consumed_at TEXT,
  request_id TEXT,
  request_digest TEXT,
  receipt_json TEXT,
  claim_nonce TEXT NOT NULL,
  CHECK (expires_at > created_at),
  CHECK ((consumed_at IS NULL AND request_id IS NULL AND request_digest IS NULL AND receipt_json IS NULL)
      OR (consumed_at IS NOT NULL AND request_id IS NOT NULL AND request_digest IS NOT NULL AND receipt_json IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_enrollment_workspace ON enrollment_invitations(workspace_id, created_at);

-- Only the managed connection slots introduced by enrollment. This does not
-- constrain legacy agent identities, or impose a global harness uniqueness rule.
CREATE TABLE IF NOT EXISTS managed_agent_slots (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  human_id TEXT NOT NULL REFERENCES humans(id),
  harness TEXT NOT NULL CHECK (harness IN ('codex', 'opencode')),
  request_id TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  receipt_json TEXT NOT NULL CHECK (json_valid(receipt_json)),
  claim_nonce TEXT NOT NULL,
  PRIMARY KEY (workspace_id, human_id, harness)
);
