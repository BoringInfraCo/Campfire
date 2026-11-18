import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { V16_SQL } from "../../src/store/agent-session-share-schema.js";
import { applyMigrations, CURRENT_SCHEMA_VERSION, schemaVersion } from "../../src/store/migrations.js";
import { migrateD1 } from "../../src/worker/d1-store.js";
import { sqliteD1 } from "../helpers/sqlite-d1.js";

const NOW = "2026-11-17T00:00:00.000Z";
const open: Database.Database[] = [];
afterEach(() => { for (const db of open.splice(0)) db.close(); });

function columns(db: Database.Database): Array<{ name: string; notnull: number; pk: number }> {
  return db.prepare("PRAGMA table_info(agent_session_shares)").all() as Array<{ name: string; notnull: number; pk: number }>;
}

describe("migration 0016 agent_session_shares", () => {
  it("keeps the bundled SQL identical to the migration file", () => {
    const file = readFileSync(new URL("../../migrations/0016_agent_session_shares.sql", import.meta.url), "utf8");
    const strip = (sql: string) => sql.split("\n").filter((line) => !line.startsWith("--")).join("\n").replace(/\s+/g, " ").trim();
    expect(strip(file)).toBe(strip(V16_SQL));
  });

  it("is additive, holds no secret, and leaves the published schema version alone", () => {
    const db = new Database(":memory:");
    open.push(db);
    applyMigrations(db, () => NOW);
    expect(columns(db).map((c) => c.name)).toEqual(["session_id", "workspace_id", "shared_by", "shared_at", "revoked_at"]);
    expect(columns(db).find((c) => c.name === "session_id")?.pk).toBe(1);
    expect(columns(db).find((c) => c.name === "revoked_at")?.notnull).toBe(0);
    expect(schemaVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
    expect(CURRENT_SCHEMA_VERSION).toBe(11);
  });

  it("upgrades a database that stops at 0015, keeping rows, and is idempotent", () => {
    const db = new Database(":memory:");
    open.push(db);
    applyMigrations(db, () => NOW);
    db.exec("DROP TABLE agent_session_shares");
    expect(columns(db)).toEqual([]);
    db.prepare("INSERT INTO workspace_create_session_claims (agent_id, workspace_id, session_id, created_at) VALUES ('a','w','s',?)").run(NOW);
    applyMigrations(db, () => NOW);
    applyMigrations(db, () => NOW);
    expect(columns(db)).toHaveLength(5);
    expect(db.prepare("SELECT COUNT(*) AS n FROM workspace_create_session_claims").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get()).toEqual({ v: CURRENT_SCHEMA_VERSION });
  });

  it("creates the table on a fresh D1 and upgrades a 0015 D1 by applying the migration file", async () => {
    const adapter = sqliteD1();
    open.push(adapter.database);
    await migrateD1(adapter.binding);
    const names = ["session_id", "workspace_id", "shared_by", "shared_at", "revoked_at"];
    expect(columns(adapter.database).map((c) => c.name)).toEqual(names);

    // The 0015 state has no share table; `wrangler d1 migrations apply` runs the file once.
    adapter.database.exec("DROP TABLE agent_session_shares");
    expect(columns(adapter.database)).toEqual([]);
    const file = readFileSync(new URL("../../migrations/0016_agent_session_shares.sql", import.meta.url), "utf8");
    await adapter.binding.exec(file);
    await adapter.binding.exec(file);
    expect(columns(adapter.database).map((c) => c.name)).toEqual(names);
  });
  it("adds the agent-session contributions index and both session queries use it", () => {
    const db = new Database(":memory:");
    open.push(db);
    applyMigrations(db, () => NOW);
    const idx = db.prepare("PRAGMA index_info(idx_contributions_agent_session)").all() as Array<{ name: string }>;
    expect(idx.map((c) => c.name)).toEqual(["workspace_id", "agent_session_id", "append_position"]);
    for (const sql of [
      "SELECT COUNT(*) AS count, MAX(append_position) AS newest FROM contributions WHERE workspace_id = ? AND agent_session_id = ?",
      "SELECT * FROM contributions WHERE workspace_id = ? AND agent_session_id = ? AND append_position > ? ORDER BY append_position LIMIT ?",
    ]) {
      const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...(sql.includes("> ?") ? ["w", "s", 0, 5] : ["w", "s"])) as Array<{ detail: string }>;
      expect(plan.map((p) => p.detail).join("\n")).toContain("idx_contributions_agent_session");
    }
  });

  it("applies 0016 to a 0015-era database with data and leaves every existing row untouched", () => {
    const db = new Database(":memory:");
    open.push(db);
    applyMigrations(db, () => NOW);
    db.pragma("foreign_keys = OFF");
    db.exec("DROP INDEX idx_contributions_agent_session; DROP TABLE agent_session_shares");
    const sessionCols = (db.prepare("PRAGMA table_info(agent_sessions)").all() as Array<{ name: string; notnull: number; dflt_value: unknown }>)
      .filter((c) => c.notnull === 1 && c.dflt_value === null).map((c) => c.name);
    expect(sessionCols.length).toBeGreaterThan(0);
    const values: Record<string, string> = { id: "ses_1", workspace_id: "w", agent_id: "agt", human_id: "hum", harness: "codex", started_at: NOW, created_at: NOW };
    db.prepare(`INSERT INTO agent_sessions (${sessionCols.join(",")}) VALUES (${sessionCols.map(() => "?").join(",")})`).run(...sessionCols.map((c) => values[c] ?? "x"));
    for (const n of [1, 2]) {
      db.prepare("INSERT INTO contributions (id, workspace_id, actor_id, actor_type, agent_session_id, action, object_type, object_id, payload, append_position, created_at) VALUES (?, 'w', 'agt', 'agent', 'ses_1', 'create', 'finding', ?, '{\"summary\":\"hi\"}', ?, ?)")
        .run(`con_${n}`, `fnd_${n}`, n, NOW);
    }
    const snapshot = () => ({
      sessions: db.prepare("SELECT * FROM agent_sessions ORDER BY id").all(),
      contributions: db.prepare("SELECT * FROM contributions ORDER BY id").all(),
      claims: db.prepare("SELECT COUNT(*) AS n FROM workspace_create_session_claims").get(),
      versions: db.prepare("SELECT version FROM schema_migrations ORDER BY version").all(),
    });
    const before = snapshot();
    expect(before.sessions).toHaveLength(1);
    expect(before.contributions).toHaveLength(2);
    applyMigrations(db, () => NOW);
    expect(columns(db)).toHaveLength(5);
    expect(db.prepare("SELECT COUNT(*) AS n FROM agent_session_shares").get()).toEqual({ n: 0 });
    expect(db.prepare("PRAGMA index_info(idx_contributions_agent_session)").all()).toHaveLength(3);
    expect(snapshot()).toEqual(before);
  });

  it("applies the 0016 file to a D1-style 0015 database that holds data, rows untouched", async () => {
    const adapter = sqliteD1();
    open.push(adapter.database);
    await migrateD1(adapter.binding);
    const db = adapter.database;
    db.exec("DROP INDEX idx_contributions_agent_session; DROP TABLE agent_session_shares");
    db.pragma("foreign_keys = OFF");
    db.exec(`
      INSERT INTO contributions (id, workspace_id, actor_id, actor_type, agent_session_id, action, object_type, object_id, payload, append_position, created_at)
        VALUES ('con_1', 'w', 'agt', 'agent', NULL, 'create', 'finding', 'fnd_1', NULL, 1, '${NOW}');
    `);
    const before = db.prepare("SELECT * FROM contributions").all();
    const file = readFileSync(new URL("../../migrations/0016_agent_session_shares.sql", import.meta.url), "utf8");
    await adapter.binding.exec(file);
    expect(db.prepare("SELECT * FROM contributions").all()).toEqual(before);
    expect(db.prepare("PRAGMA index_info(idx_contributions_agent_session)").all()).toHaveLength(3);
  });
});
