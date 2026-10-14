/**
 * Pure RCL-001 assembly.
 *
 * SQLite and D1 both feed this function. It does not search, authorize, or
 * write. Cross-workspace ids are omitted here after a point lookup already
 * confirmed the workspace. Historical lifecycle is copied, never promoted.
 */
import type { Decision, Task } from "../domain/types.js";
import {
  RECALL_GOAL_TEXT_MAX_BYTES,
  RECALL_NAME_MAX_BYTES,
  RECALL_ORDERING_VERSION,
  RECALL_SCHEMA_VERSION,
  RECALL_TIERS,
  boundRecallText,
  boundedDecisionRationale,
  capIdList,
  capRecallResponse,
  cursorForHit,
  deriveDecisionSetState,
  finishRecallSection,
  matchedFieldName,
  matchingExcerpt,
  recallSourceCursor,
  recordedDecisionTransitions,
  type CampfireHandoffPacket,
  type HandoffAnchorPages,
  type HandoffRecord,
  type RecallCursor,
  type RecallDecisionSet,
  type RecallDecisionSetMember,
  type RecallHit,
  type RecallSection,
  type RecallSectionName,
  type WorkspaceRecall,
} from "../domain/recall.js";
import type {
  RecallCandidate,
  RecallDecisionSetPage,
  RecallGoalRow,
  RecallPage,
  RecallPageQuery,
} from "../store/recall-queries.js";
import { attachCitations } from "./correction-read.js";
import type { DecisionCitation } from "../domain/types.js";

export interface RecallLinkIndex {
  findingWorkspace: ReadonlyMap<string, string>;
  findingCurrentness: ReadonlyMap<string, string>;
  decisionWorkspace: ReadonlyMap<string, string>;
  artifactWorkspace: ReadonlyMap<string, string>;
  evidenceByFinding: ReadonlyMap<string, readonly string[]>;
  citationsByDecision: ReadonlyMap<string, readonly string[]>;
  staleFindingIds: ReadonlySet<string>;
}

export interface LoadedRecall {
  workspace: { id: string; name: string };
  generatedAt: string;
  sourcePosition: number;
  queryText: string;
  normalizedQuery: string;
  goal?: RecallGoalRow;
  current: RecallPage;
  historical: RecallPage;
  artifacts: RecallPage;
  decisionSet: RecallDecisionSetPage;
  /** Decision id to its cited finding ids that are no longer current. */
  staleByDecision: ReadonlyMap<string, readonly string[]>;
  links: RecallLinkIndex;
}

export function recallSectionRequest(
  section: RecallSectionName,
  normalizedQuery: string,
  limit: number,
  cursor: RecallCursor | undefined,
): RecallPageQuery {
  const request: RecallPageQuery = { normalizedQuery, limit };
  if (cursor?.section === section) {
    request.after = { tier: cursor.tier, at: cursor.at, id: cursor.id };
  }
  return request;
}

export function recallLookupIds(
  candidates: readonly RecallCandidate[],
  decisionSetMembers: readonly { id: string; predecessorId?: string; successorId?: string }[] = [],
): {
  pageFindingIds: string[];
  pageDecisionIds: string[];
  findingIds: string[];
  decisionIds: string[];
} {
  const findingIds = new Set<string>();
  const decisionIds = new Set<string>();
  const pageFindingIds: string[] = [];
  const pageDecisionIds: string[] = [];
  for (const candidate of candidates) {
    if (candidate.kind === "finding") {
      pageFindingIds.push(candidate.id);
      findingIds.add(candidate.id);
      if (candidate.predecessorId !== undefined) findingIds.add(candidate.predecessorId);
      if (candidate.successorId !== undefined) findingIds.add(candidate.successorId);
    } else if (candidate.kind === "decision") {
      pageDecisionIds.push(candidate.id);
      decisionIds.add(candidate.id);
      if (candidate.predecessorId !== undefined) decisionIds.add(candidate.predecessorId);
      if (candidate.successorId !== undefined) decisionIds.add(candidate.successorId);
    }
  }
  // Set members need their own citations and stale findings even when they did
  // not earn a page slot, and their links need the same workspace confirmation
  // the hits get. One extra hop either way; nothing expands transitively.
  for (const member of decisionSetMembers) {
    if (!pageDecisionIds.includes(member.id)) pageDecisionIds.push(member.id);
    decisionIds.add(member.id);
    if (member.predecessorId !== undefined) decisionIds.add(member.predecessorId);
    if (member.successorId !== undefined) decisionIds.add(member.successorId);
  }
  return {
    pageFindingIds,
    pageDecisionIds,
    findingIds: [...findingIds],
    decisionIds: [...decisionIds],
  };
}

