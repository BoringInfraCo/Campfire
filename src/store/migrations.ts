/**
 * Deterministic SQLite migrations.
 *
 * Sprint 001/002 applied `schema.sql` with CREATE TABLE IF NOT EXISTS and never
 * wrote `schema_migrations`. That cannot evolve columns. Open now records a
 * version and applies pending migrations in order.
 */
import { readFileSync } from "node:fs";
import type Database from "better-sqlite3";
import { V5_SQL } from "./enrollment-schema.js";
export { V5_SQL } from "./enrollment-schema.js";

export const CURRENT_SCHEMA_VERSION = 5;

/** Sprint 019 outbox. Identical to migrations/0002 and worker schema V3_SQL. */
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

/** Binds a queued delivery to the destination it was created for. */
export const V4_ADD_COLUMN_SQL = "ALTER TABLE webhook_deliveries ADD COLUMN config_fingerprint TEXT";

/**
 * Rows queued before v4 have no destination fingerprint. The destination they
 * were queued for cannot be reconstructed without the secret, so they must not
 * be sent under whatever destination happens to be configured now. They stay
 * inspectable as `exhausted` instead of silently pending forever.
 */
export const V4_EXHAUST_LEGACY_SQL = `
UPDATE webhook_deliveries
SET status = 'exhausted',
    next_attempt_at = NULL,
    claim_token = NULL,
    claimed_at = NULL,
    last_error = 'queued before destination fingerprinting; repeat the mutation with the current bridge configuration',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE config_fingerprint IS NULL AND status IN ('pending', 'delivering')
`.trim();

export const V4_SQL = `${V4_ADD_COLUMN_SQL};\n${V4_EXHAUST_LEGACY_SQL}`;

const SCHEMA_SQL = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

interface Migration {
  version: number;
  up: (db: Database.Database) => void;
}

const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    up: (db) => {
      db.exec(SCHEMA_SQL);
    },
  },
  {
    version: 2,
    up: (db) => {
      db.exec(`
        CREATE TABLE actor_tokens (
          id TEXT PRIMARY KEY,
          actor_id TEXT NOT NULL,
          actor_type TEXT NOT NULL,
          token_hash TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          revoked_at TEXT
        );
        CREATE INDEX idx_actor_tokens_hash ON actor_tokens(token_hash);

        CREATE TABLE workspace_invites (
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
        CREATE INDEX idx_invites_workspace_actor ON workspace_invites(workspace_id, actor_id, actor_type);
      `);
    },
  },
  {
    version: 3,
    up: (db) => {
      db.exec(V3_SQL);
    },
  },
  {
    version: 4,
    up: (db) => {
      const columns = db.prepare("PRAGMA table_info(webhook_deliveries)").all() as Array<{ name: string }>;
      if (!columns.some((column) => column.name === "config_fingerprint")) {
        db.exec(`${V4_ADD_COLUMN_SQL};`);
      }
      db.exec(`${V4_EXHAUST_LEGACY_SQL};`);
    },
  },
  { version: 5, up: (db) => { db.exec(V5_SQL); } },
];

function currentVersion(db: Database.Database): number {
  const row = db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as {
    version: number | null;
  };
  return row.version ?? 0;
}

function hasTable(db: Database.Database, name: string): boolean {
  const row = db
    .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name) as { present: number } | undefined;
  return row !== undefined;
}

export function applyMigrations(
  db: Database.Database,
  now: () => string = () => new Date().toISOString(),
): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     INTEGER PRIMARY KEY,
      applied_at  TEXT NOT NULL
    )
  `);

  // Legacy Sprint 001/002 databases already have the v1 tables but no version row.
  if (currentVersion(db) === 0 && hasTable(db, "workspaces")) {
    db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(1, now());
  }

  for (const migration of MIGRATIONS) {
    if (migration.version <= currentVersion(db)) continue;
    const apply = db.transaction(() => {
      migration.up(db);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
        migration.version,
        now(),
      );
    });
    apply();
  }
}

export function schemaVersion(db: Database.Database): number {
  if (!hasTable(db, "schema_migrations")) return 0;
  return currentVersion(db);
}
