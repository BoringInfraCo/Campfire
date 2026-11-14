/**
 * FAC-001 slice 1: attention domain module. Types, constants, the typed error
 * vocabulary and the pure derivation core (`deriveAttention`) delivered by
 * slice 1. No store, clock, filesystem or network access.
 * Contract: docs/Campfire-FAC-001-Deterministic-Facilitation.md (F1-F16,
 * Amendments 1-3; Amendment 2 is A2.1-A2.11).
 */
import { ValidationError } from "./errors.js";
import {
  MEMORY_HEALTH_REASONS,
  deriveMemoryHealthCues,
  type MemoryHealthRows,
  type MemoryHealthSubjectType,
} from "./memory-health.js";

export const ATTENTION_SCHEMA_VERSION = 1 as const;
export const ATTENTION_ORDERING_VERSION = "fac-1" as const;
/** Cursor prefix (unsigned base64url JSON, like `cf1.` / `mh1.`). */
export const ATTENTION_CURSOR_PREFIX = "fa1." as const;

/** rulesEvaluated, severity order (A1.7). Index is the reason's severity rank. */
export const ATTENTION_REASONS = [
  "action_proposal_awaiting_review",
  "action_outcome_unknown",
  "assigned_blocked_task",
  "proposed_decision_actionable",
  "team_proposed_decision",
  "accepted_decision_needs_review",
  "current_finding_has_contradicting_evidence",
  "unassigned_blocked_task",
  "team_blocked_task",
  "blocked_task_missing_context",
  "assigned_open_task",
] as const;
export type AttentionReason = (typeof ATTENTION_REASONS)[number];

/** Reasons sourced from memory-health (load-then-fold, scanned = total, not subject to S). */
export const ATTENTION_MEMORY_HEALTH_REASONS = [
  "action_outcome_unknown",
  "accepted_decision_needs_review",
  "current_finding_has_contradicting_evidence",
  "blocked_task_missing_context",
] as const satisfies readonly AttentionReason[];

/** Newly authored reasons, each one SQL scan with ceiling S. */
export const ATTENTION_AUTHORED_REASONS = [
  "action_proposal_awaiting_review",
  "assigned_blocked_task",
  "proposed_decision_actionable",
  "team_proposed_decision",
  "unassigned_blocked_task",
  "team_blocked_task",
  "assigned_open_task",
] as const satisfies readonly AttentionReason[];

export type AttentionAudience = "you" | "team";
export const ATTENTION_AUDIENCES = ["you", "team"] as const satisfies readonly AttentionAudience[];
export type AttentionSubjectType = MemoryHealthSubjectType;

/** Per-reason scan ceiling S (= MAX_PAGE_SIZE). */
export const ATTENTION_SCAN_CEILING = 100;
/** Catch-up examined-set ceiling E. */
export const ATTENTION_EXAMINED_CEILING = 100;
export const ATTENTION_DEFAULT_LIMIT = 25;
export const ATTENTION_MIN_LIMIT = 1;
/** `limit` above this is rejected, never clamped (A1.30): ValidationError field `limit`. */
export const ATTENTION_MAX_LIMIT = 100;
/** Serialized cues[] ceiling per page (A2.7: bounds cues[] only). */
export const ATTENTION_RESPONSE_MAX_BYTES = 48 * 1024;
/** D1 tip-bracket attempts (s5 Snapshot). */
export const ATTENTION_D1_BRACKET_ATTEMPTS = 3;
/** The only skip value (F13). */
export const ATTENTION_SKIP_WORKSPACE_NOT_ACTIVE = "workspace_not_active" as const;
/** affectedIds object types (A1.17). */
export const ATTENTION_AFFECTED_OBJECT_TYPES = ["decision", "finding", "task", "artifact", "action_proposal"] as const;

