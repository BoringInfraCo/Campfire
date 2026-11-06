/**
 * Private launch registry.
 *
 * Parent directory is 0700 and record files are 0600. Writes are atomic
 * rename onto a file we created. Symlinks are never followed. The serializer
 * is an allowlist: no credential, prompt, transcript, terminal bytes, or
 * child environment can be stored by a later field add without changing it.
 */
import { randomBytes, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { resolveProfilePaths } from "../bootstrap/profile.js";
import { ValidationError } from "../domain/errors.js";
import type { FailureKind, LaunchMode, LaunchRecord, LocalLaunchState, SupportedHarness } from "./types.js";

const MAX_RECORD_BYTES = 16 * 1024;
const LAUNCH_ID = /^lch_[a-f0-9]{32}$/;
const CREDENTIAL_MARKERS = ["cft_", "sk-", "BEGIN PRIVATE", "BEGIN OPENSSH", "CAMPFIRE_TOKEN="];

export class RegistryFault extends Error {
  constructor(
    readonly kind: "corrupt" | "symlink" | "insecure",
    readonly launchId: string,
  ) {
    super(`Launch record ${launchId} is ${kind}`);
    this.name = "RegistryFault";
  }
}

export function createLaunchId(): string {
  return `lch_${randomBytes(16).toString("hex")}`;
}

export function registryDirectory(env: NodeJS.ProcessEnv): string {
  return join(resolveProfilePaths(env).dataDir, "session-host");
}

function ownerUid(): number {
  return typeof process.getuid === "function" ? process.getuid() : 0;
}

/**
 * Create or reopen the registry. A symlinked directory is refused so a
 * planted link cannot redirect private records.
 */
export function ensureRegistry(env: NodeJS.ProcessEnv): string {
  const paths = resolveProfilePaths(env);
  mkdirSync(paths.dataDir, { recursive: true, mode: 0o700 });
  chmodSync(paths.dataDir, 0o700);
  const root = registryDirectory(env);
  try {
    const existing = lstatSync(root);
    if (existing.isSymbolicLink()) {
      throw new ValidationError("Session registry directory is a symlink. Refusing to follow it.", {
        field: "registry",
        nextAction: "remove_session_registry_symlink",
      });
    }
    if (!existing.isDirectory()) {
      throw new ValidationError("Session registry path is not a directory.", { field: "registry" });
    }
    if (existing.uid !== ownerUid() && ownerUid() !== 0) {
      throw new ValidationError("Session registry directory is not owned by this user.", { field: "registry" });
    }
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw new ValidationError("Session registry directory could not be opened.", { field: "registry" });
    }
    mkdirSync(root, { recursive: true, mode: 0o700 });
  }
  chmodSync(root, 0o700);
  const checked = lstatSync(root);
  if (checked.isSymbolicLink() || !checked.isDirectory() || (checked.mode & 0o077) !== 0) {
    throw new ValidationError("Session registry directory is not a private directory.", { field: "registry" });
  }
  return root;
}

export function recordPath(root: string, launchId: string): string {
  if (!LAUNCH_ID.test(launchId)) {
    throw new ValidationError("Launch id is invalid.", { field: "launchId" });
  }
  return join(root, `${launchId}.json`);
}

export function launcherPath(root: string, launchId: string): string {
  if (!LAUNCH_ID.test(launchId)) {
    throw new ValidationError("Launch id is invalid.", { field: "launchId" });
  }
  return join(root, "launchers", `${launchId}.command`);
}

export function lockPath(root: string, launchId: string): string {
  if (!LAUNCH_ID.test(launchId)) {
    throw new ValidationError("Launch id is invalid.", { field: "launchId" });
  }
  return join(root, "locks", `${launchId}.lock`);
}

function assertPrivateFile(path: string, launchId: string): void {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    throw new ValidationError("Launch record was not found.", { field: "launchId", launchId });
  }
  if (stat.isSymbolicLink()) throw new RegistryFault("symlink", launchId);
  if (!stat.isFile() || stat.size === 0 || stat.size > MAX_RECORD_BYTES) throw new RegistryFault("corrupt", launchId);
  if ((stat.mode & 0o077) !== 0) throw new RegistryFault("insecure", launchId);
  if (stat.uid !== ownerUid() && ownerUid() !== 0) throw new RegistryFault("insecure", launchId);
}

