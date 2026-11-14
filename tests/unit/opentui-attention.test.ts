import { afterEach, describe, expect, it, vi } from "vitest";
import { attentionCompactSummaryLines, attentionCueRowText, attentionDetailLines, attentionSummaryLines, cuesFor, attentionCount, attentionLines, initialAttention, readAttention } from "../../tui/src/attention.js";
import { postCall } from "../../tui/src/client.js";

function fixture(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: "ws_a", orientationCursor: "cf1.initial", nextCursor: "fa1.more", returned: 2,
    coverage: { completeUnderRules: false, perSource: [{ reason: "action_proposal_awaiting_review", total: 103, scanned: 100, truncated: true }] },
    cues: [
      { id: "fac1:a", audience: "you", reason: "action_proposal_awaiting_review", subjectType: "action_proposal", subjectId: "p1", summary: "Proposal recorded", relatedIds: [] },
      { id: "fac1:b", audience: "team", reason: "assigned_open_task", subjectType: "task", subjectId: "t1", summary: "Task recorded", relatedIds: [] },
    ],
    catchUp: { status: "not_requested", changedCount: 0, examined: 0, affectedIds: [], tipAdvanced: false, affectedTruncated: false },
    ...overrides,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("OpenTUI FAC-001 attention", () => {
  it("preserves order, source coverage and page-scoped counts", async () => {
    const call = vi.fn(async () => ({ ok: true as const, result: fixture() }));
    const state = await readAttention(initialAttention("ws_a"), call);
    expect(call).toHaveBeenCalledWith("get_workspace_attention", { workspaceId: "ws_a", limit: 100 });
    expect(state.baseline).toBe("cf1.initial");
    const text = attentionLines(state).join("\n");
    expect(text.indexOf("fac1:a")).toBeLessThan(text.indexOf("fac1:b"));
    expect(text).toContain("scanned 100 of 103; scan limit reached.");
    expect(text).toContain("More cues exist beyond this page.");
    expect(attentionCount(state)).toBe("1+ (more pages or incomplete coverage)");
  });

  it("advances partial and complete catch-up baselines without continuation cursor", async () => {
    const first = await readAttention(initialAttention("ws_a"), async () => ({ ok: true, result: fixture() }));
    const call = vi.fn(async () => ({ ok: true as const, result: fixture({ catchUp: { status: "partial", changedCount: 101, examined: 100, affectedIds: [], tipAdvanced: true, affectedTruncated: true, toCursor: "cf1.partial" } }) }));
    const partial = await readAttention(first, call);
    expect(call).toHaveBeenCalledWith("get_workspace_attention", { workspaceId: "ws_a", limit: 100, since: "cf1.initial" });
    expect(partial.baseline).toBe("cf1.partial");
    expect(attentionLines(partial).join("\n")).toContain("100 examined on this page");
    expect(attentionLines(partial).join("\n")).toContain("The workspace advanced while reading.");
    const done = await readAttention(partial, async () => ({ ok: true, result: fixture({ catchUp: { status: "complete", changedCount: 101, examined: 1, affectedIds: [], tipAdvanced: false, affectedTruncated: false, toCursor: "cf1.done" } }) }));
    expect(done.baseline).toBe("cf1.done");
    expect(attentionSummaryLines(done).join(" ")).toContain("Caught up. 101 changed in this interval; 1 examined on this page.");
    expect(attentionSummaryLines(done).join(" ")).not.toContain("cf1.done");
    expect(attentionDetailLines(done).join(" ")).toContain("Catch-up cursor: cf1.done");
    expect(attentionSummaryLines(partial).join(" ")).toContain("partial; more changes exist");
    expect(attentionSummaryLines(partial).join(" ")).toContain("Affected list is truncated");
    expect(attentionDetailLines(partial).join(" ")).toContain("cf1.partial");
  });

  it("shows a readable cue row without identifiers, keeping them in details", () => {
    const cue = fixture().cues[0] as never as Parameters<typeof attentionCueRowText>[0];
    const row = attentionCueRowText(cue);
    expect(row).toContain("Proposal awaiting review by an owner");
    expect(row).toContain("Proposal recorded");
    expect(row).not.toContain("fac1:a");
  });

  it("keeps every warning visible in a bounded compact summary", async () => {
    const state = await readAttention(initialAttention("ws_a"), async () => ({ ok: true, result: fixture({
      cues: [],
      coverage: { completeUnderRules: false, perSource: [
        { reason: "assigned_open_task", total: 101, scanned: 100, truncated: true },
        { reason: "action_proposal_awaiting_review", skipped: "workspace_not_active" },
      ] },
      catchUp: { status: "partial", changedCount: 101, examined: 100, affectedIds: [], tipAdvanced: true, affectedTruncated: true, toCursor: "cf1.partial" },
    }) }));
    const lines = attentionCompactSummaryLines(state);
    expect(lines.length).toBeLessThanOrEqual(3);
    const text = lines.join(" ");
    for (const phrase of ["coverage is incomplete", "scan limit reached", "source skipped", "more cues on another page", "partial", "101 changed", "100 examined", "workspace advanced", "affected list truncated"]) expect(text).toContain(phrase);
    const details = attentionDetailLines(state).join(" ");
    expect(details).toContain("scanned 100 of 101");
    expect(details).toContain("skipped (workspace_not_active)");
  });

  it("discards results on denial, never prints raw errors, and labels fallback", async () => {
    const first = await readAttention(initialAttention("ws_a"), async () => ({ ok: true, result: fixture() }));
    const denied = await readAttention(first, async () => ({ ok: false, error: "Unauthorized", message: "secret" }));
    expect(denied.baseline).toBeUndefined();
    expect(attentionLines(denied, ["old workspace row"]).join(" ")).not.toMatch(/secret|old workspace row/);
    const failed = await readAttention(first, async () => ({ ok: false, error: "Conflict", message: "secret" }));
    expect(failed.baseline).toBeUndefined();
    expect(attentionLines(failed, ["old list"]).join(" ")).toContain("Showing the older list.");
    expect(attentionLines(failed, ["old list"]).join(" ")).not.toContain("secret");
    const mismatch = await readAttention(first, async () => ({ ok: true, result: fixture({ workspaceId: "ws_other" }) }));
    expect(mismatch.status).toBe("denied");
    expect(mismatch.result).toBeUndefined();
    expect(mismatch.baseline).toBeUndefined();
    expect(attentionLines(mismatch, ["old list"]).join(" ")).not.toContain("old list");
    const missing = await readAttention(first, async () => ({ ok: true, result: fixture({ workspaceId: undefined }) }));
    expect(missing.status).toBe("denied");
    expect(missing.baseline).toBeUndefined();
  });

  it("shows the ahead-of-tip error and clears the catch-up baseline", async () => {
    const first = await readAttention(initialAttention("ws_a"), async () => ({ ok: true, result: fixture() }));
    const ahead = await readAttention(first, async () => ({ ok: false, error: "ValidationError", message: "since is ahead of the current contribution tip" }));
    expect(ahead.baseline).toBeUndefined();
    expect(ahead.status).toBe("cursor_error");
    expect(attentionLines(ahead, ["fallback"]).join(" ")).toContain("ahead of the workspace tip");
    expect(attentionLines(ahead, ["fallback"]).join(" ")).toContain("fallback");
  });

  it("discloses skipped coverage without calling complete coverage incomplete", async () => {
    const state = await readAttention(initialAttention("ws_a"), async () => ({ ok: true, result: fixture({ nextCursor: undefined, cues: [], coverage: { completeUnderRules: true, perSource: [{ reason: "action_proposal_awaiting_review", skipped: "workspace_not_active" }] } }) }));
    const text = attentionLines(state).join("\n");
    expect(text).toContain("No recorded cue matches these rules.");
    expect(text).toContain("skipped (workspace_not_active)");
    expect(text).not.toContain("Coverage: incomplete");
  });

  it("treats non-JSON auth failures as refusals and redacts bearer tokens in errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad proxy", { status: 403 })));
    expect(await postCall("http://localhost", "secret", "get_workspace_attention", {})).toMatchObject({ ok: false, error: "Unauthorized" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false, error: "Conflict", message: "secret exposed" }), { status: 409 })));
    expect(await postCall("http://localhost", "secret", "get_workspace_attention", {})).toMatchObject({ ok: false, message: "Campfire request failed" });
  });

  it("never treats a non-success HTTP response as a successful read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, result: fixture() }), { status: 500 })));
    expect(await postCall("http://localhost", "secret", "get_workspace_attention", {})).toMatchObject({ ok: false, message: "Campfire HTTP 500: request failed" });
  });
});

