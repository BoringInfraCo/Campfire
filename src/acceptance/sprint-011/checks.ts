/**
 * Sprint 011 natural-contribution evaluator (pure, no I/O).
 *
 * Compares a final workspace snapshot against the fixture's predeclared fact
 * and completion condition (SPRINT_011.md section 5): contribution accuracy,
 * usefulness, selectivity, provenance, and isolation. No network, no LLM, no
 * filesystem access. RegExp inputs are caller-supplied; this module never
 * reads fixtures or harness output.
 */
import type {
  Artifact,
  Contribution,
  Decision,
  Finding,
  Task,
} from "../../domain/types.js";
import type { WorkspaceView } from "../../service/service.js";

export interface Sprint011Check {
  name: string;
  passed: boolean;
  detail?: string;
}

/**
 * Workspace snapshot under evaluation. Field names are compatible with
 * {@link WorkspaceView}: findings/tasks/artifacts/decisions/activity map
 * directly onto the projection lists. `discoveries` and `contributions` are
 * accepted as aliases for `findings` and `activity`.
 */
export interface Sprint011Snapshot {
  workspaceId: string;
  findings: Finding[];
  tasks: Task[];
  artifacts: Artifact[];
  decisions: Decision[];
  activity: Contribution[];
  discoveries?: Finding[];
  contributions?: Contribution[];
}

export interface Sprint011Expected {
  factPattern: RegExp;
  completionRequiresDiagnosis: boolean;
  hasDiagnosisArtifact: boolean;
  taskStatus: string;
  decisionStatus?: string;
  workspaceId: string;
  forbidden: string[];
}

export type Sprint011Recommendation = "GO" | "CONDITIONAL GO" | "NO-GO / REFRAME";

function check(name: string, passed: boolean, detail?: string): Sprint011Check {
  return detail === undefined ? { name, passed } : { name, passed, detail };
}

function normalizeSummary(summary: string): string {
  return summary.trim().toLowerCase();
}

function findingText(finding: Finding): string {
  return `${finding.summary} ${finding.detail ?? ""}`;
}

function resolveFindings(snapshot: Sprint011Snapshot): Finding[] {
  if (snapshot.findings !== undefined && snapshot.findings.length > 0) return snapshot.findings;
  return snapshot.discoveries ?? snapshot.findings ?? [];
}

function resolveActivity(snapshot: Sprint011Snapshot): Contribution[] {
  if (snapshot.activity !== undefined && snapshot.activity.length > 0) return snapshot.activity;
  return snapshot.contributions ?? snapshot.activity ?? [];
}

/**
 * Build an evaluator snapshot from a full {@link WorkspaceView} projection.
 * Keeps the evaluator input compatible with the service projection without
 * taking on service or store dependencies.
 */
export function fromWorkspaceView(view: WorkspaceView, workspaceId: string): Sprint011Snapshot {
  return {
    workspaceId,
    findings: view.findings,
    tasks: view.tasks,
    artifacts: view.artifacts,
    decisions: view.decisions,
    activity: view.activity,
  };
}

function hasForbiddenText(text: string, forbidden: string[]): string | undefined {
  for (const token of forbidden) {
    if (token !== "" && text.includes(token)) return token;
  }
  return undefined;
}

