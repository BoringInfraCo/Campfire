/**
 * Sprint 012 workspace-closure evaluator (pure, no I/O).
 *
 * Scores the scored closure against the truthful closure rule and measurement
 * plan (SPRINT_012.md sections 3-5): readiness precondition, closure accuracy,
 * history retention, provenance, selectivity, and isolation. No network, no
 * LLM, no filesystem access.
 */
import type { Contribution } from "../../domain/types.js";
import type { WorkspaceContext, WorkspaceView } from "../../service/service.js";

export interface Sprint012Check {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface ClosureSignals {
  workspaceStatus: string;
  goalStatus: string | undefined;
  openTaskCount: number;
  proposedDecisionCount: number;
  unresolvedBlockedCount: number;
  nextActionKind: string;
}

export function isReadyToClose(s: ClosureSignals): { ready: boolean; unmet: string[] } {
  const unmet: string[] = [];
  if (s.workspaceStatus !== "active") unmet.push("workspaceStatus != active");
  if (s.goalStatus !== "completed") unmet.push("goalStatus != completed");
  if (s.openTaskCount !== 0) unmet.push("openTaskCount != 0");
  if (s.proposedDecisionCount !== 0) unmet.push("proposedDecisionCount != 0");
  if (s.unresolvedBlockedCount !== 0) unmet.push("unresolvedBlockedCount != 0");
  if (s.nextActionKind !== "none") unmet.push("nextActionKind != none");
  return { ready: unmet.length === 0, unmet };
}

export interface Sprint012Snapshot {
  workspaceId: string;
  signals: ClosureSignals;
  findingIds: string[];
  taskIds: string[];
  artifactIds: string[];
  decisionIds: string[];
  activity: Contribution[];
}

export interface Sprint012Expected {
  workspaceId: string;
  closerActorId: string;
  closerSessionId: string;
  forbidden: string[];
}

export type Sprint012Recommendation = "GO" | "CONDITIONAL GO" | "NO-GO / REFRAME";

function check(name: string, passed: boolean, detail?: string): Sprint012Check {
  return detail === undefined ? { name, passed } : { name, passed, detail };
}

function sameIdSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const seen = new Set(a);
  if (seen.size !== a.length) {
    // Duplicate ids should never occur; fall back to sorted comparison.
    const sortedA = [...a].sort();
    const sortedB = [...b].sort();
    return sortedA.every((id, index) => id === sortedB[index]);
  }
  for (const id of b) {
    if (!seen.has(id)) return false;
  }
  return true;
}

function hasForbiddenText(text: string, forbidden: string[]): string | undefined {
  for (const token of forbidden) {
    if (token !== "" && text.includes(token)) return token;
  }
  return undefined;
}

/**
 * Build an evaluator snapshot from a workspace projection.
 *
 * Reads orientation signals when present (`openTasks`, `proposedDecisions`,
 * `alignment.unresolvedBlockedTaskIds`, `suggestedNextAction.kind` from
 * `get_workspace_context`) and otherwise derives them from the full
 * `get_workspace` lists (open = status != completed; proposed = status ==
 * proposed; blocked = status == blocked). Id lists and activity come straight
 * from the view.
 */
export function fromWorkspaceView(view: WorkspaceView, workspaceId: string): Sprint012Snapshot {
  const asContext = view as unknown as Partial<WorkspaceContext>;
  const tasks = view.tasks ?? [];
  const decisions = view.decisions ?? [];
  const findings = view.findings ?? [];
  const artifacts = view.artifacts ?? [];
  const activity = view.activity ?? [];

  const openTasks = asContext.openTasks ?? tasks.filter((task) => task.status !== "completed");
  const proposedDecisions =
    asContext.proposedDecisions ?? decisions.filter((decision) => decision.status === "proposed");
  const unresolvedBlockedTaskIds =
    asContext.alignment?.unresolvedBlockedTaskIds ??
    tasks.filter((task) => task.status === "blocked").map((task) => task.id);

  let nextActionKind: string;
  if (asContext.suggestedNextAction?.kind !== undefined) {
    nextActionKind = asContext.suggestedNextAction.kind;
  } else if (proposedDecisions.length > 0) {
    nextActionKind = "decision";
  } else if (openTasks.length > 0 || unresolvedBlockedTaskIds.length > 0) {
    nextActionKind = "task";
  } else {
    nextActionKind = "none";
  }

  return {
    workspaceId,
    signals: {
      workspaceStatus: view.workspace.status,
      goalStatus: view.goal?.status,
      openTaskCount: openTasks.length,
      proposedDecisionCount: proposedDecisions.length,
      unresolvedBlockedCount: unresolvedBlockedTaskIds.length,
      nextActionKind,
    },
    findingIds: findings.map((finding) => finding.id),
    taskIds: tasks.map((task) => task.id),
    artifactIds: artifacts.map((artifact) => artifact.id),
    decisionIds: decisions.map((decision) => decision.id),
    activity,
  };
}

