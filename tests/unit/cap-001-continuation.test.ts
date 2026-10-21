/**
 * CAP-001 continuation fixture.
 *
 * Engineering evidence only. This is not a Codex or OpenCode trace and not a
 * human comparison. The client below follows the frozen read recipes with
 * direct service reads. Search and recipe lookup stay pure.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { seedCap001Database } from "../../fixtures/cap-001/seed.js";
import { getReadRecipe, searchCapabilities } from "../../src/catalog/capability-search.js";
import { ParticipantRequired } from "../../src/domain/errors.js";
import type { ActorContext } from "../../src/service/authorization.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import * as sqlite from "../../src/store/sqlite-store.js";

const ANSWER_KEY_PATH = fileURLToPath(
  new URL("../../fixtures/cap-001/contract/answer-key.json", import.meta.url),
);
const SOURCE_PATH = fileURLToPath(new URL("../../src/catalog/capability-search.ts", import.meta.url));

interface AnswerKey {
  actors: { authorized: string; denied: string };
  workspaces: { authorized: string; unreadableByAuthorizedActor: string };
  taskPage: {
    total: number;
    page1: { returned: number; truncated: boolean; nextCursor: string; ids: string[] };
    page2: { returned: number; truncated: boolean; nextCursor: null; ids: string[] };
    blockedTaskBeyondFirstPage: { id: string; status: string; assignee: null };
  };
  contextCoverage: {
    tasks: { total: number; returned: number; truncated: boolean };
    blockers: { returned: number; truncated: boolean; ids: string[] };
    findings: { ids: string[] };
    historicalFindings: number;
    attentionCompleteUnderRules: boolean;
    suggestedNextAction: { id: string; reason: string; orientationHint: boolean };
  };
  decision: { id: string; status: string; needsReview: boolean; needsReviewFindingIds: string[] };
  findings: {
    stale: { id: string; currentness: string };
    current: { id: string; currentness: string };
  };
  history: {
    task: { items: Array<{ id: string; action: string }> };
    decision: { items: Array<{ id: string; action: string }> };
  };
  denial: {
    adaOnOtherWorkspace: { code: string };
    zedOnLab: { code: string };
  };
  handoff?: unknown;
}

const key = JSON.parse(readFileSync(ANSWER_KEY_PATH, "utf8")) as AnswerKey;
const dirs: string[] = [];

function actor(id: string): ActorContext {
  return { actor: { actorId: id, actorType: "human" } };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("CAP-001 frozen continuation fixture", () => {
  it("follows continue-blocked-work and review-decision-basis without false completeness", () => {
    const dir = mkdtempSync(join(tmpdir(), "cap-001-fixture-"));
    dirs.push(dir);
    const databasePath = join(dir, "campfire.db");
    const seeded = seedCap001Database(databasePath);
    const { handoff: _handoff, ...frozenFacts } = key;
    expect(seeded).toEqual(frozenFacts);

    const store = sqlite.openSqliteStore(databasePath);
    const service = createCampfireService({ store });
    const ada = actor(key.actors.authorized);
    const zed = actor(key.actors.denied);
    const lab = key.workspaces.authorized;
    const other = key.workspaces.unreadableByAuthorizedActor;
    const laterId = key.taskPage.blockedTaskBeyondFirstPage.id;
    try {
      const memberships = service.listWorkspaces(ada).map((workspace) => workspace.id);
      expect(memberships).toEqual([lab]);
      expect(memberships).not.toContain(other);

      const context = service.getWorkspaceContext(ada, lab);
      expect(context.slices.tasks.truncated).toBe(true);
      expect(context.slices.tasks.returned).toBe(key.contextCoverage.tasks.returned);
      expect(context.slices.tasks.total).toBe(key.contextCoverage.tasks.total);
      expect(context.slices.tasks.returned).toBeLessThan(context.slices.tasks.total);
      expect(context.slices.tasks.items.map((task) => task.id)).not.toContain(laterId);
      expect(context.slices.blockers.truncated).toBe(true);
      expect(context.slices.blockers.items.map((task) => task.id)).toEqual(key.contextCoverage.blockers.ids);
      expect(context.slices.blockers.items.map((task) => task.id)).not.toContain(laterId);
      expect(context.slices.findings.items.map((finding) => finding.id)).toEqual(key.contextCoverage.findings.ids);
      expect(context.historicalCounts.findings).toBe(key.contextCoverage.historicalFindings);
      expect(context.attentionCoverage.completeUnderRules).toBe(key.contextCoverage.attentionCompleteUnderRules);
      expect(context.suggestedNextAction).toMatchObject(key.contextCoverage.suggestedNextAction);
      expect(context.suggestedNextAction?.id).not.toBe(laterId);

      const page1 = service.listTasksPage(ada, { workspaceId: lab });
      expect(page1.items.map((task) => task.id)).toEqual(key.taskPage.page1.ids);
      expect(page1.returned).toBe(key.taskPage.page1.returned);
      expect(page1.total).toBe(key.taskPage.total);
      expect(page1.truncated).toBe(true);
      expect(page1.nextCursor).toBe(key.taskPage.page1.nextCursor);
      expect(page1.items.map((task) => task.id)).not.toContain(laterId);

      const page2 = service.listTasksPage(ada, { workspaceId: lab, cursor: page1.nextCursor });
      expect(page2.items.map((task) => task.id)).toEqual(key.taskPage.page2.ids);
      expect(page2.returned).toBe(1);
      expect(page2.total).toBe(21);
      expect(page2.truncated).toBe(true);
      expect(page2.nextCursor).toBeUndefined();

      const task = service.getTaskInWorkspace(ada, lab, laterId);
      expect(task.status).toBe("blocked");
      expect(task.assignee ?? null).toBeNull();
      const taskHistory = service.getRecordHistory(ada, {
        workspaceId: lab,
        objectType: "task",
        objectId: laterId,
      });
      expect(taskHistory.items.map((item) => ({ id: item.id, action: item.action }))).toEqual(
        key.history.task.items.map((item) => ({ id: item.id, action: item.action })),
      );
      expect(taskHistory.nextCursor).toBeUndefined();

      expect(context.slices.decisions.truncated).toBe(false);
      expect(context.slices.decisions.items.map((decision) => decision.id)).toContain(key.decision.id);
      const decision = service.getDecisionInWorkspace(ada, lab, key.decision.id);
      expect(decision.status).toBe("accepted");
      expect(decision.needsReview).toBe(true);
      expect(decision.needsReviewFindingIds).toEqual(key.decision.needsReviewFindingIds);
      const stale = service.getFindingInWorkspace(ada, lab, key.findings.stale.id);
      const current = service.getFindingInWorkspace(ada, lab, key.findings.current.id);
      expect(stale.currentness).toBe("superseded");
      expect(current.currentness).toBe("current");
      expect(decision.status).toBe("accepted");
      const decisionHistory = service.getRecordHistory(ada, {
        workspaceId: lab,
        objectType: "decision",
        objectId: key.decision.id,
      });
      expect(decisionHistory.items.map((item) => ({ id: item.id, action: item.action }))).toEqual(
        key.history.decision.items.map((item) => ({ id: item.id, action: item.action })),
      );

      expect(() => service.getWorkspaceContext(zed, lab)).toThrow(ParticipantRequired);
      expect(() => service.listTasksPage(ada, { workspaceId: other })).toThrow(ParticipantRequired);
      try {
        service.getWorkspaceContext(zed, lab);
      } catch (error) {
        expect(error).toBeInstanceOf(ParticipantRequired);
        expect((error as ParticipantRequired).code).toBe(key.denial.zedOnLab.code);
        expect((error as ParticipantRequired).message).not.toContain("CAP001_OTHER_SENTINEL");
      }

      const recipe = getReadRecipe("review-decision-basis");
      expect(recipe.resultContract).toContain("does not treat a review cue as revocation");
      expect(recipe.resultContract).not.toContain("permission to act, and it does invent");
      const guide = searchCapabilities("blocked work", undefined);
      expect(guide.entries.map((entry) => entry.id)).toEqual(["get_task", "list_tasks"]);
      expect(guide.recipeSummaries.map((entry) => entry.id)).toEqual(["continue-blocked-work"]);
      expect(JSON.stringify(guide)).not.toContain(laterId);
    } finally {
      service.close();
    }
  });

  it("does not open a store while searching or reading a recipe", () => {
    const source = readFileSync(SOURCE_PATH, "utf8");
    expect(source).not.toMatch(/sqlite-store|campfire-service|http\/client|openSqliteStore/);
    const dir = mkdtempSync(join(tmpdir(), "cap-001-pure-"));
    dirs.push(dir);
    const databasePath = join(dir, "unused.db");
    const spy = vi.spyOn(sqlite, "openSqliteStore");
    const before = spy.mock.calls.length;
    searchCapabilities("workspace", 10);
    getReadRecipe("continue-blocked-work");
    expect(spy.mock.calls.length).toBe(before);
    expect(existsSync(databasePath)).toBe(false);
    spy.mockRestore();
  });
});
