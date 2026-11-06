/**
 * SES-001 local session host. The fake Codex executable is
 * tests/fixtures/ses-001/fake-codex.mjs. No live harness credential is used.
 */
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveCredentials, saveProfile } from "../../src/bootstrap/profile.js";
import { ValidationError } from "../../src/domain/errors.js";
import { runCliEntry } from "../../src/cli/index.js";
import { createFakeCoreClient, createHttpCoreClient, createServiceCoreClient, HTTP_METHODS } from "../../src/session-host/core-client.js";
import { sendControl } from "../../src/session-host/control.js";
import { openTerminalLauncher, terminalOpenArgv } from "../../src/session-host/external.js";
import {
  prepareSession,
  reconcileSessions,
  runSession,
  stopSession,
  type RunResult,
} from "../../src/session-host/host.js";
import { launcherPath, readLaunchRecord, registryDirectory, writeLaunchRecord } from "../../src/session-host/registry.js";
import { CODEX_ONLY_MESSAGE, EMBEDDED_UNAVAILABLE_MESSAGE, RUNTIME_REPORT_MISSING_MESSAGE, type Clock, type ManagedChild, type SpawnRequest } from "../../src/session-host/types.js";

const HUMAN = "cft_ses001_human_secret";
const AGENT = "cft_ses001_agent_secret";
const FINDING = "FINDING_SENTINEL_do_not_copy";
const AWS = "aws-ses001-secret-value";
const FIXTURE = fileURLToPath(new URL("../fixtures/ses-001/fake-codex.mjs", import.meta.url));

function clockAt(start = Date.parse("2026-11-05T00:00:00.000Z")): Clock & {
  waits: number[];
  set: (value: number) => void;
  pending: () => number;
  release: () => boolean;
} {
  let now = start;
  const waits: number[] = [];
  const pending: Array<{ ms: number; resolve: () => void }> = [];
  return {
    waits,
    now: () => now,
    set: (value: number) => {
      now = value;
    },
    pending: () => pending.length,
    wait: (ms: number) => {
      waits.push(ms);
      return new Promise((resolve) => {
        pending.push({ ms, resolve });
      });
    },
    release: () => {
      const next = pending.shift();
      if (next === undefined) return false;
      now += next.ms;
      next.resolve();
      return true;
    },
  };
}

class FakeChild extends EventEmitter implements ManagedChild {
  pid = 424242;
  readonly signals: string[] = [];
  private exited = false;
  private armed = false;
  constructor(private readonly mode: "hold" | "error" | "signal") {
    super();
  }
  /** Emit spawn after the host has attached listeners. Call from the spawn callback. */
  arm(): this {
    if (this.armed) return this;
    this.armed = true;
    queueMicrotask(() => {
      if (this.mode === "error") {
        this.emit("error", new Error("spawn failed"));
        return;
      }
      this.emit("spawn");
      if (this.mode === "signal") this.emit("exit", null, "SIGTERM");
    });
    return this;
  }
  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.signals.push(signal);
    if (signal === "SIGKILL") this.finish(null, "SIGKILL");
    return true;
  }
  finish(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.exited) return;
    this.exited = true;
    this.emit("exit", code, signal);
  }
}

function installProfile(): void {
  saveProfile(
    {
      version: 1,
      databasePath: join(tmpdir(), "ses001-unused.db"),
      url: "http://127.0.0.1:9414",
      humanId: "hum_owner",
      humanName: "Owner",
      agentId: "agt_codex",
      agentName: "Codex",
      harness: "codex",
      agents: [{ id: "agt_codex", name: "Codex", harness: "codex" }],
    },
    process.env,
  );
  saveCredentials({ humanToken: HUMAN, agentToken: AGENT, agents: { codex: AGENT } }, process.env);
}

function installCodex(root: string, version = "0.164.0"): string {
  const bin = join(root, "codex");
  copyFileSync(FIXTURE, bin);
  writeFileSync(join(root, "codex-version.txt"), `${version}\n`);
  chmodSync(bin, 0o755);
  return bin;
}

function dumpRegistry(): string {
  const root = registryDirectory(process.env);
  const parts: string[] = [];
  const walk = (directory: string): void => {
    let names: string[];
    try {
      names = readdirSync(directory);
    } catch {
      return;
    }
    for (const name of names) {
      const path = join(directory, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) {
        parts.push(`symlink:${name}`);
        continue;
      }
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile() && stat.size < 100_000) parts.push(readFileSync(path, "utf8"));
    }
  };
  walk(root);
  return parts.join("\n");
}

async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for session host");
}

