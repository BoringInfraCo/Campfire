/**
 * Hosted publication boundary (SHR-001).
 *
 * - `POST /v1/publication/enroll` creates a fresh owner identity, private
 *   organization/team, and fresh token hashes. It never accepts a workspace.
 * - `POST /v1/publication/import` requires the new owner token and writes one
 *   complete workspace graph in one D1 batch.
 * - `POST /v1/publication/recover` replaces the owner credential only when the
 *   client proves possession of the recovery secret.
 *
 * Invitation secrets, install tokens, and local bearer tokens are different
 * authorities and cannot call these routes as owner credentials.
 */
import { Conflict, CampfireError, RateLimited, Unauthorized, ValidationError } from "../domain/errors.js";
import { createId, type IdSource } from "../domain/ids.js";
import {
  PUBLICATION_LIMITS,
  PUBLICATION_REHEARSAL_HEADER,
  canonicalJson,
  snapshotDigestInput,
  validateEnrollmentInput,
  validateImportInput,
  validateRecoveryInput,
  type PublicationCounts,
  type PublicationEnrollmentReceipt,
  type PublicationImportReceipt,
  type PublicationSnapshot,
} from "../domain/publication.js";
import { hashTokenWeb } from "./crypto.js";
import type { D1Database, D1PreparedStatement } from "./d1-types.js";
import type { AsyncCampfireService } from "./async-service.js";

export interface PublicationWorkerOptions {
  db: D1Database;
  enabled: boolean;
  clock?: () => string;
  idSource?: IdSource;
  maxEnrollmentsPerSourcePerDay?: number;
  /**
   * SHA-256 of the operator-held rehearsal admission code. When the alpha is
   * enabled, every publication write route requires the matching header. If
   * this is absent, the routes fail closed: an alpha flag alone must never open
   * anonymous enrollment.
   */
  rehearsalCodeHash?: string;
  maxAdmissionAttemptsPerHour?: number;
}

type Row = Record<string, unknown>;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function fail(status: number, code: string, message: string, details?: Record<string, unknown>): Response {
  return json(status, details === undefined ? { ok: false, error: code, message } : { ok: false, error: code, message, details });
}

function statusFor(error: CampfireError): number {
  switch (error.code) {
    case "RateLimited": return 429;
    case "Conflict": return 409;
    case "Unauthorized": return 403;
    case "ActorNotFound": return 404;
    default: return 400;
  }
}

async function readJson(request: Request, maxBytes: number): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const length = request.headers.get("content-length");
  if (length !== null && Number(length) > maxBytes) return { ok: false, response: fail(413, "ValidationError", "Publication request body too large") };
  const reader = request.body?.getReader();
  if (reader === undefined) return { ok: true, value: {} };
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const item = await reader.read();
    if (item.done === true) break;
    if (item.value === undefined) continue;
    total += item.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, response: fail(413, "ValidationError", "Publication request body too large") };
    }
    chunks.push(item.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const raw = new TextDecoder().decode(bytes);
    return { ok: true, value: raw.trim().length === 0 ? {} : JSON.parse(raw) };
  } catch {
    return { ok: false, response: fail(400, "ValidationError", "Publication request body must be JSON") };
  }
}

function now(options: PublicationWorkerOptions): string {
  return (options.clock ?? (() => new Date().toISOString()))();
}

async function sourceHash(request: Request): Promise<string> {
  // CF-Connecting-IP is set by Cloudflare. Do not trust a client-controllable
  // fallback: an absent header is one opaque bucket, not a bypass.
  const source = request.headers.get("cf-connecting-ip") ?? "unattributed";
  return hashTokenWeb(`publication-source:${source}`);
}

function hourBucket(at: string): string {
  const ms = Date.parse(at);
  return new Date(Math.floor(ms / 3_600_000) * 3_600_000).toISOString();
}

