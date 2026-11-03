/**
 * NAV-001 focused navigator: section cycle, local filter, shown-list
 * navigation, and refresh selection reconciliation.
 *
 * Pure state/renderer checks over a small hand-built authorized context. This
 * is unit evidence for the projection and key map; it is not fixture or human
 * observation evidence.
 */
import { describe, expect, it } from "vitest";
import {
  applyWorkspaceChoices,
  createDashboardState,
  fulfillWorkspaceSwitch,
  normalizeInputChunk,
  reconcileAfterLoad,
  reduceDashboardKey,
  renderDashboard,
  sectionRows,
  shownRows,
  stripEscapeSequences,
  unavailableWorkspaceList,
  type DashboardState,
} from "../../src/cli/dashboard.js";
import type { ContextSlice } from "../../src/domain/context-policy.js";
import type { ActorRef, Artifact, Decision, Task } from "../../src/domain/types.js";
import type { AttentionCoverage, AttentionItem, WorkspaceContext } from "../../src/service/service.js";

const FULL_FOOTER =
  "p perspective  tab section  w workspaces  j/k move  n/b page  h history  / filter  enter  r refresh  ? help  esc  q quit";
const COMPACT_FOOTER = "tab  w list  j/k move  n/b page  h history  / filter  enter  r  ?  esc  q quit";
const FILTER_SCOPE = "filters shown records, not the workspace";

function slice<T>(items: T[] = [], extra?: { total?: number; returned?: number; truncated?: boolean }): ContextSlice<T> {
  return {
    items,
    total: extra?.total ?? items.length,
    returned: extra?.returned ?? items.length,
    truncated: extra?.truncated ?? false,
  };
}

function actor(actorId: string, actorType: ActorRef["actorType"] = "human"): ActorRef {
  return { actorId, actorType };
}

function task(id: string, status: Task["status"], title: string, assignee?: ActorRef): Task {
  return {
    id,
    workspaceId: "ws_nav",
    title,
    status,
    ...(assignee === undefined ? {} : { assignee }),
    createdBy: actor("hum_ana"),
    createdAt: "2026-10-16T00:00:00.000Z",
    updatedAt: "2026-10-16T00:00:00.000Z",
  };
}

function decision(id: string, status: Decision["status"], summary: string): Decision {
  return {
    id,
    workspaceId: "ws_nav",
    summary,
    status,
    createdBy: actor("hum_ana"),
    createdAt: "2026-10-16T00:00:00.000Z",
    updatedAt: "2026-10-16T00:00:00.000Z",
  };
}

function artifact(id: string, uriOrPath: string): Artifact {
  return {
    id,
    workspaceId: "ws_nav",
    type: "document",
    title: `Reference ${id}`,
    uriOrPath,
    createdBy: actor("hum_ana"),
    createdAt: "2026-10-16T00:00:00.000Z",
  };
}

function cue(id: string, reason: AttentionItem["reason"], summary: string): AttentionItem {
  return {
    kind: reason.includes("decision") ? "decision" : "task",
    id,
    summary,
    status: reason.includes("blocked") ? "blocked" : reason.includes("decision") ? "proposed" : "open",
    reason,
  };
}

function coverage(partial?: Partial<AttentionCoverage>): AttentionCoverage {
  return {
    tasks: { total: 3, returned: 3, truncated: false },
    decisions: { total: 2, returned: 2, truncated: false },
    completeUnderRules: true,
    ...partial,
  };
}

