/**
 * RCL-001 repeatable seed.
 *
 * Private. This file contains the seeded record text. Do not mount it, or this
 * directory, into an agent session. Ids come from an IdSource so the real
 * service still performs invites, sessions, corrections, citations, and accepts.
 *
 *   npx tsx fixtures/recall/rcl-001/seed.ts [--out <dir>] [--force]
 *
 * Writes a sqlite database and a token file outside the repository. The token
 * file is mode 0600. The receipt lists ids only.
 */
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
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
const DEFAULT_OUT = resolve(homedir(), ".campfire-pilot/rcl-001/seed");
const REASON = "recorded correction";

const PLANNED: Partial<Record<IdKind, string[]>> = {
  human: ["hum_rcl001_s1", "hum_rcl001_s2", "hum_rcl001_s3", "hum_rcl001_reader"],
  agent: ["agt_rcl001_s1", "agt_rcl001_s2", "agt_rcl001_s3"],
  workspace: ["ws_rcl001_s1", "ws_rcl001_s2", "ws_rcl001_s3"],
  goal: ["goal_rcl001_s1", "goal_rcl001_s2", "goal_rcl001_s3"],
  task: ["task_rcl001_s1_open", "task_rcl001_s2_open", "task_rcl001_s3_open"],
  finding: [
    "find_rcl001_s1_stale",
    "find_rcl001_s1_current",
    "find_rcl001_s2_stale",
    "find_rcl001_s2_current",
    "find_rcl001_s3_current",
  ],
  decision: [
    "dec_rcl001_s1_proposed",
    "dec_rcl001_s1_accepted",
    "dec_rcl001_s2_review",
    "dec_rcl001_s3_proposed",
  ],
  agentSession: [
    "ses_rcl001_s1_a",
    "ses_rcl001_s1_b",
    "ses_rcl001_s2_a",
    "ses_rcl001_s2_b",
    "ses_rcl001_s3",
  ],
};

const READER: ActorRef = { actorId: "hum_rcl001_reader", actorType: "human" };

function fail(message: string): never {
  throw new Error(`rcl-001 seed: ${message}`);
}

function queueSource(): IdSource {
  const planned: Partial<Record<IdKind, string[]>> = {};
  for (const [kind, ids] of Object.entries(PLANNED) as Array<[IdKind, string[]]>) {
    planned[kind] = [...ids];
  }
  let spare = 0;
  return (kind) => {
    const next = planned[kind]?.shift();
    if (next !== undefined) return next;
    spare += 1;
    return createId(kind, () => {
      const prefix = kind === "organization" ? "org" : kind.slice(0, 3);
      return `${prefix}_seed${String(spare).padStart(4, "0")}`;
    });
  };
}

function assertQueuesEmpty(source: IdSource): void {
  for (const kind of Object.keys(PLANNED) as IdKind[]) {
    const probe = source(kind);
    if (!probe.includes("_seed")) {
      fail(`unused planned ${kind} id ${probe}`);
    }
  }
}

