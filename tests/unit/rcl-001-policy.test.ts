/**
 * RCL-001 frozen rcl-1 rule: normalization parity, tiers, and byte caps.
 * SQLite executes the same expression the domain normalizer describes.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { ValidationError } from "../../src/domain/errors.js";
import {
  DECISION_SET_LINKED_NEXT_STEP,
  DECISION_SET_UNRESOLVED_NEXT_STEP,
  HANDOFF_PACKET_MAX_BYTES,
  HANDOFF_RATIONALE_MAX_BYTES,
  RECALL_DECISION_SET_LIMIT,
  RECALL_RESPONSE_MAX_BYTES,
  RECALL_SCHEMA_VERSION,
  RECALL_TIERS,
  capRecallResponse,
  deriveDecisionSetState,
  emptyRecallSection,
  handoffDecisionSetMembers,
  jsonByteLength,
  matchTier,
  normalizeRecallText,
  prepareRecallQuery,
  projectHandoffPacket,
  recallLimit,
  recordedDecisionTransitions,
  serializeHandoffPacket,
  type CampfireHandoffPacket,
  type HandoffAnchorPages,
  type HandoffRecord,
  type RecallDecisionSet,
  type RecallDecisionSetMember,
  type RecallDecisionTransition,
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
    schemaVersion: RECALL_SCHEMA_VERSION,
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

function member(
  id: string,
  lifecycle: string,
  overrides: Partial<RecallDecisionSetMember> = {},
): RecallDecisionSetMember {
  return {
    id,
    lifecycle,
    summary: `partner callback ${id}`,
    summaryTruncated: false,
    provenance: { createdBy: ACTOR, createdAt: NOW },
    ...overrides,
  };
}

/**
 * Build a decision set the way the assembly does: transitions from the members,
 * state from the recorded transitions only. `total` past the returned members is
 * how a test says the set was cut at the limit.
 */