async function recordAdmissionAttempt(options: PublicationWorkerOptions, source: string, at: string): Promise<void> {
  const windowStart = hourBucket(at);
  const limit = options.maxAdmissionAttemptsPerHour ?? 30;
  const row = await options.db.prepare(
    `INSERT INTO publication_admission_attempts (source_hash, window_start, attempts, updated_at)
     VALUES (?, ?, 1, ?)
     ON CONFLICT(source_hash, window_start)
     DO UPDATE SET attempts = attempts + 1, updated_at = excluded.updated_at
     RETURNING attempts`,
  ).bind(source, windowStart, at).first<{ attempts: number }>();
  if (Number(row?.attempts ?? 0) > limit) {
    throw new RateLimited("Hosted publication admission is temporarily rate limited", { nextAction: "retry_later" });
  }
}

async function assertRehearsalAdmission(options: PublicationWorkerOptions, request: Request, at: string): Promise<Response | undefined> {
  if (!options.enabled) return fail(403, "Unauthorized", "Hosted publication enrollment is not enabled");
  if (options.rehearsalCodeHash === undefined || !/^[0-9a-f]{64}$/.test(options.rehearsalCodeHash)) {
    // Fail closed. A deployment must configure the hash before opening the
    // alpha; the global flag is not an admission system.
    return fail(403, "Unauthorized", "Hosted publication admission is not configured");
  }
  const source = await sourceHash(request);
  const countFailure = async (): Promise<Response | undefined> => {
    try {
      await recordAdmissionAttempt(options, source, at);
      return undefined;
    } catch (error) {
      if (error instanceof CampfireError) return fail(statusFor(error), error.code, error.message, error.details);
      throw error;
    }
  };
  const supplied = request.headers.get(PUBLICATION_REHEARSAL_HEADER)?.trim();
  if (supplied === undefined || supplied.length === 0) {
    return (await countFailure()) ?? fail(403, "Unauthorized", "A rehearsal admission code is required");
  }
  const actual = await hashTokenWeb(supplied);
  if (actual !== options.rehearsalCodeHash) {
    return (await countFailure()) ?? fail(403, "Unauthorized", "The rehearsal admission code was rejected");
  }
  return undefined;
}

function id(options: PublicationWorkerOptions, kind: Parameters<IdSource>[0]): string {
  return createId(kind, options.idSource);
}

async function first<T extends Row>(db: D1Database, sql: string, ...params: unknown[]): Promise<T | undefined> {
  const row = await db.prepare(sql).bind(...params).first<T>();
  return row ?? undefined;
}

async function rateLimit(db: D1Database, source: string, limit: number, at: string): Promise<void> {
  const since = new Date(Date.parse(at) - 24 * 3_600_000).toISOString();
  const row = await first<{ count: number }>(db,
    "SELECT COUNT(*) AS count FROM publication_enrollments WHERE source_hash = ? AND created_at >= ?", source, since);
  if (Number(row?.count ?? 0) >= limit) {
    throw new RateLimited("Hosted publication enrollment is temporarily rate limited", { nextAction: "retry_later" });
  }
}

function enrollmentReceipt(row: Row): PublicationEnrollmentReceipt {
  return JSON.parse(String(row.receipt_json)) as PublicationEnrollmentReceipt;
}

function publicationReceipt(row: Row): PublicationImportReceipt {
  return JSON.parse(String(row.receipt_json)) as PublicationImportReceipt;
}

function ensureStrings(snapshot: PublicationSnapshot): void {
  const bytes = new TextEncoder().encode(canonicalJson(snapshot)).byteLength;
  if (bytes > PUBLICATION_LIMITS.maxSnapshotBytes) {
    throw new ValidationError("Snapshot exceeds the hosted single-batch limit", { field: "snapshot.size", nextAction: "reduce_workspace_scope" });
  }
}

function insertHuman(human: PublicationSnapshot["humans"][number], teamId: string, db: D1Database): D1PreparedStatement {
  return db.prepare(
    "INSERT INTO humans (id, team_id, display_name, external_identity, created_at) VALUES (?, ?, ?, ?, ?)",
  ).bind(human.id, teamId, human.displayName, human.externalIdentity ?? null, human.createdAt);
}

function insertAgent(agent: PublicationSnapshot["agents"][number], teamId: string, db: D1Database): D1PreparedStatement {
  return db.prepare(
    "INSERT INTO agents (id, team_id, human_id, name, harness, model, instance_metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)",
  ).bind(agent.id, teamId, agent.humanId ?? null, agent.name, agent.harness, agent.model ?? null, agent.createdAt);
}

