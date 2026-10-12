/**
 * Repeatable RCL-002 fixture. Never mount this file or its answer key into an
 * agent arm. The real service creates every record; a queued IdSource pins the
 * ids named in the frozen key. Output stays outside the checkout.
 *
 *   npx tsx fixtures/recall/rcl-002/seed.ts [--out <dir>] [--force]
 */
import { existsSync, lstatSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createId, type IdKind, type IdSource } from "../../../src/domain/ids.js";
import type { ActorRef } from "../../../src/domain/types.js";
import { createCampfireService } from "../../../src/service/campfire-service.js";
import type { ActorContext } from "../../../src/service/authorization.js";
import type { CampfireService } from "../../../src/service/service.js";
import { openReadonlySqliteStore, openSqliteStore } from "../../../src/store/sqlite-store.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const DEFAULT_OUT = resolve(homedir(), ".campfire-pilot/rcl-002/seed");
const READER: ActorRef = { actorId: "hum_rcl002_reader", actorType: "human" };
const REASON = "recorded correction";
const QUERIES = { s1: "partner callback", s2: "checkout retry", s3: "partner callback limit" } as const;

const PLANNED: Partial<Record<IdKind, string[]>> = {
  human: ["hum_rcl002_s1", "hum_rcl002_s2", "hum_rcl002_s3", READER.actorId],
  agent: ["agt_rcl002_s1", "agt_rcl002_s2", "agt_rcl002_s3"],
  workspace: ["ws_rcl002_s1", "ws_rcl002_s2", "ws_rcl002_s3"],
  goal: ["goal_rcl002_s1", "goal_rcl002_s2", "goal_rcl002_s3"],
  task: [
    "task_rcl002_s1_open", ...housekeepingIds("s1"),
    "task_rcl002_s2_open", ...housekeepingIds("s2"),
    "task_rcl002_s3_open",
  ],
  finding: [
    "find_rcl002_s1_stale", "find_rcl002_s1_current",
    "find_rcl002_s2_stale", "find_rcl002_s2_current",
    "find_rcl002_s3_current",
  ],
  decision: [
    "dec_rcl002_s1_proposed", "dec_rcl002_s1_accepted",
    ...fillerIds("s1", 10),
    "dec_rcl002_s2_accepted", ...fillerIds("s2", 9),
    "dec_rcl002_s2_review", "dec_rcl002_s2_proposed",
    "dec_rcl002_s3_proposed", ...fillerIds("s3", 9),
  ],
  agentSession: [
    "ses_rcl002_s1_a", "ses_rcl002_s1_b",
    "ses_rcl002_s2_a", "ses_rcl002_s2_b", "ses_rcl002_s3",
  ],
};

function fillerIds(scenario: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `dec_rcl002_${scenario}_fill_${String(index + 1).padStart(2, "0")}`);
}

function housekeepingIds(scenario: string): string[] {
  return Array.from({ length: 11 }, (_, index) => `task_rcl002_${scenario}_house_${String(index + 1).padStart(2, "0")}`);
}

function fail(message: string): never {
  throw new Error(`rcl-002 seed: ${message}`);
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
    teamId: "team_rcl002", humanId: owner.actor.actorId, name: `${scenario} fixture`, harness: "fixture",
  });
  const workspace = service.createWorkspace(owner, { teamId: "team_rcl002", name: `RCL-002 ${scenario}` });
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

function fill(service: CampfireService, owner: ActorContext, workspaceId: string, count: number): void {
  for (let index = 1; index <= count; index += 1) {
    accepted(service, owner, workspaceId, `Maintain service window ${String(index).padStart(2, "0")}.`,
      `Keep the ordinary service window ${String(index).padStart(2, "0")} documented.`);
  }
}

/** Later completed work supplies enough high-materiality rows to bury the
 * keyed old decision beyond the first recentChanges and provenance slices. */
function buryOldContribution(service: CampfireService, owner: ActorContext, workspaceId: string): void {
  for (let index = 1; index <= 11; index += 1) {
    const task = service.createTask(owner, {
      workspaceId,
      title: `Close routine maintenance item ${String(index).padStart(2, "0")}.`,
    });
    service.updateTask(owner, { taskId: task.id, status: "completed" });
  }
}

