import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import {
  applyMigrations,
  CURRENT_SCHEMA_VERSION,
  schemaVersion,
  V3_SQL as sqliteV3Sql,
  V4_SQL as sqliteV4Sql,
} from "../../src/store/migrations.js";
import { V3_SQL as workerV3Sql, V4_SQL as workerV4Sql } from "../../src/worker/schema.js";

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
        "domain_events",
        "webhook_deliveries",
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
      { version: 3, applied_at: NOW },
      { version: 4, applied_at: NOW },
    ]);
  });

  it("stamps a legacy schema.sql database as v1 then applies pending migrations", () => {
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
    const events = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'domain_events'")
      .get();
    expect(events).toBeDefined();
    const deliveries = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'webhook_deliveries'")
      .get();
    expect(deliveries).toBeDefined();
  });

  it("adds actor tokens, invites, domain events, and webhook deliveries", () => {
    const db = memory();
    applyMigrations(db, () => NOW);
    expect(schemaVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    expect(tables.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "actor_tokens",
        "workspace_invites",
        "domain_events",
        "webhook_deliveries",
      ]),
    );
    const columns = db.prepare("PRAGMA table_info(webhook_deliveries)").all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toContain("config_fingerprint");
  });

  it("keeps the v3 outbox SQL identical in sqlite, D1, and the worker bundle", () => {
    const file = readFileSync(new URL("../../migrations/0002_domain_events.sql", import.meta.url), "utf8");
    const body = file.replace(/^--[^\n]*\n+/, "").trim();
    expect(sqliteV3Sql).toBe(workerV3Sql);
    expect(body).toBe(sqliteV3Sql);
    const v4 = readFileSync(new URL("../../migrations/0003_webhook_fingerprint.sql", import.meta.url), "utf8");
    const v4Body = v4.replace(/^--[^\n]*\n+/, "").trim().replace(/;$/, "");
    expect(sqliteV4Sql).toBe(workerV4Sql);
    expect(v4Body).toBe(sqliteV4Sql);
  });

  it("exhausts pre-fingerprint queued rows instead of sending them to a changed destination", () => {
    const db = memory();
    // The quarantine only needs delivery rows; the referenced event is not part
    // of this fixture.
    db.pragma("foreign_keys = OFF");
    db.exec(SCHEMA_SQL);
    db.exec(sqliteV3Sql);
    const insert = db.prepare(
      `INSERT INTO webhook_deliveries
         (id, event_id, bridge_id, status, attempt_count, next_attempt_at, claimed_at, claim_token, last_error, delivered_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?, NULL, NULL, ?, ?)`,
    );
    insert.run(
      "dlv_legacy_pending",
      "evt_missing",
      "bridge_legacy",
      "pending",
      "2026-01-01T00:00:00.000Z",
      null,
      null,
      NOW,
      NOW,
    );
    insert.run(
      "dlv_legacy_delivering",
      "evt_missing",
      "bridge_legacy",
      "delivering",
      null,
      NOW,
      "tok_old",
      NOW,
      NOW,
    );
    insert.run(
      "dlv_legacy_delivered",
      "evt_missing",
      "bridge_legacy",
      "delivered",
      null,
      null,
      null,
      NOW,
      NOW,
    );

    applyMigrations(db, () => NOW);
    expect(schemaVersion(db)).toBe(CURRENT_SCHEMA_VERSION);

    const rows = db
      .prepare("SELECT id, status, next_attempt_at, claim_token, claimed_at, last_error FROM webhook_deliveries ORDER BY id")
      .all() as Array<{
      id: string;
      status: string;
      next_attempt_at: string | null;
      claim_token: string | null;
      claimed_at: string | null;
      last_error: string | null;
    }>;
    const pending = rows.find((row) => row.id === "dlv_legacy_pending");
    const delivering = rows.find((row) => row.id === "dlv_legacy_delivering");
    expect(pending).toMatchObject({
      status: "exhausted",
      next_attempt_at: null,
      last_error: expect.stringContaining("destination fingerprinting"),
    });
    expect(delivering).toMatchObject({
      status: "exhausted",
      claim_token: null,
      claimed_at: null,
      last_error: expect.stringContaining("destination fingerprinting"),
    });
    expect(rows.find((row) => row.id === "dlv_legacy_delivered")?.status).toBe("delivered");
  });
});
