import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { FIXTURE, seedFixture } from "../../src/bootstrap/seed.js";
import {
  computeSprint012Checks,
  fromWorkspaceView,
  isReadyToClose,
  recommend012,
} from "../../src/acceptance/sprint-012/checks.js";
import { PRIVATE_TRANSCRIPT_SENTINEL_012 } from "../../src/acceptance/sprint-012/prompts.js";
import { createCounterIdSource } from "../../src/domain/ids.js";
import {
  InvalidTransition,
  ParticipantRequired,
  Unauthorized,
} from "../../src/domain/errors.js";
import type { ActorRef, Contribution } from "../../src/domain/types.js";
import { createCampfireMcpServer } from "../../src/mcp/tools.js";
import type { ActorContext } from "../../src/service/authorization.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import type { CampfireService, WorkspaceView } from "../../src/service/service.js";
import { openInMemoryStore } from "../../src/store/sqlite-store.js";
import type { CampfireStore } from "../../src/store/store.js";
import { createAsyncCampfireService } from "../../src/worker/async-service.js";
import type { AsyncCampfireStore } from "../../src/worker/d1-store.js";

const NOW = "2026-09-25T00:00:00.000Z";
const WORKSPACE_ID = FIXTURE.workspaces.billing;

const CODEX_AGENT: ActorRef = { actorId: FIXTURE.agents.codexSergio, actorType: "agent" };
const OPENCODE_AGENT: ActorRef = { actorId: FIXTURE.agents.opencodeAlice, actorType: "agent" };
const SERGIO_HUMAN: ActorRef = { actorId: FIXTURE.humans.sergio, actorType: "human" };

const FINDING_SUMMARY = "Billing deploy pipeline verified against the staged rollout checklist.";
const FINDING_DETAIL = "Goal outcome recorded after the final verification pass; no open work remains.";
const TASK_TITLE = "Finish billing deploy verification";
const ARTIFACT_TITLE = "Billing deploy verification record";
const ARTIFACT_PATH = "verification.md";

const FORBIDDEN = [PRIVATE_TRANSCRIPT_SENTINEL_012];

function createClock(startMs = Date.parse(NOW)): () => string {
  let current = startMs;
  return (): string => {
    current += 1000;
    return new Date(current).toISOString();
  };
}

let store: CampfireStore;
let service: CampfireService;
let clock: () => string;

function contributions(): Contribution[] {
  return store.listContributions(WORKSPACE_ID);
}

function newestId(): string {
  return contributions().at(-1)?.id ?? "";
}

function expectNoForbidden(value: string, scope: string): void {
  for (const token of FORBIDDEN) {
    expect(value.includes(token), `${scope} leaks forbidden string ${token}`).toBe(false);
  }
}

beforeEach(() => {
  store = openInMemoryStore();
  clock = createClock();
  service = createCampfireService({ store, idSource: createCounterIdSource(), clock });
  seedFixture(store, { clock });
});

afterEach(() => {
  service.close();
});

function registerCodexSession(): { ctx: ActorContext; sessionId: string } {
  const base: ActorContext = { actor: CODEX_AGENT };
  const session = service.registerAgentSession(base, {
    agentId: CODEX_AGENT.actorId,
    humanId: FIXTURE.humans.sergio,
    workspaceId: WORKSPACE_ID,
    harness: "codex",
  });
  return { ctx: { actor: CODEX_AGENT, agentSessionId: session.id }, sessionId: session.id };
}

function registerOpencodeSession(): { ctx: ActorContext; sessionId: string } {
  const base: ActorContext = { actor: OPENCODE_AGENT };
  const session = service.registerAgentSession(base, {
    agentId: OPENCODE_AGENT.actorId,
    humanId: FIXTURE.humans.alice,
    workspaceId: WORKSPACE_ID,
    harness: "opencode",
  });
  return { ctx: { actor: OPENCODE_AGENT, agentSessionId: session.id }, sessionId: session.id };
}

function buildPostWorkShape(ctx: ActorContext): {
  findingId: string;
  taskId: string;
  artifactId: string;
} {
  const goal = service.updateGoal(ctx, { goalId: FIXTURE.goals.billing, status: "completed" });
  expect(goal.status).toBe("completed");
  const task = service.createTask(ctx, { workspaceId: WORKSPACE_ID, title: TASK_TITLE });
  expect(task.status).toBe("open");
  const completedTask = service.updateTask(ctx, { taskId: task.id, status: "completed" });
  expect(completedTask.status).toBe("completed");
  const finding = service.addFinding(ctx, {
    workspaceId: WORKSPACE_ID,
    summary: FINDING_SUMMARY,
    detail: FINDING_DETAIL,
  });
  const artifact = service.addArtifact(ctx, {
    workspaceId: WORKSPACE_ID,
    type: "document",
    title: ARTIFACT_TITLE,
    uriOrPath: ARTIFACT_PATH,
  });
  expect(service.getWorkspace(ctx, WORKSPACE_ID).workspace.status).toBe("active");
  return { findingId: finding.id, taskId: completedTask.id, artifactId: artifact.id };
}