function seedS1(service: CampfireService, owner: ActorContext): void {
  const { workspaceId, agentId } = setup(service, owner, "s1", "Ship the partner callback.", "Choose partner callback authentication.");
  const first = session(service, agentId, workspaceId);
  service.addFinding(first, { workspaceId, summary: "A query-string API key authenticated the partner callback." });
  service.addDecision(first, { workspaceId, summary: "Authenticate partner callbacks with a query-string bearer token." });
  const second = session(service, agentId, workspaceId);
  service.correctFinding(second, {
    findingId: "find_rcl002_s1_stale", summary: "Partner callbacks without a body signature were rejected.", reason: REASON,
  });
  const old = accepted(service, owner, workspaceId,
    "Authenticate partner callbacks with an HMAC of the raw body.",
    "Sign the raw body, and accept the previous secret for twenty-four hours during rotation.");
  service.citeDecisionBasis(owner, { decisionId: old, findingId: "find_rcl002_s1_current" });
  fill(service, owner, workspaceId, 10);
  buryOldContribution(service, owner, workspaceId);
}

function seedS2(service: CampfireService, owner: ActorContext): void {
  const { workspaceId, agentId } = setup(service, owner, "s2", "Stabilize checkout.", "Set the checkout retry policy.");
  const first = session(service, agentId, workspaceId);
  service.addFinding(first, { workspaceId, summary: "The checkout retry failures were timeouts." });
  const second = session(service, agentId, workspaceId);
  service.correctFinding(second, {
    findingId: "find_rcl002_s2_stale", summary: "The checkout retry created duplicate charges.", reason: REASON,
  });
  const old = accepted(service, owner, workspaceId,
    "Reuse the existing checkout attempt id on checkout retry.",
    "The next checkout retry sends that same attempt id and does not open a second charge.");
  service.citeDecisionBasis(owner, { decisionId: old, findingId: "find_rcl002_s2_current" });
  fill(service, owner, workspaceId, 9);
  // The agent's first session owns this later record. It cites the stale
  // finding, remains accepted, and is intentionally not linked to the older one.
  const review = accepted(service, first, workspaceId,
    "Use a checkout retry without a charge guard.",
    "The earlier timeouts did not require a charge guard.");
  service.citeDecisionBasis(first, { decisionId: review, findingId: "find_rcl002_s2_stale" });
  service.addDecision(first, {
    workspaceId, summary: "Publish the checkout status page weekly.",
  });
  buryOldContribution(service, owner, workspaceId);
}

function seedS3(service: CampfireService, owner: ActorContext): void {
  const { workspaceId, agentId } = setup(service, owner, "s3", "Operate the partner callback.", "Confirm the partner callback limit.");
  const acting = session(service, agentId, workspaceId);
  service.addFinding(acting, { workspaceId, summary: "The partner callback limit path responded in under two seconds." });
  service.addDecision(acting, {
    workspaceId, summary: "Set the partner callback limit to one hundred requests per second.",
    rationale: "This is a suggestion, not an accepted limit.",
  });
  fill(service, owner, workspaceId, 9);
}

