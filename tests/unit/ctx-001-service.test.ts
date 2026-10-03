/**
 * CTX-001 bounded orientation, catch-up, and drill-down.
 * Fixture evidence only. This file does not claim a live harness trace.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCounterIdSource } from "../../src/domain/ids.js";
import {
  decodeContextCursor,
  DEFAULT_CONTEXT_BUDGET,
  encodeContextCursor,
  genesisContributionCursor,
} from "../../src/domain/context-policy.js";
import { FindingNotFound, ParticipantRequired, ValidationError } from "../../src/domain/errors.js";
import type { ActorContext } from "../../src/service/authorization.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import type { CampfireService, WorkspaceCatchUp } from "../../src/service/service.js";
import { openInMemoryStore, openSqliteStore } from "../../src/store/sqlite-store.js";
import type { CampfireStore } from "../../src/store/store.js";
import type { AsyncCampfireStore } from "../../src/worker/d1-store.js";
import { createAsyncCampfireService } from "../../src/worker/async-service.js";
import { runCli } from "../../src/cli/index.js";

const NOW = "2026-01-01T00:00:00.000Z";
const HUMAN1: ActorContext = { actor: { actorId: "hum_1", actorType: "human" } };
const HUMAN2: ActorContext = { actor: { actorId: "hum_2", actorType: "human" } };
const AGENT1: ActorContext = { actor: { actorId: "agt_1", actorType: "agent" } };

function createClock(startMs = Date.parse(NOW)) {
  let current = startMs;
  const tick = (): string => {
    current += 1000;
    return new Date(current).toISOString();
  };
  return { tick };
}

function wrapSync(store: CampfireStore): AsyncCampfireStore {
  return new Proxy(store, {
    get(target, prop, receiver) {
      if (prop === "transaction") {
        return (fn: () => Promise<unknown>) => fn();
      }
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => Promise.resolve((value as (...a: unknown[]) => unknown).apply(target, args));
    },
  }) as unknown as AsyncCampfireStore;
}

function harness(observeQuery?: (sql: string) => void) {
  const store = openInMemoryStore(observeQuery === undefined ? undefined : { observeQuery });
  const clock = createClock();
  const service = createCampfireService({ store, idSource: createCounterIdSource(), clock: clock.tick });
  const createdAt = NOW;
  store.createOrganization({ id: "org_1", name: "Boring Infra Co.", createdAt });
  store.createTeam({ id: "team_1", organizationId: "org_1", name: "Engineering", createdAt });
  store.createHuman({ id: "hum_1", teamId: "team_1", displayName: "Ada", createdAt });
  store.createHuman({ id: "hum_2", teamId: "team_1", displayName: "Grace", createdAt });
  store.createAgent({
    id: "agt_1",
    teamId: "team_1",
    humanId: "hum_1",
    name: "Codex",
    harness: "codex",
    createdAt,
  });
  return { store, service, clock };
}

function changeIds(page: { changes: { items: readonly { cursor: string }[] } }): string[] {
  return page.changes.items.map((item) => {
    const decoded = decodeContextCursor(item.cursor);
    if (decoded.kind !== "contribution") throw new Error("catch-up item is not a contribution");
    return decoded.id;
  });
}

function cursorToken(value: unknown): string {
  return `cf1.${Buffer.from(JSON.stringify(value), "utf8").toString("base64url")}`;
}

async function drainCatchUp(
  first: WorkspaceCatchUp,
  nextPage: (after: string) => Promise<WorkspaceCatchUp>,
  frozenTip: number,
): Promise<{ ids: string[]; toCursor: string; completion: ReturnType<typeof decodeContextCursor> }> {
  const ids: string[] = [];
  let page = first;
  for (let guard = 0; guard < 40; guard += 1) {
    ids.push(...changeIds(page));
    expect(page.changes.total).toBe(first.changes.total);
    if (page.changes.nextCursor === undefined) {
      return { ids, toCursor: page.toCursor, completion: decodeContextCursor(page.toCursor) };
    }
    expect(decodeContextCursor(page.toCursor)).toMatchObject({ kind: "contribution", tip: frozenTip });
    page = await nextPage(page.toCursor);
  }
  throw new Error("catch-up did not finish");
}

function inviteAndJoin(service: CampfireService, inviter: ActorContext, joiner: ActorContext, workspaceId: string): void {
  service.inviteToWorkspace(inviter, { workspaceId, actor: joiner.actor, role: "member" });
  service.joinWorkspace(joiner, { workspaceId });
}

interface MatureWorkspace {
  workspaceId: string;
  goalTitle: string;
  proposedId: string;
  acceptedId: string;
  blockedId: string;
  openTaskId: string;
}

function buildSmall(service: CampfireService, ctx: ActorContext) {
  const workspace = service.createWorkspace(ctx, { teamId: "team_1", name: "Small" });
  service.createGoal(ctx, { workspaceId: workspace.id, title: "Keep the room small" });
  const proposed = service.addDecision(ctx, { workspaceId: workspace.id, summary: "propose a path" });
  const accepted = service.addDecision(ctx, { workspaceId: workspace.id, summary: "accept a path" });
  service.acceptDecision(ctx, accepted.id);
  for (let index = 0; index < 3; index += 1) {
    service.addFinding(ctx, { workspaceId: workspace.id, summary: `finding ${index}` });
  }
  for (let index = 0; index < 3; index += 1) {
    service.createTask(ctx, { workspaceId: workspace.id, title: `open ${index}` });
  }
  const done = service.createTask(ctx, { workspaceId: workspace.id, title: "done" });
  service.updateTask(ctx, { taskId: done.id, status: "completed" });
  for (let index = 0; index < 2; index += 1) {
    service.addArtifact(ctx, {
      workspaceId: workspace.id,
      type: "log",
      title: `log ${index}`,
      uriOrPath: `logs/${index}.log`,
    });
  }
  return { workspaceId: workspace.id, proposedId: proposed.id, acceptedId: accepted.id, doneId: done.id };
}

function buildMature(service: CampfireService, ctx: ActorContext): MatureWorkspace {
  const workspace = service.createWorkspace(ctx, { teamId: "team_1", name: "Mature" });
  const goalTitle = "Ship the bounded orientation";
  service.createGoal(ctx, { workspaceId: workspace.id, title: goalTitle });
  let acceptedId = "";
  for (let index = 0; index < 12; index += 1) {
    const decision = service.addDecision(ctx, { workspaceId: workspace.id, summary: `accepted ${index}` });
    service.acceptDecision(ctx, decision.id);
    acceptedId = decision.id;
  }
  const proposed = service.addDecision(ctx, { workspaceId: workspace.id, summary: "recent proposal" });
  for (let index = 0; index < 15; index += 1) {
    service.addFinding(ctx, { workspaceId: workspace.id, summary: `finding ${index}` });
  }
  const blocked = service.createTask(ctx, { workspaceId: workspace.id, title: "blocked work" });
  service.updateTask(ctx, { taskId: blocked.id, status: "blocked" });
  let openTaskId = "";
  for (let index = 0; index < 24; index += 1) {
    const task = service.createTask(ctx, { workspaceId: workspace.id, title: `open ${index}` });
    openTaskId = task.id;
  }
  for (let index = 0; index < 12; index += 1) {
    service.addArtifact(ctx, {
      workspaceId: workspace.id,
      type: "log",
      title: `log ${index}`,
      uriOrPath: `logs/${index}.log`,
    });
  }
  return {
    workspaceId: workspace.id,
    goalTitle,
    proposedId: proposed.id,
    acceptedId,
    blockedId: blocked.id,
    openTaskId,
  };
}

/**
 * Repeatable cold-agent procedure. Fixture evidence, not a live harness trace.
 * Reads the bounded orientation, then the matching list or get only when that
 * slice is truncated. It does not call getWorkspace.
 */
