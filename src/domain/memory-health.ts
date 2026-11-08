/**
 * Pure MEM-001 memory-health projection.
 *
 * Cues are derived from already-loaded rows. This module does not read a
 * store, a clock, the filesystem, or a model, and it does not decide whether
 * a contribution tip is stale.
 */
import { ValidationError } from "./errors.js";

export const MEMORY_HEALTH_SCHEMA_VERSION = 1;
export const MEMORY_HEALTH_ORDERING_VERSION = "mem-health-1";
export const MEMORY_HEALTH_DEFAULT_LIMIT = 25;
export const MEMORY_HEALTH_MAX_LIMIT = 100;
/** Serialized cue-array ceiling per page (same as Recall); the envelope adds well under 1 KiB. */
export const MEMORY_HEALTH_RESPONSE_MAX_BYTES = 48 * 1024;

export const MEMORY_HEALTH_REASONS = [
  "action_outcome_unknown",
  "accepted_decision_needs_review",
  "current_finding_has_contradicting_evidence",
  "blocked_task_missing_context",
] as const;

export type MemoryHealthReason = (typeof MEMORY_HEALTH_REASONS)[number];

export type MemoryHealthSubjectType = "decision" | "finding" | "task" | "action_proposal";

export type ReasonFacts =
  | {
      reason: "action_outcome_unknown";
      sourceFacts: {
        proposalStatus: "submission_unknown";
        proposalRevision: number;
        taskId: string;
        unknownReceiptId: string;
        unknownReceiptOutcome: "unknown";
        reservationId: string;
      };
    }
  | {
      reason: "accepted_decision_needs_review";
      sourceFacts: {
        decisionStatus: "accepted";
        citationId: string;
        findingId: string;
        findingCurrentness: "superseded" | "withdrawn";
      };
    }
  | {
      reason: "current_finding_has_contradicting_evidence";
      sourceFacts: {
        findingCurrentness: "current";
        evidenceId: string;
        artifactId: string;
        relation: "contradicts";
      };
    }
  | {
      reason: "blocked_task_missing_context";
      sourceFacts: {
        taskStatus: "blocked";
        hasDescription: false;
        hasAssignee: false;
      };
    };

export type MemoryHealthCue = {
  id: string;
  subjectType: MemoryHealthSubjectType;
  subjectId: string;
  relatedRecordIds: string[];
  summary: string;
  createdAt: string;
  updatedAt?: string;
  sourceUpdateTime: string;
} & ReasonFacts;

export interface MemoryHealthCoverage {
  rulesEvaluated: MemoryHealthReason[];
  total: number;
  returned: number;
  truncated: boolean;
}

export interface MemoryHealthResult {
  kind: "memory_health";
  schemaVersion: 1;
  workspaceId: string;
  observedAt: string;
  orientationCursor: string;
  filters: { reason?: MemoryHealthReason };
  coverage: MemoryHealthCoverage;
  cues: MemoryHealthCue[];
  nextCursor?: string;
}

export interface DecisionHealthCitation {
  id: string;
  findingId: string;
  createdAt: string;
  findingCurrentness: string;
  findingCreatedAt: string;
  findingCorrectedAt?: string | null;
}

export interface DecisionHealthRow {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  citations: DecisionHealthCitation[];
}

export interface FindingHealthEvidence {
  id: string;
  artifactId: string;
  relation: string;
  createdAt: string;
  artifactCreatedAt: string;
}

export interface FindingHealthRow {
  id: string;
  currentness: string;
  createdAt: string;
  evidence: FindingHealthEvidence[];
}

