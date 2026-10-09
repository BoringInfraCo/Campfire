/**
 * Sprint 002 evidence writer.
 *
 * Renders the section 19 evidence tree from a captured acceptance run. This is
 * a pure formatting layer: it never re-evaluates checks and never records raw
 * environment dumps, auth tokens, or private transcript contents. Command
 * arrays may contain the SQLite path; that is not a secret.
 *
 * Writing is overwrite-proof. A run claims its own directory with a
 * non-recursive `mkdir`, which the kernel serialises, so exactly one process
 * can win a name, and every file is created with the `wx` flag, so an existing
 * file is never silently replaced. Nothing here is best-effort: a collision
 * escalates to a fresh name or throws.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { HarnessRunResult, RealAcceptanceCheck, RealAcceptanceEvidence } from "./types.js";

export interface WriteEvidenceResult {
  directory: string;
  files: string[];
}

/** A named directory is already taken by evidence this module must not replace. */
export class EvidenceDirectoryConflictError extends Error {
  readonly directory: string;

  constructor(directory: string, message: string) {
    super(message);
    this.name = "EvidenceDirectoryConflictError";
    this.directory = directory;
  }
}

const EVIDENCE_FILES = [
  "acceptance.json",
  "campfire-state-before-b.json",
  "campfire-state-after-b.json",
  "environment.md",
  "harness-a.md",
  "harness-b.md",
  "notes.md",
] as const;

/**
 * Written last, and that ordering is load-bearing.
 *
 * `scripts/evidence-manifest.mjs` reads `acceptance.json` for a run's verdict,
 * so the file doubles as the completion marker: a directory abandoned by a hard
 * kill — which no cleanup can catch — has no verdict and fewer than seven
 * files, and reads as incomplete rather than as a finished run.
 */
const COMPLETION_MARKER = "acceptance.json";

const WRITE_ORDER: readonly (typeof EVIDENCE_FILES)[number][] = [
  ...EVIDENCE_FILES.filter((name) => name !== COMPLETION_MARKER),
  COMPLETION_MARKER,
];

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

/** Candidate directories for a run, most preferred first. */
function runDirectoryCandidates(evidence: RealAcceptanceEvidence): string[] {
  const base = `evidence/sprint-${evidence.sprint}/run-${evidence.startedAt.slice(0, 10)}`;
  return [base, `${base}T${evidence.startedAt.slice(11, 19).replace(/:/g, "")}`];
}

/**
 * Claim `directory` for this run, or report that it is already taken.
 *
 * The claim is a non-recursive `mkdir`. The parent chain is created
 * recursively first because a non-recursive `mkdir` needs it to exist, and
 * creating parents is idempotent rather than racy; the leaf is where two
 * concurrent runs actually collide, and `EEXIST` there is decided by the kernel
 * instead of by an `existsSync` that another process can slip in between.
 */
function claimDirectory(directory: string): boolean {
  mkdirSync(dirname(directory), { recursive: true });
  try {
    mkdirSync(directory, { recursive: false });
    return true;
  } catch (error) {
    if (errorCode(error) === "EEXIST") return false;
    throw error;
  }
}

/**
 * Reserve the directory this run writes into and return its absolute path.
 *
 * Each run gets its own dated directory, `evidence/sprint-002/run-<date>`. A
 * second run on the same date escalates to `run-<date>T<hhmmss>`; a third has
 * nowhere left to go and throws. A single fixed output path is what let the
 * September 23 rerun silently replace the September 12 run's evidence, and an
 * `existsSync` check plus a later `mkdirSync` is only advisory — so the name is
 * claimed, not merely checked.
 *
 * A caller-supplied `directory` is never escalated. Escalating would write the
 * run somewhere the caller did not name, which is the same silent surprise as
 * overwriting, in a different place: the caller asked for one path and would
 * get another. A deliberate name that is already taken is an error to report,
 * not a collision to route around.
 */
export function reserveRunDirectory(evidence: RealAcceptanceEvidence, directory?: string): string {
  if (directory !== undefined) {
    const dir = resolve(directory);
    if (!claimDirectory(dir)) {
      throw new EvidenceDirectoryConflictError(
        dir,
        `evidence directory ${dir} already exists; a caller-supplied evidence directory is never ` +
          `relocated, and existing evidence is never overwritten. Choose a path that does not exist yet.`,
      );
    }
    return dir;
  }

  const candidates = runDirectoryCandidates(evidence);
  let conflict: string | undefined;
  for (const candidate of candidates) {
    const dir = resolve(candidate);
    if (claimDirectory(dir)) return dir;
    conflict = dir;
  }

  throw new EvidenceDirectoryConflictError(
    conflict ?? "",
    `evidence directories ${candidates.join(" and ")} both exist; refusing to overwrite an earlier ` +
      `acceptance run. Move or remove the earlier run, or pass an explicit evidence directory.`,
  );
}

