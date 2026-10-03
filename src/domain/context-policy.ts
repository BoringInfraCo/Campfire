/**
 * CTX-001 selection policy.
 *
 * Orientation, catch-up, and drill-down share this module so CLI, MCP, and
 * HTTP cannot grow a second ranking rule. Selection uses structured fields
 * that already exist. Findings are not attached to tasks or decisions; the
 * only relationship is `Finding.sourceArtifactId`. This sprint does not add
 * one. Superseding a finding or decision is a later lifecycle.
 */
import { ValidationError } from "./errors.js";
import type { ActorRef, Contribution, ContributionObjectType, Decision, DecisionStatus, Task, TaskStatus } from "./types.js";

export const CONTEXT_SCHEMA_VERSION = 1 as const;

/** Defaults are policy, not acceptance criteria. Tests may pass another budget. */
export const DEFAULT_CONTEXT_BUDGET = {
  goals: 1,
  decisions: 10,
  findings: 10,
  tasks: 20,
  blockers: 10,
  artifacts: 10,
  recentChanges: 20,
} as const;

export type ContextBudget = {
  -readonly [K in keyof typeof DEFAULT_CONTEXT_BUDGET]: number;
};

/** Hard cap for one page. Orientation lookahead uses this same ceiling. */
export const MAX_PAGE_SIZE = 100;

/**
 * Orientation recent-changes reads at most this many newest rows, then
 * prefers material ones inside that window. Catch-up does not use a lookahead:
 * it filters materiality in SQL and pages until the stream is exhausted.
 */
export const ORIENTATION_CHANGE_LOOKAHEAD = MAX_PAGE_SIZE;

export interface ContextSlice<T> {
  items: T[];
  total: number;
  returned: number;
  truncated: boolean;
  nextCursor?: string;
}

export function toContextSlice<T>(items: readonly T[], total: number, nextCursor?: string): ContextSlice<T> {
  const slice: ContextSlice<T> = {
    items: [...items],
    total,
    returned: items.length,
    truncated: items.length < total,
  };
  if (nextCursor !== undefined && slice.truncated) {
    slice.nextCursor = nextCursor;
  }
  return slice;
}

export function clampPageLimit(limit: number | undefined, fallback: number): number {
  const resolved = limit === undefined ? fallback : limit;
  if (!Number.isInteger(resolved) || resolved < 1) {
    throw new ValidationError("limit must be a positive integer", { field: "limit", limit: resolved });
  }
  if (resolved > MAX_PAGE_SIZE) {
    throw new ValidationError(`limit must be at most ${MAX_PAGE_SIZE}`, { field: "limit", limit: resolved });
  }
  return resolved;
}

/** Accepted, then proposed, then superseded. Time is newest-first inside a rank. */
export function decisionRank(status: DecisionStatus): number {
  if (status === "accepted") return 0;
  if (status === "proposed") return 1;
  return 2;
}

/** Blocked, then in progress, then open, then completed. */
export function taskRank(status: TaskStatus): number {
  switch (status) {
    case "blocked":
      return 0;
    case "in_progress":
      return 1;
    case "open":
      return 2;
    default:
      return 3;
  }
}

export function findingRank(sourceArtifactId: string | undefined): number {
  return sourceArtifactId !== undefined && sourceArtifactId.length > 0 ? 0 : 1;
}

/**
 * Keep one proposed decision visible when accepted decisions would otherwise
 * fill the budget. A budget of one still prefers the accepted decision.
 */
export function decisionFetchLimits(
  budget: number,
  counts: { accepted: number; proposed: number },
): { accepted: number; proposed: number } {
  if (budget <= 0) return { accepted: 0, proposed: 0 };
  const reserve = counts.proposed > 0 && counts.accepted > 0 && budget >= 2 ? 1 : 0;
  const accepted = Math.min(counts.accepted, budget - reserve);
  const proposed = Math.min(counts.proposed, budget - accepted);
  return { accepted, proposed };
}

