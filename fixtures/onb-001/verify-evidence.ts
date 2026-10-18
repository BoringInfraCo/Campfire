/**
 * ONB-001 Step 0 — evidence verifier and manifest writer.
 *
 * FIXTURE EVIDENCE TOOLING — not product code. Walks every file under
 * docs/evidence/onb-001 and:
 *   1. re-scans the bytes for forbidden strings (cft~/cfe~ credentials,
 *      absolute /Users, /private, /var/folders, /tmp paths),
 *   2. re-scans for residual unmasked dynamic shapes (object ids, enrollment
 *      invitation ids, UUIDs, ISO timestamps, loopback ports),
 *   3. re-derives sha256 from disk and cross-checks it against the per-case
 *      file records written into summaries/*.json (capture files must be
 *      covered; a capture file missing from every summary is a problem),
 *   4. requires every case in every summary to be `captured`,
 *
 * then writes MANIFEST.json (the file list excludes the manifest itself).
 *
 *   npx tsx fixtures/onb-001/verify-evidence.ts \
 *     --root <clean v1.22.0 worktree> [--out docs/evidence/onb-001]
 *
 * Exit code is nonzero when any problem is found. The baseline worktree is
 * re-verified first, so a final run proves the packet was produced against the
 * clean v1.22.0 source.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { leakCheck, redact, sha256 } from "./lib/capture.js";
import { parseToolArgs, verifyBaselineRoot } from "./lib/tool.js";

const NAME = "onb-001 verify-evidence";
const args = parseToolArgs(process.argv.slice(2), NAME);
const baseline = verifyBaselineRoot(NAME, args.root);

/** Additional forbidden literals beyond `leakCheck`'s defaults. */
const FORBIDDEN = ["/tmp/"] as const;

/** Unmasked dynamic shapes that must not survive into any evidence file. */
const RESIDUAL_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  // Any <prefix>_<16 hex> object id (covers ein_inv_*, hum_*, ws_*, ...).
  { name: "object_id", pattern: /\b[a-z][a-z0-9]{1,6}_[0-9a-f]{16}\b/g },
  { name: "uuid", pattern: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g },
  { name: "iso_timestamp", pattern: /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g },
  { name: "loopback_port", pattern: /127\.0\.0\.1:\d/g },
  { name: "loopback_port_localhost", pattern: /localhost:\d/g },
];

interface SummaryFileRecord {
  file: string;
  bytes: number;
  sha256: string;
  kind: string;
  verified: boolean;
}

interface SummaryShape {
  tool?: string;
  cases?: Array<{ id?: string; status?: string; files?: SummaryFileRecord[] }>;
}

function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const abs = join(dir, entry);
      const stat = statSync(abs);
      if (stat.isDirectory()) walk(abs);
      else out.push(relative(root, abs));
    }
  };
  walk(root);
  return out.sort();
}

