import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import {
  applyMigrations,
  CURRENT_SCHEMA_VERSION,
  schemaVersion,
} from "../../src/store/migrations.js";

const NOW = "2026-01-01T00:00:00.000Z";
const LATER = "2026-01-02T00:00:00.000Z";
const SCHEMA_SQL = readFileSync(new URL("../../src/store/schema.sql", import.meta.url), "utf8");

const open: Database.Database[] = [];

afterEach(() => {
  for (const db of open) db.close();
  open.length = 0;
});

function memory(): Database.Database {
  const db = new Database(":memory:");
  open.push(db);
  return db;
}

describe("schema migrations", () => {
  it("applies v1 and records the schema version", () => {
    const db = memory();
    applyMigrations(db, () => NOW);
    expect(schemaVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    expect(tables.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "workspaces",
        "contributions",
        "schema_migrations",
        "actor_tokens",
        "workspace_invites",
      ]),
    );
  });

  it("does not duplicate version rows on reopen", () => {
    const db = memory();
    applyMigrations(db, () => NOW);
    applyMigrations(db, () => LATER);
    const rows = db.prepare("SELECT version, applied_at FROM schema_migrations ORDER BY version").all();
    expect(rows).toEqual([
      { version: 1, applied_at: NOW },
      { version: 2, applied_at: NOW },
    ]);
  });

  it("stamps a legacy schema.sql database as v1 then applies v2", () => {
    const db = memory();
    db.exec(SCHEMA_SQL);
    expect(schemaVersion(db)).toBe(0);
    applyMigrations(db, () => NOW);
    expect(schemaVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
    const workspaces = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'workspaces'")
      .get();
    expect(workspaces).toBeDefined();
    const tokens = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'actor_tokens'")
      .get();
    expect(tokens).toBeDefined();
  });

  it("adds actor_tokens and workspace_invites at version 2", () => {
    const db = memory();
    applyMigrations(db, () => NOW);
    expect(schemaVersion(db)).toBe(2);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    expect(tables.map((row) => row.name)).toEqual(
      expect.arrayContaining(["actor_tokens", "workspace_invites"]),
    );
  });
});
