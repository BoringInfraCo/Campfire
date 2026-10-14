/**
 * Recall and handoff projection.
 *
 * This module is the frozen selection and packet rule. CLI, MCP, local HTTP,
 * and the Worker call it. They do not grow a second ranker. SQLite and D1
 * execute the same normalization in `src/store/recall-queries.ts`.
 *
 * RCL-003 adds `decisionSet` (schema version 2). The set groups every decision
 * the same query matches so a caller can see that two accepted decisions
 * conflict, and it is derived from recorded transitions only. Campfire never
 * infers an operative decision from position, recency, authorship, or
 * `needsReview`. Ordering is untouched: `rcl-1` still ranks the section hits,
 * and the set is neither ranked nor paginated.
 *
 * Ordering version `rcl-1`:
 * 1. tier ascending — exact primary, exact secondary, prefix primary,
 *    prefix secondary, substring primary, substring secondary
 * 2. recency descending (updated_at for tasks and decisions, created_at for
 *    findings and artifacts)
 * 3. id ascending
 *
 * Recency breaks ties. It does not decide which text is current. A superseded
 * finding stays historical even when it is the newest match. Normalization is
 * ASCII A-Z casefold, the whitespace set tab/LF/VT/FF/CR collapsed with the
 * same non-overlapping pass count SQLite `replace` uses, then ASCII-space trim.
 * SQLite has no NFKC fold that D1 can share, so this version does not use one.
 */
import { contributionCursor, encodeContextCursor } from "./context-policy.js";
import { RecallRestart, ValidationError } from "./errors.js";
import type { ActorRef, ActorType, GoalStatus } from "./types.js";

export const RECALL_SCHEMA_VERSION = 2 as const;
export const RECALL_ORDERING_VERSION = "rcl-1" as const;
export const HANDOFF_PACKET_SCHEMA_VERSION = 2 as const;
export const RECALL_DEFAULT_LIMIT = 20;
export const RECALL_MAX_LIMIT = 50;
export const RECALL_QUERY_MAX_CHARS = 200;
export const RECALL_EXCERPT_MAX_BYTES = 240;
export const RECALL_GOAL_TEXT_MAX_BYTES = 1024;
export const RECALL_NAME_MAX_BYTES = 256;
export const RECALL_RESPONSE_MAX_BYTES = 48 * 1024;
export const HANDOFF_PACKET_MAX_BYTES = 64 * 1024;
export const HANDOFF_ANCHOR_LIMIT = 10;
/** Decision rationale is separate from the query excerpt. The summary can match while the operational constraint sits only in the rationale. */
export const HANDOFF_RATIONALE_MAX_BYTES = 1024;
/** Decision-set members. Independent of `limit` and `cursor`: paging the sections never changes the set. */
export const RECALL_DECISION_SET_LIMIT = 10;
export const RECALL_RELATIONSHIP_LIMIT = 20;

/**
 * The only sentence Campfire produces about an unresolved decision set. It is
 * frozen here so it is written by the same rule on SQLite and D1, and so it is
 * never model-generated. It states the boundary and the two recorded ways out;
 * it does not choose a rule.
 */
export const DECISION_SET_UNRESOLVED_NEXT_STEP =
  "Campfire has not selected an operative decision. Do not execute either rule. Seek a recorded retirement of one accepted decision, or an accepted replacement that names its predecessor and is accepted with a reason." as const;

/**
 * The companion sentence for a set that already has a recorded transition.
 *
 * MCP instructions already told matched arms to follow the recorded successor.
 * The scored offline packet lacked that guidance, and its recipient promoted a
 * superseded rationale into a live condition. A recorded transition makes the
 * predecessor's own text historical, so the packet now says so explicitly.
 */
export const DECISION_SET_LINKED_NEXT_STEP =
  "A recorded transition already selects the operative decision in this set. Follow operativeDecisionId. Do not ask for another transition, and do not apply any condition that appears only in a superseded decision's summary or rationale." as const;
/** Matches the SQL `replace('  ', ' ')` pass count. Runs longer than 2^16 spaces stay partially collapsed on both sides. */
export const RECALL_SPACE_COLLAPSE_PASSES = 16;

const WHITESPACE_CODES = new Set([9, 10, 11, 12, 13]);

export const RECALL_TIERS = [
  "exact-primary",
  "exact-secondary",
  "prefix-primary",
  "prefix-secondary",
  "substring-primary",
  "substring-secondary",
] as const;

export type RecallSectionName = "current" | "historical" | "artifacts";
export type RecallKind = "task" | "finding" | "decision" | "artifact";
export type RecallMatchedField = "title" | "description" | "summary" | "detail" | "rationale" | "type";

export interface RecallProvenance {
  createdBy: ActorRef;
  agentSessionId?: string;
  createdAt: string;
}

export interface RecallHit {
  kind: RecallKind;
  id: string;
  tier: number;
  matchedField: RecallMatchedField;
  excerpt: string;
  excerptTruncated: boolean;
  /** Exact stored lifecycle. Tasks and decisions use status. Findings use currentness. Artifacts use type. */
  lifecycle: string;
  provenance: RecallProvenance;
  /**
   * Bounded stored decision rationale. Decision hits only, and separate from
   * the excerpt: a summary can match while the operational constraint sits only
   * in the rationale. Added in schema version 2.
   */
  rationale?: string;
  rationaleTruncated?: true;
  predecessorId?: string;
  successorId?: string;
  evidenceArtifactIds?: string[];
  basisFindingIds?: string[];
  relationshipIdsTruncated?: true;
  needsReview?: true;
  needsReviewFindingIds?: string[];
}

