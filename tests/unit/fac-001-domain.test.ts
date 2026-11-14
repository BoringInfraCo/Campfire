/**
 * FAC-001 phase A: pure derivation core (D1 cue grammar, D3 order and
 * determinism, D4 cursor and pagination, D10 privacy of summaries). No store,
 * clock, filesystem or network.
 */
import { describe, expect, it } from "vitest";
import {
  ATTENTION_REASONS,
  ATTENTION_RESPONSE_MAX_BYTES,
  ATTENTION_SCAN_CEILING,
  attentionBlock,
  attentionCueId,
  audienceFor,
  compareAttentionCues,
  decodeAttentionCursor,
  deriveAttention,
  encodeAttentionCursor,
  foldMemoryHealthCues,
  validateAttentionLimit,
  type AttentionAuthority,
  type AttentionCursorBinding,
  type AttentionCatchUp,
  type AttentionCue,
  type AttentionSnapshot,
  type DeriveAttentionInput,
} from "../../src/domain/attention.js";
import type { MemoryHealthRows } from "../../src/domain/memory-health.js";

const NOW = "2026-11-10T10:15:00.000Z";
const NOT_REQUESTED: AttentionCatchUp = { status: "not_requested", changedCount: 0, examined: 0, affectedIds: [], affectedTruncated: false, tipAdvanced: false };
const EMPTY_ROWS: MemoryHealthRows = { decisions: [], findings: [], tasks: [], proposals: [] };
const scan = <T>(rows: T[], total = rows.length) => ({ total, rows });

function authority(over: Partial<AttentionAuthority> = {}): AttentionAuthority {
  return { role: "member", canDecisionUpdate: true, canTaskUpdate: true, reviewEligible: false, workspaceStatus: "active", ...over };
}
function snapshot(over: Partial<AttentionSnapshot> = {}): AttentionSnapshot {
  return {
    memoryHealth: EMPTY_ROWS,
    assignedBlocked: scan([]),
    assignedOpen: scan([]),
    unassignedBlocked: scan([]),
    teamBlocked: scan([]),
    proposedDecisions: scan([]),
    awaitingReview: scan([]),
    ...over,
  };
}
function input(over: Partial<DeriveAttentionInput> = {}): DeriveAttentionInput {
  return {
    workspaceId: "ws_1",
    who: { actorType: "human", actorId: "hum_1" },
    authority: authority(),
    limit: 25,
    observedAt: NOW,
    contributionTip: 7,
    orientationCursor: "cf1.x",
    snapshot: snapshot(),
    catchUp: NOT_REQUESTED,
    ...over,
  };
}
const task = (id: string, updatedAt = "2026-11-10T09:00:00.000Z", title = `Title ${id}`) => ({ id, title, updatedAt });

describe("FAC-001 cue id and identity (D1)", () => {
  it("builds the literal length-prefixed id and stays injective for multibyte ids", () => {
    expect(attentionCueId("assigned_open_task", "task", "task_a")).toBe("fac1:18:assigned_open_task4:task6:task_a");
    // "é" is 2 bytes: the prefix is a byte length, so these two never collide.
    const a = attentionCueId("assigned_open_task", "task", "é");
    const b = attentionCueId("assigned_open_task", "task", "e");
    expect(a).toBe("fac1:18:assigned_open_task4:task2:é");
    expect(a).not.toBe(b);
    // A crafted id that imitates the grammar cannot collide with a different triple.
    expect(attentionCueId("assigned_open_task", "task", "x4:task1:y")).not.toBe(attentionCueId("assigned_open_task", "task", "x"));
  });

  it("serializes identityKey as the JSON array [reason, subjectType, subjectId] (A2.10)", () => {
    const result = deriveAttention(input({ snapshot: snapshot({ unassignedBlocked: scan([task("t1")]) }) }));
    expect(JSON.stringify(result.cues[0]!.identityKey)).toBe('["unassigned_blocked_task","task","t1"]');
  });
});

