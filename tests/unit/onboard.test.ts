import Database from "better-sqlite3";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onboardInstallation } from "../../src/bootstrap/onboard.js";
import { loadCredentials } from "../../src/bootstrap/profile.js";
import { runCliEntry } from "../../src/cli/index.js";
import { ValidationError } from "../../src/domain/errors.js";
import { createRuntimeFromPath } from "../../src/runtime.js";

const GOAL = "Ship the billing migration safely";
const WORKSPACE = "billing deploy";

let dir: string;
let dbPath: string;
let stdout: string[];
let stderr: string[];
const previousDb = process.env.CAMPFIRE_DB;
const previousUrl = process.env.CAMPFIRE_URL;
const previousToken = process.env.CAMPFIRE_TOKEN;

function countTokens(path: string): number {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare("select count(*) as n from actor_tokens").get() as { n: number };
    return row.n;
  } finally {
    db.close();
  }
}

function onboardArgs(extra: string[] = []): string[] {
  return [
    "onboard",
    "--db",
    dbPath,
    "--human-name",
    "Sergio",
    "--agent-name",
    "Codex",
    "--harness",
    "codex",
    "--workspace-name",
    WORKSPACE,
    "--goal",
    GOAL,
    ...extra,
  ];
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "campfire-onboard-"));
  dbPath = join(dir, "campfire.db");
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
  if (previousDb === undefined) delete process.env.CAMPFIRE_DB;
  else process.env.CAMPFIRE_DB = previousDb;
  if (previousUrl === undefined) delete process.env.CAMPFIRE_URL;
  else process.env.CAMPFIRE_URL = previousUrl;
  if (previousToken === undefined) delete process.env.CAMPFIRE_TOKEN;
  else process.env.CAMPFIRE_TOKEN = previousToken;
});

