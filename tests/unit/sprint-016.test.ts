import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareConnection } from "../../src/bootstrap/connect.js";
import { diagnoseLocal } from "../../src/bootstrap/doctor.js";
import { buildHandoff, formatHandoff } from "../../src/bootstrap/handoff.js";
import { setupContract } from "../../src/bootstrap/setup-contract.js";
import { runCliEntry } from "../../src/cli/index.js";
import { createRuntimeFromPath } from "../../src/runtime.js";

let dir: string;
let stdout: string[];
let stderr: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "campfire-s016-"));
  stdout = [];
  stderr = [];
  delete process.env.CAMPFIRE_URL;
  delete process.env.CAMPFIRE_TOKEN;
  delete process.env.CAMPFIRE_DB;
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    stdout.push(args.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    stderr.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.CAMPFIRE_URL;
  delete process.env.CAMPFIRE_TOKEN;
  delete process.env.CAMPFIRE_DB;
});

async function onboard(dbPath: string): Promise<{ humanToken: string; agentToken: string; workspaceId: string }> {
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
  const receipt = JSON.parse(stdout.join("\n")) as {
    human: { token: string };
    agent: { token: string };
    workspace: { id: string };
    next: { setup: { workspaceId: string; reloadRequired: boolean; handoffFields: string[] } };
  };
  expect(receipt.next.setup.workspaceId).toBe(receipt.workspace.id);
  expect(receipt.next.setup.reloadRequired).toBe(true);
  expect(receipt.next.setup.handoffFields).toContain("viewerUrl");
  stdout.length = 0;
  stderr.length = 0;
  return { humanToken: receipt.human.token, agentToken: receipt.agent.token, workspaceId: receipt.workspace.id };
}

