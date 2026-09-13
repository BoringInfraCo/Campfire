import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeChecks, recommend } from "../../src/acceptance/real/checks.js";
import type { CheckInput } from "../../src/acceptance/real/checks.js";
import { writeRealEvidence } from "../../src/acceptance/real/evidence.js";
import type {
  CampfireSnapshot,
  ErgonomicsMetrics,
  HarnessRunResult,
  RealAcceptanceEvidence,
} from "../../src/acceptance/real/types.js";
import type { WorkspaceView } from "../../src/service/service.js";
import type {
  ActorRef,
  Artifact,
  Contribution,
  Decision,
  Finding,
  Goal,
  Task,
  Workspace,
} from "../../src/domain/types.js";

const T0 = "2026-09-12T00:00:00.000Z";

function at(minutes: number): string {
  return new Date(Date.parse(T0) + minutes * 60_000).toISOString();
}

const ACTOR_A: ActorRef = { actorId: "agt_codex_sergio", actorType: "agent" };
const ACTOR_B: ActorRef = { actorId: "agt_opencode_alice", actorType: "agent" };
const ACTOR_HUMAN: ActorRef = { actorId: "hum_sergio", actorType: "human" };

const SESSION_A = "sess_a";
const SESSION_B = "sess_b";
const NATIVE_A = "thread_a";
const NATIVE_B = "thread_b";
const WORKSPACE_ID = "ws_billing_deploy";
const UNRELATED_WORKSPACE_ID = "ws_auth_migration";
const PRIVATE_SENTINEL = "PRIVATE_TRANSCRIPT_SENTINEL_A_never_shared";
const UNRELATED_SENTINEL = "UNRELATED_FINDING_SENTINEL_auth_token_rotation";

const WORKSPACE: Workspace = {
  id: WORKSPACE_ID,
  teamId: "team_engineering",
  name: "billing-deploy-failure",
  status: "active",
  createdBy: ACTOR_HUMAN,
  createdAt: at(0),
  updatedAt: at(30),
};

const GOAL: Goal = {
  id: "goal_billing",
  workspaceId: WORKSPACE_ID,
  title: "Determine why billing-service deploys fail.",
  status: "active",
  createdBy: ACTOR_HUMAN,
  createdAt: at(0),
  updatedAt: at(0),
};

const FINDING_A1: Finding = {
  id: "find_a1",
  workspaceId: WORKSPACE_ID,
  summary: "Migration 284 holds a database lock longer than the deployment timeout.",
  detail: "migration-284.sql wraps an ALTER and backfill in one transaction.",
  confidence: 0.9,
  createdBy: ACTOR_A,
  agentSessionId: SESSION_A,
  createdAt: at(1),
};

const FINDING_A2: Finding = {
  id: "find_a2",
  workspaceId: WORKSPACE_ID,
  summary: "The billing deploy times out after 120 seconds.",
  createdBy: ACTOR_A,
  agentSessionId: SESSION_A,
  createdAt: at(2),
};

const FINDING_B1: Finding = {
  id: "find_b1",
  workspaceId: WORKSPACE_ID,
  summary: "Migration 284 should be split into a schema phase and a backfill phase.",
  detail: "Phase 1 is metadata-only; phase 2 backfills in batches.",
  confidence: 0.85,
  createdBy: ACTOR_B,
  agentSessionId: SESSION_B,
  createdAt: at(40),
};

const FINDING_B_VIOLATION: Finding = {
  id: "find_b2",
  workspaceId: WORKSPACE_ID,
  summary: "Increase the global timeout to 300 seconds.",
  createdBy: ACTOR_B,
  agentSessionId: SESSION_B,
  createdAt: at(43),
};

const DECISION_A: Decision = {
  id: "dec_a1",
  workspaceId: WORKSPACE_ID,
  summary: "Do not increase the global deployment timeout; split the migration instead.",
  rationale: "Raising the global timeout previously caused unrelated deploy failures.",
  status: "accepted",
  createdBy: ACTOR_A,
  agentSessionId: SESSION_A,
  createdAt: at(3),
  updatedAt: at(3),
};

