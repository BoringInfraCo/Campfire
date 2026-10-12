/**
 * RCL-001 read orchestration.
 *
 * Authorization stays in the service. This module freezes the contribution
 * cursor, reads one page per section, and confirms relationship ids. The sync
 * function runs inside a SQLite snapshot. The async function reads the append
 * position before and after and discards the page when it moved. Neither
 * function writes a contribution.
 */
import { RecallRestart, WorkspaceNotFound } from "../domain/errors.js";
import {
  HANDOFF_ANCHOR_LIMIT,
  RECALL_DECISION_SET_LIMIT,
  assertRecallCursorPosition,
  type HandoffAnchorPages,
  type RecallCursor,
  type WorkspaceRecall,
} from "../domain/recall.js";
import type { Artifact, Decision, DecisionCitation, Finding, FindingEvidence, Task, Workspace } from "../domain/types.js";
import type { ObjectPage } from "../store/context-queries.js";
import type {
  RecallDecisionSetPage,
  RecallDecisionSetQuery,
  RecallGoalRow,
  RecallPage,
  RecallPageQuery,
} from "../store/recall-queries.js";
import type { RecallSectionName } from "../domain/recall.js";
import {
  anchorLookupIds,
  assembleHandoffAnchors,
  assembleRecall,
  buildRecallLinkIndex,
  recallLookupIds,
  recallSectionRequest,
} from "./recall-assembly.js";

export interface RecallReadInput {
  workspaceId: string;
  queryText: string;
  normalizedQuery: string;
  limit: number;
  cursor?: RecallCursor;
  generatedAt: string;
  includeAnchors: boolean;
}

export interface RecallProjection {
  recall: WorkspaceRecall;
  anchors?: HandoffAnchorPages;
  /** Decision id to stored rationale. Used only when fitting a handoff packet. */
  decisionRationales: ReadonlyMap<string, string>;
}

interface RecallOps {
  maxAppendPosition(workspaceId: string): number;
  getWorkspace(id: string): Workspace | undefined;
  recallGoal(workspaceId: string, normalizedQuery: string): RecallGoalRow | undefined;
  recallSection(workspaceId: string, section: RecallSectionName, query: RecallPageQuery): RecallPage;
  recallDecisionSet(workspaceId: string, query: RecallDecisionSetQuery): RecallDecisionSetPage;
  listFindingEvidence(findingIds: readonly string[]): FindingEvidence[];
  listDecisionCitations(decisionIds: readonly string[]): DecisionCitation[];
  listStaleCitedFindingIds(decisionIds: readonly string[]): string[];
  getFinding(id: string): Finding | undefined;
  getDecision(id: string): Decision | undefined;
  getArtifact(id: string): Artifact | undefined;
  pageTasks(workspaceId: string, query: { limit: number; statuses: Array<"open" | "blocked"> }): ObjectPage<Task>;
  pageDecisions(workspaceId: string, query: { limit: number; statuses: Array<"proposed" | "accepted"> }): ObjectPage<Decision>;
}

interface AsyncRecallOps {
  maxAppendPosition(workspaceId: string): Promise<number>;
  getWorkspace(id: string): Promise<Workspace | undefined>;
  recallGoal(workspaceId: string, normalizedQuery: string): Promise<RecallGoalRow | undefined>;
  recallSection(workspaceId: string, section: RecallSectionName, query: RecallPageQuery): Promise<RecallPage>;
  recallDecisionSet(workspaceId: string, query: RecallDecisionSetQuery): Promise<RecallDecisionSetPage>;
  listFindingEvidence(findingIds: readonly string[]): Promise<FindingEvidence[]>;
  listDecisionCitations(decisionIds: readonly string[]): Promise<DecisionCitation[]>;
  listStaleCitedFindingIds(decisionIds: readonly string[]): Promise<string[]>;
  getFinding(id: string): Promise<Finding | undefined>;
  getDecision(id: string): Promise<Decision | undefined>;
  getArtifact(id: string): Promise<Artifact | undefined>;
  pageTasks(workspaceId: string, query: { limit: number; statuses: Array<"open" | "blocked"> }): Promise<ObjectPage<Task>>;
  pageDecisions(workspaceId: string, query: { limit: number; statuses: Array<"proposed" | "accepted"> }): Promise<ObjectPage<Decision>>;
}

