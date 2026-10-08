/**
 * CLI-001 contract tests: output selection, canonical projections, command
 * semantics, and security/privacy rules from docs/SPRINT_CLI_001.md.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beginHuman } from "../../src/bootstrap/listen.js";
import { persistHumanProfile, saveProfile } from "../../src/bootstrap/profile.js";
import { FIXTURE, seedFixture } from "../../src/bootstrap/seed.js";
import { parseArgs } from "../../src/cli/args.js";
import {
  CLI_CATALOG,
  CLI_COMMAND_NAMES,
  commandDiscoverable,
  commandSpec,
  formatUsage,
  isKnownCommand,
} from "../../src/cli/catalog.js";
import { CLI_COMMAND_HANDLERS, runCli, runCliEntry } from "../../src/cli/index.js";
import { resolveOutputMode } from "../../src/cli/output.js";
import { colorEnabled } from "../../src/cli/ui.js";
import { createRuntimeFromPath } from "../../src/runtime.js";
import { openSqliteStore } from "../../src/store/sqlite-store.js";
import type { WorkspaceContext } from "../../src/service/service.js";

const BILLING = FIXTURE.workspaces.billing;
const UNRELATED = FIXTURE.workspaces.unrelated;
const BILLING_GOAL_TITLE =
  "Determine why billing-service deploys fail and prepare the correct remediation.";

let dir: string;
let dbPath: string;
let logs: string[];
let errors: string[];

const previousEnv: Record<string, string | undefined> = {};
const ENV_KEYS = [
  "CAMPFIRE_URL",
  "CAMPFIRE_TOKEN",
  "CAMPFIRE_BRIDGE_TOKEN",
  "CAMPFIRE_OUTPUT",
  "CAMPFIRE_PLAYBOOK",
  "NO_COLOR",
  "CAMPFIRE_HARNESS",
  "CAMPFIRE_SESSION_ID",
];

function stdout(): string {
  return logs.join("\n");
}

function stderr(): string {
  return errors.join("\n");
}

function parseStdout<T>(): T {
  return JSON.parse(stdout()) as T;
}

function parseStderr<T>(): T {
  return JSON.parse(stderr()) as T;
}

function cli(args: string[]): Promise<void> {
  return runCli(["--db", dbPath, ...args]);
}

function entry(args: string[]): Promise<number> {
  return runCliEntry(["--db", dbPath, ...args]);
}

function setTty(value: boolean): void {
  Object.defineProperty(process.stdout, "isTTY", { value, configurable: true });
}

function clearTty(): void {
  delete (process.stdout as unknown as { isTTY?: boolean }).isTTY;
}

/** Run the CLI as a specific seeded actor token (local fixture token). */
function entryAs(args: string[], token: string): Promise<number> {
  return runCliEntry(["--db", dbPath, ...args, "--token", token]);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "campfire-cli-001-"));
  dbPath = join(dir, "campfire.db");
  const store = openSqliteStore(dbPath);
  // Seed in the past so later CLI contributions sort after every fixture row.
  let seeded = Date.parse("2026-01-01T00:00:00.000Z");
  seedFixture(store, { clock: () => new Date((seeded += 1000)).toISOString() });
  store.close();
  logs = [];
  errors = [];
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
});

