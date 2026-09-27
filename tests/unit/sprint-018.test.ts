import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { SESSION_INSTRUCTIONS } from "../../src/mcp/instructions.js";
import {
  ensureLocalListener,
  isCampfireCliEntry,
  type ListenerSpawn,
} from "../../src/mcp/listener.js";
import { resolveRemoteStartup } from "../../src/mcp/stdio.js";
import { createCampfireMcpServer } from "../../src/mcp/tools.js";

const CLI = "/opt/campfire/dist/src/cli/index.js";

function callText(result: unknown): { isError: boolean; json: { message?: string } } {
  const record = result as { isError?: boolean; content?: Array<{ type: string; text?: string }> };
  const text = record.content?.find((part) => part.type === "text")?.text;
  return { isError: record.isError === true, json: text === undefined ? {} : JSON.parse(text) };
}

describe("Sprint 018 session entry", () => {
  const dirs: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("reuses a listener that is already accepting", async () => {
    const spawnUp = vi.fn();
    const result = await ensureLocalListener({
      url: "http://127.0.0.1:9414",
      cliEntry: CLI,
      probe: async () => true,
      spawnUp,
    });
    expect(result).toEqual({ ready: true, started: false });
    expect(spawnUp).not.toHaveBeenCalled();
  });

  it("starts one detached campfire up and keeps the agent token out of that process", async () => {
    const dir = mkdtempSync(join(tmpdir(), "campfire-018-"));
    dirs.push(dir);
    let up = false;
    const spawnUp = vi.fn((spawned: ListenerSpawn) => {
      up = true;
      expect(spawned.command).toBe("/usr/bin/node");
      expect(spawned.args).toEqual([
        "--import",
        "tsx",
        CLI,
        "up",
        "--no-open",
        "--no-connect",
        "--host",
        "127.0.0.1",
        "--port",
        "9414",
      ]);
      expect(spawned.env.CAMPFIRE_TOKEN).toBeUndefined();
      expect(spawned.env.CAMPFIRE_SESSION_ID).toBeUndefined();
      expect(spawned.env.CAMPFIRE_ACTOR_ID).toBeUndefined();
      expect(spawned.env.CAMPFIRE_URL).toBeUndefined();
      expect(JSON.stringify(spawned.env)).not.toContain("cft_secret");
    });

    const result = await ensureLocalListener({
      url: "http://127.0.0.1:9414",
      cliEntry: CLI,
      execPath: "/usr/bin/node",
      execArgv: ["--import", "tsx"],
      env: {
        CAMPFIRE_TOKEN: "cft_secret",
        CAMPFIRE_SESSION_ID: "ses_1",
        CAMPFIRE_ACTOR_ID: "agt_1",
        CAMPFIRE_URL: "http://127.0.0.1:9414",
        CAMPFIRE_HARNESS: "codex",
      },
      probe: async () => up,
      spawnUp,
      lockPath: join(dir, "listener.lock"),
      attempts: 5,
      intervalMs: 1,
    });

    expect(result).toEqual({ ready: true, started: true });
    expect(spawnUp).toHaveBeenCalledOnce();
  });

  it("does not start a local listener for a non-loopback URL", async () => {
    const spawnUp = vi.fn();
    const result = await ensureLocalListener({
      url: "https://campfire.example",
      cliEntry: CLI,
      probe: async () => false,
      spawnUp,
      attempts: 2,
      intervalMs: 1,
    });
    expect(result.ready).toBe(false);
    if (!result.ready) {
      expect(result.message).not.toContain("Run campfire up");
      expect(result.details.nextAction).toBe("check_campfire_url");
    }
    expect(spawnUp).not.toHaveBeenCalled();
  });

  it("does not re-exec an entry that is not the campfire CLI", async () => {
    const spawnUp = vi.fn();
    const result = await ensureLocalListener({
      url: "http://127.0.0.1:9414",
      cliEntry: "/opt/campfire/src/mcp/stdio.ts",
      probe: async () => false,
      spawnUp,
      attempts: 2,
      intervalMs: 1,
    });
    expect(isCampfireCliEntry("/opt/campfire/src/mcp/stdio.ts")).toBe(false);
    expect(isCampfireCliEntry(CLI)).toBe(true);
    expect(spawnUp).not.toHaveBeenCalled();
    expect(result.ready).toBe(false);
    if (!result.ready) expect(result.message).toContain("Run campfire up");
  });

  it("names campfire up when the loopback listener never accepts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "campfire-018-down-"));
    dirs.push(dir);
    const result = await ensureLocalListener({
      url: "http://127.0.0.1:9",
      cliEntry: CLI,
      probe: async () => false,
      spawnUp: () => {},
      lockPath: join(dir, "listener.lock"),
      attempts: 2,
      intervalMs: 1,
    });
    expect(result.ready).toBe(false);
    if (!result.ready) {
      expect(result.message).toContain("Run campfire up");
      expect(result.details.nextAction).toBe("campfire up");
      expect(result.message).not.toContain("cft_");
    }
  });

  it("lets a second session reuse the listener the first session started", async () => {
    const dir = mkdtempSync(join(tmpdir(), "campfire-018-race-"));
    dirs.push(dir);
    let up = false;
    let starts = 0;
    const spawnUp = (): void => {
      starts += 1;
      up = true;
    };
    const shared = {
      url: "http://127.0.0.1:9414",
      cliEntry: CLI,
      execPath: "/usr/bin/node",
      execArgv: [] as string[],
      probe: async () => up,
      spawnUp,
      lockPath: join(dir, "listener.lock"),
      attempts: 20,
      intervalMs: 5,
    };
    const [first, second] = await Promise.all([ensureLocalListener(shared), ensureLocalListener(shared)]);
    expect(starts).toBe(1);
    expect(first.ready).toBe(true);
    expect(second.ready).toBe(true);
  });

  it("finishes startup without whoami when the listener stays down", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await resolveRemoteStartup(
      "http://127.0.0.1:9",
      "cft_secret",
      {},
      [],
      async () => ({
        ready: false,
        message: "Unable to reach Campfire at http://127.0.0.1:9. Run campfire up.",
        details: { field: "CAMPFIRE_URL", nextAction: "campfire up", url: "http://127.0.0.1:9" },
      }),
    );
    expect(result.kind).toBe("unavailable");
    expect(fetchSpy).not.toHaveBeenCalled();
    if (result.kind === "unavailable") {
      const server = createCampfireMcpServer({
        unavailable: { message: result.down.message, details: result.down.details },
      });
      const client = new Client({ name: "sprint-018", version: "0.0.0" });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
      expect(client.getInstructions()).toBe(SESSION_INSTRUCTIONS);
      const outcome = callText(await client.callTool({ name: "whoami", arguments: {} }));
      expect(outcome.isError).toBe(true);
      expect(outcome.json.message).toContain("Run campfire up");
      expect(JSON.stringify(outcome.json)).not.toContain("cft_secret");
      await client.close();
      await server.close();
    }
  });
});
