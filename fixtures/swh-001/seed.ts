/**
 * SWH-001 controlled scenario fixture (contract §6.1).
 *
 * FIXTURE EVIDENCE — calibrates UI and rubric; cannot establish Gate B, C, or E.
 *
 * Builds the frozen two-human/two-harness `swh-billing-deploy` workspace into a
 * dedicated SQLite database. Both the id source and the clock are deterministic,
 * so re-running into a fresh output directory produces byte-identical structure
 * and ids. Raw actor tokens are random by construction (`mintToken` uses
 * WebCrypto); only the token values and their stored hashes differ between
 * runs, they never appear in the served-state dumps, and the key excludes them.
 * The raw database also varies in `schema_migrations.applied_at` (wall-clock),
 * which is invisible to the dumps and the key.
 *
 *   npx tsx fixtures/swh-001/seed.ts [--out <dir>] [--force]
 *
 * Default output: `fixtures/swh-001/.tmp/served` (gitignored; no database is
 * committed). `tokens.json` is written mode 0600 for the local trace runbook;
 * the participant packet and answer key never carry tokens.
 */
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ID_PREFIXES, createId, type IdKind, type IdSource } from "../../src/domain/ids.js";
import type { ActorRef, Task } from "../../src/domain/types.js";
import type { ActorContext } from "../../src/service/authorization.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import type { AttentionItem, CampfireService, WorkspaceContext } from "../../src/service/service.js";
import { openSqliteStore } from "../../src/store/sqlite-store.js";
import type { CampfireStore } from "../../src/store/store.js";

const FIXTURE_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = resolve(FIXTURE_DIR, ".tmp", "served");

/** Fixed seed clock. Every write advances by one second. */
export const SEED_BASE_ISO = "2026-10-13T16:00:00.000Z";
const SEED_BASE_MS = Date.parse(SEED_BASE_ISO);
const CLOCK_STEP_MS = 1000;

/**
 * Frozen read clock for `dump.ts`. Sits after every seed timestamp, so the
 * served-state dumps are byte-identical across two fresh seeds instead of
 * differing only in `generatedAt`.
 */
export const SERVED_AT = "2026-10-13T18:00:00.000Z";

/** Frozen scenario ids. The answer key and dump script cite these exact values. */
export const SCENARIO = {
  organizationId: "org_swh001",
  teamId: "team_swh001",
  workspaceId: "ws_swh001_billing",
  workspaceName: "swh-billing-deploy",
  goalId: "goal_swh001_deploy_safety",
  goalTitle: "Make billing-service deploys rollback-safe before Friday's release.",
  humans: { dana: "hum_swh001_dana", rowan: "hum_swh001_rowan" },
  agents: { codex: "agt_swh001_codex", opencode: "agt_swh001_opencode" },
  sessions: { codex: "ses_swh001_codex", opencode: "ses_swh001_opencode" },
  tasks: {
    stagingCheck: "task_swh001_staging_check",
    reproduceFailure: "task_swh001_reproduce_failure",
    rollbackJob: "task_swh001_rollback_job",
    reviewDrill: "task_swh001_review_drill",
    healthChecks: "task_swh001_health_checks",
    escalationOwner: "task_swh001_escalation_owner",
    releaseChecklist: "task_swh001_release_checklist",
    stagingEnv: "task_swh001_staging_env",
  },
  decisions: {
    blueGreen: "dec_swh001_blue_green",
    canary: "dec_swh001_canary",
    manualRollback: "dec_swh001_manual_rollback",
    automatedRollback: "dec_swh001_automated_rollback",
    fridayWindows: "dec_swh001_friday_windows",
  },
  findings: {
    drainingWindow: "find_swh001_draining_window",
    drainClean: "find_swh001_drain_clean",
    healthGate: "find_swh001_health_gate",
  },
  artifacts: {
    checklist05: "art_swh001_checklist_05",
    checklist06: "art_swh001_checklist_06",
    trace284: "art_swh001_trace_284",
    drillReport: "art_swh001_drill_report",
    runbookRef: "art_swh001_runbook_ref",
    pr284: "art_swh001_pr_284",
    checklist07: "art_swh001_checklist_07",
    checklist08: "art_swh001_checklist_08",
    checklist09: "art_swh001_checklist_09",
    checklist10: "art_swh001_checklist_10",
    checklist11: "art_swh001_checklist_11",
    checklist12: "art_swh001_checklist_12",
  },
} as const;

