/**
 * ARH-001 live MCP capture for the frozen v1.20.1 baseline (contract §3.1).
 *
 * FIXTURE EVIDENCE — calibrates the surface record; cannot establish Gate B, C, or E.
 *
 * Connects the real Campfire MCP server (`createCampfireMcpServer`, the same
 * construction as tests/integration/att-001.test.ts) to an in-memory MCP
 * client through `InMemoryTransport`, bound to the fixture actor
 * `hum_arh001_ana`, and captures the artifact surface:
 *
 * - `tools/list` (tool names and count);
 * - `get_artifact` for `art_arh001_safe_output` (raw record including
 *   `uriOrPath`, unwrapped);
 * - `list_artifacts` for `ws_arh001_trunc_artifacts` (bounded page with
 *   `nextCursor`).
 *
 *   CAMPFIRE_TELEMETRY=0 npx tsx fixtures/artifact-handoff/arh-001/capture-mcp.ts \
 *     --db fixtures/artifact-handoff/arh-001/.tmp/served/campfire.db \
 *     --out docs/evidence/arh-001/baseline/captures/mcp
 *
 * Every response is written as the parsed JSON text of the tool result; the
 * raw tool-result framing is noted in the summary.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { ServerIdentity } from "../../../src/mcp/context.js";
import { createCampfireMcpServer } from "../../../src/mcp/tools.js";
import { createRuntimeFromPath } from "../../../src/runtime.js";
import { SCENARIO } from "./seed.js";

function fail(message: string): never {
  throw new Error(`arh-001 capture-mcp: ${message}`);
}

function parseArgs(argv: string[]): { db: string; out: string } {
  let db: string | undefined;
  let out: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === "--db" || arg === "--out") {
      if (value === undefined || value.startsWith("--")) fail(`${arg} requires a value`);
      if (arg === "--db") db = isAbsolute(value) ? value : resolve(value);
      else out = isAbsolute(value) ? value : resolve(value);
      index += 1;
      continue;
    }
    fail(`unknown argument ${arg}`);
  }
  if (db === undefined) fail("--db is required");
  if (out === undefined) fail("--out is required");
  return { db, out };
}

interface ToolResultLike {
  isError?: boolean;
  content?: Array<{ type?: string; text?: string }>;
}

/** The MCP success shape is `{ content: [{ type: "text", text: <json> }] }`. */
function parsedResult(result: ToolResultLike): unknown {
  const text = result.content?.[0]?.text;
  if (typeof text !== "string") fail("tool result carried no text content");
  return JSON.parse(text) as unknown;
}

const args = parseArgs(process.argv.slice(2));
mkdirSync(args.out, { recursive: true });

const runtime = createRuntimeFromPath(args.db);
const identity = {
  ctx: { actor: { actorId: SCENARIO.humans.ana, actorType: "human" as const } },
} as ServerIdentity;
const server = createCampfireMcpServer({ service: runtime.service, identity });
const client = new Client({ name: "arh-001-capture", version: "0.0.0" });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

try {
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  const listed = await client.listTools();
  const toolNames = listed.tools.map((tool) => tool.name);
  writeFileSync(resolve(args.out, "tools-list.json"), `${JSON.stringify(listed.tools, null, 2)}\n`);

  const getArtifact = (await client.callTool({
    name: "get_artifact",
    arguments: { workspaceId: SCENARIO.workspaces.lab, artifactId: SCENARIO.artifacts.safeOutput },
  })) as ToolResultLike;
  const getArtifactValue = parsedResult(getArtifact);
  writeFileSync(
    resolve(args.out, "get-artifact-art_arh001_safe_output.json"),
    `${JSON.stringify(getArtifactValue, null, 2)}\n`,
  );

  const listArtifacts = (await client.callTool({
    name: "list_artifacts",
    arguments: { workspaceId: SCENARIO.workspaces.truncArtifacts },
  })) as ToolResultLike;
  const listArtifactsValue = parsedResult(listArtifacts);
  writeFileSync(
    resolve(args.out, "list-artifacts-ws_arh001_trunc_artifacts.json"),
    `${JSON.stringify(listArtifactsValue, null, 2)}\n`,
  );

  const page = listArtifactsValue as {
    total?: number;
    returned?: number;
    truncated?: boolean;
    nextCursor?: string;
    items?: unknown[];
  };
  const record = getArtifactValue as Record<string, unknown>;
  const summary = {
    provenance: "FIXTURE EVIDENCE — cannot establish Gate B, C, or E.",
    methodNote:
      "Live in-process MCP: createCampfireMcpServer + @modelcontextprotocol/sdk InMemoryTransport client, actor hum_arh001_ana; files hold the parsed JSON text of each tool result.",
    toolCount: toolNames.length,
    artifactTools: toolNames.filter((name) => name.includes("artifact")),
    getArtifact: {
      isError: getArtifact.isError === true,
      id: record.id,
      fields: Object.keys(record).sort(),
      uriOrPath: record.uriOrPath,
    },
    listArtifacts: {
      isError: listArtifacts.isError === true,
      total: page.total,
      returned: page.returned,
      truncated: page.truncated,
      nextCursorPresent: typeof page.nextCursor === "string" && page.nextCursor.length > 0,
      itemCount: page.items?.length,
    },
  };
  writeFileSync(resolve(args.out, "capture-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} finally {
  await client.close();
  await server.close();
  runtime.close();
}