function context(partial: Partial<WorkspaceContext> = {}): WorkspaceContext {
  const workspaceId = partial.workspace?.id ?? "ws_nav";
  return {
    schemaVersion: 1,
    generatedAt: "2026-10-16T00:00:00.000Z",
    orientationCursor: "cur_nav",
    completeness: { fullHistoryIncluded: false, drillDownAvailable: true },
    slices: {
      decisions: slice(),
      findings: slice(),
      tasks: slice(),
      blockers: slice(),
      artifacts: slice(),
      recentChanges: slice(),
    },
    budget: {
      goals: 1,
      decisions: 10,
      findings: 10,
      tasks: 20,
      blockers: 10,
      artifacts: 10,
      recentChanges: 20,
    },
    workspace: {
      id: workspaceId,
      teamId: "team_nav",
      name: "Navigator lab",
      status: "active",
      createdBy: actor("hum_ana"),
      createdAt: "2026-10-16T00:00:00.000Z",
      updatedAt: "2026-10-16T00:00:00.000Z",
    },
    goal: {
      id: "goal_nav",
      workspaceId,
      title: "Give the terminal one focused screen over the recorded work.",
      status: "active",
      createdBy: actor("hum_ana"),
      createdAt: "2026-10-16T00:00:00.000Z",
      updatedAt: "2026-10-16T00:00:00.000Z",
    },
    participants: [],
    proposedDecisions: [],
    acceptedDecisions: [],
    supersededDecisions: [],
    openTasks: [],
    findings: [],
    artifacts: [],
    provenance: [],
    provenanceTotal: 0,
    provenanceTruncated: false,
    needsYou: [],
    needsAttention: [],
    attentionCoverage: coverage(),
    currentWork: { inProgressTasks: [], blockedTasks: [], acceptedDecisions: [] },
    suggestedNextAction: { kind: "none", summary: "", reason: "none", orientationHint: true },
    alignment: {
      status: "unspecified",
      proposedDecisionIds: [],
      acceptedDecisionIds: [],
      unresolvedBlockedTaskIds: [],
    },
    historicalCounts: { findings: 0, decisions: 0 },
    provenanceSummary: [],
    ...partial,
  };
}

function stateFor(value: WorkspaceContext, extra?: { section?: DashboardState["section"] }): DashboardState {
  return createDashboardState({
    workspaceId: value.workspace.id,
    actorId: "hum_ana",
    actorType: "human",
    context: value,
    refreshedAt: "2026-10-16T12:00:00.000Z",
    ...(extra?.section === undefined ? {} : { section: extra.section }),
  });
}

/** The three-task work fixture used by the filter/navigation checks. */
function workContext(): WorkspaceContext {
  return context({
    openTasks: [
      task("task_work_alpha", "open", "Alpha task"),
      task("task_work_beta", "open", "Beta task"),
    ],
    currentWork: {
      inProgressTasks: [task("task_other_gamma", "in_progress", "Gamma task")],
      blockedTasks: [],
      acceptedDecisions: [],
    },
    slices: {
      decisions: slice(),
      findings: slice(),
      tasks: slice<Task>([], { total: 5, returned: 3, truncated: true }),
      blockers: slice(),
      artifacts: slice(),
      recentChanges: slice(),
    },
  });
}

function stateAt(value: WorkspaceContext, section: DashboardState["section"]): DashboardState {
  let state = stateFor(value);
  while (state.section !== section) state = reduceDashboardKey(state, "tab");
  return state;
}

function type(state: DashboardState, text: string): DashboardState {
  let next = state;
  for (const char of text) next = reduceDashboardKey(next, char);
  return next;
}

/** Wrap-safe logical text for long chrome lines (record() only breaks at spaces). */
function flat(frame: string): string {
  return frame.split("\n").join(" ").replace(/\s+/g, " ").trim();
}