afterEach(() => {
  vi.restoreAllMocks();
  clearTty();
  rmSync(dir, { recursive: true, force: true });
  for (const key of ENV_KEYS) {
    const value = previousEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("output selection", () => {
  it("emits one compact JSON value on stdout for --output json", async () => {
    await cli(["status", BILLING, "--output", "json"]);

    const output = stdout();
    expect(output.includes("\n")).toBe(false);
    expect(output.trim().startsWith("{")).toBe(true);
    const parsed = JSON.parse(output) as { kind: string };
    expect(parsed.kind).toBe("workspace_status");
  });

  it("treats --json as the same value as --output json", async () => {
    await cli(["status", BILLING, "--output", "json"]);
    const explicit = stdout();
    logs = [];
    await cli(["status", BILLING, "--json"]);
    expect(stdout()).toBe(explicit);
  });

  it("rejects conflicting explicit output flags with a structured error", async () => {
    const code = await entry(["status", BILLING, "--output", "human", "--json"]);
    expect(code).toBe(1);
    const payload = parseStderr<{ error: { code: string; message: string } }>();
    expect(payload.error.code).toBe("ValidationError");
    expect(payload.error.message).toContain("Conflicting output modes");
    expect(stdout()).toBe("");
  });

  it("rejects repeated conflicting --output values", async () => {
    const code = await entry(["status", BILLING, "--output", "human", "--output", "json"]);
    expect(code).toBe(1);
    expect(stderr()).toContain("Conflicting --output values");
  });

  it("rejects an invalid --output mode", async () => {
    const code = await entry(["status", BILLING, "--output", "yaml"]);
    expect(code).toBe(1);
    expect(stderr()).toContain("Invalid --output mode: yaml");
  });

  it("honors CAMPFIRE_OUTPUT below explicit flags and ignores invalid values", async () => {
    process.env.CAMPFIRE_OUTPUT = "json";
    await cli(["status", BILLING]);
    expect(parseStdout<{ kind: string }>().kind).toBe("workspace_status");

    logs = [];
    await cli(["status", BILLING, "--output", "human"]);
    expect(stdout()).toContain("Workspace");
    expect(stdout().trim().startsWith("{")).toBe(false);

    logs = [];
    process.env.CAMPFIRE_OUTPUT = "human";
    await cli(["status", BILLING, "--json"]);
    expect(parseStdout<{ kind: string }>().kind).toBe("workspace_status");

    logs = [];
    process.env.CAMPFIRE_OUTPUT = "yaml";
    await cli(["status", BILLING]);
    expect(parseStdout<{ kind: string }>().kind).toBe("workspace_status");
  });

  it("keeps credential receipts out of the auto pipe and opt-in only", async () => {
    const root = mkdtempSync(join(tmpdir(), "campfire-cli-001-onboard-"));
    const onboardArgs = (workspace: string): string[] => [
      "onboard",
      "--human-name",
      "TraceHuman",
      "--agent-name",
      "TraceAgent",
      "--harness",
      "codex",
      "--workspace-name",
      workspace,
      "--goal",
      "Ship safely",
    ];
    try {
      // Non-TTY auto: the credential-bearing command stays human and token-free.
      logs = [];
      errors = [];
      const autoCode = await runCliEntry([
        "--db",
        join(root, "auto.db"),
        ...onboardArgs("auto workspace"),
      ]);
      expect(autoCode).toBe(0);
      expect(stdout()).not.toMatch(/cft_/);
      expect(stdout()).toContain("campfire up");

      // Explicit JSON still emits the one-time receipt.
      logs = [];
      errors = [];
      const jsonCode = await runCliEntry([
        "--db",
        join(root, "json.db"),
        ...onboardArgs("json workspace"),
        "--output",
        "json",
      ]);
      expect(jsonCode).toBe(0);
      const receipt = parseStdout<{ human: { token: string }; agent: { token: string } }>();
      expect(receipt.human.token).toMatch(/^cft_/);
      expect(receipt.agent.token).toMatch(/^cft_/);

      // CAMPFIRE_OUTPUT is ambient configuration, not an opt-in for tokens.
      logs = [];
      errors = [];
      process.env.CAMPFIRE_OUTPUT = "json";
      const envCode = await runCliEntry([
        "--db",
        join(root, "env.db"),
        ...onboardArgs("env workspace"),
      ]);
      expect(envCode).toBe(0);
      expect(stdout()).not.toMatch(/cft_/);
      expect(stdout()).toContain("campfire up");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("selects human text on a TTY and JSON when stdout is not a TTY", async () => {
    setTty(true);
    await cli(["status", BILLING]);
    expect(stdout()).toContain("Workspace");
    expect(stdout()).toContain(BILLING_GOAL_TITLE);
    expect(stdout().trim().startsWith("{")).toBe(false);

    clearTty();
    logs = [];
    await cli(["status", BILLING]);
    expect(parseStdout<{ kind: string }>().kind).toBe("workspace_status");
  });

  it("keeps JSON free of ANSI escapes, wordmark, and progress prose", async () => {
    await cli(["status", BILLING, "--output", "json"]);
    const output = stdout();
    expect(output).not.toMatch(/\u001b\[/);
    expect(output).not.toContain("the shared workspace for people and their agents");
    expect(output).not.toMatch(/spinner|loading|\.\.\.$/i);
  });

  it("keeps help as text and never a JSON document", async () => {
    await cli(["help", "--json"]);
    const output = stdout();
    expect(output).toContain("Campfire");
    expect(() => JSON.parse(output)).toThrow();
  });

  it("keeps help-by-command compatible", async () => {
    await cli(["status", "--help"]);
    expect(stdout()).toContain("campfire status [workspace]");
    expect(stdout()).toContain("Output: auto|human|json");
  });

  it("keeps protocol commands protocol-owned for every output request", () => {
    for (const name of ["help", "mcp", "serve", "view"] as const) {
      const spec = commandSpec(name);
      expect(spec.protocol).toBe(true);
      expect(resolveOutputMode(parseArgs([name]), spec)).toBe("human");
      expect(resolveOutputMode(parseArgs([name, "--output", "human"]), spec)).toBe("human");
    }
    expect(resolveOutputMode(parseArgs(["status", "--json"]), commandSpec("status"))).toBe("json");
  });

  it("keeps NO_COLOR in charge of human color", () => {
    expect(colorEnabled({ isTTY: true })).toBe(true);
    process.env.NO_COLOR = "1";
    expect(colorEnabled({ isTTY: true })).toBe(false);
    delete process.env.NO_COLOR;
    expect(colorEnabled({ isTTY: false })).toBe(false);
  });
});

describe("canonical projection parity", () => {
  it("renders human output from the same facts as JSON for status", async () => {
    await cli(["create-task", "--workspace", BILLING, "--title", "open one"]);
    logs = [];
    await cli(["status", BILLING, "--output", "json"]);
    const parsed = parseStdout<{
      workspace: { id: string; name: string };
      goal?: { title: string };
      work: { open: number };
      participants: { humans: number; agents: number };
      activity: { newestContributionId?: string };
    }>();

    logs = [];
    await cli(["status", BILLING, "--output", "human"]);
    const human = stdout();
    expect(human).toContain(parsed.workspace.name);
    expect(human).toContain(parsed.workspace.id);
    expect(human).toContain(parsed.goal?.title);
    expect(human).toContain(`open ${parsed.work.open}`);
    expect(human).toContain(`humans`);
    expect(human).toContain(`newest ${parsed.activity.newestContributionId}`);
  });

  it("renders human output from the same facts as JSON for agents, decisions, and changes", async () => {
    await cli(["add-decision", "--workspace", BILLING, "--summary", "Human parity decision"]);
    const decision = JSON.parse(logs.at(-1)!) as { id: string };

    logs = [];
    await cli(["agents", BILLING, "--output", "json"]);
    const agents = parseStdout<{ agents: Array<{ id: string; name: string }> }>();
    logs = [];
    await cli(["agents", BILLING, "--output", "human"]);
    for (const agent of agents.agents) {
      expect(stdout()).toContain(agent.id);
    }

    logs = [];
    await cli(["decisions", BILLING, "--output", "human"]);
    expect(stdout()).toContain(decision.id);
    expect(stdout()).toContain("Human parity decision");

    logs = [];
    await cli(["changes", BILLING, "--output", "json"]);
    const changes = parseStdout<{ items: Array<{ id: string }> }>();
    logs = [];
    await cli(["changes", BILLING, "--output", "human"]);
    for (const item of changes.items) {
      expect(stdout()).toContain(item.id);
    }
  });

  it("never lets stale profile labels override live service state", async () => {
    saveProfile({
      version: 1,
      databasePath: dbPath,
      url: "http://127.0.0.1:9414",
      humanId: FIXTURE.humans.sergio,
      humanName: "Sergio",
      workspaceId: BILLING,
      workspaceName: "STALE WORKSPACE LABEL",
      goalTitle: "STALE GOAL LABEL",
      agentName: "STALE AGENT LABEL",
      harness: "codex",
    });

    await cli(["status", "--output", "json"]);
    const parsed = parseStdout<{
      workspace: { id: string; name: string };
      goal?: { title: string };
    }>();
    expect(parsed.workspace.id).toBe(BILLING);
    expect(parsed.workspace.name).not.toBe("STALE WORKSPACE LABEL");
    expect(parsed.goal?.title).toBe(BILLING_GOAL_TITLE);
    expect(stdout()).not.toContain("STALE");
  });

  it("returns awaiting_workspace for a human-only profile without creating state", async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "campfire-cli-001-empty-"));
    const emptyDb = join(emptyDir, "campfire.db");
    const runtime = createRuntimeFromPath(emptyDb);
    try {
      const started = beginHuman(runtime.store, runtime.service, runtime.config, "Ada");
      persistHumanProfile({
        databasePath: emptyDb,
        humanId: started.humanId,
        humanName: "Ada",
        humanToken: started.token,
      });
    } finally {
      runtime.close();
    }

    const code = await runCliEntry(["--db", emptyDb, "status", "--output", "json"]);
    expect(code).toBe(0);
    const parsed = parseStdout<{
      state: string;
      kind: string;
      human?: { name: string };
      workspace?: unknown;
    }>();
    expect(parsed.kind).toBe("workspace_status");
    expect(parsed.state).toBe("awaiting_workspace");
    expect(parsed.human?.name).toBe("Ada");
    expect(parsed.workspace).toBeUndefined();

    const check = createRuntimeFromPath(emptyDb);
    try {
      expect(check.store.listWorkspaces()).toEqual([]);
    } finally {
      check.close();
    }
    rmSync(emptyDir, { recursive: true, force: true });
  });

  it("denies an explicit unauthorized workspace before state crosses the boundary", async () => {
    const code = await entryAs(["status", UNRELATED, "--output", "json"], FIXTURE.tokens.alice);
    expect(code).toBe(1);
    const payload = parseStderr<{ error: { code: string; message: string } }>();
    expect(["ParticipantRequired", "Unauthorized", "WorkspaceNotFound"]).toContain(payload.error.code);
    expect(stdout()).not.toContain(FIXTURE.unrelatedFindingSentinel);
    expect(stderr()).not.toContain(FIXTURE.unrelatedFindingSentinel);
  });

  it("fails ambiguous workspace selection with an actionable authorized-only list", async () => {
    const code = await runCliEntry(["--db", dbPath, "status", "--output", "json"]);
    expect(code).toBe(1);
    const payload = parseStderr<{
      error: { code: string; message: string; details?: { field?: string; workspaces?: Array<{ id: string; name: string }> } };
      next?: Array<{ command: string }>;
    }>();
    expect(payload.error.code).toBe("ValidationError");
    expect(payload.error.message).toContain("--workspace");
    const listed = payload.error.details?.workspaces ?? [];
    expect(listed.map((workspace) => workspace.id).sort()).toEqual([BILLING, UNRELATED].sort());
    expect(payload.next?.some((step) => step.command === "campfire list")).toBe(true);
    expect(stderr()).not.toContain(FIXTURE.unrelatedFindingSentinel);
  });
});

describe("command semantics", () => {
  it("status includes workspace, goal, work, decision, attention, and cursor facts", async () => {
    await cli(["create-task", "--workspace", BILLING, "--title", "open task"]);
    await cli(["create-task", "--workspace", BILLING, "--title", "started task"]);
    const started = JSON.parse(logs.at(-1)!) as { id: string };
    await cli(["update-task", started.id, "--status", "in_progress"]);
    await cli(["create-task", "--workspace", BILLING, "--title", "blocked task"]);
    const blocked = JSON.parse(logs.at(-1)!) as { id: string };
    await cli(["update-task", blocked.id, "--status", "blocked"]);
    await cli(["add-decision", "--workspace", BILLING, "--summary", "status proposed"]);
    await cli(["add-decision", "--workspace", BILLING, "--summary", "status accepted"]);
    const accepted = JSON.parse(logs.at(-1)!) as { id: string };
    await cli(["accept-decision", accepted.id]);

    const contributions = openSqliteStore(dbPath);
    let newest: string | undefined;
    try {
      newest = contributions.listContributions(BILLING).at(-1)?.id;
    } finally {
      contributions.close();
    }

    logs = [];
    await cli(["status", BILLING, "--output", "json"]);
    const parsed = parseStdout<{
      version: number;
      kind: string;
      state: string;
      workspace: { id: string; name: string; status: string };
      goal?: { title: string };
      participants: { humans: number; agents: number };
      work: { open: number; inProgress: number; blocked: number };
      decisions: { proposed: number; accepted: number };
      attention: { needsYou: unknown[]; needsAttention: unknown[] };
      activity: { total: number; newestContributionId?: string; truncated: boolean };
    }>();

    expect(parsed.version).toBe(1);
    expect(parsed.state).toBe("ready");
    expect(parsed.workspace).toEqual({ id: BILLING, name: "billing-deploy-failure", status: "active" });
    expect(parsed.goal?.title).toBe(BILLING_GOAL_TITLE);
    expect(parsed.participants).toEqual({ humans: 2, agents: 2 });
    expect(parsed.work).toEqual({ open: 1, inProgress: 1, blocked: 1 });
    expect(parsed.decisions).toEqual({ proposed: 1, accepted: 1 });
    expect(Array.isArray(parsed.attention.needsYou)).toBe(true);
    expect(Array.isArray(parsed.attention.needsAttention)).toBe(true);
    expect(parsed.activity.total).toBeGreaterThan(0);
    expect(parsed.activity.newestContributionId).toBe(newest);
    expect(parsed.activity.truncated).toBe(false);
    expect("databasePath" in parsed).toBe(false);
  });

  it("agents lists recorded participants without inventing presence", async () => {
    await cli(["agents", BILLING, "--output", "json"]);
    const parsed = parseStdout<{
      version: number;
      kind: string;
      workspaceId: string;
      agents: Array<Record<string, unknown>>;
    }>();
    expect(parsed.kind).toBe("workspace_agents");
    expect(parsed.version).toBe(1);
    expect(parsed.workspaceId).toBe(BILLING);
    expect(parsed.agents.map((agent) => agent.id).sort()).toEqual(
      [FIXTURE.agents.codexSergio, FIXTURE.agents.opencodeAlice].sort(),
    );
    for (const agent of parsed.agents) {
      expect(Object.keys(agent).sort()).toEqual(
        ["harness", "humanOwnerId", "id", "joinedAt", "name", "role"].sort(),
      );
    }
    expect(JSON.stringify(parsed)).not.toMatch(/"online"|"idle"|"working"|"dead"|"blocked"/);

    logs = [];
    await cli(["agents", BILLING, "--output", "human"]);
    expect(stdout()).toContain(FIXTURE.agents.codexSergio);
    expect(stdout()).not.toMatch(/online|idle|working|dead/);
  });

  it("decisions preserves proposed, accepted, and superseded distinctions", async () => {
    await cli(["add-decision", "--workspace", BILLING, "--summary", "proposed decision"]);
    await cli(["add-decision", "--workspace", BILLING, "--summary", "accepted decision"]);
    const accepted = JSON.parse(logs.at(-1)!) as { id: string };
    await cli(["accept-decision", accepted.id]);
    const now = new Date().toISOString();
    const store = openSqliteStore(dbPath);
    try {
      store.createDecision({
        id: "dec_superseded_test",
        workspaceId: BILLING,
        summary: "superseded decision",
        status: "superseded",
        createdBy: { actorId: FIXTURE.humans.sergio, actorType: "human" },
        createdAt: now,
        updatedAt: now,
      });
    } finally {
      store.close();
    }

    logs = [];
    await cli(["decisions", BILLING, "--output", "json"]);
    const parsed = parseStdout<{
      version: number;
      kind: string;
      proposed: Array<{ status: string; summary: string }>;
      accepted: Array<{ status: string; summary: string }>;
      superseded: Array<{ status: string; summary: string }>;
    }>();
    expect(parsed.kind).toBe("workspace_decisions");
    expect(parsed.proposed.map((decision) => decision.summary)).toContain("proposed decision");
    expect(parsed.accepted.map((decision) => decision.summary)).toContain("accepted decision");
    expect(parsed.superseded.map((decision) => decision.summary)).toContain("superseded decision");
    expect(parsed.proposed.every((decision) => decision.status === "proposed")).toBe(true);
    expect(parsed.accepted.every((decision) => decision.status === "accepted")).toBe(true);
    expect(parsed.superseded.every((decision) => decision.status === "superseded")).toBe(true);
  });

  it("changes --since returns only Contributions strictly after the cursor", async () => {
    await cli(["changes", BILLING, "--output", "json"]);
    const baseline = parseStdout<{ toCursor: string; items: Array<{ id: string }> }>();
    expect(baseline.toCursor).toBeDefined();

    await cli(["add-finding", "--workspace", BILLING, "--summary", "after cursor finding"]);
    const finding = JSON.parse(logs.at(-1)!) as { id: string };

    logs = [];
    await cli(["changes", BILLING, "--since", baseline.toCursor, "--output", "json"]);
    const delta = parseStdout<{
      fromCursor: string;
      toCursor: string;
      items: Array<{ id: string; objectId: string; objectType: string }>;
      truncated: boolean;
    }>();
    expect(delta.fromCursor).toBe(baseline.toCursor);
    expect(delta.items).toHaveLength(1);
    expect(delta.items[0]!.objectType).toBe("finding");
    expect(delta.items[0]!.objectId).toBe(finding.id);
    expect(delta.truncated).toBe(false);
    expect(delta.toCursor).not.toBe(baseline.toCursor);
  });

  it("keeps the supplied cursor for an empty valid delta", async () => {
    await cli(["changes", BILLING, "--output", "json"]);
    const baseline = parseStdout<{ toCursor: string }>();

    logs = [];
    await cli(["changes", BILLING, "--since", baseline.toCursor, "--output", "json"]);
    const delta = parseStdout<{ fromCursor: string; toCursor: string; items: unknown[] }>();
    expect(delta.items).toEqual([]);
    expect(delta.fromCursor).toBe(baseline.toCursor);
    expect(delta.toCursor).toBe(baseline.toCursor);
  });

  it("rejects unknown and foreign-workspace cursors without leaking rows", async () => {
    const code = await entry([
      "changes",
      BILLING,
      "--since",
      "con_missing",
      "--output",
      "json",
    ]);
    expect(code).toBe(1);
    expect(parseStderr<{ error: { code: string } }>().error.code).toBe("ValidationError");
    expect(stderr()).toContain("con_missing");

    logs = [];
    errors = [];
    await cli(["changes", UNRELATED, "--output", "json"]);
    const foreign = parseStdout<{ toCursor: string }>();

    logs = [];
    errors = [];
    const foreignCode = await entry([
      "changes",
      BILLING,
      "--since",
      foreign.toCursor,
      "--output",
      "json",
    ]);
    expect(foreignCode).toBe(1);
    expect(stderr()).toContain("Unknown contribution id");
    expect(stdout()).not.toContain(FIXTURE.unrelatedFindingSentinel);
    expect(stderr()).not.toContain(FIXTURE.unrelatedFindingSentinel);
  });

  it("inspect requires a workspace for non-workspace objects", async () => {
    const code = await entry(["inspect", "goal", FIXTURE.goals.billing, "--output", "json"]);
    expect(code).toBe(1);
    expect(parseStderr<{ error: { code: string; details?: { field?: string } } }>().error.details?.field).toBe(
      "workspace",
    );
  });

  it("inspect selects objects only from the authorized workspace", async () => {
    await cli(["inspect", "workspace", BILLING, "--output", "json"]);
    expect(parseStdout<{ objectType: string; object: { id: string } }>().object.id).toBe(BILLING);

    logs = [];
    await cli([
      "inspect",
      "agent",
      FIXTURE.agents.codexSergio,
      "--workspace",
      BILLING,
      "--output",
      "json",
    ]);
    const agent = parseStdout<{ objectType: string; object: { id: string; name: string } }>();
    expect(agent.objectType).toBe("agent");
    expect(agent.object.id).toBe(FIXTURE.agents.codexSergio);

    logs = [];
    await cli([
      "inspect",
      "contribution",
      "con_seed_ws_billing_deploy_create",
      "--workspace",
      BILLING,
      "--output",
      "json",
    ]);
    expect(parseStdout<{ object: { action: string } }>().object.action).toBe("create");

    logs = [];
    errors = [];
    const cross = await entry([
      "inspect",
      "goal",
      FIXTURE.goals.billing,
      "--workspace",
      UNRELATED,
      "--output",
      "json",
    ]);
    expect(cross).toBe(1);
    const failure = parseStderr<{ error: { code: string } }>();
    expect(failure.error.code).toBe("GoalNotFound");
    expect(stderr()).not.toContain(FIXTURE.unrelatedFindingSentinel);
  });

  it("inspect rejects unknown kinds and missing objects without cross-workspace discovery", async () => {
    const unknownKind = await entry([
      "inspect",
      "sorcery",
      "x",
      "--workspace",
      BILLING,
      "--output",
      "json",
    ]);
    expect(unknownKind).toBe(1);
    expect(parseStderr<{ error: { message: string } }>().error.message).toContain("Invalid inspect kind");

    logs = [];
    errors = [];
    const missing = await entry([
      "inspect",
      "artifact",
      "art_missing",
      "--workspace",
      BILLING,
      "--output",
      "json",
    ]);
    expect(missing).toBe(1);
    expect(parseStderr<{ error: { code: string } }>().error.code).toBe("ArtifactNotFound");
  });

  it("capabilities exactly matches the installed command catalog", async () => {
    await cli(["capabilities", "--output", "json"]);
    const manifest = parseStdout<{
      version: number;
      kind: string;
      manifestVersion: number;
      campfireVersion: string;
      commands: Array<{
        name: string;
        description: string;
        usage: string;
        mutates: boolean;
        workspaceScoped: boolean;
        outputModes: string[];
      }>;
    }>();
    expect(manifest.kind).toBe("cli_command_manifest");
    expect(manifest.manifestVersion).toBe(1);
    expect(manifest.campfireVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(manifest.commands.map((command) => command.name)).toEqual(
      CLI_COMMAND_NAMES.filter((name) => commandDiscoverable(name)),
    );

    for (const command of manifest.commands) {
      expect(command.description.length).toBeGreaterThan(0);
      expect(command.usage.startsWith("campfire ")).toBe(true);
      expect(typeof command.mutates).toBe("boolean");
      expect(typeof command.workspaceScoped).toBe("boolean");
      expect(command.outputModes).toContain("auto");
      expect(isKnownCommand(command.name)).toBe(true);
    }

    logs = [];
    await cli(["capabilities", "--output", "human"]);
    expect(stdout()).toContain("Understand the workspace");
    expect(stdout()).toContain("campfire status");
  });

  it("keeps every catalogued command on a dispatch path and vice versa", () => {
    const dispatched = Object.keys(CLI_COMMAND_HANDLERS).sort();
    const catalogued = [...CLI_COMMAND_NAMES].sort();
    expect(dispatched).toEqual(catalogued);
    for (const name of CLI_COMMAND_NAMES) {
      expect(CLI_CATALOG[name].name).toBe(name);
      if (commandDiscoverable(name)) {
        expect(formatUsage()).toContain(CLI_CATALOG[name].usage);
      }
    }
    // Only onboard can carry a one-time credential in a successful result.
    expect(commandSpec("onboard").credentials).toBe(true);
    for (const name of CLI_COMMAND_NAMES) {
      if (name !== "onboard") {
        expect(CLI_CATALOG[name].credentials, name).toBe(false);
      }
    }
  });
});

describe("security and privacy", () => {
  const OPERATOR_SENTINEL = "cfg_bridge_operator_secret_sentinel";

  async function forEachPrimaryRead(
    run: (args: string[], label: string) => Promise<string>,
  ): Promise<void> {
    const cases: Array<[string, string[]]> = [
      ["status", ["status", BILLING, "--output", "json"]],
      ["agents", ["agents", BILLING, "--output", "json"]],
      ["decisions", ["decisions", BILLING, "--output", "json"]],
      ["changes", ["changes", BILLING, "--output", "json"]],
      ["inspect", ["inspect", "workspace", BILLING, "--output", "json"]],
      ["status human", ["status", BILLING, "--output", "human"]],
      ["agents human", ["agents", BILLING, "--output", "human"]],
      ["changes human", ["changes", BILLING, "--output", "human"]],
    ];
    for (const [label, args] of cases) {
      const output = await run(args, label);
      expect(output, label).not.toContain(OPERATOR_SENTINEL);
      expect(output, label).not.toMatch(/cft_/);
      expect(output, label).not.toContain(FIXTURE.unrelatedFindingSentinel);
      expect(output, label).not.toContain("PRIVATE_TRANSCRIPT_SENTINEL");
    }
  }

  it("never leaks tokens, operator secrets, or unrelated workspace state in primary reads", async () => {
    process.env.CAMPFIRE_BRIDGE_TOKEN = OPERATOR_SENTINEL;
    await forEachPrimaryRead(async (args) => {
      logs = [];
      errors = [];
      await cli(args);
      return `${stdout()}\n${stderr()}`;
    });
  });

  it("keeps human mode from revealing fields absent from JSON mode", async () => {
    await cli(["status", BILLING, "--output", "json"]);
    const json = stdout();
    logs = [];
    await cli(["status", BILLING, "--output", "human"]);
    const human = stdout();
    for (const forbidden of ["databasePath", "humanToken", "agentToken", "operatorToken"]) {
      expect(json).not.toContain(forbidden);
      expect(human).not.toContain(forbidden);
    }
  });

  it("requires the existing actor credential in hosted mode", async () => {
    process.env.CAMPFIRE_URL = "http://127.0.0.1:9";
    const code = await runCliEntry(["status", BILLING, "--output", "json"]);
    expect(code).toBe(1);
    const failure = parseStderr<{ error: { code: string; message: string } }>();
    expect(failure.error.code).toBe("ValidationError");
    expect(failure.error.message).toContain("CAMPFIRE_TOKEN");
  });

  it("does not present command discovery as an authorization grant", async () => {
    await cli(["capabilities", "--output", "json"]);
    const manifest = stdout();
    expect(manifest).toContain("cli_command_manifest");
    expect(manifest).not.toMatch(/capability_grant|authorized_for|granted/i);
  });
});

describe("regression compatibility", () => {
  it("keeps existing command names accepted and unknown names rejected", async () => {
    for (const name of ["list", "show", "activity", "doctor", "handoff", "preflight"]) {
      expect(isKnownCommand(name)).toBe(true);
    }
    const code = await entry(["definitely-not-a-command", "--output", "json"]);
    expect(code).toBe(1);
    expect(parseStderr<{ error: { code: string } }>().error.code).toBe("ValidationError");
  });

  it("keeps show --json on the existing service object", async () => {
    await cli(["show", BILLING, "--json"]);
    const context = parseStdout<WorkspaceContext>();
    expect(context.workspace.id).toBe(BILLING);
    expect(context.alignment).toBeDefined();
    expect(context.currentWork).toBeDefined();
  });

  it("keeps structured failures for existing read commands", async () => {
    const code = await entry(["show", "ws_missing", "--output", "json"]);
    expect(code).toBe(1);
    const failure = parseStderr<{
      error: { code: string; message: string; details?: { workspaceId?: string } };
      next?: Array<{ command: string }>;
    }>();
    expect(failure.error.code).toBe("WorkspaceNotFound");
    expect(failure.error.details?.workspaceId).toBe("ws_missing");
    expect(failure.next?.some((step) => step.command === "campfire list")).toBe(true);
  });
});