describe("sprint 016 setup contract and handoff", () => {
  it("prints a token-free setup contract", async () => {
    expect(await runCliEntry(["setup", "--json"])).toBe(0);
    const contract = JSON.parse(stdout.join("\n"));
    expect(contract).toMatchObject(setupContract());
    expect(JSON.stringify(contract)).not.toMatch(/cft_/);
    expect(contract.agentSteps).toEqual(["register_agent_session", "preflight", "get_workspace_context"]);
    expect(contract.viewer.tokenInBrowser).toBe(false);
  });

  it("prepares codex and opencode config without leaking the token to stdout", async () => {
    const token = "agent-token-fixture";
    const unrelated = "keeper = \"leave-me\"\n";
    const codexPath = join(dir, "codex.toml");
    writeFileSync(codexPath, unrelated);
    const codex = prepareConnection({
      harness: "codex",
      configPath: codexPath,
      mcpCommand: "/tmp/campfire",
      url: "http://127.0.0.1:9414",
      agentToken: token,
      workspaceId: "ws_test",
    });
    expect(codex.reloadRequired).toBe(true);
    expect(JSON.stringify(codex)).not.toContain(token);
    const codexText = readFileSync(codexPath, "utf8");
    expect(codexText.startsWith(unrelated)).toBe(true);
    expect(codexText).toContain('CAMPFIRE_HARNESS = "codex"');
    expect(codexText).toContain('args = ["mcp"]');
    expect(statSync(codexPath).mode & 0o777).toBe(0o600);
    prepareConnection({
      harness: "codex",
      configPath: codexPath,
      mcpCommand: "/tmp/campfire",
      url: "http://127.0.0.1:9414",
      agentToken: token,
      workspaceId: "ws_test",
    });
    expect(readFileSync(codexPath, "utf8").split("# BEGIN campfire-connect").length - 1).toBe(1);

    const openPath = join(dir, "opencode.json");
    writeFileSync(openPath, JSON.stringify({ model: "keep", mcp: { other: { type: "remote", url: "https://example.test" } } }));
    prepareConnection({
      harness: "opencode",
      configPath: openPath,
      mcpCommand: "/tmp/campfire",
      url: "http://127.0.0.1:9414",
      agentToken: token,
      workspaceId: "ws_test",
    });
    const open = JSON.parse(readFileSync(openPath, "utf8")) as {
      model: string;
      mcp: { other: { url: string }; campfire: { command: string[]; environment: { CAMPFIRE_HARNESS: string; CAMPFIRE_TOKEN: string } } };
    };
    expect(open.model).toBe("keep");
    expect(open.mcp.other.url).toBe("https://example.test");
    expect(open.mcp.campfire.command).toEqual(["/tmp/campfire", "mcp"]);
    expect(open.mcp.campfire.environment.CAMPFIRE_HARNESS).toBe("opencode");
    expect(open.mcp.campfire.environment.CAMPFIRE_TOKEN).toBe(token);
    expect(statSync(openPath).mode & 0o777).toBe(0o600);

    const broken = join(dir, "broken.json");
    writeFileSync(broken, "{ not json");
    expect(() =>
      prepareConnection({
        harness: "opencode",
        configPath: broken,
        mcpCommand: "/tmp/campfire",
        url: "http://127.0.0.1:9414",
        agentToken: token,
        workspaceId: "ws_test",
      }),
    ).toThrow(/strict JSON/);
    expect(readFileSync(broken, "utf8")).toBe("{ not json");
    expect(() =>
      prepareConnection({
        harness: "claude",
        configPath: join(dir, "nope"),
        mcpCommand: "/tmp/campfire",
        url: "http://127.0.0.1:9414",
        agentToken: token,
        workspaceId: "ws_test",
      }),
    ).toThrow(/no validated connection adapter/);
  });

  it("diagnoses readiness without mutation and hands off without a token", async () => {
    const dbPath = join(dir, "campfire.db");
    const { humanToken, agentToken, workspaceId } = await onboard(dbPath);
    const runtime = createRuntimeFromPath(dbPath);
    const before = runtime.store.listContributions(workspaceId).length;
    const missing = diagnoseLocal(runtime, { workspaceId, harness: "codex", token: agentToken });
    expect(missing.ready).toBe(false);
    expect(missing.nextAction).toBe("register_agent_session");
    expect(runtime.store.listContributions(workspaceId)).toHaveLength(before);
    expect(JSON.stringify(missing)).not.toContain(agentToken);

    const human = diagnoseLocal(runtime, { workspaceId, harness: "codex", token: humanToken });
    expect(human.nextAction).toBe("use_agent_token");
    expect(diagnoseLocal(runtime, { workspaceId: "ws_missing", harness: "codex", token: agentToken }).nextAction).toBe(
      "workspace_not_found",
    );

    const actor = runtime.service.resolveToken(agentToken);
    const session = runtime.service.registerAgentSession(
      { actor },
      { agentId: actor.actorId, workspaceId, harness: "opencode" },
    );
    expect(diagnoseLocal(runtime, { workspaceId, harness: "codex", token: agentToken }).nextAction).toBe("harness_mismatch");
    runtime.service.endAgentSession({ actor, agentSessionId: session.id }, session.id);
    runtime.service.registerAgentSession({ actor }, { agentId: actor.actorId, workspaceId, harness: "codex" });
    const ready = diagnoseLocal(runtime, { workspaceId, harness: "codex", token: agentToken });
    expect(ready.ready).toBe(true);
    expect(ready.nextAction).toBe("start_campfire_view");

    const view = runtime.service.getWorkspace({ actor }, workspaceId);
    const receipt = buildHandoff({
      version: ready.version,
      workspaceName: view.workspace.name,
      workspaceId,
      goalTitle: view.goal!.title,
      humanName: "Sergio",
      agentName: "Codex",
      viewerUrl: "http://127.0.0.1:9415/",
      doctor: ready,
    });
    expect(formatHandoff(receipt)).not.toContain(agentToken);
    expect(formatHandoff(receipt)).not.toContain(humanToken);
    expect(receipt.viewerUrl).toContain("127.0.0.1");
    expect(() =>
      buildHandoff({
        version: ready.version,
        workspaceName: view.workspace.name,
        workspaceId,
        goalTitle: view.goal!.title,
        humanName: "Sergio",
        agentName: "Codex",
        viewerUrl: "https://example.com/",
        doctor: ready,
      }),
    ).toThrow(/loopback/);

    const owner = runtime.service.resolveToken(humanToken);
    const outsider = runtime.service.createAgent(
      { actor: owner },
      { teamId: runtime.config.team.id, humanId: owner.actorId, name: "Outsider", harness: "codex" },
    );
    expect(diagnoseLocal(runtime, { workspaceId, harness: "codex", token: outsider.token }).nextAction).toBe(
      "not_a_participant",
    );
    runtime.close();

    const configPath = join(dir, "codex.toml");
    expect(
      await runCliEntry([
        "connect",
        "--harness",
        "codex",
        "--config",
        configPath,
        "--url",
        "http://127.0.0.1:9414",
        "--token",
        agentToken,
        "--workspace",
        workspaceId,
        "--mcp-command",
        "/tmp/campfire",
      ]),
    ).toBe(0);
    expect(`${stdout.join("\n")}\n${stderr.join("\n")}`).not.toContain(agentToken);
    expect(readFileSync(configPath, "utf8")).toContain(agentToken);

    stdout.length = 0;
    stderr.length = 0;
    expect(await runCliEntry(["doctor", workspaceId, "--harness", "codex", "--db", dbPath, "--token", agentToken, "--json"])).toBe(0);
    const doctor = JSON.parse(stdout.join("\n")) as { ready: boolean; nextAction: string };
    expect(doctor.ready).toBe(true);
    expect(JSON.stringify(doctor)).not.toContain(agentToken);

    stdout.length = 0;
    expect(
      await runCliEntry([
        "handoff",
        workspaceId,
        "--harness",
        "codex",
        "--viewer-url",
        "http://127.0.0.1:9415/",
        "--db",
        dbPath,
        "--token",
        agentToken,
        "--json",
      ]),
    ).toBe(0);
    const handoff = JSON.parse(stdout.join("\n")) as { viewerUrl: string; goalTitle: string };
    expect(handoff.goalTitle).toBe("Ship the billing migration safely");
    expect(handoff.viewerUrl).toContain("127.0.0.1");
    expect(JSON.stringify(handoff)).not.toContain(agentToken);
    expect(JSON.stringify(handoff)).not.toContain(humanToken);
  });
});
