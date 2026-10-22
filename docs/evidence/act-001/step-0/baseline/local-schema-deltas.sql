/** Sprint 020 schema shared verbatim by local migrations and the Worker bundle. */
export const V5_SQL = `
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
`.trim();
/**
 * v6 contribution append order, shared by local migrations and the Worker bundle.
 * `migrations.ts` reads `schema.sql` with `node:fs`, which Workers do not have.
 * Catch-up pages this order. Contribution ids are random, so they are not monotonic.
 * The backfill follows `created_at, rowid` and does not rewrite payloads.
 */
export const V6_ADD_COLUMN_SQL = "ALTER TABLE contributions ADD COLUMN append_position INTEGER NOT NULL DEFAULT 0";

export const V6_BACKFILL_SQL = `
UPDATE contributions
SET append_position = (
  SELECT COUNT(*)
  FROM contributions AS earlier
  WHERE earlier.workspace_id = contributions.workspace_id
    AND (
      earlier.created_at < contributions.created_at
      OR (earlier.created_at = contributions.created_at AND earlier.rowid <= contributions.rowid)
    )
)
WHERE append_position = 0
`.trim();

export const V6_INDEX_SQL = `
CREATE UNIQUE INDEX IF NOT EXISTS idx_contributions_workspace_position
  ON contributions(workspace_id, append_position)
`.trim();

export const V6_SQL = `${V6_ADD_COLUMN_SQL};\n\n${V6_BACKFILL_SQL};\n\n${V6_INDEX_SQL}`;
/**
 * v7 correct-the-record columns, shared by local migrations and the Worker bundle.
 *
 * `migrations.ts` skips this script when `findings.currentness` already exists.
 * The SQL itself is the one-time delta: a second ALTER of the same column fails.
 * Existing finding rows default to `current`. No correction actor or reason is invented.
 * Decision `predecessor_id` is not unique: several proposed replacements may cite
 * one accepted decision. Acceptance claims the single successor.
 */
export const V7_SQL = `
ALTER TABLE findings ADD COLUMN currentness TEXT NOT NULL DEFAULT 'current';
ALTER TABLE findings ADD COLUMN predecessor_id TEXT REFERENCES findings(id);
ALTER TABLE findings ADD COLUMN successor_id TEXT REFERENCES findings(id);
ALTER TABLE findings ADD COLUMN correction_reason TEXT;
ALTER TABLE findings ADD COLUMN corrected_by_actor_id TEXT;
ALTER TABLE findings ADD COLUMN corrected_by_actor_type TEXT;
ALTER TABLE findings ADD COLUMN corrected_session_id TEXT REFERENCES agent_sessions(id);
ALTER TABLE findings ADD COLUMN corrected_at TEXT;

ALTER TABLE decisions ADD COLUMN predecessor_id TEXT REFERENCES decisions(id);
ALTER TABLE decisions ADD COLUMN successor_id TEXT REFERENCES decisions(id);
ALTER TABLE decisions ADD COLUMN supersede_reason TEXT;
ALTER TABLE decisions ADD COLUMN superseded_by_actor_id TEXT;
ALTER TABLE decisions ADD COLUMN superseded_by_actor_type TEXT;
ALTER TABLE decisions ADD COLUMN superseded_session_id TEXT REFERENCES agent_sessions(id);
ALTER TABLE decisions ADD COLUMN superseded_at TEXT;

CREATE TABLE IF NOT EXISTS finding_transitions (
  finding_id TEXT PRIMARY KEY REFERENCES findings(id),
  successor_id TEXT UNIQUE REFERENCES findings(id),
  kind TEXT NOT NULL CHECK (kind IN ('superseded', 'withdrawn')),
  reason TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  agent_session_id TEXT REFERENCES agent_sessions(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS decision_transitions (
  decision_id TEXT PRIMARY KEY REFERENCES decisions(id),
  successor_id TEXT UNIQUE REFERENCES decisions(id),
  kind TEXT NOT NULL CHECK (kind IN ('superseded', 'rejected')),
  reason TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  agent_session_id TEXT REFERENCES agent_sessions(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS finding_evidence (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  finding_id TEXT NOT NULL REFERENCES findings(id),
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  relation TEXT NOT NULL CHECK (relation IN ('supports', 'contradicts')),
  note TEXT,
  actor_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  agent_session_id TEXT REFERENCES agent_sessions(id),
  created_at TEXT NOT NULL,
  UNIQUE (finding_id, artifact_id)
);

CREATE TABLE IF NOT EXISTS decision_citations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  decision_id TEXT NOT NULL REFERENCES decisions(id),
  finding_id TEXT NOT NULL REFERENCES findings(id),
  note TEXT,
  actor_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  agent_session_id TEXT REFERENCES agent_sessions(id),
  created_at TEXT NOT NULL,
  UNIQUE (decision_id, finding_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_findings_successor_id
  ON findings(successor_id) WHERE successor_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_findings_predecessor_id
  ON findings(predecessor_id) WHERE predecessor_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_decisions_successor_id
  ON decisions(successor_id) WHERE successor_id IS NOT NULL
`.trim();
/**
 * v8 per-record history access path.
 *
 * `idx_contributions_workspace_position` constrains only `workspace_id` when a
 * query also filters object type and id, so it walks every contribution in the
 * workspace. This index is the workspace/type/id/position path. Catch-up keeps
 * using the append-position index. The statement is idempotent.
 */
export const V8_SQL = `
CREATE INDEX IF NOT EXISTS idx_contributions_object_position
  ON contributions(workspace_id, object_type, object_id, append_position)
`.trim();