/** Typed error vocabulary (no new error classes; ValidationError / Conflict from errors.ts). */
export const ATTENTION_ERROR_FIELDS = {
  limit: "limit",
  cursor: "cursor",
  since: "since",
  byteBudget: "byteBudget",
} as const;
export const ATTENTION_RECOVERY_CODES = {
  cursorStale: "attention_cursor_stale",
  authorityChanged: "attention_cursor_authority_changed",
  concurrentWrite: "attention_concurrent_write",
  cursorAheadOfTip: "cursor_ahead_of_tip",
} as const;
export const ATTENTION_NEXT_ACTIONS = {
  restartWithoutCursor: "restart_without_cursor",
  retry: "retry",
} as const;

export interface GetWorkspaceAttentionInput {
  workspaceId: string;
  limit?: number;
  cursor?: string;
  since?: string;
}

/** identityKey is the JSON array [reason, subjectType, subjectId] (A2.10). */
export type AttentionIdentityKey = [AttentionReason, AttentionSubjectType, string];

export interface AttentionCue {
  id: string;
  identityKey: AttentionIdentityKey;
  audience: AttentionAudience;
  reason: AttentionReason;
  subjectType: AttentionSubjectType;
  subjectId: string;
  relatedIds: string[];
  sourceUpdatedAt: string;
  summary: string;
  /** Present only on action_proposal_awaiting_review. */
  expired?: boolean;
}

/** A2.1: one entry per reason in rulesEvaluated order; the skipped entry is {reason, skipped} (A1.29). */
export interface PerSourceCoverage {
  reason: AttentionReason;
  total?: number;
  scanned?: number;
  truncated?: boolean;
  skipped?: typeof ATTENTION_SKIP_WORKSPACE_NOT_ACTIVE;
}

export interface AttentionCatchUp {
  status: "not_requested" | "complete" | "partial";
  changedCount: number;
  examined: number;
  affectedIds: string[];
  affectedTruncated: boolean;
  tipAdvanced: boolean;
  toCursor?: string;
}

/** Envelope (A2.6): closed field list. */
export interface AttentionResult {
  schemaVersion: typeof ATTENTION_SCHEMA_VERSION;
  orderingVersion: typeof ATTENTION_ORDERING_VERSION;
  rulesEvaluated: AttentionReason[];
  workspaceId: string;
  observedAt: string;
  contributionTip: number;
  orientationCursor: string;
  coverage: { perSource: PerSourceCoverage[]; completeUnderRules: boolean };
  total: number;
  returned: number;
  truncated: boolean;
  nextCursor?: string;
  cues: AttentionCue[];
  catchUp: AttentionCatchUp;
}

/** Authority fingerprint bound into the cursor. */
export interface AttentionAuthority {
  role: string;
  canDecisionUpdate: boolean;
  canTaskUpdate: boolean;
  reviewEligible: boolean;
  workspaceStatus: string;
}

export interface AttentionWho {
  actorType: "human" | "agent";
  actorId: string;
}

export interface AttentionCursor {
  v: 1;
  ordering: typeof ATTENTION_ORDERING_VERSION;
  workspaceId: string;
  actorType: "human" | "agent";
  actorId: string;
  rules: readonly AttentionReason[];
  limit: number;
  observedAt: string;
  contributionTip: number;
  authority: AttentionAuthority;
  last: { block: number; sourceUpdatedAt: string; subjectType: string; subjectId: string; id: string };
}

// ---------------------------------------------------------------------------
// Phase A: snapshot types, pure derivation core (no store, clock, fs, network).
// ---------------------------------------------------------------------------

export interface AttentionSourceScan<T> {
  /** Exact COUNT in the same snapshot. */
  total: number;
  /** At most S rows, in SQL order (SQL order only selects which rows are scanned, A2.4). */
  rows: T[];
}
export interface AttentionTaskRow {
  id: string;
  title: string;
  updatedAt: string;
}
export interface AttentionDecisionRow {
  id: string;
  summary: string;
  updatedAt: string;
}
export interface AttentionProposalRow {
  id: string;
  updatedAt: string;
  expiresAt: string;
}

