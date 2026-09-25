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
  body: { ok: true; result: any } | { ok: false; error: string; message: string };
}

async function call(
  baseUrl: string,
  token: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<HttpOutcome> {
  const response = await fetch(`${baseUrl}/v1/call`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ method, params }),
  });
  return { status: response.status, body: (await response.json()) as HttpOutcome["body"] };
}

describe("hosted campfire doctor session id", () => {
  const open: Array<{ runtime: CampfireRuntime; server: RunningHttpServer; dir: string }> = [];
  let stdout: string[];
  let stderr: string[];

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
    delete process.env.CAMPFIRE_SESSION_ID;
  });

  async function doctor(args: string[]): Promise<{ status: number; report: { ready: boolean; mode: string; nextAction: string; checks: Array<{ id: string; pass: boolean }> } }> {
    stdout = [];
    stderr = [];
    const status = await runCliEntry(["doctor", ...args, "--json"]);
    const report = JSON.parse(stdout.join("\n") || "{}") as {
      ready: boolean;
      mode: string;
      nextAction: string;
      checks: Array<{ id: string; pass: boolean }>;
    };
    return { status, report };
  }

  it("requires an explicit session id and stays read-only", async () => {
    const dir = mkdtempSync(join(tmpdir(), "campfire-doctor-hosted-"));
    const dbPath = join(dir, "campfire.db");
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
      stdout.push(args.map(String).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      stderr.push(args.map(String).join(" "));
    });
    stdout = [];
    stderr = [];
    expect(
      await runCliEntry([
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
      ]),
    ).toBe(0);
    const receipt = JSON.parse(logs.join("\n")) as {
      team: { id: string };
      human: { id: string; token: string };
      agent: { id: string; token: string };
      workspace: { id: string };
    };
    logs.length = 0;
    const runtime = createRuntimeFromPath(dbPath);
    const server = await startCampfireHttpServer({ runtime, host: "127.0.0.1", port: 0 });
    open.push({ runtime, server, dir });
    process.env.CAMPFIRE_URL = server.url;
    process.env.CAMPFIRE_TOKEN = receipt.agent.token;

    const missing = await doctor([receipt.workspace.id, "--harness", "codex"]);
    expect(missing.report.ready).toBe(false);
    expect(missing.report.mode).toBe("hosted");
    expect(missing.report.nextAction).toBe("register_agent_session_then_pass_session");

    const registered = await call(server.url, receipt.agent.token, "register_agent_session", {
      agentId: receipt.agent.id,
      workspaceId: receipt.workspace.id,
      harness: "codex",
    });
    expect(registered.body.ok).toBe(true);
    if (!registered.body.ok) return;
    const sessionId = registered.body.result.id as string;
    const before = await call(server.url, receipt.agent.token, "get_activity", {
      workspaceId: receipt.workspace.id,
      agentSessionId: sessionId,
    });
    expect(before.body.ok).toBe(true);
    if (!before.body.ok) return;
    const contributionsBefore = before.body.result.total as number;

    const ready = await doctor([receipt.workspace.id, "--harness", "codex", "--session", sessionId]);
    expect(ready.report).toMatchObject({ ready: true, mode: "hosted", nextAction: "start_campfire_view" });
    expect(ready.report.checks.every((check) => check.pass)).toBe(true);

    delete process.env.CAMPFIRE_SESSION_ID;
    process.env.CAMPFIRE_SESSION_ID = sessionId;
    const fromEnv = await doctor([receipt.workspace.id, "--harness", "codex"]);
    expect(fromEnv.report.ready).toBe(true);

    process.env.CAMPFIRE_SESSION_ID = "ses_not_the_flag";
    const flagWins = await doctor([receipt.workspace.id, "--harness", "codex", "--session", sessionId]);
    expect(flagWins.report.ready).toBe(true);
    const envLoses = await doctor([receipt.workspace.id, "--harness", "codex", "--session", "ses_unknown"]);
    expect(envLoses.report.ready).toBe(false);
    expect(envLoses.report.nextAction).toBe("unknown_session");

    const unknown = await doctor([receipt.workspace.id, "--harness", "codex", "--session", "ses_missing"]);
    expect(unknown.report.nextAction).toBe("unknown_session");

    const created = await call(server.url, receipt.human.token, "create_agent", {
      teamId: receipt.team.id,
      humanId: receipt.human.id,
      name: "Other",
      harness: "codex",
    });
    expect(created.body.ok).toBe(true);
    if (!created.body.ok) return;
    const otherId = created.body.result.agent.id as string;
    const otherToken = created.body.result.token as string;
    await call(server.url, receipt.human.token, "invite_workspace", {
      workspaceId: receipt.workspace.id,
      actorId: otherId,
      actorType: "agent",
      role: "agent",
    });
    await call(server.url, otherToken, "join_workspace", { workspaceId: receipt.workspace.id });
    const otherSession = await call(server.url, otherToken, "register_agent_session", {
      agentId: otherId,
      workspaceId: receipt.workspace.id,
      harness: "codex",
    });
    expect(otherSession.body.ok).toBe(true);
    if (!otherSession.body.ok) return;
    process.env.CAMPFIRE_TOKEN = receipt.agent.token;
    const wrongActor = await doctor([
      receipt.workspace.id,
      "--harness",
      "codex",
      "--session",
      otherSession.body.result.id as string,
    ]);
    expect(wrongActor.report.nextAction).toBe("session_wrong_actor");

    const otherWorkspace = await call(server.url, receipt.human.token, "create_workspace", {
      teamId: receipt.team.id,
      name: "other workspace",
    });
    expect(otherWorkspace.body.ok).toBe(true);
    if (!otherWorkspace.body.ok) return;
    const otherWorkspaceId = otherWorkspace.body.result.id as string;
    await call(server.url, receipt.human.token, "invite_workspace", {
      workspaceId: otherWorkspaceId,
      actorId: receipt.agent.id,
      actorType: "agent",
      role: "agent",
    });
    await call(server.url, receipt.agent.token, "join_workspace", { workspaceId: otherWorkspaceId });
    const elsewhere = await call(server.url, receipt.agent.token, "register_agent_session", {
      agentId: receipt.agent.id,
      workspaceId: otherWorkspaceId,
      harness: "codex",
    });
    expect(elsewhere.body.ok).toBe(true);
    if (!elsewhere.body.ok) return;
    const wrongWorkspace = await doctor([
      receipt.workspace.id,
      "--harness",
      "codex",
      "--session",
      elsewhere.body.result.id as string,
    ]);
    expect(wrongWorkspace.report.nextAction).toBe("session_wrong_workspace");

    const wrongHarnessSession = await call(server.url, receipt.agent.token, "register_agent_session", {
      agentId: receipt.agent.id,
      workspaceId: receipt.workspace.id,
      harness: "other",
    });
    expect(wrongHarnessSession.body.ok).toBe(true);
    if (!wrongHarnessSession.body.ok) return;
    const wrongHarness = await doctor([
      receipt.workspace.id,
      "--harness",
      "codex",
      "--session",
      wrongHarnessSession.body.result.id as string,
    ]);
    expect(wrongHarness.report.nextAction).toBe("harness_mismatch");

    const after = await call(server.url, receipt.agent.token, "get_activity", {
      workspaceId: receipt.workspace.id,
      agentSessionId: sessionId,
    });
    expect(after.body.ok).toBe(true);
    if (!after.body.ok) return;
    expect(after.body.result.total).toBe(contributionsBefore + 4);

    const captured = `${stdout.join("\n")}\n${stderr.join("\n")}`;
    expect(captured).not.toContain(receipt.agent.token);
    expect(captured).not.toContain(receipt.human.token);
    expect(captured).not.toContain(otherToken);
  });
});
