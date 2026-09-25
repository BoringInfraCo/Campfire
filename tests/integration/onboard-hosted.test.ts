import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCliEntry } from "../../src/cli/index.js";
import { startCampfireHttpServer } from "../../src/http/server.js";
import type { RunningHttpServer } from "../../src/http/server.js";
import { createRuntimeFromPath } from "../../src/runtime.js";
import type { CampfireRuntime } from "../../src/runtime.js";

interface HttpOutcome {
  status: number;
  body:
    | { ok: true; result: any }
    | { ok: false; error: string; message: string; details?: Record<string, unknown> };
}

async function call(
  baseUrl: string,
  token: string | undefined,
  method: string,
  params: Record<string, unknown> = {},
): Promise<HttpOutcome> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}/v1/call`, {
    method: "POST",
    headers,
    body: JSON.stringify({ method, params }),
  });
  return { status: response.status, body: (await response.json()) as HttpOutcome["body"] };
}

describe("onboarded workspace over HTTP", () => {
  const open: Array<{ runtime: CampfireRuntime; server: RunningHttpServer; dir: string }> = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const item of open.splice(0)) {
      await item.server.close();
      item.runtime.close();
      rmSync(item.dir, { recursive: true, force: true });
    }
    delete process.env.CAMPFIRE_URL;
    delete process.env.CAMPFIRE_TOKEN;
    delete process.env.CAMPFIRE_DB;
  });

  it("stays unreadied until the agent registers a session, then retrieves the goal", async () => {
    const dir = mkdtempSync(join(tmpdir(), "campfire-onboard-http-"));
    const dbPath = join(dir, "campfire.db");
    const logs: string[] = [];
    delete process.env.CAMPFIRE_URL;
    delete process.env.CAMPFIRE_TOKEN;
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await runCliEntry([
      "onboard",
      "--json",
      "--db",
      dbPath,
      "--human-name",
      "Sergio",
      "--agent-name",
      "Codex",
      "--harness",
      "codex",
      "--workspace-name",
      "billing deploy",
      "--goal",
      "Ship the billing migration safely",
    ]);
    expect(code).toBe(0);
    const receipt = JSON.parse(logs.join("\n")) as {
      human: { id: string; token: string };
      agent: { id: string; token: string; harness: string };
      workspace: { id: string };
      goal: { title: string };
    };

    const runtime = createRuntimeFromPath(dbPath);
    const server = await startCampfireHttpServer({ runtime, host: "127.0.0.1", port: 0 });
    open.push({ runtime, server, dir });
    const contributionsBefore = runtime.store.listContributions(receipt.workspace.id).length;

    const anonymous = await call(server.url, undefined, "get_workspace_context", {
      workspaceId: receipt.workspace.id,
    });
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.ok).toBe(false);

    const garbage = await call(server.url, "not-a-bearer-token", "whoami");
    expect(garbage.status).toBe(401);

    const early = await call(server.url, receipt.agent.token, "preflight", {
      workspaceId: receipt.workspace.id,
    });
    expect(early.body.ok).toBe(false);
    if (early.body.ok) return;
    expect(early.body.message).toContain("register_agent_session");
    expect(runtime.store.listAgentSessions(receipt.workspace.id)).toEqual([]);
    expect(runtime.store.listContributions(receipt.workspace.id)).toHaveLength(contributionsBefore);

    const humanReady = await call(server.url, receipt.human.token, "preflight", {
      workspaceId: receipt.workspace.id,
    });
    expect(humanReady.body.ok).toBe(true);
    if (!humanReady.body.ok) return;
    expect(humanReady.body.result.actor).toEqual({ actorId: receipt.human.id, actorType: "human" });
    expect(humanReady.body.result.sessionId).toBeUndefined();

    const registered = await call(server.url, receipt.agent.token, "register_agent_session", {
      agentId: receipt.agent.id,
      workspaceId: receipt.workspace.id,
      harness: receipt.agent.harness,
    });
    expect(registered.body.ok).toBe(true);
    if (!registered.body.ok) return;
    const sessionId = registered.body.result.id as string;

    const ready = await call(server.url, receipt.agent.token, "preflight", {
      workspaceId: receipt.workspace.id,
      agentSessionId: sessionId,
    });
    expect(ready.body.ok).toBe(true);
    if (!ready.body.ok) return;
    expect(ready.body.result).toMatchObject({
      ready: true,
      workspaceId: receipt.workspace.id,
      actor: { actorId: receipt.agent.id, actorType: "agent" },
      sessionId,
    });

    const context = await call(server.url, receipt.agent.token, "get_workspace_context", {
      workspaceId: receipt.workspace.id,
      agentSessionId: sessionId,
    });
    expect(context.body.ok).toBe(true);
    if (!context.body.ok) return;
    expect(context.body.result.goal.title).toBe("Ship the billing migration safely");
    const participants = context.body.result.participants as Array<{ actor: { actorType: string }; name: string }>;
    expect(participants.map((participant) => participant.actor.actorType).sort()).toEqual(["agent", "human"]);
    expect(participants.map((participant) => participant.name).sort()).toEqual(["Codex", "Sergio"]);

    const whoHuman = await call(server.url, receipt.human.token, "whoami");
    const whoAgent = await call(server.url, receipt.agent.token, "whoami");
    expect(whoHuman.body.ok && whoHuman.body.result.actor.actorType).toBe("human");
    expect(whoAgent.body.ok && whoAgent.body.result.actor.actorType).toBe("agent");
  });
});
