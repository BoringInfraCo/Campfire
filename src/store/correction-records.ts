/**
 * COR-001 row mapping and statements shared by SQLite and D1.
 *
 * The successor claim is the transition primary key plus the partial unique
 * indexes. A lost claim must fail the whole transaction. Do not treat a
 * buffered D1 `changes` count as that lock.
 */
import { Conflict } from "../domain/errors.js";
import { ValidationError } from "../domain/errors.js";
import type { ActorType, Decision, DecisionCitation, Finding, FindingEvidence } from "../domain/types.js";
import type { SqlStatement } from "./context-queries.js";
import type { DecisionTransitionClaim, FindingTransitionClaim } from "./store.js";

export interface FindingCorrectionRow {
  currentness?: string | null;
  predecessor_id?: string | null;
  successor_id?: string | null;
  correction_reason?: string | null;
  corrected_by_actor_id?: string | null;
  corrected_by_actor_type?: string | null;
  corrected_session_id?: string | null;
  corrected_at?: string | null;
}

export interface DecisionCorrectionRow {
  predecessor_id?: string | null;
  successor_id?: string | null;
  supersede_reason?: string | null;
  superseded_by_actor_id?: string | null;
  superseded_by_actor_type?: string | null;
  superseded_session_id?: string | null;
  superseded_at?: string | null;
}

export interface EvidenceRow {
  id: string;
  workspace_id: string;
  finding_id: string;
  artifact_id: string;
  relation: string;
  note: string | null;
  actor_id: string;
  actor_type: string;
  agent_session_id: string | null;
  created_at: string;
}

export interface CitationRow {
  id: string;
  workspace_id: string;
  decision_id: string;
  finding_id: string;
  note: string | null;
  actor_id: string;
  actor_type: string;
  agent_session_id: string | null;
  created_at: string;
}

const CORRECTION_CONSTRAINTS = [
  "finding_transitions",
  "decision_transitions",
  "finding_evidence",
  "decision_citations",
  "findings.predecessor_id",
  "findings.successor_id",
  "decisions.successor_id",
  "campfire_delete_guard_one_row",
];

export function asCorrectionConflict(error: unknown): unknown {
  if (error instanceof Conflict) return error;
  if (typeof error !== "object" || error === null) return error;
  const code = "code" in error && typeof error.code === "string" ? error.code : "";
  const message = "message" in error && typeof error.message === "string" ? error.message : "";
  const constraint = code.startsWith("SQLITE_CONSTRAINT") || /unique constraint failed/i.test(message);
  if (!constraint) return error;
  if (!CORRECTION_CONSTRAINTS.some((name) => message.includes(name))) return error;
  return new Conflict("The record changed before this correction could commit");
}

export function findingCorrectionFields(row: FindingCorrectionRow): Pick<Finding, "currentness"> & Partial<Finding> {
  const currentness =
    row.currentness === "superseded" || row.currentness === "withdrawn" || row.currentness === "current"
      ? row.currentness
      : "current";
  return {
    currentness,
    ...(row.predecessor_id ? { predecessorId: row.predecessor_id } : {}),
    ...(row.successor_id ? { successorId: row.successor_id } : {}),
    ...(row.correction_reason ? { correctionReason: row.correction_reason } : {}),
    ...(row.corrected_by_actor_id && row.corrected_by_actor_type
      ? {
          correctedBy: {
            actorId: row.corrected_by_actor_id,
            actorType: row.corrected_by_actor_type as ActorType,
          },
        }
      : {}),
    ...(row.corrected_session_id ? { correctedSessionId: row.corrected_session_id } : {}),
    ...(row.corrected_at ? { correctedAt: row.corrected_at } : {}),
  };
}

export function decisionCorrectionFields(row: DecisionCorrectionRow): Partial<Decision> {
  return {
    ...(row.predecessor_id ? { predecessorId: row.predecessor_id } : {}),
    ...(row.successor_id ? { successorId: row.successor_id } : {}),
    ...(row.supersede_reason ? { supersedeReason: row.supersede_reason } : {}),
    ...(row.superseded_by_actor_id && row.superseded_by_actor_type
      ? {
          supersededBy: {
            actorId: row.superseded_by_actor_id,
            actorType: row.superseded_by_actor_type as ActorType,
          },
        }
      : {}),
    ...(row.superseded_session_id ? { supersededSessionId: row.superseded_session_id } : {}),
    ...(row.superseded_at ? { supersededAt: row.superseded_at } : {}),
  };
}

