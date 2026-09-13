-- Campfire v1 schema (migration version 1).
-- Deliberately small, explicit, inspectable. No transcript storage.
-- JSON is used only for genuinely flexible auxiliary metadata.
-- Versioning is owned by src/store/migrations.ts; do not add columns here.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     INTEGER PRIMARY KEY,
  applied_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS organizations (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS teams (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name            TEXT NOT NULL,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS humans (
  id                TEXT PRIMARY KEY,
  team_id           TEXT NOT NULL REFERENCES teams(id),
  display_name      TEXT NOT NULL,
  external_identity TEXT,
  created_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id                  TEXT PRIMARY KEY,
  team_id             TEXT NOT NULL REFERENCES teams(id),
  human_id            TEXT REFERENCES humans(id),
  name                TEXT NOT NULL,
  harness             TEXT NOT NULL,
  model               TEXT,
  instance_metadata   TEXT,
  created_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspaces (
  id                   TEXT PRIMARY KEY,
  team_id              TEXT NOT NULL REFERENCES teams(id),
  name                 TEXT NOT NULL,
  description          TEXT,
  status               TEXT NOT NULL,
  created_by_actor_id  TEXT NOT NULL,
  created_by_actor_type TEXT NOT NULL,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_participants (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  actor_id     TEXT NOT NULL,
  actor_type   TEXT NOT NULL,
  role         TEXT NOT NULL,
  joined_at    TEXT NOT NULL,
  PRIMARY KEY (workspace_id, actor_id, actor_type)
);

CREATE TABLE IF NOT EXISTS agent_sessions (
  id           TEXT PRIMARY KEY,
  agent_id     TEXT NOT NULL REFERENCES agents(id),
  human_id     TEXT NOT NULL REFERENCES humans(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  harness      TEXT NOT NULL,
  started_at   TEXT NOT NULL,
  ended_at     TEXT
);

CREATE TABLE IF NOT EXISTS goals (
  id                      TEXT PRIMARY KEY,
  workspace_id            TEXT NOT NULL REFERENCES workspaces(id),
  title                   TEXT NOT NULL,
  description             TEXT,
  status                  TEXT NOT NULL,
  created_by_actor_id     TEXT NOT NULL,
  created_by_actor_type   TEXT NOT NULL,
  agent_session_id        TEXT REFERENCES agent_sessions(id),
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id                      TEXT PRIMARY KEY,
  workspace_id            TEXT NOT NULL REFERENCES workspaces(id),
  title                   TEXT NOT NULL,
  description             TEXT,
  status                  TEXT NOT NULL,
  assignee_actor_id       TEXT,
  assignee_actor_type     TEXT,
  created_by_actor_id     TEXT NOT NULL,
  created_by_actor_type   TEXT NOT NULL,
  agent_session_id        TEXT REFERENCES agent_sessions(id),
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS findings (
  id                      TEXT PRIMARY KEY,
  workspace_id            TEXT NOT NULL REFERENCES workspaces(id),
  summary                 TEXT NOT NULL,
  detail                  TEXT,
  confidence              REAL,
  source_artifact_id      TEXT REFERENCES artifacts(id),
  created_by_actor_id     TEXT NOT NULL,
  created_by_actor_type   TEXT NOT NULL,
  agent_session_id        TEXT REFERENCES agent_sessions(id),
  created_at              TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS decisions (
  id                      TEXT PRIMARY KEY,
  workspace_id            TEXT NOT NULL REFERENCES workspaces(id),
  summary                 TEXT NOT NULL,
  rationale               TEXT,
  status                  TEXT NOT NULL,
  approved_by_actor_id    TEXT,
  approved_by_actor_type  TEXT,
  created_by_actor_id     TEXT NOT NULL,
  created_by_actor_type   TEXT NOT NULL,
  agent_session_id        TEXT REFERENCES agent_sessions(id),
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifacts (
  id                      TEXT PRIMARY KEY,
  workspace_id            TEXT NOT NULL REFERENCES workspaces(id),
  type                    TEXT NOT NULL,
  title                   TEXT NOT NULL,
  uri_or_path             TEXT NOT NULL,
  metadata                TEXT,
  created_by_actor_id     TEXT NOT NULL,
  created_by_actor_type   TEXT NOT NULL,
  agent_session_id        TEXT REFERENCES agent_sessions(id),
  created_at              TEXT NOT NULL
);

-- Append-only activity / provenance log. Rows are never updated or deleted.
CREATE TABLE IF NOT EXISTS contributions (
  id                      TEXT PRIMARY KEY,
  workspace_id            TEXT NOT NULL REFERENCES workspaces(id),
  actor_id                TEXT NOT NULL,
  actor_type              TEXT NOT NULL,
  agent_session_id        TEXT REFERENCES agent_sessions(id),
  action                  TEXT NOT NULL,
  object_type             TEXT NOT NULL,
  object_id               TEXT NOT NULL,
  payload                 TEXT,
  created_at              TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_participants_workspace ON workspace_participants(workspace_id);
CREATE INDEX IF NOT EXISTS idx_contributions_workspace ON contributions(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_findings_workspace ON findings(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_decisions_workspace ON decisions(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_artifacts_workspace ON artifacts(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON agent_sessions(workspace_id);
