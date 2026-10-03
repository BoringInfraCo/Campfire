import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURE, seedFixture } from "../../src/bootstrap/seed.js";
import { createCounterIdSource } from "../../src/domain/ids.js";
import { createCampfireMcpServer } from "../../src/mcp/tools.js";
import type { ServerIdentity } from "../../src/mcp/context.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import type { ActorContext } from "../../src/service/authorization.js";
import type { CampfireService } from "../../src/service/service.js";
import { openSqliteStore } from "../../src/store/sqlite-store.js";
import type { CampfireStore } from "../../src/store/store.js";
import { runCli } from "../../src/cli/index.js";
import { isTelemetryInstallationId } from "../../src/telemetry/contract.js";
import { reportActivated, reportActive } from "../../src/telemetry/report.js";
import { utcDay } from "../../src/telemetry/state.js";

/**
 * TEL-001 activation lifecycle (sprint section 9, section 17).
 *
 * Activation means "the first successful action demonstrating Campfire is
 * actually usable". The claims defended here are:
 *
 *   1. Only a meaningful success activates. `whoami`, `preflight`,
 *      `list_workspaces`, `get_workspace`, `get_activity`,
 *      `register_agent_session`, `create_goal`, `add_finding`, `--help`,
 *      `capabilities`, `setup`, and `telemetry status` do not; a failed call
 *      does not either.
 *   2. `get_workspace_context`, `join_workspace`, and `create_workspace` do.
 *   3. `activated` fires at most once per installation and `active` at most
 *      once per UTC day, so an agent loop cannot create event spam.
 *   4. Telemetry off means no product events at all.
 *
 * `reportMcpSuccess` is module-private in `src/mcp/tools.ts` and is left that
 * way. These tests drive the real MCP server over an in-memory transport and
 * observe the local telemetry state file, so the boundary is exercised exactly
 * as a product client would exercise it rather than through a test-only export.
 */

const NOW = "2026-01-01T00:00:00.000Z";
const DAY_ONE = new Date("2026-03-01T09:00:00.000Z");
const DAY_ONE_LATER = new Date("2026-03-01T21:00:00.000Z");
const DAY_TWO = new Date("2026-03-02T09:00:00.000Z");

const AGENT_SERGIO: ServerIdentity = {
  ctx: { actor: { actorId: FIXTURE.agents.codexSergio, actorType: "agent" } },
  harness: "codex",
};
const HUMAN_SERGIO: ServerIdentity = {
  ctx: { actor: { actorId: FIXTURE.humans.sergio, actorType: "human" } },
};
const HUMAN_CONTEXT: ActorContext = { actor: { actorId: FIXTURE.humans.sergio, actorType: "human" } };

const ENV_KEYS = [
  "CAMPFIRE_TELEMETRY",
  "CAMPFIRE_TELEMETRY_URL",
  "CAMPFIRE_URL",
  "CAMPFIRE_TOKEN",
  "CAMPFIRE_DB",
  "CAMPFIRE_OUTPUT",
  "CAMPFIRE_HARNESS",
] as const;

let dir: string;
let configDir: string;
let store: CampfireStore;
let service: CampfireService;
let logs: string[];
const saved: Record<string, string | undefined> = {};
const servers: McpServer[] = [];
const clients: Client[] = [];
/** Bodies of every telemetry POST the process attempted. */
let posted: Array<Record<string, unknown>> = [];

function statePath(): string {
  return join(configDir, "telemetry.json");
}

function telemetryState(): Record<string, unknown> {
  return JSON.parse(readFileSync(statePath(), "utf8")) as Record<string, unknown>;
}

function hasTelemetryState(): boolean {
  return existsSync(statePath());
}

function eventNames(): string[] {
  return posted.map((body) => String(body.event));
}

function countsByEvent(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const name of eventNames()) counts[name] = (counts[name] ?? 0) + 1;
  return counts;
}

interface ToolOutcome {
  isError: boolean;
  json: unknown;
}