describe("NAV-001 focused navigator", () => {
  it("cycles sections in order with tab and wraps to overview", () => {
    let state = stateFor(context());
    const order: string[] = [state.section];
    for (let step = 0; step < 7; step += 1) {
      state = reduceDashboardKey(state, "tab");
      order.push(state.section);
    }
    expect(order).toEqual([
      "overview",
      "attention",
      "work",
      "decisions",
      "references",
      "people",
      "changes",
      "overview",
    ]);
  });

  it("renders overview by default and keeps other sections off that frame", () => {
    const value = context({
      goal: {
        id: "goal_nav",
        workspaceId: "ws_nav001_lab",
        title: "One focused screen",
        status: "active",
        createdBy: actor("hum_ana"),
        createdAt: "2026-10-16T00:00:00.000Z",
        updatedAt: "2026-10-16T00:00:00.000Z",
      },
      needsYou: [cue("task_attention_blocked", "assigned_blocked_task", "Blocked for Ana")],
      openTasks: [task("task_work_alpha", "open", "Alpha task")],
      proposedDecisions: [decision("dec_proposed_one", "proposed", "Consider the split")],
      artifacts: [artifact("art_reference_one", "https://example.com/nav-001/runbook.html")],
      participants: [
        {
          actor: actor("agt_rex", "agent"),
          name: "Rex",
          role: "agent",
          harness: "codex",
          humanOwnerId: "hum_ana",
          joinedAt: "2026-10-16T00:00:00.000Z",
        },
      ],
      attentionCoverage: coverage(),
    });
    const frame = renderDashboard(stateFor(value), 120, 36);
    expect(stateFor(value).section).toBe("overview");
    expect(frame).toContain("OVERVIEW");
    expect(frame).toContain("goal  One focused screen");
    expect(frame).toContain("Needs You  1");
    expect(frame).toContain("People load in People & Agents.");
    expect(frame).not.toContain("task_attention_blocked");
    expect(frame).not.toContain("Rex");
    expect(frame).not.toContain("art_reference_one");
    expect(frame).not.toContain("dec_proposed_one");
    expect(frame).not.toContain("MY WORK");
    expect(frame).not.toContain("TEAM WORK");
    expect(frame).not.toContain("working");
    expect(frame).toContain("1 registered agents");
    const attention = renderDashboard(reduceDashboardKey(stateFor(value), "tab"), 120, 36);
    expect(attention).toContain("NEEDS YOU");
    expect(attention).toContain("task_attention_blocked");
    expect(attention).toContain("SOURCE");
    expect(attention).not.toContain("MY WORK");
    expect(attention).not.toContain("TEAM WORK");
    const team = renderDashboard(reduceDashboardKey(reduceDashboardKey(stateFor(value), "tab"), "p"), 120, 36);
    expect(team).toContain("NEEDS ATTENTION");
    expect(team).not.toContain("TEAM WORK");
    expect(team).not.toContain("MY WORK");
  });

  it("enters filterMode on / without dropping the text or the selection", () => {
    const before = stateAt(workContext(), "work");
    const entered = reduceDashboardKey(before, "/");
    expect(entered.filterMode).toBe(true);
    expect(entered.filter).toBe("");
    expect(entered.row).toBe(before.row);
    expect(entered.section).toBe("work");
  });

  it("filters shown rows and labels the filter as shown records, not the workspace", () => {
    let state = stateAt(workContext(), "work");
    state = reduceDashboardKey(state, "/");
    state = type(state, "alpha");
    expect(state.filter).toBe("alpha");
    expect(state.filterMode).toBe(true);
    expect(shownRows(state).map((row) => row.id)).toEqual(["task_work_alpha"]);
    expect(sectionRows(state)).toHaveLength(3);

    const frame = renderDashboard(state, 120, 36);
    expect(flat(frame)).toContain('filter "alpha"');
    expect(flat(frame)).toContain(FILTER_SCOPE);
    expect(flat(frame)).toContain("matching 1 loaded 3 workspace total 5");
    expect(flat(frame)).toContain("(typing — enter confirms, esc clears, ctrl-c quits)");
    expect(frame).toContain("task_work_alpha");
    expect(frame).not.toContain("task_work_beta");
    expect(frame).not.toContain("task_other_gamma");
  });

  it("clears the filter and leaves filterMode on esc", () => {
    let state = stateAt(workContext(), "work");
    state = reduceDashboardKey(state, "/");
    state = type(state, "alpha");
    state = reduceDashboardKey(state, "\u001b");
    expect(state.filter).toBe("");
    expect(state.filterMode).toBe(false);
    expect(shownRows(state)).toHaveLength(3);
    expect(renderDashboard(state, 120, 36)).not.toContain(FILTER_SCOPE);
  });

  it("confirms the filter with enter, keeping the text and the narrowed rows", () => {
    let state = stateAt(workContext(), "work");
    state = reduceDashboardKey(state, "/");
    state = type(state, "beta");
    state = reduceDashboardKey(state, "enter");
    expect(state.filterMode).toBe(false);
    expect(state.filter).toBe("beta");
    expect(shownRows(state).map((row) => row.id)).toEqual(["task_work_beta"]);
    const frame = renderDashboard(state, 120, 36);
    expect(frame).toContain('filter "beta"');
    expect(frame).toContain(FILTER_SCOPE);
  });

  it("quits on Ctrl-C from filterMode", () => {
    let state = stateAt(workContext(), "work");
    state = reduceDashboardKey(state, "/");
    state = type(state, "alp");
    state = reduceDashboardKey(state, "\u0003");
    expect(state.quit).toBe(true);
  });

  it("moves and inspects only the shown rows while a filter is active", () => {
    let state = stateAt(workContext(), "work");
    state = reduceDashboardKey(state, "/");
    state = type(state, "task_work");
    state = reduceDashboardKey(state, "enter");
    expect(shownRows(state)).toHaveLength(2);
    expect(state.row).toBe(0);

    state = reduceDashboardKey(state, "j");
    expect(state.row).toBe(1);
    state = reduceDashboardKey(state, "j");
    expect(state.row).toBe(1);
    state = reduceDashboardKey(state, "k");
    expect(state.row).toBe(0);

    state = reduceDashboardKey(state, "j");
    const opened = reduceDashboardKey(state, "enter");
    expect(opened.row).toBe(1);
    expect(opened.detailOpen).toBe(true);
    expect(opened.inspectRequest).toBeUndefined();
    const frame = renderDashboard(opened, 120, 36);
    expect(frame).toContain("get_workspace_context  task_work_beta");
  });

  it("preserves the selected row id across filter typing when it survives", () => {
    let state = stateAt(workContext(), "work");
    state = reduceDashboardKey(state, "/");
    state = type(state, "task");
    state = reduceDashboardKey(state, "enter");
    // All three rows match "task"; select beta (shown index 1).
    state = reduceDashboardKey(state, "j");
    expect(state.row).toBe(1);
    expect(shownRows(state)[1]?.id).toBe("task_work_beta");
    state = {
      ...state,
      detailOpen: true,
      inspected: { method: "get_task", sourceId: "task_work_beta", record: { id: "task_work_beta" } },
    };

    state = reduceDashboardKey(state, "/");
    state = type(state, "_work");
    expect(state.filter).toBe("task_work");
    // Beta survives and stays at the same shown index; the inspected detail
    // still names the selected row.
    expect(shownRows(state)[state.row]?.id).toBe("task_work_beta");
    expect(state.row).toBe(1);
    expect(state.detailOpen).toBe(true);
    expect(state.inspected?.sourceId).toBe("task_work_beta");
  });

  it("drops the selection and inspected detail when typing filters the row out", () => {
    let state = stateAt(workContext(), "work");
    state = reduceDashboardKey(state, "/");
    state = type(state, "beta");
    state = reduceDashboardKey(state, "enter");
    state = {
      ...state,
      detailOpen: true,
      inspected: { method: "get_task", sourceId: "task_work_beta", record: { id: "task_work_beta" } },
    };

    state = reduceDashboardKey(state, "/");
    state = type(state, "x");
    expect(state.filter).toBe("betax");
    expect(shownRows(state)).toHaveLength(0);
    expect(state.row).toBe(0);
    expect(state.detailOpen).toBe(false);
    expect(state.inspected).toBeUndefined();
    const frame = renderDashboard(state, 120, 36);
    expect(frame).toContain("no shown row matches the filter");
    // The source page coverage stays visible; an empty shown list never
    // becomes an all-clear.
    expect(frame).toContain("WORK  tasks 3 of 5  truncated");
    expect(frame).not.toContain("CURRENT WORK");
    expect(frame).not.toContain("No open, in_progress, or blocked task in the returned records.");
  });

  it("reconciles a successful refresh by selected id and drops stale detail", () => {
    const before = stateAt(
      context({
        openTasks: [task("task_keep_alpha", "open", "Alpha"), task("task_keep_beta", "open", "Beta")],
      }),
      "work",
    );
    let state = reduceDashboardKey(before, "j");
    expect(shownRows(state)[state.row]?.id).toBe("task_keep_beta");
    state = {
      ...state,
      detailOpen: true,
      inspected: { method: "get_task", sourceId: "task_keep_beta", record: { id: "task_keep_beta" } },
    };

    // The refreshed page reorders the rows; the id survives at a new index.
    const loaded = context({
      openTasks: [
        task("task_keep_gamma", "open", "Gamma"),
        task("task_keep_beta", "open", "Beta"),
        task("task_keep_alpha", "open", "Alpha"),
      ],
    });
    const kept = reconcileAfterLoad(state, loaded, "2026-10-16T12:15:00.000Z");
    expect(kept.context).toBe(loaded);
    expect(kept.refreshedAt).toBe("2026-10-16T12:15:00.000Z");
    expect(shownRows(kept)[kept.row]?.id).toBe("task_keep_beta");
    expect(kept.row).toBe(1);
    expect(kept.detailOpen).toBe(true);
    expect(kept.inspected?.sourceId).toBe("task_keep_beta");

    // The refreshed page no longer carries the id: top row, no stale detail.
    const missing = context({ openTasks: [task("task_keep_gamma", "open", "Gamma")] });
    const dropped = reconcileAfterLoad(kept, missing, "2026-10-16T12:30:00.000Z");
    expect(dropped.row).toBe(0);
    expect(dropped.detailOpen).toBe(false);
    expect(dropped.inspected).toBeUndefined();
    const frame = renderDashboard(dropped, 120, 36);
    expect(frame).toContain("task_keep_gamma");
    expect(frame).not.toContain("get_task  task_keep_beta");
  });

  it("preserves the filter and filterMode across p, tab, j/k, enter, ?, and refresh", () => {
    let state = stateAt(workContext(), "work");
    state = reduceDashboardKey(state, "/");
    state = type(state, "task_work");
    state = reduceDashboardKey(state, "enter");
    const filter = state.filter;

    for (const key of ["p", "tab", "j", "k", "enter", "?"]) {
      state = reduceDashboardKey(state, key);
      expect(state.filter, `filter after ${key}`).toBe(filter);
      expect(state.filterMode, `filterMode after ${key}`).toBe(false);
    }
    const loaded = context({ openTasks: [task("task_work_alpha", "open", "Alpha task")] });
    state = reconcileAfterLoad(state, loaded, "2026-10-16T12:45:00.000Z");
    expect(state.filter).toBe(filter);
    expect(state.filterMode).toBe(false);
  });

  it("keeps the q-quit guarantee and the new footer on one line at 80 and 120 columns", () => {
    const state = stateAt(workContext(), "work");
    const narrow = renderDashboard(state, 80, 24).split("\n");
    const wide = renderDashboard(state, 120, 36).split("\n");
    expect(narrow).toContain(COMPACT_FOOTER);
    expect(wide).toContain(FULL_FOOTER);
    expect(narrow[narrow.length - 1]).toBe(COMPACT_FOOTER);
    expect(wide[wide.length - 1]).toBe(FULL_FOOTER);
    expect(narrow.join("\n")).toContain("q quit");
    for (const line of narrow) expect(line.length).toBeLessThanOrEqual(80);
    for (const line of wide) expect(line.length).toBeLessThanOrEqual(120);
  });
});