function makeTask(status: Task["status"]): Task {
  return {
    id: "task_a1",
    workspaceId: WORKSPACE_ID,
    title: "Prepare the migration split.",
    description: "Split migration 284 so schema and backfill run separately.",
    status,
    createdBy: ACTOR_A,
    agentSessionId: SESSION_A,
    createdAt: at(4),
    updatedAt: at(4),
  };
}

const ARTIFACT_A: Artifact = {
  id: "art_a1",
  workspaceId: WORKSPACE_ID,
  type: "file",
  title: "migration-284.sql",
  uriOrPath: "fixtures/billing/migration-284.sql",
  createdBy: ACTOR_A,
  agentSessionId: SESSION_A,
  createdAt: at(5),
};

const ARTIFACT_B: Artifact = {
  id: "art_b1",
  workspaceId: WORKSPACE_ID,
  type: "document",
  title: "migration-284-split-plan.md",
  uriOrPath: "fixtures/billing/migration-284-split-plan.md",
  createdBy: ACTOR_B,
  agentSessionId: SESSION_B,
  createdAt: at(42),
};

function makeContribution(
  id: string,
  actor: ActorRef,
  session: string,
  objectType: Contribution["objectType"],
  objectId: string,
  action: Contribution["action"],
  createdAt: string,
): Contribution {
  return {
    id,
    workspaceId: WORKSPACE_ID,
    actor,
    agentSessionId: session,
    action,
    objectType,
    objectId,
    createdAt,
  };
}

const ACTIVITY_BEFORE: Contribution[] = [
  makeContribution("ctr_a1", ACTOR_A, SESSION_A, "finding", "find_a1", "create", at(1)),
  makeContribution("ctr_a2", ACTOR_A, SESSION_A, "finding", "find_a2", "create", at(2)),
  makeContribution("ctr_a3", ACTOR_A, SESSION_A, "decision", "dec_a1", "create", at(3)),
  makeContribution("ctr_a4", ACTOR_A, SESSION_A, "task", "task_a1", "create", at(4)),
  makeContribution("ctr_a5", ACTOR_A, SESSION_A, "artifact", "art_a1", "create", at(5)),
];

const ACTIVITY_AFTER: Contribution[] = [
  ...ACTIVITY_BEFORE,
  makeContribution("ctr_b1", ACTOR_B, SESSION_B, "finding", "find_b1", "create", at(40)),
  makeContribution("ctr_b2", ACTOR_B, SESSION_B, "task", "task_a1", "update", at(41)),
  makeContribution("ctr_b3", ACTOR_B, SESSION_B, "artifact", "art_b1", "create", at(42)),
];

function viewBefore(): WorkspaceView {
  return {
    workspace: WORKSPACE,
    goal: GOAL,
    participants: [],
    tasks: [makeTask("open")],
    findings: [FINDING_A1, FINDING_A2],
    decisions: [DECISION_A],
    artifacts: [ARTIFACT_A],
    activity: ACTIVITY_BEFORE,
    provenanceSummary: ["agent: Codex (Sergio)"],
  };
}

function viewAfter(): WorkspaceView {
  return {
    workspace: WORKSPACE,
    goal: GOAL,
    participants: [],
    tasks: [makeTask("in_progress")],
    findings: [FINDING_A1, FINDING_A2, FINDING_B1],
    decisions: [DECISION_A],
    artifacts: [ARTIFACT_A, ARTIFACT_B],
    activity: ACTIVITY_AFTER,
    provenanceSummary: ["agent: Codex (Sergio)", "agent: OpenCode (Alice)"],
  };
}

function snapshot(view: WorkspaceView, capturedAt: string): CampfireSnapshot {
  return { workspaceId: WORKSPACE_ID, capturedAt, view };
}

