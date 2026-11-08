/**
 * MEM-001 step 3: get_memory_health over HTTP dispatch is semantically equal
 * on sync (SQLite) and async (D1) dispatch, and denies non-participants.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createCounterIdSource } from "../../src/domain/ids.js";
import type { ActorContext } from "../../src/service/authorization.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import { dispatchCampfireMethod, isDeliveryEligibleMethod } from "../../src/http/dispatch.js";
import { dispatchCampfireMethodAsync } from "../../src/worker/async-dispatch.js";
import { openInMemoryStore } from "../../src/store/sqlite-store.js";
import { createAsyncCampfireService } from "../../src/worker/async-service.js";
import { createD1Store, migrateD1 } from "../../src/worker/d1-store.js";
import { sqliteD1 } from "../helpers/sqlite-d1.js";

const NOW = "2026-01-01T00:00:00.000Z";
const owner: ActorContext = { actor: { actorId: "hum_1", actorType: "human" } };
const outsider: ActorContext = { actor: { actorId: "hum_2", actorType: "human" } };

function clock() {
  let ms = Date.parse(NOW);
  return () => new Date((ms += 1000)).toISOString();
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

async function seed() {
  const sqlite = openInMemoryStore();
  const adapter = sqliteD1();
  await migrateD1(adapter.binding);
  const remote = createD1Store(adapter.binding);
  const sync = createCampfireService({ store: sqlite, idSource: createCounterIdSource(), clock: clock() });
  const async_ = createAsyncCampfireService({ store: remote, idSource: createCounterIdSource(), clock: clock() });
  cleanups.push(() => {
    sync.close();
    adapter.database.close();
  });
  for (const s of [sqlite, remote] as const) {
    await s.createOrganization({ id: "org_1", name: "Org", createdAt: NOW });
    await s.createTeam({ id: "team_1", organizationId: "org_1", name: "Team", createdAt: NOW });
    await s.createHuman({ id: "hum_1", teamId: "team_1", displayName: "Ada", createdAt: NOW });
    await s.createHuman({ id: "hum_2", teamId: "team_1", displayName: "Eve", createdAt: NOW });
  }
  const ws = sync.createWorkspace(owner, { teamId: "team_1", name: "W" });
  await async_.createWorkspace(owner, { teamId: "team_1", name: "W" });
  const t = sync.createTask(owner, { workspaceId: ws.id, title: "t" });
  sync.updateTask(owner, { taskId: t.id, status: "blocked" });
  const tA = await async_.createTask(owner, { workspaceId: ws.id, title: "t" });
  await async_.updateTask(owner, { taskId: tA.id, status: "blocked" });
  return { sync, async_, workspaceId: ws.id };
}

describe("get_memory_health dispatch", () => {
  it("returns equal semantic results through sync and D1 dispatch", async () => {
    const { sync, async_, workspaceId } = await seed();
    const left = dispatchCampfireMethod(sync, owner, "get_memory_health", { workspaceId }) as Record<string, unknown>;
    const right = (await dispatchCampfireMethodAsync(async_, owner, "get_memory_health", { workspaceId })) as Record<string, unknown>;
    const { observedAt: _l, ...l } = left;
    const { observedAt: _r, ...r } = right;
    expect(r).toEqual(l);
    expect((left.cues as unknown[]).length).toBeGreaterThan(0);
    expect(isDeliveryEligibleMethod("get_memory_health")).toBe(false);
  });

  it("denies an actor who is not a workspace participant on both paths", async () => {
    const { sync, async_, workspaceId } = await seed();
    expect(() => dispatchCampfireMethod(sync, outsider, "get_memory_health", { workspaceId })).toThrow();
    await expect(
      dispatchCampfireMethodAsync(async_, outsider, "get_memory_health", { workspaceId }),
    ).rejects.toThrow();
  });
});