function takeSnapshot(ctx: ActorContext): ReturnType<typeof fromWorkspaceView> {
  const view = service.getWorkspace(ctx, WORKSPACE_ID);
  const context = service.getWorkspaceContext(ctx, WORKSPACE_ID);
  const merged = { ...view, ...context } as unknown as WorkspaceView;
  return fromWorkspaceView(merged, WORKSPACE_ID);
}

/**
 * Adapt the sync SQLite store to the async boundary. Each call is deferred
 * through Promise.resolve so the async service/authorizer/dispatch port is
 * exercised end to end without emulating D1 SQL.
 */
function wrapSync(syncStore: CampfireStore): AsyncCampfireStore {
  return new Proxy(syncStore, {
    get(target, prop, receiver) {
      if (prop === "transaction") {
        return (fn: () => Promise<unknown>) => fn();
      }
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== "function") return value;
      return (...args: unknown[]) =>
        Promise.resolve((value as (...a: unknown[]) => unknown).apply(target, args));
    },
  }) as unknown as AsyncCampfireStore;
}

describe("sprint-012 workspace closure", () => {
  it("closes a genuinely finished workspace with one provenance-backed contribution", () => {
    const { ctx, sessionId } = registerCodexSession();
    const shaped = buildPostWorkShape(ctx);

    const before = takeSnapshot(ctx);
    expect(isReadyToClose(before.signals).ready).toBe(true);

    const preCloseCursor = newestId();
    expect(preCloseCursor).not.toBe("");
    const beforeCount = contributions().length;

    const closed = service.updateWorkspace(ctx, { workspaceId: WORKSPACE_ID, status: "completed" });
    expect(closed.status).toBe("completed");

    const afterActivity = contributions();
    expect(afterActivity.length).toBe(beforeCount + 1);
    const fresh = afterActivity[afterActivity.length - 1]!;
    expect(fresh).toMatchObject({
      workspaceId: WORKSPACE_ID,
      actor: CODEX_AGENT,
      agentSessionId: sessionId,
      action: "update",
      objectType: "workspace",
      objectId: WORKSPACE_ID,
      payload: { status: "completed" },
    });
    expect(typeof fresh.createdAt).toBe("string");
    expect(fresh.createdAt.length).toBeGreaterThan(0);
    expect(fresh.createdAt).toBe(closed.updatedAt);

    // Visible across every read surface.
    expect(service.getWorkspace(ctx, WORKSPACE_ID).workspace.status).toBe("completed");
    expect(service.getWorkspaceContext(ctx, WORKSPACE_ID).workspace.status).toBe("completed");
    const activityPage = service.getActivity(ctx, { workspaceId: WORKSPACE_ID });
    expect(activityPage.items.map((entry) => entry.id)).toContain(fresh.id);
    const listed = service.listWorkspaces(ctx).find((entry) => entry.id === WORKSPACE_ID);
    expect(listed?.status).toBe("completed");

    // History retention: prior objects remain readable.
    const view = service.getWorkspace(ctx, WORKSPACE_ID);
    expect(view.findings.map((entry) => entry.id)).toContain(shaped.findingId);
    expect(view.tasks.map((entry) => entry.id)).toContain(shaped.taskId);
    expect(view.artifacts.map((entry) => entry.id)).toContain(shaped.artifactId);
    expect(view.goal?.status).toBe("completed");

    // Since-delta returns exactly the closure contribution.
    const delta = service.getWorkspaceContext(ctx, WORKSPACE_ID, { since: preCloseCursor });
    expect(delta.since).toBeDefined();
    expect(delta.since!.items).toHaveLength(1);
    expect(delta.since!.items[0]).toMatchObject({
      id: fresh.id,
      action: "update",
      objectType: "workspace",
      objectId: WORKSPACE_ID,
      agentSessionId: sessionId,
    });

    expectNoForbidden(JSON.stringify(view), "workspace view");
    expectNoForbidden(JSON.stringify(delta.since!.items), "closure delta");

    // Evaluator scores the deterministic outcome as GO.
    const after = takeSnapshot(ctx);
    const checks = computeSprint012Checks(before, after, {
      workspaceId: WORKSPACE_ID,
      closerActorId: CODEX_AGENT.actorId,
      closerSessionId: sessionId,
      forbidden: FORBIDDEN,
    });
    expect(checks.filter((entry) => !entry.passed)).toEqual([]);
    expect(recommend012(checks)).toBe("GO");

    // A cold downstream agent with its own session reads the outcome alone.
    const { ctx: downstreamCtx } = registerOpencodeSession();
    const downstream = service.getWorkspaceContext(downstreamCtx, WORKSPACE_ID);
    expect(downstream.workspace.status).toBe("completed");
    expect(downstream.goal?.status).toBe("completed");
    expect(downstream.findings.map((entry) => entry.id)).toContain(shaped.findingId);
    expect(downstream.artifacts.map((entry) => entry.id)).toContain(shaped.artifactId);
  });

  it("rejects sessionless agent, viewer, and non-participant lifecycle writes", () => {
    const { ctx } = registerCodexSession();
    buildPostWorkShape(ctx);

    // Agent without a registered session cannot close (sync service enforces it).
    expect(() =>
      service.updateWorkspace({ actor: CODEX_AGENT }, { workspaceId: WORKSPACE_ID, status: "completed" }),
    ).toThrow(Unauthorized);

    // Viewer may read but cannot change lifecycle; authorization happens first.
    const sergioCtx: ActorContext = { actor: SERGIO_HUMAN };
    const { human: viewer } = service.createHuman(sergioCtx, {
      teamId: FIXTURE.teamId,
      displayName: "Viewer V",
    });
    const viewerRef: ActorRef = { actorId: viewer.id, actorType: "human" };
    service.inviteToWorkspace(sergioCtx, { workspaceId: WORKSPACE_ID, actor: viewerRef, role: "viewer" });
    service.joinWorkspace({ actor: viewerRef }, { workspaceId: WORKSPACE_ID });
    const viewerCtx: ActorContext = { actor: viewerRef };
    expect(service.getWorkspace(viewerCtx, WORKSPACE_ID).workspace.id).toBe(WORKSPACE_ID);
    expect(() =>
      service.updateWorkspace(viewerCtx, { workspaceId: WORKSPACE_ID, status: "completed" }),
    ).toThrow(Unauthorized);

    // Non-participant cannot change lifecycle and learns nothing via the write path.
    const { human: outsider } = service.createHuman(sergioCtx, {
      teamId: FIXTURE.teamId,
      displayName: "Outsider O",
    });
    const outsiderCtx: ActorContext = { actor: { actorId: outsider.id, actorType: "human" } };
    // Snapshot after all setup writes (viewer invite/join); only the rejected
    // lifecycle attempts below must record nothing.
    const beforeCount = contributions().length;
    expect(() =>
      service.updateWorkspace(outsiderCtx, { workspaceId: WORKSPACE_ID, status: "completed" }),
    ).toThrow(ParticipantRequired);

    // Failed attempts record nothing.
    expect(contributions().length).toBe(beforeCount);

    // The contributor session itself remains valid after the rejected writes.
    expect(service.getWorkspaceContext(ctx, WORKSPACE_ID).workspace.id).toBe(WORKSPACE_ID);
  });

  it("reopens explicitly while archived stays terminal", () => {
    const { ctx } = registerCodexSession();
    buildPostWorkShape(ctx);
    service.updateWorkspace(ctx, { workspaceId: WORKSPACE_ID, status: "completed" });

    const beforeReopen = contributions().length;
    const reopened = service.updateWorkspace(ctx, { workspaceId: WORKSPACE_ID, status: "active" });
    expect(reopened.status).toBe("active");
    const afterReopen = contributions();
    expect(afterReopen.length).toBe(beforeReopen + 1);
    expect(afterReopen[afterReopen.length - 1]).toMatchObject({
      action: "update",
      objectType: "workspace",
      objectId: WORKSPACE_ID,
      payload: { status: "active" },
    });

    service.updateWorkspace(ctx, { workspaceId: WORKSPACE_ID, status: "archived" });
    expect(store.getWorkspace(WORKSPACE_ID)?.status).toBe("archived");
    expect(() =>
      service.updateWorkspace(ctx, { workspaceId: WORKSPACE_ID, status: "active" }),
    ).toThrow(InvalidTransition);
    expect(() =>
      service.updateWorkspace(ctx, { workspaceId: WORKSPACE_ID, status: "completed" }),
    ).toThrow(InvalidTransition);
  });

  it("treats counterexamples as not ready to close", () => {
    const ready = {
      workspaceStatus: "active",
      goalStatus: "completed" as string | undefined,
      openTaskCount: 0,
      proposedDecisionCount: 0,
      unresolvedBlockedCount: 0,
      nextActionKind: "none",
    };
    expect(isReadyToClose(ready).ready).toBe(true);
    expect(isReadyToClose(ready).unmet).toEqual([]);

    expect(isReadyToClose({ ...ready, goalStatus: "active" }).ready).toBe(false);
    expect(isReadyToClose({ ...ready, goalStatus: undefined }).ready).toBe(false);
    expect(isReadyToClose({ ...ready, openTaskCount: 1 }).ready).toBe(false);
    expect(
      isReadyToClose({ ...ready, openTaskCount: 1, unresolvedBlockedCount: 1 }).ready,
    ).toBe(false);
    expect(isReadyToClose({ ...ready, unresolvedBlockedCount: 1 }).ready).toBe(false);
    expect(isReadyToClose({ ...ready, proposedDecisionCount: 1 }).ready).toBe(false);
    expect(isReadyToClose({ ...ready, nextActionKind: "task" }).ready).toBe(false);
    expect(isReadyToClose({ ...ready, nextActionKind: "decision" }).ready).toBe(false);
    expect(isReadyToClose({ ...ready, workspaceStatus: "completed" }).ready).toBe(false);

    for (const signals of [
      { ...ready, goalStatus: "active" as string | undefined },
      { ...ready, goalStatus: undefined },
      { ...ready, openTaskCount: 1 },
      { ...ready, unresolvedBlockedCount: 1 },
      { ...ready, proposedDecisionCount: 1 },
      { ...ready, nextActionKind: "task" },
    ]) {
      expect(isReadyToClose(signals).unmet.length).toBeGreaterThan(0);
    }
  });

  it("keeps worker lifecycle writes session-bound with identical provenance", async () => {
    const sync = openInMemoryStore();
    const tick = createClock();
    const asyncStore = wrapSync(sync);
    const asyncService = createAsyncCampfireService({
      store: asyncStore,
      idSource: createCounterIdSource(),
      clock: tick,
    });
    seedFixture(sync, { clock: tick });

    const agentCtx: ActorContext = { actor: CODEX_AGENT };
    const session = await asyncService.registerAgentSession(agentCtx, {
      agentId: CODEX_AGENT.actorId,
      humanId: FIXTURE.humans.sergio,
      workspaceId: WORKSPACE_ID,
      harness: "codex",
    });
    const sessionCtx: ActorContext = { actor: CODEX_AGENT, agentSessionId: session.id };

    await asyncService.updateGoal(sessionCtx, { goalId: FIXTURE.goals.billing, status: "completed" });
    const task = await asyncService.createTask(sessionCtx, {
      workspaceId: WORKSPACE_ID,
      title: TASK_TITLE,
    });
    await asyncService.updateTask(sessionCtx, { taskId: task.id, status: "completed" });
    await asyncService.addFinding(sessionCtx, {
      workspaceId: WORKSPACE_ID,
      summary: FINDING_SUMMARY,
      detail: FINDING_DETAIL,
    });
    await asyncService.addArtifact(sessionCtx, {
      workspaceId: WORKSPACE_ID,
      type: "document",
      title: ARTIFACT_TITLE,
      uriOrPath: ARTIFACT_PATH,
    });

    // Sessionless agent lifecycle write is rejected before any mutation.
    const beforeCount = sync.listContributions(WORKSPACE_ID).length;
    await expect(
      asyncService.updateWorkspace(agentCtx, { workspaceId: WORKSPACE_ID, status: "completed" }),
    ).rejects.toThrow(Unauthorized);
    expect(sync.listContributions(WORKSPACE_ID).length).toBe(beforeCount);

    const closed = await asyncService.updateWorkspace(sessionCtx, {
      workspaceId: WORKSPACE_ID,
      status: "completed",
    });
    expect(closed.status).toBe("completed");
    const afterActivity = sync.listContributions(WORKSPACE_ID);
    expect(afterActivity.length).toBe(beforeCount + 1);
    const fresh = afterActivity[afterActivity.length - 1]!;
    expect(fresh).toMatchObject({
      workspaceId: WORKSPACE_ID,
      actor: CODEX_AGENT,
      agentSessionId: session.id,
      action: "update",
      objectType: "workspace",
      objectId: WORKSPACE_ID,
      payload: { status: "completed" },
    });
    expect(typeof fresh.createdAt).toBe("string");
    expect(fresh.createdAt.length).toBeGreaterThan(0);
  });

  it("exposes lifecycle boundaries in the MCP update_workspace description", async () => {
    const server = createCampfireMcpServer({
      service,
      identity: { ctx: { actor: CODEX_AGENT }, harness: "codex" },
    });
    const client = new Client({ name: "sprint-012-test", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    try {
      const listed = await client.listTools();
      const byName = new Map(listed.tools.map((tool) => [tool.name, (tool.description ?? "").toLowerCase()]));
      const updateWorkspace = byName.get("update_workspace") ?? "";
      expect(updateWorkspace).toContain("completed");
      expect(updateWorkspace).toContain("archived");
      expect(updateWorkspace).toContain("preserves");
      expect(updateWorkspace).toContain("active");
      expect(updateWorkspace).toContain("never");
    } finally {
      await client.close();
      await server.close();
    }
  });
});