export function coldAgentProcedure(service: CampfireService, ctx: ActorContext, workspaceId: string) {
  const context = service.getWorkspaceContext(ctx, workspaceId);
  const firstDecision = context.slices.decisions.items[0];
  const firstFinding = context.findings[0];
  const firstTask = context.slices.tasks.items[0];
  const firstArtifact = context.artifacts[0];
  return {
    context,
    decisions: context.slices.decisions.truncated ? service.listDecisionsPage(ctx, { workspaceId }) : undefined,
    decision:
      context.slices.decisions.truncated && firstDecision !== undefined
        ? service.getDecisionInWorkspace(ctx, workspaceId, firstDecision.id)
        : undefined,
    findings: context.slices.findings.truncated ? service.listFindingsPage(ctx, { workspaceId }) : undefined,
    finding:
      context.slices.findings.truncated && firstFinding !== undefined
        ? service.getFindingInWorkspace(ctx, workspaceId, firstFinding.id)
        : undefined,
    tasks: context.slices.tasks.truncated ? service.listTasksPage(ctx, { workspaceId }) : undefined,
    task:
      context.slices.tasks.truncated && firstTask !== undefined
        ? service.getTaskInWorkspace(ctx, workspaceId, firstTask.id)
        : undefined,
    artifacts: context.slices.artifacts.truncated ? service.listArtifactsPage(ctx, { workspaceId }) : undefined,
    artifact:
      context.slices.artifacts.truncated && firstArtifact !== undefined
        ? service.getArtifactInWorkspace(ctx, workspaceId, firstArtifact.id)
        : undefined,
    blockers: context.slices.blockers.truncated
      ? service.listTasksPage(ctx, { workspaceId, status: "blocked" })
      : undefined,
    changes: context.slices.recentChanges.truncated
      ? service.getWorkspaceChanges(ctx, { workspaceId, after: context.orientationCursor })
      : undefined,
  };
}