function harnessA(): HarnessRunResult {
  return {
    harness: "codex",
    actorId: ACTOR_A.actorId,
    agentSessionId: SESSION_A,
    command: ["codex", "exec", "--json", "prompt.md"],
    cwd: "/repo",
    startedAt: at(0),
    finishedAt: at(10),
    exitCode: 0,
    rawStdoutPath: join(tmpdir(), "campfire-nonexistent-a.stdout"),
    rawStderrPath: join(tmpdir(), "campfire-nonexistent-a.stderr"),
    finalMessage: "Recorded the migration 284 lock finding and the decision to split the migration.",
    events: [],
    mcpCalls: [
      {
        rawTool: "campfire_add_finding",
        tool: "campfire.add_finding",
        input: { summary: FINDING_A1.summary },
      },
    ],
    nonMcpToolCalls: [
      { rawTool: "Read", tool: "Read", input: { file_path: "fixtures/billing/migration-284.sql" } },
    ],
    harnessSessionId: NATIVE_A,
    usage: { totalTokens: 100, costUsd: 0.01 },
  };
}

function harnessB(): HarnessRunResult {
  return {
    harness: "opencode",
    actorId: ACTOR_B.actorId,
    agentSessionId: SESSION_B,
    command: ["opencode", "run", "prompt.md"],
    cwd: "/repo",
    startedAt: at(20),
    finishedAt: at(50),
    exitCode: 0,
    rawStdoutPath: join(tmpdir(), "campfire-nonexistent-b.stdout"),
    rawStderrPath: join(tmpdir(), "campfire-nonexistent-b.stderr"),
    finalMessage: "Split migration 284 into a schema phase and a backfill phase.",
    events: [],
    mcpCalls: [
      { rawTool: "campfire_list_workspaces", tool: "campfire.list_workspaces" },
      { rawTool: "campfire_get_workspace_context", tool: "campfire.get_workspace_context", output: "goal: billing" },
      {
        rawTool: "campfire_update_task",
        tool: "campfire.update_task",
        input: { taskId: "task_a1", status: "in_progress" },
      },
      { rawTool: "campfire_add_finding", tool: "campfire.add_finding", input: { summary: FINDING_B1.summary } },
    ],
    nonMcpToolCalls: [
      { rawTool: "Read", tool: "Read", input: { file_path: "fixtures/billing/migration-284.sql" } },
    ],
    harnessSessionId: NATIVE_B,
    usage: { totalTokens: 200 },
  };
}

function ergonomics(): ErgonomicsMetrics {
  return {
    firstCampfireCall: "campfire.list_workspaces",
    sequence: [
      "campfire.list_workspaces",
      "campfire.get_workspace_context",
      "campfire.update_task",
      "campfire.add_finding",
    ],
    totalCampfireCalls: 4,
    readCalls: 2,
    writeCalls: 2,
    orientationToolCalls: 2,
    redundantReads: 0,
    redundantReadTools: [],
    missingContextSignals: [],
    contextNoiseSignals: [],
  };
}

function passingInput(): CheckInput {
  return {
    harnessA: harnessA(),
    harnessB: harnessB(),
    stateBeforeB: snapshot(viewBefore(), at(20)),
    stateAfterB: snapshot(viewAfter(), at(50)),
    agentAOriginal: {
      findingIds: ["find_a1", "find_a2"],
      decisionId: "dec_a1",
      taskId: "task_a1",
      artifactId: "art_a1",
    },
    sentinels: { privateSentinel: PRIVATE_SENTINEL, unrelatedSentinel: UNRELATED_SENTINEL },
    unrelatedWorkspaceId: UNRELATED_WORKSPACE_ID,
    visibleWorkspaceIds: [WORKSPACE_ID],
    unrelatedReadDenied: true,
    humanInterventions: [],
    ergonomics: ergonomics(),
  };
}

function checkPassed(input: CheckInput, name: string): boolean {
  return computeChecks(input).find((check) => check.name === name)?.passed === true;
}

