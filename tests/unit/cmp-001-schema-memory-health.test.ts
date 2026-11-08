/**
 * CMP-001 slice B: the declared get_memory_health outputSchema must accept every
 * real output (a mismatch turns a success into a hidden text isError) and its
 * emitted JSON Schema must stay flat-client friendly (no $ref/$defs/$schema).
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createCounterIdSource } from "../../src/domain/ids.js";
import { MEMORY_HEALTH_REASONS } from "../../src/domain/memory-health.js";
import { getMemoryHealthOutput, getMemoryHealthOutputObject } from "../../src/mcp/schemas/memory-health.js";
import type { ActorContext } from "../../src/service/authorization.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import { openSqliteStore } from "../../src/store/sqlite-store.js";
import { createAsyncCampfireService } from "../../src/worker/async-service.js";
import { createD1Store, migrateD1 } from "../../src/worker/d1-store.js";
import { seedMem000Candidate } from "../helpers/mem-000-candidate-seed.js";
import { sqliteD1 } from "../helpers/sqlite-d1.js";

const REPO = join(import.meta.dirname, "..", "..");
const OBS = join(REPO, "fixtures/cmp-001/observations/get_memory_health.json");
const schema = z.object(getMemoryHealthOutput);
const agent: ActorContext = { actor: { actorId: "agt_mempage_agent", actorType: "agent" }, agentSessionId: "ses_mempage_agent" };
const owner: ActorContext = { actor: { actorId: "hum_mempage_owner", actorType: "human" } };
const NOW = "2026-11-07T18:00:00.000Z";

type Json = Record<string, unknown>;
type Fetch = (params: Json) => Promise<Json>;
const fetchers: Record<string, Fetch> = {};
const cleanups: Array<() => void> = [];
let dir = "";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "cmp001-mh-"));
  const db = join(dir, "fixture.db");
  seedMem000Candidate({ out: join(dir, "source.json"), databasePath: db });

  const sqlite = createCampfireService({ store: openSqliteStore(db), clock: () => NOW, webhookEnv: {} });
  cleanups.push(() => sqlite.close());
  fetchers.sqlite = async (p) => sqlite.getMemoryHealth(p.workspaceId === "ws_mempage" ? agent : owner, p as never) as unknown as Json;

  // Copy the frozen SQLite fixture into a D1-shaped store (same approach as run-mem-001-candidate).
  const adapter = sqliteD1();
  await migrateD1(adapter.binding);
  const d = adapter.database;
  d.pragma("foreign_keys = OFF");
  d.exec(`ATTACH DATABASE '${db.replace(/'/g, "''")}' AS src`);
  const tables = (d.prepare("SELECT name FROM main.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>).map((t) => t.name);
  for (const t of tables) {
    const main = (d.prepare(`PRAGMA main.table_info("${t}")`).all() as Array<{ name: string }>).map((c) => c.name);
    const src = new Set((d.prepare(`PRAGMA src.table_info("${t}")`).all() as Array<{ name: string }>).map((c) => c.name));
    const common = main.filter((c) => src.has(c)).map((c) => `"${c}"`).join(", ");
    if (common) d.exec(`INSERT OR REPLACE INTO main."${t}" (${common}) SELECT ${common} FROM src."${t}" ORDER BY rowid`);
  }
  d.exec("DETACH DATABASE src");
  d.pragma("foreign_keys = ON");
  const remote = createAsyncCampfireService({ store: createD1Store(adapter.binding), idSource: createCounterIdSource(), clock: () => NOW });
  cleanups.push(() => adapter.database.close());
  fetchers.d1 = async (p) => (await remote.getMemoryHealth(p.workspaceId === "ws_mempage" ? agent : owner, p as never)) as unknown as Json;
});

afterAll(() => {
  while (cleanups.length) cleanups.pop()?.();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function sdkRoundTrip(structured: Json, outputSchema: unknown = getMemoryHealthOutput): Promise<{ isError?: boolean; tools: Array<{ name: string; outputSchema?: Json }>; structuredContent?: unknown }> {
  const server = new McpServer({ name: "t", version: "0" });
  server.registerTool("get_memory_health", { description: "t", outputSchema: outputSchema as typeof getMemoryHealthOutput }, () => ({
    content: [{ type: "text", text: JSON.stringify(structured) }],
    structuredContent: structured,
  }));
  const client = new Client({ name: "c", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  try {
    const tools = (await client.listTools()).tools as never;
    const res = await client.callTool({ name: "get_memory_health", arguments: {} });
    return { isError: res.isError as boolean | undefined, tools, structuredContent: res.structuredContent };
  } finally {
    await client.close();
    await server.close();
  }
}

describe("get_memory_health outputSchema accepts recorded Step 0 outputs", () => {
  const rows = (JSON.parse(readFileSync(OBS, "utf8")) as { rows: Array<{ caseId: string; shape: unknown; parsedBody: Json }> }).rows;
  const successes = rows.filter((r) => r.parsedBody && r.parsedBody.kind === "memory_health");
  it("covers the 13 recorded successes", () => expect(successes.length).toBe(13));
  for (const row of successes) {
    it(`validates ${row.caseId}`, () => {
      const parsed = schema.safeParse(row.parsedBody);
      expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
    });
  }
});

describe.each(["sqlite", "d1"])("get_memory_health outputSchema accepts live %s outputs", (backend) => {
  const calls: Array<[string, string, Json, (r: Json) => void]> = [
    ["frozen eight-cue fixture", "ws_mempage", { limit: 8 }, (r) => {
      const cues = r.cues as Array<{ reason: string }>;
      expect(cues.length).toBe(8);
      expect(new Set(cues.map((c) => c.reason))).toEqual(new Set(MEMORY_HEALTH_REASONS));
    }],
    ["default limit", "ws_mempage", {}, () => {}],
    ["empty workspace", "ws_mempage_empty", {}, (r) => expect(r.cues).toEqual([])],
    ["empty workspace filtered", "ws_mempage_empty", { reason: "action_outcome_unknown" }, (r) => expect(r.filters).toEqual({ reason: "action_outcome_unknown" })],
    ["paged (nextCursor present)", "ws_mempage", { limit: 2 }, (r) => expect(typeof r.nextCursor).toBe("string")],
    ["filtered finding", "ws_mempage", { reason: "current_finding_has_contradicting_evidence", limit: 2 }, () => {}],
    ["filtered task", "ws_mempage", { reason: "blocked_task_missing_context", limit: 2 }, () => {}],
    ["filtered decision", "ws_mempage", { reason: "accepted_decision_needs_review" }, () => {}],
    ["filtered action", "ws_mempage", { reason: "action_outcome_unknown" }, () => {}],
  ];
  for (const [name, workspaceId, params, check] of calls) {
    it(name, async () => {
      const result = await fetchers[backend]!({ workspaceId, ...params });
      check(result);
      const wire = JSON.parse(JSON.stringify(result)) as Json;
      const parsed = schema.safeParse(wire);
      expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
      const rt = await sdkRoundTrip(wire); // real SDK server+client: output validation incl. client-side ajv
      expect(rt.isError).toBeUndefined();
      expect(rt.structuredContent).toEqual(wire);
    });
  }

  it("pages through every cue and all pages validate", async () => {
    let cursor: string | undefined;
    const seen: Json[] = [];
    do {
      const page = await fetchers[backend]!({ workspaceId: "ws_mempage", limit: 3, ...(cursor ? { cursor } : {}) });
      expect(schema.safeParse(JSON.parse(JSON.stringify(page))).success).toBe(true);
      seen.push(...(page.cues as Json[]));
      cursor = page.nextCursor as string | undefined;
    } while (cursor);
    expect(seen.length).toBeGreaterThanOrEqual(8);
  });
});

describe("emitted JSON Schema (tools/list)", () => {
  it("is flat-client safe: object root, no $ref/$defs/$schema, inline union", async () => {
    const wire = JSON.parse(JSON.stringify(await fetchers.sqlite!({ workspaceId: "ws_mempage_empty" }))) as Json;
    const { tools } = await sdkRoundTrip(wire);
    const out = tools[0]!.outputSchema as Json;
    expect(out).toBeDefined();
    expect(out.type).toBe("object");
    const text = JSON.stringify(out);
    for (const banned of ["$ref", "$defs", "definitions"]) expect(text, banned).not.toContain(`"${banned}"`);
    // The SDK (zod v4 toJSONSchema, draft-7) stamps `$schema` on the root only; it cannot be removed from
    // a raw shape. It never appears nested, and existing inputSchemas already carry the same root keyword.
    const { $schema, ...rest } = out;
    expect($schema).toBe("http://json-schema.org/draft-07/schema#");
    expect(JSON.stringify(rest)).not.toContain("$schema");
    expect(out.required).toEqual(expect.arrayContaining(["kind", "schemaVersion", "workspaceId", "observedAt", "orientationCursor", "filters", "coverage", "cues"]));
    expect(out.required).not.toContain("nextCursor");
    const cues = (out.properties as Record<string, Json>).cues!;
    expect(cues.type).toBe("array");
    const items = cues.items as Json;
    const variants = (items.oneOf ?? items.anyOf) as Json[];
    expect(variants).toHaveLength(4);
    for (const v of variants) expect(v.type).toBe("object");
    // Raw shape => SDK wraps in strict z.object => root additionalProperties:false; nested objects are open.
    expect(out.additionalProperties).toBe(false);
    expect(JSON.stringify({ ...rest, additionalProperties: undefined })).not.toContain('"additionalProperties":false');
    const loose = (await sdkRoundTrip(wire, getMemoryHealthOutputObject)).tools[0]!.outputSchema as Json;
    expect(loose.additionalProperties).not.toBe(false);
    expect(JSON.stringify(loose)).not.toContain('"additionalProperties":false');
    expect(JSON.stringify(loose)).not.toMatch(/"\$(ref|defs)"/);
    // Surface the full emitted schema for the report when requested.
    if (process.env.CMP_DUMP_SCHEMA) console.log(JSON.stringify(out, null, 1));
  });
});

describe("negative cases", () => {
  async function sample(): Promise<Json> {
    return JSON.parse(JSON.stringify(await fetchers.sqlite!({ workspaceId: "ws_mempage", limit: 8 }))) as Json;
  }
  const mutate = async (fn: (r: Json) => void) => {
    const r = await sample();
    fn(r);
    return schema.safeParse(r).success;
  };
  const cueOf = (r: Json, reason: string) => (r.cues as Array<Json>).find((c) => c.reason === reason)!;

  it("baseline sample passes", async () => expect(await mutate(() => {})).toBe(true));
  it("unknown cue reason fails", async () => expect(await mutate((r) => { (r.cues as Json[])[0]!.reason = "made_up"; })).toBe(false));
  it("unknown filter reason fails", async () => expect(await mutate((r) => { r.filters = { reason: "made_up" }; })).toBe(false));
  it("unknown rulesEvaluated entry fails", async () => expect(await mutate((r) => { (r.coverage as Json).rulesEvaluated = ["made_up"]; })).toBe(false));
  it("missing coverage fails", async () => expect(await mutate((r) => { delete r.coverage; })).toBe(false));
  it("missing coverage.truncated fails", async () => expect(await mutate((r) => { delete (r.coverage as Json).truncated; })).toBe(false));
  it("wrong schemaVersion fails", async () => expect(await mutate((r) => { r.schemaVersion = 2; })).toBe(false));
  it("wrong fact type fails", async () => expect(await mutate((r) => { (cueOf(r, "action_outcome_unknown").sourceFacts as Json).proposalRevision = "1"; })).toBe(false));
  it("wrong fact literal fails", async () => expect(await mutate((r) => { (cueOf(r, "blocked_task_missing_context").sourceFacts as Json).hasAssignee = true; })).toBe(false));
  it("facts from another reason fail", async () => expect(await mutate((r) => { cueOf(r, "blocked_task_missing_context").sourceFacts = cueOf(r, "action_outcome_unknown").sourceFacts; })).toBe(false));
  it("tolerates extra keys and absent optionals", async () => {
    expect(await mutate((r) => { r.futureField = 1; delete r.nextCursor; (r.cues as Json[])[0]!.extra = true; })).toBe(true);
  });
});