async function connect(identity: ServerIdentity = AGENT_SERGIO): Promise<Client> {
  const server = createCampfireMcpServer({ service, identity });
  const client = new Client({ name: "campfire-tel-001", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  servers.push(server);
  clients.push(client);
  return client;
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolOutcome> {
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content?: Array<{ type: string; text?: string }>;
  };
  const text = result.content?.find((part) => part.type === "text" && typeof part.text === "string")?.text;
  return { isError: result.isError === true, json: text === undefined ? undefined : JSON.parse(text) };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "campfire-tel-001-life-"));
  configDir = join(dir, "config");
  process.env.CAMPFIRE_CONFIG_DIR = configDir;
  process.env.CAMPFIRE_DATA_DIR = join(dir, "data");
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  logs = [];
  posted = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  // Measurement must never reach the network from a test, and every recorded
  // POST is evidence for the activation and activity claims below.
  vi.stubGlobal("fetch", (async (_input: unknown, init?: RequestInit) => {
    posted.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({ ok: true, result: { recorded: true } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch);

  const sqlite = openSqliteStore(dbPathOf());
  seedFixture(sqlite, { clock: () => NOW });
  sqlite.close();
  store = openSqliteStore(":memory:");
  seedFixture(store, { clock: () => NOW });
  service = createCampfireService({ store, idSource: createCounterIdSource(), clock: () => NOW });
});

function dbPathOf(): string {
  return join(dir, "campfire.db");
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close().catch(() => undefined)));
  await Promise.all(servers.splice(0).map((server) => server.close().catch(() => undefined)));
  service.close();
  store.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
  for (const key of ENV_KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("the mcp activation boundary", () => {
  it("activates and counts activity on a successful workspace-context read", async () => {
    const client = await connect();
    const result = await callTool(client, "get_workspace_context", { workspaceId: FIXTURE.workspaces.billing });
    await flush();

    expect(result.isError).toBe(false);
    const state = telemetryState();
    expect(state.activatedOn).toBe(utcDay());
    expect(state.lastActiveOn).toBe(utcDay());
    expect(isTelemetryInstallationId(String(state.installationId))).toBe(true);
    expect(countsByEvent()).toEqual({ activated: 1, active: 1 });
    expect(posted.every((body) => body.surface === "mcp")).toBe(true);
    expect(posted.every((body) => body.installationId === state.installationId)).toBe(true);
  });

  it("activates on a successful create_workspace without spending the daily activity budget", async () => {
    const client = await connect();
    const result = await callTool(client, "create_workspace", {
      teamId: FIXTURE.teamId,
      name: "example-workspace-for-activation",
    });
    await flush();

    expect(result.isError).toBe(false);
    const state = telemetryState();
    expect(state.activatedOn).toBe(utcDay());
    // Bootstrapping is meaningful once; the daily `active` budget is reserved
    // for a returning participant reading the workspace.
    expect(state.lastActiveOn).toBeUndefined();
    expect(eventNames()).toEqual(["activated"]);
  });

  it("activates on a successful join_workspace", async () => {
    // A workspace the agent is not yet a participant of, invited through the
    // service so the setup itself crosses no MCP boundary.
    const fresh = service.createWorkspace(HUMAN_CONTEXT, { teamId: FIXTURE.teamId, name: "example-join-workspace" });
    service.inviteToWorkspace(HUMAN_CONTEXT, {
      workspaceId: fresh.id,
      actor: { actorId: FIXTURE.agents.codexSergio, actorType: "agent" },
      role: "agent",
    });

    const client = await connect();
    const result = await callTool(client, "join_workspace", { workspaceId: fresh.id });
    await flush();

    expect(result.isError).toBe(false);
    expect(telemetryState().activatedOn).toBe(utcDay());
    expect(eventNames()).toEqual(["activated"]);
  });

  it("does not activate for trivial, diagnostic, or workspace-presuming tools", async () => {
    // A goal-free workspace the agent will belong to, prepared through the
    // service so this setup step crosses no MCP boundary.
    const fresh = service.createWorkspace(HUMAN_CONTEXT, { teamId: FIXTURE.teamId, name: "example-goal-workspace" });
    service.inviteToWorkspace(HUMAN_CONTEXT, {
      workspaceId: fresh.id,
      actor: { actorId: FIXTURE.agents.codexSergio, actorType: "agent" },
      role: "agent",
    });
    service.joinWorkspace(
      { actor: { actorId: FIXTURE.agents.codexSergio, actorType: "agent" } },
      { workspaceId: fresh.id },
    );
    const billing = await connect();
    const freshWorkspace = await connect();
    const outcomes: ToolOutcome[] = [];
    outcomes.push(await callTool(billing, "whoami"));
    // Session registration is itself a workspace-presuming write, and it is
    // listed here because it must not be mistaken for activation.
    outcomes.push(
      await callTool(billing, "register_agent_session", {
        agentId: FIXTURE.agents.codexSergio,
        humanId: FIXTURE.humans.sergio,
        workspaceId: FIXTURE.workspaces.billing,
      }),
    );
    outcomes.push(await callTool(billing, "preflight", { workspaceId: FIXTURE.workspaces.billing }));
    outcomes.push(await callTool(billing, "list_workspaces"));
    outcomes.push(await callTool(billing, "get_workspace", { workspaceId: FIXTURE.workspaces.billing }));
    outcomes.push(await callTool(billing, "get_activity", { workspaceId: FIXTURE.workspaces.billing }));
    outcomes.push(await callTool(billing, "add_finding", {
      workspaceId: FIXTURE.workspaces.billing,
      summary: "example-repo deploys fail on Friday",
    }));
    outcomes.push(
      await callTool(freshWorkspace, "register_agent_session", {
        agentId: FIXTURE.agents.codexSergio,
        humanId: FIXTURE.humans.sergio,
        workspaceId: fresh.id,
      }),
    );
    outcomes.push(await callTool(freshWorkspace, "create_goal", { workspaceId: fresh.id, title: "Ship example-repo" }));
    await flush();

    // Every one of these really succeeded: a failing call proves nothing about
    // the post-success hook.
    expect(outcomes.map((outcome) => outcome.isError)).toEqual(outcomes.map(() => false));
    expect(hasTelemetryState()).toBe(false);
    expect(posted).toEqual([]);
  });

  it("does not activate when the meaningful call fails", async () => {
    // An agent that is not a participant of the workspace gets 403, not context.
    const client = await connect();
    const result = await callTool(client, "get_workspace_context", {
      workspaceId: FIXTURE.workspaces.unrelated,
    });
    await flush();

    expect(result.isError).toBe(true);
    expect(hasTelemetryState()).toBe(false);
    expect(posted).toEqual([]);
  });

  it("emits one activated and one active for an agent loop, whatever the surface count", async () => {
    const client = await connect();
    const dayBefore = utcDay();
    for (let i = 0; i < 50; i += 1) {
      const result = await callTool(client, "get_workspace_context", { workspaceId: FIXTURE.workspaces.billing });
      expect(result.isError).toBe(false);
    }
    await flush();
    const dayAfter = utcDay();

    // An agent loop calling a tool hundreds of times produces one of each.
    expect(countsByEvent()).toEqual({ activated: 1, active: 1 });
    const state = telemetryState();
    expect([dayBefore, dayAfter]).toContain(String(state.activatedOn));
    expect([dayBefore, dayAfter]).toContain(String(state.lastActiveOn));
    expect(isTelemetryInstallationId(String(state.installationId))).toBe(true);
  });

  it("does not let a second surface double-count the same installation", async () => {
    const mcp = await connect();
    const cliSurface = await connect(HUMAN_SERGIO);
    await callTool(mcp, "get_workspace_context", { workspaceId: FIXTURE.workspaces.billing });
    await callTool(cliSurface, "get_workspace_context", { workspaceId: FIXTURE.workspaces.billing });
    await flush();

    expect(countsByEvent()).toEqual({ activated: 1, active: 1 });
  });
});

describe("the cli activation boundary", () => {
  it("activates on a real workspace-context read through withBackend", async () => {
    await runCli(["--db", dbPathOf(), "status", FIXTURE.workspaces.billing, "--output", "json"]);
    await flush();

    const state = telemetryState();
    expect(state.activatedOn).toBe(utcDay());
    expect(state.lastActiveOn).toBe(utcDay());
    expect(countsByEvent()).toEqual({ activated: 1, active: 1 });
    expect(posted.every((body) => body.surface === "cli")).toBe(true);
  });

  it("does not activate on trivial commands", async () => {
    for (const argv of [
      ["--db", dbPathOf(), "capabilities", "--output", "json"],
      ["--db", dbPathOf(), "setup", "--output", "json"],
      ["--db", dbPathOf(), "telemetry", "status", "--output", "json"],
      ["--db", dbPathOf(), "--help"],
      ["--db", dbPathOf(), "help"],
    ]) {
      await runCli(argv);
      await flush();
      expect(hasTelemetryState(), argv.join(" ")).toBe(false);
    }
    expect(posted).toEqual([]);
  });

  it("does not activate on a failed read", async () => {
    await expect(
      runCli(["--db", dbPathOf(), "status", "ws_missing_workspace", "--output", "json"]),
    ).rejects.toThrow();
    await flush();
    expect(hasTelemetryState()).toBe(false);
    expect(posted).toEqual([]);
  });

  it("does not activate a telemetry command that writes the preference", async () => {
    await runCli(["--db", dbPathOf(), "telemetry", "enable", "--output", "json"]);
    await flush();
    // `enable` writes a state file, but it must not claim an activation.
    expect(telemetryState().activatedOn).toBeUndefined();
    expect(telemetryState().lastActiveOn).toBeUndefined();
    expect(posted).toEqual([]);
  });
});

describe("bounded lifecycle claims", () => {
  const fetchImpl = (async (_input: unknown, init?: RequestInit) => {
    posted.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(null, { status: 202 });
  }) as unknown as typeof fetch;

  it("claims one activated and one active for fifty calls in one day", async () => {
    const env = { ...process.env, CAMPFIRE_CONFIG_DIR: configDir };
    const options = { env, fetchImpl, now: DAY_ONE };
    for (let i = 0; i < 50; i += 1) {
      await reportActivated("cli", options);
      await reportActive("cli", options);
    }

    expect(countsByEvent()).toEqual({ activated: 1, active: 1 });
    expect(telemetryState().activatedOn).toBe("2026-03-01");
    expect(telemetryState().lastActiveOn).toBe("2026-03-01");
  });

  it("claims exactly one more active on a later utc day and no second activated", async () => {
    const env = { ...process.env, CAMPFIRE_CONFIG_DIR: configDir };
    for (let i = 0; i < 25; i += 1) {
      await reportActive("mcp", { env, fetchImpl, now: DAY_ONE_LATER });
    }
    await reportActive("agent", { env, fetchImpl, now: DAY_TWO });
    for (let i = 0; i < 25; i += 1) {
      await reportActive("cli", { env, fetchImpl, now: DAY_TWO });
    }

    // Two UTC days, two activity events, and no activation at all: activity
    // claims do not imply activation.
    expect(countsByEvent()).toEqual({ active: 2 });
    expect(telemetryState().lastActiveOn).toBe("2026-03-02");
    expect(telemetryState().activatedOn).toBeUndefined();
  });

  it("sends no product events and writes no state when telemetry is disabled", async () => {
    const env = { ...process.env, CAMPFIRE_CONFIG_DIR: configDir, CAMPFIRE_TELEMETRY: "0" };
    for (let i = 0; i < 10; i += 1) {
      await reportActivated("cli", { env, fetchImpl, now: DAY_ONE });
      await reportActive("cli", { env, fetchImpl, now: DAY_ONE });
    }
    expect(posted).toEqual([]);
    expect(hasTelemetryState()).toBe(false);
  });

  it("sends no product events for a disabled cli read", async () => {
    process.env.CAMPFIRE_TELEMETRY = "0";
    await runCli(["--db", dbPathOf(), "status", FIXTURE.workspaces.billing, "--output", "json"]);
    await flush();

    expect(hasTelemetryState()).toBe(false);
    expect(posted).toEqual([]);
    // The command itself still succeeded: telemetry is not on the critical path.
    expect(logs.join("\n")).toContain(FIXTURE.workspaces.billing);
  });
});
