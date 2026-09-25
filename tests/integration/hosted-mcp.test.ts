import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FIXTURE, seedFixture } from "../../src/bootstrap/seed.js";
import { startCampfireHttpServer } from "../../src/http/server.js";
import type { RunningHttpServer } from "../../src/http/server.js";
import { createCampfireMcpServer } from "../../src/mcp/tools.js";
import { resolveRemoteIdentity, startStdioServer } from "../../src/mcp/stdio.js";
import type { ServerIdentity } from "../../src/mcp/context.js";
import { createRuntimeFromPath } from "../../src/runtime.js";
import type { CampfireRuntime } from "../../src/runtime.js";

interface ToolOutcome {
  isError: boolean;
  json: any;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<ToolOutcome> {
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content?: Array<{ type: string; text?: string }>;
  };
  const text = result.content?.find((part) => part.type === "text" && typeof part.text === "string")?.text;
  return {
    isError: result.isError === true,
    json: text === undefined ? undefined : JSON.parse(text),
  };
}

let dir: string;
let runtime: CampfireRuntime;
let running: RunningHttpServer;
const openServers: McpServer[] = [];
const openClients: Client[] = [];

async function connectServer(options: {
  identity: ServerIdentity;
  service?: CampfireRuntime["service"];
  remote?: { url: string; token: string };
}): Promise<Client> {
  const server = createCampfireMcpServer(options);
  const client = new Client({ name: "campfire-hosted-mcp-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  openServers.push(server);
  openClients.push(client);
  return client;
}

async function connectHostedIdentity(token: string, harness: string): Promise<Client> {
  const identity = await resolveRemoteIdentity(
    running.url,
    token,
    { CAMPFIRE_URL: running.url, CAMPFIRE_HARNESS: harness },
    [],
  );
  return connectServer({ identity, remote: { url: running.url, token } });
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "campfire-hosted-mcp-"));
  runtime = createRuntimeFromPath(join(dir, "campfire.db"));
  seedFixture(runtime.store);
  vi.spyOn(console, "error").mockImplementation(() => {});
  running = await startCampfireHttpServer({ runtime, host: "127.0.0.1", port: 0 });
});

afterEach(async () => {
  await Promise.all(openClients.splice(0).map((client) => client.close()));
  await Promise.all(openServers.splice(0).map((server) => server.close()));
  await running.close();
  runtime.close();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe("hosted MCP readiness", () => {
  it("resolves equivalent Codex and OpenCode readiness through hosted HTTP", async () => {
    const codex = await connectHostedIdentity(FIXTURE.tokens.codexSergio, "codex");
    const opencode = await connectHostedIdentity(FIXTURE.tokens.opencodeAlice, "opencode");

    for (const [client, agentId] of [
      [codex, FIXTURE.agents.codexSergio],
      [opencode, FIXTURE.agents.opencodeAlice],
    ] as const) {
      const session = await call(client, "register_agent_session", {
        agentId,
        workspaceId: FIXTURE.workspaces.billing,
      });
      expect(session.isError).toBe(false);

      const ready = await call(client, "preflight", {
        workspaceId: FIXTURE.workspaces.billing,
      });
      expect(ready.isError).toBe(false);
      expect(ready.json).toMatchObject({
        ready: true,
        workspaceId: FIXTURE.workspaces.billing,
        actor: { actorId: agentId, actorType: "agent" },
        sessionId: session.json.id,
      });
    }
  });

  it("does not re-emit token-bearing remote preflight errors", async () => {
    const token = "cft_hosted_mcp_remote_secret";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          error: "Unauthorized",
          message: `Remote rejected ${token}`,
          details: { echoedToken: token },
        }),
        { status: 401, headers: { "content-type": "application/json" } },
      ),
    );
    const client = await connectServer({
      identity: { ctx: { actor: { actorId: FIXTURE.agents.codexSergio, actorType: "agent" } } },
      remote: { url: "https://campfire.invalid", token },
    });

    const result = await call(client, "preflight", { workspaceId: FIXTURE.workspaces.billing });

    expect(result.isError).toBe(true);
    expect(result.json).toMatchObject({
      error: "Unauthorized",
      details: { nextAction: "register_agent_session" },
    });
    expect(result.json.message).toContain("verify CAMPFIRE_TOKEN");
    expect(JSON.stringify(result.json)).not.toContain(token);
  });

  it("does not re-emit token-bearing remote identity startup errors", async () => {
    const token = "cft_hosted_startup_remote_secret";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          error: "Unauthorized",
          message: `Startup rejected ${token}`,
          details: { echoedToken: token },
        }),
        { status: 401, headers: { "content-type": "application/json" } },
      ),
    );

    let thrown: unknown;
    try {
      await startStdioServer(
        undefined,
        { CAMPFIRE_URL: "https://campfire.invalid", CAMPFIRE_TOKEN: token },
        [],
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      code: "Unauthorized",
      message: expect.stringContaining("verify CAMPFIRE_TOKEN"),
      details: { nextAction: "verify_campfire_token" },
    });
    expect(String((thrown as Error).message)).not.toContain(token);
    expect(JSON.stringify((thrown as { details?: unknown }).details)).not.toContain(token);
  });
});
