/**
 * RCL-001 recall and handoff projection.
 *
 * This module is the frozen selection and packet rule. CLI, MCP, local HTTP,
 * and the Worker call it. They do not grow a second ranker. SQLite and D1
 * execute the same normalization in `src/store/recall-queries.ts`.
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

export const RECALL_SCHEMA_VERSION = 1 as const;
export const RECALL_ORDERING_VERSION = "rcl-1" as const;
export const HANDOFF_PACKET_SCHEMA_VERSION = 1 as const;
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
export const RECALL_RELATIONSHIP_LIMIT = 20;
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
  predecessorId?: string;
  successorId?: string;
  evidenceArtifactIds?: string[];
  basisFindingIds?: string[];
  relationshipIdsTruncated?: true;
  needsReview?: true;
  needsReviewFindingIds?: string[];
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
  section: RecallSectionName | "anchor";
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
}

export interface HandoffCount {
  total: number;
  returned: number;
  truncated: boolean;
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
  const dropped = { current: false, historical: false, artifacts: false };
  const render = (): WorkspaceRecall =>
    renderRecall(recall, current, historical, artifacts, dropped, cursorFor);
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
  dropped: { current: boolean; historical: boolean; artifacts: boolean },
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
  const responseTruncated = dropped.current || dropped.historical || dropped.artifacts;
  return {
    ...recall,
    current: section("current", current, recall.current, dropped.current),
    historical: section("historical", historical, recall.historical, dropped.historical),
    artifacts: section("artifacts", artifacts, recall.artifacts, dropped.artifacts),
    completeness: { ...recall.completeness, responseTruncated },
  };
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
  /** Full decision rationale by id. The packet bounds it; the recall response does not gain this field. */
  decisionRationales?: ReadonlyMap<string, string>;
}): CampfireHandoffPacket {
  const recallRecords = packetRecords(input.recall, input.decisionRationales);
  const header = basePacket(input, [], {
    openTasks: [],
    blockedTasks: [],
    proposedDecisions: [],
    acceptedDecisions: [],
  }, []);
  if (jsonByteLength(header) > HANDOFF_PACKET_MAX_BYTES) {
    throw new ValidationError("Handoff packet header exceeds 64 KiB", { field: "packet" });
  }
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
  const omissions: string[] = [];
  for (const key of anchorOrder) {
    const source = input.anchors[key];
    const kept: HandoffRecord[] = [];
    for (const record of source) {
      const next = { ...keptAnchors, [key]: [...kept, record] };
      if (jsonByteLength(basePacket(input, [], next, omissions)) > HANDOFF_PACKET_MAX_BYTES) break;
      kept.push(record);
    }
    keptAnchors[key] = kept;
    const omitted = source.length - kept.length;
    if (omitted > 0) omissions.push(`anchors.${key}: ${omitted} not included`);
  }
  const keptRecords: HandoffRecord[] = [];
  for (const record of recallRecords) {
    const candidate = basePacket(input, [...keptRecords, record], keptAnchors, omissions);
    if (jsonByteLength(candidate) > HANDOFF_PACKET_MAX_BYTES) break;
    keptRecords.push(record);
  }
  const recordsOmitted = recallRecords.length - keptRecords.length;
  if (recordsOmitted > 0) omissions.push(`records: ${recordsOmitted} not included`);
  let packet = basePacket(input, keptRecords, keptAnchors, omissions);
  while (jsonByteLength(packet) > HANDOFF_PACKET_MAX_BYTES && keptRecords.length > 0) {
    keptRecords.pop();
    const without = basePacket(input, keptRecords, keptAnchors, [
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
    ...(hit.kind === "decision" ? boundedDecisionRationale(rationales?.get(hit.id)) : {}),
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