function main(): void {
  const root = args.out;
  const files = listFiles(root).filter((file) => file !== "MANIFEST.json");

  // ---- load summary records ------------------------------------------------
  const summaryRecords = new Map<string, SummaryFileRecord>();
  const summaryProblems: string[] = [];
  const summaryTools: Array<{ tool: string; cases: number; captured: number }> = [];
  const summaryFiles = files.filter((file) => file.startsWith("summaries/") && file.endsWith(".json"));
  for (const summaryFile of summaryFiles) {
    let parsed: SummaryShape;
    try {
      parsed = JSON.parse(readFileSync(join(root, summaryFile), "utf8")) as SummaryShape;
    } catch (error) {
      summaryProblems.push(`${summaryFile}: unreadable (${error instanceof Error ? error.message : String(error)})`);
      continue;
    }
    const cases = parsed.cases ?? [];
    const captured = cases.filter((record) => record.status === "captured").length;
    summaryTools.push({ tool: parsed.tool ?? summaryFile, cases: cases.length, captured });
    for (const record of cases) {
      if (record.status !== "captured") {
        summaryProblems.push(`${summaryFile}: case ${record.id ?? "?"} has status ${record.status ?? "?"}`);
      }
      for (const file of record.files ?? []) {
        if (summaryRecords.has(file.file)) {
          summaryProblems.push(`${summaryFile}: ${file.file} listed by more than one case`);
        }
        summaryRecords.set(file.file, file);
      }
    }
  }

  // ---- scan every file -----------------------------------------------------
  const problems: string[] = [...summaryProblems];
  const manifestFiles: Array<Record<string, unknown>> = [];
  for (const file of files) {
    const abs = join(root, file);
    const buf = readFileSync(abs);
    const text = buf.toString("utf8");
    const sha = sha256(buf);
    const forbiddenHits = [...leakCheck(text), ...FORBIDDEN.filter((needle) => text.includes(needle))];
    const residualHits: Array<{ name: string; sample: string }> = [];
    for (const rule of RESIDUAL_PATTERNS) {
      const match = rule.pattern.exec(text);
      if (match !== null) residualHits.push({ name: rule.name, sample: match[0] });
      rule.pattern.lastIndex = 0;
    }
    const record = summaryRecords.get(file);
    const provenance = file.startsWith("summaries/")
      ? "capture-summary"
      : file.endsWith(".md")
        ? "documentation"
        : "capture";
    if (forbiddenHits.length > 0) problems.push(`${file}: forbidden string(s): ${forbiddenHits.join(", ")}`);
    if (residualHits.length > 0) {
      problems.push(`${file}: residual unmasked shape(s): ${residualHits.map((hit) => `${hit.name} ${hit.sample}`).join(", ")}`);
    }
    if (provenance === "capture" && record === undefined) {
      problems.push(`${file}: capture file is not listed in any summary`);
    }
    if (record !== undefined && record.sha256 !== sha) {
      problems.push(`${file}: sha256 ${sha} does not match summary record ${record.sha256}`);
    }
    manifestFiles.push({
      path: file,
      bytes: buf.byteLength,
      sha256: sha,
      kind: record?.kind ?? null,
      provenance,
      summarizedIn: record === undefined ? null : "a capture summary",
      matchesSummaryHash: record === undefined ? null : record.sha256 === sha,
      forbiddenHits,
      residualHits: residualHits.map((hit) => hit.name),
    });
  }

  // ---- manifest ------------------------------------------------------------
  const manifest = {
    tool: NAME,
    generatedOn: "2026-10-18",
    evidenceDir: "docs/evidence/onb-001",
    baseline: {
      tag: "v1.22.0",
      describeTag: baseline.describeTag,
      packageVersion: baseline.packageVersion,
      worktreeClean: baseline.worktreeClean,
      srcMatchesTag: baseline.srcMatchesTag,
    },
    rules: {
      forbidden: ["cft~ (bearer token shape)", "cfe~ (invitation secret shape)", "/Users/", "/private/", "/var/folders/", "/tmp/"],
      residualShapes: RESIDUAL_PATTERNS.map((rule) => rule.name),
      maskedForms:
        "ports -> [port]; ISO timestamps -> [timestamp]; UUIDs -> [uuid]; <prefix>_<16 hex> -> <prefix>_[id]; enrollment invitation ids -> ein_inv_[id]; tokens -> [redacted]; invitation secrets -> [one-time-credential: redacted]; absolute temp/home paths -> [path]",
    },
    tools: summaryTools,
    fileCount: manifestFiles.length,
    files: manifestFiles,
    problems,
    ok: problems.length === 0,
    manifestSelf: {
      path: "MANIFEST.json",
      note: "excluded from its own file list; regenerated by every verify run",
    },
  };
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  // The manifest is written straight to disk (it is the inventory), but its
  // own text must pass the same scans: a problem sample quoting a raw id must
  // never leak into the packet.
  const { text: redactedManifest } = redact(serialized);
  const manifestLeaks = [...leakCheck(redactedManifest), ...FORBIDDEN.filter((needle) => redactedManifest.includes(needle))];
  if (manifestLeaks.length === 0) {
    writeFileSync(join(root, "MANIFEST.json"), redactedManifest, "utf8");
  } else {
    problems.push(`MANIFEST.json: refused to write (forbidden string(s): ${manifestLeaks.join(", ")})`);
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        tool: NAME,
        evidenceDir: root,
        files: manifestFiles.length,
        captureFiles: manifestFiles.filter((file) => file.provenance === "capture").length,
        summaryFiles: summaryFiles.length,
        tools: summaryTools,
        problems,
        ok: problems.length === 0,
        manifestBytes: Buffer.byteLength(redactedManifest, "utf8"),
        manifestSha256: sha256(redactedManifest),
      },
      null,
      2,
    )}\n`,
  );
  if (problems.length > 0) process.exitCode = 1;
}

main();
