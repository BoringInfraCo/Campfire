import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { contributionMateriality, decisionRank } from "../../src/domain/context-policy.js";
import type { ActorRef, Contribution, Decision, DecisionStatus, TaskStatus } from "../../src/domain/types.js";
import { pageContributionsSql, pageDecisionsSql, type SqlStatement } from "../../src/store/context-queries.js";
import { openInMemoryStore, openSqliteStore } from "../../src/store/sqlite-store.js";
import type { CampfireStore } from "../../src/store/store.js";

const NOW = "2026-01-01T00:00:00.000Z";
const HUMAN: ActorRef = { actorId: "hum_1", actorType: "human" };

let store: CampfireStore;
let contributionSequence = 0;

beforeEach(() => {
  contributionSequence = 0;
  store = openInMemoryStore();
  seedIdentity(store);
});

afterEach(() => {
  store.close();
});

function seedIdentity(target: CampfireStore): void {
  target.createOrganization({ id: "org_1", name: "Boring Infra Co.", createdAt: NOW });
  target.createTeam({ id: "team_1", organizationId: "org_1", name: "Engineering", createdAt: NOW });
  target.createHuman({ id: "hum_1", teamId: "team_1", displayName: "Ada", createdAt: NOW });
  target.createWorkspace({
    id: "ws_1",
    teamId: "team_1",
    name: "Workspace",
    status: "active",
    createdBy: HUMAN,
    createdAt: NOW,
    updatedAt: NOW,
  });
  target.createWorkspace({
    id: "ws_2",
    teamId: "team_1",
    name: "Other",
    status: "active",
    createdBy: HUMAN,
    createdAt: NOW,
    updatedAt: NOW,
  });
}

function decision(id: string, status: DecisionStatus, updatedAt: string, workspaceId = "ws_1"): Decision {
  return {
    id,
    workspaceId,
    summary: id,
    status,
    createdBy: HUMAN,
    createdAt: updatedAt,
    updatedAt,
  };
}

function byDecisionOrder(rows: readonly Decision[]): Decision[] {
  return [...rows].sort((left, right) => {
    const rank = decisionRank(left.status) - decisionRank(right.status);
    if (rank !== 0) return rank;
    if (left.updatedAt !== right.updatedAt) return left.updatedAt < right.updatedAt ? 1 : -1;
    if (left.id === right.id) return 0;
    return left.id < right.id ? -1 : 1;
  });
}