/** A recorded supersession whose two ends are both members of the returned set. */
export interface RecallDecisionTransition {
  supersededDecisionId: string;
  supersedingDecisionId: string;
}

export type RecallDecisionSetState =
  | "no-accepted-decision"
  | "single-accepted-decision"
  | "linked-accepted-decisions"
  | "unresolved-accepted-decisions"
  | "truncated";

export interface RecallDecisionSetMember {
  id: string;
  /** Exact stored decision status. */
  lifecycle: string;
  /** Bounded decision summary. Separate from the query excerpt. */
  summary: string;
  summaryTruncated: boolean;
  /** Bounded stored rationale when the decision has one. */
  rationale?: string;
  rationaleTruncated?: true;
  provenance: RecallProvenance;
  predecessorId?: string;
  successorId?: string;
  basisFindingIds?: string[];
  needsReview?: true;
  needsReviewFindingIds?: string[];
  relationshipIdsTruncated?: true;
}

export interface RecallDecisionSet {
  members: RecallDecisionSetMember[];
  total: number;
  returned: number;
  truncated: boolean;
  state: RecallDecisionSetState;
  /** Sole accepted survivor among query-matched members only; not a workspace-wide decision claim. */
  operativeDecisionId?: string;
  recordedTransitions: RecallDecisionTransition[];
  /** Present when `state` is `unresolved-accepted-decisions` or `truncated`. */
  beforeActing?: typeof DECISION_SET_UNRESOLVED_NEXT_STEP;
  /** Present when `state` is `linked-accepted-decisions`. */
  linkedNextStep?: typeof DECISION_SET_LINKED_NEXT_STEP;
}

export interface RecallSection {
  items: RecallHit[];
  total: number;
  returned: number;
  truncated: boolean;
  nextCursor?: string;
}

export interface RecallGoal {
  id: string;
  title: string;
  description?: string;
  status: GoalStatus;
  matched: boolean;
  textTruncated: boolean;
}

export interface WorkspaceRecall {
  schemaVersion: typeof RECALL_SCHEMA_VERSION;
  orderingVersion: typeof RECALL_ORDERING_VERSION;
  ordering: {
    tiers: typeof RECALL_TIERS;
    recency: "descending";
    id: "ascending";
  };
  query: { text: string; normalized: string };
  workspace: { id: string; name: string; nameTruncated: boolean };
  generatedAt: string;
  /** Contribution cursor at the frozen append position. Catch-up reads strictly after it. */
  sourceCursor: string;
  sourcePosition: number;
  goal?: RecallGoal;
  current: RecallSection;
  historical: RecallSection;
  artifacts: RecallSection;
  /**
   * Every decision this query matches, grouped. Independent of `limit` and
   * `cursor`. Added in schema version 2. Absent only when the caller asked for
   * a workspace with no matching decision, in which case `members` is empty
   * and `state` is `no-accepted-decision`.
   */
  decisionSet?: RecallDecisionSet;
  completeness: {
    fullHistoryIncluded: false;
    responseTruncated: boolean;
    drillDown: "get_decision, get_finding, get_task, get_artifact, list_decisions, list_findings, list_tasks, list_artifacts";
    catchUp: "get_workspace_changes";
  };
}

export interface HandoffActor {
  actorId: string;
  actorType: ActorType;
}

export interface HandoffRecord {
  section: RecallSectionName | "anchor" | "decision-set";
  kind: RecallKind | "task" | "decision";
  id: string;
  lifecycle: string;
  text: string;
  textTruncated: boolean;
  provenance: RecallProvenance;
  predecessorId?: string;
  successorId?: string;
  evidenceArtifactIds?: string[];
  basisFindingIds?: string[];
  relationshipIdsTruncated?: true;
  needsReview?: true;
  needsReviewFindingIds?: string[];
  /** Set for a decision that has a rationale. Bounded, and separate from the query excerpt. */
  rationale?: string;
  rationaleTruncated?: true;
  /**
   * Set only on a superseded decision-set member. States that the member's own
   * summary and rationale are historical explanation, not a current condition.
   * A superseded member never carries `rationale`; see `handoffDecisionSetMembers`.
   */
  historicalExplanation?: string;
}

export interface HandoffCount {
  total: number;
  returned: number;
  truncated: boolean;
}

/**
 * The decision set carried offline. `members` uses `HandoffRecord` with its
 * current/historical section intact. `text` is the bounded decision summary.
 */
export interface HandoffDecisionSet {
  members: HandoffRecord[];
  total: number;
  returned: number;
  truncated: boolean;
  state: RecallDecisionSetState;
  operativeDecisionId?: string;
  recordedTransitions: RecallDecisionTransition[];
  beforeActing?: typeof DECISION_SET_UNRESOLVED_NEXT_STEP;
  linkedNextStep?: typeof DECISION_SET_LINKED_NEXT_STEP;
}

