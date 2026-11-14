/** FAC-001 slice 1 phase C: `campfire attention` CLI (A2.5 hints, F10 JSON). */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURE, seedFixture } from "../../src/bootstrap/seed.js";
import { commandSpec } from "../../src/cli/catalog.js";
import { runCliEntry } from "../../src/cli/index.js";
import { formatCliFailure } from "../../src/cli/recovery.js";
import { Conflict } from "../../src/domain/errors.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import { openSqliteStore } from "../../src/store/sqlite-store.js";

const FROZEN = "2026-02-01T00:00:00.000Z";
const BILLING = FIXTURE.workspaces.billing;
const ENV_KEYS = ["CAMPFIRE_URL", "CAMPFIRE_TOKEN", "CAMPFIRE_DB", "CAMPFIRE_OUTPUT", "CAMPFIRE_ACTOR_ID", "CAMPFIRE_ACTOR_TYPE"];
const previousEnv: Record<string, string | undefined> = {};
const sergio = { actor: { actorId: FIXTURE.humans.sergio, actorType: "human" as const } };
let dir: string;
let dbPath: string;
let logs: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "campfire-fac-cli-"));
  dbPath = join(dir, "campfire.db");
  const store = openSqliteStore(dbPath);
  let seeded = Date.parse("2026-01-01T00:00:00.000Z");
  const clock = () => new Date((seeded += 1000)).toISOString();
  seedFixture(store, { clock });
  createCampfireService({ store, clock }).close();
  logs = [];
  for (const key of ENV_KEYS) {
    previousEnv[key] = process.env[key];
    delete process.env[key];
  }
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => void logs.push(args.map(String).join(" ")));
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
  for (const key of ENV_KEYS) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }
});

describe("campfire attention", () => {
  it("is cataloged as a read-only workspace command with the documented flags", () => {
    const spec = commandSpec("attention");
    expect(spec?.usage).toContain("--limit");
    expect(spec?.usage).toContain("--cursor");
    expect(spec?.usage).toContain("--since");
    expect(spec?.usage).not.toContain("--reason");
  });

  it("A2.5: attention Conflicts hint `campfire attention`, never `campfire memory-health`", () => {
    for (const recoveryCode of ["attention_cursor_stale", "attention_cursor_authority_changed"]) {
      const error = new Conflict("workspace changed", {
        field: "cursor",
        recoveryCode,
        nextAction: "restart_without_cursor",
      } as never);
      const text = formatCliFailure(error, { color: false } as never);
      expect(text).toContain("campfire attention");
      expect(text).not.toContain("memory-health");
    }
  });

  /** Runs the CLI under a frozen wall clock and returns the process outcome. */
  async function cli(args: string[]): Promise<{ code: number; out: string; err: string }> {
    const before = logs.length;
    const errs: string[] = [];
    vi.mocked(console.error).mockImplementation((...a: unknown[]) => void errs.push(a.map(String).join(" ")));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(FROZEN));
    try {
      const code = await runCliEntry(["--db", dbPath, "attention", ...args]);
      return { code, out: logs.slice(before).join("\n"), err: errs.join("\n") };
    } finally {
      vi.useRealTimers();
    }
  }
  const failure = (err: string) => (JSON.parse(err) as { error: { code: string; message: string; details?: Record<string, unknown> } }).error;

  it("emits the service result verbatim as JSON under a frozen clock (no field masked)", async () => {
    const store = openSqliteStore(dbPath);
    const service = createCampfireService({ store, clock: () => FROZEN });
    try {
      const r = await cli([BILLING, "--json"]);
      expect(r.code).toBe(0);
      const direct = JSON.parse(JSON.stringify(service.getWorkspaceAttention(sergio, { workspaceId: BILLING })));
      expect(direct.observedAt).toBe(FROZEN);
      expect(JSON.parse(r.out)).toEqual(direct);
      const r2 = await cli([BILLING, "--output", "json", "--limit", "1"]);
      expect(JSON.parse(r2.out)).toEqual(JSON.parse(JSON.stringify(service.getWorkspaceAttention(sergio, { workspaceId: BILLING, limit: 1 }))));
    } finally {
      service.close();
    }
  });

  it("--limit above 100 is rejected by the service with ValidationError field limit (not clamped)", async () => {
    const r = await cli([BILLING, "--json", "--limit", "101"]);
    expect(r.code).toBe(1);
    expect(r.out).toBe("");
    const e = failure(r.err);
    expect(e.code).toBe("ValidationError");
    expect(e.details?.field).toBe("limit");
    const at100 = await cli([BILLING, "--json", "--limit", "100"]);
    expect(at100.code).toBe(0);
  });

  it("--limit 0, negative, fractional or non-numeric is rejected at the CLI with field limit", async () => {
    for (const bad of ["0", "-3", "1.5", "abc"]) {
      const r = await cli([BILLING, "--json", "--limit", bad]);
      expect(r.code, `limit ${bad}`).toBe(1);
      const e = failure(r.err);
      expect(e.code).toBe("ValidationError");
      expect(e.details?.field).toBe("limit");
    }
  });

  it("--cursor and --since are validated by the service: malformed, wrong kind and foreign tokens fail with a typed error and no result", async () => {
    for (const [flag, value] of [
      ["--cursor", "fa1.!!!not-base64-json"],
      ["--cursor", "garbage"],
      ["--since", "cf1.!!!not-base64-json"],
      ["--since", "fa1.eyJ2IjoxfQ"],
      ["--since", "garbage"],
    ] as const) {
      const r = await cli([BILLING, "--json", flag, value]);
      expect(r.code, `${flag} ${value}`).toBe(1);
      expect(r.out).toBe("");
      const e = failure(r.err);
      expect(["ValidationError", "Conflict"]).toContain(e.code);
      expect(e.details?.field, `${flag} ${value}`).toBe(flag === "--cursor" ? "cursor" : "since");
    }
  });

  it("a real nextCursor and orientationCursor are accepted back as --cursor and --since", async () => {
    const first = JSON.parse((await cli([BILLING, "--json", "--limit", "1"])).out) as { nextCursor?: string; orientationCursor: string; total: number };
    const since = await cli([BILLING, "--json", "--since", first.orientationCursor]);
    expect(since.code).toBe(0);
    expect(JSON.parse(since.out).catchUp).toBeDefined();
    if (first.total > 1) {
      expect(first.nextCursor).toBeDefined();
      const next = await cli([BILLING, "--json", "--limit", "1", "--cursor", first.nextCursor!]);
      expect(next.code).toBe(0);
    } else {
      expect(first.nextCursor).toBeUndefined();
    }
  });

  it("rejects an unknown flag (--reason belongs to memory-health) and a missing --limit value", async () => {
    const unknown = await cli([BILLING, "--json", "--reason", "x"]);
    expect(unknown.code).toBe(2);
    const missing = await cli([BILLING, "--json", "--limit"]);
    expect(missing.code).toBe(1);
    expect(failure(missing.err).details?.field).toBe("limit");
  });
});
