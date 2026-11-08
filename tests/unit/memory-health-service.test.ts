/**
 * MEM-001 step 2: the authorized getMemoryHealth read returns the same
 * semantic result on SQLite and D1, authorizes before reading, and writes nothing.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createCounterIdSource } from "../../src/domain/ids.js";
import { Conflict, ParticipantRequired, ValidationError, WorkspaceNotFound } from "../../src/domain/errors.js";
import type { ActorRef } from "../../src/domain/types.js";
import type { ActorContext } from "../../src/service/authorization.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import { openInMemoryStore } from "../../src/store/sqlite-store.js";
import { createAsyncCampfireService } from "../../src/worker/async-service.js";
import { createD1Store, migrateD1 } from "../../src/worker/d1-store.js";
import { sqliteD1 } from "../helpers/sqlite-d1.js";

const NOW = "2026-01-01T00:00:00.000Z";
const HUMAN: ActorRef = { actorId: "hum_1", actorType: "human" };
const OUTSIDER: ActorRef = { actorId: "hum_2", actorType: "human" };
const owner: ActorContext = { actor: HUMAN };
const outsider: ActorContext = { actor: OUTSIDER };

function clock() {
  let ms = Date.parse(NOW);
  return () => new Date((ms += 1000)).toISOString();
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

async function seedBoth() {
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
  sqlite.createOrganization({ id: "org_1", name: "Org", createdAt: NOW });
  sqlite.createTeam({ id: "team_1", organizationId: "org_1", name: "Team", createdAt: NOW });
  sqlite.createHuman({ id: "hum_1", teamId: "team_1", displayName: "Ada", createdAt: NOW });
  sqlite.createHuman({ id: "hum_2", teamId: "team_1", displayName: "Eve", createdAt: NOW });
  await remote.createOrganization({ id: "org_1", name: "Org", createdAt: NOW });
  await remote.createTeam({ id: "team_1", organizationId: "org_1", name: "Team", createdAt: NOW });
  await remote.createHuman({ id: "hum_1", teamId: "team_1", displayName: "Ada", createdAt: NOW });
  await remote.createHuman({ id: "hum_2", teamId: "team_1", displayName: "Eve", createdAt: NOW });

  const ws = sync.createWorkspace(owner, { teamId: "team_1", name: "W" });
  const wsA = await async_.createWorkspace(owner, { teamId: "team_1", name: "W" });
  expect(wsA.id).toBe(ws.id);

  // Blocked task with no description or assignee, plus one clean in-progress task.
  const blocked = sync.createTask(owner, { workspaceId: ws.id, title: "t" });
  sync.updateTask(owner, { taskId: blocked.id, status: "blocked" });
  const blockedA = await async_.createTask(owner, { workspaceId: ws.id, title: "t" });
  await async_.updateTask(owner, { taskId: blockedA.id, status: "blocked" });

  // Accepted decision citing a finding that is later withdrawn.
  const f = sync.addFinding(owner, { workspaceId: ws.id, summary: "f", detail: "d" });
  const d = sync.addDecision(owner, { workspaceId: ws.id, summary: "d" });
  sync.citeDecisionBasis(owner, { decisionId: d.id, findingId: f.id });
  sync.acceptDecision(owner, d.id);
  sync.withdrawFinding(owner, { findingId: f.id, reason: "wrong" });
  const fA = await async_.addFinding(owner, { workspaceId: ws.id, summary: "f", detail: "d" });
  const dA = await async_.addDecision(owner, { workspaceId: ws.id, summary: "d" });
  await async_.citeDecisionBasis(owner, { decisionId: dA.id, findingId: fA.id });
  await async_.acceptDecision(owner, dA.id);
  await async_.withdrawFinding(owner, { findingId: fA.id, reason: "wrong" });
  return { sync, async_, workspaceId: ws.id, sqlite };
}

describe("MEM-001 getMemoryHealth service parity", () => {
  it("returns equal semantic results on SQLite and D1 with the same frozen inputs", async () => {
    const { sync, async_, workspaceId } = await seedBoth();
    const left = sync.getMemoryHealth(owner, { workspaceId });
    const right = await async_.getMemoryHealth(owner, { workspaceId });
    const { observedAt: _l, ...l } = left;
    const { observedAt: _r, ...r } = right;
    expect(r).toEqual(l);
    expect(left.cues.map((c) => c.reason)).toEqual([
      "accepted_decision_needs_review",
      "blocked_task_missing_context",
    ]);
    expect(left.coverage).toMatchObject({ total: 2, returned: 2, truncated: false });
    expect(left.nextCursor).toBeUndefined();
  });

  it("pages deterministically and rejects a stale cursor with the typed conflict", async () => {
    const { sync, async_, workspaceId } = await seedBoth();
    const page1 = sync.getMemoryHealth(owner, { workspaceId, limit: 1 });
    expect(page1.coverage.truncated).toBe(true);
    const page2 = sync.getMemoryHealth(owner, { workspaceId, limit: 1, cursor: page1.nextCursor! });
    expect(page2.coverage.total).toBe(page1.coverage.total);
    expect(page2.cues[0]?.id).not.toBe(page1.cues[0]?.id);
    expect(page2.orientationCursor).toBe(page1.orientationCursor);

    sync.createTask(owner, { workspaceId, title: "moves the tip" });
    expect(() => sync.getMemoryHealth(owner, { workspaceId, limit: 1, cursor: page1.nextCursor! })).toThrow(Conflict);
    try {
      sync.getMemoryHealth(owner, { workspaceId, limit: 1, cursor: page1.nextCursor! });
    } catch (error) {
      expect((error as Conflict).details).toMatchObject({
        recoveryCode: "memory_health_stale_cursor",
        field: "cursor",
        nextAction: "restart_without_cursor",
      });
    }
    const asyncPage = await async_.getMemoryHealth(owner, { workspaceId, limit: 1 });
    await async_.createTask(owner, { workspaceId, title: "moves the tip" });
    await expect(async_.getMemoryHealth(owner, { workspaceId, limit: 1, cursor: asyncPage.nextCursor! })).rejects.toBeInstanceOf(
      Conflict,
    );
  });

  it("authorizes before validating or reading, and never writes", async () => {
    const { sync, async_, workspaceId, sqlite } = await seedBoth();
    const before = sqlite.countObjects("contributions", workspaceId);
    expect(() => sync.getMemoryHealth(outsider, { workspaceId, reason: "bogus" })).toThrow(ParticipantRequired);
    await expect(async_.getMemoryHealth(outsider, { workspaceId, reason: "bogus" })).rejects.toBeInstanceOf(
      ParticipantRequired,
    );
    expect(() => sync.getMemoryHealth(owner, { workspaceId: "ws_missing" })).toThrow(WorkspaceNotFound);
    expect(() => sync.getMemoryHealth(owner, { workspaceId, reason: "bogus" })).toThrow(ValidationError);
    expect(() => sync.getMemoryHealth(owner, { workspaceId, cursor: "mh1.garbage" })).toThrow(ValidationError);
    sync.getMemoryHealth(owner, { workspaceId });
    expect(sqlite.countObjects("contributions", workspaceId)).toBe(before);
  });

  it("reports an empty workspace with the genesis cursor and no cues", async () => {
    const { sync, workspaceId } = await seedBoth();
    const empty = sync.createWorkspace(owner, { teamId: "team_1", name: "Empty" });
    const result = sync.getMemoryHealth(owner, { workspaceId: empty.id });
    expect(result.cues).toEqual([]);
    expect(result.coverage).toMatchObject({ total: 0, returned: 0, truncated: false });
    expect(workspaceId).not.toBe(empty.id);
  });
});

import { isPublicationBlockedMethod } from "../../src/publication/state.js";

describe("MEM-001 publication freeze", () => {
  it("keeps get_memory_health available while local writes are frozen", () => {
    expect(isPublicationBlockedMethod("get_memory_health")).toBe(false);
    expect(isPublicationBlockedMethod("recall_workspace")).toBe(false);
  });
});

import { MEMORY_HEALTH_RESPONSE_MAX_BYTES } from "../../src/domain/memory-health.js";

describe("MEM-001 service byte budget", () => {
  it("applies the frozen serialized budget on the real read path", async () => {
    const { sync, workspaceId } = await seedBoth();
    const full = sync.getMemoryHealth(owner, { workspaceId });
    expect(Buffer.byteLength(JSON.stringify(full.cues), "utf8")).toBeLessThanOrEqual(MEMORY_HEALTH_RESPONSE_MAX_BYTES);
  });
});
