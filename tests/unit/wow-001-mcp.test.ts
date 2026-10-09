/**
 * WOW-001 MCP contract tests: the opt-in read-only get_playbook tool, the
 * shared gate on the stdio startup path, and CLI parity from
 * docs/Campfire-v1.13-WOW-001-Prove-a-Way-of-Working.md sections 4.3, 5, 6.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FIXTURE, seedFixture } from "../../src/bootstrap/seed.js";
import { runCliEntry } from "../../src/cli/index.js";
import { createCounterIdSource } from "../../src/domain/ids.js";
import type { ServerIdentity } from "../../src/mcp/context.js";
import { createCampfireMcpServer } from "../../src/mcp/tools.js";
import type { CampfireMcpOptions } from "../../src/mcp/tools.js";
import { INCIDENT_INVESTIGATION_PLAYBOOK } from "../../src/playbooks/incident-investigation.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import type { CampfireService } from "../../src/service/service.js";
import { openInMemoryStore } from "../../src/store/sqlite-store.js";
import type { CampfireStore } from "../../src/store/store.js";

const NOW = "2026-01-01T00:00:00.000Z";
const BILLING = FIXTURE.workspaces.billing;

const AGENT_A: ServerIdentity = {
  ctx: { actor: { actorId: FIXTURE.agents.codexSergio, actorType: "agent" } },
  harness: "codex",
};

function createClock(startMs = Date.parse(NOW)): () => string {
  let current = startMs;
  return (): string => {
    current += 1000;
    return new Date(current).toISOString();
  };
}

interface ToolOutcome {
  isError: boolean;
  json: any;
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolOutcome> {
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content?: Array<{ type: string; text?: string }>;
  };
  const text = result.content?.find(
    (part) => part.type === "text" && typeof part.text === "string",
  )?.text;
  return {
    isError: result.isError === true,
    json: text === undefined ? undefined : JSON.parse(text),
  };
}

let store: CampfireStore;
let service: CampfireService;
let logs: string[];
let errors: string[];
const openServers: McpServer[] = [];
const openClients: Client[] = [];
let previousPlaybookEnv: string | undefined;

async function connectServer(options: CampfireMcpOptions): Promise<Client> {
  const server = createCampfireMcpServer(options);
  const client = new Client({ name: "campfire-wow-001", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  openServers.push(server);
  openClients.push(client);
  return client;
}

function localOptions(extra: CampfireMcpOptions = {}): CampfireMcpOptions {
  return { service, identity: AGENT_A, ...extra };
}

function toolNames(client: Client): Promise<string[]> {
  return client.listTools().then((listed) => listed.tools.map((tool) => tool.name));
}

/** Every key name in a serialized object, so a leaked credential field cannot hide. */
function collectKeys(value: unknown, keys: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
    return keys;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, nested] of Object.entries(value)) {
      keys.push(key);
      collectKeys(nested, keys);
    }
  }
  return keys;
}

beforeEach(() => {
  store = openInMemoryStore();
  const clock = createClock();
  service = createCampfireService({ store, idSource: createCounterIdSource(), clock });
  seedFixture(store, { clock });
  logs = [];
  errors = [];
  previousPlaybookEnv = process.env.CAMPFIRE_PLAYBOOK;
  delete process.env.CAMPFIRE_PLAYBOOK;
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
});

afterEach(async () => {
  await Promise.all(openClients.splice(0).map((client) => client.close()));
  await Promise.all(openServers.splice(0).map((server) => server.close()));
  service.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (previousPlaybookEnv === undefined) delete process.env.CAMPFIRE_PLAYBOOK;
  else process.env.CAMPFIRE_PLAYBOOK = previousPlaybookEnv;
});

describe("get_playbook registration", () => {
  it("is absent by default and adds exactly one tool when enabled", async () => {
    const defaultClient = await connectServer(localOptions());
    const enabledClient = await connectServer(localOptions({ playbookEnabled: true }));

    const defaultTools = await toolNames(defaultClient);
    const enabledTools = await toolNames(enabledClient);

    expect(defaultTools).not.toContain("get_playbook");
    expect(defaultTools).toContain("get_workspace_context");
    expect(enabledTools.filter((name) => !defaultTools.includes(name))).toEqual(["get_playbook"]);
    expect(defaultTools.filter((name) => !enabledTools.includes(name))).toEqual([]);
  });

  it("returns the frozen definition for a known name", async () => {
    const client = await connectServer(localOptions({ playbookEnabled: true }));

    const result = await call(client, "get_playbook", { name: "incident-investigation" });

    expect(result.isError).toBe(false);
    expect(result.json).toEqual(JSON.parse(JSON.stringify(INCIDENT_INVESTIGATION_PLAYBOOK)));
  });
});

