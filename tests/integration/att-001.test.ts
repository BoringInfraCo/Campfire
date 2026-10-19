/**
 * ATT-001 — Trustworthy Team Attention deterministic checks D1–D6.
 *
 * Contract: `docs/Campfire-v1.19-ATT-001-Trustworthy-Team-Attention.md` §5.
 *
 * These checks pin the bounded repair on the existing bounded orientation
 * projection and the read-only Viewer: explicit attention coverage derived from
 * the returned task/decision pages, and a team review cue for a returned
 * accepted decision whose existing `needsReview` flag is true. They also prove
 * that authorization, provenance, decision lifecycle, surface parity, the five
 * Viewer read methods, and existing response fields are unchanged.
 *
 * A test pass is implementation evidence, not human comprehension and not a
 * Gate B/C/E/F result.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { runCli } from "../../src/cli/index.js";
import { ParticipantRequired, Unauthorized } from "../../src/domain/errors.js";
import { createCounterIdSource } from "../../src/domain/ids.js";
import type { ActorRef } from "../../src/domain/types.js";
import { createCampfireMcpServer } from "../../src/mcp/tools.js";
import type { ServerIdentity } from "../../src/mcp/context.js";
import type { ActorContext } from "../../src/service/authorization.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import type { AttentionCoverage, CampfireService, WorkspaceContext } from "../../src/service/service.js";
import { openInMemoryStore, openSqliteStore } from "../../src/store/sqlite-store.js";
import type { CampfireStore } from "../../src/store/store.js";
import { createAsyncCampfireService } from "../../src/worker/async-service.js";
import type { AsyncCampfireStore } from "../../src/worker/d1-store.js";
import { VIEWER_READ_METHODS } from "../../src/viewer/server.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_JS = readFileSync(join(HERE, "../../src/viewer/static/app.js"), "utf8");
const INDEX_HTML = readFileSync(join(HERE, "../../src/viewer/static/index.html"), "utf8");

const NOW = "2026-02-01T00:00:00.000Z";

const HUMAN_A: ActorRef = { actorId: "hum_att_a", actorType: "human" };
const HUMAN_B: ActorRef = { actorId: "hum_att_b", actorType: "human" };
const AGENT_A: ActorRef = { actorId: "agt_att_a", actorType: "agent" };
const AGENT_B: ActorRef = { actorId: "agt_att_b", actorType: "agent" };
const VIEWER: ActorRef = { actorId: "hum_att_viewer", actorType: "human" };
const OUTSIDER: ActorRef = { actorId: "hum_att_outsider", actorType: "human" };

const ctxA: ActorContext = { actor: HUMAN_A };
const ctxB: ActorContext = { actor: HUMAN_B };
const ctxViewer: ActorContext = { actor: VIEWER };
const ctxOutsider: ActorContext = { actor: OUTSIDER };
const ctxAgentB: ActorContext = { actor: AGENT_B };

let store: CampfireStore;
let service: CampfireService;
let clockMs = 0;

function nextIso(): string {
  clockMs += 1000;
  return new Date(clockMs).toISOString();
}

interface Seeded {
  workspaceId: string;
  taskBlockedA: string;
  taskOpenA: string;
  taskOpenNoAssignee: string;
  taskBlockedNoAssignee: string;
  taskBlockedAgentB: string;
  findingCurrent: string;
  findingStale: string;
  findingWithdrawn: string;
  decisionAcceptedCurrent: string;
  decisionReviewSuperseded: string;
  decisionReviewWithdrawn: string;
  decisionCompetingA: string;
  decisionCompetingB: string;
  decisionReplaced: string;
  decisionReplacement: string;
  decisionProposed: string;
  sessionB: string;
}

function inviteAndJoin(inviter: ActorContext, joiner: ActorContext, workspaceId: string, role: "member" | "agent" | "viewer"): void {
  service.inviteToWorkspace(inviter, { workspaceId, actor: joiner.actor, role });
  service.joinWorkspace(joiner, { workspaceId });
}

function createHuman(id: string, name: string): void {
  store.createHuman({ id, teamId: "team_att", displayName: name, createdAt: NOW });
}

function baseLab(): { workspaceId: string } {
  store.createOrganization({ id: "org_att", name: "Boring Infra Co.", createdAt: NOW });
  store.createTeam({ id: "team_att", organizationId: "org_att", name: "Engineering", createdAt: NOW });
  createHuman(HUMAN_A.actorId, "Ana");
  createHuman(HUMAN_B.actorId, "Ben");
  createHuman(VIEWER.actorId, "Viewer");
  createHuman(OUTSIDER.actorId, "Outsider");
  store.createAgent({
    id: AGENT_A.actorId,
    teamId: "team_att",
    humanId: HUMAN_A.actorId,
    name: "Codex (Ana)",
    harness: "codex",
    createdAt: NOW,
  });
  store.createAgent({
    id: AGENT_B.actorId,
    teamId: "team_att",
    humanId: HUMAN_B.actorId,
    name: "OpenCode (Ben)",
    harness: "opencode",
    createdAt: NOW,
  });

  const workspace = service.createWorkspace(ctxA, { teamId: "team_att", name: "att-001 lab" });
  service.createGoal(ctxA, { workspaceId: workspace.id, title: "Keep recorded attention truthful" });
  inviteAndJoin(ctxA, ctxB, workspace.id, "member");
  inviteAndJoin(ctxA, { actor: AGENT_A }, workspace.id, "agent");
  inviteAndJoin(ctxA, ctxAgentB, workspace.id, "agent");
  inviteAndJoin(ctxA, ctxViewer, workspace.id, "viewer");
  return { workspaceId: workspace.id };
}

function addTask(workspaceId: string, title: string, assignee?: ActorRef): string {
  const task = service.createTask(ctxA, { workspaceId, title, ...(assignee !== undefined ? { assignee } : {}) });
  return task.id;
}

/** The keyed lab scenario: cues, review decisions, competing/historical decisions. */
function seedLab(): Seeded {
  const { workspaceId } = baseLab();

  const taskBlockedA = addTask(workspaceId, "Blocked task assigned to Ana", HUMAN_A);
  service.updateTask(ctxA, { taskId: taskBlockedA, status: "blocked" });
  const taskOpenA = addTask(workspaceId, "Open task assigned to Ana", HUMAN_A);
  const taskOpenNoAssignee = addTask(workspaceId, "Open task with no recorded assignee");
  const taskBlockedNoAssignee = addTask(workspaceId, "Blocked task with no recorded assignee");
  service.updateTask(ctxA, { taskId: taskBlockedNoAssignee, status: "blocked" });
  const taskBlockedAgentB = addTask(workspaceId, "Blocked task assigned to Ben's agent", AGENT_B);
  service.updateTask(ctxA, { taskId: taskBlockedAgentB, status: "blocked" });

  const stale = service.addFinding(ctxA, { workspaceId, summary: "Superseded sample" });
  const current = service.correctFinding(ctxA, {
    findingId: stale.id,
    summary: "Corrected sample",
    reason: "second sample superseded the first",
  });
  const withdrawn = service.addFinding(ctxA, { workspaceId, summary: "Withdrawn sample" });
  service.withdrawFinding(ctxA, { findingId: withdrawn.id, reason: "sampling error" });

  const acceptedCurrent = service.addDecision(ctxA, { workspaceId, summary: "Use the corrected sample" });
  service.acceptDecision(ctxA, acceptedCurrent.id);
  service.citeDecisionBasis(ctxA, { decisionId: acceptedCurrent.id, findingId: current.id });

  const reviewSuperseded = service.addDecision(ctxA, { workspaceId, summary: "Depend on the superseded sample" });
  service.acceptDecision(ctxA, reviewSuperseded.id);
  service.citeDecisionBasis(ctxA, { decisionId: reviewSuperseded.id, findingId: stale.id });

  const reviewWithdrawn = service.addDecision(ctxA, { workspaceId, summary: "Depend on the withdrawn sample" });
  service.acceptDecision(ctxA, reviewWithdrawn.id);
  service.citeDecisionBasis(ctxA, { decisionId: reviewWithdrawn.id, findingId: withdrawn.id });

  const competingA = service.addDecision(ctxA, { workspaceId, summary: "Adopt plan A", rationale: "cheaper" });
  service.acceptDecision(ctxA, competingA.id);
  const competingB = service.addDecision(ctxA, { workspaceId, summary: "Adopt plan B", rationale: "faster" });
  service.acceptDecision(ctxA, competingB.id);

  const replaced = service.addDecision(ctxA, { workspaceId, summary: "Old recorded rule" });
  service.acceptDecision(ctxA, replaced.id);
  const replacement = service.addDecision(ctxA, {
    workspaceId,
    summary: "Replacement rule",
    replacesDecisionId: replaced.id,
  });
  service.acceptDecision(ctxA, replacement.id, { reason: "replacement recorded with a reason" });

  const proposed = service.addDecision(ctxA, { workspaceId, summary: "Not accepted yet" });

  const sessionB = service.registerAgentSession(ctxAgentB, {
    agentId: AGENT_B.actorId,
    workspaceId,
    harness: "opencode",
  }).id;

  return {
    workspaceId,
    taskBlockedA,
    taskOpenA,
    taskOpenNoAssignee,
    taskBlockedNoAssignee,
    taskBlockedAgentB,
    findingCurrent: current.id,
    findingStale: stale.id,
    findingWithdrawn: withdrawn.id,
    decisionAcceptedCurrent: acceptedCurrent.id,
    decisionReviewSuperseded: reviewSuperseded.id,
    decisionReviewWithdrawn: reviewWithdrawn.id,
    decisionCompetingA: competingA.id,
    decisionCompetingB: competingB.id,
    decisionReplaced: replaced.id,
    decisionReplacement: replacement.id,
    decisionProposed: proposed.id,
    sessionB,
  };
}