/**
 * Resolve where a run's evidence belongs.
 *
 * Kept for callers that named this function before the reservation became
 * atomic. Prefer {@link reserveRunDirectory}: this delegates to it and
 * therefore *claims* the directory it returns, which is a side effect the old
 * advisory version did not have.
 */
export function resolveRunDirectory(evidence: RealAcceptanceEvidence, directory?: string): string {
  return reserveRunDirectory(evidence, directory);
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

function harnessDurationMs(harness: HarnessRunResult): number | undefined {
  const start = Date.parse(harness.startedAt);
  const end = Date.parse(harness.finishedAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return undefined;
  return end - start;
}

function renderEnvironment(evidence: RealAcceptanceEvidence): string {
  const { environment } = evidence;
  const lines: string[] = [
    "# Sprint 002 — Environment",
    "",
    `- Captured: ${evidence.startedAt} → ${evidence.finishedAt}`,
    `- Total duration: ${evidence.durationMs} ms`,
    `- Node: ${environment.node}`,
    `- Platform: ${environment.platform}`,
    `- Arch: ${environment.arch}`,
    `- Scenario: ${evidence.scenario}`,
    "",
    "## Harness A",
    "",
    `- Kind: ${environment.harnessA.kind}`,
    `- Version: ${environment.harnessA.version}`,
    `- Model: ${environment.harnessA.model ?? "unknown"}`,
    `- Actor: ${environment.harnessA.actorId}`,
    `- Session: ${environment.harnessA.sessionId ?? "unknown"}`,
    `- Duration: ${harnessDurationMs(evidence.harnessA) ?? "unknown"} ms`,
    "",
    "## Harness B",
    "",
    `- Kind: ${environment.harnessB.kind}`,
    `- Version: ${environment.harnessB.version}`,
    `- Model: ${environment.harnessB.model ?? "unknown"}`,
    `- Actor: ${environment.harnessB.actorId}`,
    `- Session: ${environment.harnessB.sessionId ?? "unknown"}`,
    `- Duration: ${harnessDurationMs(evidence.harnessB) ?? "unknown"} ms`,
    "",
    "## Prompts",
    "",
    "### Agent A",
    "",
    "```text",
    evidence.prompts.agentA,
    "```",
    "",
    "### Agent B",
    "",
    "```text",
    evidence.prompts.agentB,
    "```",
    "",
  ];
  return lines.join("\n");
}

function renderHarnessTitle(harness: HarnessRunResult): string {
  return [
    `- Kind: ${harness.harness}`,
    `- Actor: ${harness.actorId}`,
    `- Agent session: ${harness.agentSessionId ?? "unknown"}`,
    `- Native session: ${harness.harnessSessionId ?? "unknown"}`,
    `- CWD: ${harness.cwd}`,
    `- Exit code: ${harness.exitCode}`,
    `- Error: ${harness.error ?? "none"}`,
    `- Started: ${harness.startedAt}`,
    `- Finished: ${harness.finishedAt}`,
  ].join("\n");
}

function renderUsage(harness: HarnessRunResult): string {
  const usage = harness.usage;
  if (usage === undefined) return "- Usage: not reported";
  const parts: string[] = [];
  if (usage.inputTokens !== undefined) parts.push(`input=${usage.inputTokens}`);
  if (usage.outputTokens !== undefined) parts.push(`output=${usage.outputTokens}`);
  if (usage.totalTokens !== undefined) parts.push(`total=${usage.totalTokens}`);
  if (usage.costUsd !== undefined) parts.push(`cost=$${usage.costUsd}`);
  return `- Usage: ${parts.length > 0 ? parts.join(" ") : "not reported"}`;
}

function renderCampfireCalls(harness: HarnessRunResult): string {
  if (harness.mcpCalls.length === 0) return "No Campfire calls recorded.";
  const rows = harness.mcpCalls.map((call) => {
    const input = call.input === undefined ? "" : truncate(JSON.stringify(call.input), 300);
    return `| \`${escapeTableCell(call.tool)}\` | ${escapeTableCell(input)} |`;
  });
  return ["| Tool | Input |", "| --- | --- |", ...rows].join("\n");
}

function renderHarnessMarkdown(harness: HarnessRunResult, title: string, extra = ""): string {
  return [
    `# ${title}`,
    "",
    "## Command",
    "",
    "```text",
    harness.command.join(" "),
    "```",
    "",
    renderHarnessTitle(harness),
    renderUsage(harness),
    "",
    "## Final message",
    "",
    "```text",
    harness.finalMessage || "(empty)",
    "```",
    "",
    "## Campfire calls",
    "",
    renderCampfireCalls(harness),
    extra,
    "",
  ].join("\n");
}

function renderErgonomics(evidence: RealAcceptanceEvidence): string {
  const e = evidence.ergonomics;
  return [
    "",
    "## Ergonomics",
    "",
    `- First Campfire call: ${e.firstCampfireCall ?? "unknown"}`,
    `- Total Campfire calls: ${e.totalCampfireCalls}`,
    `- Reads / writes: ${e.readCalls} / ${e.writeCalls}`,
    `- Orientation tool calls: ${e.orientationToolCalls}`,
    `- Redundant reads: ${e.redundantReads} (${e.redundantReadTools.join(", ") || "none"})`,
    `- Missing context: ${e.missingContextSignals.join("; ") || "none"}`,
    `- Context noise: ${e.contextNoiseSignals.join("; ") || "none"}`,
    `- Call sequence: ${e.sequence.join(" → ") || "none"}`,
    "",
  ].join("\n");
}

function renderChecksTable(checks: RealAcceptanceCheck[]): string {
  if (checks.length === 0) return "No checks recorded.";
  const rows = checks.map(
    (check) =>
      `| ${escapeTableCell(check.name)} | ${check.passed ? "pass" : "FAIL"} | ${escapeTableCell(check.detail ?? "")} |`,
  );
  return ["| Check | Result | Detail |", "| --- | --- | --- |", ...rows].join("\n");
}

function renderNotes(evidence: RealAcceptanceEvidence): string {
  const interventions =
    evidence.humanInterventions.length === 0
      ? "None after the initial instruction."
      : evidence.humanInterventions
          .map(
            (intervention) =>
              `- [${intervention.classification}] ${intervention.description}`,
          )
          .join("\n");
  const limitations =
    evidence.limitations.length === 0 ? "None recorded." : evidence.limitations.map((item) => `- ${item}`).join("\n");

  return [
    "# Sprint 002 — Notes",
    "",
    `Scenario: ${evidence.scenario}`,
    "",
    "## Recommendation",
    "",
    `**${evidence.recommendation}**`,
    "",
    "## Checks",
    "",
    renderChecksTable(evidence.checks),
    "",
    "## Limitations",
    "",
    limitations,
    "",
    "## Human interventions",
    "",
    interventions,
    "",
  ].join("\n");
}

/**
 * Write the Sprint 002 evidence tree and return the created file paths.
 *
 * The directory is reserved first, then written, then the reservation is
 * released on failure. A partial directory that survives as `run-<date>` would
 * be the worst outcome of all — it is indistinguishable, a week later, from a
 * complete run, and that ambiguity is exactly the class of bug this module
 * exists to prevent. So a caught failure removes the directory outright: the
 * reservation is exclusive, so removing it cannot destroy anyone else's
 * evidence, and the name is free for the next attempt.
 *
 * A hard kill (SIGKILL, power loss) cannot run that cleanup. `acceptance.json`
 * is written last for that case — see {@link COMPLETION_MARKER}.
 */
export function writeRealEvidence(evidence: RealAcceptanceEvidence, directory?: string): WriteEvidenceResult {
  const dir = reserveRunDirectory(evidence, directory);

  const files: string[] = [];
  try {
    // Rendering lives inside the try: a renderer that throws would otherwise
    // strand an empty reserved directory under a run-shaped name.
    const contents: Record<(typeof EVIDENCE_FILES)[number], string> = {
      "acceptance.json": json(evidence),
      "campfire-state-before-b.json": json(evidence.stateBeforeB),
      "campfire-state-after-b.json": json(evidence.stateAfterB),
      "environment.md": renderEnvironment(evidence),
      "harness-a.md": renderHarnessMarkdown(evidence.harnessA, "Sprint 002 — Harness A"),
      "harness-b.md": renderHarnessMarkdown(evidence.harnessB, "Sprint 002 — Harness B", renderErgonomics(evidence)),
      "notes.md": renderNotes(evidence),
    };

    for (const name of WRITE_ORDER) {
      const filePath = resolve(dir, name);
      // "wx" fails with EEXIST instead of truncating. A file inside a directory
      // this run just claimed means another writer is inside a directory it does
      // not own; that is a bug worth surfacing, not a file to replace.
      writeFileSync(filePath, contents[name], { encoding: "utf8", flag: "wx" });
      files.push(filePath);
    }
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }

  return { directory: dir, files };
}
