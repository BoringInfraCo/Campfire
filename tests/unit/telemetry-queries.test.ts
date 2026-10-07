/**
 * TEL-001 founder SQL must match the one-index Analytics Engine layout.
 *
 * `--dry-run` prints the plan and sends nothing. This test does not contact
 * Cloudflare.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("telemetry founder queries", () => {
  it("filters events on blob1 and never reads an index column", () => {
    const result = spawnSync(process.execPath, ["scripts/telemetry-queries.mjs", "--dry-run"], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    const sql = result.stdout ?? "";

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
});
