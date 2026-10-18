/**
 * ONB-001 Step 1 — human receipt wording.
 *
 * The pure builders are pinned byte-for-byte per state; the CLI-level cases
 * exercise the real render paths (local `up` after the listeners bind, the
 * awaiting status projection). Direct TTY/PTY verification is Step 3.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { beginHuman, connectInstalledHarnesses } from "../../src/bootstrap/listen.js";
import { defaultHarnessConfigPath, detectInstalledHarnesses } from "../../src/bootstrap/connect.js";
import { persistHumanProfile, rememberAgentCredential } from "../../src/bootstrap/profile.js";
import { buildAwaitingWorkspace, formatWorkspaceStatus } from "../../src/cli/projections.js";
import { runCliEntry } from "../../src/cli/index.js";
import { wordmark } from "../../src/cli/ui.js";
import {
  DASHBOARD_AWAITING_WORKSPACE,
  formatJoinReceipt,
  formatLocalStatusReceipt,
  formatLocalUpReceipt,
  formatRemoteUpReceipt,
  harnessLabel,
} from "../../src/presentation/receipts.js";
import { createRuntimeFromPath } from "../../src/runtime.js";

/** The vocabulary ONB-001 forbids: configuration is not a live session. */
const FORBIDDEN = ["connected", "online", "ready to work", "workspace created"];

/** v1.22.0 `up` JSON keys, in the order `cmdUp` inserts them. */
const UP_JSON_KEYS = [
  "human",
  "workspaces",
  "agents",
  "apiUrl",
  "viewerUrl",
  "openedBrowser",
  "pastSessionsImported",
] as const;

/** Baseline packet `docs/evidence/onb-001/machine/A9-up-json-no-open.stdout.txt`. */
const A9_UP_JSON =
  '{"human":"Ada","workspaces":[],"agents":[],"apiUrl":"http://127.0.0.1:[port]","viewerUrl":"http://127.0.0.1:[port]","openedBrowser":false,"pastSessionsImported":false}';

/** Baseline packet `docs/evidence/onb-001/machine/C5-return-no-workspace-status-json.stdout.txt`. */
const C5_STATUS_JSON =
  '{"version":1,"kind":"workspace_status","state":"awaiting_workspace","human":{"id":"hum_[id]","name":"Ada"},"next":[{"command":"campfire up","when":"Start the local API and Viewer so an agent can connect"},{"command":"campfire --help","when":"See the command list"}]}';

function maskDynamic(text: string): string {
  return text
    .replace(/http:\/\/127\.0\.0\.1:\d+/g, "http://127.0.0.1:[port]")
    .replace(/hum_[0-9a-f]+/g, "hum_[id]");
}

/** One compact JSON object: JSON.stringify, no pretty-print, no human receipt. */
function expectOneCompactJson(output: string[]): { line: string; body: Record<string, unknown> } {
  expect(output).toHaveLength(1);
  const line = output[0] ?? "";
  expect(line).not.toContain("\n");
  const body = JSON.parse(line) as Record<string, unknown>;
  expect(line).toBe(JSON.stringify(body));
  expect(line).not.toContain("Config prepared");
  expect(line).not.toContain("Campfire is running");
  expect(line).not.toMatch(/cft_|cfe_/);
  return { line, body };
}

