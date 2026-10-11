/**
 * RCL-001 CLI recall and handoff-packet. The existing `campfire handoff`
 * Viewer receipt is a different command and is not exercised here.
 */
import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync, lstatSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURE, seedFixture } from "../../src/bootstrap/seed.js";
import { runCli, runCliEntry } from "../../src/cli/index.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import { openSqliteStore } from "../../src/store/sqlite-store.js";
import type { WorkspaceRecall } from "../../src/domain/recall.js";

const QUERY = "rcl-cli-secret-phrase";
const BILLING = FIXTURE.workspaces.billing;
const UNRELATED = FIXTURE.workspaces.unrelated;

let dir: string;
let dbPath: string;
let findingId: string;
let logs: string[];
let errors: string[];
let writes: string[];

const previousEnv: Record<string, string | undefined> = {};
const ENV_KEYS = [
  "CAMPFIRE_URL",
  "CAMPFIRE_TOKEN",
  "CAMPFIRE_DB",
  "CAMPFIRE_OUTPUT",
  "CAMPFIRE_ACTOR_ID",
  "CAMPFIRE_ACTOR_TYPE",
];

function stdout(): string {
  return logs.join("\n");
}

function stderr(): string {
  return `${errors.join("\n")}\n${writes.join("")}`;
}

function cli(args: string[]): Promise<void> {
  return runCli(["--db", dbPath, ...args]);
}

