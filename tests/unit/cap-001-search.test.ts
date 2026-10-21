/**
 * CAP-001 catalog search and read recipes.
 *
 * Engineering checks against the frozen Step 0 query and recipe files.
 * The contract copies under fixtures/cap-001/contract/ are byte-identical to
 * the private Step 0 evidence so this file can run in the public snapshot.
 * Not a harness trace and not a release decision.
 */
import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  CAPABILITY_LIMIT_ERROR,
  CAPABILITY_OMISSIONS,
  CAPABILITY_QUERY_ERROR,
  CAPABILITY_RECIPE_ERROR,
  CAPABILITY_SEARCH_MAX_BYTES,
  MCP_TOOL_NAMES,
  READ_RECIPE_MAX_BYTES,
  assertCorpusParity,
  capabilityOmissions,
  capabilityOperations,
  getReadRecipe,
  searchCapabilities,
  type CapabilitySearch,
} from "../../src/catalog/capability-search.js";
import { commandDiscoverable, commandSpec, type CliCommand } from "../../src/cli/catalog.js";
import { runCli, runCliEntry } from "../../src/cli/index.js";
import { ValidationError } from "../../src/domain/errors.js";
import { createCampfireMcpServer } from "../../src/mcp/tools.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import { openInMemoryStore } from "../../src/store/sqlite-store.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PROPOSED = join(ROOT, "fixtures/cap-001/contract");
const ANSWER_KEY = join(PROPOSED, "answer-key.json");

interface QueryCase {
  id: string;
  query?: string;
  limit?: number | null;
  expect: "projection" | "error";
  normalizedQuery?: string;
  normalizedQueryLength?: number;
  returned?: number;
  totalMatches?: number;
  truncated?: boolean;
  entryIds?: string[];
  recipeIds?: string[];
  code?: string;
  field?: string;
  recipeId?: string;
}

const queries = JSON.parse(readFileSync(join(PROPOSED, "queries.json"), "utf8")) as { cases: QueryCase[] };
const frozenCatalog = JSON.parse(readFileSync(join(PROPOSED, "catalog.json"), "utf8")) as {
  operations: unknown[];
};
const answerKey = JSON.parse(readFileSync(ANSWER_KEY, "utf8")) as {
  actors: { authorized: string; denied: string };
  workspaces: { authorized: string; unreadableByAuthorizedActor: string };
};

const FIXTURE_MARKERS = [
  "hum_cap001",
  "ws_cap001",
  "task_cap001",
  "find_cap001",
  "dec_cap001",
  "CAP001_OTHER_SENTINEL",
  answerKey.actors.authorized,
  answerKey.actors.denied,
  answerKey.workspaces.authorized,
  answerKey.workspaces.unreadableByAuthorizedActor,
];

const INSPECT_OPERATIONS = new Set(["get_artifact", "get_decision", "get_finding", "get_task"]);

let logs: string[];
let errors: string[];
let previousPlaybook: string | undefined;
let previousDb: string | undefined;
let previousUrl: string | undefined;

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(PROPOSED, name), "utf8")) as T;
}

function projectionCases(): QueryCase[] {
  return queries.cases.filter((entry) => entry.expect === "projection");
}

beforeEach(() => {
  logs = [];
  errors = [];
  previousPlaybook = process.env.CAMPFIRE_PLAYBOOK;
  previousDb = process.env.CAMPFIRE_DB;
  previousUrl = process.env.CAMPFIRE_URL;
  delete process.env.CAMPFIRE_PLAYBOOK;
  delete process.env.CAMPFIRE_URL;
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (previousPlaybook === undefined) delete process.env.CAMPFIRE_PLAYBOOK;
  else process.env.CAMPFIRE_PLAYBOOK = previousPlaybook;
  if (previousDb === undefined) delete process.env.CAMPFIRE_DB;
  else process.env.CAMPFIRE_DB = previousDb;
  if (previousUrl === undefined) delete process.env.CAMPFIRE_URL;
  else process.env.CAMPFIRE_URL = previousUrl;
});

