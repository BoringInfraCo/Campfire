/**
 * Sprint 001 acceptance executable.
 *
 * Runs the cross-harness handoff acceptance scenario, writes machine-readable
 * evidence, and prints a concise summary. Exits non-zero on a NO-GO
 * recommendation so CI can gate on the product thesis.
 */
import { runAcceptance, writeEvidence } from "../src/acceptance/run.js";
import type { AcceptanceEvidence } from "../src/acceptance/run.js";

function summarize(evidence: AcceptanceEvidence, evidencePath: string): string {
  const lines: string[] = [];
  lines.push("Campfire Sprint 001 acceptance run");
  lines.push("==================================");
  lines.push(`scenario:       ${evidence.scenario}`);
  lines.push(`harness A:      ${evidence.harnesses.a.label} (${evidence.harnesses.a.actorId})`);
  lines.push(`harness B:      ${evidence.harnesses.b.label} (${evidence.harnesses.b.actorId})`);
  lines.push(`duration:       ${evidence.durationMs} ms`);
  lines.push("");
  lines.push("checks:");
  for (const check of evidence.checks) {
    lines.push(`  [${check.passed ? "PASS" : "FAIL"}] ${check.name}${check.detail ? ` (${check.detail})` : ""}`);
  }
  lines.push("");
  lines.push(`recommendation: ${evidence.recommendation}`);
  lines.push(`evidence:       ${evidencePath}`);
  return lines.join("\n");
}

async function main(): Promise<void> {
  const evidence = await runAcceptance();
  const evidencePath = writeEvidence(evidence);
  console.log(summarize(evidence, evidencePath));
  if (evidence.recommendation === "NO-GO") {
    process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