export interface CampfireHandoffPacket {
  schemaVersion: typeof HANDOFF_PACKET_SCHEMA_VERSION;
  kind: "CampfireHandoffPacket";
  orderingVersion: typeof RECALL_ORDERING_VERSION;
  offlineCopy: true;
  sensitiveOfflineCopy: true;
  fullHistoryIncluded: false;
  authority: "This offline copy is not a Campfire credential, not a live current-state guarantee, and not permission to execute a decision.";
  workspace: { id: string; name: string; nameTruncated: boolean };
  query: { text: string; normalized: string };
  generatedAt: string;
  sourceCursor: string;
  sourcePosition: number;
  issuer: HandoffActor;
  recipient: HandoffActor;
  goal?: RecallGoal;
  records: HandoffRecord[];
  /** Added in schema version 2. Omitted when the byte fit drops every member. */
  decisionSet?: HandoffDecisionSet;
  anchors: {
    openTasks: HandoffRecord[];
    blockedTasks: HandoffRecord[];
    proposedDecisions: HandoffRecord[];
    acceptedDecisions: HandoffRecord[];
  };
  completeness: {
    fullHistoryIncluded: false;
    anchors: {
      openTasks: HandoffCount;
      blockedTasks: HandoffCount;
      proposedDecisions: HandoffCount;
      acceptedDecisions: HandoffCount;
    };
    recall: {
      current: HandoffCount;
      historical: HandoffCount;
      artifacts: HandoffCount;
    };
    drillDown: "Use your own Campfire credential with list_decisions, list_findings, list_tasks, list_artifacts, get_decision, get_finding, get_task, or get_artifact.";
    catchUp: "Use your own Campfire credential with get_workspace_changes and sourceCursor.";
  };
  omissions: string[];
}

export interface RecallCursor {
  v: 1;
  ordering: typeof RECALL_ORDERING_VERSION;
  workspaceId: string;
  query: string;
  sourcePosition: number;
  section: RecallSectionName;
  tier: number;
  at: string;
  id: string;
}

export interface NormalizedRecall {
  text: string;
  indexes: number[];
}

const CURSOR_PREFIX = "rcl1.";

export function normalizeRecallUnits(value: string): NormalizedRecall {
  let text = "";
  const indexes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const mapped = WHITESPACE_CODES.has(code) ? 32 : code >= 65 && code <= 90 ? code + 32 : code;
    text += String.fromCharCode(mapped);
    indexes.push(index);
  }
  for (let pass = 0; pass < RECALL_SPACE_COLLAPSE_PASSES; pass += 1) {
    let next = "";
    const nextIndexes: number[] = [];
    for (let index = 0; index < text.length; ) {
      if (text.charCodeAt(index) === 32 && index + 1 < text.length && text.charCodeAt(index + 1) === 32) {
        next += " ";
        nextIndexes.push(indexes[index] ?? index);
        index += 2;
        continue;
      }
      next += text[index] ?? "";
      nextIndexes.push(indexes[index] ?? index);
      index += 1;
    }
    text = next;
    indexes.splice(0, indexes.length, ...nextIndexes);
  }
  let start = 0;
  let end = text.length;
  while (start < end && text.charCodeAt(start) === 32) start += 1;
  while (end > start && text.charCodeAt(end - 1) === 32) end -= 1;
  return { text: text.slice(start, end), indexes: indexes.slice(start, end) };
}

export function normalizeRecallText(value: string): string {
  return normalizeRecallUnits(value).text;
}

export function prepareRecallQuery(query: string): { text: string; normalized: string } {
  if (typeof query !== "string") {
    throw new ValidationError("query must be text", { field: "query" });
  }
  if (query.includes("\u0000")) {
    throw new ValidationError("query must not contain NUL", { field: "query" });
  }
  if (query.length === 0) {
    throw new ValidationError("query must not be empty", { field: "query" });
  }
  if (query.length > RECALL_QUERY_MAX_CHARS) {
    throw new ValidationError(`query must be at most ${RECALL_QUERY_MAX_CHARS} characters`, {
      field: "query",
      limit: RECALL_QUERY_MAX_CHARS,
    });
  }
  const normalized = normalizeRecallText(query);
  if (normalized.length === 0) {
    throw new ValidationError("query must not be empty", { field: "query" });
  }
  if (normalized.length > RECALL_QUERY_MAX_CHARS) {
    throw new ValidationError(`query must be at most ${RECALL_QUERY_MAX_CHARS} characters`, {
      field: "query",
      limit: RECALL_QUERY_MAX_CHARS,
    });
  }
  return { text: query, normalized };
}

export function recallLimit(limit: number | undefined): number {
  if (limit === undefined) return RECALL_DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new ValidationError("limit must be a positive integer", { field: "limit", limit });
  }
  if (limit > RECALL_MAX_LIMIT) {
    throw new ValidationError(`limit must be at most ${RECALL_MAX_LIMIT}`, { field: "limit", limit });
  }
  return limit;
}

export function utf8Prefix(value: string, maxBytes: number): { text: string; truncated: boolean } {
  const buffer = Buffer.from(value, "utf8");
  if (buffer.length <= maxBytes) return { text: value, truncated: false };
  let end = maxBytes;
  while (end > 0 && (buffer[end]! & 0b1100_0000) === 0b1000_0000) end -= 1;
  return { text: buffer.subarray(0, end).toString("utf8"), truncated: true };
}

export function matchingExcerpt(original: string, normalizedQuery: string): { excerpt: string; truncated: boolean } {
  const normalized = normalizeRecallUnits(original);
  const at = normalized.text.indexOf(normalizedQuery);
  if (at < 0 || normalized.indexes.length === 0) {
    const bounded = utf8Prefix(original, RECALL_EXCERPT_MAX_BYTES);
    return { excerpt: bounded.text, truncated: bounded.truncated || original.length > bounded.text.length };
  }
  const start = normalized.indexes[at] ?? 0;
  const last = normalized.indexes[at + normalizedQuery.length - 1] ?? start;
  const matchEnd = Math.min(original.length, last + 1);
  const from = Math.max(0, start - 80);
  const to = Math.min(original.length, matchEnd + 80);
  const window = original.slice(from, to);
  const bounded = utf8Prefix(window, RECALL_EXCERPT_MAX_BYTES);
  const windowTruncated = from > 0 || to < original.length || bounded.truncated;
  if (!bounded.truncated || normalizeRecallText(bounded.text).includes(normalizedQuery)) {
    return { excerpt: bounded.text, truncated: windowTruncated };
  }
  const fromMatch = utf8Prefix(original.slice(start, Math.min(original.length, start + 400)), RECALL_EXCERPT_MAX_BYTES);
  return { excerpt: fromMatch.text, truncated: true };
}

