/**
 * Sprint 002 evidence writer.
 *
 * Renders the section 19 evidence tree from a captured acceptance run. This is
 * a pure formatting layer: it never re-evaluates checks and never records raw
 * environment dumps, auth tokens, or private transcript contents. Command
 * arrays may contain the SQLite path; that is not a secret.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { HarnessRunResult, RealAcceptanceCheck, RealAcceptanceEvidence } from "./types.js";

export interface WriteEvidenceResult {
  directory: string;
  files: string[];
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

/** Write the Sprint 002 evidence tree and return the created file paths. */
export function writeRealEvidence(
  evidence: RealAcceptanceEvidence,
  directory = "evidence/sprint-002",
): WriteEvidenceResult {
  const dir = resolve(directory);
  mkdirSync(dir, { recursive: true });

  const contents: Record<(typeof EVIDENCE_FILES)[number], string> = {
    "acceptance.json": json(evidence),
    "campfire-state-before-b.json": json(evidence.stateBeforeB),
    "campfire-state-after-b.json": json(evidence.stateAfterB),
    "environment.md": renderEnvironment(evidence),
    "harness-a.md": renderHarnessMarkdown(evidence.harnessA, "Sprint 002 — Harness A"),
    "harness-b.md": renderHarnessMarkdown(evidence.harnessB, "Sprint 002 — Harness B", renderErgonomics(evidence)),
    "notes.md": renderNotes(evidence),
  };

  const files: string[] = [];
  for (const name of EVIDENCE_FILES) {
    const filePath = resolve(dir, name);
    writeFileSync(filePath, contents[name], "utf8");
    files.push(filePath);
  }

  return { directory: dir, files };
}
