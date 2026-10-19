import { afterEach, describe, expect, it } from "vitest";
import type { ActorRef, Contribution, DecisionStatus, TaskStatus } from "../../src/domain/types.js";
import type { ObjectPage } from "../../src/store/context-queries.js";
import { openInMemoryStore } from "../../src/store/sqlite-store.js";
import type { CampfireStore } from "../../src/store/store.js";
import { createD1Store, migrateD1, type AsyncCampfireStore } from "../../src/worker/d1-store.js";
import { sqliteD1 } from "../helpers/sqlite-d1.js";

const NOW = "2026-01-01T00:00:00.000Z";
const HUMAN: ActorRef = { actorId: "hum_1", actorType: "human" };

let sqlite: CampfireStore | undefined;
let adapter: ReturnType<typeof sqliteD1> | undefined;

afterEach(() => {
  sqlite?.close();
  adapter?.database.close();
  sqlite = undefined;
  adapter = undefined;
});

describe("context store D1 parity", () => {
  it("returns the same page ids, totals, and hasMore as SQLite", async () => {
    sqlite = openInMemoryStore();
    adapter = sqliteD1();
    await migrateD1(adapter.binding);
    const remote = createD1Store(adapter.binding);
    await seed(sqlite);
    await seed(remote);

    await expectSamePage(
      sqlite.pageDecisions("ws_1", { limit: 2 }),
      remote.pageDecisions("ws_1", { limit: 2 }),
    );
    const sqliteDecisions = sqlite.pageDecisions("ws_1", { limit: 2 });
    await expectSamePage(
      sqlite.pageDecisions("ws_1", { limit: 2, after: sqliteDecisions.next }),
      remote.pageDecisions("ws_1", { limit: 2, after: sqliteDecisions.next }),
    );

    await expectSamePage(
      sqlite.pageTasks("ws_1", { limit: 2, statuses: ["blocked"] }),
      remote.pageTasks("ws_1", { limit: 2, statuses: ["blocked"] }),
    );
    await expectSamePage(
      sqlite.pageFindings("ws_1", { limit: 2 }),
      remote.pageFindings("ws_1", { limit: 2 }),
    );
    await expectSamePage(
      sqlite.pageArtifacts("ws_1", { limit: 1 }),
      remote.pageArtifacts("ws_1", { limit: 1 }),
    );
    await expectSamePage(
      sqlite.pageContributions("ws_1", { limit: 2, materiality: "high" }),
      remote.pageContributions("ws_1", { limit: 2, materiality: "high" }),
    );
    await expectSamePage(
      sqlite.pageContributions("ws_1", { limit: 10, materiality: "normal" }),
      remote.pageContributions("ws_1", { limit: 10, materiality: "normal" }),
    );
    const sqliteChanges = sqlite.pageContributions("ws_1", { limit: 2 });
    await expectSamePage(sqliteChanges, remote.pageContributions("ws_1", { limit: 2 }));
    const anchor = sqliteChanges.items.at(-1);
    expect(anchor?.appendPosition).toBeGreaterThan(0);
    await expectSamePage(
      sqlite.pageContributions("ws_1", { limit: 2, afterPosition: anchor!.appendPosition }),
      remote.pageContributions("ws_1", { limit: 2, afterPosition: anchor!.appendPosition }),
    );
    await expectSamePage(
      sqlite.pageContributions("ws_1", { limit: 10, throughPosition: anchor!.appendPosition }),
      remote.pageContributions("ws_1", { limit: 10, throughPosition: anchor!.appendPosition }),
    );

    const stored = sqlite.listContributions("ws_1");
    const z = stored.find((row) => row.id === "con_z");
    const a = stored.find((row) => row.id === "con_a");
    expect(z?.appendPosition).toBeLessThan(a?.appendPosition ?? 0);
    const reverseQuery = {
      limit: 10,
      afterPosition: z!.appendPosition - 1,
      throughPosition: a!.appendPosition,
    };
    const reverse = sqlite.pageContributions("ws_1", reverseQuery);
    expect(reverse.items.map((item) => item.id)).toEqual(["con_z", "con_a"]);
    expect(reverse.items.map((item) => item.appendPosition)).toEqual([z!.appendPosition, a!.appendPosition]);
    await expectSamePage(reverse, remote.pageContributions("ws_1", reverseQuery));
    const reversePage = { limit: 1, afterPosition: z!.appendPosition, throughPosition: a!.appendPosition };
    const second = sqlite.pageContributions("ws_1", reversePage);
    expect(second.items.map((item) => item.id)).toEqual(["con_a"]);
    await expectSamePage(second, remote.pageContributions("ws_1", reversePage));

    expect(sqlite.countParticipants("ws_1")).toBe(5);
    expect(await remote.countParticipants("ws_1")).toBe(5);
    expect(sqlite.countParticipants("ws_1", "hum_1")).toBe(1);
    expect(await remote.countParticipants("ws_1", "hum_1")).toBe(1);
    const people = sqlite.pageParticipants("ws_1", { limit: 2 });
    expect(people.items.map((item) => item.actor.actorId)).toEqual(["agt_a", "agt_b"]);
    expect(people.total).toBe(5);
    expect(people.hasMore).toBe(true);
    expect(people.items.every((item) => item.humanOwnerIsParticipant === true)).toBe(true);
    await expectSameValue(people, remote.pageParticipants("ws_1", { limit: 2 }));
    const peopleNext = sqlite.pageParticipants("ws_1", {
      limit: 2,
      after: { actorType: "agent", actorId: "agt_b" },
    });
    expect(peopleNext.items.map((item) => item.actor.actorId)).toEqual(["agt_out", "hum_1"]);
    expect(peopleNext.items[0]?.humanOwnerIsParticipant).toBe(false);
    expect(peopleNext.items[1]).not.toHaveProperty("humanOwnerIsParticipant");
    await expectSameValue(peopleNext, remote.pageParticipants("ws_1", {
      limit: 2,
      after: { actorType: "agent", actorId: "agt_b" },
    }));
    const owned = sqlite.pageParticipants("ws_1", { limit: 20, humanOwnerId: "hum_out" });
    expect(owned.items.map((item) => item.actor.actorId)).toEqual(["agt_out"]);
    expect(owned.total).toBe(1);
    await expectSameValue(owned, remote.pageParticipants("ws_1", { limit: 20, humanOwnerId: "hum_out" }));
    const none = sqlite.pageParticipants("ws_1", { limit: 20, humanOwnerId: "hum_none" });
    expect(none).toEqual({ items: [], total: 0, hasMore: false });
    await expectSameValue(none, remote.pageParticipants("ws_1", { limit: 20, humanOwnerId: "hum_none" }));

    const tip = sqlite.maxAppendPosition("ws_1");
    expect(tip).toBe(await remote.maxAppendPosition("ws_1"));
    const historyQuery = { limit: 1, objectType: "decision" as const, objectId: "dec_b", tip };
    const history = sqlite.pageRecordHistory("ws_1", historyQuery);
    expect(history.items.map((item) => item.id)).toEqual(["con_dec_late"]);
    expect(history.total).toBe(2);
    expect(history.hasMore).toBe(true);
    await expectSameValue(history, remote.pageRecordHistory("ws_1", historyQuery));
    const older = {
      limit: 10,
      objectType: "decision" as const,
      objectId: "dec_b",
      tip,
      beforePosition: history.items[0]!.appendPosition,
    };
    const historyNext = sqlite.pageRecordHistory("ws_1", older);
    expect(historyNext.items.map((item) => item.id)).toEqual(["con_dec"]);
    expect(historyNext.total).toBe(2);
    expect(historyNext.hasMore).toBe(false);
    expect(historyNext.items.some((item) => item.id === "con_other")).toBe(false);
    await expectSameValue(historyNext, remote.pageRecordHistory("ws_1", older));
  });
});

