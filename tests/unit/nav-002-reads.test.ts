import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import Database from "better-sqlite3";
import { CLI_COMMAND_NAMES } from "../../src/cli/catalog.js";
import { decodeContextCursor, encodeContextCursor, type ContextCursor } from "../../src/domain/context-policy.js";
import {
  CampfireError,
  DecisionNotFound,
  FindingNotFound,
  ParticipantRequired,
  ValidationError,
  WorkspaceNotFound,
} from "../../src/domain/errors.js";
import {
  FILLER_HUMAN_IDS,
  LAB_AGENT_IDS,
  SCENARIO,
  SERVED_AT,
  UNRELATED_FINDING_SENTINEL,
  seedDatabase,
} from "../../fixtures/navigator/nav-001/seed.js";
import { CAMPFIRE_HTTP_METHODS, dispatchCampfireMethod } from "../../src/http/dispatch.js";
import { createCampfireMcpServer } from "../../src/mcp/tools.js";
import type { ActorContext } from "../../src/service/authorization.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import type { CampfireService } from "../../src/service/service.js";
import { pageParticipantsSql, pageRecordHistorySql } from "../../src/store/context-queries.js";
import { openSqliteStore } from "../../src/store/sqlite-store.js";
import type { CampfireStore } from "../../src/store/store.js";
import { CAMPFIRE_HTTP_METHODS as ASYNC_HTTP_METHODS } from "../../src/worker/async-dispatch.js";
import { VIEWER_READ_METHODS } from "../../src/viewer/server.js";

const LAB = SCENARIO.workspaces.lab;
const REVIEW = SCENARIO.decisions.review;
const ana: ActorContext = { actor: { actorId: SCENARIO.humans.ana, actorType: "human" } };
const zed: ActorContext = { actor: { actorId: SCENARIO.humans.zed, actorType: "human" } };
const agent: ActorContext = { actor: { actorId: "agt_nav001_01", actorType: "agent" } };

let dir: string;
let store: CampfireStore;
let service: CampfireService;
const calls: string[] = [];

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nav-002-reads-"));
  const seeded = seedDatabase(dir, true);
  store = openSqliteStore(seeded.databasePath);
  for (const name of [
    "getHuman",
    "getAgent",
    "getParticipant",
    "getWorkspace",
    "getDecision",
    "getFinding",
    "getTask",
    "getArtifact",
    "pageRecordHistory",
    "maxAppendPosition",
    "pageParticipants",
    "countParticipants",
  ] as const) {
    const original = store[name].bind(store) as (...args: unknown[]) => unknown;
    (store as unknown as Record<string, (...args: unknown[]) => unknown>)[name] = (...args: unknown[]) => {
      calls.push(name);
      return original(...args);
    };
  }
  service = createCampfireService({ store, clock: () => SERVED_AT });
});

afterAll(() => {
  service?.close();
  rmSync(dir, { recursive: true, force: true });
});

function thrown(fn: () => unknown): CampfireError {
  try {
    fn();
  } catch (error) {
    if (error instanceof CampfireError) return error;
    throw error;
  }
  throw new Error("expected a Campfire error");
}

function ids(items: ReadonlyArray<{ actor: { actorId: string } }>): string[] {
  return items.map((item) => item.actor.actorId);
}

function explain(database: Database.Database, sql: string, params: readonly unknown[]): string {
  const rows = database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Array<{ detail: string }>;
  return rows.map((row) => row.detail).join("\n");
}

