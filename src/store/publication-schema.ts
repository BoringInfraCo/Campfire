/**
 * SHR-001 hosted publication state.
 *
 * Enrollment creates only the first human owner, a private organization/team,
 * and fresh token hashes. Import is one atomic D1 batch and records a request
 * digest so an exact retry is inert and changed content conflicts.
 */
export const V11_SQL = `
CREATE TABLE IF NOT EXISTS publication_enrollments (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  human_id TEXT NOT NULL UNIQUE REFERENCES humans(id),
  human_name TEXT NOT NULL,
  human_token_hash TEXT NOT NULL UNIQUE,
  recovery_hash TEXT NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  team_id TEXT NOT NULL REFERENCES teams(id),
  source_workspace_id TEXT NOT NULL,
  source_package_version TEXT NOT NULL,
  source_schema_version INTEGER NOT NULL,
  workspace_name TEXT NOT NULL,
  device_key_hash TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  receipt_json TEXT NOT NULL CHECK (json_valid(receipt_json)),
  claim_nonce TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_publication_enrollments_source
  ON publication_enrollments(source_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_publication_enrollments_created
  ON publication_enrollments(created_at);

-- Bounds wrong/missing rehearsal admission codes even when the alpha is on.
-- One row per source and fixed UTC hour; no request body or code is stored.
CREATE TABLE IF NOT EXISTS publication_admission_attempts (
  source_hash TEXT NOT NULL,
  window_start TEXT NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts >= 1),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (source_hash, window_start)
);

CREATE TABLE IF NOT EXISTS workspace_publications (
  id TEXT PRIMARY KEY,
  owner_human_id TEXT NOT NULL UNIQUE REFERENCES humans(id),
  workspace_id TEXT NOT NULL UNIQUE REFERENCES workspaces(id),
  request_id TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  source_tip INTEGER NOT NULL,
  counts_json TEXT NOT NULL CHECK (json_valid(counts_json)),
  receipt_json TEXT NOT NULL CHECK (json_valid(receipt_json)),
  committed_at TEXT NOT NULL,
  UNIQUE (owner_human_id, request_id)
);
CREATE INDEX IF NOT EXISTS idx_workspace_publications_request
  ON workspace_publications(request_id);
`.trim();
