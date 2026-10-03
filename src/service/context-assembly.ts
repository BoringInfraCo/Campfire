/**
 * Turns bounded store pages into one WorkspaceContext.
 *
 * Sync and async services both call this after they authorize and fetch.
 * Ranking stays in the domain policy and the shared SQL. This file only
 * assembles the response.
 */
import { CONTEXT_SCHEMA_VERSION, toContextSlice, type ChangeSummary, type ContextBudget } from "../domain/context-policy.js";
import type { Artifact, Contribution, Decision, Finding, Goal, Task, Workspace } from "../domain/types.js";
import type {
  AttentionItem,
  CurrentWork,
  ParticipantView,
  RecordedAlignment,
  SinceProjection,
  SuggestedNextAction,
  WorkspaceContext,
} from "./service.js";

export interface BoundedSection<T> {
  items: readonly T[];
  total: number;
  nextCursor?: string;
}

export interface OrientationAssembly {
  workspace: Workspace;
  goal?: Goal;
  participants: ParticipantView[];
  generatedAt: string;
  budget: ContextBudget;
  orientationCursor: string;
  decisions: BoundedSection<Decision>;
  findings: BoundedSection<Finding>;
  tasks: BoundedSection<Task>;
  blockers: BoundedSection<Task>;
  artifacts: BoundedSection<Artifact>;
  recentChanges: BoundedSection<ChangeSummary>;
  provenance: Contribution[];
  provenanceTotal: number;
  provenanceSummary: string[];
  needsYou: AttentionItem[];
  needsAttention: AttentionItem[];
  currentWork: CurrentWork;
  suggestedNextAction: SuggestedNextAction;
  alignment: RecordedAlignment;
  since?: SinceProjection;
}

export function assembleWorkspaceContext(parts: OrientationAssembly): WorkspaceContext {
  const decisions = toContextSlice(parts.decisions.items, parts.decisions.total, parts.decisions.nextCursor);
  const findings = toContextSlice(parts.findings.items, parts.findings.total, parts.findings.nextCursor);
  const tasks = toContextSlice(parts.tasks.items, parts.tasks.total, parts.tasks.nextCursor);
  const blockers = toContextSlice(parts.blockers.items, parts.blockers.total, parts.blockers.nextCursor);
  const artifacts = toContextSlice(parts.artifacts.items, parts.artifacts.total, parts.artifacts.nextCursor);
  const recentChanges = toContextSlice(
    parts.recentChanges.items,
    parts.recentChanges.total,
    parts.recentChanges.nextCursor,
  );
  const context: WorkspaceContext = {
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    generatedAt: parts.generatedAt,
    orientationCursor: parts.orientationCursor,
    completeness: { fullHistoryIncluded: false, drillDownAvailable: true },
    slices: { decisions, findings, tasks, blockers, artifacts, recentChanges },
    budget: parts.budget,
    workspace: parts.workspace,
    participants: parts.participants,
    proposedDecisions: decisions.items.filter((decision) => decision.status === "proposed"),
    acceptedDecisions: decisions.items.filter((decision) => decision.status === "accepted"),
    // Superseded decisions stay on the drill-down list. Orientation does not replay them.
    supersededDecisions: [],
    openTasks: tasks.items.filter((task) => task.status !== "completed"),
    findings: findings.items,
    artifacts: artifacts.items,
    provenance: parts.provenance,
    provenanceTotal: parts.provenanceTotal,
    provenanceTruncated: parts.provenance.length < parts.provenanceTotal,
    needsYou: parts.needsYou,
    needsAttention: parts.needsAttention,
    currentWork: parts.currentWork,
    suggestedNextAction: parts.suggestedNextAction,
    alignment: parts.alignment,
    provenanceSummary: parts.provenanceSummary,
  };
  if (parts.goal !== undefined) context.goal = parts.goal;
  if (parts.since !== undefined) context.since = parts.since;
  return context;
}
