import { describe, expect, it } from "vitest";
import {
  ATTENTION_REASONS,
  attentionCueId,
  type AttentionCue,
  type AttentionReason,
  type AttentionResult,
  type PerSourceCoverage,
} from "../../src/domain/attention.js";
import {
  ATTENTION_VIEW_STRINGS,
  FAC_ATTENTION_REASON_LABELS,
  attentionCatchUpLines,
  attentionCoverageViewLines,
  attentionCueLines,
  attentionNeedsYouCount,
  attentionReasonText,
  renderAttentionLines,
} from "../../src/presentation/attention-view.js";

function cue(over: Partial<AttentionCue> & { reason: AttentionReason; subjectId: string }): AttentionCue {
  const subjectType = over.subjectType ?? "task";
  return {
    id: attentionCueId(over.reason, subjectType, over.subjectId),
    identityKey: [over.reason, subjectType, over.subjectId],
    audience: "you",
    subjectType,
    relatedIds: [],
    sourceUpdatedAt: "2026-11-01T00:00:00.000Z",
    summary: `summary for ${over.subjectId}`,
    ...over,
  };
}

function sources(over: Record<string, Partial<PerSourceCoverage>> = {}): PerSourceCoverage[] {
  return ATTENTION_REASONS.map((reason) => ({ reason, total: 1, scanned: 1, truncated: false, ...(over[reason] ?? {}) }));
}

function result(over: Partial<AttentionResult> = {}): AttentionResult {
  const cues = over.cues ?? [];
  return {
    schemaVersion: 1,
    orderingVersion: "fac-1",
    rulesEvaluated: [...ATTENTION_REASONS],
    workspaceId: "ws_a",
    observedAt: "2026-11-12T00:00:00.000Z",
    contributionTip: 7,
    orientationCursor: "oc.1",
    coverage: { perSource: sources(), completeUnderRules: true },
    total: cues.length,
    returned: cues.length,
    truncated: false,
    cues,
    catchUp: { status: "not_requested", changedCount: 0, examined: 0, affectedIds: [], affectedTruncated: false, tipAdvanced: false },
    ...over,
  };
}

describe("FAC-001 attention view: frozen strings are literal (A4.2)", () => {
  it("matches the contract text exactly", () => {
    expect(ATTENTION_VIEW_STRINGS.emptyComplete).toBe("No recorded cue matches these rules.");
    expect(ATTENTION_VIEW_STRINGS.emptyIncomplete).toBe(
      "No recorded cue matches these rules, but coverage is incomplete (see sources below). This does not mean nothing needs attention.",
    );
    expect(ATTENTION_VIEW_STRINGS.morePages).toBe("More cues exist beyond this page.");
    expect(FAC_ATTENTION_REASON_LABELS.action_proposal_awaiting_review).toBe("Proposal awaiting review by an owner");
    expect(ATTENTION_VIEW_STRINGS.expiredMarker).toBe("(expired)");
  });
});

describe("FAC-001 attention view: labels", () => {
  it("labels every FAC-001 reason, including the proposal wording", () => {
    for (const reason of ATTENTION_REASONS) expect(FAC_ATTENTION_REASON_LABELS[reason].length).toBeGreaterThan(0);
    expect(FAC_ATTENTION_REASON_LABELS.action_proposal_awaiting_review).toBe("Proposal awaiting review by an owner");
  });

  it("falls back to the stripped raw code for an unknown reason", () => {
    expect(attentionReasonText("future_reason\u001b[31m")).toBe("future_reason");
  });

  it("never uses urgency, priority or assignment wording", () => {
    const words = Object.values(FAC_ATTENTION_REASON_LABELS).join(" ").toLowerCase();
    for (const banned of ["urgent", "priority", "critical", "important", "asap", "assigned to you"]) {
      expect(words).not.toContain(banned);
    }
    expect(FAC_ATTENTION_REASON_LABELS.action_proposal_awaiting_review.toLowerCase()).not.toContain("you");
  });
});