export interface TaskHealthRow {
  id: string;
  status: string;
  description?: string | null;
  assigneeId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProposalHealthReceipt {
  id: string;
  outcome: string;
  recordedAt: string;
}

export interface ProposalHealthRow {
  id: string;
  status: string;
  revision: number;
  taskId: string;
  reservationId: string;
  createdAt: string;
  updatedAt: string;
  receipts: ProposalHealthReceipt[];
}

/** Rows already loaded by an authorized read. The projection does not query. */
export interface MemoryHealthRows {
  decisions: readonly DecisionHealthRow[];
  findings: readonly FindingHealthRow[];
  tasks: readonly TaskHealthRow[];
  proposals: readonly ProposalHealthRow[];
}

export interface MemoryHealthCursorLast {
  severity: number;
  sourceUpdateTime: string;
  subjectType: MemoryHealthSubjectType;
  subjectId: string;
  id: string;
}

export interface MemoryHealthCursor {
  ordering: typeof MEMORY_HEALTH_ORDERING_VERSION;
  workspaceId: string;
  actorType: "human" | "agent";
  actorId: string;
  role: string;
  reason: MemoryHealthReason | null;
  limit: number;
  observedAt: string;
  contributionTip: number;
  last: MemoryHealthCursorLast;
}

export interface MemoryHealthCursorBinding {
  workspaceId: string;
  actorType: "human" | "agent";
  actorId: string;
  role: string;
  reason: MemoryHealthReason | null;
  limit: number;
}

export interface PageMemoryHealthInput {
  rows: MemoryHealthRows;
  supportedReasons: readonly MemoryHealthReason[];
  workspaceId: string;
  actorType: "human" | "agent";
  actorId: string;
  role: string;
  observedAt: string;
  orientationCursor: string;
  contributionTip: number;
  reason?: string;
  limit?: number;
  cursor?: string;
  byteBudget?: number;
}

const CURSOR_PREFIX = "mh1.";

const SEVERITY: Record<MemoryHealthReason, number> = {
  action_outcome_unknown: 0,
  accepted_decision_needs_review: 1,
  current_finding_has_contradicting_evidence: 2,
  blocked_task_missing_context: 3,
};

export function memoryHealthCueId(
  reason: MemoryHealthReason,
  subjectType: MemoryHealthSubjectType,
  subjectId: string,
  triggerId?: string,
): string {
  const base = `mh1:${reason}:${subjectType}:${utf8LengthPrefixed(subjectId)}`;
  if (reason === "blocked_task_missing_context" || triggerId === undefined) return base;
  return `${base}:${utf8LengthPrefixed(triggerId)}`;
}

export function validateMemoryHealthInput(
  input: { reason?: string; limit?: number },
  supportedReasons: readonly MemoryHealthReason[],
): { reason?: MemoryHealthReason; limit: number } {
  return {
    reason: validateReason(input.reason, supportedReasons),
    limit: validateLimit(input.limit),
  };
}

export function deriveMemoryHealthCues(
  rows: MemoryHealthRows,
  supportedReasons: readonly MemoryHealthReason[],
): MemoryHealthCue[] {
  const supported = new Set(supportedReasons);
  const cues: MemoryHealthCue[] = [];
  if (supported.has("action_outcome_unknown")) cues.push(...proposalCues(rows.proposals));
  if (supported.has("accepted_decision_needs_review")) cues.push(...decisionCues(rows.decisions));
  if (supported.has("current_finding_has_contradicting_evidence")) cues.push(...findingCues(rows.findings));
  if (supported.has("blocked_task_missing_context")) cues.push(...taskCues(rows.tasks));
  return cues;
}

export function orderMemoryHealthCues(cues: readonly MemoryHealthCue[]): MemoryHealthCue[] {
  return [...cues].sort(compareCues);
}

export function encodeMemoryHealthCursor(cursor: MemoryHealthCursor): string {
  return `${CURSOR_PREFIX}${Buffer.from(JSON.stringify(cursorPayload(cursor)), "utf8").toString("base64url")}`;
}

export function decodeMemoryHealthCursor(token: string, binding: MemoryHealthCursorBinding): MemoryHealthCursor {
  if (typeof token !== "string" || !token.startsWith(CURSOR_PREFIX)) {
    throw cursorError("Cursor is malformed");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(token.slice(CURSOR_PREFIX.length), "base64url").toString("utf8"));
  } catch {
    throw cursorError("Cursor is malformed");
  }
  const cursor = readCursor(parsed);
  if (cursor === undefined) throw cursorError("Cursor is malformed");
  if (!bindingMatches(cursor, binding)) throw cursorError("Cursor does not match this request");
  return cursor;
}

