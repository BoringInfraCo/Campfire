/**
 * ACT-001 canonical digest vectors (Step 1 core).
 *
 * The digest binds the exact approved effect: SHA-256 over the frozen
 * Step-0 ACT001-INTENT-V1 key=value line encoding (see
 * docs/evidence/act-001/step-0/proposal/canonical-proposal.json). These
 * vectors pin the frozen V1/V2/V3 digests so the local SQLite path and the
 * Workers/D1 path cannot drift. The pure-TS implementation is cross-checked
 * against Node's crypto for every vector.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  actionIntentDigest,
  assertActionTransition,
  assertReceiptAllowed,
  actionTargetKey,
  canonicalIntentEnvelope,
} from "../../src/domain/action-proposal.js";

const SHA = "deadbeef".repeat(8);

const FROZEN_BASE = {
  target: {
    repositoryId: "123456789",
    repositoryName: "example-org/verification-sandbox",
    workflowId: "9876543",
    runId: "11223344",
    commitSha: SHA,
    expectedAttempt: 2,
  },
  executor: { actorId: "agt_act001_opencode_ben", actorType: "agent" as const },
  expiresAt: "2026-10-22T12:00:00.000Z",
  reason: "Retry the failed verification run after inspecting the failed job logs",
  task: { id: "task_act001_verify", status: "open", updatedAt: "2026-10-21T12:00:40.000Z" },
  findings: [{ id: "find_act001_logs", currentness: "current" }],
  artifacts: [] as Array<{ id: string }>,
  sourceAuthorityRevision: "src_act001_github#1",
};

const FROZEN_V1_ENVELOPE = [
  "ACT001-INTENT-V1",
  "intentVersion=1",
  "kind=ci.retry_verification",
  "repoId=123456789",
  "repoName=example-org/verification-sandbox",
  "workflowId=9876543",
  "runId=11223344",
  `sha=${SHA}`,
  "expectedAttempt=2",
  "executor=agent:agt_act001_opencode_ben",
  "expiresAt=2026-10-22T12:00:00.000Z",
  "reason=Retry the failed verification run after inspecting the failed job logs",
  "task=task_act001_verify@2026-10-21T12:00:40.000Z",
  "findings=find_act001_logs:current",
  "artifacts=",
  "sourceAuthorityRev=src_act001_github#1",
].join("\n");

function nodeDigest(envelope: string): string {
  return createHash("sha256").update(envelope, "utf8").digest("hex");
}

describe("canonical intent envelope", () => {
  it("emits the frozen ACT001-INTENT-V1 key=value lines byte-identically", () => {
    expect(canonicalIntentEnvelope(FROZEN_BASE)).toBe(FROZEN_V1_ENVELOPE);
  });

  it("sorts findings and artifacts lexicographically so citation order cannot change the digest", () => {
    const envelope = canonicalIntentEnvelope({
      ...FROZEN_BASE,
      executor: { actorId: "hum_act001_ada", actorType: "human" },
      reason: "Retry the failed verification run; two failing jobs point at the same regression",
      findings: [
        { id: "find_act001_logs", currentness: "current" },
        { id: "find_act001_baseline", currentness: "current" },
      ],
      artifacts: [{ id: "art_act001_runref" }],
    });
    expect(envelope).toContain("findings=find_act001_baseline:current,find_act001_logs:current");
    expect(envelope).toContain("artifacts=art_act001_runref");
    expect(envelope).toContain("executor=human:hum_act001_ada");
  });

  it("matches Node crypto for the frozen V1 vector", () => {
    const envelope = canonicalIntentEnvelope(FROZEN_BASE);
    expect(actionIntentDigest(envelope)).toBe(nodeDigest(envelope));
    // Frozen Step-0 vector (docs/evidence/act-001/step-0/proposal/digest-vectors.json):
    // changing this digest requires a dated amendment.
    expect(actionIntentDigest(envelope)).toBe(
      "1b940e4d27b382180cb6a38ba33331118af8911f235be1bed27e6e9929ac5cba",
    );
  });

  it("matches Node crypto for the frozen V2 multi vector", () => {
    const envelope = canonicalIntentEnvelope({
      ...FROZEN_BASE,
      executor: { actorId: "hum_act001_ada", actorType: "human" },
      reason: "Retry the failed verification run; two failing jobs point at the same regression",
      findings: [
        { id: "find_act001_logs", currentness: "current" },
        { id: "find_act001_baseline", currentness: "current" },
      ],
      artifacts: [{ id: "art_act001_runref" }],
    });
    expect(actionIntentDigest(envelope)).toBe(nodeDigest(envelope));
    expect(actionIntentDigest(envelope)).toBe(
      "37bd64f01f05fcf8320caf21f938946097124b3893c001cb36165e718a407d6c",
    );
  });

  it("matches the frozen V3 tamper vector and differs from V1", () => {
    const v1 = actionIntentDigest(canonicalIntentEnvelope(FROZEN_BASE));
    const tampered = actionIntentDigest(
      canonicalIntentEnvelope({
        ...FROZEN_BASE,
        reason: "Retry the failed verification run after inspecting the failed job logz",
      }),
    );
    expect(tampered).toBe("6fec0002ec064ecac35c9371720bfffc653432c66036a49472b8decf3f1cf009");
    expect(tampered).not.toBe(v1);
  });

  it("normalizes decimal id strings to the frozen numeric bytes", () => {
    const baseline = actionIntentDigest(canonicalIntentEnvelope(FROZEN_BASE));
    const padded = actionIntentDigest(
      canonicalIntentEnvelope({
        ...FROZEN_BASE,
        target: { ...FROZEN_BASE.target, runId: "0011223344" },
      }),
    );
    expect(padded).toBe(baseline);
  });

  it("binds taskId@updatedAt only: status alone does not change the digest", () => {
    // Frozen task binding is taskId@updatedAt (canonical-proposal.json §taskBinding).
    // A status transition without an updatedAt bump leaves the digest stable;
    // any task version bump invalidates the approval.
    const baseline = actionIntentDigest(canonicalIntentEnvelope(FROZEN_BASE));
    expect(
      actionIntentDigest(
        canonicalIntentEnvelope({
          ...FROZEN_BASE,
          task: { ...FROZEN_BASE.task, status: "in_progress" },
        }),
      ),
    ).toBe(baseline);
    expect(
      actionIntentDigest(
        canonicalIntentEnvelope({
          ...FROZEN_BASE,
          task: { ...FROZEN_BASE.task, status: "in_progress", updatedAt: "2026-10-21T12:01:00.000Z" },
        }),
      ),
    ).not.toBe(baseline);
  });

  it("changes when any other bound field changes", () => {
    const baseline = actionIntentDigest(canonicalIntentEnvelope(FROZEN_BASE));
    const variants = [
      { ...FROZEN_BASE, reason: "Retry the failed verification run after inspecting the failed job logs!" },
      { ...FROZEN_BASE, task: { ...FROZEN_BASE.task, updatedAt: "2026-10-21T12:00:41.000Z" } },
      { ...FROZEN_BASE, findings: [{ id: "find_act001_logs", currentness: "superseded" }] },
      { ...FROZEN_BASE, executor: { actorId: "hum_other", actorType: "human" as const } },
      { ...FROZEN_BASE, expiresAt: "2026-10-22T12:00:01.000Z" },
      { ...FROZEN_BASE, target: { ...FROZEN_BASE.target, expectedAttempt: 3 } },
      { ...FROZEN_BASE, sourceAuthorityRevision: "src_act001_github#2" },
      { ...FROZEN_BASE, artifacts: [{ id: "art_act001_runref" }] },
    ];
    for (const variant of variants) {
      expect(actionIntentDigest(canonicalIntentEnvelope(variant))).not.toBe(baseline);
    }
  });
});

describe("target key", () => {
  it("is stable per exact target and attempt, and distinct across attempts", () => {
    expect(actionTargetKey(FROZEN_BASE.target)).toBe("123456789:9876543:11223344:2");
    expect(actionTargetKey({ ...FROZEN_BASE.target, expectedAttempt: 3 })).toBe("123456789:9876543:11223344:3");
    expect(actionTargetKey({ ...FROZEN_BASE.target, runId: "11223345" })).toBe("123456789:9876543:11223345:2");
  });
});

describe("transition matrix", () => {
  it("allows the specified forward transitions", () => {
    expect(() => assertActionTransition("proposed", "approved")).not.toThrow();
    expect(() => assertActionTransition("proposed", "rejected")).not.toThrow();
    expect(() => assertActionTransition("proposed", "cancelled")).not.toThrow();
    expect(() => assertActionTransition("approved", "cancelled")).not.toThrow();
    expect(() => assertActionTransition("approved", "dispatch_reserved")).not.toThrow();
    expect(() => assertActionTransition("dispatch_reserved", "submission_accepted")).not.toThrow();
    expect(() => assertActionTransition("dispatch_reserved", "submission_failed")).not.toThrow();
    expect(() => assertActionTransition("dispatch_reserved", "submission_unknown")).not.toThrow();
    expect(() => assertActionTransition("submission_unknown", "submission_accepted")).not.toThrow();
    expect(() => assertActionTransition("submission_unknown", "submission_failed")).not.toThrow();
  });

  it("rejects reversals, skips, and terminal exits", () => {
    const forbidden: Array<[string, string]> = [
      ["approved", "proposed"],
      ["rejected", "approved"],
      ["cancelled", "approved"],
      ["dispatch_reserved", "cancelled"],
      ["dispatch_reserved", "approved"],
      ["submission_accepted", "submission_failed"],
      ["submission_failed", "submission_accepted"],
      ["submission_unknown", "dispatch_reserved"],
      ["rejected", "cancelled"],
      ["proposed", "dispatch_reserved"],
      ["approved", "submission_accepted"],
    ];
    for (const [from, to] of forbidden) {
      expect(() => assertActionTransition(from as never, to as never)).toThrow();
    }
  });
});

describe("receipt rules", () => {
  it("accepts first outcomes only from dispatch_reserved", () => {
    expect(() => assertReceiptAllowed("dispatch_reserved", "accepted", undefined)).not.toThrow();
    expect(() => assertReceiptAllowed("dispatch_reserved", "definite_failure", undefined)).not.toThrow();
    expect(() => assertReceiptAllowed("dispatch_reserved", "unknown", undefined)).not.toThrow();
    expect(() => assertReceiptAllowed("approved", "accepted", undefined)).toThrow();
    expect(() => assertReceiptAllowed("submission_accepted", "accepted", undefined)).toThrow();
    expect(() => assertReceiptAllowed("dispatch_reserved", "reconciled_accepted", "arcp_1")).toThrow();
  });

  it("accepts reconciliation only for unknown with a cited receipt", () => {
    expect(() => assertReceiptAllowed("submission_unknown", "reconciled_accepted", "arcp_1")).not.toThrow();
    expect(() => assertReceiptAllowed("submission_unknown", "reconciled_failure", "arcp_1")).not.toThrow();
    expect(() => assertReceiptAllowed("submission_unknown", "reconciled_accepted", undefined)).toThrow();
    expect(() => assertReceiptAllowed("submission_unknown", "accepted", undefined)).toThrow();
    expect(() => assertReceiptAllowed("submission_accepted", "reconciled_accepted", "arcp_1")).toThrow();
  });
});