function decisionRationaleMap(current: RecallPage, historical: RecallPage): Map<string, string> {
  const map = new Map<string, string>();
  for (const page of [current, historical]) {
    for (const item of page.items) {
      if (item.kind === "decision" && item.secondaryText !== undefined && item.secondaryText.length > 0) {
        map.set(item.id, item.secondaryText);
      }
    }
  }
  return map;
}

function present<T>(rows: readonly (T | undefined)[]): T[] {
  return rows.filter((row): row is T => row !== undefined);
}

/** Which of each decision's cited findings are no longer current. */
function staleByDecision(
  citations: readonly DecisionCitation[],
  staleFindingIds: readonly string[],
): Map<string, readonly string[]> {
  const stale = new Set(staleFindingIds);
  const map = new Map<string, string[]>();
  for (const citation of citations) {
    if (!stale.has(citation.findingId)) continue;
    const list = map.get(citation.decisionId) ?? [];
    list.push(citation.findingId);
    map.set(citation.decisionId, list);
  }
  return map;
}

function finish(input: RecallReadInput, workspace: Workspace, sourcePosition: number, pages: {
  goal?: RecallGoalRow;
  current: RecallPage;
  historical: RecallPage;
  artifacts: RecallPage;
  decisionSet: RecallDecisionSetPage;
  findings: readonly Finding[];
  decisions: readonly Decision[];
  artifactsFound: readonly Artifact[];
  evidence: readonly FindingEvidence[];
  citations: readonly DecisionCitation[];
  staleFindingIds: readonly string[];
}, anchors?: HandoffAnchorPages): RecallProjection {
  const links = buildRecallLinkIndex({
    workspaceId: workspace.id,
    findings: inputFindings(pages.findings),
    decisions: pages.decisions,
    artifacts: pages.artifactsFound,
    evidence: pages.evidence,
    citations: pages.citations,
    staleFindingIds: pages.staleFindingIds,
  });
  return {
    decisionRationales: decisionRationaleMap(pages.current, pages.historical),
    recall: assembleRecall({
      workspace: { id: workspace.id, name: workspace.name },
      generatedAt: input.generatedAt,
      sourcePosition,
      queryText: input.queryText,
      normalizedQuery: input.normalizedQuery,
      ...(pages.goal === undefined ? {} : { goal: pages.goal }),
      current: pages.current,
      historical: pages.historical,
      artifacts: pages.artifacts,
      decisionSet: pages.decisionSet,
      staleByDecision: staleByDecision(pages.citations, pages.staleFindingIds),
      links,
    }),
    ...(anchors === undefined ? {} : { anchors }),
  };
}

function inputFindings(findings: readonly Finding[]): Array<{ id: string; workspaceId: string; currentness?: string }> {
  return findings.map((finding) => ({
    id: finding.id,
    workspaceId: finding.workspaceId,
    ...(finding.currentness === undefined ? {} : { currentness: finding.currentness }),
  }));
}