export function matchedFieldName(kind: RecallKind, field: "primary" | "secondary"): RecallMatchedField {
  if (kind === "task") return field === "primary" ? "title" : "description";
  if (kind === "finding") return field === "primary" ? "summary" : "detail";
  if (kind === "decision") return field === "primary" ? "summary" : "rationale";
  return field === "primary" ? "title" : "type";
}

/** Best rcl-1 tier. Undefined when neither field contains the normalized query. */
export function matchTier(
  primary: string,
  secondary: string,
  normalizedQuery: string,
): { tier: number; field: "primary" | "secondary" } | undefined {
  const left = normalizeRecallText(primary);
  const right = normalizeRecallText(secondary);
  if (left === normalizedQuery) return { tier: 0, field: "primary" };
  if (right === normalizedQuery) return { tier: 1, field: "secondary" };
  if (left.startsWith(normalizedQuery)) return { tier: 2, field: "primary" };
  if (right.startsWith(normalizedQuery)) return { tier: 3, field: "secondary" };
  if (left.includes(normalizedQuery)) return { tier: 4, field: "primary" };
  if (right.includes(normalizedQuery)) return { tier: 5, field: "secondary" };
  return undefined;
}

export function recallSourceCursor(workspaceId: string, position: number): string {
  return encodeContextCursor(
    contributionCursor({
      workspaceId,
      occurredAt: "",
      id: "",
      phase: "high",
      originOccurredAt: "",
      originId: "",
      position,
      originPosition: position,
      tip: 0,
    }),
  );
}

export function encodeRecallCursor(cursor: RecallCursor): string {
  return `${CURSOR_PREFIX}${Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")}`;
}

export function decodeRecallCursor(token: string, workspaceId: string, normalizedQuery: string): RecallCursor {
  if (typeof token !== "string" || !token.startsWith(CURSOR_PREFIX)) {
    throw new ValidationError("Cursor is malformed", { field: "cursor" });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(token.slice(CURSOR_PREFIX.length), "base64url").toString("utf8"));
  } catch {
    throw new ValidationError("Cursor is malformed", { field: "cursor" });
  }
  if (!isRecallCursor(parsed)) {
    throw new ValidationError("Cursor is malformed", { field: "cursor" });
  }
  if (parsed.workspaceId !== workspaceId) {
    throw new ValidationError("Cursor belongs to a different workspace", { field: "cursor", workspaceId });
  }
  if (parsed.query !== normalizedQuery) {
    throw new ValidationError("Cursor does not match this query", { field: "cursor" });
  }
  if (parsed.ordering !== RECALL_ORDERING_VERSION) {
    throw new ValidationError("Cursor uses a different recall ordering", { field: "cursor" });
  }
  return { ...parsed, ordering: RECALL_ORDERING_VERSION };
}

export function assertRecallCursorPosition(cursor: RecallCursor, sourcePosition: number, workspaceId: string): void {
  if (cursor.sourcePosition !== sourcePosition) {
    throw new RecallRestart(workspaceId);
  }
}

function isRecallCursor(value: unknown): value is Omit<RecallCursor, "ordering"> & { ordering: string } {
  if (typeof value !== "object" || value === null) return false;
  const cursor = value as Record<string, unknown>;
  return (
    cursor.v === 1 &&
    typeof cursor.ordering === "string" &&
    cursor.ordering.length > 0 &&
    typeof cursor.workspaceId === "string" &&
    cursor.workspaceId.length > 0 &&
    typeof cursor.query === "string" &&
    typeof cursor.sourcePosition === "number" &&
    Number.isInteger(cursor.sourcePosition) &&
    cursor.sourcePosition >= 0 &&
    (cursor.section === "current" || cursor.section === "historical" || cursor.section === "artifacts") &&
    typeof cursor.tier === "number" &&
    Number.isInteger(cursor.tier) &&
    cursor.tier >= 0 &&
    cursor.tier <= 5 &&
    typeof cursor.at === "string" &&
    typeof cursor.id === "string" &&
    cursor.id.length > 0
  );
}

export function emptyRecallSection(total = 0): RecallSection {
  return { items: [], total, returned: 0, truncated: total > 0 };
}

export function finishRecallSection(items: readonly RecallHit[], total: number, nextCursor?: string): RecallSection {
  const section: RecallSection = {
    items: [...items],
    total,
    returned: items.length,
    truncated: items.length < total,
  };
  if (nextCursor !== undefined && section.truncated) section.nextCursor = nextCursor;
  return section;
}

export function cursorForHit(
  workspaceId: string,
  normalizedQuery: string,
  sourcePosition: number,
  section: RecallSectionName,
  hit: RecallHit,
  recency: string,
): string {
  return encodeRecallCursor({
    v: 1,
    ordering: RECALL_ORDERING_VERSION,
    workspaceId,
    query: normalizedQuery,
    sourcePosition,
    section,
    tier: hit.tier,
    at: recency,
    id: hit.id,
  });
}

export function boundRecallText(value: string | undefined, maxBytes: number): { text?: string; truncated: boolean } {
  if (value === undefined || value.length === 0) return { truncated: false };
  const bounded = utf8Prefix(value, maxBytes);
  return { text: bounded.text, truncated: bounded.truncated };
}