const PLANNED: Partial<Record<IdKind, string[]>> = {
  human: [SCENARIO.humans.dana, SCENARIO.humans.rowan],
  agent: [SCENARIO.agents.codex, SCENARIO.agents.opencode],
  workspace: [SCENARIO.workspaceId],
  goal: [SCENARIO.goalId],
  agentSession: [SCENARIO.sessions.codex, SCENARIO.sessions.opencode],
  // Creation order fixes which artifact rows fall outside the 10-row page:
  // a5/a6 are the two oldest rows and are the two not returned to readers.
  artifact: [
    SCENARIO.artifacts.checklist05,
    SCENARIO.artifacts.checklist06,
    SCENARIO.artifacts.trace284,
    SCENARIO.artifacts.drillReport,
    SCENARIO.artifacts.runbookRef,
    SCENARIO.artifacts.pr284,
    SCENARIO.artifacts.checklist07,
    SCENARIO.artifacts.checklist08,
    SCENARIO.artifacts.checklist09,
    SCENARIO.artifacts.checklist10,
    SCENARIO.artifacts.checklist11,
    SCENARIO.artifacts.checklist12,
  ],
  finding: [SCENARIO.findings.drainingWindow, SCENARIO.findings.drainClean, SCENARIO.findings.healthGate],
  decision: [
    SCENARIO.decisions.blueGreen,
    SCENARIO.decisions.canary,
    SCENARIO.decisions.manualRollback,
    SCENARIO.decisions.automatedRollback,
    SCENARIO.decisions.fridayWindows,
  ],
  task: [
    SCENARIO.tasks.stagingCheck,
    SCENARIO.tasks.reproduceFailure,
    SCENARIO.tasks.rollbackJob,
    SCENARIO.tasks.reviewDrill,
    SCENARIO.tasks.healthChecks,
    SCENARIO.tasks.escalationOwner,
    SCENARIO.tasks.releaseChecklist,
    SCENARIO.tasks.stagingEnv,
  ],
};

