/**
 * CMP-001 whole-handshake size gate: the tools/list JSON-RPC frame (stdio
 * shape, newline included) over the frozen fixture stays within the release
 * ceiling. Frozen baseline 25,336 bytes; ceiling 2.05x = 51,939.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { FIXTURE, seedFixture } from "../../src/bootstrap/seed.js";
import { createCounterIdSource } from "../../src/domain/ids.js";
import type { ServerIdentity } from "../../src/mcp/context.js";
import { createCampfireMcpServer } from "../../src/mcp/tools.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CampfireService } from "../../src/service/service.js";
import { openInMemoryStore } from "../../src/store/sqlite-store.js";

const NOW = "2026-01-01T00:00:00.000Z";
const BASELINE_BYTES = 25_336;
const CEILING_BYTES = 51_939; // floor(25,336 * 2.05)
const AGENT: ServerIdentity = {
  ctx: { actor: { actorId: FIXTURE.agents.codexSergio, actorType: "agent" } },
  harness: "codex",
};

let client: Client;
let service: CampfireService;
let server: McpServer;
const frames: unknown[] = [];

beforeEach(async () => {
  const store = openInMemoryStore();
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
  // Capture raw incoming JSON-RPC messages, as run-cmp-000-baseline.ts does.
  const prior = c.onmessage;
  c.onmessage = (m, extra) => {
    frames.push(m);
    prior?.(m, extra);
  };
  frames.length = 0;
});

afterEach(async () => {
  await client.close();
  await server.close();
  service.close();
  vi.restoreAllMocks();
});

describe("CMP-001 whole-handshake size", () => {
  it("keeps the tools/list frame within 2.05x of the frozen baseline", async () => {
    const list = await client.listTools();
    expect(list.nextCursor).toBeUndefined();
    const raw = frames.find((m: any) => m && "result" in m && Array.isArray(m.result?.tools));
    expect(raw).toBeDefined();
    const frame = `${JSON.stringify(raw)}\n`;
    const bytes = Buffer.byteLength(frame, "utf8");
    // eslint-disable-next-line no-console
    process.stdout.write(`cmp-001 tools/list frame bytes: ${bytes} (baseline ${BASELINE_BYTES}, ceiling ${CEILING_BYTES}, ratio ${(bytes / BASELINE_BYTES).toFixed(3)})\n`);
    expect(bytes).toBeLessThanOrEqual(CEILING_BYTES);
    // FAC-001 F9/F11: the real attention tool is inside the unchanged ceiling with no outputSchema.
    const attention = list.tools.find((t) => t.name === "get_workspace_attention");
    expect(attention).toBeDefined();
    expect(attention!.outputSchema).toBeUndefined();
    expect(attention!.description!.length).toBeLessThanOrEqual(84);
    process.stdout.write(`fac-001 headroom: ${CEILING_BYTES - bytes} bytes\n`);
  });
});