function clock(): () => string {
  let current = Date.parse("2026-10-10T15:00:00.000Z");
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

function inviteReader(service: CampfireService, owner: ActorContext, workspaceId: string): void {
  service.inviteToWorkspace(owner, { workspaceId, actor: READER, role: "viewer" });
  service.joinWorkspace(human(READER.actorId), { workspaceId });
}

function inviteAgent(
  service: CampfireService,
  owner: ActorContext,
  workspaceId: string,
  agentId: string,
): void {
  const actor: ActorRef = { actorId: agentId, actorType: "agent" };
  service.inviteToWorkspace(owner, { workspaceId, actor, role: "agent" });
  service.joinWorkspace(agent(agentId), { workspaceId });
}

interface SeedResult {
  databasePath: string;
  tokenPath: string;
  receiptPath: string;
  tokens: { s1: string; s2: string; s3: string };
}

function seedAt(databasePath: string): { tokens: SeedResult["tokens"]; receipt: Record<string, unknown> } {
  const source = queueSource();
  const store = openSqliteStore(databasePath);
  const service = createCampfireService({ store, idSource: source, clock: clock() });
  const now = "2026-10-10T15:00:00.000Z";
  try {
    store.createOrganization({ id: "org_rcl001", name: "RCL fixture", createdAt: now });
    store.createTeam({ id: "team_rcl001", organizationId: "org_rcl001", name: "RCL fixture", createdAt: now });

    const s1 = service.createHuman(undefined, { teamId: "team_rcl001", displayName: "S1 owner" });
    const s2 = service.createHuman(human(s1.human.id), { teamId: "team_rcl001", displayName: "S2 owner" });
    const s3 = service.createHuman(human(s1.human.id), { teamId: "team_rcl001", displayName: "S3 owner" });
    service.createHuman(human(s1.human.id), { teamId: "team_rcl001", displayName: "RCL reader" });

    seedS1(service, human(s1.human.id));
    seedS2(service, human(s2.human.id));
    seedS3(service, human(s3.human.id));
    assertQueuesEmpty(source);
    const receipt = verify(service, store);
    return {
      tokens: { s1: s1.token, s2: s2.token, s3: s3.token },
      receipt,
    };
  } finally {
    service.close();
  }
}

function seedS1(service: CampfireService, owner: ActorContext): void {
  const created = service.createAgent(owner, {
    teamId: "team_rcl001",
    humanId: owner.actor.actorId,
    name: "S1 fixture",
    harness: "fixture",
  });
  const workspace = service.createWorkspace(owner, { teamId: "team_rcl001", name: "RCL S1" });
  service.createGoal(owner, { workspaceId: workspace.id, title: "Ship the partner callback." });
  service.createTask(owner, { workspaceId: workspace.id, title: "Choose partner callback authentication." });
  inviteAgent(service, owner, workspace.id, created.agent.id);
  inviteReader(service, owner, workspace.id);

  const sessionA = service.registerAgentSession(agent(created.agent.id), {
    agentId: created.agent.id,
    workspaceId: workspace.id,
    harness: "fixture",
  });
  const actingA = agent(created.agent.id, sessionA.id);
  service.addFinding(actingA, {
    workspaceId: workspace.id,
    summary: "A query-string API key authenticated the partner callback.",
  });
  service.addDecision(actingA, {
    workspaceId: workspace.id,
    summary: "Authenticate partner callbacks with a query-string bearer token.",
  });

  const sessionB = service.registerAgentSession(agent(created.agent.id), {
    agentId: created.agent.id,
    workspaceId: workspace.id,
    harness: "fixture",
  });
  service.correctFinding(agent(created.agent.id, sessionB.id), {
    findingId: "find_rcl001_s1_stale",
    summary: "Partner callbacks without a body signature were rejected.",
    reason: REASON,
  });
  const accepted = service.addDecision(owner, {
    workspaceId: workspace.id,
    summary: "Authenticate partner callbacks with an HMAC of the raw body.",
    rationale:
      "do not put a bearer token in the query string; sign the raw body, and accept the previous secret for twenty-four hours during rotation.",
  });
  service.acceptDecision(owner, accepted.id);
  service.citeDecisionBasis(owner, { decisionId: accepted.id, findingId: "find_rcl001_s1_current" });
}

function seedS2(service: CampfireService, owner: ActorContext): void {
  const created = service.createAgent(owner, {
    teamId: "team_rcl001",
    humanId: owner.actor.actorId,
    name: "S2 fixture",
    harness: "fixture",
  });
  const workspace = service.createWorkspace(owner, { teamId: "team_rcl001", name: "RCL S2" });
  service.createGoal(owner, { workspaceId: workspace.id, title: "Stabilize checkout." });
  service.createTask(owner, { workspaceId: workspace.id, title: "Set the checkout retry policy." });
  inviteAgent(service, owner, workspace.id, created.agent.id);
  inviteReader(service, owner, workspace.id);

  const sessionA = service.registerAgentSession(agent(created.agent.id), {
    agentId: created.agent.id,
    workspaceId: workspace.id,
    harness: "fixture",
  });
  service.addFinding(agent(created.agent.id, sessionA.id), {
    workspaceId: workspace.id,
    summary: "The checkout retry should run without an idempotency key because the failures were timeouts.",
  });
  const sessionB = service.registerAgentSession(agent(created.agent.id), {
    agentId: created.agent.id,
    workspaceId: workspace.id,
    harness: "fixture",
  });
  service.correctFinding(agent(created.agent.id, sessionB.id), {
    findingId: "find_rcl001_s2_stale",
    summary: "The checkout retry without an idempotency key created duplicate charges.",
    reason: REASON,
  });
  const decision = service.addDecision(owner, {
    workspaceId: workspace.id,
    summary: "Use a checkout retry without an idempotency key.",
  });
  service.acceptDecision(owner, decision.id);
  service.citeDecisionBasis(owner, { decisionId: decision.id, findingId: "find_rcl001_s2_stale" });
}

function seedS3(service: CampfireService, owner: ActorContext): void {
  const created = service.createAgent(owner, {
    teamId: "team_rcl001",
    humanId: owner.actor.actorId,
    name: "S3 fixture",
    harness: "fixture",
  });
  const workspace = service.createWorkspace(owner, { teamId: "team_rcl001", name: "RCL S3" });
  service.createGoal(owner, { workspaceId: workspace.id, title: "Operate the partner callback." });
  service.createTask(owner, { workspaceId: workspace.id, title: "Confirm the partner callback limit." });
  inviteAgent(service, owner, workspace.id, created.agent.id);
  inviteReader(service, owner, workspace.id);

  const session = service.registerAgentSession(agent(created.agent.id), {
    agentId: created.agent.id,
    workspaceId: workspace.id,
    harness: "fixture",
  });
  const acting = agent(created.agent.id, session.id);
  service.addFinding(acting, {
    workspaceId: workspace.id,
    summary: "The partner callback limit path responded in under two seconds.",
  });
  service.addDecision(acting, {
    workspaceId: workspace.id,
    summary: "Set the partner callback limit to one hundred requests per second.",
  });
}

function idsOf(items: Array<{ id: string }>): string[] {
  return items.map((item) => item.id).sort();
}

function verify(service: CampfireService, store: ReturnType<typeof openSqliteStore>): Record<string, unknown> {
  for (const id of ["agt_rcl001_s1", "agt_rcl001_s2", "agt_rcl001_s3"]) {
    const row = store.getAgent(id);
    if (row === undefined) fail(`missing agent ${id}`);
    if (row.harness !== "fixture") fail(`${id} harness ${row.harness}`);
    if (row.model !== undefined) fail(`${id} has a model`);
  }
  for (const id of ["ses_rcl001_s1_a", "ses_rcl001_s1_b", "ses_rcl001_s2_a", "ses_rcl001_s2_b", "ses_rcl001_s3"]) {
    const row = store.getAgentSession(id);
    if (row === undefined) fail(`missing session ${id}`);
    if (row.harness !== "fixture") fail(`${id} harness ${row.harness}`);
  }

  const s1 = service.recallWorkspace(human("hum_rcl001_s1"), {
    workspaceId: "ws_rcl001_s1",
    query: "partner callback",
  });
  expectIds(idsOf(s1.current.items), [
    "dec_rcl001_s1_accepted",
    "dec_rcl001_s1_proposed",
    "find_rcl001_s1_current",
    "task_rcl001_s1_open",
  ], "s1 current");
  expectIds(idsOf(s1.historical.items), ["find_rcl001_s1_stale"], "s1 historical");
  expectIds(idsOf(s1.artifacts.items), [], "s1 artifacts");
  expectGoal(s1.goal, "goal_rcl001_s1", "Ship the partner callback.");
  const stale = hit(s1.historical.items, "find_rcl001_s1_stale");
  const current = hit(s1.current.items, "find_rcl001_s1_current");
  if (stale.lifecycle !== "superseded" || stale.successorId !== "find_rcl001_s1_current") {
    fail("s1 stale lifecycle");
  }
  if (current.lifecycle !== "current" || current.predecessorId !== "find_rcl001_s1_stale") {
    fail("s1 current lifecycle");
  }
  if (stale.provenance.agentSessionId !== "ses_rcl001_s1_a" || stale.provenance.createdBy.actorId !== "agt_rcl001_s1") {
    fail("s1 stale provenance");
  }
  if (current.provenance.agentSessionId !== "ses_rcl001_s1_b") fail("s1 current provenance");
  const proposed = hit(s1.current.items, "dec_rcl001_s1_proposed");
  const accepted = hit(s1.current.items, "dec_rcl001_s1_accepted");
  if (proposed.lifecycle !== "proposed" || proposed.needsReview !== undefined) fail("s1 proposal");
  if (proposed.provenance.agentSessionId !== "ses_rcl001_s1_a") fail("s1 proposal provenance");
  if (accepted.lifecycle !== "accepted" || accepted.needsReview !== undefined) fail("s1 accepted review");
  if (accepted.provenance.agentSessionId !== undefined || accepted.provenance.createdBy.actorId !== "hum_rcl001_s1") {
    fail("s1 accepted provenance");
  }
  expectIds(accepted.basisFindingIds ?? [], ["find_rcl001_s1_current"], "s1 basis");
  const task = hit(s1.current.items, "task_rcl001_s1_open");
  if (task.lifecycle !== "open" || task.provenance.agentSessionId !== undefined) fail("s1 task");

  const s2 = service.recallWorkspace(human("hum_rcl001_s2"), {
    workspaceId: "ws_rcl001_s2",
    query: "checkout retry",
  });
  expectIds(idsOf(s2.current.items), [
    "dec_rcl001_s2_review",
    "find_rcl001_s2_current",
    "task_rcl001_s2_open",
  ], "s2 current");
  expectIds(idsOf(s2.historical.items), ["find_rcl001_s2_stale"], "s2 historical");
  expectGoal(s2.goal, "goal_rcl001_s2", "Stabilize checkout.");
  const review = hit(s2.current.items, "dec_rcl001_s2_review");
  if (review.lifecycle !== "accepted" || review.needsReview !== true) fail("s2 needsReview");
  expectIds(review.needsReviewFindingIds ?? [], ["find_rcl001_s2_stale"], "s2 review findings");
  expectIds(review.basisFindingIds ?? [], ["find_rcl001_s2_stale"], "s2 basis");
  if (review.provenance.createdBy.actorId !== "hum_rcl001_s2" || review.provenance.agentSessionId !== undefined) {
    fail("s2 decision provenance");
  }
  const s2stale = hit(s2.historical.items, "find_rcl001_s2_stale");
  const s2current = hit(s2.current.items, "find_rcl001_s2_current");
  if (s2stale.successorId !== "find_rcl001_s2_current" || s2stale.provenance.agentSessionId !== "ses_rcl001_s2_a") {
    fail("s2 stale link");
  }
  if (s2current.predecessorId !== "find_rcl001_s2_stale" || s2current.provenance.agentSessionId !== "ses_rcl001_s2_b") {
    fail("s2 current link");
  }

  const s3 = service.recallWorkspace(human("hum_rcl001_s3"), {
    workspaceId: "ws_rcl001_s3",
    query: "partner callback limit",
  });
  expectIds(idsOf(s3.current.items), [
    "dec_rcl001_s3_proposed",
    "find_rcl001_s3_current",
    "task_rcl001_s3_open",
  ], "s3 current");
  expectIds(idsOf(s3.historical.items), [], "s3 historical");
  expectGoal(s3.goal, "goal_rcl001_s3", "Operate the partner callback.");
  const s3proposed = hit(s3.current.items, "dec_rcl001_s3_proposed");
  if (s3proposed.lifecycle !== "proposed" || s3proposed.needsReview !== undefined) fail("s3 proposal");
  if ((s3proposed.basisFindingIds ?? []).length !== 0) fail("s3 proposal cites");
  if (s3proposed.provenance.agentSessionId !== "ses_rcl001_s3" || s3proposed.provenance.createdBy.actorId !== "agt_rcl001_s3") {
    fail("s3 proposal provenance");
  }
  const s3finding = hit(s3.current.items, "find_rcl001_s3_current");
  if (s3finding.lifecycle !== "current" || s3finding.provenance.agentSessionId !== "ses_rcl001_s3") {
    fail("s3 finding");
  }
  if (s3.current.items.some((item) => item.lifecycle === "accepted")) fail("s3 has an accepted decision");

  const packet = service.projectHandoffPacket(human("hum_rcl001_s1"), {
    workspaceId: "ws_rcl001_s1",
    query: "partner callback",
    recipient: READER,
  });
  if (!packet.authority.startsWith("This offline copy is not a Campfire credential")) fail("packet authority");
  if (packet.offlineCopy !== true || packet.sensitiveOfflineCopy !== true || packet.completeness.fullHistoryIncluded !== false) {
    fail("packet flags");
  }
  const packetIds = packet.records.map((record) => record.id);
  for (const id of ["dec_rcl001_s1_accepted", "find_rcl001_s1_stale", "find_rcl001_s1_current", "dec_rcl001_s1_proposed"]) {
    if (!packetIds.includes(id)) fail(`packet missing ${id}`);
  }
  if (JSON.stringify(packet).includes("cft_")) fail("packet contains a token");
  if (JSON.stringify(packet).includes(REASON) === false) {
    // The correction reason must stay out of the packet. Inclusion is a failure.
  }
  if (JSON.stringify(packet).includes(REASON)) fail("packet contains the correction reason");

  return {
    workspaces: {
      s1: sectionReceipt(s1),
      s2: sectionReceipt(s2),
      s3: sectionReceipt(s3),
    },
    packetBytes: JSON.stringify(packet).length,
    reader: READER.actorId,
  };
}

function sectionReceipt(recall: { current: { items: Array<{ id: string }> }; historical: { items: Array<{ id: string }> }; artifacts: { items: Array<{ id: string }> } }): {
  current: string[];
  historical: string[];
  artifacts: string[];
} {
  return {
    current: idsOf(recall.current.items),
    historical: idsOf(recall.historical.items),
    artifacts: idsOf(recall.artifacts.items),
  };
}

function hit<T extends { id: string }>(items: T[], id: string): T {
  const found = items.find((item) => item.id === id);
  if (found === undefined) fail(`missing hit ${id}`);
  return found;
}

function expectIds(actual: string[], expected: string[], label: string): void {
  const left = [...actual].sort();
  const right = [...expected].sort();
  if (left.join("|") !== right.join("|")) fail(`${label}: ${left.join(", ")}`);
}

function expectGoal(goal: { id: string; title: string; status: string } | undefined, id: string, title: string): void {
  if (goal === undefined || goal.id !== id || goal.title !== title || goal.status !== "active") {
    fail(`goal ${id}`);
  }
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

function assertOutsideRepo(path: string): void {
  const rel = relative(REPO_ROOT, path);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    fail(`refusing to write inside the repository: ${path}`);
  }
}

export function seedDatabase(outDir: string, force: boolean): SeedResult {
  assertOutsideRepo(outDir);
  const databasePath = resolve(outDir, "campfire.db");
  const tokenPath = resolve(outDir, "tokens.json");
  const receiptPath = resolve(outDir, "receipt.json");
  if (!force && (existsSync(databasePath) || existsSync(tokenPath))) {
    fail(`seed already exists at ${outDir}; pass --force to replace it`);
  }
  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  for (const path of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`, tokenPath, receiptPath]) {
    if (existsSync(path)) rmSync(path);
  }
  const seeded = seedAt(databasePath);
  const check = openReadonlySqliteStore(databasePath);
  try {
    if (check.getWorkspace("ws_rcl001_s1") === undefined) fail("database did not persist");
  } finally {
    check.close();
  }
  writeFileSync(tokenPath, `${JSON.stringify(seeded.tokens)}\n`, { mode: 0o600 });
  writeFileSync(receiptPath, `${JSON.stringify({ databasePath, ...seeded.receipt }, null, 2)}\n`, { mode: 0o600 });
  return { databasePath, tokenPath, receiptPath, tokens: seeded.tokens };
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const result = seedDatabase(args.out, args.force);
  process.stdout.write(`seeded ${result.databasePath}\nreceipt ${result.receiptPath}\n`);
}