export function buildRecallLinkIndex(input: {
  workspaceId: string;
  findings: readonly { id: string; workspaceId: string; currentness?: string }[];
  decisions: readonly { id: string; workspaceId: string }[];
  artifacts: readonly { id: string; workspaceId: string }[];
  evidence: readonly { workspaceId: string; findingId: string; artifactId: string }[];
  citations: readonly { workspaceId: string; decisionId: string; findingId: string }[];
  staleFindingIds: readonly string[];
}): RecallLinkIndex {
  const findingWorkspace = new Map<string, string>();
  const findingCurrentness = new Map<string, string>();
  for (const finding of input.findings) {
    findingWorkspace.set(finding.id, finding.workspaceId);
    if (finding.currentness !== undefined) findingCurrentness.set(finding.id, finding.currentness);
  }
  const decisionWorkspace = new Map(input.decisions.map((decision) => [decision.id, decision.workspaceId]));
  const artifactWorkspace = new Map(input.artifacts.map((artifact) => [artifact.id, artifact.workspaceId]));
  const evidenceByFinding = new Map<string, string[]>();
  for (const row of input.evidence) {
    if (row.workspaceId !== input.workspaceId) continue;
    const list = evidenceByFinding.get(row.findingId) ?? [];
    list.push(row.artifactId);
    evidenceByFinding.set(row.findingId, list);
  }
  const citationsByDecision = new Map<string, string[]>();
  for (const row of input.citations) {
    if (row.workspaceId !== input.workspaceId) continue;
    const list = citationsByDecision.get(row.decisionId) ?? [];
    list.push(row.findingId);
    citationsByDecision.set(row.decisionId, list);
  }
  return {
    findingWorkspace,
    findingCurrentness,
    decisionWorkspace,
    artifactWorkspace,
    evidenceByFinding,
    citationsByDecision,
    staleFindingIds: new Set(input.staleFindingIds),
  };
}

function confirmed(id: string | undefined, workspaceId: string, workspaces: ReadonlyMap<string, string>): string | undefined {
  if (id === undefined) return undefined;
  return workspaces.get(id) === workspaceId ? id : undefined;
}

function sameWorkspaceIds(ids: readonly string[], workspaceId: string, workspaces: ReadonlyMap<string, string>): string[] {
  return ids.filter((id) => workspaces.get(id) === workspaceId);
}

function hitFromCandidate(candidate: RecallCandidate, normalizedQuery: string, links: RecallLinkIndex, workspaceId: string): RecallHit {
  const secondary = candidate.tier % 2 === 1;
  const field = secondary ? "secondary" : "primary";
  const source = secondary ? (candidate.secondaryText ?? candidate.primaryText) : candidate.primaryText;
  const excerpt = matchingExcerpt(source, normalizedQuery);
  const predecessorWorkspace = candidate.kind === "decision" ? links.decisionWorkspace : links.findingWorkspace;
  const successorWorkspace = predecessorWorkspace;
  const predecessorId = confirmed(candidate.predecessorId, workspaceId, predecessorWorkspace);
  const successorId = confirmed(candidate.successorId, workspaceId, successorWorkspace);
  const evidenceIds = candidate.kind === "finding"
    ? sameWorkspaceIds(links.evidenceByFinding.get(candidate.id) ?? [], workspaceId, links.artifactWorkspace)
    : [];
  const basisIds = candidate.kind === "decision"
    ? sameWorkspaceIds(links.citationsByDecision.get(candidate.id) ?? [], workspaceId, links.findingWorkspace)
    : [];
  const evidence = capIdList(evidenceIds);
  const basis = capIdList(basisIds);
  const reviewIds = candidate.kind === "decision" && candidate.lifecycle !== "superseded"
    ? basisIds.filter((id) => links.staleFindingIds.has(id) && links.findingCurrentness.get(id) !== "current")
    : [];
  const review = capIdList(reviewIds);
  const relationshipIdsTruncated = evidence.truncated || basis.truncated || review.truncated;
  // For a decision the rcl-1 secondary field is the rationale column, so the
  // full stored rationale is already on the row whether or not the tier matched
  // it. Carrying it lets a caller state the operational constraint and cite this
  // hit's id in the same breath.
  const rationale = candidate.kind === "decision" ? boundedDecisionRationale(candidate.secondaryText) : {};
  return {
    kind: candidate.kind,
    id: candidate.id,
    tier: candidate.tier,
    matchedField: matchedFieldName(candidate.kind, field),
    excerpt: excerpt.excerpt,
    excerptTruncated: excerpt.truncated,
    lifecycle: candidate.lifecycle,
    ...rationale,
    provenance: {
      createdBy: { actorId: candidate.createdByActorId, actorType: candidate.createdByActorType },
      ...(candidate.agentSessionId === undefined ? {} : { agentSessionId: candidate.agentSessionId }),
      createdAt: candidate.createdAt,
    },
    ...(predecessorId === undefined ? {} : { predecessorId }),
    ...(successorId === undefined ? {} : { successorId }),
    ...(evidence.ids.length === 0 ? {} : { evidenceArtifactIds: evidence.ids }),
    ...(basis.ids.length === 0 ? {} : { basisFindingIds: basis.ids }),
    ...(relationshipIdsTruncated ? { relationshipIdsTruncated: true } : {}),
    ...(review.ids.length === 0 ? {} : { needsReview: true, needsReviewFindingIds: review.ids }),
  };
}

