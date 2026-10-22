/**
 * The static release-time map is generated, not hand-edited.
 *
 * `scripts/sync-telemetry-releases.mjs` derives every entry from annotated
 * release tags (`npm run telemetry:sync-releases`). This test pins the
 * properties a stale or hand-edited map would break: the shipped package
 * version is present, keys sort semver-ascending, every value is a UTC ISO
 * instant, and the two boundary instants match the tags exactly.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TELEMETRY_RELEASES, telemetryReleaseAt } from "../../src/telemetry/releases.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

function parseTriple(version: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (match === null) throw new Error(`not a version triple: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareTriples(a: [number, number, number], b: [number, number, number]): number {
  for (let index = 0; index < 3; index += 1) {
    const x = a[index] ?? 0;
    const y = b[index] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

describe("telemetry release-time map", () => {
  it("contains the shipped package version", () => {
    const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { version: string };
    expect(TELEMETRY_RELEASES[packageJson.version]).toBeDefined();
    expect(telemetryReleaseAt(packageJson.version)).toBe(TELEMETRY_RELEASES[packageJson.version]);
  });

  it("sorts keys semver-ascending with no duplicates", () => {
    const keys = Object.keys(TELEMETRY_RELEASES);
    expect(keys.length).toBeGreaterThan(0);
    const sorted = [...keys].sort((a, b) => compareTriples(parseTriple(a), parseTriple(b)));
    expect(keys).toEqual(sorted);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("holds valid UTC ISO instants and trims lookup input", () => {
    for (const [version, instant] of Object.entries(TELEMETRY_RELEASES)) {
      expect(instant).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      expect(Number.isNaN(Date.parse(instant))).toBe(false);
      expect(telemetryReleaseAt(`  ${version}  `)).toBe(instant);
    }
    expect(telemetryReleaseAt("unknown")).toBeUndefined();
    expect(telemetryReleaseAt("")).toBeUndefined();
  });

  it("matches the tag instants at both boundary releases", () => {
    // Tag `v1.9.1` created 2026-10-02 22:53:27 -0400; tag `v1.25.0` created
    // 2026-10-20 21:06:22 -0400. Both convert to the UTC instants below.
    expect(TELEMETRY_RELEASES["1.9.1"]).toBe("2026-10-03T02:53:27Z");
    expect(TELEMETRY_RELEASES["1.25.0"]).toBe("2026-10-21T01:06:22Z");
  });
});