describe("frozen query cases", () => {
  it.each(queries.cases.map((entry) => [entry.id, entry] as const))("%s", (_id, entry) => {
    if (entry.expect === "error" && entry.recipeId !== undefined) {
      expect(() => getReadRecipe(entry.recipeId!)).toThrow(ValidationError);
      try {
        getReadRecipe(entry.recipeId);
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).code).toBe("ValidationError");
        expect((error as ValidationError).message).toBe(CAPABILITY_RECIPE_ERROR);
        expect((error as ValidationError).details).toEqual({ field: "id" });
      }
      return;
    }
    const limit = entry.limit === null || entry.limit === undefined ? undefined : entry.limit;
    if (entry.expect === "error") {
      expect(() => searchCapabilities(entry.query ?? "", limit)).toThrow(ValidationError);
      try {
        searchCapabilities(entry.query ?? "", limit);
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).code).toBe(entry.code);
        expect((error as ValidationError).details).toEqual({ field: entry.field });
        const message = entry.field === "limit" ? CAPABILITY_LIMIT_ERROR : CAPABILITY_QUERY_ERROR;
        expect((error as ValidationError).message).toBe(message);
      }
      return;
    }
    const result = searchCapabilities(entry.query ?? "", limit);
    expect(result.kind).toBe("capability_search");
    expect(result.catalogVersion).toBe(1);
    if (entry.normalizedQuery !== undefined) expect(result.query).toBe(entry.normalizedQuery);
    expect(result.query.length).toBe(entry.normalizedQueryLength ?? entry.normalizedQuery?.length);
    expect(result.returned).toBe(entry.returned);
    expect(result.totalMatches).toBe(entry.totalMatches);
    expect(result.truncated).toBe(entry.truncated);
    expect(result.returned).toBe(result.entries.length);
    expect(result.entries.map((item) => item.id)).toEqual(entry.entryIds);
    expect(result.recipeSummaries.map((item) => item.id)).toEqual(entry.recipeIds);
    expect(result.entries.map((item) => item.id)).toEqual([...result.entries.map((item) => item.id)].sort());
  });
});

describe("recipes and corpus bounds", () => {
  it("returns deep copies equal to the frozen recipe files", () => {
    for (const name of ["continue-blocked-work.json", "review-decision-basis.json"] as const) {
      const frozen = readJson<Record<string, unknown>>(name);
      const id = frozen.id;
      expect(typeof id).toBe("string");
      const recipe = getReadRecipe(String(id));
      expect(JSON.parse(JSON.stringify(recipe))).toEqual(frozen);
      expect(Buffer.byteLength(JSON.stringify(recipe), "utf8")).toBeLessThanOrEqual(READ_RECIPE_MAX_BYTES);
      expect(Buffer.byteLength(JSON.stringify(recipe), "utf8")).toBeLessThanOrEqual(8192);
      recipe.goal = "mutated";
      expect(getReadRecipe(String(id)).goal).toBe(frozen.goal);
    }
  });

  it("copies the frozen gate-off operations and keeps the playbook out", () => {
    expect(capabilityOperations()).toEqual(frozenCatalog.operations);
    const blob = JSON.stringify(capabilityOperations());
    expect(blob).not.toContain("get_playbook");
    expect(blob).not.toContain("incident-investigation");
    const enabled = capabilityOperations({ playbookEnabled: true });
    expect(enabled.map((entry) => entry.id)).toContain("get_playbook");
    expect(enabled).toHaveLength(frozenCatalog.operations.length + 1);
  });

  it("adds get_playbook only when the gate is on and the query is a real substring", () => {
    const off = searchCapabilities("recorded", undefined);
    expect(off.entries.map((entry) => entry.id)).toEqual(["get_decision"]);
    // "recording" does not contain "recorded", so the frozen recorded case stays one entry.
    const recordedOn = searchCapabilities("recorded", undefined, { playbookEnabled: true });
    expect(recordedOn.entries.map((entry) => entry.id)).toEqual(["get_decision"]);
    const on = searchCapabilities("recording", undefined, { playbookEnabled: true });
    expect(on.entries.map((entry) => entry.id)).toEqual(["get_playbook"]);
    expect(searchCapabilities("recording", undefined).entries).toEqual([]);
    expect(on.recipeSummaries.map((entry) => entry.id)).toEqual([]);
    const playbook = on.entries.find((entry) => entry.id === "get_playbook");
    expect(playbook?.surfaces).toEqual({
      cli: { usage: commandSpec("playbook").usage },
      mcp: { tool: "get_playbook" },
    });
    expect(playbook?.outputCaveat).toBe("Not a workspace read and not a grant.");
    expect(playbook?.preconditions).toEqual(["Requires the existing playbook gate."]);
  });

  it("keeps fixture ids and the largest frozen projection inside the byte budget", () => {
    let largest = 0;
    for (const entry of projectionCases()) {
      const limit = entry.limit === null || entry.limit === undefined ? undefined : entry.limit;
      const result = searchCapabilities(entry.query ?? "", limit);
      const encoded = JSON.stringify(result);
      largest = Math.max(largest, Buffer.byteLength(encoded, "utf8"));
      for (const marker of FIXTURE_MARKERS) {
        expect(encoded).not.toContain(marker);
      }
    }
    expect(largest).toBeLessThanOrEqual(CAPABILITY_SEARCH_MAX_BYTES);
    expect(largest).toBeLessThanOrEqual(16384);
  });
});