beforeEach(() => {
  clockMs = Date.parse(NOW);
  store = openInMemoryStore();
  service = createCampfireService({ store, idSource: createCounterIdSource(), clock: nextIso });
});

afterEach(() => {
  service.close();
});

function context(actor: ActorContext, workspaceId: string): WorkspaceContext {
  return service.getWorkspaceContext(actor, workspaceId);
}

// ---------------------------------------------------------------------------
// Viewer sandbox seam (real app.js text, boot() tail cut, DOM stubbed to null)
// ---------------------------------------------------------------------------

function loadAppSandbox() {
  let fetchCalls = 0;
  const sandbox: Record<string, unknown> = {
    document: { getElementById: () => null, addEventListener: () => {} },
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
  return { sandbox, fetchCalls: () => fetchCalls };
}

function evalIn<T>(sandbox: Record<string, unknown>, expression: string): T {
  return vm.runInContext(expression, sandbox) as T;
}

function renderInto(sandbox: Record<string, unknown>, call: string): string {
  sandbox.el = { innerHTML: "" };
  vm.runInContext(call, sandbox);
  return evalIn<string>(sandbox, "el.innerHTML");
}

function renderWith(sandbox: Record<string, unknown>, fn: string, ...args: unknown[]): string {
  return renderInto(sandbox, `${fn}(el, ${args.map((value) => JSON.stringify(value)).join(", ")})`);
}

/** Drive renderOrientation through the real wiring seam with a fixed whoami. */
function renderHome(
  sandbox: Record<string, unknown>,
  contextValue: WorkspaceContext,
  perspective: string,
): { currentWork: string; needsYou: string; needsAttention: string } {
  const make = () => ({ innerHTML: "", textContent: "", hidden: false });
  sandbox.fakeEls = {
    recordNotes: make(),
    alignment: make(),
    needsYou: make(),
    needsAttention: make(),
    currentWork: make(),
    sources: make(),
    since: make(),
    nextAction: make(),
  };
  sandbox.fakeState = {
    whoami: { actor: { actorId: HUMAN_A.actorId, actorType: "human" } },
    perspective,
    context: contextValue,
    sinceView: null,
  };
  vm.runInContext("renderOrientation(fakeEls, fakeState)", sandbox);
  return {
    currentWork: evalIn<string>(sandbox, "fakeEls.currentWork.innerHTML"),
    needsYou: evalIn<string>(sandbox, "fakeEls.needsYou.innerHTML"),
    needsAttention: evalIn<string>(sandbox, "fakeEls.needsAttention.innerHTML"),
  };
}

// ---------------------------------------------------------------------------
// D1 — coverage truth
// ---------------------------------------------------------------------------

describe("ATT-001 D1 — coverage truth", () => {
  it("derives attentionCoverage from the same task and decision slice values", () => {
    const seeded = seedLab();
    const contextA = context(ctxA, seeded.workspaceId);
    expect(contextA.attentionCoverage.tasks).toEqual({
      total: contextA.slices.tasks.total,
      returned: contextA.slices.tasks.returned,
      truncated: contextA.slices.tasks.truncated,
    });
    expect(contextA.attentionCoverage.decisions).toEqual({
      total: contextA.slices.decisions.total,
      returned: contextA.slices.decisions.returned,
      truncated: contextA.slices.decisions.truncated,
    });
    expect(contextA.attentionCoverage.completeUnderRules).toBe(
      !contextA.slices.tasks.truncated && !contextA.slices.decisions.truncated,
    );
  });

  it("marks complete and truncated page combinations correctly", () => {
    const seeded = seedLab();
    const complete = context(ctxA, seeded.workspaceId);
    expect(complete.slices.tasks.truncated).toBe(false);
    expect(complete.slices.decisions.truncated).toBe(false);
    expect(complete.attentionCoverage.completeUnderRules).toBe(true);

    // Push the task page past its default budget of 20.
    for (let index = 0; index < 16; index += 1) {
      const id = addTask(seeded.workspaceId, `Filler task ${index}`);
      service.updateTask(ctxA, { taskId: id, status: "in_progress" });
      service.updateTask(ctxA, { taskId: id, status: "completed" });
    }
    const truncatedTasks = context(ctxA, seeded.workspaceId);
    expect(truncatedTasks.slices.tasks.returned).toBe(20);
    expect(truncatedTasks.slices.tasks.total).toBeGreaterThan(20);
    expect(truncatedTasks.slices.tasks.truncated).toBe(true);
    expect(truncatedTasks.attentionCoverage.tasks.truncated).toBe(true);
    expect(truncatedTasks.attentionCoverage.decisions.truncated).toBe(false);
    expect(truncatedTasks.attentionCoverage.completeUnderRules).toBe(false);

    // Push the decision page past its default budget of 10.
    for (let index = 0; index < 6; index += 1) {
      const decision = service.addDecision(ctxA, { workspaceId: seeded.workspaceId, summary: `Filler decision ${index}` });
      service.acceptDecision(ctxA, decision.id);
    }
    const both = context(ctxA, seeded.workspaceId);
    expect(both.slices.decisions.returned).toBe(10);
    expect(both.slices.decisions.total).toBeGreaterThan(10);
    expect(both.slices.decisions.truncated).toBe(true);
    expect(both.attentionCoverage.tasks.truncated).toBe(true);
    expect(both.attentionCoverage.decisions.truncated).toBe(true);
    expect(both.attentionCoverage.completeUnderRules).toBe(false);
  });

  it("renders different, qualified empty states for complete and incomplete pages", () => {
    const complete: AttentionCoverage = {
      tasks: { total: 3, returned: 3, truncated: false },
      decisions: { total: 2, returned: 2, truncated: false },
      completeUnderRules: true,
    };
    const incomplete: AttentionCoverage = {
      tasks: { total: 21, returned: 20, truncated: true },
      decisions: { total: 2, returned: 2, truncated: false },
      completeUnderRules: false,
    };
    const { sandbox } = loadAppSandbox();

    const completeEmpty = evalIn<string>(sandbox, `attentionEmptyText(${JSON.stringify(complete)})`);
    expect(completeEmpty).toContain("No recorded attention cues match these rules");
    expect(completeEmpty).toContain("does not mean all work is done");
    expect(completeEmpty).not.toContain("may exist");

    const incompleteEmpty = evalIn<string>(sandbox, `attentionEmptyText(${JSON.stringify(incomplete)})`);
    expect(incompleteEmpty).toContain("returned records");
    expect(incompleteEmpty).toContain("may exist");
    expect(incompleteEmpty).not.toBe(completeEmpty);

    const unknownEmpty = evalIn<string>(sandbox, "attentionEmptyText(undefined)");
    expect(unknownEmpty).toContain("completeness was not reported");
  });

  it("qualifies the rendered attention panels through the real renderOrientation wiring", () => {
    const seeded = seedLab();
    const { sandbox } = loadAppSandbox();

    // Incomplete empty: a truncated task page with no cue for the caller.
    const truncated = service.createWorkspace(ctxA, { teamId: "team_att", name: "att-001 truncated empty" });
    for (let index = 0; index < 21; index += 1) {
      const id = addTask(truncated.id, `Truncated filler ${index}`);
      service.updateTask(ctxA, { taskId: id, status: "in_progress" });
    }
    const contextEmpty = context(ctxA, truncated.id);
    expect(contextEmpty.slices.tasks.truncated).toBe(true);
    expect(contextEmpty.needsYou).toEqual([]);
    expect(contextEmpty.needsAttention).toEqual([]);
    const renderedEmpty = renderHome(sandbox, contextEmpty, "mine");
    expect(renderedEmpty.needsYou).toContain("No cue found in the returned records");
    expect(renderedEmpty.needsYou).toContain("may exist");
    expect(renderedEmpty.needsYou).toContain("Attention coverage:");
    expect(renderedEmpty.needsYou).toContain("20 of 21");
    expect(renderedEmpty.needsYou).not.toContain("caught up");
    expect(renderedEmpty.needsAttention).toContain("Attention coverage:");

    // Ana's nonempty Team work list still carries the coverage qualification and
    // the review cues with their cited non-current finding ids.
    const contextA = context(ctxA, seeded.workspaceId);
    const renderedA = renderHome(sandbox, contextA, "team");
    expect(renderedA.needsAttention).toContain("Attention coverage:");
    expect(renderedA.needsAttention).toContain("5 of 5");
    expect(renderedA.needsAttention).toContain("needs human review");
    expect(renderedA.needsAttention).toContain("non-current citations:");
    expect(renderedA.needsAttention).toContain(seeded.findingStale);
  });

  it("renders a qualified complete-empty state for complete pages through the wiring", () => {
    const { workspaceId } = baseLab();
    const done = addTask(workspaceId, "Completed setup");
    service.updateTask(ctxA, { taskId: done, status: "in_progress" });
    service.updateTask(ctxA, { taskId: done, status: "completed" });
    const finding = service.addFinding(ctxA, { workspaceId, summary: "Current basis" });
    const decision = service.addDecision(ctxA, { workspaceId, summary: "Accepted with current basis" });
    service.acceptDecision(ctxA, decision.id);
    service.citeDecisionBasis(ctxA, { decisionId: decision.id, findingId: finding.id });

    const contextA = context(ctxA, workspaceId);
    expect(contextA.attentionCoverage.completeUnderRules).toBe(true);
    expect(contextA.needsYou).toEqual([]);
    expect(contextA.needsAttention).toEqual([]);
    const { sandbox } = loadAppSandbox();
    const rendered = renderHome(sandbox, contextA, "mine");
    expect(rendered.needsYou).toContain("No recorded attention cues match these rules");
    expect(rendered.needsYou).toContain("does not mean all work is done");
    expect(rendered.needsYou).toContain("Both source pages are complete");
    expect(rendered.needsYou).not.toContain("may exist");
    expect(rendered.needsYou).not.toContain("caught up");
  });

  it("qualifies nonempty lists too and never renders an unqualified all-clear", () => {
    const { sandbox } = loadAppSandbox();
    const truncated: AttentionCoverage = {
      tasks: { total: 21, returned: 20, truncated: true },
      decisions: { total: 12, returned: 10, truncated: true },
      completeUnderRules: false,
    };
    const coverageText = evalIn<string>(sandbox, `attentionCoverageText(${JSON.stringify(truncated)})`);
    expect(coverageText).toContain("20 of 21");
    expect(coverageText).toContain("10 of 12");
    expect(coverageText).toContain("truncated");
    expect(coverageText).toContain("may exist");

    const item = {
      kind: "task",
      id: "task_x",
      summary: "Visible cue",
      status: "blocked",
      reason: "assigned_blocked_task",
    };
    const html = renderWith(sandbox, "renderAttentionList", [item], "empty", coverageText);
    expect(html).toContain("task_x");
    expect(html).toContain("may exist");

    const emptyHtml = renderWith(sandbox, "renderAttentionList", [], evalIn<string>(sandbox, "attentionEmptyText(undefined)"), coverageText);
    expect(emptyHtml).not.toContain("caught up");
    expect(emptyHtml).toContain("may exist");
  });
});

// ---------------------------------------------------------------------------
// D2 — review source fidelity
// ---------------------------------------------------------------------------

describe("ATT-001 D2 — review source fidelity", () => {
  it("adds a team review cue for exactly the returned accepted needsReview decisions", () => {
    const seeded = seedLab();
    const contextA = context(ctxA, seeded.workspaceId);
    const returnedReview = contextA.slices.decisions.items
      .filter((decision) => decision.status === "accepted" && decision.needsReview === true)
      .map((decision) => decision.id)
      .sort();
    expect(returnedReview).toEqual([seeded.decisionReviewSuperseded, seeded.decisionReviewWithdrawn].sort());

    const cues = contextA.needsAttention.filter((item) => item.reason === "accepted_decision_needs_review");
    expect(cues.map((item) => item.id).sort()).toEqual(returnedReview);
    for (const cue of cues) {
      expect(cue.kind).toBe("decision");
      expect(cue.status).toBe("accepted");
      expect(cue.summary).toBeTruthy();
    }
    const supersededCue = cues.find((item) => item.id === seeded.decisionReviewSuperseded);
    expect(supersededCue?.needsReviewFindingIds).toEqual([seeded.findingStale]);
    const withdrawnCue = cues.find((item) => item.id === seeded.decisionReviewWithdrawn);
    expect(withdrawnCue?.needsReviewFindingIds).toEqual([seeded.findingWithdrawn]);

    // The cue is team attention, never the caller's actionable list.
    expect(contextA.needsYou.map((item) => item.id)).not.toContain(seeded.decisionReviewSuperseded);
    // Current-citation, plain accepted, competing, and proposed decisions get no cue.
    const cueIds = cues.map((item) => item.id);
    expect(cueIds).not.toContain(seeded.decisionAcceptedCurrent);
    expect(cueIds).not.toContain(seeded.decisionCompetingA);
    expect(cueIds).not.toContain(seeded.decisionCompetingB);
    expect(cueIds).not.toContain(seeded.decisionProposed);
    // Superseded decisions are not surfaced as a live review cue.
    expect(cueIds).not.toContain(seeded.decisionReplaced);
    expect(contextA.slices.decisions.items.map((item) => item.id)).not.toContain(seeded.decisionReplaced);
  });

  it("does not manufacture a cue for a decision outside the returned page", () => {
    const { workspaceId } = baseLab();
    const trunc = service.createWorkspace(ctxA, { teamId: "team_att", name: "att-001 trunc decisions" });
    // Oldest accepted decision (beyond the 10-row page) carries the only stale citation.
    const beyond = service.addDecision(ctxA, { workspaceId: trunc.id, summary: "Older review decision" });
    service.acceptDecision(ctxA, beyond.id);
    const withdrawn = service.addFinding(ctxA, { workspaceId: trunc.id, summary: "Withdrawn basis" });
    service.withdrawFinding(ctxA, { findingId: withdrawn.id, reason: "sampling error" });
    service.citeDecisionBasis(ctxA, { decisionId: beyond.id, findingId: withdrawn.id });

    for (let index = 0; index < 11; index += 1) {
      const decision = service.addDecision(ctxA, { workspaceId: trunc.id, summary: `Later accepted ${index}` });
      service.acceptDecision(ctxA, decision.id);
    }

    expect(workspaceId).toBeTruthy();
    const contextA = context(ctxA, trunc.id);
    expect(contextA.slices.decisions.truncated).toBe(true);
    expect(contextA.slices.decisions.items.map((decision) => decision.id)).not.toContain(beyond.id);
    const cues = contextA.needsAttention.filter((item) => item.reason === "accepted_decision_needs_review");
    expect(cues).toEqual([]);
    expect(contextA.attentionCoverage.completeUnderRules).toBe(false);
  });

  it("does not surface a proposed decision's stale citation as a review cue", () => {
    const { workspaceId } = baseLab();
    const withdrawn = service.addFinding(ctxA, { workspaceId, summary: "Withdrawn basis" });
    service.withdrawFinding(ctxA, { findingId: withdrawn.id, reason: "sampling error" });
    const proposed = service.addDecision(ctxA, { workspaceId, summary: "Proposed but stale" });
    service.citeDecisionBasis(ctxA, { decisionId: proposed.id, findingId: withdrawn.id });

    const contextA = context(ctxA, workspaceId);
    const item = contextA.slices.decisions.items.find((decision) => decision.id === proposed.id);
    expect(item?.status).toBe("proposed");
    // The read-time decoration exists on the proposal, but the team review cue
    // is reserved for accepted decisions only.
    expect(item?.needsReview).toBe(true);
    expect(contextA.needsAttention.filter((cue) => cue.reason === "accepted_decision_needs_review")).toEqual([]);
    expect(contextA.needsYou.some((cue) => cue.id === proposed.id && cue.reason === "proposed_decision_actionable")).toBe(
      true,
    );
  });

  it("does not elevate the review cue to suggestedNextAction", () => {
    const reviewOnly = seedReviewOnly();
    const reviewOnlyContext = context(ctxA, reviewOnly.workspaceId);
    expect(reviewOnlyContext.needsAttention.map((item) => item.reason)).toEqual(["accepted_decision_needs_review"]);
    expect(reviewOnlyContext.suggestedNextAction).toEqual({
      kind: "none",
      summary: "",
      reason: "none",
      orientationHint: true,
    });
  });

  it("renders the cue with the accepted status, cited non-current finding ids, and a needs-review meaning", () => {
    const { sandbox } = loadAppSandbox();
    const cue = {
      kind: "decision",
      id: "dec_review",
      summary: "Depend on the superseded sample",
      status: "accepted",
      reason: "accepted_decision_needs_review",
      needsReviewFindingIds: ["find_stale", "find_withdrawn"],
    };
    const html = evalIn<string>(sandbox, `attentionItemHtml(${JSON.stringify(cue)})`);
    expect(html).toContain("dec_review");
    expect(html).toContain("accepted");
    expect(html).toContain("needs human review");
    expect(html).toContain("find_stale");
    expect(html).toContain("find_withdrawn");
    // It states a review need, not a lifecycle transition.
    expect(html).not.toMatch(/withdrawn decision|superseded decision|invalid|revoked|replaced/i);
  });
});

// ---------------------------------------------------------------------------
// D3 — authority separation
// ---------------------------------------------------------------------------

describe("ATT-001 D3 — authority separation", () => {
  it("keeps assignment, needsYou, and needsAttention from changing canAct or the write path", () => {
    const seeded = seedLab();
    // The cue for another participant's task is visible before the write.
    const before = context(ctxA, seeded.workspaceId);
    expect(before.needsAttention.some((item) => item.id === seeded.taskBlockedAgentB)).toBe(true);

    // A writing participant takes up the team task; authorization decides, not the cue.
    const updated = service.updateTask({ actor: HUMAN_B }, {
      taskId: seeded.taskBlockedAgentB,
      status: "in_progress",
    });
    expect(updated.status).toBe("in_progress");
    const latest = store.listContributions(seeded.workspaceId).at(-1);
    expect(latest?.actor).toEqual(HUMAN_B);
    expect(latest?.objectId).toBe(seeded.taskBlockedAgentB);
  });

  it("demotes a viewer-assigned blocked task without changing the denied write", () => {
    const { workspaceId } = baseLab();
    const viewerTask = addTask(workspaceId, "Blocked task assigned to the viewer", VIEWER);
    service.updateTask(ctxA, { taskId: viewerTask, status: "blocked" });

    const viewerContext = context(ctxViewer, workspaceId);
    expect(viewerContext.needsYou).toEqual([]);
    const item = viewerContext.needsAttention.find((entry) => entry.id === viewerTask);
    expect(item?.reason).toBe("team_blocked_task");
    expect(item?.assignee).toEqual(VIEWER);
    expect(() => service.updateTask(ctxViewer, { taskId: viewerTask, status: "in_progress" })).toThrow(Unauthorized);
  });

  it("reveals nothing to an unauthorized or wrong-workspace reader", () => {
    const seeded = seedLab();
    const other = service.createWorkspace(ctxA, { teamId: "team_att", name: "att-001 other" });

    expect(() => context(ctxOutsider, seeded.workspaceId)).toThrow(ParticipantRequired);
    // A participant of one workspace cannot read another workspace's records.
    expect(() => context(ctxB, other.id)).toThrow(ParticipantRequired);

    let message = "";
    try {
      context(ctxOutsider, seeded.workspaceId);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toContain("Blocked task assigned to Ben's agent");
    expect(message).not.toContain(seeded.taskBlockedA);
    expect(message).not.toContain("needsAttention");
  });
});

// ---------------------------------------------------------------------------
// D4 — decision safety
// ---------------------------------------------------------------------------

describe("ATT-001 D4 — decision safety", () => {
  it("keeps acceptance, needs-review, proposal, and supersession distinct and picks no operative winner", () => {
    const seeded = seedLab();
    const contextA = context(ctxA, seeded.workspaceId);
    const byId = new Map(contextA.slices.decisions.items.map((decision) => [decision.id, decision]));

    expect(byId.get(seeded.decisionAcceptedCurrent)?.status).toBe("accepted");
    expect(byId.get(seeded.decisionAcceptedCurrent)?.needsReview).toBeUndefined();
    expect(byId.get(seeded.decisionReviewSuperseded)?.status).toBe("accepted");
    expect(byId.get(seeded.decisionReviewSuperseded)?.needsReview).toBe(true);
    expect(byId.get(seeded.decisionProposed)?.status).toBe("proposed");
    expect(byId.get(seeded.decisionCompetingA)?.status).toBe("accepted");
    expect(byId.get(seeded.decisionCompetingB)?.status).toBe("accepted");

    // A recorded replacement keeps the predecessor historical; no cue promotes either rule.
    const replaced = store.getDecision(seeded.decisionReplaced);
    expect(replaced?.status).toBe("superseded");
    expect(replaced?.successorId).toBe(seeded.decisionReplacement);
    const replacement = store.getDecision(seeded.decisionReplacement);
    expect(replacement?.status).toBe("accepted");
    expect(replacement?.predecessorId).toBe(seeded.decisionReplaced);
    expect(contextA.supersededDecisions).toEqual([]);
    expect(contextA.slices.decisions.items.every((decision) => decision.status !== "superseded")).toBe(true);

    // The review cue carries no operative-decision fields and does not reorder the lists.
    for (const cue of contextA.needsAttention.filter((item) => item.reason === "accepted_decision_needs_review")) {
      expect(cue).not.toHaveProperty("predecessorId");
      expect(cue).not.toHaveProperty("successorId");
      expect(cue).not.toHaveProperty("rationale");
      expect(cue.status).toBe("accepted");
    }
    expect(contextA.suggestedNextAction.reason).toBe("proposed_decision_actionable");
  });

  it("leaves the recorded needsReview flag as a read-time decoration, not a lifecycle change", () => {
    const seeded = seedLab();
    const stored = store.getDecision(seeded.decisionReviewSuperseded);
    expect(stored?.status).toBe("accepted");
    const contextA = context(ctxA, seeded.workspaceId);
    const decorated = contextA.slices.decisions.items.find((decision) => decision.id === seeded.decisionReviewSuperseded);
    expect(decorated?.needsReview).toBe(true);
    expect(decorated?.needsReviewFindingIds).toEqual([seeded.findingStale]);
  });
});

// ---------------------------------------------------------------------------
// D5 — surface parity and accessibility
// ---------------------------------------------------------------------------

describe("ATT-001 D5 — surface parity and accessibility", () => {
  function wrapSync(target: CampfireStore): AsyncCampfireStore {
    return new Proxy(target, {
      get(source, prop, receiver) {
        if (prop === "transaction") {
          return (fn: () => Promise<unknown>) => fn();
        }
        const value = Reflect.get(source, prop, receiver) as unknown;
        if (typeof value !== "function") return value;
        return (...args: unknown[]) =>
          Promise.resolve((value as (...a: unknown[]) => unknown).apply(source, args));
      },
    }) as unknown as AsyncCampfireStore;
  }

  it("agrees on source ids, reasons, and coverage across the local and Workers/D1 paths", async () => {
    const seeded = seedLab();
    const asyncService = createAsyncCampfireService({ store: wrapSync(store), idSource: createCounterIdSource(), clock: nextIso });
    const local = context(ctxA, seeded.workspaceId);
    const hosted = await asyncService.getWorkspaceContext(ctxA, seeded.workspaceId);

    expect(hosted.needsYou).toEqual(local.needsYou);
    expect(hosted.needsAttention).toEqual(local.needsAttention);
    expect(hosted.attentionCoverage).toEqual(local.attentionCoverage);
    expect(hosted.suggestedNextAction).toEqual(local.suggestedNextAction);
  });

  it("carries coverage and the review cue through the MCP JSON response", async () => {
    const seeded = seedLab();
    const server = createCampfireMcpServer({ service, identity: { ctx: ctxA } as ServerIdentity });
    const client = new Client({ name: "att-001-integration", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    try {
      const tools = (await client.listTools()).tools;
      const tool = tools.find((entry) => entry.name === "get_workspace_context");
      expect(tool?.description).toContain("attentionCoverage");

      const result = (await client.callTool({
        name: "get_workspace_context",
        arguments: { workspaceId: seeded.workspaceId },
      })) as { content: Array<{ type: string; text?: string }> };
      const text = result.content.find((part) => part.type === "text")?.text ?? "";
      const payload = JSON.parse(text) as WorkspaceContext;
      expect(payload.attentionCoverage.completeUnderRules).toBe(true);
      const cues = payload.needsAttention.filter((item) => item.reason === "accepted_decision_needs_review");
      expect(cues.map((item) => item.id).sort()).toEqual(
        [seeded.decisionReviewSuperseded, seeded.decisionReviewWithdrawn].sort(),
      );
      const supersededCue = cues.find((item) => item.id === seeded.decisionReviewSuperseded);
      expect(supersededCue?.needsReviewFindingIds).toEqual([seeded.findingStale]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("renders plain-language reason labels, the coverage line, and the assignment note without relying on color", () => {
    const { sandbox } = loadAppSandbox();
    const teamItem = {
      kind: "task",
      id: "task_team",
      summary: "Blocked for a teammate",
      status: "blocked",
      reason: "team_blocked_task",
      assignee: { actorId: "agt_ben", actorType: "agent" },
    };
    const html = evalIn<string>(sandbox, `attentionItemHtml(${JSON.stringify(teamItem)})`);
    expect(html).toContain("another participant");
    expect(html).toContain("task_team");
    expect(html).toContain("agt_ben");
    expect(html).toContain('data-reason="team_blocked_task"');

    // The assignment/permission explanation is present in both attention panels.
    expect(INDEX_HTML).toContain("Recorded assignment is a record, not a permission");
  });

  it("renders the same context through the real CLI JSON and human text", async () => {
    const dir = mkdtempSync(join(tmpdir(), "campfire-att-001-"));
    const dbPath = join(dir, "campfire.db");
    try {
      const fileStore = openSqliteStore(dbPath);
      const fileService = createCampfireService({ store: fileStore, idSource: createCounterIdSource(), clock: nextIso });
      // Re-seed the same lab scenario against the file store.
      store = fileStore;
      service = fileService;
      const seeded = seedLab();
      fileService.close();

      const logs: string[] = [];
      const logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      });
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const previousUrl = process.env.CAMPFIRE_URL;
      const previousToken = process.env.CAMPFIRE_TOKEN;
      const previousActorId = process.env.CAMPFIRE_ACTOR_ID;
      const previousActorType = process.env.CAMPFIRE_ACTOR_TYPE;
      delete process.env.CAMPFIRE_URL;
      delete process.env.CAMPFIRE_TOKEN;
      // Bind the CLI to the seeded fixture owner so the local database can be read.
      process.env.CAMPFIRE_ACTOR_ID = HUMAN_A.actorId;
      process.env.CAMPFIRE_ACTOR_TYPE = "human";
      try {
        await runCli(["--db", dbPath, "show", seeded.workspaceId, "--json"]);
        const payload = JSON.parse(logs.join("\n")) as WorkspaceContext;
        expect(payload.attentionCoverage.completeUnderRules).toBe(true);
        expect(payload.needsAttention.some((item) => item.reason === "accepted_decision_needs_review")).toBe(true);

        logs.length = 0;
        await runCli(["--db", dbPath, "show", seeded.workspaceId, "--output", "human"]);
        const output = logs.join("\n");
        expect(output).toContain("Attention coverage");
        expect(output).toContain("accepted_decision_needs_review");
        expect(output).toContain(seeded.findingStale);
      } finally {
        logSpy.mockRestore();
        errorSpy.mockRestore();
        if (previousUrl === undefined) delete process.env.CAMPFIRE_URL;
        else process.env.CAMPFIRE_URL = previousUrl;
        if (previousToken === undefined) delete process.env.CAMPFIRE_TOKEN;
        else process.env.CAMPFIRE_TOKEN = previousToken;
        if (previousActorId === undefined) delete process.env.CAMPFIRE_ACTOR_ID;
        else process.env.CAMPFIRE_ACTOR_ID = previousActorId;
        if (previousActorType === undefined) delete process.env.CAMPFIRE_ACTOR_TYPE;
        else process.env.CAMPFIRE_ACTOR_TYPE = previousActorType;
      }
    } finally {
      // Leave the in-memory fixture for the shared afterEach.
      store = openInMemoryStore();
      service = createCampfireService({ store, idSource: createCounterIdSource(), clock: nextIso });
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// D6 — boundedness and compatibility
// ---------------------------------------------------------------------------

describe("ATT-001 D6 — boundedness and compatibility", () => {
  it("keeps the five Viewer read methods and adds only the NAV-002 MCP reads", async () => {
    expect([...VIEWER_READ_METHODS]).toEqual([
      "whoami",
      "list_workspaces",
      "get_workspace",
      "get_workspace_context",
      "get_activity",
    ]);

    const server = createCampfireMcpServer({ service, identity: { ctx: ctxA } as ServerIdentity });
    const client = new Client({ name: "att-001-compat", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    try {
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      // ATT-001 froze 36 tools. NAV-002 adds two read-only tools and does not
      // remove any. The Viewer allowlist stays the original five.
      expect(names).toHaveLength(38);
      for (const name of [
        "get_workspace_context",
        "update_task",
        "list_decisions",
        "get_activity",
        "list_workspace_participants",
        "get_record_history",
      ]) {
        expect(names).toContain(name);
      }
      const schema = (await client.listTools()).tools.find((tool) => tool.name === "get_workspace_context")
        ?.inputSchema as { properties?: Record<string, unknown> } | undefined;
      expect(Object.keys(schema?.properties ?? {}).sort()).toEqual(["participants", "since", "workspaceId"]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("keeps slices, cursors, budgets, and older response fields intact", () => {
    const seeded = seedLab();
    for (let index = 0; index < 16; index += 1) {
      const id = addTask(seeded.workspaceId, `Filler task ${index}`);
      service.updateTask(ctxA, { taskId: id, status: "in_progress" });
      service.updateTask(ctxA, { taskId: id, status: "completed" });
    }
    const contextA = context(ctxA, seeded.workspaceId);
    for (const slice of Object.values(contextA.slices)) {
      expect(typeof slice.total).toBe("number");
      expect(typeof slice.returned).toBe("number");
      expect(typeof slice.truncated).toBe("boolean");
    }
    expect(contextA.slices.tasks.nextCursor).toBeTruthy();
    expect(contextA.budget.tasks).toBe(20);
    expect(contextA.budget.decisions).toBe(10);
    for (const field of [
      "needsYou",
      "needsAttention",
      "currentWork",
      "proposedDecisions",
      "acceptedDecisions",
      "supersededDecisions",
      "openTasks",
      "findings",
      "artifacts",
      "provenance",
      "alignment",
      "historicalCounts",
      "provenanceSummary",
      "suggestedNextAction",
    ]) {
      expect(contextA).toHaveProperty(field);
    }
    expect(contextA.suggestedNextAction.orientationHint).toBe(true);
  });

  it("renders attention without issuing a fetch or a background read", () => {
    const seeded = seedLab();
    const contextA = context(ctxA, seeded.workspaceId);
    const { sandbox, fetchCalls } = loadAppSandbox();
    sandbox.ctx = contextA;
    const coverage = evalIn<AttentionCoverage | undefined>(sandbox, "attentionCoverageFrom(ctx)");
    expect(coverage).toEqual(contextA.attentionCoverage);
    renderWith(sandbox, "renderAttentionList", contextA.needsAttention, "empty", "coverage");
    renderWith(sandbox, "renderAttentionList", contextA.needsYou, "empty", "coverage");
    expect(fetchCalls()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Shared tiny fixtures
// ---------------------------------------------------------------------------

/** A workspace whose only attention item is the accepted-decision review cue. */
function seedReviewOnly(): { workspaceId: string } {
  const { workspaceId } = baseLab();
  const stale = service.addFinding(ctxA, { workspaceId, summary: "Stale basis" });
  service.withdrawFinding(ctxA, { findingId: stale.id, reason: "sampling error" });
  const decision = service.addDecision(ctxA, { workspaceId, summary: "Depends on stale basis" });
  service.acceptDecision(ctxA, decision.id);
  service.citeDecisionBasis(ctxA, { decisionId: decision.id, findingId: stale.id });
  return { workspaceId };
}
