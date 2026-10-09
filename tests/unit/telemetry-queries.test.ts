/**
 * TEL-001 founder SQL must match the one-index Analytics Engine layout.
 *
 * `--dry-run` prints the plan and sends nothing. This test does not contact
 * Cloudflare.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isTelemetryVersionBelowFloor } from "../../src/telemetry/contract.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const scriptPath = join(repoRoot, "scripts/telemetry-queries.mjs");

/**
 * `--dry-run` prints the plan, sends nothing, and exits 0. Nothing here contacts
 * Cloudflare: a live report would need `--confirm` and a credential, and the
 * rendered report path is therefore asserted on through the script's own source
 * and through the plan text rather than by executing a query.
 */
function dryRun(...args: string[]): string {
  const result = spawnSync(process.execPath, ["scripts/telemetry-queries.mjs", "--dry-run", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  expect(result.status).toBe(0);
  return result.stdout ?? "";
}

describe("telemetry founder queries", () => {
  it("filters events on blob1 and never reads an index column", () => {
    const sql = dryRun();

    for (const event of ["install_requested", "install_completed", "activated", "active"]) {
      expect(sql).toContain(`blob1 = '${event}'`);
    }
    expect(sql).toContain("count(DISTINCT blob8)");
    expect(sql).toContain("blob3 AS campfire_version");
    expect(sql).toContain("blob4 AS os");
    expect(sql).toContain("blob5 AS arch");
    expect(sql).toContain("blob6 AS install_method");
    expect(sql).toContain("blob7 AS surface");
    for (const column of ["index1", "index2", "index3", "index4", "index5", "index6", "index7"]) {
      expect(sql).not.toContain(column);
    }
  });

  it("aggregates the DateTime and formats after the aggregate", () => {
    const sql = dryRun("--metric", "returning_installations");

    // Analytics Engine rejected the first form of this query with HTTP 422
    // "cannot use the String type as argument 1 in
    // min(formatDateTime(...))": min()/max() take no String argument, and
    // formatDateTime() returns String. The aggregate belongs on the column.
    expect(sql).not.toContain("min(formatDateTime");
    expect(sql).not.toContain("max(formatDateTime");
    expect(sql).toContain("formatDateTime(min(timestamp), '%Y-%m-%d') AS first_active_day");
    expect(sql).toContain("formatDateTime(max(timestamp), '%Y-%m-%d') AS last_active_day");
    // Both sides are '%Y-%m-%d', which sorts chronologically as plain text, so
    // the outer comparison stays a lexicographic day comparison.
    expect(sql).toContain("WHERE first_active_day < last_active_day");
    // No other query may reintroduce a formatted String inside an aggregate.
    expect(dryRun()).not.toContain("min(formatDateTime");
    expect(dryRun()).not.toContain("max(formatDateTime");
  });

  it("keeps the metric vocabulary guard", () => {
    const source = readFileSync(scriptPath, "utf8");

    expect(source).toContain("const FORBIDDEN_METRIC_WORDS = [");
    for (const pattern of ["\\busers?\\b", "\\bpeople\\b", "\\bpersons?\\b", "\\bhumans?\\b"]) {
      expect(source).toContain(pattern);
    }
    // The guard is applied to every rendered line, not to one report section.
    expect(source).toContain("for (const pattern of FORBIDDEN_METRIC_WORDS)");
    expect(source).toContain("refusing to render: metric vocabulary violation");
    // Report and rendering code name installations, requests, and events only.
    const reportCode = source.slice(source.indexOf("function collectReport"), source.indexOf("function renderList"));
    for (const word of ["users", "people", "person", "humans"]) {
      expect(reportCode.toLowerCase()).not.toContain(word);
    }
  });

  it("reports each installer-request window only when its own query ran", () => {
    // A rendered report needs a live query, which this test must not make, so the
    // collection gate is asserted on the source: every window is consulted, and
    // the group is no longer gated on the recent-day query alone.
    const source = readFileSync(scriptPath, "utf8");
    const collectReport = source.slice(
      source.indexOf("function collectReport"),
      source.indexOf("function formatNumber"),
    );

    for (const id of [
      "installer_requests_recent_day",
      "installer_requests_since",
      "installer_requests_trailing_7d",
      "installer_requests_trailing_30d",
    ]) {
      expect(collectReport).toContain(id);
    }
    expect(collectReport).toContain("if (!ran(id)) continue;");
    expect(collectReport).not.toContain('if (ran("installer_requests_recent_day")) {');
  });

  it("renders and words a partial run without inventing a measured zero", () => {
    const source = readFileSync(scriptPath, "utf8");
    const renderText = source.slice(source.indexOf("function renderText"), source.indexOf("function renderList"));

    // Each sub-value is rendered only if present, so a partial set neither
    // crashes on an absent window nor prints an unqueried window as 0.
    for (const entry of ["recentDay", "sinceLaunch", "trailing7Days", "trailing30Days"]) {
      expect(renderText).toContain(`requests.${entry}]`);
      expect(renderText).not.toContain(`requests.${entry}.value`);
    }
    expect(renderText).toContain("if (entry === undefined) continue;");
    // The reportable sentence asserts three counts at once; a `?? 0` in it would
    // state a measured zero for a query that never ran.
    const wording = renderText.slice(renderText.indexOf("REPORTABLE WORDING"));
    expect(wording).not.toContain("?? 0");
    // The complete-run sentence is unchanged.
    expect(renderText).toContain("Campfire has recorded ");
    expect(renderText).toContain("of which activated the product, with ");
  });

  /**
   * The same prefixes the SQL predicate uses. `1.10.0` must not match
   * `1.1.` — the dot after the minor is what keeps that trap closed.
   */
  const belowFloorPrefixes = [
    "0.",
    "1.0.",
    "1.1.",
    "1.2.",
    "1.3.",
    "1.4.",
    "1.5.",
    "1.6.",
    "1.7.",
    "1.8.",
    "1.9.0-",
    "1.9.0+",
    "1.9.0.",
  ];

  function reportExcludes(version: string): boolean {
    return version === "1.9.0" || belowFloorPrefixes.some((prefix) => version.startsWith(prefix));
  }

  it("omits provably forged versions from founder counts and keeps 1.10.0", () => {
    const installations = dryRun("--metric", "successful_installations");
    const excluded = dryRun("--metric", "excluded_below_reporting_floor");
    const installs = dryRun("--metric", "installer_requests_since");
    const byVersion = dryRun("--metric", "by_campfire_version");
    const byMethod = dryRun("--metric", "by_install_method");

    expect(installations).toContain("AND NOT (startsWith(blob3,");
    expect(byVersion).toContain("AND NOT (startsWith(blob3,");
    expect(excluded).toContain("blob1 = 'install_completed'");
    expect(excluded).not.toContain("AND NOT (startsWith(blob3,");
    expect(excluded).toContain("startsWith(blob3, '1.2.')");
    // Installer fetches are Worker-written. Their version is `unknown`.
    expect(installs).not.toContain("startsWith");
    expect(byMethod).not.toContain("startsWith");

    for (const prefix of belowFloorPrefixes) {
      expect(installations).toContain(`startsWith(blob3, '${prefix}')`);
    }
    expect(installations).toContain("blob3 = '1.9.0'");
    // The lexical trap. A string compare would drop 1.10.0 and every later install.
    expect(installations).not.toMatch(/blob3\s*</);
    expect(installations).not.toContain("LIKE '1.1%");
    // `startsWith(blob3, '1.1.')` is required. `1.10.0` does not match it.
    // A prefix without the trailing dot would, and must not be generated.
    expect(installations).not.toContain("startsWith(blob3, '1.10.");
    expect(installations).not.toMatch(/startsWith\(blob3, '1\.1'\)/);

    const below = ["0.9.9", "1.0.0", "1.2.0", "1.2.1", "1.8.9", "1.9.0", "1.9.0-rc.1"];
    const kept = ["1.9.1", "1.9.2", "1.9.10", "1.10.0", "1.11.0", "1.12.0", "1.13.0", "2.0.0", "unknown", "latest", "v1.2.0", ""];
    for (const version of below) {
      expect(reportExcludes(version)).toBe(true);
      expect(isTelemetryVersionBelowFloor(version)).toBe(true);
    }
    for (const version of kept) {
      expect(reportExcludes(version)).toBe(false);
      expect(isTelemetryVersionBelowFloor(version)).toBe(false);
    }
  });

  it("buckets weekly activity by Monday, not by toStartOfWeek", () => {
    // Production Analytics Engine's one-argument toStartOfWeek returns Sunday
    // (toDayOfWeek 7). A second argument is HTTP 422. The report title says
    // Monday, so the SQL has to derive Monday itself.
    const sql = dryRun("--metric", "weekly_active_installations");

    expect(sql).toContain("toDayOfWeek(timestamp)");
    expect(sql).toContain("toUnixTimestamp(timestamp) - (toDayOfWeek(timestamp) - 1) * 86400");
    expect(sql).not.toContain("toStartOfWeek(");
    expect(sql).toContain("weeks start Monday");
  });
});
