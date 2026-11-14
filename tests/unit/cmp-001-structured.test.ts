/**
 * CMP-001 slice A: the eight read tools return structuredContent equal to the
 * unchanged text block; errors stay text-only; other tools are untouched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FIXTURE, seedFixture } from "../../src/bootstrap/seed.js";
import { createCounterIdSource } from "../../src/domain/ids.js";
import type { ServerIdentity } from "../../src/mcp/context.js";
import { createCampfireMcpServer } from "../../src/mcp/tools.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import type { CampfireService } from "../../src/service/service.js";
import { openInMemoryStore } from "../../src/store/sqlite-store.js";

const NOW = "2026-01-01T00:00:00.000Z";
const WS = FIXTURE.workspaces.billing;
const AGENT: ServerIdentity = {
  ctx: { actor: { actorId: FIXTURE.agents.codexSergio, actorType: "agent" } },
  harness: "codex",
};
const TOOLS = [
  "get_workspace_context",
  "get_workspace_changes",
  "list_tasks",
  "get_task",
  "get_memory_health",
  "get_decision",
  "get_finding",
  "get_artifact",
] as const;

type Raw = { isError?: boolean; content?: Array<{ type: string; text?: string }>; structuredContent?: unknown };
let service: CampfireService;
let storeRef: ReturnType<typeof openInMemoryStore>;
let server: McpServer;
let client: Client;

const call = async (name: string, args: Record<string, unknown>) =>
  (await client.callTool({ name, arguments: args })) as Raw;

beforeEach(async () => {
  const store = openInMemoryStore();
  storeRef = store;
  let ms = Date.parse(NOW);
  const clock = () => new Date((ms += 1000)).toISOString();
  service = createCampfireService({ store, idSource: createCounterIdSource(), clock });
  seedFixture(store, { clock });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  server = createCampfireMcpServer({ service, identity: AGENT });
  client = new Client({ name: "cmp-001", version: "0.0.0" });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(c), server.connect(s)]);
});

afterEach(async () => {
  await client.close();
  await server.close();
  service.close();
  vi.restoreAllMocks();
});

const HUMAN = { actor: { actorId: FIXTURE.humans.sergio, actorType: "human" as const } };

function seedRecords(): void {
  const blocked = service.createTask(HUMAN, { workspaceId: WS, title: "blocked" });
  service.updateTask(HUMAN, { taskId: blocked.id, status: "blocked" });
  const finding = service.addFinding(HUMAN, { workspaceId: WS, summary: "f", detail: "d" });
  const decision = service.addDecision(HUMAN, { workspaceId: WS, summary: "d" });
  service.citeDecisionBasis(HUMAN, { decisionId: decision.id, findingId: finding.id });
  service.addArtifact(HUMAN, { workspaceId: WS, type: "document", title: "a", uriOrPath: "doc://a" });
}

async function argsFor(): Promise<Record<(typeof TOOLS)[number], Record<string, unknown>>> {
  const ids = async (tool: string, key: string) => {
    const raw = await call(tool, { workspaceId: WS });
    const json = JSON.parse(raw.content![0]!.text!);
    const list = (json.items ?? json[key] ?? []) as Array<{ id: string }>;
    if (list[0] === undefined) throw new Error(`${tool}: ${raw.content![0]!.text!.slice(0, 300)}`);
    return list[0].id;
  };
  const ctx = await call("get_workspace_context", { workspaceId: WS });
  const orient = JSON.parse(ctx.content![0]!.text!);
  return {
    get_workspace_context: { workspaceId: WS },
    get_workspace_changes: { workspaceId: WS, after: orient.orientationCursor },
    list_tasks: { workspaceId: WS },
    get_task: { workspaceId: WS, taskId: await ids("list_tasks", "tasks") },
    get_memory_health: { workspaceId: WS },
    get_decision: { workspaceId: WS, decisionId: await ids("list_decisions", "decisions") },
    get_finding: { workspaceId: WS, findingId: await ids("list_findings", "findings") },
    get_artifact: { workspaceId: WS, artifactId: await ids("list_artifacts", "artifacts") },
  };
}

describe("CMP-001 slice A", () => {
  it("returns structuredContent equal to the unchanged text for the eight read tools", async () => {
    seedRecords();
    const args = await argsFor();
    for (const name of TOOLS) {
      const result = await call(name, args[name]);
      expect(result.isError, name).not.toBe(true);
      expect(result.content).toHaveLength(1);
      const text = result.content![0]!.text!;
      expect(text, name).toBe(JSON.stringify(JSON.parse(text), null, 2));
      expect(result.structuredContent, name).toEqual(JSON.parse(text));
    }
  });

  it("lists titles, output schemas, and explicit read-only annotations for the eight tools only", async () => {
    const { tools } = await client.listTools();
    for (const name of TOOLS) {
      const tool = tools.find((t) => t.name === name)!;
      expect(tool.title, name).toBeTruthy();
      expect(tool.outputSchema, name).toBeTruthy();
      expect(tool.annotations, name).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    }
    // FAC-001 (F11, A2.11): get_workspace_attention carries a title and the read-only
    // annotations but deliberately NO outputSchema (size ceiling). Carve-out is explicit.
    const attention = tools.find((t) => t.name === "get_workspace_attention")!;
    expect(attention.title).toBeTruthy();
    expect(attention.outputSchema).toBeUndefined();
    expect(attention.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    for (const tool of tools.filter(
      (t) => !(TOOLS as readonly string[]).includes(t.name) && t.name !== "get_workspace_attention",
    )) {
      expect(tool.annotations, tool.name).toBeUndefined();
      expect(tool.outputSchema, tool.name).toBeUndefined();
    }
    expect(tools).toHaveLength(48);
  });

  it("performs no write: the eight read tools leave contributions unchanged", async () => {
    seedRecords();
    const args = await argsFor();
    const before = storeRef.countObjects("contributions", WS);
    for (const name of TOOLS) await call(name, args[name]);
    expect(storeRef.countObjects("contributions", WS)).toBe(before);
  });

  it("leaves other tools and typed errors text-only", async () => {
    const other = await call("list_decisions", { workspaceId: WS });
    expect(other.structuredContent).toBeUndefined();
    const denied = await call("get_memory_health", { workspaceId: "ws_missing" });
    expect(denied.isError).toBe(true);
    expect(denied.structuredContent).toBeUndefined();
    expect(JSON.parse(denied.content![0]!.text!)).toMatchObject({ error: expect.any(String) });
    const stale = await call("get_memory_health", { workspaceId: WS, cursor: "mh1.garbage" });
    expect(stale.isError).toBe(true);
    expect(stale.structuredContent).toBeUndefined();
  });
});
