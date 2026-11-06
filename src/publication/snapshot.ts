/**
 * Read-only local workspace snapshot.
 *
 * This is intentionally not a SQLite file copy. It opens the database
 * read-only, checks the schema, selects only the allow-listed tables and
 * columns, rejects unsupported workspace state, and returns one bounded graph
 * with an integrity digest. The source database is never modified.
 */
import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { ValidationError } from "../domain/errors.js";
import {
  PUBLICATION_FORMAT,
  PUBLICATION_LIMITS,
  PUBLICATION_VERSION,
  assertPublicationSnapshotConsistent,
  parsePublicationSnapshot,
  snapshotCounts,
  type PublicationAgent,
  type PublicationArtifact,
  type PublicationContribution,
  type PublicationCounts,
  type PublicationDecision,
  type PublicationDecisionCitation,
  type PublicationDecisionTransition,
  type PublicationFinding,
  type PublicationFindingEvidence,
  type PublicationFindingTransition,
  type PublicationGoal,
  type PublicationHuman,
  type PublicationParticipant,
  type PublicationSession,
  type PublicationSnapshot,
  type PublicationTask,
} from "../domain/publication.js";
import { CURRENT_SCHEMA_VERSION } from "../store/migrations.js";
import { publicationDigest } from "./digest.js";

export interface PublicationSourceInspection {
  databasePath: string;
  workspaceId: string;
  workspaceName: string;
  schemaVersion: number;
  sourceTip: number;
  counts: PublicationCounts;
  unsupported: Array<{ feature: string; count: number }>;
  owner: { humanId: string; displayName: string };
  agents: Array<{ id: string; name: string; harness: string }>;
}

export interface ReadSnapshotInput {
  databasePath: string;
  workspaceId: string;
  ownerHumanId: string;
  packageVersion: string;
  exportedAt: string;
}

type Row = Record<string, unknown>;

function invalid(message: string, field: string, nextAction = "check_publication_source"): never {
  throw new ValidationError(message, { field, nextAction });
}

function openReadonly(databasePath: string): Database.Database {
  if (!existsSync(databasePath)) invalid("Campfire database was not found", "databasePath");
  try {
    return new Database(databasePath, { readonly: true, fileMustExist: true });
  } catch {
    invalid("Campfire database could not be opened read-only", "databasePath");
  }
}

function schemaVersion(db: Database.Database): number {
  try {
    const row = db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number | null };
    return Number(row.version ?? 0);
  } catch {
    invalid("Campfire schema is not recognizable; run the installed Campfire version first", "schema");
  }
}

function count(db: Database.Database, sql: string, ...params: unknown[]): number {
  const row = db.prepare(sql).get(...params) as { count: number } | undefined;
  return Number(row?.count ?? 0);
}

function hasTable(db: Database.Database, table: string): boolean {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { name: string } | undefined;
  return row !== undefined;
}

function workspaceRow(db: Database.Database, workspaceId: string): Row {
  const row = db.prepare("SELECT * FROM workspaces WHERE id = ?").get(workspaceId) as Row | undefined;
  if (row === undefined) invalid("Workspace was not found", "workspaceId", "select_local_workspace");
  return row;
}

function ownerParticipant(db: Database.Database, workspaceId: string, ownerHumanId: string): Row {
  const row = db.prepare(
    "SELECT * FROM workspace_participants WHERE workspace_id = ? AND actor_id = ? AND actor_type = 'human' AND role = 'owner'",
  ).get(workspaceId, ownerHumanId) as Row | undefined;
  if (row === undefined) {
    invalid("Only the workspace's human owner may publish it", "owner", "publish_as_owner");
  }
  return row;
}

