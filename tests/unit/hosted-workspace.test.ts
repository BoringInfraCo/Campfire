import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { commandForNextAction, nextStepsForError } from "../../src/cli/recovery.js";
import { ValidationError } from "../../src/domain/errors.js";
import { persistRemoteProfile } from "../../src/bootstrap/remote-profile.js";
import { activateLocalProfile, loadAnyProfile, resolveProfilePaths } from "../../src/bootstrap/profile.js";
import {
  afterVerifiedCutover,
  hostedPublish,
  parsePlacementAnswer,
  resolveHostedCredential,
  resolveWorkspacePlacement,
  resumeHostedWorkspace,
  selectHostedWorkspaceProfile,
  type HostedTokenCall,
} from "../../src/cli/hosted-workspace.js";

const ENDPOINT = "https://example.com/campfire";

describe("hosted workspace placement", () => {
  it("keeps scripted callers on the current backend when no mode flag is set", async () => {
    await expect(resolveWorkspacePlacement({ hosted: false, local: false, stdinIsTty: false })).resolves.toBe("current");
  });

  it("requires an explicit hosted or local-only answer", () => {
    expect(parsePlacementAnswer("hosted")).toBe("hosted");
    expect(parsePlacementAnswer(" local-only ")).toBe("local");
    expect(() => parsePlacementAnswer("")).toThrow(/No workspace was created/);
  });

  it("asks once on a terminal and can choose hosted", async () => {
    const prompt = vi.fn(async () => "hosted" as const);
    await expect(resolveWorkspacePlacement({ hosted: false, local: false, stdinIsTty: true, prompt })).resolves.toBe("hosted");
    expect(prompt).toHaveBeenCalledOnce();
  });

  it("does not issue an invitation unless publication cut over", async () => {
    const issue = vi.fn(async () => "link");
    const publish = vi.fn(async () => ({ receipt: { state: "verified" } }));
    await expect(afterVerifiedCutover(publish, issue)).rejects.toMatchObject({ details: { nextAction: "retry_publish" } });
    expect(issue).not.toHaveBeenCalled();
    publish.mockResolvedValueOnce({ receipt: { state: "cut_over" } });
    await expect(afterVerifiedCutover(publish, issue)).resolves.toBe("link");
    expect(issue).toHaveBeenCalledOnce();
  });

  function isolatedEnv(root: string): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      CAMPFIRE_CONFIG_DIR: join(root, "config"),
      CAMPFIRE_DATA_DIR: join(root, "data"),
      HOME: join(root, "home"),
    };
    delete env.CAMPFIRE_URL;
    delete env.CAMPFIRE_TOKEN;
    delete env.XDG_CONFIG_HOME;
    delete env.XDG_DATA_HOME;
    return env;
  }

  it("preserves the previous remote profile when the existing agent can read the new workspace", async () => {
    const root = mkdtempSync(join(tmpdir(), "campfire-hosted-profile-"));
    const env = isolatedEnv(root);
    const humanToken = `cft_${"a".repeat(32)}`;
    const agentToken = `cft_${"b".repeat(32)}`;
    const nextHumanToken = `cft_${"c".repeat(32)}`;
    try {
    persistRemoteProfile({
      url: ENDPOINT,
      humanId: "hum_sergio",
      humanName: "Sergio",
      workspaceId: "ws_old",
      workspaceName: "Old",
      humanToken,
      agents: [{ id: "agt_codex", name: "Codex", harness: "codex", token: agentToken }],
    }, env);
    const paths = resolveProfilePaths(env);
    const oldProfile = readFileSync(paths.configPath, "utf8");
    const oldCredentials = readFileSync(paths.credentialsPath, "utf8");
    const methods: string[] = [];
    const call: HostedTokenCall = async (token, method, params) => {
      methods.push(method);
      if (method === "get_workspace") {
        expect(token).toBe(agentToken);
        expect(loadAnyProfile(env)?.workspaceId).toBe("ws_old");
        return { workspace: { id: params.workspaceId } };
      }
      return {};
    };
    await selectHostedWorkspaceProfile({
      endpoint: ENDPOINT,
      humanId: "hum_sergio",
      humanName: "Sergio",
      workspaceId: "ws_new",
      workspaceName: "New",
      humanToken: nextHumanToken,
      allowLoopbackHttp: false,
      call,
    }, env);
    expect(methods).toEqual(["invite_workspace", "join_workspace", "get_workspace"]);
    expect(readFileSync(paths.configPath, "utf8")).toBe(oldProfile);
    expect(readFileSync(paths.credentialsPath, "utf8")).toBe(oldCredentials);
    expect(loadAnyProfile(env)?.workspaceId).toBe("ws_new");
    const selectedCredentials = readFileSync(join(resolveProfilePaths(env).configDir, "credentials.json"), "utf8");
    expect(selectedCredentials).not.toContain(humanToken);
    expect(selectedCredentials).toContain(agentToken);
    expect(selectedCredentials).not.toContain("sourceDatabasePath");
    activateLocalProfile(env, "default");
    expect(loadAnyProfile(env)?.workspaceId).toBe("ws_old");
    expect(hostedPublish.run).toBeTypeOf("function");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not write the new profile when the existing agent cannot read the workspace", async () => {
    const root = mkdtempSync(join(tmpdir(), "campfire-hosted-denied-"));
    const env = isolatedEnv(root);
    try {
      persistRemoteProfile({
        url: ENDPOINT,
        humanId: "hum_sergio",
        humanName: "Sergio",
        workspaceId: "ws_old",
        workspaceName: "Old",
        humanToken: `cft_${"a".repeat(32)}`,
        agents: [{ id: "agt_codex", name: "Codex", harness: "codex", token: `cft_${"b".repeat(32)}` }],
      }, env);
      const call: HostedTokenCall = async (_token, method) => {
        if (method === "get_workspace") throw new Error("denied");
        return {};
      };
      await expect(selectHostedWorkspaceProfile({
        endpoint: ENDPOINT,
        humanId: "hum_sergio",
        humanName: "Sergio",
        workspaceId: "ws_new",
        workspaceName: "New",
        humanToken: `cft_${"c".repeat(32)}`,
        allowLoopbackHttp: false,
        call,
      }, env)).rejects.toThrow(/may already exist/);
      expect(loadAnyProfile(env)?.workspaceId).toBe("ws_old");
      expect(existsSync(join(root, "config", "profiles"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("enrolls one agent when the profile has no agent token and reuses the pending request", async () => {
    const root = mkdtempSync(join(tmpdir(), "campfire-hosted-enroll-"));
    const env = isolatedEnv(root);
    const requestIds: string[] = [];
    try {
      persistRemoteProfile({
        url: ENDPOINT,
        humanId: "hum_sergio",
        humanName: "Sergio",
        workspaceId: "ws_old",
        workspaceName: "Old",
        humanToken: `cft_${"a".repeat(32)}`,
        agents: [{ id: "agt_named", name: "OpenCode", harness: "opencode", token: `cft_${"b".repeat(32)}` }],
      }, env);
      const paths = resolveProfilePaths(env);
      const credentials = JSON.parse(readFileSync(paths.credentialsPath, "utf8")) as { agents: Record<string, string>; agentIds: Record<string, string> };
      credentials.agents = {};
      credentials.agentIds = {};
      writeFileSync(paths.credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
      let reads = 0;
      const call: HostedTokenCall = async (token, method, params) => {
        if (method === "enroll_owned_agent") {
          expect(params.harness).toBe("opencode");
          expect(params.tokenHash).toEqual(expect.any(String));
          expect(String(params.tokenHash)).not.toBe(token);
          requestIds.push(String(params.requestId));
          return {
            workspaceId: "ws_new",
            humanId: "hum_sergio",
            requestId: params.requestId,
            agent: { id: "agt_enrolled", name: "OpenCode", harness: "opencode" },
          };
        }
        if (method === "whoami") return { actor: { actorId: "agt_enrolled", actorType: "agent" } };
        if (method === "get_workspace") {
          reads += 1;
          if (reads === 1) throw new Error("read failed");
          expect(loadAnyProfile(env)?.workspaceId).toBe("ws_old");
          return { workspace: { id: params.workspaceId } };
        }
        throw new Error(method);
      };
      await expect(selectHostedWorkspaceProfile({
        endpoint: ENDPOINT,
        humanId: "hum_sergio",
        humanName: "Sergio",
        workspaceId: "ws_new",
        workspaceName: "New",
        humanToken: `cft_${"a".repeat(32)}`,
        allowLoopbackHttp: false,
        call,
      }, env)).rejects.toThrow(/may already exist/);
      expect(loadAnyProfile(env)?.workspaceId).toBe("ws_old");
      expect(existsSync(join(root, "config", "profiles"))).toBe(false);
      const pending = join(root, "config", `pending-hosted-agent-ein_ws_new.json`);
      expect(existsSync(pending)).toBe(true);
      await selectHostedWorkspaceProfile({
        endpoint: ENDPOINT,
        humanId: "hum_sergio",
        humanName: "Sergio",
        workspaceId: "ws_new",
        workspaceName: "New",
        humanToken: `cft_${"a".repeat(32)}`,
        allowLoopbackHttp: false,
        call,
      }, env);
      expect(requestIds).toEqual([requestIds[0], requestIds[0]]);
      expect(loadAnyProfile(env)?.agents?.[0]?.id).toBe("agt_enrolled");
      expect(loadAnyProfile(env)?.agents?.[0]?.harness).toBe("opencode");
      expect(existsSync(pending)).toBe(false);
      expect(readFileSync(paths.configPath, "utf8")).toContain("ws_old");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses a url and token when no admitted remote profile is active", () => {
    const root = mkdtempSync(join(tmpdir(), "campfire-hosted-credential-"));
    const env = isolatedEnv(root);
    try {
      expect(resolveHostedCredential({
        url: "https://boringinfra.company/campfire",
        token: `cft_${"d".repeat(32)}`,
        allowLoopback: false,
      }, env)).toBeUndefined();
      persistRemoteProfile({
        url: ENDPOINT,
        humanId: "hum_sergio",
        humanName: "Sergio",
        workspaceId: "ws_old",
        workspaceName: "Old",
        humanToken: `cft_${"a".repeat(32)}`,
        agents: [{ id: "agt_codex", name: "Codex", harness: "codex", token: `cft_${"b".repeat(32)}` }],
      }, env);
      expect(resolveHostedCredential({
        url: ENDPOINT,
        token: `cft_${"d".repeat(32)}`,
        allowLoopback: false,
      }, env)?.token).toBe(`cft_${"a".repeat(32)}`);
      expect(() => resolveHostedCredential({
        url: "https://other.example/campfire",
        token: `cft_${"a".repeat(32)}`,
        allowLoopback: false,
      }, env)).toThrow(/cannot be replaced/);
      expect(loadAnyProfile(env)?.workspaceId).toBe("ws_old");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("names resume for a failed agent read and does not turn admission into resume", () => {
    const error = new ValidationError("Hosted workspace ws_new was created", {
      field: "agent",
      nextAction: "retry_hosted_create",
      workspaceId: "ws_new",
    });
    expect(nextStepsForError(error, "create-workspace")[0]?.command).toBe(
      "campfire create-workspace --hosted --resume ws_new",
    );
    expect(commandForNextAction("hosted_admission_required")).toBe("campfire create-workspace --hosted --name <name>");
    expect(commandForNextAction("use_admitted_team")).toBe("campfire create-workspace --hosted --name <name>");
  });

  it("refuses a resume id that is not a workspace id before any call", async () => {
    await expect(resumeHostedWorkspace({ workspaceId: "", allowLoopback: false })).rejects.toThrow(/No workspace was created/);
    await expect(resumeHostedWorkspace({ workspaceId: "../ws_new", allowLoopback: false })).rejects.toThrow(/No workspace was created/);
  });
});