export function pageMemoryHealth(input: PageMemoryHealthInput): MemoryHealthResult {
  const validated = validateMemoryHealthInput(
    { reason: input.reason, limit: input.limit },
    input.supportedReasons,
  );
  const binding: MemoryHealthCursorBinding = {
    workspaceId: input.workspaceId,
    actorType: input.actorType,
    actorId: input.actorId,
    role: input.role,
    reason: validated.reason ?? null,
    limit: validated.limit,
  };
  const decoded = input.cursor === undefined ? undefined : decodeMemoryHealthCursor(input.cursor, binding);
  const ordered = orderMemoryHealthCues(
    deriveMemoryHealthCues(input.rows, rulesFor(input.supportedReasons, validated.reason)),
  );
  const start = decoded === undefined ? 0 : indexAfter(ordered, decoded.last);
  const page: MemoryHealthCue[] = [];
  for (const cue of ordered.slice(start, start + validated.limit)) {
    if (input.byteBudget !== undefined && !fitsBudget(page, cue, input.byteBudget)) break;
    page.push(cue);
  }
  const truncated = start + page.length < ordered.length;
  const observedAt = decoded?.observedAt ?? input.observedAt;
  const contributionTip = decoded?.contributionTip ?? input.contributionTip;
  const result: MemoryHealthResult = {
    kind: "memory_health",
    schemaVersion: MEMORY_HEALTH_SCHEMA_VERSION,
    workspaceId: input.workspaceId,
    observedAt,
    orientationCursor: input.orientationCursor,
    filters: validated.reason === undefined ? {} : { reason: validated.reason },
    coverage: {
      rulesEvaluated: rulesEvaluated(input.supportedReasons, validated.reason),
      total: ordered.length,
      returned: page.length,
      truncated,
    },
    cues: page,
  };
  if (truncated) {
    const last = page[page.length - 1];
    if (last === undefined) {
      throw new ValidationError("Memory-health cue exceeds the byte budget", { field: "byteBudget" });
    }
    result.nextCursor = encodeMemoryHealthCursor({
      ordering: MEMORY_HEALTH_ORDERING_VERSION,
      workspaceId: input.workspaceId,
      actorType: input.actorType,
      actorId: input.actorId,
      role: input.role,
      reason: validated.reason ?? null,
      limit: validated.limit,
      observedAt,
      contributionTip,
      last: lastTuple(last),
    });
  }
  return result;
}

function rulesFor(
  supportedReasons: readonly MemoryHealthReason[],
  reason: MemoryHealthReason | undefined,
): readonly MemoryHealthReason[] {
  if (reason !== undefined) return [reason];
  return supportedReasons;
}

function rulesEvaluated(
  supportedReasons: readonly MemoryHealthReason[],
  reason: MemoryHealthReason | undefined,
): MemoryHealthReason[] {
  if (reason !== undefined) return [reason];
  return MEMORY_HEALTH_REASONS.filter((code) => supportedReasons.includes(code));
}

function proposalCues(proposals: readonly ProposalHealthRow[]): MemoryHealthCue[] {
  const cues: MemoryHealthCue[] = [];
  for (const proposal of proposals) {
    if (proposal.status !== "submission_unknown") continue;
    for (const receipt of proposal.receipts) {
      if (receipt.outcome !== "unknown") continue;
      const reason = "action_outcome_unknown" as const;
      cues.push({
        id: memoryHealthCueId(reason, "action_proposal", proposal.id, receipt.id),
        reason,
        subjectType: "action_proposal",
        subjectId: proposal.id,
        relatedRecordIds: [proposal.taskId, receipt.id, proposal.reservationId],
        summary: `ActionProposal ${proposal.id} has unknown submission outcome; reconcile receipt ${receipt.id} before any retry.`,
        sourceFacts: {
          proposalStatus: "submission_unknown",
          proposalRevision: proposal.revision,
          taskId: proposal.taskId,
          unknownReceiptId: receipt.id,
          unknownReceiptOutcome: "unknown",
          reservationId: proposal.reservationId,
        },
        createdAt: proposal.createdAt,
        updatedAt: proposal.updatedAt,
        sourceUpdateTime: maxCanonicalUtc([proposal.updatedAt, receipt.recordedAt]),
      });
    }
  }
  return cues;
}

function decisionCues(decisions: readonly DecisionHealthRow[]): MemoryHealthCue[] {
  const cues: MemoryHealthCue[] = [];
  for (const decision of decisions) {
    if (decision.status !== "accepted") continue;
    for (const citation of decision.citations) {
      if (citation.findingCurrentness !== "superseded" && citation.findingCurrentness !== "withdrawn") continue;
      const reason = "accepted_decision_needs_review" as const;
      const findingCurrentness = citation.findingCurrentness;
      cues.push({
        id: memoryHealthCueId(reason, "decision", decision.id, citation.id),
        reason,
        subjectType: "decision",
        subjectId: decision.id,
        relatedRecordIds: [citation.id, citation.findingId],
        summary: `Accepted Decision ${decision.id} needs review because cited Finding ${citation.findingId} is ${findingCurrentness} (citation ${citation.id}); acceptance is unchanged.`,
        sourceFacts: {
          decisionStatus: "accepted",
          citationId: citation.id,
          findingId: citation.findingId,
          findingCurrentness,
        },
        createdAt: decision.createdAt,
        updatedAt: decision.updatedAt,
        sourceUpdateTime: maxCanonicalUtc([
          decision.updatedAt,
          citation.createdAt,
          citation.findingCorrectedAt ?? citation.findingCreatedAt,
        ]),
      });
    }
  }
  return cues;
}