describe("NAV-001 chunked input", () => {
  it("splits a coalesced burst into its keys instead of dropping it", () => {
    // A pty can deliver a scripted burst as one chunk; the whole-chunk matcher
    // silently ignored "\t\tq" and the dashboard never quit.
    expect(normalizeInputChunk("\t\tq")).toEqual(["tab", "tab", "q"]);
    expect(normalizeInputChunk("\t\t\tq")).toEqual(["tab", "tab", "tab", "q"]);
    expect(normalizeInputChunk("jj")).toEqual(["j", "j"]);
    expect(normalizeInputChunk("?/")).toEqual(["?", "/"]);
  });

  it("keeps single-key semantics for lone keys and ctrl-c", () => {
    expect(normalizeInputChunk("q")).toEqual(["q"]);
    expect(normalizeInputChunk("\t")).toEqual(["tab"]);
    expect(normalizeInputChunk("\u0003")).toEqual(["\u0003"]);
    // ctrl-c wins wherever it appears in the chunk, like the reducer's rule.
    expect(normalizeInputChunk("x\u0003y")).toEqual(["\u0003"]);
    expect(normalizeInputChunk("\r\n")).toEqual(["enter"]);
    expect(normalizeInputChunk("\r")).toEqual(["enter"]);
    expect(normalizeInputChunk("\u007f")).toEqual(["\u007f"]);
    expect(normalizeInputChunk("\u0008")).toEqual(["\u007f"]);
  });

  it("never leaks terminal escape sequences as characters", () => {
    expect(normalizeInputChunk("\u001b")).toEqual(["\u001b"]);
    expect(normalizeInputChunk("\u001b[A")).toEqual([]);
    expect(normalizeInputChunk("\u001b[Z")).toEqual([]); // shift-tab
    expect(normalizeInputChunk("\u001bq")).toEqual([]); // alt chord
    // "b" is the page-back key, so the letters inside the word are recognized.
    // The chunk is still not two tab keys.
    expect(normalizeInputChunk("tab tab")).toEqual(["b", "b"]);
  });

  it("strips escape sequences without swallowing the bytes after them", () => {
    expect(stripEscapeSequences("\u001b[Aj")).toBe("j");
    expect(stripEscapeSequences("ab\u001b[Zc")).toBe("abc");
    expect(stripEscapeSequences("\u001bqj")).toBe("j");
    expect(stripEscapeSequences("\u001b")).toBe("\u001b");
    expect(stripEscapeSequences("")).toBe("");
    expect(stripEscapeSequences("plain")).toBe("plain");
  });

  it("keeps scanning after an unknown ESC-led sequence instead of dropping the chunk", () => {
    // An unknown ESC chord followed by real keys: the trailing keys survive.
    expect(normalizeInputChunk("\u001bqj")).toEqual(["j"]);
    expect(normalizeInputChunk("jj\u001b[Ak")).toEqual(["j", "j", "k"]);
    // A sequence between typed characters never reads as esc mid-chunk.
    expect(normalizeInputChunk("j\u001b[Aj")).toEqual(["j", "j"]);
    // The chord itself is still never leaked.
    expect(normalizeInputChunk("\u001bq")).toEqual([]);
  });

  it("replays coalesced bursts to the same state as one-at-a-time keys", () => {
    let burst = createDashboardState({ workspaceId: "ws_nav001_lab", actorId: "hum_nav001_ana", actorType: "human" });
    for (const key of normalizeInputChunk("\t\tq")) burst = reduceDashboardKey(burst, key);
    let single = createDashboardState({ workspaceId: "ws_nav001_lab", actorId: "hum_nav001_ana", actorType: "human" });
    for (const key of ["tab", "tab", "q"]) single = reduceDashboardKey(single, key);
    expect(burst.section).toBe(single.section);
    expect(burst.section).toBe("work");
    expect(burst.quit).toBe(true);
    expect(single.quit).toBe(true);

    let refs = createDashboardState({ workspaceId: "ws_nav001_lab", actorId: "hum_nav001_ana", actorType: "human" });
    for (const key of normalizeInputChunk("\t\t\t")) refs = reduceDashboardKey(refs, key);
    expect(refs.section).toBe("decisions");
  });
});

