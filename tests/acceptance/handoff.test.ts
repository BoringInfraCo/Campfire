/**
 * Sprint 001 acceptance test.
 *
 * This is the end-to-end product proof: two real, independent MCP client
 * processes (labelled codex and opencode) share one Campfire workspace over
 * stdio and hand work across the harness boundary without sharing a transcript
 * (docs/SPRINT_001.md sections 11, 12, 15).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { FIXTURE } from "../../src/bootstrap/seed.js";
import { PRIVATE_TRANSCRIPT_SENTINEL_A } from "../../src/acceptance/harness-a.js";
import { runAcceptance } from "../../src/acceptance/run.js";
import type { AcceptanceEvidence } from "../../src/acceptance/run.js";

let evidence: AcceptanceEvidence;

beforeAll(async () => {
  evidence = await runAcceptance({ keepDatabase: false });
}, 120_000);

describe("Sprint 001 end-to-end handoff", () => {
  it("recommends GO", () => {
    expect(evidence.recommendation).toBe("GO");
  });

  it("passes every acceptance check", () => {
    const failed = evidence.checks.filter((check) => !check.passed);
    expect(failed).toEqual([]);
    expect(evidence.checks.length).toBeGreaterThan(0);
  });

  it("holds transcript isolation across harnesses", () => {
    const check = evidence.checks.find(
      (entry) => entry.name === "transcript.sentinel_absent_from_harness_b",
    );
    expect(check?.passed).toBe(true);
    expect(evidence.transcriptIsolation.presentInHarnessBRetrieval).toBe(false);
    expect(JSON.stringify(evidence.harnessB.context)).not.toContain(
      PRIVATE_TRANSCRIPT_SENTINEL_A,
    );
    expect(JSON.stringify(evidence.harnessB.activityAfterWrites)).not.toContain(
      PRIVATE_TRANSCRIPT_SENTINEL_A,
    );
  });

  it("preserves Agent A's originals with unchanged provenance", () => {
    const { findings, decisions, artifacts, contributions } = evidence.finalState;

    const finding = findings.find((item) => item.id === evidence.harnessA.coreFinding.id);
    expect(finding).toBeDefined();
    expect(finding?.summary).toBe(evidence.harnessA.coreFinding.summary);
    expect(finding?.createdAt).toBe(evidence.harnessA.coreFinding.createdAt);
    expect(finding?.createdBy.actorId).toBe(FIXTURE.agents.codexSergio);
    expect(finding?.agentSessionId).toBe(evidence.harnessA.session.id);

    const decision = decisions.find((item) => item.id === evidence.harnessA.decision.id);
    expect(decision).toBeDefined();
    expect(decision?.status).toBe("accepted");
    expect(decision?.createdAt).toBe(evidence.harnessA.decision.createdAt);
    expect(decision?.createdBy.actorId).toBe(FIXTURE.agents.codexSergio);

    const task = evidence.finalState.tasks.find((item) => item.id === evidence.harnessA.task.id);
    expect(task).toBeDefined();
    expect(task?.createdBy.actorId).toBe(FIXTURE.agents.codexSergio);
    expect(task?.createdAt).toBe(evidence.harnessA.task.createdAt);

    const artifact = artifacts.find((item) => item.id === evidence.harnessA.artifact.id);
    expect(artifact).toBeDefined();
    expect(artifact?.uriOrPath).toBe("fixtures/billing/migration-284.sql");
    expect(artifact?.createdBy.actorId).toBe(FIXTURE.agents.codexSergio);

    const aContributions = contributions.filter(
      (entry) => entry.agentSessionId === evidence.harnessA.session.id,
    );
    expect(aContributions.length).toBeGreaterThan(0);
    expect(aContributions.every((entry) => entry.actor.actorId === FIXTURE.agents.codexSergio)).toBe(
      true,
    );
  });

  it("records Agent B's continuation with distinct provenance", () => {
    expect(evidence.harnessA.session.id).not.toBe(evidence.harnessB.session.id);

    const bFinding = evidence.finalState.findings.find(
      (finding) => finding.id === evidence.harnessB.newFinding.id,
    );
    expect(bFinding).toBeDefined();
    expect(bFinding?.createdBy.actorId).toBe(FIXTURE.agents.opencodeAlice);
    expect(bFinding?.agentSessionId).toBe(evidence.harnessB.session.id);

    const bContributions = evidence.finalState.contributions.filter(
      (entry) => entry.agentSessionId === evidence.harnessB.session.id,
    );
    expect(bContributions.length).toBeGreaterThan(0);
    expect(
      bContributions.every((entry) => entry.actor.actorId === FIXTURE.agents.opencodeAlice),
    ).toBe(true);

    // Activity is append-only and ordered: every Agent A contribution precedes
    // Agent B's first contribution.
    const contributionIndices = evidence.finalState.contributions.map((entry, index) => ({
      index,
      sessionId: entry.agentSessionId,
    }));
    const aIndices = contributionIndices
      .filter((entry) => entry.sessionId === evidence.harnessA.session.id)
      .map((entry) => entry.index);
    const bIndices = contributionIndices
      .filter((entry) => entry.sessionId === evidence.harnessB.session.id)
      .map((entry) => entry.index);
    expect(aIndices.length).toBeGreaterThan(0);
    expect(bIndices.length).toBeGreaterThan(0);
    expect(Math.min(...bIndices)).toBeGreaterThan(Math.max(...aIndices));
  });

  it("keeps the workspace boundary scoped for Agent B", () => {
    expect(evidence.harnessB.workspaceIds).toEqual([FIXTURE.workspaces.billing]);
    expect(evidence.harnessB.workspaceIds).not.toContain(FIXTURE.workspaces.unrelated);
    expect(evidence.harnessB.unauthorizedAttempt.ok).toBe(false);
    expect(["ParticipantRequired", "Unauthorized"]).toContain(
      evidence.harnessB.unauthorizedAttempt.error,
    );
    expect(JSON.stringify(evidence.harnessB.context)).not.toContain(
      FIXTURE.unrelatedFindingSentinel,
    );
  });
});
