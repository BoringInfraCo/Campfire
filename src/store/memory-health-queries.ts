/**
 * Shared memory-health reads. SQLite and D1 execute the same statements.
 * No cue table and no schema change. The service calls these only after
 * workspace:read authorization.
 */
import type { MemoryHealthRows } from "../domain/memory-health.js";
import type { SqlStatement } from "./context-queries.js";

export const MEMORY_HEALTH_TIP_SQL = `/* mem-health */ SELECT id, created_at, append_position
  FROM contributions WHERE workspace_id = ? ORDER BY append_position DESC LIMIT 1`;

export const MEMORY_HEALTH_DECISIONS_SQL = `/* mem-health */ SELECT
  d.id AS decision_id, d.status AS decision_status, d.created_at AS decision_created_at, d.updated_at AS decision_updated_at,
  c.id AS citation_id, c.finding_id AS citation_finding_id, c.created_at AS citation_created_at,
  f.currentness AS finding_currentness, f.created_at AS finding_created_at, f.corrected_at AS finding_corrected_at
  FROM decisions d
  LEFT JOIN decision_citations c ON c.decision_id = d.id AND c.workspace_id = d.workspace_id
  LEFT JOIN findings f ON f.id = c.finding_id AND f.workspace_id = d.workspace_id
  WHERE d.workspace_id = ?`;

export const MEMORY_HEALTH_FINDINGS_SQL = `/* mem-health */ SELECT
  f.id AS finding_id, f.currentness AS finding_currentness, f.created_at AS finding_created_at,
  e.id AS evidence_id, e.artifact_id AS evidence_artifact_id, e.relation AS evidence_relation, e.created_at AS evidence_created_at,
  a.created_at AS artifact_created_at
  FROM findings f
  LEFT JOIN finding_evidence e ON e.finding_id = f.id AND e.workspace_id = f.workspace_id
  LEFT JOIN artifacts a ON a.id = e.artifact_id AND a.workspace_id = f.workspace_id
  WHERE f.workspace_id = ?`;

export const MEMORY_HEALTH_TASKS_SQL = `/* mem-health */ SELECT id, status, description, assignee_actor_id, created_at, updated_at
  FROM tasks WHERE workspace_id = ?`;

export const MEMORY_HEALTH_PROPOSALS_SQL = `/* mem-health */ SELECT
  p.id AS proposal_id, p.status AS proposal_status, p.revision AS proposal_revision, p.task_id, p.reservation_id,
  p.created_at AS proposal_created_at, p.updated_at AS proposal_updated_at,
  r.id AS receipt_id, r.outcome AS receipt_outcome, r.recorded_at AS receipt_recorded_at
  FROM action_proposals p
  LEFT JOIN action_receipts r ON r.proposal_id = p.id AND r.workspace_id = p.workspace_id
  WHERE p.workspace_id = ?`;

export function memoryHealthStatement(sql: string, workspaceId: string): SqlStatement {
  return { sql, params: [workspaceId] };
}

export interface MemoryHealthTipRow {
  id: string;
  created_at: string;
  append_position: number | bigint | string;
}