/** One authorized, workspace-scoped read of every cue input. */
export interface AttentionSnapshot {
  tip?: { id: string; createdAt: string; appendPosition: number };
  memoryHealth: MemoryHealthRows;
  assignedBlocked: AttentionSourceScan<AttentionTaskRow>;
  assignedOpen: AttentionSourceScan<AttentionTaskRow>;
  unassignedBlocked: AttentionSourceScan<AttentionTaskRow>;
  teamBlocked: AttentionSourceScan<AttentionTaskRow>;
  proposedDecisions: AttentionSourceScan<AttentionDecisionRow>;
  /** Absent when the workspace is not active (F13 skip). */
  awaitingReview?: AttentionSourceScan<AttentionProposalRow>;
}

export interface AttentionSnapshotRequest {
  who: AttentionWho;
  canTaskUpdate: boolean;
  /** True only for an active workspace. */
  includeReview: boolean;
}

export interface DeriveAttentionInput {
  workspaceId: string;
  who: AttentionWho;
  authority: AttentionAuthority;
  limit: number;
  /** Already decoded, bound and authority-checked by the caller. */
  cursor?: AttentionCursor;
  observedAt: string;
  contributionTip: number;
  orientationCursor: string;
  snapshot: AttentionSnapshot;
  catchUp: AttentionCatchUp;
}

export function utf8Length(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

/** id = "fac1:" + [reason, subjectType, subjectId].map(v => utf8ByteLength(v) + ":" + v).join("") */
export function attentionCueId(reason: AttentionReason, subjectType: AttentionSubjectType, subjectId: string): string {
  return `fac1:${[reason, subjectType, subjectId].map((v) => `${utf8Length(v)}:${v}`).join("")}`;
}

export function validateAttentionLimit(limit: number | undefined): number {
  if (limit === undefined) return ATTENTION_DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < ATTENTION_MIN_LIMIT || limit > ATTENTION_MAX_LIMIT) {
    throw new ValidationError("Attention limit must be an integer from 1 to 100", { field: ATTENTION_ERROR_FIELDS.limit });
  }
  return limit;
}

export function audienceFor(reason: AttentionReason, authority: AttentionAuthority): AttentionAudience {
  switch (reason) {
    case "action_proposal_awaiting_review":
      return authority.reviewEligible ? "you" : "team";
    case "assigned_blocked_task":
    case "proposed_decision_actionable":
      return "you";
    case "assigned_open_task":
      return authority.canTaskUpdate ? "you" : "team";
    default:
      return "team";
  }
}

/** Block = fixed position of the (audience, reason) pair; you-blocks precede team-blocks. */
export function attentionBlock(reason: AttentionReason, audience: AttentionAudience): number {
  return (audience === "you" ? 0 : 1) * ATTENTION_REASONS.length + ATTENTION_REASONS.indexOf(reason);
}

export type AttentionOrderKey = { block: number; sourceUpdatedAt: string; subjectType: string; subjectId: string; id: string };

export function attentionOrderKey(cue: AttentionCue): AttentionOrderKey {
  return {
    block: attentionBlock(cue.reason, cue.audience),
    sourceUpdatedAt: cue.sourceUpdatedAt,
    subjectType: cue.subjectType,
    subjectId: cue.subjectId,
    id: cue.id,
  };
}

/** fac-1 order: block, sourceUpdatedAt descending (parsed time), subject type, subject id (UTF-8), cue id. */
export function compareAttentionKeys(a: AttentionOrderKey, b: AttentionOrderKey): number {
  if (a.block !== b.block) return a.block - b.block;
  const time = Date.parse(b.sourceUpdatedAt) - Date.parse(a.sourceUpdatedAt);
  if (time !== 0) return time;
  return compareUtf8(a.subjectType, b.subjectType) || compareUtf8(a.subjectId, b.subjectId) || compareUtf8(a.id, b.id);
}

export function compareAttentionCues(a: AttentionCue, b: AttentionCue): number {
  return compareAttentionKeys(attentionOrderKey(a), attentionOrderKey(b));
}

export function attentionAuthorityEquals(a: AttentionAuthority, b: AttentionAuthority): boolean {
  return (
    a.role === b.role &&
    a.canDecisionUpdate === b.canDecisionUpdate &&
    a.canTaskUpdate === b.canTaskUpdate &&
    a.reviewEligible === b.reviewEligible &&
    a.workspaceStatus === b.workspaceStatus
  );
}

