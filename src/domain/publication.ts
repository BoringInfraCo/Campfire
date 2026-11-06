/**
 * SHR-001 workspace publication contract.
 *
 * This is the allow-listed structured state one local workspace may export.
 * It deliberately excludes credentials, transcripts, domain events, action
 * proposals, GitHub bindings, webhooks, and every unrecognized table. The
 * Worker validates the same object before it writes one atomic D1 batch.
 */
import { ValidationError } from "./errors.js";

export const PUBLICATION_FORMAT = "campfire.workspace_snapshot";
export const PUBLICATION_VERSION = 1 as const;
export const PUBLICATION_RECEIPT_VERSION = 1 as const;
/**
 * Local schema written by a current export. Imports still accept the previous
 * snapshot schema so a v1.28.1 publication remains readable. Runtime reports
 * are never part of either snapshot.
 */
export const PUBLICATION_SOURCE_SCHEMA_VERSION = 11 as const;
export const PUBLICATION_ACCEPTED_SOURCE_SCHEMA_VERSIONS = [10, PUBLICATION_SOURCE_SCHEMA_VERSION] as const;
/**
 * A rehearsal admission code is an operator-held capability, distinct from an
 * owner token and from an invitation secret. The Worker stores only its hash.
 * The header is required on enroll, import, and recover while the hosted alpha
 * is enabled, so turning on the alpha flag without configuring a code fails
 * closed instead of opening anonymous account creation.
 */
export const PUBLICATION_REHEARSAL_HEADER = "x-campfire-rehearsal-code";
export const PUBLICATION_REHEARSAL_CODE_ENV = "CAMPFIRE_PUBLICATION_REHEARSAL_CODE";
export const PUBLICATION_REHEARSAL_CODE_HASH_ENV = "CAMPFIRE_PUBLICATION_REHEARSAL_CODE_HASH";
export const PUBLICATION_ENROLLMENT_KIND = "workspace_publication_enrollment" as const;
export const PUBLICATION_IMPORT_KIND = "workspace_publication_import" as const;
export const PUBLICATION_STATES = ["not_started", "staged", "committed", "verified", "cut_over"] as const;
export type PublicationState = (typeof PUBLICATION_STATES)[number];

/**
 * A bounded single-batch import. D1 batch limits differ by plan, so this slice
 * refuses larger workspaces with a specific recovery reason instead of
 * silently truncating or exposing a partial graph. Chunking is future work.
 */
export const PUBLICATION_LIMITS = {
  maxSnapshotBytes: 256 * 1024,
  maxRows: 500,
  maxContributions: 300,
  maxAgents: 16,
  maxText: 16 * 1024,
  maxAuxiliaryBytes: 4096,
  maxAuxiliaryDepth: 5,
  maxAuxiliaryItems: 100,
  maxEnrollmentAttemptsPerSourcePerDay: 5,
  maxEnrollmentsPerSourcePerDay: 5,
  maxImportBytes: 512 * 1024,
} as const;

export const PUBLICATION_HARNESSES = ["codex", "opencode"] as const;
export type PublicationHarness = (typeof PUBLICATION_HARNESSES)[number];

export interface PublicationWorkspace {
  id: string;
  name: string;
  description?: string;
  status: "active" | "completed" | "archived";
  createdAt: string;
  updatedAt: string;
  createdByActorId: string;
  createdByActorType: "human" | "agent";
}

export interface PublicationHuman {
  id: string;
  displayName: string;
  externalIdentity?: string;
  createdAt: string;
}

export interface PublicationAgent {
  id: string;
  humanId?: string;
  name: string;
  harness: string;
  model?: string;
  createdAt: string;
}

export interface PublicationParticipant {
  actorId: string;
  actorType: "human" | "agent";
  role: "owner" | "member" | "agent" | "viewer";
  joinedAt: string;
}

export interface PublicationSession {
  id: string;
  agentId: string;
  humanId: string;
  harness: string;
  startedAt: string;
  endedAt?: string;
  /** Historical task attachment. Operational runtime state is not published. */
  taskId?: string;
}

