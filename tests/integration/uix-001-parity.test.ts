/**
 * UIX-001 fixture parity for the frozen ATT-001 lab workspace (scenario v2).
 *
 * Seeds once, reads `get_workspace_context` through the real service with the
 * actor bound directly, and compares the tall terminal frame to the Viewer
 * orientation render. This is fixture evidence. It does not rescore ATT-001
 * and it is not a human observation.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createDashboardState,
  reduceDashboardKey,
  renderDashboard,
  sectionRows,
  type DashboardState,
} from "../../src/cli/dashboard.js";
import type { ActorRef } from "../../src/domain/types.js";
import { dispatchCampfireMethod } from "../../src/http/dispatch.js";
import { ARTIFACT_REFERENCE_LABEL } from "../../src/presentation/work-console.js";
import type { ActorContext } from "../../src/service/authorization.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import type { CampfireService, WorkspaceContext } from "../../src/service/service.js";
import { openReadonlySqliteStore } from "../../src/store/sqlite-store.js";
import {
  SCENARIO,
  SERVED_AT,
  UNRELATED_FINDING_SENTINEL,
  seedDatabase,
} from "../../fixtures/attention/att-001/seed.js";

const APP_JS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../src/viewer/static/app.js"),
  "utf8",
);

const GOAL_TITLE = "Make team attention cues trustworthy without changing recorded work.";
const COLUMNS = 120;
const ROWS = 80;
const REFRESHED_AT = "2026-10-16T12:00:00.000Z";

const REVIEW_SUPERSEDED = SCENARIO.decisions.reviewSuperseded;
const REVIEW_WITHDRAWN = SCENARIO.decisions.reviewWithdrawn;
const FINDING_SUPERSEDED = SCENARIO.findings.labSuperseded;
const FINDING_WITHDRAWN = SCENARIO.findings.labWithdrawn;
const COMPETING_A = SCENARIO.decisions.competingA;
const COMPETING_B = SCENARIO.decisions.competingB;
const RUNBOOK = SCENARIO.artifacts.runbookRef;
const SENTINEL_ID = SCENARIO.findings.unrelatedSentinel;

let dir: string;
let service: CampfireService;
let ana: WorkspaceContext;
let ben: WorkspaceContext;

function human(actorId: string): ActorContext {
  const actor: ActorRef = { actorId, actorType: "human" };
  return { actor };
}

function contextFor(actorId: string): WorkspaceContext {
  return dispatchCampfireMethod(service, human(actorId), "get_workspace_context", {
    workspaceId: SCENARIO.workspaces.lab,
  }) as WorkspaceContext;
}

function dashboardState(context: WorkspaceContext, actorId: string, perspective: "mine" | "team"): DashboardState {
  return createDashboardState({
    workspaceId: context.workspace.id,
    actorId,
    actorType: "human",
    context,
    perspective,
    refreshedAt: REFRESHED_AT,
  });
}

function tall(state: DashboardState): string {
  return renderDashboard(state, COLUMNS, ROWS);
}

/** Every section/row the keyboard can select, so a source-only artifact still counts. */
function framesIncludingSelection(initial: DashboardState): string[] {
  const frames: string[] = [];
  let state = initial;
  for (let section = 0; section < 4; section += 1) {
    const count = sectionRows(state).length;
    const steps = Math.max(count, 1);
    for (let row = 0; row < steps; row += 1) {
      frames.push(tall(state));
      if (row + 1 < count) state = reduceDashboardKey(state, "j");
    }
    state = reduceDashboardKey(state, "tab");
  }
  return frames;
}

