/**
 * CLI-001 hosted parity: local and hosted CLI calls over equivalent authorized
 * state must produce semantically equivalent command results (section 4).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXTURE, seedFixture } from "../../src/bootstrap/seed.js";
import { runCliEntry } from "../../src/cli/index.js";
import { startCampfireHttpServer } from "../../src/http/server.js";
import { createRuntimeFromPath, type CampfireRuntime } from "../../src/runtime.js";

const BILLING = FIXTURE.workspaces.billing;

let dir: string;
let dbPath: string;
let runtime: CampfireRuntime;
let server: Awaited<ReturnType<typeof startCampfireHttpServer>>;
let logs: string[];
let errors: string[];

const previousUrl = process.env.CAMPFIRE_URL;
const previousToken = process.env.CAMPFIRE_TOKEN;

function stdout(): string {
  return logs.join("\n");
}

function stderr(): string {
  return errors.join("\n");
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "campfire-cli-hosted-"));
  dbPath = join(dir, "campfire.db");
  runtime = createRuntimeFromPath(dbPath);
  seedFixture(runtime.store);
  server = await startCampfireHttpServer({ runtime, host: "127.0.0.1", port: 0 });
  logs = [];
  errors = [];
  delete process.env.CAMPFIRE_URL;
  delete process.env.CAMPFIRE_TOKEN;
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await server.close();
  runtime.close();
  rmSync(dir, { recursive: true, force: true });
  if (previousUrl === undefined) delete process.env.CAMPFIRE_URL;
  else process.env.CAMPFIRE_URL = previousUrl;
  if (previousToken === undefined) delete process.env.CAMPFIRE_TOKEN;
  else process.env.CAMPFIRE_TOKEN = previousToken;
});

async function runLocal(args: string[]): Promise<unknown> {
  delete process.env.CAMPFIRE_URL;
  delete process.env.CAMPFIRE_TOKEN;
  logs = [];
  errors = [];
  const code = await runCliEntry(["--db", dbPath, ...args, "--output", "json"]);
  expect(code).toBe(0);
  return JSON.parse(stdout()) as unknown;
}

async function runHosted(args: string[]): Promise<unknown> {
  process.env.CAMPFIRE_URL = server.url;
  process.env.CAMPFIRE_TOKEN = FIXTURE.tokens.sergio;
  logs = [];
  errors = [];
  const code = await runCliEntry([...args, "--output", "json"]);
  expect(code).toBe(0);
  return JSON.parse(stdout()) as unknown;
}

describe("CLI-001 hosted parity", () => {
  for (const command of ["status", "agents", "decisions", "changes"] as const) {
    it(`returns the same ${command} result locally and hosted`, async () => {
      const local = await runLocal([command, BILLING]);
      const hosted = await runHosted([command, BILLING]);
      expect(hosted).toEqual(local);
    });
  }

  it("returns the same inspect result locally and hosted", async () => {
    const local = await runLocal(["inspect", "workspace", BILLING]);
    const hosted = await runHosted(["inspect", "workspace", BILLING]);
    expect(hosted).toEqual(local);
  });

  it("requires the existing actor credential for hosted reads", async () => {
    process.env.CAMPFIRE_URL = server.url;
    delete process.env.CAMPFIRE_TOKEN;
    logs = [];
    errors = [];
    const code = await runCliEntry(["status", BILLING, "--output", "json"]);
    expect(code).toBe(1);
    const payload = JSON.parse(stderr()) as { error: { code: string; message: string } };
    expect(payload.error.code).toBe("ValidationError");
    expect(payload.error.message).toContain("CAMPFIRE_TOKEN");
    expect(stdout()).toBe("");
  });

  it("denies an unauthorized hosted workspace before state crosses the boundary", async () => {
    process.env.CAMPFIRE_URL = server.url;
    process.env.CAMPFIRE_TOKEN = FIXTURE.tokens.alice;
    logs = [];
    errors = [];
    const code = await runCliEntry([
      "status",
      FIXTURE.workspaces.unrelated,
      "--output",
      "json",
    ]);
    expect(code).toBe(1);
    expect(stderr()).not.toContain(FIXTURE.unrelatedFindingSentinel);
    expect(stdout()).not.toContain(FIXTURE.unrelatedFindingSentinel);
  });
});
