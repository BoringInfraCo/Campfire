import { describe, expect, it, vi } from "vitest";
import { createD1Store, migrateD1 } from "../../src/worker/d1-store.js";
import type { D1Database } from "../../src/worker/d1-types.js";
import schemaFile from "../../src/store/schema.sql";

/** Minimal fake D1 binding: records calls, serves canned rows. */
function fakeDb(opts?: {
  firstRow?: unknown;
  allRows?: unknown[];
  onExec?: (sql: string) => void;
  seen?: { query: string; params: unknown[] }[];
}) {
  const seen: { query: string; params: unknown[] }[] = opts?.seen ?? [];
  const db: D1Database = {
    prepare(query: string) {
      const stmt = {
        bound: [] as unknown[],
        bind(...params: unknown[]) {
          seen.push({ query, params });
          stmt.bound = params;
          return stmt;
        },
        async first() {
          return (opts?.firstRow ?? null) as any;
        },
        async all() {
          return { results: (opts?.allRows ?? []) as any[], success: true };
        },
        async run() {
          return { success: true };
        },
      };
      return stmt as any;
    },
    async batch(statements) {
      return statements.map(() => ({ success: true }));
    },
    async exec(sql: string) {
      opts?.onExec?.(sql);
      return { success: true } as any;
    },
  };
  return { db, seen };
}

describe("D1Store", () => {
  it("migrates via db.exec with the bundled schema.sql content", async () => {
    const exec = vi.fn();
    const { db } = fakeDb({ onExec: (sql) => exec(sql) });
    await migrateD1(db);
    expect(exec).toHaveBeenCalledTimes(1);
    const sql = exec.mock.calls[0]?.[0] as string;
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS workspaces");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS actor_tokens");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS workspace_invites");
    // The bundled migration maps the same schema.sql the SQLite path uses.
    for (const line of schemaFile.split("\n").filter((l) => l.startsWith("CREATE TABLE"))) {
      expect(sql).toContain(line);
    }
  });

  it("writes via prepare/bind/run", async () => {
    const { db, seen } = fakeDb();
    const store = createD1Store(db);
    await store.createWorkspace({
      id: "ws_1",
      teamId: "team_1",
      name: "W",
      status: "active",
      createdBy: { actorId: "hum_1", actorType: "human" },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.query).toMatch(/INSERT INTO workspaces/);
    expect(seen[0]?.params[0]).toBe("ws_1");
  });

  it("reads and maps an actor token row via prepare/bind/first", async () => {
    const { db, seen } = fakeDb({
      firstRow: {
        id: "tok_1",
        actor_id: "hum_1",
        actor_type: "human",
        token_hash: "abc",
        created_at: "2026-01-01T00:00:00.000Z",
        revoked_at: null,
      },
    });
    const store = createD1Store(db);
    const token = await store.getActorTokenByHash("abc");
    expect(token).toEqual({
      id: "tok_1",
      actor: { actorId: "hum_1", actorType: "human" },
      tokenHash: "abc",
      createdAt: "2026-01-01T00:00:00.000Z",
      revokedAt: undefined,
    });
    expect(seen[0]?.query).toMatch(/FROM actor_tokens/);
    expect(seen[0]?.params).toEqual(["abc"]);
  });

  it("lists workspaces for an actor via prepare/bind/all", async () => {
    const { db, seen } = fakeDb({
      allRows: [
        {
          id: "ws_1",
          team_id: "team_1",
          name: "W",
          description: null,
          status: "active",
          created_by_actor_id: "hum_1",
          created_by_actor_type: "human",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    const store = createD1Store(db);
    const list = await store.listWorkspacesForActor({ actorId: "hum_1", actorType: "human" });
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe("ws_1");
    expect(seen[0]?.query).toMatch(/workspace_participants/);
  });
});
