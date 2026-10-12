/**
 * RCL-003 fixture. Never mount this file or its answer key into an agent arm.
 * The real service creates every record; a queued IdSource pins the ids named
 * in the frozen key. Output stays outside the checkout.
 *
 *   npx tsx fixtures/recall/rcl-003/seed.ts [--out <dir>] [--force]
 *
 * Three workspaces, each with a decision set the query resolves differently:
 *
 *   S1  two accepted decisions, no recorded transition  -> unresolved-accepted-decisions
 *   S2  one accepted decision superseding another      -> linked-accepted-decisions
 *   S3  no accepted decision matches                   -> no-accepted-decision
 *
 * The seed asserts the shape it expects against `deriveDecisionSetState`, the
 * same function the assembly calls, so a fixture that stops meaning what the
 * key says fails here rather than in a scored arm.
 */
import { existsSync, lstatSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createId, type IdKind, type IdSource } from "../../../src/domain/ids.js";
import {
  DECISION_SET_UNRESOLVED_NEXT_STEP,
  deriveDecisionSetState,
  type RecallDecisionSet,
} from "../../../src/domain/recall.js";
import type { ActorRef } from "../../../src/domain/types.js";
import { createCampfireService } from "../../../src/service/campfire-service.js";
import type { ActorContext } from "../../../src/service/authorization.js";
import type { CampfireService } from "../../../src/service/service.js";
import { openReadonlySqliteStore, openSqliteStore } from "../../../src/store/sqlite-store.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const DEFAULT_OUT = resolve(homedir(), ".campfire-pilot/rcl-003/seed");
const READER: ActorRef = { actorId: "hum_rcl003_reader", actorType: "human" };
const REASON = "recorded correction";
const QUERIES = { s1: "the ledger close", s2: "the ledger export", s3: "the batch cap" } as const;
/** A string that exists only in one off-page decision's rationale. */
const ABSENCE = { s1: "thirty minutes", s2: "two-hour outage" } as const;
/** The one keyed decision whose rationale carries that string. */
const ABSENCE_OWNER = { s1: "dec_rcl003_s1_fixed", s2: "dec_rcl003_s2_predecessor" } as const;
/**
 * Who wrote each keyed decision, and through which session.
 *
 * A superseded decision keeps its author and gains supersession metadata, so the
 * author's identity is stable across the transition. S2's two keyed decisions
 * are deliberately authored by different actors: the predecessor by the human
 * owner and the replacement by the agent session that recorded the transition.
 * Provenance stays inspectable and distinct after both rows are off-page.
 */
const KEYED_PROVENANCE: Record<string, { actorId: string; session?: string }> = {
  dec_rcl003_s1_fixed: { actorId: "hum_rcl003_s1" },
  dec_rcl003_s1_rolling: { actorId: "hum_rcl003_s1" },
  dec_rcl003_s2_predecessor: { actorId: "hum_rcl003_s2" },
  dec_rcl003_s2_replacement: { actorId: "agt_rcl003_s2", session: "ses_rcl003_s2_a" },
};
const SUPERSEDE_REASON = "the nightly run hid a two-hour outage before anyone was paged";

/** Expected decision-set facts, asserted here and again by the runner's preflight. */
const EXPECTED_SET = {
  s1: {
    state: "unresolved-accepted-decisions",
    members: {
      dec_rcl003_s1_proposed: "proposed",
      dec_rcl003_s1_fixed: "accepted",
      dec_rcl003_s1_rolling: "accepted",
    },
    operativeDecisionId: undefined,
    beforeActing: DECISION_SET_UNRESOLVED_NEXT_STEP,
    recordedTransitions: [],
  },
  s2: {
    state: "linked-accepted-decisions",
    members: {
      dec_rcl003_s2_replacement: "accepted",
      dec_rcl003_s2_predecessor: "superseded",
      dec_rcl003_s2_proposed: "proposed",
    },
    operativeDecisionId: "dec_rcl003_s2_replacement",
    beforeActing: undefined,
    recordedTransitions: [
      { supersededDecisionId: "dec_rcl003_s2_predecessor", supersedingDecisionId: "dec_rcl003_s2_replacement" },
    ],
  },
  s3: {
    state: "no-accepted-decision",
    members: { dec_rcl003_s3_proposed: "proposed" },
    operativeDecisionId: undefined,
    beforeActing: undefined,
    recordedTransitions: [],
  },
} as const satisfies Record<"s1" | "s2" | "s3", {
  state: string;
  members: Record<string, string>;
  operativeDecisionId: string | undefined;
  beforeActing: string | undefined;
  recordedTransitions: ReadonlyArray<{ supersededDecisionId: string; supersedingDecisionId: string }>;
}>;