function insertParticipant(participant: PublicationSnapshot["participants"][number], workspaceId: string, db: D1Database): D1PreparedStatement {
  return db.prepare(
    "INSERT INTO workspace_participants (workspace_id, actor_id, actor_type, role, joined_at) VALUES (?, ?, ?, ?, ?)",
  ).bind(workspaceId, participant.actorId, participant.actorType, participant.role, participant.joinedAt);
}

function insertSession(row: PublicationSnapshot["sessions"][number], workspaceId: string, db: D1Database): D1PreparedStatement {
  return db.prepare(
    "INSERT INTO agent_sessions (id, agent_id, human_id, workspace_id, harness, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).bind(row.id, row.agentId, row.humanId, workspaceId, row.harness, row.startedAt, row.endedAt ?? null);
}

function insertGoal(row: PublicationSnapshot["goals"][number], workspaceId: string, db: D1Database): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO goals (id, workspace_id, title, description, status, created_by_actor_id, created_by_actor_type, agent_session_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(row.id, workspaceId, row.title, row.description ?? null, row.status, row.createdByActorId, row.createdByActorType, row.agentSessionId ?? null, row.createdAt, row.updatedAt);
}

function insertTask(row: PublicationSnapshot["tasks"][number], workspaceId: string, db: D1Database): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO tasks (id, workspace_id, title, description, status, assignee_actor_id, assignee_actor_type, created_by_actor_id, created_by_actor_type, agent_session_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(row.id, workspaceId, row.title, row.description ?? null, row.status, row.assigneeActorId ?? null, row.assigneeActorType ?? null, row.createdByActorId, row.createdByActorType, row.agentSessionId ?? null, row.createdAt, row.updatedAt);
}

function insertFinding(row: PublicationSnapshot["findings"][number], workspaceId: string, db: D1Database): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO findings (id, workspace_id, summary, detail, confidence, source_artifact_id, currentness, predecessor_id, successor_id, correction_reason, corrected_by_actor_id, corrected_by_actor_type, corrected_session_id, corrected_at, created_by_actor_id, created_by_actor_type, agent_session_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?)`,
  ).bind(row.id, workspaceId, row.summary, row.detail ?? null, row.confidence ?? null, row.sourceArtifactId ?? null, row.currentness, row.createdByActorId, row.createdByActorType, row.agentSessionId ?? null, row.createdAt);
}

function updateFinding(row: PublicationSnapshot["findings"][number], db: D1Database): D1PreparedStatement {
  return db.prepare(
    `UPDATE findings SET currentness = ?, predecessor_id = ?, successor_id = ?, correction_reason = ?, corrected_by_actor_id = ?, corrected_by_actor_type = ?, corrected_session_id = ?, corrected_at = ? WHERE id = ?`,
  ).bind(row.currentness, row.predecessorId ?? null, row.successorId ?? null, row.correctionReason ?? null, row.correctedByActorId ?? null, row.correctedByActorType ?? null, row.correctedSessionId ?? null, row.correctedAt ?? null, row.id);
}

function insertDecision(row: PublicationSnapshot["decisions"][number], workspaceId: string, db: D1Database): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO decisions (id, workspace_id, summary, rationale, status, approved_by_actor_id, approved_by_actor_type, predecessor_id, successor_id, supersede_reason, superseded_by_actor_id, superseded_by_actor_type, superseded_session_id, superseded_at, created_by_actor_id, created_by_actor_type, agent_session_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?)`,
  ).bind(row.id, workspaceId, row.summary, row.rationale ?? null, row.status, row.approvedByActorId ?? null, row.approvedByActorType ?? null, row.createdByActorId, row.createdByActorType, row.agentSessionId ?? null, row.createdAt, row.updatedAt);
}

