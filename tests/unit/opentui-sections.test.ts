import { describe, expect, it } from "vitest";
import { activityMatchesWorkspace, contributionText, coverage, detailLines, detailMatchesSelection, fallbackAttentionCoverage, fallbackAttentionRows, historyMatchesRequest, overviewRows, pageMatchesWorkspace, safe, sectionEmptyMessage, sectionRows, taskPageMatchesWorkspace } from "../../tui/src/sections.js";

describe("OpenTUI bounded sections", () => {
  it("renders bounded workspace work and reports a continued page", () => {
    const pages = {work: {items: [{id: "task_a", title: "Repair", status: "open"}], nextCursor: "next"}};
    expect(sectionRows("work", {}, pages)).toEqual([{id: "task_a", kind: "task", text: "Repair · open"}]);
    expect(coverage("work", {}, pages)).toContain("more records exist");
    expect(coverage("people", {}, pages)).toContain("not loaded");
  });

  it("shows readable rows and distinguishes loading from section-specific empty states", () => {
    expect(sectionRows("people", {}, {people: {items: [{name: "Ada", actor: {actorId: "hum_a", actorType: "human"}}]}})[0]).toEqual({id: "hum_a", kind: "participant", text: "Ada · human"});
    expect(sectionRows("references", {findings: [{id: "f1", summary: "Observed"}]}, {})[0]?.text).toBe("Observed · finding");
    expect(sectionRows("work", {}, {work: {items: [{id: "t1", status: "in_progress"}]}})[0]?.text).toBe("t1 · in progress");
    expect(sectionEmptyMessage("work", {})).toContain("load");
    expect(sectionEmptyMessage("work", {work: {items: []}})).toContain("work");
    expect(sectionEmptyMessage("references", {})).toContain("findings or artifacts");
    expect(sectionEmptyMessage("decisions", {})).toContain("decisions");
  });

  it("deduplicates context records without hiding distinct source kinds", () => {
    const context = {findings: [{id:"x", summary:"Finding"}], artifacts: [{id:"x", title:"Artifact"}], slices: {findings: {items: [{id:"x", summary:"Finding"}]}}};
    expect(sectionRows("references", context, {}).map((r) => r.kind)).toEqual(["finding", "artifact"]);
  });

  it("strips terminal controls and does not serialize private fields into details", () => {
    expect(safe("hi\u001b[31m\nthere")).not.toMatch(/[\u001b\n]/);
    expect(detailLines({id: "a", title: "A", token: "secret", uri: "/private"}).join(" ")).toBe("id: a title: A");
  });

  it("keeps both fallback audiences selectable with their canonical types and honest coverage", () => {
    const context = {
      needsYou: [{id:"task_a", kind:"task", summary:"My task", reason:"assigned_open_task"}],
      needsAttention: [{id:"decision_b", kind:"decision", summary:"Team choice", reason:"team_proposed_decision"}],
      attentionCoverage: {completeUnderRules: false},
    };
    const rows = fallbackAttentionRows(context);
    expect(rows.map((row) => [row.kind, row.id])).toEqual([["task", "task_a"], ["decision", "decision_b"]]);
    expect(rows[0]?.text).toContain("[you]");
    expect(rows[1]?.text).toContain("[team]");
    expect(rows[0]?.text).toContain("open task assigned to you");
    expect(fallbackAttentionCoverage(context)).toContain("incomplete");
    expect(fallbackAttentionCoverage({})).toContain("unavailable");
  });

  it("rejects wrong-workspace pages and wrong-workspace or wrong-id details", () => {
    expect(pageMatchesWorkspace({workspaceId:"w1", items:[{workspaceId:"w1"}]}, "w1", true)).toBe(true);
    expect(pageMatchesWorkspace({workspaceId:"w2", items:[]}, "w1", true)).toBe(false);
    expect(pageMatchesWorkspace({items:[]}, "w1", true)).toBe(false);
    expect(pageMatchesWorkspace({items:[{workspaceId:"w2"}]}, "w1", false)).toBe(false);
    expect(pageMatchesWorkspace({items:[{workspaceId:"w1"}]}, "w1", false)).toBe(true);
    expect(detailMatchesSelection({workspaceId:"w1", id:"t1"}, "w1", "t1")).toBe(true);
    expect(detailMatchesSelection({workspaceId:"w2", id:"t1"}, "w1", "t1")).toBe(false);
    expect(detailMatchesSelection({workspaceId:"w1", id:"t2"}, "w1", "t1")).toBe(false);
    expect(taskPageMatchesWorkspace({workspaceId:"w1", items:[{workspaceId:"w1"}]}, "w1")).toBe(true);
    expect(taskPageMatchesWorkspace({workspaceId:"w1", items:[{id:"task_a"}]}, "w1")).toBe(false);
    expect(activityMatchesWorkspace({items:[{workspaceId:"w1"}]}, "w1")).toBe(true);
    expect(activityMatchesWorkspace({items:[{id:"contribution_a"}]}, "w1")).toBe(false);
    const history = {workspaceId:"w1", objectType:"task", objectId:"task_a", items:[{workspaceId:"w1", objectType:"task", objectId:"task_a"}]};
    expect(historyMatchesRequest(history, "w1", "task", "task_a")).toBe(true);
    expect(historyMatchesRequest({...history, workspaceId:"w2"}, "w1", "task", "task_a")).toBe(false);
    expect(historyMatchesRequest({...history, objectId:"task_b"}, "w1", "task", "task_a")).toBe(false);
    expect(historyMatchesRequest({...history, items:[{workspaceId:"w1"}]}, "w1", "task", "task_a")).toBe(false);
    expect(coverage("work", {}, {work: {items: [{id: "task_a"}], total: 4}})).toContain("1 of 4");
    expect(contributionText({id: "cf1", action: "task.updated", actor: {actorId: "hum_a", actorType: "human"}, objectType: "task", objectId: "task_a", payload: {status: "open", note: "secret"}})).toContain("status=open");
    expect(contributionText({id: "cf1", payload: {note: "secret"}})).not.toContain("secret");
    const cues = [{id: "task_a", kind: "task", text: "[you] open · task_a"}, {id: "task_b", kind: "task", text: "[team] blocked · task_b"}];
    expect(overviewRows({openTasks: [{id: "task_a", title: "Mine", status: "open"}, {id: "task_c", title: "Other", status: "open"}], currentWork: {blockedTasks: [{id: "task_d", title: "Blocked", status: "blocked"}]}}, cues).map((row) => row.id)).toEqual(["task_a", "task_b", "task_c"]);
  });

  it("labels proposed decisions and drops context rows from another workspace", () => {
    const context = {
      workspace: { id: "ws_home" },
      proposedDecisions: [
        { id: "decision_home", summary: "Ship the label", status: "proposed", workspaceId: "ws_home" },
        { id: "decision_other", summary: "Foreign choice", status: "proposed", workspaceId: "ws_other" },
      ],
      acceptedDecisions: [{ id: "decision_unscoped", summary: "Orientation only", status: "accepted" }],
      slices: { decisions: { items: [{ id: "decision_slice", summary: "Slice foreign", status: "accepted", workspaceId: "ws_other" }] } },
      findings: [
        { id: "finding_home", summary: "Home finding", workspaceId: "ws_home" },
        { id: "finding_other", summary: "Foreign finding", workspaceId: "ws_other" },
      ],
      artifacts: [{ id: "artifact_other", title: "Foreign artifact", workspaceId: "ws_other" }],
      openTasks: [
        { id: "task_home", title: "Home task", status: "open", workspaceId: "ws_home" },
        { id: "task_other", title: "Foreign task", status: "open", workspaceId: "ws_other" },
        { id: "task_unscoped", title: "Unscoped task", status: "open" },
      ],
      currentWork: { inProgressTasks: [{ id: "task_progress_other", title: "Foreign progress", status: "in_progress", workspaceId: "ws_other" }] },
    };
    const decisions = sectionRows("decisions", context, {});
    expect(decisions.map((row) => row.id)).toEqual(["decision_home", "decision_unscoped"]);
    const proposed = decisions[0]?.text ?? "";
    expect(proposed).toContain("proposed — not accepted, not an instruction");
    expect(proposed).not.toMatch(/ · proposed · /);
    const shown = [
      ...decisions,
      ...sectionRows("references", context, {}),
      ...sectionRows("overview", context, {}),
      ...overviewRows(context, []),
    ].map((row) => row.text).join(" ");
    expect(shown).not.toContain("ws_other");
    expect(sectionRows("references", context, {}).map((row) => row.id)).toEqual(["finding_home"]);
    expect(sectionRows("overview", context, {}).map((row) => row.id)).toEqual(["task_home", "task_unscoped"]);
    const overview = overviewRows(context, []);
    expect(overview.map((row) => row.id)).toEqual(["task_home", "task_unscoped"]);
    expect(overview.map((row) => row.id)).not.toContain("task_other");
    expect(overview.map((row) => row.id)).not.toContain("task_progress_other");
    const overviewText = overview.map((row) => row.text).join(" ");
    expect(overviewText).not.toContain("ws_other");
    expect(overviewText).not.toContain("task_other");
    expect(overviewText).not.toContain("task_progress_other");
    expect(sectionRows("work", context, { work: { items: [{ id: "task_paged", title: "Paged", status: "open", workspaceId: "ws_other" }] } }).map((row) => row.id)).toEqual(["task_paged"]);
    const unknown = sectionRows("decisions", { workspace: { id: "ws_home" }, proposedDecisions: [{ id: "decision_draft", summary: "Draft", status: "drafted", workspaceId: "ws_home" }] }, {});
    expect(unknown[0]?.text).toContain("drafted");
    expect(unknown[0]?.text).not.toContain("not an instruction");
    const loose = sectionRows("decisions", { proposedDecisions: [{ id: "decision_loose", summary: "Loose", status: "proposed", workspaceId: "ws_other" }] }, {});
    expect(loose.map((row) => row.id)).toEqual(["decision_loose"]);
    expect(loose[0]?.text).not.toContain("ws_other");
  });
});
