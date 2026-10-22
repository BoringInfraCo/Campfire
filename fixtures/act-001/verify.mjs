// ACT-001 Step 0 verifier. Recomputes frozen digests/HMACs and checks answer-key.
// Usage: node fixtures/act-001/verify.mjs
// No store, no network, no credentials. Synthetic test-only secret lives in the fixture.
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "evidence", "act-001", "step-0");
const load = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");

let failures = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra && cond ? "" : ` :: ${extra}`}`);
  if (!cond) failures += 1;
};

// --- canonical intent encoding (must match proposal/canonical-proposal.json) ---
const SHA = "deadbeef".repeat(8);
function intentLines({ executor, reason, findings, artifacts }) {
  return [
    "ACT001-INTENT-V1",
    "intentVersion=1",
    "kind=ci.retry_verification",
    "repoId=123456789",
    "repoName=example-org/verification-sandbox",
    "workflowId=9876543",
    "runId=11223344",
    "sha=" + SHA,
    "expectedAttempt=2",
    "executor=" + executor,
    "expiresAt=2026-10-22T12:00:00.000Z",
    "reason=" + reason,
    "task=task_act001_verify@2026-10-21T12:00:40.000Z",
    "findings=" + findings,
    "artifacts=" + artifacts,
    "sourceAuthorityRev=src_act001_github#1",
  ].join("\n");
}
const vectors = load("proposal/digest-vectors.json");
check("V1 digest", sha(intentLines({ executor: "agent:agt_act001_opencode_ben", reason: "Retry the failed verification run after inspecting the failed job logs", findings: "find_act001_logs:current", artifacts: "" })) === vectors.intentVectors[0].sha256);
check("V2 digest", sha(intentLines({ executor: "human:hum_act001_ada", reason: "Retry the failed verification run; two failing jobs point at the same regression", findings: "find_act001_baseline:current,find_act001_logs:current", artifacts: "art_act001_runref" })) === vectors.intentVectors[1].sha256);
const v1 = sha(intentLines({ executor: "agent:agt_act001_opencode_ben", reason: "Retry the failed verification run after inspecting the failed job logs", findings: "find_act001_logs:current", artifacts: "" }));
const v3 = sha(intentLines({ executor: "agent:agt_act001_opencode_ben", reason: "Retry the failed verification run after inspecting the failed job logz", findings: "find_act001_logs:current", artifacts: "" }));
check("V3 tamper differs", v3 === vectors.intentVectors[2].sha256 && v3 !== v1);
check("intent sizes under 4KiB", Buffer.byteLength(intentLines({ executor: "agent:agt_act001_opencode_ben", reason: "x".repeat(500), findings: "find_act001_logs:current", artifacts: "" }), "utf8") <= 4096);

// --- source authority fingerprint ---
const src = ["ACT001-SOURCE-V1", "sourceId=src_act001_github", "workspaceId=ws_act001_lab", "repoId=123456789", "repoName=example-org/verification-sandbox", "workflowId=9876543", "actionKind=ci.retry_verification", "integrationAgent=agent:agt_act001_integration:ses_act001_integration_01"].join("\n");
check("source fingerprint", sha(src) === vectors.sourceAuthorityFingerprint.sha256);

// --- signed payloads ---
const payloads = load("proposal/signed-payloads.json");
const hmac = (s, body) => "sha256=" + createHmac("sha256", s).update(body).digest("hex");
for (const c of payloads.cases) {
  if (c.id === "tampered") {
    check("tamper detected", hmac(payloads.testOnlySecret, c.body) !== c.signature);
    continue;
  }
  if (c.id === "replay-same-delivery") {
    check("replay setup recorded", c.expected.startsWith("409"));
    continue;
  }
  check(`hmac ${c.id}`, hmac(payloads.testOnlySecret, c.body) === c.signature);
}

// --- answer key cross-checks ---
const key = load("answer-key.json");
check("answer-key workspace", key.workspace === "ws_act001_lab");
check("answer-key intent V1", key.intentDigestV1 === vectors.intentVectors[0].sha256);
check("answer-key source fp", key.sourceAuthorityFingerprint === vectors.sourceAuthorityFingerprint.sha256);
check("answer-key contribution total", key.contributionCounts.ws_act001_lab === 14 && key.contributionCounts.ws_act001_other === 1);
check("requestKey rule", new RegExp(key.requestKeyRule).test("approve-rev3-0001") && !new RegExp(key.requestKeyRule).test(""));

if (failures > 0) { console.error(`${failures} check(s) FAILED`); process.exit(1); }
console.log("all Step 0 frozen values verify");