/** Synchronous read. Call inside `store.transaction` so the two position reads share one snapshot. */
export function projectRecall(ops: RecallOps, input: RecallReadInput): RecallProjection {
  const position = ops.maxAppendPosition(input.workspaceId);
  if (input.cursor !== undefined) assertRecallCursorPosition(input.cursor, position, input.workspaceId);
  const workspace = ops.getWorkspace(input.workspaceId);
  if (workspace === undefined) throw new WorkspaceNotFound(input.workspaceId);
  const current = ops.recallSection(input.workspaceId, "current", recallSectionRequest("current", input.normalizedQuery, input.limit, input.cursor));
  const historical = ops.recallSection(input.workspaceId, "historical", recallSectionRequest("historical", input.normalizedQuery, input.limit, input.cursor));
  const artifacts = ops.recallSection(input.workspaceId, "artifacts", recallSectionRequest("artifacts", input.normalizedQuery, input.limit, input.cursor));
  const goal = ops.recallGoal(input.workspaceId, input.normalizedQuery);
  // Read after the sections so the set is a superset view of the same query,
  // not a third ranking. The limit is the contract's set bound, not the
  // caller's page limit.
  const decisionSet = ops.recallDecisionSet(input.workspaceId, {
    normalizedQuery: input.normalizedQuery,
    limit: RECALL_DECISION_SET_LIMIT,
  });
  const candidates = [...current.items, ...historical.items, ...artifacts.items];
  const lookup = recallLookupIds(candidates, decisionSet.members);
  const evidence = ops.listFindingEvidence(lookup.pageFindingIds);
  const citations = ops.listDecisionCitations(lookup.pageDecisionIds);
  const staleFindingIds = ops.listStaleCitedFindingIds(lookup.pageDecisionIds);
  const findingIds = new Set(lookup.findingIds);
  for (const citation of citations) findingIds.add(citation.findingId);
  for (const id of staleFindingIds) findingIds.add(id);
  const findings = present([...findingIds].map((id) => ops.getFinding(id)));
  const decisions = present([...lookup.decisionIds].map((id) => ops.getDecision(id)));
  const artifactsFound = present([...new Set(evidence.map((row) => row.artifactId))].map((id) => ops.getArtifact(id)));
  const anchors = input.includeAnchors ? readAnchors(ops, input.workspaceId) : undefined;
  const again = ops.maxAppendPosition(input.workspaceId);
  if (again !== position) throw new RecallRestart(input.workspaceId);
  return finish(input, workspace, position, {
    ...(goal === undefined ? {} : { goal }),
    current,
    historical,
    artifacts,
    decisionSet,
    findings,
    decisions,
    artifactsFound,
    evidence,
    citations,
    staleFindingIds,
  }, anchors);
}

function readAnchors(ops: RecallOps, workspaceId: string): HandoffAnchorPages {
  const open = ops.pageTasks(workspaceId, { limit: HANDOFF_ANCHOR_LIMIT, statuses: ["open"] });
  const blocked = ops.pageTasks(workspaceId, { limit: HANDOFF_ANCHOR_LIMIT, statuses: ["blocked"] });
  const proposed = ops.pageDecisions(workspaceId, { limit: HANDOFF_ANCHOR_LIMIT, statuses: ["proposed"] });
  const accepted = ops.pageDecisions(workspaceId, { limit: HANDOFF_ANCHOR_LIMIT, statuses: ["accepted"] });
  const listed = [...proposed.items, ...accepted.items];
  const ids = listed.map((decision) => decision.id);
  const citations = ops.listDecisionCitations(ids);
  const staleFindingIds = ops.listStaleCitedFindingIds(ids);
  const lookup = anchorLookupIds(listed, citations, staleFindingIds);
  return assembleHandoffAnchors({
    workspaceId,
    openTasks: open.items,
    openTotal: open.total,
    blockedTasks: blocked.items,
    blockedTotal: blocked.total,
    proposed: proposed.items,
    proposedTotal: proposed.total,
    accepted: accepted.items,
    acceptedTotal: accepted.total,
    citations,
    staleFindingIds,
    findings: present(lookup.findingIds.map((id) => ops.getFinding(id))),
    decisions: present(lookup.decisionIds.map((id) => ops.getDecision(id))),
  });
}