function sectionFromPage(
  section: RecallSectionName,
  page: RecallPage,
  loaded: LoadedRecall,
): RecallSection {
  const hits = page.items.map((candidate) => hitFromCandidate(candidate, loaded.normalizedQuery, loaded.links, loaded.workspace.id));
  const last = page.items[page.items.length - 1];
  const next = page.hasMore && last !== undefined
    ? cursorForHit(loaded.workspace.id, loaded.normalizedQuery, loaded.sourcePosition, section, hits[hits.length - 1]!, last.recency)
    : undefined;
  const total = Math.max(page.total, hits.length + (page.hasMore ? 1 : 0));
  return finishRecallSection(hits, total, next);
}

/**
 * Group every decision the query matches so two accepted decisions that
 * conflict are visible together instead of one hit at a time.
 *
 * Nothing here decides which decision governs. `deriveDecisionSetState` reads
 * recorded transitions only, and cross-workspace ids are dropped after a point
 * lookup confirmed the workspace.
 */
export function assembleDecisionSet(loaded: LoadedRecall): RecallDecisionSet {
  const page = loaded.decisionSet;
  const links = loaded.links;
  const members: RecallDecisionSetMember[] = page.members.map((row) => {
    const summary = boundRecallText(row.summary, RECALL_GOAL_TEXT_MAX_BYTES);
    const basis = capIdList(
      sameWorkspaceIds(links.citationsByDecision.get(row.id) ?? [], loaded.workspace.id, links.findingWorkspace),
    );
    // Same rule as the section hits: a superseded decision does not carry the
    // flag, and the cited finding must actually be non-current.
    const review = row.lifecycle === "superseded"
      ? { ids: [] as string[], truncated: false }
      : capIdList(
        (loaded.staleByDecision.get(row.id) ?? [])
          .filter((id) => links.findingWorkspace.get(id) === loaded.workspace.id)
          .filter((id) => links.findingCurrentness.get(id) !== "current"),
      );
    const predecessorId = confirmed(row.predecessorId, loaded.workspace.id, links.decisionWorkspace);
    const successorId = confirmed(row.successorId, loaded.workspace.id, links.decisionWorkspace);
    return {
      id: row.id,
      lifecycle: row.lifecycle,
      summary: summary.text ?? "",
      summaryTruncated: summary.truncated,
      ...boundedDecisionRationale(row.rationale),
      provenance: {
        createdBy: { actorId: row.createdByActorId, actorType: row.createdByActorType },
        ...(row.agentSessionId === undefined ? {} : { agentSessionId: row.agentSessionId }),
        createdAt: row.createdAt,
      },
      ...(predecessorId === undefined ? {} : { predecessorId }),
      ...(successorId === undefined ? {} : { successorId }),
      ...(basis.ids.length === 0 ? {} : { basisFindingIds: basis.ids }),
      ...(review.ids.length === 0 ? {} : { needsReview: true as const, needsReviewFindingIds: review.ids }),
      ...(basis.truncated || review.truncated ? { relationshipIdsTruncated: true as const } : {}),
    };
  });
  const truncated = members.length < page.total;
  const recordedTransitions = recordedDecisionTransitions(members);
  const verdict = deriveDecisionSetState({ members, recordedTransitions, truncated });
  return {
    members,
    total: page.total,
    returned: members.length,
    truncated,
    state: verdict.state,
    ...(verdict.operativeDecisionId === undefined ? {} : { operativeDecisionId: verdict.operativeDecisionId }),
    recordedTransitions,
    ...(verdict.beforeActing === undefined ? {} : { beforeActing: verdict.beforeActing }),
    ...(verdict.linkedNextStep === undefined ? {} : { linkedNextStep: verdict.linkedNextStep }),
  };
}

