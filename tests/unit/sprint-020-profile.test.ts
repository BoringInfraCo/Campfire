import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { loadAnyProfile, loadCredentials, loadProfile, persistHumanProfile, readOperatorAgentToken, readOperatorHumanToken, resolveProfilePaths } from "../../src/bootstrap/profile.js";
import { canonicalEndpoint, loadRemoteProfile, persistRemoteProfile, recipientHandoffNames, resolveRemoteAccess } from "../../src/bootstrap/remote-profile.js";
import { prepareConnection } from "../../src/bootstrap/connect.js";
import { diagnoseHosted } from "../../src/bootstrap/doctor.js";

let dir: string;
let env: NodeJS.ProcessEnv;
const sample = {
  url: "https://shared.example.test/team-a/",
  humanId: "hum_recipient",
  humanName: "Alice",
  workspaceId: "ws_existing",
  workspaceName: "Investigate deploy",
  humanToken: "human-secret-sentinel",
  agents: [
    { id: "agt_alice_codex", name: "Alice Codex", harness: "codex", token: "codex-secret-sentinel" },
    { id: "agt_alice_opencode", name: "Alice OpenCode", harness: "opencode", token: "opencode-secret-sentinel" },
  ],
};
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "campfire-s020-profile-"));
  env = { CAMPFIRE_CONFIG_DIR: join(dir, "config"), CAMPFIRE_DATA_DIR: join(dir, "data") };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("Sprint 020 remote profile and credential boundaries", () => {
  it("recovers a remote identity without creating local shared state or storing profile secrets", () => {
    const paths = persistRemoteProfile(sample, env);
    expect(loadAnyProfile(env)).toMatchObject({ version: 2, mode: "remote", url: "https://shared.example.test/team-a", humanId: sample.humanId });
    const text = readFileSync(paths.configPath, "utf8");
    expect(text).not.toContain("sentinel");
    expect(text).not.toContain("databasePath");
    expect(existsSync(paths.dataDir)).toBe(false);
    expect(statSync(paths.credentialsPath).mode & 0o777).toBe(0o600);
    expect(() => loadProfile(env)).toThrow(/remote/i);
    expect(() => loadConfig(env)).toThrow(/remote/i);
    expect(loadConfig({ ...env, CAMPFIRE_DB: join(dir, "explicit.db") }).databasePath).toBe(join(dir, "explicit.db"));
  });
  it("preserves legacy v1 local profiles and accepts explicit v2 local profiles", () => {
    persistHumanProfile({ databasePath: join(dir, "local.db"), humanId: "hum_local", humanName: "Local", humanToken: "local-token" }, env);
    expect(loadProfile(env)?.version).toBe(1);
    expect(loadConfig(env).databasePath).toBe(join(dir, "local.db"));
    const paths = resolveProfilePaths(env);
    const local = JSON.parse(readFileSync(paths.configPath, "utf8"));
    writeFileSync(paths.configPath, JSON.stringify({ ...local, version: 2, mode: "local" }));
    expect(loadAnyProfile(env)).toMatchObject({ version: 2, mode: "local" });
  });
  it("requires supported profile versions and explicit v2 mode", () => {
    const paths = resolveProfilePaths(env);
    mkdirSync(paths.configDir, { recursive: true });
    for (const invalid of [{ version: 99 }, { version: 2 }, { version: 1, mode: "remote" }]) {
      writeFileSync(paths.configPath, JSON.stringify(invalid));
      expect(() => loadAnyProfile(env)).toThrow();
    }
  });
  it("normalizes matching endpoint overrides and binds credentials to the complete API path", () => {
    persistRemoteProfile(sample, env);
    expect(resolveRemoteAccess({}, env)).toMatchObject({ url: "https://shared.example.test/team-a", token: sample.humanToken, workspaceId: sample.workspaceId });
    expect(resolveRemoteAccess({ url: "https://SHARED.example.test:443/team-a/", harness: "codex" }, env).token).toBe(sample.agents[0]!.token);
    for (const url of ["https://other.example.test/team-a", "https://shared.example.test/team-b"]) {
      expect(() => resolveRemoteAccess({ url }, env)).toThrow(/credential|endpoint/i);
      expect(resolveRemoteAccess({ url, token: "explicit-secret" }, env).token).toBe("explicit-secret");
    }
    expect(loadRemoteProfile(env)?.url).toBe("https://shared.example.test/team-a");
  });
  it("does not fall back from a missing selected-harness token to another agent", () => {
    persistRemoteProfile({ ...sample, agents: [sample.agents[0]!] }, env);
    expect(() => resolveRemoteAccess({ harness: "opencode" }, env)).toThrow(/agent|credential/i);
    expect(recipientHandoffNames(loadRemoteProfile(env)!, "codex")).toEqual({ humanName: "Alice", agentName: "Alice Codex", agentId: "agt_alice_codex" });
    expect(readOperatorAgentToken(env)).toBeUndefined();
    expect(readOperatorAgentToken(env, "opencode")).toBeUndefined();
    expect(readOperatorAgentToken(env, "codex")).toBe(sample.agents[0]!.token);
    expect(readOperatorHumanToken({ ...env, CAMPFIRE_URL: "https://shared.example.test/team-b" })).toBeUndefined();
  });
  it("allows exact recovery and adding the other owned harness without replacing credentials", () => {
    persistRemoteProfile({ ...sample, agents: [sample.agents[0]!] }, env);
    persistRemoteProfile(sample, env);
    persistRemoteProfile(sample, env);
    expect(loadRemoteProfile(env)?.agents).toHaveLength(2);
    expect(loadCredentials(env)?.agents).toEqual({ codex: sample.agents[0]!.token, opencode: sample.agents[1]!.token });
    expect(() => persistRemoteProfile({ ...sample, agents: [{ ...sample.agents[0]!, token: "replacement" }] }, env)).toThrow(/conflict/i);
    expect(() => persistRemoteProfile({ ...sample, agents: [{ ...sample.agents[0]!, id: "different-agent" }] }, env)).toThrow(/conflict/i);
    expect(resolveRemoteAccess({ harness: "codex" }, env).token).toBe(sample.agents[0]!.token);
  });
  it("rejects unrelated profiles and orphan credentials without replacing files", () => {
    persistHumanProfile({ databasePath: join(dir, "local.db"), humanId: "hum_local", humanName: "Local", humanToken: "local-token" }, env);
    const paths = resolveProfilePaths(env);
    const before = [readFileSync(paths.configPath, "utf8"), readFileSync(paths.credentialsPath, "utf8")];
    expect(() => persistRemoteProfile(sample, env)).toThrow(/conflict/i);
    expect([readFileSync(paths.configPath, "utf8"), readFileSync(paths.credentialsPath, "utf8")]).toEqual(before);
    rmSync(paths.configPath);
    expect(() => persistRemoteProfile(sample, env)).toThrow(/conflict/i);
    expect(readFileSync(paths.credentialsPath, "utf8")).toBe(before[1]);
  });
  it("rejects secret or ambiguous endpoint destinations without echoing input", () => {
    for (const value of ["https://user:secret@shared.test/a", "https://shared.test/a?token=secret", "https://shared.test/a#secret", "https://shared.test/a%2fb", "https://shared.test/a/../b", "http://remote.test", "file:///secret"]) {
      expect(() => canonicalEndpoint(value)).toThrow();
      try { canonicalEndpoint(value); } catch (error) { expect(String(error)).not.toContain("secret"); }
    }
    expect(() => canonicalEndpoint("http://127.0.0.1:9414")).toThrow();
    expect(canonicalEndpoint("http://127.0.0.1:9414/", { allowLoopbackHttp: true })).toBe("http://127.0.0.1:9414");
  });
  it("preserves conflicting Campfire configs and permits precise recipient reconnects", () => {
    for (const harness of ["codex", "opencode"] as const) {
      const configPath = join(dir, harness === "codex" ? "config.toml" : "opencode.json");
      const input = { harness, configPath, mcpCommand: "/tmp/campfire", url: sample.url, agentToken: sample.agents[0]!.token, rejectConflicting: true };
      prepareConnection(input);
      const before = readFileSync(configPath, "utf8");
      expect(() => prepareConnection({ ...input, agentToken: "other-secret" })).toThrow(/conflict/i);
      expect(readFileSync(configPath, "utf8")).toBe(before);
      prepareConnection(input);
    }
  });
  it("does not append a second Codex Campfire table over an unmanaged block", () => {
    const configPath = join(dir, "config.toml");
    const original = '[mcp_servers.campfire]\ncommand = "unrelated"\n';
    writeFileSync(configPath, original);
    expect(() => prepareConnection({ harness: "codex", configPath, mcpCommand: "/tmp/campfire", url: sample.url, agentToken: "secret", rejectConflicting: true })).toThrow(/conflict/i);
    expect(readFileSync(configPath, "utf8")).toBe(original);
  });
  it("doctor rejects a valid token for the wrong recipient agent before workspace retrieval", async () => {
    const calls: string[] = [];
    const doctor = await diagnoseHosted(async (method) => {
      calls.push(method);
      return { actor: { actorType: "agent", actorId: "agt_owner_codex" } };
    }, { workspaceId: sample.workspaceId, harness: "codex", expectedAgentId: "agt_alice_codex", reachable: true });
    expect(doctor.ready).toBe(false);
    expect(doctor.nextAction).toBe("recipient_agent_mismatch");
    expect(calls).toEqual(["whoami"]);
  });
});