export function capIdList(ids: readonly string[]): { ids: string[]; truncated: boolean } {
  if (ids.length <= RECALL_RELATIONSHIP_LIMIT) return { ids: [...ids], truncated: false };
  return { ids: ids.slice(0, RECALL_RELATIONSHIP_LIMIT), truncated: true };
}

export interface DecisionSetVerdict {
  state: RecallDecisionSetState;
  operativeDecisionId?: string;
  beforeActing?: typeof DECISION_SET_UNRESOLVED_NEXT_STEP;
  linkedNextStep?: typeof DECISION_SET_LINKED_NEXT_STEP;
}

/**
 * Decide whether a decision set is safe to act on, from recorded transitions only.
 *
 * A member is removed from `surviving` only when a transition inside the set
 * names it as `supersededDecisionId` and the superseding member is itself
 * accepted. Nothing else promotes or demotes a decision: not recency, not
 * position, not `needsReview`, not authorship. When two accepted decisions
 * survive, this reports the conflict and refuses to name one.
 */
export function deriveDecisionSetState(input: {
  members: readonly { id: string; lifecycle: string }[];
  recordedTransitions: readonly RecallDecisionTransition[];
  truncated: boolean;
}): DecisionSetVerdict {
  const memberIds = new Set(input.members.map((member) => member.id));
  const accepted = input.members.filter((member) => member.lifecycle === "accepted").map((member) => member.id);
  const superseded = new Set<string>();
  for (const transition of input.recordedTransitions) {
    const inside = memberIds.has(transition.supersededDecisionId) && memberIds.has(transition.supersedingDecisionId);
    if (inside && accepted.includes(transition.supersedingDecisionId)) superseded.add(transition.supersededDecisionId);
  }
  const surviving = accepted.filter((id) => !superseded.has(id));
  // Truncation is checked before the empty case, not after. A byte cap can drop
  // every member, and an empty set is then indistinguishable from a workspace
  // with no accepted decision. Reporting `no-accepted-decision` there would
  // claim safety that the cap destroyed.
  if (input.truncated && surviving.length <= 1) return { state: "truncated", beforeActing: DECISION_SET_UNRESOLVED_NEXT_STEP };
  if (accepted.length === 0) return { state: "no-accepted-decision" };
  if (surviving.length !== 1) return { state: "unresolved-accepted-decisions", beforeActing: DECISION_SET_UNRESOLVED_NEXT_STEP };
  const operativeDecisionId = surviving[0]!;
  const linkedToSurvivor = input.recordedTransitions.some(
    (transition) =>
      memberIds.has(transition.supersededDecisionId) &&
      transition.supersedingDecisionId === operativeDecisionId,
  );
  return {
    state: linkedToSurvivor ? "linked-accepted-decisions" : "single-accepted-decision",
    operativeDecisionId,
    ...(linkedToSurvivor ? { linkedNextStep: DECISION_SET_LINKED_NEXT_STEP } : {}),
  };
}

/**
 * Recorded supersessions whose two ends are both in the returned set.
 *
 * The link is split across two rows by COR-001: the predecessor carries
 * `successorId`, the successor carries `predecessorId`. A pair is therefore
 * accepted from either direction, and a row that names a decision outside the
 * set does not resolve it — the caller cannot see that decision here.
 */
export function recordedDecisionTransitions(
  members: readonly { id: string; predecessorId?: string; successorId?: string }[],
): RecallDecisionTransition[] {
  const ids = new Set(members.map((member) => member.id));
  const found = new Map<string, RecallDecisionTransition>();
  const add = (from: string, to: string): void => {
    if (from === to) return;
    if (!ids.has(from) || !ids.has(to)) return;
    found.set(JSON.stringify([from, to]), { supersededDecisionId: from, supersedingDecisionId: to });
  };
  for (const member of members) {
    // predecessor -> this member is the recorded supersession direction.
    if (member.predecessorId !== undefined) add(member.predecessorId, member.id);
    // this member -> successor is the same transition seen from the other row.
    if (member.successorId !== undefined) add(member.id, member.successorId);
  }
  return [...found.values()];
}

function transitionsWithinMembers(
  transitions: readonly RecallDecisionTransition[],
  members: readonly { id: string }[],
): RecallDecisionTransition[] {
  const ids = new Set(members.map((member) => member.id));
  return transitions.filter(
    (transition) => ids.has(transition.supersededDecisionId) && ids.has(transition.supersedingDecisionId),
  );
}

export function jsonByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

export function capRecallResponse(
  recall: WorkspaceRecall,
  cursorFor: (section: RecallSectionName, hit: RecallHit) => string,
): WorkspaceRecall {
  let current = [...recall.current.items];
  let historical = [...recall.historical.items];
  let artifacts = [...recall.artifacts.items];
  let decisionMembers = recall.decisionSet === undefined ? undefined : [...recall.decisionSet.members];
  const dropped = { current: false, historical: false, artifacts: false, decisionSet: false };
  const render = (): WorkspaceRecall =>
    renderRecall(recall, current, historical, artifacts, decisionMembers, dropped, cursorFor);
  let fitted = render();
  while (jsonByteLength(fitted) > RECALL_RESPONSE_MAX_BYTES) {
    if (artifacts.length > 0) {
      artifacts = artifacts.slice(0, -1);
      dropped.artifacts = true;
    } else if (historical.length > 0) {
      historical = historical.slice(0, -1);
      dropped.historical = true;
    } else if (current.length > 0) {
      current = current.slice(0, -1);
      dropped.current = true;
    } else if (decisionMembers !== undefined && decisionMembers.length > 0) {
      // Set members drop last. Dropping one marks the set truncated, which
      // re-derives its state, so a cut set never keeps an operative decision.
      decisionMembers = decisionMembers.slice(0, -1);
      dropped.decisionSet = true;
    } else {
      break;
    }
    fitted = render();
  }
  return fitted;
}