function findingCues(findings: readonly FindingHealthRow[]): MemoryHealthCue[] {
  const cues: MemoryHealthCue[] = [];
  for (const finding of findings) {
    if (finding.currentness !== "current") continue;
    for (const evidence of finding.evidence) {
      if (evidence.relation !== "contradicts") continue;
      const reason = "current_finding_has_contradicting_evidence" as const;
      cues.push({
        id: memoryHealthCueId(reason, "finding", finding.id, evidence.id),
        reason,
        subjectType: "finding",
        subjectId: finding.id,
        relatedRecordIds: [evidence.id, evidence.artifactId],
        summary: `Current Finding ${finding.id} has contradicting evidence ${evidence.id} for Artifact ${evidence.artifactId}; the Finding remains current.`,
        sourceFacts: {
          findingCurrentness: "current",
          evidenceId: evidence.id,
          artifactId: evidence.artifactId,
          relation: "contradicts",
        },
        createdAt: finding.createdAt,
        sourceUpdateTime: maxCanonicalUtc([finding.createdAt, evidence.createdAt, evidence.artifactCreatedAt]),
      });
    }
  }
  return cues;
}

function taskCues(tasks: readonly TaskHealthRow[]): MemoryHealthCue[] {
  const cues: MemoryHealthCue[] = [];
  for (const task of tasks) {
    if (task.status !== "blocked") continue;
    if (presentText(task.description) || presentText(task.assigneeId)) continue;
    const reason = "blocked_task_missing_context" as const;
    cues.push({
      id: memoryHealthCueId(reason, "task", task.id),
      reason,
      subjectType: "task",
      subjectId: task.id,
      relatedRecordIds: [],
      summary: `Blocked Task ${task.id} has no recorded description or assignee.`,
      sourceFacts: {
        taskStatus: "blocked",
        hasDescription: false,
        hasAssignee: false,
      },
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      sourceUpdateTime: maxCanonicalUtc([task.updatedAt]),
    });
  }
  return cues;
}

function presentText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function compareCues(left: MemoryHealthCue, right: MemoryHealthCue): number {
  const severity = SEVERITY[left.reason] - SEVERITY[right.reason];
  if (severity !== 0) return severity;
  const time = Date.parse(right.sourceUpdateTime) - Date.parse(left.sourceUpdateTime);
  if (time !== 0) return time;
  const subjectType = compareUtf8(left.subjectType, right.subjectType);
  if (subjectType !== 0) return subjectType;
  const subjectId = compareUtf8(left.subjectId, right.subjectId);
  if (subjectId !== 0) return subjectId;
  return compareUtf8(left.id, right.id);
}

function lastTuple(cue: MemoryHealthCue): MemoryHealthCursorLast {
  return {
    severity: SEVERITY[cue.reason],
    sourceUpdateTime: cue.sourceUpdateTime,
    subjectType: cue.subjectType,
    subjectId: cue.subjectId,
    id: cue.id,
  };
}

function indexAfter(cues: readonly MemoryHealthCue[], last: MemoryHealthCursorLast): number {
  const index = cues.findIndex((cue) => compareCueToLast(cue, last) > 0);
  return index === -1 ? cues.length : index;
}

function compareCueToLast(cue: MemoryHealthCue, last: MemoryHealthCursorLast): number {
  const severity = SEVERITY[cue.reason] - last.severity;
  if (severity !== 0) return severity;
  const time = Date.parse(last.sourceUpdateTime) - Date.parse(cue.sourceUpdateTime);
  if (time !== 0) return time;
  const subjectType = compareUtf8(cue.subjectType, last.subjectType);
  if (subjectType !== 0) return subjectType;
  const subjectId = compareUtf8(cue.subjectId, last.subjectId);
  if (subjectId !== 0) return subjectId;
  return compareUtf8(cue.id, last.id);
}

function fitsBudget(page: readonly MemoryHealthCue[], cue: MemoryHealthCue, byteBudget: number): boolean {
  const next = [...page, cue];
  const bytes = Buffer.byteLength(JSON.stringify(next), "utf8");
  if (bytes <= byteBudget) return true;
  if (page.length === 0) {
    throw new ValidationError("Memory-health cue exceeds the byte budget", { field: "byteBudget" });
  }
  return false;
}