describe("workspace list", () => {
  it("opens a list on w, moves only list rows, and enter requests a switch", () => {
    let state = stateFor(context());
    expect(state.section).toBe("overview");
    state = reduceDashboardKey(state, "w");
    expect(state.workspaceListOpen).toBe(true);
    expect(state.workspaceListRequest).toEqual({ generation: state.generation });
    state = applyWorkspaceChoices(state, [
      { id: "ws_nav", name: "Navigator\u001b[31m lab" },
      { id: "ws_other", name: "Other workspace" },
    ]);
    expect(state.workspaceChoices[0]?.name).toBe("Navigator lab");
    state = reduceDashboardKey(state, "j");
    expect(state.workspaceListRow).toBe(1);
    expect(state.row).toBe(0);
    expect(state.section).toBe("overview");
    const frame = renderDashboard(state, 100, 24);
    expect(frame).toContain("WORKSPACES");
    expect(frame).toContain("Other workspace");
    expect(frame).not.toContain("\u001b");
    expect(frame).not.toContain("Navigator\u001b");
    state = reduceDashboardKey(state, "enter");
    expect(state.workspaceListOpen).toBe(false);
    expect(state.workspaceSwitchId).toBe("ws_other");
    const switched = fulfillWorkspaceSwitch(
      {
        ...state,
        section: "people",
        boundedReads: true,
        taskPage: {
          items: [],
          total: 0,
          returned: 0,
          truncated: false,
          pageNumber: 1,
          readAt: "2026-10-16T00:00:00.000Z",
          cursorStack: [],
          stale: false,
        },
        detailOpen: true,
        history: { open: true, objectType: "task", objectId: "task_work_alpha", row: 0 },
      },
      "ws_other",
    );
    expect(switched.workspaceId).toBe("ws_other");
    expect(switched.section).toBe("people");
    expect(switched.taskPage).toBeUndefined();
    expect(switched.peoplePage).toBeUndefined();
    expect(switched.history).toBeUndefined();
    expect(switched.detailOpen).toBe(false);
    expect(switched.refreshRequested).toBe(true);
    expect(switched.peoplePageRequest?.pageNumber).toBe(1);
  });

  it("closes the workspace list on esc before history and before a filter", () => {
    let state = reduceDashboardKey(stateFor(context()), "w");
    state = {
      ...state,
      filter: "alpha",
      history: { open: true, objectType: "task", objectId: "task_work_alpha", row: 0 },
    };
    state = reduceDashboardKey(state, "esc");
    expect(state.workspaceListOpen).toBe(false);
    expect(state.history?.open).toBe(true);
    expect(state.filter).toBe("alpha");
    state = reduceDashboardKey(state, "esc");
    expect(state.history).toBeUndefined();
    expect(state.filter).toBe("alpha");
    state = reduceDashboardKey(state, "esc");
    expect(state.filter).toBe("");
  });

  it("notes that the workspace list is unavailable without throwing", () => {
    const opened = reduceDashboardKey(stateFor(context()), "w");
    const noted = unavailableWorkspaceList(opened);
    expect(noted.workspaceListOpen).toBe(false);
    expect(noted.workspaceListRequest).toBeUndefined();
    const frame = renderDashboard(noted, 100, 24);
    expect(frame).toContain("The workspace list is unavailable.");
  });
});