async function expectSameValue<T>(local: T, remote: Promise<T>): Promise<void> {
  expect(await remote).toEqual(local);
}

async function expectSamePage<T extends { id: string }>(
  local: ObjectPage<T>,
  remote: Promise<ObjectPage<T>>,
): Promise<void> {
  const page = await remote;
  expect(page.items.map((item) => item.id)).toEqual(local.items.map((item) => item.id));
  expect(page.total).toBe(local.total);
  expect(page.hasMore).toBe(local.hasMore);
  if (local.items.some((item) => "appendPosition" in item)) {
    expect(page.items.map((item) => (item as { appendPosition?: number }).appendPosition)).toEqual(
      local.items.map((item) => (item as { appendPosition?: number }).appendPosition),
    );
  }
}

let nextAppendPosition = 0;

async function seed(store: CampfireStore | AsyncCampfireStore): Promise<void> {
  nextAppendPosition = 0;
  await store.createOrganization({ id: "org_1", name: "Boring Infra Co.", createdAt: NOW });
  await store.createTeam({ id: "team_1", organizationId: "org_1", name: "Engineering", createdAt: NOW });
  await store.createHuman({ id: "hum_1", teamId: "team_1", displayName: "Ada", createdAt: NOW });
  await store.createHuman({ id: "hum_2", teamId: "team_1", displayName: "Bea", createdAt: NOW });
  await store.createHuman({ id: "hum_out", teamId: "team_1", displayName: "Out", createdAt: NOW });
  await store.createAgent({
    id: "agt_a",
    teamId: "team_1",
    humanId: "hum_1",
    name: "A",
    harness: "codex",
    createdAt: NOW,
  });
  await store.createAgent({
    id: "agt_b",
    teamId: "team_1",
    humanId: "hum_2",
    name: "B",
    harness: "opencode",
    createdAt: NOW,
  });
  await store.createAgent({
    id: "agt_out",
    teamId: "team_1",
    humanId: "hum_out",
    name: "Out",
    harness: "codex",
    createdAt: NOW,
  });
  await store.createWorkspace({
    id: "ws_1",
    teamId: "team_1",
    name: "Workspace",
    status: "active",
    createdBy: HUMAN,
    createdAt: NOW,
    updatedAt: NOW,
  });
  await store.addParticipant({ workspaceId: "ws_1", actor: HUMAN, role: "owner", joinedAt: NOW });
  await store.addParticipant({
    workspaceId: "ws_1",
    actor: { actorId: "hum_2", actorType: "human" },
    role: "member",
    joinedAt: "2026-01-02T00:00:00.000Z",
  });
  await store.addParticipant({
    workspaceId: "ws_1",
    actor: { actorId: "agt_a", actorType: "agent" },
    role: "agent",
    joinedAt: "2026-01-03T00:00:00.000Z",
  });
  await store.addParticipant({
    workspaceId: "ws_1",
    actor: { actorId: "agt_b", actorType: "agent" },
    role: "agent",
    joinedAt: "2026-01-04T00:00:00.000Z",
  });
  await store.addParticipant({
    workspaceId: "ws_1",
    actor: { actorId: "agt_out", actorType: "agent" },
    role: "agent",
    joinedAt: "2026-01-05T00:00:00.000Z",
  });

  const decisions: Array<{ id: string; status: DecisionStatus; updatedAt: string }> = [
    { id: "dec_m", status: "accepted", updatedAt: "2026-03-01T00:00:00.000Z" },
    { id: "dec_b", status: "accepted", updatedAt: "2026-03-01T00:00:00.000Z" },
    { id: "dec_old", status: "accepted", updatedAt: "2026-01-01T00:00:00.000Z" },
    { id: "dec_proposed", status: "proposed", updatedAt: "2026-06-01T00:00:00.000Z" },
    { id: "dec_super", status: "superseded", updatedAt: "2026-07-01T00:00:00.000Z" },
  ];
  for (const row of decisions) {
    await store.createDecision({
      id: row.id,
      workspaceId: "ws_1",
      summary: row.id,
      status: row.status,
      createdBy: HUMAN,
      createdAt: row.updatedAt,
      updatedAt: row.updatedAt,
    });
  }

  const tasks: Array<{ id: string; status: TaskStatus; updatedAt: string }> = [
    { id: "task_b1", status: "blocked", updatedAt: "2026-04-01T00:00:00.000Z" },
    { id: "task_open", status: "open", updatedAt: "2026-09-01T00:00:00.000Z" },
    { id: "task_b2", status: "blocked", updatedAt: "2026-05-01T00:00:00.000Z" },
  ];
  for (const row of tasks) {
    await store.createTask({
      id: row.id,
      workspaceId: "ws_1",
      title: row.id,
      status: row.status,
      createdBy: HUMAN,
      createdAt: row.updatedAt,
      updatedAt: row.updatedAt,
    });
  }

  await store.createArtifact({
    id: "art_plain",
    workspaceId: "ws_1",
    type: "document",
    title: "Plain",
    uriOrPath: "plain.md",
    createdBy: HUMAN,
    createdAt: "2026-06-01T00:00:00.000Z",
  });
  await store.createArtifact({
    id: "art_cited",
    workspaceId: "ws_1",
    type: "document",
    title: "Cited",
    uriOrPath: "cited.md",
    createdBy: HUMAN,
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  await store.createFinding({
    id: "find_bare",
    workspaceId: "ws_1",
    summary: "Bare",
    createdBy: HUMAN,
    createdAt: "2026-06-01T00:00:00.000Z",
  });
  await store.createFinding({
    id: "find_sourced",
    workspaceId: "ws_1",
    summary: "Cited",
    sourceArtifactId: "art_cited",
    createdBy: HUMAN,
    createdAt: "2026-01-01T00:00:00.000Z",
  });

  const contributions: Contribution[] = [
    contribution("con_find", "2026-01-01T00:00:00.000Z", "create", "finding", "find_sourced"),
    contribution("con_dec", "2026-01-02T00:00:00.000Z", "update", "decision", "dec_b", { status: "accepted" }),
    contribution("con_sess", "2026-01-03T00:00:00.000Z", "register_session", "agent_session", "ses_1"),
    contribution("con_task", "2026-01-04T00:00:00.000Z", "update", "task", "task_b1", { title: "rename" }),
    contribution("con_goal", "2026-01-05T00:00:00.000Z", "create", "goal", "goal_1"),
  ];
  for (const row of contributions) await store.createContribution(row);
  const at = "2026-08-01T00:00:00.000Z";
  await store.createContribution(contribution("con_z", at, "create", "task", "task_z"));
  await store.createContribution(contribution("con_a", at, "create", "task", "task_a"));
  await store.createContribution(
    contribution("con_dec_late", "2026-09-01T00:00:00.000Z", "update", "decision", "dec_b", { status: "accepted" }),
  );
  await store.createContribution(
    contribution("con_other", "2026-09-02T00:00:00.000Z", "update", "task", "task_open", { title: "later" }),
  );
}

function contribution(
  id: string,
  createdAt: string,
  action: Contribution["action"],
  objectType: Contribution["objectType"],
  objectId: string,
  payload?: Record<string, unknown>,
): Contribution {
  nextAppendPosition += 1;
  return {
    id,
    workspaceId: "ws_1",
    actor: HUMAN,
    action,
    objectType,
    objectId,
    ...(payload === undefined ? {} : { payload }),
    createdAt,
    appendPosition: nextAppendPosition,
  };
}