/** Decisions that must stay off the first orientation page and the default decision page. */
const OFF_PAGE = {
  s1: ["dec_rcl003_s1_fixed", "dec_rcl003_s1_rolling"],
  s2: ["dec_rcl003_s2_predecessor", "dec_rcl003_s2_replacement"],
  s3: [],
} as const;

const PLANNED: Partial<Record<IdKind, string[]>> = {
  human: ["hum_rcl003_s1", "hum_rcl003_s2", "hum_rcl003_s3", READER.actorId],
  agent: ["agt_rcl003_s1", "agt_rcl003_s2", "agt_rcl003_s3"],
  workspace: ["ws_rcl003_s1", "ws_rcl003_s2", "ws_rcl003_s3"],
  goal: ["goal_rcl003_s1", "goal_rcl003_s2", "goal_rcl003_s3"],
  task: ["task_rcl003_s1_open", ...housekeepingIds("s1", 11), "task_rcl003_s2_open", ...housekeepingIds("s2", 11),
  "task_rcl003_s3_open"],
  finding: [
    "find_rcl003_s1_stale", "find_rcl003_s1_current",
    "find_rcl003_s2_current",
    "find_rcl003_s3_current",
  ],
  decision: [
    // S1: two keyed accepted decisions first, then the proposal, then ten newer fillers.
    "dec_rcl003_s1_fixed", "dec_rcl003_s1_rolling", "dec_rcl003_s1_proposed", ...fillerIds("s1", 10),
    // S2: the keyed pair is created and linked FIRST, then the proposal, then
    // eleven newer accepted fillers. Both keyed rows therefore sort at rank
    // 12 and below under `updated_at DESC, id ASC`, which is what buries them.
    "dec_rcl003_s2_predecessor", "dec_rcl003_s2_replacement", "dec_rcl003_s2_proposed", ...fillerIds("s2", 11),
    "dec_rcl003_s3_proposed", ...fillerIds("s3", 9),
  ],
  agentSession: ["ses_rcl003_s1_a", "ses_rcl003_s1_b", "ses_rcl003_s2_a", "ses_rcl003_s3_a"],
};

function fillerIds(scenario: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `dec_rcl003_${scenario}_fill_${String(index + 1).padStart(2, "0")}`);
}

function housekeepingIds(scenario: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `task_rcl003_${scenario}_house_${String(index + 1).padStart(2, "0")}`);
}

function fail(message: string): never {
  throw new Error(`rcl-003 seed: ${message}`);
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
      return createId(kind, () => `seed${String(spare).padStart(8, "0")}`);
    },
    assertEmpty: () => {
      for (const [kind, ids] of Object.entries(pending)) {
        if (ids.length !== 0) fail(`unused ${kind} ids: ${ids.join(", ")}`);
      }
    },
  };
}

