/**
 * RCL-001 frozen rcl-1 rule: normalization parity, tiers, and byte caps.
 * SQLite executes the same expression the domain normalizer describes.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { ValidationError } from "../../src/domain/errors.js";
import {
  HANDOFF_PACKET_MAX_BYTES,
  RECALL_RESPONSE_MAX_BYTES,
  RECALL_TIERS,
  capRecallResponse,
  emptyRecallSection,
  jsonByteLength,
  matchTier,
  normalizeRecallText,
  prepareRecallQuery,
  projectHandoffPacket,
  recallLimit,
  serializeHandoffPacket,
  type CampfireHandoffPacket,
  type HandoffAnchorPages,
  type HandoffRecord,
  type RecallHit,
  type RecallSection,
  type WorkspaceRecall,
} from "../../src/domain/recall.js";
import { applyMigrations } from "../../src/store/migrations.js";
import { recallNormalizeValueSql, recallSectionSql } from "../../src/store/recall-queries.js";
import { openInMemoryStore } from "../../src/store/sqlite-store.js";
import type { CampfireStore } from "../../src/store/store.js";
import type { ActorRef } from "../../src/domain/types.js";

const NOW = "2026-01-01T00:00:00.000Z";
const ACTOR: ActorRef = { actorId: "hum_1", actorType: "human" };

const closers: Array<() => void> = [];

afterEach(() => {
  while (closers.length > 0) closers.pop()?.();
});

function sqlNorm(value: string): string {
  const db = new Database(":memory:");
  closers.push(() => db.close());
  const statement = recallNormalizeValueSql();
  const row = db.prepare(statement.sql).get(value) as { norm: string };
  return row.norm;
}

function recallShell(overrides: Partial<WorkspaceRecall> = {}): WorkspaceRecall {
  return {
    schemaVersion: 1,
    orderingVersion: "rcl-1",
    ordering: { tiers: RECALL_TIERS, recency: "descending", id: "ascending" },
    query: { text: "callback", normalized: "callback" },
    workspace: { id: "ws_1", name: "Workspace", nameTruncated: false },
    generatedAt: NOW,
    sourceCursor: "cf1.source",
    sourcePosition: 1,
    current: emptyRecallSection(),
    historical: emptyRecallSection(),
    artifacts: emptyRecallSection(),
    completeness: {
      fullHistoryIncluded: false,
      responseTruncated: false,
      drillDown: "get_decision, get_finding, get_task, get_artifact, list_decisions, list_findings, list_tasks, list_artifacts",
      catchUp: "get_workspace_changes",
    },
    ...overrides,
  };
}

function hit(id: string, excerpt: string, kind: RecallHit["kind"] = "finding"): RecallHit {
  return {
    kind,
    id,
    tier: 4,
    matchedField: kind === "task" ? "title" : kind === "artifact" ? "title" : "summary",
    excerpt,
    excerptTruncated: excerpt.length > 20,
    lifecycle: kind === "artifact" ? "log" : "current",
    provenance: { createdBy: ACTOR, createdAt: NOW },
  };
}

function section(items: RecallHit[], total = items.length): RecallSection {
  return { items, total, returned: items.length, truncated: items.length < total };
}

function record(id: string, text: string, sectionName: HandoffRecord["section"] = "current"): HandoffRecord {
  return {
    section: sectionName,
    kind: sectionName === "anchor" ? "task" : "finding",
    id,
    lifecycle: sectionName === "anchor" ? "open" : "current",
    text,
    textTruncated: text.length > 20,
    provenance: { createdBy: ACTOR, createdAt: NOW },
  };
}

function anchors(openTasks: HandoffRecord[] = []): HandoffAnchorPages {
  const count = (items: HandoffRecord[]) => ({
    total: items.length,
    returned: items.length,
    truncated: false,
  });
  return {
    openTasks,
    blockedTasks: [],
    proposedDecisions: [],
    acceptedDecisions: [],
    counts: {
      openTasks: count(openTasks),
      blockedTasks: count([]),
      proposedDecisions: count([]),
      acceptedDecisions: count([]),
    },
  };
}

function packetInput(recall: WorkspaceRecall, anchorRows: HandoffAnchorPages = anchors()): {
  recall: WorkspaceRecall;
  issuer: { actorId: string; actorType: "human" };
  recipient: { actorId: string; actorType: "human" };
  anchors: HandoffAnchorPages;
} {
  return {
    recall,
    issuer: { actorId: "hum_1", actorType: "human" },
    recipient: { actorId: "hum_2", actorType: "human" },
    anchors: anchorRows,
  };
}

describe("rcl-1 normalization", () => {
  it("folds ASCII letters only and matches the SQLite expression", () => {
    const source = readFileSync(new URL("../../src/domain/recall.ts", import.meta.url), "utf8");
    const body = source.slice(
      source.indexOf("export function normalizeRecallUnits"),
      source.indexOf("export function normalizeRecallText"),
    );
    expect(body.includes(".trim(")).toBe(false);
    expect(body.includes("toLowerCase")).toBe(false);

    const cases: Array<[string, string]> = [
      ["Café", "café"],
      ["CAFÉ", "cafÉ"],
      ["Ω", "Ω"],
      ["A\tB\nC\vD\fE\rF", "a b c d e f"],
      ["\u00A0Café\u00A0", "\u00A0café\u00A0"],
      ["\u00A0\u00A0", "\u00A0\u00A0"],
      [" \u00A0 ", "\u00A0"],
      ["   ", ""],
      ["a   b", "a b"],
      ["  Callback  ", "callback"],
      ["O'Brien", "o'brien"],
      ["100%_it's", "100%_it's"],
    ];
    for (const [input, expected] of cases) {
      expect(normalizeRecallText(input)).toBe(expected);
      expect(sqlNorm(input)).toBe(expected);
    }

    expect(normalizeRecallText("Ω")).not.toBe("Ω".toLowerCase());
    expect(normalizeRecallText("CAFÉ")).not.toBe("CAFÉ".toLowerCase());
    expect(normalizeRecallText("\u00A0x\u00A0")).not.toBe("\u00A0x\u00A0".trim());

    const db = new Database(":memory:");
    closers.push(() => db.close());
    const once = db.prepare("SELECT replace(?, '  ', ' ') AS value").get("   ") as { value: string };
    expect(once.value).toBe("  ");
    expect(once.value).not.toBe(" ");

    const wide = `a${" ".repeat(70_000)}b`;
    const collapsed = normalizeRecallText(wide);
    expect(collapsed).toBe(sqlNorm(wide));
    expect(collapsed).not.toBe("a b");
    expect(collapsed.includes("  ")).toBe(true);
  });

  it("rejects empty, NUL, and overlong queries and illegal limits", () => {
    expect(recallLimit(undefined)).toBe(20);
    expect(recallLimit(1)).toBe(1);
    expect(recallLimit(50)).toBe(50);
    for (const limit of [0, -1, 1.5, 51, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => recallLimit(limit)).toThrow(ValidationError);
      try {
        recallLimit(limit);
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).details).toMatchObject({ field: "limit" });
      }
    }

    const prepared = prepareRecallQuery("  Callback  ");
    expect(prepared).toEqual({ text: "  Callback  ", normalized: "callback" });
    expect(prepareRecallQuery("a".repeat(200)).normalized).toHaveLength(200);
    // NBSP is not recall whitespace. String.trim would reject this query.
    expect(prepareRecallQuery("\u00A0").normalized).toBe("\u00A0");

    for (const query of ["", "   ", "\t\n", "a\u0000b", "a".repeat(201)]) {
      expect(() => prepareRecallQuery(query)).toThrow(ValidationError);
      try {
        prepareRecallQuery(query);
      } catch (error) {
        expect((error as ValidationError).details).toMatchObject({ field: "query" });
        expect((error as ValidationError).message).not.toContain("home-excerpt");
      }
    }
    expect(() => prepareRecallQuery(undefined as unknown as string)).toThrow(ValidationError);
    try {
      prepareRecallQuery("a\u0000b");
    } catch (error) {
      expect((error as ValidationError).message.toLowerCase()).toContain("nul");
    }
  });
});

describe("rcl-1 SQL tiers", () => {
  it("ranks exact secondary ahead of prefix primary and treats % and _ as literal", () => {
    const store: CampfireStore = openInMemoryStore();
    closers.push(() => store.close());
    store.createOrganization({ id: "org_1", name: "Org", createdAt: NOW });
    store.createTeam({ id: "team_1", organizationId: "org_1", name: "Team", createdAt: NOW });
    store.createHuman({ id: "hum_1", teamId: "team_1", displayName: "Ada", createdAt: NOW });
    store.createWorkspace({
      id: "ws_1",
      teamId: "team_1",
      name: "Workspace",
      status: "active",
      createdBy: ACTOR,
      createdAt: NOW,
      updatedAt: NOW,
    });

    const ranked = [
      { id: "task_t0_new", title: "callback", description: "zzz", updatedAt: "2026-06-01T00:00:00.000Z", tier: 0 },
      { id: "task_t0_a", title: "callback", description: "zzz", updatedAt: "2026-03-01T00:00:00.000Z", tier: 0 },
      { id: "task_t0_b", title: "callback", description: "zzz", updatedAt: "2026-03-01T00:00:00.000Z", tier: 0 },
      { id: "task_t0_old", title: "callback", description: "zzz", updatedAt: "2026-01-01T00:00:00.000Z", tier: 0 },
      { id: "task_case", title: "Callback", description: "zzz", updatedAt: "2020-01-01T00:00:00.000Z", tier: 0 },
      { id: "task_t1", title: "plain", description: "callback", updatedAt: "2026-09-01T00:00:00.000Z", tier: 1 },
      { id: "task_t2", title: "callback extra", description: "zzz", updatedAt: "2026-08-01T00:00:00.000Z", tier: 2 },
      { id: "task_t3", title: "aa", description: "callback extra", updatedAt: "2026-07-01T00:00:00.000Z", tier: 3 },
      { id: "task_t4", title: "xx callback", description: "zzz", updatedAt: "2026-05-01T00:00:00.000Z", tier: 4 },
      { id: "task_t5", title: "qq", description: "xx callback", updatedAt: "2026-04-01T00:00:00.000Z", tier: 5 },
    ];
    for (const row of ranked) {
      store.createTask({
        id: row.id,
        workspaceId: "ws_1",
        title: row.title,
        description: row.description,
        status: "open",
        createdBy: ACTOR,
        createdAt: row.updatedAt,
        updatedAt: row.updatedAt,
      });
      expect(matchTier(row.title, row.description, "callback")).toEqual({
        tier: row.tier,
        field: row.tier % 2 === 0 ? "primary" : "secondary",
      });
    }
    store.createTask({
      id: "task_spaces",
      workspaceId: "ws_1",
      title: "call   back",
      status: "open",
      createdBy: ACTOR,
      createdAt: NOW,
      updatedAt: NOW,
    });
    store.createTask({
      id: "task_nbsp",
      workspaceId: "ws_1",
      title: "call\u00A0back",
      status: "open",
      createdBy: ACTOR,
      createdAt: NOW,
      updatedAt: NOW,
    });
    store.createTask({
      id: "task_pct",
      workspaceId: "ws_1",
      title: "100%_done",
      status: "open",
      createdBy: ACTOR,
      createdAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z",
    });
    store.createTask({
      id: "task_x",
      workspaceId: "ws_1",
      title: "100X_done",
      status: "open",
      createdBy: ACTOR,
      createdAt: "2026-03-02T00:00:00.000Z",
      updatedAt: "2026-03-02T00:00:00.000Z",
    });
    store.createTask({
      id: "task_us",
      workspaceId: "ws_1",
      title: "a_b",
      status: "open",
      createdBy: ACTOR,
      createdAt: "2026-04-02T00:00:00.000Z",
      updatedAt: "2026-04-02T00:00:00.000Z",
    });
    store.createTask({
      id: "task_axb",
      workspaceId: "ws_1",
      title: "axb",
      status: "open",
      createdBy: ACTOR,
      createdAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
    });
    store.createGoal({
      id: "goal_1",
      workspaceId: "ws_1",
      title: "Callback",
      description: "keep\u00A0this",
      status: "active",
      createdBy: ACTOR,
      createdAt: NOW,
      updatedAt: NOW,
    });

    const expected = [...ranked].sort(
      (left, right) => left.tier - right.tier || right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id),
    );
    const page = store.recallSection("ws_1", "current", { normalizedQuery: "callback", limit: 20 });
    expect(page.items.map((item) => item.id)).toEqual(expected.map((row) => row.id));
    expect(page.items.map((item) => item.tier)).toEqual(expected.map((row) => row.tier));
    expect(page.total).toBe(expected.length);
    const ids = page.items.map((item) => item.id);
    expect(ids.indexOf("task_t1")).toBeLessThan(ids.indexOf("task_t2"));
    expect(page.items.find((item) => item.id === "task_t0_a")?.id.localeCompare("task_t0_b")).toBeLessThan(0);

    const spaced = store.recallSection("ws_1", "current", {
      normalizedQuery: normalizeRecallText("call   back"),
      limit: 20,
    });
    expect(spaced.items.map((item) => item.id)).toContain("task_spaces");
    expect(spaced.items.map((item) => item.id)).not.toContain("task_nbsp");

    const percent = store.recallSection("ws_1", "current", { normalizedQuery: "%", limit: 20 });
    expect(percent.items.map((item) => item.id)).toEqual(["task_pct"]);
    const hundred = store.recallSection("ws_1", "current", { normalizedQuery: "100%", limit: 20 });
    expect(hundred.items.map((item) => item.id)).toEqual(["task_pct"]);
    const hundredX = store.recallSection("ws_1", "current", {
      normalizedQuery: normalizeRecallText("100X"),
      limit: 20,
    });
    expect(hundredX.items.map((item) => item.id)).toEqual(["task_x"]);
    const underscore = store.recallSection("ws_1", "current", { normalizedQuery: "_", limit: 20 });
    expect(underscore.items.map((item) => item.id)).toEqual(["task_us", "task_x", "task_pct"]);
    const literal = store.recallSection("ws_1", "current", { normalizedQuery: "a_b", limit: 20 });
    expect(literal.items.map((item) => item.id)).toEqual(["task_us"]);

    expect(store.recallGoal("ws_1", "callback")?.matched).toBe(true);
    expect(store.recallGoal("ws_1", "keep this")?.matched).toBe(false);

    const listed = recallSectionSql("ws_1", "artifacts", { normalizedQuery: "callback", limit: 20 });
    expect(listed.sql).toContain("LIMIT");
    expect(listed.sql).toContain("workspace_id");
    expect(listed.sql).not.toContain("uri_or_path");
    expect(listed.sql).not.toContain("metadata");
    expect(listed.sql).not.toContain("payload");
    expect(listed.sql).not.toContain("LIKE");

    const db = new Database(":memory:");
    closers.push(() => db.close());
    applyMigrations(db);
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${listed.sql}`).all(...(listed.params as never[]));
    expect(plan.length).toBeGreaterThan(0);
  });
});

describe("recall and handoff byte caps", () => {
  it("refuses a header over 64 KiB and truncates on record boundaries without excerpts", () => {
    expect(HANDOFF_PACKET_MAX_BYTES).toBe(64 * 1024);
    const hugeQuery = "Q".repeat(70_000);
    let returned: CampfireHandoffPacket | undefined;
    const headerRecall = recallShell({ query: { text: hugeQuery, normalized: hugeQuery } });
    expect(() => {
      returned = projectHandoffPacket(packetInput(headerRecall));
    }).toThrow(ValidationError);
    expect(returned).toBeUndefined();
    try {
      projectHandoffPacket(packetInput(headerRecall));
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).details).toEqual({ field: "packet" });
      expect((error as ValidationError).message).not.toContain(hugeQuery);
    }

    const openTasks = [
      record("anchor_kept", "kept-anchor", "anchor"),
      record("anchor_drop", `ANCHOR-LEAK-${"y".repeat(80_000)}`, "anchor"),
    ];
    const recall = recallShell({
      current: section([
        hit("rec_kept", "kept-record"),
        hit("rec_drop", `EXCERPT-LEAK-${"z".repeat(80_000)}`),
      ]),
    });
    const packet = projectHandoffPacket(packetInput(recall, anchors(openTasks)));
    const serialized = JSON.stringify(packet);
    expect(Buffer.byteLength(serialized, "utf8")).toBeLessThanOrEqual(HANDOFF_PACKET_MAX_BYTES);
    expect(packet.anchors.openTasks.map((row) => row.id)).toEqual(["anchor_kept"]);
    expect(packet.records.map((row) => row.id)).toEqual(["rec_kept"]);
    expect(packet.omissions).toEqual([
      "anchors.openTasks: 1 not included",
      "records: 1 not included",
    ]);
    expect(serialized).not.toContain("ANCHOR-LEAK");
    expect(serialized).not.toContain("EXCERPT-LEAK");
    expect(packet.omissions.join("\n")).not.toContain("ANCHOR-LEAK");
    expect(packet.omissions.join("\n")).not.toContain("EXCERPT-LEAK");
    const roundTrip = serializeHandoffPacket(packet);
    expect(JSON.parse(roundTrip)).toEqual(packet);
    expect(Buffer.byteLength(roundTrip, "utf8")).toBeLessThanOrEqual(HANDOFF_PACKET_MAX_BYTES);

    const oversized = {
      ...packet,
      records: [record("too_big", "x".repeat(HANDOFF_PACKET_MAX_BYTES + 1))],
    };
    expect(() => serializeHandoffPacket(oversized)).toThrow(ValidationError);
  });

  it("drops artifacts, then historical, then current to fit 48 KiB", () => {
    expect(RECALL_RESPONSE_MAX_BYTES).toBe(48 * 1024);
    const small = recallShell({
      current: section([hit("c", "ok")]),
      historical: section([hit("h", "ok")]),
      artifacts: section([hit("a", "ok", "artifact")]),
    });
    const unchanged = capRecallResponse(small, () => "cursor");
    expect(unchanged.completeness.responseTruncated).toBe(false);
    expect(unchanged.current.items.map((item) => item.id)).toEqual(["c"]);
    expect(unchanged.historical.items.map((item) => item.id)).toEqual(["h"]);
    expect(unchanged.artifacts.items.map((item) => item.id)).toEqual(["a"]);

    const recall = recallShell({
      current: section([hit("current_kept", "c".repeat(1_000))]),
      historical: section([
        hit("historical_0", "h".repeat(30_000)),
        hit("historical_1", "h".repeat(30_000)),
      ]),
      artifacts: section([
        hit("artifact_0", "a".repeat(30_000), "artifact"),
        hit("artifact_1", "a".repeat(30_000), "artifact"),
      ]),
    });
    const capped = capRecallResponse(recall, (name, item) => `cursor:${name}:${item.id}`);
    expect(jsonByteLength(capped)).toBeLessThanOrEqual(RECALL_RESPONSE_MAX_BYTES);
    expect(capped.completeness.responseTruncated).toBe(true);
    expect(capped.artifacts.items).toEqual([]);
    expect(capped.artifacts.total).toBe(2);
    expect(capped.artifacts.returned).toBe(0);
    expect(capped.artifacts.truncated).toBe(true);
    expect(capped.artifacts.nextCursor).toBeUndefined();
    // One 30 KiB historical hit still fits after the artifact section is dropped.
    expect(capped.historical.items.map((item) => item.id)).toEqual(["historical_0"]);
    expect(capped.historical.total).toBe(2);
    expect(capped.historical.returned).toBe(1);
    expect(capped.historical.truncated).toBe(true);
    expect(capped.historical.nextCursor).toBe("cursor:historical:historical_0");
    expect(capped.current.items.map((item) => item.id)).toEqual(["current_kept"]);
    expect(capped.current.returned).toBe(capped.current.items.length);
  });
});