describe("FAC-001 audience matrix (F4, F12, 4.2, 4.3)", () => {
  const cases: Array<[string, Partial<AttentionAuthority>, Record<string, "you" | "team">]> = [
    ["human owner, active", { role: "owner", reviewEligible: true }, { action_proposal_awaiting_review: "you", assigned_blocked_task: "you", proposed_decision_actionable: "you", assigned_open_task: "you" }],
    ["human member (not owner)", {}, { action_proposal_awaiting_review: "team", assigned_blocked_task: "you", proposed_decision_actionable: "you", assigned_open_task: "you" }],
    ["agent (never a you review cue)", { role: "agent" }, { action_proposal_awaiting_review: "team", assigned_blocked_task: "you", proposed_decision_actionable: "you", assigned_open_task: "you" }],
    ["viewer", { role: "viewer", canDecisionUpdate: false, canTaskUpdate: false }, { action_proposal_awaiting_review: "team", assigned_open_task: "team" }],
    ["owner in a non-active workspace", { role: "owner", reviewEligible: false, workspaceStatus: "completed" }, { action_proposal_awaiting_review: "team", assigned_blocked_task: "you" }],
  ];
  for (const [name, over, expected] of cases) {
    it(name, () => {
      const a = authority(over);
      for (const [reason, audience] of Object.entries(expected)) expect(audienceFor(reason as any, a), reason).toBe(audience);
      for (const reason of ["action_outcome_unknown", "accepted_decision_needs_review", "current_finding_has_contradicting_evidence", "unassigned_blocked_task", "team_blocked_task", "blocked_task_missing_context", "team_proposed_decision"] as const) {
        expect(audienceFor(reason, a)).toBe("team");
      }
    });
  }

  it("a viewer's proposed decisions are team_proposed_decision, never you; a member's are actionable only", () => {
    const rows = scan([{ id: "d1", summary: "S", updatedAt: "2026-11-10T09:00:00.000Z" }]);
    const viewer = deriveAttention(input({ authority: authority({ role: "viewer", canDecisionUpdate: false, canTaskUpdate: false }), snapshot: snapshot({ proposedDecisions: rows }) }));
    expect(viewer.cues.map((c) => [c.reason, c.audience])).toEqual([["team_proposed_decision", "team"]]);
    const member = deriveAttention(input({ snapshot: snapshot({ proposedDecisions: rows }) }));
    expect(member.cues.map((c) => [c.reason, c.audience])).toEqual([["proposed_decision_actionable", "you"]]);
    // The other reason is a zero entry, never a missing one (A2.1).
    expect(member.coverage.perSource.find((e) => e.reason === "team_proposed_decision")).toEqual({ reason: "team_proposed_decision", total: 0, scanned: 0, truncated: false });
  });

  it("ignores an assigned-blocked scan for a caller without task:update (no stale input becomes a you cue)", () => {
    const r = deriveAttention(input({ authority: authority({ canTaskUpdate: false }), snapshot: snapshot({ assignedBlocked: scan([task("t1")]) }) }));
    expect(r.cues).toEqual([]);
    expect(r.coverage.perSource.find((e) => e.reason === "assigned_blocked_task")).toEqual({ reason: "assigned_blocked_task", total: 0, scanned: 0, truncated: false });
  });
});