describe("FAC-001 attention view: cues", () => {
  it("renders cues in server order without re-sorting or grouping", () => {
    const cues = [
      cue({ reason: "assigned_open_task", subjectId: "t3", audience: "team" }),
      cue({ reason: "assigned_blocked_task", subjectId: "t1", audience: "you" }),
      cue({ reason: "team_blocked_task", subjectId: "t2", audience: "team" }),
    ];
    const text = renderAttentionLines(result({ cues })).join("\n");
    const order = cues.map((c) => text.indexOf(c.id));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("shows audience, label, summary, subject, id and related ids", () => {
    const c = cue({ reason: "assigned_blocked_task", subjectId: "t1", relatedIds: ["r1", "r2"] });
    expect(attentionCueLines(c)).toEqual([
      "[you] Assigned task is blocked",
      "  summary for t1",
      `  task t1 · ${c.id}`,
      "  related: r1, r2",
    ]);
  });

  it("marks only an expired proposal cue, and does not assign review to the reader", () => {
    const expired = cue({ reason: "action_proposal_awaiting_review", subjectId: "p1", subjectType: "action_proposal", audience: "team", expired: true });
    const fresh = cue({ reason: "action_proposal_awaiting_review", subjectId: "p2", subjectType: "action_proposal", audience: "team", expired: false });
    expect(attentionCueLines(expired)[0]).toBe("[team] Proposal awaiting review by an owner (expired)");
    expect(attentionCueLines(fresh)[0]).toBe("[team] Proposal awaiting review by an owner");
  });

  it("strips terminal controls from every record string", () => {
    const c = cue({ reason: "assigned_open_task", subjectId: "t\u001b[2Jx", summary: "a\u0007b\nc", relatedIds: ["r\u001b]0;evil\u0007z"] });
    const out = attentionCueLines(c).join("\n");
    expect(out).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f]/);
    expect(out).toContain("ab c");
  });
});

describe("FAC-001 attention view: empty and coverage", () => {
  it("empty with complete coverage reads the complete string", () => {
    expect(renderAttentionLines(result())[0]).toBe(ATTENTION_VIEW_STRINGS.emptyComplete);
  });

  it("skipped-with-complete keeps the complete string and adds a separate skipped line, never 'incomplete'", () => {
    const r = result({
      coverage: {
        perSource: sources({ action_proposal_awaiting_review: { skipped: "workspace_not_active", total: undefined, scanned: undefined } }),
        completeUnderRules: true,
      },
    });
    const lines = renderAttentionLines(r);
    expect(lines[0]).toBe(ATTENTION_VIEW_STRINGS.emptyComplete);
    expect(lines).toContain("Proposal awaiting review by an owner: skipped (workspace_not_active).");
    expect(lines).toContain(ATTENTION_VIEW_STRINGS.coverageComplete);
    expect(lines.join("\n").toLowerCase()).not.toContain("incomplete");
  });

  it("empty with incomplete coverage reads the incomplete string and the truncated line", () => {
    const r = result({
      coverage: { perSource: sources({ assigned_open_task: { total: 250, scanned: 100, truncated: true } }), completeUnderRules: false },
    });
    const lines = renderAttentionLines(r);
    expect(lines[0]).toBe(ATTENTION_VIEW_STRINGS.emptyIncomplete);
    expect(lines).toContain("Assigned task is open: scanned 100 of 250; scan limit reached.");
    expect(lines).toContain(ATTENTION_VIEW_STRINGS.coverageIncomplete);
  });

  it("never prints an all-clear for an empty list", () => {
    for (const complete of [true, false]) {
      const text = renderAttentionLines(result({ coverage: { perSource: sources(), completeUnderRules: complete } })).join("\n").toLowerCase();
      expect(text).not.toContain("all clear");
      expect(text).not.toContain("no attention cues.");
      expect(text.replace("this does not mean nothing needs attention.", "")).not.toContain("nothing needs attention");
    }
  });

  it("adds the more-pages line only when nextCursor is present, and keeps it separate from source truncation", () => {
    const c = [cue({ reason: "assigned_open_task", subjectId: "t1" })];
    const paged = renderAttentionLines(result({ cues: c, truncated: true, nextCursor: "fa1.x" }));
    expect(paged).toContain(ATTENTION_VIEW_STRINGS.morePages);
    expect(paged).toContain(ATTENTION_VIEW_STRINGS.coverageComplete);
    const single = renderAttentionLines(result({ cues: c }));
    expect(single).not.toContain(ATTENTION_VIEW_STRINGS.morePages);
  });

  it("coverage lines list exactly the skipped and truncated sources after the verdict", () => {
    const r = result({
      coverage: {
        perSource: sources({
          team_blocked_task: { truncated: true, total: 120, scanned: 100 },
          action_proposal_awaiting_review: { skipped: "workspace_not_active" },
        }),
        completeUnderRules: false,
      },
    });
    expect(attentionCoverageViewLines(r)).toEqual([
      ATTENTION_VIEW_STRINGS.coverageIncomplete,
      "Proposal awaiting review by an owner: skipped (workspace_not_active).",
      "Team task is blocked: scanned 100 of 120; scan limit reached.",
    ]);
  });
});