describe("computeChecks", () => {
  it("passes every check and recommends GO for a complete continuation", () => {
    const checks = computeChecks(passingInput());
    expect(checks.filter((check) => !check.passed)).toEqual([]);
    expect(recommend(checks)).toBe("GO");
  });

  it("fails continuation checks and reframes when B performs no continuation", () => {
    const input = passingInput();
    input.stateAfterB = snapshot(viewBefore(), at(50));

    const continuationNames = [
      "continuation.meaningful_work_performed",
      "continuation.task_state_advanced",
      "continuation.new_state_recorded",
      "continuation.new_provenance_recorded",
    ];
    for (const name of continuationNames) {
      expect(checkPassed(input, name), name).toBe(false);
    }
    expect(["CONDITIONAL GO", "NO-GO / REFRAME"]).toContain(recommend(computeChecks(input)));
  });

  it("fails private transcript isolation when the sentinel reaches B's output", () => {
    const input = passingInput();
    input.harnessB.finalMessage = `Leaked ${PRIVATE_SENTINEL}`;
    expect(checkPassed(input, "isolation.private_transcript_absent")).toBe(false);
  });

  it("fails respect for the prior decision when B re-proposes increasing the timeout", () => {
    const input = passingInput();
    input.stateAfterB.view.findings = [...input.stateAfterB.view.findings, FINDING_B_VIOLATION];
    input.stateAfterB.view.activity = [
      ...input.stateAfterB.view.activity,
      makeContribution("ctr_b4", ACTOR_B, SESSION_B, "finding", "find_b2", "create", at(43)),
    ];
    expect(checkPassed(input, "reasoning.respects_prior_decision")).toBe(false);
  });

  it("fails workspace isolation when the unrelated workspace is visible", () => {
    const input = passingInput();
    input.visibleWorkspaceIds = [WORKSPACE_ID, UNRELATED_WORKSPACE_ID];
    expect(checkPassed(input, "isolation.unrelated_workspace_hidden")).toBe(false);
  });
});

describe("writeRealEvidence", () => {
  it("writes all seven evidence files into a temp directory", () => {
    const input = passingInput();
    const checks = computeChecks(input);
    const evidence: RealAcceptanceEvidence = {
      sprint: "002",
      scenario: "billing-deploy-failure",
      startedAt: at(0),
      finishedAt: at(60),
      durationMs: 3_600_000,
      environment: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        harnessA: {
          kind: "codex",
          version: "test",
          model: "test-model",
          actorId: ACTOR_A.actorId,
          sessionId: SESSION_A,
        },
        harnessB: {
          kind: "opencode",
          version: "test",
          model: "test-model",
          actorId: ACTOR_B.actorId,
          sessionId: SESSION_B,
        },
      },
      prompts: {
        agentA: "Investigate why billing-service deploys fail.",
        agentB: "Continue the billing deploy investigation using the Campfire workspace.",
      },
      stateBeforeB: input.stateBeforeB,
      stateAfterB: input.stateAfterB,
      harnessA: input.harnessA,
      harnessB: input.harnessB,
      ergonomics: input.ergonomics,
      transcriptIsolation: {
        sentinel: PRIVATE_SENTINEL,
        presentInHarnessBRetrieval: false,
        presentInCampfire: false,
        checkedSources: ["finalMessage", "mcpCalls", "rawStdout", "campfireState"],
      },
      workspaceIsolation: {
        unrelatedWorkspaceId: UNRELATED_WORKSPACE_ID,
        unrelatedSentinel: UNRELATED_SENTINEL,
        visibleWorkspaceIds: input.visibleWorkspaceIds,
        unrelatedReadDenied: true,
        unrelatedSentinelAbsent: true,
      },
      humanInterventions: [],
      checks,
      limitations: ["Synthetic fixture; not real-world evidence."],
      recommendation: recommend(checks),
    };

    const dir = mkdtempSync(join(tmpdir(), "campfire-evidence-"));
    try {
      const result = writeRealEvidence(evidence, dir);
      expect(result.directory).toBe(dir);
      expect(result.files).toHaveLength(7);
      const expected = [
        "acceptance.json",
        "campfire-state-before-b.json",
        "campfire-state-after-b.json",
        "environment.md",
        "harness-a.md",
        "harness-b.md",
        "notes.md",
      ];
      for (const name of expected) {
        expect(existsSync(join(dir, name)), name).toBe(true);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