function loadAppSandbox() {
  let fetchCalls = 0;
  const sandbox: Record<string, unknown> = {
    document: {
      documentElement: { dataset: {} as Record<string, string> },
      getElementById: () => null,
      addEventListener: () => {},
    },
    localStorage: { getItem: () => null, setItem: () => {} },
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

function visible(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

interface ViewerSurface {
  workspaceOptions: string;
  goal: string;
  counts: string;
  needsYou: string;
  needsAttention: string;
  currentWork: string;
  sources: string;
  alignment: string;
  coverageText: string;
  emptyText: string;
  recordedCounts: string;
}

function renderViewer(context: WorkspaceContext, actorId: string, perspective: "mine" | "team"): ViewerSurface & { fetchCalls: number } {
  const { sandbox, fetchCalls } = loadAppSandbox();
  const payload = JSON.stringify(context);
  vm.runInContext(
    `function panel() {
       return { innerHTML: "", textContent: "", hidden: false, setAttribute: function () {}, getAttribute: function () { return null; } };
     }
     els.whoami = panel();
     els.error = panel();
     els.workspace = { innerHTML: "", value: "" };
     els.generatedViewLink = { hidden: true, href: "" };
     els.recordedCounts = panel();
     els.people = panel();
     els.goal = panel();
     els.recordNotes = panel();
     els.alignment = panel();
     els.needsYou = panel();
     els.needsAttention = panel();
     els.currentWork = panel();
     els.sources = panel();
     els.since = panel();
     els.nextAction = panel();
     state.context = ${payload};
     state.whoami = ${JSON.stringify({ actor: { actorId, actorType: "human" } })};
     state.workspaces = ${JSON.stringify([{ id: context.workspace.id, name: context.workspace.name }])};
     state.workspaceId = ${JSON.stringify(context.workspace.id)};
     state.perspective = ${JSON.stringify(perspective)};
     state.sinceView = null;
     renderHeader();
     renderMast();
     renderOrientation();
     out = {
       workspaceOptions: els.workspace.innerHTML,
       goal: els.goal.innerHTML,
       counts: els.recordedCounts.textContent,
       needsYou: els.needsYou.innerHTML,
       needsAttention: els.needsAttention.innerHTML,
       currentWork: els.currentWork.innerHTML,
       sources: els.sources.innerHTML,
       alignment: els.alignment.innerHTML,
       coverageText: attentionCoverageText(attentionCoverageFrom(state.context)),
       emptyText: attentionEmptyText(attentionCoverageFrom(state.context)),
       recordedCounts: recordedCountText(state.context.participants)
     };`,
    sandbox,
  );
  const out = sandbox.out as Omit<ViewerSurface, "goal" | "counts" | "needsYou" | "needsAttention" | "currentWork" | "sources" | "alignment"> & {
    workspaceOptions: string;
    goal: string;
    counts: string;
    needsYou: string;
    needsAttention: string;
    currentWork: string;
    sources: string;
    alignment: string;
  };
  return {
    workspaceOptions: out.workspaceOptions,
    goal: visible(out.goal),
    counts: out.counts,
    needsYou: visible(out.needsYou),
    needsAttention: visible(out.needsAttention),
    currentWork: visible(out.currentWork),
    sources: visible(out.sources),
    alignment: visible(out.alignment),
    coverageText: out.coverageText,
    emptyText: out.emptyText,
    recordedCounts: out.recordedCounts,
    fetchCalls: fetchCalls(),
  };
}

function windowAround(text: string, id: string): string {
  const index = text.indexOf(id);
  if (index < 0) return "";
  return text.slice(Math.max(0, index - 220), index + id.length + 220);
}

function expectNoSecrets(text: string, label: string): void {
  expect(text, label).not.toContain("cft_");
  expect(text, label).not.toContain("/Users/");
  expect(text, label).not.toContain(UNRELATED_FINDING_SENTINEL);
  expect(text, label).not.toContain(SENTINEL_ID);
}

function expectFrameFits(frame: string): void {
  const lines = frame.split("\n");
  expect(lines.length).toBeLessThanOrEqual(ROWS);
  for (const line of lines) expect(line.length).toBeLessThanOrEqual(COLUMNS);
}

describe("UIX-001 ATT-001 lab parity", () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "campfire-uix-001-parity-"));
    const seeded = seedDatabase(dir, true, "none");
    const store = openReadonlySqliteStore(seeded.databasePath);
    service = createCampfireService({ store, clock: () => SERVED_AT });
    ana = contextFor(SCENARIO.humans.ana);
    ben = contextFor(SCENARIO.humans.ben);
  }, 120_000);

  afterAll(() => {
    service?.close();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  });

  it("shows the same lab facts on the tall dashboard and the Viewer orientation", () => {
    const anaMineState = dashboardState(ana, SCENARIO.humans.ana, "mine");
    const anaTeamState = reduceDashboardKey(anaMineState, "p");
    expect(anaTeamState.perspective).toBe("team");
    expect(anaTeamState.workspaceId).toBe(SCENARIO.workspaces.lab);
    const benMineState = dashboardState(ben, SCENARIO.humans.ben, "mine");

    const anaMine = tall(anaMineState);
    const anaTeam = tall(anaTeamState);
    const benMine = tall(benMineState);
    expectFrameFits(anaMine);
    expectFrameFits(anaTeam);
    expectFrameFits(benMine);

    const anaViewMine = renderViewer(ana, SCENARIO.humans.ana, "mine");
    const anaViewTeam = renderViewer(ana, SCENARIO.humans.ana, "team");
    const benView = renderViewer(ben, SCENARIO.humans.ben, "mine");
    expect(anaViewMine.fetchCalls).toBe(0);
    expect(anaViewTeam.fetchCalls).toBe(0);
    expect(benView.fetchCalls).toBe(0);

    const viewerAna = [
      anaViewTeam.goal,
      anaViewTeam.counts,
      anaViewTeam.needsYou,
      anaViewTeam.needsAttention,
      anaViewTeam.currentWork,
      anaViewTeam.sources,
      anaViewTeam.alignment,
    ].join("\n");
    const viewerBen = [
      benView.goal,
      benView.counts,
      benView.needsYou,
      benView.needsAttention,
      benView.currentWork,
      benView.sources,
      benView.alignment,
    ].join("\n");

    for (const [label, text] of [
      ["dashboard ana mine", anaMine],
      ["dashboard ana team", anaTeam],
      ["dashboard ben mine", benMine],
      ["viewer ana team", viewerAna],
      ["viewer ben", viewerBen],
    ] as const) {
      expectNoSecrets(text, label);
    }

    for (const frame of [anaMine, anaTeam, benMine]) {
      expect(frame).toContain(SCENARIO.goal.lab);
      expect(frame).toContain(GOAL_TITLE);
      expect(frame).toContain(SCENARIO.workspaces.lab);
      expect(frame.includes("20/21") || frame.includes("20 of 21")).toBe(true);
      expect(frame).toContain("truncated");
      expect(frame).toContain("Cues beyond the returned pages may exist.");
      expect(frame).toContain("registered");
      expect(frame).not.toContain("online");
      expect(frame).not.toContain("working");
      expect(frame).not.toContain("operative");
    }

    expect(anaViewTeam.goal).toContain(GOAL_TITLE);
    expect(anaViewTeam.goal).toContain(SCENARIO.goal.lab);
    expect(anaViewTeam.workspaceOptions).toContain(`value="${SCENARIO.workspaces.lab}"`);
    expect(anaViewTeam.workspaceOptions).toContain(ana.workspace.name);
    expect(anaViewTeam.counts).toContain("registered");
    expect(anaViewTeam.counts).not.toContain("online");
    expect(anaViewTeam.counts).not.toContain("working");
    expect(anaViewTeam.recordedCounts).toBe(anaViewTeam.counts);
    expect(anaViewTeam.coverageText).toContain("tasks 20 of 21 (truncated)");
    expect(anaViewTeam.coverageText).toContain("Cues beyond the returned pages may exist.");
    expect(anaViewTeam.needsYou).toContain(anaViewTeam.coverageText);
    expect(anaViewTeam.needsAttention).toContain(anaViewTeam.coverageText);

    // Review cues are team attention, not Needs You.
    expect(ana.needsYou.map((item) => item.id)).not.toContain(REVIEW_SUPERSEDED);
    expect(ana.needsYou.map((item) => item.id)).not.toContain(REVIEW_WITHDRAWN);
    expect(ana.needsAttention.map((item) => item.id)).toEqual(
      expect.arrayContaining([REVIEW_SUPERSEDED, REVIEW_WITHDRAWN]),
    );
    expect(anaViewMine.needsYou).not.toContain(REVIEW_SUPERSEDED);
    expect(anaViewMine.needsYou).not.toContain(REVIEW_WITHDRAWN);
    expect(anaViewTeam.needsAttention).toContain(REVIEW_SUPERSEDED);
    expect(anaViewTeam.needsAttention).toContain(REVIEW_WITHDRAWN);
    expect(anaViewTeam.needsAttention).toContain(FINDING_SUPERSEDED);
    expect(anaViewTeam.needsAttention).toContain(FINDING_WITHDRAWN);

    for (const id of [REVIEW_SUPERSEDED, REVIEW_WITHDRAWN]) {
      for (const text of [anaTeam, anaViewTeam.needsAttention]) {
        const around = windowAround(text, id);
        expect(around, id).toContain("accepted");
        expect(around, id).not.toContain("retired");
      }
    }
    expect(windowAround(anaTeam, REVIEW_SUPERSEDED)).toContain(FINDING_SUPERSEDED);
    expect(windowAround(anaTeam, REVIEW_WITHDRAWN)).toContain(FINDING_WITHDRAWN);
    expect(windowAround(anaViewTeam.needsAttention, REVIEW_SUPERSEDED)).toContain(FINDING_SUPERSEDED);
    expect(windowAround(anaViewTeam.needsAttention, REVIEW_WITHDRAWN)).toContain(FINDING_WITHDRAWN);

    // Competing ids are on the dashboard decision lines and in the Viewer
    // alignment list that renderOrientation fills. Current work keeps the
    // accepted summaries; it does not repeat the id when a summary exists.
    for (const text of [anaTeam, anaViewTeam.alignment]) {
      expect(text).toContain(COMPETING_A);
      expect(text).toContain(COMPETING_B);
      expect(text).toContain("accepted");
      expect(text).not.toContain("operative");
    }
    expect(anaViewTeam.currentWork).toContain("accepted");
    expect(anaViewTeam.currentWork).not.toContain("operative");
    expect(windowAround(anaTeam, COMPETING_A)).toContain("accepted");
    expect(windowAround(anaTeam, COMPETING_B)).toContain("accepted");
    expect(windowAround(anaViewTeam.alignment, COMPETING_A)).toContain("accepted");
    expect(windowAround(anaViewTeam.alignment, COMPETING_B)).toContain("accepted");

    const dashArtifact = framesIncludingSelection(anaMineState).find(
      (frame) => frame.includes(RUNBOOK) && frame.includes(ARTIFACT_REFERENCE_LABEL),
    );
    expect(dashArtifact, "dashboard never lists the runbook reference").toBeDefined();
    expect(anaViewTeam.sources).toContain(RUNBOOK);
    expect(anaViewTeam.sources).toContain(ARTIFACT_REFERENCE_LABEL);
    expect(anaViewMine.sources).toContain(RUNBOOK);
    expect(anaViewMine.sources).toContain("not fetched");

    expect(ben.needsYou).toEqual([]);
    expect(benMine).toContain("more matching records may exist");
    expect(benMine).not.toContain("caught up");
    expect(benMine).not.toContain("all work is done");
    expect(benMine).not.toContain("the work is done");
    expect(benView.needsYou).toContain("more matching records may exist");
    expect(benView.emptyText).toContain("more matching records may exist");
    expect(benView.needsYou).not.toContain("caught up");
    expect(benView.needsYou).not.toContain("all work is done");
    expect(benView.coverageText).toContain("truncated");
    expect(benView.coverageText).toContain("Cues beyond the returned pages may exist.");

    const cue = ana.needsYou[0];
    expect(cue).toBeDefined();
    expect(anaMine).toContain(cue!.id);
    expect(anaViewMine.needsYou).toContain(cue!.id);
    const workId = ana.currentWork.blockedTasks[0]?.id ?? ana.openTasks[0]?.id;
    expect(workId).toBeDefined();
    expect(anaViewMine.currentWork).toContain(workId!);
  });
});
