/**
 * FAC-001 catch-up block (`since`). Pure: no store, clock, filesystem or
 * network. The service issues the page reads (same `pageContributions` calls
 * as `get_workspace_changes`, limit E) and this module decides every value.
 * `since` never filters cues; it only drives `catchUp` (contract s6).
 */
import {
  ATTENTION_AFFECTED_OBJECT_TYPES,
  ATTENTION_ERROR_FIELDS,
  ATTENTION_EXAMINED_CEILING,
  ATTENTION_RECOVERY_CODES,
  type AttentionCatchUp,
} from "./attention.js";
import {
  assembleCatchUp,
  decodeContextCursor,
  type ChangeSummary,
  type ContextCursor,
} from "./context-policy.js";
import type { Contribution } from "./types.js";
import { ValidationError } from "./errors.js";

export type SinceCursor = Extract<ContextCursor, { kind: "contribution" }>;

export function notRequestedCatchUp(): AttentionCatchUp {
  return { status: "not_requested", changedCount: 0, examined: 0, affectedIds: [], affectedTruncated: false, tipAdvanced: false };
}

function sinceError(message: string, workspaceId?: string): ValidationError {
  return new ValidationError(message, {
    field: ATTENTION_ERROR_FIELDS.since,
    ...(workspaceId === undefined ? {} : { workspaceId }),
  });
}

/** Shape, kind and workspace only (5.2 step 3). The shared `cf1.` decoder's `cursor` field is remapped to `since`. */
export function decodeAttentionSince(token: string, workspaceId: string): SinceCursor {
  let cursor: ContextCursor;
  try {
    cursor = decodeContextCursor(token);
  } catch {
    throw sinceError("since is malformed");
  }
  if (cursor.workspaceId !== workspaceId) throw sinceError("since belongs to a different workspace", workspaceId);
  if (cursor.kind !== "contribution") throw sinceError("since is not a contribution cursor");
  return cursor;
}

/** 5.2 step 6: a position (or frozen tip) above the current maximum is not an empty page (A2.8). */
export function assertSinceNotAheadOfTip(since: SinceCursor, currentTip: number): void {
  if (since.position > currentTip || (since.tip !== 0 && since.tip > currentTip)) {
    throw new ValidationError("since is ahead of the current contribution tip", {
      field: ATTENTION_ERROR_FIELDS.since,
      recoveryCode: ATTENTION_RECOVERY_CODES.cursorAheadOfTip,
    });
  }
}

/** The run's inclusive upper bound: the cursor's frozen tip, else the current snapshot tip. */
export function planAttentionCatchUp(since: SinceCursor, currentTip: number): {
  tip: number;
  origin: { occurredAt: string; id: string; position: number };
  limit: number;
} {
  return {
    tip: since.tip === 0 ? currentTip : since.tip,
    origin: { occurredAt: since.originOccurredAt, id: since.originId, position: since.originPosition },
    limit: ATTENTION_EXAMINED_CEILING,
  };
}

export interface AttentionCatchUpPages {
  workspaceId: string;
  fromCursor: string;
  since: SinceCursor;
  currentTip: number;
  high: readonly Contribution[];
  highHasMore: boolean;
  normal: readonly Contribution[];
  normalHasMore: boolean;
  /** Exact row counts in (originPosition, tip] for each materiality, from the same snapshot. */
  highTotal: number;
  normalTotal: number;
}

const AFFECTED = new Set<string>(ATTENTION_AFFECTED_OBJECT_TYPES);

export function affectedAttentionIds(items: readonly ChangeSummary[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (!AFFECTED.has(item.objectType)) continue;
    const id = `${item.objectType}:${item.objectId}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function assembleAttentionCatchUp(pages: AttentionCatchUpPages): AttentionCatchUp {
  const plan = planAttentionCatchUp(pages.since, pages.currentTip);
  const assembled = assembleCatchUp({
    workspaceId: pages.workspaceId,
    fromCursor: pages.fromCursor,
    phase: pages.since.phase,
    origin: plan.origin,
    tip: plan.tip,
    high: pages.high,
    highHasMore: pages.highHasMore,
    normal: pages.normal,
    normalHasMore: pages.normalHasMore,
  });
  const changedCount = pages.highTotal + pages.normalTotal;
  const examined = assembled.items.length;
  return {
    status: assembled.hasMore ? "partial" : "complete",
    changedCount,
    examined,
    affectedIds: affectedAttentionIds(assembled.items),
    affectedTruncated: changedCount > examined,
    tipAdvanced: pages.since.tip !== 0 && pages.currentTip > pages.since.tip,
    toCursor: assembled.toCursor,
  };
}