function looksCredentialLike(raw: string): boolean {
  return CREDENTIAL_MARKERS.some((marker) => raw.includes(marker));
}

const FAILURE_KINDS = new Set<FailureKind>([
  "spawn_failed",
  "signal",
  "nonzero_exit",
  "wrapper_lost",
  "missing_executable",
  "control_unavailable",
]);

const STATES = new Set<LocalLaunchState>([
  "prepared",
  "starting",
  "running",
  "stopping",
  "exited",
  "failed",
  "control_lost",
]);

const HARNESSES = new Set<SupportedHarness>(["codex", "claude-code", "opencode"]);
const MODES = new Set<LaunchMode>(["external", "copy", "embedded"]);

function requiredString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || value.length === 0 || value.length > 4096) {
    throw new RegistryFault("corrupt", "record");
  }
  return value;
}

function parseRecord(raw: string, launchId: string): LaunchRecord {
  if (looksCredentialLike(raw)) throw new RegistryFault("corrupt", launchId);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new RegistryFault("corrupt", launchId);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new RegistryFault("corrupt", launchId);
  }
  const record = parsed as Record<string, unknown>;
  if (record.version !== 1) throw new RegistryFault("corrupt", launchId);
  const harness = requiredString(record, "harness");
  const launchMode = requiredString(record, "launchMode");
  const localState = requiredString(record, "localState");
  if (!HARNESSES.has(harness as SupportedHarness) || !MODES.has(launchMode as LaunchMode) || !STATES.has(localState as LocalLaunchState)) {
    throw new RegistryFault("corrupt", launchId);
  }
  const launch: LaunchRecord = {
    version: 1,
    launchId: requiredString(record, "launchId"),
    workspaceId: requiredString(record, "workspaceId"),
    taskId: requiredString(record, "taskId"),
    agentId: requiredString(record, "agentId"),
    humanId: requiredString(record, "humanId"),
    harness: harness as SupportedHarness,
    repositoryRoot: requiredString(record, "repositoryRoot"),
    launchMode: launchMode as LaunchMode,
    createdAt: requiredString(record, "createdAt"),
    expiresAt: requiredString(record, "expiresAt"),
    localState: localState as LocalLaunchState,
  };
  if (launch.launchId !== launchId) throw new RegistryFault("corrupt", launchId);
  if (typeof record.worktreePath === "string") launch.worktreePath = record.worktreePath;
  if (typeof record.wrapperStartMarker === "string") launch.wrapperStartMarker = record.wrapperStartMarker;
  if (typeof record.privateControlSocket === "string") launch.privateControlSocket = record.privateControlSocket;
  if (typeof record.coreSessionId === "string") launch.coreSessionId = record.coreSessionId;
  if (typeof record.finalizedAt === "string") launch.finalizedAt = record.finalizedAt;
  if (record.reporting === "ok" || record.reporting === "offline") launch.reporting = record.reporting;
  if (typeof record.wrapperPid === "number" && Number.isInteger(record.wrapperPid) && record.wrapperPid > 0) {
    launch.wrapperPid = record.wrapperPid;
  }
  if (typeof record.lastSequence === "number" && Number.isInteger(record.lastSequence) && record.lastSequence >= 0) {
    launch.lastSequence = record.lastSequence;
  }
  if (typeof record.exitCode === "number" && Number.isInteger(record.exitCode) && record.exitCode >= 0 && record.exitCode <= 255) {
    launch.exitCode = record.exitCode;
  }
  if (typeof record.failureKind === "string" && FAILURE_KINDS.has(record.failureKind as FailureKind)) {
    launch.failureKind = record.failureKind as FailureKind;
  }
  return launch;
}

export function readLaunchRecord(env: NodeJS.ProcessEnv, launchId: string): LaunchRecord {
  const root = ensureRegistry(env);
  const path = recordPath(root, launchId);
  assertPrivateFile(path, launchId);
  const raw = readFileSync(path, "utf8");
  try {
    return parseRecord(raw, launchId);
  } catch (error) {
    if (error instanceof RegistryFault) {
      throw new RegistryFault(error.kind, launchId);
    }
    throw new RegistryFault("corrupt", launchId);
  }
}