export function mapEvidence(row: EvidenceRow): FindingEvidence {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    findingId: row.finding_id,
    artifactId: row.artifact_id,
    relation: row.relation === "contradicts" ? "contradicts" : "supports",
    ...(row.note ? { note: row.note } : {}),
    createdBy: { actorId: row.actor_id, actorType: row.actor_type as ActorType },
    ...(row.agent_session_id ? { agentSessionId: row.agent_session_id } : {}),
    createdAt: row.created_at,
  };
}

export function mapCitation(row: CitationRow): DecisionCitation {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    decisionId: row.decision_id,
    findingId: row.finding_id,
    ...(row.note ? { note: row.note } : {}),
    createdBy: { actorId: row.actor_id, actorType: row.actor_type as ActorType },
    ...(row.agent_session_id ? { agentSessionId: row.agent_session_id } : {}),
    createdAt: row.created_at,
  };
}

export const INSERT_FINDING_SQL =
  "INSERT INTO findings (id, workspace_id, summary, detail, confidence, source_artifact_id, currentness, predecessor_id, created_by_actor_id, created_by_actor_type, agent_session_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

export function findingInsertParams(finding: Finding): unknown[] {
  return [
    finding.id,
    finding.workspaceId,
    finding.summary,
    finding.detail ?? null,
    finding.confidence ?? null,
    finding.sourceArtifactId ?? null,
    finding.currentness ?? "current",
    finding.predecessorId ?? null,
    finding.createdBy.actorId,
    finding.createdBy.actorType,
    finding.agentSessionId ?? null,
    finding.createdAt,
  ];
}

export const INSERT_DECISION_SQL =
  "INSERT INTO decisions (id, workspace_id, summary, rationale, status, approved_by_actor_id, approved_by_actor_type, predecessor_id, created_by_actor_id, created_by_actor_type, agent_session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

export function decisionInsertParams(decision: Decision): unknown[] {
  return [
    decision.id,
    decision.workspaceId,
    decision.summary,
    decision.rationale ?? null,
    decision.status,
    decision.approvedBy?.actorId ?? null,
    decision.approvedBy?.actorType ?? null,
    decision.predecessorId ?? null,
    decision.createdBy.actorId,
    decision.createdBy.actorType,
    decision.agentSessionId ?? null,
    decision.createdAt,
    decision.updatedAt,
  ];
}

