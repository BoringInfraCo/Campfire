/**
 * MEM-001 step 3: the MCP get_memory_health tool returns the service result
 * unchanged (ids, exact summaries, coverage, nextCursor) and preserves typed errors.
 */
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

const NOW = "2026-01-01T00:00:00.000Z";
const BILLING = FIXTURE.workspaces.billing;
const HUMAN_CTX = { actor: { actorId: FIXTURE.humans.sergio, actorType: "human" as const } };
const AGENT: ServerIdentity = {
  ctx: { actor: { actorId: FIXTURE.agents.codexSergio, actorType: "agent" } },
  harness: "codex",
};

let service: CampfireService;
let server: McpServer;
let client: Client;

async function call(name: string, args: Record<string, unknown>) {
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content?: Array<{ type: string; text?: string }>;
  };
  const text = result.content?.find((p) => p.type === "text")?.text;
  return { isError: result.isError === true, json: text === undefined ? undefined : JSON.parse(text) };
}

beforeEach(async () => {
  const store = openInMemoryStore();
  let ms = Date.parse(NOW);
  const clock = () => new Date((ms += 1000)).toISOString();
  service = createCampfireService({ store, idSource: createCounterIdSource(), clock });
  seedFixture(store, { clock });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  server = createCampfireMcpServer({ service, identity: AGENT });
  client = new Client({ name: "mem-001", version: "0.0.0" });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(c), server.connect(s)]);
});

afterEach(async () => {
  await client.close();
  await server.close();
  service.close();
  vi.restoreAllMocks();
});

function seedBlockedTasks(count: number): void {
  for (let i = 0; i < count; i += 1) {
    const task = service.createTask(HUMAN_CTX, { workspaceId: BILLING, title: `blocked ${i}` });
    service.updateTask(HUMAN_CTX, { taskId: task.id, status: "blocked" });
  }
}

describe("MCP get_memory_health", () => {
  it("is registered and listed in the pinned tool names", async () => {
    const listed = await client.listTools();
    const names = listed.tools.map((t) => t.name);
    expect(names).toContain("get_memory_health");
    expect(MCP_TOOL_NAMES).toContain("get_memory_health");
    const tool = listed.tools.find((t) => t.name === "get_memory_health")!;
    expect(Object.keys((tool.inputSchema as any).properties).sort()).toEqual(
      ["cursor", "limit", "reason", "workspaceId"],
    );
    expect((tool.inputSchema as any).required).toEqual(["workspaceId"]);
  });

  it("returns the service result unchanged", async () => {
    seedBlockedTasks(2);
    const direct = service.getMemoryHealth(AGENT.ctx, { workspaceId: BILLING });
    const out = await call("get_memory_health", { workspaceId: BILLING });
    expect(out.isError).toBe(false);
    // observedAt comes from the advancing test clock; everything else must be identical.
    const { observedAt: _a, ...expected } = JSON.parse(JSON.stringify(direct));
    const { observedAt: _b, ...actual } = out.json;
    expect(actual).toEqual(expected);
    expect(out.json.cues.length).toBeGreaterThan(0);
  });

  it("preserves paging, coverage and nextCursor", async () => {
    seedBlockedTasks(3);
    const first = await call("get_memory_health", { workspaceId: BILLING, limit: 1 });
    expect(first.json.cues).toHaveLength(1);
    expect(first.json.coverage.truncated).toBe(true);
    expect(typeof first.json.nextCursor).toBe("string");
    const second = await call("get_memory_health", {
      workspaceId: BILLING,
      limit: 1,
      cursor: first.json.nextCursor,
    });
    expect(second.isError).toBe(false);
    expect(second.json.cues[0].id).not.toBe(first.json.cues[0].id);
    expect(second.json.coverage.total).toBe(first.json.coverage.total);
  });

  it("preserves the stale-cursor Conflict details", async () => {
    seedBlockedTasks(3);
    const first = await call("get_memory_health", { workspaceId: BILLING, limit: 1 });
    service.createTask(HUMAN_CTX, { workspaceId: BILLING, title: "moves the tip" });
    const stale = await call("get_memory_health", {
      workspaceId: BILLING,
      limit: 1,
      cursor: first.json.nextCursor,
    });
    expect(stale.isError).toBe(true);
    expect(stale.json.error).toBe("Conflict");
    expect(stale.json.details).toMatchObject({
      recoveryCode: "memory_health_stale_cursor",
      field: "cursor",
      nextAction: "restart_without_cursor",
    });
  });

  it("preserves typed validation errors", async () => {
    const bad = await call("get_memory_health", { workspaceId: BILLING, reason: "bogus" });
    expect(bad.isError).toBe(true);
    expect(bad.json.error).toBe("ValidationError");
  });
});