export function assembleRecall(loaded: LoadedRecall): WorkspaceRecall {
  const name = boundRecallText(loaded.workspace.name, RECALL_NAME_MAX_BYTES);
  const recency = new Map<string, string>();
  for (const [section, page] of [
    ["current", loaded.current],
    ["historical", loaded.historical],
    ["artifacts", loaded.artifacts],
  ] as const) {
    for (const item of page.items) recency.set(`${section}\0${item.id}`, item.recency);
  }
  const goal = loaded.goal === undefined ? undefined : goalFromRow(loaded.goal);
  const recall: WorkspaceRecall = {
    schemaVersion: RECALL_SCHEMA_VERSION,
    orderingVersion: RECALL_ORDERING_VERSION,
    ordering: { tiers: RECALL_TIERS, recency: "descending", id: "ascending" },
    query: { text: loaded.queryText, normalized: loaded.normalizedQuery },
    workspace: { id: loaded.workspace.id, name: name.text ?? "", nameTruncated: name.truncated },
    generatedAt: loaded.generatedAt,
    sourceCursor: recallSourceCursor(loaded.workspace.id, loaded.sourcePosition),
    sourcePosition: loaded.sourcePosition,
    ...(goal === undefined ? {} : { goal }),
    current: sectionFromPage("current", loaded.current, loaded),
    historical: sectionFromPage("historical", loaded.historical, loaded),
    artifacts: sectionFromPage("artifacts", loaded.artifacts, loaded),
    decisionSet: assembleDecisionSet(loaded),
    completeness: {
      fullHistoryIncluded: false,
      responseTruncated: false,
      drillDown: "get_decision, get_finding, get_task, get_artifact, list_decisions, list_findings, list_tasks, list_artifacts",
      catchUp: "get_workspace_changes",
    },
  };
  return capRecallResponse(recall, (section, hit) => {
    const at = recency.get(`${section}\0${hit.id}`);
    if (at === undefined) {
      throw new Error(`Recall cursor is missing recency for ${section} ${hit.id}`);
    }
    return cursorForHit(loaded.workspace.id, loaded.normalizedQuery, loaded.sourcePosition, section, hit, at);
  });
}

function goalFromRow(row: RecallGoalRow): WorkspaceRecall["goal"] {
  const title = boundRecallText(row.title, RECALL_GOAL_TEXT_MAX_BYTES);
  const description = boundRecallText(row.description, RECALL_GOAL_TEXT_MAX_BYTES);
  return {
    id: row.id,
    title: title.text ?? "",
    ...(description.text === undefined ? {} : { description: description.text }),
    status: row.status,
    matched: row.matched,
    textTruncated: title.truncated || description.truncated,
  };
}

function provenanceOf(record: { createdBy: Task["createdBy"]; agentSessionId?: string; createdAt: string }): HandoffRecord["provenance"] {
  return {
    createdBy: record.createdBy,
    ...(record.agentSessionId === undefined ? {} : { agentSessionId: record.agentSessionId }),
    createdAt: record.createdAt,
  };
}

export function handoffAnchorFromTask(task: Task): HandoffRecord {
  const text = boundRecallText(task.title, RECALL_GOAL_TEXT_MAX_BYTES);
  return {
    section: "anchor",
    kind: "task",
    id: task.id,
    lifecycle: task.status,
    text: text.text ?? "",
    textTruncated: text.truncated,
    provenance: provenanceOf(task),
  };
}