describe("CTX-001 orientation and drill-down", () => {
  let service: CampfireService;
  let store: CampfireStore;

  afterEach(() => {
    service?.close();
  });

  it("fixture A fits the default budget", () => {
    ({ service } = harness());
    const built = buildSmall(service, HUMAN1);
    const context = service.getWorkspaceContext(HUMAN1, built.workspaceId);

    expect(context.goal?.title).toBe("Keep the room small");
    expect(context.completeness.fullHistoryIncluded).toBe(false);
    expect(context.supersededDecisions).toEqual([]);
    expect(context.acceptedDecisions.map((decision) => decision.id)).toContain(built.acceptedId);
    expect(context.proposedDecisions.map((decision) => decision.id)).toContain(built.proposedId);
    expect(context.openTasks.map((task) => task.id)).not.toContain(built.doneId);
    for (const slice of Object.values(context.slices)) {
      expect(slice.truncated).toBe(false);
      expect(slice.returned).toBe(slice.total);
    }
    expect(context.slices.findings.total).toBe(3);
    expect(context.slices.tasks.total).toBe(4);
    expect(context.slices.artifacts.total).toBe(2);
    expect(context.slices.decisions.total).toBe(2);
  });

  it("fixture B bounds orientation, pages findings, and avoids unbounded reads", () => {
    const queries: string[] = [];
    ({ service, store } = harness((sql) => queries.push(sql)));
    const built = buildMature(service, HUMAN1);
    queries.length = 0;
    const context = service.getWorkspaceContext(HUMAN1, built.workspaceId);

    expect(context.slices.findings.returned).toBeLessThanOrEqual(DEFAULT_CONTEXT_BUDGET.findings);
    expect(context.slices.decisions.returned).toBeLessThanOrEqual(DEFAULT_CONTEXT_BUDGET.decisions);
    expect(context.slices.tasks.returned).toBeLessThanOrEqual(DEFAULT_CONTEXT_BUDGET.tasks);
    expect(context.slices.artifacts.returned).toBeLessThanOrEqual(DEFAULT_CONTEXT_BUDGET.artifacts);
    expect(context.slices.recentChanges.returned).toBeLessThanOrEqual(DEFAULT_CONTEXT_BUDGET.recentChanges);
    expect(context.slices.blockers.items.map((task) => task.id)).toContain(built.blockedId);
    expect(context.slices.decisions.items.map((decision) => decision.id)).toContain(built.proposedId);
    expect(context.slices.findings.total).toBe(15);
    expect(context.slices.decisions.total).toBe(13);
    expect(context.slices.tasks.total).toBe(25);
    expect(context.slices.artifacts.total).toBe(12);
    expect(context.slices.findings.truncated).toBe(true);
    expect(context.slices.decisions.truncated).toBe(true);
    expect(context.slices.tasks.truncated).toBe(true);
    expect(context.slices.artifacts.truncated).toBe(true);
    expect(context.slices.recentChanges.truncated).toBe(true);
    expect(context.provenanceTruncated).toBe(true);
    expect(context.provenanceTotal).toBeGreaterThan(context.provenance.length);

    const page1 = service.listFindingsPage(HUMAN1, { workspaceId: built.workspaceId });
    expect(page1.nextCursor).toBeDefined();
    const page2 = service.listFindingsPage(HUMAN1, { workspaceId: built.workspaceId, cursor: page1.nextCursor });
    const page1Ids = new Set(page1.items.map((finding) => finding.id));
    expect(page2.items.every((finding) => !page1Ids.has(finding.id))).toBe(true);
    expect(page1.items.length + page2.items.length).toBeGreaterThan(page1.items.length);
    expect(page1.items.length + page2.items.length).toBeLessThanOrEqual(page1.total);

    const normalized = queries.map((sql) => sql.replace(/\s+/g, " ").trim());
    expect(normalized.length).toBeGreaterThan(0);
    const tables = ["findings", "artifacts", "tasks", "decisions", "contributions"];
    for (const table of tables) {
      expect(normalized).not.toContain(`SELECT * FROM ${table} WHERE workspace_id = ? ORDER BY created_at, rowid`);
    }
    for (const sql of normalized) {
      const reads = tables.some((table) => new RegExp(`\\b${table}\\b`, "i").test(sql));
      if (!reads) continue;
      expect(sql).toMatch(/COUNT\(|LIMIT|GROUP BY|EXISTS/i);
    }
  });

  it("compares async slice ids on one mature workspace", async () => {
    const { store, service: syncService, clock } = harness();
    service = syncService;
    const built = buildMature(service, HUMAN1);
    const syncContext = service.getWorkspaceContext(HUMAN1, built.workspaceId);
    const asyncService = createAsyncCampfireService({
      store: wrapSync(store),
      idSource: createCounterIdSource(),
      clock: clock.tick,
    });
    const asyncContext = await asyncService.getWorkspaceContext(HUMAN1, built.workspaceId);
    const ids = (items: readonly { id: string }[]) => items.map((item) => item.id);
    expect(ids(asyncContext.slices.decisions.items)).toEqual(ids(syncContext.slices.decisions.items));
    expect(ids(asyncContext.slices.findings.items)).toEqual(ids(syncContext.slices.findings.items));
    expect(ids(asyncContext.slices.tasks.items)).toEqual(ids(syncContext.slices.tasks.items));
    expect(ids(asyncContext.slices.blockers.items)).toEqual(ids(syncContext.slices.blockers.items));
    expect(ids(asyncContext.slices.artifacts.items)).toEqual(ids(syncContext.slices.artifacts.items));
    expect(asyncContext.slices.recentChanges.items.map((change) => change.cursor)).toEqual(
      syncContext.slices.recentChanges.items.map((change) => change.cursor),
    );
    expect(asyncContext.orientationCursor).toBe(syncContext.orientationCursor);
  });

  it("uses the cold procedure on the mature fixture", () => {
    ({ service } = harness());
    const built = buildMature(service, HUMAN1);
    const workspace = vi.spyOn(service, "getWorkspace");
    const result = coldAgentProcedure(service, HUMAN1, built.workspaceId);
    expect(workspace).not.toHaveBeenCalled();
    expect(result.context.goal?.title).toBe(built.goalTitle);
    expect(result.context.acceptedDecisions.map((decision) => decision.id)).toContain(built.acceptedId);
    expect(result.context.slices.blockers.items.map((task) => task.id)).toContain(built.blockedId);
    expect(result.context.openTasks.map((task) => task.id)).toContain(built.openTaskId);
    expect(result.context.slices.findings.truncated).toBe(true);
    expect(result.context.slices.decisions.truncated).toBe(true);
    expect(result.context.slices.tasks.truncated).toBe(true);
    expect(result.context.slices.artifacts.truncated).toBe(true);
    expect(result.context.slices.recentChanges.truncated).toBe(true);
    expect(result.findings?.items.length).toBeGreaterThan(0);
    expect(result.finding?.id).toBe(result.context.findings[0]?.id);
    expect(result.decision?.status).toBeDefined();
    expect(result.task?.id).toBeDefined();
    expect(result.artifact?.id).toBe(result.context.artifacts[0]?.id);
    expect(result.changes?.ordering).toBe("material-then-chronological");
  });

  it("fixture C returns material catch-up before noise and pages each new contribution once", () => {
    ({ service, store } = harness());
    const workspace = service.createWorkspace(HUMAN1, { teamId: "team_1", name: "Catch-up" });
    service.inviteToWorkspace(HUMAN1, { workspaceId: workspace.id, actor: AGENT1.actor, role: "agent" });
    service.joinWorkspace(AGENT1, { workspaceId: workspace.id });
    service.createGoal(HUMAN1, { workspaceId: workspace.id, title: "Catch up later" });
    const toBlock = service.createTask(HUMAN1, { workspaceId: workspace.id, title: "will block" });
    const toFinish = service.createTask(HUMAN1, { workspaceId: workspace.id, title: "will finish" });
    const cursor = service.getWorkspaceContext(HUMAN1, workspace.id).orientationCursor;
    const before = new Set(store.listContributions(workspace.id).map((item) => item.id));

    const decision = service.addDecision(HUMAN1, { workspaceId: workspace.id, summary: "ship it" });
    service.acceptDecision(HUMAN1, decision.id);
    service.updateTask(HUMAN1, { taskId: toBlock.id, title: "noise title" });
    service.addFinding(HUMAN1, { workspaceId: workspace.id, summary: "the deploy log is empty" });
    service.registerAgentSession(AGENT1, { agentId: AGENT1.actor.actorId, workspaceId: workspace.id, harness: "codex" });
    service.updateTask(HUMAN1, { taskId: toBlock.id, status: "blocked" });
    service.updateTask(HUMAN1, { taskId: toFinish.id, title: "another title" });
    service.updateTask(HUMAN1, { taskId: toFinish.id, status: "completed" });
    service.updateTask(HUMAN1, { taskId: toBlock.id, title: "still noise" });

    const expected = store
      .listContributions(workspace.id)
      .map((item) => item.id)
      .filter((id) => !before.has(id));
    expect(expected.length).toBeGreaterThan(4);

    const first = service.getWorkspaceChanges(HUMAN1, { workspaceId: workspace.id, after: cursor, limit: 2 });
    expect(first.changes.items).toHaveLength(2);
    expect(first.changes.items.every((change) => change.materiality === "high")).toBe(true);
    expect(first.changes.truncated).toBe(true);

    const seen: string[] = [];
    let after = cursor;
    let page = first;
    for (let guard = 0; guard < 40; guard += 1) {
      for (const change of page.changes.items) {
        seen.push(decodeContextCursor(change.cursor).id);
      }
      if (page.changes.nextCursor === undefined) break;
      expect(page.toCursor).not.toBe(after);
      after = page.toCursor;
      page = service.getWorkspaceChanges(HUMAN1, { workspaceId: workspace.id, after, limit: 2 });
      if (guard === 39) throw new Error("catch-up did not finish");
    }
    expect(seen).toEqual(expect.arrayContaining(expected));
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.slice().sort()).toEqual(expected.slice().sort());
  });

  it("fixture D keeps the other workspace out of orientation, pages, and cursors", () => {
    ({ service } = harness());
    const workspaceA = service.createWorkspace(HUMAN1, { teamId: "team_1", name: "A" });
    const workspaceB = service.createWorkspace(HUMAN2, { teamId: "team_1", name: "B" });
    const hidden = service.addFinding(HUMAN2, { workspaceId: workspaceB.id, summary: "private finding" });
    service.addDecision(HUMAN2, { workspaceId: workspaceB.id, summary: "private decision" });
    service.createTask(HUMAN2, { workspaceId: workspaceB.id, title: "private task" });

    const contextA = service.getWorkspaceContext(HUMAN1, workspaceA.id);
    expect(contextA.findings.map((finding) => finding.id)).not.toContain(hidden.id);
    expect(contextA.slices.findings.total).toBe(0);
    expect(contextA.slices.decisions.total).toBe(0);
    expect(contextA.slices.tasks.total).toBe(0);
    const findings = service.listFindingsPage(HUMAN1, { workspaceId: workspaceA.id });
    expect(findings.items.map((finding) => finding.id)).not.toContain(hidden.id);
    expect(findings.total).toBe(0);
    const catchUp = service.getWorkspaceChanges(HUMAN1, {
      workspaceId: workspaceA.id,
      after: contextA.orientationCursor,
    });
    expect(catchUp.changes.items.map((change) => change.objectId)).not.toContain(hidden.id);

    let missing: unknown;
    try {
      service.getFindingInWorkspace(HUMAN1, workspaceA.id, hidden.id);
    } catch (error) {
      missing = error;
    }
    expect(missing).toBeInstanceOf(FindingNotFound);
    expect(String((missing as Error).message)).toBe(`Finding not found: ${hidden.id}`);
    expect(String((missing as Error).message)).not.toContain("private finding");
    expect(String((missing as Error).message)).not.toContain(workspaceB.id);

    expect(() => service.getWorkspaceContext(HUMAN2, workspaceA.id)).toThrow(ParticipantRequired);

    const foreign = service.getWorkspaceContext(HUMAN2, workspaceB.id).orientationCursor;
    expect(() => service.getWorkspaceChanges(HUMAN1, { workspaceId: workspaceA.id, after: foreign })).toThrow(
      ValidationError,
    );
    try {
      service.getWorkspaceChanges(HUMAN1, { workspaceId: workspaceA.id, after: foreign });
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as Error).message).toBe("Cursor belongs to a different workspace");
      expect((error as Error).message).not.toContain(workspaceB.id);
      expect((error as Error).message).not.toContain("private finding");
    }
    expect(() => service.listFindingsPage(HUMAN1, { workspaceId: workspaceA.id, cursor: foreign })).toThrow(
      /Cursor belongs to a different workspace/,
    );
  });

  it("rejects an over-cap budget and a status filter findings do not have", () => {
    ({ service } = harness());
    const workspace = service.createWorkspace(HUMAN1, { teamId: "team_1", name: "Limits" });
    expect(() => service.getWorkspaceContext(HUMAN1, workspace.id, { budget: { findings: 101 } })).toThrow(
      ValidationError,
    );
    expect(() => service.listFindingsPage(HUMAN1, { workspaceId: workspace.id, status: "open" })).toThrow(
      /status is not a filter for this object/,
    );
    expect(() => service.listDecisionsPage(HUMAN1, { workspaceId: workspace.id, status: "open" })).toThrow(
      ValidationError,
    );
  });

  it("returns same-timestamp contributions from genesis in append order exactly once", async () => {
    const { store: orderStore, service: syncService, clock } = harness();
    service = syncService;
    store = orderStore;
    const asyncService = createAsyncCampfireService({
      store: wrapSync(store),
      idSource: createCounterIdSource(),
      clock: clock.tick,
    });
    const workspaceId = "ws_order";
    const at = "2026-04-01T00:00:00.000Z";
    store.createWorkspace({
      id: workspaceId,
      teamId: "team_1",
      name: "Order",
      status: "active",
      createdBy: HUMAN1.actor,
      createdAt: NOW,
      updatedAt: NOW,
    });
    store.addParticipant({ workspaceId, actor: HUMAN1.actor, role: "owner", joinedAt: NOW });
    store.createContribution({
      id: "con_z",
      workspaceId,
      actor: HUMAN1.actor,
      action: "create",
      objectType: "task",
      objectId: "task_z",
      createdAt: at,
    });
    store.createContribution({
      id: "con_a",
      workspaceId,
      actor: HUMAN1.actor,
      action: "create",
      objectType: "task",
      objectId: "task_a",
      createdAt: at,
    });

    const after = encodeContextCursor(genesisContributionCursor(workspaceId));
    const syncPage = service.getWorkspaceChanges(HUMAN1, { workspaceId, after, limit: 10 });
    const asyncPage = await asyncService.getWorkspaceChanges(HUMAN1, { workspaceId, after, limit: 10 });
    expect(changeIds(syncPage)).toEqual(["con_z", "con_a"]);
    expect(changeIds(asyncPage)).toEqual(["con_z", "con_a"]);
    expect(new Set(changeIds(syncPage)).size).toBe(2);

    const first = service.getWorkspaceChanges(HUMAN1, { workspaceId, after, limit: 1 });
    const second = service.getWorkspaceChanges(HUMAN1, { workspaceId, after: first.toCursor, limit: 1 });
    expect([...changeIds(first), ...changeIds(second)]).toEqual(["con_z", "con_a"]);
    expect(new Set([...changeIds(first), ...changeIds(second)]).size).toBe(2);
  });

  it("keeps a catch-up tip frozen when a finding is appended mid-run", async () => {
    const { store: frozenStore, service: syncService, clock } = harness();
    service = syncService;
    store = frozenStore;
    const asyncService = createAsyncCampfireService({
      store: wrapSync(store),
      idSource: createCounterIdSource(),
      clock: clock.tick,
    });
    const workspace = service.createWorkspace(HUMAN1, { teamId: "team_1", name: "Freeze" });
    const task = service.createTask(HUMAN1, { workspaceId: workspace.id, title: "noise" });
    service.addFinding(HUMAN1, { workspaceId: workspace.id, summary: "first high" });
    service.addFinding(HUMAN1, { workspaceId: workspace.id, summary: "second high" });
    service.updateTask(HUMAN1, { taskId: task.id, title: "renamed only" });

    const after = encodeContextCursor(genesisContributionCursor(workspace.id));
    const frozenTip = store.maxAppendPosition(workspace.id);
    const first = service.getWorkspaceChanges(HUMAN1, { workspaceId: workspace.id, after, limit: 1 });
    const firstAsync = await asyncService.getWorkspaceChanges(HUMAN1, { workspaceId: workspace.id, after, limit: 1 });
    expect(firstAsync.toCursor).toBe(first.toCursor);
    expect(firstAsync.changes.total).toBe(first.changes.total);
    const continued = decodeContextCursor(first.toCursor);
    expect(continued).toMatchObject({ kind: "contribution", phase: "high", tip: frozenTip });

    const before = new Set(store.listContributions(workspace.id).map((row) => row.id));
    const late = service.addFinding(HUMAN1, { workspaceId: workspace.id, summary: "after the tip" });
    const lateIds = store.listContributions(workspace.id).map((row) => row.id).filter((id) => !before.has(id));
    expect(lateIds).toHaveLength(1);
    const lateId = lateIds[0]!;

    const drained = await drainCatchUp(
      first,
      (cursor) => Promise.resolve(service.getWorkspaceChanges(HUMAN1, { workspaceId: workspace.id, after: cursor, limit: 1 })),
      frozenTip,
    );
    const drainedAsync = await drainCatchUp(
      firstAsync,
      (cursor) => asyncService.getWorkspaceChanges(HUMAN1, { workspaceId: workspace.id, after: cursor, limit: 1 }),
      frozenTip,
    );
    expect(drained.ids).not.toContain(lateId);
    expect(drainedAsync.ids).toEqual(drained.ids);
    expect(drained.completion).toMatchObject({
      kind: "contribution",
      phase: "high",
      tip: 0,
      position: frozenTip,
      originPosition: frozenTip,
      occurredAt: "",
      id: "",
      originOccurredAt: "",
      originId: "",
    });

    const next = service.getWorkspaceChanges(HUMAN1, { workspaceId: workspace.id, after: drained.toCursor, limit: 20 });
    const nextAsync = await asyncService.getWorkspaceChanges(HUMAN1, {
      workspaceId: workspace.id,
      after: drained.toCursor,
      limit: 20,
    });
    expect(changeIds(next)).toEqual([lateId]);
    expect(changeIds(nextAsync)).toEqual([lateId]);
    expect(next.changes.items.map((item) => item.objectId)).toEqual([late.id]);
    for (const id of drained.ids) expect(changeIds(next)).not.toContain(id);
  });

  it("phase-switch catch-up keeps the tip so a later finding waits for the next run", () => {
    ({ service, store } = harness());
    const workspace = service.createWorkspace(HUMAN1, { teamId: "team_1", name: "Switch" });
    const task = service.createTask(HUMAN1, { workspaceId: workspace.id, title: "noise" });
    service.addFinding(HUMAN1, { workspaceId: workspace.id, summary: "only high" });
    service.updateTask(HUMAN1, { taskId: task.id, title: "renamed only" });

    const after = encodeContextCursor(genesisContributionCursor(workspace.id));
    const frozenTip = store.maxAppendPosition(workspace.id);
    const first = service.getWorkspaceChanges(HUMAN1, { workspaceId: workspace.id, after, limit: 1 });
    expect(decodeContextCursor(first.toCursor)).toMatchObject({
      kind: "contribution",
      phase: "normal",
      position: 0,
      originPosition: 0,
      tip: frozenTip,
    });

    const before = new Set(store.listContributions(workspace.id).map((row) => row.id));
    const late = service.addFinding(HUMAN1, { workspaceId: workspace.id, summary: "after the switch" });
    const lateIds = store.listContributions(workspace.id).map((row) => row.id).filter((id) => !before.has(id));
    expect(lateIds).toHaveLength(1);

    const seen: string[] = [];
    let page = first;
    for (let guard = 0; guard < 40; guard += 1) {
      seen.push(...changeIds(page));
      expect(page.changes.total).toBe(first.changes.total);
      const decoded = decodeContextCursor(page.toCursor);
      if (page.changes.nextCursor === undefined) {
        expect(decoded).toMatchObject({
          kind: "contribution",
          phase: "high",
          tip: 0,
          position: frozenTip,
          originPosition: frozenTip,
          occurredAt: "",
          id: "",
        });
        break;
      }
      expect(decoded).toMatchObject({ kind: "contribution", tip: frozenTip });
      page = service.getWorkspaceChanges(HUMAN1, { workspaceId: workspace.id, after: page.toCursor, limit: 1 });
      if (guard === 39) throw new Error("catch-up did not finish");
    }
    expect(seen).not.toContain(lateIds[0]);
    const next = service.getWorkspaceChanges(HUMAN1, { workspaceId: workspace.id, after: page.toCursor, limit: 20 });
    expect(changeIds(next)).toEqual(lateIds);
    expect(next.changes.items.map((item) => item.objectId)).toEqual([late.id]);
    for (const id of seen) expect(changeIds(next)).not.toContain(id);
  });

  it("rejects a malformed contribution cursor without returning rows", () => {
    const queries: string[] = [];
    ({ service } = harness((sql) => queries.push(sql)));
    const workspace = service.createWorkspace(HUMAN1, { teamId: "team_1", name: "Malformed" });
    service.addFinding(HUMAN1, { workspaceId: workspace.id, summary: "visible finding" });
    const missingPosition = cursorToken({
      v: 1,
      kind: "contribution",
      workspaceId: workspace.id,
      occurredAt: "",
      id: "",
      phase: "high",
      originOccurredAt: "",
      originId: "",
      originPosition: 0,
      tip: 0,
    });
    const tipBehindPosition = cursorToken({
      v: 1,
      kind: "contribution",
      workspaceId: workspace.id,
      occurredAt: "",
      id: "con_1",
      phase: "high",
      originOccurredAt: "",
      originId: "",
      position: 5,
      originPosition: 0,
      tip: 3,
    });
    queries.length = 0;
    for (const after of ["nope", missingPosition, tipBehindPosition]) {
      expect(() => service.getWorkspaceChanges(HUMAN1, { workspaceId: workspace.id, after })).toThrow(ValidationError);
      try {
        service.getWorkspaceChanges(HUMAN1, { workspaceId: workspace.id, after });
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).details).toMatchObject({ field: "cursor" });
        expect((error as Error).message).not.toContain("visible finding");
      }
    }
    expect(queries.some((sql) => sql.includes("contributions"))).toBe(false);
  });
});

