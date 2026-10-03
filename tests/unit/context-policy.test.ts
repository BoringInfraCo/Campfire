import { describe, expect, it } from "vitest";
import {
  affectedObjectIds,
  assembleCatchUp,
  assertCursorWorkspace,
  clampPageLimit,
  contributionCursor,
  contributionMateriality,
  decodeContextCursor,
  decisionFetchLimits,
  encodeContextCursor,
  genesisContributionCursor,
  selectRecentChanges,
  toContextSlice,
} from "../../src/domain/context-policy.js";
import { ValidationError } from "../../src/domain/errors.js";
import type { Contribution } from "../../src/domain/types.js";

const WORKSPACE = "ws_1";

function contribution(partial: Partial<Contribution> & Pick<Contribution, "id" | "action" | "objectType" | "objectId" | "createdAt">): Contribution {
  return {
    workspaceId: WORKSPACE,
    actor: { actorId: "hum_1", actorType: "human" },
    appendPosition: 1,
    ...partial,
  };
}

function cursorToken(value: unknown): string {
  return `cf1.${Buffer.from(JSON.stringify(value), "utf8").toString("base64url")}`;
}

describe("CTX-001 context policy", () => {
  it("rejects a limit above the page cap and a non-positive limit", () => {
    expect(clampPageLimit(undefined, 20)).toBe(20);
    expect(clampPageLimit(1, 20)).toBe(1);
    expect(() => clampPageLimit(0, 20)).toThrow(ValidationError);
    expect(() => clampPageLimit(101, 20)).toThrow(ValidationError);
  });

  it("marks a slice truncated only from the total, and hides the cursor when complete", () => {
    const complete = toContextSlice(["a"], 1, "cursor");
    expect(complete.truncated).toBe(false);
    expect(complete.nextCursor).toBeUndefined();
    const partial = toContextSlice(["a"], 4, "cursor");
    expect(partial).toMatchObject({ total: 4, returned: 1, truncated: true, nextCursor: "cursor" });
  });

  it("reserves one proposed decision when accepted decisions would fill a budget of at least two", () => {
    expect(decisionFetchLimits(10, { accepted: 15, proposed: 1 })).toEqual({ accepted: 9, proposed: 1 });
    expect(decisionFetchLimits(10, { accepted: 2, proposed: 20 })).toEqual({ accepted: 2, proposed: 8 });
    expect(decisionFetchLimits(1, { accepted: 5, proposed: 5 })).toEqual({ accepted: 1, proposed: 0 });
    expect(decisionFetchLimits(10, { accepted: 0, proposed: 4 })).toEqual({ accepted: 0, proposed: 4 });
  });

  it("classifies material changes and leaves session noise normal", () => {
    expect(contributionMateriality({ action: "create", objectType: "finding" })).toBe("high");
    expect(contributionMateriality({ action: "create", objectType: "artifact" })).toBe("high");
    expect(contributionMateriality({ action: "update", objectType: "goal", payload: { title: "next" } })).toBe("high");
    expect(contributionMateriality({ action: "update", objectType: "decision", payload: { status: "accepted" } })).toBe("high");
    expect(contributionMateriality({ action: "create", objectType: "decision", payload: { status: "proposed" } })).toBe("normal");
    expect(contributionMateriality({ action: "update", objectType: "task", payload: { status: "blocked" } })).toBe("high");
    expect(contributionMateriality({ action: "update", objectType: "task", payload: { status: "completed" } })).toBe("high");
    expect(contributionMateriality({ action: "update", objectType: "task", payload: { title: "rename" } })).toBe("normal");
    expect(contributionMateriality({ action: "register_session", objectType: "agent_session" })).toBe("normal");
    expect(contributionMateriality({ action: "join", objectType: "participant" })).toBe("normal");
  });

  it("round-trips an opaque cursor and rejects a foreign workspace", () => {
    const token = encodeContextCursor(genesisContributionCursor(WORKSPACE));
    const decoded = decodeContextCursor(token);
    expect(decoded).toMatchObject({ kind: "contribution", position: 0, originPosition: 0, tip: 0, phase: "high" });
    assertCursorWorkspace(decoded, WORKSPACE);
    expect(() => assertCursorWorkspace(decoded, "ws_other")).toThrow(ValidationError);
    expect(() => decodeContextCursor("con_0001")).toThrow(ValidationError);
    expect(() => decodeContextCursor("cf1.not-json")).toThrow(ValidationError);
  });

  it("round-trips contribution position, originPosition, and tip", () => {
    const cursor = contributionCursor({
      workspaceId: WORKSPACE,
      occurredAt: "2026-05-01T00:00:00.000Z",
      id: "con_9",
      phase: "normal",
      originOccurredAt: "2026-04-01T00:00:00.000Z",
      originId: "con_1",
      position: 6,
      originPosition: 2,
      tip: 10,
    });
    expect(decodeContextCursor(encodeContextCursor(cursor))).toEqual(cursor);
    if (cursor.kind !== "contribution") throw new Error("expected a contribution cursor");
    const unfrozen = contributionCursor({ ...cursor, phase: "high", position: 6, originPosition: 6, tip: 0 });
    expect(decodeContextCursor(encodeContextCursor(unfrozen))).toEqual(unfrozen);
  });

  it("rejects a contribution cursor with a missing position", () => {
    const token = cursorToken({
      v: 1,
      kind: "contribution",
      workspaceId: WORKSPACE,
      occurredAt: "",
      id: "",
      phase: "high",
      originOccurredAt: "",
      originId: "",
      originPosition: 0,
      tip: 0,
    });
    expect(() => decodeContextCursor(token)).toThrow(ValidationError);
    try {
      decodeContextCursor(token);
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).details).toMatchObject({ field: "cursor" });
    }
    expect(() =>
      decodeContextCursor(
        cursorToken({
          v: 1,
          kind: "contribution",
          workspaceId: WORKSPACE,
          occurredAt: "",
          id: "",
          phase: "high",
          originOccurredAt: "",
          originId: "",
          position: 5,
          originPosition: 1,
          tip: 4,
        }),
      ),
    ).toThrow(ValidationError);
  });

  it("returns material catch-up rows before normal rows and can page the rest", () => {
    const origin = { occurredAt: "", id: "", position: 0 };
    const high = contribution({
      id: "con_high",
      action: "create",
      objectType: "finding",
      objectId: "find_1",
      createdAt: "2026-02-01T00:00:00.000Z",
      appendPosition: 2,
      payload: { summary: "cache" },
    });
    const noise = contribution({
      id: "con_noise",
      action: "register_session",
      objectType: "agent_session",
      objectId: "ses_1",
      createdAt: "2026-01-01T00:00:00.000Z",
      appendPosition: 1,
    });
    const first = assembleCatchUp({
      workspaceId: WORKSPACE,
      fromCursor: "from",
      phase: "high",
      origin,
      tip: 4,
      high: [high],
      highHasMore: false,
      normal: [],
      normalHasMore: true,
    });
    expect(first.items.map((item) => item.objectId)).toEqual(["find_1"]);
    expect(first.hasMore).toBe(true);
    const next = decodeContextCursor(first.toCursor);
    expect(next.kind).toBe("contribution");
    if (next.kind === "contribution") expect(next.phase).toBe("normal");

    const second = assembleCatchUp({
      workspaceId: WORKSPACE,
      fromCursor: first.toCursor,
      phase: "normal",
      origin,
      tip: 4,
      high: [],
      highHasMore: false,
      normal: [noise],
      normalHasMore: false,
    });
    expect(second.items.map((item) => item.materiality)).toEqual(["normal"]);
    expect(second.hasMore).toBe(false);
    expect(affectedObjectIds([...first.items, ...second.items])).toEqual({
      decisions: [],
      findings: ["find_1"],
      tasks: [],
      artifacts: [],
    });
  });

  it("phase-switch cursor keeps the tip and restarts at originPosition", () => {
    const high = contribution({
      id: "con_high",
      action: "create",
      objectType: "finding",
      objectId: "find_1",
      createdAt: "2026-03-01T00:00:00.000Z",
      appendPosition: 8,
      payload: { summary: "cache" },
    });
    const first = assembleCatchUp({
      workspaceId: WORKSPACE,
      fromCursor: "from",
      phase: "high",
      origin: { occurredAt: "2026-01-01T00:00:00.000Z", id: "con_origin", position: 3 },
      tip: 12,
      high: [high],
      highHasMore: false,
      normal: [],
      normalHasMore: true,
    });
    expect(first.hasMore).toBe(true);
    expect(decodeContextCursor(first.toCursor)).toMatchObject({
      kind: "contribution",
      phase: "normal",
      position: 3,
      originPosition: 3,
      tip: 12,
      occurredAt: "2026-01-01T00:00:00.000Z",
      id: "con_origin",
      originOccurredAt: "2026-01-01T00:00:00.000Z",
      originId: "con_origin",
    });
  });

  it("completion cursor clears the tip and parks position on that tip", () => {
    const row = contribution({
      id: "con_done",
      action: "register_session",
      objectType: "agent_session",
      objectId: "ses_1",
      createdAt: "2026-02-01T00:00:00.000Z",
      appendPosition: 4,
    });
    const done = assembleCatchUp({
      workspaceId: WORKSPACE,
      fromCursor: "frozen",
      phase: "normal",
      origin: { occurredAt: "2026-01-01T00:00:00.000Z", id: "con_origin", position: 1 },
      tip: 9,
      high: [],
      highHasMore: false,
      normal: [row],
      normalHasMore: false,
    });
    expect(done.hasMore).toBe(false);
    expect(done.items).toHaveLength(1);
    expect(done.toCursor).not.toBe(done.items[0]?.cursor);
    expect(decodeContextCursor(done.toCursor)).toMatchObject({
      kind: "contribution",
      phase: "high",
      occurredAt: "",
      id: "",
      originOccurredAt: "",
      originId: "",
      position: 9,
      originPosition: 9,
      tip: 0,
    });
  });

  it("an empty page completes at the tip instead of echoing a frozen cursor", () => {
    const frozen = encodeContextCursor(
      contributionCursor({
        workspaceId: WORKSPACE,
        occurredAt: "2026-01-01T00:00:00.000Z",
        id: "con_1",
        phase: "high",
        originOccurredAt: "",
        originId: "",
        position: 4,
        originPosition: 0,
        tip: 6,
      }),
    );
    const done = assembleCatchUp({
      workspaceId: WORKSPACE,
      fromCursor: frozen,
      phase: "high",
      origin: { occurredAt: "", id: "", position: 0 },
      tip: 6,
      high: [],
      highHasMore: false,
      normal: [],
      normalHasMore: false,
    });
    expect(done.hasMore).toBe(false);
    expect(done.items).toEqual([]);
    expect(done.toCursor).not.toBe(frozen);
    expect(decodeContextCursor(done.toCursor)).toMatchObject({
      position: 6,
      originPosition: 6,
      tip: 0,
      phase: "high",
      id: "",
      occurredAt: "",
    });
  });

  it("prefers material rows inside a recent window without dropping them for older noise", () => {
    const noise = contribution({
      id: "con_noise",
      action: "join",
      objectType: "participant",
      objectId: "hum_1",
      createdAt: "2026-03-02T00:00:00.000Z",
    });
    const finding = contribution({
      id: "con_find",
      action: "create",
      objectType: "finding",
      objectId: "find_9",
      createdAt: "2026-03-01T00:00:00.000Z",
      payload: { summary: "stale cache" },
    });
    const selected = selectRecentChanges([noise, finding], 1, WORKSPACE);
    expect(selected).toHaveLength(1);
    expect(selected[0]?.objectId).toBe("find_9");
    expect(selected[0]?.materiality).toBe("high");
  });

  it("keeps the newest material rows when the window exceeds the budget", () => {
    const older = contribution({
      id: "con_old",
      action: "create",
      objectType: "finding",
      objectId: "find_old",
      createdAt: "2026-03-01T00:00:00.000Z",
      appendPosition: 1,
    });
    const newer = contribution({
      id: "con_new",
      action: "create",
      objectType: "finding",
      objectId: "find_new",
      createdAt: "2026-03-03T00:00:00.000Z",
      appendPosition: 2,
    });
    const selected = selectRecentChanges([older, newer], 1, WORKSPACE);
    expect(selected.map((item) => item.objectId)).toEqual(["find_new"]);
  });

  it("orders a recent-change window by append position ahead of id", () => {
    const at = "2026-04-01T00:00:00.000Z";
    const laterId = contribution({
      id: "con_a",
      action: "create",
      objectType: "finding",
      objectId: "find_a",
      createdAt: at,
      appendPosition: 2,
    });
    const earlierId = contribution({
      id: "con_z",
      action: "create",
      objectType: "finding",
      objectId: "find_z",
      createdAt: at,
      appendPosition: 1,
    });
    const selected = selectRecentChanges([laterId, earlierId], 2, WORKSPACE);
    expect(selected.map((item) => decodeContextCursor(item.cursor).id)).toEqual(["con_z", "con_a"]);
    const first = decodeContextCursor(selected[0]!.cursor);
    expect(first).toMatchObject({ kind: "contribution", position: 1, originPosition: 0, tip: 0 });
  });
});