/** Async read for D1. A moved append position throws and returns nothing. */
export async function projectRecallAsync(ops: AsyncRecallOps, input: RecallReadInput): Promise<RecallProjection> {
  const position = await ops.maxAppendPosition(input.workspaceId);
  if (input.cursor !== undefined) assertRecallCursorPosition(input.cursor, position, input.workspaceId);
  const workspace = await ops.getWorkspace(input.workspaceId);
  if (workspace === undefined) throw new WorkspaceNotFound(input.workspaceId);
  const current = await ops.recallSection(input.workspaceId, "current", recallSectionRequest("current", input.normalizedQuery, input.limit, input.cursor));
  const historical = await ops.recallSection(input.workspaceId, "historical", recallSectionRequest("historical", input.normalizedQuery, input.limit, input.cursor));
  const artifacts = await ops.recallSection(input.workspaceId, "artifacts", recallSectionRequest("artifacts", input.normalizedQuery, input.limit, input.cursor));
  const goal = await ops.recallGoal(input.workspaceId, input.normalizedQuery);
  const decisionSet = await ops.recallDecisionSet(input.workspaceId, {
    normalizedQuery: input.normalizedQuery,
    limit: RECALL_DECISION_SET_LIMIT,
  });
  const candidates = [...current.items, ...historical.items, ...artifacts.items];
  const lookup = recallLookupIds(candidates, decisionSet.members);
  const evidence = await ops.listFindingEvidence(lookup.pageFindingIds);
  const citations = await ops.listDecisionCitations(lookup.pageDecisionIds);
  const staleFindingIds = await ops.listStaleCitedFindingIds(lookup.pageDecisionIds);
  const findingIds = new Set(lookup.findingIds);
  for (const citation of citations) findingIds.add(citation.findingId);
  for (const id of staleFindingIds) findingIds.add(id);
  const findings = present(await Promise.all([...findingIds].map((id) => ops.getFinding(id))));
  const decisions = present(await Promise.all([...lookup.decisionIds].map((id) => ops.getDecision(id))));
  const artifactsFound = present(await Promise.all([...new Set(evidence.map((row) => row.artifactId))].map((id) => ops.getArtifact(id))));
  const anchors = input.includeAnchors ? await readAnchorsAsync(ops, input.workspaceId) : undefined;
  const again = await ops.maxAppendPosition(input.workspaceId);
  if (again !== position) throw new RecallRestart(input.workspaceId);
  return finish(input, workspace, position, {
    ...(goal === undefined ? {} : { goal }),
    current,
    historical,
    artifacts,
    decisionSet,
    findings,
    decisions,
    artifactsFound,
    evidence,
    citations,
    staleFindingIds,
  }, anchors);
}

async function readAnchorsAsync(ops: AsyncRecallOps, workspaceId: string): Promise<HandoffAnchorPages> {
  const open = await ops.pageTasks(workspaceId, { limit: HANDOFF_ANCHOR_LIMIT, statuses: ["open"] });
  const blocked = await ops.pageTasks(workspaceId, { limit: HANDOFF_ANCHOR_LIMIT, statuses: ["blocked"] });
  const proposed = await ops.pageDecisions(workspaceId, { limit: HANDOFF_ANCHOR_LIMIT, statuses: ["proposed"] });
  const accepted = await ops.pageDecisions(workspaceId, { limit: HANDOFF_ANCHOR_LIMIT, statuses: ["accepted"] });
  const listed = [...proposed.items, ...accepted.items];
  const ids = listed.map((decision) => decision.id);
  const citations = await ops.listDecisionCitations(ids);
  const staleFindingIds = await ops.listStaleCitedFindingIds(ids);
  const lookup = anchorLookupIds(listed, citations, staleFindingIds);
  const findings = present(await Promise.all(lookup.findingIds.map((id) => ops.getFinding(id))));
  const decisions = present(await Promise.all(lookup.decisionIds.map((id) => ops.getDecision(id))));
  return assembleHandoffAnchors({
    workspaceId,
    openTasks: open.items,
    openTotal: open.total,
    blockedTasks: blocked.items,
    blockedTotal: blocked.total,
    proposed: proposed.items,
    proposedTotal: proposed.total,
    accepted: accepted.items,
    acceptedTotal: accepted.total,
    citations,
    staleFindingIds,
    findings,
    decisions,
  });
}