function renderRecall(
  recall: WorkspaceRecall,
  current: RecallHit[],
  historical: RecallHit[],
  artifacts: RecallHit[],
  decisionMembers: RecallDecisionSetMember[] | undefined,
  dropped: { current: boolean; historical: boolean; artifacts: boolean; decisionSet: boolean },
  cursorFor: (section: RecallSectionName, hit: RecallHit) => string,
): WorkspaceRecall {
  const section = (
    name: RecallSectionName,
    items: RecallHit[],
    original: RecallSection,
    didDrop: boolean,
  ): RecallSection => {
    const next = didDrop
      ? items.length > 0
        ? cursorFor(name, items[items.length - 1]!)
        : undefined
      : original.nextCursor;
    const truncated = items.length < original.total || didDrop;
    const page: RecallSection = {
      items,
      total: original.total,
      returned: items.length,
      truncated,
    };
    if (next !== undefined && truncated && (didDrop || items.length > 0 || original.nextCursor !== undefined)) {
      if (didDrop && items.length === 0) return page;
      page.nextCursor = next;
    }
    return page;
  };
  const responseTruncated = dropped.current || dropped.historical || dropped.artifacts || dropped.decisionSet;
  const base: WorkspaceRecall = {
    ...recall,
    current: section("current", current, recall.current, dropped.current),
    historical: section("historical", historical, recall.historical, dropped.historical),
    artifacts: section("artifacts", artifacts, recall.artifacts, dropped.artifacts),
    completeness: { ...recall.completeness, responseTruncated },
  };
  if (recall.decisionSet === undefined || decisionMembers === undefined) return base;
  const truncated = recall.decisionSet.truncated || dropped.decisionSet;
  const recordedTransitions = transitionsWithinMembers(recall.decisionSet.recordedTransitions, decisionMembers);
  const verdict = deriveDecisionSetState({
    members: decisionMembers,
    recordedTransitions,
    truncated,
  });
  // Rebuilt rather than spread: a dropped member must clear `operativeDecisionId`
  // and `beforeActing` instead of leaving the pre-drop values behind.
  const set: RecallDecisionSet = {
    members: decisionMembers,
    total: recall.decisionSet.total,
    returned: decisionMembers.length,
    truncated,
    state: verdict.state,
    recordedTransitions,
    ...(verdict.operativeDecisionId === undefined ? {} : { operativeDecisionId: verdict.operativeDecisionId }),
    ...(verdict.beforeActing === undefined ? {} : { beforeActing: verdict.beforeActing }),
    ...(verdict.linkedNextStep === undefined ? {} : { linkedNextStep: verdict.linkedNextStep }),
  };
  return { ...base, decisionSet: set };
}

export interface HandoffAnchorPages {
  openTasks: HandoffRecord[];
  blockedTasks: HandoffRecord[];
  proposedDecisions: HandoffRecord[];
  acceptedDecisions: HandoffRecord[];
  counts: CampfireHandoffPacket["completeness"]["anchors"];
}

export function projectHandoffPacket(input: {
  recall: WorkspaceRecall;
  issuer: HandoffActor;
  recipient: HandoffActor;
  anchors: HandoffAnchorPages;
  /**
   * Full decision rationale by id, for records that matched but whose rationale
   * did not fit inside the response cap. Decision hits and set members already
   * carry a bounded rationale from the recall response.
   */
  decisionRationales?: ReadonlyMap<string, string>;
}): CampfireHandoffPacket {
  const recallRecords = packetRecords(input.recall, input.decisionRationales);
  const header = basePacket(input, undefined, [], {
    openTasks: [],
    blockedTasks: [],
    proposedDecisions: [],
    acceptedDecisions: [],
  }, []);
  if (jsonByteLength(header) > HANDOFF_PACKET_MAX_BYTES) {
    throw new ValidationError("Handoff packet header exceeds 64 KiB", { field: "packet" });
  }
  const omissions: string[] = [];
  // The decision set is fitted first. A conflict must not be the first thing
  // dropped under the cap, because a packet that silently loses it would let a
  // recipient act on a rule with nothing saying a second rule is accepted.
  const decisionSet = fitDecisionSet(input, omissions);
  const anchorOrder: Array<keyof HandoffAnchorPages & keyof CampfireHandoffPacket["anchors"]> = [
    "openTasks",
    "blockedTasks",
    "proposedDecisions",
    "acceptedDecisions",
  ];
  const keptAnchors: CampfireHandoffPacket["anchors"] = {
    openTasks: [],
    blockedTasks: [],
    proposedDecisions: [],
    acceptedDecisions: [],
  };
  for (const key of anchorOrder) {
    const source = input.anchors[key];
    const kept: HandoffRecord[] = [];
    for (const record of source) {
      const next = { ...keptAnchors, [key]: [...kept, record] };
      if (jsonByteLength(basePacket(input, decisionSet, [], next, omissions)) > HANDOFF_PACKET_MAX_BYTES) break;
      kept.push(record);
    }
    keptAnchors[key] = kept;
    const omitted = source.length - kept.length;
    if (omitted > 0) omissions.push(`anchors.${key}: ${omitted} not included`);
  }
  const keptRecords: HandoffRecord[] = [];
  for (const record of recallRecords) {
    const candidate = basePacket(input, decisionSet, [...keptRecords, record], keptAnchors, omissions);
    if (jsonByteLength(candidate) > HANDOFF_PACKET_MAX_BYTES) break;
    keptRecords.push(record);
  }
  const recordsOmitted = recallRecords.length - keptRecords.length;
  if (recordsOmitted > 0) omissions.push(`records: ${recordsOmitted} not included`);
  let packet = basePacket(input, decisionSet, keptRecords, keptAnchors, omissions);
  while (jsonByteLength(packet) > HANDOFF_PACKET_MAX_BYTES && keptRecords.length > 0) {
    keptRecords.pop();
    const without = basePacket(input, decisionSet, keptRecords, keptAnchors, [
      ...omissions.filter((line) => !line.startsWith("records:")),
      `records: ${recallRecords.length - keptRecords.length} not included`,
    ]);
    packet = without;
  }
  if (jsonByteLength(packet) > HANDOFF_PACKET_MAX_BYTES) {
    throw new ValidationError("Handoff packet header exceeds 64 KiB", { field: "packet" });
  }
  return packet;
}