export interface PublicationGoal {
  id: string;
  title: string;
  description?: string;
  status: "active" | "completed" | "abandoned";
  createdByActorId: string;
  createdByActorType: "human" | "agent";
  agentSessionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PublicationTask {
  id: string;
  title: string;
  description?: string;
  status: "open" | "in_progress" | "blocked" | "completed";
  assigneeActorId?: string;
  assigneeActorType?: "human" | "agent";
  createdByActorId: string;
  createdByActorType: "human" | "agent";
  agentSessionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PublicationFinding {
  id: string;
  summary: string;
  detail?: string;
  confidence?: number;
  sourceArtifactId?: string;
  currentness: "current" | "superseded" | "withdrawn";
  predecessorId?: string;
  successorId?: string;
  correctionReason?: string;
  correctedByActorId?: string;
  correctedByActorType?: "human" | "agent";
  correctedSessionId?: string;
  correctedAt?: string;
  createdByActorId: string;
  createdByActorType: "human" | "agent";
  agentSessionId?: string;
  createdAt: string;
}

export interface PublicationDecision {
  id: string;
  summary: string;
  rationale?: string;
  status: "proposed" | "accepted" | "superseded";
  approvedByActorId?: string;
  approvedByActorType?: "human" | "agent";
  predecessorId?: string;
  successorId?: string;
  supersedeReason?: string;
  supersededByActorId?: string;
  supersededByActorType?: "human" | "agent";
  supersededSessionId?: string;
  supersededAt?: string;
  createdByActorId: string;
  createdByActorType: "human" | "agent";
  agentSessionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PublicationArtifact {
  id: string;
  type:
    | "file"
    | "pull_request"
    | "commit"
    | "log"
    | "trace"
    | "document"
    | "deployment"
    | "screenshot"
    | "report"
    | "other";
  title: string;
  uriOrPath: string;
  metadata?: Record<string, unknown>;
  createdByActorId: string;
  createdByActorType: "human" | "agent";
  agentSessionId?: string;
  createdAt: string;
}

export interface PublicationFindingTransition {
  findingId: string;
  successorId?: string;
  kind: "superseded" | "withdrawn";
  reason: string;
  actorId: string;
  actorType: "human" | "agent";
  agentSessionId?: string;
  createdAt: string;
}

export interface PublicationDecisionTransition {
  decisionId: string;
  successorId?: string;
  kind: "superseded" | "rejected";
  reason: string;
  actorId: string;
  actorType: "human" | "agent";
  agentSessionId?: string;
  createdAt: string;
}

export interface PublicationFindingEvidence {
  id: string;
  findingId: string;
  artifactId: string;
  relation: "supports" | "contradicts";
  note?: string;
  actorId: string;
  actorType: "human" | "agent";
  agentSessionId?: string;
  createdAt: string;
}

export interface PublicationDecisionCitation {
  id: string;
  decisionId: string;
  findingId: string;
  note?: string;
  actorId: string;
  actorType: "human" | "agent";
  agentSessionId?: string;
  createdAt: string;
}

export interface PublicationContribution {
  id: string;
  actorId: string;
  actorType: "human" | "agent";
  agentSessionId?: string;
  action: "create" | "update" | "join" | "register_session" | "read";
  objectType:
    | "workspace"
    | "goal"
    | "task"
    | "finding"
    | "decision"
    | "artifact"
    | "participant"
    | "agent_session"
    // Historical invitation provenance is preserved as an audit row. The
    // invitation table itself is never imported, so this grants no authority.
    | "invite"
    | "enrollment_invitation";
  objectId: string;
  payload?: Record<string, unknown>;
  appendPosition: number;
  createdAt: string;
}

export interface PublicationCounts {
  humans: number;
  agents: number;
  participants: number;
  sessions: number;
  goals: number;
  tasks: number;
  findings: number;
  decisions: number;
  artifacts: number;
  findingTransitions: number;
  decisionTransitions: number;
  findingEvidence: number;
  decisionCitations: number;
  contributions: number;
  contributionTip: number;
}

export interface PublicationSnapshot {
  format: typeof PUBLICATION_FORMAT;
  version: typeof PUBLICATION_VERSION;
  workspaceId: string;
  source: {
    packageVersion: string;
    schemaVersion: number;
    localOrganizationId: string;
    localTeamId: string;
    localWorkspaceName: string;
    contributionTip: number;
    exportedAt: string;
  };
  owner: { humanId: string; displayName: string };
  workspace: PublicationWorkspace;
  humans: PublicationHuman[];
  agents: PublicationAgent[];
  participants: PublicationParticipant[];
  sessions: PublicationSession[];
  goals: PublicationGoal[];
  tasks: PublicationTask[];
  findings: PublicationFinding[];
  decisions: PublicationDecision[];
  artifacts: PublicationArtifact[];
  findingTransitions: PublicationFindingTransition[];
  decisionTransitions: PublicationDecisionTransition[];
  findingEvidence: PublicationFindingEvidence[];
  decisionCitations: PublicationDecisionCitation[];
  contributions: PublicationContribution[];
  counts: PublicationCounts;
  digest: string;
}

export interface PublicationEnrollmentAgent {
  id: string;
  name: string;
  harness: PublicationHarness;
  tokenHash: string;
}

export interface PublicationEnrollmentInput {
  requestId: string;
  humanId: string;
  humanName: string;
  humanTokenHash: string;
  recoveryHash: string;
  agents: PublicationEnrollmentAgent[];
  workspaceName: string;
  sourceWorkspaceId: string;
  sourcePackageVersion: string;
  sourceSchemaVersion: number;
  deviceKeyHash: string;
}

export interface PublicationEnrollmentReceipt {
  version: 1;
  kind: typeof PUBLICATION_ENROLLMENT_KIND;
  requestId: string;
  human: { id: string; displayName: string };
  organization: { id: string; name: string };
  team: { id: string; name: string };
  agents: Array<{ id: string; name: string; harness: PublicationHarness }>;
  sourceWorkspaceId: string;
  enrolledAt: string;
}

export interface PublicationImportInput {
  requestId: string;
  digest: string;
  snapshot: PublicationSnapshot;
}

export interface PublicationImportReceipt {
  version: 1;
  kind: typeof PUBLICATION_IMPORT_KIND;
  requestId: string;
  workspace: { id: string; name: string; teamId: string };
  owner: { humanId: string; displayName: string };
  sourceTip: number;
  digest: string;
  counts: PublicationCounts;
  importedAt: string;
}

export interface PublicationRecoveryInput {
  requestId: string;
  humanId: string;
  recoverySecret: string;
  humanTokenHash: string;
  newRecoveryHash: string;
}

export interface PublicationRecoveryReceipt {
  version: 1;
  kind: "workspace_publication_recovery";
  requestId: string;
  humanId: string;
  recoveredAt: string;
}

export interface PublicationReceipt {
  version: typeof PUBLICATION_RECEIPT_VERSION;
  kind: "workspace_publication";
  publicationId: string;
  state: PublicationState;
  endpoint: string;
  workspaceId: string;
  workspaceName: string;
  sourceDatabasePath: string;
  sourcePackageVersion: string;
  sourceSchemaVersion: number;
  sourceTip: number;
  snapshotDigest: string;
  counts: PublicationCounts | Record<string, never>;
  owner: { humanId: string; displayName: string };
  agents: Array<{ id: string; name: string; harness: PublicationHarness }>;
  organizationId?: string;
  teamId?: string;
  importedAt?: string;
  verifiedAt?: string;
  cutOverAt?: string;
  nextAction: string;
}

export interface PublicationStateFile {
  version: 1;
  receipt: PublicationReceipt;
  credentials?: {
    humanToken: string;
    agents: Record<string, string>;
    recoverySecret: string;
    /** Operator-held rehearsal capability. Never printed in a receipt. */
    rehearsalCode?: string;
  };
  /** Saved before the recovery request so a lost response cannot strand the owner. */
  pendingRecovery?: { humanToken: string; recoverySecret: string };
}

const ID_RE = /^[a-zA-Z0-9_.-]{1,128}$/;
const DIGEST_RE = /^[0-9a-f]{64}$/;
const TOKEN_HASH_RE = /^[0-9a-f]{64}$/;
const FORBIDDEN_CREDENTIAL_TEXT_RE =
  /\b(?:cft|cfe|cfr)_[a-f0-9]{24,}\b|\bcfrh_[A-Za-z0-9_-]{24,128}\b|\b(?:sk-|gh[pousr]_|github_pat_)[A-Za-z0-9_-]{20,}\b|Bearer\s+[A-Za-z0-9._~+/=-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/i;
const FORBIDDEN_PATH_TEXT_RES: readonly RegExp[] = [
  /(?:^|[\s"'`<>(=,:;\[\]{}|])\/?file:\/\/?/i,
  /(?:^|[\s"'`<>(=,:;\[\]{}|])\/(?=[A-Za-z0-9._~-])/i,
  /\/(?:Users|home|private|tmp|var|opt|etc|Volumes|root|srv|Library|data|mnt|workspace|usr|bin|dev|proc|sys|run|media|boot|snap)\//i,
  /(?:^|[\s"'`<>(=,:;\[\]{}|])[A-Za-z]:[\\/]/i,
  /(?:^|[\s"'`<>(=,:;\[\]{}|])\\\\[A-Za-z0-9._-]+\\/i,
  /(?<!:)\/\/[A-Za-z0-9._-]+\//i,
  /\\\\\?\\[A-Za-z]:[\\/]/i,
  /~[\\/]/i,
];
const URL_SECRET_KEY_RE =
  /token|secret|password|credential|authorization|api[-_]?key|webhook|cookie|private[-_]?key|(?:^|[-_])(?:auth|session|sessionid|sig|signature|accesskey|awsaccesskeyid|googleaccessid|x-goog[-_]?(?:signature|credential))(?:$|[-_])/i;
const FORBIDDEN_URL_USERINFO_RE = /(?:\b[a-z][a-z0-9+.-]*:)?\/\/[^/\s@]+@/i;

function hasCredentialBearingQuery(value: string): boolean {
  for (const match of value.matchAll(/[?&#]([A-Za-z0-9_.~-]+)=/g)) {
    if (URL_SECRET_KEY_RE.test(match[1] ?? "")) return true;
  }
  return false;
}
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(message: string, field: string, nextAction?: string): never {
  throw new ValidationError(message, { field, ...(nextAction === undefined ? {} : { nextAction }) });
}

function exact(value: unknown, keys: readonly string[], field: string): Record<string, unknown> {
  if (!isRecord(value)) fail(`Invalid ${field}`, field);
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) fail(`Unrecognized ${field} field`, `${field}.${key}`);
  }
  return value;
}

function text(value: unknown, field: string, max = PUBLICATION_LIMITS.maxText): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    fail(`Invalid ${field}`, field);
  }
  return value;
}

function optionalText(value: unknown, field: string, max = PUBLICATION_LIMITS.maxText): string | undefined {
  if (value === undefined || value === null) return undefined;
  return text(value, field, max);
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== "string" || !ID_RE.test(value)) fail(`Invalid ${field}`, field);
  return value;
}

function optionalIdentifier(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return identifier(value, field);
}

function timestamp(value: unknown, field: string): string {
  if (typeof value !== "string" || !TIMESTAMP_RE.test(value) || !Number.isFinite(Date.parse(value))) {
    fail(`Invalid ${field}`, field);
  }
  return value;
}

function optionalTimestamp(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return timestamp(value, field);
}

function enumValue<T extends string>(value: unknown, values: readonly T[], field: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) fail(`Invalid ${field}`, field);
  return value as T;
}

function integer(value: unknown, field: string, min = 0): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min) fail(`Invalid ${field}`, field);
  return value;
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`Invalid ${field}`, field);
  return value;
}

function actorType(value: unknown, field: string): "human" | "agent" {
  return enumValue(value, ["human", "agent"] as const, field);
}

function role(value: unknown, field: string): "owner" | "member" | "agent" | "viewer" {
  return enumValue(value, ["owner", "member", "agent", "viewer"] as const, field);
}

const SECRET_KEY_RE = /token|secret|password|credential|authorization|api[-_]?key|webhook|cookie|private[-_]?key/i;
const SECRET_VALUE_RE = /^(?:cft_|cfe_|sk-|gh[pousr]_)|^Bearer\s|-----BEGIN /;
const PATH_VALUE_RE = /^(?:file:|\/|~[\\/]|[A-Za-z]:[\\/]|\\\\)/;

/**
 * Auxiliary JSON is allowed only when it is small, structured, and free of
 * credential-shaped keys/values and filesystem paths. This is intentionally
 * stricter than the domain validators: publication is an egress boundary.
 */
export function assertSafeAuxiliary(value: unknown, field: string, depth = 0): void {
  if (depth > PUBLICATION_LIMITS.maxAuxiliaryDepth) fail(`Invalid ${field} nesting`, field);
  if (value === null || typeof value === "boolean" || typeof value === "number") return;
  if (typeof value === "string") {
    if (value.length > PUBLICATION_LIMITS.maxAuxiliaryBytes) fail(`Invalid ${field} value`, field);
    if (SECRET_VALUE_RE.test(value) || PATH_VALUE_RE.test(value)) {
      fail(`Unsupported credential or filesystem value in ${field}`, field, "remove_unsupported_state");
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > PUBLICATION_LIMITS.maxAuxiliaryItems) fail(`Invalid ${field} list`, field);
    for (const entry of value) assertSafeAuxiliary(entry, field, depth + 1);
    return;
  }
  if (!isRecord(value)) fail(`Invalid ${field}`, field);
  if (Object.keys(value).length > PUBLICATION_LIMITS.maxAuxiliaryItems) fail(`Invalid ${field} object`, field);
  for (const [key, entry] of Object.entries(value)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      fail(`Unsupported prototype key in ${field}`, `${field}.${key}`, "remove_unsupported_state");
    }
    if (SECRET_KEY_RE.test(key)) fail(`Unsupported secret field in ${field}`, `${field}.${key}`, "remove_unsupported_state");
    assertSafeAuxiliary(entry, `${field}.${key}`, depth + 1);
  }
}

function assertNoForbiddenFreeText(value: unknown, field: string): void {
  if (typeof value === "string") {
    if (FORBIDDEN_CREDENTIAL_TEXT_RE.test(value)) {
      fail("Snapshot free text contains credential-shaped material", `${field}.credentials`, "remove_unsupported_state");
    }
    if (FORBIDDEN_PATH_TEXT_RES.some((pattern) => pattern.test(value))) {
      fail("Snapshot free text contains an absolute filesystem path", `${field}.path`, "remove_unsupported_state");
    }
    if (FORBIDDEN_URL_USERINFO_RE.test(value) || hasCredentialBearingQuery(value)) {
      fail("Snapshot free text contains a credential-bearing URL", `${field}.credentials`, "remove_unsupported_state");
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoForbiddenFreeText(entry, `${field}[${index}]`));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype" || SECRET_KEY_RE.test(key)) {
      fail("Snapshot free text contains a credential-shaped key", `${field}.${key}`, "remove_unsupported_state");
    }
    assertNoForbiddenFreeText(entry, `${field}.${key}`);
  }
}

function auxiliary(value: unknown, field: string): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) fail(`Invalid ${field}`, field);
  assertSafeAuxiliary(value, field);
  const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  if (bytes > PUBLICATION_LIMITS.maxAuxiliaryBytes) fail(`Invalid ${field} size`, field);
  return value;
}

function parseRows<T>(
  value: unknown,
  field: string,
  parse: (entry: Record<string, unknown>, index: number) => T,
): T[] {
  if (!Array.isArray(value)) fail(`Invalid ${field}`, field);
  if (value.length > PUBLICATION_LIMITS.maxRows) fail(`Too many ${field}`, field);
  return value.map((entry, index) => {
    if (!isRecord(entry)) fail(`Invalid ${field}[${index}]`, `${field}[${index}]`);
    return parse(entry, index);
  });
}

function parseWorkspace(value: unknown): PublicationWorkspace {
  const row = exact(value, ["id", "name", "description", "status", "createdAt", "updatedAt", "createdByActorId", "createdByActorType"], "workspace");
  return {
    id: identifier(row.id, "workspace.id"),
    name: text(row.name, "workspace.name"),
    ...(optionalText(row.description, "workspace.description") === undefined ? {} : { description: optionalText(row.description, "workspace.description")! }),
    status: enumValue(row.status, ["active", "completed", "archived"] as const, "workspace.status"),
    createdAt: timestamp(row.createdAt, "workspace.createdAt"),
    updatedAt: timestamp(row.updatedAt, "workspace.updatedAt"),
    createdByActorId: identifier(row.createdByActorId, "workspace.createdByActorId"),
    createdByActorType: actorType(row.createdByActorType, "workspace.createdByActorType"),
  };
}

function parseHuman(value: unknown): PublicationHuman {
  const row = exact(value, ["id", "displayName", "externalIdentity", "createdAt"], "human");
  return {
    id: identifier(row.id, "human.id"),
    displayName: text(row.displayName, "human.displayName", 200),
    ...(optionalText(row.externalIdentity, "human.externalIdentity", 200) === undefined ? {} : { externalIdentity: optionalText(row.externalIdentity, "human.externalIdentity", 200)! }),
    createdAt: timestamp(row.createdAt, "human.createdAt"),
  };
}

function parseAgent(value: unknown): PublicationAgent {
  const row = exact(value, ["id", "humanId", "name", "harness", "model", "createdAt"], "agent");
  return {
    id: identifier(row.id, "agent.id"),
    ...(optionalIdentifier(row.humanId, "agent.humanId") === undefined ? {} : { humanId: optionalIdentifier(row.humanId, "agent.humanId")! }),
    name: text(row.name, "agent.name", 200),
    harness: text(row.harness, "agent.harness", 64),
    ...(optionalText(row.model, "agent.model", 200) === undefined ? {} : { model: optionalText(row.model, "agent.model", 200)! }),
    createdAt: timestamp(row.createdAt, "agent.createdAt"),
  };
}

function parseParticipant(value: unknown): PublicationParticipant {
  const row = exact(value, ["actorId", "actorType", "role", "joinedAt"], "participant");
  return {
    actorId: identifier(row.actorId, "participant.actorId"),
    actorType: actorType(row.actorType, "participant.actorType"),
    role: role(row.role, "participant.role"),
    joinedAt: timestamp(row.joinedAt, "participant.joinedAt"),
  };
}

function acceptedSourceSchemaVersion(version: number, field: string): number {
  if (!(PUBLICATION_ACCEPTED_SOURCE_SCHEMA_VERSIONS as readonly number[]).includes(version)) {
    fail(`Unsupported local schema version ${version}`, field, "upgrade_publication_contract");
  }
  return version;
}

function parseSession(value: unknown): PublicationSession {
  const row = exact(value, ["id", "agentId", "humanId", "harness", "startedAt", "endedAt", "taskId"], "session");
  const taskId = optionalIdentifier(row.taskId, "session.taskId");
  return {
    id: identifier(row.id, "session.id"),
    agentId: identifier(row.agentId, "session.agentId"),
    humanId: identifier(row.humanId, "session.humanId"),
    harness: text(row.harness, "session.harness", 64),
    startedAt: timestamp(row.startedAt, "session.startedAt"),
    ...(optionalTimestamp(row.endedAt, "session.endedAt") === undefined ? {} : { endedAt: optionalTimestamp(row.endedAt, "session.endedAt")! }),
    ...(taskId === undefined ? {} : { taskId }),
  };
}

export function parsePublicationSnapshot(value: unknown): PublicationSnapshot {
  const root = exact(value, [
    "format", "version", "workspaceId", "source", "owner", "workspace", "humans", "agents",
    "participants", "sessions", "goals", "tasks", "findings", "decisions", "artifacts",
    "findingTransitions", "decisionTransitions", "findingEvidence", "decisionCitations",
    "contributions", "counts", "digest",
  ], "snapshot");
  if (root.format !== PUBLICATION_FORMAT || root.version !== PUBLICATION_VERSION) {
    fail("Unsupported publication snapshot version", "snapshot.version", "upgrade_campfire");
  }
  const source = exact(root.source, ["packageVersion", "schemaVersion", "localOrganizationId", "localTeamId", "localWorkspaceName", "contributionTip", "exportedAt"], "source");
  const owner = exact(root.owner, ["humanId", "displayName"], "owner");
  const counts = exact(root.counts, ["humans", "agents", "participants", "sessions", "goals", "tasks", "findings", "decisions", "artifacts", "findingTransitions", "decisionTransitions", "findingEvidence", "decisionCitations", "contributions", "contributionTip"], "counts");

  const sourceSchemaVersion = acceptedSourceSchemaVersion(
    integer(source.schemaVersion, "source.schemaVersion"),
    "source.schemaVersion",
  );
  const snapshot: PublicationSnapshot = {
    format: PUBLICATION_FORMAT,
    version: PUBLICATION_VERSION,
    workspaceId: identifier(root.workspaceId, "workspaceId"),
    source: {
      packageVersion: text(source.packageVersion, "source.packageVersion", 64),
      schemaVersion: sourceSchemaVersion,
      localOrganizationId: identifier(source.localOrganizationId, "source.localOrganizationId"),
      localTeamId: identifier(source.localTeamId, "source.localTeamId"),
      localWorkspaceName: text(source.localWorkspaceName, "source.localWorkspaceName", 200),
      contributionTip: integer(source.contributionTip, "source.contributionTip"),
      exportedAt: timestamp(source.exportedAt, "source.exportedAt"),
    },
    owner: { humanId: identifier(owner.humanId, "owner.humanId"), displayName: text(owner.displayName, "owner.displayName", 200) },
    workspace: parseWorkspace(root.workspace),
    humans: parseRows(root.humans, "humans", parseHuman),
    agents: parseRows(root.agents, "agents", parseAgent),
    participants: parseRows(root.participants, "participants", parseParticipant),
    sessions: parseRows(root.sessions, "sessions", parseSession),
    goals: parseRows(root.goals, "goals", (row) => {
      const r = exact(row, ["id", "title", "description", "status", "createdByActorId", "createdByActorType", "agentSessionId", "createdAt", "updatedAt"], "goal");
      return {
        id: identifier(r.id, "goal.id"),
        title: text(r.title, "goal.title"),
        ...(optionalText(r.description, "goal.description") === undefined ? {} : { description: optionalText(r.description, "goal.description")! }),
        status: enumValue(r.status, ["active", "completed", "abandoned"] as const, "goal.status"),
        createdByActorId: identifier(r.createdByActorId, "goal.createdByActorId"),
        createdByActorType: actorType(r.createdByActorType, "goal.createdByActorType"),
        ...(optionalIdentifier(r.agentSessionId, "goal.agentSessionId") === undefined ? {} : { agentSessionId: optionalIdentifier(r.agentSessionId, "goal.agentSessionId")! }),
        createdAt: timestamp(r.createdAt, "goal.createdAt"),
        updatedAt: timestamp(r.updatedAt, "goal.updatedAt"),
      };
    }),
    tasks: parseRows(root.tasks, "tasks", (row) => {
      const r = exact(row, ["id", "title", "description", "status", "assigneeActorId", "assigneeActorType", "createdByActorId", "createdByActorType", "agentSessionId", "createdAt", "updatedAt"], "task");
      return {
        id: identifier(r.id, "task.id"),
        title: text(r.title, "task.title"),
        ...(optionalText(r.description, "task.description") === undefined ? {} : { description: optionalText(r.description, "task.description")! }),
        status: enumValue(r.status, ["open", "in_progress", "blocked", "completed"] as const, "task.status"),
        ...(optionalIdentifier(r.assigneeActorId, "task.assigneeActorId") === undefined ? {} : { assigneeActorId: optionalIdentifier(r.assigneeActorId, "task.assigneeActorId")! }),
        ...(r.assigneeActorType === undefined || r.assigneeActorType === null ? {} : { assigneeActorType: actorType(r.assigneeActorType, "task.assigneeActorType") }),
        createdByActorId: identifier(r.createdByActorId, "task.createdByActorId"),
        createdByActorType: actorType(r.createdByActorType, "task.createdByActorType"),
        ...(optionalIdentifier(r.agentSessionId, "task.agentSessionId") === undefined ? {} : { agentSessionId: optionalIdentifier(r.agentSessionId, "task.agentSessionId")! }),
        createdAt: timestamp(r.createdAt, "task.createdAt"),
        updatedAt: timestamp(r.updatedAt, "task.updatedAt"),
      };
    }),
    findings: parseRows(root.findings, "findings", (row) => {
      const r = exact(row, ["id", "summary", "detail", "confidence", "sourceArtifactId", "currentness", "predecessorId", "successorId", "correctionReason", "correctedByActorId", "correctedByActorType", "correctedSessionId", "correctedAt", "createdByActorId", "createdByActorType", "agentSessionId", "createdAt"], "finding");
      return {
        id: identifier(r.id, "finding.id"),
        summary: text(r.summary, "finding.summary"),
        ...(optionalText(r.detail, "finding.detail") === undefined ? {} : { detail: optionalText(r.detail, "finding.detail")! }),
        ...(r.confidence === undefined || r.confidence === null ? {} : { confidence: finiteNumber(r.confidence, "finding.confidence") }),
        ...(optionalIdentifier(r.sourceArtifactId, "finding.sourceArtifactId") === undefined ? {} : { sourceArtifactId: optionalIdentifier(r.sourceArtifactId, "finding.sourceArtifactId")! }),
        currentness: enumValue(r.currentness, ["current", "superseded", "withdrawn"] as const, "finding.currentness"),
        ...(optionalIdentifier(r.predecessorId, "finding.predecessorId") === undefined ? {} : { predecessorId: optionalIdentifier(r.predecessorId, "finding.predecessorId")! }),
        ...(optionalIdentifier(r.successorId, "finding.successorId") === undefined ? {} : { successorId: optionalIdentifier(r.successorId, "finding.successorId")! }),
        ...(optionalText(r.correctionReason, "finding.correctionReason") === undefined ? {} : { correctionReason: optionalText(r.correctionReason, "finding.correctionReason")! }),
        ...(optionalIdentifier(r.correctedByActorId, "finding.correctedByActorId") === undefined ? {} : { correctedByActorId: optionalIdentifier(r.correctedByActorId, "finding.correctedByActorId")! }),
        ...(r.correctedByActorType === undefined || r.correctedByActorType === null ? {} : { correctedByActorType: actorType(r.correctedByActorType, "finding.correctedByActorType") }),
        ...(optionalIdentifier(r.correctedSessionId, "finding.correctedSessionId") === undefined ? {} : { correctedSessionId: optionalIdentifier(r.correctedSessionId, "finding.correctedSessionId")! }),
        ...(optionalTimestamp(r.correctedAt, "finding.correctedAt") === undefined ? {} : { correctedAt: optionalTimestamp(r.correctedAt, "finding.correctedAt")! }),
        createdByActorId: identifier(r.createdByActorId, "finding.createdByActorId"),
        createdByActorType: actorType(r.createdByActorType, "finding.createdByActorType"),
        ...(optionalIdentifier(r.agentSessionId, "finding.agentSessionId") === undefined ? {} : { agentSessionId: optionalIdentifier(r.agentSessionId, "finding.agentSessionId")! }),
        createdAt: timestamp(r.createdAt, "finding.createdAt"),
      };
    }),
    decisions: parseRows(root.decisions, "decisions", (row) => {
      const r = exact(row, ["id", "summary", "rationale", "status", "approvedByActorId", "approvedByActorType", "predecessorId", "successorId", "supersedeReason", "supersededByActorId", "supersededByActorType", "supersededSessionId", "supersededAt", "createdByActorId", "createdByActorType", "agentSessionId", "createdAt", "updatedAt"], "decision");
      return {
        id: identifier(r.id, "decision.id"),
        summary: text(r.summary, "decision.summary"),
        ...(optionalText(r.rationale, "decision.rationale") === undefined ? {} : { rationale: optionalText(r.rationale, "decision.rationale")! }),
        status: enumValue(r.status, ["proposed", "accepted", "superseded"] as const, "decision.status"),
        ...(optionalIdentifier(r.approvedByActorId, "decision.approvedByActorId") === undefined ? {} : { approvedByActorId: optionalIdentifier(r.approvedByActorId, "decision.approvedByActorId")! }),
        ...(r.approvedByActorType === undefined || r.approvedByActorType === null ? {} : { approvedByActorType: actorType(r.approvedByActorType, "decision.approvedByActorType") }),
        ...(optionalIdentifier(r.predecessorId, "decision.predecessorId") === undefined ? {} : { predecessorId: optionalIdentifier(r.predecessorId, "decision.predecessorId")! }),
        ...(optionalIdentifier(r.successorId, "decision.successorId") === undefined ? {} : { successorId: optionalIdentifier(r.successorId, "decision.successorId")! }),
        ...(optionalText(r.supersedeReason, "decision.supersedeReason") === undefined ? {} : { supersedeReason: optionalText(r.supersedeReason, "decision.supersedeReason")! }),
        ...(optionalIdentifier(r.supersededByActorId, "decision.supersededByActorId") === undefined ? {} : { supersededByActorId: optionalIdentifier(r.supersededByActorId, "decision.supersededByActorId")! }),
        ...(r.supersededByActorType === undefined || r.supersededByActorType === null ? {} : { supersededByActorType: actorType(r.supersededByActorType, "decision.supersededByActorType") }),
        ...(optionalIdentifier(r.supersededSessionId, "decision.supersededSessionId") === undefined ? {} : { supersededSessionId: optionalIdentifier(r.supersededSessionId, "decision.supersededSessionId")! }),
        ...(optionalTimestamp(r.supersededAt, "decision.supersededAt") === undefined ? {} : { supersededAt: optionalTimestamp(r.supersededAt, "decision.supersededAt")! }),
        createdByActorId: identifier(r.createdByActorId, "decision.createdByActorId"),
        createdByActorType: actorType(r.createdByActorType, "decision.createdByActorType"),
        ...(optionalIdentifier(r.agentSessionId, "decision.agentSessionId") === undefined ? {} : { agentSessionId: optionalIdentifier(r.agentSessionId, "decision.agentSessionId")! }),
        createdAt: timestamp(r.createdAt, "decision.createdAt"),
        updatedAt: timestamp(r.updatedAt, "decision.updatedAt"),
      };
    }),
    artifacts: parseRows(root.artifacts, "artifacts", (row) => {
      const r = exact(row, ["id", "type", "title", "uriOrPath", "metadata", "createdByActorId", "createdByActorType", "agentSessionId", "createdAt"], "artifact");
      const uri = text(r.uriOrPath, "artifact.uriOrPath", 2048);
      if (!/^https?:\/\//i.test(uri)) {
        fail("Artifact references must be HTTP(S) URLs at the publication boundary", "artifact.uriOrPath", "remove_unsupported_state");
      }
      let parsedUri: URL;
      try { parsedUri = new URL(uri); } catch { fail("Invalid artifact URL", "artifact.uriOrPath"); }
      if (parsedUri.username.length > 0 || parsedUri.password.length > 0) {
        fail("Artifact URL must not carry userinfo credentials", "artifact.uriOrPath", "remove_unsupported_state");
      }
      for (const [key, value] of parsedUri.searchParams) {
        if (URL_SECRET_KEY_RE.test(key) || SECRET_VALUE_RE.test(value)) {
          fail("Artifact URL must not carry credentials", "artifact.uriOrPath", "remove_unsupported_state");
        }
      }
      if (parsedUri.hash.length > 1 &&
          (FORBIDDEN_CREDENTIAL_TEXT_RE.test(parsedUri.hash) || hasCredentialBearingQuery(parsedUri.hash) ||
           FORBIDDEN_URL_USERINFO_RE.test(parsedUri.hash))) {
        fail("Artifact URL fragment must not carry credentials", "artifact.uriOrPath", "remove_unsupported_state");
      }
      return {
        id: identifier(r.id, "artifact.id"),
        type: enumValue(r.type, ["file", "pull_request", "commit", "log", "trace", "document", "deployment", "screenshot", "report", "other"] as const, "artifact.type"),
        title: text(r.title, "artifact.title", 500),
        uriOrPath: uri,
        ...(auxiliary(r.metadata, "artifact.metadata") === undefined ? {} : { metadata: auxiliary(r.metadata, "artifact.metadata")! }),
        createdByActorId: identifier(r.createdByActorId, "artifact.createdByActorId"),
        createdByActorType: actorType(r.createdByActorType, "artifact.createdByActorType"),
        ...(optionalIdentifier(r.agentSessionId, "artifact.agentSessionId") === undefined ? {} : { agentSessionId: optionalIdentifier(r.agentSessionId, "artifact.agentSessionId")! }),
        createdAt: timestamp(r.createdAt, "artifact.createdAt"),
      };
    }),
    findingTransitions: parseRows(root.findingTransitions, "findingTransitions", (row) => {
      const r = exact(row, ["findingId", "successorId", "kind", "reason", "actorId", "actorType", "agentSessionId", "createdAt"], "findingTransition");
      return {
        findingId: identifier(r.findingId, "findingTransition.findingId"),
        ...(optionalIdentifier(r.successorId, "findingTransition.successorId") === undefined ? {} : { successorId: optionalIdentifier(r.successorId, "findingTransition.successorId")! }),
        kind: enumValue(r.kind, ["superseded", "withdrawn"] as const, "findingTransition.kind"),
        reason: text(r.reason, "findingTransition.reason"),
        actorId: identifier(r.actorId, "findingTransition.actorId"),
        actorType: actorType(r.actorType, "findingTransition.actorType"),
        ...(optionalIdentifier(r.agentSessionId, "findingTransition.agentSessionId") === undefined ? {} : { agentSessionId: optionalIdentifier(r.agentSessionId, "findingTransition.agentSessionId")! }),
        createdAt: timestamp(r.createdAt, "findingTransition.createdAt"),
      };
    }),
    decisionTransitions: parseRows(root.decisionTransitions, "decisionTransitions", (row) => {
      const r = exact(row, ["decisionId", "successorId", "kind", "reason", "actorId", "actorType", "agentSessionId", "createdAt"], "decisionTransition");
      return {
        decisionId: identifier(r.decisionId, "decisionTransition.decisionId"),
        ...(optionalIdentifier(r.successorId, "decisionTransition.successorId") === undefined ? {} : { successorId: optionalIdentifier(r.successorId, "decisionTransition.successorId")! }),
        kind: enumValue(r.kind, ["superseded", "rejected"] as const, "decisionTransition.kind"),
        reason: text(r.reason, "decisionTransition.reason"),
        actorId: identifier(r.actorId, "decisionTransition.actorId"),
        actorType: actorType(r.actorType, "decisionTransition.actorType"),
        ...(optionalIdentifier(r.agentSessionId, "decisionTransition.agentSessionId") === undefined ? {} : { agentSessionId: optionalIdentifier(r.agentSessionId, "decisionTransition.agentSessionId")! }),
        createdAt: timestamp(r.createdAt, "decisionTransition.createdAt"),
      };
    }),
    findingEvidence: parseRows(root.findingEvidence, "findingEvidence", (row) => {
      const r = exact(row, ["id", "findingId", "artifactId", "relation", "note", "actorId", "actorType", "agentSessionId", "createdAt"], "findingEvidence");
      return {
        id: identifier(r.id, "findingEvidence.id"),
        findingId: identifier(r.findingId, "findingEvidence.findingId"),
        artifactId: identifier(r.artifactId, "findingEvidence.artifactId"),
        relation: enumValue(r.relation, ["supports", "contradicts"] as const, "findingEvidence.relation"),
        ...(optionalText(r.note, "findingEvidence.note") === undefined ? {} : { note: optionalText(r.note, "findingEvidence.note")! }),
        actorId: identifier(r.actorId, "findingEvidence.actorId"),
        actorType: actorType(r.actorType, "findingEvidence.actorType"),
        ...(optionalIdentifier(r.agentSessionId, "findingEvidence.agentSessionId") === undefined ? {} : { agentSessionId: optionalIdentifier(r.agentSessionId, "findingEvidence.agentSessionId")! }),
        createdAt: timestamp(r.createdAt, "findingEvidence.createdAt"),
      };
    }),
    decisionCitations: parseRows(root.decisionCitations, "decisionCitations", (row) => {
      const r = exact(row, ["id", "decisionId", "findingId", "note", "actorId", "actorType", "agentSessionId", "createdAt"], "decisionCitation");
      return {
        id: identifier(r.id, "decisionCitation.id"),
        decisionId: identifier(r.decisionId, "decisionCitation.decisionId"),
        findingId: identifier(r.findingId, "decisionCitation.findingId"),
        ...(optionalText(r.note, "decisionCitation.note") === undefined ? {} : { note: optionalText(r.note, "decisionCitation.note")! }),
        actorId: identifier(r.actorId, "decisionCitation.actorId"),
        actorType: actorType(r.actorType, "decisionCitation.actorType"),
        ...(optionalIdentifier(r.agentSessionId, "decisionCitation.agentSessionId") === undefined ? {} : { agentSessionId: optionalIdentifier(r.agentSessionId, "decisionCitation.agentSessionId")! }),
        createdAt: timestamp(r.createdAt, "decisionCitation.createdAt"),
      };
    }),
    contributions: parseRows(root.contributions, "contributions", (row) => {
      const r = exact(row, ["id", "actorId", "actorType", "agentSessionId", "action", "objectType", "objectId", "payload", "appendPosition", "createdAt"], "contribution");
      return {
        id: identifier(r.id, "contribution.id"),
        actorId: identifier(r.actorId, "contribution.actorId"),
        actorType: actorType(r.actorType, "contribution.actorType"),
        ...(optionalIdentifier(r.agentSessionId, "contribution.agentSessionId") === undefined ? {} : { agentSessionId: optionalIdentifier(r.agentSessionId, "contribution.agentSessionId")! }),
        action: enumValue(r.action, ["create", "update", "join", "register_session", "read"] as const, "contribution.action"),
        objectType: enumValue(r.objectType, ["workspace", "goal", "task", "finding", "decision", "artifact", "participant", "agent_session", "invite", "enrollment_invitation"] as const, "contribution.objectType"),
        objectId: identifier(r.objectId, "contribution.objectId"),
        ...(auxiliary(r.payload, "contribution.payload") === undefined ? {} : { payload: auxiliary(r.payload, "contribution.payload")! }),
        appendPosition: integer(r.appendPosition, "contribution.appendPosition", 1),
        createdAt: timestamp(r.createdAt, "contribution.createdAt"),
      };
    }),
    counts: {
      humans: integer(counts.humans, "counts.humans"),
      agents: integer(counts.agents, "counts.agents"),
      participants: integer(counts.participants, "counts.participants"),
      sessions: integer(counts.sessions, "counts.sessions"),
      goals: integer(counts.goals, "counts.goals"),
      tasks: integer(counts.tasks, "counts.tasks"),
      findings: integer(counts.findings, "counts.findings"),
      decisions: integer(counts.decisions, "counts.decisions"),
      artifacts: integer(counts.artifacts, "counts.artifacts"),
      findingTransitions: integer(counts.findingTransitions, "counts.findingTransitions"),
      decisionTransitions: integer(counts.decisionTransitions, "counts.decisionTransitions"),
      findingEvidence: integer(counts.findingEvidence, "counts.findingEvidence"),
      decisionCitations: integer(counts.decisionCitations, "counts.decisionCitations"),
      contributions: integer(counts.contributions, "counts.contributions"),
      contributionTip: integer(counts.contributionTip, "counts.contributionTip"),
    },
    digest: typeof root.digest === "string" && DIGEST_RE.test(root.digest) ? root.digest : fail("Invalid snapshot digest", "digest"),
  };

  assertPublicationSnapshotConsistent(snapshot);
  return snapshot;
}

export function snapshotCounts(snapshot: Omit<PublicationSnapshot, "counts" | "digest">): PublicationCounts {
  return {
    humans: snapshot.humans.length,
    agents: snapshot.agents.length,
    participants: snapshot.participants.length,
    sessions: snapshot.sessions.length,
    goals: snapshot.goals.length,
    tasks: snapshot.tasks.length,
    findings: snapshot.findings.length,
    decisions: snapshot.decisions.length,
    artifacts: snapshot.artifacts.length,
    findingTransitions: snapshot.findingTransitions.length,
    decisionTransitions: snapshot.decisionTransitions.length,
    findingEvidence: snapshot.findingEvidence.length,
    decisionCitations: snapshot.decisionCitations.length,
    contributions: snapshot.contributions.length,
    contributionTip: snapshot.contributions.reduce((max, row) => Math.max(max, row.appendPosition), 0),
  };
}

/**
 * Shared validation used by the exporter and the Worker. It runs before any
 * write and fails closed on a malformed graph, duplicate id, missing edge,
 * non-contiguous provenance, or a size above the single-batch budget.
 */
export function assertPublicationSnapshotConsistent(snapshot: PublicationSnapshot): void {
  const rows = snapshot.humans.length + snapshot.agents.length + snapshot.participants.length +
    snapshot.sessions.length + snapshot.goals.length + snapshot.tasks.length +
    snapshot.findings.length + snapshot.decisions.length + snapshot.artifacts.length +
    snapshot.findingTransitions.length + snapshot.decisionTransitions.length +
    snapshot.findingEvidence.length + snapshot.decisionCitations.length + snapshot.contributions.length;
  if (rows > PUBLICATION_LIMITS.maxRows) fail("Snapshot row limit exceeded", "snapshot.rows", "reduce_workspace_scope");
  if (snapshot.contributions.length > PUBLICATION_LIMITS.maxContributions) fail("Contribution limit exceeded", "snapshot.contributions", "reduce_workspace_scope");
  if (snapshot.workspace.id !== snapshot.workspaceId) fail("Workspace id mismatch", "workspace.id");
  if (snapshot.workspace.id !== snapshot.source.localWorkspaceName && snapshot.workspace.name !== snapshot.source.localWorkspaceName) {
    // Name is advisory metadata; only the id is authoritative.
  }
  const expected = snapshotCounts(snapshot);
  for (const key of Object.keys(expected) as Array<keyof PublicationCounts>) {
    if (snapshot.counts[key] !== expected[key]) fail(`Snapshot count mismatch: ${key}`, `counts.${key}`);
  }
  if (snapshot.source.contributionTip !== expected.contributionTip) fail("Source tip does not match contribution positions", "source.contributionTip");

  const humanIds = new Set(snapshot.humans.map((human) => human.id));
  const agentIds = new Set(snapshot.agents.map((agent) => agent.id));
  const sessionIds = new Set(snapshot.sessions.map((session) => session.id));
  const goalIds = new Set(snapshot.goals.map((goal) => goal.id));
  const taskIds = new Set(snapshot.tasks.map((task) => task.id));
  const findingIds = new Set(snapshot.findings.map((finding) => finding.id));
  const decisionIds = new Set(snapshot.decisions.map((decision) => decision.id));
  const artifactIds = new Set(snapshot.artifacts.map((artifact) => artifact.id));
  const contributionIds = new Set(snapshot.contributions.map((contribution) => contribution.id));
  const evidenceIds = new Set(snapshot.findingEvidence.map((evidence) => evidence.id));
  const citationIds = new Set(snapshot.decisionCitations.map((citation) => citation.id));

  if (!humanIds.has(snapshot.owner.humanId)) fail("Owner is not in the imported human set", "owner.humanId");
  const ownerParticipant = snapshot.participants.find((participant) => participant.actorId === snapshot.owner.humanId && participant.actorType === "human");
  if (ownerParticipant?.role !== "owner") fail("Owner must be the workspace owner participant", "participants", "publish_as_owner");
  const workspaceCreator = snapshot.workspace.createdByActorType === "human" ? humanIds : agentIds;
  if (!workspaceCreator.has(snapshot.workspace.createdByActorId)) fail("Workspace creator is missing", "workspace.createdByActorId");

  const assertActor = (id: string, type: "human" | "agent", field: string): void => {
    const found = type === "human" ? humanIds.has(id) : agentIds.has(id);
    if (!found) fail(`Missing actor ${id} in ${field}`, field);
  };
  const assertActorPair = (id: string | undefined, type: "human" | "agent" | undefined, field: string): void => {
    if ((id === undefined) !== (type === undefined)) fail(`Actor id and type must appear together in ${field}`, field);
    if (id !== undefined && type !== undefined) assertActor(id, type, field);
  };
  const assertSession = (id: string | undefined, field: string): void => {
    if (id !== undefined && !sessionIds.has(id)) fail(`Missing session ${id} in ${field}`, field);
  };

  for (const agent of snapshot.agents) if (agent.humanId !== undefined && !humanIds.has(agent.humanId)) fail("Agent owner is missing", "agents");
  for (const participant of snapshot.participants) assertActor(participant.actorId, participant.actorType, "participants");
  for (const session of snapshot.sessions) {
    if (!agentIds.has(session.agentId) || !humanIds.has(session.humanId)) fail("Session actor is missing", "sessions");
    if (session.taskId !== undefined && !taskIds.has(session.taskId)) fail("Session task is missing", "sessions.taskId");
  }
  for (const row of snapshot.goals) { assertActor(row.createdByActorId, row.createdByActorType, "goals"); assertSession(row.agentSessionId, "goals"); }
  for (const row of snapshot.tasks) {
    assertActor(row.createdByActorId, row.createdByActorType, "tasks");
    assertActorPair(row.assigneeActorId, row.assigneeActorType, "tasks.assignee");
    assertSession(row.agentSessionId, "tasks");
  }
  for (const row of snapshot.findings) {
    assertActor(row.createdByActorId, row.createdByActorType, "findings");
    if (row.sourceArtifactId !== undefined && !artifactIds.has(row.sourceArtifactId)) fail("Finding source artifact is missing", "findings.sourceArtifactId");
    if (row.predecessorId !== undefined && !findingIds.has(row.predecessorId)) fail("Finding predecessor is missing", "findings.predecessorId");
    if (row.successorId !== undefined && !findingIds.has(row.successorId)) fail("Finding successor is missing", "findings.successorId");
    assertActorPair(row.correctedByActorId, row.correctedByActorType, "findings.correctedBy");
    assertSession(row.agentSessionId, "findings");
    assertSession(row.correctedSessionId, "findings.correctedSessionId");
  }
  for (const row of snapshot.decisions) {
    assertActor(row.createdByActorId, row.createdByActorType, "decisions");
    assertActorPair(row.approvedByActorId, row.approvedByActorType, "decisions.approvedBy");
    if (row.predecessorId !== undefined && !decisionIds.has(row.predecessorId)) fail("Decision predecessor is missing", "decisions.predecessorId");
    if (row.successorId !== undefined && !decisionIds.has(row.successorId)) fail("Decision successor is missing", "decisions.successorId");
    assertActorPair(row.supersededByActorId, row.supersededByActorType, "decisions.supersededBy");
    assertSession(row.agentSessionId, "decisions");
    assertSession(row.supersededSessionId, "decisions.supersededSessionId");
  }
  for (const row of snapshot.artifacts) { assertActor(row.createdByActorId, row.createdByActorType, "artifacts"); assertSession(row.agentSessionId, "artifacts"); }
  const findingTransitionIds = new Set(snapshot.findingTransitions.map((row) => row.findingId));
  const decisionTransitionIds = new Set(snapshot.decisionTransitions.map((row) => row.decisionId));
  for (const row of snapshot.findings) {
    if (row.currentness !== "current" && !findingTransitionIds.has(row.id) &&
        row.predecessorId === undefined && row.successorId === undefined) {
      fail("Non-current finding has no recorded transition", "findings.currentness");
    }
  }
  for (const row of snapshot.decisions) {
    if (row.status === "superseded" && !decisionTransitionIds.has(row.id) &&
        row.predecessorId === undefined && row.successorId === undefined) {
      fail("Superseded decision has no recorded transition", "decisions.status");
    }
  }
  for (const row of snapshot.findingTransitions) {
    if (!findingIds.has(row.findingId) || row.successorId !== undefined && !findingIds.has(row.successorId)) fail("Finding transition references a missing finding", "findingTransitions");
    assertActor(row.actorId, row.actorType, "findingTransitions");
    assertSession(row.agentSessionId, "findingTransitions");
  }
  for (const row of snapshot.decisionTransitions) {
    if (!decisionIds.has(row.decisionId) || row.successorId !== undefined && !decisionIds.has(row.successorId)) fail("Decision transition references a missing decision", "decisionTransitions");
    assertActor(row.actorId, row.actorType, "decisionTransitions");
    assertSession(row.agentSessionId, "decisionTransitions");
  }
  for (const row of snapshot.findingEvidence) {
    if (!findingIds.has(row.findingId) || !artifactIds.has(row.artifactId)) fail("Evidence references a missing object", "findingEvidence");
    assertActor(row.actorId, row.actorType, "findingEvidence");
    assertSession(row.agentSessionId, "findingEvidence");
  }
  for (const row of snapshot.decisionCitations) {
    if (!decisionIds.has(row.decisionId) || !findingIds.has(row.findingId)) fail("Citation references a missing object", "decisionCitations");
    assertActor(row.actorId, row.actorType, "decisionCitations");
    assertSession(row.agentSessionId, "decisionCitations");
  }
  for (const row of snapshot.contributions) {
    assertActor(row.actorId, row.actorType, "contributions");
    assertSession(row.agentSessionId, "contributions");
    if (goalIds.size === 0 && taskIds.size === 0 && findingIds.size === 0 && decisionIds.size === 0 && artifactIds.size === 0) {
      // A workspace with only participants/workspace contributions is valid.
    }
  }

  const ordered = [...snapshot.contributions].sort((a, b) => a.appendPosition - b.appendPosition);
  for (let index = 0; index < ordered.length; index += 1) {
    if (ordered[index]!.appendPosition !== index + 1) fail("Contribution append positions must be contiguous from 1", "contributions.appendPosition");
  }
  if (contributionIds.size !== snapshot.contributions.length ||
      humanIds.size !== snapshot.humans.length || agentIds.size !== snapshot.agents.length ||
      sessionIds.size !== snapshot.sessions.length || goalIds.size !== snapshot.goals.length ||
      taskIds.size !== snapshot.tasks.length || findingIds.size !== snapshot.findings.length ||
      decisionIds.size !== snapshot.decisions.length || artifactIds.size !== snapshot.artifacts.length ||
      evidenceIds.size !== snapshot.findingEvidence.length || citationIds.size !== snapshot.decisionCitations.length) {
    fail("Snapshot contains duplicate ids", "snapshot.ids");
  }
  const bytes = new TextEncoder().encode(canonicalJson(snapshot)).byteLength;
  if (bytes > PUBLICATION_LIMITS.maxSnapshotBytes + 8192) {
    fail("Snapshot exceeds the single-batch size limit", "snapshot.size", "reduce_workspace_scope");
  }
  if (snapshot.format !== PUBLICATION_FORMAT) fail("Invalid snapshot format", "format");
  if (!DIGEST_RE.test(snapshot.digest)) fail("Invalid snapshot digest", "digest");
  assertNoForbiddenFreeText(snapshot, "snapshot");
}

/** Stable JSON: object keys sorted recursively, array order preserved. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isRecord(value)) return value;
  // Null prototype plus defineProperty avoids the __proto__ setter. Auxiliary
  // objects already reject that key; this is defense in depth for the digest.
  const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(value).sort()) {
    const entry = value[key];
    if (entry !== undefined) {
      Object.defineProperty(out, key, { value: canonicalValue(entry), enumerable: true, configurable: true, writable: true });
    }
  }
  return out;
}

export function snapshotDigestInput(snapshot: PublicationSnapshot): unknown {
  const { digest: _digest, ...rest } = snapshot;
  // Export time is local metadata, not workspace content. Excluding it makes
  // a second read at the same append tip produce the same digest, which is
  // what the cutover re-check needs.
  const { exportedAt: _exportedAt, ...source } = rest.source;
  return { ...rest, source };
}

export function hasValidTokenHash(value: unknown): value is string {
  return typeof value === "string" && TOKEN_HASH_RE.test(value);
}

export function validateEnrollmentInput(value: unknown): PublicationEnrollmentInput {
  const input = exact(value, ["requestId", "humanId", "humanName", "humanTokenHash", "recoveryHash", "agents", "workspaceName", "sourceWorkspaceId", "sourcePackageVersion", "sourceSchemaVersion", "deviceKeyHash"], "enrollment");
  const agents = parseRows(input.agents, "agents", (row) => {
    const r = exact(row, ["id", "name", "harness", "tokenHash"], "agent");
    return {
      id: identifier(r.id, "agent.id"),
      name: text(r.name, "agent.name", 200),
      harness: enumValue(r.harness, PUBLICATION_HARNESSES, "agent.harness"),
      tokenHash: hasValidTokenHash(r.tokenHash) ? r.tokenHash : fail("Invalid agent token hash", "agent.tokenHash"),
    };
  });
  if (agents.length > PUBLICATION_LIMITS.maxAgents) fail("Too many agents", "agents");
  if (new Set(agents.map((agent) => agent.id)).size !== agents.length) fail("Agent ids must be distinct", "agents");
  if (new Set(agents.map((agent) => agent.harness)).size !== agents.length) fail("Only one agent per harness may enroll here", "agents");
  if (!hasValidTokenHash(input.humanTokenHash)) fail("Invalid human token hash", "humanTokenHash");
  if (new Set([input.humanTokenHash, ...agents.map((agent) => agent.tokenHash)]).size !== agents.length + 1) {
    fail("Enrollment credentials must be distinct", "agents");
  }
  return {
    requestId: identifier(input.requestId, "requestId"),
    humanId: identifier(input.humanId, "humanId"),
    humanName: text(input.humanName, "humanName", 200),
    humanTokenHash: input.humanTokenHash,
    recoveryHash: hasValidTokenHash(input.recoveryHash) ? input.recoveryHash : fail("Invalid recovery hash", "recoveryHash"),
    agents,
    workspaceName: text(input.workspaceName, "workspaceName", 200),
    sourceWorkspaceId: identifier(input.sourceWorkspaceId, "sourceWorkspaceId"),
    sourcePackageVersion: text(input.sourcePackageVersion, "sourcePackageVersion", 64),
    sourceSchemaVersion: (() => {
      return acceptedSourceSchemaVersion(integer(input.sourceSchemaVersion, "sourceSchemaVersion"), "sourceSchemaVersion");
    })(),
    deviceKeyHash: hasValidTokenHash(input.deviceKeyHash) ? input.deviceKeyHash : fail("Invalid device key hash", "deviceKeyHash"),
  };
}

export function validateRecoveryInput(value: unknown): PublicationRecoveryInput {
  const input = exact(value, ["requestId", "humanId", "recoverySecret", "humanTokenHash", "newRecoveryHash"], "recovery");
  if (typeof input.recoverySecret !== "string" || !/^cfr_[a-f0-9]{32}$/.test(input.recoverySecret)) {
    fail("Invalid recovery secret", "recoverySecret");
  }
  if (!hasValidTokenHash(input.humanTokenHash)) fail("Invalid human token hash", "humanTokenHash");
  if (!hasValidTokenHash(input.newRecoveryHash)) fail("Invalid replacement recovery hash", "newRecoveryHash");
  return {
    requestId: identifier(input.requestId, "requestId"),
    humanId: identifier(input.humanId, "humanId"),
    recoverySecret: input.recoverySecret,
    humanTokenHash: input.humanTokenHash,
    newRecoveryHash: input.newRecoveryHash,
  };
}

export function validateImportInput(value: unknown): PublicationImportInput {
  const input = exact(value, ["requestId", "digest", "snapshot"], "import");
  if (typeof input.digest !== "string" || !DIGEST_RE.test(input.digest)) fail("Invalid import digest", "digest");
  const snapshot = parsePublicationSnapshot(input.snapshot);
  if (snapshot.digest !== input.digest) fail("Import digest does not match the snapshot", "digest", "recompute_snapshot");
  return { requestId: identifier(input.requestId, "requestId"), digest: input.digest, snapshot };
}

export function assertPublicationReceiptState(value: unknown): PublicationReceipt {
  const receipt = exact(value, ["version", "kind", "publicationId", "state", "endpoint", "workspaceId", "workspaceName", "sourceDatabasePath", "sourcePackageVersion", "sourceSchemaVersion", "sourceTip", "snapshotDigest", "counts", "owner", "agents", "organizationId", "teamId", "importedAt", "verifiedAt", "cutOverAt", "nextAction"], "receipt");
  if (receipt.version !== 1 || receipt.kind !== "workspace_publication") fail("Unsupported publication receipt", "receipt");
  const owner = exact(receipt.owner, ["humanId", "displayName"], "receipt.owner");
  const agents = parseRows(receipt.agents, "receipt.agents", (row) => {
    const r = exact(row, ["id", "name", "harness"], "receipt.agent");
    return { id: identifier(r.id, "receipt.agent.id"), name: text(r.name, "receipt.agent.name", 200), harness: enumValue(r.harness, PUBLICATION_HARNESSES, "receipt.agent.harness") };
  });
  return {
    version: 1,
    kind: "workspace_publication",
    publicationId: identifier(receipt.publicationId, "receipt.publicationId"),
    state: enumValue(receipt.state, PUBLICATION_STATES, "receipt.state"),
    endpoint: text(receipt.endpoint, "receipt.endpoint", 2048),
    workspaceId: identifier(receipt.workspaceId, "receipt.workspaceId"),
    workspaceName: text(receipt.workspaceName, "receipt.workspaceName", 200),
    sourceDatabasePath: text(receipt.sourceDatabasePath, "receipt.sourceDatabasePath", 4096),
    sourcePackageVersion: text(receipt.sourcePackageVersion, "receipt.sourcePackageVersion", 64),
    sourceSchemaVersion: integer(receipt.sourceSchemaVersion, "receipt.sourceSchemaVersion"),
    sourceTip: integer(receipt.sourceTip, "receipt.sourceTip"),
    snapshotDigest: hasValidTokenHash(receipt.snapshotDigest) ? receipt.snapshotDigest : fail("Invalid receipt digest", "receipt.snapshotDigest"),
    counts: isRecord(receipt.counts) ? receipt.counts as unknown as PublicationCounts : {},
    owner: { humanId: identifier(owner.humanId, "receipt.owner.humanId"), displayName: text(owner.displayName, "receipt.owner.displayName", 200) },
    agents,
    ...(receipt.organizationId === undefined ? {} : { organizationId: identifier(receipt.organizationId, "receipt.organizationId") }),
    ...(receipt.teamId === undefined ? {} : { teamId: identifier(receipt.teamId, "receipt.teamId") }),
    ...(receipt.importedAt === undefined ? {} : { importedAt: timestamp(receipt.importedAt, "receipt.importedAt") }),
    ...(receipt.verifiedAt === undefined ? {} : { verifiedAt: timestamp(receipt.verifiedAt, "receipt.verifiedAt") }),
    ...(receipt.cutOverAt === undefined ? {} : { cutOverAt: timestamp(receipt.cutOverAt, "receipt.cutOverAt") }),
    nextAction: text(receipt.nextAction, "receipt.nextAction", 200),
  };
}