describe("FAC-001 envelope and coverage (A2.1, A2.6, F13)", () => {
  it("has the closed field list, rulesEvaluated and exactly 11 perSource entries in order", () => {
    const r = deriveAttention(input());
    expect(Object.keys(r)).toEqual(["schemaVersion", "orderingVersion", "rulesEvaluated", "workspaceId", "observedAt", "contributionTip", "orientationCursor", "coverage", "total", "returned", "truncated", "cues", "catchUp"]);
    expect(r.rulesEvaluated).toEqual([...ATTENTION_REASONS]);
    expect(r.coverage.perSource.map((e) => e.reason)).toEqual([...ATTENTION_REASONS]);
    expect(r.coverage.perSource).toHaveLength(11);
    expect(r.coverage.perSource.every((e) => e.total === 0 && e.scanned === 0 && e.truncated === false)).toBe(true);
    expect(r.coverage.completeUnderRules).toBe(true);
    expect(r.nextCursor).toBeUndefined();
  });

  it("records the review skip in a non-active workspace and keeps completeUnderRules true (F13)", () => {
    const r = deriveAttention(input({ authority: authority({ workspaceStatus: "archived" }), snapshot: snapshot({ awaitingReview: scan([{ id: "p1", updatedAt: NOW, expiresAt: NOW }]) }) }));
    expect(r.cues).toEqual([]); // no review cue in a non-active workspace
    expect(r.coverage.perSource[0]).toEqual({ reason: "action_proposal_awaiting_review", skipped: "workspace_not_active" });
    expect(r.coverage.completeUnderRules).toBe(true);
  });

  it("scan-ceiling truncation: total > scanned sets truncated and completeUnderRules false; byte-short does not", () => {
    const rows = Array.from({ length: ATTENTION_SCAN_CEILING }, (_, i) => task(`t${String(i).padStart(3, "0")}`));
    const r = deriveAttention(input({ limit: 100, snapshot: snapshot({ unassignedBlocked: scan(rows, 105) }) }));
    const entry = r.coverage.perSource.find((e) => e.reason === "unassigned_blocked_task")!;
    expect(entry).toEqual({ reason: "unassigned_blocked_task", total: 105, scanned: 100, truncated: true });
    expect(r.coverage.completeUnderRules).toBe(false);
    expect(r.total).toBe(100);
    expect(r.truncated).toBe(false); // page-level truncated is nextCursor presence only
  });
});

describe("FAC-001 order (D3, fac-1)", () => {
  it("orders by block, then sourceUpdatedAt descending by parsed time, subject type, subject id UTF-8, cue id", () => {
    const r = deriveAttention(
      input({
        authority: authority({ role: "owner", reviewEligible: true }),
        snapshot: snapshot({
          awaitingReview: scan([{ id: "p1", updatedAt: "2026-11-10T09:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z" }]),
          assignedOpen: scan([task("a", "2026-11-10T09:00:00.000Z")]),
          unassignedBlocked: scan([task("b", "2026-11-10T08:00:00.000Z"), task("c", "2026-11-10T08:00:00.000Z"), task("z", "2026-11-10T09:30:00.000Z"), task("é", "2026-11-10T08:00:00.000Z")]),
          teamBlocked: scan([task("t", "2026-11-10T09:59:00.000Z")]),
        }),
      }),
    );
    expect(r.cues.map((c) => `${c.audience}:${c.reason}:${c.subjectId}`)).toEqual([
      "you:action_proposal_awaiting_review:p1",
      "you:assigned_open_task:a",
      "team:unassigned_blocked_task:z",
      "team:unassigned_blocked_task:b",
      "team:unassigned_blocked_task:c",
      "team:unassigned_blocked_task:é",
      "team:team_blocked_task:t",
    ]);
  });

  it("every (audience, reason) pair is its own block and you-blocks precede team-blocks", () => {
    const blocks = ATTENTION_REASONS.map((r) => attentionBlock(r, "you"));
    const teamBlocks = ATTENTION_REASONS.map((r) => attentionBlock(r, "team"));
    expect(Math.max(...blocks)).toBeLessThan(Math.min(...teamBlocks));
    expect(new Set([...blocks, ...teamBlocks]).size).toBe(22);
  });

  it("compares sourceUpdatedAt by parsed time, not by string", () => {
    const mk = (t: string): AttentionCue => ({ id: t, identityKey: ["team_blocked_task", "task", t], audience: "team", reason: "team_blocked_task", subjectType: "task", subjectId: t, relatedIds: [], sourceUpdatedAt: t, summary: "" });
    expect(compareAttentionCues(mk("2026-11-10T09:00:00.5Z"), mk("2026-11-10T09:00:00.000Z"))).toBeLessThan(0);
  });

  it("is byte-identical for the same input, and expired flips only through observedAt", () => {
    const base = input({ authority: authority({ role: "owner", reviewEligible: true }), snapshot: snapshot({ awaitingReview: scan([{ id: "p1", updatedAt: "2026-11-10T09:00:00.000Z", expiresAt: "2026-11-10T10:30:00.000Z" }]) }) });
    expect(JSON.stringify(deriveAttention(base))).toBe(JSON.stringify(deriveAttention(base)));
    expect(deriveAttention(base).cues[0]!.expired).toBe(false);
    expect(deriveAttention({ ...base, observedAt: "2026-11-10T10:30:00.001Z" }).cues[0]!.expired).toBe(true);
    expect(deriveAttention({ ...base, observedAt: "2026-11-10T10:30:00.000Z" }).cues[0]!.expired).toBe(false); // strictly greater
    const other = deriveAttention({ ...base, observedAt: "2026-11-10T12:00:00.000Z" });
    expect(other.cues.map((c) => c.id)).toEqual(deriveAttention(base).cues.map((c) => c.id));
    expect(deriveAttention(input({ snapshot: snapshot({ unassignedBlocked: scan([task("t1")]) }) })).cues[0]).not.toHaveProperty("expired");
  });
});