function decisionSet(
  members: RecallDecisionSetMember[],
  options: { total?: number; recordedTransitions?: RecallDecisionTransition[] } = {},
): RecallDecisionSet {
  const total = options.total ?? members.length;
  const truncated = members.length < total;
  const transitions = options.recordedTransitions ?? recordedDecisionTransitions(members);
  const verdict = deriveDecisionSetState({ members, recordedTransitions: transitions, truncated });
  return {
    members,
    total,
    returned: members.length,
    truncated,
    state: verdict.state,
    ...(verdict.operativeDecisionId === undefined ? {} : { operativeDecisionId: verdict.operativeDecisionId }),
    recordedTransitions: transitions,
    ...(verdict.beforeActing === undefined ? {} : { beforeActing: verdict.beforeActing }),
    ...(verdict.linkedNextStep === undefined ? {} : { linkedNextStep: verdict.linkedNextStep }),
  };
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

  it("keeps a bounded decision rationale that the query excerpt does not contain", () => {
    const rationale = "Accept the previous secret for twenty-four hours during rotation.";
    const recall = recallShell({
      current: section([hit("dec_kept", "Authenticate partner callbacks with an HMAC of the raw body.", "decision")]),
    });
    const rationales = new Map<string, string>([
      ["dec_kept", rationale],
      ["find_ignored", rationale],
    ]);
    const packet = projectHandoffPacket({
      recall,
      issuer: { actorId: "hum_1", actorType: "human" },
      recipient: { actorId: "hum_2", actorType: "human" },
      anchors: anchors([]),
      decisionRationales: rationales,
    });
    expect(packet.records).toHaveLength(1);
    expect(packet.records[0]?.text).not.toContain("twenty-four");
    expect(packet.records[0]?.rationale).toBe(rationale);
    expect(packet.records[0]?.rationaleTruncated).toBeUndefined();

    const long = "R".repeat(HANDOFF_RATIONALE_MAX_BYTES + 40);
    const truncated = projectHandoffPacket({
      recall,
      issuer: { actorId: "hum_1", actorType: "human" },
      recipient: { actorId: "hum_2", actorType: "human" },
      anchors: anchors([]),
      decisionRationales: new Map([["dec_kept", long]]),
    });
    expect(truncated.records[0]?.rationale).toBe("R".repeat(HANDOFF_RATIONALE_MAX_BYTES));
    expect(truncated.records[0]?.rationaleTruncated).toBe(true);
    expect(Buffer.byteLength(truncated.records[0]?.rationale ?? "", "utf8")).toBeLessThanOrEqual(HANDOFF_RATIONALE_MAX_BYTES);

    const finding = projectHandoffPacket({
      recall: recallShell({ current: section([hit("find_1", "a timing sample")]) }),
      issuer: { actorId: "hum_1", actorType: "human" },
      recipient: { actorId: "hum_2", actorType: "human" },
      anchors: anchors([]),
      decisionRationales: new Map([["find_1", rationale]]),
    });
    expect(finding.records[0]?.rationale).toBeUndefined();
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

  it("drops decision-set members last and re-derives a cut set as truncated", () => {
    const set = decisionSet([member("dec_kept", "accepted"), member("dec_dropped", "accepted")], {
      total: RECALL_DECISION_SET_LIMIT,
    });
    // Cut at the limit, but two accepted members still survive, so the cut
    // cannot be reported as `truncated` and the set is still unresolved.
    expect(set.state).toBe("unresolved-accepted-decisions");
    expect(set.operativeDecisionId).toBeUndefined();
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
      decisionSet: set,
    });
    const capped = capRecallResponse(recall, (name, item) => `cursor:${name}:${item.id}`);
    expect(jsonByteLength(capped)).toBeLessThanOrEqual(RECALL_RESPONSE_MAX_BYTES);
    // Sections go first. Both members survive because they are small and the set
    // is only touched once every section item is already gone.
    expect(capped.artifacts.items).toEqual([]);
    expect(capped.decisionSet?.members.map((row) => row.id)).toEqual(["dec_kept", "dec_dropped"]);
    expect(capped.decisionSet?.total).toBe(RECALL_DECISION_SET_LIMIT);
    expect(capped.decisionSet?.state).toBe("unresolved-accepted-decisions");
    expect(capped.decisionSet?.operativeDecisionId).toBeUndefined();
    expect(capped.decisionSet?.beforeActing).toBe(DECISION_SET_UNRESOLVED_NEXT_STEP);
  });

  it("re-derives a resolved set to truncated and loses its operative decision when members are dropped", () => {
    const resolved = decisionSet(
      [member("dec_old", "superseded"), member("dec_new", "accepted", { predecessorId: "dec_old" })],
      { recordedTransitions: [{ supersededDecisionId: "dec_old", supersedingDecisionId: "dec_new" }] },
    );
    expect(resolved.state).toBe("linked-accepted-decisions");
    expect(resolved.operativeDecisionId).toBe("dec_new");
    expect(resolved.beforeActing).toBeUndefined();

    // Big enough that only one member can survive the 48 KiB cap.
    const recall = recallShell({
      decisionSet: {
        ...resolved,
        members: [
          member("dec_big_0", "accepted", { summary: "s".repeat(30_000), summaryTruncated: true }),
          member("dec_big_1", "accepted", { summary: "s".repeat(30_000), summaryTruncated: true }),
        ],
        total: 2,
        truncated: false,
      },
    });
    const capped = capRecallResponse(recall, () => "cursor");
    expect(jsonByteLength(capped)).toBeLessThanOrEqual(RECALL_RESPONSE_MAX_BYTES);
    expect(capped.decisionSet?.members).toHaveLength(1);
    expect(capped.decisionSet?.returned).toBe(1);
    expect(capped.decisionSet?.truncated).toBe(true);
    // One surviving accepted member after a cut is not a resolved set.
    expect(capped.decisionSet?.state).toBe("truncated");
    expect(capped.decisionSet?.operativeDecisionId).toBeUndefined();
    expect(capped.decisionSet?.beforeActing).toBe(DECISION_SET_UNRESOLVED_NEXT_STEP);
    expect(capped.completeness.responseTruncated).toBe(true);
  });

  it("removes recorded transitions whose endpoints were dropped by the response cap", () => {
    const old = member("dec_old", "superseded", { summary: "o".repeat(30_000), successorId: "dec_new" });
    const next = member("dec_new", "accepted", { summary: "n".repeat(30_000), predecessorId: "dec_old" });
    const capped = capRecallResponse(recallShell({ decisionSet: decisionSet([old, next]) }), () => "cursor");
    expect(capped.decisionSet?.members.map((row) => row.id)).toEqual(["dec_old"]);
    expect(capped.decisionSet?.recordedTransitions).toEqual([]);
    expect(capped.decisionSet?.state).toBe("truncated");
  });
});

