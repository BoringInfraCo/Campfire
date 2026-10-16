/**
 * ATT-001 controlled scenario fixture (contract §2 baseline / §4 frozen key).
 *
 * FIXTURE EVIDENCE — calibrates UI and rubric; cannot establish Gate B, C, or E.
 *
 * Builds the frozen ATT-001 v1.18.0 baseline scenario: six workspaces, three
 * humans, two owned agents. Both the id source and the clock are deterministic,
 * so re-running into a fresh output directory produces byte-identical serves
 * and dumps. Raw actor tokens are random by construction (`mintToken` uses
 * WebCrypto); only the token values and their stored hashes differ between
 * runs, they never appear in the served-state dumps, and the key excludes them.
 * The raw database also varies in `schema_migrations.applied_at` (wall-clock),
 * which is invisible to the dumps and the key.
 *
 *   npx tsx fixtures/attention/att-001/seed.ts [--out <dir>] [--force]
 *     [--attention-expectation baseline|none]
 *
 * Default output: `fixtures/attention/att-001/.tmp/served` (gitignored; no
 * database is committed). `tokens.json` is written mode 0600 for the local
 * trace runbook; the participant packet and answer key never carry tokens.
 *
 * `--attention-expectation baseline` additionally asserts the v1.18.0 served
 * attention shape (no coverage field, review decisions absent from the lists).
 * The default `none` asserts only record-level and page-coverage facts, so the
 * same fixture seeds cleanly at the ATT-001 candidate commit, where the served
 * attention shape changes by design. The baseline evidence was captured at tag
 * `v1.18.0`; see `docs/evidence/att-001/baseline/`.
 *
 * Keyed facts always verified before the seed writes its receipt (contract §4):
 * - failure workspace `ws_att001_lab` returns 20 of 21 tasks (truncated) with
 *   all five keyed tasks inside the returned page; decisions 7/7 complete;
 *   the two review decisions carry `needsReview` with the exact non-current
 *   finding ids; the superseded decision is excluded from the orientation
 *   slice; `historicalCounts` is findings 2 / decisions 1; member Ben has an
 *   empty, incomplete My work attention list (the H4 observation).
 * - the v1.18.0 baseline additionally lacked attention coverage and review
 *   cues: truncated source pages with no coverage on the attention lists,
 *   review decisions absent from both attention lists, and team cues for work
 *   the caller can still write (asserted only in `baseline` mode).
 */
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ID_PREFIXES, createId, type IdKind, type IdSource } from "../../../src/domain/ids.js";
import type { ActorRef, ParticipantRole } from "../../../src/domain/types.js";
import type { ActorContext } from "../../../src/service/authorization.js";
import { createCampfireService } from "../../../src/service/campfire-service.js";
import type { AttentionItem, CampfireService, WorkspaceContext } from "../../../src/service/service.js";
import { openSqliteStore } from "../../../src/store/sqlite-store.js";
import type { CampfireStore } from "../../../src/store/store.js";

const FIXTURE_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = resolve(FIXTURE_DIR, ".tmp", "served");

/** Fixed seed clock. Every write advances by one second. */
export const SEED_BASE_ISO = "2026-10-15T16:00:00.000Z";
const SEED_BASE_MS = Date.parse(SEED_BASE_ISO);
const CLOCK_STEP_MS = 1000;

/**
 * Frozen read clock for `dump.ts`. Sits after every seed timestamp, so the
 * served-state dumps are byte-identical across two fresh seeds instead of
 * differing only in `generatedAt`.
 */
export const SERVED_AT = "2026-10-15T18:00:00.000Z";

/** Exact string planted only in the unauthorized workspace's finding. */
export const UNRELATED_FINDING_SENTINEL = "UNRELATED_FINDING_SENTINEL_att001_do_not_leak";

