import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import {
  applyMigrations,
  CURRENT_SCHEMA_VERSION,
  schemaVersion,
  V3_SQL as sqliteV3Sql,
  V4_SQL as sqliteV4Sql,
  V5_SQL as sqliteV5Sql,
  V6_SQL as sqliteV6Sql,
  V7_SQL as sqliteV7Sql,
} from "../../src/store/migrations.js";
import { openInMemoryStore } from "../../src/store/sqlite-store.js";
import { V2_SQL as workerV2Sql, V3_SQL as workerV3Sql, V4_SQL as workerV4Sql, V5_SQL as workerV5Sql, V6_SQL as workerV6Sql, V7_SQL as workerV7Sql } from "../../src/worker/schema.js";

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
      { version: 5, applied_at: NOW },
      { version: 6, applied_at: NOW },
      { version: 7, applied_at: NOW },
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
    const v6 = readFileSync(new URL("../../migrations/0005_contribution_append_position.sql", import.meta.url), "utf8");
    const v6Body = v6.replace(/^--[^\n]*\n+/, "").trim().replace(/;$/, "");
    expect(sqliteV6Sql).toBe(workerV6Sql);
    expect(v6Body).toBe(sqliteV6Sql);
    const v7 = readFileSync(new URL("../../migrations/0006_correct_the_record.sql", import.meta.url), "utf8");
    const v7Body = v7.replace(/^--[^\n]*\n+/, "").trim().replace(/;$/, "");
    expect(sqliteV7Sql).toBe(workerV7Sql);
    expect(v7Body).toBe(sqliteV7Sql);
  });

  it("keeps enrollment migrations identical and upgrades v4 without altering collaboration state", () => {
    const file = readFileSync(new URL("../../migrations/0004_enrollment.sql", import.meta.url), "utf8");
    expect(file.replace(/^--[^\n]*\n+/, "").trim()).toBe(sqliteV5Sql);
    expect(workerV5Sql).toBe(sqliteV5Sql);
    const db = memory();
    applyMigrations(db, () => NOW);
    db.exec("DROP TABLE managed_agent_slots; DROP TABLE enrollment_invitations; DELETE FROM schema_migrations WHERE version >= 5;");
    const before = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
    applyMigrations(db, () => LATER);
    expect(schemaVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
    const after = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT IN ('enrollment_invitations', 'managed_agent_slots') ORDER BY name").all();
    expect(after).toEqual(before);
    expect(db.prepare("SELECT applied_at FROM schema_migrations WHERE version = 5").get()).toEqual({ applied_at: LATER });
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

  it("backfills append order by created_at and rowid without rewriting payloads", () => {
    const db = memory();
    db.pragma("foreign_keys = ON");
    db.exec(SCHEMA_SQL);
    db.exec(workerV2Sql);
    db.exec(sqliteV3Sql);
    db.exec(sqliteV4Sql);
    db.exec(sqliteV5Sql);
    const stamp = db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)");
    for (let version = 1; version <= 5; version += 1) stamp.run(version, NOW);

    db.prepare("INSERT INTO organizations (id, name, created_at) VALUES (?, ?, ?)").run("org_1", "Org", NOW);
    db.prepare("INSERT INTO teams (id, organization_id, name, created_at) VALUES (?, ?, ?, ?)").run("team_1", "org_1", "Team", NOW);
    const workspace = db.prepare(
      `INSERT INTO workspaces (
         id, team_id, name, description, status, created_by_actor_id, created_by_actor_type, created_at, updated_at
       ) VALUES (?, ?, ?, NULL, 'active', 'hum_1', 'human', ?, ?)`,
    );
    workspace.run("ws_1", "team_1", "One", NOW, NOW);
    workspace.run("ws_2", "team_1", "Two", NOW, NOW);
    const contribution = db.prepare(
      `INSERT INTO contributions (
         id, workspace_id, actor_id, actor_type, agent_session_id, action, object_type, object_id, payload, created_at
       ) VALUES (?, ?, 'hum_1', 'human', NULL, 'create', ?, ?, ?, ?)`,
    );
    const at = "2026-05-01T00:00:00.000Z";
    contribution.run("con_z", "ws_1", "task", "task_z", "{\"title\":\"kept\"}", at);
    contribution.run("con_a", "ws_1", "finding", "find_a", null, at);
    contribution.run("con_b", "ws_2", "task", "task_b", null, at);
    db.prepare(
      `INSERT INTO findings (
         id, workspace_id, summary, detail, confidence, source_artifact_id,
         created_by_actor_id, created_by_actor_type, agent_session_id, created_at
       ) VALUES ('find_old', 'ws_1', 'kept assertion', NULL, NULL, NULL, 'hum_1', 'human', NULL, ?)`,
    ).run(at);

    applyMigrations(db, () => NOW);
    expect(schemaVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
    const migrated = db
      .prepare(
        "SELECT summary, currentness, correction_reason, predecessor_id, successor_id FROM findings WHERE id = 'find_old'",
      )
      .get() as {
      summary: string;
      currentness: string;
      correction_reason: string | null;
      predecessor_id: string | null;
      successor_id: string | null;
    };
    expect(migrated).toEqual({
      summary: "kept assertion",
      currentness: "current",
      correction_reason: null,
      predecessor_id: null,
      successor_id: null,
    });

    const rows = db
      .prepare("SELECT id, append_position, payload FROM contributions ORDER BY id")
      .all() as Array<{ id: string; append_position: number; payload: string | null }>;
    expect(rows).toEqual([
      { id: "con_a", append_position: 2, payload: null },
      { id: "con_b", append_position: 1, payload: null },
      { id: "con_z", append_position: 1, payload: "{\"title\":\"kept\"}" },
    ]);

    db.prepare("UPDATE contributions SET append_position = 7 WHERE id = 'con_a'").run();
    db.prepare("DELETE FROM schema_migrations WHERE version >= 6").run();
    applyMigrations(db, () => LATER);
    const again = db
      .prepare("SELECT id, append_position, payload FROM contributions ORDER BY id")
      .all();
    expect(again).toEqual([
      { id: "con_a", append_position: 7, payload: null },
      { id: "con_b", append_position: 1, payload: null },
      { id: "con_z", append_position: 1, payload: "{\"title\":\"kept\"}" },
    ]);
    expect(schemaVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
    expect(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 6").get()).toEqual({ count: 1 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 7").get()).toEqual({ count: 1 });
    expect(
      db.prepare("SELECT summary, currentness, correction_reason FROM findings WHERE id = 'find_old'").get(),
    ).toEqual({ summary: "kept assertion", currentness: "current", correction_reason: null });
  });

  it("assigns append positions in insert order when timestamps match", () => {
    const store = openInMemoryStore();
    try {
      const at = "2026-05-01T00:00:00.000Z";
      store.createOrganization({ id: "org_1", name: "Org", createdAt: NOW });
      store.createTeam({ id: "team_1", organizationId: "org_1", name: "Team", createdAt: NOW });
      const workspace = {
        teamId: "team_1",
        status: "active" as const,
        createdBy: { actorId: "hum_1", actorType: "human" as const },
        createdAt: NOW,
        updatedAt: NOW,
      };
      store.createWorkspace({ ...workspace, id: "ws_1", name: "One" });
      store.createWorkspace({ ...workspace, id: "ws_2", name: "Two" });
      const base = {
        actor: { actorId: "hum_1", actorType: "human" as const },
        action: "create" as const,
        objectType: "task" as const,
        createdAt: at,
      };
      store.createContribution({ ...base, id: "con_z", workspaceId: "ws_1", objectId: "task_z", payload: { title: "kept" } });
      store.createContribution({ ...base, id: "con_a", workspaceId: "ws_1", objectId: "find_a", objectType: "finding" });
      store.createContribution({ ...base, id: "con_b", workspaceId: "ws_2", objectId: "task_b" });
      expect(store.getContribution("con_z")).toMatchObject({ appendPosition: 1, id: "con_z", payload: { title: "kept" }, createdAt: at });
      expect(store.getContribution("con_a")?.appendPosition).toBe(2);
      expect(store.getContribution("con_b")?.appendPosition).toBe(1);
      expect(store.maxAppendPosition("ws_1")).toBe(2);
      expect(store.maxAppendPosition("ws_2")).toBe(1);
      expect(store.maxAppendPosition("ws_missing")).toBe(0);
    } finally {
      store.close();
    }
  });
});
