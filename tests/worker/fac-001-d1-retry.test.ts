/**
 * FAC-001 phase B. D1 emulation, local (better-sqlite3 behind the D1 interface), NOT deployed D1.
 * Bracket/retry, exhaustion, authorization-before-retrieval, read-only, no-migration.
 */
import { afterEach, describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { createCounterIdSource } from "../../src/domain/ids.js";
import { Conflict } from "../../src/domain/errors.js";
import { MEMORY_HEALTH_TIP_SQL } from "../../src/store/memory-health-queries.js";
import { createAsyncCampfireService } from "../../src/worker/async-service.js";
import { createD1Store, migrateD1, type AsyncCampfireStore } from "../../src/worker/d1-store.js";
import type { D1Database } from "../../src/worker/d1-types.js";
import { sqliteD1 } from "../helpers/sqlite-d1.js";

const NOW = "2026-01-01T00:00:00.000Z";
const owner = { actor: { actorId: "hum_1", actorType: "human" as const } };
const stranger = { actor: { actorId: "hum_stranger", actorType: "human" as const } };
const WHO = { actorType: "human" as const, actorId: "hum_1" };
const REQ = { who: WHO, canTaskUpdate: true, includeReview: true };
const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length > 0) cleanups.pop()?.(); });

async function setup(mutateAfterBeforeRead: (tipCall: number) => boolean) {
  const adapter = sqliteD1();
  await migrateD1(adapter.binding);
  cleanups.push(() => adapter.database.close());
  const plain = createD1Store(adapter.binding);
  let ms = Date.parse(NOW);
  const clock = () => new Date((ms += 1000)).toISOString();
  const writer = createAsyncCampfireService({ store: plain, idSource: createCounterIdSource(), clock });
  await plain.createOrganization({ id: "org_1", name: "Org", createdAt: NOW });
  await plain.createTeam({ id: "team_1", organizationId: "org_1", name: "Team", createdAt: NOW });
  await plain.createHuman({ id: "hum_1", teamId: "team_1", displayName: "Ada", createdAt: NOW });
  await plain.createHuman({ id: "hum_stranger", teamId: "team_1", displayName: "Eve", createdAt: NOW });
  const ws = await writer.createWorkspace(owner, { teamId: "team_1", name: "W" });
  await writer.createTask(owner, { workspaceId: ws.id, title: "seed" });

  let tipCalls = 0;
  let mutating = false;
  const sqlSeen: string[] = [];
  const wrapped: D1Database = {
    ...adapter.binding,
    prepare(sql) {
      sqlSeen.push(sql);
      const statement = adapter.binding.prepare(sql);
      if (sql !== MEMORY_HEALTH_TIP_SQL) return statement;
      return new Proxy(statement, {
        get(target, prop, receiver) {
          if (prop === "bind") {
            return (...args: unknown[]) => { (target as { bind(...a: unknown[]): unknown }).bind(...args); return receiver; };
          }
          if (prop === "first") {
            return async (...args: unknown[]) => {
              const value = await (target as { first(...a: unknown[]): Promise<unknown> }).first(...args);
              tipCalls += 1;
              if (!mutating && tipCalls % 2 === 1 && mutateAfterBeforeRead(tipCalls)) {
                mutating = true;
                try { await writer.createTask(owner, { workspaceId: ws.id, title: `concurrent-${tipCalls}` }); } finally { mutating = false; }
              }
              return value;
            };
          }
          const member = Reflect.get(target, prop, target);
          return typeof member === "function" ? member.bind(target) : member;
        },
      });
    },
  };
  const wrappedStore = createD1Store(wrapped);
  const service = createAsyncCampfireService({ store: wrappedStore, idSource: createCounterIdSource(), clock });
  return { wrappedStore, service, ws: ws.id, tipCalls: () => tipCalls, plain, sqlSeen, adapter };
}