function unsupportedFeatures(db: Database.Database, workspaceId: string): Array<{ feature: string; count: number }> {
  const checks: Array<[string, string]> = [
    ["action_proposals", "SELECT COUNT(*) AS count FROM action_proposals WHERE workspace_id = ?"],
    ["action_target_reservations", "SELECT COUNT(*) AS count FROM action_target_reservations WHERE workspace_id = ?"],
    ["action_receipts", "SELECT COUNT(*) AS count FROM action_receipts WHERE workspace_id = ?"],
    ["action_mutation_receipts", "SELECT COUNT(*) AS count FROM action_mutation_receipts WHERE workspace_id = ?"],
    ["github_source_bindings", "SELECT COUNT(*) AS count FROM github_source_bindings WHERE workspace_id = ?"],
    ["github_ingress_deliveries", "SELECT COUNT(*) AS count FROM github_ingress_deliveries d JOIN github_source_bindings b ON b.source_id = d.source_id WHERE b.workspace_id = ?"],
    ["github_ingress_receipts", "SELECT COUNT(*) AS count FROM github_ingress_receipts WHERE workspace_id = ?"],
    // A consumed invite is historical membership provenance, not current
    // authority. Only an open invite blocks publication.
    ["workspace_invites", "SELECT COUNT(*) AS count FROM workspace_invites WHERE workspace_id = ? AND consumed_at IS NULL"],
    ["enrollment_invitations", "SELECT COUNT(*) AS count FROM enrollment_invitations WHERE workspace_id = ?"],
    ["managed_agent_slots", "SELECT COUNT(*) AS count FROM managed_agent_slots WHERE workspace_id = ?"],
  ];
  return checks
    .filter(([table]) => hasTable(db, table))
    .map(([feature, sql]) => ({ feature, count: count(db, sql, workspaceId) }))
    .filter((entry) => entry.count > 0);
}

/**
 * Preflight reads only counts, owner, and unsupported state. It never opens a
 * write transaction or emits object text.
 */
export function inspectPublicationSource(databasePath: string, workspaceId: string, ownerHumanId: string): PublicationSourceInspection {
  const db = openReadonly(databasePath);
  try {
    const read = db.transaction(() => {
    const version = schemaVersion(db);
    // A v1.28.1 database is schema 10. Schema 11 adds an optional task id and
    // runtime rows, and runtime rows are not part of a snapshot.
    if (version !== CURRENT_SCHEMA_VERSION && version !== 10) {
      invalid(`Local schema version ${version} is not the supported version ${CURRENT_SCHEMA_VERSION}`, "schema", "upgrade_or_restore_local");
    }
    const workspace = workspaceRow(db, workspaceId);
    ownerParticipant(db, workspaceId, ownerHumanId);
    const owner = db.prepare("SELECT id, display_name FROM humans WHERE id = ?").get(ownerHumanId) as { id: string; display_name: string } | undefined;
    if (owner === undefined) invalid("Local owner identity was not found", "owner");
    const participants = db.prepare("SELECT * FROM workspace_participants WHERE workspace_id = ?").all(workspaceId) as Row[];
    const agentRows = db.prepare(
      `SELECT a.id, a.name, a.harness FROM agents a
       JOIN workspace_participants p ON p.actor_id = a.id AND p.actor_type = 'agent' AND p.workspace_id = ?
       WHERE a.human_id = ? ORDER BY a.id`,
    ).all(workspaceId, ownerHumanId) as Array<{ id: string; name: string; harness: string }>;
    const counts: PublicationCounts = {
      humans: participants.filter((row) => row.actor_type === "human").length,
      agents: participants.filter((row) => row.actor_type === "agent").length,
      participants: participants.length,
      sessions: count(db, "SELECT COUNT(*) AS count FROM agent_sessions WHERE workspace_id = ?", workspaceId),
      goals: count(db, "SELECT COUNT(*) AS count FROM goals WHERE workspace_id = ?", workspaceId),
      tasks: count(db, "SELECT COUNT(*) AS count FROM tasks WHERE workspace_id = ?", workspaceId),
      findings: count(db, "SELECT COUNT(*) AS count FROM findings WHERE workspace_id = ?", workspaceId),
      decisions: count(db, "SELECT COUNT(*) AS count FROM decisions WHERE workspace_id = ?", workspaceId),
      artifacts: count(db, "SELECT COUNT(*) AS count FROM artifacts WHERE workspace_id = ?", workspaceId),
      findingTransitions: count(db, "SELECT COUNT(*) AS count FROM finding_transitions WHERE finding_id IN (SELECT id FROM findings WHERE workspace_id = ?)", workspaceId),
      decisionTransitions: count(db, "SELECT COUNT(*) AS count FROM decision_transitions WHERE decision_id IN (SELECT id FROM decisions WHERE workspace_id = ?)", workspaceId),
      findingEvidence: count(db, "SELECT COUNT(*) AS count FROM finding_evidence WHERE workspace_id = ?", workspaceId),
      decisionCitations: count(db, "SELECT COUNT(*) AS count FROM decision_citations WHERE workspace_id = ?", workspaceId),
      contributions: count(db, "SELECT COUNT(*) AS count FROM contributions WHERE workspace_id = ?", workspaceId),
      contributionTip: count(db, "SELECT COALESCE(MAX(append_position), 0) AS count FROM contributions WHERE workspace_id = ?", workspaceId),
    };
    return {
      databasePath,
      workspaceId,
      workspaceName: String(workspace.name),
      schemaVersion: version,
      sourceTip: counts.contributionTip,
      counts,
      unsupported: unsupportedFeatures(db, workspaceId),
      owner: { humanId: ownerHumanId, displayName: owner.display_name },
      agents: agentRows,
    };
    });
    return read();
  } finally {
    db.close();
  }
}

