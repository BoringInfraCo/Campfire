import { afterEach, describe, expect, it, vi } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activateJoinProfile, activateLocalProfile, joinProfileEnvironment, listLocalProfiles, loadAnyProfile, loadCredentials, pinnedMcpProfileEnvironment, resolveProfilePaths } from "../../src/bootstrap/profile.js";
import { resolveRemoteAccess } from "../../src/bootstrap/remote-profile.js";
import { runCliEntry } from "../../src/cli/index.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

function setup() {
  const root = mkdtempSync(join(tmpdir(), "campfire-profile-selection-"));
  roots.push(root);
  const env = { CAMPFIRE_CONFIG_DIR: join(root, "config"), CAMPFIRE_DATA_DIR: join(root, "data") };
  mkdirSync(env.CAMPFIRE_CONFIG_DIR, { recursive: true });
  return { root, env };
}

function writeProfile(env: NodeJS.ProcessEnv, suffix: string) {
  const paths = resolveProfilePaths(env);
  mkdirSync(paths.configDir, { recursive: true, mode: 0o700 });
  writeFileSync(paths.configPath, JSON.stringify({ version: 2, mode: "remote", url: "https://example.test/campfire", humanId: `hum_${suffix}`, humanName: suffix, workspaceId: `ws_${suffix}`, workspaceName: suffix, agents: [{ id: `agt_${suffix}`, name: "agent", harness: "opencode" }] }));
  writeFileSync(paths.credentialsPath, JSON.stringify({ humanToken: `human-${suffix}`, endpoint: "https://example.test/campfire", humanId: `hum_${suffix}`, workspaceId: `ws_${suffix}`, agentIds: { opencode: `agt_${suffix}` }, agents: { opencode: `agent-token-${suffix}` } }), { mode: 0o600 });
}

