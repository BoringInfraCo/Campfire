/**
 * MEM-001 D1 snapshot bracket: readMemoryHealthSnapshot retries when the
 * contribution tip moves between reads and gives up with a typed Conflict.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createCounterIdSource } from "../../src/domain/ids.js";
import { Conflict } from "../../src/domain/errors.js";
import { MEMORY_HEALTH_TIP_SQL } from "../../src/store/memory-health-queries.js";
import { createAsyncCampfireService } from "../../src/worker/async-service.js";
import { createD1Store, migrateD1 } from "../../src/worker/d1-store.js";
import type { D1Database } from "../../src/worker/d1-types.js";
import { sqliteD1 } from "../helpers/sqlite-d1.js";

const NOW = "2026-01-01T00:00:00.000Z";
const owner = { actor: { actorId: "hum_1", actorType: "human" as const } };
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
  const ws = await writer.createWorkspace(owner, { teamId: "team_1", name: "W" });
  await writer.createTask(owner, { workspaceId: ws.id, title: "seed" });

  let tipCalls = 0;
  let mutating = false;
  const wrapped: D1Database = {
    ...adapter.binding,
    prepare(sql) {
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
              // Odd calls are the "before" read of an attempt; even calls the "after" read.
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
  return { wrappedStore, service, ws: ws.id, tipCalls: () => tipCalls, plain };
}

describe("MEM-001 D1: readMemoryHealthSnapshot retry bracket", () => {
  it("reads once without retry when the tip is stable", async () => {
    const t = await setup(() => false);
    const snapshot = await t.wrappedStore.readMemoryHealthSnapshot(t.ws);
    expect(t.tipCalls()).toBe(2);
    expect(snapshot.tip).toBeDefined();
  });

  it("retries after one concurrent append and returns the post-append tip and rows", async () => {
    const t = await setup((call) => call === 1);
    const before = await t.plain.readMemoryHealthSnapshot(t.ws);
    const snapshot = await t.wrappedStore.readMemoryHealthSnapshot(t.ws);
    // First read (2 tip reads): tip moved. Second attempt: stable. The call counter also includes the earlier plain read? No, plain is unwrapped.
    expect(t.tipCalls()).toBe(4);
    expect(snapshot.tip!.appendPosition).toBeGreaterThan(before.tip!.appendPosition);
    expect(snapshot.rows.tasks.some((task) => task.id.length > 0)).toBe(true);
    const after = await t.plain.readMemoryHealthSnapshot(t.ws);
    expect(snapshot.tip).toEqual(after.tip);
    expect(snapshot.rows.tasks.length).toBe(after.rows.tasks.length);
  });

  it("throws Conflict memory_health_concurrent_write after three moving attempts", async () => {
    const t = await setup(() => true);
    await expect(t.wrappedStore.readMemoryHealthSnapshot(t.ws)).rejects.toBeInstanceOf(Conflict);
    expect(t.tipCalls()).toBe(6);
    try {
      await t.wrappedStore.readMemoryHealthSnapshot(t.ws);
      expect.unreachable("must conflict");
    } catch (error) {
      expect((error as Conflict).details).toMatchObject({ recoveryCode: "memory_health_concurrent_write", nextAction: "retry" });
      expect(JSON.stringify((error as Conflict).details)).not.toMatch(/concurrent-|seed/);
    }
  });

  it("succeeds on the third attempt but not the fourth", async () => {
    const third = await setup((call) => call <= 3);
    await expect(third.wrappedStore.readMemoryHealthSnapshot(third.ws)).resolves.toBeDefined();
    expect(third.tipCalls()).toBe(6);
    const fourth = await setup((call) => call <= 5);
    await expect(fourth.wrappedStore.readMemoryHealthSnapshot(fourth.ws)).rejects.toBeInstanceOf(Conflict);
  });

  it("surfaces the conflict through getMemoryHealth and writes no contribution of its own", async () => {
    const t = await setup(() => true);
    await expect(t.service.getMemoryHealth(owner, { workspaceId: t.ws })).rejects.toMatchObject({
      details: { recoveryCode: "memory_health_concurrent_write" },
    });
  });
});