export function assembleMemoryHealthRows(input: {
  decisions: readonly DecisionJoinRow[];
  findings: readonly FindingJoinRow[];
  tasks: readonly TaskJoinRow[];
  proposals: readonly ProposalJoinRow[];
}): MemoryHealthRows {
  return {
    decisions: groupDecisions(input.decisions),
    findings: groupFindings(input.findings),
    tasks: input.tasks.map((row) => ({
      id: row.id,
      status: row.status,
      description: row.description,
      assigneeId: row.assignee_actor_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    proposals: groupProposals(input.proposals),
  };
}

export interface DecisionJoinRow {
  decision_id: string;
  decision_status: string;
  decision_created_at: string;
  decision_updated_at: string;
  citation_id: string | null;
  citation_finding_id: string | null;
  citation_created_at: string | null;
  finding_currentness: string | null;
  finding_created_at: string | null;
  finding_corrected_at: string | null;
}

export interface FindingJoinRow {
  finding_id: string;
  finding_currentness: string;
  finding_created_at: string;
  evidence_id: string | null;
  evidence_artifact_id: string | null;
  evidence_relation: string | null;
  evidence_created_at: string | null;
  artifact_created_at: string | null;
}

export interface TaskJoinRow {
  id: string;
  status: string;
  description: string | null;
  assignee_actor_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProposalJoinRow {
  proposal_id: string;
  proposal_status: string;
  proposal_revision: number | bigint | string;
  task_id: string;
  reservation_id: string | null;
  proposal_created_at: string;
  proposal_updated_at: string;
  receipt_id: string | null;
  receipt_outcome: string | null;
  receipt_recorded_at: string | null;
}

function groupDecisions(rows: readonly DecisionJoinRow[]): MemoryHealthRows["decisions"] {
  const byId = new Map<string, MemoryHealthRows["decisions"][number]>();
  for (const row of rows) {
    let decision = byId.get(row.decision_id);
    if (decision === undefined) {
      decision = {
        id: row.decision_id,
        status: row.decision_status,
        createdAt: row.decision_created_at,
        updatedAt: row.decision_updated_at,
        citations: [],
      };
      byId.set(row.decision_id, decision);
    }
    if (row.citation_id === null || row.citation_finding_id === null || row.citation_created_at === null) continue;
    if (row.finding_currentness === null || row.finding_created_at === null) continue;
    decision.citations.push({
      id: row.citation_id,
      findingId: row.citation_finding_id,
      createdAt: row.citation_created_at,
      findingCurrentness: row.finding_currentness,
      findingCreatedAt: row.finding_created_at,
      findingCorrectedAt: row.finding_corrected_at,
    });
  }
  return [...byId.values()];
}

function groupFindings(rows: readonly FindingJoinRow[]): MemoryHealthRows["findings"] {
  const byId = new Map<string, MemoryHealthRows["findings"][number]>();
  for (const row of rows) {
    let finding = byId.get(row.finding_id);
    if (finding === undefined) {
      finding = { id: row.finding_id, currentness: row.finding_currentness, createdAt: row.finding_created_at, evidence: [] };
      byId.set(row.finding_id, finding);
    }
    if (
      row.evidence_id === null ||
      row.evidence_artifact_id === null ||
      row.evidence_relation === null ||
      row.evidence_created_at === null ||
      row.artifact_created_at === null
    ) {
      continue;
    }
    finding.evidence.push({
      id: row.evidence_id,
      artifactId: row.evidence_artifact_id,
      relation: row.evidence_relation,
      createdAt: row.evidence_created_at,
      artifactCreatedAt: row.artifact_created_at,
    });
  }
  return [...byId.values()];
}

function groupProposals(rows: readonly ProposalJoinRow[]): MemoryHealthRows["proposals"] {
  const byId = new Map<string, MemoryHealthRows["proposals"][number]>();
  for (const row of rows) {
    if (row.reservation_id === null || row.reservation_id.length === 0) continue;
    let proposal = byId.get(row.proposal_id);
    if (proposal === undefined) {
      proposal = {
        id: row.proposal_id,
        status: row.proposal_status,
        revision: Number(row.proposal_revision),
        taskId: row.task_id,
        reservationId: row.reservation_id,
        createdAt: row.proposal_created_at,
        updatedAt: row.proposal_updated_at,
        receipts: [],
      };
      byId.set(row.proposal_id, proposal);
    }
    if (row.receipt_id === null || row.receipt_outcome === null || row.receipt_recorded_at === null) continue;
    proposal.receipts.push({ id: row.receipt_id, outcome: row.receipt_outcome, recordedAt: row.receipt_recorded_at });
  }
  return [...byId.values()];
}

export interface MemoryHealthSnapshot {
  tip?: { id: string; createdAt: string; appendPosition: number };
  rows: MemoryHealthRows;
}

export function mapMemoryHealthTip(row: MemoryHealthTipRow | undefined): MemoryHealthSnapshot["tip"] {
  return row === undefined
    ? undefined
    : { id: row.id, createdAt: row.created_at, appendPosition: Number(row.append_position) };
}
