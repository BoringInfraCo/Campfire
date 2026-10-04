-- COR-001: findings and decisions gain explicit currentness, transitions, evidence, and citations. Historical text is not rewritten.
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
  ON decisions(successor_id) WHERE successor_id IS NOT NULL;