describe("parity", () => {
  it("keeps frozen usages, with inspect selector drift recorded", () => {
    for (const operation of capabilityOperations()) {
      const cli = operation.surfaces.cli;
      if (!("usage" in cli)) continue;
      const word = cli.usage.split(" ")[1] as CliCommand;
      const live = commandSpec(word).usage;
      if (INSPECT_OPERATIONS.has(operation.id)) {
        expect(live.startsWith("campfire inspect ")).toBe(true);
        expect(cli.usage).not.toBe(live);
        expect(cli.usage.startsWith(`campfire inspect ${operation.id.slice(4)} `)).toBe(true);
      } else {
        expect(cli.usage).toBe(live);
      }
    }
    const history = capabilityOperations().find((entry) => entry.id === "get_record_history");
    const bridge = capabilityOperations().find((entry) => entry.id === "bridge");
    const capabilities = capabilityOperations().find((entry) => entry.id === "capabilities");
    expect(history?.surfaces.cli).toEqual({
      unavailable: "MCP-only read. campfire activity is workspace-wide and is not this record history.",
    });
    expect(bridge?.surfaces.mcp).toEqual({ unavailable: "operator CLI only; not an agent MCP tool" });
    expect(capabilities?.surfaces.mcp).toEqual({
      unavailable: "CLI manifest only; MCP provides tools/list and discover_capabilities",
    });
  });

  it("covers or omits every discoverable command and live tool", async () => {
    const store = openInMemoryStore();
    const service = createCampfireService({ store });
    const offServer = createCampfireMcpServer({
      service,
      identity: { ctx: { actor: { actorId: "hum_cap001_ada", actorType: "human" } } },
    });
    const onServer = createCampfireMcpServer({
      service,
      identity: { ctx: { actor: { actorId: "hum_cap001_ada", actorType: "human" } } },
      playbookEnabled: true,
    });
    const offClient = new Client({ name: "cap-001-off", version: "0.0.0" });
    const onClient = new Client({ name: "cap-001-on", version: "0.0.0" });
    const [offClientTransport, offServerTransport] = InMemoryTransport.createLinkedPair();
    const [onClientTransport, onServerTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      offClient.connect(offClientTransport),
      offServer.connect(offServerTransport),
      onClient.connect(onClientTransport),
      onServer.connect(onServerTransport),
    ]);
    try {
      const offNames = (await offClient.listTools()).tools.map((tool) => tool.name).sort();
      const onNames = (await onClient.listTools()).tools.map((tool) => tool.name).sort();
      expect(offNames).toEqual([...MCP_TOOL_NAMES].sort());
      expect(onNames).toEqual([...MCP_TOOL_NAMES, "get_playbook"].sort());
      const offCommands = ["setup", "context", "inspect", "playbook"].filter((name) =>
        commandDiscoverable(name as CliCommand, {}),
      );
      expect(offCommands).not.toContain("playbook");
      const discoverableOff = (await import("../../src/cli/catalog.js")).CLI_COMMAND_NAMES.filter((name) =>
        commandDiscoverable(name, {}),
      );
      assertCorpusParity({ cliCommands: discoverableOff, mcpTools: offNames, playbookEnabled: false });
      const discoverableOn = (await import("../../src/cli/catalog.js")).CLI_COMMAND_NAMES.filter((name) =>
        commandDiscoverable(name, { CAMPFIRE_PLAYBOOK: "1" }),
      );
      assertCorpusParity({ cliCommands: discoverableOn, mcpTools: onNames, playbookEnabled: true });
      expect(CAPABILITY_OMISSIONS.some((entry) => entry.surface === "cli" && entry.name === "recall")).toBe(true);
      expect(CAPABILITY_OMISSIONS.some((entry) => entry.surface === "mcp" && entry.name === "discover_capabilities")).toBe(
        true,
      );
      expect(
        CAPABILITY_OMISSIONS.find((entry) => entry.name === "get_read_recipe")?.reason,
      ).toBe("Local catalog projection, not a workspace operation.");
      expect(CAPABILITY_OMISSIONS.find((entry) => entry.name === "recall")?.reason).toContain("not a grant");
      expect(capabilityOmissions({ playbookEnabled: true }).some((entry) => entry.name === "playbook")).toBe(false);
      expect(capabilityOmissions({ playbookEnabled: true }).some((entry) => entry.name === "get_playbook")).toBe(false);
      const context = (await offClient.listTools()).tools.find((tool) => tool.name === "get_workspace_context");
      expect(Object.keys(context?.inputSchema?.properties ?? {}).sort()).toEqual([
        "participants",
        "since",
        "workspaceId",
      ]);
    } finally {
      await offClient.close();
      await onClient.close();
      await offServer.close();
      await onServer.close();
      service.close();
    }
  });
});

