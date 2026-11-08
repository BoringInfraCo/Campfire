/**
 * Bare `campfire` on an interactive terminal opens the read-only console.
 * Scripts and JSON keep the status card. The dashboard frame stays mocked so
 * this test does not bind a port or enter raw mode.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as localWorkspace from "../../src/bootstrap/local-workspace.js";
import { beginHuman } from "../../src/bootstrap/listen.js";
import { loadProfile, persistHumanProfile, saveCredentials, saveProfile } from "../../src/bootstrap/profile.js";
import { persistRemoteProfile } from "../../src/bootstrap/remote-profile.js";
import * as dashboard from "../../src/cli/dashboard.js";
import { runCliEntry } from "../../src/cli/index.js";
import { createRuntimeFromPath } from "../../src/runtime.js";

function setTty(stream: NodeJS.ReadStream | NodeJS.WriteStream, value: boolean | undefined): void {
  if (value === undefined) {
    delete (stream as { isTTY?: boolean }).isTTY;
    return;
  }
  Object.defineProperty(stream, "isTTY", { value, configurable: true });
}

describe("bare campfire human shell", () => {
  let root: string;
  let dbPath: string;
  let output: string[];
  let errors: string[];
  let previousStdin: boolean | undefined;
  let previousStdout: boolean | undefined;
  let previousStderr: boolean | undefined;
  let listenerClosed: boolean;

  afterEach(() => {
    setTty(process.stdin, previousStdin);
    setTty(process.stdout, previousStdout);
    setTty(process.stderr, previousStderr);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    rmSync(root, { recursive: true, force: true });
  });

  function prepare(): void {
    previousStdin = process.stdin.isTTY;
    previousStdout = process.stdout.isTTY;
    previousStderr = process.stderr.isTTY;
    root = mkdtempSync(join(tmpdir(), "campfire-human-shell-"));
    dbPath = join(root, "campfire.db");
    output = [];
    errors = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      output.push(args.map(String).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
    listenerClosed = false;
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("connect ECONNREFUSED");
    }));
    vi.spyOn(localWorkspace, "startLocalWorkspace").mockResolvedValue({
      apiUrl: "http://127.0.0.1:9414",
      viewerUrl: "http://127.0.0.1:9415",
      close: async () => {
        listenerClosed = true;
      },
    });
    vi.spyOn(localWorkspace, "openLoopbackUrl").mockImplementation(() => {});
    vi.spyOn(dashboard, "runDashboardSession").mockResolvedValue(undefined);
  }

  function localProfileWithWorkspace(): { token: string; workspaceId: string; humanId: string } {
    const runtime = createRuntimeFromPath(dbPath);
    const started = beginHuman(runtime.store, runtime.service, runtime.config, "Ada");
    persistHumanProfile({
      databasePath: dbPath,
      humanId: started.humanId,
      humanName: started.humanName,
      humanToken: started.token,
    });
    const workspace = runtime.service.createWorkspace(
      { actor: { actorId: started.humanId, actorType: "human" } },
      { teamId: started.teamId, name: "billing deploy" },
    );
    const profile = loadProfile();
    if (profile === undefined) throw new Error("profile missing");
    saveProfile({ ...profile, workspaceId: workspace.id, workspaceName: workspace.name });
    runtime.close();
    return { token: started.token, workspaceId: workspace.id, humanId: started.humanId };
  }

  it("does not print an authorization trace and opens the console when there is no workspace", async () => {
    prepare();
    const runtime = createRuntimeFromPath(dbPath);
    const started = beginHuman(runtime.store, runtime.service, runtime.config, "Ada");
    persistHumanProfile({
      databasePath: dbPath,
      humanId: started.humanId,
      humanName: started.humanName,
      humanToken: started.token,
    });
    runtime.close();
    setTty(process.stdin, true);
    setTty(process.stdout, true);
    setTty(process.stderr, true);
    const traces: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk): boolean => {
      traces.push(String(chunk));
      return true;
    });

    expect(await runCliEntry([])).toBe(0);

    expect(traces.join("")).not.toContain('"event":"authz"');
    expect(`${output.join("\n")}\n${errors.join("\n")}`).not.toContain("EADDRINUSE");
    expect(dashboard.runDashboardSession).toHaveBeenCalledTimes(1);
    expect(vi.mocked(dashboard.runDashboardSession).mock.calls[0]?.[0]).toMatchObject({
      awaitingWorkspace: true,
      workspaceId: "",
    });
  });

  it("reports a mismatched local credential without opening the console or changing the database", async () => {
    prepare();
    localProfileWithWorkspace();
    saveCredentials({ humanToken: "cft_not_in_this_database_0000000000000000" });
    setTty(process.stdin, true);
    setTty(process.stdout, true);

    expect(await runCliEntry([])).toBe(1);

    expect(errors.join("\n")).toContain("does not match this installation's database");
    expect(errors.join("\n")).not.toContain("Invalid or revoked token");
    expect(localWorkspace.startLocalWorkspace).not.toHaveBeenCalled();
    expect(dashboard.runDashboardSession).not.toHaveBeenCalled();
  });

  it("opens the dashboard for a TTY local profile with a workspace and does not print the status card", async () => {
    prepare();
    const { token, workspaceId, humanId } = localProfileWithWorkspace();
    setTty(process.stdin, true);
    setTty(process.stdout, true);

    expect(await runCliEntry(["--db", dbPath])).toBe(0);

    expect(dashboard.runDashboardSession).toHaveBeenCalledTimes(1);
    expect(vi.mocked(dashboard.runDashboardSession).mock.calls[0]?.[0]).toMatchObject({
      workspaceId,
      actorId: humanId,
      actorType: "human",
    });
    expect(localWorkspace.startLocalWorkspace).toHaveBeenCalledTimes(1);
    expect(localWorkspace.openLoopbackUrl).not.toHaveBeenCalled();
    expect(listenerClosed).toBe(true);
    const calls: Array<{ url: string; authorization: string | null; body: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input, init) => {
      calls.push({
        url: String(input),
        authorization: new Headers(init?.headers).get("authorization"),
        body: JSON.parse(String(init?.body ?? "")),
      });
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
    }));
    await vi.mocked(dashboard.runDashboardSession).mock.calls[0]?.[0]?.load();
    expect(calls).toEqual([
      {
        url: "http://127.0.0.1:9414/v1/call",
        authorization: `Bearer ${token}`,
        body: { method: "get_workspace_context", params: { workspaceId, participants: "omit" } },
      },
    ]);
    const text = `${output.join("\n")}\n${errors.join("\n")}`;
    expect(text).not.toContain("Saved local profile");
    expect(text).not.toContain("open the Viewer and prepare your harness's tools");
    expect(text).not.toContain("Campfire is running");
    expect(text).not.toContain(token);
  });

  it("does not start the dashboard for non-TTY or JSON bare campfire", async () => {
    prepare();
    const { token, workspaceId } = localProfileWithWorkspace();
    setTty(process.stdin, false);
    setTty(process.stdout, false);

    expect(await runCliEntry(["--db", dbPath])).toBe(0);
    expect(dashboard.runDashboardSession).not.toHaveBeenCalled();
    expect(localWorkspace.startLocalWorkspace).not.toHaveBeenCalled();
    expect(localWorkspace.openLoopbackUrl).not.toHaveBeenCalled();
    const text = output.join("\n");
    expect(text).toContain("Saved local profile — not live service or agent status.");
    expect(text).toContain("open Campfire and prepare your harness's tools");
    expect(text).not.toContain(token);

    output.length = 0;
    errors.length = 0;
    vi.mocked(dashboard.runDashboardSession).mockClear();
    vi.mocked(localWorkspace.startLocalWorkspace).mockClear();
    expect(await runCliEntry(["--db", dbPath, "--output", "json"])).toBe(0);
    expect(dashboard.runDashboardSession).not.toHaveBeenCalled();
    expect(localWorkspace.startLocalWorkspace).not.toHaveBeenCalled();
    const body = JSON.parse(output.at(-1)!) as { workspaceId: string; human: string };
    expect(body).toMatchObject({ human: "Ada", workspace: "billing deploy", workspaceId });
    expect(JSON.stringify(body)).not.toContain(token);

    output.length = 0;
    errors.length = 0;
    vi.mocked(dashboard.runDashboardSession).mockClear();
    vi.mocked(localWorkspace.startLocalWorkspace).mockClear();
    setTty(process.stdin, true);
    setTty(process.stdout, true);
    vi.stubEnv("CAMPFIRE_NONINTERACTIVE", "1");
    expect(await runCliEntry(["--db", dbPath])).toBe(0);
    expect(dashboard.runDashboardSession).not.toHaveBeenCalled();
    expect(localWorkspace.startLocalWorkspace).not.toHaveBeenCalled();
    expect(output.join("\n")).toContain("Saved local profile — not live service or agent status.");
    expect(output.join("\n")).not.toContain(token);
    vi.unstubAllEnvs();
  });

  it("opens a remote profile in the dashboard without a local listener", async () => {
    prepare();
    persistRemoteProfile({
      url: "https://shared.example.test/team-a",
      humanId: "hum_alice",
      humanName: "Alice",
      workspaceId: "ws_existing",
      workspaceName: "Old receipt name",
      humanToken: "human-secret-sentinel",
      agents: [{ id: "agt_alice_codex", name: "Alice Codex", harness: "codex", token: "codex-secret-sentinel" }],
    });
    setTty(process.stdin, true);
    setTty(process.stdout, true);

    expect(await runCliEntry([])).toBe(0);

    expect(dashboard.runDashboardSession).toHaveBeenCalledTimes(1);
    expect(vi.mocked(dashboard.runDashboardSession).mock.calls[0]?.[0]).toMatchObject({
      workspaceId: "ws_existing",
      actorId: "hum_alice",
      actorType: "human",
    });
    expect(localWorkspace.startLocalWorkspace).not.toHaveBeenCalled();
    expect(localWorkspace.openLoopbackUrl).not.toHaveBeenCalled();
    const text = `${output.join("\n")}\n${errors.join("\n")}`;
    expect(text).not.toContain("open the shared workspace journal");
    expect(text).not.toContain("human-secret-sentinel");
    expect(text).not.toContain("codex-secret-sentinel");
  });

  it("attaches to a Campfire that is already listening and does not stop it on quit", async () => {
    prepare();
    const { workspaceId, humanId } = localProfileWithWorkspace();
    setTty(process.stdin, true);
    setTty(process.stdout, true);
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify({ version: "1.29.3" }), { status: 200 });
      }
      return new Response("no", { status: 404 });
    }));

    expect(await runCliEntry(["--db", dbPath])).toBe(0);

    expect(localWorkspace.startLocalWorkspace).not.toHaveBeenCalled();
    expect(listenerClosed).toBe(false);
    expect(dashboard.runDashboardSession).toHaveBeenCalledTimes(1);
    expect(vi.mocked(dashboard.runDashboardSession).mock.calls[0]?.[0]).toMatchObject({
      workspaceId,
      actorId: humanId,
      actorType: "human",
    });
    expect(`${output.join("\n")}\n${errors.join("\n")}`).not.toContain("EADDRINUSE");
  });

  it("moves an unpinned busy port to an ephemeral bind without printing the Node listen error", async () => {
    prepare();
    localProfileWithWorkspace();
    setTty(process.stdin, true);
    setTty(process.stdout, true);
    vi.mocked(localWorkspace.startLocalWorkspace).mockImplementation(async (options) => {
      if (options.httpPort === 9414) {
        const error = new Error("listen EADDRINUSE: address already in use 127.0.0.1:9414") as NodeJS.ErrnoException;
        error.code = "EADDRINUSE";
        throw error;
      }
      return {
        apiUrl: "http://127.0.0.1:9",
        viewerUrl: "http://127.0.0.1:10",
        close: async () => {
          listenerClosed = true;
        },
      };
    });

    expect(await runCliEntry(["--db", dbPath])).toBe(0);

    expect(localWorkspace.startLocalWorkspace).toHaveBeenCalledTimes(2);
    expect(vi.mocked(localWorkspace.startLocalWorkspace).mock.calls[1]?.[0]).toMatchObject({
      httpPort: 0,
      viewerPort: 0,
    });
    expect(dashboard.runDashboardSession).toHaveBeenCalledTimes(1);
    expect(`${output.join("\n")}\n${errors.join("\n")}`).not.toContain("EADDRINUSE");
    expect(listenerClosed).toBe(true);
  });

  it("names a pinned busy port without the raw Node listen error", async () => {
    prepare();
    localProfileWithWorkspace();
    setTty(process.stdin, true);
    setTty(process.stdout, true);
    vi.mocked(localWorkspace.startLocalWorkspace).mockImplementation(async () => {
      const error = new Error("listen EADDRINUSE: address already in use 127.0.0.1:9414") as NodeJS.ErrnoException;
      error.code = "EADDRINUSE";
      throw error;
    });

    expect(await runCliEntry(["--db", dbPath, "--port", "9414"])).toBe(1);

    expect(localWorkspace.startLocalWorkspace).toHaveBeenCalledTimes(1);
    expect(dashboard.runDashboardSession).not.toHaveBeenCalled();
    const text = errors.join("\n");
    expect(text).toContain("Another process is using that address");
    expect(text).toContain("127.0.0.1:9414");
    expect(text).not.toContain("EADDRINUSE");
  });
});