describe("rcl-3 decision set derivation", () => {
  it("names no accepted member as no-accepted-decision", () => {
    const verdict = deriveDecisionSetState({
      members: [member("dec_p", "proposed"), member("dec_s", "superseded")],
      recordedTransitions: [],
      truncated: false,
    });
    expect(verdict).toEqual({ state: "no-accepted-decision" });
  });

  it("names the only accepted member when no transition is recorded", () => {
    const verdict = deriveDecisionSetState({
      members: [member("dec_p", "proposed"), member("dec_a", "accepted")],
      recordedTransitions: [],
      truncated: false,
    });
    expect(verdict).toEqual({ state: "single-accepted-decision", operativeDecisionId: "dec_a" });
  });

  it("resolves two accepted members only when the successor is itself accepted", () => {
    const linked = deriveDecisionSetState({
      members: [member("dec_old", "accepted", { successorId: "dec_new" }), member("dec_new", "accepted", { predecessorId: "dec_old" })],
      recordedTransitions: [{ supersededDecisionId: "dec_old", supersedingDecisionId: "dec_new" }],
      truncated: false,
    });
    expect(linked).toEqual({
      state: "linked-accepted-decisions",
      operativeDecisionId: "dec_new",
      // The recorded transition is what tells a reader the predecessor's own
      // text is historical, so the packet must carry the sentence with it. The
      // RCL-003 S2 offline recipient never saw this prose and promoted the
      // superseded rationale into a live release condition.
      linkedNextStep: DECISION_SET_LINKED_NEXT_STEP,
    });

    // A link whose superseding end is not accepted does not resolve the old
    // accepted member or make that member a linked survivor.
    const unlinked = deriveDecisionSetState({
      members: [
        member("dec_old", "accepted", { successorId: "dec_new" }),
        member("dec_new", "superseded", { predecessorId: "dec_old" }),
      ],
      recordedTransitions: [{ supersededDecisionId: "dec_old", supersedingDecisionId: "dec_new" }],
      truncated: false,
    });
    expect(unlinked).toEqual({ state: "single-accepted-decision", operativeDecisionId: "dec_old" });
  });

  it("does not label an unrelated accepted member as the survivor of a historical link", () => {
    const verdict = deriveDecisionSetState({
      members: [
        member("dec_historical_old", "superseded"),
        member("dec_historical_new", "superseded"),
        member("dec_current", "accepted"),
      ],
      recordedTransitions: [
        { supersededDecisionId: "dec_historical_old", supersedingDecisionId: "dec_historical_new" },
      ],
      truncated: false,
    });
    expect(verdict).toEqual({ state: "single-accepted-decision", operativeDecisionId: "dec_current" });
  });

  it("refuses to resolve two accepted members with no recorded transition", () => {
    const verdict = deriveDecisionSetState({
      members: [member("dec_a", "accepted"), member("dec_b", "accepted")],
      recordedTransitions: [],
      truncated: false,
    });
    expect(verdict.state).toBe("unresolved-accepted-decisions");
    expect(verdict).not.toHaveProperty("operativeDecisionId");
    expect(verdict.beforeActing).toBe(DECISION_SET_UNRESOLVED_NEXT_STEP);
  });

  it("keeps three accepted members unresolved when only one transition is recorded", () => {
    const verdict = deriveDecisionSetState({
      members: [
        member("dec_a", "accepted", { successorId: "dec_b" }),
        member("dec_b", "accepted", { predecessorId: "dec_a" }),
        member("dec_c", "accepted"),
      ],
      recordedTransitions: [{ supersededDecisionId: "dec_a", supersedingDecisionId: "dec_b" }],
      truncated: false,
    });
    // dec_b survives the recorded transition, dec_c never took part in one.
    expect(verdict.state).toBe("unresolved-accepted-decisions");
    expect(verdict).not.toHaveProperty("operativeDecisionId");
    expect(verdict.beforeActing).toBe(DECISION_SET_UNRESOLVED_NEXT_STEP);
  });

  it("treats truncation as unresolved safety, never as a resolved set", () => {
    for (const members of [
      [member("dec_a", "accepted"), member("dec_p", "proposed")],
      [member("dec_a", "accepted")],
    ]) {
      const verdict = deriveDecisionSetState({ members, recordedTransitions: [], truncated: true });
      expect(verdict.state).toBe("truncated");
      expect(verdict).not.toHaveProperty("operativeDecisionId");
      expect(verdict.beforeActing).toBe(DECISION_SET_UNRESOLVED_NEXT_STEP);
    }
    // Two survivors after a cut is still an unresolved conflict, not truncation.
    const both = deriveDecisionSetState({
      members: [member("dec_a", "accepted"), member("dec_b", "accepted")],
      recordedTransitions: [],
      truncated: true,
    });
    expect(both.state).toBe("unresolved-accepted-decisions");
    expect(both).not.toHaveProperty("operativeDecisionId");
    expect(both.beforeActing).toBe(DECISION_SET_UNRESOLVED_NEXT_STEP);
  });

  it("derives the same state from reversed membership order and a needsReview difference", () => {
    const forward = [
      member("dec_a", "accepted", { needsReview: true, needsReviewFindingIds: ["find_1"] }),
      member("dec_b", "accepted"),
    ];
    const reversed = [
      member("dec_b", "accepted"),
      member("dec_a", "accepted", { needsReview: true, needsReviewFindingIds: ["find_1"] }),
    ];
    const left = deriveDecisionSetState({ members: forward, recordedTransitions: [], truncated: false });
    const right = deriveDecisionSetState({ members: reversed, recordedTransitions: [], truncated: false });
    expect(left).toEqual(right);
    expect(left.state).toBe("unresolved-accepted-decisions");
    expect(left).not.toHaveProperty("operativeDecisionId");

    // A newer member that needs review does not displace the older one.
    const withNewer = [
      member("dec_a", "accepted", { provenance: { createdBy: ACTOR, createdAt: "2026-01-01T00:00:00.000Z" } }),
      member("dec_b", "accepted", {
        needsReview: true,
        needsReviewFindingIds: ["find_1"],
        provenance: { createdBy: ACTOR, createdAt: "2026-09-01T00:00:00.000Z" },
      }),
    ];
    expect(deriveDecisionSetState({ members: withNewer, recordedTransitions: [], truncated: false })).toEqual(left);
  });

  it("records a transition only when both ends are members", () => {
    const inside = recordedDecisionTransitions([
      member("dec_old", "superseded", { successorId: "dec_new" }),
      member("dec_new", "accepted", { predecessorId: "dec_old" }),
    ]);
    expect(inside).toEqual([{ supersededDecisionId: "dec_old", supersedingDecisionId: "dec_new" }]);

    // Both directions of the same recorded link collapse to one pair.
    const bothDirections = recordedDecisionTransitions([
      member("dec_old", "superseded", { successorId: "dec_new" }),
      member("dec_new", "accepted", { predecessorId: "dec_old" }),
      member("dec_newer", "superseded", { successorId: "dec_new" }),
    ]);
    expect(bothDirections).toHaveLength(2);

    expect(
      recordedDecisionTransitions([
        member("dec_old", "superseded", { successorId: "dec_outside" }),
        member("dec_new", "accepted", { predecessorId: "dec_outside" }),
      ]),
    ).toEqual([]);
    expect(
      recordedDecisionTransitions([member("dec_self", "accepted", { predecessorId: "dec_self", successorId: "dec_self" })]),
    ).toEqual([]);
    expect(recordedDecisionTransitions([member("dec_lonely", "accepted")])).toEqual([]);
  });

  it("maps a set member to a current or historical handoff record, never a flattened one", () => {
    const set = decisionSet(
      [
        member("dec_a", "accepted", {
          summary: "accept the partner callback rule",
          rationale: "rotate within the window",
          predecessorId: "dec_old",
          successorId: "dec_newer",
          basisFindingIds: ["find_2"],
          needsReview: true,
          needsReviewFindingIds: ["find_1"],
          relationshipIdsTruncated: true,
        }),
        // A superseded member still has a stored rationale, and it is exactly
        // the text the RCL-003 S2 recipient promoted into a live condition.
        member("dec_b", "superseded", {
          summaryTruncated: true,
          rationale: "keep the job disabled until two clean runs",
          rationaleTruncated: true,
        }),
      ],
      { recordedTransitions: [{ supersededDecisionId: "dec_a", supersedingDecisionId: "dec_b" }] },
    );
    const rows = handoffDecisionSetMembers(set);
    expect(rows).toHaveLength(2);
    // A live member keeps `current` and its rationale: the operative rule's own
    // text is authoritative. `basisFindingIds` is carried so a member that
    // names its basis keeps it, as it does on the live projection and on records.
    expect(rows[0]).toEqual({
      section: "current",
      kind: "decision",
      id: "dec_a",
      lifecycle: "accepted",
      text: "accept the partner callback rule",
      textTruncated: false,
      provenance: { createdBy: ACTOR, createdAt: NOW },
      rationale: "rotate within the window",
      predecessorId: "dec_old",
      successorId: "dec_newer",
      basisFindingIds: ["find_2"],
      needsReview: true,
      needsReviewFindingIds: ["find_1"],
      relationshipIdsTruncated: true,
    });
    // A superseded member is historical, and its rationale is not emitted under
    // `rationale` at all: `rationale` is the field an offline reader acts on, so
    // dropping the trap is stronger than labelling it. It carries
    // `historicalExplanation` naming the decision instead.
    expect(rows[1]).toEqual({
      section: "historical",
      kind: "decision",
      id: "dec_b",
      lifecycle: "superseded",
      text: "partner callback dec_b",
      textTruncated: true,
      provenance: { createdBy: ACTOR, createdAt: NOW },
      historicalExplanation:
        "Decision dec_b is superseded. Its summary describes the former rule; its rationale is not a current condition.",
    });
    expect(rows[1]).not.toHaveProperty("rationale");
    expect(rows[1]).not.toHaveProperty("rationaleTruncated");
    expect(rows[1]?.historicalExplanation).toContain("dec_b");
    // The grouping must not erase the split the same packet already carries in
    // `records`, so a set member is never reported as its own flat section.
    expect(rows.map((row) => row.section)).toEqual(["current", "historical"]);
  });

  it("never presents a superseded decision's rationale as a live condition in the decision set", () => {
    const clause = "keep the 02:00 job disabled until two on-request releases have run with no operator escalation";
    const set = decisionSet(
      [
        member("dec_predecessor", "superseded", { rationale: clause }),
        member("dec_successor", "accepted", {
          rationale: "Adopt the replacement rule for partner callbacks.",
          predecessorId: "dec_predecessor",
        }),
      ],
      { recordedTransitions: [{ supersededDecisionId: "dec_predecessor", supersedingDecisionId: "dec_successor" }] },
    );
    const rows = handoffDecisionSetMembers(set);
    // The RCL-003 S2 failure, asserted directly: for a set holding a superseded
    // and an accepted decision, no superseded member carries a `rationale`.
    for (const row of rows.filter((entry) => entry.lifecycle === "superseded")) {
      expect(row).not.toHaveProperty("rationale");
      expect(row).not.toHaveProperty("rationaleTruncated");
    }
    // The precondition clause is unreachable anywhere inside the set projection.
    expect(JSON.stringify(rows)).not.toContain(clause);
    // It is still reachable on the accepted replacement, as its own rationale.
    expect(rows.find((row) => row.id === "dec_successor")?.rationale).toBe(
      "Adopt the replacement rule for partner callbacks.",
    );
  });

  it("carries an unresolved set into the packet with the frozen beforeActing string", () => {
    const unresolved = decisionSet([member("dec_a", "accepted"), member("dec_b", "accepted")]);
    expect(unresolved.state).toBe("unresolved-accepted-decisions");
    const packet = projectHandoffPacket(packetInput(recallShell({ decisionSet: unresolved })));
    expect(packet.schemaVersion).toBe(2);
    expect(packet.decisionSet?.state).toBe("unresolved-accepted-decisions");
    expect(packet.decisionSet?.beforeActing).toBe(DECISION_SET_UNRESOLVED_NEXT_STEP);
    expect(packet.decisionSet?.operativeDecisionId).toBeUndefined();
    expect(packet.decisionSet?.members.map((row) => row.id)).toEqual(["dec_a", "dec_b"]);
    // Both members are accepted, so both are live. The set does not merge them
    // into one flat section, and an unresolved set never carries the linked
    // sentence: there is no recorded transition to follow.
    expect(packet.decisionSet?.members.map((row) => row.section)).toEqual(["current", "current"]);
    expect(packet.decisionSet?.linkedNextStep).toBeUndefined();
    expect(packet.authority).toBe(
      "This offline copy is not a Campfire credential, not a live current-state guarantee, and not permission to execute a decision.",
    );

    const linked = decisionSet(
      [member("dec_old", "superseded", { successorId: "dec_new" }), member("dec_new", "accepted", { predecessorId: "dec_old" })],
      { recordedTransitions: [{ supersededDecisionId: "dec_old", supersedingDecisionId: "dec_new" }] },
    );
    const resolved = projectHandoffPacket(packetInput(recallShell({ decisionSet: linked })));
    expect(resolved.decisionSet?.state).toBe("linked-accepted-decisions");
    expect(resolved.decisionSet?.operativeDecisionId).toBe("dec_new");
    expect(resolved.decisionSet?.beforeActing).toBeUndefined();
    // The recorded transition replaces the ask-for-a-transition sentence with
    // the follow-the-operative-decision one.
    expect(resolved.decisionSet?.linkedNextStep).toBe(DECISION_SET_LINKED_NEXT_STEP);

    const single = projectHandoffPacket(
      packetInput(recallShell({ decisionSet: decisionSet([member("dec_only", "accepted")]) })),
    );
    expect(single.decisionSet?.state).toBe("single-accepted-decision");
    expect(single.decisionSet?.operativeDecisionId).toBe("dec_only");
    expect(single.decisionSet?.beforeActing).toBeUndefined();
    expect(single.decisionSet?.linkedNextStep).toBeUndefined();
  });

  it("carries linkedNextStep exactly when the set is linked-accepted-decisions", () => {
    const cases: Array<{ label: string; set: RecallDecisionSet; linked: boolean }> = [
      { label: "single-accepted-decision", set: decisionSet([member("dec_a", "accepted")]), linked: false },
      {
        label: "unresolved-accepted-decisions",
        set: decisionSet([member("dec_a", "accepted"), member("dec_b", "accepted")]),
        linked: false,
      },
      {
        label: "truncated",
        set: decisionSet([member("dec_a", "accepted")], { total: 3 }),
        linked: false,
      },
      {
        label: "no-accepted-decision",
        set: decisionSet([member("dec_p", "proposed"), member("dec_s", "superseded")]),
        linked: false,
      },
      {
        label: "linked-accepted-decisions",
        set: decisionSet(
          [
            member("dec_old", "superseded", { successorId: "dec_new" }),
            member("dec_new", "accepted", { predecessorId: "dec_old" }),
          ],
          { recordedTransitions: [{ supersededDecisionId: "dec_old", supersedingDecisionId: "dec_new" }] },
        ),
        linked: true,
      },
    ];
    for (const { label, set, linked } of cases) {
      expect(set.state, label).toBe(label);
      const verdict = deriveDecisionSetState({
        members: set.members,
        recordedTransitions: set.recordedTransitions,
        truncated: set.truncated,
      });
      // The frozen sentence is present exactly for the linked state, on the
      // verdict, on the assembled set, and in the offline packet. It must not
      // leak into any other state, where it would either ask for a transition
      // that is already recorded or claim a link that does not exist.
      if (linked) {
        expect(verdict.linkedNextStep, label).toBe(DECISION_SET_LINKED_NEXT_STEP);
        expect(set.linkedNextStep, label).toBe(DECISION_SET_LINKED_NEXT_STEP);
      } else {
        expect(verdict, label).not.toHaveProperty("linkedNextStep");
        expect(set, label).not.toHaveProperty("linkedNextStep");
      }
      const packet = projectHandoffPacket(packetInput(recallShell({ decisionSet: set })));
      expect(packet.decisionSet?.state, label).toBe(label);
      if (linked) {
        expect(packet.decisionSet?.linkedNextStep, label).toBe(DECISION_SET_LINKED_NEXT_STEP);
      } else {
        expect(packet.decisionSet, label).not.toHaveProperty("linkedNextStep");
      }
    }
  });

  it("fits the decision set before anchors and reports what it dropped", () => {
    const bigMember = (id: string, size: number): RecallDecisionSetMember =>
      member(id, "accepted", { summary: `${id} ${"s".repeat(size)}`, summaryTruncated: true });

    // The set fits but the set plus one anchor does not. The anchor is what the
    // cap takes: a conflict must not be the first thing dropped.
    const fits = decisionSet([bigMember("dec_a", 30_000), bigMember("dec_b", 30_000)]);
    expect(fits.state).toBe("unresolved-accepted-decisions");
    const openTasks = [record("anchor_drop", `A${"a".repeat(4_000)}`, "anchor")];
    const packet = projectHandoffPacket(packetInput(recallShell({ decisionSet: fits }), anchors(openTasks)));
    const serialized = JSON.stringify(packet);
    expect(Buffer.byteLength(serialized, "utf8")).toBeLessThanOrEqual(HANDOFF_PACKET_MAX_BYTES);
    expect(packet.decisionSet?.members.map((row) => row.id)).toEqual(["dec_a", "dec_b"]);
    expect(packet.decisionSet?.state).toBe("unresolved-accepted-decisions");
    expect(packet.decisionSet?.beforeActing).toBe(DECISION_SET_UNRESOLVED_NEXT_STEP);
    expect(packet.anchors.openTasks).toEqual([]);
    expect(packet.omissions).toEqual(["anchors.openTasks: 1 not included"]);

    // The set itself cannot fit, so a member is dropped and the kept subset is
    // re-derived rather than keeping the two-member verdict.
    const oversizedSet = decisionSet([bigMember("dec_a", 32_000), bigMember("dec_b", 32_000)]);
    const cut = projectHandoffPacket(packetInput(recallShell({ decisionSet: oversizedSet })));
    expect(Buffer.byteLength(JSON.stringify(cut), "utf8")).toBeLessThanOrEqual(HANDOFF_PACKET_MAX_BYTES);
    expect(cut.decisionSet?.members.map((row) => row.id)).toEqual(["dec_a"]);
    expect(cut.decisionSet?.total).toBe(2);
    expect(cut.decisionSet?.returned).toBe(1);
    expect(cut.decisionSet?.truncated).toBe(true);
    expect(cut.decisionSet?.state).toBe("truncated");
    expect(cut.decisionSet?.beforeActing).toBe(DECISION_SET_UNRESOLVED_NEXT_STEP);
    expect(cut.decisionSet?.operativeDecisionId).toBeUndefined();
    expect(cut.omissions).toEqual(["decisionSet: 1 not included"]);
  });

  it("removes recorded transitions whose endpoints were dropped by the packet cap", () => {
    const old = member("dec_old", "superseded", { summary: "o".repeat(33_000), successorId: "dec_new" });
    const next = member("dec_new", "accepted", { summary: "n".repeat(33_000), predecessorId: "dec_old" });
    const packet = projectHandoffPacket(packetInput(recallShell({ decisionSet: decisionSet([old, next]) })));
    expect(packet.decisionSet?.members.map((row) => row.id)).toEqual(["dec_old"]);
    expect(packet.decisionSet?.recordedTransitions).toEqual([]);
    expect(packet.decisionSet?.state).toBe("truncated");
  });

  // §4.1: truncation is never reported as safety, and §8 makes a truncated set
  // that reports itself safe a NO-GO. When every member is dropped the set has
  // zero accepted survivors, and the cap has hidden whatever came past the
  // limit, so the state must be `truncated` with `beforeActing` present.
  //
  // These currently FAIL against src/domain/recall.ts: `deriveDecisionSetState`
  // A byte cap can drop every member. The set must then report `truncated`,
  // never `no-accepted-decision`: an empty set is indistinguishable from a
  // workspace with no accepted decision, and claiming that would report safety
  // the cap destroyed. Reachable from both the 48 KiB and 64 KiB fits.
  it("reports a fully dropped recall set as truncated, never as no-accepted-decision", () => {
    const recall = recallShell({
      decisionSet: {
        ...decisionSet([member("dec_only", "accepted")]),
        members: [member("dec_only", "accepted", { summary: "s".repeat(60_000) })],
        total: 1,
        truncated: false,
      },
    });
    const capped = capRecallResponse(recall, () => "cursor");
    expect(capped.decisionSet?.members).toEqual([]);
    expect(capped.decisionSet?.truncated).toBe(true);
    expect(capped.decisionSet?.state).toBe("truncated");
    expect(capped.decisionSet?.beforeActing).toBe(DECISION_SET_UNRESOLVED_NEXT_STEP);
    expect(capped.decisionSet?.operativeDecisionId).toBeUndefined();
  });

  it("reports a fully dropped packet set as truncated, never as no-accepted-decision", () => {
    const oversized = decisionSet([
      member("dec_huge", "accepted", { summary: "h".repeat(HANDOFF_PACKET_MAX_BYTES) }),
    ]);
    const packet = projectHandoffPacket(packetInput(recallShell({ decisionSet: oversized })));
    expect(packet.decisionSet?.members).toEqual([]);
    expect(packet.decisionSet?.total).toBe(1);
    expect(packet.decisionSet?.truncated).toBe(true);
    expect(packet.decisionSet?.state).toBe("truncated");
    expect(packet.decisionSet?.beforeActing).toBe(DECISION_SET_UNRESOLVED_NEXT_STEP);
    expect(packet.omissions).toContain("decisionSet: 1 not included");
  });
});