describe("campfire onboard", () => {
  it("creates one human-owned agent workspace and goal on a clean database", async () => {
    expect(await runCliEntry(onboardArgs())).toBe(0);

    const runtime = createRuntimeFromPath(dbPath);
    try {
      expect(runtime.store.countHumans()).toBe(1);
      expect(runtime.store.listWorkspaces()).toHaveLength(1);
      const workspace = runtime.store.listWorkspaces()[0];
      expect(workspace?.name).toBe(WORKSPACE);
      expect(workspace?.status).toBe("active");
      const humans = runtime.store.listHumans(runtime.config.team.id);
      const human = humans[0];
      const agents = runtime.store.listAgents(runtime.config.team.id);
      expect(agents).toHaveLength(1);
      expect(agents[0]?.humanId).toBe(human?.id);
      expect(agents[0]?.harness).toBe("codex");
      expect(agents[0]?.name).toBe("Codex");
      const goal = runtime.store.getGoalForWorkspace(workspace!.id);
      expect(goal?.title).toBe(GOAL);
      expect(goal?.status).toBe("active");
      expect(runtime.store.getParticipant(workspace!.id, { actorId: human!.id, actorType: "human" })?.role).toBe(
        "owner",
      );
      expect(runtime.store.getParticipant(workspace!.id, { actorId: agents[0]!.id, actorType: "agent" })?.role).toBe(
        "agent",
      );
      const invites = runtime.store.listInvites(workspace!.id);
      expect(invites).toHaveLength(1);
      expect(invites[0]?.role).toBe("agent");
      expect(invites[0]?.consumedAt).toBeDefined();
      expect(invites[0]?.actor).toEqual({ actorId: agents[0]!.id, actorType: "agent" });
      expect(runtime.store.listFindings(workspace!.id)).toEqual([]);
      expect(runtime.store.listDecisions(workspace!.id)).toEqual([]);
      expect(runtime.store.listTasks(workspace!.id)).toEqual([]);
      expect(runtime.store.listArtifacts(workspace!.id)).toEqual([]);
      expect(runtime.store.listAgentSessions(workspace!.id)).toEqual([]);

      const contributions = runtime.store.listContributions(workspace!.id);
      const actorOf = (action: string, objectType: string) =>
        contributions.find((row) => row.action === action && row.objectType === objectType)?.actor;
      expect(actorOf("create", "workspace")).toEqual({ actorId: human!.id, actorType: "human" });
      expect(actorOf("create", "goal")).toEqual({ actorId: human!.id, actorType: "human" });
      expect(actorOf("create", "invite")).toEqual({ actorId: human!.id, actorType: "human" });
      expect(
        contributions.filter((row) => row.action === "join" && row.actor.actorType === "human"),
      ).toHaveLength(1);
      expect(
        contributions.find((row) => row.action === "join" && row.actor.actorType === "agent")?.actor.actorId,
      ).toBe(agents[0]!.id);

      const text = stdout.join("\n");
      const credentials = loadCredentials();
      expect(credentials).toBeDefined();
      const humanToken = credentials!.humanToken;
      const agentToken = credentials!.agentToken;
      expect(agentToken).toBeDefined();
      expect(text).not.toMatch(/cft_/);
      expect(text).toContain("campfire up");
      expect(runtime.service.resolveToken(humanToken)).toEqual({ actorId: human!.id, actorType: "human" });
      expect(runtime.service.resolveToken(agentToken!)).toEqual({ actorId: agents[0]!.id, actorType: "agent" });
      const stored = JSON.stringify({
        humans,
        agents,
        workspace,
        goal,
        invites,
        contributions,
        sessions: runtime.store.listAgentSessions(workspace!.id),
      });
      expect(stored).not.toContain(humanToken);
      expect(stored).not.toContain(agentToken);
      expect(stderr.join("\n")).not.toContain(humanToken);
      expect(stderr.join("\n")).not.toContain(agentToken);
      expect(isAbsolute(dbPath)).toBe(true);
      expect(text).toContain("register_agent_session");
      expect(text).toContain("preflight");
    } finally {
      runtime.close();
    }
  });

  it("prints a stable json receipt", async () => {
    expect(await runCliEntry(onboardArgs(["--json"]))).toBe(0);
    const receipt = JSON.parse(stdout.join("\n")) as {
      databasePath: string;
      human: { id: string; actorType: string; token: string };
      agent: { id: string; actorType: string; humanId: string; harness: string; token: string };
      workspace: { id: string; name: string; status: string };
      goal: { title: string; status: string };
      next: { serve: string; up: string; harness: { env: string[]; workspaceId: string }; steps: string[] };
    };
    expect(receipt.databasePath).toBe(dbPath);
    expect(isAbsolute(receipt.databasePath)).toBe(true);
    expect(receipt.human.actorType).toBe("human");
    expect(receipt.agent.actorType).toBe("agent");
    expect(receipt.agent.humanId).toBe(receipt.human.id);
    expect(receipt.agent.harness).toBe("codex");
    expect(receipt.workspace).toMatchObject({ name: WORKSPACE, status: "active" });
    expect(receipt.goal).toMatchObject({ title: GOAL, status: "active" });
    expect(receipt.human.token).toMatch(/^cft_/);
    expect(receipt.agent.token).toMatch(/^cft_/);
    expect(receipt.next.up).toBe("campfire up");
    expect(receipt.next.serve).toBe(`CAMPFIRE_DB=${dbPath} campfire serve`);
    expect(receipt.next.harness.env).toEqual(["CAMPFIRE_URL", "CAMPFIRE_TOKEN", "CAMPFIRE_HARNESS"]);
    expect(receipt.next.harness.workspaceId).toBe(receipt.workspace.id);
    expect(receipt.next.steps).toEqual(["register_agent_session", "preflight", "get_workspace_context"]);
    expect(receipt.human.token).not.toBe(receipt.agent.token);
  });

  it("rejects missing flags before creating a database", async () => {
    expect(await runCliEntry(["onboard", "--db", dbPath, "--human-name", "Sergio"])).toBe(1);
    expect(existsSync(dbPath)).toBe(false);
    expect(
      await runCliEntry([
        "onboard",
        "--db",
        dbPath,
        "--human-name",
        "Sergio",
        "--agent-name",
        "Codex",
        "--harness",
        "codex",
        "--workspace-name",
        WORKSPACE,
        "--goal",
        "   ",
      ]),
    ).toBe(1);
    expect(existsSync(dbPath)).toBe(false);
  });

  it("refuses a second run without minting another credential", async () => {
    expect(await runCliEntry(onboardArgs())).toBe(0);
    const tokensBefore = countTokens(dbPath);
    const runtime = createRuntimeFromPath(dbPath);
    const humansBefore = runtime.store.countHumans();
    const workspacesBefore = runtime.store.listWorkspaces().length;
    const contributionsBefore = runtime.store.listContributions(runtime.store.listWorkspaces()[0]!.id).length;
    runtime.close();
    stdout.length = 0;
    stderr.length = 0;

    expect(await runCliEntry(onboardArgs())).toBe(1);
    expect(stderr.join("\n")).toContain(
      "This installation already has a human or a workspace. Use create-human, create-agent, create-workspace, create-goal, invite, and join.",
    );
    expect(countTokens(dbPath)).toBe(tokensBefore);
    const again = createRuntimeFromPath(dbPath);
    try {
      expect(again.store.countHumans()).toBe(humansBefore);
      expect(again.store.listWorkspaces()).toHaveLength(workspacesBefore);
      expect(again.store.listContributions(again.store.listWorkspaces()[0]!.id)).toHaveLength(contributionsBefore);
      expect(again.store.listAgentSessions(again.store.listWorkspaces()[0]!.id)).toEqual([]);
    } finally {
      again.close();
    }
    const combined = `${stdout.join("\n")}\n${stderr.join("\n")}`;
    expect(combined).not.toMatch(/cft_[0-9a-fA-F]{32,}/);
  });

  it("rolls back a partial onboarding when a later step throws", () => {
    const runtime = createRuntimeFromPath(dbPath);
    vi.spyOn(runtime.service, "createGoal").mockImplementation(() => {
      throw new ValidationError("boom", { field: "goal" });
    });
    expect(() =>
      onboardInstallation(runtime.store, runtime.service, runtime.config, {
        humanName: "Sergio",
        agentName: "Codex",
        harness: "codex",
        workspaceName: WORKSPACE,
        goal: GOAL,
      }),
    ).toThrow(ValidationError);
    expect(runtime.store.countHumans()).toBe(0);
    expect(runtime.store.listWorkspaces()).toEqual([]);
    runtime.close();
    expect(countTokens(dbPath)).toBe(0);
  });

  it("refuses a seeded demo database", async () => {
    expect(await runCliEntry(["seed", "--reset", "--db", dbPath])).toBe(0);
    const runtime = createRuntimeFromPath(dbPath);
    const humansBefore = runtime.store.countHumans();
    const workspacesBefore = runtime.store.listWorkspaces().length;
    runtime.close();
    expect(humansBefore).toBeGreaterThan(0);
    stdout.length = 0;
    stderr.length = 0;

    expect(await runCliEntry(onboardArgs())).toBe(1);
    const again = createRuntimeFromPath(dbPath);
    try {
      expect(again.store.countHumans()).toBe(humansBefore);
      expect(again.store.listWorkspaces()).toHaveLength(workspacesBefore);
    } finally {
      again.close();
    }
  });
});