/** Evaluate every Sprint 012 acceptance check against before/after snapshots. */
export function computeSprint012Checks(
  before: Sprint012Snapshot,
  after: Sprint012Snapshot,
  expected: Sprint012Expected,
): Sprint012Check[] {
  const readiness = isReadyToClose(before.signals);
  const precondition = check(
    "precondition.was-ready",
    readiness.ready,
    readiness.ready ? "fixture was ready to close" : `unmet: ${readiness.unmet.join(", ")}`,
  );

  const selectedCompleted = check(
    "closure-accuracy.selected-completed",
    after.signals.workspaceStatus === "completed",
    `workspaceStatus=${after.signals.workspaceStatus}`,
  );

  const beforeIds = new Set(before.activity.map((contribution) => contribution.id));
  const fresh = after.activity.filter((contribution) => !beforeIds.has(contribution.id));
  const single = fresh.length === 1 ? fresh[0] : undefined;
  const singlePayloadStatus =
    single !== undefined
      ? (single.payload as Record<string, unknown> | undefined)?.["status"]
      : undefined;
  const singleOk =
    fresh.length === 1 &&
    single !== undefined &&
    single.action === "update" &&
    single.objectType === "workspace" &&
    single.objectId === expected.workspaceId &&
    singlePayloadStatus === "completed";
  const singleMutation = check(
    "closure-accuracy.single-mutation",
    singleOk,
    single === undefined && fresh.length !== 1
      ? `fresh contributions=${fresh.length}, expected exactly 1`
      : `fresh=${fresh.length} action=${single?.action} objectType=${single?.objectType} objectId=${single?.objectId} status=${String(singlePayloadStatus)}`,
  );

  const objectsIntact =
    sameIdSet(before.findingIds, after.findingIds) &&
    sameIdSet(before.taskIds, after.taskIds) &&
    sameIdSet(before.artifactIds, after.artifactIds) &&
    sameIdSet(before.decisionIds, after.decisionIds) &&
    after.activity.length === before.activity.length + 1;
  const retention = check(
    "history-retention.objects-intact",
    objectsIntact,
    `findings=${before.findingIds.length}->${after.findingIds.length} tasks=${before.taskIds.length}->${after.taskIds.length} artifacts=${before.artifactIds.length}->${after.artifactIds.length} decisions=${before.decisionIds.length}->${after.decisionIds.length} activity=${before.activity.length}->${after.activity.length}`,
  );

  const provenanceOk =
    single !== undefined &&
    fresh.length === 1 &&
    single.actor?.actorId === expected.closerActorId &&
    single.agentSessionId === expected.closerSessionId &&
    typeof single.createdAt === "string" &&
    single.createdAt.length > 0;
  const provenance = check(
    "provenance.closer-attribution",
    provenanceOk,
    single === undefined
      ? `no single fresh contribution to attribute (fresh=${fresh.length})`
      : `actor=${single.actor?.actorId} session=${single.agentSessionId} createdAt=${single.createdAt}`,
  );

  const selectivityOk =
    fresh.length === 1 && single !== undefined && single.objectId === expected.workspaceId;
  const selectivity = check(
    "selectivity.no-unrelated-writes",
    selectivityOk,
    `fresh=${fresh.length} objectIds=${fresh.map((contribution) => contribution.objectId).join(",") || "none"}`,
  );

  const blob = JSON.stringify(after);
  const leaked = hasForbiddenText(blob, expected.forbidden ?? []);
  const isolation = check(
    "isolation.no-forbidden",
    leaked === undefined,
    leaked === undefined
      ? `checked ${(expected.forbidden ?? []).length} forbidden strings`
      : `forbidden string present: ${leaked}`,
  );

  return [
    precondition,
    selectedCompleted,
    singleMutation,
    retention,
    provenance,
    selectivity,
    isolation,
  ];
}

/**
 * GO only when every check passes. CONDITIONAL GO when completion, history
 * retention, provenance, and isolation hold but the only failure is one
 * unrelated/selectivity write. Otherwise NO-GO / REFRAME.
 */
export function recommend012(checks: readonly Sprint012Check[]): Sprint012Recommendation {
  if (checks.length > 0 && checks.every((candidate) => candidate.passed)) return "GO";

  const byName = new Map(checks.map((candidate) => [candidate.name, candidate.passed]));
  const selectedOk = byName.get("closure-accuracy.selected-completed") === true;
  const historyOk = byName.get("history-retention.objects-intact") === true;
  const provenanceOk = byName.get("provenance.closer-attribution") === true;
  const isolationOk = byName.get("isolation.no-forbidden") === true;
  const failures = checks.filter((candidate) => !candidate.passed);
  if (
    selectedOk &&
    historyOk &&
    provenanceOk &&
    isolationOk &&
    failures.length === 1 &&
    failures[0]!.name === "selectivity.no-unrelated-writes"
  ) {
    return "CONDITIONAL GO";
  }
  return "NO-GO / REFRAME";
}