describe("local joined-profile selection", () => {
  it("pins MCP agent credentials to the original profile across profile switches", () => {
    const { env } = setup();
    writeProfile(env, "old");
    const child = joinProfileEnvironment(env, "ein_inv_pinned"); writeProfile(child, "new");
    activateJoinProfile(env, "ein_inv_pinned");
    expect(resolveRemoteAccess({ harness: "opencode" }, env).agent?.id).toBe("agt_new");
    const pinned = pinnedMcpProfileEnvironment(env.CAMPFIRE_CONFIG_DIR, env);
    expect(resolveRemoteAccess({ harness: "opencode" }, pinned)).toMatchObject({ agent: { id: "agt_old" }, token: "agent-token-old" });
    expect(resolveRemoteAccess({ harness: "opencode" }, pinnedMcpProfileEnvironment(child.CAMPFIRE_CONFIG_DIR!, env)).agent?.id).toBe("agt_new");
  });
  it("rejects symlinked or exposed credential files for pinned MCP", () => {
    const { env } = setup(); writeProfile(env, "old");
    const credentials = join(env.CAMPFIRE_CONFIG_DIR, "credentials.json");
    chmodSync(credentials, 0o644);
    expect(() => pinnedMcpProfileEnvironment(env.CAMPFIRE_CONFIG_DIR, env)).toThrow();
    chmodSync(credentials, 0o600);
    renameSync(credentials, `${credentials}.saved`); symlinkSync(`${credentials}.saved`, credentials);
    expect(() => pinnedMcpProfileEnvironment(env.CAMPFIRE_CONFIG_DIR, env)).toThrow();
  });
  it("rejects inherited token and endpoint overrides before starting pinned MCP", async () => {
    const { env } = setup(); writeProfile(env, "old");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("CAMPFIRE_MCP_PROFILE_DIR", env.CAMPFIRE_CONFIG_DIR);
    vi.stubEnv("CAMPFIRE_HARNESS", "opencode");
    vi.stubEnv("CAMPFIRE_URL", "https://untrusted.example");
    vi.stubEnv("CAMPFIRE_TOKEN", "");
    expect(await runCliEntry(["mcp"])).toBe(1);
    vi.stubEnv("CAMPFIRE_URL", ""); vi.stubEnv("CAMPFIRE_TOKEN", "untrusted-token");
    expect(await runCliEntry(["mcp"])).toBe(1);
  });
  it("preserves the original profile and credentials while selecting and switching workspaces", () => {
    const { env } = setup();
    writeProfile(env, "old");
    const oldPaths = resolveProfilePaths(env);
    const oldProfile = readFileSync(oldPaths.configPath, "utf8");
    const oldCredentials = readFileSync(oldPaths.credentialsPath, "utf8");
    const joined = joinProfileEnvironment(env, "ein_inv_123");
    expect(joined.CAMPFIRE_CONFIG_DIR).toBe(join(env.CAMPFIRE_CONFIG_DIR, "profiles", "join-ein_inv_123"));
    writeProfile(joined, "new");
    expect(loadAnyProfile(env)?.humanId).toBe("hum_old");
    activateJoinProfile(env, "ein_inv_123");
    expect(statSync(join(env.CAMPFIRE_CONFIG_DIR, "active-profile.json")).mode & 0o777).toBe(0o600);
    expect(loadAnyProfile(env)?.humanId).toBe("hum_new");
    expect(loadCredentials(env)?.humanToken).toBe("human-new");
    expect(resolveProfilePaths(env).dataDir).toBe(env.CAMPFIRE_DATA_DIR);
    expect(readFileSync(oldPaths.configPath, "utf8")).toBe(oldProfile);
    expect(readFileSync(oldPaths.credentialsPath, "utf8")).toBe(oldCredentials);
    expect(listLocalProfiles(env)).toEqual([
      { id: "default", active: false },
      { id: "join-ein_inv_123", active: true, mode: "remote", workspaceId: "ws_new", workspaceName: "new" },
    ]);
    activateLocalProfile(env, "default");
    expect(loadAnyProfile(env)?.humanId).toBe("hum_old");
    activateLocalProfile(env, "join-ein_inv_123");
    expect(loadAnyProfile(env)?.humanId).toBe("hum_new");
  });

  it("keeps separately prepared invitations addressable after another profile becomes active", () => {
    const { env } = setup();
    writeProfile(env, "original");
    const first = joinProfileEnvironment(env, "ein_inv_first");
    const second = joinProfileEnvironment(env, "ein_inv_second");
    writeProfile(first, "first");
    writeProfile(second, "second");
    activateJoinProfile(env, "ein_inv_first");
    expect(joinProfileEnvironment(env, "ein_inv_second").CAMPFIRE_CONFIG_DIR).toBe(second.CAMPFIRE_CONFIG_DIR);
    expect(loadAnyProfile(env)?.humanId).toBe("hum_first");
    // Explicit child environments do not inherit the root's active marker.
    expect(loadAnyProfile(second)?.humanId).toBe("hum_second");
    activateJoinProfile(env, "ein_inv_second");
    expect(loadAnyProfile(env)?.humanId).toBe("hum_second");
    activateLocalProfile(env, "join-ein_inv_first");
    expect(loadAnyProfile(env)?.humanId).toBe("hum_first");
    activateLocalProfile(env, "default");
    expect(loadAnyProfile(env)?.humanId).toBe("hum_original");
  });

  it("cannot activate a partially saved or mismatched profile", () => {
    const { env } = setup();
    writeProfile(env, "old");
    const joined = joinProfileEnvironment(env, "ein_inv_123");
    writeProfile(joined, "new");
    const child = resolveProfilePaths(joined);
    const credentials = JSON.parse(readFileSync(child.credentialsPath, "utf8"));
    credentials.workspaceId = "ws_other";
    writeFileSync(child.credentialsPath, JSON.stringify(credentials), { mode: 0o600 });
    expect(() => activateJoinProfile(env, "ein_inv_123")).toThrow(/profile selection is invalid/);
    expect(loadAnyProfile(env)?.humanId).toBe("hum_old");
    expect(existsSync(join(env.CAMPFIRE_CONFIG_DIR, "active-profile.json"))).toBe(false);
  });

  it("rejects malformed, world-readable, traversing and nested active markers", () => {
    const { env } = setup();
    writeProfile(env, "old");
    const marker = join(env.CAMPFIRE_CONFIG_DIR, "active-profile.json");
    writeFileSync(marker, '{"version":1,"active":"../../outside"}', { mode: 0o600 });
    expect(() => resolveProfilePaths(env)).toThrow(/profile selection is invalid/);
    expect(() => joinProfileEnvironment(env, "ein_inv_123")).toThrow(/profile selection is invalid/);
    activateLocalProfile(env, "default");
    expect(loadAnyProfile(env)?.humanId).toBe("hum_old");
    const backup = readdirSync(env.CAMPFIRE_CONFIG_DIR).find((name) => name.startsWith(".active-profile-invalid-"));
    expect(backup).toBeDefined();
    expect(readFileSync(join(env.CAMPFIRE_CONFIG_DIR, backup!), "utf8")).toBe('{"version":1,"active":"../../outside"}');
    writeFileSync(marker, '{"version":1,"active":"default"}');
    chmodSync(marker, 0o644);
    expect(() => resolveProfilePaths(env)).toThrow(/profile selection is invalid/);
    chmodSync(marker, 0o600);
    const child = joinProfileEnvironment(env, "ein_inv_123");
    mkdirSync(child.CAMPFIRE_CONFIG_DIR!, { recursive: true });
    writeFileSync(join(child.CAMPFIRE_CONFIG_DIR!, "active-profile.json"), '{"version":1,"active":"default"}', { mode: 0o600 });
    expect(() => resolveProfilePaths(child)).toThrow(/profile selection is invalid/);
  });

  it("restores the default without following an invalid marker symlink", () => {
    const { env, root } = setup(); writeProfile(env, "old");
    const outside = join(root, "outside"); writeFileSync(outside, "do not change");
    symlinkSync(outside, join(env.CAMPFIRE_CONFIG_DIR, "active-profile.json"));
    expect(() => resolveProfilePaths(env)).toThrow(/profile selection is invalid/);
    activateLocalProfile(env, "default");
    expect(loadAnyProfile(env)?.humanId).toBe("hum_old");
    expect(readFileSync(outside, "utf8")).toBe("do not change");
  });

  it("rejects symlinked profile directories and invalid invitation identifiers", () => {
    const { env, root } = setup();
    expect(() => joinProfileEnvironment(env, "../../outside")).toThrow(/profile selection is invalid/);
    symlinkSync(root, join(env.CAMPFIRE_CONFIG_DIR, "profiles"));
    expect(() => joinProfileEnvironment(env, "ein_inv_123")).toThrow(/profile selection is invalid/);
  });

  it("fails closed if a selected child directory is replaced by a symlink", () => {
    const { env, root } = setup();
    const child = joinProfileEnvironment(env, "ein_inv_123");
    writeProfile(child, "new");
    activateJoinProfile(env, "ein_inv_123");
    const moved = join(root, "moved-profile");
    renameSync(child.CAMPFIRE_CONFIG_DIR!, moved);
    symlinkSync(moved, child.CAMPFIRE_CONFIG_DIR!);
    expect(() => resolveProfilePaths(env)).toThrow(/profile selection is invalid/);
    expect(() => resolveProfilePaths(child)).toThrow(/profile selection is invalid/);
    unlinkSync(child.CAMPFIRE_CONFIG_DIR!);
    symlinkSync(join(root, "missing-profile"), child.CAMPFIRE_CONFIG_DIR!);
    expect(() => resolveProfilePaths(env)).toThrow(/profile selection is invalid/);
    expect(() => joinProfileEnvironment(env, "ein_inv_123")).toThrow(/profile selection is invalid/);
  });

  it("rejects non-private joined directories without changing the original directory", () => {
    const { env } = setup();
    chmodSync(env.CAMPFIRE_CONFIG_DIR, 0o755);
    writeProfile(env, "old");
    const child = joinProfileEnvironment(env, "ein_inv_123");
    writeProfile(child, "new");
    const profilesDir = join(env.CAMPFIRE_CONFIG_DIR, "profiles");
    chmodSync(profilesDir, 0o755);
    expect(() => activateJoinProfile(env, "ein_inv_123")).toThrow(/profile selection is invalid/);
    chmodSync(profilesDir, 0o700);
    chmodSync(child.CAMPFIRE_CONFIG_DIR!, 0o750);
    expect(() => activateJoinProfile(env, "ein_inv_123")).toThrow(/profile selection is invalid/);
    chmodSync(child.CAMPFIRE_CONFIG_DIR!, 0o700);
    activateJoinProfile(env, "ein_inv_123");
    expect(statSync(env.CAMPFIRE_CONFIG_DIR).mode & 0o777).toBe(0o755);
  });

  it("fails closed if an active child's profile or credential file disappears, is linked, or changes binding", () => {
    const { env, root } = setup();
    const child = joinProfileEnvironment(env, "ein_inv_123");
    writeProfile(child, "new");
    const paths = resolveProfilePaths(child);
    const profile = readFileSync(paths.configPath, "utf8");
    const credentials = readFileSync(paths.credentialsPath, "utf8");
    activateJoinProfile(env, "ein_inv_123");

    unlinkSync(paths.configPath);
    expect(() => resolveProfilePaths(env)).toThrow(/profile selection is invalid/);
    symlinkSync(join(root, "missing-profile"), paths.configPath);
    expect(() => resolveProfilePaths(env)).toThrow(/profile selection is invalid/);
    unlinkSync(paths.configPath);
    writeFileSync(paths.configPath, profile, { mode: 0o644 });

    unlinkSync(paths.credentialsPath);
    expect(() => resolveProfilePaths(env)).toThrow(/profile selection is invalid/);
    symlinkSync(paths.configPath, paths.credentialsPath);
    expect(() => resolveProfilePaths(env)).toThrow(/profile selection is invalid/);
    unlinkSync(paths.credentialsPath);
    writeFileSync(paths.credentialsPath, credentials, { mode: 0o600 });
    chmodSync(paths.credentialsPath, 0o644);
    expect(() => resolveProfilePaths(env)).toThrow(/profile selection is invalid/);
    chmodSync(paths.credentialsPath, 0o600);
    const mismatched = JSON.parse(credentials);
    mismatched.workspaceId = "ws_other";
    writeFileSync(paths.credentialsPath, JSON.stringify(mismatched));
    expect(() => resolveProfilePaths(env)).toThrow(/profile selection is invalid/);
  });

  it("rejects a dangling or linked active marker instead of falling back to the default", () => {
    const { env, root } = setup();
    const marker = join(env.CAMPFIRE_CONFIG_DIR, "active-profile.json");
    symlinkSync(join(root, "absent"), marker);
    expect(() => resolveProfilePaths(env)).toThrow(/profile selection is invalid/);
    unlinkSync(marker);
    const target = join(root, "target.json");
    writeFileSync(target, '{"version":1,"active":"default"}', { mode: 0o600 });
    symlinkSync(target, marker);
    expect(() => resolveProfilePaths(env)).toThrow(/profile selection is invalid/);
  });

  it("ignores incomplete pending profiles when listing other choices", () => {
    const { env } = setup();
    const pending = joinProfileEnvironment(env, "ein_inv_pending");
    mkdirSync(pending.CAMPFIRE_CONFIG_DIR!, { recursive: true, mode: 0o700 });
    writeFileSync(join(pending.CAMPFIRE_CONFIG_DIR!, "pending-enrollment.json"), "{}", { mode: 0o600 });
    expect(listLocalProfiles(env)).toEqual([{ id: "default", active: true }]);
    expect(() => activateJoinProfile(env, "ein_inv_pending")).toThrow(/profile selection is invalid/);
  });
});