describe("FAC-001 attention view: catch-up", () => {
  const base = { changedCount: 3, examined: 3, affectedIds: ["a", "b"], affectedTruncated: false, tipAdvanced: false };

  it("renders nothing when no catch-up was requested", () => {
    expect(attentionCatchUpLines(result())).toEqual([]);
  });

  it("partial is never 'caught up'", () => {
    const lines = attentionCatchUpLines(result({ catchUp: { ...base, status: "partial", toCursor: "cu.9" } }));
    expect(lines[0]).toBe("Catch-up: partial; more changes exist. 3 changed in this interval; 3 examined on this page.");
    expect(lines.join("\n")).not.toContain("Caught up");
  });

  it("complete reads caught up with the cursor, and shows affected ids", () => {
    const lines = attentionCatchUpLines(result({ catchUp: { ...base, status: "complete", toCursor: "cu.9" } }));
    expect(lines).toEqual(["Caught up to cu.9. 3 changed in this interval; 3 examined on this page.", "Affected: a, b"]);
  });

  it("renders examined (page-local) beside changedCount (interval total), for partial and complete", () => {
    const p = attentionCatchUpLines(result({ catchUp: { ...base, status: "partial", toCursor: "cu.9", changedCount: 341, examined: 100 } }));
    expect(p[0]).toBe("Catch-up: partial; more changes exist. 341 changed in this interval; 100 examined on this page.");
    const c = attentionCatchUpLines(result({ catchUp: { ...base, status: "complete", toCursor: "cu.9", changedCount: 341, examined: 41 } }));
    expect(c[0]).toBe("Caught up to cu.9. 341 changed in this interval; 41 examined on this page.");
    for (const line of [p[0], c[0]]) {
      expect(line).toContain("examined on this page");
      expect(line).not.toMatch(/examined in this interval|total examined/);
    }
  });

  it("preserves tipAdvanced and affectedTruncated", () => {
    const lines = attentionCatchUpLines(result({ catchUp: { ...base, status: "complete", toCursor: "cu.9", tipAdvanced: true, affectedTruncated: true } }));
    expect(lines).toContain("The workspace advanced while reading.");
    expect(lines).toContain("Affected list is truncated (showing 2).");
  });
});

describe("FAC-001 attention view: Needs You count", () => {
  const you = (id: string) => cue({ reason: "assigned_blocked_task", subjectId: id, audience: "you" });
  const team = (id: string) => cue({ reason: "team_blocked_task", subjectId: id, audience: "team" });

  it("is exact only when coverage is complete and no further page exists", () => {
    expect(attentionNeedsYouCount(result({ cues: [you("a"), team("b"), you("c")] }))).toEqual({ count: 2, exact: true, text: "2" });
  });

  it("is N+ when more pages exist", () => {
    const r = attentionNeedsYouCount(result({ cues: [you("a")], nextCursor: "fa1.x", truncated: true }));
    expect(r).toEqual({ count: 1, exact: false, text: "1+ (more pages or incomplete coverage)" });
  });

  it("is N+ when coverage is incomplete", () => {
    const r = attentionNeedsYouCount(result({ cues: [], coverage: { perSource: sources(), completeUnderRules: false } }));
    expect(r.text).toBe("0+ (more pages or incomplete coverage)");
  });

  it("stays exact when a source is skipped but coverage is complete (F13)", () => {
    const r = attentionNeedsYouCount(
      result({ cues: [you("a")], coverage: { perSource: sources({ action_proposal_awaiting_review: { skipped: "workspace_not_active" } }), completeUnderRules: true } }),
    );
    expect(r.exact).toBe(true);
  });
});

describe("FAC-001 attention view: purity", () => {
  it("is deterministic and does not mutate its input", () => {
    const r = result({ cues: [cue({ reason: "assigned_open_task", subjectId: "t1" })] });
    const before = JSON.stringify(r);
    expect(renderAttentionLines(r)).toEqual(renderAttentionLines(r));
    expect(JSON.stringify(r)).toBe(before);
  });
});
