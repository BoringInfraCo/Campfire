/**
 * Guarded enrollment batches shared by SQLite and D1. A per-execution nonce
 * distinguishes the winning write from even an identical concurrent retry.
 * Every dependent INSERT selects only if that execution won the claim.
 */
import type { EnrollmentInvitation, EnrollmentProvisionPlan, OwnedAgentEnrollmentRecord, OwnedAgentProvisionPlan, RevokeEnrollmentInvitationPlan } from "../domain/enrollment.js";
import type { Agent, ActorToken, Contribution, WorkspaceParticipant } from "../domain/types.js";

export interface EnrollmentStatement { sql: string; values: unknown[] }
interface Guard { sql: string; values: unknown[] }

function insert(table: string, columns: string, values: unknown[], guard: Guard): EnrollmentStatement {
  return { sql: `INSERT INTO ${table} (${columns}) SELECT ${values.map(() => "?").join(", ")} WHERE ${guard.sql}`, values: [...values, ...guard.values] };
}
const ownerGuard = (workspaceId: string, humanId: string, teamId?: string): Guard => ({
  sql: `EXISTS (SELECT 1 FROM workspaces w JOIN humans h ON h.id = ? AND h.team_id = w.team_id
    JOIN workspace_participants p ON p.workspace_id = w.id AND p.actor_id = h.id
      AND p.actor_type = 'human' AND p.role = 'owner'
    WHERE w.id = ?${teamId === undefined ? "" : " AND w.team_id = ? AND w.status = 'active'"})`,
  values: [humanId, workspaceId, ...(teamId === undefined ? [] : [teamId])],
});
function contributionInsert(value: Contribution, guard: Guard): EnrollmentStatement {
  return insert("contributions", "id, workspace_id, actor_id, actor_type, agent_session_id, action, object_type, object_id, payload, created_at",
    [value.id, value.workspaceId, value.actor.actorId, value.actor.actorType, value.agentSessionId ?? null, value.action,
      value.objectType, value.objectId, value.payload === undefined ? null : JSON.stringify(value.payload), value.createdAt], guard);
}
function agentInsert(value: Agent, guard: Guard): EnrollmentStatement {
  return insert("agents", "id, team_id, human_id, name, harness, model, instance_metadata, created_at",
    [value.id, value.teamId, value.humanId ?? null, value.name, value.harness, value.model ?? null,
      value.instanceMetadata === undefined ? null : JSON.stringify(value.instanceMetadata), value.createdAt], guard);
}
function tokenInsert(value: ActorToken, guard: Guard): EnrollmentStatement {
  return insert("actor_tokens", "id, actor_id, actor_type, token_hash, created_at, revoked_at",
    [value.id, value.actor.actorId, value.actor.actorType, value.tokenHash, value.createdAt, value.revokedAt ?? null], guard);
}
function participantInsert(value: WorkspaceParticipant, guard: Guard): EnrollmentStatement {
  return insert("workspace_participants", "workspace_id, actor_id, actor_type, role, joined_at",
    [value.workspaceId, value.actor.actorId, value.actor.actorType, value.role, value.joinedAt], guard);
}
function slotInsert(record: OwnedAgentEnrollmentRecord, nonce: string, guard: Guard): EnrollmentStatement {
  return insert("managed_agent_slots", "workspace_id, human_id, harness, request_id, request_digest, token_hash, receipt_json, claim_nonce",
    [record.workspaceId, record.humanId, record.harness, record.requestId, record.requestDigest, record.tokenHash, JSON.stringify(record.receipt), nonce], guard);
}

