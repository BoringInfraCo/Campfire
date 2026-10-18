/**
 * NAV-001 deterministic display-pressure fixture (Step 0, contract §3).
 *
 * FIXTURE EVIDENCE — stresses the terminal surface; cannot establish Gate B, C,
 * or E and is not human-observation evidence.
 *
 * Builds the frozen NAV-001 display-pressure scenario for
 * `docs/Campfire-v1.22-NAV-001-Focused-Terminal-Navigator.md`: one authorized
 * lab workspace with 20 human participants, 37 registered agents, 64 tasks, 12
 * artifacts, 5 decisions (one proposed, one accepted-needs-review, one
 * competing accepted pair, one plain accepted), plus one unrelated workspace
 * that only Zed can read. Both the id source and the clock are deterministic,
 * so re-running into a fresh output directory produces byte-identical served
 * state (raw actor tokens stay random; they never enter the dumps).
 *
 *   npx tsx fixtures/navigator/nav-001/seed.ts [--out <dir>] [--force]
 *
 * Default output: `fixtures/navigator/nav-001/.tmp/served` (gitignored; no
 * database or token is committed). `tokens.json` is written mode 0600 and
 * stays under `.tmp/`; the answer key and dumps never carry tokens.
 *
 * The record ids, the fixed seed clock, the invite/join path, the superseded
 * mechanism, the needsReview mechanism, and the receipt flow copy
 * `fixtures/attention/att-001/seed.ts` exactly. Keyed facts are always
 * verified against the real service before the seed writes its receipt.
 *
 * Page-budget note (the display-pressure point): `get_workspace_context`
 * returns at most 20 tasks per page and this fixture keeps the default budget.
 * The task page is selected blocked-first, then in_progress, then open, each
 * newest-first (`TASK_RANK_SQL`), so filler statuses use a weighted
 * deterministic cycle (N % 13: 0 → blocked, 6 → in_progress, otherwise open).
 * A plain open/in_progress/blocked round-robin would put 22 blocked tasks
 * ahead of every open task and hide `task_nav001_assigned_open_ana` from the
 * returned page, breaking the frozen needsYou key (see README).
 */
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ID_PREFIXES, createId, type IdKind, type IdSource } from "../../../src/domain/ids.js";
import type { ActorRef, ActorType, ParticipantRole, TaskStatus } from "../../../src/domain/types.js";
import type { ActorContext } from "../../../src/service/authorization.js";
import { createCampfireService } from "../../../src/service/campfire-service.js";
import type { AttentionItem, CampfireService, WorkspaceContext } from "../../../src/service/service.js";
import { openSqliteStore } from "../../../src/store/sqlite-store.js";
import type { CampfireStore } from "../../../src/store/store.js";

const FIXTURE_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = resolve(FIXTURE_DIR, ".tmp", "served");

/** Fixed seed clock. Every write advances by one second. */
export const SEED_BASE_ISO = "2026-10-17T12:00:00.000Z";
const SEED_BASE_MS = Date.parse(SEED_BASE_ISO);
const CLOCK_STEP_MS = 1000;

/**
 * Frozen read clock for `dump.ts`. Sits after every seed timestamp, so the
 * served-state dumps are byte-identical across two fresh seeds instead of
 * differing only in `generatedAt`. The seed writes well under 500 rows, so a
 * one-hour margin (att-001 uses two) cannot be crossed.
 */
export const SERVED_AT = "2026-10-17T14:00:00.000Z";

/** Exact string planted only in the unauthorized workspace's finding. */
export const UNRELATED_FINDING_SENTINEL = "UNRELATED_FINDING_SENTINEL_nav001_do_not_leak";

/**
 * Hostile task title: raw ANSI escape sequences plus a BEL, planted fixture-side
 * only. Every surface must strip controls before rendering; the captured frames
 * must never carry an ESC (see FIXTURE_KEY).
 */
export const HOSTILE_TASK_TITLE = "nav-001 \u001b[31mhostile\u001b[0m\u0007 title";

/** Hostile artifact reference: markup that must never become an open control. */
export const HOSTILE_ARTIFACT_URI = 'https://example.com/nav-001/report"><img src=x onerror=alert(1)>';

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** The 20 humans of the lab: Ana, Ben, then hum_nav001_h03 .. hum_nav001_h20. */
export const FILLER_HUMAN_IDS: readonly string[] = Array.from(
  { length: 18 },
  (_, index) => `hum_nav001_h${pad2(index + 3)}`,
);

