/**
 * SWH-001 — Shared Work Home deterministic checks (contract §7, D1–D7).
 *
 * This is a deterministic integration check of the read-only Viewer slice. It
 * is not a human comprehension trace and establishes no Gate.
 *
 * The renderers are exercised in a vm sandbox exactly like the frozen
 * VIS-001/COR-001 suites: real app.js text, boot() tail cut, DOM stubbed to
 * null. Every renderer here takes explicit parameters and never touches the
 * network.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { FIXTURE, seedFixture } from "../../src/bootstrap/seed.js";
import type { ActorRef } from "../../src/domain/types.js";
import { dispatchCampfireMethod } from "../../src/http/dispatch.js";
import { createRuntimeFromPath, type CampfireRuntime } from "../../src/runtime.js";
import type { ActorContext } from "../../src/service/authorization.js";
import { startCampfireViewer, VIEWER_READ_METHODS, type RunningViewer } from "../../src/viewer/server.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_JS = readFileSync(join(HERE, "../../src/viewer/static/app.js"), "utf8");
const APP_CSS = readFileSync(join(HERE, "../../src/viewer/static/app.css"), "utf8");
const INDEX_HTML = readFileSync(join(HERE, "../../src/viewer/static/index.html"), "utf8");

interface CallOutcome {
  status: number;
  body: { ok: true; result: any } | { ok: false; error: string; message: string };
}

function loadAppSandbox() {
  const listeners: Record<string, Array<(event: any) => void>> = {};
  let fetchCalls = 0;
  const sandbox: Record<string, unknown> = {
    document: {
      getElementById: () => null,
      addEventListener: (name: string, fn: (event: any) => void) => {
        (listeners[name] ??= []).push(fn);
      },
    },
    sessionStorage: { getItem: () => null, setItem: () => {} },
    fetch: async () => {
      fetchCalls += 1;
      throw new Error("no fetch in sandbox");
    },
    setInterval: () => 0,
    CSS: { escape: (value: string) => value },
    console,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const cut = APP_JS.lastIndexOf("async function boot()");
  vm.runInContext(cut === -1 ? APP_JS : APP_JS.slice(0, cut), sandbox, { filename: "app.js" });
  return { sandbox, listeners, fetchCalls: () => fetchCalls };
}

function evalIn<T>(sandbox: Record<string, unknown>, expression: string): T {
  return vm.runInContext(expression, sandbox) as T;
}

/** Render through an explicit-parameter renderer into a stubbed element. */
function renderInto(sandbox: Record<string, unknown>, call: string): string {
  sandbox.el = { innerHTML: "" };
  vm.runInContext(call, sandbox);
  return evalIn<string>(sandbox, "el.innerHTML");
}

function renderWith(
  sandbox: Record<string, unknown>,
  fn: string,
  ...args: unknown[]
): string {
  return renderInto(sandbox, `${fn}(el, ${args.map((value) => JSON.stringify(value)).join(", ")})`);
}

async function call(baseUrl: string, method: string, params?: Record<string, unknown>): Promise<CallOutcome> {
  const response = await fetch(`${baseUrl}/api/call`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, params }),
  });
  return { status: response.status, body: (await response.json()) as CallOutcome["body"] };
}

/** Raw request with a caller-chosen Host (fetch cannot set Host). */
function rawRequest(options: {
  port: number;
  path: string;
  method?: string;
  host?: string;
}): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port: options.port,
        path: options.path,
        method: options.method ?? "GET",
        ...(options.host !== undefined ? { headers: { host: options.host } } : {}),
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          text += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

const SERGIO: ActorRef = { actorId: FIXTURE.humans.sergio, actorType: "human" };
const ALICE: ActorRef = { actorId: FIXTURE.humans.alice, actorType: "human" };

let dir: string;
let runtime: CampfireRuntime;
const viewers: RunningViewer[] = [];

function ctxFor(actor: ActorRef): ActorContext {
  return { actor };
}

async function startViewer(actor: ActorRef): Promise<RunningViewer> {
  const viewer = await startCampfireViewer({
    port: 0,
    call: (method, params) => Promise.resolve(dispatchCampfireMethod(runtime.service, ctxFor(actor), method, params ?? {})),
  });
  viewers.push(viewer);
  return viewer;
}

/** Render an attention list (needsYou/needsAttention) into a stubbed element. */
function renderAttention(sandbox: Record<string, unknown>, items: unknown[]): string {
  return renderInto(sandbox, `renderAttentionList(el, ${JSON.stringify(items)}, "none")`);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "campfire-swh-001-"));
  runtime = createRuntimeFromPath(join(dir, "campfire.db"));
  seedFixture(runtime.store);
});

