/**
 * Cold-start backfill for the prior-install gate.
 *
 * The script hashes installation ids (SHA-256) and emits idempotent
 * `INSERT OR IGNORE` rows. Raw ids must appear in neither stdout nor stderr:
 * stdout carries digests inside SQL, stderr carries only a count summary (and,
 * with `--execute-sql`, the printed wrangler invocation — never executed).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  backfillStatementFor,
  buildBackfillStatements,
  claimKeyForInstallationId,
  hashInstallationId,
  isInstallationId,
  wranglerExecuteInvocation,
} from "../../scripts/backfill-telemetry-claims.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const script = join(repoRoot, "scripts/backfill-telemetry-claims.mjs");

const ID_A = "11111111-2222-4333-8444-555555555555";
const ID_B = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const AT = "2026-10-20T00:00:00.000Z";

function shaHex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function run(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: repoRoot, encoding: "utf8" });
  return result;
}

describe("backfill hashing and SQL generation", () => {
  it("validates UUID format", () => {
    expect(isInstallationId(ID_A)).toBe(true);
    expect(isInstallationId(ID_A.toUpperCase())).toBe(true);
    expect(isInstallationId("not-a-uuid")).toBe(false);
    expect(isInstallationId("")).toBe(false);
    expect(isInstallationId(42)).toBe(false);
  });

  it("hashes with SHA-256 hex and prefixes the guard claim key", () => {
    expect(hashInstallationId(ID_A)).toBe(shaHex(ID_A));
    expect(hashInstallationId(ID_A)).toMatch(/^[0-9a-f]{64}$/);
    // Matches guard.ts: claim_key is `install:<sha256hex(id)>`.
    expect(claimKeyForInstallationId(ID_A)).toBe(`install:${shaHex(ID_A)}`);
  });

  it("emits idempotent INSERT OR IGNORE rows", () => {
    const statements = buildBackfillStatements([ID_A, ID_B], AT);
    expect(statements).toHaveLength(2);
    for (const [statement, id] of [
      [statements[0], ID_A],
      [statements[1], ID_B],
    ] as Array<[string, string]>) {
      expect(statement).toBe(
        `INSERT OR IGNORE INTO telemetry_claims (kind, claim_key, claimed_at) VALUES ('install', 'install:${shaHex(id)}', '${AT}');`,
      );
      // No raw id anywhere in the emitted SQL.
      expect(statement).not.toContain(id);
    }
    expect(backfillStatementFor("install:abc", AT)).toContain("INSERT OR IGNORE INTO telemetry_claims");
  });

  it("deduplicates repeated ids", () => {
    expect(buildBackfillStatements([ID_A, ID_A], AT)).toHaveLength(1);
  });

  it("refuses non-UUID input without echoing it", () => {
    expect(() => buildBackfillStatements(["not-a-uuid"], AT)).toThrow(/not a valid installation id/);
    try {
      buildBackfillStatements(["not-a-uuid"], AT);
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain("not-a-uuid");
    }
  });

  it("builds a wrangler invocation without executing anything", () => {
    const invocation = wranglerExecuteInvocation({ database: "campfire", local: false, sqlFile: "backfill.sql" });
    expect(invocation).toBe("npx wrangler d1 execute campfire --remote --file backfill.sql");
    expect(wranglerExecuteInvocation({ database: "campfire", local: true, sqlFile: "b.sql" })).toContain("--local");
  });
});

describe("backfill CLI", () => {
  it("emits SQL to stdout and a count summary to stderr, never a raw id", () => {
    const result = run(ID_A, ID_B, "--claimed-at", AT);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`'install:${shaHex(ID_A)}'`);
    expect(result.stdout).toContain(`'install:${shaHex(ID_B)}'`);
    expect(result.stdout).not.toContain(ID_A);
    expect(result.stdout).not.toContain(ID_B);
    expect(result.stderr).toContain("2 statement(s) for 2 unique installation(s)");
    expect(result.stderr).not.toContain(ID_A);
    expect(result.stderr).not.toContain(ID_B);
  });

  it("reads ids from a JSON file (array or { ids }) and merges with argv", () => {
    const dir = mkdtempSync(join(tmpdir(), "backfill-"));
    const arrayFile = join(dir, "array.json");
    const objectFile = join(dir, "object.json");
    writeFileSync(arrayFile, JSON.stringify([ID_A]));
    writeFileSync(objectFile, JSON.stringify({ ids: [ID_B] }));

    const fromArray = run("--from-json", arrayFile, "--claimed-at", AT);
    expect(fromArray.status).toBe(0);
    expect(fromArray.stdout).toContain(shaHex(ID_A));
    expect(fromArray.stdout).not.toContain(ID_A);

    const merged = run("--from-json", objectFile, ID_A, "--claimed-at", AT);
    expect(merged.status).toBe(0);
    expect(merged.stdout).toContain(shaHex(ID_A));
    expect(merged.stdout).toContain(shaHex(ID_B));
    expect(merged.stderr).toContain("2 statement(s)");
  });

  it("prints the wrangler invocation with --execute-sql and never runs it", () => {
    const result = run(ID_A, "--claimed-at", AT, "--execute-sql");
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("npx wrangler d1 execute campfire --remote --file backfill.sql");
    // The invocation is printed, not executed: no wrangler output appears.
    expect(result.stdout).toContain("INSERT OR IGNORE");
    expect(result.stderr).not.toContain(ID_A);
  });

  it("refuses invalid ids with a non-zero exit and no raw id in output", () => {
    const result = run("definitely-not-an-id", "--claimed-at", AT);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).not.toContain("definitely-not-an-id");
  });
});
