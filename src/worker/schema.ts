/**
 * Bundled schema text for Workers.
 *
 * `src/store/migrations.ts` loads `schema.sql` via `node:fs`, which does not
 * exist in Workers. This module bundles the same file as a Text module
 * (`rules` in wrangler.toml; Vitest inlines it via a local plugin) so D1
 * migrations execute the identical schema via `db.exec`.
 */
import SCHEMA_SQL from "../store/schema.sql";
import { V5_SQL } from "../store/enrollment-schema.js";
import { V6_SQL } from "../store/contribution-position-schema.js";
import { V7_SQL } from "../store/correction-schema.js";
export { V5_SQL } from "../store/enrollment-schema.js";
export { V6_SQL } from "../store/contribution-position-schema.js";
export { V7_SQL } from "../store/correction-schema.js";

/** v2 delta: actor tokens + workspace invites (mirrors migrations.ts v2). */
export const V2_SQL = `
CREATE TABLE IF NOT EXISTS actor_tokens (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_actor_tokens_hash ON actor_tokens(token_hash);

CREATE TABLE IF NOT EXISTS workspace_invites (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  actor_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  role TEXT NOT NULL,
  invited_by_actor_id TEXT NOT NULL,
  invited_by_actor_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  consumed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_invites_workspace_actor ON workspace_invites(workspace_id, actor_id, actor_type);
`;

/** v3 delta: domain events and webhook deliveries (mirrors migrations.ts v3). */
export const V3_SQL = `
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
`.trim();

/** v4 delta: destination fingerprint + legacy queue quarantine (mirrors migrations.ts v4). */
export const V4_SQL = `ALTER TABLE webhook_deliveries ADD COLUMN config_fingerprint TEXT;
UPDATE webhook_deliveries
SET status = 'exhausted',
    next_attempt_at = NULL,
    claim_token = NULL,
    claimed_at = NULL,
    last_error = 'queued before destination fingerprinting; repeat the mutation with the current bridge configuration',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE config_fingerprint IS NULL AND status IN ('pending', 'delivering')`;

export const CAMPFIRE_D1_SCHEMA_SQL: string = `${SCHEMA_SQL}\n${V2_SQL}\n${V3_SQL}\n${V4_SQL};\n${V5_SQL}\n${V6_SQL};\n${V7_SQL};\n`;
