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
let decisionId: string;
let secondDecisionId: string;
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
  const sergio = { actor: { actorId: FIXTURE.humans.sergio, actorType: "human" as const } };
  const finding = service.addFinding(sergio, {
    workspaceId: BILLING,
    summary: `${QUERY} during callback review`,
    detail: "kept in the excerpt",
  });
  findingId = finding.id;
  // Two accepted decisions that both match the query and neither names the
  // other, so the set is genuinely unresolved and the CLI has a conflict to print.
  const first = service.addDecision(sergio, {
    workspaceId: BILLING,
    summary: `${QUERY} rule alpha`,
    rationale: "Keep the alpha rule.",
  });
  decisionId = service.acceptDecision(sergio, first.id).id;
  const second = service.addDecision(sergio, {
    workspaceId: BILLING,
    summary: `${QUERY} rule beta`,
    rationale: "Keep the beta rule.",
  });
  secondDecisionId = service.acceptDecision(sergio, second.id).id;
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
    // RCL-003 §3.2: schema 2 so a consumer can tell "no decision set" from
    // "built before the decision set existed". The ordering version stays rcl-1.
    expect(left.schemaVersion).toBe(2);
    expect(left.orderingVersion).toBe("rcl-1");
    expect(left.decisionSet?.state).toBe("unresolved-accepted-decisions");
    expect(left.decisionSet?.operativeDecisionId).toBeUndefined();
    expect(left.decisionSet?.beforeActing).toBeDefined();
    expect(left.decisionSet?.members.map((row) => row.id).sort()).toEqual([decisionId, secondDecisionId].sort());
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

  it("prints the decision state, member ids, and beforeActing in human output", async () => {
    await cli(["recall", BILLING, "--query", QUERY, "--output", "human"]);
    const text = stdout();
    expect(text).toContain("decisions");
    expect(text).toContain("unresolved-accepted-decisions");
    expect(text).toContain(decisionId);
    expect(text).toContain(secondDecisionId);
    // No operative decision is named, and the frozen instruction is present.
    expect(text).not.toContain("operativeDecision");
    expect(text).toContain("Campfire has not selected an operative decision. Do not execute either rule.");
    expect(stderr()).not.toContain(QUERY);
  });

  it("omits beforeActing when exactly one accepted decision matches", async () => {
    await cli(["recall", BILLING, "--query", `${QUERY} rule alpha`]);
    const parsed = JSON.parse(stdout()) as WorkspaceRecall;
    expect(parsed.decisionSet?.state).toBe("single-accepted-decision");
    expect(parsed.decisionSet?.operativeDecisionId).toBe(decisionId);
    expect(parsed.decisionSet?.beforeActing).toBeUndefined();

    logs = [];
    await cli(["recall", BILLING, "--query", `${QUERY} rule alpha`, "--output", "human"]);
    const text = stdout();
    expect(text).toContain("single-accepted-decision");
    expect(text).toContain(`operativeDecision ${decisionId}`);
    expect(text).not.toContain("Campfire has not selected an operative decision");
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
      decisionSet?: unknown;
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
    // RCL-003: the packet gains a decision set, and the receipt still carries no
    // query, records, or decision text. It reports counts and nothing else.
    expect(receipt.decisionSet).toBeUndefined();
    expect(JSON.stringify(receipt)).not.toContain(QUERY);
    expect(JSON.stringify(receipt)).not.toContain(decisionId);
    expect(JSON.stringify(receipt)).not.toContain(secondDecisionId);
    expect(stdout()).not.toContain("CampfireHandoffPacket");

    const packet = JSON.parse(readFileSync(out, "utf8")) as {
      kind: string;
      offlineCopy: boolean;
      sensitiveOfflineCopy: boolean;
      fullHistoryIncluded: boolean;
      query: { text: string };
      decisionSet?: {
        state: string;
        operativeDecisionId?: string;
        beforeActing?: string;
        linkedNextStep?: string;
        members: Array<{ section: string; id: string; text: string; lifecycle: string }>;
        recordedTransitions: unknown[];
      };
    };
    expect(packet.kind).toBe("CampfireHandoffPacket");
    expect(packet.offlineCopy).toBe(true);
    expect(packet.sensitiveOfflineCopy).toBe(true);
    expect(packet.fullHistoryIncluded).toBe(false);
    expect(packet.query.text).toBe(QUERY);
    expect(packet.decisionSet?.state).toBe("unresolved-accepted-decisions");
    expect(packet.decisionSet?.operativeDecisionId).toBeUndefined();
    expect(packet.decisionSet?.beforeActing).toBe(
      "Campfire has not selected an operative decision. Do not execute either rule. Seek a recorded retirement of one accepted decision, or an accepted replacement that names its predecessor and is accepted with a reason.",
    );
    expect(packet.decisionSet?.recordedTransitions).toEqual([]);
    expect(packet.decisionSet?.members.map((row) => row.id).sort()).toEqual([decisionId, secondDecisionId].sort());
    // Both members are accepted, so both are live. The grouped set does not
    // replace them with a flat `"decision-set"` section; it keeps the split the
    // same packet already carries in `records`, so a superseded member would
    // read `historical` here too.
    expect(packet.decisionSet?.members.map((row) => row.section)).toEqual(["current", "current"]);
    expect(packet.decisionSet?.linkedNextStep).toBeUndefined();
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