describe("FAC-001 D1 (emulation, local, not deployed D1): readAttentionSnapshot bracket", () => {
  it("reads once without retry when the tip is stable", async () => {
    const t = await setup(() => false);
    const snap = await t.wrappedStore.readAttentionSnapshot(t.ws, REQ);
    expect(t.tipCalls()).toBe(2);
    expect(snap.tip).toBeDefined();
    expect(snap.proposedDecisions.total).toBe(0);
  });

  it("one bracket around ALL reads: a write between the reads retries and returns the post-write snapshot", async () => {
    const t = await setup((call) => call === 1);
    const before = await t.plain.readAttentionSnapshot(t.ws, REQ);
    const snap = await t.wrappedStore.readAttentionSnapshot(t.ws, REQ);
    expect(t.tipCalls()).toBe(4);
    expect(snap.tip!.appendPosition).toBeGreaterThan(before.tip!.appendPosition);
    const after = await t.plain.readAttentionSnapshot(t.ws, REQ);
    expect(snap).toEqual(after);
  });

  it("succeeds on the third attempt but not the fourth", async () => {
    const third = await setup((call) => call <= 3);
    await expect(third.wrappedStore.readAttentionSnapshot(third.ws, REQ)).resolves.toBeDefined();
    expect(third.tipCalls()).toBe(6);
    const fourth = await setup((call) => call <= 5);
    await expect(fourth.wrappedStore.readAttentionSnapshot(fourth.ws, REQ)).rejects.toBeInstanceOf(Conflict);
  });

  it("exhaustion is Conflict attention_concurrent_write / retry and leaks no record text", async () => {
    const t = await setup(() => true);
    try {
      await t.wrappedStore.readAttentionSnapshot(t.ws, REQ);
      expect.unreachable("must conflict");
    } catch (error) {
      expect(error).toBeInstanceOf(Conflict);
      expect((error as Conflict).details).toMatchObject({ recoveryCode: "attention_concurrent_write", nextAction: "retry" });
      expect(JSON.stringify((error as Conflict).details)).not.toMatch(/concurrent-|seed/);
    }
    expect(t.tipCalls()).toBe(6);
  });

  it("the attention read issues only SELECTs (no write, no migration)", async () => {
    const t = await setup(() => false);
    t.sqlSeen.length = 0;
    await t.wrappedStore.readAttentionSnapshot(t.ws, REQ);
    expect(t.sqlSeen.length).toBeGreaterThan(0);
    for (const sql of t.sqlSeen) expect(sql.replace(/\/\*.*?\*\//g, "").trim()).toMatch(/^SELECT\b/i);
  });

  it("skips sources not run for the actor (no task:update, inactive review)", async () => {
    const t = await setup(() => false);
    const snap = await t.wrappedStore.readAttentionSnapshot(t.ws, { who: WHO, canTaskUpdate: false, includeReview: false });
    expect(snap.assignedBlocked).toEqual({ total: 0, rows: [] });
    expect(snap.awaitingReview).toBeUndefined();
  });
});

describe("FAC-001 D1 (emulation): authorization before retrieval on the async path", () => {
  it("a non-participant is refused with no attention source read", async () => {
    const t = await setup(() => false);
    const calls: string[] = [];
    const spy = new Proxy(t.plain, {
      get(target, prop, receiver) {
        const v = Reflect.get(target, prop, receiver);
        if (typeof v !== "function") return v;
        return (...args: unknown[]) => { calls.push(String(prop)); return (v as (...a: unknown[]) => unknown).apply(target, args); };
      },
    }) as AsyncCampfireStore;
    const svc = createAsyncCampfireService({ store: spy, idSource: createCounterIdSource(), clock: () => NOW });
    await expect(svc.getWorkspaceAttention(stranger, { workspaceId: t.ws })).rejects.toMatchObject({ code: expect.stringMatching(/Unauthorized|ParticipantRequired|WorkspaceNotFound/) });
    expect(calls).not.toContain("readAttentionSnapshot");
    expect(calls).not.toContain("pageContributions");
    expect(calls).not.toContain("maxAppendPosition");
  });

  it("a nonexistent workspace is refused with no attention source read", async () => {
    const t = await setup(() => false);
    await expect(t.service.getWorkspaceAttention(owner, { workspaceId: "ws_nope" })).rejects.toBeDefined();
    expect(t.tipCalls()).toBe(0);
  });
});

describe("FAC-001 phase B: no migration", () => {
  it("adds no migration or schema file mentioning attention", () => {
    const names = [
      ...readdirSync(new URL("../../src/store/", import.meta.url)),
      ...readdirSync(new URL("../../src/worker/", import.meta.url)),
    ];
    expect(names.filter((n) => /attention/i.test(n) && /migrat|schema/i.test(n))).toEqual([]);
  });
});