describe("get_playbook behavior", () => {
  it("returns a typed ValidationError for an unknown name and stays usable", async () => {
    const client = await connectServer(localOptions({ playbookEnabled: true }));

    const unknown = await call(client, "get_playbook", { name: "sorcery" });
    expect(unknown.isError).toBe(true);
    expect(unknown.json.error).toBe("ValidationError");
    expect(unknown.json.message).toContain("Unknown playbook: sorcery");
    expect(unknown.json.details).toMatchObject({
      field: "name",
      value: "sorcery",
      available: ["incident-investigation"],
    });
    expect(unknown.json.kind).toBeUndefined();
    expect(unknown.json.stages).toBeUndefined();
    expect(unknown.json.rules).toBeUndefined();

    const empty = await call(client, "get_playbook", { name: "" });
    expect(empty.isError).toBe(true);
    expect(empty.json.error).toBe("ValidationError");
    expect(empty.json.message).toContain("Unknown playbook:");
    expect(empty.json.stages).toBeUndefined();

    const valid = await call(client, "get_playbook", { name: "incident-investigation" });
    expect(valid.isError).toBe(false);
    expect(valid.json.name).toBe("incident-investigation");
  });

  it("reads static guidance without touching workspace state", async () => {
    const client = await connectServer(localOptions({ playbookEnabled: true }));
    const before = {
      position: store.maxAppendPosition(BILLING),
      contributions: store.listContributions(BILLING).map((contribution) => contribution.id),
    };

    const result = await call(client, "get_playbook", { name: "incident-investigation" });

    expect(result.isError).toBe(false);
    expect({
      position: store.maxAppendPosition(BILLING),
      contributions: store.listContributions(BILLING).map((contribution) => contribution.id),
    }).toEqual(before);

    const serialized = JSON.stringify(result.json);
    expect(serialized).not.toContain(BILLING);
    expect(serialized).not.toContain(FIXTURE.workspaces.unrelated);
    expect(serialized).not.toMatch(/workspaceId/);
    expect(serialized).not.toMatch(/cft_|credential|password|api[_-]?key|bearer|secret|token/i);
    for (const key of collectKeys(result.json)) {
      expect(key).not.toMatch(/token|secret|credential|password|api[_-]?key/i);
    }
  });
});

describe("get_playbook remote and unavailable modes", () => {
  it("serves the local registry in remote mode with zero HTTP calls", async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("get_playbook must not call fetch");
    });
    vi.stubGlobal("fetch", fetchSpy);
    const client = await connectServer({
      remote: { url: "https://campfire.invalid", token: "test-token" },
      identity: AGENT_A,
      playbookEnabled: true,
    });

    const result = await call(client, "get_playbook", { name: "incident-investigation" });

    expect(result.isError).toBe(false);
    expect(result.json).toEqual(JSON.parse(JSON.stringify(INCIDENT_INVESTIGATION_PLAYBOOK)));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps a disabled remote server free of get_playbook", async () => {
    const client = await connectServer({
      remote: { url: "https://campfire.invalid", token: "test-token" },
      identity: AGENT_A,
    });

    expect(await toolNames(client)).not.toContain("get_playbook");
  });

  it("lists the tool behind an unavailable listener but keeps the existing failure", async () => {
    const client = await connectServer({
      unavailable: { message: "listener down" },
      playbookEnabled: true,
    });

    expect(await toolNames(client)).toContain("get_playbook");

    const result = await call(client, "get_playbook", { name: "incident-investigation" });
    expect(result.isError).toBe(true);
    expect(result.json).toEqual({
      error: "ValidationError",
      message: "listener down",
      details: null,
    });
    expect(JSON.stringify(result.json)).not.toContain("stages");
  });
});

describe("CLI parity", () => {
  it("returns the same definition as campfire playbook and the frozen list projection", async () => {
    process.env.CAMPFIRE_PLAYBOOK = "1";
    const client = await connectServer(localOptions({ playbookEnabled: true }));
    const toolResult = await call(client, "get_playbook", { name: "incident-investigation" });
    expect(toolResult.isError).toBe(false);

    expect(await runCliEntry(["playbook", "incident-investigation", "--output", "json"])).toBe(0);
    expect(JSON.parse(logs.at(-1)!)).toEqual(toolResult.json);

    logs = [];
    expect(await runCliEntry(["playbook", "list", "--output", "json"])).toBe(0);
    expect(JSON.parse(logs.at(-1)!)).toEqual({
      kind: "campfire_playbook_list",
      schemaVersion: 1,
      playbooks: [{ name: "incident-investigation", version: "1.0.0" }],
    });
  });
});