afterEach(async () => {
  while (viewers.length) {
    const viewer = viewers.pop();
    await viewer?.close();
  }
  runtime.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("SWH-001 D1 — authorization", () => {
  it("lists only the bound actor's workspaces and denies every other selection without leakage", async () => {
    const sergioViewer = await startViewer(SERGIO);

    // A human of the same team who participates in nothing: the viewer bound to
    // them must see no workspace, and neither must a workspace they create be
    // visible to a different actor.
    const una = runtime.service.createHuman(ctxFor(SERGIO), { teamId: FIXTURE.teamId, displayName: "Una Probe" });
    const unaRef: ActorRef = { actorId: una.human.id, actorType: "human" };
    const unaCtx = ctxFor(unaRef);
    const unaWorkspace = runtime.service.createWorkspace(unaCtx, { teamId: FIXTURE.teamId, name: "una-only-probe" });
    const unaViewer = await startViewer(unaRef);

    const sergioList = await call(sergioViewer.url, "list_workspaces");
    expect(sergioList.status).toBe(200);
    expect(sergioList.body.ok).toBe(true);
    if (!sergioList.body.ok) return;
    const sergioIds = (sergioList.body.result as Array<{ id: string }>).map((workspace) => workspace.id);
    expect(sergioIds).toContain(FIXTURE.workspaces.billing);
    expect(sergioIds).toContain(FIXTURE.workspaces.unrelated);
    expect(sergioIds).not.toContain(unaWorkspace.id);

    const unaList = await call(unaViewer.url, "list_workspaces");
    expect(unaList.status).toBe(200);
    expect(unaList.body.ok).toBe(true);
    if (!unaList.body.ok) return;
    const unaIds = (unaList.body.result as Array<{ id: string }>).map((workspace) => workspace.id);
    expect(unaIds).toEqual([unaWorkspace.id]);

    // The authorized read is bounded and real.
    const authorized = await call(sergioViewer.url, "get_workspace_context", {
      workspaceId: FIXTURE.workspaces.billing,
    });
    expect(authorized.status).toBe(200);
    expect(authorized.body.ok).toBe(true);
    if (!authorized.body.ok) return;
    expect(authorized.body.result.goal.title).toContain("billing-service deploys fail");
    expect(authorized.body.result.workspace.id).toBe(FIXTURE.workspaces.billing);

    // Non-participant, unknown, and forged selections: the denial carries no
    // title, participant, count, reference, or activity from the workspace.
    const deniedSelections: Array<[RunningViewer, string]> = [
      [unaViewer, FIXTURE.workspaces.billing],
      [unaViewer, FIXTURE.workspaces.unrelated],
      [sergioViewer, "ws_forged_swh_probe"],
      [sergioViewer, "ws_never_created"],
    ];
    for (const [viewer, workspaceId] of deniedSelections) {
      const denied = await call(viewer.url, "get_workspace_context", { workspaceId });
      expect(denied.status, workspaceId).toBeGreaterThanOrEqual(400);
      expect(denied.body.ok, workspaceId).toBe(false);
      const text = JSON.stringify(denied.body);
      expect(text).not.toContain(FIXTURE.unrelatedFindingSentinel);
      expect(text).not.toContain("auth-token-rotation");
      expect(text).not.toContain("billing-deploy-failure");
      expect(text).not.toContain("Sergio");
      expect(text).not.toContain("Alice");
      expect(text).not.toContain('"slices"');
      expect(text).not.toContain('"participants"');
    }

    // Service-side denial, before retrieval: not a client-side filter.
    expect(() => runtime.service.getWorkspaceContext(unaCtx, FIXTURE.workspaces.unrelated)).toThrow(
      /not a participant/,
    );
    expect(() => runtime.service.getWorkspace(unaCtx, FIXTURE.workspaces.billing)).toThrow(/not a participant/);
    try {
      runtime.service.getWorkspaceContext(unaCtx, FIXTURE.workspaces.unrelated);
      throw new Error("expected the unauthorized read to fail");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(FIXTURE.unrelatedFindingSentinel);
      expect(message).not.toContain("auth-token-rotation");
    }
  });
});

describe("SWH-001 D2 — identity", () => {
  it("shows different My work and Needs You per actor while Team work keeps the same shared facts", async () => {
    const workspaceId = FIXTURE.workspaces.billing;
    const sergioCtx = ctxFor(SERGIO);
    const sergioViewer = await startViewer(SERGIO);
    const aliceViewer = await startViewer(ALICE);

    // Two participating agents with no resolvable owner, and one assignee who
    // is not a participant at all. Seeded through the store because the service
    // correctly refuses to write unattributable state.
    const unownedAgentId = "agt_swh_probe_unowned";
    const ghostAgentId = "agt_swh_probe_ghost";
    const ghostOwnerId = "hum_swh_probe_ghost";
    const foreignActorId = "hum_swh_probe_outsider";
    // The recorded owner exists in the team but never joins this workspace, so
    // the ownership is recorded yet unresolvable here.
    runtime.store.createHuman({
      id: ghostOwnerId,
      teamId: FIXTURE.teamId,
      displayName: "Ghost Owner",
      createdAt: "2026-10-13T08:59:59.000Z",
    });
    runtime.store.createAgent({
      id: unownedAgentId,
      teamId: FIXTURE.teamId,
      name: "ProbeUnowned",
      harness: "codex",
      createdAt: "2026-10-13T09:00:00.000Z",
    });
    runtime.store.createAgent({
      id: ghostAgentId,
      teamId: FIXTURE.teamId,
      humanId: ghostOwnerId,
      name: "ProbeGhost",
      harness: "claude-code",
      createdAt: "2026-10-13T09:00:01.000Z",
    });
    runtime.store.addParticipant({
      workspaceId,
      actor: { actorId: unownedAgentId, actorType: "agent" },
      role: "agent",
      joinedAt: "2026-10-13T09:00:02.000Z",
    });
    runtime.store.addParticipant({
      workspaceId,
      actor: { actorId: ghostAgentId, actorType: "agent" },
      role: "agent",
      joinedAt: "2026-10-13T09:00:03.000Z",
    });

    const sergioOpen = runtime.service.createTask(sergioCtx, {
      workspaceId,
      title: "Sergio open probe",
      assignee: SERGIO,
    });
    const sergioBlocked = runtime.service.createTask(sergioCtx, {
      workspaceId,
      title: "Sergio blocked probe",
      assignee: SERGIO,
    });
    runtime.service.updateTask(sergioCtx, { taskId: sergioBlocked.id, status: "blocked" });
    const aliceOpen = runtime.service.createTask(sergioCtx, {
      workspaceId,
      title: "Alice open probe",
      assignee: ALICE,
    });
    const codexTask = runtime.service.createTask(sergioCtx, {
      workspaceId,
      title: "Codex probe",
      assignee: { actorId: FIXTURE.agents.codexSergio, actorType: "agent" },
    });
    runtime.service.updateTask(sergioCtx, { taskId: codexTask.id, status: "in_progress" });
    const opencodeTask = runtime.service.createTask(sergioCtx, {
      workspaceId,
      title: "OpenCode probe",
      assignee: { actorId: FIXTURE.agents.opencodeAlice, actorType: "agent" },
    });
    const unownedTask = runtime.service.createTask(sergioCtx, {
      workspaceId,
      title: "Unowned agent probe",
      assignee: { actorId: unownedAgentId, actorType: "agent" },
    });
    const ghostTask = runtime.service.createTask(sergioCtx, {
      workspaceId,
      title: "Ghost owner probe",
      assignee: { actorId: ghostAgentId, actorType: "agent" },
    });
    const unassignedTask = runtime.service.createTask(sergioCtx, { workspaceId, title: "Unassigned probe" });
    runtime.service.updateTask(sergioCtx, { taskId: unassignedTask.id, status: "blocked" });
    runtime.store.createTask({
      id: "task_swh_probe_foreign",
      workspaceId,
      title: "Foreign assignee probe",
      status: "open",
      assignee: { actorId: foreignActorId, actorType: "human" },
      createdBy: SERGIO,
      createdAt: "2026-10-13T09:10:00.000Z",
      updatedAt: "2026-10-13T09:10:00.000Z",
    });

    const sergioRead = await call(sergioViewer.url, "get_workspace_context", { workspaceId });
    const aliceRead = await call(aliceViewer.url, "get_workspace_context", { workspaceId });
    expect(sergioRead.body.ok).toBe(true);
    expect(aliceRead.body.ok).toBe(true);
    if (!sergioRead.body.ok || !aliceRead.body.ok) return;
    const sergioContext = sergioRead.body.result;
    const aliceContext = aliceRead.body.result;

    const sandbox = loadAppSandbox().sandbox;
    const sergioMine = renderWith(sandbox, "renderMyWork", sergioContext, SERGIO);
    const aliceMine = renderWith(sandbox, "renderMyWork", aliceContext, ALICE);
    const sergioTeam = renderWith(sandbox, "renderTeamWork", sergioContext, SERGIO);
    const aliceTeam = renderWith(sandbox, "renderTeamWork", aliceContext, ALICE);
    // An agent-bound caller sees only that agent's assignment and never
    // acquires the owning human's other work.
    const agentMine = renderWith(sandbox, "renderMyWork", sergioContext, {
      actorId: FIXTURE.agents.codexSergio,
      actorType: "agent",
    });

    // My work differs exactly where the service says it differs.
    expect(sergioMine).toContain(sergioOpen.id);
    expect(sergioMine).toContain(sergioBlocked.id);
    expect(sergioMine).toContain(codexTask.id);
    expect(sergioMine).not.toContain(aliceOpen.id);
    expect(sergioMine).not.toContain(opencodeTask.id);
    expect(sergioMine).not.toContain(unassignedTask.id);
    expect(sergioMine).toContain("Codex");
    expect(sergioMine).toContain("owned by you");
    expect(sergioMine).toContain("harness codex");

    expect(agentMine).toContain(codexTask.id);
    expect(agentMine).toContain("Viewer bound to agent Codex");
    expect(agentMine).not.toContain(sergioOpen.id);
    expect(agentMine).not.toContain(sergioBlocked.id);
    expect(agentMine).not.toContain("owned by you");

    expect(aliceMine).toContain(aliceOpen.id);
    expect(aliceMine).toContain(opencodeTask.id);
    expect(aliceMine).not.toContain(sergioOpen.id);
    expect(aliceMine).not.toContain(sergioBlocked.id);
    expect(aliceMine).not.toContain(codexTask.id);

    // An agent with no recorded owner is never treated as the caller's, and
    // never acquires its task.
    expect(sergioMine).not.toContain("ProbeUnowned");
    expect(sergioMine).not.toContain("ProbeGhost");
    expect(sergioMine).not.toContain(unownedTask.id);
    expect(sergioMine).not.toContain(ghostTask.id);

    // Team work carries the shared facts for both actors, identically.
    expect(sergioTeam).toBe(aliceTeam);
    for (const id of [
      sergioOpen.id,
      sergioBlocked.id,
      aliceOpen.id,
      codexTask.id,
      opencodeTask.id,
      unownedTask.id,
      ghostTask.id,
      unassignedTask.id,
      "task_swh_probe_foreign",
    ]) {
      expect(sergioTeam, id).toContain(id);
    }
    expect(sergioTeam).toContain("Unowned agents (ownership unknown)");
    expect(sergioTeam).toContain("ProbeUnowned (agent · codex) — ownership unknown");
    expect(sergioTeam).toContain(`recorded owner ${ghostOwnerId} is not a participant (unresolvable)`);
    expect(sergioTeam).toContain(`${foreignActorId} — (name not recorded)`);
    expect(sergioTeam).toContain("Unassigned");
    expect(sergioTeam).toContain(`owned by Sergio`);
    expect(sergioTeam).toContain(`owned by Alice`);
    // The unowned agent is never attributed to a human owner.
    expect(sergioTeam).not.toMatch(/ProbeUnowned[^<]*owned by/);

    // Needs You follows the service projection and differs per actor.
    sandbox.context = sergioContext;
    const sergioNeedsYouIds = evalIn<Array<{ id: string; reason: string }>>(sandbox, "deriveNeedsYou(context)").map(
      (item) => item.id,
    );
    sandbox.context = aliceContext;
    const aliceNeedsYouIds = evalIn<Array<{ id: string; reason: string }>>(sandbox, "deriveNeedsYou(context)").map(
      (item) => item.id,
    );
    expect(sergioNeedsYouIds).toContain(sergioOpen.id);
    expect(sergioNeedsYouIds).toContain(sergioBlocked.id);
    expect(sergioNeedsYouIds).not.toContain(aliceOpen.id);
    expect(aliceNeedsYouIds).toContain(aliceOpen.id);
    expect(aliceNeedsYouIds).not.toContain(sergioOpen.id);
    expect(sergioNeedsYouIds).not.toEqual(aliceNeedsYouIds);

    const sergioNeedsYouHtml = renderAttention(sandbox, sergioContext.needsYou);
    expect(sergioNeedsYouHtml).toContain(sergioOpen.id);
    expect(sergioNeedsYouHtml).toContain("assigned_open_task");
    expect(sergioNeedsYouHtml).not.toContain(aliceOpen.id);
  });
});

describe("SWH-001 D3 — source parity", () => {
  it("renders statuses, reasons, ids, labels, and completeness exactly as served, in both perspectives", async () => {
    const workspaceId = FIXTURE.workspaces.billing;
    const sergioCtx = ctxFor(SERGIO);
    const viewer = await startViewer(SERGIO);

    const tProgress = runtime.service.createTask(sergioCtx, {
      workspaceId,
      title: "In progress probe",
      assignee: { actorId: FIXTURE.agents.codexSergio, actorType: "agent" },
    });
    runtime.service.updateTask(sergioCtx, { taskId: tProgress.id, status: "in_progress" });
    const tBlocked = runtime.service.createTask(sergioCtx, { workspaceId, title: "Blocked probe", assignee: SERGIO });
    runtime.service.updateTask(sergioCtx, { taskId: tBlocked.id, status: "blocked" });
    runtime.service.createTask(sergioCtx, { workspaceId, title: "Extra open probe" });

    const art1 = runtime.service.addArtifact(sergioCtx, {
      workspaceId,
      type: "log",
      title: "Probe log",
      uriOrPath: "s3://campfire-probe/run.log",
    });
    runtime.service.addArtifact(sergioCtx, {
      workspaceId,
      type: "document",
      title: "Probe document",
      uriOrPath: "docs/probe.md",
    });
    runtime.service.addArtifact(sergioCtx, {
      workspaceId,
      type: "report",
      title: "Probe report",
      uriOrPath: "reports/probe.html",
    });

    const f1 = runtime.service.addFinding(sergioCtx, { workspaceId, summary: "Probe finding one", detail: "one" });
    runtime.service.citeFindingEvidence(sergioCtx, {
      findingId: f1.id,
      artifactId: art1.id,
      relation: "supports",
    });
    runtime.service.addFinding(sergioCtx, { workspaceId, summary: "Probe finding two" });
    runtime.service.addFinding(sergioCtx, { workspaceId, summary: "Probe finding three" });

    const dAccepted = runtime.service.addDecision(sergioCtx, { workspaceId, summary: "Probe accepted rule" });
    runtime.service.acceptDecision(sergioCtx, dAccepted.id);
    const dProposed = runtime.service.addDecision(sergioCtx, { workspaceId, summary: "Probe proposed rule" });
    const dReplacement = runtime.service.addDecision(sergioCtx, {
      workspaceId,
      summary: "Probe replacement rule",
      replacesDecisionId: dAccepted.id,
    });
    runtime.service.acceptDecision(sergioCtx, dReplacement.id, { reason: "the probe rule replaces the old one" });
    const fStale = runtime.service.addFinding(sergioCtx, { workspaceId, summary: "Probe stale finding" });
    runtime.service.citeDecisionBasis(sergioCtx, { decisionId: dReplacement.id, findingId: fStale.id });
    runtime.service.withdrawFinding(sergioCtx, { findingId: fStale.id, reason: "probe data was stale" });

    // A bounded read: the truncation is served by the service, not simulated.
    const read = await call(viewer.url, "get_workspace_context", {
      workspaceId,
      budget: { tasks: 2, findings: 2, artifacts: 2 },
    });
    expect(read.body.ok).toBe(true);
    if (!read.body.ok) return;
    const context = read.body.result;
    expect(context.slices.tasks.truncated).toBe(true);
    expect(context.slices.findings.truncated).toBe(true);
    expect(context.slices.artifacts.truncated).toBe(true);

    const sandbox = loadAppSandbox().sandbox;
    const myHtml = renderWith(sandbox, "renderMyWork", context, SERGIO);
    const teamHtml = renderWith(sandbox, "renderTeamWork", context, SERGIO);
    const sourcesHtml = renderWith(sandbox, "renderSources", context);

    // Tasks: every served row is displayed with its stored status and id, and
    // no task id that was not served appears.
    const servedTasks = new Map<
      string,
      { status: string; assignee?: { actorId: string; actorType: string } }
    >();
    for (const task of [
      ...context.openTasks,
      ...context.currentWork.inProgressTasks,
      ...context.currentWork.blockedTasks,
    ]) {
      servedTasks.set(task.id, task);
    }
    expect(servedTasks.size).toBeGreaterThan(0);
    for (const [id, task] of servedTasks) {
      expect(teamHtml, id).toContain(id);
      expect(teamHtml, id).toContain(task.status);
      if (task.assignee) {
        // The recorded assignee identity is preserved, not summarized away.
        expect(teamHtml, id).toContain(task.assignee.actorId);
      }
    }
    const shownTaskIds = new Set(teamHtml.match(/task_[a-z0-9_]+/g) ?? []);
    for (const id of shownTaskIds) {
      expect(servedTasks.has(id), `unserved task id rendered: ${id}`).toBe(true);
    }

    // Attention: reason, source id, and status come from the projection.
    for (const item of [...context.needsYou, ...context.needsAttention]) {
      sandbox.item = item;
      const row = evalIn<string>(sandbox, "attentionItemHtml(item)");
      expect(row).toContain(item.id);
      expect(row).toContain(item.reason);
      expect(row).toContain(item.status);
      expect(row).toContain(item.summary);
    }
    sandbox.context = context;
    expect(evalIn<Array<{ id: string }>>(sandbox, "deriveNeedsYou(context)").map((item) => item.id)).toEqual(
      context.needsYou.map((item: { id: string }) => item.id),
    );
    expect(evalIn<Array<{ id: string }>>(sandbox, "deriveNeedsAttention(context)").map((item) => item.id)).toEqual(
      context.needsAttention.map((item: { id: string }) => item.id),
    );

    // Findings and artifacts: ids, evidence relations, and inert references.
    for (const finding of context.slices.findings.items) {
      expect(sourcesHtml, finding.id).toContain(finding.id);
      expect(sourcesHtml, finding.id).toContain(finding.summary);
      for (const evidence of finding.evidence ?? []) {
        expect(sourcesHtml).toContain(evidence.artifactId);
        expect(sourcesHtml).toContain(evidence.relation);
      }
    }
    for (const artifact of context.slices.artifacts.items) {
      expect(sourcesHtml, artifact.id).toContain(artifact.id);
      expect(sourcesHtml, artifact.id).toContain(artifact.title);
      expect(sourcesHtml, artifact.id).toContain(artifact.type);
      expect(sourcesHtml).toContain(artifact.uriOrPath);
    }
    expect(sourcesHtml).toContain("(stored reference, not fetched)");

    // Decisions: labels and recorded links survive in both perspectives.
    for (const html of [myHtml, teamHtml]) {
      expect(html).toContain("accepted decisions");
      expect(html).toContain("accepted decisions needing review");
      expect(html).toContain("needs review");
      expect(html).toContain(`cites non-current finding ${fStale.id}`);
      expect(html).toContain("proposed decisions — not accepted, not permission to act");
      expect(html).toContain(dProposed.summary);
      expect(html).toContain(dReplacement.summary);
      expect(html).toContain(`replaces ${dAccepted.id}`);
      expect(html).toContain(
        `Historical: ${context.historicalCounts.decisions} superseded decisions / ${context.historicalCounts.findings} corrected findings recorded`,
      );
    }
    expect(context.historicalCounts.decisions).toBe(1);
    expect(context.historicalCounts.findings).toBe(1);

    // Completeness counts match the served slices, and truncation stays open
    // in both perspectives.
    for (const html of [myHtml, teamHtml]) {
      expect(html).toContain(`showing ${context.slices.tasks.returned} of ${context.slices.tasks.total}`);
      expect(html).toContain("more available");
      expect(html).toContain(`showing ${context.slices.decisions.returned} of ${context.slices.decisions.total}`);
    }
    expect(sourcesHtml).toContain(`showing ${context.slices.findings.returned} of ${context.slices.findings.total}`);
    expect(sourcesHtml).toContain(`showing ${context.slices.artifacts.returned} of ${context.slices.artifacts.total}`);
    expect(sourcesHtml).toContain("more available");

    // A filtered group with no returned row speaks in incomplete terms; it
    // never claims the workspace has none.
    expect(teamHtml).toContain(
      `no matching tasks in the returned ${context.slices.tasks.returned} of ${context.slices.tasks.total}; more may exist`,
    );
    expect(teamHtml).not.toContain("none in workspace");

    // Orientation prose is not a write form. A row button only selects a record.
    for (const html of [myHtml, teamHtml, sourcesHtml]) {
      expect(html).not.toContain("<input");
      expect(html).not.toContain("<form");
      expect(html).not.toMatch(/type="submit"|<textarea/i);
      expect(html).not.toContain("<a ");
      expect(html).not.toContain("href=");
    }
  });
});

describe("SWH-001 D4 — read boundary", () => {
  it("keeps the NAV-003 read allowlist, writes nothing, and holds no browser token", async () => {
    const viewer = await startViewer(SERGIO);

    expect([...VIEWER_READ_METHODS]).toEqual([
      "whoami",
      "list_workspaces",
      "get_workspace",
      "get_workspace_context",
      "get_activity",
      "list_tasks",
      "list_workspace_participants",
      "get_task",
      "get_decision",
      "get_finding",
      "get_artifact",
      "get_record_history",
    ]);

    const before = runtime.store.countObjects("contributions", FIXTURE.workspaces.billing);
    const shell = await fetch(`${viewer.url}/`);
    expect(shell.status).toBe(200);
    expect(await shell.text()).toContain("Workstream");
    const client = await fetch(`${viewer.url}/app.js`);
    expect(client.status).toBe(200);
    expect(await client.text()).toContain(
      "No workspace to show yet. After your agent has the Campfire tools loaded, describe the work you want to do; your agent can create the workspace and goal.",
    );

    const reads: Array<[string, Record<string, unknown>]> = [
      ["whoami", {}],
      ["list_workspaces", {}],
      ["get_workspace", { workspaceId: FIXTURE.workspaces.billing }],
      ["get_workspace_context", { workspaceId: FIXTURE.workspaces.billing }],
      ["get_activity", { workspaceId: FIXTURE.workspaces.billing, limit: 10 }],
    ];
    for (const [method, params] of reads) {
      const result = await call(viewer.url, method, params);
      expect(result.status, method).toBe(200);
      expect(result.body.ok, method).toBe(true);
    }
    // Viewing is not a Contribution; the store did not change.
    expect(runtime.store.countObjects("contributions", FIXTURE.workspaces.billing)).toBe(before);

    const write = await call(viewer.url, "add_finding", {
      workspaceId: FIXTURE.workspaces.billing,
      summary: "the viewer must never write",
    });
    expect(write.status).toBe(403);
    expect(write.body.ok).toBe(false);
    if (write.body.ok) return;
    expect(write.body.error).toBe("Unauthorized");
    expect(write.body.message).toBe("Viewer is read-only");
    expect(runtime.store.countObjects("contributions", FIXTURE.workspaces.billing)).toBe(before);

    // The browser never carries a token, and the client calls only allowlisted
    // methods.
    expect(APP_JS).not.toMatch(/Authorization/);
    const methods = [...APP_JS.matchAll(/api\("([a-z_]+)"/g)].map((match) => match[1]!);
    expect(methods.length).toBeGreaterThan(0);
    for (const method of methods) {
      expect(VIEWER_READ_METHODS as readonly string[]).toContain(method);
    }
  });
});

describe("SWH-001 D5 — hostile text and reference", () => {
  it("renders markup as inert text, never links or fetches a reference, and keeps the Host boundary", async () => {
    const sandbox = loadAppSandbox().sandbox;
    const hostile = '<img src=x onerror=alert(1)>';
    const context = {
      participants: [
        {
          actor: { actorId: "hum_probe", actorType: "human" },
          name: `<script>alert(1)</script>`,
          role: "member",
          joinedAt: "2026-10-13T09:00:00.000Z",
        },
      ],
      openTasks: [
        {
          id: "task_probe_hostile",
          title: hostile,
          status: "open",
          assignee: { actorId: "hum_probe", actorType: "human" },
        },
      ],
      currentWork: {
        inProgressTasks: [],
        blockedTasks: [],
        acceptedDecisions: [
          {
            id: "dec_probe_hostile",
            status: "accepted",
            summary: "<b>accepted proposal</b>",
            needsReview: true,
            needsReviewFindingIds: ["<i>find_probe_hostile</i>"],
          },
        ],
      },
      proposedDecisions: [{ id: "dec_probe_proposed", status: "proposed", summary: `<script>x</script>` }],
      supersededDecisions: [{ id: "dec_probe_old", status: "superseded", summary: "<img src=y>" }],
      historicalCounts: { findings: 1, decisions: 1 },
      slices: {
        tasks: { total: 1, returned: 1, truncated: false },
        decisions: { total: 2, returned: 2, truncated: false },
        findings: {
          items: [
            {
              id: "find_probe_hostile",
              summary: `<script>finding</script>`,
              currentness: "current",
              evidence: [{ artifactId: "art_probe_hostile", relation: "supports" }],
            },
          ],
          total: 1,
          returned: 1,
          truncated: false,
        },
        artifacts: {
          items: [
            {
              id: "art_probe_hostile",
              type: "file",
              title: hostile,
              uriOrPath: "javascript:alert(document.domain)",
            },
          ],
          total: 1,
          returned: 1,
          truncated: false,
        },
      },
    };

    const html = [
      renderWith(sandbox, "renderMyWork", context, { actorId: "hum_probe", actorType: "human" }),
      renderWith(sandbox, "renderTeamWork", context, { actorId: "hum_probe", actorType: "human" }),
      renderWith(sandbox, "renderSources", context),
    ].join("\n");

    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<b>");
    expect(html).not.toMatch(/<[a-z][^>]*\sonerror=/i);
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain("href=");
    expect(html).not.toContain("<a ");
    // The hostile text is present, escaped, so nothing was silently dropped.
    expect(html).toContain("&lt;img");
    expect(html).toContain("&lt;script");
    expect(html).toContain("supports");
    expect(html).toContain("(stored reference, not fetched)");

    sandbox.item = {
      kind: "task",
      id: "<i>task_probe</i>",
      summary: "<script>cue</script>",
      status: "blocked",
      reason: "<b>reason</b>",
    };
    const attentionRow = evalIn<string>(sandbox, "attentionItemHtml(item)");
    expect(attentionRow).not.toContain("<script");
    expect(attentionRow).not.toContain("<b>reason");
    expect(attentionRow).toContain("&lt;script");

    const viewer = await startViewer(SERGIO);
    const badHost = await rawRequest({ port: viewer.port, path: "/", host: "attacker.example" });
    expect(badHost.status).toBe(403);
    expect(badHost.text).not.toContain("Campfire");
    const badHostApi = await rawRequest({ port: viewer.port, path: "/app.js", host: "attacker.example" });
    expect(badHostApi.status).toBe(403);
  });
});

describe("SWH-001 D6 — accessibility and compatibility", () => {
  it("exposes both perspectives by keyboard with non-color state and keeps the journal", () => {
    expect(INDEX_HTML).toContain('id="perspective"');
    expect(INDEX_HTML).toContain('aria-label="Perspectives"');
    expect(INDEX_HTML).toContain('id="perspective-mine"');
    expect(INDEX_HTML).toContain('id="perspective-team"');
    expect(INDEX_HTML).toContain('data-perspective="mine"');
    expect(INDEX_HTML).toMatch(/id="perspective-mine"[^>]*aria-pressed="true"[^>]*>My work</);
    expect(INDEX_HTML).toMatch(/id="perspective-team"[^>]*aria-pressed="false"[^>]*>Team work</);
    expect(INDEX_HTML).toContain('id="mast"');
    expect(INDEX_HTML).toContain("Workstream");
    expect(INDEX_HTML).toContain("Campfire");
    expect(INDEX_HTML).toContain('id="current-work-title"');
    expect(INDEX_HTML).toContain("p perspective");

    expect(APP_CSS).toContain(".perspective-btn:focus-visible");
    const selected = APP_CSS.slice(APP_CSS.indexOf('.perspective-btn[aria-pressed="true"]'));
    const selectedRule = selected.slice(0, selected.indexOf("}"));
    expect(selectedRule).toMatch(/font-weight|text-decoration|border/);

    const { sandbox, listeners } = loadAppSandbox();
    expect(evalIn(sandbox, "state.perspective")).toBe("mine");
    expect(evalIn(sandbox, "perspectiveLabel('mine')")).toBe("My work");
    expect(evalIn(sandbox, "perspectiveLabel('team')")).toBe("Team work");

    evalIn(
      sandbox,
      `els.perspectiveMine = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
       els.perspectiveTeam = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
       els.orientation = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
       els.currentWorkTitle = { textContent: "" };
       setPerspective("team");
       state.perspective;`,
    );
    expect(evalIn<string>(sandbox, 'els.perspectiveMine.attrs["aria-pressed"]')).toBe("false");
    expect(evalIn<string>(sandbox, 'els.perspectiveTeam.attrs["aria-pressed"]')).toBe("true");
    expect(evalIn<string>(sandbox, 'els.orientation.attrs["data-perspective"]')).toBe("team");
    expect(evalIn<string>(sandbox, "els.currentWorkTitle.textContent")).toBe("Team work");
    evalIn(sandbox, 'setPerspective("mine")');
    expect(evalIn(sandbox, "state.perspective")).toBe("mine");

    // The p shortcut toggles, and stays out of text fields.
    const keydown = listeners.keydown?.[0];
    expect(typeof keydown).toBe("function");
    const press = (key: string, tag: string) =>
      keydown?.({
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        key,
        target: { tagName: tag },
        preventDefault: () => {},
      });
    press("p", "BODY");
    expect(evalIn(sandbox, "state.perspective")).toBe("team");
    press("p", "SELECT");
    expect(evalIn(sandbox, "state.perspective")).toBe("team");
    press("P", "BODY");
    expect(evalIn(sandbox, "state.perspective")).toBe("mine");
    // Enter on a native button is left to the button itself.
    evalIn(sandbox, "state.selectedId = null; state.expandedId = null;");
    press("Enter", "BUTTON");
    expect(evalIn(sandbox, "state.expandedId")).toBe(null);
    press("Enter", "BODY");
    expect(evalIn(sandbox, "state.expandedId")).toBe(null);

    // Keyboard shortcuts still work (j/k selection over the visible rows).
    evalIn(
      sandbox,
      `state.activity = { items: [
         { id: "c1", action: "create", objectType: "finding", objectId: "f1", payload: { summary: "one" }, actor: { actorId: "a1" } },
         { id: "c2", action: "create", objectType: "finding", objectId: "f2", payload: { summary: "two" }, actor: { actorId: "a1" } },
       ] };
       state.selectedId = null;`,
    );
    evalIn(sandbox, "moveSelection(1)");
    expect(evalIn(sandbox, "state.selectedId")).toBe("c1");

    // Task and decision labels carry text statuses and the review marker.
    const context = {
      participants: [
        {
          actor: { actorId: "hum_probe", actorType: "human" },
          name: "Probe",
          role: "owner",
          joinedAt: "2026-10-13T09:00:00.000Z",
        },
      ],
      openTasks: [
        { id: "task_p1", title: "Open p", status: "open", assignee: { actorId: "hum_probe", actorType: "human" } },
        {
          id: "task_p2",
          title: "Progress p",
          status: "in_progress",
          assignee: { actorId: "hum_probe", actorType: "human" },
        },
        { id: "task_p3", title: "Blocked p", status: "blocked", assignee: { actorId: "hum_probe", actorType: "human" } },
      ],
      currentWork: {
        inProgressTasks: [],
        blockedTasks: [],
        acceptedDecisions: [
          { id: "dec_p1", status: "accepted", summary: "Needs a look", needsReview: true, needsReviewFindingIds: ["f9"] },
        ],
      },
      proposedDecisions: [{ id: "dec_p2", status: "proposed", summary: "Proposal p" }],
      historicalCounts: { findings: 0, decisions: 0 },
      slices: { tasks: { total: 3, returned: 3, truncated: false } },
    };
    const labels = renderWith(sandbox, "renderMyWork", context, { actorId: "hum_probe", actorType: "human" });
    expect(labels).toContain("in_progress");
    expect(labels).toContain("blocked");
    expect(labels).toContain("open");
    expect(labels).toContain("needs review");
    expect(labels).toContain('aria-label="accepted decision needing review"');
    expect(labels).toContain("proposed");

    // The journal renderer still exists and runs.
    evalIn(
      sandbox,
      `els.stream = { innerHTML: "", scrollTop: 0, scrollHeight: 0, clientHeight: 0, querySelector: () => null };
       state.workspaces = [{ id: "ws_probe", name: "Probe" }];
       state.activity = { items: [
         { id: "c9", action: "create", objectType: "finding", objectId: "f9",
           payload: { summary: "journal still renders" },
           actor: { actorId: "hum_probe", actorType: "human" },
           createdAt: "2026-10-13T10:00:00.000Z" },
       ], total: 1, truncated: false };
       renderStream();
       els.stream.innerHTML;`,
    );
    expect(evalIn<string>(sandbox, "els.stream.innerHTML")).toContain("journal still renders");
  });
});

describe("SWH-001 D7 — bounded work", () => {
  it("renders truncated work honestly without fetching and adds no method, poll, or loop", () => {
    const { sandbox, fetchCalls } = loadAppSandbox();
    const context = {
      participants: [
        {
          actor: { actorId: "hum_probe", actorType: "human" },
          name: "Probe",
          role: "owner",
          joinedAt: "2026-10-13T09:00:00.000Z",
        },
        {
          actor: { actorId: "agt_probe", actorType: "agent" },
          name: "ProbeAgent",
          role: "agent",
          harness: "codex",
          joinedAt: "2026-10-13T09:00:01.000Z",
        },
      ],
      openTasks: [
        { id: "task_t1", title: "First returned", status: "open", assignee: { actorId: "hum_probe", actorType: "human" } },
        { id: "task_t2", title: "Second returned", status: "open" },
      ],
      currentWork: { inProgressTasks: [], blockedTasks: [], acceptedDecisions: [] },
      proposedDecisions: [],
      supersededDecisions: [],
      historicalCounts: { findings: 0, decisions: 0 },
      slices: {
        tasks: { total: 21, returned: 2, truncated: true },
        decisions: { total: 4, returned: 4, truncated: false },
        findings: { total: 3, returned: 3, truncated: false },
        artifacts: { total: 3, returned: 3, truncated: false },
      },
    };
    const who = { actorId: "hum_probe", actorType: "human" };
    const myHtml = renderWith(sandbox, "renderMyWork", context, who);
    const teamHtml = renderWith(sandbox, "renderTeamWork", context, who);
    const sourcesHtml = renderWith(sandbox, "renderSources", context);

    for (const html of [myHtml, teamHtml]) {
      expect(html).toContain("showing 2 of 21");
      expect(html).toContain("more available");
    }
    // The unassigned group has no returned row in a truncated slice.
    expect(teamHtml).toContain("no matching tasks in the returned 2 of 21; more may exist");
    expect(sourcesHtml).toContain("none");

    // The renderers ran in a sandbox where fetch throws: no transport was used.
    expect(fetchCalls()).toBe(0);
    evalIn(sandbox, 'setPerspective("team")');
    evalIn(sandbox, 'setPerspective("mine")');
    expect(fetchCalls()).toBe(0);

    // Every client call is one of the allowlisted reads.
    const methods = new Set([...APP_JS.matchAll(/api\("([a-z_]+)"/g)].map((match) => match[1]!));
    expect([...methods].every((method) => (VIEWER_READ_METHODS as readonly string[]).includes(method))).toBe(true);

    // No new polling loop: boot() still owns the single interval.
    expect((APP_JS.match(/setInterval\(/g) ?? []).length).toBe(1);
  });
});

/**
 * SWH-001 home wiring — the glue the D1–D7 renderer checks leave untested:
 * state.whoami -> callerRef -> My work, and state.perspective -> renderer
 * choice. Both are driven through the explicit renderOrientation(homeEls,
 * homeState) seam with a synthetic authorized context; no DOM, no network.
 */
describe("SWH-001 home wiring", () => {
  // One shared synthetic context. W1 and W2 render from this exact object, so
  // any "same shared facts" difference can only come from the perspective.
  const context = {
    participants: [
      {
        actor: { actorId: "hum_a", actorType: "human" },
        name: "Avery",
        role: "owner",
        joinedAt: "2026-10-13T09:00:00.000Z",
      },
      {
        actor: { actorId: "hum_b", actorType: "human" },
        name: "Blair",
        role: "member",
        joinedAt: "2026-10-13T09:00:01.000Z",
      },
      {
        actor: { actorId: "agt_a", actorType: "agent" },
        name: "AgentA",
        role: "agent",
        harness: "codex",
        humanOwnerId: "hum_a",
        joinedAt: "2026-10-13T09:00:02.000Z",
      },
      {
        actor: { actorId: "agt_b", actorType: "agent" },
        name: "AgentB",
        role: "agent",
        harness: "opencode",
        humanOwnerId: "hum_b",
        joinedAt: "2026-10-13T09:00:03.000Z",
      },
      {
        actor: { actorId: "agt_free", actorType: "agent" },
        name: "AgentFree",
        role: "agent",
        harness: "claude-code",
        joinedAt: "2026-10-13T09:00:04.000Z",
      },
    ],
    openTasks: [
      {
        id: "task_home_hum_a",
        title: "Avery owns this",
        status: "open",
        assignee: { actorId: "hum_a", actorType: "human" },
        createdAt: "2026-10-13T09:01:00.000Z",
        updatedAt: "2026-10-13T09:01:00.000Z",
      },
      {
        id: "task_home_agt_a",
        title: "AgentA is on this",
        status: "in_progress",
        assignee: { actorId: "agt_a", actorType: "agent" },
        createdAt: "2026-10-13T09:01:01.000Z",
        updatedAt: "2026-10-13T09:01:01.000Z",
      },
      {
        id: "task_home_hum_b",
        title: "Blair owns this",
        status: "open",
        assignee: { actorId: "hum_b", actorType: "human" },
        createdAt: "2026-10-13T09:01:02.000Z",
        updatedAt: "2026-10-13T09:01:02.000Z",
      },
      {
        id: "task_home_unassigned",
        title: "Nobody owns this",
        status: "blocked",
        createdAt: "2026-10-13T09:01:03.000Z",
        updatedAt: "2026-10-13T09:01:03.000Z",
      },
      {
        id: "task_home_done",
        title: "Already finished",
        status: "completed",
        assignee: { actorId: "hum_a", actorType: "human" },
        createdAt: "2026-10-13T09:01:04.000Z",
        updatedAt: "2026-10-13T09:01:04.000Z",
      },
    ],
    currentWork: { inProgressTasks: [], blockedTasks: [], acceptedDecisions: [] },
    needsYou: [
      {
        kind: "task",
        id: "task_home_hum_a",
        summary: "Avery owns this",
        status: "open",
        reason: "assigned_open_task",
      },
    ],
    needsAttention: [
      {
        kind: "task",
        id: "task_home_unassigned",
        summary: "Nobody owns this",
        status: "blocked",
        reason: "unassigned_blocked_task",
      },
    ],
    proposedDecisions: [],
    supersededDecisions: [],
    historicalCounts: { findings: 0, decisions: 0 },
    slices: { tasks: { total: 5, returned: 5, truncated: false } },
  };

  function homeEls() {
    const make = () => ({ innerHTML: "", textContent: "", hidden: false });
    return {
      recordNotes: make(),
      alignment: make(),
      needsYou: make(),
      needsAttention: make(),
      currentWork: make(),
      sources: make(),
      since: make(),
      nextAction: make(),
    };
  }

  /** Drive renderOrientation through the seam with a fixed whoami. */
  function renderHome(
    sandbox: Record<string, unknown>,
    perspective: string,
  ): { currentWork: string; needsYou: string; needsAttention: string } {
    sandbox.fakeEls = homeEls();
    sandbox.fakeState = {
      whoami: { actor: { actorId: "hum_a", actorType: "human" } },
      perspective,
      context,
      sinceView: null,
    };
    evalIn(sandbox, "renderOrientation(fakeEls, fakeState)");
    return {
      currentWork: evalIn<string>(sandbox, "fakeEls.currentWork.innerHTML"),
      needsYou: evalIn<string>(sandbox, "fakeEls.needsYou.innerHTML"),
      needsAttention: evalIn<string>(sandbox, "fakeEls.needsAttention.innerHTML"),
    };
  }

  it("W1 whoami drives My work: the caller's tasks and owned agent only", () => {
    const sandbox = loadAppSandbox().sandbox;
    const { currentWork, needsYou, needsAttention } = renderHome(sandbox, "mine");

    // The caller's own assignment and the caller's owned agent's assignment.
    expect(currentWork).toContain("Avery owns this");
    expect(currentWork).toContain("AgentA is on this");
    // Not another human's task, not the unassigned task, not the completed one.
    expect(currentWork).not.toContain("Blair owns this");
    expect(currentWork).not.toContain("Nobody owns this");
    expect(currentWork).not.toContain("Already finished");
    // The owned-agent section names hum_a's agent and only hum_a's.
    expect(currentWork).toContain("AgentA · harness codex · owned by you");
    expect(currentWork).not.toContain("AgentB");
    // Team-only groups do not leak into My work.
    expect(currentWork).not.toContain('class="ogroup-label">Unassigned<');
    expect(currentWork).not.toContain("Unowned agents (ownership unknown)");
    // The caller's attention cue keeps its service reason and source id.
    expect(needsYou).toContain("assigned_open_task");
    expect(needsYou).toContain("task_home_hum_a");
    expect(needsAttention).toContain("unassigned_blocked_task");
    expect(needsAttention).toContain("task_home_unassigned");
  });

  it("W2 perspective drives the renderer: Team work shows the same context's shared facts", () => {
    const sandbox = loadAppSandbox().sandbox;
    const { currentWork } = renderHome(sandbox, "team");

    // Every human's and agent's work plus the unassigned task, from the same
    // context object W1 rendered from.
    expect(currentWork).toContain("Avery owns this");
    expect(currentWork).toContain("AgentA is on this");
    expect(currentWork).toContain("Blair owns this");
    expect(currentWork).toContain("Nobody owns this");
    // Team-only groups are present here.
    expect(currentWork).toContain('class="ogroup-label">Unassigned<');
    expect(currentWork).toContain("Unowned agents (ownership unknown)");
    expect(currentWork).toContain("AgentFree");
    // Shared slice completeness comes from the same context.
    expect(currentWork).toContain("showing 5 of 5");
    // Completed work stays historical in both perspectives.
    expect(currentWork).not.toContain("Already finished");
  });

  it("W3 callerRef derives only from the provided whoami and rejects unknown actor types", () => {
    const sandbox = loadAppSandbox().sandbox;

    expect(
      evalIn(sandbox, 'callerRef({ actor: { actorId: "agt_x", actorType: "agent" } })'),
    ).toEqual({ actorId: "agt_x", actorType: "agent" });
    expect(evalIn(sandbox, 'callerRef({ actor: { actorId: "x", actorType: "bogus" } })')).toBe(null);
    expect(evalIn(sandbox, "callerRef(null)")).toBe(null);
    // The no-argument default still reads the current state (render pipeline).
    evalIn(sandbox, 'state.whoami = { actor: { actorId: "hum_default", actorType: "human" } }');
    expect(evalIn(sandbox, "callerRef()")).toEqual({ actorId: "hum_default", actorType: "human" });
  });
});
