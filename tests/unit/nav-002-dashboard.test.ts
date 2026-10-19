/**
 * NAV-002 dashboard state: omitted participants, paged work and people,
 * record history, and stale responses.
 *
 * Pure reducer and renderer checks. No network. Not human-observation evidence.
 */
import { describe, expect, it } from "vitest";
import {
  applyHistoryPage,
  applyPeoplePage,
  applyTaskPage,
  createDashboardState,
  failHistoryRead,
  reduceDashboardChunk,
  reduceDashboardKey,
  renderDashboard,
  sectionRows,
  type DashboardState,
} from "../../src/cli/dashboard.js";
import type { ContextSlice } from "../../src/domain/context-policy.js";
import type { ActorRef, Contribution, Decision, Task } from "../../src/domain/types.js";
import type { AttentionItem, ParticipantListItem, WorkspaceContext } from "../../src/service/service.js";

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

function task(id: string, status: Task["status"], title: string): Task {
  return {
    id,
    workspaceId: "ws_nav001_lab",
    title,
    status,
    createdBy: actor("hum_nav001_ana"),
    createdAt: "2026-10-17T12:04:09.000Z",
    updatedAt: "2026-10-17T12:04:09.000Z",
  };
}

function decision(id: string, summary: string): Decision {
  return {
    id,
    workspaceId: "ws_nav001_lab",
    summary,
    status: "accepted",
    createdBy: actor("hum_nav001_ana"),
    createdAt: "2026-10-17T12:00:00.000Z",
    updatedAt: "2026-10-17T12:00:00.000Z",
  };
}

function cue(id: string, summary: string): AttentionItem {
  return { kind: "task", id, summary, status: "open", reason: "assigned_open_task" };
}

