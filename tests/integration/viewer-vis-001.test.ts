/**
 * VIS-001 Viewer presentation slice.
 *
 * Every check here corresponds to a comprehension failure observed against
 * correct service data during the v1.12 entry-gate trace. See
 * docs/SPRINT_VIS_001_RESULT.md section 2. This is a deterministic check of
 * presentation logic, not a live harness trace and not Gate B or Gate C
 * evidence.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const APP_JS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../src/viewer/static/app.js"), "utf8");
const APP_CSS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../src/viewer/static/app.css"), "utf8");

function loadAppSandbox() {
  const sandbox: Record<string, unknown> = {
    document: { getElementById: () => null, addEventListener: () => {} },
    sessionStorage: { getItem: () => null, setItem: () => {} },
    fetch: async () => {
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
  return sandbox;
}

function evalIn<T>(sandbox: Record<string, unknown>, expression: string): T {
  return vm.runInContext(expression, sandbox) as T;
}

// The gate workspace: two accepted decisions, one of them flagged because it
// cites a superseded finding. Exactly the state that misled the participant.
const GATE_WORK = {
  inProgressTasks: [],
  blockedTasks: [
    { id: "task_blocked", status: "blocked", title: "Blocked export rerun", updatedAt: "2026-10-04T01:00:00.000Z" },
  ],
  acceptedDecisions: [
    {
      id: "dec_precaution",
      status: "accepted",
      summary: "Keep the tide-table check before every export",
      updatedAt: "2026-10-04T04:30:40.000Z",
      needsReview: true,
      needsReviewFindingIds: ["find_d64c878a8016415a"],
    },
    {
      id: "dec_operative",
      status: "accepted",
      summary: "Skip the cache flush and rerun the export after the reload window",
      updatedAt: "2026-10-03T23:48:43.000Z",
    },
  ],
};

const GATE_CONTEXT = {
  currentWork: GATE_WORK,
  // The most recently touched open task, which the Viewer previously never listed.
  openTasks: [
    { id: "task_next", status: "open", title: "Reload the March export", updatedAt: "2026-10-04T17:48:20.000Z" },
    { id: "task_old", status: "open", title: "Older open item", updatedAt: "2026-10-03T10:00:00.000Z" },
  ],
  acceptedDecisions: GATE_WORK.acceptedDecisions,
  suggestedNextAction: {
    kind: "decision",
    id: "dec_chalkboard",
    summary: "Harbor chalkboard note",
    reason: "team_proposed_decision",
    orientationHint: true,
  },
  slices: {
    decisions: { total: 14, returned: 10, truncated: true },
    findings: { total: 15, returned: 10, truncated: true },
    tasks: { total: 22, returned: 20, truncated: true },
    artifacts: { total: 14, returned: 10, truncated: true },
  },
};

describe("VIS-001 accepted-decision salience", () => {
  it("separates an accepted decision that needs review from the settled list", () => {
    const sandbox = loadAppSandbox();
    sandbox.el = { innerHTML: "" };
    sandbox.work = GATE_WORK;
    sandbox.context = GATE_CONTEXT;
    evalIn(sandbox, "renderCurrentWork(el, work, context)");
    const html = evalIn<string>(sandbox, "el.innerHTML");
    // The flagged decision appears in the needs-review group, not the settled one.
    expect(html).toContain("accepted decisions needing review");
    const flaggedIndex = html.indexOf("accepted decisions needing review");
    const settledIndex = html.indexOf(">accepted decisions");
    expect(settledIndex).toBeGreaterThanOrEqual(0);
    expect(flaggedIndex).toBeGreaterThan(settledIndex);
    // "non-current", not "withdrawn": the stale-citation rule is
    // currentness <> 'current', which includes superseded findings.
    expect(html).toContain("cites non-current finding find_d64c878a8016415a");
    expect(html).not.toContain("withdrawn");
  });

  it("shows the full cited finding id, not a clipped marker", () => {
    const sandbox = loadAppSandbox();
    sandbox.decision = GATE_WORK.acceptedDecisions[0];
    const rendered = evalIn<string>(sandbox, "workDecisionHtml(decision)");
    expect(rendered).toContain("find_d64c878a8016415a");
  });

  it("does not mark a settled decision as needing review", () => {
    const sandbox = loadAppSandbox();
    sandbox.decision = GATE_WORK.acceptedDecisions[1];
    const html = evalIn<string>(sandbox, "workDecisionHtml(decision)");
    expect(html).not.toContain("needs review");
    expect(html).not.toContain("oreview");
  });

  it("applies the same distinction in the alignment panel", () => {
    const sandbox = loadAppSandbox();
    sandbox.el = { innerHTML: "" };
    sandbox.context = GATE_CONTEXT;
    evalIn(sandbox, `renderAlignment(el, ${JSON.stringify({
      status: "open",
      proposedDecisionIds: ["dec_chalkboard"],
      acceptedDecisionIds: ["dec_precaution", "dec_operative"],
      unresolvedBlockedTaskIds: ["task_blocked"],
    })}, context)`);
    const html = evalIn<string>(sandbox, "el.innerHTML");
    // A decision cannot read as settled in one panel and suspect in the other.
    expect(html).toContain("accepted needing review");
    expect(html).toContain("dec_precaution");
    expect(html).toContain("dec_operative");
  });

  it("never carries the distinction by color alone", () => {
    const rule = APP_CSS.slice(APP_CSS.indexOf(".oreview {"), APP_CSS.indexOf(".owork-flag {"));
    expect(rule).toContain("border");
    expect(APP_JS).toContain('aria-label="accepted decision needing review"');
    // The old rule clipped the ids that explain the flag.
    const reason = APP_CSS.slice(APP_CSS.indexOf(".oreason {"), APP_CSS.indexOf(".oreview {"));
    expect(reason).not.toContain("text-overflow");
    expect(reason).not.toContain("white-space: nowrap");
    expect(reason).not.toContain("color: var(--dim)");
  });
});

describe("VIS-001 next action is reachable", () => {
  it("enumerates open tasks that the service already returned", () => {
    const sandbox = loadAppSandbox();
    sandbox.el = { innerHTML: "" };
    sandbox.work = GATE_WORK;
    sandbox.context = GATE_CONTEXT;
    evalIn(sandbox, "renderCurrentWork(el, work, context)");
    const html = evalIn<string>(sandbox, "el.innerHTML");
    expect(html).toContain("open");
    expect(html).toContain("Reload the March export");
    // Newest open task first, and not duplicated from another group.
    expect(html.indexOf("Reload the March export")).toBeLessThan(html.indexOf("Older open item"));
    expect(html.match(/Reload the March export/g)).toHaveLength(1);
  });

  it("names the suggested action's kind and id", () => {
    const sandbox = loadAppSandbox();
    sandbox.el = { innerHTML: "" };
    sandbox.action = GATE_CONTEXT.suggestedNextAction;
    evalIn(sandbox, "renderNextAction(el, action)");
    const html = evalIn<string>(sandbox, "el.innerHTML");
    // The hint pointed at a proposed decision but did not say so.
    expect(html).toContain("decision");
    expect(html).toContain("dec_chalkboard");
    expect(html).toContain("orientation hint, not an action");
  });
});

describe("VIS-001 completeness is visible", () => {
  it("renders returned, total, and truncation per section", () => {
    const sandbox = loadAppSandbox();
    sandbox.el = { innerHTML: "" };
    sandbox.work = GATE_WORK;
    sandbox.context = GATE_CONTEXT;
    evalIn(sandbox, "renderCurrentWork(el, work, context)");
    const html = evalIn<string>(sandbox, "el.innerHTML");
    expect(html).toContain("showing 10 of 14");
    expect(html).toContain("showing 20 of 22");
    expect(html).toContain("more available");
  });

  it("still states completeness when every displayed decision needs review", () => {
    const sandbox = loadAppSandbox();
    sandbox.el = { innerHTML: "" };
    sandbox.context = {
      ...GATE_CONTEXT,
      openTasks: [],
      currentWork: {
        inProgressTasks: [],
        blockedTasks: [],
        // The settled group is empty, which previously swallowed the count.
        acceptedDecisions: [GATE_WORK.acceptedDecisions[0]],
      },
      acceptedDecisions: [GATE_WORK.acceptedDecisions[0]],
    };
    const flaggedOnly = {
      ...GATE_CONTEXT,
      openTasks: [],
      currentWork: {
        inProgressTasks: [],
        blockedTasks: [],
        // The settled group is empty, which previously swallowed the count.
        acceptedDecisions: [GATE_WORK.acceptedDecisions[0]],
      },
      acceptedDecisions: [GATE_WORK.acceptedDecisions[0]],
    };
    sandbox.work = flaggedOnly.currentWork;
    sandbox.context = flaggedOnly;
    evalIn(sandbox, "renderCurrentWork(el, work, context)");
    const html = evalIn<string>(sandbox, "el.innerHTML");
    expect(html).not.toContain(">accepted decisions<");
    expect(html).toContain("accepted decisions needing review");
    expect(html).toContain("decisions");
    expect(html).toContain("showing 10 of 14");
  });

  it("states completeness when the section has no rows at all", () => {
    const sandbox = loadAppSandbox();
    sandbox.el = { innerHTML: "" };
    sandbox.context = {
      ...GATE_CONTEXT,
      openTasks: [],
      currentWork: { inProgressTasks: [], blockedTasks: [], acceptedDecisions: [] },
    };
    const empty = {
      ...GATE_CONTEXT,
      openTasks: [],
      currentWork: { inProgressTasks: [], blockedTasks: [], acceptedDecisions: [] },
    };
    sandbox.work = empty.currentWork;
    sandbox.context = empty;
    evalIn(sandbox, "renderCurrentWork(el, work, context)");
    const html = evalIn<string>(sandbox, "el.innerHTML");
    // Zero rows and undisplayed rows must look different.
    expect(html).toContain("No current work");
    expect(html).toContain("orientation completeness");
    expect(html).toContain("more available");
  });

  it("marks a section that returned everything as complete", () => {
    const sandbox = loadAppSandbox();
    const note = evalIn<string>(
      sandbox,
      "completenessNote({ total: 4, returned: 4, truncated: false })",
    );
    expect(note).toContain("showing 4 of 4");
    expect(note).not.toContain("more available");
  });

  it("does not invent counts when the service sent none", () => {
    const sandbox = loadAppSandbox();
    const note = evalIn<string>(sandbox, "completenessNote(null)");
    expect(note).toBe("");
  });

  it("still renders work when no slice metadata is present", () => {
    const sandbox = loadAppSandbox();
    sandbox.el = { innerHTML: "" };
    evalIn(
      sandbox,
      `renderCurrentWork(el, ${JSON.stringify({ inProgressTasks: [], blockedTasks: [], acceptedDecisions: GATE_WORK.acceptedDecisions })}, ${JSON.stringify({ openTasks: [] })})`,
    );
    const html = evalIn<string>(sandbox, "el.innerHTML");
    expect(html).toContain("Skip the cache flush");
    expect(html).not.toContain("showing");
  });
});

describe("VIS-001 basis is labelled", () => {
  it("labels reason and cites references instead of counting", () => {
    const sandbox = loadAppSandbox();
    sandbox.payload = {
      summary: "The export window overlapped a reload",
      currentness: "current",
      reason: "The tide table was already current",
      evidence: [{ artifactId: "art_1", note: "internal note" }],
      citations: [{ findingId: "find_1" }],
    };
    const lines = evalIn<string[]>(sandbox, "compactRecordLines(payload, {})");
    expect(lines).toContain("current");
    expect(lines).toContain("reason: The tide table was already current");
    expect(lines.join("\n")).toContain("evidence (1): art_1");
    expect(lines.join("\n")).toContain("cites (1): find_1");
  });
});

describe("VIS-001 the Viewer stays read-only", () => {
  it("adds no write control to the orientation surface", () => {
    const sandbox = loadAppSandbox();
    sandbox.el = { innerHTML: "" };
    sandbox.work = GATE_WORK;
    sandbox.context = GATE_CONTEXT;
    evalIn(sandbox, "renderCurrentWork(el, work, context)");
    const html = evalIn<string>(sandbox, "el.innerHTML");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<form");
  });

  it("escapes decision text rather than rendering it", () => {
    const sandbox = loadAppSandbox();
    sandbox.decision = {
      id: "dec_x",
      status: "accepted",
      summary: "<img src=x onerror=alert(1)>",
      needsReview: true,
      needsReviewFindingIds: ["<b>f1</b>"],
    };
    const html = evalIn<string>(sandbox, "workDecisionHtml(decision)");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;img");
  });
});