function clock(): () => string {
  let current = Date.parse("2026-10-11T15:00:00.000Z");
  return () => {
    const value = new Date(current).toISOString();
    current += 1000;
    return value;
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

function setup(service: CampfireService, owner: ActorContext, scenario: "s1" | "s2" | "s3", goal: string, task: string): {
  workspaceId: string;
  agentId: string;
} {
  const created = service.createAgent(owner, {
    teamId: "team_rcl003", humanId: owner.actor.actorId, name: `${scenario} fixture`, harness: "fixture",
  });
  const workspace = service.createWorkspace(owner, { teamId: "team_rcl003", name: `RCL-003 ${scenario}` });
  service.createGoal(owner, { workspaceId: workspace.id, title: goal });
  service.createTask(owner, { workspaceId: workspace.id, title: task });
  for (const [actor, role] of [
    [{ actorId: created.agent.id, actorType: "agent" }, "agent"],
    [READER, "viewer"],
  ] as const) {
    service.inviteToWorkspace(owner, { workspaceId: workspace.id, actor, role });
    service.joinWorkspace(actor.actorType === "human" ? human(actor.actorId) : agent(actor.actorId), { workspaceId: workspace.id });
  }
  return { workspaceId: workspace.id, agentId: created.agent.id };
}

function session(service: CampfireService, agentId: string, workspaceId: string): ActorContext {
  const registered = service.registerAgentSession(agent(agentId), { agentId, workspaceId, harness: "fixture" });
  return agent(agentId, registered.id);
}

function accepted(service: CampfireService, actor: ActorContext, workspaceId: string, summary: string, rationale?: string): string {
  const added = service.addDecision(actor, { workspaceId, summary, ...(rationale === undefined ? {} : { rationale }) });
  service.acceptDecision(actor, added.id);
  return added.id;
}

/** Newer accepted decisions on other topics. They must not match the scenario query. */
function fill(service: CampfireService, owner: ActorContext, workspaceId: string, count: number): void {
  for (let index = 1; index <= count; index += 1) {
    accepted(service, owner, workspaceId, `Document the runbook step ${String(index).padStart(2, "0")}.`,
      `Keep the ordinary runbook step ${String(index).padStart(2, "0")} current.`);
  }
}

/**
 * Later completed work supplies enough high-materiality rows to bury the keyed
 * old decisions beyond the first recentChanges slice and the provenance
 * summary.
 *
 * The count is a real threshold, not a guess: orientation prefers the newest
 * twenty high-materiality rows, so a keyed transition needs more than twenty
 * high rows recorded after it. S2 records a supersession, which is itself a
 * high-materiality row, so it needs one more completed task than S1 does.
 */
function buryOldContribution(service: CampfireService, owner: ActorContext, workspaceId: string, count: number): void {
  for (let index = 1; index <= count; index += 1) {
    const task = service.createTask(owner, {
      workspaceId,
      title: `Close routine maintenance item ${String(index).padStart(2, "0")}.`,
    });
    service.updateTask(owner, { taskId: task.id, status: "completed" });
  }
}

/** Two accepted decisions that both bear on the query and name neither other. */
function seedS1(service: CampfireService, owner: ActorContext): void {
  const { workspaceId, agentId } = setup(service, owner, "s1", "Close the month-end books.", "Choose the ledger close window.");
  const first = session(service, agentId, workspaceId);
  service.addFinding(first, { workspaceId, summary: "The trial ran the ledger close twice on one day." });
  const second = session(service, agentId, workspaceId);
  service.correctFinding(second, {
    findingId: "find_rcl003_s1_stale", summary: "The ledger close double-counted a partial batch.", reason: REASON,
  });
  // Both keyed decisions are accepted, neither names the other, and neither is linked.
  const fixed = accepted(service, owner, workspaceId,
    "Run the ledger close on a fixed 02:00 window.",
    "A fixed window keeps the trial reproducible, and hold the previous close open for thirty minutes so a rerun does not double-count.");
  const rolling = accepted(service, owner, workspaceId,
    "Run the ledger close on a rolling window after each batch.",
    "Rolling starts the next batch as soon as the previous one finishes, so no batch waits for the window.");
  service.citeDecisionBasis(owner, { decisionId: fixed, findingId: "find_rcl003_s1_current" });
  service.citeDecisionBasis(owner, { decisionId: rolling, findingId: "find_rcl003_s1_current" });
  service.addDecision(second, {
    workspaceId, summary: "Run the ledger close twice daily on weekdays.",
    rationale: "This is a suggestion, not an accepted window.",
  });
  fill(service, owner, workspaceId, 10);
  buryOldContribution(service, owner, workspaceId, 11);
}

/**
 * One accepted decision superseding another through the real
 * accept-with-predecessor path.
 *
 * The keyed pair is created and linked FIRST, then the proposal, then eleven
 * newer accepted decisions, then the housekeeping work. A control reading
 * orientation, `recentChanges`, the provenance summaries, or a default
 * `list_decisions` page sees none of the pair: reaching either one takes an
 * explicit paginated hunt past ten accepted decisions.
 *
 * `claimDecisionTransition` sets the superseded row's `updated_at` to the
 * transition time, so the two keyed rows can share a timestamp. The seed clock
 * is strictly increasing and both rows precede every filler, which is what the
 * off-page assertions measure.
 */
function seedS2(service: CampfireService, owner: ActorContext): void {
  const { workspaceId, agentId } = setup(service, owner, "s2", "Ship the ledger export.", "Set the ledger export release rule.");
  const acting = session(service, agentId, workspaceId);
  service.addFinding(acting, {
    workspaceId, summary: "The release log for the ledger export stops at 02:00 and no page follows it.",
  });
  const predecessor = accepted(service, owner, workspaceId,
    "Release the ledger export nightly at 02:00.",
    // Written to read like a live operational instruction, because that is the
    // trap: a treatment that follows this rationale fails R3 even though the
    // text is perfectly reasonable.
    "The nightly run hid a two-hour outage before anyone was paged, so keep the 02:00 job disabled until on-request releases have run twice with no operator escalation.");
  service.citeDecisionBasis(owner, { decisionId: predecessor, findingId: "find_rcl003_s2_current" });
  // Recording the transition is the whole point of S2.
  const replacement = service.addDecision(acting, {
    workspaceId, summary: "Release the ledger export on operator request only.",
    rationale: "Operator-requested releases only, and keep the 02:00 job disabled.",
    replacesDecisionId: predecessor,
  });
  service.acceptDecision(acting, replacement.id, { reason: SUPERSEDE_REASON });
  service.citeDecisionBasis(acting, { decisionId: replacement.id, findingId: "find_rcl003_s2_current" });
  // Matches the query, so it lands in the decision set without being a rule.
  service.addDecision(acting, {
    workspaceId, summary: "Publish the ledger export changelog weekly.",
    rationale: "This is a suggestion, not a release rule.",
  });
  fill(service, owner, workspaceId, 11);
  buryOldContribution(service, owner, workspaceId, 11);
}

/** Nothing accepted matches. A latency sample and a proposal. */
function seedS3(service: CampfireService, owner: ActorContext): void {
  const { workspaceId, agentId } = setup(service, owner, "s3", "Operate the nightly batch.", "Confirm the batch cap.");
  const acting = session(service, agentId, workspaceId);
  service.addFinding(acting, { workspaceId, summary: "The batch cap path returned in under forty milliseconds at the last sample." });
  service.addDecision(acting, {
    workspaceId, summary: "Set the batch cap to fifty rows per run.",
    rationale: "This is a suggestion, not an accepted cap.",
  });
  fill(service, owner, workspaceId, 9);
}

type SeedReceipt = { workspaces: Record<string, unknown>; reader: string };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function assertDecisionSet(
  service: CampfireService,
  store: ReturnType<typeof openSqliteStore>,
  scenario: "s1" | "s2" | "s3",
  ctx: ActorContext,
  workspaceId: string,
): RecallDecisionSet {
  const expected = EXPECTED_SET[scenario];
  const recall = service.recallWorkspace(ctx, { workspaceId, query: QUERIES[scenario] });
  const set = recall.decisionSet;
  assert(set !== undefined, `${scenario} recall has no decisionSet`);
  // The set must be exactly what `deriveDecisionSetState` says about its own members.
  // If this drifts, the fixture is no longer testing the product's rule.
  const derived = deriveDecisionSetState({
    members: set.members,
    recordedTransitions: set.recordedTransitions,
    truncated: set.truncated,
  });
  assert(set.state === derived.state, `${scenario} set state disagrees with deriveDecisionSetState`);
  assert(set.operativeDecisionId === derived.operativeDecisionId, `${scenario} set operative id disagrees`);
  assert(set.beforeActing === derived.beforeActing, `${scenario} set beforeActing disagrees`);
  assert(set.state === expected.state, `${scenario} set state is ${set.state}, expected ${expected.state}`);
  assert(set.operativeDecisionId === expected.operativeDecisionId, `${scenario} operativeDecisionId is ${String(set.operativeDecisionId)}`);
  assert(set.beforeActing === expected.beforeActing, `${scenario} beforeActing mismatch`);
  if (expected.beforeActing !== undefined) {
    assert(set.beforeActing === DECISION_SET_UNRESOLVED_NEXT_STEP, `${scenario} beforeActing is not the frozen literal`);
  }
  assert(set.total === Object.keys(expected.members).length, `${scenario} set total ${set.total}`);
  assert(set.returned === set.members.length && set.truncated === false, `${scenario} set truncation`);
  assert(JSON.stringify(set.recordedTransitions) === JSON.stringify(expected.recordedTransitions),
    `${scenario} recorded transitions ${JSON.stringify(set.recordedTransitions)}`);
  const lifecycles = Object.fromEntries(set.members.map((member) => [member.id, member.lifecycle]));
  const wanted = Object.fromEntries(Object.entries(expected.members).sort());
  assert(JSON.stringify(Object.fromEntries(Object.entries(lifecycles).sort())) === JSON.stringify(wanted),
    `${scenario} set members ${JSON.stringify(lifecycles)}`);
  for (const [id, lifecycle] of Object.entries(expected.members)) {
    const row = store.getDecision(id);
    assert(row !== undefined && row.status === lifecycle, `${scenario} ${id} stored lifecycle`);
    // Members carry the text needed to quote a rule and cite it, bounded and flagged.
    const member = set.members.find((row) => row.id === id)!;
    assert(member.summary === row.summary, `${scenario} ${id} member summary is not the stored summary`);
    if (row.rationale !== undefined) {
      assert(member.rationale === row.rationale && member.rationaleTruncated === undefined,
        `${scenario} ${id} member rationale`);
    }
    assert(member.provenance.createdBy.actorId === row.createdBy.actorId
      && member.provenance.agentSessionId === row.agentSessionId, `${scenario} ${id} member provenance`);
  }
  // The set is grouped for safety, not ranked: paging the sections cannot change it.
  const paged = service.recallWorkspace(ctx, { workspaceId, query: QUERIES[scenario], limit: 1 });
  assert(JSON.stringify(paged.decisionSet?.members.map((row) => row.id)) === JSON.stringify(set.members.map((row) => row.id)),
    `${scenario} decision set changed under limit=1`);
  assert(paged.decisionSet?.state === set.state, `${scenario} decision set state changed under limit=1`);
  return set;
}

function verifyScenario(service: CampfireService, store: ReturnType<typeof openSqliteStore>, scenario: "s1" | "s2" | "s3"):
  Record<string, unknown> {
  const workspaceId = `ws_rcl003_${scenario}`;
  const owner = human(`hum_rcl003_${scenario}`);
  const expectedAccepted = scenario === "s3" ? 9 : 12;
  const orientation = service.getWorkspaceContext(owner, workspaceId);
  const decisions = store.listDecisions(workspaceId);
  const acceptedRows = decisions.filter((row) => row.status === "accepted");
  const proposalRows = decisions.filter((row) => row.status === "proposed");
  assert(acceptedRows.length === expectedAccepted, `${scenario} accepted count ${acceptedRows.length}`);
  assert(proposalRows.length === 1, `${scenario} proposal count`);
  const expectedTotal = scenario === "s3" ? 10 : 13;
  assert(orientation.slices.decisions.total === expectedTotal, `${scenario} orientation total`);
  assert(orientation.slices.decisions.returned === 10, `${scenario} orientation returned`);
  assert(orientation.slices.decisions.truncated === (scenario !== "s3"), `${scenario} orientation truncation`);
  const proposalId = `dec_rcl003_${scenario}_proposed`;
  assert(orientation.slices.decisions.items.some((row) => row.id === proposalId), `${scenario} proposal absent from orientation`);
  const findingId = scenario === "s3" ? "find_rcl003_s3_current" : `find_rcl003_${scenario}_current`;
  assert(orientation.slices.findings.items.some((row) => row.id === findingId), `${scenario} current finding absent`);
  const currentFinding = store.getFinding(findingId);
  assert(currentFinding?.currentness === "current" && currentFinding.createdBy.actorId === `agt_rcl003_${scenario}`,
    `${scenario} current finding lifecycle or author`);
  assert(currentFinding.agentSessionId === (scenario === "s2" || scenario === "s3"
    ? `ses_rcl003_${scenario}_a`
    : "ses_rcl003_s1_b"), `${scenario} current finding session`);
  const keyedTask = store.getTask(`task_rcl003_${scenario}_open`);
  assert(keyedTask?.status === "open" && keyedTask.createdBy.actorId === `hum_rcl003_${scenario}`
    && keyedTask.agentSessionId === undefined, `${scenario} keyed task status or provenance`);
  assert(orientation.slices.tasks.items.some((row) => row.id === `task_rcl003_${scenario}_open`),
    `${scenario} keyed open task absent`);
  const reader = store.listParticipants(workspaceId).find((row) => row.actor.actorId === READER.actorId);
  assert(reader?.role === "viewer", `${scenario} reader membership`);
  const page = service.listDecisionsPage(owner, { workspaceId });
  assert(page.items.length === 10, `${scenario} default decisions count`);
  for (const id of OFF_PAGE[scenario]) {
    assert(!orientation.slices.decisions.items.some((row) => row.id === id), `${scenario} ${id} on the orientation page`);
    assert(!page.items.some((row) => row.id === id), `${scenario} ${id} on the first decision page`);
    assert(!orientation.slices.recentChanges.items.some((row) => JSON.stringify(row).includes(id)),
      `${scenario} ${id} in recent changes`);
    assert(!orientation.provenanceSummary.some((summary) => summary.includes(id)), `${scenario} ${id} in provenance`);
  }

  const set = assertDecisionSet(service, store, scenario, owner, workspaceId);
  const recall = service.recallWorkspace(owner, { workspaceId, query: QUERIES[scenario] });
  assert(!/(?:https?:\/\/|file:\/\/|\/Users\/|\/private\/|\/tmp\/)/.test(JSON.stringify(recall)), `${scenario} recall contains a path`);
  assert(!JSON.stringify(recall).includes("uriOrPath"), `${scenario} recall contains an artifact uri field`);
  for (const member of set.members) {
    assert(recall.current.items.some((hit) => hit.id === member.id)
      || recall.historical.items.some((hit) => hit.id === member.id), `${scenario} ${member.id} absent from recall sections`);
  }

  if (scenario !== "s3") {
    const absence = ABSENCE[scenario];
    const orientationJson = JSON.stringify(orientation);
    assert(!orientationJson.includes(absence), `${scenario} absence string leaked into orientation`);
    assert(!JSON.stringify(page).includes(absence), `${scenario} absence string leaked into the first decision page`);
    // The off-page property, stated as a count rather than as a timestamp
    // comparison. `list_decisions` and orientation both rank accepted
    // decisions by `updated_at DESC, id ASC`, so a keyed decision with at least
    // ten strictly newer accepted decisions cannot appear on either first page.
    // Equal timestamps are not sufficient: a tie sorts by id ascending.
    const oldestFillerAt = decisions
      .filter((row) => row.id.startsWith(`dec_rcl003_${scenario}_fill_`))
      .map((row) => row.updatedAt)
      .sort()[0]!;
    for (const id of OFF_PAGE[scenario]) {
      const row = store.getDecision(id);
      assert(row !== undefined, `${scenario} ${id} is missing`);
      assert(row.updatedAt < oldestFillerAt, `${scenario} ${id} is not strictly earlier than every filler`);
      const newerAccepted = acceptedRows.filter((other) => other.updatedAt > row.updatedAt).length;
      assert(newerAccepted >= 10, `${scenario} ${id} has only ${newerAccepted} newer accepted decisions`);
      assert(store.listDecisionCitations([id]).map((row) => row.findingId).join() === findingId, `${scenario} ${id} basis`);
      assert(recall.current.items.some((hit) => hit.id === id) || recall.historical.items.some((hit) => hit.id === id),
        `${scenario} recall missed ${id}`);
      const member = set.members.find((row) => row.id === id)!;
      if (id === ABSENCE_OWNER[scenario]) {
        assert(member.rationale?.includes(absence) === true, `${scenario} ${id} member lacks the absence string`);
      }
      const author = KEYED_PROVENANCE[id]!;
      assert(row.createdBy.actorId === author.actorId && row.agentSessionId === author.session,
        `${scenario} ${id} provenance`);
    }
  }

  const packet = service.projectHandoffPacket(owner, { workspaceId, query: QUERIES[scenario], recipient: READER });
  const packetText = JSON.stringify(packet);
  assert(!packetText.includes("cft_") && !packetText.includes(REPO_ROOT), `${scenario} packet credential or path`);
  assert(!packetText.includes('"uriOrPath"')
    && !/(?:https?:\/\/|file:\/\/|\/Users\/|\/private\/|\/tmp\/)/.test(packetText),
    `${scenario} packet contains URI or filesystem path`);
  assert(packet.recipient.actorId === READER.actorId && packet.recipient.actorType === "human", `${scenario} recipient`);
  assert(packet.decisionSet?.state === set.state, `${scenario} packet set state`);
  assert(packet.decisionSet?.operativeDecisionId === set.operativeDecisionId, `${scenario} packet operative id`);
  assert(packet.decisionSet?.beforeActing === set.beforeActing, `${scenario} packet beforeActing`);
  assert(JSON.stringify(packet.decisionSet?.recordedTransitions) === JSON.stringify(set.recordedTransitions),
    `${scenario} packet transitions`);
  const packetMembers = packet.decisionSet?.members ?? [];
  assert(packetMembers.length === set.members.length
    && packetMembers.every((row) => row.section === "decision-set" && row.kind === "decision"),
  `${scenario} packet set members`);
  for (const member of set.members) {
    const record = packetMembers.find((row) => row.id === member.id);
    assert(record?.lifecycle === member.lifecycle && record.text === member.summary, `${scenario} packet member ${member.id}`);
  }

  if (scenario === "s1") {
    const fixed = store.getDecision("dec_rcl003_s1_fixed");
    const rolling = store.getDecision("dec_rcl003_s1_rolling");
    assert(fixed?.status === "accepted" && rolling?.status === "accepted", "s1 keyed decisions not accepted");
    assert(fixed?.summary.includes(ABSENCE.s1) === false && fixed?.rationale?.includes(ABSENCE.s1) === true,
      "s1 absence string placement");
    assert(fixed.predecessorId === undefined && fixed.successorId === undefined
      && rolling.predecessorId === undefined && rolling.successorId === undefined, "s1 keyed decisions are linked");
    assert(service.getDecisionInWorkspace(owner, workspaceId, "dec_rcl003_s1_fixed").needsReview === undefined
      && service.getDecisionInWorkspace(owner, workspaceId, "dec_rcl003_s1_rolling").needsReview === undefined,
    "s1 needsReview is set on a keyed decision");
    const stale = store.getFinding("find_rcl003_s1_stale");
    assert(stale?.currentness === "superseded" && stale.successorId === findingId
      && currentFinding.predecessorId === stale.id && stale.agentSessionId === "ses_rcl003_s1_a",
      "s1 correction chain");
    const proposal = store.getDecision(proposalId);
    assert(proposal?.status === "proposed" && proposal.agentSessionId === "ses_rcl003_s1_b",
      "s1 proposal provenance");
    assert(!packet.anchors.acceptedDecisions.some((row) => row.id === "dec_rcl003_s1_fixed"), "s1 fixed decision in anchors");
    assert(packet.completeness.anchors.acceptedDecisions.total === 12
      && packet.completeness.anchors.acceptedDecisions.returned === 10
      && packet.completeness.anchors.acceptedDecisions.truncated, "s1 anchor completeness");
  }
  if (scenario === "s2") {
    const predecessor = store.getDecision("dec_rcl003_s2_predecessor");
    const replacement = store.getDecision("dec_rcl003_s2_replacement");
    assert(predecessor?.status === "superseded" && predecessor.successorId === "dec_rcl003_s2_replacement",
      "s2 predecessor is not superseded by the replacement");
    assert(replacement?.status === "accepted" && replacement.predecessorId === "dec_rcl003_s2_predecessor",
      "s2 replacement does not name its predecessor");
    assert(replacement.createdBy.actorId === "agt_rcl003_s2" && replacement.agentSessionId === "ses_rcl003_s2_a",
      "s2 replacement provenance");
    assert(predecessor.createdBy.actorId === "hum_rcl003_s2" && predecessor.agentSessionId === undefined,
      "s2 predecessor provenance");
    assert(service.getDecisionInWorkspace(owner, workspaceId, "dec_rcl003_s2_replacement").needsReview === undefined,
      "s2 replacement is needsReview");
    // Neither keyed row survives the unassisted control view. The survivor is
    // not on the orientation page, not on the default decision page, and not in
    // the packet's accepted anchors; the predecessor is not on either page.
    assert(!orientation.slices.decisions.items.some((row) => row.id === "dec_rcl003_s2_replacement"),
      "s2 survivor is on the orientation page");
    assert(!orientation.slices.decisions.items.some((row) => row.id === "dec_rcl003_s2_predecessor"),
      "s2 predecessor is on the orientation decision page");
    assert(!page.items.some((row) => row.id === "dec_rcl003_s2_replacement"), "s2 survivor is on the first decision page");
    assert(!page.items.some((row) => row.id === "dec_rcl003_s2_predecessor"), "s2 predecessor is on the first decision page");
    assert(!packet.anchors.acceptedDecisions.some((row) => row.id === "dec_rcl003_s2_replacement"),
      "s2 survivor is in the accepted anchors");
    assert(packet.completeness.anchors.acceptedDecisions.total === 12
      && packet.completeness.anchors.acceptedDecisions.returned === 10
      && packet.completeness.anchors.acceptedDecisions.truncated, "s2 anchor completeness");
    // The set still resolves: both rows are in it, linked, and the survivor governs.
    const setIds = set.members.map((member) => member.id);
    assert(setIds.includes("dec_rcl003_s2_predecessor") && setIds.includes("dec_rcl003_s2_replacement"),
      "s2 keyed pair is missing from the decision set");
    assert(packet.records.some((row) => row.id === "dec_rcl003_s2_replacement" && row.lifecycle === "accepted"),
      "s2 survivor absent from packet records");
    const record = packet.records.find((row) => row.id === "dec_rcl003_s2_predecessor")
      ?? packet.decisionSet?.members.find((row) => row.id === "dec_rcl003_s2_predecessor");
    assert(record?.rationale?.includes(ABSENCE.s2) === true, "s2 packet lost the predecessor rationale");
  }
  if (scenario === "s3") {
    assert(orientation.slices.decisions.total === 10, "s3 ten decisions");
    assert(acceptedRows.every((row) => !/(?:fifty|50 rows|rows per run|batch cap)/i.test(`${row.summary} ${row.rationale ?? ""}`)),
      "s3 an accepted decision states a cap");
    assert(packet.records.some((row) => row.id === proposalId && row.lifecycle === "proposed"), "s3 proposal packet status");
    const proposal = store.getDecision(proposalId);
    assert(proposal?.status === "proposed" && proposal.agentSessionId === "ses_rcl003_s3_a"
      && proposal.rationale === "This is a suggestion, not an accepted cap.", "s3 proposal provenance or rationale");
  }
  return {
    accepted: acceptedRows.length,
    proposed: proposalRows.length,
    orientationDecisions: {
      total: orientation.slices.decisions.total,
      returned: orientation.slices.decisions.returned,
      truncated: orientation.slices.decisions.truncated,
    },
    decisionSet: {
      state: set.state,
      total: set.total,
      returned: set.returned,
      truncated: set.truncated,
      members: set.members.map((member) => ({ id: member.id, lifecycle: member.lifecycle })),
      recordedTransitions: set.recordedTransitions,
      operativeDecisionId: set.operativeDecisionId,
      beforeActing: set.beforeActing !== undefined,
    },
    recallCurrentIds: recall.current.items.map((hit) => hit.id),
    recallHistoricalIds: recall.historical.items.map((hit) => hit.id),
    packetDecisionSetState: packet.decisionSet?.state,
  };
}

function seedAt(databasePath: string): { tokens: { s1: string; s2: string; s3: string }; receipt: SeedReceipt } {
  const queued = queueSource();
  const store = openSqliteStore(databasePath);
  const service = createCampfireService({ store, idSource: queued.source, clock: clock() });
  try {
    const now = "2026-10-11T15:00:00.000Z";
    store.createOrganization({ id: "org_rcl003", name: "RCL-003 fixture", createdAt: now });
    store.createTeam({ id: "team_rcl003", organizationId: "org_rcl003", name: "RCL-003 fixture", createdAt: now });
    const s1 = service.createHuman(undefined, { teamId: "team_rcl003", displayName: "S1 owner" });
    const s2 = service.createHuman(human(s1.human.id), { teamId: "team_rcl003", displayName: "S2 owner" });
    const s3 = service.createHuman(human(s1.human.id), { teamId: "team_rcl003", displayName: "S3 owner" });
    service.createHuman(human(s1.human.id), { teamId: "team_rcl003", displayName: "RCL reader" });
    seedS1(service, human(s1.human.id));
    seedS2(service, human(s2.human.id));
    seedS3(service, human(s3.human.id));
    queued.assertEmpty();
    for (const scenario of ["s1", "s2", "s3"] as const) {
      const fixtureAgent = store.getAgent(`agt_rcl003_${scenario}`);
      assert(fixtureAgent?.harness === "fixture" && fixtureAgent.model === undefined, `${scenario} agent provenance`);
    }
    const receipt: SeedReceipt = {
      reader: READER.actorId,
      workspaces: {
        s1: verifyScenario(service, store, "s1"),
        s2: verifyScenario(service, store, "s2"),
        s3: verifyScenario(service, store, "s3"),
      },
    };
    return { tokens: { s1: s1.token, s2: s2.token, s3: s3.token }, receipt };
  } finally {
    service.close();
  }
}

function assertOutsideRepo(path: string): void {
  const resolved = resolve(path);
  const rel = relative(REPO_ROOT, resolved);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) fail(`refusing to write inside the repository: ${path}`);
  // A lexical outside path can lead back into the checkout through a symlink.
  // Inspect every existing ancestor before mkdir or removing an old seed.
  for (let cursor = resolved; ; cursor = dirname(cursor)) {
    let found;
    try {
      found = lstatSync(cursor);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (found?.isSymbolicLink()) fail(`refusing symlinked output path: ${cursor}`);
    if (dirname(cursor) === cursor) break;
  }
}

export interface SeedResult {
  databasePath: string;
  tokenPath: string;
  receiptPath: string;
  tokens: { s1: string; s2: string; s3: string };
}

export function seedDatabase(outDir: string, force: boolean): SeedResult {
  assertOutsideRepo(outDir);
  const databasePath = resolve(outDir, "campfire.db");
  const tokenPath = resolve(outDir, "tokens.json");
  const receiptPath = resolve(outDir, "receipt.json");
  if (!force && [databasePath, tokenPath, receiptPath].some(existsSync)) {
    fail(`seed already exists at ${outDir}; pass --force to replace it`);
  }
  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  for (const path of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`, tokenPath, receiptPath]) {
    if (existsSync(path)) rmSync(path);
  }
  const seeded = seedAt(databasePath);
  const check = openReadonlySqliteStore(databasePath);
  try {
    assert(check.getWorkspace("ws_rcl003_s1") !== undefined, "database did not persist");
  } finally {
    check.close();
  }
  writeFileSync(tokenPath, `${JSON.stringify(seeded.tokens)}\n`, { mode: 0o600 });
  writeFileSync(receiptPath, `${JSON.stringify({ databasePath, ...seeded.receipt }, null, 2)}\n`, { mode: 0o600 });
  assert((statSync(tokenPath).mode & 0o777) === 0o600, "token mode");
  assert((statSync(receiptPath).mode & 0o777) === 0o600, "receipt mode");
  assert(JSON.stringify(seeded.receipt).includes("cft_") === false, "receipt contains token");
  return { databasePath, tokenPath, receiptPath, tokens: seeded.tokens };
}

function parseArgs(argv: string[]): { out: string; force: boolean } {
  let out = DEFAULT_OUT;
  let force = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--force") { force = true; continue; }
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
  process.stdout.write(`seeded ${result.databasePath}\nreceipt ${result.receiptPath}\n`);
}