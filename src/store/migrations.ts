/**
 * Deterministic SQLite migrations.
 *
 * Sprint 001/002 applied `schema.sql` with CREATE TABLE IF NOT EXISTS and never
 * wrote `schema_migrations`. That cannot evolve columns. Open now records a
 * version and applies pending migrations in order.
 */
import { readFileSync } from "node:fs";
import type Database from "better-sqlite3";

export const CURRENT_SCHEMA_VERSION = 2;

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