function fillerIds(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}${String(index + 1).padStart(2, "0")}`);
}

/** Frozen scenario ids. The answer key and dump script cite these exact values. */
export const SCENARIO = {
  organizationId: "org_att001",
  teamId: "team_att001",
  humans: { ana: "hum_att001_ana", ben: "hum_att001_ben", zed: "hum_att001_zed" },
  agents: { codex: "agt_att001_codex", opencode: "agt_att001_opencode" },
  workspaces: {
    lab: "ws_att001_lab",
    quiet: "ws_att001_quiet",
    truncTasks: "ws_att001_trunc_tasks",
    truncDecisions: "ws_att001_trunc_decisions",
    truncBoth: "ws_att001_trunc_both",
    unrelated: "ws_att001_unrelated",
  },
  workspaceNames: {
    lab: "ATT-001 attention lab",
    quiet: "ATT-001 quiet desk",
    truncTasks: "ATT-001 truncated tasks",
    truncDecisions: "ATT-001 truncated decisions",
    truncBoth: "ATT-001 truncated both",
    unrelated: "ATT-001 unrelated",
  },
  goal: { lab: "goal_att001_attention" },
  findings: {
    labSuperseded: "find_att001_superseded",
    labCurrent: "find_att001_current",
    labWithdrawn: "find_att001_withdrawn",
    quietCurrent: "find_att001_quiet_current",
    tdSuperseded: "find_att001_td_superseded",
    tdCurrent: "find_att001_td_current",
    tdWithdrawn: "find_att001_td_withdrawn",
    tbSuperseded: "find_att001_tb_superseded",
    tbCurrent: "find_att001_tb_current",
    tbWithdrawn: "find_att001_tb_withdrawn",
    unrelatedSentinel: "find_att001_unrelated_sentinel",
  },
  decisions: {
    acceptedCurrent: "dec_att001_accepted_current",
    reviewSuperseded: "dec_att001_review_superseded",
    reviewWithdrawn: "dec_att001_review_withdrawn",
    competingA: "dec_att001_competing_a",
    competingB: "dec_att001_competing_b",
    plain: "dec_att001_plain",
    old: "dec_att001_old",
    new: "dec_att001_new",
    quietAccepted: "dec_att001_quiet_accepted",
    beyondReview: "dec_att001_beyond_review",
    pageReview: "dec_att001_page_review",
    tbBeyondReview: "dec_att001_tb_beyond_review",
    tbPageReview: "dec_att001_tb_page_review",
  },
  tasks: {
    blockedAna: "task_att001_blocked_ana",
    openAna: "task_att001_open_ana",
    openNoassignee: "task_att001_open_noassignee",
    blockedOpencode: "task_att001_blocked_opencode",
    blockedNoassignee: "task_att001_blocked_noassignee",
    fillerInprogress: "task_att001_filler_inprogress",
    fillerOpenCodex: "task_att001_filler_open_codex",
    quietOpen: "task_att001_quiet_open",
    beyondOpenAna: "task_att001_beyond_open_ana",
    truncCompleted: "task_att001_trunc_completed",
    tbBeyondOpenAna: "task_att001_tb_beyond_open_ana",
    tbCompleted: "task_att001_tb_completed",
  },
  artifacts: {
    runbookRef: "art_att001_runbook_ref",
    trace284: "art_att001_trace_284",
  },
} as const;

const TD_PLAIN_IDS = fillerIds("dec_att001_td_plain_", 10);
const TB_PLAIN_IDS = fillerIds("dec_att001_tb_plain_", 10);
const LAB_COMPLETED_IDS = fillerIds("task_att001_filler_completed_", 14);
const QUIET_COMPLETED_IDS = fillerIds("task_att001_quiet_completed_", 2);
const TRUNC_INPROGRESS_IDS = fillerIds("task_att001_inprogress_", 20);
const TB_INPROGRESS_IDS = fillerIds("task_att001_tb_inprogress_", 20);

const PLANNED: Partial<Record<IdKind, string[]>> = {
  human: [SCENARIO.humans.ana, SCENARIO.humans.ben, SCENARIO.humans.zed],
  agent: [SCENARIO.agents.codex, SCENARIO.agents.opencode],
  workspace: [
    SCENARIO.workspaces.lab,
    SCENARIO.workspaces.quiet,
    SCENARIO.workspaces.truncTasks,
    SCENARIO.workspaces.truncDecisions,
    SCENARIO.workspaces.truncBoth,
    SCENARIO.workspaces.unrelated,
  ],
  goal: [SCENARIO.goal.lab],
  artifact: [SCENARIO.artifacts.runbookRef, SCENARIO.artifacts.trace284],
  // Creation order fixes the finding chain: the `correct_finding` successor
  // consumes the next queued finding id, so superseded/current pairs are pinned.
  finding: [
    SCENARIO.findings.labSuperseded,
    SCENARIO.findings.labCurrent,
    SCENARIO.findings.labWithdrawn,
    SCENARIO.findings.quietCurrent,
    SCENARIO.findings.tdSuperseded,
    SCENARIO.findings.tdCurrent,
    SCENARIO.findings.tdWithdrawn,
    SCENARIO.findings.tbSuperseded,
    SCENARIO.findings.tbCurrent,
    SCENARIO.findings.tbWithdrawn,
    SCENARIO.findings.unrelatedSentinel,
  ],
  // Creation order also fixes each decision page's recency order (updatedAt is
  // set again at accept time, so the accept order is the creation order here).
  decision: [
    SCENARIO.decisions.acceptedCurrent,
    SCENARIO.decisions.reviewSuperseded,
    SCENARIO.decisions.reviewWithdrawn,
    SCENARIO.decisions.competingA,
    SCENARIO.decisions.competingB,
    SCENARIO.decisions.plain,
    SCENARIO.decisions.old,
    SCENARIO.decisions.new,
    SCENARIO.decisions.quietAccepted,
    SCENARIO.decisions.beyondReview,
    ...TD_PLAIN_IDS,
    SCENARIO.decisions.pageReview,
    SCENARIO.decisions.tbBeyondReview,
    ...TB_PLAIN_IDS,
    SCENARIO.decisions.tbPageReview,
  ],
  // Creation order per workspace: failure case, quiet case, truncated tasks
  // (20 in-progress fillers fill the page), truncated decisions (no tasks),
  // truncated both (tasks + decisions).
  task: [
    SCENARIO.tasks.blockedAna,
    SCENARIO.tasks.openAna,
    SCENARIO.tasks.openNoassignee,
    SCENARIO.tasks.blockedOpencode,
    SCENARIO.tasks.blockedNoassignee,
    SCENARIO.tasks.fillerInprogress,
    SCENARIO.tasks.fillerOpenCodex,
    ...LAB_COMPLETED_IDS,
    SCENARIO.tasks.quietOpen,
    ...QUIET_COMPLETED_IDS,
    ...TRUNC_INPROGRESS_IDS,
    SCENARIO.tasks.beyondOpenAna,
    SCENARIO.tasks.truncCompleted,
    ...TB_INPROGRESS_IDS,
    SCENARIO.tasks.tbBeyondOpenAna,
    SCENARIO.tasks.tbCompleted,
  ],
};

function fail(message: string): never {
  throw new Error(`att-001 seed: ${message}`);
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
      return createId(kind, () => `${ID_PREFIXES[kind]}_att001_${String(spare).padStart(4, "0")}`);
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

function agent(id: string): ActorContext {
  return { actor: { actorId: id, actorType: "agent" } };
}

const ANA_REF: ActorRef = { actorId: SCENARIO.humans.ana, actorType: "human" };
const BEN_REF: ActorRef = { actorId: SCENARIO.humans.ben, actorType: "human" };
const CODEX_REF: ActorRef = { actorId: SCENARIO.agents.codex, actorType: "agent" };
const OPENCODE_REF: ActorRef = { actorId: SCENARIO.agents.opencode, actorType: "agent" };

export interface ScenarioTokens {
  ana: string;
  ben: string;
  zed: string;
  codex: string;
  opencode: string;
}

/** Ana invites and the named actor consumes the invite. Ids stay deterministic. */
function inviteAndJoin(
  service: CampfireService,
  anaCtx: ActorContext,
  workspaceId: string,
  entries: ReadonlyArray<[ActorRef, ParticipantRole]>,
): void {
  for (const [actor, role] of entries) {
    service.inviteToWorkspace(anaCtx, { workspaceId, actor, role });
    service.joinWorkspace(
      actor.actorType === "human" ? human(actor.actorId) : agent(actor.actorId),
      { workspaceId },
    );
  }
}

function seedLab(service: CampfireService, anaCtx: ActorContext): void {
  const lab = SCENARIO.workspaces.lab;

  // --- Artifacts: two inert references --------------------------------------
  service.addArtifact(anaCtx, {
    workspaceId: lab,
    type: "document",
    title: "ATT-001 baseline runbook reference",
    uriOrPath: "references/att-001/attention-runbook.md",
  });
  service.addArtifact(anaCtx, {
    workspaceId: lab,
    type: "trace",
    title: "attention lab trace 284",
    uriOrPath: "https://internal.example/att-001/traces/284",
  });

  // --- Findings: superseded pair and a withdrawn row ------------------------
  service.addFinding(anaCtx, {
    workspaceId: lab,
    summary: "Every recorded lab task appeared in the first attention read.",
    detail: "Observed while the lab still fit inside one default task page.",
  });
  service.correctFinding(anaCtx, {
    findingId: SCENARIO.findings.labSuperseded,
    summary: "The lab attention read covers only the returned task page.",
    detail: "The 21st task sits outside the default 20-row page and is not inspected.",
    reason: "The lab grew past one default task page; the earlier observation covered only the returned page.",
    sourceArtifactId: SCENARIO.artifacts.trace284,
  });
  service.addFinding(anaCtx, {
    workspaceId: lab,
    summary: "The quiet desk's empty attention lists prove the team finished.",
    detail: "Read from one desk during the freeze instead of the recorded task set.",
  });
  service.withdrawFinding(anaCtx, {
    findingId: SCENARIO.findings.labWithdrawn,
    reason: "The claim was about team completion, which the attention lists do not establish.",
  });

  // --- Decisions -------------------------------------------------------------
  service.addDecision(anaCtx, {
    workspaceId: lab,
    summary: "Cut a fresh ATT-001 baseline before changing attention behavior.",
    rationale: "The contract requires the v1.18.0 baseline to be frozen before implementation.",
  });
  service.acceptDecision(anaCtx, SCENARIO.decisions.acceptedCurrent);
  service.citeDecisionBasis(anaCtx, {
    decisionId: SCENARIO.decisions.acceptedCurrent,
    findingId: SCENARIO.findings.labCurrent,
    note: "baseline recount",
  });

  /** Cites a superseded finding; stays accepted and needsReview at read time. */
  service.addDecision(anaCtx, {
    workspaceId: lab,
    summary: "The lab attention lists are complete because the task slice is complete.",
    rationale: "Assumed the default task page returned every recorded task.",
  });
  service.acceptDecision(anaCtx, SCENARIO.decisions.reviewSuperseded);
  service.citeDecisionBasis(anaCtx, {
    decisionId: SCENARIO.decisions.reviewSuperseded,
    findingId: SCENARIO.findings.labSuperseded,
    note: "original observation",
  });

  /** Cites a withdrawn finding; stays accepted and needsReview at read time. */
  service.addDecision(anaCtx, {
    workspaceId: lab,
    summary: "The quiet desk needs no review because its attention lists are empty.",
    rationale: "Read the empty lists as a statement about the whole team.",
  });
  service.acceptDecision(anaCtx, SCENARIO.decisions.reviewWithdrawn);
  service.citeDecisionBasis(anaCtx, {
    decisionId: SCENARIO.decisions.reviewWithdrawn,
    findingId: SCENARIO.findings.labWithdrawn,
    note: "withdrawn reading of the quiet desk",
  });

  /** Competing accepted pair: conflicting rationales, no recorded transition. */
  service.addDecision(anaCtx, {
    workspaceId: lab,
    summary: "Order attention cues by recorded assignment.",
    rationale: "Assignment is the only recorded grouping, so it should lead the attention order.",
  });
  service.acceptDecision(anaCtx, SCENARIO.decisions.competingA);
  service.addDecision(anaCtx, {
    workspaceId: lab,
    summary: "Order attention cues by newest record.",
    rationale: "Recency shows the latest change first; assignment ordering hides fresh work.",
  });
  service.acceptDecision(anaCtx, SCENARIO.decisions.competingB);

  service.addDecision(anaCtx, {
    workspaceId: lab,
    summary: "Keep the workspace read-only during the baseline freeze.",
    rationale: "No write path may change the baseline before captures are frozen.",
  });
  service.acceptDecision(anaCtx, SCENARIO.decisions.plain);

  // Historical pair: created as a proposal, accepted, then replaced by an
  // explicit accepted replacement with a recorded reason (the only v1.18.0
  // path that records `predecessorId` on the replacement). dec_att001_old
  // ends superseded, excluded from the orientation decisions slice.
  service.addDecision(anaCtx, {
    workspaceId: lab,
    summary: "Review the attention lists manually once a week.",
    rationale: "A human review was assumed to catch what the lists miss.",
  });
  service.acceptDecision(anaCtx, SCENARIO.decisions.old);
  service.addDecision(anaCtx, {
    workspaceId: lab,
    summary: "Replace the weekly manual review with coverage-qualified attention cues.",
    rationale: "Coverage metadata from the returned pages makes the manual sweep unnecessary.",
    replacesDecisionId: SCENARIO.decisions.old,
  });
  service.acceptDecision(anaCtx, SCENARIO.decisions.new, {
    reason: "The ATT-001 contract replaces the weekly manual review; list coverage qualifies the cues.",
  });

  // Scenario repair (dated; see docs/evidence/att-001/baseline/SCENARIO_REPAIR.md):
  // the lab deliberately has no proposed decision, so the member Ben's My work
  // attention list is an incomplete empty (tasks page truncated, no cue) and
  // rubric H4 is directly observable in the trace workspace.

  // --- Tasks: 21 rows so the default 20-row page is truncated ---------------
  const tasks: Array<[string, string, ActorRef | undefined]> = [
    [SCENARIO.tasks.blockedAna, "Package the lab baseline evidence", ANA_REF],
    [SCENARIO.tasks.openAna, "Review the lab attention rules", ANA_REF],
    [SCENARIO.tasks.openNoassignee, "Pick a lab reviewer", undefined],
    [SCENARIO.tasks.blockedOpencode, "Reproduce the truncated-page cue gap", OPENCODE_REF],
    [SCENARIO.tasks.blockedNoassignee, "Decide what counts as an all-clear", undefined],
    [SCENARIO.tasks.fillerInprogress, "Reformat the lab trace notes", undefined],
    [SCENARIO.tasks.fillerOpenCodex, "Draft the quiet-desk checklist", CODEX_REF],
    ...LAB_COMPLETED_IDS.map(
      (id, index): [string, string, ActorRef | undefined] => [
        id,
        `Lab baseline housekeeping ${String(index + 1).padStart(2, "0")}`,
        undefined,
      ],
    ),
  ];
  for (const [id, title, assignee] of tasks) {
    const created = service.createTask(anaCtx, {
      workspaceId: lab,
      title,
      ...(assignee === undefined ? {} : { assignee }),
    });
    assertEqual(created.id, id, `lab task id ${id}`);
  }
  service.updateTask(anaCtx, { taskId: SCENARIO.tasks.blockedAna, status: "blocked" });
  service.updateTask(anaCtx, { taskId: SCENARIO.tasks.blockedOpencode, status: "blocked" });
  service.updateTask(anaCtx, { taskId: SCENARIO.tasks.blockedNoassignee, status: "blocked" });
  service.updateTask(anaCtx, { taskId: SCENARIO.tasks.fillerInprogress, status: "in_progress" });
  for (const id of LAB_COMPLETED_IDS) {
    service.updateTask(anaCtx, { taskId: id, status: "completed" });
  }
}

function seedQuiet(service: CampfireService, anaCtx: ActorContext): void {
  const quiet = SCENARIO.workspaces.quiet;
  service.addFinding(anaCtx, {
    workspaceId: quiet,
    summary: "The quiet desk has no recorded attention cues.",
    detail: "One unassigned open task, two completed tasks, one accepted decision citing this finding.",
  });
  service.addDecision(anaCtx, {
    workspaceId: quiet,
    summary: "Keep the quiet desk in the baseline freeze.",
    rationale: "It is the complete-page empty-attention counterexample for ATT-001.",
  });
  service.acceptDecision(anaCtx, SCENARIO.decisions.quietAccepted);
  service.citeDecisionBasis(anaCtx, {
    decisionId: SCENARIO.decisions.quietAccepted,
    findingId: SCENARIO.findings.quietCurrent,
    note: "quiet desk read",
  });

  const tasks: Array<[string, string, string]> = [
    [SCENARIO.tasks.quietOpen, "Choose the quiet-desk next step", "open"],
    [QUIET_COMPLETED_IDS[0]!, "Quiet desk setup", "completed"],
    [QUIET_COMPLETED_IDS[1]!, "Quiet desk review", "completed"],
  ];
  for (const [id, title] of tasks) {
    const created = service.createTask(anaCtx, { workspaceId: quiet, title });
    assertEqual(created.id, id, `quiet task id ${id}`);
  }
  for (const id of QUIET_COMPLETED_IDS) {
    service.updateTask(anaCtx, { taskId: id, status: "completed" });
  }
}

/** 20 in-progress fillers fill the page; the open assigned task stays beyond it. */
function seedTruncTasks(service: CampfireService, anaCtx: ActorContext): void {
  const workspaceId = SCENARIO.workspaces.truncTasks;
  for (const id of TRUNC_INPROGRESS_IDS) {
    const created = service.createTask(anaCtx, {
      workspaceId,
      title: `Truncated-tasks filler ${id.slice(-2)}`,
    });
    assertEqual(created.id, id, `trunc-tasks filler id ${id}`);
  }
  const beyond = service.createTask(anaCtx, {
    workspaceId,
    title: "Check the task beyond the truncated page",
    assignee: ANA_REF,
  });
  assertEqual(beyond.id, SCENARIO.tasks.beyondOpenAna, "beyond-page open task id");
  const completed = service.createTask(anaCtx, {
    workspaceId,
    title: "Truncated-tasks setup complete",
  });
  assertEqual(completed.id, SCENARIO.tasks.truncCompleted, "trunc-tasks completed id");

  for (const id of TRUNC_INPROGRESS_IDS) {
    service.updateTask(anaCtx, { taskId: id, status: "in_progress" });
  }
  service.updateTask(anaCtx, { taskId: SCENARIO.tasks.truncCompleted, status: "completed" });
}

/** 12 accepted decisions; the default 10-row decision page is truncated. */
function seedTruncDecisions(service: CampfireService, anaCtx: ActorContext): void {
  const workspaceId = SCENARIO.workspaces.truncDecisions;
  service.addFinding(anaCtx, {
    workspaceId,
    summary: "The decision page returned every recorded decision.",
    detail: "Observed while the decision count still fit inside one default page.",
  });
  service.correctFinding(anaCtx, {
    findingId: SCENARIO.findings.tdSuperseded,
    summary: "The decision page returns the ten newest accepted decisions.",
    detail: "Older accepted decisions sit outside the default decision page.",
    reason: "The workspace grew past the default decision page; only the returned rows are inspected.",
  });
  service.addFinding(anaCtx, {
    workspaceId,
    summary: "The truncated decision page hides nothing important.",
    detail: "Importance is not a recorded property of a decision.",
  });
  service.withdrawFinding(anaCtx, {
    findingId: SCENARIO.findings.tdWithdrawn,
    reason: "Importance is not recorded; the page boundary alone does not establish it.",
  });

  // Accept order = creation order = ascending updatedAt. The oldest accepted
  // decision (beyond_review) is pushed out of the page budget; the newest
  // (page_review) stays inside it.
  service.addDecision(anaCtx, {
    workspaceId,
    summary: "Reopen the superseded review rule once the page recovers.",
    rationale: "Kept as the page-boundary counterexample for the truncated decision page.",
  });
  service.acceptDecision(anaCtx, SCENARIO.decisions.beyondReview);
  service.citeDecisionBasis(anaCtx, {
    decisionId: SCENARIO.decisions.beyondReview,
    findingId: SCENARIO.findings.tdSuperseded,
    note: "beyond the returned page",
  });
  for (const [index, id] of TD_PLAIN_IDS.entries()) {
    service.addDecision(anaCtx, {
      workspaceId,
      summary: `Truncated-decisions plain filler ${String(index + 1).padStart(2, "0")}`,
      rationale: "Plain accepted filler with no citations.",
    });
    service.acceptDecision(anaCtx, id);
  }
  service.addDecision(anaCtx, {
    workspaceId,
    summary: "Keep the review cue tied to the returned page.",
    rationale: "The withdrawn citation is the only review signal inside the page budget.",
  });
  service.acceptDecision(anaCtx, SCENARIO.decisions.pageReview);
  service.citeDecisionBasis(anaCtx, {
    decisionId: SCENARIO.decisions.pageReview,
    findingId: SCENARIO.findings.tdWithdrawn,
    note: "withdrawn citation inside the page",
  });
}

/** Workspace 3's task recipe plus workspace 4's decision recipe. */
function seedTruncBoth(service: CampfireService, anaCtx: ActorContext): void {
  const workspaceId = SCENARIO.workspaces.truncBoth;

  service.addFinding(anaCtx, {
    workspaceId,
    summary: "Both pages returned every recorded row.",
    detail: "Observed while the workspace still fit inside both default pages.",
  });
  service.correctFinding(anaCtx, {
    findingId: SCENARIO.findings.tbSuperseded,
    summary: "Both pages are bounded by their default budgets.",
    detail: "Neither the task page nor the decision page inspects rows beyond its budget.",
    reason: "The workspace grew past both default pages; only the returned rows are inspected.",
  });
  service.addFinding(anaCtx, {
    workspaceId,
    summary: "Bounded pages hide nothing important.",
    detail: "Importance is not a recorded property.",
  });
  service.withdrawFinding(anaCtx, {
    findingId: SCENARIO.findings.tbWithdrawn,
    reason: "Importance is not recorded; the page boundary alone does not establish it.",
  });

  service.addDecision(anaCtx, {
    workspaceId,
    summary: "Reopen the superseded review rule once both pages recover.",
    rationale: "Kept as the combined page-boundary counterexample.",
  });
  service.acceptDecision(anaCtx, SCENARIO.decisions.tbBeyondReview);
  service.citeDecisionBasis(anaCtx, {
    decisionId: SCENARIO.decisions.tbBeyondReview,
    findingId: SCENARIO.findings.tbSuperseded,
    note: "beyond the returned page",
  });
  for (const [index, id] of TB_PLAIN_IDS.entries()) {
    service.addDecision(anaCtx, {
      workspaceId,
      summary: `Truncated-both plain filler ${String(index + 1).padStart(2, "0")}`,
      rationale: "Plain accepted filler with no citations.",
    });
    service.acceptDecision(anaCtx, id);
  }
  service.addDecision(anaCtx, {
    workspaceId,
    summary: "Keep the review cue tied to the returned page when both pages are bounded.",
    rationale: "The withdrawn citation is the only review signal inside the page budget.",
  });
  service.acceptDecision(anaCtx, SCENARIO.decisions.tbPageReview);
  service.citeDecisionBasis(anaCtx, {
    decisionId: SCENARIO.decisions.tbPageReview,
    findingId: SCENARIO.findings.tbWithdrawn,
    note: "withdrawn citation inside the page",
  });

  for (const id of TB_INPROGRESS_IDS) {
    const created = service.createTask(anaCtx, {
      workspaceId,
      title: `Truncated-both filler ${id.slice(-2)}`,
    });
    assertEqual(created.id, id, `trunc-both filler id ${id}`);
  }
  const beyond = service.createTask(anaCtx, {
    workspaceId,
    title: "Check the task beyond both truncated pages",
    assignee: ANA_REF,
  });
  assertEqual(beyond.id, SCENARIO.tasks.tbBeyondOpenAna, "trunc-both beyond-page task id");
  const completed = service.createTask(anaCtx, {
    workspaceId,
    title: "Truncated-both setup complete",
  });
  assertEqual(completed.id, SCENARIO.tasks.tbCompleted, "trunc-both completed id");
  for (const id of TB_INPROGRESS_IDS) {
    service.updateTask(anaCtx, { taskId: id, status: "in_progress" });
  }
  service.updateTask(anaCtx, { taskId: SCENARIO.tasks.tbCompleted, status: "completed" });
}

function seedScenario(service: CampfireService): ScenarioTokens {
  const anaCtx = human(SCENARIO.humans.ana);
  const benCtx = human(SCENARIO.humans.ben);
  const zedCtx = human(SCENARIO.humans.zed);

  // --- Identities -----------------------------------------------------------
  const ana = service.createHuman(undefined, { teamId: SCENARIO.teamId, displayName: "Ana" });
  const ben = service.createHuman(anaCtx, { teamId: SCENARIO.teamId, displayName: "Ben" });
  const zed = service.createHuman(anaCtx, { teamId: SCENARIO.teamId, displayName: "Zed" });
  assertEqual(ana.human.id, SCENARIO.humans.ana, "Ana id");
  assertEqual(ben.human.id, SCENARIO.humans.ben, "Ben id");
  assertEqual(zed.human.id, SCENARIO.humans.zed, "Zed id");
  const codex = service.createAgent(anaCtx, {
    teamId: SCENARIO.teamId,
    humanId: ana.human.id,
    name: "Codex",
    harness: "codex",
  });
  const opencode = service.createAgent(benCtx, {
    teamId: SCENARIO.teamId,
    humanId: ben.human.id,
    name: "OpenCode",
    harness: "opencode",
  });
  assertEqual(codex.agent.id, SCENARIO.agents.codex, "Codex id");
  assertEqual(opencode.agent.id, SCENARIO.agents.opencode, "OpenCode id");

  // --- Workspace 1: the failure/attention lab -------------------------------
  const lab = service.createWorkspace(anaCtx, {
    teamId: SCENARIO.teamId,
    name: SCENARIO.workspaceNames.lab,
  });
  assertEqual(lab.id, SCENARIO.workspaces.lab, "lab workspace id");
  const goal = service.createGoal(anaCtx, {
    workspaceId: lab.id,
    title: "Make team attention cues trustworthy without changing recorded work.",
    description: "Two humans and two owned agents share one lab while the v1.18.0 attention baseline is frozen.",
  });
  assertEqual(goal.id, SCENARIO.goal.lab, "lab goal id");
  inviteAndJoin(service, anaCtx, lab.id, [
    [BEN_REF, "member"],
    [CODEX_REF, "agent"],
    [OPENCODE_REF, "agent"],
  ]);
  seedLab(service, anaCtx);

  // --- Workspace 2: the quiet desk ------------------------------------------
  const quiet = service.createWorkspace(anaCtx, {
    teamId: SCENARIO.teamId,
    name: SCENARIO.workspaceNames.quiet,
  });
  assertEqual(quiet.id, SCENARIO.workspaces.quiet, "quiet workspace id");
  inviteAndJoin(service, anaCtx, quiet.id, [[BEN_REF, "member"]]);
  seedQuiet(service, anaCtx);

  // --- Workspaces 3–5: truncated pages --------------------------------------
  const truncTasks = service.createWorkspace(anaCtx, {
    teamId: SCENARIO.teamId,
    name: SCENARIO.workspaceNames.truncTasks,
  });
  assertEqual(truncTasks.id, SCENARIO.workspaces.truncTasks, "trunc-tasks workspace id");
  inviteAndJoin(service, anaCtx, truncTasks.id, [[BEN_REF, "member"]]);
  seedTruncTasks(service, anaCtx);

  const truncDecisions = service.createWorkspace(anaCtx, {
    teamId: SCENARIO.teamId,
    name: SCENARIO.workspaceNames.truncDecisions,
  });
  assertEqual(truncDecisions.id, SCENARIO.workspaces.truncDecisions, "trunc-decisions workspace id");
  inviteAndJoin(service, anaCtx, truncDecisions.id, [[BEN_REF, "member"]]);
  seedTruncDecisions(service, anaCtx);

  const truncBoth = service.createWorkspace(anaCtx, {
    teamId: SCENARIO.teamId,
    name: SCENARIO.workspaceNames.truncBoth,
  });
  assertEqual(truncBoth.id, SCENARIO.workspaces.truncBoth, "trunc-both workspace id");
  inviteAndJoin(service, anaCtx, truncBoth.id, [[BEN_REF, "member"]]);
  seedTruncBoth(service, anaCtx);

  // --- Workspace 6: unrelated, owned by Zed only ----------------------------
  const unrelated = service.createWorkspace(zedCtx, {
    teamId: SCENARIO.teamId,
    name: SCENARIO.workspaceNames.unrelated,
  });
  assertEqual(unrelated.id, SCENARIO.workspaces.unrelated, "unrelated workspace id");
  service.addFinding(zedCtx, {
    workspaceId: unrelated.id,
    summary: `Token rotation: old signing key retired before replica flush. ${UNRELATED_FINDING_SENTINEL}`,
    detail: "Never returned to a non-participant; the denial must not leak this workspace.",
  });

  return {
    ana: ana.token,
    ben: ben.token,
    zed: zed.token,
    codex: codex.token,
    opencode: opencode.token,
  };
}

function attentionSummary(items: readonly AttentionItem[]): Array<{ reason: string; id: string }> {
  return items.map((item) => ({ reason: item.reason, id: item.id }));
}

function decisionItem(context: WorkspaceContext, id: string) {
  const item = context.slices.decisions.items.find((decision) => decision.id === id);
  assert(item !== undefined, `decision ${id} outside the returned orientation page`);
  return item;
}

type AttentionExpectation = "baseline" | "none";

/**
 * Verify the served projection matches the frozen scenario before returning.
 * Record-level and page-coverage facts are always asserted. The v1.18.0 served
 * attention shape (no coverage field, no review cues) is asserted only in
 * `baseline` mode, so the fixture also seeds cleanly at the candidate commit.
 */
function verifyScenario(
  service: CampfireService,
  store: CampfireStore,
  attentionExpectation: AttentionExpectation,
): Record<string, unknown> {
  const baselineAttention = attentionExpectation === "baseline";
  const anaCtx = human(SCENARIO.humans.ana);
  const benCtx = human(SCENARIO.humans.ben);
  const zedCtx = human(SCENARIO.humans.zed);

  // --- Workspace 1: keyed slice and lifecycle facts -------------------------
  const labAna = service.getWorkspaceContext(anaCtx, SCENARIO.workspaces.lab);
  const labBen = service.getWorkspaceContext(benCtx, SCENARIO.workspaces.lab);

  assertEqual(labAna.slices.tasks.total, 21, "lab task total");
  assertEqual(labAna.slices.tasks.returned, 20, "lab task returned");
  assertEqual(labAna.slices.tasks.truncated, true, "lab task truncated");
  const returnedTaskIds = labAna.slices.tasks.items.map((task) => task.id);
  for (const id of [
    SCENARIO.tasks.blockedAna,
    SCENARIO.tasks.openAna,
    SCENARIO.tasks.openNoassignee,
    SCENARIO.tasks.blockedOpencode,
    SCENARIO.tasks.blockedNoassignee,
  ]) {
    assert(returnedTaskIds.includes(id), `key task ${id} outside the returned page`);
  }

  assertEqual(labAna.slices.decisions.total, 7, "lab decision total");
  assertEqual(labAna.slices.decisions.returned, 7, "lab decision returned");
  assertEqual(labAna.slices.decisions.truncated, false, "lab decision truncated");
  const returnedDecisionIds = labAna.slices.decisions.items.map((decision) => decision.id);
  for (const id of [
    SCENARIO.decisions.acceptedCurrent,
    SCENARIO.decisions.reviewSuperseded,
    SCENARIO.decisions.reviewWithdrawn,
    SCENARIO.decisions.competingA,
    SCENARIO.decisions.competingB,
    SCENARIO.decisions.plain,
    SCENARIO.decisions.new,
  ]) {
    assert(returnedDecisionIds.includes(id), `key decision ${id} outside the returned page`);
  }
  assert(!returnedDecisionIds.includes(SCENARIO.decisions.old), "superseded decision replayed in orientation");

  // Scenario repair (dated): Ben has no cues and no assigned tasks while the
  // task page is truncated, so his My work list is an incomplete empty. This is
  // the H4 observation the repaired trace workspace must provide.
  assertEqual(attentionSummary(labBen.needsYou), [], "lab ben needsYou");
  assertEqual(labBen.slices.tasks.truncated, true, "lab ben task page truncated");

  const acceptedCurrent = decisionItem(labAna, SCENARIO.decisions.acceptedCurrent);
  assertEqual(acceptedCurrent.needsReview, undefined, "accepted-current needsReview");
  assertEqual(acceptedCurrent.needsReviewFindingIds, undefined, "accepted-current review ids");
  const reviewSuperseded = decisionItem(labAna, SCENARIO.decisions.reviewSuperseded);
  assertEqual(reviewSuperseded.needsReview, true, "review-superseded needsReview");
  assertEqual(
    reviewSuperseded.needsReviewFindingIds,
    [SCENARIO.findings.labSuperseded],
    "review-superseded finding ids",
  );
  const reviewWithdrawn = decisionItem(labAna, SCENARIO.decisions.reviewWithdrawn);
  assertEqual(reviewWithdrawn.needsReview, true, "review-withdrawn needsReview");
  assertEqual(
    reviewWithdrawn.needsReviewFindingIds,
    [SCENARIO.findings.labWithdrawn],
    "review-withdrawn finding ids",
  );

  assertEqual(labAna.historicalCounts, { findings: 2, decisions: 1 }, "lab historical counts");
  assertEqual(labAna.supersededDecisions, [], "orientation does not replay superseded decisions");

  const oldRow = service.getDecisionInWorkspace(anaCtx, SCENARIO.workspaces.lab, SCENARIO.decisions.old);
  assertEqual(oldRow.status, "superseded", "old decision status");
  assertEqual(oldRow.successorId, SCENARIO.decisions.new, "old decision successor");
  assert(typeof oldRow.supersedeReason === "string" && oldRow.supersedeReason.length > 0, "old supersede reason");
  const newRow = service.getDecisionInWorkspace(anaCtx, SCENARIO.workspaces.lab, SCENARIO.decisions.new);
  assertEqual(newRow.status, "accepted", "new decision status");
  assertEqual(newRow.predecessorId, SCENARIO.decisions.old, "new decision predecessor");

  // Gap 2 (v1.18.0): accepted needsReview decisions carry no attention cue.
  if (baselineAttention) {
    const labAnaAttentionIds = [...labAna.needsYou, ...labAna.needsAttention].map((item) => item.id);
    assert(
      !labAnaAttentionIds.includes(SCENARIO.decisions.reviewSuperseded) &&
        !labAnaAttentionIds.includes(SCENARIO.decisions.reviewWithdrawn),
      "v1.18.0 baseline changed: needsReview decisions appeared in an attention list",
    );

    // Gap 3 (v1.18.0): the cue for another participant's blocked task.
    assertEqual(
      attentionSummary(labAna.needsAttention),
      [
        { reason: "unassigned_blocked_task", id: SCENARIO.tasks.blockedNoassignee },
        { reason: "team_blocked_task", id: SCENARIO.tasks.blockedOpencode },
      ],
      "lab ana needsAttention",
    );
  }

  // --- Workspace 2: complete pages, empty attention, open fallback ----------
  const quietAna = service.getWorkspaceContext(anaCtx, SCENARIO.workspaces.quiet);
  const quietBen = service.getWorkspaceContext(benCtx, SCENARIO.workspaces.quiet);
  assertEqual(quietAna.slices.tasks.total, 3, "quiet task total");
  assertEqual(quietAna.slices.tasks.returned, 3, "quiet task returned");
  assertEqual(quietAna.slices.tasks.truncated, false, "quiet task truncated");
  assertEqual(quietAna.slices.decisions.total, 1, "quiet decision total");
  assertEqual(quietAna.slices.decisions.returned, 1, "quiet decision returned");
  assertEqual(quietAna.slices.decisions.truncated, false, "quiet decision truncated");
  assertEqual(attentionSummary(quietAna.needsYou), [], "quiet ana needsYou");
  assertEqual(attentionSummary(quietAna.needsAttention), [], "quiet ana needsAttention");
  assertEqual(attentionSummary(quietBen.needsYou), [], "quiet ben needsYou");
  assertEqual(attentionSummary(quietBen.needsAttention), [], "quiet ben needsAttention");
  const quietOpen = quietAna.openTasks.find((task) => task.id === SCENARIO.tasks.quietOpen);
  assert(quietOpen !== undefined && quietOpen.status === "open", "quiet open task missing");
  assertEqual(quietOpen.assignee, undefined, "quiet open task unassigned");
  assertEqual(quietAna.suggestedNextAction.kind, "task", "quiet next action kind");
  assertEqual(quietAna.suggestedNextAction.id, SCENARIO.tasks.quietOpen, "quiet next action id");
  assertEqual(quietAna.suggestedNextAction.reason, "team_open_task", "quiet next action reason");
  const quietAccepted = decisionItem(quietAna, SCENARIO.decisions.quietAccepted);
  assertEqual(quietAccepted.needsReview, undefined, "quiet accepted decision needsReview");

  // --- Workspace 3: truncated tasks, no cue, suggestedNextAction none -------
  const truncTasksAna = service.getWorkspaceContext(anaCtx, SCENARIO.workspaces.truncTasks);
  const truncTasksBen = service.getWorkspaceContext(benCtx, SCENARIO.workspaces.truncTasks);
  assertEqual(truncTasksAna.slices.tasks.total, 22, "trunc-tasks task total");
  assertEqual(truncTasksAna.slices.tasks.returned, 20, "trunc-tasks task returned");
  assertEqual(truncTasksAna.slices.tasks.truncated, true, "trunc-tasks task truncated");
  assert(
    !truncTasksAna.slices.tasks.items.some((task) => task.id === SCENARIO.tasks.beyondOpenAna),
    "beyond-page open task appeared inside the returned page",
  );
  assertEqual(attentionSummary(truncTasksAna.needsYou), [], "trunc-tasks ana needsYou");
  assertEqual(attentionSummary(truncTasksAna.needsAttention), [], "trunc-tasks ana needsAttention");
  assertEqual(attentionSummary(truncTasksBen.needsYou), [], "trunc-tasks ben needsYou");
  assertEqual(attentionSummary(truncTasksBen.needsAttention), [], "trunc-tasks ben needsAttention");
  assertEqual(truncTasksAna.suggestedNextAction.kind, "none", "trunc-tasks next action kind");

  // --- Workspace 4: truncated decisions, review row inside the page ---------
  const truncDecisionsAna = service.getWorkspaceContext(anaCtx, SCENARIO.workspaces.truncDecisions);
  const truncDecisionsBen = service.getWorkspaceContext(benCtx, SCENARIO.workspaces.truncDecisions);
  assertEqual(truncDecisionsAna.slices.decisions.total, 12, "trunc-decisions decision total");
  assertEqual(truncDecisionsAna.slices.decisions.returned, 10, "trunc-decisions decision returned");
  assertEqual(truncDecisionsAna.slices.decisions.truncated, true, "trunc-decisions decision truncated");
  const pageReview = decisionItem(truncDecisionsAna, SCENARIO.decisions.pageReview);
  assertEqual(pageReview.needsReview, true, "page-review needsReview");
  assertEqual(pageReview.needsReviewFindingIds, [SCENARIO.findings.tdWithdrawn], "page-review finding ids");
  assert(
    !truncDecisionsAna.slices.decisions.items.some((decision) => decision.id === SCENARIO.decisions.beyondReview),
    "beyond-page review decision appeared inside the returned page",
  );
  if (baselineAttention) {
    assertEqual(attentionSummary(truncDecisionsAna.needsYou), [], "trunc-decisions ana needsYou");
    assertEqual(attentionSummary(truncDecisionsAna.needsAttention), [], "trunc-decisions ana needsAttention");
    assertEqual(attentionSummary(truncDecisionsBen.needsYou), [], "trunc-decisions ben needsYou");
    assertEqual(attentionSummary(truncDecisionsBen.needsAttention), [], "trunc-decisions ben needsAttention");
  }

  // --- Workspace 5: both pages truncated ------------------------------------
  const truncBothAna = service.getWorkspaceContext(anaCtx, SCENARIO.workspaces.truncBoth);
  const truncBothBen = service.getWorkspaceContext(benCtx, SCENARIO.workspaces.truncBoth);
  assertEqual(truncBothAna.slices.tasks.total, 22, "trunc-both task total");
  assertEqual(truncBothAna.slices.tasks.returned, 20, "trunc-both task returned");
  assertEqual(truncBothAna.slices.tasks.truncated, true, "trunc-both task truncated");
  assertEqual(truncBothAna.slices.decisions.total, 12, "trunc-both decision total");
  assertEqual(truncBothAna.slices.decisions.returned, 10, "trunc-both decision returned");
  assertEqual(truncBothAna.slices.decisions.truncated, true, "trunc-both decision truncated");
  const tbPageReview = decisionItem(truncBothAna, SCENARIO.decisions.tbPageReview);
  assertEqual(tbPageReview.needsReview, true, "tb page-review needsReview");
  assertEqual(tbPageReview.needsReviewFindingIds, [SCENARIO.findings.tbWithdrawn], "tb page-review finding ids");
  assert(
    !truncBothAna.slices.decisions.items.some((decision) => decision.id === SCENARIO.decisions.tbBeyondReview),
    "trunc-both beyond-page review decision appeared inside the returned page",
  );
  if (baselineAttention) {
    assertEqual(attentionSummary(truncBothAna.needsYou), [], "trunc-both ana needsYou");
    assertEqual(attentionSummary(truncBothAna.needsAttention), [], "trunc-both ana needsAttention");
    assertEqual(attentionSummary(truncBothBen.needsYou), [], "trunc-both ben needsYou");
    assertEqual(attentionSummary(truncBothBen.needsAttention), [], "trunc-both ben needsAttention");
  }

  // --- Workspace 6: the sentinel stays inside its own workspace -------------
  const unrelatedZed = service.getWorkspaceContext(zedCtx, SCENARIO.workspaces.unrelated);
  assertEqual(unrelatedZed.slices.findings.total, 1, "unrelated finding total");
  assert(
    unrelatedZed.slices.findings.items[0]?.summary.includes(UNRELATED_FINDING_SENTINEL) === true,
    "unrelated sentinel missing from its own workspace",
  );
  const authorizedContexts = [
    labAna,
    labBen,
    quietAna,
    quietBen,
    truncTasksAna,
    truncTasksBen,
    truncDecisionsAna,
    truncDecisionsBen,
    truncBothAna,
    truncBothBen,
  ];
  for (const context of authorizedContexts) {
    assert(
      !JSON.stringify(context).includes(UNRELATED_FINDING_SENTINEL),
      "unrelated sentinel leaked into an authorized context",
    );
  }
  assert(
    store.listParticipants(SCENARIO.workspaces.unrelated).length === 1,
    "unrelated workspace has more than one participant",
  );
  assertEqual(
    store.listParticipants(SCENARIO.workspaces.lab).map((row) => row.actor.actorId).sort(),
    [SCENARIO.humans.ana, SCENARIO.humans.ben, SCENARIO.agents.codex, SCENARIO.agents.opencode].sort(),
    "lab participant set",
  );
  assertEqual(store.getAgent(SCENARIO.agents.codex)?.humanId, SCENARIO.humans.ana, "Codex owner");
  assertEqual(store.getAgent(SCENARIO.agents.opencode)?.humanId, SCENARIO.humans.ben, "OpenCode owner");

  return {
    provenance: "FIXTURE EVIDENCE — cannot establish Gate B, C, or E.",
    lab: {
      tasks: {
        total: labAna.slices.tasks.total,
        returned: labAna.slices.tasks.returned,
        truncated: labAna.slices.tasks.truncated,
        keyTasksInsidePage: [
          SCENARIO.tasks.blockedAna,
          SCENARIO.tasks.openAna,
          SCENARIO.tasks.openNoassignee,
          SCENARIO.tasks.blockedOpencode,
          SCENARIO.tasks.blockedNoassignee,
        ],
      },
      decisions: {
        total: labAna.slices.decisions.total,
        returned: labAna.slices.decisions.returned,
        truncated: labAna.slices.decisions.truncated,
        review: [
          {
            id: SCENARIO.decisions.reviewSuperseded,
            needsReview: reviewSuperseded.needsReview === true,
            needsReviewFindingIds: reviewSuperseded.needsReviewFindingIds ?? [],
          },
          {
            id: SCENARIO.decisions.reviewWithdrawn,
            needsReview: reviewWithdrawn.needsReview,
            needsReviewFindingIds: reviewWithdrawn.needsReviewFindingIds ?? [],
          },
        ],
        supersededExcluded: !returnedDecisionIds.includes(SCENARIO.decisions.old),
      },
      historicalCounts: labAna.historicalCounts,
      needsYou: { ana: attentionSummary(labAna.needsYou), ben: attentionSummary(labBen.needsYou) },
      needsAttention: { ana: attentionSummary(labAna.needsAttention), ben: attentionSummary(labBen.needsAttention) },
      reviewDecisionsAbsentFromAttentionLists: true,
    },
    quiet: {
      tasksSlice: {
        total: quietAna.slices.tasks.total,
        returned: quietAna.slices.tasks.returned,
        truncated: quietAna.slices.tasks.truncated,
      },
      decisionsSlice: {
        total: quietAna.slices.decisions.total,
        returned: quietAna.slices.decisions.returned,
        truncated: quietAna.slices.decisions.truncated,
      },
      needsYou: { ana: attentionSummary(quietAna.needsYou), ben: attentionSummary(quietBen.needsYou) },
      needsAttention: {
        ana: attentionSummary(quietAna.needsAttention),
        ben: attentionSummary(quietBen.needsAttention),
      },
      suggestedNextAction: {
        kind: quietAna.suggestedNextAction.kind,
        id: quietAna.suggestedNextAction.id,
        reason: quietAna.suggestedNextAction.reason,
      },
    },
    truncTasks: {
      tasksSlice: {
        total: truncTasksAna.slices.tasks.total,
        returned: truncTasksAna.slices.tasks.returned,
        truncated: truncTasksAna.slices.tasks.truncated,
      },
      beyondPageTaskInsidePage: false,
      needsYou: { ana: attentionSummary(truncTasksAna.needsYou), ben: attentionSummary(truncTasksBen.needsYou) },
      needsAttention: {
        ana: attentionSummary(truncTasksAna.needsAttention),
        ben: attentionSummary(truncTasksBen.needsAttention),
      },
      suggestedNextAction: { kind: truncTasksAna.suggestedNextAction.kind, reason: truncTasksAna.suggestedNextAction.reason },
    },
    truncDecisions: {
      decisionsSlice: {
        total: truncDecisionsAna.slices.decisions.total,
        returned: truncDecisionsAna.slices.decisions.returned,
        truncated: truncDecisionsAna.slices.decisions.truncated,
      },
      pageReview: {
        id: SCENARIO.decisions.pageReview,
        needsReview: pageReview.needsReview === true,
        needsReviewFindingIds: pageReview.needsReviewFindingIds ?? [],
      },
      beyondPageReviewAbsent: true,
      needsYou: { ana: attentionSummary(truncDecisionsAna.needsYou), ben: attentionSummary(truncDecisionsBen.needsYou) },
      needsAttention: {
        ana: attentionSummary(truncDecisionsAna.needsAttention),
        ben: attentionSummary(truncDecisionsBen.needsAttention),
      },
    },
    truncBoth: {
      tasksSlice: {
        total: truncBothAna.slices.tasks.total,
        returned: truncBothAna.slices.tasks.returned,
        truncated: truncBothAna.slices.tasks.truncated,
      },
      decisionsSlice: {
        total: truncBothAna.slices.decisions.total,
        returned: truncBothAna.slices.decisions.returned,
        truncated: truncBothAna.slices.decisions.truncated,
      },
      needsYou: { ana: attentionSummary(truncBothAna.needsYou), ben: attentionSummary(truncBothBen.needsYou) },
      needsAttention: {
        ana: attentionSummary(truncBothAna.needsAttention),
        ben: attentionSummary(truncBothBen.needsAttention),
      },
    },
  };
}

function keyIdMap(): Record<string, unknown> {
  return {
    organization: SCENARIO.organizationId,
    team: SCENARIO.teamId,
    workspaces: SCENARIO.workspaces,
    goal: SCENARIO.goal.lab,
    ana: SCENARIO.humans.ana,
    ben: SCENARIO.humans.ben,
    zed: SCENARIO.humans.zed,
    codex: SCENARIO.agents.codex,
    opencode: SCENARIO.agents.opencode,
    findings: SCENARIO.findings,
    decisions: SCENARIO.decisions,
    tasks: SCENARIO.tasks,
    artifacts: SCENARIO.artifacts,
    unrelatedSentinel: UNRELATED_FINDING_SENTINEL,
  };
}

export interface SeedReceipt {
  databasePath: string;
  workspaces: typeof SCENARIO.workspaces;
  seedClock: { base: string; final: string; servedAt: string };
  deterministic: { ids: string; clock: string; tokens: string };
  keyIds: Record<string, unknown>;
  verification: Record<string, unknown>;
}

export interface SeedResult {
  databasePath: string;
  tokensPath: string;
  receiptPath: string;
  tokens: ScenarioTokens;
  receipt: SeedReceipt;
}

function seedAt(databasePath: string, attentionExpectation: AttentionExpectation): SeedReceipt & { tokens: ScenarioTokens } {
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
    const verification = verifyScenario(service, store, attentionExpectation);
    return {
      databasePath,
      workspaces: SCENARIO.workspaces,
      seedClock: { base: SEED_BASE_ISO, final: next(), servedAt: SERVED_AT },
      deterministic: {
        ids: "pinned+sequential",
        clock: "fixed base, +1s per write",
        tokens: "random by construction; excluded from dumps and key",
      },
      keyIds: keyIdMap(),
      verification: { attentionExpectation, ...verification },
      tokens,
    };
  } finally {
    service.close();
  }
}

export function seedDatabase(outDir: string, force: boolean, attentionExpectation: AttentionExpectation = "none"): SeedResult {
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
  const seeded = seedAt(databasePath, attentionExpectation);
  const { tokens, ...receipt } = seeded;
  writeFileSync(tokensPath, `${JSON.stringify(tokens)}\n`, { mode: 0o600 });
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  assert((statSync(tokensPath).mode & 0o777) === 0o600, "token file mode");
  assert((statSync(receiptPath).mode & 0o777) === 0o600, "receipt file mode");
  return { databasePath, tokensPath, receiptPath, tokens, receipt };
}

function parseArgs(argv: string[]): { out: string; force: boolean; attentionExpectation: AttentionExpectation } {
  let out = DEFAULT_OUT;
  let force = false;
  let attentionExpectation: AttentionExpectation = "none";
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (arg === "--attention-expectation") {
      const value = argv[index + 1];
      if (value !== "baseline" && value !== "none") {
        fail("--attention-expectation requires baseline|none");
      }
      attentionExpectation = value;
      index += 1;
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
  return { out, force, attentionExpectation };
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const result = seedDatabase(args.out, args.force, args.attentionExpectation);
  process.stdout.write(
    `${JSON.stringify(
      {
        databasePath: result.databasePath,
        tokensPath: result.tokensPath,
        receiptPath: result.receiptPath,
        workspaces: SCENARIO.workspaces,
        tokens: result.tokens,
        keyIds: keyIdMap(),
        servedAt: SERVED_AT,
      },
      null,
      2,
    )}\n`,
  );
}
