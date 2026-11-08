/** MEM-001 D7: sentinel secrets never reach CLI human/JSON output, CLI errors, or logs. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCli, runCliEntry } from "../../src/cli/index.js";
import type { MemoryHealthResult } from "../../src/domain/memory-health.js";
import { openSqliteStore } from "../../src/store/sqlite-store.js";
import { MH_OWNER, SENTINELS, mhOwner, seedMemoryHealth, type SeededMemory } from "../helpers/mem-health-seed.js";

const ENV_KEYS = ["CAMPFIRE_URL", "CAMPFIRE_TOKEN", "CAMPFIRE_DB", "CAMPFIRE_OUTPUT", "CAMPFIRE_ACTOR_ID", "CAMPFIRE_ACTOR_TYPE"];
const previousEnv: Record<string, string | undefined> = {};
let dir: string;
let dbPath: string;
let seeded: SeededMemory;
let out: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "campfire-mem-priv-"));
  dbPath = join(dir, "campfire.db");
  const store = openSqliteStore(dbPath);
  const seed = seedMemoryHealth(store);
  seeded = seed.seeded;
  seed.service.withdrawFinding(mhOwner, { findingId: seeded.citedFindingId, reason: SENTINELS.withdrawReason });
  seed.service.close();
  out = [];
  for (const key of ENV_KEYS) { previousEnv[key] = process.env[key]; delete process.env[key]; }
  process.env.CAMPFIRE_ACTOR_ID = MH_OWNER.actorId;
  process.env.CAMPFIRE_ACTOR_TYPE = "human";
  const capture = (...args: unknown[]) => { out.push(args.map(String).join(" ")); return true as never; };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "info").mockImplementation(capture);
  vi.spyOn(process.stderr, "write").mockImplementation(capture);
  vi.spyOn(process.stdout, "write").mockImplementation(capture);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
  for (const key of ENV_KEYS) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }
});

function parseResult(): MemoryHealthResult {
  const text = out.join("\n").split("\n").filter((l) => l.length > 0 && !l.startsWith('{"event":"authz"')).join("\n");
  return JSON.parse(text) as MemoryHealthResult;
}

function assertClean(label: string, text: string) {
  for (const value of [...Object.values(SENTINELS), "acme/api", "sentinel-a8.example", dir, dbPath]) {
    expect(text.includes(value), `${label} leaks ${value}`).toBe(false);
  }
  expect(text).not.toMatch(/token|secret|password|bearer/i);
}

describe("MEM-001 D7 CLI privacy", () => {
  it("human and JSON output carry only allowlisted facts", async () => {
    await runCli(["--db", dbPath, "memory-health", seeded.workspaceId, "--output", "human"]);
    const human = out.join("\n");
    expect(human).toContain(seeded.citationId);
    expect(human).toContain(seeded.unknownReceiptId);
    assertClean("human", human);
    out.length = 0;
    await runCli(["--db", dbPath, "memory-health", seeded.workspaceId, "--json"]);
    const json = out.join("\n");
    expect(parseResult().cues.length).toBe(4);
    assertClean("json", json);
  });

  it("CLI errors for bad reason, bad cursor, and stale cursor leak no source text", async () => {
    const entry = (args: string[]) => runCliEntry(["--db", dbPath, ...args]);
    expect(await entry(["memory-health", seeded.workspaceId, "--reason", SENTINELS.rationale, "--output", "human"])).toBe(1);
    expect(await entry(["memory-health", seeded.workspaceId, "--cursor", "mh1.AAAA", "--output", "human"])).toBe(1);
    const earlier = out.join("\n");
    out.length = 0;
    await runCli(["--db", dbPath, "memory-health", seeded.workspaceId, "--limit", "1", "--json"]);
    const first = parseResult();
    const store = openSqliteStore(dbPath);
    const seed = seedlessService(store);
    seed.createTask(mhOwner, { workspaceId: seeded.workspaceId, title: SENTINELS.taskTitle });
    seed.close();
    out.length = 0;
    expect(await entry(["memory-health", seeded.workspaceId, "--limit", "1", "--cursor", first.nextCursor!, "--output", "human"])).toBe(1);
    const text = out.join("\n");
    expect(text).toContain("Conflict");
    expect(text).not.toContain(first.nextCursor!);
    assertClean("errors", earlier);
    assertClean("errors", text.replace(/campfire memory-health <workspaceId>/g, ""));
  });
});

import { createCampfireService } from "../../src/service/campfire-service.js";
import type { CampfireStore } from "../../src/store/store.js";
function seedlessService(store: CampfireStore) {
  return createCampfireService({ store });
}
