import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyChannelPins,
  hexToSri,
  INSTALL_CHANNEL_ARCHIVES,
  parseChecksumFile,
} from "../../scripts/sync-install-channels.mjs";

const root = resolve(import.meta.dirname, "../..");
const formula = readFileSync(resolve(root, "packaging/homebrew/campfire.rb"), "utf8");
const flake = readFileSync(resolve(root, "flake.nix"), "utf8");
const exporter = readFileSync(resolve(root, "scripts/export-public-release.mjs"), "utf8");
const packageVersion = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version as string;

function digestsFromFormula(text: string): Record<string, string> {
  const digests: Record<string, string> = {};
  for (const archive of INSTALL_CHANNEL_ARCHIVES) {
    const match = text.match(
      new RegExp(`${archive.replaceAll(".", "\\.")}"\\n\\s+sha256 "([0-9a-f]{64})"`),
    );
    expect(match, archive).not.toBeNull();
    digests[archive] = match?.[1] ?? "";
  }
  return digests;
}

describe("install channels", () => {
  it("pins the Homebrew formula and Nix flake to the same release archives", () => {
    expect(formula).toContain(`/v${packageVersion}/`);
    expect(formula).not.toMatch(/^\s*version "/m);
    expect(flake).toMatch(`version = "${packageVersion}";`);
    expect(formula).toContain('depends_on "node@22"');
    expect(flake).toContain("pkgs.nodejs-slim_22");
    expect(formula).not.toContain("boringinfra.company/campfire/v1/telemetry");
    expect(flake).not.toContain("boringinfra.company/campfire/v1/telemetry");

    const digests = digestsFromFormula(formula);
    for (const archive of INSTALL_CHANNEL_ARCHIVES) {
      const digest = digests[archive];
      expect(digest, archive).toBeDefined();
      expect(flake).toContain(`${hexToSri(digest ?? "")}"; # ${archive}`);
      expect(flake).toContain('url = "https://github.com/BoringInfraCo/Campfire/releases/download/v${version}/${archive.name}";');
      expect(formula).toContain(`/v${packageVersion}/${archive}`);
    }
    expect(applyChannelPins(formula, flake, { version: packageVersion, digests })).toEqual({
      formula,
      flake,
    });
  });

  it("replaces the version and one archive digest without touching the others", () => {
    const digests = digestsFromFormula(formula);
    const changed = { ...digests, "campfire-darwin-arm64.tar.gz": "a".repeat(64) };
    const next = applyChannelPins(formula, flake, { version: "9.9.9", digests: changed });
    expect(next.formula).toContain(`/v9.9.9/campfire-darwin-arm64.tar.gz`);
    expect(next.formula).toContain(`sha256 "${"a".repeat(64)}"`);
    expect(next.formula).toContain(`sha256 "${digests["campfire-linux-x64.tar.gz"]}"`);
    expect(next.formula).not.toContain(`/v${packageVersion}/`);
    expect(next.flake).toContain('version = "9.9.9";');
    expect(next.flake).toContain("v${version}");
    expect(next.flake).not.toContain("/v9.9.9/");
    expect(next.flake).toContain(`${hexToSri("a".repeat(64))}"; # campfire-darwin-arm64.tar.gz`);
    const linuxDigest = digests["campfire-linux-x64.tar.gz"];
    expect(linuxDigest).toBeDefined();
    expect(next.flake).toContain(
      `${hexToSri(linuxDigest ?? "")}"; # campfire-linux-x64.tar.gz`,
    );
  });

  it("rejects a checksum that is not a hex digest", () => {
    expect(() => parseChecksumFile("not-a-digest  campfire.tar.gz\n", "campfire.tar.gz")).toThrow(
      /64-character hex digest/,
    );
  });

  it("keeps the channel files on the public export allowlist", () => {
    for (const path of [
      "flake.nix",
      "flake.lock",
      "packaging/homebrew/campfire.rb",
      "scripts/sync-install-channels.mjs",
    ]) {
      expect(exporter).toContain(`"${path}"`);
    }
  });
});
