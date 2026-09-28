-- Sprint 019 outbox. Mirrors src/store/migrations.ts v3.

CREATE TABLE IF NOT EXISTS domain_events (
  id TEXT PRIMARY KEY,
  spec_version TEXT NOT NULL,
  type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  actor_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  data TEXT NOT NULL,
  body TEXT NOT NULL,
  contribution_id TEXT NOT NULL REFERENCES contributions(id),
  agent_session_id TEXT,
  on_behalf_of_actor_id TEXT,
  on_behalf_of_actor_type TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_domain_events_workspace ON domain_events(workspace_id, occurred_at);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES domain_events(id),
  bridge_id TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL,
  next_attempt_at TEXT,
  claimed_at TEXT,
  claim_token TEXT,
  last_error TEXT,
  delivered_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_due ON webhook_deliveries(bridge_id, status, next_attempt_at);
