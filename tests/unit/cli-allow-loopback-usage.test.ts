/**
 * v1.29.4 rejects any option the catalog does not name. --allow-loopback was
 * missing from publish and the join variants, so they exited 2 in the installed
 * binary. This guards the catalog and the strict check together.
 */
import { describe, expect, it } from "vitest";
import { commandSpec, commandSpecForArgs } from "../../src/cli/catalog.js";
import { assertKnownInvocation } from "../../src/cli/strict-args.js";

function accepts(command: "publish" | "join" | "invite-teammate", flags: Record<string, string | boolean>, positionals: string[] = []): void {
  const spec = commandSpec(command); // the gate in src/cli/index.ts uses the base spec
  assertKnownInvocation(spec, { flags, positionals });
}

describe("--allow-loopback is accepted by the strict-argument check", () => {
  it("publish", () => {
    expect(() => accepts("publish", { url: "https://x", "allow-loopback": true, "dry-run": true })).not.toThrow();
    expect(commandSpec("publish").usage).toContain("--allow-loopback");
  });

  it("join --invitation-link", () => {
    expect(() => accepts("join", { "invitation-link": "link", "allow-loopback": true })).not.toThrow();
    expect(commandSpecForArgs("join", { "invitation-link": "link" }).usage).toContain("--allow-loopback");
  });

  it("join --invitation-file", () => {
    expect(() => accepts("join", { "invitation-file": "f", "human-name": "A", harness: "codex", "allow-loopback": true })).not.toThrow();
    expect(commandSpecForArgs("join", { "invitation-file": "f" }).usage).toContain("--allow-loopback");
  });

  it("invite-teammate", () => {
    expect(() => accepts("invite-teammate", { "allow-loopback": true }, ["ws_1"])).not.toThrow();
  });

  it("still rejects a flag the catalog does not name", () => {
    expect(() => accepts("publish", { url: "https://x", "not-a-flag": true })).toThrow(/does not accept --not-a-flag/);
  });
});