describe("CTX-001 CLI context and catch-up", () => {
  const previous: Record<string, string | undefined> = {};
  const envKeys = ["CAMPFIRE_URL", "CAMPFIRE_TOKEN", "CAMPFIRE_ACTOR_ID", "CAMPFIRE_ACTOR_TYPE", "CAMPFIRE_DB"];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const key of envKeys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("prints a cursor and a showing line through the catalog commands", async () => {
    const dir = mkdtempSync(join(tmpdir(), "campfire-ctx-001-"));
    const dbPath = join(dir, "campfire.db");
    const store = openSqliteStore(dbPath);
    const clock = createClock();
    const service = createCampfireService({ store, idSource: createCounterIdSource(), clock: clock.tick });
    store.createOrganization({ id: "org_1", name: "Boring Infra Co.", createdAt: NOW });
    store.createTeam({ id: "team_1", organizationId: "org_1", name: "Engineering", createdAt: NOW });
    store.createHuman({ id: "hum_sergio", teamId: "team_1", displayName: "Sergio", createdAt: NOW });
    const ctx: ActorContext = { actor: { actorId: "hum_sergio", actorType: "human" } };
    const built = buildMature(service, ctx);
    const cursor = service.getWorkspaceContext(ctx, built.workspaceId).orientationCursor;
    service.addFinding(ctx, { workspaceId: built.workspaceId, summary: "after cursor one" });
    service.addFinding(ctx, { workspaceId: built.workspaceId, summary: "after cursor two" });
    service.close();

    for (const key of envKeys) {
      previous[key] = process.env[key];
      delete process.env[key];
    }
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await runCli(["--db", dbPath, "context", built.workspaceId, "--output", "human"]);
    const contextOut = logs.join("\n");
    expect(contextOut).toMatch(/cf1\./);
    expect(contextOut).toMatch(/Showing \d+ of \d+|truncated/);

    logs.length = 0;
    await runCli(["--db", dbPath, "catch-up", built.workspaceId, "--after", cursor, "--limit", "1", "--output", "human"]);
    const catchUpOut = logs.join("\n");
    expect(catchUpOut).toMatch(/cf1\./);
    expect(catchUpOut).toMatch(/Showing \d+ of \d+/);
    rmSync(dir, { recursive: true, force: true });
  });
});