describe("FAC-001 memory-health fold (A1.8, CS-01, F5)", () => {
  const T = (n: number) => `2026-11-10T09:0${n}:00.000Z`;
  it("folds N receipts of one proposal into one cue: sorted union relatedIds, max sourceUpdatedAt (synthetic rows)", () => {
    const rows: MemoryHealthRows = {
      ...EMPTY_ROWS,
      proposals: [
        {
          id: "p1",
          status: "submission_unknown",
          revision: 3,
          taskId: "task_z",
          reservationId: "resv_a",
          createdAt: T(0),
          updatedAt: T(1),
          receipts: [
            { id: "rcp_2", outcome: "unknown", recordedAt: T(5) },
            { id: "rcp_1", outcome: "unknown", recordedAt: T(3) },
            { id: "rcp_3", outcome: "reconciled", recordedAt: T(8) },
          ],
        },
      ],
    };
    const folded = foldMemoryHealthCues(rows);
    expect(folded).toHaveLength(1);
    expect(folded[0]).toMatchObject({ reason: "action_outcome_unknown", subjectId: "p1", triggerCount: 2, sourceUpdatedAt: T(5) });
    expect(folded[0]!.relatedIds).toEqual(["rcp_1", "rcp_2", "resv_a", "task_z"]);
    const r = deriveAttention(input({ snapshot: snapshot({ memoryHealth: rows }) }));
    expect(r.cues).toHaveLength(1);
    expect(r.coverage.perSource.find((e) => e.reason === "action_outcome_unknown")).toEqual({ reason: "action_outcome_unknown", total: 1, scanned: 1, truncated: false });
  });

  it("sourceUpdatedAt is the max over decision updatedAt, citation createdAt and finding time (decision updated after the newest trigger)", () => {
    const rows: MemoryHealthRows = {
      ...EMPTY_ROWS,
      decisions: [
        {
          id: "d1",
          status: "accepted",
          createdAt: T(0),
          updatedAt: T(9),
          citations: [
            { id: "cit_a", findingId: "f_a", createdAt: T(2), findingCurrentness: "superseded", findingCreatedAt: T(1) },
            { id: "cit_b", findingId: "f_b", createdAt: T(4), findingCurrentness: "withdrawn", findingCreatedAt: T(1), findingCorrectedAt: T(3) },
            { id: "cit_c", findingId: "f_c", createdAt: T(5), findingCurrentness: "current", findingCreatedAt: T(1) },
          ],
        },
      ],
    };
    const [cue] = foldMemoryHealthCues(rows);
    expect(cue).toMatchObject({ triggerCount: 2, sourceUpdatedAt: T(9) });
    expect(cue!.relatedIds).toEqual(["cit_a", "cit_b", "f_a", "f_b"]); // the current finding's citation is not a trigger
  });

  it("never emits summary text that carries record bodies (A2.2, D10)", () => {
    const rows: MemoryHealthRows = { ...EMPTY_ROWS, tasks: [{ id: "task_1", status: "blocked", description: null, assigneeId: null, createdAt: T(0), updatedAt: T(1) }] };
    const r = deriveAttention(input({ snapshot: snapshot({ memoryHealth: rows, awaitingReview: scan([{ id: "p9", updatedAt: T(1), expiresAt: T(2) }]) }), authority: authority({ role: "owner", reviewEligible: true }) }));
    for (const cue of r.cues) expect(cue.summary).toMatch(/^[A-Za-z ]+ [A-Za-z0-9_]+ /);
    expect(r.cues.find((c) => c.reason === "blocked_task_missing_context")!.summary).toBe("Blocked Task task_1 has no recorded description or assignee.");
    expect(r.cues.find((c) => c.reason === "action_proposal_awaiting_review")!.summary).toBe("ActionProposal p9 is proposed and awaiting review.");
  });

  it("keeps the ATT-001 summary strings (task title, decision summary)", () => {
    const r = deriveAttention(input({ snapshot: snapshot({ assignedOpen: scan([task("t1", NOW, "Write the doc")]), proposedDecisions: scan([{ id: "d1", summary: "Adopt X", updatedAt: NOW }]) }) }));
    expect(r.cues.map((c) => c.summary).sort()).toEqual(["Adopt X", "Write the doc"]);
  });
});

