/**
 * Turns an already authorized snapshot into a memory-health page.
 * Both the SQLite service and the Worker service call this function.
 */
import { contributionCursor, encodeContextCursor, genesisContributionCursor } from "../domain/context-policy.js";
import { Conflict } from "../domain/errors.js";
import {
  MEMORY_HEALTH_REASONS,
  MEMORY_HEALTH_RESPONSE_MAX_BYTES,
  decodeMemoryHealthCursor,
  pageMemoryHealth,
  validateMemoryHealthInput,
  type MemoryHealthResult,
  type MemoryHealthRows,
} from "../domain/memory-health.js";
import type { MemoryHealthSnapshot } from "../store/memory-health-queries.js";

export interface MemoryHealthReadInput {
  workspaceId: string;
  reason?: string;
  limit?: number;
  cursor?: string;
  actorType: "human" | "agent";
  actorId: string;
  role: string;
  observedAt: string;
  contributionTip: number;
  orientationCursor: string;
  rows: MemoryHealthRows;
}

export interface GetMemoryHealthInput {
  workspaceId: string;
  reason?: string;
  limit?: number;
  cursor?: string;
}

/** Validates reason and limit only after the caller has been authorized. */
export function memoryHealthFromSnapshot(
  input: GetMemoryHealthInput,
  who: { actorType: "human" | "agent"; actorId: string; role: string },
  observedAt: string,
  snapshot: MemoryHealthSnapshot,
): MemoryHealthResult {
  const validated = validateMemoryHealthInput(input, MEMORY_HEALTH_REASONS);
  const tip = snapshot.tip;
  const orientationCursor =
    tip === undefined
      ? encodeContextCursor(genesisContributionCursor(input.workspaceId))
      : encodeContextCursor(
          contributionCursor({
            workspaceId: input.workspaceId,
            occurredAt: tip.createdAt,
            id: tip.id,
            phase: "high",
            originOccurredAt: tip.createdAt,
            originId: tip.id,
            position: tip.appendPosition,
            originPosition: tip.appendPosition,
            tip: 0,
          }),
        );
  return projectMemoryHealth({
    workspaceId: input.workspaceId,
    ...(validated.reason === undefined ? {} : { reason: validated.reason }),
    limit: validated.limit,
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    ...who,
    observedAt,
    contributionTip: tip?.appendPosition ?? 0,
    orientationCursor,
    rows: snapshot.rows,
  });
}

export function projectMemoryHealth(input: MemoryHealthReadInput): MemoryHealthResult {
  if (input.cursor !== undefined) {
    const decoded = decodeMemoryHealthCursor(input.cursor, {
      workspaceId: input.workspaceId,
      actorType: input.actorType,
      actorId: input.actorId,
      role: input.role,
      reason: input.reason === undefined ? null : (input.reason as typeof MEMORY_HEALTH_REASONS[number]),
      limit: input.limit ?? 25,
    });
    if (decoded.contributionTip !== input.contributionTip) {
      throw new Conflict("Memory health cursor is stale", {
        recoveryCode: "memory_health_stale_cursor",
        field: "cursor",
        nextAction: "restart_without_cursor",
      });
    }
  }
  return pageMemoryHealth({
    rows: input.rows,
    supportedReasons: MEMORY_HEALTH_REASONS,
    workspaceId: input.workspaceId,
    actorType: input.actorType,
    actorId: input.actorId,
    role: input.role,
    observedAt: input.observedAt,
    orientationCursor: input.orientationCursor,
    contributionTip: input.contributionTip,
    byteBudget: MEMORY_HEALTH_RESPONSE_MAX_BYTES,
    ...(input.reason === undefined ? {} : { reason: input.reason }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
  });
}
