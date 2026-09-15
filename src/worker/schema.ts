/**
 * Bundled schema text for Workers.
 *
 * `src/store/migrations.ts` loads `schema.sql` via `node:fs`, which does not
 * exist in Workers. This module bundles the same file as a Text module
 * (`rules` in wrangler.toml; Vitest inlines it via a local plugin) so D1
 * migrations execute the identical schema via `db.exec`.
 */
import SCHEMA_SQL from "../store/schema.sql";

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

export const CAMPFIRE_D1_SCHEMA_SQL: string = `${SCHEMA_SQL}\n${V2_SQL}`;
