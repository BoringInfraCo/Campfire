import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultHarnessConfigPath, detectInstalledHarnesses } from "../../src/bootstrap/connect.js";
import { beginHuman, connectInstalledHarnesses } from "../../src/bootstrap/listen.js";
import {
  formatStatus,
  loadCredentials,
  loadProfile,
  persistHumanProfile,
  rememberAgentCredential,
  rememberProfileAgents,
} from "../../src/bootstrap/profile.js";
import { defaultHumanName } from "../../src/cli/first-run.js";
import { runCliEntry } from "../../src/cli/index.js";
import { Unauthorized } from "../../src/domain/errors.js";
import { createRuntimeFromPath } from "../../src/runtime.js";
import type { ActorContext } from "../../src/service/authorization.js";

const previousDb = process.env.CAMPFIRE_DB;

afterEach(() => {
  vi.restoreAllMocks();
  if (previousDb === undefined) delete process.env.CAMPFIRE_DB;
  else process.env.CAMPFIRE_DB = previousDb;
});

describe("first-run human", () => {
  it("defaults the name from git, then the login", () => {
    const home = mkdtempSync(join(tmpdir(), "campfire-name-"));
    const gitconfig = join(home, ".gitconfig");
    writeFileSync(gitconfig, "[user]\n\tname = Ada Lovelace\n");
    const base = {
      HOME: home,
      PATH: process.env.PATH ?? "",
      GIT_CONFIG_GLOBAL: gitconfig,
      GIT_CONFIG_NOSYSTEM: "1",
      USER: "root",
    };
    try {
      expect(defaultHumanName(base)).toBe("Ada Lovelace");
      expect(
        defaultHumanName({
          ...base,
          GIT_CONFIG_GLOBAL: join(home, "missing-gitconfig"),
          USER: "ada",
        }),
      ).toBe("ada");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("refuses a non-interactive start that has no name", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      stdout.push(args.map(String).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      stderr.push(args.map(String).join(" "));
    });
    expect(await runCliEntry([])).toBe(1);
    const err = stderr.join("\n");
    expect(err).toMatch(/human-name/);
    expect(err).toMatch(/harness connects/);
    expect(loadProfile()).toBeUndefined();
    expect(`${stdout.join("\n")}\n${err}`).not.toMatch(/cft_/);
  });

  it("records only the human and does not print the token", async () => {
    const dir = mkdtempSync(join(tmpdir(), "campfire-human-"));
    const dbPath = join(dir, "campfire.db");
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      stdout.push(args.map(String).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      stderr.push(args.map(String).join(" "));
    });
    try {
      expect(await runCliEntry(["--db", dbPath, "--human-name", "Ada", "--json"])).toBe(0);
      const body = JSON.parse(stdout.join("\n")) as {
        human: string;
        waiting: string;
        pastSessionsImported: boolean;
      };
      expect(body).toEqual({
        human: "Ada",
        humanId: expect.any(String),
        databasePath: dbPath,
        waiting: "agent",
        pastSessionsImported: false,
      });
      expect(JSON.stringify(body)).not.toMatch(/cft_/);

      const profile = loadProfile();
      expect(profile?.humanName).toBe("Ada");
      expect(profile?.workspaceId).toBeUndefined();
      expect(profile?.agentId).toBeUndefined();
      expect(profile?.agents).toBeUndefined();
      const credentials = loadCredentials();
      expect(credentials?.humanToken).toMatch(/^cft_/);
      expect(credentials?.agentToken).toBeUndefined();
      expect(credentials?.agents).toBeUndefined();

      const runtime = createRuntimeFromPath(dbPath);
      try {
        expect(runtime.store.countHumans()).toBe(1);
        const human = runtime.store.getHuman(profile!.humanId);
        expect(human).toBeDefined();
        expect(runtime.store.listAgents(human!.teamId)).toEqual([]);
        expect(runtime.store.listWorkspaces()).toEqual([]);
        expect(() => beginHuman(runtime.store, runtime.service, runtime.config, "Grace")).toThrow(/already has a human/);
      } finally {
        runtime.close();
      }

      stdout.length = 0;
      expect(await runCliEntry([])).toBe(0);
      const text = stdout.join("\n");
      expect(text).toContain("Ada");
      expect(text).toContain("Waiting for an agent to start work.");
      expect(text).toContain("Past sessions are not imported.");
      expect(text).not.toMatch(/cft_/);
      expect(text).not.toContain(credentials!.humanToken);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("campfire up harness connection", () => {
  it("creates one owned agent per installed harness and does not duplicate them", () => {
    const root = mkdtempSync(join(tmpdir(), "campfire-listen-"));
    const dbPath = join(root, "campfire.db");
    const home = join(root, "home");
    const cwd = join(root, "work");
    mkdirSync(join(home, ".codex"), { recursive: true });
    mkdirSync(join(home, ".config", "opencode"), { recursive: true });
    mkdirSync(cwd, { recursive: true });
    const env = { HOME: home, XDG_CONFIG_HOME: join(home, ".config") };
    const runtime = createRuntimeFromPath(dbPath);
    try {
      const harnesses = detectInstalledHarnesses(env, cwd);
      expect(harnesses).toEqual(["codex", "opencode"]);
      const started = beginHuman(runtime.store, runtime.service, runtime.config, "Ada");
      persistHumanProfile({
        databasePath: started.databasePath,
        humanId: started.humanId,
        humanName: started.humanName,
        humanToken: started.token,
      });
      const minted: Record<string, string> = {};
      const first = connectInstalledHarnesses({
        store: runtime.store,
        service: runtime.service,
        human: { id: started.humanId, teamId: started.teamId },
        harnesses,
        knownTokens: {},
        url: "http://127.0.0.1:9414",
        mcpCommand: "/tmp/campfire",
        configPathFor: (harness) => defaultHarnessConfigPath(harness, env, cwd),
        onMintedToken: (harness, token) => {
          minted[harness] = token;
          rememberAgentCredential(harness, token);
        },
      });
      expect(first.connected).toEqual(["Codex", "OpenCode"]);
      expect(first.agents.map((agent) => agent.created)).toEqual([true, true]);
      expect(minted.codex).toMatch(/^cft_/);
      expect(minted.opencode).toMatch(/^cft_/);
      expect(minted.codex).not.toBe(minted.opencode);
      const codexText = readFileSync(defaultHarnessConfigPath("codex", env, cwd), "utf8");
      const openText = readFileSync(defaultHarnessConfigPath("opencode", env, cwd), "utf8");
      expect(codexText).toContain(minted.codex);
      expect(openText).toContain(minted.opencode);
      expect(codexText.split("# BEGIN campfire-connect").length - 1).toBe(1);
      expect(first.connected.join(" ")).not.toContain(minted.codex);

      rememberProfileAgents(
        first.agents.map((agent) => ({ id: agent.agentId, name: agent.name, harness: agent.harness })),
      );
      const status = formatStatus(loadProfile()!);
      expect(status).toContain("Codex (codex)");
      expect(status).toContain("OpenCode (opencode)");
      expect(status).toContain("Waiting for an agent to start work.");
      expect(status).not.toContain(minted.codex);
      expect(status).not.toContain(started.token);

      const again = connectInstalledHarnesses({
        store: runtime.store,
        service: runtime.service,
        human: { id: started.humanId, teamId: started.teamId },
        harnesses,
        knownTokens: {
          codex: minted.codex,
          opencode: minted.opencode,
        },
        url: "http://127.0.0.1:9414",
        mcpCommand: "/tmp/campfire",
        configPathFor: (harness) => defaultHarnessConfigPath(harness, env, cwd),
        onMintedToken: () => {
          throw new Error("a second connection must reuse the agent");
        },
      });
      expect(again.agents.map((agent) => agent.agentId)).toEqual(first.agents.map((agent) => agent.agentId));
      expect(again.agents.every((agent) => agent.created === false)).toBe(true);
      expect(runtime.store.listAgents(started.teamId)).toHaveLength(2);
      expect(readFileSync(defaultHarnessConfigPath("codex", env, cwd), "utf8").split("# BEGIN campfire-connect").length - 1).toBe(1);
    } finally {
      runtime.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("agent-created work", () => {
  it("lets the owning human see a second workspace, and requires a session for the goal", () => {
    const dir = mkdtempSync(join(tmpdir(), "campfire-work-"));
    const runtime = createRuntimeFromPath(join(dir, "campfire.db"));
    try {
      const started = beginHuman(runtime.store, runtime.service, runtime.config, "Ada");
      const [agent] = connectInstalledHarnesses({
        store: runtime.store,
        service: runtime.service,
        human: { id: started.humanId, teamId: started.teamId },
        harnesses: ["codex"],
        knownTokens: {},
        url: "http://127.0.0.1:9414",
        mcpCommand: "/tmp/campfire",
        configPathFor: () => join(dir, "codex.toml"),
        onMintedToken: () => undefined,
      }).agents;
      expect(agent).toBeDefined();
      const humanCtx: ActorContext = { actor: { actorId: started.humanId, actorType: "human" } };
      const agentCtx: ActorContext = { actor: { actorId: agent!.agentId, actorType: "agent" } };
      const privateWorkspace = runtime.service.createWorkspace(humanCtx, {
        teamId: started.teamId,
        name: "human notes",
      });
      const first = runtime.service.createWorkspace(agentCtx, {
        teamId: started.teamId,
        name: "billing deploy",
      });
      const second = runtime.service.createWorkspace(agentCtx, {
        teamId: started.teamId,
        name: "ledger export",
      });

      const humanView = runtime.service.listWorkspaces(humanCtx).map((workspace) => workspace.name).sort();
      expect(humanView).toEqual(["billing deploy", "human notes", "ledger export"]);
      const agentView = runtime.service.listWorkspaces(agentCtx).map((workspace) => workspace.name).sort();
      expect(agentView).toEqual(["billing deploy", "ledger export"]);

      const owners = runtime.store.listParticipants(first.id).map((participant) => participant.actor);
      expect(owners).toEqual(
        expect.arrayContaining([
          { actorId: agent!.agentId, actorType: "agent" },
          { actorId: started.humanId, actorType: "human" },
        ]),
      );
      expect(owners).toHaveLength(2);

      expect(() =>
        runtime.service.createGoal(agentCtx, { workspaceId: first.id, title: "Ship the billing migration safely" }),
      ).toThrow(Unauthorized);
      try {
        runtime.service.createGoal(agentCtx, { workspaceId: first.id, title: "Ship the billing migration safely" });
      } catch (error) {
        expect((error as Unauthorized).message).toMatch(/registered agent session/);
      }

      const session = runtime.service.registerAgentSession(agentCtx, {
        agentId: agent!.agentId,
        workspaceId: first.id,
        harness: "codex",
      });
      const goal = runtime.service.createGoal(
        { ...agentCtx, agentSessionId: session.id },
        { workspaceId: first.id, title: "Ship the billing migration safely" },
      );
      expect(goal.title).toBe("Ship the billing migration safely");
      const listed = runtime.service.listWorkspaces(humanCtx);
      expect(listed.find((workspace) => workspace.id === first.id)?.goalTitle).toBe(goal.title);
      expect(listed.find((workspace) => workspace.id === second.id)?.goalTitle).toBeUndefined();
      expect(runtime.store.listWorkspaces()).toHaveLength(3);
    } finally {
      runtime.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("viewer empty state", () => {
  it("says it is waiting for an agent in the static viewer and the published copy", () => {
    for (const path of ["src/viewer/static/app.js", "public/app.js"]) {
      const source = readFileSync(path, "utf8");
      expect(source).toContain("Waiting for an agent to start work.");
      expect(source).not.toContain("No workspaces");
    }
  });
});