function updateDecision(row: PublicationSnapshot["decisions"][number], db: D1Database): D1PreparedStatement {
  return db.prepare(
    `UPDATE decisions SET predecessor_id = ?, successor_id = ?, supersede_reason = ?, superseded_by_actor_id = ?, superseded_by_actor_type = ?, superseded_session_id = ?, superseded_at = ? WHERE id = ?`,
  ).bind(row.predecessorId ?? null, row.successorId ?? null, row.supersedeReason ?? null, row.supersededByActorId ?? null, row.supersededByActorType ?? null, row.supersededSessionId ?? null, row.supersededAt ?? null, row.id);
}

function insertArtifact(row: PublicationSnapshot["artifacts"][number], workspaceId: string, db: D1Database): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO artifacts (id, workspace_id, type, title, uri_or_path, metadata, created_by_actor_id, created_by_actor_type, agent_session_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(row.id, workspaceId, row.type, row.title, row.uriOrPath, row.metadata === undefined ? null : JSON.stringify(row.metadata), row.createdByActorId, row.createdByActorType, row.agentSessionId ?? null, row.createdAt);
}

function insertFindingEvidence(row: PublicationSnapshot["findingEvidence"][number], workspaceId: string, db: D1Database): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO finding_evidence (id, workspace_id, finding_id, artifact_id, relation, note, actor_id, actor_type, agent_session_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(row.id, workspaceId, row.findingId, row.artifactId, row.relation, row.note ?? null, row.actorId, row.actorType, row.agentSessionId ?? null, row.createdAt);
}

function insertDecisionCitation(row: PublicationSnapshot["decisionCitations"][number], workspaceId: string, db: D1Database): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO decision_citations (id, workspace_id, decision_id, finding_id, note, actor_id, actor_type, agent_session_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(row.id, workspaceId, row.decisionId, row.findingId, row.note ?? null, row.actorId, row.actorType, row.agentSessionId ?? null, row.createdAt);
}

function insertFindingTransition(row: PublicationSnapshot["findingTransitions"][number], db: D1Database): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO finding_transitions (finding_id, successor_id, kind, reason, actor_id, actor_type, agent_session_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(row.findingId, row.successorId ?? null, row.kind, row.reason, row.actorId, row.actorType, row.agentSessionId ?? null, row.createdAt);
}

function insertDecisionTransition(row: PublicationSnapshot["decisionTransitions"][number], db: D1Database): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO decision_transitions (decision_id, successor_id, kind, reason, actor_id, actor_type, agent_session_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(row.decisionId, row.successorId ?? null, row.kind, row.reason, row.actorId, row.actorType, row.agentSessionId ?? null, row.createdAt);
}

function insertContribution(row: PublicationSnapshot["contributions"][number], workspaceId: string, db: D1Database): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO contributions (id, workspace_id, actor_id, actor_type, agent_session_id, action, object_type, object_id, payload, append_position, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(row.id, workspaceId, row.actorId, row.actorType, row.agentSessionId ?? null, row.action, row.objectType, row.objectId, row.payload === undefined ? null : JSON.stringify(row.payload), row.appendPosition, row.createdAt);
}