describe("FAC-001 pagination, byte budget and cursor (D4)", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => task(`t${String(i).padStart(3, "0")}`, `2026-11-10T09:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}.000Z`));
  function traverse(limit: number, snap: AttentionSnapshot): { pages: ReturnType<typeof deriveAttention>[] } {
    const pages: ReturnType<typeof deriveAttention>[] = [];
    let cursor: string | undefined;
    do {
      const decoded = cursor === undefined ? undefined : decodeAttentionCursor(cursor, { workspaceId: "ws_1", actorType: "human", actorId: "hum_1", limit });
      const page = deriveAttention(input({ limit, snapshot: snap, ...(decoded === undefined ? {} : { cursor: decoded }) }));
      pages.push(page);
      cursor = page.nextCursor;
    } while (cursor !== undefined);
    return { pages };
  }

  it("exact tail has no nextCursor and no empty trailing page; truncated equals nextCursor presence", () => {
    const snap = snapshot({ unassignedBlocked: scan(many(4)) });
    const { pages } = traverse(2, snap);
    expect(pages.map((p) => p.returned)).toEqual([2, 2]);
    expect(pages.map((p) => p.truncated)).toEqual([true, false]);
    expect(pages[1]!.nextCursor).toBeUndefined();
    expect(pages.every((p) => p.total === 4)).toBe(true);
  });

  it("limit 1 concatenation equals limit 100", () => {
    const snap = snapshot({ unassignedBlocked: scan(many(7)), teamBlocked: scan(many(3).map((t) => ({ ...t, id: `u${t.id}` }))) });
    const one = traverse(1, snap).pages.flatMap((p) => p.cues.map((c) => c.id));
    const all = traverse(100, snap).pages.flatMap((p) => p.cues.map((c) => c.id));
    expect(one).toEqual(all);
    expect(new Set(one).size).toBe(10);
  });

  it("a page that stops on the byte budget is truncated with a nextCursor and resumes without loss", () => {
    const big = "x".repeat(9000);
    const rows = Array.from({ length: 10 }, (_, i) => task(`t${i}`, `2026-11-10T09:00:0${i}.000Z`, big));
    const snap = snapshot({ unassignedBlocked: scan(rows) });
    const { pages } = traverse(100, snap);
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) expect(Buffer.byteLength(JSON.stringify(page.cues))).toBeLessThanOrEqual(ATTENTION_RESPONSE_MAX_BYTES);
    expect(pages.flatMap((p) => p.cues).length).toBe(10);
    expect(pages[0]!.truncated).toBe(true);
    // Byte shortness is page-level only: no perSource entry is marked truncated.
    expect(pages[0]!.coverage.completeUnderRules).toBe(true);
  });

  it("a single cue over the budget is ValidationError field byteBudget", () => {
    const snap = snapshot({ unassignedBlocked: scan([task("t1", NOW, "y".repeat(ATTENTION_RESPONSE_MAX_BYTES))]) });
    expect(() => deriveAttention(input({ snapshot: snap }))).toThrowError(expect.objectContaining({ name: "ValidationError", details: { field: "byteBudget" } }));
  });

  it("the continuation clock is the cursor's observedAt", () => {
    const snap = snapshot({ unassignedBlocked: scan(many(3)) });
    const first = deriveAttention(input({ limit: 1, snapshot: snap }));
    const cursor = decodeAttentionCursor(first.nextCursor!, { workspaceId: "ws_1", actorType: "human", actorId: "hum_1", limit: 1 });
    const second = deriveAttention(input({ limit: 1, snapshot: snap, cursor, observedAt: "2030-01-01T00:00:00.000Z" }));
    expect(second.observedAt).toBe(NOW);
  });
});

