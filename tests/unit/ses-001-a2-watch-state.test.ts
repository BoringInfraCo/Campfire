import { describe, expect, it } from "vitest";
import {
  clampWatchLimit,
  deriveSessionWatchState,
  isShareActive,
  parseWatchAfter,
  boundWatchText,
  projectWatchActivityItem,
} from "../../src/domain/session-watch.js";
import { ValidationError } from "../../src/domain/errors.js";
import type { Contribution } from "../../src/domain/types.js";

const NOW = "2026-11-17T12:00:00.000Z";
const BEFORE = "2026-11-17T11:59:59.999Z";
const AFTER = "2026-11-17T12:00:00.001Z";

describe("SES-001 A2 watch state mapping (server time only)", () => {
  it("is live for a non-final report with an unexpired lease", () => {
    for (const state of ["starting", "running", "stopping"] as const) {
      expect(deriveSessionWatchState({ report: { state, expiresAt: AFTER }, now: NOW })).toBe("live");
    }
  });

  it("expires exactly at the lease boundary", () => {
    expect(deriveSessionWatchState({ report: { state: "running", expiresAt: NOW }, now: NOW })).toBe("disconnected");
    expect(deriveSessionWatchState({ report: { state: "running", expiresAt: AFTER }, now: NOW })).toBe("live");
    expect(deriveSessionWatchState({ report: { state: "running", expiresAt: BEFORE }, now: NOW })).toBe("disconnected");
  });

  it("is disconnected when no report was ever accepted, or the lease is missing or unreadable", () => {
    expect(deriveSessionWatchState({ now: NOW })).toBe("disconnected");
    expect(deriveSessionWatchState({ report: { state: "running" }, now: NOW })).toBe("disconnected");
    expect(deriveSessionWatchState({ report: { state: "running", expiresAt: "garbage" }, now: NOW })).toBe("disconnected");
    expect(deriveSessionWatchState({ report: { state: "running", expiresAt: AFTER }, now: "garbage" })).toBe("disconnected");
  });

  it("is live again for a recovered host whose newer report carries a fresh lease", () => {
    const stale = { state: "running" as const, expiresAt: BEFORE };
    const recovered = { state: "running" as const, expiresAt: "2026-11-17T12:03:00.000Z" };
    expect(deriveSessionWatchState({ report: stale, now: NOW })).toBe("disconnected");
    expect(deriveSessionWatchState({ report: recovered, now: NOW })).toBe("live");
  });

  it("is ended for a final report or an ended session, whatever the lease says", () => {
    expect(deriveSessionWatchState({ report: { state: "exited" }, now: NOW })).toBe("ended");
    expect(deriveSessionWatchState({ report: { state: "failed" }, now: NOW })).toBe("ended");
    expect(deriveSessionWatchState({ endedAt: BEFORE, report: { state: "running", expiresAt: AFTER }, now: NOW })).toBe("ended");
    expect(deriveSessionWatchState({ endedAt: BEFORE, now: NOW })).toBe("ended");
  });
});

describe("SES-001 A2 watch helpers", () => {
  it("treats only an unrevoked share as active", () => {
    const base = { sessionId: "s", workspaceId: "w", sharedBy: "h", sharedAt: NOW };
    expect(isShareActive(undefined)).toBe(false);
    expect(isShareActive(base)).toBe(true);
    expect(isShareActive({ ...base, revokedAt: AFTER })).toBe(false);
  });

  it("bounds the limit and validates the cursor", () => {
    expect(clampWatchLimit(undefined)).toBe(25);
    expect(clampWatchLimit(0)).toBe(1);
    expect(clampWatchLimit(500)).toBe(50);
    expect(clampWatchLimit(7.9)).toBe(7);
    expect(parseWatchAfter(undefined)).toBe(0);
    expect(parseWatchAfter(12)).toBe(12);
    for (const bad of [-1, 1.5, "3", Number.NaN]) {
      expect(() => parseWatchAfter(bad)).toThrow(ValidationError);
    }
  });

  it("projects only type, summary, position and time from a contribution", () => {
    const contribution: Contribution = {
      id: "con_1",
      workspaceId: "w",
      actor: { actorId: "agt", actorType: "agent" },
      agentSessionId: "ses",
      action: "create",
      objectType: "finding",
      objectId: "fnd_1",
      payload: { summary: "Found it", argv: ["secret"], path: "/Users/x", cwd: "/tmp" },
      appendPosition: 4,
      createdAt: NOW,
    };
    const item = projectWatchActivityItem(contribution);
    expect(item).toEqual({ position: 4, type: "finding.create", summary: "Found it", createdAt: NOW });
    const bare = projectWatchActivityItem({ ...contribution, payload: { argv: ["x"] } });
    expect(bare.summary).toBe("create finding");
    expect(projectWatchActivityItem({ ...contribution, payload: { summary: "x".repeat(900) } }).summary).toHaveLength(240);
  });

  describe("text bounding", () => {
    const base: Contribution = {
      id: "con_1", workspaceId: "w", actor: { actorId: "agt", actorType: "agent" }, agentSessionId: "ses",
      action: "create", objectType: "finding", objectId: "fnd_1", appendPosition: 1, createdAt: NOW,
    };
    const summaryOf = (payload: Record<string, unknown>) => projectWatchActivityItem({ ...base, payload }).summary;

    it("never leaves a lone surrogate when an emoji straddles the 240 boundary", () => {
      const out = summaryOf({ summary: `${"a".repeat(239)}\u{1F600}tail` });
      expect(out).toBe("a".repeat(239));
      expect(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(out)).toBe(false);
      const fits = summaryOf({ summary: `${"a".repeat(238)}\u{1F600}tail` });
      expect(fits).toBe(`${"a".repeat(238)}\u{1F600}`);
      expect(fits).toHaveLength(240);
    });

    it("collapses control characters and newlines to single spaces and trims", () => {
      expect(summaryOf({ summary: "  one\n\ntwo\t\x1b[31mthree\u0000four\u2028five  " })).toBe("one two [31mthree four five");
      expect(boundWatchText("\r\n x \r\n")).toBe("x");
    });

    it("falls through when a payload field is not a usable string", () => {
      expect(summaryOf({ summary: 42, title: "Title wins" })).toBe("Title wins");
      expect(summaryOf({ summary: "\n\t ", title: { a: 1 }, status: "open" })).toBe("open");
      expect(summaryOf({ summary: null, title: ["x"] })).toBe("create finding");
    });
  });
});