describe("CLI and MCP adapters", () => {
  async function callTool(name: string, args: Record<string, unknown>, playbookEnabled = false) {
    const store = openInMemoryStore();
    const service = createCampfireService({ store });
    const server = createCampfireMcpServer({
      service,
      identity: { ctx: { actor: { actorId: "hum_cap001_ada", actorType: "human" } } },
      ...(playbookEnabled ? { playbookEnabled: true } : {}),
    });
    const client = new Client({ name: "cap-001-call", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    try {
      const result = (await client.callTool({ name, arguments: args })) as {
        isError?: boolean;
        content?: Array<{ type: string; text?: string }>;
      };
      const text = result.content?.find((part) => part.type === "text")?.text;
      return { isError: result.isError === true, json: text === undefined ? undefined : JSON.parse(text) };
    } finally {
      await client.close();
      await server.close();
      service.close();
    }
  }

  it("keeps the unqualified manifest and adds capabilities variants", async () => {
    await runCli(["capabilities", "--output", "json", "--limit", "3"]);
    const manifest = JSON.parse(logs.join("\n")) as {
      kind: string;
      commands: Array<Record<string, unknown>>;
    };
    expect(manifest.kind).toBe("cli_command_manifest");
    const entry = manifest.commands.find((command) => command.name === "capabilities");
    expect(entry).toMatchObject({
      name: "capabilities",
      description: "Describe the installed Campfire CLI commands.",
      usage: "campfire capabilities [--output json]",
      mutates: false,
      workspaceScoped: false,
      outputModes: ["auto", "human", "json"],
      protocol: false,
    });
    expect(entry?.variants).toEqual([
      {
        selector: "--search",
        usage: "campfire capabilities --search <query> [--limit <1..10>] [--output auto|human|json]",
        mutates: false,
        outputModes: ["auto", "human", "json"],
      },
      {
        selector: "--recipe",
        usage: "campfire capabilities --recipe <id> [--output auto|human|json]",
        mutates: false,
        outputModes: ["auto", "human", "json"],
      },
    ]);
  });

  it("returns the same search and recipe JSON from CLI and MCP", async () => {
    const dbDir = mkdtempSync(join(tmpdir(), "cap-001-nodb-"));
    process.env.CAMPFIRE_DB = join(dbDir, "missing.db");
    expect(await runCliEntry(["capabilities", "--search", "blocked work", "--output", "json"])).toBe(0);
    const cliSearch = JSON.parse(logs.at(-1) ?? "") as CapabilitySearch;
    expect(cliSearch).toEqual(searchCapabilities("blocked work", undefined));
    const mcpSearch = await callTool("discover_capabilities", { query: "blocked work" });
    expect(mcpSearch.isError).toBe(false);
    expect(mcpSearch.json).toEqual(cliSearch);

    logs = [];
    expect(
      await runCliEntry(["capabilities", "--recipe", "review-decision-basis", "--output", "json"]),
    ).toBe(0);
    const cliRecipe = JSON.parse(logs.at(-1) ?? "");
    expect(cliRecipe).toEqual(JSON.parse(JSON.stringify(getReadRecipe("review-decision-basis"))));
    const mcpRecipe = await callTool("get_read_recipe", { id: "review-decision-basis" });
    expect(mcpRecipe.json).toEqual(cliRecipe);

    logs = [];
    await runCli(["capabilities", "--search", "blocked work", "--output", "human"]);
    const human = logs.join("\n");
    expect(human).not.toMatch(/\u001b/);
    expect(human).toContain("get_task — Read one shared work task by id.");
    expect(human).toContain("continue-blocked-work — ");
    expect(human).not.toContain("ws_cap001");

    logs = [];
    await runCli(["capabilities", "--recipe", "continue-blocked-work", "--output", "human"]);
    const lines = logs.join("\n").split("\n");
    const recipe = getReadRecipe("continue-blocked-work");
    expect(lines[0]).toBe(recipe.id);
    expect(lines[1]).toBe(recipe.goal);
    expect(lines.slice(2)).toEqual(recipe.steps.map((step) => step.operationId));
  });

  it("reports validation errors with ValidationError", async () => {
    expect(await runCliEntry(["capabilities", "--search", "--recipe", "continue-blocked-work", "--output", "json"])).toBe(1);
    const both = JSON.parse(errors.at(-1) ?? "") as { error: { code: string; message: string; details: { field: string } } };
    expect(both.error.code).toBe("ValidationError");
    expect(both.error.message).toBe("Pass only one of --search or --recipe.");
    expect(both.error.details.field).toBe("query");

    errors = [];
    expect(await runCliEntry(["capabilities", "--search", "--output", "json"])).toBe(1);
    expect(JSON.parse(errors.at(-1) ?? "").error).toMatchObject({
      code: "ValidationError",
      message: CAPABILITY_QUERY_ERROR,
      details: { field: "query" },
    });

    errors = [];
    expect(await runCliEntry(["capabilities", "--search", "workspace", "--limit", "--output", "json"])).toBe(1);
    expect(JSON.parse(errors.at(-1) ?? "").error).toMatchObject({
      code: "ValidationError",
      message: CAPABILITY_LIMIT_ERROR,
      details: { field: "limit" },
    });

    const mcpLimit = await callTool("discover_capabilities", { query: "workspace", limit: 1.5 });
    expect(mcpLimit.isError).toBe(true);
    expect(mcpLimit.json).toMatchObject({
      error: "ValidationError",
      message: CAPABILITY_LIMIT_ERROR,
      details: { field: "limit" },
    });
    const mcpZero = await callTool("discover_capabilities", { query: "workspace", limit: 0 });
    expect(mcpZero.json.details.field).toBe("limit");
    const mcpEleven = await callTool("discover_capabilities", { query: "workspace", limit: 11 });
    expect(mcpEleven.json.details.field).toBe("limit");
    const mcpEmpty = await callTool("discover_capabilities", { query: "", limit: 11 });
    expect(mcpEmpty.json.details.field).toBe("query");
    const mcpRecipe = await callTool("get_read_recipe", { id: "no-such-recipe" });
    expect(mcpRecipe.json).toMatchObject({
      error: "ValidationError",
      message: CAPABILITY_RECIPE_ERROR,
      details: { field: "id" },
    });
  });
});
