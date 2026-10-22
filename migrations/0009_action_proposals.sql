-- ACT-001 action proposals: current state, append-only receipts, mutation idempotency.
CREATE TABLE IF NOT EXISTS action_proposals (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  kind TEXT NOT NULL CHECK (kind = 'ci.retry_verification'),
  intent_version INTEGER NOT NULL CHECK (intent_version = 1),
  intent_json TEXT NOT NULL CHECK (json_valid(intent_json)),
  intent_digest TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  finding_ids_json TEXT NOT NULL CHECK (json_valid(finding_ids_json)),
  artifact_ids_json TEXT NOT NULL CHECK (json_valid(artifact_ids_json)),
  source_authority_revision TEXT NOT NULL,
  proposed_by_actor_id TEXT NOT NULL,
  proposed_by_actor_type TEXT NOT NULL CHECK (proposed_by_actor_type IN ('human', 'agent')),
  proposed_session_id TEXT,
  proposed_at TEXT NOT NULL,
  review_actor_id TEXT,
  review_actor_type TEXT,
  review_session_id TEXT,
  review_at TEXT,
  review_reason TEXT,
  review_revision INTEGER,
  reservation_actor_id TEXT,
  reservation_actor_type TEXT,
  reservation_session_id TEXT,
  reserved_at TEXT,
  reservation_id TEXT,
  reservation_revision INTEGER,
  evidence_snapshot_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('proposed', 'approved', 'rejected', 'cancelled', 'dispatch_reserved', 'submission_accepted', 'submission_failed', 'submission_unknown')),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  target_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_action_proposals_workspace ON action_proposals(workspace_id, updated_at, id);

-- One dispatch reservation per exact provider target/attempt. Never deleted:
-- the key survives terminal receipts and crashes so two separately approved
-- proposals cannot reserve the same retry.
CREATE TABLE IF NOT EXISTS action_target_reservations (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  target_key TEXT NOT NULL,
  proposal_id TEXT NOT NULL REFERENCES action_proposals(id),
  reservation_id TEXT NOT NULL,
  reserved_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, target_key)
);

-- Append-only submission/reconciliation receipts. (proposal_id,
-- recorded_by_actor_id, recorded_by_actor_type, request_key) is unique so a
-- retried report cannot append the same receipt twice. The scope includes the
-- recorder so two actors may use the same key without colliding (contract:
-- workspace+actor+method+key); equal input still replays via the mutation
-- receipt, unequal input conflicts.
CREATE TABLE IF NOT EXISTS action_receipts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  proposal_id TEXT NOT NULL REFERENCES action_proposals(id),
  reservation_id TEXT NOT NULL,
  intent_digest TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('accepted', 'definite_failure', 'unknown', 'reconciled_accepted', 'reconciled_failure')),
  resolves_receipt_id TEXT REFERENCES action_receipts(id),
  provider_ref_json TEXT NOT NULL CHECK (json_valid(provider_ref_json)),
  recorded_by_actor_id TEXT NOT NULL,
  recorded_by_actor_type TEXT NOT NULL CHECK (recorded_by_actor_type IN ('human', 'agent')),
  recorded_session_id TEXT,
  recorded_at TEXT NOT NULL,
  request_key TEXT NOT NULL,
  UNIQUE (proposal_id, recorded_by_actor_id, recorded_by_actor_type, request_key)
);
CREATE INDEX IF NOT EXISTS idx_action_receipts_proposal ON action_receipts(workspace_id, proposal_id, recorded_at, id);

-- Mutation idempotency: scoped to workspace, actor, method, and requestKey.
-- Equal normalized input replays the prior result; unequal input conflicts.
CREATE TABLE IF NOT EXISTS action_mutation_receipts (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  actor_id TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('human', 'agent')),
  method TEXT NOT NULL,
  request_key TEXT NOT NULL,
  input_digest TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK (json_valid(result_json)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, actor_id, actor_type, method, request_key)
);

-- Operator-bound inbound source, persisted on first use. Secret is never stored.
-- Session/secret renewal keeps this row; workspace/target/actor changes need a new source id.
CREATE TABLE IF NOT EXISTS github_source_bindings (
  source_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  repository_id TEXT NOT NULL,
  repository_name TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  action_kind TEXT NOT NULL CHECK (action_kind = 'ci.retry_verification'),
  integration_agent_id TEXT NOT NULL,
  authority_fingerprint TEXT NOT NULL,
  first_used_at TEXT NOT NULL
);

-- Unique source/delivery identity. Reusing a delivery id for different bytes conflicts.
CREATE TABLE IF NOT EXISTS github_ingress_deliveries (
  source_id TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  payload_digest TEXT NOT NULL,
  received_at TEXT NOT NULL,
  PRIMARY KEY (source_id, delivery_id)
);

-- Semantic uniqueness over workspace, provider, repository, workflow, run, attempt,
-- and completion event. Independent of source id and secret.
CREATE TABLE IF NOT EXISTS github_ingress_receipts (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  attempt_key TEXT NOT NULL,
  semantic_key TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider = 'github'),
  repository_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  conclusion TEXT NOT NULL,
  event_kind TEXT NOT NULL CHECK (event_kind = 'workflow_run.completed'),
  payload_digest TEXT NOT NULL,
  provider_timestamp TEXT NOT NULL,
  received_at TEXT NOT NULL,
  source_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL REFERENCES action_proposals(id),
  reservation_id TEXT NOT NULL,
  finding_id TEXT NOT NULL REFERENCES findings(id),
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  PRIMARY KEY (workspace_id, attempt_key)
);
CREATE INDEX IF NOT EXISTS idx_github_ingress_receipts_proposal
  ON github_ingress_receipts(workspace_id, proposal_id, received_at, finding_id);