export function handoffAnchorFromDecision(
  decision: Decision,
  workspaceId: string,
  findingWorkspace: ReadonlyMap<string, string>,
  decisionWorkspace: ReadonlyMap<string, string>,
): HandoffRecord {
  const text = boundRecallText(decision.summary, RECALL_GOAL_TEXT_MAX_BYTES);
  const rationale = boundedDecisionRationale(decision.rationale);
  const basis = capIdList(
    (decision.citations ?? []).map((citation) => citation.findingId).filter((id) => findingWorkspace.get(id) === workspaceId),
  );
  const review = decision.status === "superseded"
    ? { ids: [] as string[], truncated: false }
    : capIdList((decision.needsReviewFindingIds ?? []).filter((id) => findingWorkspace.get(id) === workspaceId));
  const predecessorId = decision.predecessorId !== undefined && decisionWorkspace.get(decision.predecessorId) === workspaceId
    ? decision.predecessorId
    : undefined;
  const successorId = decision.successorId !== undefined && decisionWorkspace.get(decision.successorId) === workspaceId
    ? decision.successorId
    : undefined;
  return {
    section: "anchor",
    kind: "decision",
    id: decision.id,
    lifecycle: decision.status,
    text: text.text ?? "",
    textTruncated: text.truncated,
    provenance: provenanceOf(decision),
    ...rationale,
    ...(predecessorId === undefined ? {} : { predecessorId }),
    ...(successorId === undefined ? {} : { successorId }),
    ...(basis.ids.length === 0 ? {} : { basisFindingIds: basis.ids }),
    ...(basis.truncated || review.truncated ? { relationshipIdsTruncated: true } : {}),
    ...(review.ids.length === 0 ? {} : { needsReview: true as const, needsReviewFindingIds: review.ids }),
  };
}

export function assembleHandoffAnchors(input: {
  workspaceId: string;
  openTasks: readonly Task[];
  openTotal: number;
  blockedTasks: readonly Task[];
  blockedTotal: number;
  proposed: readonly Decision[];
  proposedTotal: number;
  accepted: readonly Decision[];
  acceptedTotal: number;
  citations: readonly DecisionCitation[];
  staleFindingIds: readonly string[];
  findings: readonly { id: string; workspaceId: string }[];
  decisions: readonly { id: string; workspaceId: string }[];
}): HandoffAnchorPages {
  const findingWorkspace = new Map(input.findings.map((finding) => [finding.id, finding.workspaceId]));
  const decisionWorkspace = new Map(input.decisions.map((decision) => [decision.id, decision.workspaceId]));
  const decorated = attachCitations(
    [...input.proposed, ...input.accepted],
    input.citations,
    new Set(input.staleFindingIds),
  );
  const byId = new Map(decorated.map((decision) => [decision.id, decision]));
  const proposed = input.proposed.map((decision) => byId.get(decision.id) ?? decision);
  const accepted = input.accepted.map((decision) => byId.get(decision.id) ?? decision);
  const count = (total: number, returned: number): CampfireHandoffPacket["completeness"]["anchors"]["openTasks"] => ({
    total,
    returned,
    truncated: returned < total,
  });
  return {
    openTasks: input.openTasks.map(handoffAnchorFromTask),
    blockedTasks: input.blockedTasks.map(handoffAnchorFromTask),
    proposedDecisions: proposed.map((decision) => handoffAnchorFromDecision(decision, input.workspaceId, findingWorkspace, decisionWorkspace)),
    acceptedDecisions: accepted.map((decision) => handoffAnchorFromDecision(decision, input.workspaceId, findingWorkspace, decisionWorkspace)),
    counts: {
      openTasks: count(input.openTotal, input.openTasks.length),
      blockedTasks: count(input.blockedTotal, input.blockedTasks.length),
      proposedDecisions: count(input.proposedTotal, input.proposed.length),
      acceptedDecisions: count(input.acceptedTotal, input.accepted.length),
    },
  };
}

export function anchorLookupIds(
  decisions: readonly { predecessorId?: string; successorId?: string }[],
  citations: readonly { findingId: string }[],
  staleFindingIds: readonly string[],
): { findingIds: string[]; decisionIds: string[] } {
  const findingIds = new Set<string>(staleFindingIds);
  const decisionIds = new Set<string>();
  for (const decision of decisions) {
    if (decision.predecessorId !== undefined) decisionIds.add(decision.predecessorId);
    if (decision.successorId !== undefined) decisionIds.add(decision.successorId);
  }
  for (const citation of citations) findingIds.add(citation.findingId);
  return { findingIds: [...findingIds], decisionIds: [...decisionIds] };
}