export function issueEnrollmentStatements(invitation: EnrollmentInvitation, contribution: Contribution, nonce: string): EnrollmentStatement[] {
  const guard = ownerGuard(invitation.workspaceId, invitation.issuedByHumanId, invitation.teamId);
  const ownWrite = { sql: "EXISTS (SELECT 1 FROM enrollment_invitations WHERE id = ? AND claim_nonce = ?)", values: [invitation.id, nonce] };
  return [
    insert("enrollment_invitations", "id, workspace_id, team_id, issued_by_human_id, secret_hash, permitted_harnesses, created_at, expires_at, claim_nonce",
      [invitation.id, invitation.workspaceId, invitation.teamId, invitation.issuedByHumanId, invitation.secretHash,
        JSON.stringify(invitation.permittedHarnesses), invitation.createdAt, invitation.expiresAt, nonce], guard),
    contributionInsert(contribution, ownWrite),
  ];
}
export function revokeEnrollmentStatements(input: RevokeEnrollmentInvitationPlan, nonce: string): EnrollmentStatement[] {
  const allowed = ownerGuard(input.workspaceId, input.actor.actorId);
  return [
    { sql: `UPDATE enrollment_invitations SET revoked_at = ?, claim_nonce = ?
        WHERE id = ? AND workspace_id = ? AND revoked_at IS NULL AND ? = 'human' AND ${allowed.sql}`,
      values: [input.revokedAt, nonce, input.invitationId, input.workspaceId, input.actor.actorType, ...allowed.values] },
    contributionInsert(input.contribution, { sql: "EXISTS (SELECT 1 FROM enrollment_invitations WHERE id = ? AND revoked_at IS NOT NULL AND claim_nonce = ?)", values: [input.invitationId, nonce] }),
  ];
}
export function provisionEnrollmentStatements(plan: EnrollmentProvisionPlan, nonce: string): EnrollmentStatement[] {
  const guard: Guard = { sql: "EXISTS (SELECT 1 FROM enrollment_invitations WHERE id = ? AND claim_nonce = ? AND consumed_at IS NOT NULL)", values: [plan.invitationId, nonce] };
  const statements: EnrollmentStatement[] = [{
    sql: `UPDATE enrollment_invitations SET consumed_at = ?, request_id = ?, request_digest = ?, receipt_json = ?, claim_nonce = ?
      WHERE id = ? AND secret_hash = ? AND consumed_at IS NULL AND revoked_at IS NULL
        AND julianday(expires_at) > julianday(?) AND team_id = ? AND workspace_id = ?
        AND EXISTS (SELECT 1 FROM workspaces w JOIN humans h ON h.id = enrollment_invitations.issued_by_human_id AND h.team_id = w.team_id
          JOIN workspace_participants p ON p.workspace_id = w.id AND p.actor_id = h.id AND p.actor_type = 'human' AND p.role = 'owner'
          WHERE w.id = enrollment_invitations.workspace_id AND w.team_id = enrollment_invitations.team_id AND w.status = 'active')
        AND NOT EXISTS (SELECT 1 FROM json_each(?) chosen WHERE chosen.value NOT IN (SELECT value FROM json_each(enrollment_invitations.permitted_harnesses)))`,
    values: [plan.claimedAt, plan.requestId, plan.requestDigest, JSON.stringify(plan.receipt), nonce,
      plan.invitationId, plan.secretHash, plan.claimedAt, plan.human.teamId, plan.receipt.workspace.id, JSON.stringify(plan.agents.map((agent) => agent.harness))],
  }, insert("humans", "id, team_id, display_name, external_identity, created_at",
    [plan.human.id, plan.human.teamId, plan.human.displayName, plan.human.externalIdentity ?? null, plan.human.createdAt], guard)];
  statements.push(...plan.agents.map((agent) => agentInsert(agent, guard)), ...plan.tokens.map((token) => tokenInsert(token, guard)),
    ...plan.participants.map((participant) => participantInsert(participant, guard)));
  for (const agent of plan.agents) {
    const token = plan.tokens.find((item) => item.actor.actorType === "agent" && item.actor.actorId === agent.id);
    if (token === undefined || (agent.harness !== "codex" && agent.harness !== "opencode")) throw new Error("Invalid enrollment provisioning plan");
    statements.push(slotInsert({ workspaceId: plan.receipt.workspace.id, humanId: plan.human.id, harness: agent.harness,
      requestId: plan.requestId, requestDigest: plan.requestDigest, tokenHash: token.tokenHash,
      receipt: { version: 1, kind: "owned_agent_enrollment", requestId: plan.requestId, workspaceId: plan.receipt.workspace.id,
        humanId: plan.human.id, agent: { id: agent.id, name: agent.name, harness: agent.harness }, enrolledAt: plan.claimedAt } }, nonce, guard));
  }
  statements.push(...plan.contributions.map((contribution) => contributionInsert(contribution, guard)));
  return statements;
}

