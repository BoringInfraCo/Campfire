import { describe, expect, it } from "vitest";
import { openInMemoryStore } from "../../src/store/sqlite-store.js";
import type { CampfireStore } from "../../src/store/store.js";
import { createCounterIdSource } from "../../src/domain/ids.js";
import { createAsyncCampfireService } from "../../src/worker/async-service.js";
import { ORIENTATION_PROVENANCE_LIMIT } from "../../src/service/service.js";
import type { AsyncCampfireStore } from "../../src/worker/d1-store.js";
import { dispatchCampfireMethodAsync } from "../../src/worker/async-dispatch.js";
import { createD1WorkerHandler } from "../../src/worker/handler.js";
import { ParticipantRequired } from "../../src/domain/errors.js";

const NOW = "2026-01-01T00:00:00.000Z";

/**
 * Adapt the sync SQLite store to the async boundary. Each call is deferred
 * through Promise.resolve so the async service/authorizer/dispatch port is
 * exercised end to end without emulating D1 SQL.
 */
function wrapSync(store: CampfireStore): AsyncCampfireStore {
  return new Proxy(store, {
    get(target, prop, receiver) {
      // Mirror D1 semantics: no interactive transactions, run sequentially.
      // better-sqlite3 rejects async transaction functions outright.
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

/**
 * Defer contribution inserts by a macrotask. A service method that does not
 * await `record()` resolves before the row lands, so a following read misses
 * it — the sequencing bug Sprint 010 closes for the Workers/D1 path.
 */
function deferContributions(store: AsyncCampfireStore): AsyncCampfireStore {
  return new Proxy(store, {
    get(target, prop, receiver) {
      if (prop === "createContribution") {
        const insert = Reflect.get(target, prop, receiver) as (value: unknown) => Promise<void>;
        return (value: unknown) =>
          new Promise<void>((resolve, reject) => {
            setTimeout(() => {
              insert.call(target, value).then(resolve, reject);
            }, 0);
          });
      }
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== "function") return value;
      return (...args: unknown[]) =>
        (value as (...a: unknown[]) => unknown).apply(target, args);
    },
  }) as unknown as AsyncCampfireStore;
}

async function setup() {
  const sync = openInMemoryStore();
  const store = wrapSync(sync);
  const service = createAsyncCampfireService({
    store,
    idSource: createCounterIdSource(),
    clock: () => NOW,
  });
  await store.createOrganization({ id: "org_1", name: "Boring Infra Co.", createdAt: NOW });
  await store.createTeam({ id: "team_1", organizationId: "org_1", name: "Engineering", createdAt: NOW });
  const { human, token } = await service.createHuman(undefined, {
    teamId: "team_1",
    displayName: "Ada",
  });
  return { sync, store, service, human, token };
}

describe("async service port (Workers/D1 logic)", () => {
  it("resolves a freshly minted token to its actor", async () => {
    const { service, human, token } = await setup();
    await expect(service.resolveToken(token)).resolves.toEqual({
      actorId: human.id,
      actorType: "human",
    });
  });

  it("creates a workspace, goal, finding, and projects context", async () => {
    const { service, human } = await setup();
    const ctx = { actor: { actorId: human.id, actorType: "human" as const } };

    const workspace = await service.createWorkspace(ctx, { teamId: "team_1", name: "A" });
    expect(workspace.status).toBe("active");

    await service.createGoal(ctx, { workspaceId: workspace.id, title: "Continuity" });
    const finding = await service.addFinding(ctx, {
      workspaceId: workspace.id,
      summary: "Async port works",
    });
    expect(finding.createdBy).toEqual(ctx.actor);

    const context = await service.getWorkspaceContext(ctx, workspace.id);
    expect(context.goal?.title).toBe("Continuity");
    expect(context.findings.map((f) => f.id)).toContain(finding.id);

    const resolved = await dispatchCampfireMethodAsync(service, ctx, "list_workspaces", {});
    expect(resolved as unknown[]).toHaveLength(1);
  });

  it("checks workspace-scoped readiness through the async service and dispatch", async () => {
    const { service, human } = await setup();
    const humanCtx = { actor: { actorId: human.id, actorType: "human" as const } };
    const workspace = await service.createWorkspace(humanCtx, { teamId: "team_1", name: "A" });
    const otherWorkspace = await service.createWorkspace(humanCtx, {
      teamId: "team_1",
      name: "B",
    });
    const created = await service.createAgent(humanCtx, {
      teamId: "team_1",
      humanId: human.id,
      name: "Codex",
      harness: "codex",
    });
    const agent = { actorId: created.agent.id, actorType: "agent" as const };
    const agentCtx = { actor: agent };
    await service.inviteToWorkspace(humanCtx, {
      workspaceId: workspace.id,
      actor: agent,
      role: "agent",
    });
    await service.joinWorkspace(agentCtx, { workspaceId: workspace.id });
    await service.inviteToWorkspace(humanCtx, {
      workspaceId: otherWorkspace.id,
      actor: agent,
      role: "agent",
    });
    await service.joinWorkspace(agentCtx, { workspaceId: otherWorkspace.id });

    await expect(
      dispatchCampfireMethodAsync(service, agentCtx, "preflight", { workspaceId: workspace.id }),
    ).rejects.toMatchObject({
      code: "Unauthorized",
      details: { nextAction: "register_agent_session" },
    });

    const session = await service.registerAgentSession(agentCtx, {
      agentId: agent.actorId,
      workspaceId: workspace.id,
      harness: "codex",
    });
    await expect(
      service.checkReadiness({ ...agentCtx, agentSessionId: session.id }, { workspaceId: workspace.id }),
    ).resolves.toEqual({
      ready: true,
      workspaceId: workspace.id,
      actor: agent,
      sessionId: session.id,
    });
    await expect(
      dispatchCampfireMethodAsync(
        service,
        { ...agentCtx, agentSessionId: session.id },
        "preflight",
        { workspaceId: otherWorkspace.id },
      ),
    ).rejects.toMatchObject({
      code: "Unauthorized",
      details: { nextAction: "register_agent_session" },
    });

    await service.endAgentSession(humanCtx, session.id);
    await expect(
      service.checkReadiness({ ...agentCtx, agentSessionId: session.id }, { workspaceId: workspace.id }),
    ).rejects.toMatchObject({
      code: "Unauthorized",
      details: { nextAction: "register_agent_session" },
    });
  });

  it("rejects reads by non-participants before retrieval", async () => {
    const { service, human } = await setup();
    const ctx = { actor: { actorId: human.id, actorType: "human" as const } };
    const workspace = await service.createWorkspace(ctx, { teamId: "team_1", name: "A" });

    const other = await service.createHuman(ctx, { teamId: "team_1", displayName: "Grace" });
    const otherCtx = { actor: { actorId: other.human.id, actorType: "human" as const } };
    await expect(service.getWorkspace(otherCtx, workspace.id)).rejects.toThrow(ParticipantRequired);
  });
});

describe("Sprint 010 contribution sequencing (async port)", () => {
  it("awaits the contribution write for join, invite, register session, decision, and artifact", async () => {
    const sync = openInMemoryStore();
    const store = deferContributions(wrapSync(sync));
    const service = createAsyncCampfireService({
      store,
      idSource: createCounterIdSource(),
      clock: () => NOW,
    });
    await store.createOrganization({ id: "org_1", name: "Boring Infra Co.", createdAt: NOW });
    await store.createTeam({ id: "team_1", organizationId: "org_1", name: "Engineering", createdAt: NOW });
    const { human } = await service.createHuman(undefined, { teamId: "team_1", displayName: "Ada" });
    const ctx = { actor: { actorId: human.id, actorType: "human" as const } };
    const other = await service.createHuman(ctx, { teamId: "team_1", displayName: "Grace" });
    const otherActor = { actorId: other.human.id, actorType: "human" as const };

    const workspace = await service.createWorkspace(ctx, { teamId: "team_1", name: "Sequenced" });
    await service.inviteToWorkspace(ctx, { workspaceId: workspace.id, actor: otherActor, role: "member" });
    await service.joinWorkspace({ actor: otherActor }, { workspaceId: workspace.id });

    const created = await service.createAgent(ctx, {
      teamId: "team_1",
      humanId: human.id,
      name: "Codex",
      harness: "codex",
    });
    const agentActor = { actorId: created.agent.id, actorType: "agent" as const };
    await service.inviteToWorkspace(ctx, { workspaceId: workspace.id, actor: agentActor, role: "agent" });
    await service.joinWorkspace({ actor: agentActor }, { workspaceId: workspace.id });
    await service.registerAgentSession(
      { actor: agentActor },
      { agentId: agentActor.actorId, workspaceId: workspace.id, harness: "codex" },
    );
    await service.addDecision(ctx, { workspaceId: workspace.id, summary: "Sequenced" });
    await service.addArtifact(ctx, {
      workspaceId: workspace.id,
      type: "log",
      title: "Log",
      uriOrPath: "a.log",
    });

    // Every write must be durable before its method resolves: the deferred
    // store has not inserted anything at this point unless the service awaited.
    const activity = sync.listContributions(workspace.id);
    expect(activity.map((item) => [item.action, item.objectType])).toEqual([
      ["create", "workspace"],
      ["join", "participant"],
      ["create", "invite"],
      ["join", "participant"],
      ["create", "invite"],
      ["join", "participant"],
      ["register_session", "agent_session"],
      ["create", "decision"],
      ["create", "artifact"],
    ]);
    expect(activity.at(-1)?.actor.actorId).toBe(human.id);
  });
});

describe("Sprint 008 orientation projection (async parity)", () => {
  // Build a populated workspace through the async service so sync and
  // Workers/D1 projections can be compared field by field.
  async function populate() {
    const { service, human, sync } = await setup();
    const ctx = { actor: { actorId: human.id, actorType: "human" as const } };
    const other = await service.createHuman(ctx, { teamId: "team_1", displayName: "Grace" });
    const otherActor = { actorId: other.human.id, actorType: "human" as const };
    const created = await service.createAgent(ctx, {
      teamId: "team_1",
      humanId: human.id,
      name: "Codex",
      harness: "codex",
    });
    const agentActor = { actorId: created.agent.id, actorType: "agent" as const };

    const workspace = await service.createWorkspace(ctx, { teamId: "team_1", name: "Room" });
    await service.inviteToWorkspace(ctx, { workspaceId: workspace.id, actor: otherActor, role: "member" });
    await service.joinWorkspace({ actor: otherActor }, { workspaceId: workspace.id });
    await service.inviteToWorkspace(ctx, { workspaceId: workspace.id, actor: agentActor, role: "agent" });
    await service.joinWorkspace({ actor: agentActor }, { workspaceId: workspace.id });
    await service.createGoal(ctx, { workspaceId: workspace.id, title: "Ship the room" });

    const actionable = await service.addDecision(ctx, { workspaceId: workspace.id, summary: "D1" });
    const accepted = await service.addDecision(ctx, { workspaceId: workspace.id, summary: "D2" });
    await service.acceptDecision(ctx, accepted.id);

    const assignedOpen = await service.createTask(ctx, {
      workspaceId: workspace.id,
      title: "Open mine",
      assignee: ctx.actor,
    });
    const assignedBlocked = await service.createTask(ctx, {
      workspaceId: workspace.id,
      title: "Blocked mine",
      assignee: ctx.actor,
    });
    await service.updateTask(ctx, { taskId: assignedBlocked.id, status: "blocked" });
    const inProgress = await service.createTask(ctx, {
      workspaceId: workspace.id,
      title: "In progress",
      assignee: ctx.actor,
    });
    await service.updateTask(ctx, { taskId: inProgress.id, status: "in_progress" });
    const unassignedBlocked = await service.createTask(ctx, {
      workspaceId: workspace.id,
      title: "Unassigned blocked",
    });
    await service.updateTask(ctx, { taskId: unassignedBlocked.id, status: "blocked" });
    const otherBlocked = await service.createTask(ctx, {
      workspaceId: workspace.id,
      title: "Other blocked",
      assignee: otherActor,
    });
    await service.updateTask(ctx, { taskId: otherBlocked.id, status: "blocked" });

    await service.addFinding(ctx, { workspaceId: workspace.id, summary: "Finding" });
    await service.addArtifact(ctx, {
      workspaceId: workspace.id,
      type: "log",
      title: "Log",
      uriOrPath: "a.log",
    });

    return {
      service,
      ctx,
      sync,
      workspace,
      actionable,
      accepted,
      assignedOpen,
      assignedBlocked,
      inProgress,
      unassignedBlocked,
      otherBlocked,
    };
  }

  it("derives the same authorization-aware orientation projection as the sync service", async () => {
    const p = await populate();
    const context = await p.service.getWorkspaceContext(p.ctx, p.workspace.id);

    expect(context.needsYou.map((item) => item.reason)).toEqual([
      "proposed_decision_actionable",
      "assigned_blocked_task",
      "assigned_open_task",
    ]);
    expect(context.needsYou.find((item) => item.reason === "proposed_decision_actionable")?.id).toBe(
      p.actionable.id,
    );
    expect(context.needsYou.find((item) => item.reason === "assigned_blocked_task")?.id).toBe(
      p.assignedBlocked.id,
    );
    expect(context.needsYou.find((item) => item.reason === "assigned_open_task")?.id).toBe(
      p.assignedOpen.id,
    );

    expect(context.needsAttention.map((item) => item.reason)).toEqual([
      "unassigned_blocked_task",
      "team_blocked_task",
    ]);
    expect(context.needsAttention.find((item) => item.reason === "team_blocked_task")?.id).toBe(
      p.otherBlocked.id,
    );

    expect(context.currentWork.inProgressTasks.map((task) => task.id)).toEqual([p.inProgress.id]);
    expect(context.currentWork.blockedTasks.map((task) => task.id).sort()).toEqual(
      [p.assignedBlocked.id, p.unassignedBlocked.id, p.otherBlocked.id].sort(),
    );
    expect(context.currentWork.acceptedDecisions.map((decision) => decision.id)).toEqual([
      p.accepted.id,
    ]);

    expect(context.suggestedNextAction).toEqual({
      kind: "decision",
      id: p.actionable.id,
      summary: "D1",
      reason: "proposed_decision_actionable",
      orientationHint: true,
    });
    expect(context.provenanceSummary.some((line) => line.includes("Finding"))).toBe(true);
    expect(context.since).toBeUndefined();
  });

  it("supports since and rejects an unknown cursor through the async port", async () => {
    const p = await populate();
    const activity = p.sync.listContributions(p.workspace.id);
    const anchor = activity[2]!.id;

    const context = await p.service.getWorkspaceContext(p.ctx, p.workspace.id, { since: anchor });
    expect(context.since?.items.map((item) => item.id)).toEqual(
      activity.slice(3).map((item) => item.id),
    );
    expect(context.since?.cursor).toBe(activity.at(-1)!.id);
    expect(context.since?.truncated).toBe(false);

    const newest = activity.at(-1)!.id;
    const empty = await p.service.getWorkspaceContext(p.ctx, p.workspace.id, { since: newest });
    expect(empty.since).toEqual({ cursor: newest, items: [], truncated: false });

    for (let index = 0; index < ORIENTATION_PROVENANCE_LIMIT + 1; index += 1) {
      await p.service.addFinding(p.ctx, { workspaceId: p.workspace.id, summary: `more ${index}` });
    }
    const after = p.sync.listContributions(p.workspace.id);
    const capped = await p.service.getWorkspaceContext(p.ctx, p.workspace.id, { since: newest });
    expect(capped.since?.truncated).toBe(true);
    expect(capped.since?.items).toHaveLength(ORIENTATION_PROVENANCE_LIMIT);
    expect(capped.since?.cursor).toBe(after.at(-1)!.id);
    expect(capped.since?.items.map((item) => item.id)).not.toContain(after[activity.length]!.id);

    const elsewhere = await p.service.createWorkspace(p.ctx, { teamId: "team_1", name: "Elsewhere" });
    const foreign = p.sync.listContributions(elsewhere.id).at(-1)!.id;
    await expect(
      p.service.getWorkspaceContext(p.ctx, p.workspace.id, { since: foreign }),
    ).rejects.toMatchObject({ code: "ValidationError", details: { field: "since" } });

    await expect(
      p.service.getWorkspaceContext(p.ctx, p.workspace.id, { since: "con_missing" }),
    ).rejects.toMatchObject({ code: "ValidationError", details: { field: "since" } });
  });

  it("gives a viewer no Needs You decision and rejects non-participants", async () => {
    const { service, human } = await setup();
    const ctx = { actor: { actorId: human.id, actorType: "human" as const } };
    const viewer = await service.createHuman(ctx, { teamId: "team_1", displayName: "Vic" });
    const viewerActor = { actorId: viewer.human.id, actorType: "human" as const };
    const workspace = await service.createWorkspace(ctx, { teamId: "team_1", name: "Viewer" });
    await service.inviteToWorkspace(ctx, { workspaceId: workspace.id, actor: viewerActor, role: "viewer" });
    await service.joinWorkspace({ actor: viewerActor }, { workspaceId: workspace.id });
    const decision = await service.addDecision(ctx, {
      workspaceId: workspace.id,
      summary: "Viewer cannot accept",
    });

    const context = await service.getWorkspaceContext({ actor: viewerActor }, workspace.id);
    expect(context.needsYou).toEqual([]);
    expect(context.needsAttention).toEqual([
      {
        kind: "decision",
        id: decision.id,
        summary: "Viewer cannot accept",
        status: "proposed",
        reason: "team_proposed_decision",
      },
    ]);

    const outsider = await service.createHuman(ctx, { teamId: "team_1", displayName: "Out" });
    const outsiderCtx = { actor: { actorId: outsider.human.id, actorType: "human" as const } };
    await expect(service.getWorkspaceContext(outsiderCtx, workspace.id)).rejects.toMatchObject({
      code: "ParticipantRequired",
    });
  });
});

describe("Sprint 008 attention edge cases (async parity)", () => {
  it("demotes viewer-assigned blocked and open tasks to needsAttention, not needsYou", async () => {
    const { service, human } = await setup();
    const ctx = { actor: { actorId: human.id, actorType: "human" as const } };
    const viewer = await service.createHuman(ctx, { teamId: "team_1", displayName: "Vic" });
    const viewerActor = { actorId: viewer.human.id, actorType: "human" as const };
    const workspace = await service.createWorkspace(ctx, { teamId: "team_1", name: "Viewer edges" });
    await service.inviteToWorkspace(ctx, { workspaceId: workspace.id, actor: viewerActor, role: "viewer" });
    await service.joinWorkspace({ actor: viewerActor }, { workspaceId: workspace.id });

    // Tasks are assigned to the viewer by the owner; the viewer may read but
    // cannot act, so neither task may surface as Needs You (Sprint 008).
    const blocked = await service.createTask(ctx, {
      workspaceId: workspace.id,
      title: "Viewer blocked",
      assignee: viewerActor,
    });
    await service.updateTask(ctx, { taskId: blocked.id, status: "blocked" });
    const open = await service.createTask(ctx, {
      workspaceId: workspace.id,
      title: "Viewer open",
      assignee: viewerActor,
    });

    const context = await service.getWorkspaceContext({ actor: viewerActor }, workspace.id);
    expect(context.needsYou).toEqual([]);
    expect(context.needsAttention).toEqual([
      {
        kind: "task",
        id: blocked.id,
        summary: "Viewer blocked",
        status: "blocked",
        reason: "team_blocked_task",
        assignee: viewerActor,
      },
      {
        kind: "task",
        id: open.id,
        summary: "Viewer open",
        status: "open",
        reason: "assigned_open_task",
        assignee: viewerActor,
      },
    ]);
  });

  it("falls back to team_open_task for an unassigned oldest open task", async () => {
    const { service, human } = await setup();
    const ctx = { actor: { actorId: human.id, actorType: "human" as const } };
    const workspace = await service.createWorkspace(ctx, { teamId: "team_1", name: "Fallback" });
    const oldest = await service.createTask(ctx, { workspaceId: workspace.id, title: "Oldest open" });
    await service.createTask(ctx, { workspaceId: workspace.id, title: "Newer open" });

    const context = await service.getWorkspaceContext(ctx, workspace.id);
    // The owner cannot act on an unassigned task, so it is neither Needs You
    // nor Needs Attention; the generic fallback still points at it.
    expect(context.needsYou).toEqual([]);
    expect(context.needsAttention).toEqual([]);
    expect(context.suggestedNextAction).toEqual({
      kind: "task",
      id: oldest.id,
      summary: "Oldest open",
      reason: "team_open_task",
      orientationHint: true,
    });
  });

  it("keeps an actionable proposed decision ahead of the team_open_task fallback", async () => {
    const { service, human } = await setup();
    const ctx = { actor: { actorId: human.id, actorType: "human" as const } };
    const workspace = await service.createWorkspace(ctx, { teamId: "team_1", name: "Precedence" });
    const decision = await service.addDecision(ctx, { workspaceId: workspace.id, summary: "Decide now" });
    const fallback = await service.createTask(ctx, {
      workspaceId: workspace.id,
      title: "Unassigned open",
    });

    const context = await service.getWorkspaceContext(ctx, workspace.id);
    expect(context.needsAttention).toEqual([]);
    expect(context.suggestedNextAction).toEqual({
      kind: "decision",
      id: decision.id,
      summary: "Decide now",
      reason: "proposed_decision_actionable",
      orientationHint: true,
    });
    expect(context.suggestedNextAction.id).not.toBe(fallback.id);
  });
});

describe("Sprint 009 recorded alignment (async parity)", () => {
  it("derives open, established, unspecified, and ignores superseded-only decisions", async () => {
    const { service, human, sync } = await setup();
    const ctx = { actor: { actorId: human.id, actorType: "human" as const } };

    const unspecified = await service.createWorkspace(ctx, { teamId: "team_1", name: "None" });
    const none = await service.getWorkspaceContext(ctx, unspecified.id);
    expect(none.alignment).toEqual({
      status: "unspecified",
      proposedDecisionIds: [],
      acceptedDecisionIds: [],
      unresolvedBlockedTaskIds: [],
    });

    const openWs = await service.createWorkspace(ctx, { teamId: "team_1", name: "Open" });
    const proposed = await service.addDecision(ctx, { workspaceId: openWs.id, summary: "Propose" });
    const acceptedToo = await service.addDecision(ctx, {
      workspaceId: openWs.id,
      summary: "Accept too",
    });
    await service.acceptDecision(ctx, acceptedToo.id);
    const blocked = await service.createTask(ctx, { workspaceId: openWs.id, title: "Blocked" });
    await service.updateTask(ctx, { taskId: blocked.id, status: "blocked" });
    const openTask = await service.createTask(ctx, { workspaceId: openWs.id, title: "Open task" });
    const openContext = await service.getWorkspaceContext(ctx, openWs.id);
    expect(openContext.alignment).toEqual({
      status: "open",
      proposedDecisionIds: [proposed.id],
      acceptedDecisionIds: [acceptedToo.id],
      unresolvedBlockedTaskIds: [blocked.id],
    });
    expect(openContext.alignment.unresolvedBlockedTaskIds).not.toContain(openTask.id);

    const establishedWs = await service.createWorkspace(ctx, {
      teamId: "team_1",
      name: "Established",
    });
    const accepted = await service.addDecision(ctx, {
      workspaceId: establishedWs.id,
      summary: "Accepted",
    });
    await service.acceptDecision(ctx, accepted.id);
    const established = await service.getWorkspaceContext(ctx, establishedWs.id);
    expect(established.alignment).toEqual({
      status: "established",
      proposedDecisionIds: [],
      acceptedDecisionIds: [accepted.id],
      unresolvedBlockedTaskIds: [],
    });

    const supersededWs = await service.createWorkspace(ctx, {
      teamId: "team_1",
      name: "Superseded",
    });
    const old = await service.addDecision(ctx, {
      workspaceId: supersededWs.id,
      summary: "Old",
    });
    sync.updateDecision(old.id, { status: "superseded", updatedAt: "2026-01-02T00:00:00.000Z" });
    const onlySuperseded = await service.getWorkspaceContext(ctx, supersededWs.id);
    expect(onlySuperseded.alignment).toEqual({
      status: "unspecified",
      proposedDecisionIds: [],
      acceptedDecisionIds: [],
      unresolvedBlockedTaskIds: [],
    });
  });
});

describe("D1 worker handler (async production path)", () => {
  it("does not expose the journal from the production asset binding", async () => {
    const { store } = await setup();
    const fetched: string[] = [];
    const handle = createD1WorkerHandler({
      store,
      assetsFetch: async (request) => {
        fetched.push(new URL(request.url).pathname);
        return new Response("installer");
      },
    });

    const journal = await handle(new Request("https://campfire.test/"));
    expect(journal.status).toBe(404);
    expect(fetched).toEqual([]);

    const installer = await handle(new Request("https://campfire.test/campfire/install.sh"));
    expect(installer.status).toBe(200);
    expect(await installer.text()).toBe("installer");
    expect(fetched).toEqual(["/campfire/install.sh"]);
  });

  it("accepts a valid token, rejects missing/bad tokens, denies unauthorized reads", async () => {
    const { store, service, token, human } = await setup();
    const handle = createD1WorkerHandler({ store });

    async function call(auth: string | undefined, method: string, params: Record<string, unknown> = {}) {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (auth !== undefined) headers.authorization = `Bearer ${auth}`;
      const res = await handle(
        new Request("https://campfire.test/v1/call", {
          method: "POST",
          headers,
          body: JSON.stringify({ method, params }),
        }),
      );
      return { status: res.status, body: (await res.json()) as any };
    }

    const whoami = await call(token, "whoami");
    expect(whoami.status).toBe(200);
    expect(whoami.body.result.actor).toEqual({ actorId: human.id, actorType: "human" });

    const missing = await call(undefined, "whoami");
    expect(missing.status).toBe(401);

    const bad = await call("cft_not_a_real_token_0000000000000000", "whoami");
    expect(bad.status).toBe(401);

    // Private workspace: the second human is not a participant.
    const ctx = { actor: { actorId: human.id, actorType: "human" as const } };
    const workspace = await service.createWorkspace(ctx, { teamId: "team_1", name: "Private" });
    const ready = await call(token, "preflight", { workspaceId: workspace.id });
    expect(ready.status).toBe(200);
    expect(ready.body.result).toEqual({
      ready: true,
      workspaceId: workspace.id,
      actor: { actorId: human.id, actorType: "human" },
    });

    const other = await service.createHuman(ctx, { teamId: "team_1", displayName: "Grace" });
    const denied = await call(other.token, "get_workspace_context", { workspaceId: workspace.id });
    expect(denied.status).toBe(403);
    expect(["ParticipantRequired", "Unauthorized"]).toContain(denied.body.error);

    service.close();
  });
});
