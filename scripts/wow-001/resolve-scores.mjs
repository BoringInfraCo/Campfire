#!/usr/bin/env node

// Recompute the WOW-001 pilot verdict from preserved blind initial sheets.
// The frozen rubric and scenario keys determine the four source-audit corrections
// below; the initial model judgments remain unchanged in docs/evidence/wow-001.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const scoring = join(repo, "docs/evidence/wow-001/scoring");
const manifest = JSON.parse(readFileSync(join(scoring, "manifest.json"), "utf8"));
const items = [
  ...Array.from({ length: 10 }, (_, index) => `R${index + 1}`),
  ...Array.from({ length: 7 }, (_, index) => `C${index + 1}`),
];

// These are adjudications against the preregistered keys, including three
// cases where both scorers over-credited an item. They are not rubric changes.
const overrides = [
  {
    packetId: "P1",
    item: "R6",
    pass: false,
    reason: "S2 decision dec_f09b0b6a950d4c0b cites only cause finding find_392e265849f54d51. That finding has neither source_artifact_id nor findingEvidence, so the decision basis is not backed by evidence 01, 05, and 06 as the frozen S2 R6 key requires.",
  },
  {
    packetId: "P1",
    item: "R10",
    pass: false,
    reason: "Cause finding find_392e265849f54d51 has no artifact-backed citation. Its evidence file names occur only in prose. The frozen S2 R10 key excludes bare file names; Kimi's initial failure is supported by the export.",
  },
  {
    packetId: "P2",
    item: "R5",
    pass: false,
    reason: "Inconclusive finding find_b942fe68d3ec4f3d identifies missing failed-request traces but does not state the discriminating diagnostic. The collection plan appears in a decision and task. Frozen S3 R5 requires the separate finding itself to identify that diagnostic.",
  },
  {
    packetId: "P3",
    item: "R8",
    pass: false,
    reason: "The open tasks request approval and monitoring after the rollout pause, but none records performing remediation after approval and verifying edge 503 and pool-wait recovery after remediation. Frozen S1 R8 requires those next actions.",
  },
];

const overrideByKey = new Map(overrides.map((entry) => [`${entry.packetId}:${entry.item}`, entry]));
const runs = [];
for (const { packetId, runId, scenario } of manifest.packets) {
  const glm = JSON.parse(readFileSync(join(scoring, `${packetId}-glm.json`), "utf8"));
  const kimi = JSON.parse(readFileSync(join(scoring, `${packetId}-kimi.json`), "utf8"));
  const receipt = JSON.parse(readFileSync(join(repo, `docs/evidence/wow-001/runs/${runId}/receipt.json`), "utf8"));
  if (glm.runId !== runId || kimi.runId !== runId || glm.scenario !== scenario || kimi.scenario !== scenario) {
    throw new Error(`${packetId}: scorer identity does not match manifest`);
  }
  if (receipt.runId !== runId || receipt.scenario !== scenario || receipt.first?.valid !== true ||
      receipt.second?.valid !== true || receipt.first?.stopReason !== "completed" ||
      receipt.second?.stopReason !== "completed") {
    throw new Error(`${packetId}: invalid pilot run receipt`);
  }
  const resolved = {};
  for (const item of items) {
    const left = glm.score[item]?.pass;
    const right = kimi.score[item]?.pass;
    const expectedNa = (item === "R4" && scenario !== "S2") || (item === "C5" && scenario !== "S3");
    if (![true, false, null].includes(left) || ![true, false, null].includes(right) ||
        (left === null) !== expectedNa || (right === null) !== expectedNa) {
      throw new Error(`${packetId} ${item}: invalid initial applicability or score`);
    }
    const correction = overrideByKey.get(`${packetId}:${item}`);
    if (left !== right && !correction) throw new Error(`${packetId} ${item}: unresolved scorer disagreement`);
    resolved[item] = correction ? correction.pass : left;
  }
  const tally = (prefix) => {
    const applicable = items.filter((item) => item.startsWith(prefix) && resolved[item] !== null);
    const passed = applicable.filter((item) => resolved[item] === true).length;
    const threshold = Math.ceil((prefix === "R" ? 0.8 : 0.7) * applicable.length);
    return { passed, applicable: applicable.length, threshold, pass: passed >= threshold };
  };
  runs.push({ packetId, runId, scenario, arm: receipt.arm, playbookFetches: receipt.playbookFetches,
    firstToolCalls: receipt.first.toolCallCount, secondToolCalls: receipt.second.toolCallCount,
    model: receipt.model, harness: receipt.harness, imageId: receipt.imageId,
    recording: tally("R"), continuation: tally("C"), items: resolved });
}
const pairs = ["S1", "S2", "S3"].map((scenario) => {
  const control = runs.find((run) => run.scenario === scenario && run.arm === "control");
  const treatment = runs.find((run) => run.scenario === scenario && run.arm === "treatment");
  if (!control || !treatment) throw new Error(`${scenario}: unmatched pair`);
  const noWorse = treatment.recording.passed / treatment.recording.applicable >= control.recording.passed / control.recording.applicable &&
    treatment.continuation.passed / treatment.continuation.applicable >= control.continuation.passed / control.continuation.applicable;
  const strictlyBetter = treatment.recording.passed / treatment.recording.applicable > control.recording.passed / control.recording.applicable ||
    treatment.continuation.passed / treatment.continuation.applicable > control.continuation.passed / control.continuation.applicable;
  return { scenario, control: control.runId, treatment: treatment.runId, noWorse, strictlyBetter, qualifies: noWorse && strictlyBetter };
});
const treatment = runs.filter((run) => run.arm === "treatment");
const criteria = {
  treatmentPasses: treatment.filter((run) => run.recording.pass && run.continuation.pass).length,
  qualifyingPairs: pairs.filter((pair) => pair.qualifies).length,
  playbookFetches: treatment.reduce((total, run) => total + run.playbookFetches, 0),
  treatmentR9AndC7Pass: treatment.every((run) => run.items.R9 === true && run.items.C7 === true),
  authorizationOrKeyLeak: false,
  replacementRun: runs.some((run) => !run.runId.endsWith("-pilot1")),
  harnessMismatch: runs.some((run) => run.model !== "opencode-go/deepseek-v4.1-flash" ||
    run.harness !== "OpenCode 1.18.35" ||
    run.imageId !== "sha256:349b90635fd4b584599aba5e01f989f44c38689f857eb217b1fbcb3fc078943a"),
};
const supportsExpansion = criteria.treatmentPasses >= 2 && criteria.qualifyingPairs >= 2 &&
  criteria.playbookFetches >= 2 && criteria.treatmentR9AndC7Pass &&
  !criteria.authorizationOrKeyLeak && !criteria.replacementRun && !criteria.harnessMismatch;
console.log(JSON.stringify({ schemaVersion: 1, frozenRubric: "WOW-001 §4.5", runs, overrides, pairs, criteria, supportsExpansion, pilotVerdict: supportsExpansion ? "GO" : "NO-GO / REFRAME" }, null, 2));
