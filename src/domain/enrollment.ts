/** Sprint 020's narrow enrollment capability and deterministic provisioning plans. */
import { ValidationError } from "./errors.js";
import type { IdSource } from "./ids.js";
import type { ActorRef, ActorToken, Agent, Human, NewContribution, Workspace, WorkspaceParticipant } from "./types.js";

export const ENROLLMENT_HARNESSES = ["codex", "opencode"] as const;
export type EnrollmentHarness = (typeof ENROLLMENT_HARNESSES)[number];
export interface PreparedEnrollmentAgent { harness: EnrollmentHarness; name?: string; tokenHash: string }
export interface RedeemEnrollmentInput {
  invitationId: string;
  requestId: string;
  humanName: string;
  humanTokenHash: string;
  agents: PreparedEnrollmentAgent[];
}
export interface IssueEnrollmentInvitationInput { workspaceId: string; expiresInHours?: number }
export interface RevokeEnrollmentInvitationInput { workspaceId: string; invitationId: string }
export interface EnrollmentAgentRef { id: string; name: string; harness: EnrollmentHarness }
export interface EnrollmentReceipt {
  version: 1;
  kind: "workspace_enrollment";
  invitationId: string;
  requestId: string;
  workspace: { id: string; name: string; teamId: string };
  human: { id: string; name: string };
  agents: EnrollmentAgentRef[];
  enrolledAt: string;
}
export interface EnrollmentInvitation {
  id: string;
  workspaceId: string;
  teamId: string;
  issuedByHumanId: string;
  secretHash: string;
  createdAt: string;
  expiresAt: string;
  permittedHarnesses: EnrollmentHarness[];
  revokedAt?: string;
  consumedAt?: string;
  requestId?: string;
  requestDigest?: string;
  receipt?: EnrollmentReceipt;
}
export interface IssuedEnrollmentInvitation {
  version: 1;
  kind: "enrollment_invitation";
  invitationId: string;
  secret: string;
  workspace: { id: string; name: string; teamId: string };
  expiresAt: string;
  permittedHarnesses: EnrollmentHarness[];
}
/** Revocation stops invitation authority; it never removes already enrolled principals. */
export interface EnrollmentRevocationReceipt {
  version: 1;
  kind: "enrollment_revocation";
  invitationId: string;
  workspaceId: string;
  revokedAt: string;
  revokedAuthority: "unclaimed_enrollment" | "consumed_receipt_replay";
}
export function revocationReceipt(invitation: EnrollmentInvitation): EnrollmentRevocationReceipt {
  return {
    version: 1,
    kind: "enrollment_revocation",
    invitationId: invitation.id,
    workspaceId: invitation.workspaceId,
    revokedAt: invitation.revokedAt as string,
    revokedAuthority: invitation.consumedAt === undefined ? "unclaimed_enrollment" : "consumed_receipt_replay",
  };
}
export interface EnrollmentInvitationView {
  invitationId: string;
  workspaceId: string;
  issuedByHumanId: string;
  createdAt: string;
  expiresAt: string;
  permittedHarnesses: EnrollmentHarness[];
  revokedAt?: string;
  consumedAt?: string;
}
export interface EnrollmentProvisionPlan {
  invitationId: string;
  secretHash: string;
  requestId: string;
  requestDigest: string;
  claimedAt: string;
  human: Human;
  agents: Agent[];
  tokens: ActorToken[];
  participants: WorkspaceParticipant[];
  contributions: NewContribution[];
  receipt: EnrollmentReceipt;
}
export interface EnrollOwnedAgentInput {
  workspaceId: string;
  requestId: string;
  harness: EnrollmentHarness;
  name?: string;
  tokenHash: string;
}
export interface OwnedAgentReceipt {
  version: 1;
  kind: "owned_agent_enrollment";
  requestId: string;
  workspaceId: string;
  humanId: string;
  agent: EnrollmentAgentRef;
  enrolledAt: string;
}
export interface OwnedAgentEnrollmentRecord {
  workspaceId: string;
  humanId: string;
  harness: EnrollmentHarness;
  requestId: string;
  requestDigest: string;
  tokenHash: string;
  receipt: OwnedAgentReceipt;
}
export interface OwnedAgentProvisionPlan {
  record: OwnedAgentEnrollmentRecord;
  claimedAt: string;
  agent: Agent;
  token: ActorToken;
  participant: WorkspaceParticipant;
  contributions: NewContribution[];
}
export interface RevokeEnrollmentInvitationPlan {
  invitationId: string;
  workspaceId: string;
  actor: ActorRef;
  revokedAt: string;
  contribution: NewContribution;
}