export interface ChangeSummary {
  cursor: string;
  occurredAt: string;
  actorId: string;
  actorType: ActorRef["actorType"];
  objectType: ContributionObjectType;
  objectId: string;
  changeType: string;
  summary: string;
  materiality: "high" | "normal";
}

/**
 * High means the change can alter what a participant should do next.
 * Session registration, joins, invites, and title-only edits stay normal so
 * they cannot fill a catch-up page ahead of those changes.
 */
export function contributionMateriality(input: {
  action: string;
  objectType: string;
  payload?: Record<string, unknown> | null;
}): "high" | "normal" {
  const status = input.payload && typeof input.payload.status === "string" ? input.payload.status : undefined;
  if (input.objectType === "finding" && input.action === "create") return "high";
  if (input.objectType === "artifact" && input.action === "create") return "high";
  if (input.objectType === "goal" && (input.action === "create" || input.action === "update")) return "high";
  if (input.objectType === "decision" && input.action === "update" && status === "accepted") return "high";
  if (
    input.objectType === "task" &&
    input.action === "update" &&
    (status === "blocked" || status === "completed" || status === "in_progress" || status === "open")
  ) {
    return "high";
  }
  return "normal";
}

export function describeChange(input: {
  action: string;
  objectType: string;
  objectId: string;
  payload?: Record<string, unknown> | null;
}): { changeType: string; summary: string } {
  const payload = input.payload ?? {};
  const status = typeof payload.status === "string" ? payload.status : undefined;
  const label =
    typeof payload.summary === "string" ? payload.summary : typeof payload.title === "string" ? payload.title : undefined;
  const changeType = status === undefined ? input.action : `${input.action}:${status}`;
  const summary =
    label === undefined
      ? `${changeType} ${input.objectType} ${input.objectId}`
      : `${changeType} ${input.objectType} ${input.objectId}: ${label}`;
  return { changeType, summary };
}

export type ContextCursor =
  | {
      v: 1;
      kind: "contribution";
      workspaceId: string;
      occurredAt: string;
      id: string;
      phase: "high" | "normal";
      /** Catch-up boundary. Normal-phase pages restart here after material rows are exhausted. */
      originOccurredAt: string;
      originId: string;
      /** Exclusive lower bound: last consumed append position. 0 is the start of the workspace. */
      position: number;
      /** Exclusive lower bound where the normal phase restarts. */
      originPosition: number;
      /** Inclusive upper bound of this run. 0 means the run is not frozen yet. */
      tip: number;
    }
  | {
      v: 1;
      kind: "decision" | "task" | "finding" | "artifact";
      workspaceId: string;
      rank: number;
      at: string;
      id: string;
    };

const CURSOR_PREFIX = "cf1.";

export function encodeContextCursor(cursor: ContextCursor): string {
  return `${CURSOR_PREFIX}${Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")}`;
}

export function decodeContextCursor(token: string): ContextCursor {
  if (typeof token !== "string" || !token.startsWith(CURSOR_PREFIX)) {
    throw new ValidationError("Cursor is malformed", { field: "cursor" });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(token.slice(CURSOR_PREFIX.length), "base64url").toString("utf8"));
  } catch {
    throw new ValidationError("Cursor is malformed", { field: "cursor" });
  }
  if (!isContextCursor(parsed)) {
    throw new ValidationError("Cursor is malformed", { field: "cursor" });
  }
  return parsed;
}