// --- cursor ----------------------------------------------------------------

export function encodeAttentionCursor(cursor: AttentionCursor): string {
  const payload: AttentionCursor = {
    v: 1,
    ordering: ATTENTION_ORDERING_VERSION,
    workspaceId: cursor.workspaceId,
    actorType: cursor.actorType,
    actorId: cursor.actorId,
    rules: [...cursor.rules],
    limit: cursor.limit,
    observedAt: cursor.observedAt,
    contributionTip: cursor.contributionTip,
    authority: {
      role: cursor.authority.role,
      canDecisionUpdate: cursor.authority.canDecisionUpdate,
      canTaskUpdate: cursor.authority.canTaskUpdate,
      reviewEligible: cursor.authority.reviewEligible,
      workspaceStatus: cursor.authority.workspaceStatus,
    },
    last: {
      block: cursor.last.block,
      sourceUpdatedAt: cursor.last.sourceUpdatedAt,
      subjectType: cursor.last.subjectType,
      subjectId: cursor.last.subjectId,
      id: cursor.last.id,
    },
  };
  return `${ATTENTION_CURSOR_PREFIX}${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
}

export interface AttentionCursorBinding {
  workspaceId: string;
  actorType: "human" | "agent";
  actorId: string;
  limit: number;
}

function cursorError(message: string): ValidationError {
  return new ValidationError(message, { field: ATTENTION_ERROR_FIELDS.cursor });
}

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isNonNegInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

function readAuthority(value: unknown): AttentionAuthority | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const a = value as Record<string, unknown>;
  if (!nonEmpty(a.role) || !nonEmpty(a.workspaceStatus)) return undefined;
  if (typeof a.canDecisionUpdate !== "boolean" || typeof a.canTaskUpdate !== "boolean" || typeof a.reviewEligible !== "boolean") {
    return undefined;
  }
  return {
    role: a.role,
    canDecisionUpdate: a.canDecisionUpdate,
    canTaskUpdate: a.canTaskUpdate,
    reviewEligible: a.reviewEligible,
    workspaceStatus: a.workspaceStatus,
  };
}

function readLast(value: unknown): AttentionCursor["last"] | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const l = value as Record<string, unknown>;
  if (!isNonNegInt(l.block) || l.block >= ATTENTION_REASONS.length * 2) return undefined;
  if (!nonEmpty(l.sourceUpdatedAt) || !Number.isFinite(Date.parse(l.sourceUpdatedAt))) return undefined;
  if (!nonEmpty(l.subjectType) || !nonEmpty(l.subjectId) || !nonEmpty(l.id)) return undefined;
  return { block: l.block, sourceUpdatedAt: l.sourceUpdatedAt, subjectType: l.subjectType, subjectId: l.subjectId, id: l.id };
}

/** Shape, prefix, ordering and binding checks. No store, no authority: those are separate steps (5.2). */
export function decodeAttentionCursor(token: string, binding: AttentionCursorBinding): AttentionCursor {
  if (typeof token !== "string" || !token.startsWith(ATTENTION_CURSOR_PREFIX)) throw cursorError("Cursor is malformed");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(token.slice(ATTENTION_CURSOR_PREFIX.length), "base64url").toString("utf8"));
  } catch {
    throw cursorError("Cursor is malformed");
  }
  if (typeof parsed !== "object" || parsed === null) throw cursorError("Cursor is malformed");
  const c = parsed as Record<string, unknown>;
  if (c.v !== 1) throw cursorError("Cursor is malformed");
  if (c.ordering !== ATTENTION_ORDERING_VERSION) throw cursorError("Cursor does not match this request");
  if (!nonEmpty(c.workspaceId) || !nonEmpty(c.actorId) || (c.actorType !== "human" && c.actorType !== "agent")) {
    throw cursorError("Cursor is malformed");
  }
  if (!Array.isArray(c.rules) || c.rules.some((r) => typeof r !== "string")) throw cursorError("Cursor is malformed");
  if (!Number.isInteger(c.limit) || (c.limit as number) < ATTENTION_MIN_LIMIT || (c.limit as number) > ATTENTION_MAX_LIMIT) {
    throw cursorError("Cursor is malformed");
  }
  if (!nonEmpty(c.observedAt) || !Number.isFinite(Date.parse(c.observedAt)) || !isNonNegInt(c.contributionTip)) {
    throw cursorError("Cursor is malformed");
  }
  const authority = readAuthority(c.authority);
  const last = readLast(c.last);
  if (authority === undefined || last === undefined) throw cursorError("Cursor is malformed");
  const rules = c.rules as AttentionReason[];
  const sameRules = rules.length === ATTENTION_REASONS.length && rules.every((r, i) => r === ATTENTION_REASONS[i]);
  if (
    c.workspaceId !== binding.workspaceId ||
    c.actorType !== binding.actorType ||
    c.actorId !== binding.actorId ||
    c.limit !== binding.limit ||
    !sameRules
  ) {
    throw cursorError("Cursor does not match this request");
  }
  return {
    v: 1,
    ordering: ATTENTION_ORDERING_VERSION,
    workspaceId: c.workspaceId as string,
    actorType: c.actorType as "human" | "agent",
    actorId: c.actorId as string,
    rules,
    limit: c.limit as number,
    observedAt: c.observedAt as string,
    contributionTip: c.contributionTip as number,
    authority,
    last,
  };
}

// --- memory-health fold ------------------------------------------------------

export interface FoldedAttentionCue {
  reason: AttentionReason;
  subjectType: AttentionSubjectType;
  subjectId: string;
  relatedIds: string[];
  sourceUpdatedAt: string;
  triggerCount: number;
}

/**
 * Runs `deriveMemoryHealthCues` UNCHANGED, then folds triggers per
 * (reason, subjectType, subjectId): relatedIds is the deduplicated UTF-8
 * ascending union, sourceUpdatedAt the maximum `sourceUpdateTime` (A1.8).
 */
export function foldMemoryHealthCues(rows: MemoryHealthRows): FoldedAttentionCue[] {
  const folded = new Map<string, FoldedAttentionCue>();
  for (const cue of deriveMemoryHealthCues(rows, MEMORY_HEALTH_REASONS)) {
    const key = JSON.stringify([cue.reason, cue.subjectType, cue.subjectId]);
    const existing = folded.get(key);
    if (existing === undefined) {
      folded.set(key, {
        reason: cue.reason,
        subjectType: cue.subjectType,
        subjectId: cue.subjectId,
        relatedIds: [...new Set(cue.relatedRecordIds)],
        sourceUpdatedAt: cue.sourceUpdateTime,
        triggerCount: 1,
      });
      continue;
    }
    existing.triggerCount += 1;
    for (const id of cue.relatedRecordIds) if (!existing.relatedIds.includes(id)) existing.relatedIds.push(id);
    if (Date.parse(cue.sourceUpdateTime) > Date.parse(existing.sourceUpdatedAt)) existing.sourceUpdatedAt = cue.sourceUpdateTime;
  }
  const out = [...folded.values()];
  for (const f of out) f.relatedIds.sort(compareUtf8);
  return out;
}

// --- summaries (A2.2: fixed templates, no record body, URI, token or path) --------

function relatedPhrase(count: number): string {
  return `${count} related record${count === 1 ? "" : "s"}`;
}

export function foldedSummary(reason: AttentionReason, subjectType: AttentionSubjectType, subjectId: string, relatedCount: number): string {
  switch (reason) {
    case "action_outcome_unknown":
      return `ActionProposal ${subjectId} has an unknown submission outcome (${relatedPhrase(relatedCount)}).`;
    case "accepted_decision_needs_review":
      return `Accepted Decision ${subjectId} needs review (${relatedPhrase(relatedCount)}).`;
    case "current_finding_has_contradicting_evidence":
      return `Current Finding ${subjectId} has contradicting evidence (${relatedPhrase(relatedCount)}).`;
    case "blocked_task_missing_context":
      return `Blocked Task ${subjectId} has no recorded description or assignee.`;
    default:
      return `${subjectType} ${subjectId}: ${reason} (${relatedPhrase(relatedCount)}).`;
  }
}

export function awaitingReviewSummary(proposalId: string): string {
  return `ActionProposal ${proposalId} is proposed and awaiting review.`;
}

// --- derivation ------------------------------------------------------------------

function scanCoverage(reason: AttentionReason, total: number, scanned: number): PerSourceCoverage {
  return { reason, total, scanned, truncated: total > scanned };
}

const EMPTY_SCAN = { total: 0, rows: [] as never[] };

/**
 * Pure projection of one authorized snapshot into one page of the fac-1 order.
 * Reads nothing, writes nothing, never consults a clock: `observedAt` is the
 * cursor's when a cursor is present.
 */
export function deriveAttention(input: DeriveAttentionInput): AttentionResult {
  const { authority, snapshot, who } = input;
  const observedAt = input.cursor?.observedAt ?? input.observedAt;
  const nowMs = Date.parse(observedAt);
  const cues: AttentionCue[] = [];
  const perSource = new Map<AttentionReason, PerSourceCoverage>();

  const push = (cue: Omit<AttentionCue, "id" | "identityKey" | "audience">): void => {
    cues.push({
      id: attentionCueId(cue.reason, cue.subjectType, cue.subjectId),
      identityKey: [cue.reason, cue.subjectType, cue.subjectId],
      audience: audienceFor(cue.reason, authority),
      ...cue,
    });
  };
  const taskScan = (reason: AttentionReason, scan: AttentionSourceScan<AttentionTaskRow>): void => {
    for (const row of scan.rows) {
      push({ reason, subjectType: "task", subjectId: row.id, relatedIds: [], sourceUpdatedAt: row.updatedAt, summary: row.title });
    }
    perSource.set(reason, scanCoverage(reason, scan.total, scan.rows.length));
  };

  // Newly authored reasons.
  if (authority.workspaceStatus === "active") {
    const scan = snapshot.awaitingReview ?? EMPTY_SCAN;
    for (const row of scan.rows) {
      push({
        reason: "action_proposal_awaiting_review",
        subjectType: "action_proposal",
        subjectId: row.id,
        relatedIds: [],
        sourceUpdatedAt: row.updatedAt,
        summary: awaitingReviewSummary(row.id),
        expired: nowMs > Date.parse(row.expiresAt),
      });
    }
    perSource.set("action_proposal_awaiting_review", scanCoverage("action_proposal_awaiting_review", scan.total, scan.rows.length));
  } else {
    perSource.set("action_proposal_awaiting_review", {
      reason: "action_proposal_awaiting_review",
      skipped: ATTENTION_SKIP_WORKSPACE_NOT_ACTIVE,
    });
  }
  taskScan("assigned_blocked_task", authority.canTaskUpdate ? snapshot.assignedBlocked : EMPTY_SCAN);
  const decisionReason: AttentionReason = authority.canDecisionUpdate ? "proposed_decision_actionable" : "team_proposed_decision";
  const otherDecisionReason: AttentionReason = authority.canDecisionUpdate ? "team_proposed_decision" : "proposed_decision_actionable";
  for (const row of snapshot.proposedDecisions.rows) {
    push({ reason: decisionReason, subjectType: "decision", subjectId: row.id, relatedIds: [], sourceUpdatedAt: row.updatedAt, summary: row.summary });
  }
  perSource.set(decisionReason, scanCoverage(decisionReason, snapshot.proposedDecisions.total, snapshot.proposedDecisions.rows.length));
  perSource.set(otherDecisionReason, scanCoverage(otherDecisionReason, 0, 0));
  taskScan("unassigned_blocked_task", snapshot.unassignedBlocked);
  taskScan("team_blocked_task", snapshot.teamBlocked);
  taskScan("assigned_open_task", snapshot.assignedOpen);

  // Reused memory-health reasons: load-then-fold, scanned = total.
  const mhCounts = new Map<AttentionReason, number>();
  for (const folded of foldMemoryHealthCues(snapshot.memoryHealth)) {
    mhCounts.set(folded.reason, (mhCounts.get(folded.reason) ?? 0) + 1);
    push({
      reason: folded.reason,
      subjectType: folded.subjectType,
      subjectId: folded.subjectId,
      relatedIds: folded.relatedIds,
      sourceUpdatedAt: folded.sourceUpdatedAt,
      summary: foldedSummary(folded.reason, folded.subjectType, folded.subjectId, folded.relatedIds.length),
    });
  }
  for (const reason of ATTENTION_MEMORY_HEALTH_REASONS) {
    const n = mhCounts.get(reason) ?? 0;
    perSource.set(reason, scanCoverage(reason, n, n));
  }

  const ordered = [...cues].sort(compareAttentionCues);
  const seen = new Set<string>();
  for (const cue of ordered) {
    const key = JSON.stringify(cue.identityKey);
    if (seen.has(key)) throw new Error("attention invariant: duplicate identityKey in one result");
    seen.add(key);
  }

  // Page: exact slice of the ordered scanned cues; cue array bounded in bytes.
  let start = 0;
  if (input.cursor !== undefined) {
    const last = input.cursor.last;
    const idx = ordered.findIndex((cue) => compareAttentionKeys(attentionOrderKey(cue), last) > 0);
    start = idx === -1 ? ordered.length : idx;
  }
  const page: AttentionCue[] = [];
  let bytes = 2;
  for (const cue of ordered.slice(start, start + input.limit)) {
    const size = utf8Length(JSON.stringify(cue)) + (page.length === 0 ? 0 : 1);
    if (bytes + size > ATTENTION_RESPONSE_MAX_BYTES) {
      if (page.length === 0) {
        throw new ValidationError("Attention cue exceeds the byte budget", { field: ATTENTION_ERROR_FIELDS.byteBudget });
      }
      break;
    }
    bytes += size;
    page.push(cue);
  }
  const more = start + page.length < ordered.length;
  const coverageEntries = ATTENTION_REASONS.map((reason) => perSource.get(reason)!);
  const result: AttentionResult = {
    schemaVersion: ATTENTION_SCHEMA_VERSION,
    orderingVersion: ATTENTION_ORDERING_VERSION,
    rulesEvaluated: [...ATTENTION_REASONS],
    workspaceId: input.workspaceId,
    observedAt,
    contributionTip: input.contributionTip,
    orientationCursor: input.orientationCursor,
    coverage: {
      perSource: coverageEntries,
      completeUnderRules: coverageEntries.every((entry) => entry.truncated !== true),
    },
    total: ordered.length,
    returned: page.length,
    truncated: more,
    cues: page,
    catchUp: input.catchUp,
  };
  if (more) {
    const last = page[page.length - 1]!;
    result.nextCursor = encodeAttentionCursor({
      v: 1,
      ordering: ATTENTION_ORDERING_VERSION,
      workspaceId: input.workspaceId,
      actorType: who.actorType,
      actorId: who.actorId,
      rules: ATTENTION_REASONS,
      limit: input.limit,
      observedAt,
      contributionTip: input.contributionTip,
      authority,
      last: attentionOrderKey(last),
    });
  }
  // Fixed key order for byte-identical output: nextCursor sits before cues.
  return orderEnvelope(result);
}

function orderEnvelope(r: AttentionResult): AttentionResult {
  return {
    schemaVersion: r.schemaVersion,
    orderingVersion: r.orderingVersion,
    rulesEvaluated: r.rulesEvaluated,
    workspaceId: r.workspaceId,
    observedAt: r.observedAt,
    contributionTip: r.contributionTip,
    orientationCursor: r.orientationCursor,
    coverage: r.coverage,
    total: r.total,
    returned: r.returned,
    truncated: r.truncated,
    ...(r.nextCursor === undefined ? {} : { nextCursor: r.nextCursor }),
    cues: r.cues,
    catchUp: r.catchUp,
  };
}