/** Evaluate every Sprint 011 acceptance check against a workspace snapshot. */
export function computeSprint011Checks(
  snapshot: Sprint011Snapshot,
  expected: Sprint011Expected,
): Sprint011Check[] {
  const findings = resolveFindings(snapshot);
  const activity = resolveActivity(snapshot);
  const tasks = snapshot.tasks ?? [];
  const artifacts = snapshot.artifacts ?? [];
  const decisions = snapshot.decisions ?? [];
  const forbidden = expected.forbidden ?? [];

  const matchingFinding = findings.find((finding) => expected.factPattern.test(findingText(finding)));
  const findingMatchesFact = check(
    "contribution-accuracy.finding-matches-fact",
    matchingFinding !== undefined,
    matchingFinding === undefined
      ? `no finding matches ${String(expected.factPattern)} among ${findings.length}`
      : `finding ${matchingFinding.id} matches fact pattern`,
  );

  const isTerminal = expected.taskStatus === "blocked" || expected.taskStatus === "completed";
  let completionConsistent = true;
  if (expected.completionRequiresDiagnosis) {
    completionConsistent = expected.hasDiagnosisArtifact
      ? expected.taskStatus === "completed"
      : expected.taskStatus === "blocked";
  }
  const snapshotHasTask = tasks.some((task) => task.status === expected.taskStatus);
  const taskTruthful = check(
    "contribution-accuracy.task-truthful-terminal",
    isTerminal && completionConsistent && snapshotHasTask,
    `expected=${expected.taskStatus} terminal=${isTerminal} completionConsistent=${completionConsistent} present=${snapshotHasTask}`,
  );

  const artifactPresent = check(
    "contribution-accuracy.artifact-present",
    expected.hasDiagnosisArtifact ? artifacts.length > 0 : true,
    `hasDiagnosisArtifact=${expected.hasDiagnosisArtifact} artifacts=${artifacts.length}`,
  );

  const requiredDecisionStatus = expected.decisionStatus ?? "proposed";
  const decisionProposed =
    decisions.length === 0
      ? check(
          "contribution-accuracy.decision-proposed",
          true,
          `no optional decision earned; decisions=0`,
        )
      : check(
          "contribution-accuracy.decision-proposed",
          decisions.every(
            (decision) => decision.status === "proposed" && decision.status === requiredDecisionStatus,
          ),
          `decisions=${decisions.map((d) => `${d.id}:${d.status}`).join(",") || "none"} required=${requiredDecisionStatus}`,
        );

  const usefulFinding = findings.find((finding) => {
    if (!expected.factPattern.test(findingText(finding))) return false;
    if (finding.summary.trim().length <= 20) return false;
    return hasForbiddenText(findingText(finding), forbidden) === undefined;
  });
  const summaryUseful = check(
    "usefulness.summary-useful",
    usefulFinding !== undefined,
    usefulFinding === undefined
      ? `no matching finding with a self-contained summary longer than 20 chars`
      : `finding ${usefulFinding.id} summary is self-contained (${usefulFinding.summary.trim().length} chars)`,
  );

  const seen = new Set<string>();
  let duplicate: string | undefined;
  for (const finding of findings) {
    const normalized = normalizeSummary(finding.summary);
    if (seen.has(normalized)) {
      duplicate = finding.summary;
      break;
    }
    seen.add(normalized);
  }
  const noDuplicates = check(
    "selectivity.no-duplicates",
    duplicate === undefined,
    duplicate === undefined ? `findings=${findings.length} unique` : `duplicate summary: ${duplicate}`,
  );

  const offWorkspace =
    tasks.some((task) => task.workspaceId !== expected.workspaceId) ||
    findings.some((finding) => finding.workspaceId !== expected.workspaceId) ||
    artifacts.some((artifact) => artifact.workspaceId !== expected.workspaceId) ||
    decisions.some((decision) => decision.workspaceId !== expected.workspaceId) ||
    activity.some((contribution) => contribution.workspaceId !== expected.workspaceId) ||
    snapshot.workspaceId !== expected.workspaceId;
  const noUnsupportedWrites = check(
    "selectivity.no-unsupported-writes",
    !offWorkspace,
    `workspace=${expected.workspaceId} offWorkspace=${offWorkspace}`,
  );

  const WRITABLE_OBJECTS: ReadonlySet<Contribution["objectType"]> = new Set([
    "finding",
    "task",
    "decision",
    "artifact",
  ]);
  let provenanceDetail = `contributions=${activity.length}`;
  let provenanceOk = true;
  for (const contribution of activity) {
    const hasCore =
      contribution.actor?.actorId !== undefined &&
      contribution.actor.actorId !== "" &&
      contribution.workspaceId !== undefined &&
      contribution.workspaceId !== "" &&
      contribution.objectType !== undefined &&
      contribution.objectId !== undefined &&
      contribution.objectId !== "" &&
      contribution.createdAt !== undefined &&
      contribution.createdAt !== "";
    const needsSession =
      contribution.actor?.actorType === "agent" && WRITABLE_OBJECTS.has(contribution.objectType);
    const hasSession =
      !needsSession ||
      (contribution.agentSessionId !== undefined && contribution.agentSessionId !== "");
    if (!hasCore || !hasSession) {
      provenanceOk = false;
      provenanceDetail = `contribution ${contribution.id} missing ${!hasCore ? "actor/workspace/object/time" : "agent session"}`;
      break;
    }
  }
  const provenanceComplete = check("provenance.complete", provenanceOk, provenanceDetail);

  const blob = JSON.stringify(snapshot);
  const leaked = hasForbiddenText(blob, forbidden);
  const noForbidden = check(
    "isolation.no-forbidden",
    leaked === undefined,
    leaked === undefined ? `checked ${forbidden.length} forbidden strings` : `forbidden string present: ${leaked}`,
  );

  return [
    findingMatchesFact,
    taskTruthful,
    artifactPresent,
    decisionProposed,
    summaryUseful,
    noDuplicates,
    noUnsupportedWrites,
    provenanceComplete,
    noForbidden,
  ];
}

const CORE_CHECKS: readonly string[] = [
  "contribution-accuracy.finding-matches-fact",
  "contribution-accuracy.task-truthful-terminal",
  "provenance.complete",
  "isolation.no-forbidden",
];

/** Single recoverable gaps that keep a CONDITIONAL GO open per the rubric. */
const CONDITIONAL_SINGLE_FAILURES: ReadonlySet<string> = new Set([
  "usefulness.summary-useful",
  "selectivity.no-duplicates",
  "contribution-accuracy.artifact-present",
  "contribution-accuracy.decision-proposed",
]);

/**
 * GO only when every check passes. CONDITIONAL GO when the correct durable
 * state reaches Campfire (core finding, truthful task, provenance, and
 * isolation hold) but exactly one recoverable gap remains: one clarification,
 * one duplicate/noisy write, or one omitted optional Artifact or proposed
 * Decision. Otherwise NO-GO / REFRAME.
 */
export function recommend011(checks: readonly Sprint011Check[]): Sprint011Recommendation {
  if (checks.length > 0 && checks.every((candidate) => candidate.passed)) return "GO";

  const byName = new Map(checks.map((candidate) => [candidate.name, candidate.passed]));
  const coreOk = CORE_CHECKS.every((name) => byName.get(name) === true);
  const failures = checks.filter((candidate) => !candidate.passed);
  if (coreOk && failures.length === 1 && CONDITIONAL_SINGLE_FAILURES.has(failures[0]!.name)) {
    return "CONDITIONAL GO";
  }
  return "NO-GO / REFRAME";
}