describe("context store pages", () => {
  it("pages decisions by rank, then updatedAt DESC, then id ASC", () => {
    const rows = [
      decision("dec_m", "accepted", "2026-03-01T00:00:00.000Z"),
      decision("dec_b", "accepted", "2026-03-01T00:00:00.000Z"),
      decision("dec_old", "accepted", "2026-01-01T00:00:00.000Z"),
      decision("dec_new_proposed", "proposed", "2026-06-01T00:00:00.000Z"),
      decision("dec_super", "superseded", "2026-07-01T00:00:00.000Z"),
      decision("dec_other", "accepted", "2026-08-01T00:00:00.000Z", "ws_2"),
    ];
    for (const row of rows) store.createDecision(row);
    const expected = byDecisionOrder(rows.filter((row) => row.workspaceId === "ws_1"));

    const page1 = store.pageDecisions("ws_1", { limit: 2 });
    expect(page1.next).toBeDefined();
    const page2 = store.pageDecisions("ws_1", { limit: 2, after: page1.next });
    expect(page1.items.map((item) => item.id)).toEqual(expected.slice(0, 2).map((row) => row.id));
    expect(page2.items.map((item) => item.id)).toEqual(expected.slice(2, 4).map((row) => row.id));
    expect(page1.items.map((item) => item.id).filter((id) => page2.items.some((item) => item.id === id))).toEqual([]);
    expect(page1.total).toBe(expected.length);
    expect(page2.total).toBe(expected.length);
    expect(page1.items[0]).not.toHaveProperty("context_rank");
    expect(store.countDecisions("ws_1")).toBe(expected.length);
    expect(store.countDecisions("ws_1", ["accepted"])).toBe(expected.filter((row) => row.status === "accepted").length);

    const collected: string[] = [];
    let after = page1.next;
    collected.push(...page1.items.map((item) => item.id));
    let guard = 0;
    while (after !== undefined && guard < 10) {
      const page = store.pageDecisions("ws_1", { limit: 2, after });
      collected.push(...page.items.map((item) => item.id));
      after = page.next;
      guard += 1;
    }
    expect(collected).toEqual(expected.map((row) => row.id));
    expect(new Set(collected).size).toBe(collected.length);

    const counts = store.countObjectsByStatus("decisions", "ws_1").sort((left, right) => left.status.localeCompare(right.status));
    expect(counts).toEqual([
      { status: "accepted", count: 3 },
      { status: "proposed", count: 1 },
      { status: "superseded", count: 1 },
    ]);
  });

  it("filters tasks by status and totals the filtered rows", () => {
    const tasks: Array<{ id: string; status: TaskStatus; updatedAt: string }> = [
      { id: "task_b1", status: "blocked", updatedAt: "2026-04-01T00:00:00.000Z" },
      { id: "task_open", status: "open", updatedAt: "2026-09-01T00:00:00.000Z" },
      { id: "task_b3", status: "blocked", updatedAt: "2026-05-01T00:00:00.000Z" },
      { id: "task_b2", status: "blocked", updatedAt: "2026-05-01T00:00:00.000Z" },
      { id: "task_done", status: "completed", updatedAt: "2026-08-01T00:00:00.000Z" },
    ];
    for (const task of tasks) {
      store.createTask({
        id: task.id,
        workspaceId: "ws_1",
        title: task.id,
        status: task.status,
        createdBy: HUMAN,
        createdAt: task.updatedAt,
        updatedAt: task.updatedAt,
      });
    }

    const page1 = store.pageTasks("ws_1", { limit: 2, statuses: ["blocked"] });
    const page2 = store.pageTasks("ws_1", { limit: 2, statuses: ["blocked"], after: page1.next });
    expect(page1.items.map((item) => item.status)).toEqual(["blocked", "blocked"]);
    expect(page2.items.map((item) => item.status)).toEqual(["blocked"]);
    expect([...page1.items, ...page2.items].map((item) => item.id)).toEqual(["task_b2", "task_b3", "task_b1"]);
    expect(page1.total).toBe(3);
    expect(page2.total).toBe(3);
    expect(page1.hasMore).toBe(true);
    expect(page2.hasMore).toBe(false);
    expect(store.countTasks("ws_1", ["blocked"])).toBe(3);
    expect(store.countTasks("ws_1")).toBe(tasks.length);
  });

  it("ranks findings that cite an artifact ahead of a newer bare finding", () => {
    store.createArtifact({
      id: "art_1",
      workspaceId: "ws_1",
      type: "document",
      title: "Notes",
      uriOrPath: "notes.md",
      createdBy: HUMAN,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    store.createFinding({
      id: "find_sourced",
      workspaceId: "ws_1",
      summary: "Cited",
      sourceArtifactId: "art_1",
      createdBy: HUMAN,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    store.createFinding({
      id: "find_sourced_newer",
      workspaceId: "ws_1",
      summary: "Cited later",
      sourceArtifactId: "art_1",
      createdBy: HUMAN,
      createdAt: "2026-02-01T00:00:00.000Z",
    });
    store.createFinding({
      id: "find_bare",
      workspaceId: "ws_1",
      summary: "Bare but newest",
      createdBy: HUMAN,
      createdAt: "2026-06-01T00:00:00.000Z",
    });

    const page = store.pageFindings("ws_1", { limit: 10 });
    expect(page.items.map((item) => item.id)).toEqual(["find_sourced_newer", "find_sourced", "find_bare"]);
    expect(page.items[0]?.sourceArtifactId).toBe("art_1");
    expect(page.items[2]?.sourceArtifactId).toBeUndefined();
    expect(page.total).toBe(3);
    expect(page.hasMore).toBe(false);
    expect(store.countObjects("findings", "ws_1")).toBe(3);
  });

  it("ranks a cited artifact ahead of a newer uncited artifact", () => {
    store.createArtifact({
      id: "art_plain",
      workspaceId: "ws_1",
      type: "document",
      title: "Plain",
      uriOrPath: "plain.md",
      createdBy: HUMAN,
      createdAt: "2026-06-01T00:00:00.000Z",
    });
    store.createArtifact({
      id: "art_cited",
      workspaceId: "ws_1",
      type: "document",
      title: "Cited",
      uriOrPath: "cited.md",
      createdBy: HUMAN,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    store.createFinding({
      id: "find_cite",
      workspaceId: "ws_1",
      summary: "Cites",
      sourceArtifactId: "art_cited",
      createdBy: HUMAN,
      createdAt: "2026-01-02T00:00:00.000Z",
    });

    const page = store.pageArtifacts("ws_1", { limit: 10 });
    expect(page.items.map((item) => item.id)).toEqual(["art_cited", "art_plain"]);
    expect(page.total).toBe(2);
    expect(store.countObjects("artifacts", "ws_1")).toBe(2);
  });

  it("pages high-material contributions the same way as contributionMateriality", () => {
    const rows: Contribution[] = [
      contribution("con_find", "2026-01-01T00:00:00.000Z", "create", "finding", "find_1"),
      contribution("con_dec", "2026-01-02T00:00:00.000Z", "update", "decision", "dec_1", { status: "accepted" }),
      contribution("con_sess", "2026-01-03T00:00:00.000Z", "register_session", "agent_session", "ses_1"),
      contribution("con_task", "2026-01-04T00:00:00.000Z", "update", "task", "task_1", { title: "rename" }),
    ];
    for (const row of rows) store.createContribution(row);

    const high = store.pageContributions("ws_1", { limit: 10, materiality: "high" });
    const normal = store.pageContributions("ws_1", { limit: 10, materiality: "normal" });
    const expectedHigh = rows.filter((row) => contributionMateriality(row) === "high");
    const expectedNormal = rows.filter((row) => contributionMateriality(row) === "normal");
    expect(high.items.map((item) => item.id)).toEqual(expectedHigh.map((row) => row.id));
    expect(high.total).toBe(expectedHigh.length);
    expect(high.hasMore).toBe(false);
    expect(expectedHigh.map((row) => row.id)).toEqual(["con_find", "con_dec"]);
    expect(normal.items.map((item) => item.id)).toEqual(expectedNormal.map((row) => row.id));
    expect(normal.total).toBe(expectedNormal.length);
    expect(expectedNormal.map((row) => row.id)).toEqual(["con_sess", "con_task"]);
  });

  it("pages same-timestamp contributions in append order when ids sort backwards", () => {
    const at = "2026-04-01T00:00:00.000Z";
    store.createContribution(contribution("con_z", at, "create", "task", "task_z"));
    store.createContribution(contribution("con_a", at, "create", "task", "task_a"));

    const stored = store.listContributions("ws_1");
    const z = stored.find((row) => row.id === "con_z");
    const a = stored.find((row) => row.id === "con_a");
    expect(z?.appendPosition).toBeLessThan(a?.appendPosition ?? 0);

    const page1 = store.pageContributions("ws_1", { limit: 1 });
    expect(page1.items.map((item) => item.id)).toEqual(["con_z"]);
    expect(page1.total).toBe(2);
    expect(page1.hasMore).toBe(true);

    const page2 = store.pageContributions("ws_1", { limit: 1, afterPosition: page1.items[0]!.appendPosition });
    expect(page2.items.map((item) => item.id)).toEqual(["con_a"]);
    expect(page2.total).toBe(1);
    expect(page2.hasMore).toBe(false);
    const together = [...page1.items, ...page2.items].map((item) => item.id);
    expect(together).toEqual(["con_z", "con_a"]);
    expect(new Set(together).size).toBe(together.length);

    const all = store.pageContributions("ws_1", { limit: 10 });
    expect(all.items.map((item) => item.id)).toEqual(["con_z", "con_a"]);
    expect(all.items.map((item) => item.id)).not.toEqual(["con_a", "con_z"]);
    expect(all.total).toBe(2);
  });

  it("returns rows appended between pages once and keeps a frozen tip closed", () => {
    const at = "2026-04-01T00:00:00.000Z";
    for (const id of ["con_e", "con_a", "con_c"]) {
      store.createContribution(contribution(id, at, "create", "task", id));
    }
    const page1 = store.pageContributions("ws_1", { limit: 2 });
    expect(page1.items.map((item) => item.id)).toEqual(["con_e", "con_a"]);
    expect(page1.hasMore).toBe(true);
    const tip = store.maxAppendPosition("ws_1");
    expect(tip).toBe(Math.max(...store.listContributions("ws_1").map((row) => row.appendPosition)));

    for (const id of ["con_d", "con_b"]) {
      store.createContribution(contribution(id, at, "create", "task", id));
    }
    const continued = store.pageContributions("ws_1", {
      limit: 10,
      afterPosition: page1.items[1]!.appendPosition,
    });
    expect(continued.items.map((item) => item.id)).toEqual(["con_c", "con_d", "con_b"]);

    const seen = [...page1.items.map((item) => item.id)];
    let after = page1.items[1]!.appendPosition;
    for (let guard = 0; guard < 10; guard += 1) {
      const page = store.pageContributions("ws_1", { limit: 2, afterPosition: after });
      if (page.items.length === 0) break;
      seen.push(...page.items.map((item) => item.id));
      after = page.items[page.items.length - 1]!.appendPosition;
      if (!page.hasMore) break;
    }
    expect(seen).toEqual(["con_e", "con_a", "con_c", "con_d", "con_b"]);
    expect(new Set(seen).size).toBe(seen.length);

    const frozen = store.pageContributions("ws_1", { limit: 10, throughPosition: tip });
    expect(frozen.items.map((item) => item.id)).toEqual(["con_e", "con_a", "con_c"]);
    expect(frozen.total).toBe(3);
    const later = store.pageContributions("ws_1", { limit: 10, afterPosition: tip });
    expect(later.items.map((item) => item.id)).toEqual(["con_d", "con_b"]);
    expect(later.total).toBe(2);
  });

  it("reopens append positions from the same sqlite file", () => {
    const dir = mkdtempSync(join(tmpdir(), "campfire-ctx-restart-"));
    const path = join(dir, "campfire.db");
    let current: CampfireStore | undefined;
    try {
      current = openSqliteStore(path);
      seedIdentity(current);
      const at = "2026-04-01T00:00:00.000Z";
      current.createContribution(contribution("con_z", at, "create", "task", "task_z"));
      current.createContribution(contribution("con_a", at, "create", "task", "task_a"));
      const stored = current.listContributions("ws_1");
      const z = stored.find((row) => row.id === "con_z");
      const a = stored.find((row) => row.id === "con_a");
      expect(z?.appendPosition).toBeLessThan(a?.appendPosition ?? 0);
      const zPosition = z!.appendPosition;
      const aPosition = a!.appendPosition;
      current.close();
      current = openSqliteStore(path);
      const page = current.pageContributions("ws_1", { limit: 10, afterPosition: zPosition });
      expect(page.items.map((item) => item.id)).toEqual(["con_a"]);
      expect(page.items[0]?.appendPosition).toBe(aPosition);
      current.close();
      current = undefined;
    } finally {
      try {
        current?.close();
      } catch {
        // The store was already closed before reopen failed.
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns the newest contribution window since an anchor and rejects another workspace", () => {
    const rows = ["con_1", "con_2", "con_3", "con_4", "con_5"];
    rows.forEach((id, index) => {
      store.createContribution(contribution(id, `2026-05-0${index + 1}T00:00:00.000Z`, "create", "task", id));
    });
    store.createContribution(contribution("con_other", "2026-06-01T00:00:00.000Z", "create", "task", "other", undefined, "ws_2"));

    const since = store.listContributionsSince("ws_1", "con_2", 2);
    expect(since.found).toBe(true);
    expect(since.items.map((item) => item.id)).toEqual(["con_4", "con_5"]);
    expect(since.total).toBe(3);
    expect(since.hasMore).toBe(true);

    const recent = store.listRecentContributionWindow("ws_1", 2);
    expect(recent.items.map((item) => item.id)).toEqual(["con_4", "con_5"]);
    expect(recent.total).toBe(5);
    expect(recent.hasMore).toBe(true);
    expect(recent).not.toHaveProperty("next");

    expect(store.listContributionsSince("ws_1", "con_missing", 2)).toEqual({
      found: false,
      items: [],
      total: 0,
      hasMore: false,
    });
    expect(store.listContributionsSince("ws_1", "con_other", 2).found).toBe(false);
  });

  it("follows journal order when two contributions share a timestamp", () => {
    const at = "2026-07-01T00:00:00.000Z";
    store.createContribution(contribution("con_z", at, "create", "task", "task_z"));
    store.createContribution(contribution("con_a", at, "create", "finding", "find_a"));
    const activity = store.listContributions("ws_1").map((item) => item.id);
    expect(activity).toEqual(["con_z", "con_a"]);

    const since = store.listContributionsSince("ws_1", "con_z", 10);
    expect(since.items.map((item) => item.id)).toEqual(["con_a"]);
    expect(since.total).toBe(1);
    const before = store.listContributionsBefore("ws_1", "con_a", 10);
    expect(before.items.map((item) => item.id)).toEqual(["con_z"]);
  });

  it("returns older contributions before an anchor without including it", () => {
    const rows = ["con_1", "con_2", "con_3", "con_4", "con_5"];
    rows.forEach((id, index) => {
      store.createContribution(contribution(id, `2026-05-0${index + 1}T00:00:00.000Z`, "create", "task", id));
    });

    const before = store.listContributionsBefore("ws_1", "con_4", 2);
    expect(before.found).toBe(true);
    expect(before.items.map((item) => item.id)).toEqual(["con_2", "con_3"]);
    expect(before.items.some((item) => item.id === "con_4")).toBe(false);
    expect(before.hasMore).toBe(true);
    expect(before.total).toBe(5);

    const closest = store.listContributionsBefore("ws_1", "con_4", 1);
    expect(closest.items.map((item) => item.id)).toEqual(["con_3"]);
    expect(closest.hasMore).toBe(true);
    expect(store.listContributionsBefore("ws_1", "missing", 1).found).toBe(false);
  });

  it("reports SQL text and not bound parameters", () => {
    const seen: string[] = [];
    const observed = openInMemoryStore({ observeQuery: (sql) => seen.push(sql) });
    seedIdentity(observed);
    seen.length = 0;
    observed.pageDecisions("ws_1", { limit: 1 });
    expect(seen.some((sql) => sql.includes("FROM decisions"))).toBe(true);
    expect(seen.join("\n").includes("ws_1")).toBe(false);
    observed.close();
  });

  it("plans decision and contribution pages through the workspace index", () => {
    const dir = mkdtempSync(join(tmpdir(), "campfire-ctx-plan-"));
    const path = join(dir, "campfire.db");
    const populated = openSqliteStore(path);
    try {
      seedIdentity(populated);
      populated.createDecision(decision("dec_1", "accepted", NOW));
      populated.createContribution(contribution("con_1", NOW, "create", "finding", "find_1"));
      populated.close();
      const db = new Database(path, { readonly: true, fileMustExist: true });
      try {
        assertWorkspaceIndex(db, "decisions", pageDecisionsSql("ws_1", { limit: 2 }));
        assertWorkspaceIndex(
          db,
          "contributions",
          pageContributionsSql("ws_1", { limit: 2, materiality: "high" }),
        );
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function contribution(
  id: string,
  createdAt: string,
  action: Contribution["action"],
  objectType: Contribution["objectType"],
  objectId: string,
  payload?: Record<string, unknown>,
  workspaceId = "ws_1",
): Contribution {
  contributionSequence += 1;
  return {
    id,
    workspaceId,
    actor: HUMAN,
    action,
    objectType,
    objectId,
    ...(payload === undefined ? {} : { payload }),
    createdAt,
    appendPosition: contributionSequence,
  };
}

function assertWorkspaceIndex(db: Database.Database, table: string, statement: SqlStatement): void {
  const rows = db.prepare(`EXPLAIN QUERY PLAN ${statement.sql}`).all(...statement.params) as Array<{ detail: string }>;
  const plan = rows.map((row) => row.detail).join("\n");
  const bareScan = rows.filter((row) => row.detail.includes(`SCAN TABLE ${table}`) && !row.detail.includes("USING INDEX"));
  expect(bareScan, plan).toEqual([]);
  expect(plan, plan).toContain(`idx_${table}_workspace`);
  expect(plan, plan).toContain("workspace_id");
}