function expectClean(text: string): void {
  for (const word of FORBIDDEN) {
    expect(text, `forbidden word ${JSON.stringify(word)}`).not.toContain(word);
  }
  expect(text).not.toMatch(/cft_|cfe_/);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("ONB-001 harness vocabulary", () => {
  it("labels supported harnesses and leaves unknown ids verbatim", () => {
    expect(harnessLabel("codex")).toBe("Codex");
    expect(harnessLabel("opencode")).toBe("OpenCode");
    expect(harnessLabel("other")).toBe("other");
  });
});

describe("ONB-001 local up receipt", () => {
  it("renders both prepared harnesses, the actual Viewer URL, and one next action", () => {
    const text = formatLocalUpReceipt({
      wordmark: wordmark(false),
      humanName: "Sergio",
      workspaces: [],
      viewerUrl: "http://127.0.0.1:49793",
      connect: true,
      detected: ["codex", "opencode"],
      prepared: ["codex", "opencode"],
    });
    expect(text).toBe(
      [
        wordmark(false),
        "  Campfire is running for Sergio.",
        "  Workspace  None yet",
        "  Codex      Config prepared — restart Codex to load Campfire tools",
        "  OpenCode   Config prepared — restart OpenCode to load Campfire tools",
        "  Viewer     http://127.0.0.1:49793",
        "",
        "  Next: Restart Codex or OpenCode. In that session, describe the work you want to do;",
        "        your agent can create a Campfire workspace and goal with you.",
        "",
        "  Past sessions are not imported.",
      ].join("\n"),
    );
    expectClean(text);
  });

  it("separates a prepared harness from a detected one with no stored credential", () => {
    const text = formatLocalUpReceipt({
      wordmark: wordmark(false),
      humanName: "Sergio",
      workspaces: [],
      viewerUrl: "http://127.0.0.1:1",
      connect: true,
      detected: ["codex", "opencode"],
      prepared: ["codex"],
    });
    expect(text).toContain("  Codex      Config prepared — restart Codex to load Campfire tools");
    expect(text).toContain("  OpenCode   Detected — Campfire tools were not prepared");
    expect(text).toContain("  Next: Restart Codex. In that session, describe the work you want to do;");
    // The unwritten block gets its explicit recovery, never a reload suggestion.
    expect(text).toContain("        OpenCode: run campfire connect --harness opencode --token <agent-token>.");
    expect(text).not.toContain("Restart OpenCode");
    expectClean(text);
  });

  it("says no supported harness was detected and installs before restarting", () => {
    const text = formatLocalUpReceipt({
      wordmark: wordmark(false),
      humanName: "Ada",
      workspaces: [],
      viewerUrl: "http://127.0.0.1:1",
      connect: true,
      detected: [],
      prepared: [],
    });
    expect(text).toContain("  Harness    No supported harness detected");
    expect(text).toContain(
      "  Next: Install Codex or OpenCode, then run campfire up to prepare its Campfire tools.",
    );
    expectClean(text);
  });

  it("names --no-connect instead of claiming a detection failure", () => {
    const text = formatLocalUpReceipt({
      wordmark: wordmark(false),
      humanName: "Ada",
      workspaces: [],
      viewerUrl: "http://127.0.0.1:1",
      connect: false,
      detected: [],
      prepared: [],
    });
    expect(text).toContain("  Harness    Connection setup skipped (--no-connect)");
    expect(text).toContain(
      "  Next: Run campfire up without --no-connect to prepare your harness's Campfire tools.",
    );
    expect(text).not.toContain("Config prepared");
    expectClean(text);
  });

  it("continues the work when a workspace is already visible", () => {
    const text = formatLocalUpReceipt({
      wordmark: wordmark(false),
      humanName: "Sergio",
      workspaces: [{ name: "billing deploy", goalTitle: "Ship the billing migration safely" }],
      viewerUrl: "http://127.0.0.1:1",
      connect: true,
      detected: ["codex"],
      prepared: ["codex"],
    });
    expect(text).toContain("  Workspace  billing deploy  Ship the billing migration safely");
    expect(text).toContain("  Next: Restart Codex. In that session, continue the work you want to do;");
    expect(text).toContain("        your agent reads the current authorized work before contributing.");
    expectClean(text);
  });

  it("gives each not-prepared harness its connect recovery when nothing was prepared", () => {
    const text = formatLocalUpReceipt({
      wordmark: wordmark(false),
      humanName: "Sergio",
      workspaces: [],
      viewerUrl: "http://127.0.0.1:1",
      connect: true,
      detected: ["codex", "opencode"],
      prepared: [],
    });
    expect(text).toBe(
      [
        wordmark(false),
        "  Campfire is running for Sergio.",
        "  Workspace  None yet",
        "  Codex      Detected — Campfire tools were not prepared",
        "  OpenCode   Detected — Campfire tools were not prepared",
        "  Viewer     http://127.0.0.1:1",
        "",
        "  Next: Run campfire connect --harness codex --token <agent-token> to write its Campfire config.",
        "        Run campfire connect --harness opencode --token <agent-token> to write its Campfire config.",
        "",
        "  Past sessions are not imported.",
      ].join("\n"),
    );
    expectClean(text);
  });
});

describe("ONB-001 returning local status", () => {
  it("renders the no-workspace state with one bounded next action", () => {
    expect(formatLocalStatusReceipt({ humanName: "Ada" })).toBe(
      [
        "  You        Ada",
        "  No workspace yet.",
        "  Next: Run campfire up to reopen Campfire and prepare your harness's tools.",
        "        Then, in that session, describe the work you want to do;",
        "        your agent can create a Campfire workspace and goal with you.",
        "  Past sessions are not imported.",
      ].join("\n"),
    );
  });

  it("labels recorded agents as recorded, not live", () => {
    const text = formatLocalStatusReceipt({
      humanName: "Ada",
      agents: "Codex (codex), OpenCode (opencode)",
    });
    expect(text).toContain("  Agents     Codex (codex), OpenCode (opencode)  (recorded, not live)");
    expectClean(text);
  });

  it("labels a stored workspace selection as saved profile data", () => {
    const text = formatLocalStatusReceipt({
      humanName: "Sergio",
      agents: "Codex (codex)",
      workspaceName: "billing deploy",
      goalTitle: "Ship the billing migration safely",
    });
    expect(text).toBe(
      [
        "  You        Sergio",
        "  Workspace  billing deploy",
        "  Goal       Ship the billing migration safely",
        "  Agents     Codex (codex)",
        "  Next: campfire status    read your current authorized work",
        "        campfire up        open the Viewer and prepare your harness's tools",
        "  Saved local profile — not live service or agent status.",
      ].join("\n"),
    );
    expectClean(text);
  });
});

describe("ONB-001 awaiting-workspace projection", () => {
  it("keeps the JSON next array untouched", () => {
    expect(buildAwaitingWorkspace({ id: "hum_1", name: "Ada" })).toEqual({
      version: 1,
      kind: "workspace_status",
      state: "awaiting_workspace",
      human: { id: "hum_1", name: "Ada" },
      next: [
        { command: "campfire up", when: "Start the local API and Viewer so an agent can connect" },
        { command: "campfire --help", when: "See the command list" },
      ],
    });
  });

  it("replaces the bare waiting sentence and appends the agent-side next step", () => {
    const text = formatWorkspaceStatus(buildAwaitingWorkspace({ id: "hum_1", name: "Ada" }));
    expect(text).toBe(
      [
        "You        Ada",
        "No workspace yet.",
        "Past sessions are not imported.",
        "campfire up  Start the local API and Viewer so an agent can connect",
        "campfire --help  See the command list",
        "  Next: After your agent has the Campfire tools loaded, describe the work",
        "        you want to do; your agent can create a Campfire workspace and goal with you.",
      ].join("\n"),
    );
    expectClean(text);
  });

  it("keeps the dashboard awaiting sentence free of presence claims", () => {
    expect(DASHBOARD_AWAITING_WORKSPACE).toBe(
      "No workspace yet. Run campfire up, then describe the work to your agent; it can create the workspace and goal.",
    );
    expectClean(DASHBOARD_AWAITING_WORKSPACE);
  });
});

describe("ONB-001 join receipt", () => {
  it("distinguishes membership from a prepared config", () => {
    const text = formatJoinReceipt({
      workspaceName: "billing deploy",
      humanName: "Ben",
      agents: ["codex", "opencode"],
      prepared: ["codex", "opencode"],
    });
    expect(text).toBe(
      [
        "  Joined billing deploy as Ben.",
        "  Codex      Config prepared — restart Codex to load Campfire tools",
        "  OpenCode   Config prepared — restart OpenCode to load Campfire tools",
        "",
        "  Next: Run campfire up, then restart Codex or OpenCode. Approve Campfire tools if asked,",
        "        then begin from billing deploy.",
      ].join("\n"),
    );
    expectClean(text);
  });

  it("never claims prepared config without the connection_prepared stage", () => {
    const text = formatJoinReceipt({
      workspaceName: "billing deploy",
      humanName: "Ben",
      agents: ["codex"],
      prepared: [],
    });
    expect(text).toContain("  Joined billing deploy as Ben.");
    expect(text).not.toContain("Config prepared");
    expect(text).not.toContain("Restart");
    expect(text).toContain("  Next: Run campfire up.");
    expect(text).toContain(
      "        Run campfire connect --harness codex --token <agent-token> to write its Campfire config.",
    );
    expectClean(text);
  });
});

describe("ONB-001 remote up receipt", () => {
  it("names prepared connections and begins from the joined workspace", () => {
    const text = formatRemoteUpReceipt({
      wordmark: wordmark(false),
      humanName: "Alice",
      workspaces: [
        { id: "ws_1", name: "billing deploy" },
        { id: "ws_2", name: "ledger export" },
      ],
      joinedWorkspaceId: "ws_2",
      viewerUrl: "http://127.0.0.1:9499",
      connect: true,
      prepared: ["opencode"],
    });
    expect(text).toBe(
      [
        wordmark(false),
        "  Campfire is running for Alice.",
        "  Workspace  billing deploy",
        "  Workspace  ledger export",
        "  OpenCode   Config prepared — restart OpenCode to load Campfire tools",
        "  Viewer     http://127.0.0.1:9499",
        "",
        "  Next: Restart OpenCode. In that session, approve Campfire tools if asked, then",
        "        begin from ledger export.",
        "",
        "  The Viewer is read-only; an agent registers its own session before contributing.",
      ].join("\n"),
    );
    expectClean(text);
  });

  it("falls back to the first visible workspace, then the stored name", () => {
    const first = formatRemoteUpReceipt({
      wordmark: wordmark(false),
      humanName: "Alice",
      workspaces: [{ id: "ws_1", name: "billing deploy" }],
      joinedWorkspaceId: "ws_gone",
      joinedWorkspaceName: "stored name",
      viewerUrl: "http://127.0.0.1:1",
      connect: true,
      prepared: ["codex"],
    });
    expect(first).toContain("        begin from billing deploy.");
    const stored = formatRemoteUpReceipt({
      wordmark: wordmark(false),
      humanName: "Alice",
      workspaces: [],
      joinedWorkspaceId: "ws_gone",
      joinedWorkspaceName: "stored name",
      viewerUrl: "http://127.0.0.1:1",
      connect: true,
      prepared: ["codex"],
    });
    expect(stored).toContain("        begin from stored name.");
  });

  it("distinguishes an unprepared enrollment from a skipped connection", () => {
    const nothing = formatRemoteUpReceipt({
      wordmark: wordmark(false),
      humanName: "Alice",
      workspaces: [{ id: "ws_1", name: "billing deploy" }],
      joinedWorkspaceId: "ws_1",
      viewerUrl: "http://127.0.0.1:1",
      connect: true,
      prepared: [],
    });
    expect(nothing).toContain("  Harness    No enrolled harness config prepared");
    expect(nothing).toContain(
      "  Next: Install Codex or OpenCode, then run campfire up to prepare its Campfire tools.",
    );
    expect(nothing).toContain("  The Viewer is read-only; an agent registers its own session before contributing.");
    expectClean(nothing);

    const skipped = formatRemoteUpReceipt({
      wordmark: wordmark(false),
      humanName: "Alice",
      workspaces: [{ id: "ws_1", name: "billing deploy" }],
      joinedWorkspaceId: "ws_1",
      viewerUrl: "http://127.0.0.1:1",
      connect: false,
      prepared: [],
    });
    expect(skipped).toContain("  Harness    Connection setup skipped (--no-connect)");
    expect(skipped).toContain(
      "  Next: Run campfire up without --no-connect to prepare your enrolled harness's Campfire tools.",
    );
    expectClean(skipped);
  });
});

describe("ONB-001 connectInstalledHarnesses result", () => {
  it("reports prepared harnesses while keeping the connected display names", () => {
    const root = mkdtempSync(join(tmpdir(), "campfire-onb001-prepared-"));
    const home = join(root, "home");
    const cwd = join(root, "work");
    mkdirSync(join(home, ".codex"), { recursive: true });
    mkdirSync(cwd, { recursive: true });
    const env = { HOME: home, XDG_CONFIG_HOME: join(home, ".config") };
    const runtime = createRuntimeFromPath(join(root, "campfire.db"));
    try {
      const started = beginHuman(runtime.store, runtime.service, runtime.config, "Ada");
      const result = connectInstalledHarnesses({
        store: runtime.store,
        service: runtime.service,
        human: { id: started.humanId, teamId: started.teamId },
        harnesses: detectInstalledHarnesses(env, cwd),
        knownTokens: {},
        url: "http://127.0.0.1:9414",
        mcpCommand: "/tmp/campfire",
        configPathFor: (harness) => defaultHarnessConfigPath(harness, env, cwd),
        onMintedToken: () => undefined,
      });
      expect(result.connected).toEqual(["Codex"]);
      expect(result.prepared).toEqual(["codex"]);
    } finally {
      runtime.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("ONB-001 CLI receipts", () => {
  it("prints the local up receipt after the listeners bind and names the real Viewer URL", async () => {
    const root = mkdtempSync(join(tmpdir(), "campfire-onb001-up-"));
    const home = join(root, "home");
    mkdirSync(join(home, ".codex"), { recursive: true });
    mkdirSync(join(home, ".config", "opencode"), { recursive: true });
    vi.stubEnv("HOME", home);
    vi.stubEnv("XDG_CONFIG_HOME", join(home, ".config"));
    vi.stubEnv("CAMPFIRE_CONFIG_DIR", join(root, "config"));
    vi.stubEnv("CAMPFIRE_DATA_DIR", join(root, "data"));
    const dbPath = join(root, "campfire.db");
    const runtime = createRuntimeFromPath(dbPath);
    const started = beginHuman(runtime.store, runtime.service, runtime.config, "Ada");
    persistHumanProfile({
      databasePath: dbPath,
      humanId: started.humanId,
      humanName: started.humanName,
      humanToken: started.token,
    });
    runtime.close();

    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      output.push(args.map(String).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const execution = runCliEntry([
        "--db", dbPath, "up", "--output", "human", "--no-open", "--port", "0", "--viewer-port", "0",
      ]);
      await vi.waitFor(
        () => {
          expect(output.join("\n")).toContain("Campfire is running for Ada.");
        },
        { timeout: 5000 },
      );
      process.emit("SIGTERM");
      expect(await execution).toBe(0);
      const text = output.join("\n");
      expect(text).toContain("  Workspace  None yet");
      expect(text).toContain("  Codex      Config prepared — restart Codex to load Campfire tools");
      expect(text).toContain("  OpenCode   Config prepared — restart OpenCode to load Campfire tools");
      expect(text).toMatch(/  Viewer     http:\/\/127\.0\.0\.1:\d+/);
      expect(text).toContain("  Next: Restart Codex or OpenCode. In that session, describe the work you want to do;");
      expect(text).toContain("        your agent can create a Campfire workspace and goal with you.");
      expect(text).toContain("  Past sessions are not imported.");
      expectClean(text);
      // The receipt carries the bound port, not the default one.
      expect(text).not.toContain("http://127.0.0.1:9414");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips connection setup with --no-connect and says how to prepare it", async () => {
    const root = mkdtempSync(join(tmpdir(), "campfire-onb001-noconnect-"));
    vi.stubEnv("HOME", join(root, "home"));
    vi.stubEnv("XDG_CONFIG_HOME", join(root, "home", ".config"));
    vi.stubEnv("CAMPFIRE_CONFIG_DIR", join(root, "config"));
    vi.stubEnv("CAMPFIRE_DATA_DIR", join(root, "data"));
    const dbPath = join(root, "campfire.db");
    const runtime = createRuntimeFromPath(dbPath);
    const started = beginHuman(runtime.store, runtime.service, runtime.config, "Ada");
    persistHumanProfile({
      databasePath: dbPath,
      humanId: started.humanId,
      humanName: started.humanName,
      humanToken: started.token,
    });
    runtime.close();

    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      output.push(args.map(String).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const execution = runCliEntry([
        "--db", dbPath, "up", "--output", "human", "--no-connect", "--no-open", "--port", "0", "--viewer-port", "0",
      ]);
      await vi.waitFor(
        () => {
          expect(output.join("\n")).toContain("Campfire is running for Ada.");
        },
        { timeout: 5000 },
      );
      process.emit("SIGTERM");
      expect(await execution).toBe(0);
      const text = output.join("\n");
      expect(text).toContain("  Harness    Connection setup skipped (--no-connect)");
      expect(text).toContain("  Next: Run campfire up without --no-connect to prepare your harness's Campfire tools.");
      expect(text).not.toContain("Config prepared");
      expectClean(text);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns the awaiting status projection with the agent-side next step", async () => {
    const root = mkdtempSync(join(tmpdir(), "campfire-onb001-status-"));
    vi.stubEnv("CAMPFIRE_CONFIG_DIR", join(root, "config"));
    vi.stubEnv("CAMPFIRE_DATA_DIR", join(root, "data"));
    const dbPath = join(root, "campfire.db");
    const runtime = createRuntimeFromPath(dbPath);
    const started = beginHuman(runtime.store, runtime.service, runtime.config, "Ada");
    persistHumanProfile({
      databasePath: dbPath,
      humanId: started.humanId,
      humanName: started.humanName,
      humanToken: started.token,
    });
    runtime.close();

    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      output.push(args.map(String).join(" "));
    });
    try {
      expect(await runCliEntry(["--db", dbPath, "status", "--output", "human"])).toBe(0);
      const text = output.join("\n");
      expect(text).toBe(
        [
          "You        Ada",
          "No workspace yet.",
          "Past sessions are not imported.",
          "campfire up  Start the local API and Viewer so an agent can connect",
          "campfire --help  See the command list",
          "  Next: After your agent has the Campfire tools loaded, describe the work",
          "        you want to do; your agent can create a Campfire workspace and goal with you.",
        ].join("\n"),
      );
      expectClean(text);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("prints the returning no-workspace status for a bare campfire with an existing profile", async () => {
    const root = mkdtempSync(join(tmpdir(), "campfire-onb001-return-"));
    vi.stubEnv("CAMPFIRE_CONFIG_DIR", join(root, "config"));
    vi.stubEnv("CAMPFIRE_DATA_DIR", join(root, "data"));
    const dbPath = join(root, "campfire.db");
    const runtime = createRuntimeFromPath(dbPath);
    const started = beginHuman(runtime.store, runtime.service, runtime.config, "Ada");
    persistHumanProfile({
      databasePath: dbPath,
      humanId: started.humanId,
      humanName: started.humanName,
      humanToken: started.token,
    });
    runtime.close();

    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      output.push(args.map(String).join(" "));
    });
    try {
      expect(await runCliEntry(["--db", dbPath])).toBe(0);
      const text = output.join("\n");
      expect(text).toContain("  No workspace yet.");
      expect(text).toContain("  Next: Run campfire up to reopen Campfire and prepare your harness's tools.");
      expect(text).toContain("  Past sessions are not imported.");
      expectClean(text);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("prints v1.22.0 compact JSON for non-TTY up, with display-name agents", async () => {
    const root = mkdtempSync(join(tmpdir(), "campfire-onb001-up-json-"));
    const home = join(root, "home");
    mkdirSync(join(home, ".codex"), { recursive: true });
    mkdirSync(join(home, ".config", "opencode"), { recursive: true });
    vi.stubEnv("HOME", home);
    vi.stubEnv("XDG_CONFIG_HOME", join(home, ".config"));
    vi.stubEnv("CAMPFIRE_CONFIG_DIR", join(root, "config"));
    vi.stubEnv("CAMPFIRE_DATA_DIR", join(root, "data"));
    const dbPath = join(root, "campfire.db");
    const runtime = createRuntimeFromPath(dbPath);
    const started = beginHuman(runtime.store, runtime.service, runtime.config, "Ada");
    persistHumanProfile({
      databasePath: dbPath,
      humanId: started.humanId,
      humanName: started.humanName,
      humanToken: started.token,
    });
    const [agent] = connectInstalledHarnesses({
      store: runtime.store,
      service: runtime.service,
      human: { id: started.humanId, teamId: started.teamId },
      harnesses: detectInstalledHarnesses(),
      knownTokens: {},
      url: "http://127.0.0.1:9414",
      mcpCommand: "/tmp/campfire",
      configPathFor: (harness) => defaultHarnessConfigPath(harness),
      onMintedToken: (harness, token) => rememberAgentCredential(harness, token),
    }).agents;
    const agentCtx = { actor: { actorId: agent!.agentId, actorType: "agent" as const } };
    const workspace = runtime.service.createWorkspace(agentCtx, {
      teamId: started.teamId,
      name: "billing deploy",
    });
    const session = runtime.service.registerAgentSession(agentCtx, {
      agentId: agent!.agentId,
      workspaceId: workspace.id,
      harness: agent!.harness,
    });
    runtime.service.createGoal(
      { ...agentCtx, agentSessionId: session.id },
      { workspaceId: workspace.id, title: "Ship the billing migration safely" },
    );
    runtime.close();

    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      output.push(args.map(String).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const execution = runCliEntry([
        "--db", dbPath, "up", "--no-open", "--port", "0", "--viewer-port", "0",
      ]);
      await vi.waitFor(() => {
        expect(output.length).toBeGreaterThan(0);
      }, { timeout: 5000 });
      process.emit("SIGTERM");
      expect(await execution).toBe(0);
      const { line, body } = expectOneCompactJson(output);
      expect(Object.keys(body)).toEqual([...UP_JSON_KEYS]);
      expect(body.human).toBe("Ada");
      // `agents` stays the existing connected display names, not receipt prose.
      expect(body.agents).toEqual(["Codex", "OpenCode"]);
      expect(body.workspaces).toEqual([
        {
          id: workspace.id,
          name: "billing deploy",
          goal: "Ship the billing migration safely",
        },
      ]);
      expect(Object.keys((body.workspaces as Array<Record<string, unknown>>)[0] ?? {})).toEqual([
        "id",
        "name",
        "goal",
      ]);
      expect(body.openedBrowser).toBe(false);
      expect(body.pastSessionsImported).toBe(false);
      expect(body.apiUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(body.viewerUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(line).not.toContain("9414");
      expect(line).not.toContain("9415");
      expectClean(line);
    } finally {
      process.emit("SIGTERM");
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("matches the A9 non-TTY up JSON bytes aside from the bound port", async () => {
    const root = mkdtempSync(join(tmpdir(), "campfire-onb001-up-a9-"));
    vi.stubEnv("HOME", join(root, "home"));
    vi.stubEnv("XDG_CONFIG_HOME", join(root, "home", ".config"));
    vi.stubEnv("CAMPFIRE_CONFIG_DIR", join(root, "config"));
    vi.stubEnv("CAMPFIRE_DATA_DIR", join(root, "data"));
    const dbPath = join(root, "campfire.db");
    const runtime = createRuntimeFromPath(dbPath);
    const started = beginHuman(runtime.store, runtime.service, runtime.config, "Ada");
    persistHumanProfile({
      databasePath: dbPath,
      humanId: started.humanId,
      humanName: started.humanName,
      humanToken: started.token,
    });
    runtime.close();

    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      output.push(args.map(String).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const execution = runCliEntry([
        "--db", dbPath, "up", "--no-open", "--port", "0", "--viewer-port", "0",
      ]);
      await vi.waitFor(() => {
        expect(output.length).toBeGreaterThan(0);
      }, { timeout: 5000 });
      process.emit("SIGTERM");
      expect(await execution).toBe(0);
      const { line, body } = expectOneCompactJson(output);
      expect(Object.keys(body)).toEqual([...UP_JSON_KEYS]);
      expect(body.agents).toEqual([]);
      expect(body.workspaces).toEqual([]);
      expect(body.openedBrowser).toBe(false);
      expect(maskDynamic(line)).toBe(A9_UP_JSON);
      expectClean(line);
    } finally {
      process.emit("SIGTERM");
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps non-TTY up --no-connect on the same JSON object", async () => {
    const root = mkdtempSync(join(tmpdir(), "campfire-onb001-up-json-skip-"));
    const home = join(root, "home");
    mkdirSync(join(home, ".codex"), { recursive: true });
    vi.stubEnv("HOME", home);
    vi.stubEnv("XDG_CONFIG_HOME", join(home, ".config"));
    vi.stubEnv("CAMPFIRE_CONFIG_DIR", join(root, "config"));
    vi.stubEnv("CAMPFIRE_DATA_DIR", join(root, "data"));
    const dbPath = join(root, "campfire.db");
    const runtime = createRuntimeFromPath(dbPath);
    const started = beginHuman(runtime.store, runtime.service, runtime.config, "Ada");
    persistHumanProfile({
      databasePath: dbPath,
      humanId: started.humanId,
      humanName: started.humanName,
      humanToken: started.token,
    });
    runtime.close();

    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      output.push(args.map(String).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const execution = runCliEntry([
        "--db", dbPath, "up", "--no-connect", "--no-open", "--port", "0", "--viewer-port", "0",
      ]);
      await vi.waitFor(() => {
        expect(output.length).toBeGreaterThan(0);
      }, { timeout: 5000 });
      process.emit("SIGTERM");
      expect(await execution).toBe(0);
      const { line, body } = expectOneCompactJson(output);
      expect(Object.keys(body)).toEqual([...UP_JSON_KEYS]);
      expect(body.agents).toEqual([]);
      expect(body.openedBrowser).toBe(false);
      expect(body.pastSessionsImported).toBe(false);
      expect(line).not.toContain("Connection setup skipped");
      expect(line).not.toContain("No supported harness detected");
      expect(maskDynamic(line)).toBe(A9_UP_JSON);
      expectClean(line);
    } finally {
      process.emit("SIGTERM");
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("prints v1.22.0 compact JSON for non-TTY status with no workspace", async () => {
    const root = mkdtempSync(join(tmpdir(), "campfire-onb001-status-json-"));
    vi.stubEnv("CAMPFIRE_CONFIG_DIR", join(root, "config"));
    vi.stubEnv("CAMPFIRE_DATA_DIR", join(root, "data"));
    const dbPath = join(root, "campfire.db");
    const runtime = createRuntimeFromPath(dbPath);
    const started = beginHuman(runtime.store, runtime.service, runtime.config, "Ada");
    persistHumanProfile({
      databasePath: dbPath,
      humanId: started.humanId,
      humanName: started.humanName,
      humanToken: started.token,
    });
    runtime.close();

    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      output.push(args.map(String).join(" "));
    });
    try {
      expect(await runCliEntry(["--db", dbPath, "status"])).toBe(0);
      const { line, body } = expectOneCompactJson(output);
      expect(Object.keys(body)).toEqual(["version", "kind", "state", "human", "next"]);
      expect(body).toEqual({
        version: 1,
        kind: "workspace_status",
        state: "awaiting_workspace",
        human: { id: expect.stringMatching(/^hum_[0-9a-f]+$/), name: "Ada" },
        next: [
          { command: "campfire up", when: "Start the local API and Viewer so an agent can connect" },
          { command: "campfire --help", when: "See the command list" },
        ],
      });
      expect(maskDynamic(line)).toBe(C5_STATUS_JSON);
      expect(line).not.toContain("No workspace yet");
      expectClean(line);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
