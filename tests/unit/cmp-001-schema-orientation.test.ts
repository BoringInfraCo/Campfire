/**
 * CMP-001 slice B: orientation output schemas accept every real output (frozen
 * corpus and live service) and emit a $ref-free JSON Schema.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import * as zm from "zod/v4-mini";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FIXTURE, seedFixture } from "../../src/bootstrap/seed.js";
import { createCounterIdSource } from "../../src/domain/ids.js";
import type { ServerIdentity } from "../../src/mcp/context.js";
import {
  getWorkspaceChangesOutput,
  getWorkspaceContextOutput,
  getWorkspaceChangesSchema,
  getWorkspaceContextSchema,
} from "../../src/mcp/schemas/orientation.js";
import { createCampfireMcpServer } from "../../src/mcp/tools.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import type { CampfireService } from "../../src/service/service.js";
import { openInMemoryStore } from "../../src/store/sqlite-store.js";

const NOW = "2026-01-01T00:00:00.000Z";
const WS = FIXTURE.workspaces.billing;
const HUMAN = { actor: { actorId: FIXTURE.humans.sergio, actorType: "human" as const } };
const AGENT: ServerIdentity = {
  ctx: { actor: { actorId: FIXTURE.agents.codexSergio, actorType: "agent" } },
  harness: "codex",
};
const CONTEXT = z.object(getWorkspaceContextOutput);
const CHANGES = z.object(getWorkspaceChangesOutput);
const OBS = "fixtures/cmp-001/observations";

function corpus(tool: string): Array<{ caseId: string; parsedBody: unknown }> {
  const file = JSON.parse(readFileSync(`${OBS}/${tool}.json`, "utf8")) as {
    rows: Array<{ caseId: string; parsedBody: unknown; shape?: string }>;
  };
  return file.rows.filter((r) => r.parsedBody && typeof r.parsedBody === "object" && !("error" in (r.parsedBody as object)));
}

function emitted(schema: z.ZodType): Record<string, unknown> {
  // Same conversion as McpServer tools/list (zod-json-schema-compat.js, zod v4 branch).
  return zm.toJSONSchema(schema as never, { target: "draft-7", io: "output" }) as Record<string, unknown>;
}

function keysDeep(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((n) => keysDeep(n, out));
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      out.push(k);
      keysDeep(v, out);
    }
  }
  return out;
}

let service: CampfireService;
let server: McpServer;
let client: Client;
const call = async (name: string, args: Record<string, unknown>, c: Client = client) => {
  const raw = (await c.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: Array<{ text: string }>;
  };
  expect(raw.isError, raw.content[0]?.text).not.toBe(true);
  return JSON.parse(raw.content[0]!.text) as Record<string, any>;
};

beforeEach(async () => {
  const store = openInMemoryStore();
  let ms = Date.parse(NOW);
  const clock = () => new Date((ms += 1000)).toISOString();
  service = createCampfireService({ store, idSource: createCounterIdSource(), clock });
  seedFixture(store, { clock });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  server = createCampfireMcpServer({ service, identity: AGENT });
  client = new Client({ name: "cmp-001b", version: "0.0.0" });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(c), server.connect(s)]);
});

afterEach(async () => {
  await client.close();
  await server.close();
  service.close();
  vi.restoreAllMocks();
});

describe("frozen corpus", () => {
  it("accepts every non-error get_workspace_context body", () => {
    const rows = corpus("get_workspace_context");
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const res = CONTEXT.safeParse(r.parsedBody);
      expect(res.success, `${r.caseId}: ${res.success ? "" : JSON.stringify(res.error.issues.slice(0, 3))}`).toBe(true);
    }
  });
  it("accepts every non-error get_workspace_changes body", () => {
    const rows = corpus("get_workspace_changes");
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const res = CHANGES.safeParse(r.parsedBody);
      expect(res.success, `${r.caseId}: ${res.success ? ""
 : JSON.stringify(res.error.issues.slice(0, 3))}`).toBe(true);
    }
  });
});

describe("live service", () => {
  it("accepts a seeded workspace, truncated pages, since, participants omit, and catch-up", async () => {
    for (let i = 0; i < 25; i++) service.createTask(HUMAN, { workspaceId: WS, title: `t${i}` });
    const blocked = service.createTask(HUMAN, { workspaceId: WS, title: "blocked" });
    service.updateTask(HUMAN, { taskId: blocked.id, status: "blocked" });
    const findings = [];
    for (let i = 0; i < 12; i++) findings.push(service.addFinding(HUMAN, { workspaceId: WS, summary: `f${i}`, detail: "d" }));
    const d = service.addDecision(HUMAN, { workspaceId: WS, summary: "d" });
    service.citeDecisionBasis(HUMAN, { decisionId: d.id, findingId: findings[0]!.id });
    service.addArtifact(HUMAN, { workspaceId: WS, type: "document", title: "a", uriOrPath: "doc://a" });

    const first = await call("get_workspace_context", { workspaceId: WS });
    expect(CONTEXT.parse(first)).toBeTruthy();
    expect(first.slices.tasks.truncated).toBe(true);
    expect(first.slices.findings.truncated).toBe(true);

    const contribId = first.provenance[0].id as string;
    expect(CONTEXT.safeParse(await call("get_workspace_context", { workspaceId: WS, since: contribId })).success).toBe(true);
    const omit = await call("get_workspace_context", { workspaceId: WS, participants: "omit" });
    expect(omit.participantsCoverage).toBeDefined();
    expect(CONTEXT.safeParse(omit).success).toBe(true);

    service.addFinding(HUMAN, { workspaceId: WS, summary: "late", detail: "d" });
    const after = await call("get_workspace_changes", { workspaceId: WS, after: first.orientationCursor });
    expect(CHANGES.parse(after)).toBeTruthy();
    // truncated page + continuation
    for (let i = 0; i < 30; i++) service.createTask(HUMAN, { workspaceId: WS, title: `n${i}` });
    const page = await call("get_workspace_changes", { workspaceId: WS, after: first.orientationCursor, limit: 5 });
    expect(page.changes.truncated).toBe(true);
    expect(CHANGES.safeParse(page).success).toBe(true);
    const next = await call("get_workspace_changes", { workspaceId: WS, after: page.toCursor, limit: 5 });
    expect(CHANGES.safeParse(next).success).toBe(true);
    // caught up
    const tip = await call("get_workspace_context", { workspaceId: WS });
    const empty = await call("get_workspace_changes", { workspaceId: WS, after: tip.orientationCursor });
    expect(empty.changes.items).toHaveLength(0);
    expect(CHANGES.safeParse(empty).success).toBe(true);
  });

  it("accepts an empty workspace", async () => {
    const ws = service.createWorkspace(HUMAN, { teamId: FIXTURE.teamId, name: "empty" });
    const humanServer = createCampfireMcpServer({ service, identity: { ctx: HUMAN, harness: "cli" } });
    const hc = new Client({ name: "h", version: "0" });
    const [c, s] = InMemoryTransport.createLinkedPair();
    await Promise.all([hc.connect(c), humanServer.connect(s)]);
    const ctx = await call("get_workspace_context", { workspaceId: ws.id }, hc);
    expect(CONTEXT.safeParse(ctx).success).toBe(true);
    const ch = await call("get_workspace_changes", { workspaceId: ws.id, after: ctx.orientationCursor }, hc);
    await hc.close();
    await humanServer.close();
    expect(CHANGES.safeParse(ch).success).toBe(true);
  });

  it("accepts the fixture workspace unmodified", async () => {
    const ctx = await call("get_workspace_context", { workspaceId: WS });
    expect(CONTEXT.safeParse(ctx).success).toBe(true);
  });
});

describe("emitted JSON Schema", () => {
  const cases: Array<[string, z.ZodType]> = [
    ["context shape", CONTEXT],
    ["changes shape", CHANGES],
    ["context loose", getWorkspaceContextSchema],
    ["changes loose", getWorkspaceChangesSchema],
  ];
  it.each(cases)("%s has no $ref/$defs and no nested $schema", (_n, schema) => {
    const json = emitted(schema);
    expect(json.type).toBe("object");
    const keys = keysDeep(json);
    expect(keys).not.toContain("$ref");
    expect(keys).not.toContain("$defs");
    expect(keys).not.toContain("definitions");
    // The SDK converter itself adds a root-only draft-07 $schema; nothing nested.
    const { $schema: _root, ...rest } = json;
    expect(keysDeep(rest)).not.toContain("$schema");
  });
  it("emitted size stays within the CMP-001 budget", () => {
    const size = (x: z.ZodType) => JSON.stringify(emitted(x)).length;
    expect(size(CONTEXT)).toBeLessThanOrEqual(12_000);
    expect(size(CHANGES)).toBeLessThanOrEqual(2_000);
  });
  it("nested objects tolerate extra keys", () => {
    const json = emitted(CONTEXT) as any;
    expect(json.properties.workspace.additionalProperties).not.toBe(false);
    expect(json.properties.slices.properties.tasks.additionalProperties).not.toBe(false);
  });
  it("tools/list through the SDK matches the converter when wired", async () => {
    const mcp = new McpServer({ name: "t", version: "0" });
    mcp.registerTool("x", { outputSchema: getWorkspaceChangesOutput }, async () => ({
      content: [],
      structuredContent: {},
    }));
    const [c, s] = InMemoryTransport.createLinkedPair();
    const cl = new Client({ name: "c", version: "0" });
    await Promise.all([cl.connect(c), mcp.connect(s)]);
    const { tools } = await cl.listTools();
    expect(tools[0]!.outputSchema).toEqual(emitted(CHANGES));
    await cl.close();
    await mcp.close();
  });
});

describe("negative", () => {
  it("rejects wrong types", async () => {
    const ctx = await call("get_workspace_context", { workspaceId: WS });
    expect(CONTEXT.safeParse({ ...ctx, provenanceTotal: "3" }).success).toBe(false);
    expect(CONTEXT.safeParse({ ...ctx, slices: { ...ctx.slices, tasks: { ...ctx.slices.tasks, truncated: "no" } } }).success).toBe(false);
    const { orientationCursor: _o, ...missing } = ctx;
    expect(CONTEXT.safeParse(missing).success).toBe(false);
    const ch = await call("get_workspace_changes", { workspaceId: WS, after: ctx.orientationCursor });
    expect(CHANGES.safeParse({ ...ch, toCursor: 5 }).success).toBe(false);
    expect(CHANGES.safeParse({ ...ch, schemaVersion: 2 }).success).toBe(false);
  });
});