function entry(args: string[]): Promise<number> {
  return runCliEntry(["--db", dbPath, ...args]);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "campfire-rcl-cli-"));
  dbPath = join(dir, "campfire.db");
  const store = openSqliteStore(dbPath);
  let seeded = Date.parse("2026-01-01T00:00:00.000Z");
  const clock = () => new Date((seeded += 1000)).toISOString();
  seedFixture(store, { clock });
  const service = createCampfireService({ store, clock });
  const finding = service.addFinding(
    { actor: { actorId: FIXTURE.humans.sergio, actorType: "human" } },
    {
      workspaceId: BILLING,
      summary: `${QUERY} during callback review`,
      detail: "kept in the excerpt",
    },
  );
  findingId = finding.id;
  service.close();

  logs = [];
  errors = [];
  writes = [];
  for (const key of ENV_KEYS) {
    previousEnv[key] = process.env[key];
    delete process.env[key];
  }
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    writes.push(typeof chunk === "string" ? chunk : Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
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

describe("campfire recall", () => {
  it("prints the same JSON object for --json and --output json", async () => {
    await cli(["recall", BILLING, "--query", QUERY, "--json"]);
    const fromJson = stdout();
    expect(fromJson.includes("\n")).toBe(false);
    logs = [];
    await cli(["recall", BILLING, "--query", QUERY, "--output", "json"]);
    const fromOutput = stdout();
    expect(fromOutput.includes("\n")).toBe(false);

    const left = JSON.parse(fromJson) as WorkspaceRecall;
    const right = JSON.parse(fromOutput) as WorkspaceRecall;
    expect(left.schemaVersion).toBe(1);
    expect(left.orderingVersion).toBe("rcl-1");
    const { generatedAt: leftAt, ...leftRest } = left;
    const { generatedAt: rightAt, ...rightRest } = right;
    expect(leftAt).toEqual(expect.any(String));
    expect(rightAt).toEqual(expect.any(String));
    expect(leftRest).toEqual(rightRest);
    expect(left.current.items.some((item) => item.id === findingId)).toBe(true);
    expect(stderr()).not.toContain(QUERY);
  });

  it("prints kind, id, lifecycle, and excerpt for human output", async () => {
    await cli(["recall", BILLING, "--query", QUERY, "--output", "human"]);
    const text = stdout();
    expect(text.trim().startsWith("{")).toBe(false);
    expect(text).toContain("finding");
    expect(text).toContain(findingId);
    expect(text).toContain("current");
    expect(text).toContain(QUERY);
    expect(stderr()).not.toContain(QUERY);
  });
});

describe("campfire handoff-packet", () => {
  function packetArgs(workspaceId: string, out: string): string[] {
    return [
      "handoff-packet",
      workspaceId,
      "--query",
      QUERY,
      "--recipient-type",
      "human",
      "--recipient",
      FIXTURE.humans.alice,
      "--out",
      out,
      "--output",
      "json",
    ];
  }

  it("writes a private packet under os.tmpdir and prints a receipt", async () => {
    const out = join(dir, "packet.json");
    const code = await entry(packetArgs(BILLING, out));
    expect(code).toBe(0);

    const receipt = JSON.parse(stdout()) as {
      kind: string;
      query?: unknown;
      records?: unknown;
      offlineCopy: boolean;
      sensitiveOfflineCopy: boolean;
      fullHistoryIncluded: boolean;
    };
    expect(receipt.kind).toBe("CampfireHandoffReceipt");
    expect(receipt.offlineCopy).toBe(true);
    expect(receipt.sensitiveOfflineCopy).toBe(true);
    expect(receipt.fullHistoryIncluded).toBe(false);
    expect(receipt.query).toBeUndefined();
    expect(receipt.records).toBeUndefined();
    expect(JSON.stringify(receipt)).not.toContain(QUERY);
    expect(stdout()).not.toContain("CampfireHandoffPacket");

    const packet = JSON.parse(readFileSync(out, "utf8")) as {
      kind: string;
      offlineCopy: boolean;
      sensitiveOfflineCopy: boolean;
      fullHistoryIncluded: boolean;
      query: { text: string };
    };
    expect(packet.kind).toBe("CampfireHandoffPacket");
    expect(packet.offlineCopy).toBe(true);
    expect(packet.sensitiveOfflineCopy).toBe(true);
    expect(packet.fullHistoryIncluded).toBe(false);
    expect(packet.query.text).toBe(QUERY);
    expect(statSync(out).mode & 0o777).toBe(0o600);
    expect(out.startsWith(tmpdir()) || out.startsWith("/private/tmp") || out.startsWith("/var/")).toBe(true);
    expect(stderr()).not.toContain(QUERY);
  });

  it("refuses overwrite, symlink, missing parent, and unauthorized destinations", async () => {
    const existing = join(dir, "existing.json");
    writeFileSync(existing, "original-bytes");
    expect(await entry(packetArgs(BILLING, existing))).toBe(1);
    expect(readFileSync(existing, "utf8")).toBe("original-bytes");
    expect(stderr()).not.toContain(QUERY);

    errors = [];
    writes = [];
    const real = join(dir, "real.json");
    writeFileSync(real, "original-bytes");
    const link = join(dir, "link.json");
    symlinkSync(real, link);
    expect(await entry(packetArgs(BILLING, link))).toBe(1);
    expect(readFileSync(real, "utf8")).toBe("original-bytes");
    expect(lstatSync(link).isSymbolicLink()).toBe(true);

    errors = [];
    writes = [];
    const missing = join(dir, "no-parent", "packet.json");
    expect(await entry(packetArgs(BILLING, missing))).toBe(1);
    expect(existsSync(missing)).toBe(false);
    expect(existsSync(join(dir, "no-parent"))).toBe(false);

    errors = [];
    writes = [];
    const denied = join(dir, "denied.json");
    expect(await entry(packetArgs(UNRELATED, denied))).toBe(1);
    expect(existsSync(denied)).toBe(false);
    expect(stderr()).toContain("ParticipantRequired");
    expect(stderr()).not.toContain(QUERY);

    errors = [];
    writes = [];
    const unknown = join(dir, "unknown.json");
    expect(await entry(packetArgs("ws_missing_rcl", unknown))).toBe(1);
    expect(existsSync(unknown)).toBe(false);
    expect(stderr()).toContain("WorkspaceNotFound");
    expect(stderr()).not.toContain(QUERY);
  });
});
