/**
 * CMP-001 declared MCP outputSchema for `get_memory_health`.
 *
 * Tolerant on read: objects are `looseObject` (no additionalProperties:false in
 * the emitted JSON Schema, extra keys pass), absent fields are `.optional()`.
 * The ReasonFacts union is a nested `discriminatedUnion` on `reason`; the top
 * level stays a single object because tools/list drops non-object outputSchemas.
 *
 * A mismatch makes the SDK turn a success into a text isError result, so this
 * must accept every real MemoryHealthResult. The type-level check at the bottom
 * fails tsc when the schema and the domain type drift.
 */
import { z } from "zod";
import {
  MEMORY_HEALTH_REASONS,
  type MemoryHealthResult,
} from "../../domain/memory-health.js";

const reasonEnum = z.enum(MEMORY_HEALTH_REASONS);

const cueBase = {
  id: z.string(),
  subjectType: z.enum(["decision", "finding", "task", "action_proposal"]),
  subjectId: z.string(),
  relatedRecordIds: z.array(z.string()),
  summary: z.string(),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
  sourceUpdateTime: z.string(),
};

const actionOutcomeUnknownCue = z.looseObject({
  ...cueBase,
  reason: z.literal("action_outcome_unknown"),
  sourceFacts: z.looseObject({
    proposalStatus: z.literal("submission_unknown"),
    proposalRevision: z.number(),
    taskId: z.string(),
    unknownReceiptId: z.string(),
    unknownReceiptOutcome: z.literal("unknown"),
    reservationId: z.string(),
  }),
});

const acceptedDecisionNeedsReviewCue = z.looseObject({
  ...cueBase,
  reason: z.literal("accepted_decision_needs_review"),
  sourceFacts: z.looseObject({
    decisionStatus: z.literal("accepted"),
    citationId: z.string(),
    findingId: z.string(),
    findingCurrentness: z.enum(["superseded", "withdrawn"]),
  }),
});

const currentFindingContradictedCue = z.looseObject({
  ...cueBase,
  reason: z.literal("current_finding_has_contradicting_evidence"),
  sourceFacts: z.looseObject({
    findingCurrentness: z.literal("current"),
    evidenceId: z.string(),
    artifactId: z.string(),
    relation: z.literal("contradicts"),
  }),
});

const blockedTaskMissingContextCue = z.looseObject({
  ...cueBase,
  reason: z.literal("blocked_task_missing_context"),
  sourceFacts: z.looseObject({
    taskStatus: z.literal("blocked"),
    hasDescription: z.literal(false),
    hasAssignee: z.literal(false),
  }),
});

const memoryHealthCue = z.discriminatedUnion("reason", [
  actionOutcomeUnknownCue,
  acceptedDecisionNeedsReviewCue,
  currentFindingContradictedCue,
  blockedTaskMissingContextCue,
]);

/** Raw shape for `registerTool({ outputSchema })`. */
export const getMemoryHealthOutput = {
  kind: z.literal("memory_health"),
  schemaVersion: z.literal(1),
  workspaceId: z.string(),
  observedAt: z.string(),
  orientationCursor: z.string(),
  filters: z.looseObject({ reason: reasonEnum.optional() }),
  coverage: z.looseObject({
    rulesEvaluated: z.array(reasonEnum),
    total: z.number(),
    returned: z.number(),
    truncated: z.boolean(),
  }),
  cues: z.array(memoryHealthCue),
  nextCursor: z.string().optional(),
};

/**
 * Same shape as a loose root object. A raw shape is wrapped by the SDK in a strict
 * `z.object`, which emits root `additionalProperties:false`; pass this instead to
 * keep the root tolerant like every nested object.
 */
export const getMemoryHealthOutputObject = z.looseObject(getMemoryHealthOutput);

// ---- compile-time drift check -------------------------------------------
// Loose objects infer an index signature; strip it (deeply) so the comparison
// is about declared properties only. Interfaces vs aliases are normalized too.
type Norm<T> = T extends readonly (infer E)[]
  ? Norm<E>[]
  : T extends object
    ? { [K in keyof T as string extends K ? never : K]: Norm<T[K]> }
    : T;
type Inferred = z.infer<z.ZodObject<typeof getMemoryHealthOutput>>;
type Assert<T extends true> = T;
// Mutual assignability (catches missing/extra/mistyped fields and union drift).
export type MemoryHealthSchemaMatchesDomain = Assert<
  [Norm<Inferred>] extends [Norm<MemoryHealthResult>]
    ? [Norm<MemoryHealthResult>] extends [Norm<Inferred>]
      ? true
      : false
    : false
>;