describe("FAC-001 limit and cursor validation", () => {
  it("rejects, never clamps, a limit that is not an integer from 1 to 100", () => {
    expect(validateAttentionLimit(undefined)).toBe(25);
    expect(validateAttentionLimit(1)).toBe(1);
    expect(validateAttentionLimit(100)).toBe(100);
    for (const bad of [0, -1, 2.5, 101, 1000, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => validateAttentionLimit(bad), String(bad)).toThrowError(expect.objectContaining({ name: "ValidationError", details: { field: "limit" } }));
    }
  });

  const good = () =>
    encodeAttentionCursor({
      v: 1,
      ordering: "fac-1",
      workspaceId: "ws_1",
      actorType: "human",
      actorId: "hum_1",
      rules: ATTENTION_REASONS,
      limit: 5,
      observedAt: NOW,
      contributionTip: 3,
      authority: authority(),
      last: { block: 11, sourceUpdatedAt: NOW, subjectType: "task", subjectId: "t", id: "i" },
    });
  const bind: AttentionCursorBinding = { workspaceId: "ws_1", actorType: "human", actorId: "hum_1", limit: 5 };

  it("round-trips and carries no counts or ids beyond the last tuple", () => {
    const c = decodeAttentionCursor(good(), bind);
    expect(c.last.subjectId).toBe("t");
    const raw = Buffer.from(good().slice(4), "base64url").toString("utf8");
    expect(raw).not.toMatch(/total|count/);
  });

  it("binds workspace, actor, limit, rules and ordering; malformed input is field cursor", () => {
    const decode = (token: string, b = bind) => () => decodeAttentionCursor(token, b);
    const err = expect.objectContaining({ name: "ValidationError", details: { field: "cursor" } });
    expect(decode(good(), { ...bind, workspaceId: "ws_2" })).toThrowError(err);
    expect(decode(good(), { ...bind, actorId: "hum_2" })).toThrowError(err);
    expect(decode(good(), { ...bind, actorType: "agent" })).toThrowError(err);
    expect(decode(good(), { ...bind, limit: 6 })).toThrowError(err);
    expect(decode("mh1.abc")).toThrowError(err);
    expect(decode("fa1.@@@")).toThrowError(err);
    expect(decode(`fa1.${Buffer.from("[]").toString("base64url")}`)).toThrowError(err);
    const edit = (f: (o: any) => void) => {
      const o = JSON.parse(Buffer.from(good().slice(4), "base64url").toString("utf8"));
      f(o);
      return `fa1.${Buffer.from(JSON.stringify(o)).toString("base64url")}`;
    };
    expect(decode(edit((o) => (o.ordering = "fac-0")))).toThrowError(err);
    expect(decode(edit((o) => (o.rules = o.rules.slice(1))))).toThrowError(err);
    expect(decode(edit((o) => (o.rules = [...o.rules].reverse())))).toThrowError(err);
    expect(decode(edit((o) => (o.authority.canTaskUpdate = "yes")))).toThrowError(err);
    expect(decode(edit((o) => (o.contributionTip = -1)))).toThrowError(err);
    expect(decode(edit((o) => (o.last.block = 99)))).toThrowError(err);
    expect(decode(edit((o) => delete o.last))).toThrowError(err);
  });
});