export async function handlePublicationEnroll(
  options: PublicationWorkerOptions,
  request: Request,
): Promise<Response> {
  const at = now(options);
  const denied = await assertRehearsalAdmission(options, request, at);
  if (denied !== undefined) return denied;
  const body = await readJson(request, PUBLICATION_LIMITS.maxImportBytes);
  if (!body.ok) return body.response;
  let input;
  try { input = validateEnrollmentInput(body.value); }
  catch (error) { return fail(statusFor(error as CampfireError), (error as CampfireError).code, (error as Error).message, (error as CampfireError).details); }
  const source = await sourceHash(request);
  const digest = await hashTokenWeb(canonicalJson(input));
  try {
    const existingByRequest = await first<Row>(options.db, "SELECT * FROM publication_enrollments WHERE request_id = ?", input.requestId);
    if (existingByRequest !== undefined) {
      if (existingByRequest.request_digest !== digest) throw new Conflict("The same publication request was retried with different content", { nextAction: "start_new_publication" });
      return json(200, { ok: true, result: enrollmentReceipt(existingByRequest) });
    }
    const existingByHuman = await first<Row>(options.db, "SELECT * FROM publication_enrollments WHERE human_id = ?", input.humanId);
    if (existingByHuman !== undefined) throw new Conflict("This human identity is already enrolled for hosted publication", { nextAction: "recover_publication_credentials" });
    await rateLimit(options.db, source, options.maxEnrollmentsPerSourcePerDay ?? PUBLICATION_LIMITS.maxEnrollmentsPerSourcePerDay, at);

    const organizationId = id(options, "organization");
    const teamId = id(options, "team");
    const enrollmentId = `pubenr_${crypto.randomUUID()}`;
    const receipt: PublicationEnrollmentReceipt = {
      version: 1,
      kind: "workspace_publication_enrollment",
      requestId: input.requestId,
      human: { id: input.humanId, displayName: input.humanName },
      organization: { id: organizationId, name: `${input.humanName}'s Campfire` },
      team: { id: teamId, name: "Private workspace" },
      agents: input.agents.map((agent) => ({ id: agent.id, name: agent.name, harness: agent.harness })),
      sourceWorkspaceId: input.sourceWorkspaceId,
      enrolledAt: at,
    };
    const statements: D1PreparedStatement[] = [
      options.db.prepare("INSERT INTO organizations (id, name, created_at) VALUES (?, ?, ?)").bind(organizationId, receipt.organization.name, at),
      options.db.prepare("INSERT INTO teams (id, organization_id, name, created_at) VALUES (?, ?, ?, ?)").bind(teamId, organizationId, receipt.team.name, at),
      options.db.prepare("INSERT INTO humans (id, team_id, display_name, external_identity, created_at) VALUES (?, ?, ?, NULL, ?)").bind(input.humanId, teamId, input.humanName, at),
      options.db.prepare("INSERT INTO actor_tokens (id, actor_id, actor_type, token_hash, created_at, revoked_at) VALUES (?, ?, 'human', ?, ?, NULL)").bind(id(options, "token"), input.humanId, input.humanTokenHash, at),
      ...input.agents.flatMap((agent) => [
        options.db.prepare("INSERT INTO agents (id, team_id, human_id, name, harness, model, instance_metadata, created_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)").bind(agent.id, teamId, input.humanId, agent.name, agent.harness, at),
        options.db.prepare("INSERT INTO actor_tokens (id, actor_id, actor_type, token_hash, created_at, revoked_at) VALUES (?, ?, 'agent', ?, ?, NULL)").bind(id(options, "token"), agent.id, agent.tokenHash, at),
      ]),
      options.db.prepare(
        `INSERT INTO publication_enrollments (id, request_id, human_id, human_name, human_token_hash, recovery_hash, organization_id, team_id, source_workspace_id, source_package_version, source_schema_version, workspace_name, device_key_hash, source_hash, request_digest, receipt_json, claim_nonce, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(enrollmentId, input.requestId, input.humanId, input.humanName, input.humanTokenHash, input.recoveryHash, organizationId, teamId, input.sourceWorkspaceId, input.sourcePackageVersion, input.sourceSchemaVersion, input.workspaceName, input.deviceKeyHash, source, digest, JSON.stringify(receipt), crypto.randomUUID(), at),
    ];
    try {
      await options.db.batch(statements);
    } catch (error) {
      const raced = await first<Row>(options.db, "SELECT * FROM publication_enrollments WHERE request_id = ?", input.requestId);
      if (raced !== undefined && raced.request_digest === digest) return json(200, { ok: true, result: enrollmentReceipt(raced) });
      throw error;
    }
    return json(200, { ok: true, result: receipt });
  } catch (error) {
    if (error instanceof CampfireError) return fail(statusFor(error), error.code, error.message, error.details);
    return fail(500, "InternalError", "Publication enrollment could not be completed");
  }
}

function assertOwnerEnrollment(row: Row | undefined, humanId: string): asserts row is Row {
  if (row === undefined || row.human_id !== humanId) {
    throw new Unauthorized("No hosted publication enrollment exists for this owner", { nextAction: "begin_publication" });
  }
}

function importStatements(input: {
  db: D1Database;
  snapshot: PublicationSnapshot;
  ownerHumanId: string;
  teamId: string;
  receipt: PublicationImportReceipt;
  existingHumanIds: Set<string>;
  existingAgentIds: Set<string>;
}): D1PreparedStatement[] {
  const { db, snapshot, teamId, receipt } = input;
  const workspaceId = snapshot.workspace.id;
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO workspaces (id, team_id, name, description, status, created_by_actor_id, created_by_actor_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(workspaceId, teamId, snapshot.workspace.name, snapshot.workspace.description ?? null, snapshot.workspace.status, snapshot.workspace.createdByActorId, snapshot.workspace.createdByActorType, snapshot.workspace.createdAt, snapshot.workspace.updatedAt),
  ];
  for (const human of snapshot.humans) {
    if (!input.existingHumanIds.has(human.id)) statements.push(insertHuman(human, teamId, db));
  }
  for (const agent of snapshot.agents) {
    if (!input.existingAgentIds.has(agent.id)) statements.push(insertAgent(agent, teamId, db));
  }
  // Enrollment creates the owner identity before the snapshot arrives. Replace
  // the enrollment placeholders with the local provenance fields; the id and
  // owning relationship stay authoritative.
  for (const human of snapshot.humans) {
    if (!input.existingHumanIds.has(human.id)) continue;
    statements.push(
      db.prepare("UPDATE humans SET display_name = ?, external_identity = ?, created_at = ? WHERE id = ?")
        .bind(human.displayName, human.externalIdentity ?? null, human.createdAt, human.id),
    );
  }
  for (const agent of snapshot.agents) {
    if (!input.existingAgentIds.has(agent.id)) continue;
    statements.push(
      db.prepare("UPDATE agents SET name = ?, harness = ?, model = ?, created_at = ? WHERE id = ?")
        .bind(agent.name, agent.harness, agent.model ?? null, agent.createdAt, agent.id),
    );
  }
  for (const participant of snapshot.participants) statements.push(insertParticipant(participant, workspaceId, db));
  for (const session of snapshot.sessions) statements.push(insertSession(session, workspaceId, db));
  for (const artifact of snapshot.artifacts) statements.push(insertArtifact(artifact, workspaceId, db));
  for (const goal of snapshot.goals) statements.push(insertGoal(goal, workspaceId, db));
  for (const task of snapshot.tasks) statements.push(insertTask(task, workspaceId, db));
  for (const finding of snapshot.findings) statements.push(insertFinding(finding, workspaceId, db));
  for (const decision of snapshot.decisions) statements.push(insertDecision(decision, workspaceId, db));
  for (const transition of snapshot.findingTransitions) statements.push(insertFindingTransition(transition, db));
  for (const transition of snapshot.decisionTransitions) statements.push(insertDecisionTransition(transition, db));
  for (const finding of snapshot.findings) statements.push(updateFinding(finding, db));
  for (const decision of snapshot.decisions) statements.push(updateDecision(decision, db));
  for (const evidence of snapshot.findingEvidence) statements.push(insertFindingEvidence(evidence, workspaceId, db));
  for (const citation of snapshot.decisionCitations) statements.push(insertDecisionCitation(citation, workspaceId, db));
  for (const contribution of snapshot.contributions) statements.push(insertContribution(contribution, workspaceId, db));
  statements.push(
    db.prepare(
      `INSERT INTO workspace_publications (id, owner_human_id, workspace_id, request_id, request_digest, source_tip, counts_json, receipt_json, committed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(`pub_${crypto.randomUUID()}`, input.ownerHumanId, workspaceId, receipt.requestId, receipt.digest, receipt.sourceTip, JSON.stringify(receipt.counts), JSON.stringify(receipt), receipt.importedAt),
  );
  return statements;
}

export async function handlePublicationImport(
  options: PublicationWorkerOptions,
  request: Request,
  service: AsyncCampfireService,
): Promise<Response> {
  const at = now(options);
  const denied = await assertRehearsalAdmission(options, request, at);
  if (denied !== undefined) return denied;
  const token = bearer(request);
  if (token === undefined) return fail(401, "Unauthorized", "Missing bearer token");
  let actor;
  try { actor = await service.resolveToken(token); }
  catch { return fail(401, "Unauthorized", "Invalid or revoked token"); }
  if (actor.actorType !== "human") return fail(403, "Unauthorized", "Only the enrolled human owner can import a workspace");
  const body = await readJson(request, PUBLICATION_LIMITS.maxImportBytes);
  if (!body.ok) return body.response;
  let input;
  try { input = validateImportInput(body.value); }
  catch (error) { return fail(statusFor(error as CampfireError), (error as CampfireError).code, (error as Error).message, (error as CampfireError).details); }
  try {
    const recomputed = await hashTokenWeb(canonicalJson(snapshotDigestInput(input.snapshot)));
    if (recomputed !== input.digest) throw new ValidationError("Snapshot digest does not match its content", { field: "digest", nextAction: "recompute_snapshot" });
    const enrollment = await first<Row>(options.db, "SELECT * FROM publication_enrollments WHERE human_id = ?", actor.actorId);
    assertOwnerEnrollment(enrollment, actor.actorId);
    if (input.requestId !== enrollment.request_id) {
      throw new ValidationError("Import request does not match the enrolled publication request", { field: "requestId", nextAction: "resume_original_publication" });
    }
    if (input.snapshot.workspace.id !== enrollment.source_workspace_id ||
        input.snapshot.workspace.name !== enrollment.workspace_name) {
      throw new ValidationError("The imported workspace does not match the enrolled source workspace", {
        field: "snapshot.workspace",
        nextAction: "start_new_publication",
      });
    }
    if (input.snapshot.owner.humanId !== actor.actorId) throw new Unauthorized("The snapshot owner does not match the authenticated owner", { nextAction: "publish_as_owner" });
    const existing = await first<Row>(options.db,
      "SELECT * FROM workspace_publications WHERE owner_human_id = ? AND request_id = ?", actor.actorId, input.requestId);
    if (existing !== undefined) {
      if (existing.request_digest !== input.digest) throw new Conflict("The same import request was retried with different content", { nextAction: "start_new_publication" });
      return json(200, { ok: true, result: publicationReceipt(existing) });
    }
    const byOwner = await first<Row>(options.db, "SELECT * FROM workspace_publications WHERE owner_human_id = ?", actor.actorId);
    if (byOwner !== undefined) throw new Conflict("This owner already has a published workspace in this alpha", { nextAction: "use_existing_publication" });
    const existingWorkspace = await first<Row>(options.db, "SELECT id FROM workspaces WHERE id = ?", input.snapshot.workspace.id);
    if (existingWorkspace !== undefined) throw new Conflict("The workspace id is already in use", { nextAction: "start_new_publication" });

    const sourceAgents = input.snapshot.agents.filter((agent) => agent.humanId === actor.actorId).map((agent) => `${agent.id}:${agent.harness}`).sort().join(",");
    const enrolledAgents = (await options.db.prepare("SELECT id, harness FROM agents WHERE human_id = ? ORDER BY id").bind(actor.actorId).all<{ id: string; harness: string }>()).results;
    const enrolledKey = enrolledAgents.map((agent) => `${agent.id}:${agent.harness}`).sort().join(",");
    if (sourceAgents !== enrolledKey) throw new Conflict("The owner agent set does not match hosted enrollment", { nextAction: "start_new_publication" });

    const existingHumans = new Set<string>();
    const existingAgents = new Set<string>();
    for (const human of input.snapshot.humans) {
      const row = await first<Row>(options.db, "SELECT id FROM humans WHERE id = ?", human.id);
      if (row !== undefined) existingHumans.add(human.id);
    }
    for (const agent of input.snapshot.agents) {
      const row = await first<Row>(options.db, "SELECT id FROM agents WHERE id = ?", agent.id);
      if (row !== undefined) existingAgents.add(agent.id);
    }
    if (!existingHumans.has(actor.actorId)) throw new Unauthorized("The enrolled owner identity is missing");
    for (const human of input.snapshot.humans) {
      if (existingHumans.has(human.id) && human.id !== actor.actorId) {
        throw new Conflict("An imported human id is already in use", { nextAction: "start_new_publication" });
      }
    }
    for (const agent of input.snapshot.agents) {
      if (existingAgents.has(agent.id) && agent.humanId !== actor.actorId) {
        throw new Conflict("An imported agent id is already in use", { nextAction: "start_new_publication" });
      }
    }

    ensureStrings(input.snapshot);
    const counts: PublicationCounts = input.snapshot.counts;
    const receipt: PublicationImportReceipt = {
      version: 1,
      kind: "workspace_publication_import",
      requestId: input.requestId,
      workspace: { id: input.snapshot.workspace.id, name: input.snapshot.workspace.name, teamId: String(enrollment.team_id) },
      owner: { humanId: actor.actorId, displayName: input.snapshot.owner.displayName },
      sourceTip: input.snapshot.source.contributionTip,
      digest: input.digest,
      counts,
      importedAt: at,
    };
    const statements = importStatements({
      db: options.db,
      snapshot: input.snapshot,
      ownerHumanId: actor.actorId,
      teamId: String(enrollment.team_id),
      receipt,
      existingHumanIds: existingHumans,
      existingAgentIds: existingAgents,
    });
    try {
      await options.db.batch(statements);
    } catch (error) {
      const raced = await first<Row>(options.db,
        "SELECT * FROM workspace_publications WHERE owner_human_id = ? AND request_id = ?", actor.actorId, input.requestId);
      if (raced !== undefined && raced.request_digest === input.digest) return json(200, { ok: true, result: publicationReceipt(raced) });
      if (raced !== undefined) throw new Conflict("The same import request was retried with different content", { nextAction: "start_new_publication" });
      throw new Conflict("The import could not commit as one complete graph; no partial workspace is visible", {
        nextAction: "inspect_publication_source",
      });
    }
    return json(200, { ok: true, result: receipt });
  } catch (error) {
    if (error instanceof CampfireError) return fail(statusFor(error), error.code, error.message, error.details);
    return fail(500, "InternalError", "Publication import could not be completed");
  }
}

export async function handlePublicationRecover(
  options: PublicationWorkerOptions,
  request: Request,
): Promise<Response> {
  const at = now(options);
  const denied = await assertRehearsalAdmission(options, request, at);
  if (denied !== undefined) return denied;
  const body = await readJson(request, PUBLICATION_LIMITS.maxImportBytes);
  if (!body.ok) return body.response;
  let input;
  try { input = validateRecoveryInput(body.value); }
  catch (error) { return fail(statusFor(error as CampfireError), (error as CampfireError).code, (error as Error).message, (error as CampfireError).details); }
  try {
    const row = await first<Row>(options.db, "SELECT * FROM publication_enrollments WHERE request_id = ? AND human_id = ?", input.requestId, input.humanId);
    if (row === undefined) throw new Unauthorized("Publication enrollment was not found for this recovery request");
    const recoveryHash = await hashTokenWeb(input.recoverySecret);
    if (recoveryHash !== row.recovery_hash) throw new Unauthorized("Recovery proof did not match");
    const statements = [
      options.db.prepare("UPDATE actor_tokens SET revoked_at = ? WHERE actor_id = ? AND actor_type = 'human' AND revoked_at IS NULL").bind(at, input.humanId),
      options.db.prepare("INSERT INTO actor_tokens (id, actor_id, actor_type, token_hash, created_at, revoked_at) VALUES (?, ?, 'human', ?, ?, NULL)").bind(id(options, "token"), input.humanId, input.humanTokenHash, at),
      options.db.prepare("UPDATE publication_enrollments SET human_token_hash = ? WHERE request_id = ?").bind(input.humanTokenHash, input.requestId),
    ];
    await options.db.batch(statements);
    return json(200, { ok: true, result: { version: 1, kind: "workspace_publication_recovery", requestId: input.requestId, humanId: input.humanId, recoveredAt: at } });
  } catch (error) {
    if (error instanceof CampfireError) return fail(statusFor(error), error.code, error.message, error.details);
    return fail(500, "InternalError", "Publication credential recovery could not be completed");
  }
}

function bearer(request: Request): string | undefined {
  const header = request.headers.get("authorization");
  if (header === null) return undefined;
  const match = /^Bearer\s+(\S+)/i.exec(header.trim());
  return match?.[1]?.trim() || undefined;
}
