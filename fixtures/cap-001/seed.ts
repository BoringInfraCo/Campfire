/**
 * CAP-001 Step 0 fixture.
 *
 * FIXTURE EVIDENCE — one authorized workspace, one workspace the actor must
 * not read, and a denied non-participant. Not a sprint verdict and not a
 * human observation. The answer key lives in
 * docs/evidence/cap-001/step-0/. Do not copy these ids into catalog or recipe
 * prose.
 *
 *   CAMPFIRE_TELEMETRY=0 npx tsx fixtures/cap-001/seed.ts --out fixtures/cap-001/.tmp/served --force
 *
 * Writes campfire.db under the output directory (gitignored). Does not write
 * tokens. Service authz lines may precede one JSON object on stdout. That
 * object has no database path and no token.
 */
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CampfireError } from "../../src/domain/errors.js";
import { ID_PREFIXES, type IdKind, type IdSource } from "../../src/domain/ids.js";
import type { ActorContext } from "../../src/service/authorization.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import type { CampfireService } from "../../src/service/service.js";
import { openSqliteStore } from "../../src/store/sqlite-store.js";

const DEFAULT_OUT = resolve(new URL(".", import.meta.url).pathname, ".tmp", "served");
const SEED_BASE_ISO = "2026-10-20T12:00:00.000Z";
const SEED_BASE_MS = Date.parse(SEED_BASE_ISO);
const CLOCK_STEP_MS = 1000;

/** Other-workspace canary. Ada's reads and denial text must not contain it. */
export const OTHER_SENTINEL = "CAP001_OTHER_SENTINEL_do_not_leak";

const ADA = "hum_cap001_ada";
const ZED = "hum_cap001_zed";
const LAB = "ws_cap001_lab";
const OTHER = "ws_cap001_other";
const GOAL = "goal_cap001_lab";
const FINDING_STALE = "find_cap001_stale";
const FINDING_CURRENT = "find_cap001_current";
const FINDING_OTHER = "find_cap001_other";
const DECISION = "dec_cap001_selected";
const CITE_STALE = "cit_cap001_stale";
const CITE_CURRENT = "cit_cap001_current";
const TASK_LATER = "task_cap001_blocked_later";
const FILLER_IDS = Array.from({ length: 20 }, (_, index) => `task_cap001_b${String(index + 1).padStart(2, "0")}`);

const PLANNED: Partial<Record<IdKind, string[]>> = {
  human: [ADA, ZED],
  workspace: [LAB, OTHER],
  goal: [GOAL],
  finding: [FINDING_STALE, FINDING_CURRENT, FINDING_OTHER],
  decision: [DECISION],
  decisionCitation: [CITE_STALE, CITE_CURRENT],
  task: [TASK_LATER, ...FILLER_IDS],
};

