/**
 * ACT-001 row mapping shared verbatim by the SQLite and D1 stores.
 *
 * One mapping keeps fresh and upgraded databases equivalent across runtimes
 * (ACT-001 D8). The canonical envelope in `intent_json` (stored JSON-encoded
 * so the column's json_valid check holds; decode once for the exact digest
 * bytes) is the immutable approval subject; materialized columns rehydrate it
 * on read so the digest always covers what reads show.
 */
import type {
  ActionProposal,
  ActionProposalStatus,
  ActionReceipt,
  ActionSubmissionOutcome,
} from "../domain/action-proposal.js";
import { parseIntentEnvelope } from "../domain/action-proposal.js";
import type {
  ActionMutationReceipt,
  ActionProposalPatch,
} from "./store.js";

export interface ActionProposalRow {
  id: string;
  workspace_id: string;
  kind: string;
  intent_version: number | bigint;
  intent_json: string;
  intent_digest: string;
  expires_at: string;
  reason: string;
  task_id: string;
  finding_ids_json: string;
  artifact_ids_json: string;
  source_authority_revision: string;
  proposed_by_actor_id: string;
  proposed_by_actor_type: string;
  proposed_session_id: string | null;
  proposed_at: string;
  review_actor_id: string | null;
  review_actor_type: string | null;
  review_session_id: string | null;
  review_at: string | null;
  review_reason: string | null;
  review_revision: number | bigint | null;
  reservation_actor_id: string | null;
  reservation_actor_type: string | null;
  reservation_session_id: string | null;
  reserved_at: string | null;
  reservation_id: string | null;
  reservation_revision: number | bigint | null;
  evidence_snapshot_json: string | null;
  status: string;
  revision: number | bigint;
  target_key: string;
  created_at: string;
  updated_at: string;
}

export interface ActionReceiptRow {
  id: string;
  workspace_id: string;
  proposal_id: string;
  reservation_id: string;
  intent_digest: string;
  outcome: string;
  resolves_receipt_id: string | null;
  provider_ref_json: string;
  recorded_by_actor_id: string;
  recorded_by_actor_type: string;
  recorded_session_id: string | null;
  recorded_at: string;
  request_key: string;
}

export interface ActionMutationReceiptRow {
  workspace_id: string;
  actor_id: string;
  actor_type: string;
  method: string;
  request_key: string;
  input_digest: string;
  result_json: string;
  created_at: string;
}

export function mapActionProposal(row: ActionProposalRow): ActionProposal {
  // `intent_json` holds the frozen key=value envelope bytes as a JSON string
  // literal (the column requires json_valid; see encodeIntentEnvelopeStorage).
  // Legacy rows hold a JSON object with target/executor instead.
  const stored = JSON.parse(row.intent_json) as unknown;
  const envelope = typeof stored === "string"
    ? parseIntentEnvelope(stored)
    : (stored as { target: ActionProposal["target"]; executor: ActionProposal["executor"] });
  const proposal: ActionProposal = {
    id: row.id,
    workspaceId: row.workspace_id,
    kind: "ci.retry_verification",
    intentVersion: 1,
    target: envelope.target,
    executor: envelope.executor,
    intentDigest: row.intent_digest,
    expiresAt: row.expires_at,
    reason: row.reason,
    taskId: row.task_id,
    findingIds: JSON.parse(row.finding_ids_json) as string[],
    artifactIds: JSON.parse(row.artifact_ids_json) as string[],
    sourceAuthorityRevision: row.source_authority_revision,
    proposedBy: {
      actorId: row.proposed_by_actor_id,
      actorType: row.proposed_by_actor_type as "human" | "agent",
    },
    status: row.status as ActionProposalStatus,
    revision: Number(row.revision),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.proposed_session_id !== null) proposal.proposedSessionId = row.proposed_session_id;
  if (row.review_actor_id !== null && row.review_actor_type !== null && row.review_at !== null) {
    proposal.review = {
      actor: {
        actorId: row.review_actor_id,
        actorType: row.review_actor_type as "human" | "agent",
      },
      decision: proposal.status === "rejected"
        ? "rejected"
        : proposal.status === "cancelled"
          ? "cancelled"
          : "approved",
      at: row.review_at,
      revision: row.review_revision !== null ? Number(row.review_revision) : 2,
      intentDigest: row.intent_digest,
    };
    if (row.review_session_id !== null) proposal.review.sessionId = row.review_session_id;
    if (row.review_reason !== null) proposal.review.reason = row.review_reason;
  }
  if (
    row.reservation_actor_id !== null && row.reservation_actor_type !== null &&
    row.reserved_at !== null && row.reservation_id !== null && row.evidence_snapshot_json !== null
  ) {
    proposal.reservation = {
      actor: {
        actorId: row.reservation_actor_id,
        actorType: row.reservation_actor_type as "human" | "agent",
      },
      reservationId: row.reservation_id,
      evidenceSnapshot: JSON.parse(row.evidence_snapshot_json) as NonNullable<
        NonNullable<ActionProposal["reservation"]>["evidenceSnapshot"]
      >,
      at: row.reserved_at,
      revision: row.reservation_revision !== null ? Number(row.reservation_revision) : Number(row.revision),
      intentDigest: row.intent_digest,
    };
    if (row.reservation_session_id !== null) proposal.reservation.sessionId = row.reservation_session_id;
  }
  return proposal;
}

