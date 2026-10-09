/**
 * Sprint 002 real-harness acceptance runner.
 *
 * Not part of `npm test`: it invokes real vendor agent harnesses against real
 * model providers, so it is run explicitly and its output is captured as
 * evidence rather than asserted in the deterministic CI suite.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runRealAcceptance } from "../src/acceptance/real/run.js";

function line(text = ""): void {
  process.stdout.write(`${text}\n`);
}

const result = await runRealAcceptance({ keepArtifacts: true });
const { evidence, evidenceDir, rootDir } = result;

line("Campfire Sprint 002 — real-harness acceptance");
line("=============================================");
line(`harness A:      ${evidence.environment.harnessA.kind} ${evidence.environment.harnessA.version} (${evidence.environment.harnessA.actorId})`);
line(`harness B:      ${evidence.environment.harnessB.kind} ${evidence.environment.harnessB.version} (${evidence.environment.harnessB.actorId})`);
line(`duration:       ${evidence.durationMs} ms`);
line("");
line("checks:");
for (const check of evidence.checks) {
  line(`  [${check.passed ? "PASS" : "FAIL"}] ${check.name}${check.detail ? ` (${check.detail})` : ""}`);
}
line("");
line(`recommendation: ${evidence.recommendation}`);
line(`evidence:       ${evidenceDir}`);
line(`raw captures:   ${rootDir}`);
line("");

// Every run lands in its own dated directory; refresh the tracked index so the
// manifest records this run's verdict and per-file hashes without hand-editing.
const manifest = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("./evidence-manifest.mjs", import.meta.url))],
  { stdio: "inherit" },
);
if (manifest.status !== 0) line("warning: evidence manifest was not regenerated; run: npm run evidence:manifest");

process.exitCode = evidence.recommendation === "NO-GO / REFRAME" ? 1 : 0;