describe("NAV-002 bounded reads", () => {
  it("keeps HTTP and CLI catalogs unchanged while the Viewer allowlist adds the seven NAV-003 reads", () => {
    expect(ASYNC_HTTP_METHODS).toEqual([...CAMPFIRE_HTTP_METHODS]);
    expect(CAMPFIRE_HTTP_METHODS).toHaveLength(47);
    expect(CAMPFIRE_HTTP_METHODS).toEqual(
      expect.arrayContaining(["list_workspace_participants", "get_record_history"]),
    );
    expect([...VIEWER_READ_METHODS]).toEqual([
      "whoami",
      "list_workspaces",
      "get_workspace",
      "get_workspace_context",
      "get_activity",
      "list_tasks",
      "list_workspace_participants",
      "get_task",
      "get_decision",
      "get_finding",
      "get_artifact",
      "get_record_history",
    ]);
    expect(CLI_COMMAND_NAMES).toHaveLength(60);
    const listed = (source: string): string[] => {
      const match = /const VIEWER_READ_METHODS = \[([\s\S]*?)\] as const/.exec(source);
      expect(match).not.toBeNull();
      return [...match![1]!.matchAll(/"([a-z_]+)"/g)].map((item) => item[1]!);
    };
    const viewer = readFileSync(new URL("../../src/viewer/server.ts", import.meta.url), "utf8");
    const handler = readFileSync(new URL("../../src/worker/handler.ts", import.meta.url), "utf8");
    expect(listed(viewer)).toEqual([...VIEWER_READ_METHODS]);
    expect(listed(handler)).toEqual([...VIEWER_READ_METHODS]);
    // NAV-002 service default is unchanged: omitting `participants` still returns the roster.
    const defaults = service.getWorkspaceContext(ana, LAB);
    expect(defaults.participants).toHaveLength(57);
    expect(defaults).not.toHaveProperty("participantsCoverage");
    const dashboard = readFileSync(new URL("../../src/cli/dashboard.ts", import.meta.url), "utf8");
    expect(dashboard).toContain("list_workspace_participants");
    expect(dashboard).toContain("get_record_history");
  });

  it("pages the lab roster, filters owners, and uses a workspace-bounded participant plan", () => {
    const database = new Database(join(dir, "campfire.db"), { readonly: true, fileMustExist: true });
    const peopleSql = pageParticipantsSql(LAB, { limit: 20 });
    const participantPlan = explain(database, peopleSql.sql, peopleSql.params);
    const historySql = pageRecordHistorySql(LAB, {
      limit: 10,
      objectType: "decision",
      objectId: REVIEW,
      tip: 217,
    });
    const historyPlan = explain(database, historySql.sql, historySql.params);
    database.close();
    expect(participantPlan).toContain("idx_participants_workspace");
    expect(participantPlan).toContain("workspace_id");
    expect(participantPlan).not.toMatch(/SCAN workspace_participants/);
    expect(historyPlan).toContain("idx_contributions_object_position");

    const page1 = service.listWorkspaceParticipants(ana, { workspaceId: LAB });
    const page2 = service.listWorkspaceParticipants(ana, { workspaceId: LAB, cursor: page1.nextCursor });
    const page3 = service.listWorkspaceParticipants(ana, { workspaceId: LAB, cursor: page2.nextCursor });
    expect(page1).toMatchObject({ schemaVersion: 1, workspaceId: LAB, total: 57, returned: 20, truncated: true });
    expect(page1).not.toHaveProperty("filter");
    expect(ids(page1.items)).toEqual(LAB_AGENT_IDS.slice(0, 20));
    expect(page2).toMatchObject({ total: 57, returned: 20, truncated: true });
    expect(ids(page2.items)).toEqual([
      ...LAB_AGENT_IDS.slice(20),
      SCENARIO.humans.ana,
      SCENARIO.humans.ben,
      "hum_nav001_h03",
    ]);
    expect(page3).toMatchObject({ total: 57, returned: 17, truncated: false });
    expect(page3.nextCursor).toBeUndefined();
    expect(ids(page3.items)).toEqual(FILLER_HUMAN_IDS.slice(1));
    expect(Buffer.byteLength(JSON.stringify(page1), "utf8")).toBeLessThan(8192);

    const agent03 = page1.items[2];
    expect(agent03).toMatchObject({
      actor: { actorId: "agt_nav001_03", actorType: "agent" },
      name: "Agent 03",
      role: "agent",
      harness: "codex",
      humanOwnerId: SCENARIO.humans.zed,
      humanOwnerIsParticipant: false,
      joinedAt: "2026-10-17T12:01:45.000Z",
    });
    const anaRow = page2.items.find((item) => item.actor.actorId === SCENARIO.humans.ana);
    expect(anaRow).toMatchObject({ role: "owner", joinedAt: "2026-10-17T12:01:00.000Z" });
    expect(anaRow).not.toHaveProperty("humanOwnerIsParticipant");
    for (const item of [...page1.items, ...page2.items, ...page3.items]) {
      expect(JSON.stringify(item)).not.toMatch(/token|email|session|presence/i);
      if (item.actor.actorType === "human") expect(item).not.toHaveProperty("humanOwnerIsParticipant");
    }
    expect(ids([...page1.items, ...page2.items, ...page3.items])).not.toContain(SCENARIO.humans.zed);

    const anaAgents = service.listWorkspaceParticipants(ana, { workspaceId: LAB, humanOwnerId: SCENARIO.humans.ana });
    expect(anaAgents).toMatchObject({
      total: 2,
      returned: 2,
      truncated: false,
      filter: { humanOwnerId: SCENARIO.humans.ana },
    });
    expect(anaAgents.items.map((item) => ({
      id: item.actor.actorId,
      owner: item.humanOwnerId,
      inRoster: item.humanOwnerIsParticipant,
      joinedAt: item.joinedAt,
      harness: item.harness,
      name: item.name,
    }))).toEqual([
      {
        id: "agt_nav001_01",
        owner: SCENARIO.humans.ana,
        inRoster: true,
        joinedAt: "2026-10-17T12:01:41.000Z",
        harness: "codex",
        name: "Agent 01",
      },
      {
        id: "agt_nav001_21",
        owner: SCENARIO.humans.ana,
        inRoster: true,
        joinedAt: "2026-10-17T12:02:21.000Z",
        harness: "codex",
        name: "Agent 21",
      },
    ]);
    const zedAgent = service.listWorkspaceParticipants(ana, { workspaceId: LAB, humanOwnerId: SCENARIO.humans.zed });
    expect(zedAgent.total).toBe(1);
    expect(zedAgent.items[0]).toMatchObject({
      actor: { actorId: "agt_nav001_03", actorType: "agent" },
      humanOwnerIsParticipant: false,
    });
    const h03 = service.listWorkspaceParticipants(ana, { workspaceId: LAB, humanOwnerId: "hum_nav001_h03" });
    expect(h03.items).toEqual([
      expect.objectContaining({
        actor: { actorId: "agt_nav001_23", actorType: "agent" },
        harness: "codex",
        humanOwnerIsParticipant: true,
        joinedAt: "2026-10-17T12:02:25.000Z",
      }),
    ]);
    const nobody = service.listWorkspaceParticipants(ana, { workspaceId: LAB, humanOwnerId: "hum_nav001_nobody" });
    expect(nobody).toMatchObject({ total: 0, returned: 0, items: [] });
    expect(thrown(() => service.listWorkspaceParticipants(ana, { workspaceId: LAB, humanOwnerId: "" })).code).toBe(
      "ValidationError",
    );

    const agentPage = service.listWorkspaceParticipants(agent, { workspaceId: LAB });
    expect(ids(agentPage.items)).toEqual(ids(page1.items));
    expect(thrown(() => service.listWorkspaceParticipants(agent, { workspaceId: SCENARIO.workspaces.unrelated }))).toBeInstanceOf(
      ParticipantRequired,
    );

    const tasks = service.listTasksPage(ana, { workspaceId: LAB });
    expect(tasks).toMatchObject({ total: 64, returned: 20, truncated: true });
  });

  it("keeps default orientation byte-compatible and reports omit coverage", () => {
    const full = service.getWorkspaceContext(ana, LAB);
    expect(full.participants).toHaveLength(57);
    expect(full).not.toHaveProperty("participantsCoverage");
    expect(Buffer.byteLength(JSON.stringify(full), "utf8")).toBe(64920);
    expect(Buffer.byteLength(JSON.stringify(full.participants), "utf8")).toBe(9197);

    const omitted = service.getWorkspaceContext(ana, LAB, { participants: "omit" });
    expect(omitted.participants).toEqual([]);
    expect(omitted.participantsCoverage).toEqual({ returned: 0, total: 57, truncated: true, omitted: true });
    expect(Buffer.byteLength(JSON.stringify(omitted), "utf8")).toBeLessThanOrEqual(56000);
    expect(thrown(() => service.getWorkspaceContext(ana, LAB, { participants: "all" as "omit" })).message).toBe(
      "participants must be omit",
    );
  });

  it("returns dec_nav001_review contributions newest first under a frozen tip", () => {
    const history = service.getRecordHistory(ana, { workspaceId: LAB, objectType: "decision", objectId: REVIEW });
    expect(history).toMatchObject({
      schemaVersion: 1,
      workspaceId: LAB,
      objectType: "decision",
      objectId: REVIEW,
      total: 3,
      returned: 3,
      truncated: false,
    });
    expect(history.items.map((item) => ({
      id: item.id,
      action: item.action,
      appendPosition: item.appendPosition,
      actorId: item.actor.actorId,
      session: item.agentSessionId,
      payload: item.payload,
    }))).toEqual([
      {
        id: "con_nav001_0283",
        action: "update",
        appendPosition: 135,
        actorId: SCENARIO.humans.ana,
        session: undefined,
        payload: {
          summary: "cites find_nav001_superseded",
          findingId: "find_nav001_superseded",
          note: "original observation",
        },
      },
      {
        id: "con_nav001_0279",
        action: "update",
        appendPosition: 134,
        actorId: SCENARIO.humans.ana,
        session: undefined,
        payload: { status: "accepted" },
      },
      {
        id: "con_nav001_0276",
        action: "create",
        appendPosition: 133,
        actorId: SCENARIO.humans.ana,
        session: undefined,
        payload: {
          summary: "The terminal screen lists every recorded task because the read felt complete.",
          status: "proposed",
        },
      },
    ]);
    expect(Buffer.byteLength(JSON.stringify(history), "utf8")).toBeLessThan(8192);
    expect(service.getRecordHistory(agent, { workspaceId: LAB, objectType: "decision", objectId: REVIEW }).items.map((item) => item.id)).toEqual([
      "con_nav001_0283",
      "con_nav001_0279",
      "con_nav001_0276",
    ]);

    const first = service.getRecordHistory(ana, { workspaceId: LAB, objectType: "decision", objectId: REVIEW, limit: 1 });
    expect(first).toMatchObject({ total: 3, returned: 1, truncated: true });
    expect(first.items[0]?.id).toBe("con_nav001_0283");
    const cursor = decodeContextCursor(first.nextCursor ?? "");
    expect(cursor).toMatchObject({
      kind: "record-history",
      workspaceId: LAB,
      objectType: "decision",
      objectId: REVIEW,
      order: "append-position-desc",
      tip: 217,
      beforePosition: 135,
    });
  });

  it("checks activity:read and stops a non-participant before object, count, or cursor diagnostics", () => {
    calls.length = 0;
    service.getRecordHistory(ana, { workspaceId: LAB, objectType: "decision", objectId: REVIEW, limit: 1 });
    const decisionAt = calls.indexOf("getDecision");
    const participantCalls = calls
      .map((name, index) => ({ name, index }))
      .filter((entry) => entry.name === "getParticipant");
    expect(participantCalls.length).toBeGreaterThanOrEqual(2);
    expect(participantCalls[1]?.index).toBeLessThan(decisionAt);
    expect(calls.indexOf("pageRecordHistory")).toBeGreaterThan(decisionAt);
    expect(calls.indexOf("maxAppendPosition")).toBeGreaterThan(decisionAt);

    calls.length = 0;
    const denied = thrown(() =>
      service.getRecordHistory(zed, {
        workspaceId: LAB,
        objectType: "decision",
        objectId: REVIEW,
        limit: 0,
        cursor: "not-a-cursor",
      }),
    );
    expect(denied).toBeInstanceOf(ParticipantRequired);
    expect(denied.message).toBe(`Actor ${SCENARIO.humans.zed} is not a participant of workspace ${LAB}`);
    expect(JSON.stringify({ message: denied.message, details: denied.details })).not.toContain(UNRELATED_FINDING_SENTINEL);
    expect(JSON.stringify(denied.details ?? {})).not.toMatch(/total|con_nav001|original observation/);
    expect(calls).not.toContain("getDecision");
    expect(calls).not.toContain("pageRecordHistory");
    expect(calls).not.toContain("maxAppendPosition");
    expect(calls.filter((name) => name === "getParticipant")).toEqual(["getParticipant"]);

    expect(thrown(() => service.listWorkspaceParticipants(zed, { workspaceId: LAB, limit: 0, cursor: "%%%" }))).toBeInstanceOf(
      ParticipantRequired,
    );
    expect(thrown(() => service.getRecordHistory(ana, { workspaceId: "ws_does_not_exist", objectType: "decision", objectId: REVIEW }))).toBeInstanceOf(
      WorkspaceNotFound,
    );
    expect(
      thrown(() => service.listWorkspaceParticipants(ana, { workspaceId: SCENARIO.workspaces.unrelated, cursor: "not-a-cursor" })),
    ).toBeInstanceOf(ParticipantRequired);

    const missing = thrown(() =>
      service.getRecordHistory(ana, {
        workspaceId: LAB,
        objectType: "decision",
        objectId: "dec_missing",
        cursor: "not-a-cursor",
      }),
    );
    expect(missing).toBeInstanceOf(DecisionNotFound);
    expect(missing.message).not.toContain("malformed");

    const cross = thrown(() =>
      service.getRecordHistory(ana, {
        workspaceId: LAB,
        objectType: "finding",
        objectId: SCENARIO.findings.unrelatedSentinel,
      }),
    );
    expect(cross).toBeInstanceOf(FindingNotFound);
    expect(cross.message).toContain(SCENARIO.findings.unrelatedSentinel);
    expect(`${cross.message} ${JSON.stringify(cross.details ?? {})}`).not.toContain(UNRELATED_FINDING_SENTINEL);
  });

  it("rejects a cursor that does not bind this workspace, filter, or record", () => {
    const otherWorkspace: ContextCursor = {
      v: 1,
      kind: "participant",
      workspaceId: SCENARIO.workspaces.unrelated,
      humanOwnerId: null,
      actorType: "agent",
      actorId: "agt_nav001_01",
    };
    const wrongWorkspace = thrown(() =>
      service.listWorkspaceParticipants(ana, { workspaceId: LAB, cursor: encodeContextCursor(otherWorkspace) }),
    );
    expect(wrongWorkspace).toBeInstanceOf(ValidationError);
    expect(wrongWorkspace.message).toBe("Cursor belongs to a different workspace");
    expect(wrongWorkspace.details).toEqual({ field: "cursor", workspaceId: LAB });

    const page1 = service.listWorkspaceParticipants(ana, { workspaceId: LAB });
    const wrongFilter = thrown(() =>
      service.listWorkspaceParticipants(ana, {
        workspaceId: LAB,
        humanOwnerId: SCENARIO.humans.ana,
        cursor: page1.nextCursor,
      }),
    );
    expect(wrongFilter.message).toBe("Cursor belongs to a different filter");
    expect(wrongFilter.details).toEqual({ field: "cursor", humanOwnerId: SCENARIO.humans.ana });

    const otherRecord: ContextCursor = {
      v: 1,
      kind: "record-history",
      workspaceId: LAB,
      objectType: "decision",
      objectId: SCENARIO.decisions.plain,
      order: "append-position-desc",
      tip: 217,
      beforePosition: 10,
    };
    const wrongRecord = thrown(() =>
      service.getRecordHistory(ana, {
        workspaceId: LAB,
        objectType: "decision",
        objectId: REVIEW,
        cursor: encodeContextCursor(otherRecord),
      }),
    );
    expect(wrongRecord.message).toBe("Cursor belongs to a different record");
    expect(wrongRecord.details).toEqual({ field: "cursor", objectType: "decision", objectId: REVIEW });

    const taskCursor: ContextCursor = {
      v: 1,
      kind: "task",
      workspaceId: LAB,
      rank: 2,
      at: "2026-10-17T12:04:11.000Z",
      id: "task_nav001_f053",
    };
    expect(
      thrown(() => service.getRecordHistory(ana, { workspaceId: LAB, objectType: "decision", objectId: REVIEW, cursor: encodeContextCursor(taskCursor) })).message,
    ).toBe("Cursor is not a record-history cursor");
    expect(
      thrown(() => service.listWorkspaceParticipants(ana, { workspaceId: LAB, cursor: "not-a-cursor" })).message,
    ).toBe("Cursor is malformed");
    expect(thrown(() => service.listWorkspaceParticipants(ana, { workspaceId: LAB, limit: 101 })).message).toBe(
      "limit must be at most 100",
    );
    expect(
      thrown(() => service.getRecordHistory(ana, { workspaceId: LAB, objectType: "decision", objectId: REVIEW, limit: 51 })).message,
    ).toBe("limit must be at most 50");
  });

  it("rejects malformed HTTP and MCP input without adding the reads to the viewer", () => {
    expect(
      thrown(() => dispatchCampfireMethod(service, ana, "get_workspace_context", { workspaceId: LAB, participants: "all" })).message,
    ).toBe("participants must be omit");
    expect(
      thrown(() => dispatchCampfireMethod(service, ana, "list_workspace_participants", { workspaceId: LAB, limit: "20" })).message,
    ).toBe("limit must be a number");
    expect(
      thrown(() =>
        dispatchCampfireMethod(service, zed, "list_workspace_participants", {
          workspaceId: LAB,
          limit: 0,
          cursor: "not-a-cursor",
        }),
      ),
    ).toBeInstanceOf(ParticipantRequired);
    expect(
      thrown(() =>
        dispatchCampfireMethod(service, zed, "get_record_history", {
          workspaceId: LAB,
          objectType: "decision",
          objectId: REVIEW,
          cursor: "",
        }),
      ),
    ).toBeInstanceOf(ParticipantRequired);
    expect(
      thrown(() =>
        dispatchCampfireMethod(service, ana, "get_record_history", {
          workspaceId: LAB,
          objectType: "goal",
          objectId: REVIEW,
        }),
      ).code,
    ).toBe("ValidationError");

    const httpPage = dispatchCampfireMethod(service, ana, "get_workspace_context", {
      workspaceId: LAB,
      participants: "omit",
    });
    expect(httpPage).toMatchObject({
      participants: [],
      participantsCoverage: { returned: 0, total: 57, truncated: true, omitted: true },
    });
  });

  it("registers the MCP reads and rejects a malformed limit before a roster", async () => {
    const server = createCampfireMcpServer({ service, identity: { ctx: ana } });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "nav-002", version: "0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["list_workspace_participants", "get_record_history"]));
    const described = (await client.listTools()).tools.filter((tool) =>
      tool.name === "list_workspace_participants" || tool.name === "get_record_history",
    );
    expect(described.map((tool) => tool.description).join("\n")).toMatch(/not a team directory/);
    expect(described.map((tool) => tool.description).join("\n")).toMatch(/not live presence/);
    expect(described.find((tool) => tool.name === "get_record_history")?.description).toMatch(/Matching contributions only/);

    const badLimit = await client.callTool({
      name: "list_workspace_participants",
      arguments: { workspaceId: LAB, limit: 0 },
    });
    expect(badLimit.isError).toBe(true);
    expect(JSON.stringify(badLimit)).not.toContain("agt_nav001_01");

    const badOption = await client.callTool({
      name: "get_workspace_context",
      arguments: { workspaceId: LAB, participants: "all" },
    });
    expect(badOption.isError).toBe(true);

    const zedServer = createCampfireMcpServer({ service, identity: { ctx: zed } });
    const [zedClientTransport, zedServerTransport] = InMemoryTransport.createLinkedPair();
    const zedClient = new Client({ name: "nav-002-zed", version: "0" });
    await zedServer.connect(zedServerTransport);
    await zedClient.connect(zedClientTransport);
    const denied = await zedClient.callTool({
      name: "get_record_history",
      arguments: { workspaceId: LAB, objectType: "decision", objectId: REVIEW, cursor: "not-a-cursor", limit: 101 },
    });
    expect(denied.isError).toBe(true);
    const deniedText = JSON.stringify(denied);
    expect(deniedText).toContain("ParticipantRequired");
    expect(deniedText).not.toContain(UNRELATED_FINDING_SENTINEL);
    expect(deniedText).not.toContain("original observation");
    await client.close();
    await zedClient.close();
  });

  it("keeps a later write above the frozen tip out of the continuation", () => {
    const first = service.getRecordHistory(ana, { workspaceId: LAB, objectType: "decision", objectId: REVIEW, limit: 1 });
    expect(first.items[0]?.appendPosition).toBe(135);
    const written = service.citeDecisionBasis(ana, {
      decisionId: REVIEW,
      findingId: SCENARIO.findings.labCurrent,
      note: "written after the first history page",
    });
    expect(written.findingId).toBe(SCENARIO.findings.labCurrent);
    const second = service.getRecordHistory(ana, {
      workspaceId: LAB,
      objectType: "decision",
      objectId: REVIEW,
      limit: 10,
      cursor: first.nextCursor,
    });
    expect(second.total).toBe(3);
    expect(second.items.map((item) => item.id)).toEqual(["con_nav001_0279", "con_nav001_0276"]);
    expect(second.items.some((item) => item.appendPosition > 217)).toBe(false);
    const fresh = service.getRecordHistory(ana, { workspaceId: LAB, objectType: "decision", objectId: REVIEW, limit: 1 });
    expect(fresh.total).toBe(4);
    expect(fresh.items[0]?.appendPosition).toBe(218);
    expect(fresh.items[0]?.id).not.toBe("con_nav001_0283");
    const freshCursor = decodeContextCursor(fresh.nextCursor ?? "");
    expect(freshCursor).toMatchObject({ kind: "record-history", tip: 218, beforePosition: 218 });
  });
});
