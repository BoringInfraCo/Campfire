/**
 * Turns an already authorized attention request into a page.
 * Both the SQLite service and the Worker service call these functions
 * (one derivation, no third copy). Step numbers are contract 5.2.
 *
 *   prepareAttentionRequest        steps 3 and 4 (no store read)
 *   (service acquires snapshot)    step 4.5
 *   assertAttentionSnapshotFresh   steps 5 and 6
 *   attentionFromSnapshot          derivation
 */
import {
  ATTENTION_ERROR_FIELDS,
  ATTENTION_NEXT_ACTIONS,
  ATTENTION_RECOVERY_CODES,
  attentionAuthorityEquals,
  decodeAttentionCursor,
  deriveAttention,
  validateAttentionLimit,
  type AttentionAuthority,
  type AttentionCatchUp,
  type AttentionCursor,
  type AttentionResult,
  type AttentionSnapshot,
  type AttentionWho,
  type GetWorkspaceAttentionInput,
} from "../domain/attention.js";
import { assertSinceNotAheadOfTip, decodeAttentionSince, type SinceCursor } from "../domain/attention-catchup.js";
import { Conflict } from "../domain/errors.js";
import { orientationCursorFromTip } from "./memory-health-read.js";

export interface PreparedAttentionRequest {
  workspaceId: string;
  limit: number;
  cursor?: AttentionCursor;
  since?: SinceCursor;
  /** The raw `since` string, echoed back as the catch-up `fromCursor` input. */
  sinceToken?: string;
}

/** Steps 3 and 4: limit, cursor shape/binding, since shape/kind/workspace, then the authority fingerprint. No store read. */
export function prepareAttentionRequest(
  input: GetWorkspaceAttentionInput,
  who: AttentionWho,
  authority: AttentionAuthority,
): PreparedAttentionRequest {
  const limit = validateAttentionLimit(input.limit);
  const cursor =
    input.cursor === undefined
      ? undefined
      : decodeAttentionCursor(input.cursor, {
          workspaceId: input.workspaceId,
          actorType: who.actorType,
          actorId: who.actorId,
          limit,
        });
  const since = input.since === undefined ? undefined : decodeAttentionSince(input.since, input.workspaceId);
  if (cursor !== undefined && !attentionAuthorityEquals(cursor.authority, authority)) {
    throw new Conflict("Attention cursor authority changed", {
      recoveryCode: ATTENTION_RECOVERY_CODES.authorityChanged,
      field: ATTENTION_ERROR_FIELDS.cursor,
      nextAction: ATTENTION_NEXT_ACTIONS.restartWithoutCursor,
    });
  }
  return {
    workspaceId: input.workspaceId,
    limit,
    ...(cursor === undefined ? {} : { cursor }),
    ...(since === undefined ? {} : { since, sinceToken: input.since as string }),
  };
}

export function snapshotTip(snapshot: AttentionSnapshot): number {
  return snapshot.tip?.appendPosition ?? 0;
}

/** Steps 5 (tip staleness) and 6 (`since` ahead of tip), against the one snapshot. */
export function assertAttentionSnapshotFresh(prepared: PreparedAttentionRequest, snapshot: AttentionSnapshot): void {
  const tip = snapshotTip(snapshot);
  if (prepared.cursor !== undefined && prepared.cursor.contributionTip !== tip) {
    throw new Conflict("Attention cursor is stale", {
      recoveryCode: ATTENTION_RECOVERY_CODES.cursorStale,
      field: ATTENTION_ERROR_FIELDS.cursor,
      nextAction: ATTENTION_NEXT_ACTIONS.restartWithoutCursor,
    });
  }
  if (prepared.since !== undefined) assertSinceNotAheadOfTip(prepared.since, tip);
}

export function attentionFromSnapshot(
  prepared: PreparedAttentionRequest,
  who: AttentionWho,
  authority: AttentionAuthority,
  observedAt: string,
  snapshot: AttentionSnapshot,
  catchUp: AttentionCatchUp,
): AttentionResult {
  return deriveAttention({
    workspaceId: prepared.workspaceId,
    who,
    authority,
    limit: prepared.limit,
    ...(prepared.cursor === undefined ? {} : { cursor: prepared.cursor }),
    observedAt,
    contributionTip: snapshotTip(snapshot),
    orientationCursor: orientationCursorFromTip(prepared.workspaceId, snapshot.tip),
    snapshot,
    catchUp,
  });
}
