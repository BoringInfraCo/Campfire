/**
 * Private publication receipt, write lock, and cutover file handling.
 *
 * Publication state can hold the freshly minted hosted credentials, so the
 * file is always mode 0600. Human and JSON receipts are projected from the
 * token-free `receipt` member; credentials are never printed.
 */
import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Conflict, ValidationError } from "../domain/errors.js";
import {
  assertPublicationReceiptState,
  type PublicationReceipt,
  type PublicationStateFile,
} from "../domain/publication.js";
import { resolveProfilePaths } from "../bootstrap/profile.js";

const MAX_STATE_BYTES = 1_048_576;
const MAX_LOCK_BYTES = 4096;

export function publicationStatePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveProfilePaths(env).configDir, "publication.json");
}

export function publicationLockPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveProfilePaths(env).configDir, "publication.lock");
}

export function publicationCutoverPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveProfilePaths(env).configDir, "publication.cutover");
}

export interface PublicationCutover {
  workspaceId: string;
  publicationId: string;
  databasePath: string;
  cutOverAt: string;
}

/** A completed publication leaves the local database as a read-only backup. */
export function readPublicationCutover(env: NodeJS.ProcessEnv = process.env): PublicationCutover | undefined {
  const path = publicationCutoverPath(env);
  if (!existsSync(path)) return undefined;
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_LOCK_BYTES || (stat.mode & 0o077) !== 0) return undefined;
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<PublicationCutover>;
    if (typeof parsed.workspaceId !== "string" || typeof parsed.publicationId !== "string" ||
        typeof parsed.databasePath !== "string" || typeof parsed.cutOverAt !== "string") return undefined;
    return parsed as PublicationCutover;
  } catch {
    return undefined;
  }
}

export function markPublicationCutover(input: PublicationCutover, env: NodeJS.ProcessEnv = process.env): void {
  const path = publicationCutoverPath(env);
  privateDirectory(resolveProfilePaths(env).configDir);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const fd = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(fd, `${JSON.stringify(input, null, 2)}\n`);
      fsyncSync(fd);
    } finally { closeSync(fd); }
    renameSync(temporary, path);
    chmodSync(path, 0o600);
    flushDirectory(resolveProfilePaths(env).configDir);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function privateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
}

function flushDirectory(directory: string): void {
  const fd = openSync(directory, "r");
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

export function readPublicationState(env: NodeJS.ProcessEnv = process.env): PublicationStateFile | undefined {
  const path = publicationStatePath(env);
  if (!existsSync(path)) return undefined;
  let raw: string;
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_STATE_BYTES || (stat.mode & 0o077) !== 0) {
      throw new ValidationError("Publication state is not a bounded private file", { field: "publication", nextAction: "inspect_publication_state" });
    }
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError("Publication state could not be read", { field: "publication" });
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { parsed = undefined; }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ValidationError("Publication state is not strict JSON", { field: "publication" });
  }
  const file = parsed as Record<string, unknown>;
  if (file.version !== 1 || typeof file.receipt !== "object" || file.receipt === null) {
    throw new ValidationError("Unsupported publication state", { field: "publication" });
  }
  const receipt = assertPublicationReceiptState(file.receipt);
  let credentials: PublicationStateFile["credentials"];
  if (file.credentials !== undefined) {
    if (typeof file.credentials !== "object" || file.credentials === null) {
      throw new ValidationError("Publication credentials are invalid", { field: "publication.credentials" });
    }
    const value = file.credentials as Record<string, unknown>;
    if (typeof value.humanToken !== "string" || !/^cft_[a-f0-9]{32}$/.test(value.humanToken) ||
        typeof value.recoverySecret !== "string" || !/^cfr_[a-f0-9]{32}$/.test(value.recoverySecret) ||
        typeof value.agents !== "object" || value.agents === null || Array.isArray(value.agents)) {
      throw new ValidationError("Publication credentials are invalid", { field: "publication.credentials" });
    }
    const agents: Record<string, string> = {};
    for (const [harness, token] of Object.entries(value.agents as Record<string, unknown>)) {
      if (typeof token !== "string" || !/^cft_[a-f0-9]{32}$/.test(token)) {
        throw new ValidationError("Publication agent credential is invalid", { field: "publication.credentials" });
      }
      agents[harness] = token;
    }
    const rehearsalCode = value.rehearsalCode;
    if (rehearsalCode !== undefined &&
        (typeof rehearsalCode !== "string" || !/^cfrh_[A-Za-z0-9_-]{24,128}$/.test(rehearsalCode))) {
      throw new ValidationError("Publication rehearsal code is invalid", { field: "publication.credentials.rehearsalCode" });
    }
    credentials = {
      humanToken: value.humanToken,
      agents,
      recoverySecret: value.recoverySecret,
      ...(rehearsalCode === undefined ? {} : { rehearsalCode }),
    };
  }
  return { version: 1, receipt, ...(credentials === undefined ? {} : { credentials }) };
}

export function savePublicationState(state: PublicationStateFile, env: NodeJS.ProcessEnv = process.env): string {
  const path = publicationStatePath(env);
  const directory = resolveProfilePaths(env).configDir;
  privateDirectory(directory);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const fd = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(fd, `${JSON.stringify(state, null, 2)}\n`);
      fsyncSync(fd);
    } finally { closeSync(fd); }
    renameSync(temporary, path);
    chmodSync(path, 0o600);
    flushDirectory(directory);
    return path;
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function updatePublicationReceipt(receipt: PublicationReceipt, env: NodeJS.ProcessEnv = process.env): PublicationStateFile {
  const existing = readPublicationState(env);
  const state: PublicationStateFile = {
    version: 1,
    receipt,
    ...(existing?.credentials === undefined ? {} : { credentials: existing.credentials }),
  };
  savePublicationState(state, env);
  return state;
}