function fail(message: string): never {
  throw new Error(`swh-001 seed: ${message}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function queueSource(): { source: IdSource; assertEmpty: () => void } {
  const pending: Partial<Record<IdKind, string[]>> = {};
  for (const [kind, ids] of Object.entries(PLANNED) as Array<[IdKind, string[]]>) pending[kind] = [...ids];
  let spare = 0;
  return {
    source: (kind) => {
      const pinned = pending[kind]?.shift();
      if (pinned !== undefined) return pinned;
      spare += 1;
      return createId(kind, () => `${ID_PREFIXES[kind]}_swh001_${String(spare).padStart(4, "0")}`);
    },
    assertEmpty: () => {
      for (const [kind, ids] of Object.entries(pending)) {
        if (ids.length !== 0) fail(`unused ${kind} ids: ${ids.join(", ")}`);
      }
    },
  };
}

function seedClock(): { tick: () => string; next: () => string } {
  let current = SEED_BASE_MS;
  return {
    tick: () => {
      const value = new Date(current).toISOString();
      current += CLOCK_STEP_MS;
      return value;
    },
    next: () => new Date(current).toISOString(),
  };
}

function human(id: string): ActorContext {
  return { actor: { actorId: id, actorType: "human" } };
}

function agent(id: string, sessionId?: string): ActorContext {
  return {
    actor: { actorId: id, actorType: "agent" },
    ...(sessionId === undefined ? {} : { agentSessionId: sessionId }),
  };
}

const DANA_REF: ActorRef = { actorId: SCENARIO.humans.dana, actorType: "human" };
const ROWAN_REF: ActorRef = { actorId: SCENARIO.humans.rowan, actorType: "human" };
const CODEX_REF: ActorRef = { actorId: SCENARIO.agents.codex, actorType: "agent" };
const OPENCODE_REF: ActorRef = { actorId: SCENARIO.agents.opencode, actorType: "agent" };

export interface ScenarioTokens {
  dana: string;
  rowan: string;
  codex: string;
  opencode: string;
}

function checklistTitle(index: number): string {
  return `Deploy checklist snapshot ${String(index).padStart(2, "0")}`;
}

function checklistUri(index: number): string {
  return `https://internal.example/billing/docs/deploy-checklist-${String(index).padStart(2, "0")}`;
}

function seedScenario(service: CampfireService): ScenarioTokens {
  const danaCtx = human(SCENARIO.humans.dana);
  const rowanCtx = human(SCENARIO.humans.rowan);

  // --- Identities ----------------------------------------------------------
  const dana = service.createHuman(undefined, { teamId: SCENARIO.teamId, displayName: "Dana" });
  const rowan = service.createHuman(danaCtx, { teamId: SCENARIO.teamId, displayName: "Rowan" });
  const codex = service.createAgent(danaCtx, {
    teamId: SCENARIO.teamId,
    humanId: dana.human.id,
    name: "Codex",
    harness: "codex",
  });
  const opencode = service.createAgent(rowanCtx, {
    teamId: SCENARIO.teamId,
    humanId: rowan.human.id,
    name: "OpenCode",
    harness: "opencode",
  });
  assertEqual(dana.human.id, SCENARIO.humans.dana, "Dana id");
  assertEqual(rowan.human.id, SCENARIO.humans.rowan, "Rowan id");
  assertEqual(codex.agent.id, SCENARIO.agents.codex, "Codex id");
  assertEqual(opencode.agent.id, SCENARIO.agents.opencode, "OpenCode id");

  // --- Workspace, goal, participants --------------------------------------
  const workspace = service.createWorkspace(danaCtx, {
    teamId: SCENARIO.teamId,
    name: SCENARIO.workspaceName,
  });
  assertEqual(workspace.id, SCENARIO.workspaceId, "workspace id");
  const goal = service.createGoal(danaCtx, {
    workspaceId: workspace.id,
    title: SCENARIO.goalTitle,
    description: "Two teammates and their agents share one billing-deploy workspace before Friday's release.",
  });
  assertEqual(goal.id, SCENARIO.goalId, "goal id");
  for (const [actor, role] of [
    [ROWAN_REF, "member"],
    [CODEX_REF, "agent"],
    [OPENCODE_REF, "agent"],
  ] as const) {
    service.inviteToWorkspace(danaCtx, { workspaceId: workspace.id, actor, role });
    service.joinWorkspace(
      actor.actorType === "human" ? human(actor.actorId) : agent(actor.actorId),
      { workspaceId: workspace.id },
    );
  }
  const codexSession = agent(
    SCENARIO.agents.codex,
    service.registerAgentSession(agent(SCENARIO.agents.codex), {
      agentId: SCENARIO.agents.codex,
      workspaceId: workspace.id,
      harness: "codex",
    }).id,
  );
  const opencodeSession = agent(
    SCENARIO.agents.opencode,
    service.registerAgentSession(agent(SCENARIO.agents.opencode), {
      agentId: SCENARIO.agents.opencode,
      workspaceId: workspace.id,
      harness: "opencode",
    }).id,
  );

  // --- Artifacts: two oldest fillers, then the keyed references ------------
  for (const index of [5, 6]) {
    service.addArtifact(danaCtx, {
      workspaceId: workspace.id,
      type: "document",
      title: checklistTitle(index),
      uriOrPath: checklistUri(index),
    });
  }
  service.addArtifact(codexSession, {
    workspaceId: workspace.id,
    type: "trace",
    title: "billing-service rollout traffic trace 284",
    uriOrPath: "https://internal.example/billing/traces/284",
  });
  service.addArtifact(rowanCtx, {
    workspaceId: workspace.id,
    type: "report",
    title: "billing-service rollback drill report (17)",
    uriOrPath: "https://internal.example/billing/reports/rollback-drill-17",
  });
  service.addArtifact(danaCtx, {
    workspaceId: workspace.id,
    type: "file",
    title: "Rollback runbook reference",
    uriOrPath: "docs/ARCHITECTURE.md",
  });
  service.addArtifact(codexSession, {
    workspaceId: workspace.id,
    type: "pull_request",
    title: "Add the automated billing rollback job",
    uriOrPath: "https://github.example/billing-service/pull/284",
  });

  // --- Findings: f1 superseded by f2; f3 current and free-standing ---------
  service.addFinding(codexSession, {
    workspaceId: workspace.id,
    summary: "The previous color kept serving traffic after the failed rollout was marked rolled back.",
    detail: "Trace 284 ends while connections from the failed color are still being drained.",
    sourceArtifactId: SCENARIO.artifacts.trace284,
  });
  service.correctFinding(danaCtx, {
    findingId: SCENARIO.findings.drainingWindow,
    summary: "Traffic drains cleanly once the rollback job stops opening connections; trace 284 ended mid-drain.",
    detail: "The drill completed the drain and the previous color stopped serving within 40 seconds.",
    reason: "The drill showed trace 284 captured the pre-drain window, not a stuck rollback.",
    sourceArtifactId: SCENARIO.artifacts.drillReport,
    evidence: [
      {
        artifactId: SCENARIO.artifacts.drillReport,
        relation: "supports",
        note: "drill report section 3",
      },
    ],
  });
  service.addFinding(opencodeSession, {
    workspaceId: workspace.id,
    summary: "Deploy health checks pass only after the new color reports ready, so a canary halt leaves the previous color serving.",
    detail: "Checked the deploy health gate wiring on the staging service.",
  });

  // --- Decisions: conflicting accepted pair, resolved historical pair,
  //     proposal ------------------------------------------------------------
  const blueGreen = service.addDecision(danaCtx, {
    workspaceId: workspace.id,
    summary: "Adopt blue-green deploys for billing-service.",
    rationale: "Blue-green keeps the previous color available, so a bad release is one traffic switch away from rollback.",
  });
  assertEqual(blueGreen.id, SCENARIO.decisions.blueGreen, "d1 id");
  service.acceptDecision(danaCtx, blueGreen.id);
  service.citeDecisionBasis(danaCtx, {
    decisionId: blueGreen.id,
    findingId: SCENARIO.findings.drainingWindow,
    note: "rollout trace 284",
  });
  const canary = service.addDecision(rowanCtx, {
    workspaceId: workspace.id,
    summary: "Adopt canary deploys for billing-service.",
    rationale: "A canary limits a bad release to a fraction of traffic and can be halted before full rollout.",
  });
  assertEqual(canary.id, SCENARIO.decisions.canary, "d2 id");
  service.acceptDecision(rowanCtx, canary.id);
  service.citeDecisionBasis(rowanCtx, {
    decisionId: canary.id,
    findingId: SCENARIO.findings.healthGate,
    note: "deploy health gate reading",
  });
  const manualRollback = service.addDecision(danaCtx, {
    workspaceId: workspace.id,
    summary: "Escalate billing deploy failures to the on-call engineer for a manual rollback.",
    rationale: "A human decision point before changing production traffic.",
  });
  service.acceptDecision(danaCtx, manualRollback.id);
  const automatedRollback = service.addDecision(danaCtx, {
    workspaceId: workspace.id,
    summary: "Run the automated billing rollback job for failed deploys.",
    rationale: "The drill showed the automated job drains and restores the previous color faster than the manual runbook.",
    replacesDecisionId: manualRollback.id,
  });
  service.acceptDecision(danaCtx, automatedRollback.id, {
    reason: "The rollback drill succeeded; the automated job replaces the manual escalation.",
  });
  const fridayWindows = service.addDecision(danaCtx, {
    workspaceId: workspace.id,
    summary: "Adopt Friday-only billing deploy windows.",
    rationale: "Recorded during triage as a scheduling proposal; not agreed.",
  });
  assertEqual(fridayWindows.id, SCENARIO.decisions.fridayWindows, "p1 id");

  // --- Tasks: statuses, explicit assignment, one unassigned blocked, one
  //     completed ------------------------------------------------------------
  const tasks: Array<[string, string, ActorRef | undefined]> = [
    [SCENARIO.tasks.stagingCheck, "Confirm the rollback checklist on staging", DANA_REF],
    [SCENARIO.tasks.reproduceFailure, "Reproduce the failed billing deploy", DANA_REF],
    [SCENARIO.tasks.rollbackJob, "Draft the automated rollback job", CODEX_REF],
    [SCENARIO.tasks.reviewDrill, "Review the rollback drill report before Friday", ROWAN_REF],
    [SCENARIO.tasks.healthChecks, "Wire deploy health checks into the rollback job", OPENCODE_REF],
    [SCENARIO.tasks.escalationOwner, "Choose an owner for billing deploy escalations", undefined],
    [SCENARIO.tasks.releaseChecklist, "Update the release checklist with rollback steps", undefined],
    [SCENARIO.tasks.stagingEnv, "Set up the billing-service staging environment", DANA_REF],
  ];
  for (const [id, title, assignee] of tasks) {
    const created = service.createTask(rowanCtxForTask(id) ?? danaCtx, {
      workspaceId: workspace.id,
      title,
      ...(assignee === undefined ? {} : { assignee }),
    });
    assertEqual(created.id, id, `task id ${id}`);
  }
  service.updateTask(danaCtx, { taskId: SCENARIO.tasks.stagingCheck, status: "blocked" });
  service.updateTask(danaCtx, { taskId: SCENARIO.tasks.reproduceFailure, status: "in_progress" });
  service.updateTask(danaCtx, { taskId: SCENARIO.tasks.escalationOwner, status: "blocked" });
  service.updateTask(danaCtx, { taskId: SCENARIO.tasks.stagingEnv, status: "completed" });

  // --- Remaining filler artifacts -----------------------------------------
  for (const index of [7, 8, 9, 10, 11, 12]) {
    service.addArtifact(danaCtx, {
      workspaceId: workspace.id,
      type: "document",
      title: checklistTitle(index),
      uriOrPath: checklistUri(index),
    });
  }

  return { dana: dana.token, rowan: rowan.token, codex: codex.token, opencode: opencode.token };
}

/** Rowan creates the row for her own agent; every other task is created by Dana. */
function rowanCtxForTask(taskId: string): ActorContext | undefined {
  return taskId === SCENARIO.tasks.healthChecks ? human(SCENARIO.humans.rowan) : undefined;
}

function attentionSummary(items: readonly AttentionItem[]): Array<{ reason: string; id: string }> {
  return items.map((item) => ({ reason: item.reason, id: item.id }));
}

function taskByAssignee(context: WorkspaceContext, actorId: string): Task[] {
  return context.slices.tasks.items.filter(
    (task) => task.assignee !== undefined && task.assignee.actorId === actorId,
  );
}

/** Verify the served projection matches the frozen scenario before returning. */
function verifyScenario(service: CampfireService, store: CampfireStore): Record<string, unknown> {
  const danaCtx = human(SCENARIO.humans.dana);
  const rowanCtx = human(SCENARIO.humans.rowan);
  const dana = service.getWorkspaceContext(danaCtx, SCENARIO.workspaceId);
  const rowan = service.getWorkspaceContext(rowanCtx, SCENARIO.workspaceId);

  for (const [label, context] of [["dana", dana] as const, ["rowan", rowan] as const]) {
    assertEqual(context.slices.tasks.returned, context.slices.tasks.total, `${label} tasks slice complete`);
    assertEqual(context.slices.tasks.truncated, false, `${label} tasks truncated`);
    assertEqual(context.slices.findings.truncated, false, `${label} findings truncated`);
    assertEqual(context.slices.decisions.truncated, false, `${label} decisions truncated`);
    assertEqual(context.slices.artifacts.total, 12, `${label} artifact total`);
    assertEqual(context.slices.artifacts.returned, 10, `${label} artifact returned`);
    assertEqual(context.slices.artifacts.truncated, true, `${label} artifact truncated`);
    assertEqual(context.alignment.status, "open", `${label} alignment`);
  }
  assertEqual(dana.slices.tasks.total, 8, "task total includes the completed row");
  assertEqual(dana.openTasks.length, 7, "openTasks excludes completed");
  assert(!dana.openTasks.some((task) => task.id === SCENARIO.tasks.stagingEnv), "completed task presented as active");

  const artifactIds = dana.slices.artifacts.items.map((row) => row.id);
  for (const id of [
    SCENARIO.artifacts.trace284,
    SCENARIO.artifacts.drillReport,
    SCENARIO.artifacts.runbookRef,
    SCENARIO.artifacts.pr284,
  ]) {
    assert(artifactIds.includes(id), `keyed artifact ${id} outside the returned page`);
  }
  for (const id of [SCENARIO.artifacts.checklist05, SCENARIO.artifacts.checklist06]) {
    assert(!artifactIds.includes(id), `expected ${id} outside the first page`);
  }
  const runbook = store.getArtifact(SCENARIO.artifacts.runbookRef);
  assertEqual(runbook?.uriOrPath, "docs/ARCHITECTURE.md", "runbook reference");

  // Findings: f1 historical, f2 current with evidence, f3 current.
  const stale = store.getFinding(SCENARIO.findings.drainingWindow);
  assertEqual(stale?.currentness, "superseded", "f1 currentness");
  assertEqual(stale?.successorId, SCENARIO.findings.drainClean, "f1 successor");
  assertEqual(dana.findings.map((row) => row.id), [SCENARIO.findings.drainClean, SCENARIO.findings.healthGate], "current findings");
  const current = service.getFindingInWorkspace(danaCtx, SCENARIO.workspaceId, SCENARIO.findings.drainClean);
  assertEqual(current.evidence?.map((row) => row.artifactId), [SCENARIO.artifacts.drillReport], "f2 evidence");
  assertEqual(current.sourceArtifactId, SCENARIO.artifacts.drillReport, "f2 source artifact");
  assertEqual(
    service.getFindingInWorkspace(danaCtx, SCENARIO.workspaceId, SCENARIO.findings.healthGate).currentness,
    "current",
    "f3 currentness",
  );

  // Decisions: d1 flagged, d2 clean, d3 replaced by d4, p1 proposed.
  const d1 = service.getDecisionInWorkspace(danaCtx, SCENARIO.workspaceId, SCENARIO.decisions.blueGreen);
  assertEqual(d1.status, "accepted", "d1 accepted");
  assertEqual(d1.needsReview, true, "d1 needsReview");
  assertEqual(d1.needsReviewFindingIds, [SCENARIO.findings.drainingWindow], "d1 needsReviewFindingIds");
  assertEqual(d1.predecessorId, undefined, "d1 predecessor");
  assertEqual(d1.successorId, undefined, "d1 successor");
  const d2 = service.getDecisionInWorkspace(danaCtx, SCENARIO.workspaceId, SCENARIO.decisions.canary);
  assertEqual(d2.status, "accepted", "d2 accepted");
  assertEqual(d2.needsReview, undefined, "d2 not flagged");
  assertEqual(d2.predecessorId, undefined, "d2 predecessor");
  assertEqual(d2.successorId, undefined, "d2 successor");
  assertEqual(d2.citations?.map((row) => row.findingId), [SCENARIO.findings.healthGate], "d2 citation");
  const d3 = service.getDecisionInWorkspace(danaCtx, SCENARIO.workspaceId, SCENARIO.decisions.manualRollback);
  assertEqual(d3.status, "superseded", "d3 superseded");
  assertEqual(d3.successorId, SCENARIO.decisions.automatedRollback, "d3 successor");
  assert(typeof d3.supersedeReason === "string" && d3.supersedeReason.length > 0, "d3 supersede reason");
  assert(typeof d3.supersededAt === "string" && d3.supersededAt.length > 0, "d3 supersededAt");
  const d4 = service.getDecisionInWorkspace(danaCtx, SCENARIO.workspaceId, SCENARIO.decisions.automatedRollback);
  assertEqual(d4.status, "accepted", "d4 accepted");
  assertEqual(d4.predecessorId, SCENARIO.decisions.manualRollback, "d4 predecessor");
  const p1 = service.getDecisionInWorkspace(rowanCtx, SCENARIO.workspaceId, SCENARIO.decisions.fridayWindows);
  assertEqual(p1.status, "proposed", "p1 proposed");

  // Attention: personal cues for both humans, a team cue for both.
  assertEqual(
    attentionSummary(dana.needsYou),
    [
      { reason: "proposed_decision_actionable", id: SCENARIO.decisions.fridayWindows },
      { reason: "assigned_blocked_task", id: SCENARIO.tasks.stagingCheck },
    ],
    "Dana needsYou",
  );
  assertEqual(
    attentionSummary(rowan.needsYou),
    [
      { reason: "proposed_decision_actionable", id: SCENARIO.decisions.fridayWindows },
      { reason: "assigned_open_task", id: SCENARIO.tasks.reviewDrill },
    ],
    "Rowan needsYou",
  );
  assertEqual(
    attentionSummary(dana.needsAttention),
    [{ reason: "unassigned_blocked_task", id: SCENARIO.tasks.escalationOwner }],
    "Dana needsAttention",
  );
  assertEqual(
    attentionSummary(rowan.needsAttention),
    [
      { reason: "unassigned_blocked_task", id: SCENARIO.tasks.escalationOwner },
      { reason: "team_blocked_task", id: SCENARIO.tasks.stagingCheck },
    ],
    "Rowan needsAttention",
  );

  // Task statuses and explicit assignment; Rowan's blocked group is empty on
  // a complete slice (the keyed complete-empty section).
  const expectation: Array<[string, string, ActorRef | undefined]> = [
    [SCENARIO.tasks.stagingCheck, "blocked", DANA_REF],
    [SCENARIO.tasks.reproduceFailure, "in_progress", DANA_REF],
    [SCENARIO.tasks.rollbackJob, "open", CODEX_REF],
    [SCENARIO.tasks.reviewDrill, "open", ROWAN_REF],
    [SCENARIO.tasks.healthChecks, "open", OPENCODE_REF],
    [SCENARIO.tasks.escalationOwner, "blocked", undefined],
    [SCENARIO.tasks.releaseChecklist, "open", undefined],
    [SCENARIO.tasks.stagingEnv, "completed", DANA_REF],
  ];
  for (const [id, status, assignee] of expectation) {
    const task = store.getTask(id);
    assertEqual(task?.status, status, `task ${id} status`);
    assertEqual(task?.assignee, assignee, `task ${id} assignee`);
  }
  const completed = taskByAssignee(rowan, SCENARIO.humans.rowan).filter((task) => task.status === "completed");
  assertEqual(completed.length, 0, "Rowan completed group empty");
  assertEqual(taskByAssignee(rowan, SCENARIO.humans.rowan).filter((task) => task.status === "blocked").length, 0, "Rowan blocked group empty");

  // Participants: four actors, both agents owned by their human.
  const participants = store.listParticipants(SCENARIO.workspaceId).map((row) => ({
    id: row.actor.actorId,
    type: row.actor.actorType,
    role: row.role,
  }));
  assertEqual(participants.length, 4, "participant count");
  assert(participants.some((row) => row.id === SCENARIO.humans.dana && row.role === "owner"), "Dana owner");
  assert(participants.some((row) => row.id === SCENARIO.humans.rowan && row.role === "member"), "Rowan member");
  assert(participants.some((row) => row.id === SCENARIO.agents.codex && row.role === "agent"), "Codex agent");
  assert(participants.some((row) => row.id === SCENARIO.agents.opencode && row.role === "agent"), "OpenCode agent");
  assertEqual(store.getAgent(SCENARIO.agents.codex)?.humanId, SCENARIO.humans.dana, "Codex owner");
  assertEqual(store.getAgent(SCENARIO.agents.opencode)?.humanId, SCENARIO.humans.rowan, "OpenCode owner");

  assertEqual(dana.historicalCounts, { findings: 1, decisions: 1 }, "historical counts");
  assertEqual(dana.currentWork.inProgressTasks.map((task) => task.id), [SCENARIO.tasks.reproduceFailure], "in progress");
  assertEqual(
    dana.currentWork.blockedTasks.map((task) => task.id).sort(),
    [SCENARIO.tasks.stagingCheck, SCENARIO.tasks.escalationOwner].sort(),
    "blocked tasks",
  );
  assertEqual(dana.suggestedNextAction.id, SCENARIO.decisions.fridayWindows, "suggested next action");

  return {
    counts: {
      tasks: { total: dana.slices.tasks.total, returned: dana.slices.tasks.returned, truncated: dana.slices.tasks.truncated },
      findings: { total: dana.slices.findings.total, returned: dana.slices.findings.returned, truncated: dana.slices.findings.truncated },
      decisions: { total: dana.slices.decisions.total, returned: dana.slices.decisions.returned, truncated: dana.slices.decisions.truncated },
      artifacts: { total: dana.slices.artifacts.total, returned: dana.slices.artifacts.returned, truncated: dana.slices.artifacts.truncated },
      historicalCounts: dana.historicalCounts,
      contributors: dana.slices.recentChanges.total,
    },
    dana: {
      generatedAt: dana.generatedAt,
      orientationCursor: dana.orientationCursor,
      needsYou: attentionSummary(dana.needsYou),
      needsAttention: attentionSummary(dana.needsAttention),
    },
    rowan: {
      generatedAt: rowan.generatedAt,
      orientationCursor: rowan.orientationCursor,
      needsYou: attentionSummary(rowan.needsYou),
      needsAttention: attentionSummary(rowan.needsAttention),
    },
  };
}

function keyIdMap(): Record<string, string> {
  return {
    organization: SCENARIO.organizationId,
    team: SCENARIO.teamId,
    workspace: SCENARIO.workspaceId,
    goal: SCENARIO.goalId,
    dana: SCENARIO.humans.dana,
    rowan: SCENARIO.humans.rowan,
    codex: SCENARIO.agents.codex,
    opencode: SCENARIO.agents.opencode,
    codexSession: SCENARIO.sessions.codex,
    opencodeSession: SCENARIO.sessions.opencode,
    ...Object.fromEntries(Object.entries(SCENARIO.tasks).map(([name, id]) => [`task.${name}`, id])),
    ...Object.fromEntries(Object.entries(SCENARIO.decisions).map(([name, id]) => [`decision.${name}`, id])),
    ...Object.fromEntries(Object.entries(SCENARIO.findings).map(([name, id]) => [`finding.${name}`, id])),
    ...Object.fromEntries(Object.entries(SCENARIO.artifacts).map(([name, id]) => [`artifact.${name}`, id])),
  };
}

export interface SeedReceipt {
  databasePath: string;
  workspaceId: string;
  workspaceName: string;
  goalId: string;
  goalTitle: string;
  humans: { dana: string; rowan: string };
  agents: { codex: string; opencode: string };
  sessions: { codex: string; opencode: string };
  keyIds: Record<string, string>;
  seedClock: { base: string; final: string; servedAt: string };
  deterministic: { ids: string; clock: string; tokens: string };
  verification: Record<string, unknown>;
}

export interface SeedSummary extends Omit<SeedReceipt, "verification"> {
  tokensPath: string;
  receiptPath: string;
  tokens: ScenarioTokens;
}

export interface SeedResult {
  databasePath: string;
  tokensPath: string;
  receiptPath: string;
  tokens: ScenarioTokens;
  receipt: SeedReceipt;
}

function seedAt(databasePath: string): SeedReceipt & { tokens: ScenarioTokens } {
  const queued = queueSource();
  const { tick, next } = seedClock();
  const store = openSqliteStore(databasePath);
  const service = createCampfireService({ store, idSource: queued.source, clock: tick });
  try {
    const now = tick();
    store.createOrganization({ id: SCENARIO.organizationId, name: "Boring Infra Co. fixture", createdAt: now });
    store.createTeam({
      id: SCENARIO.teamId,
      organizationId: SCENARIO.organizationId,
      name: "Engineering fixture",
      createdAt: tick(),
    });
    const tokens = seedScenario(service);
    queued.assertEmpty();
    const verification = verifyScenario(service, store);
    return {
      databasePath,
      workspaceId: SCENARIO.workspaceId,
      workspaceName: SCENARIO.workspaceName,
      goalId: SCENARIO.goalId,
      goalTitle: SCENARIO.goalTitle,
      humans: SCENARIO.humans,
      agents: SCENARIO.agents,
      sessions: SCENARIO.sessions,
      keyIds: keyIdMap(),
      seedClock: { base: SEED_BASE_ISO, final: next(), servedAt: SERVED_AT },
      deterministic: {
        ids: "pinned+sequential",
        clock: "fixed base, +1s per write",
        tokens: "random by construction; excluded from dumps and key",
      },
      verification,
      tokens,
    };
  } finally {
    service.close();
  }
}

export function seedDatabase(outDir: string, force: boolean): SeedResult {
  const databasePath = resolve(outDir, "campfire.db");
  const tokensPath = resolve(outDir, "tokens.json");
  const receiptPath = resolve(outDir, "seed-receipt.json");
  if (!force && [databasePath, tokensPath, receiptPath].some(existsSync)) {
    fail(`seed already exists at ${outDir}; pass --force to replace it`);
  }
  mkdirSync(outDir, { recursive: true });
  for (const path of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`, tokensPath, receiptPath]) {
    if (existsSync(path)) rmSync(path);
  }
  const seeded = seedAt(databasePath);
  const { tokens, ...receipt } = seeded;
  writeFileSync(tokensPath, `${JSON.stringify(tokens)}\n`, { mode: 0o600 });
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  assert((statSync(tokensPath).mode & 0o777) === 0o600, "token file mode");
  assert((statSync(receiptPath).mode & 0o777) === 0o600, "receipt file mode");
  return { databasePath, tokensPath, receiptPath, tokens, receipt };
}

function parseArgs(argv: string[]): { out: string; force: boolean } {
  let out = DEFAULT_OUT;
  let force = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (arg === "--out") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) fail("--out requires a directory");
      out = isAbsolute(value) ? value : resolve(value);
      index += 1;
      continue;
    }
    fail(`unknown argument ${arg}`);
  }
  return { out, force };
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const result = seedDatabase(args.out, args.force);
  process.stdout.write(
    `${JSON.stringify(
      {
        databasePath: result.databasePath,
        tokensPath: result.tokensPath,
        receiptPath: result.receiptPath,
        workspaceId: SCENARIO.workspaceId,
        workspaceName: SCENARIO.workspaceName,
        tokens: result.tokens,
        keyIds: keyIdMap(),
        servedAt: SERVED_AT,
      },
      null,
      2,
    )}\n`,
  );
}