export function assertCursorWorkspace(cursor: ContextCursor, workspaceId: string): void {
  if (cursor.workspaceId !== workspaceId) {
    throw new ValidationError("Cursor belongs to a different workspace", {
      field: "cursor",
      workspaceId,
    });
  }
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isContextCursor(value: unknown): value is ContextCursor {
  if (typeof value !== "object" || value === null) return false;
  const cursor = value as Record<string, unknown>;
  if (cursor.v !== 1 || typeof cursor.workspaceId !== "string" || cursor.workspaceId.length === 0) return false;
  if (typeof cursor.id !== "string") return false;
  if (cursor.kind === "contribution") {
    if (typeof cursor.occurredAt !== "string") return false;
    if (cursor.phase !== "high" && cursor.phase !== "normal") return false;
    if (typeof cursor.originOccurredAt !== "string" || typeof cursor.originId !== "string") return false;
    if (
      !isNonNegativeInteger(cursor.position) ||
      !isNonNegativeInteger(cursor.originPosition) ||
      !isNonNegativeInteger(cursor.tip)
    ) {
      return false;
    }
    // A normal-phase restart cannot sit in front of rows the high phase already passed.
    if (cursor.position < cursor.originPosition) return false;
    // tip 0 is unfrozen. A frozen tip must cover both bounds or the next page is empty forever.
    if (cursor.tip !== 0 && (cursor.tip < cursor.position || cursor.tip < cursor.originPosition)) return false;
    return true;
  }
  return (
    (cursor.kind === "decision" || cursor.kind === "task" || cursor.kind === "finding" || cursor.kind === "artifact") &&
    typeof cursor.rank === "number" &&
    Number.isInteger(cursor.rank) &&
    typeof cursor.at === "string"
  );
}

/** Empty id and timestamp means the beginning of the workspace stream. */
export function genesisContributionCursor(workspaceId: string): ContextCursor {
  return {
    v: 1,
    kind: "contribution",
    workspaceId,
    occurredAt: "",
    id: "",
    phase: "high",
    originOccurredAt: "",
    originId: "",
    position: 0,
    originPosition: 0,
    tip: 0,
  };
}

export function contributionCursor(input: {
  workspaceId: string;
  occurredAt: string;
  id: string;
  phase: "high" | "normal";
  originOccurredAt: string;
  originId: string;
  position: number;
  originPosition: number;
  tip: number;
}): ContextCursor {
  return { v: 1, kind: "contribution", ...input };
}

/**
 * Finished runs must not keep a frozen tip. The next catch-up freezes a new
 * tip and reads strictly after this one. A cursor with position > tip and
 * position <= tip matches nothing and would stay empty forever.
 */
function completionContributionCursor(workspaceId: string, tip: number): ContextCursor {
  return {
    v: 1,
    kind: "contribution",
    workspaceId,
    occurredAt: "",
    id: "",
    phase: "high",
    originOccurredAt: "",
    originId: "",
    position: tip,
    originPosition: tip,
    tip: 0,
  };
}

export function toChangeSummary(
  row: Contribution,
  workspaceId: string,
  origin: { occurredAt: string; id: string; position: number },
  tip: number,
): ChangeSummary {
  const materiality = contributionMateriality(row);
  const described = describeChange(row);
  return {
    cursor: encodeContextCursor(
      contributionCursor({
        workspaceId,
        occurredAt: row.createdAt,
        id: row.id,
        phase: materiality,
        originOccurredAt: origin.occurredAt,
        originId: origin.id,
        position: row.appendPosition,
        originPosition: origin.position,
        tip,
      }),
    ),
    occurredAt: row.createdAt,
    actorId: row.actor.actorId,
    actorType: row.actor.actorType,
    objectType: row.objectType,
    objectId: row.objectId,
    changeType: described.changeType,
    summary: described.summary,
    materiality,
  };
}

export interface CatchUpAssembly {
  workspaceId: string;
  fromCursor: string;
  phase: "high" | "normal";
  origin: { occurredAt: string; id: string; position: number };
  /** Inclusive append position frozen for this run. */
  tip: number;
  /** Chronological material rows after the continuation point. Already limited. */
  high: readonly Contribution[];
  highHasMore: boolean;
  /** Chronological normal rows. Already limited to the room left on this page. */
  normal: readonly Contribution[];
  normalHasMore: boolean;
}

/**
 * Material rows come first. When a full material page has no further material
 * rows, the next cursor restarts the normal phase at originPosition and keeps
 * the same tip. A finished or empty page returns a completion cursor at that
 * tip with tip cleared — not the last row, and not the frozen input cursor.
 */
export function assembleCatchUp(input: CatchUpAssembly): {
  items: ChangeSummary[];
  hasMore: boolean;
  toCursor: string;
} {
  const origin = input.origin;
  const summarize = (row: Contribution) => toChangeSummary(row, input.workspaceId, origin, input.tip);
  if (input.phase === "high" && input.highHasMore && input.high.length > 0) {
    const items = input.high.map(summarize);
    return { items, hasMore: true, toCursor: items[items.length - 1]!.cursor };
  }

  const chosen = input.phase === "high" ? [...input.high, ...input.normal] : [...input.normal];
  const items = chosen.map(summarize);
  if (
    input.phase === "high" &&
    !input.highHasMore &&
    input.normalHasMore &&
    input.normal.length === 0 &&
    input.high.length > 0
  ) {
    return {
      items,
      hasMore: true,
      toCursor: encodeContextCursor(
        contributionCursor({
          workspaceId: input.workspaceId,
          occurredAt: origin.occurredAt,
          id: origin.id,
          phase: "normal",
          originOccurredAt: origin.occurredAt,
          originId: origin.id,
          position: origin.position,
          originPosition: origin.position,
          tip: input.tip,
        }),
      ),
    };
  }

  if (items.length === 0 || !input.normalHasMore) {
    return {
      items,
      hasMore: false,
      toCursor: encodeContextCursor(completionContributionCursor(input.workspaceId, input.tip)),
    };
  }

  return { items, hasMore: true, toCursor: items[items.length - 1]!.cursor };
}

function takeNewest<T>(rows: readonly T[], count: number): T[] {
  if (count <= 0) return [];
  return rows.slice(-count);
}

/**
 * Prefer the newest material rows inside an already-bounded window, then the
 * newest normal rows. Each group stays chronological. This is an orientation
 * view, not a keyset page: callers continue history through drill-down and
 * catch up forward from `orientationCursor`.
 */
export function selectRecentChanges(
  window: readonly Contribution[],
  budget: number,
  workspaceId: string,
): ChangeSummary[] {
  const ordered = [...window].sort(compareContributionChronological);
  const high = ordered.filter((row) => contributionMateriality(row) === "high");
  const normal = ordered.filter((row) => contributionMateriality(row) === "normal");
  const chosenHigh = takeNewest(high, budget);
  const chosenNormal = takeNewest(normal, budget - chosenHigh.length);
  // Orientation cursors are not a catch-up page. Origin stays at the start and tip stays unfrozen.
  const origin = { occurredAt: "", id: "", position: 0 };
  return [...chosenHigh, ...chosenNormal].map((row) => toChangeSummary(row, workspaceId, origin, 0));
}

/** Append position is the durable order. Same-timestamp ids are not. */
export function compareContributionChronological(a: Contribution, b: Contribution): number {
  if (a.appendPosition !== b.appendPosition) return a.appendPosition < b.appendPosition ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

export function compareDecisionKeyset(a: Decision, b: Decision): number {
  const rank = decisionRank(a.status) - decisionRank(b.status);
  if (rank !== 0) return rank;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

export function affectedObjectIds(changes: readonly ChangeSummary[]): {
  decisions: string[];
  findings: string[];
  tasks: string[];
  artifacts: string[];
} {
  const decisions: string[] = [];
  const findings: string[] = [];
  const tasks: string[] = [];
  const artifacts: string[] = [];
  const seen = new Set<string>();
  for (const change of changes) {
    const key = `${change.objectType}:${change.objectId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (change.objectType === "decision") decisions.push(change.objectId);
    else if (change.objectType === "finding") findings.push(change.objectId);
    else if (change.objectType === "task") tasks.push(change.objectId);
    else if (change.objectType === "artifact") artifacts.push(change.objectId);
  }
  return { decisions, findings, tasks, artifacts };
}

export function objectCursor(input: {
  kind: "decision" | "task" | "finding" | "artifact";
  workspaceId: string;
  rank: number;
  at: string;
  id: string;
}): string {
  return encodeContextCursor({ v: 1, ...input });
}