function fitDecisionSet(
  input: { recall: WorkspaceRecall; issuer: HandoffActor; recipient: HandoffActor; anchors: HandoffAnchorPages },
  omissions: string[],
): HandoffDecisionSet | undefined {
  const set = input.recall.decisionSet;
  if (set === undefined) return undefined;
  const source = handoffDecisionSetMembers(set);
  const emptyAnchors = { openTasks: [], blockedTasks: [], proposedDecisions: [], acceptedDecisions: [] };
  const withMembers = (members: HandoffRecord[]): HandoffDecisionSet => {
    // Re-derived after every fit so a kept subset never keeps a state or an
    // operative decision id that its own members no longer support.
    const recordedTransitions = transitionsWithinMembers(set.recordedTransitions, members);
    const verdict = deriveDecisionSetState({
      members,
      recordedTransitions,
      truncated: set.truncated || members.length < set.total,
    });
    return {
      members,
      total: set.total,
      returned: members.length,
      truncated: set.truncated || members.length < set.total,
      state: verdict.state,
      recordedTransitions,
      ...(verdict.operativeDecisionId === undefined ? {} : { operativeDecisionId: verdict.operativeDecisionId }),
      ...(verdict.beforeActing === undefined ? {} : { beforeActing: verdict.beforeActing }),
      ...(verdict.linkedNextStep === undefined ? {} : { linkedNextStep: verdict.linkedNextStep }),
    };
  };
  const kept: HandoffRecord[] = [];
  for (const record of source) {
    const candidate = basePacket(input, withMembers([...kept, record]), [], emptyAnchors, omissions);
    if (jsonByteLength(candidate) > HANDOFF_PACKET_MAX_BYTES) break;
    kept.push(record);
  }
  const omitted = source.length - kept.length;
  if (omitted > 0) omissions.push(`decisionSet: ${omitted} not included`);
  if (kept.length === 0) {
    // Every member was dropped. The set itself is reported as truncated with no
    // members so the recipient sees that a decision set existed and is unread.
    const verdict = deriveDecisionSetState({
      members: [],
      recordedTransitions: [],
      truncated: true,
    });
    return {
      members: [],
      total: set.total,
      returned: 0,
      truncated: true,
      state: verdict.state,
      recordedTransitions: [],
      ...(verdict.beforeActing === undefined ? {} : { beforeActing: verdict.beforeActing }),
      ...(verdict.linkedNextStep === undefined ? {} : { linkedNextStep: verdict.linkedNextStep }),
    };
  }
  return withMembers(kept);
}

/**
 * Project decision-set members for the offline packet.
 *
 * Two rules learned from the RCL-003 S2 recipient, which lifted a superseded
 * decision's rationale into a live release condition:
 *
 * 1. `section` is not flattened to `"decision-set"`. A superseded member keeps
 *    `"historical"` and the live members keep `"current"`. The grouped view is
 *    the addition; it must not erase the current/historical split that COR-001
 *    already established and that this same packet carries in `records`.
 * 2. A superseded member's rationale is not emitted under `rationale`. Its
 *    summary and rationale are historical explanation, and a `rationale` field
 *    is the field an offline reader acts on. Dropping it removes the trap
 *    rather than labelling it.
 *
 * `basisFindingIds` is carried here; the live projection emits it and a member
 * that loses its basis cannot be checked against the evidence behind it.
 */
export function handoffDecisionSetMembers(set: RecallDecisionSet): HandoffRecord[] {
  return set.members.map((member) => {
    const superseded = member.lifecycle === "superseded";
    const historical = boundRecallText(
      superseded
        ? `Decision ${member.id} is superseded. Its summary describes the former rule; its rationale is not a current condition.`
        : undefined,
      RECALL_GOAL_TEXT_MAX_BYTES,
    );
    return {
      section: superseded ? ("historical" as const) : ("current" as const),
      kind: "decision" as const,
      id: member.id,
      lifecycle: member.lifecycle,
      text: member.summary,
      textTruncated: member.summaryTruncated,
      provenance: member.provenance,
      ...(member.rationale === undefined || superseded ? {} : { rationale: member.rationale }),
      ...(member.rationaleTruncated === undefined || superseded ? {} : { rationaleTruncated: member.rationaleTruncated }),
      ...(member.predecessorId === undefined ? {} : { predecessorId: member.predecessorId }),
      ...(member.successorId === undefined ? {} : { successorId: member.successorId }),
      ...(member.basisFindingIds === undefined ? {} : { basisFindingIds: member.basisFindingIds }),
      ...(member.needsReview === undefined ? {} : { needsReview: member.needsReview }),
      ...(member.needsReviewFindingIds === undefined ? {} : { needsReviewFindingIds: member.needsReviewFindingIds }),
      ...(member.relationshipIdsTruncated === undefined ? {} : { relationshipIdsTruncated: member.relationshipIdsTruncated }),
      ...(historical.text === undefined ? {} : { historicalExplanation: historical.text }),
    };
  });
}