function object(value: unknown, keys: readonly string[], field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      Object.keys(value).some((key) => !keys.includes(key))) {
    throw new ValidationError(`Invalid ${field}`, { field });
  }
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string, max = 128): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new ValidationError(`Invalid ${field}`, { field });
  }
  return value.trim();
}
function identifier(value: unknown, field: string): string {
  const result = text(value, field);
  if (!/^[a-zA-Z0-9_.-]+$/.test(result)) throw new ValidationError(`Invalid ${field}`, { field });
  return result;
}
export function validatePreparedTokenHash(value: unknown, field = "tokenHash"): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new ValidationError(`Invalid ${field}`, { field });
  return value;
}
function harness(value: unknown): EnrollmentHarness {
  if (value !== "codex" && value !== "opencode") throw new ValidationError("Unsupported enrollment harness", { field: "harness" });
  return value;
}
export function normalizeIssueEnrollmentInput(value: unknown): Required<IssueEnrollmentInvitationInput> {
  const input = object(value, ["workspaceId", "expiresInHours"], "invitation request");
  const expiresInHours = input.expiresInHours ?? 24;
  if (typeof expiresInHours !== "number" || !Number.isInteger(expiresInHours) || expiresInHours < 1 || expiresInHours > 168) {
    throw new ValidationError("Invitation expiry must be between 1 and 168 hours", { field: "expiresInHours" });
  }
  return { workspaceId: identifier(input.workspaceId, "workspaceId"), expiresInHours };
}
export function normalizeInvitationLookup(value: unknown): RevokeEnrollmentInvitationInput {
  const input = object(value, ["workspaceId", "invitationId"], "invitation lookup");
  return { workspaceId: identifier(input.workspaceId, "workspaceId"), invitationId: identifier(input.invitationId, "invitationId") };
}
export function normalizeRedeemEnrollmentInput(value: unknown): RedeemEnrollmentInput {
  const input = object(value, ["invitationId", "requestId", "humanName", "humanTokenHash", "agents"], "enrollment request");
  if (!Array.isArray(input.agents) || input.agents.length < 1 || input.agents.length > 2) throw new ValidationError("Select one or two supported harnesses", { field: "agents" });
  const agents = input.agents.map((value) => {
    const agent = object(value, ["harness", "name", "tokenHash"], "prepared agent");
    const selected = harness(agent.harness);
    return { harness: selected, name: agent.name === undefined ? (selected === "codex" ? "Codex" : "OpenCode") : text(agent.name, "agent name", 200), tokenHash: validatePreparedTokenHash(agent.tokenHash) };
  }).sort((a, b) => a.harness.localeCompare(b.harness));
  const humanTokenHash = validatePreparedTokenHash(input.humanTokenHash, "humanTokenHash");
  if (new Set(agents.map((agent) => agent.harness)).size !== agents.length || new Set([humanTokenHash, ...agents.map((agent) => agent.tokenHash)]).size !== agents.length + 1) {
    throw new ValidationError("Enrollment harnesses and credentials must be distinct", { field: "agents" });
  }
  return { invitationId: identifier(input.invitationId, "invitationId"), requestId: identifier(input.requestId, "requestId"), humanName: text(input.humanName, "humanName", 200), humanTokenHash, agents };
}
export function normalizeEnrollOwnedAgentInput(value: unknown): EnrollOwnedAgentInput {
  const input = object(value, ["workspaceId", "requestId", "harness", "name", "tokenHash"], "owned agent request");
  const selected = harness(input.harness);
  return { workspaceId: identifier(input.workspaceId, "workspaceId"), requestId: identifier(input.requestId, "requestId"), harness: selected, name: input.name === undefined ? (selected === "codex" ? "Codex" : "OpenCode") : text(input.name, "agent name", 200), tokenHash: validatePreparedTokenHash(input.tokenHash) };
}

/** Only safe metadata crosses authenticated invitation inspection boundaries. */
export function invitationView(invitation: EnrollmentInvitation): EnrollmentInvitationView {
  return { invitationId: invitation.id, workspaceId: invitation.workspaceId, issuedByHumanId: invitation.issuedByHumanId, createdAt: invitation.createdAt, expiresAt: invitation.expiresAt, permittedHarnesses: [...invitation.permittedHarnesses], ...(invitation.revokedAt === undefined ? {} : { revokedAt: invitation.revokedAt }), ...(invitation.consumedAt === undefined ? {} : { consumedAt: invitation.consumedAt }) };
}