export const INSERT_FINDING_EVIDENCE_SQL = `INSERT INTO finding_evidence (
  id, workspace_id, finding_id, artifact_id, relation, note, actor_id, actor_type, agent_session_id, created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export function evidenceInsertParams(evidence: FindingEvidence): unknown[] {
  return [
    evidence.id,
    evidence.workspaceId,
    evidence.findingId,
    evidence.artifactId,
    evidence.relation,
    evidence.note ?? null,
    evidence.createdBy.actorId,
    evidence.createdBy.actorType,
    evidence.agentSessionId ?? null,
    evidence.createdAt,
  ];
}

export const INSERT_DECISION_CITATION_SQL = `INSERT INTO decision_citations (
  id, workspace_id, decision_id, finding_id, note, actor_id, actor_type, agent_session_id, created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export function citationInsertParams(citation: DecisionCitation): unknown[] {
  return [
    citation.id,
    citation.workspaceId,
    citation.decisionId,
    citation.findingId,
    citation.note ?? null,
    citation.createdBy.actorId,
    citation.createdBy.actorType,
    citation.agentSessionId ?? null,
    citation.createdAt,
  ];
}

function idList(column: string, ids: readonly string[]): SqlStatement | undefined {
  if (ids.length === 0) return undefined;
  return {
    sql: `${column} IN (${ids.map(() => "?").join(", ")})`,
    params: [...ids],
  };
}

export function listFindingEvidenceSql(ids: readonly string[]): SqlStatement | undefined {
  const clause = idList("finding_id", ids);
  if (clause === undefined) return undefined;
  return {
    sql: `SELECT * FROM finding_evidence WHERE ${clause.sql} ORDER BY created_at, id`,
    params: clause.params,
  };
}

export function listDecisionCitationsSql(ids: readonly string[]): SqlStatement | undefined {
  const clause = idList("decision_id", ids);
  if (clause === undefined) return undefined;
  return {
    sql: `SELECT * FROM decision_citations WHERE ${clause.sql} ORDER BY created_at, id`,
    params: clause.params,
  };
}

export function listStaleCitedFindingIdsSql(ids: readonly string[]): SqlStatement | undefined {
  const clause = idList("citation.decision_id", ids);
  if (clause === undefined) return undefined;
  return {
    sql: `SELECT citation.finding_id AS finding_id
FROM decision_citations AS citation
WHERE ${clause.sql}
AND EXISTS (
  SELECT 1 FROM findings
  WHERE findings.id = citation.finding_id
    AND findings.currentness <> 'current'
)`,
    params: clause.params,
  };
}

export function findingClaimStatements(claim: FindingTransitionClaim): { insert: SqlStatement; update: SqlStatement } {
  if (claim.kind === "superseded" && (claim.successorId === undefined || claim.successorId.length === 0)) {
    throw new ValidationError("A superseding finding requires a successor", { field: "successorId" });
  }
  if (claim.kind === "withdrawn" && claim.successorId !== undefined) {
    throw new ValidationError("A withdrawal has no successor", { field: "successorId" });
  }
  const currentness = claim.kind === "withdrawn" ? "withdrawn" : "superseded";
  return {
    insert: {
      sql: `INSERT INTO finding_transitions (
        finding_id, successor_id, kind, reason, actor_id, actor_type, agent_session_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        claim.findingId,
        claim.successorId ?? null,
        claim.kind,
        claim.reason,
        claim.actor.actorId,
        claim.actor.actorType,
        claim.agentSessionId ?? null,
        claim.createdAt,
      ],
    },
    update: {
      sql: `UPDATE findings SET
        currentness = ?,
        successor_id = ?,
        correction_reason = ?,
        corrected_by_actor_id = ?,
        corrected_by_actor_type = ?,
        corrected_session_id = ?,
        corrected_at = ?
      WHERE id = ? AND currentness = 'current'`,
      params: [
        currentness,
        claim.successorId ?? null,
        claim.reason,
        claim.actor.actorId,
        claim.actor.actorType,
        claim.agentSessionId ?? null,
        claim.createdAt,
        claim.findingId,
      ],
    },
  };
}

export function decisionClaimStatements(claim: DecisionTransitionClaim): { insert: SqlStatement; update: SqlStatement } {
  if (claim.kind === "rejected" && claim.successorId !== undefined) {
    throw new ValidationError("A rejected decision has no successor", { field: "successorId" });
  }
  const expected = claim.kind === "rejected" ? "proposed" : "accepted";
  return {
    insert: {
      sql: `INSERT INTO decision_transitions (
        decision_id, successor_id, kind, reason, actor_id, actor_type, agent_session_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        claim.decisionId,
        claim.successorId ?? null,
        claim.kind,
        claim.reason,
        claim.actor.actorId,
        claim.actor.actorType,
        claim.agentSessionId ?? null,
        claim.createdAt,
      ],
    },
    update: {
      sql: `UPDATE decisions SET
        status = 'superseded',
        successor_id = ?,
        supersede_reason = ?,
        superseded_by_actor_id = ?,
        superseded_by_actor_type = ?,
        superseded_session_id = ?,
        superseded_at = ?,
        updated_at = ?
      WHERE id = ? AND status = ?`,
      params: [
        claim.successorId ?? null,
        claim.reason,
        claim.actor.actorId,
        claim.actor.actorType,
        claim.agentSessionId ?? null,
        claim.createdAt,
        claim.createdAt,
        claim.decisionId,
        expected,
      ],
    },
  };
}
