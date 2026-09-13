/**
 * Deterministic integration test for the Sprint 002 real-harness orchestrator.
 *
 * The real acceptance run requires network and vendor agent quotas, so this
 * test injects stub harness runners through the orchestrator's test seam. It
 * exercises the full pipeline: work-dir setup, Campfire snapshots, check
 * evaluation, recommendation, and evidence writing.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FIXTURE } from "../../src/bootstrap/seed.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import { openSqliteStore } from "../../src/store/sqlite-store.js";
import {
  runRealAcceptance,
  type HarnessInvocation,
  type HarnessRunner,
} from "../../src/acceptance/real/run.js";
import { PRIVATE_TRANSCRIPT_SENTINEL_A } from "../../src/acceptance/real/prompts.js";
import type { HarnessRunResult } from "../../src/acceptance/real/types.js";

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "campfire-sprint002-test-"));
  roots.push(root);
  return root;
}

function baseResult(
  invocation: HarnessInvocation,
  harness: "codex" | "opencode",
  rawStdoutPath: string,
  overrides: Partial<HarnessRunResult> = {},
): HarnessRunResult {
  return {
    harness,
    actorId: invocation.actorId,
    agentSessionId: invocation.agentSessionId,
    command: [`stub-${harness}`],
    cwd: invocation.workdir,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    exitCode: 0,
    rawStdoutPath,
    rawStderrPath: join(invocation.workdir, `${harness}.stderr.log`),
    finalMessage: "",
    events: [],
    mcpCalls: [],
    nonMcpToolCalls: [],
    ...overrides,
  };
}

const runHarnessA: HarnessRunner = (invocation) => {
  const store = openSqliteStore(invocation.databasePath);
  const service = createCampfireService({ store });
  const ctx = {
    actor: { actorId: invocation.actorId, actorType: "agent" as const },
    agentSessionId: invocation.agentSessionId,
  };
  service.addFinding(ctx, {
    workspaceId: FIXTURE.workspaces.billing,
    summary: "Migration 284 holds a database lock longer than the deployment timeout.",
    detail: "fixtures/billing/migration-284.sql holds an ACCESS EXCLUSIVE lock until COMMIT.",
    confidence: 0.9,
  });
  service.addFinding(ctx, {
    workspaceId: FIXTURE.workspaces.billing,
    summary: "The billing deployment times out after 120 seconds.",
  });
  const decision = service.addDecision(ctx, {
    workspaceId: FIXTURE.workspaces.billing,
    summary: "Do not increase the global deployment timeout; split the migration instead.",
    rationale: "A previous timeout increase caused overlapping deploys.",
  });
  service.acceptDecision(ctx, decision.id);
  service.createTask(ctx, {
    workspaceId: FIXTURE.workspaces.billing,
    title: "Prepare the migration split.",
  });
  service.addArtifact(ctx, {
    workspaceId: FIXTURE.workspaces.billing,
    type: "file",
    title: "migration-284.sql",
    uriOrPath: "fixtures/billing/migration-284.sql",
  });
  service.close();

  // Agent A's private transcript is allowed to contain the sentinel; only
  // Agent B must never see it.
  const rawA = join(invocation.workdir, "stub-a.jsonl");
  writeFileSync(rawA, `private transcript ${PRIVATE_TRANSCRIPT_SENTINEL_A}\n`, "utf8");
  return baseResult(invocation, "codex", rawA, {
    finalMessage: "Recorded findings, decision, task, and artifact for billing-deploy-failure.",
    harnessSessionId: "codex-thread-1",
    mcpCalls: [
      { rawTool: "campfire_campfire_add_finding", tool: "campfire.add_finding" },
      { rawTool: "campfire_campfire_add_decision", tool: "campfire.add_decision" },
      { rawTool: "campfire_campfire_create_task", tool: "campfire.create_task" },
    ],
  });
};

function stubB(leakSentinel: boolean): HarnessRunner {
  return (invocation) => {
    const store = openSqliteStore(invocation.databasePath);
    const service = createCampfireService({ store });
    const ctx = {
      actor: { actorId: invocation.actorId, actorType: "agent" as const },
      agentSessionId: invocation.agentSessionId,
    };
    const context = service.getWorkspaceContext(ctx, FIXTURE.workspaces.billing);
    const task = context.openTasks[0];
    if (task !== undefined) {
      service.updateTask(ctx, { taskId: task.id, status: "in_progress" });
    }
    service.addFinding(ctx, {
      workspaceId: FIXTURE.workspaces.billing,
      summary: "Split migration 284 into two phases: schema change first, backfill second.",
      detail: "Phase 1 is a fast metadata change; phase 2 backfills in batches.",
    });
    service.addArtifact(ctx, {
      workspaceId: FIXTURE.workspaces.billing,
      type: "document",
      title: "Migration 284 split plan",
      uriOrPath: "fixtures/billing/migration-284-split-plan.md",
    });
    service.close();

    const rawB = join(invocation.workdir, "stub-b.jsonl");
    const leak = leakSentinel ? ` leaked ${PRIVATE_TRANSCRIPT_SENTINEL_A}` : "";
    writeFileSync(rawB, `agent b log${leak}\n`, "utf8");
    return baseResult(invocation, "opencode", rawB, {
      finalMessage: `I read the workspace, respected the decision not to raise the timeout, and split migration 284 into schema and backfill phases.${leak}`,
      harnessSessionId: "opencode-session-1",
      mcpCalls: [
        { rawTool: "campfire_campfire_list_workspaces", tool: "campfire.list_workspaces" },
        { rawTool: "campfire_campfire_get_workspace_context", tool: "campfire.get_workspace_context" },
        { rawTool: "campfire_campfire_update_task", tool: "campfire.update_task" },
        { rawTool: "campfire_campfire_add_finding", tool: "campfire.add_finding" },
        { rawTool: "campfire_campfire_add_artifact", tool: "campfire.add_artifact" },
      ],
      nonMcpToolCalls: [
        {
          rawTool: "read",
          tool: "Read",
          input: { filePath: "fixtures/billing/migration-284.sql" },
        },
      ],
    });
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Sprint 002 real-harness orchestrator (stubbed harnesses)", () => {
  it("passes every substantive check and recommends GO for a clean handoff", async () => {
    const root = makeRoot();
    const result = await runRealAcceptance({
      rootDir: root,
      keepArtifacts: true,
      evidenceDir: join(root, "evidence"),
      runHarnessA,
      runHarnessB: stubB(false),
    });

    const failed = result.evidence.checks.filter((check) => !check.passed);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(result.evidence.recommendation).toBe("GO");
    expect(result.evidence.transcriptIsolation.presentInHarnessBRetrieval).toBe(false);
    expect(result.evidence.transcriptIsolation.presentInCampfire).toBe(false);
    expect(result.evidence.workspaceIsolation.visibleWorkspaceIds).toEqual([
      FIXTURE.workspaces.billing,
    ]);
    expect(result.evidence.workspaceIsolation.unrelatedReadDenied).toBe(true);
  });

  it("fails transcript isolation when Agent B output leaks Agent A's sentinel", async () => {
    const root = makeRoot();
    const result = await runRealAcceptance({
      rootDir: root,
      keepArtifacts: true,
      evidenceDir: join(root, "evidence"),
      runHarnessA,
      runHarnessB: stubB(true),
    });

    const privateCheck = result.evidence.checks.find(
      (check) => check.name === "isolation.private_transcript_absent",
    );
    expect(privateCheck?.passed).toBe(false);
    expect(result.evidence.recommendation).not.toBe("GO");
  });
});