/** Prebuild complete rows; persistence performs the single guarded claim. */
export function buildEnrollmentPlan(invitation: EnrollmentInvitation, workspace: Workspace, input: RedeemEnrollmentInput, requestDigest: string, now: string, idSource: IdSource): EnrollmentProvisionPlan {
  const human: Human = { id: idSource("human"), teamId: invitation.teamId, displayName: input.humanName, createdAt: now };
  const humanActor: ActorRef = { actorId: human.id, actorType: "human" };
  const agents: Agent[] = input.agents.map((prepared) => ({ id: idSource("agent"), teamId: invitation.teamId, humanId: human.id, name: prepared.name!, harness: prepared.harness, createdAt: now }));
  const tokens: ActorToken[] = [{ id: idSource("token"), actor: humanActor, tokenHash: input.humanTokenHash, createdAt: now }, ...agents.map((agent, index) => ({ id: idSource("token"), actor: { actorId: agent.id, actorType: "agent" as const }, tokenHash: input.agents[index]!.tokenHash, createdAt: now }))];
  const participants: WorkspaceParticipant[] = [{ workspaceId: workspace.id, actor: humanActor, role: "member", joinedAt: now }, ...agents.map((agent) => ({ workspaceId: workspace.id, actor: { actorId: agent.id, actorType: "agent" as const }, role: "agent" as const, joinedAt: now }))];
  const contributions: NewContribution[] = [
    { id: idSource("contribution"), workspaceId: workspace.id, actor: humanActor, action: "update", objectType: "enrollment_invitation", objectId: invitation.id, payload: { consumedAt: now, issuedByHumanId: invitation.issuedByHumanId }, createdAt: now },
    ...participants.map((participant) => ({ id: idSource("contribution"), workspaceId: workspace.id, actor: humanActor, action: "join" as const, objectType: "participant" as const, objectId: participant.actor.actorId, payload: { role: participant.role, actorType: participant.actor.actorType, invitationId: invitation.id, ...(participant.actor.actorType === "agent" ? { humanOwnerId: human.id } : {}) }, createdAt: now })),
  ];
  const receipt: EnrollmentReceipt = { version: 1, kind: "workspace_enrollment", invitationId: invitation.id, requestId: input.requestId, workspace: { id: workspace.id, name: workspace.name, teamId: workspace.teamId }, human: { id: human.id, name: human.displayName }, agents: agents.map((agent) => ({ id: agent.id, name: agent.name, harness: agent.harness as EnrollmentHarness })), enrolledAt: now };
  return { invitationId: invitation.id, secretHash: invitation.secretHash, requestId: input.requestId, requestDigest, claimedAt: now, human, agents, tokens, participants, contributions, receipt };
}

export function buildOwnedAgentPlan(human: Human, input: EnrollOwnedAgentInput, requestDigest: string, now: string, idSource: IdSource): OwnedAgentProvisionPlan {
  const actor: ActorRef = { actorId: human.id, actorType: "human" };
  const agent: Agent = { id: idSource("agent"), teamId: human.teamId, humanId: human.id, name: input.name!, harness: input.harness, createdAt: now };
  const agentActor: ActorRef = { actorId: agent.id, actorType: "agent" };
  const token: ActorToken = { id: idSource("token"), actor: agentActor, tokenHash: input.tokenHash, createdAt: now };
  const participant: WorkspaceParticipant = { workspaceId: input.workspaceId, actor: agentActor, role: "agent", joinedAt: now };
  const receipt: OwnedAgentReceipt = { version: 1, kind: "owned_agent_enrollment", requestId: input.requestId, workspaceId: input.workspaceId, humanId: human.id, agent: { id: agent.id, name: agent.name, harness: input.harness }, enrolledAt: now };
  const contributions: NewContribution[] = [{ id: idSource("contribution"), workspaceId: input.workspaceId, actor, action: "join", objectType: "participant", objectId: agent.id, payload: { role: "agent", actorType: "agent", humanOwnerId: human.id }, createdAt: now }];
  return { record: { workspaceId: input.workspaceId, humanId: human.id, harness: input.harness, requestId: input.requestId, requestDigest, tokenHash: input.tokenHash, receipt }, claimedAt: now, agent, token, participant, contributions };
}