function fail(message: string): never {
  throw new Error(`cap-001 seed: ${message}`);
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
  const counters = new Map<IdKind, number>();
  return {
    source: (kind) => {
      const pinned = pending[kind]?.shift();
      if (pinned !== undefined) return pinned;
      const next = (counters.get(kind) ?? 0) + 1;
      counters.set(kind, next);
      return `${ID_PREFIXES[kind]}_cap001_${String(next).padStart(4, "0")}`;
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

function caught(fn: () => unknown): { code: string; message: string; details: unknown } {
  try {
    fn();
  } catch (error) {
    if (error instanceof CampfireError) {
      return { code: error.code, message: error.message, details: error.details ?? null };
    }
    throw error;
  }
  fail("expected a domain error");
}

function historyFacts(service: CampfireService, actor: ActorContext, objectType: "task" | "decision", objectId: string) {
  const page = service.getRecordHistory(actor, { workspaceId: LAB, objectType, objectId });
  return {
    total: page.total,
    returned: page.returned,
    truncated: page.truncated,
    nextCursor: page.nextCursor ?? null,
    items: page.items.map((item) => ({
      id: item.id,
      action: item.action,
      objectType: item.objectType,
      objectId: item.objectId,
      appendPosition: item.appendPosition,
      actorId: item.actor.actorId,
      actorType: item.actor.actorType,
    })),
  };
}

export function seedCap001Database(databasePath: string): Record<string, unknown> {
  return seedAt(databasePath);
}

function seedAt(databasePath: string): Record<string, unknown> {
  const queued = queueSource();
  const { tick, next } = seedClock();
  const store = openSqliteStore(databasePath);
  const service = createCampfireService({ store, idSource: queued.source, clock: tick });
  const ada = human(ADA);
  const zed = human(ZED);
  try {
    const now = tick();
    store.createOrganization({ id: "org_cap001", name: "CAP-001 fixture", createdAt: now });
    store.createTeam({
      id: "team_cap001",
      organizationId: "org_cap001",
      name: "CAP-001 fixture team",
      createdAt: tick(),
    });

    const adaHuman = service.createHuman(undefined, { teamId: "team_cap001", displayName: "Ada" });
    assertEqual(adaHuman.human.id, ADA, "Ada id");
    const zedHuman = service.createHuman(ada, { teamId: "team_cap001", displayName: "Zed" });
    assertEqual(zedHuman.human.id, ZED, "Zed id");

    const lab = service.createWorkspace(ada, { teamId: "team_cap001", name: "cap-001 lab" });
    assertEqual(lab.id, LAB, "lab id");
    const goal = service.createGoal(ada, {
      workspaceId: LAB,
      title: "Continue blocked work that is past the first page.",
    });
    assertEqual(goal.id, GOAL, "goal id");

    service.addFinding(ada, {
      workspaceId: LAB,
      summary: "The first task page contained every blocked task.",
      detail: "Observed before the lab grew past the default task page.",
    });
    service.correctFinding(ada, {
      findingId: FINDING_STALE,
      summary: "A blocked task remains on a later task page.",
      detail: "The default task budget is 20. This lab records 21 blocked tasks.",
      reason: "The lab has more blocked tasks than the default page.",
    });
    service.addDecision(ada, {
      workspaceId: LAB,
      summary: "Treat the first task page as the full blocked set.",
      rationale: "The orientation looked complete before the later page was read.",
    });
    service.acceptDecision(ada, DECISION);
    service.citeDecisionBasis(ada, {
      decisionId: DECISION,
      findingId: FINDING_STALE,
      note: "earlier observation",
    });
    service.citeDecisionBasis(ada, {
      decisionId: DECISION,
      findingId: FINDING_CURRENT,
      note: "corrected observation",
    });

    const later = service.createTask(ada, { workspaceId: LAB, title: "Blocked work past the first page" });
    assertEqual(later.id, TASK_LATER, "later task id");
    service.updateTask(ada, { taskId: TASK_LATER, status: "blocked" });
    for (const [index, id] of FILLER_IDS.entries()) {
      const created = service.createTask(ada, {
        workspaceId: LAB,
        title: `Earlier blocked work ${String(index + 1).padStart(2, "0")}`,
      });
      assertEqual(created.id, id, `filler id ${id}`);
    }
    for (const id of FILLER_IDS) {
      service.updateTask(ada, { taskId: id, status: "blocked" });
    }

    const other = service.createWorkspace(zed, { teamId: "team_cap001", name: "cap-001 other" });
    assertEqual(other.id, OTHER, "other workspace id");
    const leaked = service.addFinding(zed, {
      workspaceId: OTHER,
      summary: OTHER_SENTINEL,
      detail: "Must not appear in an unauthorized read or denial.",
    });
    assertEqual(leaked.id, FINDING_OTHER, "other finding id");
    queued.assertEmpty();

    const page1 = service.listTasksPage(ada, { workspaceId: LAB });
    const page1Ids = page1.items.map((task) => task.id);
    assertEqual(page1.total, 21, "task total");
    assertEqual(page1.returned, 20, "task page 1 returned");
    assertEqual(page1.truncated, true, "task page 1 truncated");
    assert(page1.nextCursor !== undefined, "task page 1 cursor");
    assert(!page1Ids.includes(TASK_LATER), "later task on page 1");
    assertEqual(page1Ids, [...FILLER_IDS].reverse(), "page 1 order");

    const page2 = service.listTasksPage(ada, { workspaceId: LAB, cursor: page1.nextCursor });
    assertEqual(page2.items.map((task) => task.id), [TASK_LATER], "page 2 ids");
    assertEqual(page2.returned, 1, "page 2 returned");
    assertEqual(page2.total, 21, "page 2 total");
    assertEqual(page2.nextCursor, undefined, "page 2 cursor");
    // returned < total, so truncated stays true even though the store has no further row.
    assertEqual(page2.truncated, true, "page 2 truncated without a cursor");
    assertEqual(
      page1.nextCursor,
      "cf1.eyJ2IjoxLCJraW5kIjoidGFzayIsIndvcmtzcGFjZUlkIjoid3NfY2FwMDAxX2xhYiIsInJhbmsiOjAsImF0IjoiMjAyNi0xMC0yMFQxMjowMDozNC4wMDBaIiwiaWQiOiJ0YXNrX2NhcDAwMV9iMDEifQ",
      "page 1 cursor",
    );
    const laterTask = service.getTaskInWorkspace(ada, LAB, TASK_LATER);
    assertEqual(laterTask.status, "blocked", "later status");
    assertEqual(laterTask.assignee, undefined, "later assignee");

    const context = service.getWorkspaceContext(ada, LAB);
    const contextTaskIds = context.slices.tasks.items.map((task) => task.id);
    const contextBlockerIds = context.slices.blockers.items.map((task) => task.id);
    assertEqual(contextTaskIds, page1Ids, "context tasks match page 1");
    assert(!contextTaskIds.includes(TASK_LATER), "later task in context tasks");
    assert(!contextBlockerIds.includes(TASK_LATER), "later task in context blockers");
    assertEqual(context.slices.tasks.total, 21, "context task total");
    assertEqual(context.slices.tasks.returned, 20, "context task returned");
    assertEqual(context.slices.tasks.truncated, true, "context task truncated");
    assertEqual(context.slices.blockers.total, 21, "blocker total");
    assertEqual(context.slices.blockers.returned, 10, "blocker returned");
    assertEqual(context.slices.blockers.truncated, true, "blocker truncated");
    assertEqual(contextBlockerIds, page1Ids.slice(0, 10), "blocker ids");
    assertEqual(
      context.slices.findings.items.map((finding) => finding.id),
      [FINDING_CURRENT],
      "orientation findings are current only",
    );
    assertEqual(context.historicalCounts.findings, 1, "historical finding count");
    assertEqual(context.attentionCoverage.completeUnderRules, false, "attention coverage");
    assertEqual(context.generatedAt, "2026-10-20T12:00:56.000Z", "generatedAt");
    assertEqual(context.suggestedNextAction, {
      kind: "task",
      id: "task_cap001_b01",
      summary: "Earlier blocked work 01",
      reason: "unassigned_blocked_task",
      orientationHint: true,
    }, "suggested next action");
    assertEqual(
      context.slices.blockers.nextCursor,
      "cf1.eyJ2IjoxLCJraW5kIjoidGFzayIsIndvcmtzcGFjZUlkIjoid3NfY2FwMDAxX2xhYiIsInJhbmsiOjAsImF0IjoiMjAyNi0xMC0yMFQxMjowMDo0NC4wMDBaIiwiaWQiOiJ0YXNrX2NhcDAwMV9iMTEifQ",
      "blocker cursor",
    );

    const decision = service.getDecisionInWorkspace(ada, LAB, DECISION);
    assertEqual(decision.status, "accepted", "decision status");
    assertEqual(decision.needsReview, true, "needsReview");
    assertEqual(decision.needsReviewFindingIds, [FINDING_STALE], "needsReview findings");
    assertEqual(
      (decision.citations ?? []).map((citation) => ({ id: citation.id, findingId: citation.findingId })),
      [
        { id: CITE_STALE, findingId: FINDING_STALE },
        { id: CITE_CURRENT, findingId: FINDING_CURRENT },
      ],
      "citations",
    );
    const stale = service.getFindingInWorkspace(ada, LAB, FINDING_STALE);
    const current = service.getFindingInWorkspace(ada, LAB, FINDING_CURRENT);
    assertEqual(stale.currentness, "superseded", "stale currentness");
    assertEqual(stale.successorId, FINDING_CURRENT, "stale successor");
    assertEqual(current.currentness, "current", "current currentness");
    assertEqual(current.predecessorId, FINDING_STALE, "current predecessor");
    assert(
      context.slices.findings.items.every((finding) => finding.id !== FINDING_STALE),
      "stale finding absent from orientation",
    );

    const taskHistory = historyFacts(service, ada, "task", TASK_LATER);
    const decisionHistory = historyFacts(service, ada, "decision", DECISION);
    assertEqual(
      taskHistory.items.map((item) => item.id),
      ["con_cap001_0012", "con_cap001_0011"],
      "task contribution ids",
    );
    assertEqual(
      decisionHistory.items.map((item) => item.id),
      ["con_cap001_0010", "con_cap001_0009", "con_cap001_0008", "con_cap001_0007"],
      "decision contribution ids",
    );
    assertEqual(taskHistory.items.map((item) => item.action), ["update", "create"], "task history actions");
    assertEqual(
      decisionHistory.items.map((item) => item.action),
      ["update", "update", "update", "create"],
      "decision history actions",
    );

    const adaOnOther = caught(() => service.listTasksPage(ada, { workspaceId: OTHER }));
    const zedOnLab = caught(() => service.getWorkspaceContext(zed, LAB));
    assertEqual(adaOnOther.code, "ParticipantRequired", "Ada denial code");
    assertEqual(zedOnLab.code, "ParticipantRequired", "Zed denial code");
    assert(!adaOnOther.message.includes(OTHER_SENTINEL), "Ada denial leaked sentinel");
    assert(!zedOnLab.message.includes(OTHER_SENTINEL), "Zed denial leaked sentinel");
    assert(!adaOnOther.message.includes("cap-001 other"), "Ada denial leaked other name");
    assertEqual(
      service.listWorkspaces(ada).map((workspace) => workspace.id),
      [LAB],
      "Ada workspaces",
    );
    assertEqual(
      service.listWorkspaces(zed).map((workspace) => workspace.id),
      [OTHER],
      "Zed workspaces",
    );

    const answer = {
      label: "FIXTURE EVIDENCE",
      seedClock: SEED_BASE_ISO,
      generatedAt: context.generatedAt,
      nextClock: next(),
      actors: { authorized: ADA, denied: ZED },
      workspaces: { authorized: LAB, unreadableByAuthorizedActor: OTHER },
      goalId: GOAL,
      taskPage: {
        total: page1.total,
        page1: {
          returned: page1.returned,
          truncated: page1.truncated,
          nextCursor: page1.nextCursor,
          ids: page1Ids,
        },
        page2: {
          returned: page2.returned,
          truncated: page2.truncated,
          nextCursor: null,
          ids: page2.items.map((task) => task.id),
        },
        blockedTaskBeyondFirstPage: {
          id: TASK_LATER,
          status: laterTask.status,
          assignee: null,
          title: laterTask.title,
          createdBy: laterTask.createdBy,
          createdAt: laterTask.createdAt,
          updatedAt: laterTask.updatedAt,
          absentFromFirstListTasksPage: true,
          absentFromContextTasks: true,
          absentFromContextBlockers: true,
          appearsOnPage: 2,
        },
      },
      contextCoverage: {
        tasks: {
          total: context.slices.tasks.total,
          returned: context.slices.tasks.returned,
          truncated: context.slices.tasks.truncated,
          nextCursor: context.slices.tasks.nextCursor ?? null,
        },
        blockers: {
          total: context.slices.blockers.total,
          returned: context.slices.blockers.returned,
          truncated: context.slices.blockers.truncated,
          nextCursor: context.slices.blockers.nextCursor ?? null,
          ids: contextBlockerIds,
        },
        decisions: {
          total: context.slices.decisions.total,
          returned: context.slices.decisions.returned,
          truncated: context.slices.decisions.truncated,
        },
        findings: {
          total: context.slices.findings.total,
          returned: context.slices.findings.returned,
          truncated: context.slices.findings.truncated,
          ids: context.slices.findings.items.map((finding) => finding.id),
        },
        historicalFindings: context.historicalCounts.findings,
        attentionCompleteUnderRules: context.attentionCoverage.completeUnderRules,
        suggestedNextAction: context.suggestedNextAction,
      },
      decision: {
        id: decision.id,
        status: decision.status,
        needsReview: decision.needsReview === true,
        needsReviewFindingIds: decision.needsReviewFindingIds ?? [],
        summary: decision.summary,
        rationale: decision.rationale ?? null,
        citations: (decision.citations ?? []).map((citation) => ({
          id: citation.id,
          findingId: citation.findingId,
          note: citation.note ?? null,
        })),
      },
      findings: {
        stale: {
          id: stale.id,
          currentness: stale.currentness,
          successorId: stale.successorId ?? null,
          summary: stale.summary,
        },
        current: {
          id: current.id,
          currentness: current.currentness,
          predecessorId: current.predecessorId ?? null,
          summary: current.summary,
        },
      },
      history: { task: taskHistory, decision: decisionHistory },
      denial: {
        adaOnOtherWorkspace: adaOnOther,
        zedOnLab: zedOnLab,
        sentinelAbsent: true,
      },
    };
    const serialized = JSON.stringify(answer);
    assert(!serialized.includes(OTHER_SENTINEL), "answer key contains the other-workspace sentinel");
    return answer;
  } finally {
    service.close();
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
    fail(`unknown argument ${arg ?? ""}`);
  }
  return { out, force };
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const databasePath = resolve(args.out, "campfire.db");
  if (!args.force && existsSync(databasePath)) {
    fail(`seed already exists at ${args.out}; pass --force to replace it`);
  }
  mkdirSync(args.out, { recursive: true });
  for (const path of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    if (existsSync(path)) rmSync(path);
  }
  const answer = seedCap001Database(databasePath);
  process.stdout.write(`${JSON.stringify(answer, null, 2)}\n`);
}