function context(partial: Partial<WorkspaceContext> = {}): WorkspaceContext {
  const workspaceId = partial.workspace?.id ?? "ws_nav001_lab";
  return {
    schemaVersion: 1,
    generatedAt: "2026-10-17T14:00:00.000Z",
    orientationCursor: "cur_nav",
    completeness: { fullHistoryIncluded: false, drillDownAvailable: true },
    slices: {
      decisions: slice(),
      findings: slice(),
      tasks: slice<Task>([], { total: 64, returned: 20, truncated: true }),
      blockers: slice(),
      artifacts: slice(),
      recentChanges: slice(),
    },
    budget: { goals: 1, decisions: 10, findings: 10, tasks: 20, blockers: 10, artifacts: 10, recentChanges: 20 },
    workspace: {
      id: workspaceId,
      teamId: "team_nav001",
      name: "nav-001 display-pressure lab",
      status: "active",
      createdBy: actor("hum_nav001_ana"),
      createdAt: "2026-10-17T12:00:00.000Z",
      updatedAt: "2026-10-17T12:00:00.000Z",
    },
    goal: {
      id: "goal_nav001_focus",
      workspaceId,
      title: "Give the terminal one focused screen over the recorded work.",
      status: "active",
      createdBy: actor("hum_nav001_ana"),
      createdAt: "2026-10-17T12:00:00.000Z",
      updatedAt: "2026-10-17T12:00:00.000Z",
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
    attentionCoverage: {
      tasks: { total: 64, returned: 20, truncated: true },
      decisions: { total: 5, returned: 5, truncated: false },
      completeUnderRules: false,
    },
    currentWork: { inProgressTasks: [], blockedTasks: [], acceptedDecisions: [] },
    suggestedNextAction: { kind: "none", summary: "", reason: "none", orientationHint: true },
    alignment: { status: "unspecified", proposedDecisionIds: [], acceptedDecisionIds: [], unresolvedBlockedTaskIds: [] },
    historicalCounts: { findings: 0, decisions: 0 },
    provenanceSummary: [],
    ...partial,
  };
}

function stateFor(value: WorkspaceContext, section: DashboardState["section"] = "attention"): DashboardState {
  return createDashboardState({
    workspaceId: value.workspace.id,
    actorId: "hum_nav001_ana",
    actorType: "human",
    context: value,
    section,
    refreshedAt: "2026-10-18T00:00:00.000Z",
  });
}

function participant(id: string, actorType: "human" | "agent", extra?: Partial<ParticipantListItem>): ParticipantListItem {
  return {
    actor: actor(id, actorType),
    name: extra?.name ?? id,
    role: extra?.role ?? (actorType === "agent" ? "agent" : "member"),
    joinedAt: extra?.joinedAt ?? "2026-10-17T12:01:41.000Z",
    ...(extra?.harness === undefined ? {} : { harness: extra.harness }),
    ...(extra?.humanOwnerId === undefined ? {} : { humanOwnerId: extra.humanOwnerId }),
    ...(extra?.humanOwnerIsParticipant === undefined ? {} : { humanOwnerIsParticipant: extra.humanOwnerIsParticipant }),
  };
}

function contribution(id: string, objectId: string, payload?: Record<string, unknown>): Contribution {
  return {
    id,
    workspaceId: "ws_nav001_lab",
    actor: actor("hum_nav001_ana"),
    action: "update",
    objectType: "decision",
    objectId,
    appendPosition: 1,
    createdAt: "2026-10-17T12:08:00.000Z",
    ...(payload === undefined ? {} : { payload }),
  };
}

const READ_AT = "2026-10-18T00:00:00.000Z";

describe("NAV-002 dashboard projection", () => {
  it("does not call an omitted participant roster zero people or the released split", () => {
    const value = context({
      participants: [
        participant("hum_hidden", "human", { name: "Hidden Person" }),
      ],
      participantsCoverage: { returned: 0, total: 57, truncated: true, omitted: true },
      needsYou: [cue("task_nav001_assigned_open_ana", "Give the terminal one focused screen")],
    });
    const frame = renderDashboard(stateFor(value), 120, 36);
    expect(frame).not.toContain("0 people");
    expect(frame).not.toContain("20 people · 37 registered agents");
    expect(frame).not.toContain("Hidden Person");
    expect(frame).toContain("57 workspace participants");
    expect(frame).toContain("human/agent split is not in this read");
    expect(frame).toContain("task_nav001_assigned_open_ana");
  });

  it("does not invent people rows when the section is selected before a page arrives", () => {
    const value = context({
      participantsCoverage: { returned: 0, total: 57, truncated: true, omitted: true },
      participants: [participant("agt_nav001_01", "agent", { name: "Agent 01" })],
    });
    let state = stateFor(value);
    while (state.section !== "people") state = reduceDashboardKey(state, "tab");
    expect(sectionRows(state)).toHaveLength(0);
    const frame = renderDashboard(state, 120, 36);
    expect(frame).not.toContain("agt_nav001_01");
    expect(frame).not.toContain("Agent 01");
    expect(frame).toContain("People page is loading");
  });

  it("does not label people page 1 as the workspace split", () => {
    const items = Array.from({ length: 20 }, (_, index) => {
      const id = `agt_nav001_${String(index + 1).padStart(2, "0")}`;
      return participant(id, "agent", { name: `Agent ${String(index + 1).padStart(2, "0")}`, harness: "codex", humanOwnerId: "hum_nav001_ana", humanOwnerIsParticipant: true });
    });
    const value = context({
      participantsCoverage: { returned: 0, total: 57, truncated: true, omitted: true },
    });
    const state = applyPeoplePage(stateFor(value, "people"), {
      items,
      total: 57,
      returned: 20,
      truncated: true,
      nextCursor: "cf1.next",
    }, { generation: 1, readAt: READ_AT, pageNumber: 1, cursorStack: [] });
    const frame = renderDashboard(state, 120, 40);
    expect(frame).toContain("agt_nav001_01");
    expect(frame).toContain("agt_nav001_20");
    expect(frame).toContain("returned 20 of 57");
    expect(frame).toContain("another page");
    expect(frame).not.toContain("20 people");
    expect(frame).not.toContain("0 people");
    expect(frame).not.toContain("37 registered agents");
    expect(frame).toContain("not the workspace human/agent split");
    expect(frame).toContain("57 workspace participants");
  });

  it("labels an outside owner from the agent row and a filtered total from that read", () => {
    const value = context({
      participantsCoverage: { returned: 0, total: 57, truncated: true, omitted: true },
    });
    const outside = applyPeoplePage(stateFor(value, "people"), {
      items: [
        participant("agt_nav001_03", "agent", {
          name: "Agent 03",
          harness: "codex",
          humanOwnerId: "hum_nav001_zed",
          humanOwnerIsParticipant: false,
        }),
      ],
      total: 57,
      returned: 1,
      truncated: true,
    }, { generation: 1, readAt: READ_AT, pageNumber: 1, cursorStack: [] });
    const outsideFrame = renderDashboard(outside, 120, 40);
    expect(outsideFrame).toContain("humanOwnerId hum_nav001_zed");
    expect(outsideFrame).toContain("owner is outside the roster");
    expect(outsideFrame).not.toContain("hum_nav001_zed  role");

    const filtered = applyPeoplePage(stateFor(value, "people"), {
      items: [
        participant("agt_nav001_01", "agent", { name: "Agent 01", harness: "codex", humanOwnerId: "hum_nav001_ana", humanOwnerIsParticipant: true }),
        participant("agt_nav001_21", "agent", { name: "Agent 21", harness: "codex", humanOwnerId: "hum_nav001_ana", humanOwnerIsParticipant: true }),
      ],
      total: 2,
      returned: 2,
      truncated: false,
    }, { generation: 1, readAt: READ_AT, pageNumber: 1, cursorStack: [], humanOwnerId: "hum_nav001_ana" });
    const filteredFrame = renderDashboard(filtered, 120, 40);
    expect(filteredFrame).toContain("WORKSPACE-PARTICIPATING AGENTS");
    expect(filteredFrame).toContain("total 2");
    expect(filteredFrame).toContain("hum_nav001_ana");
    expect(filteredFrame).not.toContain("20 people");
  });

  it("keeps n, b, and h as filter text while a filter is being typed", () => {
    const value = context({
      openTasks: [task("task_nav001_f058", "in_progress", "Filler 58"), task("task_keep", "open", "Keep")],
    });
    let state = stateFor(value, "work");
    state = reduceDashboardKey(state, "/");
    expect(state.filterMode).toBe(true);
    state = reduceDashboardKey(state, "n");
    state = reduceDashboardKey(state, "b");
    state = reduceDashboardKey(state, "h");
    expect(state.filter).toBe("nbh");
    expect(state.filterMode).toBe(true);
    expect(state.section).toBe("work");
    expect(state.taskPageRequest).toBeUndefined();
    expect(state.history).toBeUndefined();
    expect(state.row).toBe(0);
  });

  it("keeps n inside a record id when slash and the id arrive in one chunk", () => {
    const value = context({
      acceptedDecisions: [decision("dec_nav001_review", "Review the superseded finding")],
    });
    const state = stateFor(value, "decisions");
    const next = reduceDashboardChunk(state, "/dec_nav001_review\rh");
    expect(next.filter).toBe("dec_nav001_review");
    expect(next.filterMode).toBe(false);
    expect(next.section).toBe("decisions");
    expect(next.history?.objectId).toBe("dec_nav001_review");
    expect(next.history?.open).toBe(true);
    expect(next.taskPageRequest).toBeUndefined();
  });

  it("does not render a history response for a previous selection", () => {
    const value = context({
      acceptedDecisions: [decision("dec_old", "Old rule"), decision("dec_new", "New rule")],
    });
    let state = stateFor(value, "decisions");
    const opened = reduceDashboardKey(state, "h");
    expect(opened.history?.objectId).toBe("dec_old");
    const staleGeneration = opened.generation;
    state = reduceDashboardKey(reduceDashboardKey(opened, "esc"), "j");
    expect(state.history).toBeUndefined();
    expect(shownId(state)).toBe("dec_new");
    state = applyHistoryPage(
      state,
      { items: [contribution("con_old", "dec_old", { note: "old payload" })], total: 1, returned: 1, truncated: false },
      { generation: staleGeneration, readAt: READ_AT, pageNumber: 1, cursorStack: [], objectType: "decision", objectId: "dec_old" },
    );
    const frame = renderDashboard(state, 120, 40);
    expect(frame).not.toContain("con_old");
    expect(frame).not.toContain("old payload");
    expect(state.history).toBeUndefined();
  });

  it("lets an 80x24 terminal reach every contribution on a complete loaded history page", () => {
    const value = context({
      acceptedDecisions: [decision("dec_nav001_review", "Review the superseded finding")],
      participantsCoverage: { returned: 0, total: 57, truncated: true, omitted: true },
    });
    const opened = reduceDashboardKey(stateFor(value, "decisions"), "h");
    const entries = [
      contribution("con_nav001_0283", "dec_nav001_review", { summary: "cites find_nav001_superseded" }),
      contribution("con_nav001_0279", "dec_nav001_review", { status: "accepted" }),
      contribution("con_nav001_0276", "dec_nav001_review", { status: "proposed" }),
    ];
    let state = applyHistoryPage(
      opened,
      { items: entries, total: 3, returned: 3, truncated: false },
      { generation: opened.generation, readAt: READ_AT, pageNumber: 1, cursorStack: [], objectType: "decision", objectId: "dec_nav001_review" },
    );
    for (const [index, id] of entries.map((entry) => entry.id).entries()) {
      const frame = renderDashboard(state, 80, 24);
      expect(frame).toContain("returned 3 of 3");
      expect(frame).toContain(`event ${index + 1} of 3`);
      expect(frame).toContain(id);
      expect(frame).toContain("dec_nav001_review");
      expect(frame).toContain("j/k event");
      expect(frame.split("\n").length).toBeLessThanOrEqual(24);
      expect(state.historyRequest).toBeUndefined();
      if (index < 2) state = reduceDashboardKey(state, "j");
    }
    expect(state.history?.row).toBe(2);
    expect(reduceDashboardKey(state, "j").history?.row).toBe(2);
    expect(reduceDashboardKey(state, "k").history?.row).toBe(1);
    const closed = reduceDashboardKey(state, "esc");
    expect(closed.history).toBeUndefined();
    expect(shownId(closed)).toBe("dec_nav001_review");
  });

  it("uses the empty-history sentence and does not call a failed read complete", () => {
    const value = context({
      acceptedDecisions: [decision("dec_nav001_review", "Assumed the default task page returned every recorded task.")],
    });
    const opened = reduceDashboardKey(stateFor(value, "decisions"), "h");
    const empty = applyHistoryPage(
      opened,
      { items: [], total: 0, returned: 0, truncated: false },
      { generation: opened.generation, readAt: READ_AT, pageNumber: 1, cursorStack: [], objectType: "decision", objectId: "dec_nav001_review" },
    );
    const emptyFrame = renderDashboard(empty, 120, 40);
    expect(emptyFrame).toContain("No contributions recorded for this record");
    expect(emptyFrame).not.toContain("no earlier work");
    expect(emptyFrame.toLowerCase()).not.toContain("complete");

    const loaded = applyHistoryPage(
      opened,
      { items: [contribution("con_nav001_0283", "dec_nav001_review", { status: "accepted" })], total: 3, returned: 1, truncated: true },
      { generation: opened.generation, readAt: READ_AT, pageNumber: 1, cursorStack: [], objectType: "decision", objectId: "dec_nav001_review" },
    );
    const failed = failHistoryRead(loaded, loaded.generation, "denied");
    const failedFrame = renderDashboard(failed, 120, 40);
    expect(failedFrame).toContain("History is unavailable");
    expect(failedFrame.toLowerCase()).not.toContain("complete");
  });

  it("strips terminal controls from a hostile title and history payload", () => {
    const hostileTitle = "hello\u001b[2JWORLD";
    const value = context({
      acceptedDecisions: [decision("dec_nav001_review", "Review")],
    });
    const work = applyTaskPage(stateFor(value, "work"), {
      items: [task("task_nav001_hostile", "open", hostileTitle)],
      total: 64,
      returned: 1,
      truncated: true,
    }, { generation: 1, readAt: READ_AT, pageNumber: 1, cursorStack: [] });
    const workFrame = renderDashboard(work, 120, 40);
    expect(workFrame.includes("\u001b")).toBe(false);
    expect(workFrame).toContain("hello");
    expect(workFrame).toContain("WORLD");

    const opened = reduceDashboardKey(stateFor(value, "decisions"), "h");
    const history = applyHistoryPage(
      opened,
      {
        items: [contribution("con_nav001_0283", "dec_nav001_review", { note: "boom\u001b[31mRED", transcript: "secret prompt" })],
        total: 1,
        returned: 1,
        truncated: false,
      },
      { generation: opened.generation, readAt: READ_AT, pageNumber: 1, cursorStack: [], objectType: "decision", objectId: "dec_nav001_review" },
    );
    const historyFrame = renderDashboard(history, 120, 40);
    expect(historyFrame.includes("\u001b")).toBe(false);
    expect(historyFrame).toContain("boom");
    expect(historyFrame).toContain("RED");
    expect(historyFrame).not.toContain("secret prompt");
    expect(historyFrame).toContain("con_nav001_0283");
  });

  it("shows a later work page without replacing attention cues, and does not call in_progress a running process", () => {
    const value = context({
      needsYou: [cue("task_nav001_assigned_open_ana", "Focused screen")],
      openTasks: [task("task_nav001_assigned_open_ana", "open", "Focused screen")],
    });
    const work = applyTaskPage(stateFor(value, "work"), {
      items: [
        task("task_nav001_f051", "open", "Display-pressure filler task 51"),
        task("task_nav001_f058", "in_progress", "Display-pressure filler task 58"),
      ],
      total: 64,
      returned: 2,
      truncated: true,
    }, { generation: 1, readAt: READ_AT, pageNumber: 2, cursorStack: [{ pageNumber: 1 }] });
    const workFrame = renderDashboard(work, 120, 40);
    expect(workFrame).toContain("task_nav001_f051");
    expect(workFrame).toContain("page 2");
    expect(workFrame).toContain("returned 2 of 64");
    expect(workFrame).toContain("not an attention recomputation");
    expect(workFrame).not.toContain("task_nav001_assigned_open_ana");
    expect(workFrame).toContain("in_progress");
    expect(workFrame).toContain("in progress");
    expect(workFrame).toContain("not a running process");
    expect(workFrame).not.toContain("is running");
    expect(workFrame).toContain("not a consistent census");
    expect(workFrame).not.toContain("64-row census");

    const attention = renderDashboard({ ...work, section: "attention", row: 0 }, 120, 40);
    expect(attention).toContain("task_nav001_assigned_open_ana");
    expect(attention).not.toContain("task_nav001_f051");
    expect(attention).not.toContain("task_nav001_f058");
  });

  it("explains paging on attention without moving the selection", () => {
    const value = context({
      needsYou: [cue("task_one", "One"), cue("task_two", "Two")],
    });
    const state = stateFor(value);
    const next = reduceDashboardKey(state, "n");
    expect(next.row).toBe(state.row);
    expect(next.section).toBe("attention");
    expect(renderDashboard(next, 80, 24)).toContain("Paging is unavailable here.");
  });
});

function shownId(state: DashboardState): string | undefined {
  const rows = sectionRows(state);
  return rows[state.row]?.id;
}
