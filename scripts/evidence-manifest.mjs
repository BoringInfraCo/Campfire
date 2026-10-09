/**
 * Regenerate `evidence/MANIFEST.json`, the tracked index of every acceptance run
 * on disk.
 *
 * Raw evidence stays gitignored; this manifest is the tracked record of which
 * run lives where, what it concluded, and what every file in it hashes to. It is
 * an index and a tripwire, not a copy — it makes a changed or missing file
 * detectable, and preserves nothing itself. It is generated, never hand-edited —
 * edit the runner, not this file.
 *
 * A run directory is any `evidence/<sprint>/run-<YYYY-MM-DD>/`. The date comes
 * from the directory name; the verdict, harness versions, and check tally are
 * read out of that run's `acceptance.json` when it is present. Runs listed in
 * UNAVAILABLE are runs whose artifacts are gone, kept so the index does not
 * silently imply they never happened.
 *
 * Usage: node scripts/evidence-manifest.mjs [--check]
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const EVIDENCE_DIR = "evidence";
const MANIFEST_PATH = "evidence/MANIFEST.json";
const RUN_DIR_PATTERN = /^run-(\d{4}-\d{2}-\d{2})(?:T\d{6})?$/;

/**
 * Runs whose evidence no longer exists on disk. Their historical verdicts stay
 * in `docs/`; only the artifacts are unrecoverable.
 */
const UNAVAILABLE = [
  {
    run: "sprint-002/run-2026-09-12",
    runDate: "2026-09-12",
    verdict: "GO",
    checks: { total: 31, passed: 31 },
    campfireRevision: "d7e160d",
    harnesses: { a: "codex-cli 0.149.1", b: "OpenCode 1.18.30" },
    status: "artifacts-not-available",
    note:
      "Artifacts were written to the fixed path evidence/sprint-002/ and overwritten in place by the September 23 rerun on 2026-09-23. Because evidence/ is gitignored they were never in Git history, and no copy survived on disk. The GO verdict remains the historical conclusion recorded in docs/SPRINT_002_RESULT.md sections 1-19; its underlying artifacts can no longer be independently verified. See docs/SPRINT_002_RESULT.md section 20.",
  },
];

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function walk(dir, base) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(full, base));
    } else if (entry.isFile()) {
      files.push({
        path: relative(base, full).split(sep).join("/"),
        bytes: statSync(full).size,
        sha256: sha256(full),
      });
    }
  }
  return files;
}

function summariseRun(runDir) {
  const acceptancePath = join(runDir, "acceptance.json");
  if (!existsSync(acceptancePath)) return {};

  const evidence = JSON.parse(readFileSync(acceptancePath, "utf8"));
  const checks = Array.isArray(evidence.checks) ? evidence.checks : [];
  return {
    startedAt: evidence.startedAt ?? null,
    finishedAt: evidence.finishedAt ?? null,
    durationMs: evidence.durationMs ?? null,
    verdict: evidence.recommendation ?? null,
    checks: {
      total: checks.length,
      passed: checks.filter((check) => check.passed).length,
    },
    harnesses: {
      a: evidence.environment?.harnessA?.version ?? null,
      b: evidence.environment?.harnessB?.version ?? null,
    },
  };
}

function findRunDirs() {
  const runs = [];
  if (!existsSync(EVIDENCE_DIR)) return runs;

  for (const sprint of readdirSync(EVIDENCE_DIR, { withFileTypes: true })) {
    if (!sprint.isDirectory() || sprint.name === "node_modules") continue;
    const sprintDir = join(EVIDENCE_DIR, sprint.name);
    if (!existsSync(join(sprintDir, "MANIFEST.json")) && !existsSync(join(sprintDir, "acceptance.json"))) {
      const nested = readdirSync(sprintDir, { withFileTypes: true });
      if (!nested.some((entry) => RUN_DIR_PATTERN.test(entry.name))) continue;
    }
    for (const entry of readdirSync(sprintDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const match = RUN_DIR_PATTERN.exec(entry.name);
      if (!match) continue;
      runs.push({
        run: `${sprint.name}/${entry.name}`,
        runDate: match[1],
        directory: join(sprintDir, entry.name),
      });
    }
  }
  return runs.sort((a, b) => a.run.localeCompare(b.run));
}

function build() {
  const runs = findRunDirs().map(({ run, runDate, directory }) => ({
    run,
    runDate,
    directory: `evidence/${run}`,
    status: "on-disk",
    ...summariseRun(directory),
    files: walk(directory, directory),
  }));

  return {
    schema: "campfire-evidence-manifest/1",
    generator: "scripts/evidence-manifest.mjs",
    note:
      "Raw evidence is gitignored and never committed; it lives in one place on one disk and is not backed up. This manifest is an index and a tripwire, not a copy: it records which acceptance run lives where and what each file in it hashes to, so an altered or missing file is detectable. It preserves nothing — delete the files and the manifest simply records hashes of files that no longer exist. A durable copy requires copying the evidence to controlled storage. Regenerate with `npm run evidence:manifest` after any acceptance run; never hand-edit.",
    runs,
    unavailable: UNAVAILABLE,
  };
}

const check = process.argv.includes("--check");
const manifest = build();
const serialised = `${JSON.stringify(manifest, null, 2)}\n`;

if (check) {
  const current = existsSync(MANIFEST_PATH) ? readFileSync(resolve(MANIFEST_PATH), "utf8") : "";
  if (current === serialised) {
    process.stdout.write(`${MANIFEST_PATH} is up to date (${manifest.runs.length} run(s))\n`);
    process.exitCode = 0;
  } else {
    process.stderr.write(`${MANIFEST_PATH} is stale; run: npm run evidence:manifest\n`);
    process.exitCode = 1;
  }
} else {
  writeFileSync(resolve(MANIFEST_PATH), serialised, "utf8");
  process.stdout.write(`${MANIFEST_PATH}: ${manifest.runs.length} run(s), ${manifest.unavailable.length} unavailable\n`);
  for (const run of manifest.runs) {
    process.stdout.write(`  ${run.run}  ${run.verdict ?? "verdict unknown"}  ${run.files.length} file(s)\n`);
  }
}