function maxCanonicalUtc(timestamps: readonly string[]): string {
  let best: string | undefined;
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const value of timestamps) {
    if (!isCanonicalUtc(value)) {
      throw new ValidationError("Memory-health timestamp is invalid", { field: "sourceUpdateTime" });
    }
    const ms = Date.parse(value);
    if (ms > bestMs) {
      best = value;
      bestMs = ms;
    }
  }
  if (best === undefined) {
    throw new ValidationError("Memory-health timestamp is invalid", { field: "sourceUpdateTime" });
  }
  return best;
}

function isCanonicalUtc(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
}

function utf8LengthPrefixed(value: string): string {
  return `${Buffer.byteLength(value, "utf8")}:${value}`;
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function validateLimit(limit: number | undefined): number {
  if (limit === undefined) return MEMORY_HEALTH_DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MEMORY_HEALTH_MAX_LIMIT) {
    throw new ValidationError("Memory-health limit must be an integer from 1 to 100", { field: "limit" });
  }
  return limit;
}

function validateReason(
  reason: string | undefined,
  supportedReasons: readonly MemoryHealthReason[],
): MemoryHealthReason | undefined {
  if (reason === undefined) return undefined;
  if (!(MEMORY_HEALTH_REASONS as readonly string[]).includes(reason) || !supportedReasons.includes(reason as MemoryHealthReason)) {
    throw new ValidationError("Memory-health reason is not supported", { field: "reason" });
  }
  return reason as MemoryHealthReason;
}

function cursorError(message: string): ValidationError {
  return new ValidationError(message, { field: "cursor" });
}

function bindingMatches(cursor: MemoryHealthCursor, binding: MemoryHealthCursorBinding): boolean {
  return (
    cursor.workspaceId === binding.workspaceId &&
    cursor.actorType === binding.actorType &&
    cursor.actorId === binding.actorId &&
    cursor.role === binding.role &&
    cursor.reason === binding.reason &&
    cursor.limit === binding.limit
  );
}

function cursorPayload(cursor: MemoryHealthCursor): MemoryHealthCursor & { v: 1 } {
  return { v: 1, ...cursor, ordering: MEMORY_HEALTH_ORDERING_VERSION };
}

function readCursor(value: unknown): MemoryHealthCursor | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const cursor = value as Record<string, unknown>;
  if (cursor.v !== 1 || cursor.ordering !== MEMORY_HEALTH_ORDERING_VERSION) return undefined;
  if (!nonEmpty(cursor.workspaceId) || (cursor.actorType !== "human" && cursor.actorType !== "agent")) return undefined;
  if (!nonEmpty(cursor.actorId) || !nonEmpty(cursor.role)) return undefined;
  if (!(cursor.reason === null || isReason(cursor.reason))) return undefined;
  if (!Number.isInteger(cursor.limit) || (cursor.limit as number) < 1 || (cursor.limit as number) > MEMORY_HEALTH_MAX_LIMIT) {
    return undefined;
  }
  if (!nonEmpty(cursor.observedAt) || !isNonNegativeInteger(cursor.contributionTip)) return undefined;
  const last = readLast(cursor.last);
  if (last === undefined) return undefined;
  return {
    ordering: MEMORY_HEALTH_ORDERING_VERSION,
    workspaceId: cursor.workspaceId,
    actorType: cursor.actorType,
    actorId: cursor.actorId,
    role: cursor.role,
    reason: cursor.reason,
    limit: cursor.limit as number,
    observedAt: cursor.observedAt,
    contributionTip: cursor.contributionTip,
    last,
  };
}

function readLast(value: unknown): MemoryHealthCursorLast | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const last = value as Record<string, unknown>;
  if (!isNonNegativeInteger(last.severity) || last.severity > 3) return undefined;
  if (!nonEmpty(last.sourceUpdateTime) || !isSubjectType(last.subjectType)) return undefined;
  if (!nonEmpty(last.subjectId) || !nonEmpty(last.id)) return undefined;
  return {
    severity: last.severity,
    sourceUpdateTime: last.sourceUpdateTime,
    subjectType: last.subjectType,
    subjectId: last.subjectId,
    id: last.id,
  };
}

function isReason(value: unknown): value is MemoryHealthReason {
  return typeof value === "string" && (MEMORY_HEALTH_REASONS as readonly string[]).includes(value);
}

function isSubjectType(value: unknown): value is MemoryHealthSubjectType {
  return value === "decision" || value === "finding" || value === "task" || value === "action_proposal";
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
