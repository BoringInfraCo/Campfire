/** MEM-001 step 3: `campfire memory-health` CLI projection of get_memory_health. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURE, seedFixture } from "../../src/bootstrap/seed.js";
import { commandSpec } from "../../src/cli/catalog.js";
import { runCli, runCliEntry } from "../../src/cli/index.js";
import { formatCliFailure } from "../../src/cli/recovery.js";
import { Conflict } from "../../src/domain/errors.js";
import type { MemoryHealthResult } from "../../src/domain/memory-health.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import { openSqliteStore } from "../../src/store/sqlite-store.js";

const BILLING = FIXTURE.workspaces.billing;
const ENV_KEYS = ["CAMPFIRE_URL", "CAMPFIRE_TOKEN", "CAMPFIRE_DB", "CAMPFIRE_OUTPUT", "CAMPFIRE_ACTOR_ID", "CAMPFIRE_ACTOR_TYPE"];
const previousEnv: Record<string, string | undefined> = {};

let dir: string;
let dbPath: string;
let logs: string[];
let errors: string[];
const sergio = { actor: { actorId: FIXTURE.humans.sergio, actorType: "human" as const } };

function stdout(): string {
  return logs.join("\n");
}
function cli(args: string[]): Promise<void> {
  return runCli(["--db", dbPath, ...args]);
}
function withService<T>(fn: (service: ReturnType<typeof createCampfireService>) => T): T {
  const store = openSqliteStore(dbPath);
  const service = createCampfireService({ store });
  try {
    return fn(service);
  } finally {
    service.close();
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "campfire-mem-cli-"));
  dbPath = join(dir, "campfire.db");
  const store = openSqliteStore(dbPath);
  let seeded = Date.parse("2026-01-01T00:00:00.000Z");
  const clock = () => new Date((seeded += 1000)).toISOString();
  seedFixture(store, { clock });
  const service = createCampfireService({ store, clock });
  for (const title of ["blocked one", "blocked two"]) {
    const task = service.createTask(sergio, { workspaceId: BILLING, title });
    service.updateTask(sergio, { taskId: task.id, status: "blocked" });
  }
  service.close();
  logs = [];
  errors = [];
  for (const key of ENV_KEYS) {
    previousEnv[key] = process.env[key];
    delete process.env[key];
  }
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => void logs.push(args.map(String).join(" ")));
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void errors.push(args.map(String).join(" ")));
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    errors.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
  for (const key of ENV_KEYS) {
    const value = previousEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("campfire memory-health", () => {
  it("is cataloged as a read-only workspace command with help", () => {
    const spec = commandSpec("memory-health");
    expect(spec?.usage).toContain("--reason");
    expect(spec?.usage).toContain("--cursor");
  });

  it("emits the service result verbatim as JSON", async () => {
    await cli(["memory-health", BILLING, "--json"]);
    const result = JSON.parse(stdout()) as MemoryHealthResult;
    const direct = withService((s) => s.getMemoryHealth(sergio, { workspaceId: BILLING }));
    expect({ ...result, observedAt: "" }).toEqual({ ...direct, observedAt: "" });
    expect(result.kind).toBe("memory_health");
    expect(result.cues.length).toBe(2);
  });

  it("accepts --workspace, --reason and --limit", async () => {
    await cli(["memory-health", "--workspace", BILLING, "--reason", "blocked_task_missing_context", "--limit", "1", "--output", "json"]);
    const result = JSON.parse(stdout()) as MemoryHealthResult;
    expect(result.filters.reason).toBe("blocked_task_missing_context");
    expect(result.coverage).toMatchObject({ total: 2, returned: 1, truncated: true });
    expect(result.nextCursor).toBeDefined();
  });

  it("human output preserves ids, summaries, coverage, and nextCursor", async () => {
    await cli(["memory-health", BILLING, "--limit", "1", "--json"]);
    const result = JSON.parse(stdout()) as MemoryHealthResult;
    logs.length = 0;
    await cli(["memory-health", BILLING, "--limit", "1", "--output", "human"]);
    const text = stdout();
    const cue = result.cues[0]!;
    expect(text).toContain(cue.id);
    expect(text).toContain(cue.subjectId);
    expect(text).toContain(cue.summary);
    for (const id of cue.relatedRecordIds) expect(text).toContain(id);
    expect(text).toContain("returned 1");
    expect(text).toContain("total 2");
    expect(text).toContain("truncated true");
    expect(result.nextCursor).toBeDefined();
    expect(text).toMatch(/^nextCursor mh1\.\S+$/m);
    for (const rule of result.coverage.rulesEvaluated) expect(text).toContain(rule);
  });

  it("follows nextCursor to the next page", async () => {
    await cli(["memory-health", BILLING, "--limit", "1", "--json"]);
    const first = JSON.parse(stdout()) as MemoryHealthResult;
    logs.length = 0;
    await cli(["memory-health", BILLING, "--limit", "1", "--cursor", first.nextCursor!, "--json"]);
    const second = JSON.parse(stdout()) as MemoryHealthResult;
    expect(second.cues[0]?.id).not.toBe(first.cues[0]?.id);
    expect(second.coverage.total).toBe(first.coverage.total);
  });

  it("surfaces typed validation errors and a stale-cursor recovery", async () => {
    const entry = (args: string[]) => runCliEntry(["--db", dbPath, ...args]);
    expect(await entry(["memory-health", BILLING, "--reason", "nope", "--output", "human"])).toBe(1);
    expect(errors.join("\n")).toContain("[ValidationError]");

    await cli(["memory-health", BILLING, "--limit", "1", "--json"]);
    const first = JSON.parse(stdout()) as MemoryHealthResult;
    withService((s) => s.createTask(sergio, { workspaceId: BILLING, title: "moves the tip" }));
    errors.length = 0;
    expect(await entry(["memory-health", BILLING, "--limit", "1", "--cursor", first.nextCursor!, "--json"])).toBe(1);
    const payload = JSON.parse(errors.join("\n").trim().split("\n").pop()!) as {
      error: { code: string; details: { recoveryCode: string } };
      next?: Array<{ command: string }>;
    };
    expect(payload.error.code).toBe("Conflict");
    expect(payload.error.details.recoveryCode).toBe("memory_health_stale_cursor");
    expect(payload.next?.[0]?.command).toBe("campfire memory-health <workspaceId>");
    expect(payload.next?.[0]?.command).not.toContain("--cursor");
  });

  it("maps the stale-cursor Conflict to a restart-without-cursor step", () => {
    const error = new Conflict("stale", {
      recoveryCode: "memory_health_stale_cursor",
      field: "cursor",
      nextAction: "restart_without_cursor",
    });
    const text = formatCliFailure(error, { command: "memory-health" });
    expect(text).toContain("[Conflict]");
    expect(text).toContain("campfire memory-health <workspaceId>");
  });
});