/** The 20 lab human participant ids, in join-independent pinned order. */
export const LAB_HUMAN_IDS: readonly string[] = ["hum_nav001_ana", "hum_nav001_ben", ...FILLER_HUMAN_IDS];

/** The 37 registered agents of the lab: agt_nav001_01 .. agt_nav001_37. */
export const LAB_AGENT_IDS: readonly string[] = Array.from(
  { length: 37 },
  (_, index) => `agt_nav001_${pad2(index + 1)}`,
);

function fillerIds(prefix: string, count: number, width = 2): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}${String(index + 1).padStart(width, "0")}`);
}

const FILLER_TASK_IDS: readonly string[] = fillerIds("task_nav001_f", 58, 3); // f001..f058
const FILLER_ARTIFACT_IDS: readonly string[] = fillerIds("art_nav001_f", 9); // f01..f09

/** Frozen scenario ids. The answer key and dump script cite these exact values. */
export const SCENARIO = {
  organizationId: "org_nav001",
  teamId: "team_nav001",
  labHumanIds: LAB_HUMAN_IDS,
  agentIds: LAB_AGENT_IDS,
  humans: { ana: "hum_nav001_ana", ben: "hum_nav001_ben", zed: "hum_nav001_zed" },
  workspaces: { lab: "ws_nav001_lab", unrelated: "ws_nav001_unrelated" },
  workspaceNames: { lab: "nav-001 display-pressure lab", unrelated: "nav-001 unrelated" },
  goal: { lab: "goal_nav001_focus" },
  findings: {
    labSuperseded: "find_nav001_superseded",
    labCurrent: "find_nav001_current",
    unrelatedSentinel: "find_nav001_unrelated",
  },
  decisions: {
    proposed: "dec_nav001_proposed",
    review: "dec_nav001_review",
    competingA: "dec_nav001_competing_a",
    competingB: "dec_nav001_competing_b",
    plain: "dec_nav001_plain",
  },
  tasks: {
    assignedOpenAna: "task_nav001_assigned_open_ana",
    assignedBlockedAna: "task_nav001_assigned_blocked_ana",
    openNoassignee: "task_nav001_open_noassignee",
    blockedNoassignee: "task_nav001_blocked_noassignee",
    blockedAgent: "task_nav001_blocked_agent",
    hostile: "task_nav001_hostile",
  },
  artifacts: {
    runbook: "art_nav001_runbook",
    hostile: "art_nav001_hostile",
    notes: "art_nav001_notes",
  },
  hostileTaskTitle: HOSTILE_TASK_TITLE,
  hostileArtifactUri: HOSTILE_ARTIFACT_URI,
} as const;

/**
 * Deterministic filler task status. Weighted cycle, not a plain round-robin:
 * with 58 fillers a 1:1:1 cycle would create 19 blocked fillers + 3 keyed
 * blocked = 22 blocked rows, and the 20-row page (blocked rank first) would
 * then contain no open task at all — hiding `task_nav001_assigned_open_ana`
 * from the returned page and breaking the frozen needsYou key. N % 13 keeps
 * blocked + in_progress at 9, well inside the page budget.
 */
function fillerStatus(fillerNumber: number): TaskStatus {
  const phase = fillerNumber % 13;
  if (phase === 0) return "blocked";
  if (phase === 6) return "in_progress";
  return "open";
}

/**
 * Deterministic filler assignees: cycle over the 18 lab humans other than
 * Ana and Ben, then the 37 agents (55 candidates). No filler is ever assigned
 * to `hum_nav001_ana` or `hum_nav001_ben`, so their needsYou lists stay frozen.
 */
function fillerAssignee(fillerNumber: number): ActorRef {
  const candidates: ReadonlyArray<{ id: string; type: ActorType }> = [
    ...FILLER_HUMAN_IDS.map((id) => ({ id, type: "human" as const })),
    ...LAB_AGENT_IDS.map((id) => ({ id, type: "agent" as const })),
  ];
  const picked = candidates[(fillerNumber - 1) % candidates.length]!;
  return { actorId: picked.id, actorType: picked.type };
}

function taskStatusNumber(id: string): number {
  return Number.parseInt(id.slice(-3), 10);
}

const PLANNED: Partial<Record<IdKind, string[]>> = {
  human: [...LAB_HUMAN_IDS, SCENARIO.humans.zed],
  agent: [...LAB_AGENT_IDS],
  workspace: [SCENARIO.workspaces.lab, SCENARIO.workspaces.unrelated],
  goal: [SCENARIO.goal.lab],
  // Creation order fixes the finding chain: the `correct_finding` successor
  // consumes the next queued finding id, so the superseded/current pair is
  // pinned exactly like att-001.
  finding: [
    SCENARIO.findings.labSuperseded,
    SCENARIO.findings.labCurrent,
    SCENARIO.findings.unrelatedSentinel,
  ],
  // Creation order fixes each decision's updatedAt (the accept order is the
  // creation order here); 5 decisions, all inside the default 10-row page.
  decision: [
    SCENARIO.decisions.proposed,
    SCENARIO.decisions.review,
    SCENARIO.decisions.competingA,
    SCENARIO.decisions.competingB,
    SCENARIO.decisions.plain,
  ],
  artifact: [...FILLER_ARTIFACT_IDS, SCENARIO.artifacts.runbook, SCENARIO.artifacts.hostile, SCENARIO.artifacts.notes],
  // Creation order per task: fillers first, then the keyed open tasks, then
  // the keyed blocked tasks — so the three keyed opens are the newest open
  // rows and land inside the returned page next to the blocker rows.
  task: [
    ...FILLER_TASK_IDS,
    SCENARIO.tasks.assignedOpenAna,
    SCENARIO.tasks.openNoassignee,
    SCENARIO.tasks.hostile,
    SCENARIO.tasks.assignedBlockedAna,
    SCENARIO.tasks.blockedNoassignee,
    SCENARIO.tasks.blockedAgent,
  ],
};

function fail(message: string): never {
  throw new Error(`nav-001 seed: ${message}`);
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
      return createId(kind, () => `${ID_PREFIXES[kind]}_nav001_${String(spare).padStart(4, "0")}`);
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

function actorRef(id: string, type: ActorType): ActorRef {
  return { actorId: id, actorType: type };
}

function actorContext(id: string, type: ActorType): ActorContext {
  return { actor: actorRef(id, type) };
}

export interface ScenarioTokens {
  humans: Record<string, string>;
  agents: Record<string, string>;
  zed: string;
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
    service.joinWorkspace(actorContext(actor.actorId, actor.actorType), { workspaceId });
  }
}

function seedLab(service: CampfireService, anaCtx: ActorContext): void {
  const lab = SCENARIO.workspaces.lab;

  // --- Artifacts: nine fillers first; the three keyed references last so the
  // newest-first artifacts page returns runbook/hostile/notes inside 10 of 12.
  for (const [index, id] of FILLER_ARTIFACT_IDS.entries()) {
    const added = service.addArtifact(anaCtx, {
      workspaceId: lab,
      type: "document",
      title: `Display-pressure filler reference ${pad2(index + 1)}`,
      uriOrPath: `nav-001/filler-reference-${pad2(index + 1)}.md`,
    });
    assertEqual(added.id, id, `lab filler artifact id ${id}`);
  }
  const runbook = service.addArtifact(anaCtx, {
    workspaceId: lab,
    type: "report",
    title: "nav-001 runbook reference",
    uriOrPath: "https://example.com/nav-001/runbook.html",
  });
  assertEqual(runbook.id, SCENARIO.artifacts.runbook, "runbook artifact id");
  const hostile = service.addArtifact(anaCtx, {
    workspaceId: lab,
    type: "other",
    title: "nav-001 hostile markup reference",
    uriOrPath: HOSTILE_ARTIFACT_URI,
  });
  assertEqual(hostile.id, SCENARIO.artifacts.hostile, "hostile artifact id");
  const notes = service.addArtifact(anaCtx, {
    workspaceId: lab,
    type: "document",
    title: "nav-001 working notes",
    uriOrPath: "nav-001/working-notes.md",
  });
  assertEqual(notes.id, SCENARIO.artifacts.notes, "notes artifact id");

  // --- Findings: the superseded pair (att-001 mechanism) ...----------------
  service.addFinding(anaCtx, {
    workspaceId: lab,
    summary: "Every recorded lab task appeared in the first terminal read.",
    detail: "Observed while the lab still fit inside one default task page.",
  });
  service.correctFinding(anaCtx, {
    findingId: SCENARIO.findings.labSuperseded,
    summary: "The terminal read covers only the returned task page.",
    detail: "The 44 tasks beyond the default 20-row page are not inspected.",
    reason: "The lab grew past one default task page; the earlier observation covered only the returned page.",
  });

  // ...and the recorded Finding→Artifact citation (ARH-001 relations), so the
  // runbook row renders "cited by find_nav001_current (supports)".
  service.citeFindingEvidence(anaCtx, {
    findingId: SCENARIO.findings.labCurrent,
    artifactId: SCENARIO.artifacts.runbook,
    relation: "supports",
    note: "runbook recorded beside the correction",
  });

  // --- Decisions -------------------------------------------------------------
  service.addDecision(anaCtx, {
    workspaceId: lab,
    summary: "Adopt the focused single-screen terminal layout.",
    rationale: "The contract seeks lower time-to-source without a second work feed.",
  });

  /** Cites the superseded finding; stays accepted and needsReview at read time. */
  service.addDecision(anaCtx, {
    workspaceId: lab,
    summary: "The terminal screen lists every recorded task because the read felt complete.",
    rationale: "Assumed the default task page returned every recorded task.",
  });
  service.acceptDecision(anaCtx, SCENARIO.decisions.review);
  service.citeDecisionBasis(anaCtx, {
    decisionId: SCENARIO.decisions.review,
    findingId: SCENARIO.findings.labSuperseded,
    note: "original observation",
  });

  /** Competing accepted pair: conflicting rationales, no recorded transition. */
  service.addDecision(anaCtx, {
    workspaceId: lab,
    summary: "Order the screen by recorded assignment.",
    rationale: "Assignment is the only recorded grouping, so it should lead the order.",
  });
  service.acceptDecision(anaCtx, SCENARIO.decisions.competingA);
  service.addDecision(anaCtx, {
    workspaceId: lab,
    summary: "Order the screen by newest record.",
    rationale: "Recency shows the latest change first; assignment ordering hides fresh work.",
  });
  service.acceptDecision(anaCtx, SCENARIO.decisions.competingB);

  service.addDecision(anaCtx, {
    workspaceId: lab,
    summary: "Keep the workspace read-only during the baseline freeze.",
    rationale: "No write path may change the fixture before captures are frozen.",
  });
  service.acceptDecision(anaCtx, SCENARIO.decisions.plain);

  // --- Tasks: 64 rows, none completed, so slices.tasks total = 64 -----------
  interface PinnedTask {
    id: string;
    title: string;
    assignee?: ActorRef;
  }
  const fillerTasks: PinnedTask[] = FILLER_TASK_IDS.map((id, index) => {
    const fillerNumber = index + 1;
    return {
      id,
      title: `Display-pressure filler task ${pad2(fillerNumber)}`,
      assignee: fillerAssignee(fillerNumber),
    };
  });
  const keyedOpenTasks: PinnedTask[] = [
    {
      id: SCENARIO.tasks.assignedOpenAna,
      title: "Give the terminal one focused screen",
      assignee: actorRef(SCENARIO.humans.ana, "human"),
    },
    { id: SCENARIO.tasks.openNoassignee, title: "Pick the screen reviewer" },
    { id: SCENARIO.tasks.hostile, title: HOSTILE_TASK_TITLE },
  ];
  const keyedBlockedTasks: PinnedTask[] = [
    {
      id: SCENARIO.tasks.assignedBlockedAna,
      title: "Package the display-pressure baseline",
      assignee: actorRef(SCENARIO.humans.ana, "human"),
    },
    { id: SCENARIO.tasks.blockedNoassignee, title: "Decide what counts as a focused screen" },
    {
      id: SCENARIO.tasks.blockedAgent,
      title: "Reproduce the eager-dump pressure",
      assignee: actorRef(SCENARIO.agentIds[0]!, "agent"),
    },
  ];
  for (const task of [...fillerTasks, ...keyedOpenTasks, ...keyedBlockedTasks]) {
    const created = service.createTask(anaCtx, {
      workspaceId: lab,
      title: task.title,
      ...(task.assignee === undefined ? {} : { assignee: task.assignee }),
    });
    assertEqual(created.id, task.id, `lab task id ${task.id}`);
    assert(created.title.length > 0, `lab task ${task.id} lost its title`);
  }

  // Status updates, in a pinned order: filler rows first (ascending id), then
  // the three keyed blocked rows LAST so they are the newest blocked rows and
  // stay inside the returned page beside the keyed open rows.
  for (const [index, id] of FILLER_TASK_IDS.entries()) {
    const status = fillerStatus(index + 1);
    if (status === "open") continue;
    service.updateTask(anaCtx, { taskId: id, status });
  }
  for (const id of [SCENARIO.tasks.assignedBlockedAna, SCENARIO.tasks.blockedNoassignee, SCENARIO.tasks.blockedAgent]) {
    service.updateTask(anaCtx, { taskId: id, status: "blocked" });
  }

  // Hostile strings live in the fixture store; the surfaces must render them
  // inert. Assert the planted bytes survive the seed path itself.
  const hostileTask = service.getTaskInWorkspace(anaCtx, lab, SCENARIO.tasks.hostile);
  assertEqual(hostileTask.title, HOSTILE_TASK_TITLE, "hostile task title bytes");
  assert(hostileTask.title.includes("\u001b[31m"), "hostile task title lost its escape sequence");
  assert(hostileTask.title.includes("\u0007"), "hostile task title lost its BEL");
  const hostileArtifact = service.getArtifactInWorkspace(anaCtx, lab, SCENARIO.artifacts.hostile);
  assertEqual(hostileArtifact.uriOrPath, HOSTILE_ARTIFACT_URI, "hostile artifact uri bytes");
  assert(hostileArtifact.uriOrPath.includes('"><img'), "hostile artifact uri lost its markup");
}

function seedScenario(service: CampfireService): ScenarioTokens {
  const anaCtx = human(SCENARIO.humans.ana);
  const zedCtx = human(SCENARIO.humans.zed);

  // --- Identities -----------------------------------------------------------
  const ana = service.createHuman(undefined, { teamId: SCENARIO.teamId, displayName: "Ana" });
  assertEqual(ana.human.id, SCENARIO.humans.ana, "Ana id");
  const tokens: ScenarioTokens = { humans: {}, agents: {}, zed: "" };
  tokens.humans[SCENARIO.humans.ana] = ana.token;
  for (const [humanId, displayName] of [
    [SCENARIO.humans.ben, "Ben"],
    ...FILLER_HUMAN_IDS.map((id) => [id, `H${id.slice(-2)}`] as const),
  ]) {
    const created = service.createHuman(anaCtx, { teamId: SCENARIO.teamId, displayName });
    assertEqual(created.human.id, humanId, `lab human id ${humanId}`);
    tokens.humans[humanId] = created.token;
  }
  const zed = service.createHuman(anaCtx, { teamId: SCENARIO.teamId, displayName: "Zed" });
  assertEqual(zed.human.id, SCENARIO.humans.zed, "Zed id");
  tokens.zed = zed.token;

  // 37 agents, each owned by one of the 20 lab humans (cycled), with
  // alternating harness values "codex" and "opencode" (odd = codex).
  for (const [index, agentId] of LAB_AGENT_IDS.entries()) {
    const agentNumber = index + 1;
    const ownerId = LAB_HUMAN_IDS[index % LAB_HUMAN_IDS.length]!;
    const harness = agentNumber % 2 === 1 ? "codex" : "opencode";
    const created = service.createAgent(human(ownerId), {
      teamId: SCENARIO.teamId,
      humanId: ownerId,
      name: `Agent ${pad2(agentNumber)}`,
      harness,
    });
    assertEqual(created.agent.id, agentId, `lab agent id ${agentId}`);
    assertEqual(created.agent.humanId, ownerId, `agent ${agentId} owner`);
    assertEqual(created.agent.harness, harness, `agent ${agentId} harness`);
    tokens.agents[agentId] = created.token;
  }

  // --- Workspace 1: the display-pressure lab -------------------------------
  const lab = service.createWorkspace(anaCtx, {
    teamId: SCENARIO.teamId,
    name: SCENARIO.workspaceNames.lab,
  });
  assertEqual(lab.id, SCENARIO.workspaces.lab, "lab workspace id");
  const goal = service.createGoal(anaCtx, {
    workspaceId: lab.id,
    title: "Give the terminal one focused screen over the recorded work.",
    description:
      "Twenty humans and thirty-seven agents share one lab while the v1.21.0 navigator baseline is frozen.",
  });
  assertEqual(goal.id, SCENARIO.goal.lab, "lab goal id");
  const labEntries: Array<[ActorRef, ParticipantRole]> = [
    [actorRef(SCENARIO.humans.ben, "human"), "member"],
    ...FILLER_HUMAN_IDS.map((id) => [actorRef(id, "human"), "member"] as [ActorRef, ParticipantRole]),
    ...LAB_AGENT_IDS.map((id) => [actorRef(id, "agent"), "agent"] as [ActorRef, ParticipantRole]),
  ];
  inviteAndJoin(service, anaCtx, lab.id, labEntries);
  seedLab(service, anaCtx);

  // --- Workspace 2: unrelated, owned by Zed only ---------------------------
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

  return tokens;
}

function attentionSummary(items: readonly AttentionItem[]): Array<{ reason: string; id: string }> {
  return items.map((item) => ({ reason: item.reason, id: item.id }));
}

function decisionItem(context: WorkspaceContext, id: string) {
  const item = context.slices.decisions.items.find((decision) => decision.id === id);
  assert(item !== undefined, `decision ${id} outside the returned orientation page`);
  return item;
}

/**
 * Verify the served projection matches the frozen scenario before returning.
 * Every assertion below is the frozen answer key (see FIXTURE_KEY).
 */
function verifyScenario(service: CampfireService, store: CampfireStore): Record<string, unknown> {
  const anaCtx = human(SCENARIO.humans.ana);
  const benCtx = human(SCENARIO.humans.ben);
  const zedCtx = human(SCENARIO.humans.zed);

  const labAna = service.getWorkspaceContext(anaCtx, SCENARIO.workspaces.lab);
  const labBen = service.getWorkspaceContext(benCtx, SCENARIO.workspaces.lab);

  // --- Participants ---------------------------------------------------------
  const participants = store.listParticipants(SCENARIO.workspaces.lab);
  const participantIds = participants.map((row) => row.actor.actorId);
  const humanParticipants = participants.filter((row) => row.actor.actorType === "human");
  const agentParticipants = participants.filter((row) => row.actor.actorType === "agent");
  assertEqual(humanParticipants.length, 20, "lab human participants");
  assertEqual(agentParticipants.length, 37, "lab agent participants");
  assertEqual(participantIds.length, 57, "lab participant count");
  assertEqual(
    [...LAB_HUMAN_IDS, ...LAB_AGENT_IDS].every((id) => participantIds.includes(id)),
    true,
    "lab participant set",
  );
  assertEqual(
    store.getAgent(SCENARIO.agentIds[0]!)?.humanId,
    SCENARIO.humans.ana,
    "agent 01 owner",
  );
  assertEqual(
    store.getAgent(SCENARIO.agentIds[36]!)?.humanId,
    LAB_HUMAN_IDS[36 % LAB_HUMAN_IDS.length],
    "agent 37 owner cycles over the lab humans",
  );
  assert(store.getAgent(SCENARIO.agentIds[1]!)?.harness === "opencode", "agent 02 harness alternation");

  // --- Tasks slice ----------------------------------------------------------
  assertEqual(labAna.slices.tasks.total, 64, "lab task total");
  assertEqual(labAna.slices.tasks.returned, 20, "lab task returned");
  assertEqual(labAna.slices.tasks.truncated, true, "lab task truncated");
  const returnedTaskIds = labAna.slices.tasks.items.map((task) => task.id);
  for (const id of [
    SCENARIO.tasks.assignedOpenAna,
    SCENARIO.tasks.openNoassignee,
    SCENARIO.tasks.hostile,
    SCENARIO.tasks.assignedBlockedAna,
    SCENARIO.tasks.blockedNoassignee,
    SCENARIO.tasks.blockedAgent,
  ]) {
    assert(returnedTaskIds.includes(id), `key task ${id} outside the returned page`);
  }
  assert(labAna.slices.tasks.items.every((task) => task.status !== "completed"), "no completed tasks");

  // --- Attention: Ana's frozen key -----------------------------------------
  const anaNeedsYouIds = labAna.needsYou.map((item) => item.id);
  assert(
    anaNeedsYouIds.includes(SCENARIO.tasks.assignedOpenAna) && anaNeedsYouIds.includes(SCENARIO.tasks.assignedBlockedAna),
    `ana needsYou lost an assigned task: ${JSON.stringify(attentionSummary(labAna.needsYou))}`,
  );

  // --- Attention coverage ---------------------------------------------------
  assertEqual(labAna.attentionCoverage.tasks, { total: 64, returned: 20, truncated: true }, "ana task coverage");
  assertEqual(labAna.attentionCoverage.decisions, { total: 5, returned: 5, truncated: false }, "ana decision coverage");
  assertEqual(labBen.attentionCoverage, labAna.attentionCoverage, "coverage is actor-independent");

  // --- Decisions slice ------------------------------------------------------
  assertEqual(labAna.slices.decisions.total, 5, "lab decision total");
  assertEqual(labAna.slices.decisions.returned, 5, "lab decision returned");
  assertEqual(labAna.slices.decisions.truncated, false, "lab decision truncated");
  const returnedDecisionIds = labAna.slices.decisions.items.map((decision) => decision.id);
  for (const id of [
    SCENARIO.decisions.proposed,
    SCENARIO.decisions.review,
    SCENARIO.decisions.competingA,
    SCENARIO.decisions.competingB,
    SCENARIO.decisions.plain,
  ]) {
    assert(returnedDecisionIds.includes(id), `key decision ${id} outside the returned page`);
  }
  const review = decisionItem(labAna, SCENARIO.decisions.review);
  assertEqual(review.status, "accepted", "review decision status");
  assertEqual(review.needsReview, true, "review decision needsReview");
  assertEqual(review.needsReviewFindingIds, [SCENARIO.findings.labSuperseded], "review decision review ids");
  const proposed = decisionItem(labAna, SCENARIO.decisions.proposed);
  assertEqual(proposed.status, "proposed", "proposed decision status");
  const competingA = decisionItem(labAna, SCENARIO.decisions.competingA);
  assertEqual(competingA.status, "accepted", "competing A status");
  assertEqual(competingA.needsReview, undefined, "competing A needsReview");
  const competingB = decisionItem(labAna, SCENARIO.decisions.competingB);
  assertEqual(competingB.status, "accepted", "competing B status");
  assertEqual(competingB.needsReview, undefined, "competing B needsReview");
  const plain = decisionItem(labAna, SCENARIO.decisions.plain);
  assertEqual(plain.status, "accepted", "plain decision status");
  assertEqual(labAna.supersededDecisions, [], "no superseded decisions replayed");

  // --- Artifacts slice ------------------------------------------------------
  assertEqual(labAna.slices.artifacts.total, 12, "lab artifact total");
  assertEqual(labAna.slices.artifacts.returned, 10, "lab artifact returned");
  assertEqual(labAna.slices.artifacts.truncated, true, "lab artifact truncated");
  const returnedArtifactIds = labAna.slices.artifacts.items.map((artifact) => artifact.id);
  for (const id of [SCENARIO.artifacts.runbook, SCENARIO.artifacts.hostile, SCENARIO.artifacts.notes]) {
    assert(returnedArtifactIds.includes(id), `key artifact ${id} outside the returned page`);
  }
  assert(
    !returnedArtifactIds.includes(FILLER_ARTIFACT_IDS[0]!) && !returnedArtifactIds.includes(FILLER_ARTIFACT_IDS[1]!),
    "the two oldest filler artifacts sit beyond the page",
  );

  // --- Recorded citation ----------------------------------------------------
  const labCurrent = labAna.slices.findings.items.find((finding) => finding.id === SCENARIO.findings.labCurrent);
  assert(labCurrent !== undefined, "current finding outside the orientation page");
  const runbookEvidence = (labCurrent.evidence ?? []).find(
    (row) => row.artifactId === SCENARIO.artifacts.runbook && row.relation === "supports",
  );
  assert(runbookEvidence !== undefined, "runbook not cited by the current finding as supports");
  assertEqual(labCurrent.predecessorId, SCENARIO.findings.labSuperseded, "current finding predecessor");
  const historicalCounts = store.countHistoricalFindings(SCENARIO.workspaces.lab);
  assertEqual(historicalCounts, 1, "lab historical findings");
  assert(
    !labAna.slices.findings.items.some((finding) => finding.id === SCENARIO.findings.labSuperseded),
    "superseded finding replayed as current",
  );

  // --- Hostile strings stay fixture-side -----------------------------------
  assert(
    !JSON.stringify(labAna).includes("\u001b") && !JSON.stringify(labBen).includes("\u001b"),
    "an escape sequence leaked into an authorized context",
  );

  // --- The unrelated workspace stays closed --------------------------------
  const unrelatedZed = service.getWorkspaceContext(zedCtx, SCENARIO.workspaces.unrelated);
  assertEqual(unrelatedZed.slices.findings.total, 1, "unrelated finding total");
  assert(
    unrelatedZed.slices.findings.items[0]?.summary.includes(UNRELATED_FINDING_SENTINEL) === true,
    "unrelated sentinel missing from its own workspace",
  );
  assert(
    store.listParticipants(SCENARIO.workspaces.unrelated).every((row) => row.actor.actorId === SCENARIO.humans.zed),
    "unrelated workspace has a participant other than Zed",
  );
  assert(
    !participantIds.includes(SCENARIO.humans.zed),
    "Zed is a lab participant; he must be authorized only in the unrelated workspace",
  );
  let labDenied = false;
  try {
    service.getWorkspaceContext(zedCtx, SCENARIO.workspaces.lab);
  } catch {
    labDenied = true;
  }
  assert(labDenied, "Zed read the lab workspace");
  const authorizedContexts = [labAna, labBen];
  for (const context of authorizedContexts) {
    assert(
      !JSON.stringify(context).includes(UNRELATED_FINDING_SENTINEL),
      "unrelated sentinel leaked into an authorized context",
    );
  }

  // --- Ana's frozen cue rows (recorded into the receipt) -------------------
  return {
    provenance: "FIXTURE EVIDENCE — cannot establish Gate B, C, or E.",
    lab: {
      participants: { humans: humanParticipants.length, agents: agentParticipants.length },
      tasks: {
        total: labAna.slices.tasks.total,
        returned: labAna.slices.tasks.returned,
        truncated: labAna.slices.tasks.truncated,
        keyTasksInsidePage: [
          SCENARIO.tasks.assignedOpenAna,
          SCENARIO.tasks.openNoassignee,
          SCENARIO.tasks.hostile,
          SCENARIO.tasks.assignedBlockedAna,
          SCENARIO.tasks.blockedNoassignee,
          SCENARIO.tasks.blockedAgent,
        ],
      },
      decisions: {
        total: labAna.slices.decisions.total,
        returned: labAna.slices.decisions.returned,
        truncated: labAna.slices.decisions.truncated,
        review: {
          id: SCENARIO.decisions.review,
          needsReview: review.needsReview === true,
          needsReviewFindingIds: review.needsReviewFindingIds ?? [],
        },
        proposed: { id: SCENARIO.decisions.proposed, status: proposed.status },
        competing: [
          { id: SCENARIO.decisions.competingA, status: competingA.status },
          { id: SCENARIO.decisions.competingB, status: competingB.status },
        ],
      },
      artifacts: {
        total: labAna.slices.artifacts.total,
        returned: labAna.slices.artifacts.returned,
        truncated: labAna.slices.artifacts.truncated,
        runbookCitedBy: [
          {
            findingId: SCENARIO.findings.labCurrent,
            relation: "supports",
          },
        ],
      },
      historicalCounts: labAna.historicalCounts,
      needsYou: { ana: attentionSummary(labAna.needsYou), ben: attentionSummary(labBen.needsYou) },
      needsAttention: {
        ana: attentionSummary(labAna.needsAttention),
        ben: attentionSummary(labBen.needsAttention),
      },
      attentionCoverage: {
        tasks: { total: labAna.attentionCoverage.tasks.total, returned: labAna.attentionCoverage.tasks.returned, truncated: labAna.attentionCoverage.tasks.truncated },
        decisions: {
          total: labAna.attentionCoverage.decisions.total,
          returned: labAna.attentionCoverage.decisions.returned,
          truncated: labAna.attentionCoverage.decisions.truncated,
        },
        completeUnderRules: labAna.attentionCoverage.completeUnderRules,
      },
      suggestedNextAction: {
        kind: labAna.suggestedNextAction.kind,
        id: labAna.suggestedNextAction.id,
        reason: labAna.suggestedNextAction.reason,
      },
    },
    unrelated: { sentinelInsideItsOwnWorkspace: true, zedOnly: true, labDeniedForZed: true },
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
    labHumans: [SCENARIO.humans.ana, SCENARIO.humans.ben, ...FILLER_HUMAN_IDS],
    agents: [...LAB_AGENT_IDS],
    findings: SCENARIO.findings,
    decisions: SCENARIO.decisions,
    tasks: SCENARIO.tasks,
    fillerTasks: [...FILLER_TASK_IDS],
    artifacts: SCENARIO.artifacts,
    fillerArtifacts: [...FILLER_ARTIFACT_IDS],
    hostileTaskTitle: HOSTILE_TASK_TITLE,
    hostileArtifactUri: HOSTILE_ARTIFACT_URI,
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
      workspaces: SCENARIO.workspaces,
      seedClock: { base: SEED_BASE_ISO, final: next(), servedAt: SERVED_AT },
      deterministic: {
        ids: "pinned+sequential",
        clock: "fixed base, +1s per write",
        tokens: "random by construction; excluded from dumps and key",
      },
      keyIds: keyIdMap(),
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
        workspaces: SCENARIO.workspaces,
        keyIds: keyIdMap(),
        servedAt: SERVED_AT,
      },
      null,
      2,
    )}\n`,
  );
}