function stringField(row: Row, field: string): string {
  const value = row[field];
  if (typeof value !== "string" || value.length === 0) invalid(`Missing local field ${field}`, field);
  return value;
}

function optionalString(row: Row, field: string): string | undefined {
  const value = row[field];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalNumber(row: Row, field: string): number | undefined {
  const value = row[field];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function jsonField(row: Row, field: string): Record<string, unknown> | undefined {
  const value = row[field];
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") invalid(`Local field ${field} is not JSON`, field);
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) invalid(`Local field ${field} is not an object`, field);
    return parsed as Record<string, unknown>;
  } catch {
    invalid(`Local field ${field} is not strict JSON`, field);
  }
}

/**
 * Build the export. The caller must already have authorized the human owner.
 * Unsupported state fails closed with a stable field/reason; nothing is skipped.
 */
export function readWorkspaceSnapshot(input: ReadSnapshotInput): PublicationSnapshot {
  const inspection = inspectPublicationSource(input.databasePath, input.workspaceId, input.ownerHumanId);
  if (inspection.unsupported.length > 0) {
    throw new ValidationError("Workspace contains state this publication slice cannot preserve", {
      field: "unsupported",
      nextAction: "remove_unsupported_state",
      unsupported: inspection.unsupported,
    });
  }
  const db = openReadonly(input.databasePath);
  try {
    const read = db.transaction(() => {
    const workspace = workspaceRow(db, input.workspaceId);
    const team = db.prepare("SELECT * FROM teams WHERE id = ?").get(workspace.team_id) as Row | undefined;
    const organization = team === undefined ? undefined : db.prepare("SELECT * FROM organizations WHERE id = ?").get(team.organization_id) as Row | undefined;
    if (team === undefined || organization === undefined) invalid("Workspace organization or team is missing", "team");

    const participantsRaw = db.prepare("SELECT * FROM workspace_participants WHERE workspace_id = ? ORDER BY joined_at, actor_type, actor_id").all(input.workspaceId) as Row[];
    const goalsRaw = db.prepare("SELECT * FROM goals WHERE workspace_id = ? ORDER BY created_at, id").all(input.workspaceId) as Row[];
    const tasksRaw = db.prepare("SELECT * FROM tasks WHERE workspace_id = ? ORDER BY created_at, id").all(input.workspaceId) as Row[];
    const findingsRaw = db.prepare("SELECT * FROM findings WHERE workspace_id = ? ORDER BY created_at, id").all(input.workspaceId) as Row[];
    const decisionsRaw = db.prepare("SELECT * FROM decisions WHERE workspace_id = ? ORDER BY created_at, id").all(input.workspaceId) as Row[];
    const artifactsRaw = db.prepare("SELECT * FROM artifacts WHERE workspace_id = ? ORDER BY created_at, id").all(input.workspaceId) as Row[];
    const sessionsRaw = db.prepare("SELECT * FROM agent_sessions WHERE workspace_id = ? ORDER BY started_at, id").all(input.workspaceId) as Row[];
    const contributionsRaw = db.prepare("SELECT * FROM contributions WHERE workspace_id = ? ORDER BY append_position, id").all(input.workspaceId) as Row[];
    const findingTransitionsRaw = db.prepare(
      "SELECT t.* FROM finding_transitions t JOIN findings f ON f.id = t.finding_id WHERE f.workspace_id = ? ORDER BY t.created_at, t.finding_id",
    ).all(input.workspaceId) as Row[];
    const decisionTransitionsRaw = db.prepare(
      "SELECT t.* FROM decision_transitions t JOIN decisions d ON d.id = t.decision_id WHERE d.workspace_id = ? ORDER BY t.created_at, t.decision_id",
    ).all(input.workspaceId) as Row[];
    const evidenceRaw = db.prepare("SELECT * FROM finding_evidence WHERE workspace_id = ? ORDER BY created_at, id").all(input.workspaceId) as Row[];
    const citationsRaw = db.prepare("SELECT * FROM decision_citations WHERE workspace_id = ? ORDER BY created_at, id").all(input.workspaceId) as Row[];

    const allRows = [workspace, ...participantsRaw, ...goalsRaw, ...tasksRaw, ...findingsRaw, ...decisionsRaw, ...artifactsRaw, ...sessionsRaw, ...contributionsRaw, ...findingTransitionsRaw, ...decisionTransitionsRaw, ...evidenceRaw, ...citationsRaw];
    const humanIds = new Set<string>();
    const agentIds = new Set<string>();
    const addActor = (row: Row, idField: string, typeField: string): void => {
      const id = row[idField];
      const type = row[typeField];
      if (typeof id !== "string" || id.length === 0) return;
      if (type === "human") humanIds.add(id);
      else if (type === "agent") agentIds.add(id);
    };
    for (const row of allRows) {
      addActor(row, "actor_id", "actor_type");
      addActor(row, "created_by_actor_id", "created_by_actor_type");
      addActor(row, "corrected_by_actor_id", "corrected_by_actor_type");
      addActor(row, "superseded_by_actor_id", "superseded_by_actor_type");
      addActor(row, "approved_by_actor_id", "approved_by_actor_type");
      addActor(row, "assignee_actor_id", "assignee_actor_type");
      if (typeof row.human_id === "string") humanIds.add(row.human_id);
      if (typeof row.issued_by_human_id === "string") humanIds.add(row.issued_by_human_id);
    }
    for (const row of sessionsRaw) {
      if (typeof row.agent_id === "string") agentIds.add(row.agent_id);
      if (typeof row.human_id === "string") humanIds.add(row.human_id);
    }
    for (const row of participantsRaw) {
      if (row.actor_type === "human") humanIds.add(String(row.actor_id));
      else if (row.actor_type === "agent") agentIds.add(String(row.actor_id));
    }
    humanIds.add(input.ownerHumanId);

    const agentRows = [...agentIds].map((id) => db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as Row | undefined);
    for (const row of agentRows) {
      if (row === undefined) invalid("A referenced agent identity is missing", "agents");
      if (typeof row.human_id === "string") humanIds.add(row.human_id);
    }
    const humanRows = [...humanIds].map((id) => db.prepare("SELECT * FROM humans WHERE id = ?").get(id) as Row | undefined);
    if (humanRows.some((row) => row === undefined)) invalid("A referenced human identity is missing", "humans");
    const humanIdsFinal = new Set(humanRows.map((row) => String(row!.id)));
    if (!humanIdsFinal.has(input.ownerHumanId)) invalid("Owner identity is missing", "owner");

    const humans: PublicationHuman[] = humanRows.map((row) => ({
      id: stringField(row!, "id"),
      displayName: stringField(row!, "display_name"),
      ...(optionalString(row!, "external_identity") === undefined ? {} : { externalIdentity: optionalString(row!, "external_identity")! }),
      createdAt: stringField(row!, "created_at"),
    }));
    const agents: PublicationAgent[] = agentRows.map((row) => ({
      id: stringField(row!, "id"),
      ...(optionalString(row!, "human_id") === undefined ? {} : { humanId: optionalString(row!, "human_id")! }),
      name: stringField(row!, "name"),
      harness: stringField(row!, "harness"),
      ...(optionalString(row!, "model") === undefined ? {} : { model: optionalString(row!, "model")! }),
      createdAt: stringField(row!, "created_at"),
    }));
    // The owner's published agents are the only ones that receive fresh hosted
    // credentials. They must be participants of this workspace.
    const ownerAgents = participantsRaw
      .filter((row) => row.actor_type === "agent" && agentRows.some((agent) => agent !== undefined && agent.id === row.actor_id && agent.human_id === input.ownerHumanId))
      .map((row) => {
        const agent = agentRows.find((entry) => entry?.id === row.actor_id)!;
        return { id: String(agent.id), name: String(agent.name), harness: String(agent.harness) };
      });
    if (ownerAgents.some((agent) => agent.harness !== "codex" && agent.harness !== "opencode")) {
      invalid("Only codex and opencode owner agents can receive hosted credentials in this slice", "agents", "remove_unsupported_state");
    }

    const participants: PublicationParticipant[] = participantsRaw.map((row) => ({
      actorId: stringField(row, "actor_id"),
      actorType: String(row.actor_type) === "agent" ? "agent" : "human",
      role: String(row.role) as PublicationParticipant["role"],
      joinedAt: stringField(row, "joined_at"),
    }));
    const sessions: PublicationSession[] = sessionsRaw.map((row) => ({
      id: stringField(row, "id"),
      agentId: stringField(row, "agent_id"),
      humanId: stringField(row, "human_id"),
      harness: stringField(row, "harness"),
      startedAt: stringField(row, "started_at"),
      ...(optionalString(row, "ended_at") === undefined ? {} : { endedAt: optionalString(row, "ended_at")! }),
      ...(optionalString(row, "task_id") === undefined ? {} : { taskId: optionalString(row, "task_id")! }),
    }));
    const goals: PublicationGoal[] = goalsRaw.map((row) => ({
      id: stringField(row, "id"),
      title: stringField(row, "title"),
      ...(optionalString(row, "description") === undefined ? {} : { description: optionalString(row, "description")! }),
      status: String(row.status) as PublicationGoal["status"],
      createdByActorId: stringField(row, "created_by_actor_id"),
      createdByActorType: String(row.created_by_actor_type) as "human" | "agent",
      ...(optionalString(row, "agent_session_id") === undefined ? {} : { agentSessionId: optionalString(row, "agent_session_id")! }),
      createdAt: stringField(row, "created_at"),
      updatedAt: stringField(row, "updated_at"),
    }));
    const tasks: PublicationTask[] = tasksRaw.map((row) => ({
      id: stringField(row, "id"),
      title: stringField(row, "title"),
      ...(optionalString(row, "description") === undefined ? {} : { description: optionalString(row, "description")! }),
      status: String(row.status) as PublicationTask["status"],
      ...(optionalString(row, "assignee_actor_id") === undefined ? {} : { assigneeActorId: optionalString(row, "assignee_actor_id")! }),
      ...(optionalString(row, "assignee_actor_type") === undefined ? {} : { assigneeActorType: optionalString(row, "assignee_actor_type") as "human" | "agent" }),
      createdByActorId: stringField(row, "created_by_actor_id"),
      createdByActorType: String(row.created_by_actor_type) as "human" | "agent",
      ...(optionalString(row, "agent_session_id") === undefined ? {} : { agentSessionId: optionalString(row, "agent_session_id")! }),
      createdAt: stringField(row, "created_at"),
      updatedAt: stringField(row, "updated_at"),
    }));
    const findings: PublicationFinding[] = findingsRaw.map((row) => ({
      id: stringField(row, "id"),
      summary: stringField(row, "summary"),
      ...(optionalString(row, "detail") === undefined ? {} : { detail: optionalString(row, "detail")! }),
      ...(optionalNumber(row, "confidence") === undefined ? {} : { confidence: optionalNumber(row, "confidence")! }),
      ...(optionalString(row, "source_artifact_id") === undefined ? {} : { sourceArtifactId: optionalString(row, "source_artifact_id")! }),
      currentness: (optionalString(row, "currentness") ?? "current") as PublicationFinding["currentness"],
      ...(optionalString(row, "predecessor_id") === undefined ? {} : { predecessorId: optionalString(row, "predecessor_id")! }),
      ...(optionalString(row, "successor_id") === undefined ? {} : { successorId: optionalString(row, "successor_id")! }),
      ...(optionalString(row, "correction_reason") === undefined ? {} : { correctionReason: optionalString(row, "correction_reason")! }),
      ...(optionalString(row, "corrected_by_actor_id") === undefined ? {} : { correctedByActorId: optionalString(row, "corrected_by_actor_id")! }),
      ...(optionalString(row, "corrected_by_actor_type") === undefined ? {} : { correctedByActorType: optionalString(row, "corrected_by_actor_type") as "human" | "agent" }),
      ...(optionalString(row, "corrected_session_id") === undefined ? {} : { correctedSessionId: optionalString(row, "corrected_session_id")! }),
      ...(optionalString(row, "corrected_at") === undefined ? {} : { correctedAt: optionalString(row, "corrected_at")! }),
      createdByActorId: stringField(row, "created_by_actor_id"),
      createdByActorType: String(row.created_by_actor_type) as "human" | "agent",
      ...(optionalString(row, "agent_session_id") === undefined ? {} : { agentSessionId: optionalString(row, "agent_session_id")! }),
      createdAt: stringField(row, "created_at"),
    }));
    const decisions: PublicationDecision[] = decisionsRaw.map((row) => ({
      id: stringField(row, "id"),
      summary: stringField(row, "summary"),
      ...(optionalString(row, "rationale") === undefined ? {} : { rationale: optionalString(row, "rationale")! }),
      status: String(row.status) as PublicationDecision["status"],
      ...(optionalString(row, "approved_by_actor_id") === undefined ? {} : { approvedByActorId: optionalString(row, "approved_by_actor_id")! }),
      ...(optionalString(row, "approved_by_actor_type") === undefined ? {} : { approvedByActorType: optionalString(row, "approved_by_actor_type") as "human" | "agent" }),
      ...(optionalString(row, "predecessor_id") === undefined ? {} : { predecessorId: optionalString(row, "predecessor_id")! }),
      ...(optionalString(row, "successor_id") === undefined ? {} : { successorId: optionalString(row, "successor_id")! }),
      ...(optionalString(row, "supersede_reason") === undefined ? {} : { supersedeReason: optionalString(row, "supersede_reason")! }),
      ...(optionalString(row, "superseded_by_actor_id") === undefined ? {} : { supersededByActorId: optionalString(row, "superseded_by_actor_id")! }),
      ...(optionalString(row, "superseded_by_actor_type") === undefined ? {} : { supersededByActorType: optionalString(row, "superseded_by_actor_type") as "human" | "agent" }),
      ...(optionalString(row, "superseded_session_id") === undefined ? {} : { supersededSessionId: optionalString(row, "superseded_session_id")! }),
      ...(optionalString(row, "superseded_at") === undefined ? {} : { supersededAt: optionalString(row, "superseded_at")! }),
      createdByActorId: stringField(row, "created_by_actor_id"),
      createdByActorType: String(row.created_by_actor_type) as "human" | "agent",
      ...(optionalString(row, "agent_session_id") === undefined ? {} : { agentSessionId: optionalString(row, "agent_session_id")! }),
      createdAt: stringField(row, "created_at"),
      updatedAt: stringField(row, "updated_at"),
    }));
    const artifacts: PublicationArtifact[] = artifactsRaw.map((row) => ({
      id: stringField(row, "id"),
      type: String(row.type) as PublicationArtifact["type"],
      title: stringField(row, "title"),
      uriOrPath: stringField(row, "uri_or_path"),
      ...(jsonField(row, "metadata") === undefined ? {} : { metadata: jsonField(row, "metadata")! }),
      createdByActorId: stringField(row, "created_by_actor_id"),
      createdByActorType: String(row.created_by_actor_type) as "human" | "agent",
      ...(optionalString(row, "agent_session_id") === undefined ? {} : { agentSessionId: optionalString(row, "agent_session_id")! }),
      createdAt: stringField(row, "created_at"),
    }));
    const findingTransitions: PublicationFindingTransition[] = findingTransitionsRaw.map((row) => ({
      findingId: stringField(row, "finding_id"),
      ...(optionalString(row, "successor_id") === undefined ? {} : { successorId: optionalString(row, "successor_id")! }),
      kind: String(row.kind) as PublicationFindingTransition["kind"],
      reason: stringField(row, "reason"),
      actorId: stringField(row, "actor_id"),
      actorType: String(row.actor_type) as "human" | "agent",
      ...(optionalString(row, "agent_session_id") === undefined ? {} : { agentSessionId: optionalString(row, "agent_session_id")! }),
      createdAt: stringField(row, "created_at"),
    }));
    const decisionTransitions: PublicationDecisionTransition[] = decisionTransitionsRaw.map((row) => ({
      decisionId: stringField(row, "decision_id"),
      ...(optionalString(row, "successor_id") === undefined ? {} : { successorId: optionalString(row, "successor_id")! }),
      kind: String(row.kind) as PublicationDecisionTransition["kind"],
      reason: stringField(row, "reason"),
      actorId: stringField(row, "actor_id"),
      actorType: String(row.actor_type) as "human" | "agent",
      ...(optionalString(row, "agent_session_id") === undefined ? {} : { agentSessionId: optionalString(row, "agent_session_id")! }),
      createdAt: stringField(row, "created_at"),
    }));
    const findingEvidence: PublicationFindingEvidence[] = evidenceRaw.map((row) => ({
      id: stringField(row, "id"),
      findingId: stringField(row, "finding_id"),
      artifactId: stringField(row, "artifact_id"),
      relation: String(row.relation) as PublicationFindingEvidence["relation"],
      ...(optionalString(row, "note") === undefined ? {} : { note: optionalString(row, "note")! }),
      actorId: stringField(row, "actor_id"),
      actorType: String(row.actor_type) as "human" | "agent",
      ...(optionalString(row, "agent_session_id") === undefined ? {} : { agentSessionId: optionalString(row, "agent_session_id")! }),
      createdAt: stringField(row, "created_at"),
    }));
    const decisionCitations: PublicationDecisionCitation[] = citationsRaw.map((row) => ({
      id: stringField(row, "id"),
      decisionId: stringField(row, "decision_id"),
      findingId: stringField(row, "finding_id"),
      ...(optionalString(row, "note") === undefined ? {} : { note: optionalString(row, "note")! }),
      actorId: stringField(row, "actor_id"),
      actorType: String(row.actor_type) as "human" | "agent",
      ...(optionalString(row, "agent_session_id") === undefined ? {} : { agentSessionId: optionalString(row, "agent_session_id")! }),
      createdAt: stringField(row, "created_at"),
    }));
    const contributions: PublicationContribution[] = contributionsRaw.map((row) => ({
      id: stringField(row, "id"),
      actorId: stringField(row, "actor_id"),
      actorType: String(row.actor_type) as "human" | "agent",
      ...(optionalString(row, "agent_session_id") === undefined ? {} : { agentSessionId: optionalString(row, "agent_session_id")! }),
      action: String(row.action) as PublicationContribution["action"],
      objectType: String(row.object_type) as PublicationContribution["objectType"],
      objectId: stringField(row, "object_id"),
      ...(jsonField(row, "payload") === undefined ? {} : { payload: jsonField(row, "payload")! }),
      appendPosition: Number(row.append_position),
      createdAt: stringField(row, "created_at"),
    }));

    const base: Omit<PublicationSnapshot, "counts" | "digest"> = {
      format: PUBLICATION_FORMAT,
      version: PUBLICATION_VERSION,
      workspaceId: input.workspaceId,
      source: {
        packageVersion: input.packageVersion,
        schemaVersion: inspection.schemaVersion,
        localOrganizationId: stringField(organization, "id"),
        localTeamId: stringField(team, "id"),
        localWorkspaceName: stringField(workspace, "name"),
        contributionTip: Math.max(0, ...contributions.map((row) => row.appendPosition)),
        exportedAt: input.exportedAt,
      },
      owner: { humanId: input.ownerHumanId, displayName: String(humanRows.find((row) => row?.id === input.ownerHumanId)?.display_name) },
      workspace: {
        id: stringField(workspace, "id"),
        name: stringField(workspace, "name"),
        ...(optionalString(workspace, "description") === undefined ? {} : { description: optionalString(workspace, "description")! }),
        status: String(workspace.status) as PublicationSnapshot["workspace"]["status"],
        createdAt: stringField(workspace, "created_at"),
        updatedAt: stringField(workspace, "updated_at"),
        createdByActorId: stringField(workspace, "created_by_actor_id"),
        createdByActorType: stringField(workspace, "created_by_actor_type") as "human" | "agent",
      },
      humans,
      agents,
      participants,
      sessions,
      goals,
      tasks,
      findings,
      decisions,
      artifacts,
      findingTransitions,
      decisionTransitions,
      findingEvidence,
      decisionCitations,
      contributions,
    };
    const counts = snapshotCounts(base);
    const snapshot: PublicationSnapshot = { ...base, counts, digest: "" };
    snapshot.digest = publicationDigest(snapshot);
    assertPublicationSnapshotConsistent(snapshot);
    // Re-run the full boundary validator so artifact URI, auxiliary JSON, and
    // credential-shaped value checks apply before anything crosses the wire.
    return parsePublicationSnapshot(snapshot);
    });
    return read();
  } finally {
    db.close();
  }
}

export function ownerAgentsForPublication(databasePath: string, workspaceId: string, ownerHumanId: string): Array<{ id: string; name: string; harness: string }> {
  const inspection = inspectPublicationSource(databasePath, workspaceId, ownerHumanId);
  return inspection.agents;
}

export function snapshotByteSize(snapshot: PublicationSnapshot): number {
  return new TextEncoder().encode(JSON.stringify(snapshot)).byteLength;
}

export function assertSnapshotWithinLimits(snapshot: PublicationSnapshot): void {
  const bytes = snapshotByteSize(snapshot);
  if (bytes > PUBLICATION_LIMITS.maxSnapshotBytes) {
    throw new ValidationError("Workspace snapshot exceeds the supported publication size", {
      field: "snapshot.size",
      nextAction: "reduce_workspace_scope",
      bytes,
      limit: PUBLICATION_LIMITS.maxSnapshotBytes,
    });
  }
}
