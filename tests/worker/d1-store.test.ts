import { describe, expect, it, vi } from "vitest";
import { createD1Store, migrateD1 } from "../../src/worker/d1-store.js";
import type { D1Database } from "../../src/worker/d1-types.js";
import schemaFile from "../../src/store/schema.sql";

const NOW = "2026-01-01T00:00:00.000Z";

/** Minimal fake D1 binding: records calls, serves canned rows. */
function fakeDb(opts?: {
  firstRow?: unknown;
  firstRows?: unknown[];
  allRows?: unknown[];
  runResult?: { success: boolean; meta?: { changes?: number } };
  onExec?: (sql: string) => void;
  onRun?: () => void;
  seen?: { query: string; params: unknown[] }[];
}) {
  const seen: { query: string; params: unknown[] }[] = opts?.seen ?? [];
  let firstIndex = 0;
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
          if (opts?.firstRows) {
            const row = opts.firstRows[firstIndex] ?? null;
            firstIndex += 1;
            return row as any;
          }
          return (opts?.firstRow ?? null) as any;
        },
        async all() {
          return { results: (opts?.allRows ?? []) as any[], success: true };
        },
        async run() {
          opts?.onRun?.();
          return opts?.runResult ?? { success: true };
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
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS domain_events");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS webhook_deliveries");
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

  it("batches two transaction writes once and skips batch when the callback throws", async () => {
    let runs = 0;
    const { db } = fakeDb({ onRun: () => { runs += 1; } });
    const batch = vi.fn(async (statements: unknown[]) => statements.map(() => ({ success: true })));
    db.batch = batch as D1Database["batch"];
    const store = createD1Store(db);
    const org = { name: "A", createdAt: NOW };

    await store.transaction(async () => {
      await store.createOrganization({ id: "org_1", ...org });
      await store.createOrganization({ id: "org_2", ...org, name: "B" });
    });
    expect(runs).toBe(0);
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[0]?.[0]).toHaveLength(2);

    batch.mockClear();
    await store.transaction(async () => {
      await store.createOrganization({ id: "org_3", ...org });
      await store.transaction(async () => {
        await store.createOrganization({ id: "org_4", ...org });
      });
    });
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[0]?.[0]).toHaveLength(2);
    expect(runs).toBe(0);

    batch.mockClear();
    await expect(
      store.transaction(async () => {
        await store.createOrganization({ id: "org_5", ...org });
        await store.createOrganization({ id: "org_6", ...org });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(batch).not.toHaveBeenCalled();
    expect(runs).toBe(0);
  });

  it("writes a workspace outside a transaction with run, not batch", async () => {
    let runs = 0;
    const { db, seen } = fakeDb({ onRun: () => { runs += 1; } });
    const batch = vi.fn(async () => []);
    db.batch = batch as D1Database["batch"];
    const store = createD1Store(db);
    await store.createWorkspace({
      id: "ws_1",
      teamId: "team_1",
      name: "W",
      status: "active",
      createdBy: { actorId: "hum_1", actorType: "human" },
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(runs).toBe(1);
    expect(batch).not.toHaveBeenCalled();
    expect(seen[0]?.query).toMatch(/INSERT INTO workspaces/);
  });

  it("does not read rows written earlier in the same D1 transaction", async () => {
    const { db } = fakeDb();
    const batch = vi.fn(async () => []);
    db.batch = batch as D1Database["batch"];
    const store = createD1Store(db);
    await expect(
      store.transaction(async () => {
        await store.createOrganization({ id: "org_1", name: "A", createdAt: NOW });
        await store.getOrganization("org_1");
      }),
    ).rejects.toThrow("D1 transaction cannot read uncommitted writes");
    expect(batch).not.toHaveBeenCalled();
  });

  it("returns a claimed delivery only when the conditional update changes one row", async () => {
    const pending = {
      id: "dlv_1",
      event_id: "evt_1",
      bridge_id: "bridge_1",
      status: "pending",
      attempt_count: 0,
      next_attempt_at: null,
      claimed_at: null,
      claim_token: null,
      last_error: null,
      delivered_at: null,
      config_fingerprint: "fp",
      created_at: NOW,
      updated_at: NOW,
    };
    const delivering = {
      ...pending,
      status: "delivering",
      claim_token: "tok-a",
      claimed_at: NOW,
    };
    const won = fakeDb({
      firstRows: [pending, delivering],
      runResult: { success: true, meta: { changes: 1 } },
    });
    const winner = createD1Store(won.db);
    const claimed = await winner.claimWebhookDelivery("dlv_1", {
      now: NOW,
      claimToken: "tok-a",
      leaseBefore: "2025-12-31T00:00:00.000Z",
      configFingerprint: "fp",
    });
    expect(claimed).toEqual({
      id: "dlv_1",
      eventId: "evt_1",
      bridgeId: "bridge_1",
      status: "delivering",
      attemptCount: 0,
      claimedAt: NOW,
      claimToken: "tok-a",
      configFingerprint: "fp",
      createdAt: NOW,
      updatedAt: NOW,
    });
    const update = won.seen.find((entry) => entry.query.includes("status = 'delivering'"));
    expect(update?.query).toMatch(/claim_token IS NULL OR claim_token = \?/);
    expect(update?.params).toContain("tok-a");

    const lost = fakeDb({
      firstRow: pending,
      runResult: { success: true, meta: { changes: 0 } },
    });
    const loser = createD1Store(lost.db);
    await expect(
      loser.claimWebhookDelivery("dlv_1", {
        now: NOW,
        claimToken: "tok-b",
        leaseBefore: "2025-12-31T00:00:00.000Z",
        configFingerprint: "fp",
      }),
    ).resolves.toBeUndefined();
  });

  it("filters listDue and claim by the destination fingerprint", async () => {
    const pending = {
      id: "dlv_1",
      event_id: "evt_1",
      bridge_id: "bridge_1",
      status: "pending",
      attempt_count: 0,
      next_attempt_at: null,
      claimed_at: null,
      claim_token: null,
      last_error: null,
      delivered_at: null,
      config_fingerprint: "old-fp",
      created_at: NOW,
      updated_at: NOW,
    };
    const listed = fakeDb({ allRows: [pending] });
    const store = createD1Store(listed.db);
    const due = await store.listDueWebhookDeliveries({
      bridgeId: "bridge_1",
      now: NOW,
      leaseBefore: "2025-12-31T00:00:00.000Z",
      configFingerprint: "new-fp",
    });
    // The fake serves canned rows; assert the query itself binds the fingerprint.
    expect(due).toHaveLength(1);
    expect(listed.seen[0]?.query).toMatch(/config_fingerprint = \?/);
    expect(listed.seen[0]?.params).toEqual(["bridge_1", "new-fp", NOW, "2025-12-31T00:00:00.000Z"]);

    const rejected = fakeDb({ firstRow: pending, runResult: { success: true, meta: { changes: 1 } } });
    const mismatch = createD1Store(rejected.db);
    await expect(
      mismatch.claimWebhookDelivery("dlv_1", {
        now: NOW,
        claimToken: "tok-a",
        leaseBefore: "2025-12-31T00:00:00.000Z",
        configFingerprint: "new-fp",
      }),
    ).resolves.toBeUndefined();

    const accepted = fakeDb({
      firstRows: [pending, { ...pending, status: "delivering", claim_token: "tok-a", claimed_at: NOW }],
      runResult: { success: true, meta: { changes: 1 } },
    });
    const match = createD1Store(accepted.db);
    await expect(
      match.claimWebhookDelivery("dlv_1", {
        now: NOW,
        claimToken: "tok-a",
        leaseBefore: "2025-12-31T00:00:00.000Z",
        configFingerprint: "old-fp",
      }),
    ).resolves.toMatchObject({ status: "delivering", configFingerprint: "old-fp" });
  });
});
