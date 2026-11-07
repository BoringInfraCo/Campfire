/**
 * Unknown options fail before a command runs. Root help stays a short map.
 */
import { describe, expect, it, vi } from "vitest";
import { formatCommandUsage, formatFullUsage, formatUsage } from "../../src/cli/catalog.js";
import { runCliEntry } from "../../src/cli/index.js";
import { positionalLimit, positionalLimitFor } from "../../src/cli/strict-args.js";
import { commandSpec } from "../../src/cli/catalog.js";

describe("strict CLI options", () => {
  it("rejects an unknown option before capabilities prints the manifest", async () => {
    const errors: string[] = [];
    const logs: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    const code = await runCliEntry(["capabilities", "--definitely-not-real", "--output", "json"]);
    expect(code).toBe(2);
    expect(logs.join("\n")).toBe("");
    const text = errors.join("\n");
    expect(text).toContain("does not accept --definitely-not-real");
    expect(text).toContain("campfire capabilities --help");
    expect(text).not.toContain("cli_command_manifest");
    vi.restoreAllMocks();
  });

  it("rejects an extra positional and still accepts a documented capabilities search", async () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
    expect(await runCliEntry(["status", "ws_one", "extra"])).toBe(2);
    expect(errors.join("\n")).toContain("does not take that many arguments");
    vi.restoreAllMocks();
  });

  it("keeps root help short and the full catalog behind --all", () => {
    const root = formatUsage();
    const full = formatFullUsage();
    expect(root.split("\n").length).toBeLessThan(40);
    expect(root).toContain("Start here:");
    expect(root).toContain("campfire status");
    expect(root).not.toContain("Administration:");
    expect(full).toContain("Administration:");
    expect(full).toContain("campfire seed [--reset]");
    const help = formatCommandUsage("actions");
    expect(help).toContain("Summary:");
    expect(help).toContain("Options:");
    expect(help).toContain("--workspace");
    expect(help).toContain("Effects:");
    expect(positionalLimit("campfire status [workspaceId] [--output auto|human|json]")).toBe(1);
    expect(positionalLimitFor(commandSpec("actions"), ["approve", "act_1"])).toBe(2);
    expect(positionalLimitFor(commandSpec("actions"), ["list"])).toBe(1);
  });
});