export function provisionOwnedAgentStatements(plan: OwnedAgentProvisionPlan, nonce: string): EnrollmentStatement[] {
  const record = plan.record;
  const eligible: Guard = {
    sql: `EXISTS (SELECT 1 FROM humans h JOIN workspaces w ON w.team_id = h.team_id
      JOIN workspace_participants p ON p.workspace_id = w.id AND p.actor_id = h.id AND p.actor_type = 'human' AND p.role IN ('owner', 'member')
      WHERE h.id = ? AND w.id = ? AND w.status = 'active' AND h.team_id = ?)
      AND ? = ? AND ? = ?
      AND NOT EXISTS (SELECT 1 FROM managed_agent_slots WHERE workspace_id = ? AND human_id = ? AND harness = ?)`,
    values: [record.humanId, record.workspaceId, plan.agent.teamId, plan.agent.humanId, record.humanId, plan.agent.harness, record.harness,
      record.workspaceId, record.humanId, record.harness],
  };
  const ownWrite: Guard = {
    sql: "EXISTS (SELECT 1 FROM managed_agent_slots WHERE workspace_id = ? AND human_id = ? AND harness = ? AND claim_nonce = ?)",
    values: [record.workspaceId, record.humanId, record.harness, nonce],
  };
  return [slotInsert(record, nonce, eligible), agentInsert(plan.agent, ownWrite), tokenInsert(plan.token, ownWrite),
    participantInsert(plan.participant, ownWrite), ...plan.contributions.map((value) => contributionInsert(value, ownWrite))];
}

export interface EnrollmentInvitationRow {
  id: string; workspace_id: string; team_id: string; issued_by_human_id: string; secret_hash: string; permitted_harnesses: string;
  created_at: string; expires_at: string; revoked_at: string | null; consumed_at: string | null; request_id: string | null;
  request_digest: string | null; receipt_json: string | null;
}
export function mapEnrollmentInvitation(row: EnrollmentInvitationRow): EnrollmentInvitation {
  return { id: row.id, workspaceId: row.workspace_id, teamId: row.team_id, issuedByHumanId: row.issued_by_human_id,
    secretHash: row.secret_hash, permittedHarnesses: JSON.parse(row.permitted_harnesses), createdAt: row.created_at, expiresAt: row.expires_at,
    revokedAt: row.revoked_at ?? undefined, consumedAt: row.consumed_at ?? undefined, requestId: row.request_id ?? undefined,
    requestDigest: row.request_digest ?? undefined, receipt: row.receipt_json === null ? undefined : JSON.parse(row.receipt_json) };
}
export interface OwnedAgentEnrollmentRow { workspace_id: string; human_id: string; harness: OwnedAgentEnrollmentRecord["harness"]; request_id: string; request_digest: string; token_hash: string; receipt_json: string }
export function mapOwnedAgentEnrollment(row: OwnedAgentEnrollmentRow): OwnedAgentEnrollmentRecord {
  return { workspaceId: row.workspace_id, humanId: row.human_id, harness: row.harness, requestId: row.request_id,
    requestDigest: row.request_digest, tokenHash: row.token_hash, receipt: JSON.parse(row.receipt_json) };
}