export function boundedDecisionRationale(value: string | undefined): Pick<HandoffRecord, "rationale" | "rationaleTruncated"> {
  const bounded = boundRecallText(value, HANDOFF_RATIONALE_MAX_BYTES);
  if (bounded.text === undefined) return {};
  return {
    rationale: bounded.text,
    ...(bounded.truncated ? { rationaleTruncated: true as const } : {}),
  };
}

function packetRecords(recall: WorkspaceRecall, rationales: ReadonlyMap<string, string> | undefined): HandoffRecord[] {
  const map = (section: RecallSectionName, hit: RecallHit): HandoffRecord => ({
    section,
    kind: hit.kind,
    id: hit.id,
    lifecycle: hit.lifecycle,
    text: hit.excerpt,
    textTruncated: hit.excerptTruncated,
    provenance: hit.provenance,
    ...(hit.kind === "decision" ? boundedDecisionRationale(hit.rationale ?? rationales?.get(hit.id)) : {}),
    ...(hit.predecessorId === undefined ? {} : { predecessorId: hit.predecessorId }),
    ...(hit.successorId === undefined ? {} : { successorId: hit.successorId }),
    ...(hit.evidenceArtifactIds === undefined ? {} : { evidenceArtifactIds: hit.evidenceArtifactIds }),
    ...(hit.basisFindingIds === undefined ? {} : { basisFindingIds: hit.basisFindingIds }),
    ...(hit.relationshipIdsTruncated === undefined ? {} : { relationshipIdsTruncated: hit.relationshipIdsTruncated }),
    ...(hit.needsReview === undefined ? {} : { needsReview: hit.needsReview }),
    ...(hit.needsReviewFindingIds === undefined ? {} : { needsReviewFindingIds: hit.needsReviewFindingIds }),
  });
  return [
    ...recall.current.items.map((hit) => map("current", hit)),
    ...recall.historical.items.map((hit) => map("historical", hit)),
    ...recall.artifacts.items.map((hit) => map("artifacts", hit)),
  ];
}

function countOf(section: RecallSection): HandoffCount {
  return { total: section.total, returned: section.returned, truncated: section.truncated };
}

function basePacket(
  input: { recall: WorkspaceRecall; issuer: HandoffActor; recipient: HandoffActor; anchors: HandoffAnchorPages },
  decisionSet: HandoffDecisionSet | undefined,
  records: HandoffRecord[],
  anchors: CampfireHandoffPacket["anchors"],
  omissions: string[],
): CampfireHandoffPacket {
  const anchorCount = (key: keyof CampfireHandoffPacket["anchors"]): HandoffCount => {
    const total = input.anchors.counts[key].total;
    const returned = anchors[key].length;
    return { total, returned, truncated: returned < total };
  };
  return {
    schemaVersion: HANDOFF_PACKET_SCHEMA_VERSION,
    kind: "CampfireHandoffPacket",
    orderingVersion: RECALL_ORDERING_VERSION,
    offlineCopy: true,
    sensitiveOfflineCopy: true,
    fullHistoryIncluded: false,
    authority:
      "This offline copy is not a Campfire credential, not a live current-state guarantee, and not permission to execute a decision.",
    workspace: input.recall.workspace,
    query: input.recall.query,
    generatedAt: input.recall.generatedAt,
    sourceCursor: input.recall.sourceCursor,
    sourcePosition: input.recall.sourcePosition,
    issuer: input.issuer,
    recipient: input.recipient,
    ...(input.recall.goal === undefined ? {} : { goal: input.recall.goal }),
    records,
    ...(decisionSet === undefined ? {} : { decisionSet }),
    anchors,
    completeness: {
      fullHistoryIncluded: false,
      anchors: {
        openTasks: anchorCount("openTasks"),
        blockedTasks: anchorCount("blockedTasks"),
        proposedDecisions: anchorCount("proposedDecisions"),
        acceptedDecisions: anchorCount("acceptedDecisions"),
      },
      recall: {
        current: countOf(input.recall.current),
        historical: countOf(input.recall.historical),
        artifacts: countOf(input.recall.artifacts),
      },
      drillDown:
        "Use your own Campfire credential with list_decisions, list_findings, list_tasks, list_artifacts, get_decision, get_finding, get_task, or get_artifact.",
      catchUp: "Use your own Campfire credential with get_workspace_changes and sourceCursor.",
    },
    omissions,
  };
}

export function serializeHandoffPacket(packet: CampfireHandoffPacket): string {
  const serialized = JSON.stringify(packet);
  JSON.parse(serialized);
  if (Buffer.byteLength(serialized, "utf8") > HANDOFF_PACKET_MAX_BYTES) {
    throw new ValidationError("Handoff packet exceeds 64 KiB", { field: "packet" });
  }
  return serialized;
}

export function handoffReceipt(packet: CampfireHandoffPacket, bytes: number, path: string): {
  kind: "CampfireHandoffReceipt";
  offlineCopy: true;
  sensitiveOfflineCopy: true;
  fullHistoryIncluded: false;
  workspaceId: string;
  recipient: HandoffActor;
  bytes: number;
  omissions: number;
  path: string;
} {
  return {
    kind: "CampfireHandoffReceipt",
    offlineCopy: true,
    sensitiveOfflineCopy: true,
    fullHistoryIncluded: false,
    workspaceId: packet.workspace.id,
    recipient: packet.recipient,
    bytes,
    omissions: packet.omissions.length,
    path,
  };
}
