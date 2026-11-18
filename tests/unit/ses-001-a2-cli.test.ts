import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseArgs } from "../../src/cli/args.js";
import { formatSessionList, runSessionHostFromParsed } from "../../src/cli/session-host.js";
import { SESSION_HOST_USAGE } from "../../src/cli/session-host-catalog.js";
import { ValidationError } from "../../src/domain/errors.js";
import { createHttpCoreClient, createFakeCoreClient, HTTP_METHODS } from "../../src/session-host/core-client.js";
import type { CoreClient, SessionHostDeps } from "../../src/session-host/types.js";

const HUMAN = "cft_a2cli_human_secret";
const AGENT = "cft_a2cli_agent_secret";
const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function isolatedEnv(): NodeJS.ProcessEnv {
  const home = mkdtempSync(join(tmpdir(), "a2-cli-"));
  roots.push(home);
  return { HOME: home, CAMPFIRE_SESSION_HOST: "1" };
}

function shareCore(calls: Array<{ op: string; input: unknown; actor: string }>): CoreClient {
  const base = createFakeCoreClient();
  return {
    ...base,
    async shareAgentSession(reader, input) {
      calls.push({ op: "share", input, actor: reader.actor.actorType });
      return { sessionId: input.sessionId, shared: true, sharedAt: "2026-11-17T12:00:00.000Z" };
    },
    async unshareAgentSession(reader, input) {
      calls.push({ op: "unshare", input, actor: reader.actor.actorType });
      return { sessionId: input.sessionId, shared: false };
    },
  };
}

async function run(argv: string[], deps: SessionHostDeps): Promise<string> {
  const lines: string[] = [];
  vi.spyOn(console, "log").mockImplementation((value?: unknown) => { lines.push(String(value)); });
  await runSessionHostFromParsed(parseArgs(argv), deps);
  return lines.join("\n");
}

describe("campfire session share and unshare", () => {
  it("is listed in the session command catalog", () => {
    expect(SESSION_HOST_USAGE.some((line) => line.startsWith("campfire session share <sessionId>"))).toBe(true);
    expect(SESSION_HOST_USAGE.some((line) => line.startsWith("campfire session unshare <sessionId>"))).toBe(true);
  });

  it("shares as the reader human and prints JSON", async () => {
    const calls: Array<{ op: string; input: unknown; actor: string }> = [];
    const out = await run(["session", "share", "ses_1", "--workspace", "ws_1", "--output", "json"], {
      env: isolatedEnv(),
      core: shareCore(calls),
      readerContext: { actor: { actorId: "hum_1", actorType: "human" } },
    });
    expect(calls).toEqual([{ op: "share", input: { workspaceId: "ws_1", sessionId: "ses_1" }, actor: "human" }]);
    expect(JSON.parse(out)).toEqual({ sessionId: "ses_1", shared: true, sharedAt: "2026-11-17T12:00:00.000Z" });
  });

  it("prints clear text for humans and says no terminal text is shared", async () => {
    const calls: Array<{ op: string; input: unknown; actor: string }> = [];
    const deps: SessionHostDeps = {
      env: isolatedEnv(),
      core: shareCore(calls),
      readerContext: { actor: { actorId: "hum_1", actorType: "human" } },
    };
    const shared = await run(["session", "share", "ses_1", "--workspace", "ws_1", "--output", "human"], deps);
    expect(shared).toMatch(/Shared ses_1/);
    expect(shared).toMatch(/No terminal text is shared/);
    const stopped = await run(["session", "unshare", "ses_1", "--workspace", "ws_1", "--output", "human"], deps);
    expect(stopped).toMatch(/Stopped sharing ses_1/);
    expect(calls.map((call) => call.op)).toEqual(["share", "unshare"]);
  });

  it("needs a session id, a workspace and a Core that supports sharing", async () => {
    const env = isolatedEnv();
    const reader = { actor: { actorId: "hum_1", actorType: "human" as const } };
    await expect(run(["session", "share", "--workspace", "ws_1"], { env, core: shareCore([]), readerContext: reader })).rejects.toThrow(/sessionId/);
    await expect(run(["session", "share", "ses_1"], { env, core: shareCore([]), readerContext: reader })).rejects.toThrow(/--workspace/);
    await expect(run(["session", "share", "ses_1", "--workspace", "ws_1"], { env, core: createFakeCoreClient(), readerContext: reader })).rejects.toThrow(/does not support session sharing/);
  });

  it("refuses an agent reader before calling Core", async () => {
    const calls: Array<{ op: string; input: unknown; actor: string }> = [];
    const error = await run(["session", "share", "ses_1", "--workspace", "ws_1", "--output", "json"], {
      env: isolatedEnv(),
      core: shareCore(calls),
      readerContext: { actor: { actorId: "agt_1", actorType: "agent" } },
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect(calls).toEqual([]);
  });

  it("marks shared sessions in the human list and leaves others alone", () => {
    const text = formatSessionList("ws_1", {
      serverTime: "t",
      sessions: [
        { id: "ses_a", workspaceId: "ws_1", agentId: "agt", harness: "codex", state: "running", shared: true },
        { id: "ses_b", workspaceId: "ws_1", agentId: "agt", harness: "codex", state: "running", shared: false },
      ],
    });
    const [, a, b] = text.split("\n");
    expect(a).toMatch(/shared$/);
    expect(b).not.toMatch(/shared/);
  });

  it("calls the HTTP methods with the human token only", async () => {
    const seen: Array<{ method: string; token: string; params?: Record<string, unknown> }> = [];
    const http = createHttpCoreClient({
      baseUrl: "http://127.0.0.1:9",
      agentToken: AGENT,
      humanToken: HUMAN,
      call: async (request) => { seen.push(request); return { sessionId: "ses_1", shared: true }; },
    });
    const reader = { actor: { actorId: "hum_1", actorType: "human" as const } };
    await http.shareAgentSession?.(reader, { workspaceId: "ws_1", sessionId: "ses_1" });
    await http.unshareAgentSession?.(reader, { workspaceId: "ws_1", sessionId: "ses_1" });
    expect(seen.map((call) => call.method)).toEqual([HTTP_METHODS.share, HTTP_METHODS.unshare]);
    expect(seen.every((call) => call.token === HUMAN)).toBe(true);
    expect(JSON.stringify(seen)).not.toContain(AGENT);
  });
});