function serialize(record: LaunchRecord): string {
  const body: Record<string, unknown> = {
    version: 1,
    launchId: record.launchId,
    workspaceId: record.workspaceId,
    taskId: record.taskId,
    agentId: record.agentId,
    humanId: record.humanId,
    harness: record.harness,
    repositoryRoot: record.repositoryRoot,
    launchMode: record.launchMode,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    localState: record.localState,
  };
  if (record.worktreePath !== undefined) body.worktreePath = record.worktreePath;
  if (record.wrapperPid !== undefined) body.wrapperPid = record.wrapperPid;
  if (record.wrapperStartMarker !== undefined) body.wrapperStartMarker = record.wrapperStartMarker;
  if (record.privateControlSocket !== undefined) body.privateControlSocket = record.privateControlSocket;
  if (record.coreSessionId !== undefined) body.coreSessionId = record.coreSessionId;
  if (record.exitCode !== undefined) body.exitCode = record.exitCode;
  if (record.failureKind !== undefined) body.failureKind = record.failureKind;
  if (record.finalizedAt !== undefined) body.finalizedAt = record.finalizedAt;
  if (record.lastSequence !== undefined) body.lastSequence = record.lastSequence;
  if (record.reporting !== undefined) body.reporting = record.reporting;
  return `${JSON.stringify(body)}\n`;
}

export function writeLaunchRecord(env: NodeJS.ProcessEnv, record: LaunchRecord): void {
  const root = ensureRegistry(env);
  const path = recordPath(root, record.launchId);
  let existing: ReturnType<typeof lstatSync> | undefined;
  try {
    existing = lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new ValidationError("Launch record could not be replaced.", { field: "launchId" });
    }
  }
  if (existing?.isSymbolicLink()) throw new RegistryFault("symlink", record.launchId);
  const payload = serialize(record);
  if (Buffer.byteLength(payload) > MAX_RECORD_BYTES || looksCredentialLike(payload)) {
    throw new ValidationError("Launch record was refused.", { field: "launchId" });
  }
  const temporary = join(root, `.${record.launchId}.${randomUUID()}.tmp`);
  const fd = openSync(temporary, "wx", 0o600);
  try {
    writeSync(fd, payload);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  chmodSync(temporary, 0o600);
  try {
    renameSync(temporary, path);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      // The temporary name is removed on the next successful write's directory.
    }
    throw error;
  }
  chmodSync(path, 0o600);
  const written = lstatSync(path);
  if (written.isSymbolicLink() || !written.isFile() || (written.mode & 0o077) !== 0) {
    throw new ValidationError("Launch record was not stored as a private file.", { field: "launchId" });
  }
}

export interface RegistryEntryFault {
  launchId: string;
  kind: "corrupt" | "symlink" | "insecure";
}

export function listRegistryEntries(env: NodeJS.ProcessEnv): { records: LaunchRecord[]; faults: RegistryEntryFault[] } {
  const root = ensureRegistry(env);
  const records: LaunchRecord[] = [];
  const faults: RegistryEntryFault[] = [];
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    throw new ValidationError("Session registry could not be listed.", { field: "registry" });
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const launchId = name.slice(0, -".json".length);
    if (!LAUNCH_ID.test(launchId)) {
      faults.push({ launchId: "unreadable", kind: "corrupt" });
      continue;
    }
    try {
      records.push(readLaunchRecord(env, launchId));
    } catch (error) {
      if (error instanceof RegistryFault) faults.push({ launchId, kind: error.kind });
      else faults.push({ launchId, kind: "corrupt" });
    }
  }
  return { records, faults };
}

export function removeLaunchFiles(env: NodeJS.ProcessEnv, launchId: string): void {
  const root = ensureRegistry(env);
  for (const path of [recordPath(root, launchId), launcherPath(root, launchId), lockPath(root, launchId)]) {
    let stat;
    try {
      stat = lstatSync(path);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) throw new RegistryFault("symlink", launchId);
    if (stat.isFile()) unlinkSync(path);
  }
}

export function ensurePrivateDir(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}