export function setPublicationCredentials(
  credentials: NonNullable<PublicationStateFile["credentials"]>,
  env: NodeJS.ProcessEnv = process.env,
): PublicationStateFile {
  const existing = readPublicationState(env);
  if (existing === undefined) {
    throw new ValidationError("Publication state is missing; rerun campfire publish", { field: "publication" });
  }
  const state: PublicationStateFile = { ...existing, credentials };
  savePublicationState(state, env);
  return state;
}

export interface PublicationLock {
  workspaceId: string;
  publicationId: string;
  databasePath: string;
  pid: number;
  acquiredAt: string;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function readPublicationLock(env: NodeJS.ProcessEnv = process.env): PublicationLock | undefined {
  const path = publicationLockPath(env);
  if (!existsSync(path)) return undefined;
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_LOCK_BYTES || (stat.mode & 0o077) !== 0) return undefined;
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<PublicationLock>;
    if (typeof parsed.workspaceId !== "string" || typeof parsed.publicationId !== "string" ||
        typeof parsed.databasePath !== "string" || typeof parsed.pid !== "number" ||
        typeof parsed.acquiredAt !== "string") return undefined;
    return parsed as PublicationLock;
  } catch {
    return undefined;
  }
}

/**
 * Held for the snapshot → import → verify → cutover window. Supported local
 * writes fail closed while it exists. A stale lock from a dead process is
 * recoverable, but an active lock for a different publication is a conflict.
 */
export function acquirePublicationLock(input: Omit<PublicationLock, "pid" | "acquiredAt">, env: NodeJS.ProcessEnv = process.env): PublicationLock {
  const path = publicationLockPath(env);
  privateDirectory(resolveProfilePaths(env).configDir);
  const write = (): PublicationLock => {
    const lock: PublicationLock = { ...input, pid: process.pid, acquiredAt: new Date().toISOString() };
    const fd = openSync(path, "wx", 0o600);
    try {
      writeFileSync(fd, `${JSON.stringify(lock, null, 2)}\n`);
      fsyncSync(fd);
    } finally { closeSync(fd); }
    flushDirectory(resolveProfilePaths(env).configDir);
    return lock;
  };
  try {
    return write();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const current = readPublicationLock(env);
  if (current !== undefined && current.pid !== process.pid && processAlive(current.pid)) {
    throw new Conflict("Another publication is active for this Campfire profile", {
      field: "publication",
      nextAction: "wait_or_resume_publish",
      workspaceId: current.workspaceId,
    });
  }
  if (current !== undefined && current.publicationId !== input.publicationId && processAlive(current.pid)) {
    throw new Conflict("A different publication is active for this Campfire profile", {
      field: "publication",
      nextAction: "resume_or_abandon_publication",
    });
  }
  try { unlinkSync(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return write();
}

export function releasePublicationLock(publicationId: string, env: NodeJS.ProcessEnv = process.env): void {
  const current = readPublicationLock(env);
  if (current === undefined || current.publicationId !== publicationId) return;
  if (current.pid !== process.pid) return;
  rmSync(publicationLockPath(env), { force: true });
}

/** Methods that can mutate local collaboration state. Read-only methods stay usable. */
const READ_ONLY_METHODS = new Set([
  "preflight", "whoami", "list_workspaces", "get_workspace", "get_workspace_context",
  "get_workspace_changes", "recall_workspace", "project_handoff_packet", "list_decisions",
  "list_findings", "list_tasks", "list_artifacts", "get_decision", "get_finding", "get_task",
  "get_artifact", "get_activity", "list_workspace_participants", "get_record_history",
  "get_action_proposal", "list_action_proposals", "list_action_receipts",
]);

export function isPublicationBlockedMethod(method: string): boolean {
  return !READ_ONLY_METHODS.has(method);
}

/**
 * Called by supported local write surfaces before dispatch. A missing lock is
 * the normal case. A lock on another database is irrelevant to this one.
 */
export function assertLocalWritesAllowed(databasePath: string, env: NodeJS.ProcessEnv = process.env): void {
  const lock = readPublicationLock(env);
  if (lock !== undefined && lock.databasePath === databasePath) {
    throw new Conflict("Local writes are frozen while this workspace is being published", {
      field: "publication",
      nextAction: "wait_or_resume_publish",
      workspaceId: lock.workspaceId,
    });
  }
  const cutover = readPublicationCutover(env);
  if (cutover !== undefined && cutover.databasePath === databasePath) {
    throw new Conflict("This local database is the read-only backup of a published workspace", {
      field: "publication",
      nextAction: "use_remote_profile",
      workspaceId: cutover.workspaceId,
    });
  }
}

export function formatPublicationReceipt(receipt: PublicationReceipt): string {
  const lines = [
    `Publication ${receipt.state.replace(/_/g, " ")}.`,
    "",
    `  Workspace  ${receipt.workspaceName} (${receipt.workspaceId})`,
    `  Hosted at  ${receipt.endpoint}`,
    `  Owner      ${receipt.owner.displayName}`,
    `  Source tip ${receipt.sourceTip}`,
    `  Digest     ${receipt.snapshotDigest.slice(0, 12)}…`,
  ];
  if (receipt.agents.length > 0) {
    lines.push(`  Agents     ${receipt.agents.map((agent) => `${agent.name} (${agent.harness})`).join(", ")}`);
  }
  lines.push("", `Next: ${receipt.nextAction}`);
  return lines.join("\n");
}
