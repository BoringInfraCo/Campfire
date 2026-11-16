import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseJsonc } from "jsonc-parser";
import { parse as parseToml } from "smol-toml";
import { afterEach, describe, expect, it } from "vitest";
import { assertConnectionCompatible, defaultHarnessConfigPath, detectOpenCodeMajor, prepareConnection } from "../../src/bootstrap/connect.js";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("independent harness connections", () => {
  for (const harness of ["opencode", "codex"] as const) {
    it(`preserves the existing ${harness} connection while adding and reconnecting the joined workspace`, () => {
      const dir = mkdtempSync(join(tmpdir(), "campfire-named-harness-")); directories.push(dir);
      const configPath = join(dir, harness === "codex" ? "config.toml" : "opencode.json");
      if (harness === "opencode") writeFileSync(configPath, JSON.stringify({ model: "unchanged", mcp: { other: { type: "remote", url: "https://other.test" } } }));
      else writeFileSync(configPath, 'model = "unchanged"\n');
      const original = { harness, configPath, mcpCommand: "/tmp/campfire", url: "https://one.example", agentToken: "old-token", rejectConflicting: true };
      prepareConnection(original);
      const joined = { ...original, serverName: "campfire_ws_new", url: "https://two.example", agentToken: "new-token" };
      assertConnectionCompatible(joined);
      const plan = prepareConnection(joined);
      expect(plan.serverName).toBe("campfire_ws_new");
      expect(JSON.stringify(plan)).not.toContain("token");
      expect(statSync(configPath).mode & 0o777).toBe(0o600);
      const updated = readFileSync(configPath, "utf8");
      if (harness === "opencode") {
        const data = JSON.parse(updated);
        expect(data.model).toBe("unchanged");
        expect(data.mcp.other.url).toBe("https://other.test");
        expect(data.mcp.campfire.environment.CAMPFIRE_TOKEN).toBe("old-token");
        expect(data.mcp.campfire_ws_new.environment.CAMPFIRE_TOKEN).toBe("new-token");
      } else {
        expect(updated).toContain('[mcp_servers.campfire]\n');
        expect(updated).toContain('[mcp_servers.campfire_ws_new]\n');
        expect(updated).toContain('CAMPFIRE_TOKEN = "old-token"');
        expect(updated).toContain('CAMPFIRE_TOKEN = "new-token"');
      }
      prepareConnection(joined);
      expect(readFileSync(configPath, "utf8")).toBe(updated);
      expect(() => prepareConnection({ ...joined, agentToken: "different-token" })).toThrow(/conflict/i);
      expect(readFileSync(configPath, "utf8")).toBe(updated);
      prepareConnection(original);
      expect(readFileSync(configPath, "utf8")).toBe(updated);
    });
  }

  it("rejects invalid names without exposing credentials or creating a config", () => {
    const dir = mkdtempSync(join(tmpdir(), "campfire-invalid-harness-")); directories.push(dir);
    const configPath = join(dir, "opencode.json");
    expect(() => prepareConnection({ harness: "opencode", configPath, mcpCommand: "/tmp/campfire", url: "https://one.example", agentToken: "never-print-this", serverName: 'campfire_bad"name' })).toThrow(/invalid/i);
    expect(() => readFileSync(configPath)).toThrow();
  });

  it("refuses a symlinked harness configuration without modifying its target", () => {
    const dir = mkdtempSync(join(tmpdir(), "campfire-harness-link-")); directories.push(dir);
    const target = join(dir, "original.json"), link = join(dir, "opencode.json");
    const original = '{"mcp":{}}\n'; writeFileSync(target, original); symlinkSync(target, link);
    expect(() => prepareConnection({ harness: "opencode", configPath: link, mcpCommand: "/tmp/campfire", url: "https://one.example", agentToken: "secret", serverName: "campfire_new" })).toThrow(/conflict/i);
    expect(readFileSync(target, "utf8")).toBe(original);
  });

  it("does not overwrite an unmanaged named server", () => {
    const dir = mkdtempSync(join(tmpdir(), "campfire-occupied-harness-")); directories.push(dir);
    const configPath = join(dir, "config.toml");
    const original = '[mcp_servers.campfire_ws_new]\ncommand = "not-campfire"\n';
    writeFileSync(configPath, original);
    expect(() => prepareConnection({ harness: "codex", configPath, mcpCommand: "/tmp/campfire", url: "https://one.example", agentToken: "secret", serverName: "campfire_ws_new" })).toThrow(/conflict/i);
    expect(readFileSync(configPath, "utf8")).toBe(original);
  });

  it("preserves an existing Codex inline server and validates the resulting TOML", () => {
    const dir = mkdtempSync(join(tmpdir(), "campfire-inline-toml-")); directories.push(dir);
    const configPath = join(dir, "config.toml");
    const original = '[mcp_servers]\ncampfire = { command = "old", args = ["mcp"] }\n';
    writeFileSync(configPath, original);
    const input = { harness: "codex", configPath, mcpCommand: "/tmp/campfire", url: "https://one.example", agentToken: "secret", rejectConflicting: true };
    expect(() => prepareConnection(input)).toThrow(/conflict/i);
    expect(readFileSync(configPath, "utf8")).toBe(original);
    prepareConnection({ ...input, serverName: "campfire_new" });
    const parsed = parseToml(readFileSync(configPath, "utf8")) as any;
    expect(parsed.mcp_servers.campfire.command).toBe("old");
    expect(parsed.mcp_servers.campfire_new.command).toBe("/tmp/campfire");
  });

  it("refuses to extend an inline Codex root table without changing it", () => {
    const dir = mkdtempSync(join(tmpdir(), "campfire-inline-root-")); directories.push(dir);
    const configPath = join(dir, "config.toml");
    const original = 'mcp_servers = { campfire = { command = "old", args = ["mcp"] } }\n';
    writeFileSync(configPath, original);
    expect(() => prepareConnection({ harness: "codex", configPath, mcpCommand: "/tmp/campfire", url: "https://one.example", agentToken: "secret", serverName: "campfire_new", rejectConflicting: true })).toThrow(/conflict/i);
    expect(readFileSync(configPath, "utf8")).toBe(original);
    expect(() => parseToml(original)).not.toThrow();
  });

  it("adds a v2 server without losing JSONC comments, unrelated settings or the legacy connection", () => {
    const dir = mkdtempSync(join(tmpdir(), "campfire-opencode-v2-")); directories.push(dir);
    const configPath = join(dir, "opencode.jsonc");
    const original = `{
  // Keep the user's model and this comment.
  "model": "unchanged",
  "mcp": {
    "campfire": { "type": "local", "command": ["old-campfire", "mcp"], "enabled": true, "environment": { "CAMPFIRE_TOKEN": "old-token" } },
    "servers": {
      // Keep this unrelated server.
      "other": { "type": "remote", "url": "https://other.test" },
    },
  },
}\n`;
    writeFileSync(configPath, original);
    const input = { harness: "opencode", configPath, mcpCommand: "/tmp/campfire", url: "https://two.example", agentToken: "new-token", serverName: "campfire_ws_new", opencodeMajor: 2 as const };
    prepareConnection(input);
    const updated = readFileSync(configPath, "utf8");
    expect(updated).toContain("// Keep the user's model and this comment.");
    expect(updated).toContain("// Keep this unrelated server.");
    const data = parseJsonc(updated, [], { allowTrailingComma: true });
    expect(data.model).toBe("unchanged");
    expect(data.mcp.campfire.environment.CAMPFIRE_TOKEN).toBe("old-token");
    expect(data.mcp.servers.other.url).toBe("https://other.test");
    expect(data.mcp.servers.campfire_ws_new).toMatchObject({ type: "local", disabled: false, command: ["/tmp/campfire", "mcp"], environment: { CAMPFIRE_TOKEN: "new-token" } });
    expect(data.mcp.servers.campfire_ws_new.codemode).toBe(false);
    expect(data.mcp.servers.campfire_ws_new).not.toHaveProperty("enabled");
    prepareConnection(input);
    expect(readFileSync(configPath, "utf8")).toBe(updated);
  });

  it("rejects duplicate JSONC keys and leaves the original bytes intact", () => {
    const dir = mkdtempSync(join(tmpdir(), "campfire-duplicate-jsonc-")); directories.push(dir);
    const configPath = join(dir, "opencode.jsonc");
    const original = '{ "mcp": {}, /* do not discard */ "mcp": {} }\n';
    writeFileSync(configPath, original);
    expect(() => prepareConnection({ harness: "opencode", configPath, mcpCommand: "/tmp/campfire", url: "https://one.example", agentToken: "secret", serverName: "campfire_ws_new", opencodeMajor: 2 })).toThrow(/conflict/i);
    expect(readFileSync(configPath, "utf8")).toBe(original);
  });

  it("detects supported OpenCode major versions without echoing process output", () => {
    expect(detectOpenCodeMajor({}, () => ({ status: 0, stdout: "1.9.2\n" }))).toBe(1);
    expect(detectOpenCodeMajor({}, () => ({ status: 0, stdout: "opencode v2.3.0\n" }))).toBe(2);
    for (const result of [{ status: 1, stdout: "SECRET" }, { status: 0, stdout: "opencode v3.0.0" }, { status: null, error: new Error("SECRET") }]) {
      try { detectOpenCodeMajor({}, () => result); throw new Error("expected an error"); }
      catch (error) { expect(String(error)).not.toContain("SECRET"); expect(String(error)).toContain("OpenCode"); }
    }
  });

  it("uses an existing global JSONC file and can avoid project-local config", () => {
    const dir = mkdtempSync(join(tmpdir(), "campfire-config-path-")); directories.push(dir);
    const configRoot = join(dir, "xdg");
    const globalConfig = join(configRoot, "opencode", "opencode.jsonc");
    require("node:fs").mkdirSync(join(configRoot, "opencode"), { recursive: true });
    writeFileSync(globalConfig, "{}\n");
    writeFileSync(join(dir, "opencode.json"), "{}\n");
    expect(defaultHarnessConfigPath("opencode", { HOME: dir, XDG_CONFIG_HOME: configRoot }, dir, 2, true)).toBe(globalConfig);
    expect(defaultHarnessConfigPath("opencode", { HOME: dir, XDG_CONFIG_HOME: configRoot }, dir, 1, true)).toBe(globalConfig);
    expect(defaultHarnessConfigPath("opencode", { HOME: dir, XDG_CONFIG_HOME: configRoot }, dir, 2)).toBe(join(dir, "opencode.json"));
  });
});
