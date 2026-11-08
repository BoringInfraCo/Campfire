/**
 * CMP-001 slice B: declared MCP output schemas for the orientation tools.
 *
 * Read-tolerant by design: nested objects are loose (unknown keys pass), absent
 * fields are optional, and growing vocabularies (objectType, changeType) are
 * plain strings. Every sub-schema is built by a factory so the emitted JSON
 * Schema is fully inlined: no $ref, no $defs, no recursion.
 */
import { z } from "zod/v4";

const lo = z.looseObject;
const str = () => z.string();
const num = () => z.number();
const bool = () => z.boolean();
const actorRef = () => lo({ actorId: str() });
const strArr = () => z.array(str());
// Minimal record: id plus provenance (createdBy/createdAt) and any extra load-bearing fields.
const rec = (extra: Record<string, z.ZodType> = {}) =>
  lo({ id: str(), createdBy: actorRef(), createdAt: str(), ...extra });
const slice = <T extends z.ZodType>(item: () => T) =>
  lo({
    items: z.array(item()),
    total: num(),
    returned: num(),
    truncated: bool(),
    nextCursor: str().optional(),
  });

const workspace = () => rec({ status: str(), updatedAt: str() });
const goal = () => rec({ status: str() });
const task = () => rec({ status: str(), assignee: actorRef().optional() });
const finding = () =>
  rec({
    currentness: z.enum(["current", "superseded", "withdrawn"]).optional(),
    predecessorId: str().optional(),
    successorId: str().optional(),
  });
const decision = () =>
  rec({
    status: str(),
    needsReview: bool().optional(),
    needsReviewFindingIds: strArr().optional(),
    predecessorId: str().optional(),
    successorId: str().optional(),
  });
const artifact = () => rec();
// Lean form for legacy arrays that repeat the slices: id plus the decision-relevant flags.
const lean = (extra: Record<string, z.ZodType> = {}) =>
  lo({ id: str(), createdAt: str().optional(), ...extra });
const leanDecision = () =>
  lean({ status: str(), needsReview: bool().optional() });
const leanTask = () => lean({ status: str() });
const contribution = () =>
  lo({
    id: str(),
    actor: actorRef(),
    objectType: str(),
    objectId: str(),
    appendPosition: num(),
    createdAt: str(),
  });
const changeSummary = () =>
  lo({
    cursor: str(),
    occurredAt: str(),
    actorId: str(),
    objectType: str(),
    objectId: str(),
    changeType: str(),
    materiality: z.enum(["high", "normal"]),
  });
const attentionItem = () =>
  lo({
    kind: z.enum(["task", "decision"]),
    id: str(),
    status: str(),
    needsReviewFindingIds: strArr().optional(),
  });
const participant = () => lo({ actor: actorRef(), joinedAt: str() });
const cover = () => lo({ total: num(), returned: num(), truncated: bool() });

export const getWorkspaceContextOutput = {
  schemaVersion: z.literal(1),
  generatedAt: z.string(),
  orientationCursor: z.string(),
  completeness: lo({
    fullHistoryIncluded: z.boolean(),
    drillDownAvailable: z.boolean(),
  }),
  slices: lo({
    decisions: slice(decision),
    findings: slice(finding),
    tasks: slice(task),
    blockers: slice(task),
    artifacts: slice(artifact),
    recentChanges: slice(changeSummary),
  }),
  budget: z.record(str(), num()),
  workspace: workspace(),
  goal: goal().optional(),
  participants: z.array(participant()),
  participantsCoverage: lo({
    returned: z.number(),
    total: z.number(),
    truncated: z.boolean(),
    omitted: z.boolean(),
  }).optional(),
  proposedDecisions: z.array(leanDecision()),
  acceptedDecisions: z.array(leanDecision()),
  supersededDecisions: z.array(
    lo({ id: z.string(), summary: z.string(), updatedAt: z.string() }),
  ),
  openTasks: z.array(leanTask()),
  findings: z.array(
    lean({
      currentness: z.enum(["current", "superseded", "withdrawn"]).optional(),
    }),
  ),
  artifacts: z.array(lean()),
  provenance: z.array(contribution()),
  provenanceTotal: z.number(),
  provenanceTruncated: z.boolean(),
  needsYou: z.array(attentionItem()),
  needsAttention: z.array(attentionItem()),
  attentionCoverage: lo({
    tasks: cover(),
    decisions: cover(),
    completeUnderRules: z.boolean(),
  }),
  currentWork: lo({
    inProgressTasks: z.array(leanTask()),
    blockedTasks: z.array(leanTask()),
    acceptedDecisions: z.array(leanDecision()),
  }),
  suggestedNextAction: lo({
    kind: z.enum(["task", "decision", "none"]),
    id: z.string().optional(),
    summary: z.string(),
    reason: z.string(),
    orientationHint: z.boolean(),
  }),
  alignment: lo({
    status: z.enum(["open", "established", "unspecified"]),
    proposedDecisionIds: strArr(),
    acceptedDecisionIds: strArr(),
    unresolvedBlockedTaskIds: strArr(),
  }),
  historicalCounts: lo({ findings: z.number(), decisions: z.number() }),
  provenanceSummary: strArr(),
  since: lo({
    cursor: z.string(),
    items: z.array(contribution()),
    truncated: z.boolean(),
  }).optional(),
};

export const getWorkspaceChangesOutput = {
  schemaVersion: z.literal(1),
  workspaceId: z.string(),
  fromCursor: z.string(),
  toCursor: z.string(),
  changes: slice(changeSummary),
  affected: lo({
    decisions: strArr(),
    findings: strArr(),
    tasks: strArr(),
    artifacts: strArr(),
  }),
  generatedAt: z.string(),
  ordering: z.string(),
};

/** Loose object forms: emit additionalProperties:{} at the root instead of false. */
export const getWorkspaceContextSchema = z.looseObject(
  getWorkspaceContextOutput,
);
export const getWorkspaceChangesSchema = z.looseObject(
  getWorkspaceChangesOutput,
);
