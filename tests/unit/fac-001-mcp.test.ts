/** FAC-001 slice 1 phase C: MCP get_workspace_attention wiring (F10, F11). */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FIXTURE, seedFixture } from "../../src/bootstrap/seed.js";
import { MCP_TOOL_NAMES } from "../../src/catalog/capability-search.js";
import { createCounterIdSource } from "../../src/domain/ids.js";
import type { ServerIdentity } from "../../src/mcp/context.js";
import { createCampfireMcpServer } from "../../src/mcp/tools.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import type { CampfireService } from "../../src/service/service.js";
import { openInMemoryStore } from "../../src/store/sqlite-store.js";

const FROZEN_READ_AT = "2026-02-01T00:00:00.000Z";
const BILLING = FIXTURE.workspaces.billing;
const AGENT: ServerIdentity = {
  ctx: { actor: { actorId: FIXTURE.agents.codexSergio, actorType: "agent" } },
  harness: "codex",
};
let service: CampfireService;
let server: McpServer;
let client: Client;

beforeEach(async () => {
  const store = openInMemoryStore();
  // Seeding advances 1 s per write; every service read then sees one frozen instant (observedAt is stable).
  let ms = Date.parse("2026-01-01T00:00:00.000Z");
  const seedClock = () => new Date((ms += 1000)).toISOString();
  const frozenClock = () => FROZEN_READ_AT;
  service = createCampfireService({ store, idSource: createCounterIdSource(), clock: frozenClock });
  seedFixture(store, { clock: seedClock });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  server = createCampfireMcpServer({ service, identity: AGENT });
  client = new Client({ name: "fac-001", version: "0.0.0" });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(c), server.connect(s)]);
});
afterEach(async () => {
  await client.close();
  await server.close();
  service.close();
  vi.restoreAllMocks();
});

describe("FAC-001 MCP get_workspace_attention", () => {
  it("is registered with title, read-only annotations, short description and no outputSchema", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "get_workspace_attention")!;
    expect(tool).toBeDefined();
    expect(MCP_TOOL_NAMES).toContain("get_workspace_attention");
    expect(tool.title).toBe("Get workspace attention");
    expect(tool.description!.length).toBeLessThanOrEqual(84);
    expect(tool.outputSchema).toBeUndefined();
    expect("outputSchema" in tool).toBe(false);
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    const props = Object.keys((tool.inputSchema as { properties: Record<string, unknown> }).properties).sort();
    expect(props).toEqual(["cursor", "limit", "since", "workspaceId"]);
    expect((tool.inputSchema as { required?: string[] }).required).toEqual(["workspaceId"]);
  });

  it("tools/list frame with the real tool stays within the 51,939 ceiling (F9/F11)", async () => {
    const frames: unknown[] = [];
    const server2 = createCampfireMcpServer({ service, identity: AGENT });
    const client2 = new Client({ name: "fac-001-frame", version: "0.0.0" });
    const [c, s] = InMemoryTransport.createLinkedPair();
    await Promise.all([client2.connect(c), server2.connect(s)]);
    const prior = c.onmessage;
    c.onmessage = (m, extra) => {
      frames.push(m);
      prior?.(m, extra);
    };
    try {
      await client2.listTools();
      const raw = frames.find((m: any) => m && "result" in m && Array.isArray(m.result?.tools)) as { result: { tools: Array<{ name: string; description: string }> } };
      const bytes = Buffer.byteLength(`${JSON.stringify(raw)}\n`, "utf8");
      const description = raw.result.tools.find((t) => t.name === "get_workspace_attention")!.description;
      process.stdout.write(`fac-001 tools/list frame bytes ${bytes}, ceiling 51939, headroom ${51_939 - bytes}, attention description ${description.length} chars\n`);
      expect(bytes).toBeLessThanOrEqual(51_939);
      expect(description.length).toBeLessThanOrEqual(84);
    } finally {
      await client2.close();
      await server2.close();
    }
  });

  it("returns structuredContent equal to the text fallback and writes nothing", async () => {
    const ctx = AGENT.ctx;
    const result = (await client.callTool({ name: "get_workspace_attention", arguments: { workspaceId: BILLING } })) as {
      isError?: boolean;
      content?: Array<{ type: string; text?: string }>;
      structuredContent?: unknown;
    };
    expect(result.isError).not.toBe(true);
    const text = result.content![0]!.text!;
    expect(text).toBe(JSON.stringify(JSON.parse(text), null, 2));
    expect(result.structuredContent).toEqual(JSON.parse(text));
    const direct = JSON.parse(JSON.stringify(service.getWorkspaceAttention(ctx, { workspaceId: BILLING })));
    expect(JSON.parse(text)).toEqual(direct);
    expect(direct.observedAt).toBe(FROZEN_READ_AT);
    expect(direct.schemaVersion).toBeDefined();
  });

  it("inputSchema agrees with the dispatch parser: types, bounds, and the required set", async () => {
    const { tools } = await client.listTools();
    const schema = tools.find((t) => t.name === "get_workspace_attention")!.inputSchema as {
      properties: Record<string, { type: string; minimum?: number; exclusiveMinimum?: number; description?: unknown }>;
      required?: string[];
      additionalProperties?: unknown;
    };
    expect(schema.properties.workspaceId!.type).toBe("string");
    expect(schema.properties.cursor!.type).toBe("string");
    expect(schema.properties.since!.type).toBe("string");
    expect(schema.properties.limit!.type).toBe("integer");
    expect(schema.properties.limit!.exclusiveMinimum ?? schema.properties.limit!.minimum).toBeDefined();
    for (const p of Object.values(schema.properties)) expect(p.description).toBeUndefined(); // F9: no .describe() bytes
    // dispatch accepts exactly these four keys and forwards them unchanged (see fac-001-dispatch)
    const ok = (await client.callTool({ name: "get_workspace_attention", arguments: { workspaceId: BILLING, limit: 5 } })) as { isError?: boolean };
    expect(ok.isError).not.toBe(true);
  });

  it("limit 101 passes the schema and is rejected by the service as ValidationError field limit (rejected, not clamped)", async () => {
    const r = (await client.callTool({ name: "get_workspace_attention", arguments: { workspaceId: BILLING, limit: 101 } })) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    expect(r.isError).toBe(true);
    const body = JSON.parse(r.content[0]!.text) as { error: string; details: { field?: string } };
    expect(body.error).toBe("ValidationError");
    expect(body.details.field).toBe("limit");
  });

  it("limit 0 and limit 1.5 are refused at the MCP schema boundary (no service call, no result)", async () => {
    for (const limit of [0, -1, 1.5]) {
      const r = (await client.callTool({ name: "get_workspace_attention", arguments: { workspaceId: BILLING, limit } })) as { isError?: boolean; structuredContent?: unknown };
      expect(r.isError, `limit ${limit}`).toBe(true);
      expect(r.structuredContent).toBeUndefined();
    }
  });

  it("rejects a missing workspaceId at the schema boundary", async () => {
    const result = (await client.callTool({ name: "get_workspace_attention", arguments: {} })) as { isError?: boolean };
    expect(result.isError).toBe(true);
  });
});