type SeedReceipt = { workspaces: Record<string, unknown>; reader: string };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function verifyScenario(service: CampfireService, store: ReturnType<typeof openSqliteStore>, scenario: "s1" | "s2" | "s3"):
  Record<string, unknown> {
  const workspaceId = `ws_rcl002_${scenario}`;
  const owner = human(`hum_rcl002_${scenario}`);
  const oldId = scenario === "s1" ? "dec_rcl002_s1_accepted" : "dec_rcl002_s2_accepted";
  const orientation = service.getWorkspaceContext(owner, workspaceId);
  const decisions = store.listDecisions(workspaceId);
  const acceptedRows = decisions.filter((row) => row.status === "accepted");
  const proposalRows = decisions.filter((row) => row.status === "proposed");
  assert(acceptedRows.length === (scenario === "s3" ? 9 : 11), `${scenario} accepted count`);
  assert(proposalRows.length === 1, `${scenario} proposal count`);
  assert(orientation.slices.decisions.total === decisions.length, `${scenario} orientation total`);
  assert(orientation.slices.decisions.returned === 10, `${scenario} orientation returned`);
  assert(orientation.slices.decisions.truncated === (scenario !== "s3"), `${scenario} orientation truncation`);
  const proposalId = `dec_rcl002_${scenario}_proposed`;
  assert(orientation.slices.decisions.items.some((row) => row.id === proposalId), `${scenario} proposal absent`);
  const findingId = `find_rcl002_${scenario}_current`;
  assert(orientation.slices.findings.items.some((row) => row.id === findingId), `${scenario} current finding absent`);
  const currentFinding = store.getFinding(findingId);
  assert(currentFinding?.currentness === "current" && currentFinding.createdBy.actorId === `agt_rcl002_${scenario}`,
    `${scenario} current finding lifecycle or author`);
  assert(currentFinding.agentSessionId === (scenario === "s3" ? "ses_rcl002_s3" : `ses_rcl002_${scenario}_b`),
    `${scenario} current finding session`);
  const keyedTask = store.getTask(`task_rcl002_${scenario}_open`);
  assert(keyedTask?.status === "open" && keyedTask.createdBy.actorId === `hum_rcl002_${scenario}`
    && keyedTask.agentSessionId === undefined, `${scenario} keyed task status or provenance`);
  assert(orientation.slices.tasks.items.some((row) => row.id === `task_rcl002_${scenario}_open`),
    `${scenario} keyed open task absent`);
  const reader = store.listParticipants(workspaceId).find((row) => row.actor.actorId === READER.actorId);
  assert(reader?.role === "viewer", `${scenario} reader membership`);
  const page = service.listDecisionsPage(owner, { workspaceId });
  assert(page.items.length === 10, `${scenario} default decisions count`);
  const recall = service.recallWorkspace(owner, { workspaceId, query: QUERIES[scenario] });
  assert(!JSON.stringify(recall).includes('"rationale"'), `${scenario} live recall contains rationale`);
  const packet = service.projectHandoffPacket(owner, { workspaceId, query: QUERIES[scenario], recipient: READER });
  const packetText = JSON.stringify(packet);
  assert(!packetText.includes("cft_") && !packetText.includes(REPO_ROOT), `${scenario} packet credential or path`);
  assert(!packetText.includes('"uriOrPath"') && !/(?:https?:\/\/|file:\/\/|\/Users\/|\/private\/|\/tmp\/|[A-Za-z]:\\\\)/.test(packetText),
    `${scenario} packet contains URI or filesystem path`);
  assert(packet.recipient.actorId === READER.actorId && packet.recipient.actorType === "human", `${scenario} recipient`);

  if (scenario !== "s3") {
    const older = store.getDecision(oldId);
    assert(older?.status === "accepted", `${scenario} older not accepted`);
    assert(acceptedRows.filter((row) => row.id !== oldId).every((row) => row.updatedAt > older.updatedAt),
      `${scenario} older timestamp not strictly earlier`);
    assert(!orientation.slices.decisions.items.some((row) => row.id === oldId), `${scenario} older on orientation`);
    assert(!page.items.some((row) => row.id === oldId), `${scenario} older on first decision page`);
    assert(!orientation.slices.recentChanges.items.some((row) => JSON.stringify(row).includes(oldId)), `${scenario} older in recent changes`);
    assert(!orientation.provenanceSummary.some((summary) => summary.includes(oldId)), `${scenario} older in provenance`);
    const absence = scenario === "s1" ? "twenty-four" : "attempt id";
    assert(!JSON.stringify(orientation).includes(absence), `${scenario} absence string leaked into orientation`);
    assert(recall.current.items.some((hit) => hit.id === oldId), `${scenario} recall missed older decision`);
    const record = packet.records.find((row) => row.id === oldId);
    assert(record?.lifecycle === "accepted" && record.rationale?.includes(absence), `${scenario} packet missed older rationale`);
    assert(older.createdBy.actorId === `hum_rcl002_${scenario}` && older.agentSessionId === undefined,
      `${scenario} old decision provenance`);
    assert(store.listDecisionCitations([oldId]).map((row) => row.findingId).join() === findingId,
      `${scenario} old decision basis`);
    const stale = store.getFinding(`find_rcl002_${scenario}_stale`);
    assert(stale?.currentness === "superseded" && stale.successorId === findingId
      && currentFinding.predecessorId === stale.id && stale.agentSessionId === `ses_rcl002_${scenario}_a`,
      `${scenario} correction chain`);
    assert(!packet.anchors.acceptedDecisions.some((row) => row.id === oldId), `${scenario} older in accepted anchors`);
    assert(packet.completeness.anchors.acceptedDecisions.total === 11
      && packet.completeness.anchors.acceptedDecisions.returned === 10
      && packet.completeness.anchors.acceptedDecisions.truncated, `${scenario} anchor completeness`);
    assert(orientation.slices.decisions.total === 12, `${scenario} twelve decisions`);
    if (scenario === "s2") {
      const newer = store.getDecision("dec_rcl002_s2_review");
      assert(newer?.status === "accepted" && newer.needsReview === undefined, "s2 raw review row");
      const decorated = service.getDecisionInWorkspace(owner, workspaceId, newer.id);
      assert(decorated.needsReview === true, "s2 review marker");
      assert(newer.createdBy.actorId === "agt_rcl002_s2" && newer.agentSessionId === "ses_rcl002_s2_a",
        "s2 review provenance");
      assert(store.listDecisionCitations([newer.id]).map((row) => row.findingId).join() === stale.id,
        "s2 review stale basis");
      assert(older.predecessorId === undefined && older.successorId === undefined
        && newer.predecessorId === undefined && newer.successorId === undefined, "s2 decisions linked");
      assert(packet.records.some((row) => row.id === newer.id && row.lifecycle === "accepted"), "s2 review absent from packet");
    }
  } else {
    assert(orientation.slices.decisions.total === 10, "s3 ten decisions");
    assert(acceptedRows.every((row) => !/\b(?:one hundred|100|requests per second)\b/i.test(row.summary)), "s3 numeric limit accepted");
    assert(packet.records.some((row) => row.id === proposalId && row.lifecycle === "proposed"), "s3 proposal packet status");
    const proposal = store.getDecision(proposalId);
    assert(proposal?.status === "proposed" && proposal.agentSessionId === "ses_rcl002_s3"
      && proposal.rationale === "This is a suggestion, not an accepted limit.", "s3 proposal provenance or rationale");
  }
  return {
    accepted: acceptedRows.length,
    proposed: proposalRows.length,
    orientationDecisions: {
      total: orientation.slices.decisions.total,
      returned: orientation.slices.decisions.returned,
      truncated: orientation.slices.decisions.truncated,
    },
    recallCurrentIds: recall.current.items.map((hit) => hit.id),
    packetRecordIds: packet.records.map((record) => record.id),
  };
}

