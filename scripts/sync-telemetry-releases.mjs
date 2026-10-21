#!/usr/bin/env node

/**
 * Sync the static release-time map in `src/telemetry/releases.ts` from git tags.
 *
 * The SQL is not the only product here: the server-side release-time check in
 * `src/worker/telemetry.ts` reads `TELEMETRY_RELEASES`, and that map must gain
 * one entry per release without hand-editing timestamps. This script is the
 * single writer. It runs
 *
 *   git tag --format='%(refname:short) %(creatordate:iso8601)'
 *
 * keeps tags matching /^v\d+\.\d+\.\d+$/ with a version at or above 1.9.1,
 * converts each tag's local-offset timestamp to a UTC ISO instant, and writes
 * `src/telemetry/releases.ts` with the same exported API
 * (`TELEMETRY_RELEASES`, `telemetryReleaseAt`) so existing imports and tests
 * keep working.
 *
 * Usage:
 *   npm run telemetry:sync-releases
 *   node scripts/sync-telemetry-releases.mjs [--check]
 *
 * `--check` exits non-zero when the map differs from what the tags say,
 * without writing. Re-run on every release: a version that is not in the map
 * is allowed through the gate and measured as `unknown_release`, so a stale
 * map silently weakens the release-time check instead of failing loudly.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const RELEASES_PATH = join(repoRoot, "src/telemetry/releases.ts");

/** First release that contained any telemetry code. Below this is the version floor, not the map. */
const MAP_FLOOR = [1, 9, 1];

/** `%(creatordate:iso8601)` carries a numeric local offset; Date parses it fine. */
const TAG_LINE_PATTERN = /^v(\d+)\.(\d+)\.(\d+)\s+(.+)$/;
const MAP_ENTRY_PATTERN = /"(\d+\.\d+\.\d+)": "([^"]+)"/g;

function fail(message) {
  console.error(`sync-telemetry-releases: ${message}`);
  process.exit(1);
}

function parseTriple(text) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(text);
  return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareTriples(a, b) {
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function readTags() {
  const result = spawnSync("git", ["tag", "--format=%(refname:short) %(creatordate:iso8601)"], {
    encoding: "utf8",
    cwd: repoRoot,
  });
  if (result.status !== 0) {
    fail(`git tag failed: ${(result.stderr ?? "").trim() || "unknown error"}`);
  }
  const entries = new Map();
  for (const line of (result.stdout ?? "").split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const match = TAG_LINE_PATTERN.exec(trimmed);
    if (match === null) continue;
    const triple = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (compareTriples(triple, MAP_FLOOR) < 0) continue;
    const parsed = new Date(match[4]);
    if (Number.isNaN(parsed.getTime())) fail(`unparseable tag date: ${trimmed}`);
    // Whole-second instants only; the map carries no fractional seconds.
    entries.set(`${triple[0]}.${triple[1]}.${triple[2]}`, parsed.toISOString().replace(/\.\d{3}Z$/, "Z"));
  }
  return new Map([...entries].sort((a, b) => compareTriples(parseTriple(a[0]), parseTriple(b[0]))));
}

function readExisting() {
  const source = readFileSync(RELEASES_PATH, "utf8");
  const entries = new Map();
  for (const match of source.matchAll(MAP_ENTRY_PATTERN)) {
    entries.set(match[1], match[2]);
  }
  return entries;
}

function renderFile(entries, generatedAt) {
  const lines = [];
  for (const [version, instant] of entries) {
    lines.push(`  "${version}": "${instant}",`);
  }
  return `/**
 * GENERATED — do not edit by hand. Regenerate with \`npm run telemetry:sync-releases\`.
 *
 * Source command: git tag --format='%(refname:short) %(creatordate:iso8601)'
 * Generated at: ${generatedAt}
 *
 * Tag timestamps carry numeric local offsets (EDT/EST across the year, so the
 * offset is a seasonality artifact, not a stable property). Each is converted
 * to a UTC ISO instant above, which is what the release-time check compares.
 * Release instants never change after the fact; a version absent from this
 * table is allowed through the gate and measured as \`unknown_release\`.
 *
 * Static release-time map for server-side telemetry integrity.
 *
 * Each entry is the UTC instant its release was published. The ingestion
 * route compares a payload's declared \`campfireVersion\` against this map: a
 * known version whose release instant is still in the future cannot have been
 * emitted by a real binary, so it is a provable forgery (same reasoning as
 * the v1.9.1 reporting floor, extended forward in time). A version that is
 * not in the map — \`unknown\`, a build string, a local checkout, or a release
 * newer than this table — is allowed through: absence of proof is not proof
 * of forgery.
 *
 * The table is deliberately static. Release instants never change after the
 * fact, and a static map keeps the check stateless: no D1 read, nothing to
 * evade by rotating source addresses. Update it when a new release ships.
 */
export const TELEMETRY_RELEASES: Readonly<Record<string, string>> = {
${lines.join("\n")}
};

/**
 * The release instant for a declared client version, or \`undefined\` when the
 * version is not a known release. Unknown means allow: an unparseable value
 * (\`unknown\`, a build string) is an honest possibility, and a version newer
 * than this table is expected until the table is updated.
 */
export function telemetryReleaseAt(campfireVersion: string): string | undefined {
  return TELEMETRY_RELEASES[campfireVersion.trim()];
}
`;
}

function summarizeDiff(existing, next) {
  const added = [];
  const removed = [];
  const changed = [];
  for (const [version, instant] of next) {
    if (!existing.has(version)) added.push(version);
    else if (existing.get(version) !== instant) changed.push(`${version}: ${existing.get(version)} -> ${instant}`);
  }
  for (const version of existing.keys()) {
    if (!next.has(version)) removed.push(version);
  }
  return { added, removed, changed };
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const next = readTags();
  if (next.size === 0) fail("no release tags found at or above 1.9.1");
  const existing = readExisting();
  const { added, removed, changed } = summarizeDiff(existing, next);
  const generatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  if (checkOnly) {
    if (added.length === 0 && removed.length === 0 && changed.length === 0) {
      console.log(`sync-telemetry-releases: in sync (${next.size} versions)`);
      return;
    }
    fail(
      `map differs from tags: added [${added.join(", ")}] removed [${removed.join(", ")}] changed [${changed.join(", ")}]`,
    );
  }

  writeFileSync(RELEASES_PATH, renderFile(next, generatedAt));
  console.log(`sync-telemetry-releases: wrote ${next.size} versions to src/telemetry/releases.ts`);
  console.log(`  added (${added.length}): ${added.length > 0 ? added.join(", ") : "none"}`);
  console.log(`  removed (${removed.length}): ${removed.length > 0 ? removed.join(", ") : "none"}`);
  console.log(`  changed (${changed.length}): ${changed.length > 0 ? changed.join("; ") : "none"}`);
}

main();