export const ACTION_PROPOSAL_INSERT_SQL = `INSERT INTO action_proposals (
  id, workspace_id, kind, intent_version, intent_json, intent_digest, expires_at, reason,
  task_id, finding_ids_json, artifact_ids_json, source_authority_revision,
  proposed_by_actor_id, proposed_by_actor_type, proposed_session_id, proposed_at,
  review_actor_id, review_actor_type, review_session_id, review_at, review_reason, review_revision,
  reservation_actor_id, reservation_actor_type, reservation_session_id, reserved_at,
  reservation_id, reservation_revision, evidence_snapshot_json,
  status, revision, target_key, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export function actionProposalInsertParams(
  proposal: ActionProposal,
  intentJson: string,
  targetKey: string,
): unknown[] {
  return [
    proposal.id,
    proposal.workspaceId,
    proposal.kind,
    proposal.intentVersion,
    intentJson,
    proposal.intentDigest,
    proposal.expiresAt,
    proposal.reason,
    proposal.taskId,
    JSON.stringify(proposal.findingIds),
    JSON.stringify(proposal.artifactIds),
    proposal.sourceAuthorityRevision,
    proposal.proposedBy.actorId,
    proposal.proposedBy.actorType,
    proposal.proposedSessionId ?? null,
    proposal.createdAt,
    proposal.review?.actor.actorId ?? null,
    proposal.review?.actor.actorType ?? null,
    proposal.review?.sessionId ?? null,
    proposal.review?.at ?? null,
    proposal.review?.reason ?? null,
    proposal.review?.revision ?? null,
    proposal.reservation?.actor.actorId ?? null,
    proposal.reservation?.actor.actorType ?? null,
    proposal.reservation?.sessionId ?? null,
    proposal.reservation?.at ?? null,
    proposal.reservation?.reservationId ?? null,
    proposal.reservation?.revision ?? null,
    proposal.reservation ? JSON.stringify(proposal.reservation.evidenceSnapshot) : null,
    proposal.status,
    proposal.revision,
    targetKey,
    proposal.createdAt,
    proposal.updatedAt,
  ];
}

const ACTION_PROPOSAL_UPDATE_COLUMNS: Array<{
  key: keyof ActionProposalPatch;
  column: string;
}> = [
  { key: "status", column: "status" },
  { key: "revision", column: "revision" },
  { key: "updatedAt", column: "updated_at" },
  { key: "reviewActorId", column: "review_actor_id" },
  { key: "reviewActorType", column: "review_actor_type" },
  { key: "reviewSessionId", column: "review_session_id" },
  { key: "reviewAt", column: "review_at" },
  { key: "reviewReason", column: "review_reason" },
  { key: "reviewRevision", column: "review_revision" },
  { key: "reservationActorId", column: "reservation_actor_id" },
  { key: "reservationActorType", column: "reservation_actor_type" },
  { key: "reservationSessionId", column: "reservation_session_id" },
  { key: "reservedAt", column: "reserved_at" },
  { key: "reservationId", column: "reservation_id" },
  { key: "reservationRevision", column: "reservation_revision" },
  { key: "evidenceSnapshotJson", column: "evidence_snapshot_json" },
];

export function actionProposalUpdateStatement(
  id: string,
  patch: ActionProposalPatch,
  expected: { revision: number; status?: ActionProposal["status"] },
): { sql: string; params: unknown[] } {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const { key, column } of ACTION_PROPOSAL_UPDATE_COLUMNS) {
    // Undefined preserves the committed column: a status-only outcome update
    // must not null the recorded review and reservation facts.
    if (patch[key] === undefined) continue;
    sets.push(`${column} = ?`);
    params.push(patch[key]);
  }
  if (patch.status === undefined || patch.revision === undefined || patch.updatedAt === undefined) {
    throw new Error("Action proposal updates always carry status, revision, and updatedAt");
  }
  params.push(id, expected.revision);
  let sql = `UPDATE action_proposals SET ${sets.join(", ")} WHERE id = ? AND revision = ?`;
  if (expected.status !== undefined) {
    sql += " AND status = ?";
    params.push(expected.status);
  }
  return { sql, params };
};

export const ACTION_RECEIPT_INSERT_SQL = `INSERT INTO action_receipts (
  id, workspace_id, proposal_id, reservation_id, intent_digest, outcome,
  resolves_receipt_id, provider_ref_json,
  recorded_by_actor_id, recorded_by_actor_type, recorded_session_id, recorded_at, request_key
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export function actionReceiptInsertParams(receipt: ActionReceipt): unknown[] {
  return [
    receipt.id,
    receipt.workspaceId,
    receipt.proposalId,
    receipt.reservationId,
    receipt.intentDigest,
    receipt.outcome,
    receipt.resolvesReceiptId ?? null,
    JSON.stringify(receipt.providerRef),
    receipt.recordedBy.actorId,
    receipt.recordedBy.actorType,
    receipt.recordedSessionId ?? null,
    receipt.recordedAt,
    receipt.requestKey,
  ];
}

export function mapActionReceipt(row: ActionReceiptRow): ActionReceipt {
  const receipt: ActionReceipt = {
    id: row.id,
    proposalId: row.proposal_id,
    workspaceId: row.workspace_id,
    reservationId: row.reservation_id,
    intentDigest: row.intent_digest,
    outcome: row.outcome as ActionSubmissionOutcome,
    providerRef: JSON.parse(row.provider_ref_json) as ActionReceipt["providerRef"],
    recordedBy: {
      actorId: row.recorded_by_actor_id,
      actorType: row.recorded_by_actor_type as "human" | "agent",
    },
    recordedAt: row.recorded_at,
    requestKey: row.request_key,
  };
  if (row.resolves_receipt_id !== null) receipt.resolvesReceiptId = row.resolves_receipt_id;
  if (row.recorded_session_id !== null) receipt.recordedSessionId = row.recorded_session_id;
  return receipt;
}

export const ACTION_MUTATION_RECEIPT_INSERT_SQL =
  "INSERT INTO action_mutation_receipts (workspace_id, actor_id, actor_type, method, request_key, input_digest, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";

export function actionMutationReceiptParams(receipt: ActionMutationReceipt): unknown[] {
  return [
    receipt.workspaceId,
    receipt.actorId,
    receipt.actorType,
    receipt.method,
    receipt.requestKey,
    receipt.inputDigest,
    receipt.resultJson,
    receipt.createdAt,
  ];
}

export function mapActionMutationReceipt(row: ActionMutationReceiptRow): ActionMutationReceipt {
  return {
    workspaceId: row.workspace_id,
    actorId: row.actor_id,
    actorType: row.actor_type as "human" | "agent",
    method: row.method,
    requestKey: row.request_key,
    inputDigest: row.input_digest,
    resultJson: row.result_json,
    createdAt: row.created_at,
  };
}

export interface GithubSourceBindingRow {
  source_id: string;
  workspace_id: string;
  repository_id: string;
  repository_name: string;
  workflow_id: string;
  action_kind: string;
  integration_agent_id: string;
  authority_fingerprint: string;
  first_used_at: string;
}

export interface GithubSourceBindingRecord {
  sourceId: string;
  workspaceId: string;
  repositoryId: string;
  repositoryName: string;
  workflowId: string;
  actionKind: string;
  integrationAgentId: string;
  authorityFingerprint: string;
  firstUsedAt: string;
}

export interface GithubIngressDeliveryRow {
  source_id: string;
  delivery_id: string;
  payload_digest: string;
  received_at: string;
}

export interface GithubIngressDeliveryRecord {
  sourceId: string;
  deliveryId: string;
  payloadDigest: string;
  receivedAt: string;
}

export interface GithubIngressReceiptRow {
  workspace_id: string;
  attempt_key: string;
  semantic_key: string;
  provider: string;
  repository_id: string;
  workflow_id: string;
  run_id: string;
  attempt: number | bigint;
  conclusion: string;
  event_kind: string;
  payload_digest: string;
  provider_timestamp: string;
  received_at: string;
  source_id: string;
  proposal_id: string;
  reservation_id: string;
  finding_id: string;
  artifact_id: string;
}

export interface GithubIngressReceiptRecord {
  workspaceId: string;
  attemptKey: string;
  semanticKey: string;
  provider: "github";
  repositoryId: string;
  workflowId: string;
  runId: string;
  attempt: number;
  conclusion: string;
  eventKind: "workflow_run.completed";
  payloadDigest: string;
  providerTimestamp: string;
  receivedAt: string;
  sourceId: string;
  proposalId: string;
  reservationId: string;
  findingId: string;
  artifactId: string;
}

export function mapGithubSourceBinding(row: GithubSourceBindingRow): GithubSourceBindingRecord {
  return {
    sourceId: row.source_id,
    workspaceId: row.workspace_id,
    repositoryId: row.repository_id,
    repositoryName: row.repository_name,
    workflowId: row.workflow_id,
    actionKind: row.action_kind,
    integrationAgentId: row.integration_agent_id,
    authorityFingerprint: row.authority_fingerprint,
    firstUsedAt: row.first_used_at,
  };
}

export function mapGithubIngressDelivery(row: GithubIngressDeliveryRow): GithubIngressDeliveryRecord {
  return {
    sourceId: row.source_id,
    deliveryId: row.delivery_id,
    payloadDigest: row.payload_digest,
    receivedAt: row.received_at,
  };
}

export function mapGithubIngressReceipt(row: GithubIngressReceiptRow): GithubIngressReceiptRecord {
  return {
    workspaceId: row.workspace_id,
    attemptKey: row.attempt_key,
    semanticKey: row.semantic_key,
    provider: "github",
    repositoryId: row.repository_id,
    workflowId: row.workflow_id,
    runId: row.run_id,
    attempt: Number(row.attempt),
    conclusion: row.conclusion,
    eventKind: "workflow_run.completed",
    payloadDigest: row.payload_digest,
    providerTimestamp: row.provider_timestamp,
    receivedAt: row.received_at,
    sourceId: row.source_id,
    proposalId: row.proposal_id,
    reservationId: row.reservation_id,
    findingId: row.finding_id,
    artifactId: row.artifact_id,
  };
}

export const GITHUB_SOURCE_BINDING_INSERT_SQL = `INSERT INTO github_source_bindings (
  source_id, workspace_id, repository_id, repository_name, workflow_id, action_kind,
  integration_agent_id, authority_fingerprint, first_used_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export function githubSourceBindingParams(binding: GithubSourceBindingRecord): unknown[] {
  return [
    binding.sourceId,
    binding.workspaceId,
    binding.repositoryId,
    binding.repositoryName,
    binding.workflowId,
    binding.actionKind,
    binding.integrationAgentId,
    binding.authorityFingerprint,
    binding.firstUsedAt,
  ];
}

export const GITHUB_INGRESS_DELIVERY_INSERT_SQL =
  "INSERT INTO github_ingress_deliveries (source_id, delivery_id, payload_digest, received_at) VALUES (?, ?, ?, ?)";

export function githubIngressDeliveryParams(delivery: GithubIngressDeliveryRecord): unknown[] {
  return [delivery.sourceId, delivery.deliveryId, delivery.payloadDigest, delivery.receivedAt];
}

export const GITHUB_INGRESS_RECEIPT_INSERT_SQL = `INSERT INTO github_ingress_receipts (
  workspace_id, attempt_key, semantic_key, provider, repository_id, workflow_id, run_id, attempt,
  conclusion, event_kind, payload_digest, provider_timestamp, received_at, source_id,
  proposal_id, reservation_id, finding_id, artifact_id
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export function githubIngressReceiptParams(receipt: GithubIngressReceiptRecord): unknown[] {
  return [
    receipt.workspaceId,
    receipt.attemptKey,
    receipt.semanticKey,
    receipt.provider,
    receipt.repositoryId,
    receipt.workflowId,
    receipt.runId,
    receipt.attempt,
    receipt.conclusion,
    receipt.eventKind,
    receipt.payloadDigest,
    receipt.providerTimestamp,
    receipt.receivedAt,
    receipt.sourceId,
    receipt.proposalId,
    receipt.reservationId,
    receipt.findingId,
    receipt.artifactId,
  ];
}