function seedAt(databasePath: string): { tokens: { s1: string; s2: string; s3: string }; receipt: SeedReceipt } {
  const queued = queueSource();
  const store = openSqliteStore(databasePath);
  const service = createCampfireService({ store, idSource: queued.source, clock: clock() });
  try {
    const now = "2026-10-11T15:00:00.000Z";
    store.createOrganization({ id: "org_rcl002", name: "RCL-002 fixture", createdAt: now });
    store.createTeam({ id: "team_rcl002", organizationId: "org_rcl002", name: "RCL-002 fixture", createdAt: now });
    const s1 = service.createHuman(undefined, { teamId: "team_rcl002", displayName: "S1 owner" });
    const s2 = service.createHuman(human(s1.human.id), { teamId: "team_rcl002", displayName: "S2 owner" });
    const s3 = service.createHuman(human(s1.human.id), { teamId: "team_rcl002", displayName: "S3 owner" });
    service.createHuman(human(s1.human.id), { teamId: "team_rcl002", displayName: "RCL reader" });
    seedS1(service, human(s1.human.id));
    seedS2(service, human(s2.human.id));
    seedS3(service, human(s3.human.id));
    queued.assertEmpty();
    for (const scenario of ["s1", "s2", "s3"] as const) {
      const fixtureAgent = store.getAgent(`agt_rcl002_${scenario}`);
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
    assert(check.getWorkspace("ws_rcl002_s1") !== undefined, "database did not persist");
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