describe("OpenTUI perspective filter", () => {
  const result = fixture() as never as Parameters<typeof cuesFor>[0];
  it("filters by audience in server order", () => {
    const many = { ...(result as object), cues: [
      { id: "1", audience: "team" }, { id: "2", audience: "you" }, { id: "3", audience: "team" }, { id: "4", audience: "you" },
    ] } as never as Parameters<typeof cuesFor>[0];
    expect(cuesFor(many, "mine").map((c) => c.id)).toEqual(["2", "4"]);
    expect(cuesFor(many, "team").map((c) => c.id)).toEqual(["1", "3"]);
  });
  it("says the active view is empty when only the other audience has cues", () => {
    const onlyTeam = { ...(result as object), cues: [{ id: "1", audience: "team" }] };
    const state = { ...initialAttention("ws"), status: "ready", result: onlyTeam } as never as Parameters<typeof attentionSummaryLines>[0];
    expect(attentionSummaryLines(state, "mine")[0]).toContain("No you cue on this page");
    expect(attentionSummaryLines(state, "team").join("\n")).not.toContain("No team cue");
  });
  it("returns empty when nothing matches or no result", () => {
    expect(cuesFor(undefined, "mine")).toEqual([]);
    expect(cuesFor({ ...(result as object), cues: [] } as never, "team")).toEqual([]);
  });
});
