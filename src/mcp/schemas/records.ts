/**
 * CMP-001 slice B: declared MCP outputSchema for the single-record and task-list reads
 * (`list_tasks`, `get_task`, `get_decision`, `get_finding`, `get_artifact`).
 *
 * Exported as zod RAW SHAPES (property maps) so they can be passed straight to
 * `registerTool({ outputSchema })`, like the inputSchema maps in `tools.ts`.
 *
 * Policy:
 * - Tolerant on read: never `.strict()`, unknown keys pass. Absent optional fields are `.optional()`.
 *   Both stores (SQLite and D1) map NULL columns to `undefined` (key absent on the wire), so
 *   nothing here is `.nullable()`.
 * - Closed enums only where the service validates the value; free text carries no length caps;
 *   `Artifact.type` is an open string because legacy rows may predate the current vocabulary.
 * - No recursion and no named/reused (registered) schemas, so the emitted JSON Schema has no
 *   `$ref`, `$defs`, or `$schema` (the SDK converts with `io: "output"`; see the schema test).
 *   Every nested object is built by a factory call so no schema instance is shared.
 */
import { z } from "zod";

const actorRef = () =>
  z.looseObject({
    actorId: z.string(),
    actorType: z.enum(["human", "agent"]),
  });

/** Provenance fields spread into Task, Finding, Decision, Artifact. */
const provenance = () => ({
  createdBy: actorRef(),
  agentSessionId: z.string().optional(),
  createdAt: z.string(),
});

const taskRecord = () =>
  z.looseObject({
    ...provenance(),
    id: z.string(),
    workspaceId: z.string(),
    title: z.string(),
    description: z.string().optional(),
    status: z.enum(["open", "in_progress", "blocked", "completed"]),
    assignee: actorRef().optional(),
    updatedAt: z.string(),
  });

const findingEvidence = () =>
  z.looseObject({
    id: z.string(),
    workspaceId: z.string(),
    findingId: z.string(),
    artifactId: z.string(),
    relation: z.enum(["supports", "contradicts"]),
    note: z.string().optional(),
    createdBy: actorRef(),
    agentSessionId: z.string().optional(),
    createdAt: z.string(),
  });

const decisionCitation = () =>
  z.looseObject({
    id: z.string(),
    workspaceId: z.string(),
    decisionId: z.string(),
    findingId: z.string(),
    note: z.string().optional(),
    createdBy: actorRef(),
    agentSessionId: z.string().optional(),
    createdAt: z.string(),
  });

/** Task record fields as a property map (get_task returns the bare record). */
export const getTaskOutput = taskRecord().shape;

/** Bounded page of tasks: `WorkspaceObjectPage<Task>`. */
export const listTasksOutput = {
  schemaVersion: z.literal(1),
  workspaceId: z.string(),
  items: z.array(taskRecord()),
  total: z.number(),
  returned: z.number(),
  truncated: z.boolean(),
  nextCursor: z.string().optional(),
};

export const getDecisionOutput = {
  ...provenance(),
  id: z.string(),
  workspaceId: z.string(),
  summary: z.string(),
  rationale: z.string().optional(),
  status: z.enum(["proposed", "accepted", "superseded"]),
  approvedBy: actorRef().optional(),
  updatedAt: z.string(),
  predecessorId: z.string().optional(),
  successorId: z.string().optional(),
  supersedeReason: z.string().optional(),
  supersededBy: actorRef().optional(),
  supersededSessionId: z.string().optional(),
  supersededAt: z.string().optional(),
  citations: z.array(decisionCitation()).optional(),
  needsReview: z.literal(true).optional(),
  needsReviewFindingIds: z.array(z.string()).optional(),
};

export const getFindingOutput = {
  ...provenance(),
  id: z.string(),
  workspaceId: z.string(),
  summary: z.string(),
  detail: z.string().optional(),
  confidence: z.number().optional(),
  sourceArtifactId: z.string().optional(),
  // Optional in the TS type, but both stores always set it on reads. Kept optional for tolerance.
  currentness: z.enum(["current", "superseded", "withdrawn"]).optional(),
  predecessorId: z.string().optional(),
  successorId: z.string().optional(),
  correctionReason: z.string().optional(),
  correctedBy: actorRef().optional(),
  correctedSessionId: z.string().optional(),
  correctedAt: z.string().optional(),
  evidence: z.array(findingEvidence()).optional(),
};

export const getArtifactOutput = {
  ...provenance(),
  id: z.string(),
  workspaceId: z.string(),
  type: z.string(),
  title: z.string(),
  uriOrPath: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
};

/**
 * Preferred registration form. A raw shape is wrapped by the SDK in a plain `z.object`, which the
 * JSON Schema converter emits with `additionalProperties:false` on the top-level object, so a client
 * that validates structuredContent against the listed schema would reject additive fields. These
 * loose objects emit `additionalProperties:{}` at the top level too. Nested objects are already loose.
 */
export const getTaskOutputSchema = z.looseObject(getTaskOutput);
export const listTasksOutputSchema = z.looseObject(listTasksOutput);
export const getDecisionOutputSchema = z.looseObject(getDecisionOutput);
export const getFindingOutputSchema = z.looseObject(getFindingOutput);
export const getArtifactOutputSchema = z.looseObject(getArtifactOutput);
