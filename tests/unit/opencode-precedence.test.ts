import { describe, expect, it } from "vitest";
import { assertOpenCodeUnshadowed, assertOpenCodeV1Effective } from "../../src/bootstrap/connect.js";

const target = "/tmp/private/opencode/opencode.json";
const name = "campfire_joined";
const document = (path: string, hasAlias: boolean) => ({ type: "document", path, info: { mcp: { servers: hasAlias ? { [name]: { environment: { CAMPFIRE_TOKEN: "secret-never-print" } } } : {} } } });
const runner = (sources: unknown) => () => ({ status: 0, stdout: JSON.stringify(sources) });

describe("OpenCode v2 precedence preflight", () => {
  it("permits other sources and confirms the written connection is loaded", () => {
    const sources = [{ type: "directory", path: "/tmp/project" }, document(target, true), document("/tmp/project/opencode.json", false)];
    expect(() => assertOpenCodeUnshadowed(target, name, {}, true, runner(sources))).not.toThrow();
    expect(() => assertOpenCodeUnshadowed(target, name, {}, false, runner([]))).not.toThrow();
  });
  it("rejects a duplicate in any other source without exposing configuration", () => {
    const sources = [document(target, true), document("/tmp/project/opencode.json", true)];
    try { assertOpenCodeUnshadowed(target, name, {}, true, runner(sources)); throw new Error("expected failure"); }
    catch (error) { expect(String(error)).toContain("Could not verify"); expect(String(error)).not.toContain("secret-never-print"); }
  });
  it("fails closed for missing connection, malformed output and process errors", () => {
    for (const run of [runner([]), runner({ unexpected: true }), runner([{ type: "document", path: target, info: { mcp: { servers: null } } }]), () => ({ status: 1, stdout: "secret-never-print" })]) {
      expect(() => assertOpenCodeUnshadowed(target, name, {}, true, run)).toThrow("Could not verify");
    }
  });
});

describe("OpenCode v1 merged configuration", () => {
  const config = { serverName: name, profileDir: "/private/profile", mcpCommand: "/bin/campfire" };
  const entry = { type: "local", enabled: true, command: ["/bin/campfire", "mcp"], environment: { CAMPFIRE_HARNESS: "opencode", CAMPFIRE_MCP_PROFILE_DIR: "/private/profile" } };
  const merged = (value: unknown) => ({ mcp: { [name]: value } });
  it("allows absence before enrollment and requires the exact bound entry after writing", () => {
    expect(() => assertOpenCodeV1Effective(config, {}, false, runner({}))).not.toThrow();
    expect(() => assertOpenCodeV1Effective(config, {}, true, runner(merged(entry)))).not.toThrow();
    expect(() => assertOpenCodeV1Effective(config, {}, true, runner({}))).toThrow();
  });
  it("rejects merged command, profile, endpoint, token and extra environment overrides", () => {
    const altered = [
      { ...entry, command: ["/attacker", "mcp"] },
      { ...entry, environment: { ...entry.environment, CAMPFIRE_MCP_PROFILE_DIR: "/different" } },
      { ...entry, environment: { ...entry.environment, CAMPFIRE_TOKEN: "***" } },
      { ...entry, environment: { ...entry.environment, CAMPFIRE_URL: "https://wrong.invalid" } },
      { ...entry, environment: { ...entry.environment, NODE_OPTIONS: "--require=bad" } },
    ];
    for (const value of altered) expect(() => assertOpenCodeV1Effective(config, {}, true, runner(merged(value)))).toThrow("Could not verify");
  });
});