describe("SES-001 session host", () => {
  const sockets: string[] = [];
  let logs: string[] = [];
  let errors: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.CAMPFIRE_SESSION_HOST;
    delete process.env.CODEX_CLI;
    delete process.env.CAMPFIRE_TOKEN;
    delete process.env.CAMPFIRE_BRIDGE_TOKEN;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    for (const socket of sockets.splice(0)) rmSync(socket, { recursive: true, force: true });
  });

  function enable(): void {
    process.env.CAMPFIRE_SESSION_HOST = "1";
  }

  function socketDir(): string {
    const path = join("/tmp", `s${process.pid.toString(36)}${sockets.length}`);
    sockets.push(path);
    return path;
  }

  function base(codex: string, core = createFakeCoreClient()) {
    return {
      core,
      codexExecutable: codex,
      readVersion: () => "codex-cli 0.164.0",
      campfireExecutable: "/usr/local/bin/campfire",
      socketDir: socketDir(),
      stdio: "ignore" as const,
    };
  }

  it("refuses the commands when the feature flag is unset", async () => {
    logs = [];
    errors = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
    const code = await runCliEntry(["session", "prepare", "--output", "json"]);
    expect(code).toBe(1);
    const failure = JSON.parse(errors.join("\n")) as { error: { message: string } };
    expect(failure.error.message).toContain("CAMPFIRE_SESSION_HOST=1");
    expect(failure.error.message).not.toContain(HUMAN);
  });

  it("returns a token-free prepare receipt, separately gates embedded, and rejects non-Codex launch", () => {
    enable();
    installProfile();
    const root = mkdtempSync(join(tmpdir(), "ses001-repo-"));
    const codex = installCodex(mkdtempSync(join(tmpdir(), "ses001-bin-")));
    const repo = join(root, "repo");
    mkdirSync(repo);
    const prepared = prepareSession(
      {
        workspaceId: "ws_lab",
        taskId: "task_one",
        agentId: "agt_codex",
        harness: "codex",
        repository: repo,
        launch: "external",
      },
      { ...base(codex), openExternal: () => undefined },
    );
    expect(Object.keys(prepared.receipt).sort()).toEqual([
      "agentId",
      "expiresAt",
      "harness",
      "launchId",
      "launchMode",
      "localLaunchState",
      "repositoryDisplayName",
      "taskId",
      "workspaceId",
    ]);
    expect(prepared.receipt.repositoryDisplayName).toBe("repo");
    expect(prepared.receipt.localLaunchState).toBe("prepared");
    const encoded = JSON.stringify(prepared.receipt);
    expect(encoded).not.toContain(repo);
    expect(encoded).not.toContain(HUMAN);
    expect(encoded).not.toContain(AGENT);
    expect(encoded).not.toContain("/");
    const recordStat = lstatSync(join(registryDirectory(process.env), `${prepared.receipt.launchId}.json`));
    const dirStat = lstatSync(registryDirectory(process.env));
    expect(recordStat.mode & 0o077).toBe(0);
    expect(recordStat.isSymbolicLink()).toBe(false);
    expect(dirStat.mode & 0o077).toBe(0);
    expect(dirStat.mode & 0o700).toBe(0o700);
    expect(dumpRegistry()).not.toContain(AGENT);
    expect(dumpRegistry()).not.toContain("Read Campfire task");
    expect(readdirSync(registryDirectory(process.env)).some((name) => name.includes(".tmp"))).toBe(false);

    expect(() =>
      prepareSession(
        { workspaceId: "ws_lab", taskId: "task_one", agentId: "agt_codex", harness: "codex", repository: repo, launch: "embedded" },
        base(codex),
      ),
    ).toThrow(EMBEDDED_UNAVAILABLE_MESSAGE);
    process.env.CAMPFIRE_EMBEDDED_TERMINAL = "1";
    const embedded = prepareSession(
      { workspaceId: "ws_lab", taskId: "task_one", agentId: "agt_codex", harness: "codex", repository: repo, launch: "embedded" },
      base(codex),
    );
    expect(embedded.receipt.launchMode).toBe("embedded");
    expect(embedded.copyCommand).toBeUndefined();
    expect(() =>
      prepareSession(
        { workspaceId: "ws_lab", taskId: "task_one", agentId: "agt_codex", harness: "claude-code", repository: repo, launch: "external" },
        base(codex),
      ),
    ).toThrow(CODEX_ONLY_MESSAGE);
    expect(() =>
      prepareSession(
        { workspaceId: "ws_lab", taskId: "task_one", agentId: "agt_codex", harness: "opencode", repository: repo, launch: "external" },
        base(codex),
      ),
    ).toThrow(/Codex only/);
  });

  it("requires an existing in-repository worktree and does not create one", () => {
    enable();
    installProfile();
    const repo = mkdtempSync(join(tmpdir(), "ses001-wt-"));
    const bin = mkdtempSync(join(tmpdir(), "ses001-bin-"));
    const codex = installCodex(bin);
    const missing = join(repo, "missing-worktree");
    expect(() =>
      prepareSession(
        {
          workspaceId: "ws_lab",
          taskId: "task_one",
          agentId: "agt_codex",
          harness: "codex",
          repository: repo,
          worktree: missing,
          launch: "copy-launch-command",
        },
        base(codex),
      ),
    ).toThrow(/does not create/);
    expect(lstatSync(repo).isDirectory()).toBe(true);
    let missingExists = true;
    try {
      lstatSync(missing);
    } catch {
      missingExists = false;
    }
    expect(missingExists).toBe(false);
    const outside = mkdtempSync(join(tmpdir(), "ses001-out-"));
    expect(() =>
      prepareSession(
        {
          workspaceId: "ws_lab",
          taskId: "task_one",
          agentId: "agt_codex",
          harness: "codex",
          repository: repo,
          worktree: outside,
          launch: "copy-launch-command",
        },
        base(codex),
      ),
    ).toThrow(/inside the repository/);
    expect(lstatSync(outside).isDirectory()).toBe(true);
  });

  it("prints only the absolute campfire command and launch id for copy-launch-command", async () => {
    enable();
    installProfile();
    const repo = mkdtempSync(join(tmpdir(), "ses001-copy-"));
    const bin = mkdtempSync(join(tmpdir(), "ses001-copy-bin-"));
    const codex = installCodex(bin);
    process.env.CODEX_CLI = codex;
    logs = [];
    errors = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
    const code = await runCliEntry([
      "session",
      "prepare",
      "--workspace",
      "ws_lab",
      "--task",
      "task_one",
      "--agent",
      "agt_codex",
      "--harness",
      "codex",
      "--repository",
      repo,
      "--launch",
      "copy-launch-command",
      "--output",
      "json",
    ]);
    expect(code).toBe(0);
    const line = logs.join("\n");
    expect(line).toMatch(/ session run lch_[a-f0-9]{32}$/);
    expect(line).not.toContain(repo);
    expect(line).not.toContain(AGENT);
    expect(line).not.toContain(HUMAN);
    expect(line).not.toContain(FINDING);
    expect(errors.join("\n")).not.toContain(AGENT);
  });

  it("opens Terminal.app with an argv array and keeps hostile paths out of the launcher", () => {
    enable();
    installProfile();
    const parent = mkdtempSync(join(tmpdir(), "ses001-hostile-"));
    const repo = join(parent, "evil; rm -rf /");
    mkdirSync(repo);
    const bin = mkdtempSync(join(tmpdir(), "ses001-hostile-bin-"));
    const codex = installCodex(bin);
    const opened: string[] = [];
    const prepared = prepareSession(
      {
        workspaceId: "ws_lab",
        taskId: "task_one",
        agentId: "agt_codex",
        harness: "codex",
        repository: repo,
        launch: "external",
      },
      { ...base(codex), openExternal: (path) => opened.push(path) },
    );
    expect(opened).toHaveLength(1);
    const launcher = opened[0]!;
    expect(terminalOpenArgv(launcher)).toEqual(["/usr/bin/open", launcher]);
    const body = readFileSync(launcher, "utf8");
    expect(body).toContain(prepared.receipt.launchId);
    expect(body).toContain("/usr/local/bin/campfire");
    expect(body).not.toContain(repo);
    expect(body).not.toContain("rm -rf");
    expect(body).not.toContain(AGENT);
    const calls: Array<{ command: string; args: readonly string[]; shell: false }> = [];
    if (process.platform === "darwin") {
      openTerminalLauncher(launcher, (command, args, options) => {
        calls.push({ command, args, shell: options.shell });
        return { status: 0 };
      });
      expect(calls).toEqual([{ command: "/usr/bin/open", args: [launcher], shell: false }]);
    }
    const requests: SpawnRequest[] = [];
    const core = createFakeCoreClient();
    const clock = clockAt();
    const child = new FakeChild("hold");
    const run = runSession(prepared.receipt.launchId, {
      ...base(codex, core),
      clock,
      spawn: (request) => {
        requests.push(request);
        return child.arm();
      },
    });
    return until(() => clock.pending() > 0).then(async () => {
      child.finish(0, null);
      while (clock.release()) undefined;
      await run;
      expect(requests).toHaveLength(1);
      const request = requests[0]!;
      expect(request.shell).toBe(false);
      expect(request.command).toBe(codex);
      expect(Array.isArray(request.args)).toBe(true);
      expect(request.args.join("\n")).not.toContain(repo);
      expect(request.args.join("\n")).toContain("ws_lab");
      expect(request.args.join("\n")).toContain("task_one");
      expect(request.args.join("\n")).not.toContain(FINDING);
      expect(request.args.join("\n")).not.toContain(AGENT);
      expect(request.cwd).toBe(realpathSync(repo));
      expect(request.env.CAMPFIRE_TOKEN).toBeUndefined();
      expect(request.env.CAMPFIRE_SESSION_ID).toMatch(/^ses_/);
      expect(dumpRegistry()).not.toContain(AGENT);
      expect(launcherPath(registryDirectory(process.env), prepared.receipt.launchId)).toBe(launcher);
      let launcherGone = false;
      try {
        lstatSync(launcher);
      } catch {
        launcherGone = true;
      }
      expect(launcherGone).toBe(true);
    });
  });

  it("locks a launch, registers before spawn, heartbeats on the injected clock, and normalizes exit", async () => {
    enable();
    installProfile();
    const repo = mkdtempSync(join(tmpdir(), "ses001-run-"));
    const bin = mkdtempSync(join(tmpdir(), "ses001-run-bin-"));
    const codex = installCodex(bin);
    const core = createFakeCoreClient();
    const order: string[] = [];
    const register = core.registerAgentSession.bind(core);
    core.registerAgentSession = async (ctx, input) => {
      order.push("register");
      return register(ctx, input);
    };
    const prepared = prepareSession(
      { workspaceId: "ws_lab", taskId: "task_one", agentId: "agt_codex", harness: "codex", repository: repo, launch: "copy-launch-command" },
      base(codex, core),
    );
    const clock = clockAt();
    const child = new FakeChild("hold");
    const first = runSession(prepared.receipt.launchId, {
      ...base(codex, core),
      clock,
      spawn: (request) => {
        order.push("spawn");
        expect(request.shell).toBe(false);
        return child.arm();
      },
    });
    await until(() => clock.pending() > 0);
    await expect(runSession(prepared.receipt.launchId, { ...base(codex, core), clock, spawn: () => child.arm() })).rejects.toThrow(/already running/);
    expect(order.indexOf("register")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("register")).toBeLessThan(order.indexOf("spawn"));
    clock.release();
    await until(() => core.calls.filter((call) => call.method === "report" && (call.input as { state?: string }).state === "running").length >= 1);
    clock.release();
    await until(() => core.calls.filter((call) => call.method === "report" && (call.input as { state?: string }).state === "running").length >= 2);
    expect(clock.waits.every((wait) => wait === 15_000)).toBe(true);
    expect(clock.waits.length).toBeGreaterThanOrEqual(2);
    child.finish(0, null);
    const result = await first;
    while (clock.release()) undefined;
    expect(result.localState).toBe("exited");
    expect(result.exitCode).toBe(0);
    const reports = core.calls.filter((call) => call.method === "report" && !("rejected" in (call.input as object)));
    const sequences = reports.map((call) => (call.input as { sequence: number }).sequence);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
    expect(new Set(sequences).size).toBe(sequences.length);
    expect(core.calls.some((call) => call.method === "end")).toBe(true);
    expect(core.calls[0]?.method).toBe("register");
  });

  it("does not backfill heartbeats after a failed report", async () => {
    enable();
    installProfile();
    const repo = mkdtempSync(join(tmpdir(), "ses001-offline-"));
    const bin = mkdtempSync(join(tmpdir(), "ses001-offline-bin-"));
    const codex = installCodex(bin);
    const core = createFakeCoreClient();
    core.failNextReports = 1;
    const prepared = prepareSession(
      { workspaceId: "ws_lab", taskId: "task_one", agentId: "agt_codex", harness: "codex", repository: repo, launch: "copy-launch-command" },
      base(codex, core),
    );
    const clock = clockAt();
    const child = new FakeChild("hold");
    const run = runSession(prepared.receipt.launchId, {
      ...base(codex, core),
      clock,
      spawn: () => child.arm(),
    });
    await until(() => clock.pending() > 0);
    const rejected = core.calls.filter((call) => call.method === "report" && "rejected" in (call.input as object));
    expect(rejected).toHaveLength(1);
    clock.release();
    await until(() => core.calls.some((call) => call.method === "report" && (call.input as { state?: string }).state === "running"));
    child.finish(2, null);
    const result = await run;
    while (clock.release()) undefined;
    expect(result.localState).toBe("failed");
    expect(result.failureKind).toBe("nonzero_exit");
    expect(result.exitCode).toBe(2);
    const accepted = core.calls.filter((call) => call.method === "report" && !("rejected" in (call.input as object)));
    expect(accepted.map((call) => (call.input as { state: string }).state)).toEqual(["running", "failed"]);
  });

  it("normalizes a signal exit without copying terminal bytes", async () => {
    enable();
    installProfile();
    const repo = mkdtempSync(join(tmpdir(), "ses001-signal-"));
    const bin = mkdtempSync(join(tmpdir(), "ses001-signal-bin-"));
    const codex = installCodex(bin);
    const core = createFakeCoreClient();
    const prepared = prepareSession(
      { workspaceId: "ws_lab", taskId: "task_one", agentId: "agt_codex", harness: "codex", repository: repo, launch: "copy-launch-command" },
      base(codex, core),
    );
    const result = await runSession(prepared.receipt.launchId, {
      ...base(codex, core),
      spawn: () => new FakeChild("signal").arm(),
    });
    expect(result.failureKind).toBe("signal");
    expect(result.localState).toBe("failed");
    expect(dumpRegistry()).not.toContain(FINDING);
  });

  it("retries one rate-limited runtime report after the Core interval", async () => {
    enable();
    installProfile();
    const repo = mkdtempSync(join(tmpdir(), "ses001-rate-"));
    const bin = mkdtempSync(join(tmpdir(), "ses001-rate-bin-"));
    const codex = installCodex(bin);
    const core = createFakeCoreClient();
    const report = core.reportAgentSessionRuntime.bind(core);
    let limited = false;
    core.reportAgentSessionRuntime = async (ctx, input) => {
      if (!limited && input.state === "failed") {
        limited = true;
        throw new ValidationError("Session runtime reports are limited to one every 5 seconds", { field: "sequence" });
      }
      return report(ctx, input);
    };
    const prepared = prepareSession(
      { workspaceId: "ws_lab", taskId: "task_one", agentId: "agt_codex", harness: "codex", repository: repo, launch: "copy-launch-command" },
      base(codex, core),
    );
    const clock = clockAt();
    const run = runSession(prepared.receipt.launchId, {
      ...base(codex, core),
      clock,
      spawn: () => new FakeChild("signal").arm(),
    });
    await until(() => clock.pending() > 0);
    expect(clock.waits).toContain(5_000);
    clock.release();
    const result = await run;
    while (clock.release()) undefined;
    expect(result.failureKind).toBe("signal");
    const accepted = core.calls.filter((call) => call.method === "report" && !("rejected" in (call.input as object)));
    expect(accepted.map((call) => (call.input as { state: string }).state)).toEqual(["starting", "failed"]);
  });

  it("ends the session and records spawn_failed when the child cannot start", async () => {
    enable();
    installProfile();
    const repo = mkdtempSync(join(tmpdir(), "ses001-spawn-"));
    const bin = mkdtempSync(join(tmpdir(), "ses001-spawn-bin-"));
    const codex = installCodex(bin);
    const core = createFakeCoreClient();
    const order: string[] = [];
    const register = core.registerAgentSession.bind(core);
    core.registerAgentSession = async (ctx, input) => {
      order.push("register");
      return register(ctx, input);
    };
    const prepared = prepareSession(
      { workspaceId: "ws_lab", taskId: "task_one", agentId: "agt_codex", harness: "codex", repository: repo, launch: "copy-launch-command" },
      base(codex, core),
    );
    const result = await runSession(prepared.receipt.launchId, {
      ...base(codex, core),
      spawn: () => {
        order.push("spawn");
        return new FakeChild("error").arm();
      },
    });
    expect(result.failureKind).toBe("spawn_failed");
    expect(order).toEqual(["register", "spawn"]);
    expect(core.calls.some((call) => call.method === "end")).toBe(true);
    expect(readLaunchRecord(process.env, prepared.receipt.launchId).failureKind).toBe("spawn_failed");
    expect(dumpRegistry()).not.toContain(AGENT);
  });

  it("rejects a bad control-socket marker and stops only through the authenticated socket", async () => {
    enable();
    installProfile();
    const repo = mkdtempSync(join(tmpdir(), "ses001-stop-"));
    const bin = mkdtempSync(join(tmpdir(), "ses001-stop-bin-"));
    const codex = installCodex(bin);
    const core = createFakeCoreClient();
    const prepared = prepareSession(
      { workspaceId: "ws_lab", taskId: "task_one", agentId: "agt_codex", harness: "codex", repository: repo, launch: "copy-launch-command" },
      base(codex, core),
    );
    const clock = clockAt();
    const child = new FakeChild("hold");
    let runResult: RunResult | undefined;
    const run = runSession(prepared.receipt.launchId, {
      ...base(codex, core),
      clock,
      graceMs: 5,
      spawn: () => child.arm(),
    }).then((result) => {
      runResult = result;
    });
    await until(() => clock.pending() > 0 && readLaunchRecord(process.env, prepared.receipt.launchId).privateControlSocket !== undefined);
    const record = readLaunchRecord(process.env, prepared.receipt.launchId);
    const denied = await sendControl(record.privateControlSocket!, {
      op: "stop",
      launchId: record.launchId,
      marker: "not-the-marker",
    });
    expect(denied.ok).toBe(false);
    expect(child.signals).toEqual([]);
    const stopped = await stopSession(prepared.receipt.launchId, { env: process.env });
    expect(stopped.stopped).toBe(true);
    expect(stopped.control).toBe("ok");
    await until(() => child.signals.includes("SIGTERM"));
    child.finish(0, null);
    while (clock.release()) undefined;
    await run;
    expect(runResult?.localState).toBe("exited");
    expect(child.signals).not.toContain("SIGKILL");
  });

  it("refuses to signal a live pid when the control socket does not identify the wrapper", async () => {
    enable();
    installProfile();
    const repo = mkdtempSync(join(tmpdir(), "ses001-reuse-"));
    const worktree = join(repo, "tree");
    mkdirSync(worktree);
    const record = {
      version: 1 as const,
      launchId: "lch_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      workspaceId: "ws_lab",
      taskId: "task_one",
      agentId: "agt_codex",
      humanId: "hum_owner",
      harness: "codex" as const,
      repositoryRoot: repo,
      worktreePath: worktree,
      launchMode: "external" as const,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      localState: "running" as const,
      wrapperPid: process.pid,
      wrapperStartMarker: "marker",
      privateControlSocket: "/tmp/ses001-no-such-socket.sock",
      coreSessionId: "ses_reusedpid000001",
    };
    writeLaunchRecord(process.env, record);
    const core = createFakeCoreClient();
    const result = await reconcileSessions({ env: process.env, core, codexExecutable: "/no/such/codex" });
    expect(result.pidReuseRefused).toContain(record.launchId);
    expect(result.controlLost).toContain(record.launchId);
    expect(lstatSync(worktree).isDirectory()).toBe(true);
    expect(core.calls.some((call) => call.method === "end")).toBe(false);
    expect(JSON.stringify(result)).not.toContain(repo);
  });

  it("cleans expired and final records without deleting the checkout", async () => {
    enable();
    installProfile();
    const repo = mkdtempSync(join(tmpdir(), "ses001-clean-"));
    const worktree = join(repo, "tree");
    mkdirSync(worktree);
    const bin = mkdtempSync(join(tmpdir(), "ses001-clean-bin-"));
    const codex = installCodex(bin);
    const clock = clockAt();
    const prepared = prepareSession(
      {
        workspaceId: "ws_lab",
        taskId: "task_one",
        agentId: "agt_codex",
        harness: "codex",
        repository: repo,
        worktree,
        launch: "copy-launch-command",
      },
      { ...base(codex), clock },
    );
    clock.set(clock.now() + 2 * 60 * 60 * 1000);
    const expired = await reconcileSessions({ ...base(codex), clock });
    expect(expired.expiredRemoved).toContain(prepared.receipt.launchId);
    expect(lstatSync(worktree).isDirectory()).toBe(true);
    let recordGone = false;
    try {
      readLaunchRecord(process.env, prepared.receipt.launchId);
    } catch {
      recordGone = true;
    }
    expect(recordGone).toBe(true);
  });

  it("reports a missing executable, corrupt records, insecure modes, and symlink refusal", async () => {
    enable();
    installProfile();
    const repo = mkdtempSync(join(tmpdir(), "ses001-reg-"));
    const bin = mkdtempSync(join(tmpdir(), "ses001-reg-bin-"));
    const codex = installCodex(bin);
    const clock = clockAt();
    const prepared = prepareSession(
      { workspaceId: "ws_lab", taskId: "task_one", agentId: "agt_codex", harness: "codex", repository: repo, launch: "copy-launch-command" },
      { ...base(codex), clock },
    );
    const root = registryDirectory(process.env);
    const corruptId = "lch_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    writeFileSync(join(root, `${corruptId}.json`), "{", { mode: 0o600 });
    chmodSync(join(root, `${corruptId}.json`), 0o600);
    const insecureId = "lch_cccccccccccccccccccccccccccccccc";
    writeFileSync(join(root, `${insecureId}.json`), JSON.stringify({ secret: AGENT }), { mode: 0o644 });
    chmodSync(join(root, `${insecureId}.json`), 0o644);
    const linkId = "lch_dddddddddddddddddddddddddddddddd";
    const secretFile = join(repo, "secret.txt");
    writeFileSync(secretFile, AGENT);
    symlinkSync(secretFile, join(root, `${linkId}.json`));
    const result = await reconcileSessions({
      env: process.env,
      clock,
      codexExecutable: join(repo, "missing-codex"),
    });
    expect(result.missingExecutable).toContain(prepared.receipt.launchId);
    expect(result.corrupt).toContain(corruptId);
    expect(result.insecure).toContain(insecureId);
    expect(result.symlinkRefused).toContain(linkId);
    expect(JSON.stringify(result)).not.toContain(AGENT);
    expect(lstatSync(repo).isDirectory()).toBe(true);
  });

  it("refuses a symlinked registry directory without reading its target", () => {
    enable();
    installProfile();
    const data = process.env.CAMPFIRE_DATA_DIR;
    expect(data).toBeTruthy();
    const target = mkdtempSync(join(tmpdir(), "ses001-link-target-"));
    writeFileSync(join(target, "secret.txt"), AGENT);
    mkdirSync(data!, { recursive: true });
    symlinkSync(target, join(data!, "session-host"));
    const repo = mkdtempSync(join(tmpdir(), "ses001-link-repo-"));
    const bin = mkdtempSync(join(tmpdir(), "ses001-link-bin-"));
    expect(() =>
      prepareSession(
        { workspaceId: "ws_lab", taskId: "task_one", agentId: "agt_codex", harness: "codex", repository: repo, launch: "copy-launch-command" },
        base(installCodex(bin)),
      ),
    ).toThrow(/symlink/);
    expect(readFileSync(join(target, "secret.txt"), "utf8")).toBe(AGENT);
  });

  it("fails an unsupported Codex version with one actionable message", () => {
    enable();
    installProfile();
    const repo = mkdtempSync(join(tmpdir(), "ses001-ver-"));
    const bin = mkdtempSync(join(tmpdir(), "ses001-ver-bin-"));
    const codex = installCodex(bin, "9.9.9");
    expect(() =>
      prepareSession(
        { workspaceId: "ws_lab", taskId: "task_one", agentId: "agt_codex", harness: "codex", repository: repo, launch: "copy-launch-command" },
        { ...base(codex), readVersion: () => "codex-cli 9.9.9" },
      ),
    ).toThrow(/Codex CLI 0\.164\.0 is required[\s\S]*9\.9\.9/);
  });

  it("runs the fixture harness without putting secrets in argv, env, registry, or output", async () => {
    enable();
    installProfile();
    process.env.CAMPFIRE_TOKEN = HUMAN;
    process.env.CAMPFIRE_BRIDGE_TOKEN = AGENT;
    process.env.AWS_SECRET_ACCESS_KEY = AWS;
    const repo = mkdtempSync(join(tmpdir(), "ses001-fixture-"));
    const bin = mkdtempSync(join(tmpdir(), "ses001-fixture-bin-"));
    const codex = installCodex(bin);
    const core = createFakeCoreClient();
    const prepared = prepareSession(
      { workspaceId: "ws_lab", taskId: "task_one", agentId: "agt_codex", harness: "codex", repository: repo, launch: "copy-launch-command" },
      { ...base(codex, core), readVersion: undefined, campfireExecutable: "/usr/local/bin/campfire" },
    );
    let child: ReturnType<typeof spawn> | undefined;
    const running = runSession(prepared.receipt.launchId, {
      ...base(codex, core),
      readVersion: undefined,
      stdio: "ignore",
      spawn: (request) => {
        child = spawn(request.command, [...request.args], {
          cwd: request.cwd,
          env: request.env,
          shell: false,
          stdio: "ignore",
        });
        return child;
      },
    });
    const capturePath = join(repo, "ses001-capture.json");
    const started = Date.now();
    while (!existsSync(capturePath)) {
      if (Date.now() - started > 5_000) throw new Error("fixture harness did not write a capture file");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    child?.kill("SIGTERM");
    const result = await running;
    expect(result.failureKind === "signal" || result.localState === "exited").toBe(true);
    const capture = JSON.parse(readFileSync(join(repo, "ses001-capture.json"), "utf8")) as {
      argv: string[];
      env: Record<string, string | null>;
    };
    const argv = capture.argv.join("\n");
    expect(argv).toContain("ws_lab");
    expect(argv).toContain("task_one");
    expect(argv).not.toContain(FINDING);
    expect(argv).not.toContain(AGENT);
    expect(argv).not.toContain(HUMAN);
    expect(argv).not.toContain(" -c ");
    expect(argv).not.toContain("/bin/sh");
    expect(capture.env.CAMPFIRE_SESSION_ID).toBe(result.coreSessionId);
    expect(capture.env.CAMPFIRE_TOKEN).toBeNull();
    expect(capture.env.CAMPFIRE_BRIDGE_TOKEN).toBeNull();
    expect(capture.env.AWS_SECRET_ACCESS_KEY).toBeNull();
    const registry = dumpRegistry();
    expect(registry).not.toContain(AGENT);
    expect(registry).not.toContain(HUMAN);
    expect(registry).not.toContain(AWS);
    expect(registry).not.toContain("Read Campfire task");
    expect(registry).not.toContain(FINDING);
  });

  it("reports a lost socket without killing an arbitrary pid", async () => {
    enable();
    installProfile();
    const repo = mkdtempSync(join(tmpdir(), "ses001-lost-"));
    const bin = mkdtempSync(join(tmpdir(), "ses001-lost-bin-"));
    const codex = installCodex(bin);
    const prepared = prepareSession(
      { workspaceId: "ws_lab", taskId: "task_one", agentId: "agt_codex", harness: "codex", repository: repo, launch: "copy-launch-command" },
      base(codex),
    );
    const result = await stopSession(prepared.receipt.launchId);
    expect(result.control).toBe("lost");
    expect(result.reconcileRequired).toBe(true);
    expect(result.stopped).toBe(false);
  });

  it("throws a clear error when Core has no runtime report method", () => {
    expect(() =>
      createServiceCoreClient(
        {
          registerAgentSession() {
            return undefined;
          },
          endAgentSession() {
            return undefined;
          },
          listAgentSessions() {
            return undefined;
          },
        },
        {
          agent: { actor: { actorId: "agt_codex", actorType: "agent" } },
          reader: { actor: { actorId: "hum_owner", actorType: "human" } },
        },
      ),
    ).toThrow(RUNTIME_REPORT_MISSING_MESSAGE);
  });

  it("calls service and HTTP methods with taskId and without the credential in params", async () => {
    let seen: { taskId?: string } | undefined;
    const client = createServiceCoreClient(
      {
        registerAgentSession(_ctx: unknown, input: { taskId?: string }) {
          seen = input;
          return { id: "ses_service", agentId: "agt_codex", workspaceId: "ws_lab", taskId: input.taskId, harness: "codex", startedAt: "t" };
        },
        reportAgentSessionRuntime() {
          return { sessionId: "ses_service", state: "running", sequence: 1, reportedAt: "t" };
        },
        endAgentSession() {
          return undefined;
        },
        listAgentSessions() {
          return { sessions: [], serverTime: "t" };
        },
      },
      {
        agent: { actor: { actorId: "agt_codex", actorType: "agent" } },
        reader: { actor: { actorId: "hum_owner", actorType: "human" } },
        secrets: [AGENT],
      },
    );
    await client.registerAgentSession(
      { actor: { actorId: "agt_codex", actorType: "agent" } },
      { agentId: "agt_codex", workspaceId: "ws_lab", harness: "codex", taskId: "task_one" },
    );
    expect(seen?.taskId).toBe("task_one");
    const httpCalls: Array<{ method: string; token: string; params?: Record<string, unknown> }> = [];
    const http = createHttpCoreClient({
      baseUrl: "http://127.0.0.1:9",
      agentToken: AGENT,
      humanToken: HUMAN,
      call: async (request) => {
        httpCalls.push(request);
        if (request.method === HTTP_METHODS.list) return { sessions: [], serverTime: "t" };
        if (request.method === HTTP_METHODS.register) {
          return { id: "ses_http", agentId: "agt_codex", workspaceId: "ws_lab", harness: "codex", startedAt: "t", taskId: "task_one" };
        }
        return { sessionId: "ses_http", state: "running", sequence: 1, reportedAt: "t" };
      },
    });
    await http.registerAgentSession(
      { actor: { actorId: "agt_codex", actorType: "agent" } },
      { agentId: "agt_codex", workspaceId: "ws_lab", harness: "codex", taskId: "task_one" },
    );
    await http.listAgentSessions({ actor: { actorId: "hum_owner", actorType: "human" } }, { workspaceId: "ws_lab" });
    expect(httpCalls.map((call) => call.method)).toEqual([HTTP_METHODS.register, HTTP_METHODS.list]);
    expect(JSON.stringify(httpCalls[0]?.params)).not.toContain(AGENT);
    expect(httpCalls[0]?.params?.taskId).toBe("task_one");
    expect(httpCalls[1]?.token).toBe(HUMAN);
  });
});
