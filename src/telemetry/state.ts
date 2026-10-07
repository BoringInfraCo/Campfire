/**
 * Local telemetry identity and preferences (TEL-001B).
 *
 * One non-secret file, `telemetry.json`, inside the existing Campfire config
 * directory. It is kept separate from `config.json` because `loadAnyProfile`
 * validates a closed profile shape: adding a field there would require a profile
 * version bump and would silently drop the field on the next read-modify-write.
 * The enrolment receipt files already establish the convention of a small,
 * purpose-named state file in `configDir`.
 *
 * Nothing in this file is a credential and nothing is machine-derived. The
 * installation id is a random UUIDv4 produced locally (TEL-001 section 10): it
 * is never built from a username, hostname, MAC address, machine serial, IP
 * address, Git identity, or any hardware fingerprint. It identifies an
 * *installation*, never a person.
 */
import { randomUUID } from "node:crypto";
import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveProfilePaths } from "../bootstrap/profile.js";
import { isTelemetryInstallationId } from "./contract.js";

/** Environment override, following the existing `CAMPFIRE_*` naming convention. */
export const TELEMETRY_ENV_VAR = "CAMPFIRE_TELEMETRY";

export const TELEMETRY_STATE_VERSION = 1 as const;

export interface TelemetryState {
  version: typeof TELEMETRY_STATE_VERSION;
  /** Random local installation UUID. Preserved across ordinary upgrades. */
  installationId: string;
  /** Absent means "not decided yet", which resolves to enabled. */
  enabled?: boolean;
  installCompletedReported?: boolean;
  /** UTC day (`YYYY-MM-DD`) of the single `activated` event, if already emitted. */
  activatedOn?: string;
  /** UTC day of the most recent `active` event, for local rate limiting. */
  lastActiveOn?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalBoolean(record: Record<string, unknown>, field: string): boolean | undefined {
  const value = record[field];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") return undefined;
  return value;
}

function optionalDay(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field];
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  return value;
}

/**
 * Atomic, world-readable write. Telemetry state is not secret, but it must not
 * be truncated by an interrupted write: a lost installation id would silently
 * restart the deduplication window, so the file is written to a temporary path,
 * fsynced, and renamed.
 */
function writeTelemetryState(path: string, state: TelemetryState): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  let fd: number | undefined;
  try {
    fd = openSync(temporary, "wx", 0o644);
    writeFileSync(fd, `${JSON.stringify(state, null, 2)}\n`);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, path);
    chmodSync(path, 0o644);
  } finally {
    if (fd !== undefined) closeSync(fd);
    rmSync(temporary, { force: true });
  }
}

export function telemetryStatePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveProfilePaths(env).configDir, "telemetry.json");
}

/**
 * Read the state file. A missing file is "no installation yet", not an error:
 * a fresh install and a first `telemetry status` must both work before anything
 * has been written. A corrupt file is treated as absent so telemetry can never
 * block Campfire (TEL-001 section 12).
 */
export function loadTelemetryState(env: NodeJS.ProcessEnv = process.env): TelemetryState | undefined {
  const path = telemetryStatePath(env);
  if (!existsSync(path)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  if (!isTelemetryInstallationId(parsed.installationId)) return undefined;
  const state: TelemetryState = {
    version: TELEMETRY_STATE_VERSION,
    installationId: parsed.installationId,
  };
  const enabled = optionalBoolean(parsed, "enabled");
  if (enabled !== undefined) state.enabled = enabled;
  const completed = optionalBoolean(parsed, "installCompletedReported");
  if (completed !== undefined) state.installCompletedReported = completed;
  const activatedOn = optionalDay(parsed, "activatedOn");
  if (activatedOn !== undefined) state.activatedOn = activatedOn;
  const lastActiveOn = optionalDay(parsed, "lastActiveOn");
  if (lastActiveOn !== undefined) state.lastActiveOn = lastActiveOn;
  return state;
}

function saveTelemetryState(state: TelemetryState, env: NodeJS.ProcessEnv): void {
  writeTelemetryState(telemetryStatePath(env), state);
}

export interface ResolvedTelemetryPreference {
  enabled: boolean;
  source: "env" | "preference" | "default";
}

/**
 * Resolve whether runtime telemetry may send product events.
 *
 * Precedence, matching Campfire's flag/env/file convention:
 *   1. `CAMPFIRE_TELEMETRY` — an explicit, per-invocation override for CI and
 *      automation. Highest precedence so a CI job can guarantee silence without
 *      mutating operator state.
 *   2. the recorded `telemetry.json` preference (`campfire telemetry`).
 *   3. enabled — the default is opt-out, and `status` shows it explicitly.
 */
export function resolveTelemetryPreference(
  env: NodeJS.ProcessEnv = process.env,
): ResolvedTelemetryPreference {
  const override = env[TELEMETRY_ENV_VAR]?.trim().toLowerCase();
  if (override !== undefined && override.length > 0) {
    if (override === "0" || override === "off" || override === "false" || override === "no") {
      return { enabled: false, source: "env" };
    }
    if (override === "1" || override === "on" || override === "true" || override === "yes") {
      return { enabled: true, source: "env" };
    }
  }
  const state = loadTelemetryState(env);
  if (state?.enabled !== undefined) return { enabled: state.enabled, source: "preference" };
  return { enabled: true, source: "default" };
}

export function isTelemetryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveTelemetryPreference(env).enabled;
}

export function setTelemetryEnabled(enabled: boolean, env: NodeJS.ProcessEnv = process.env): TelemetryState {
  const state = loadTelemetryState(env) ?? createInstallationState(env);
  const next: TelemetryState = { ...state, enabled };
  saveTelemetryState(next, env);
  return next;
}

/**
 * Create the installation state with a fresh random UUID.
 *
 * Persisting the id (rather than deriving it) is what makes an ordinary upgrade
 * or reinstall preserve identity while a genuinely clean installation — an
 * absent state file — produces a new one. `randomUUID` is a CSPRNG over 122 bits
 * of entropy and reads nothing about the machine or its user.
 */
function createInstallationState(env: NodeJS.ProcessEnv): TelemetryState {
  const state: TelemetryState = {
    version: TELEMETRY_STATE_VERSION,
    installationId: randomUUID(),
  };
  saveTelemetryState(state, env);
  return state;
}

/**
 * The anonymous installation id, creating and persisting one on first use.
 * Stable for the life of the local profile.
 */
export function ensureInstallationId(env: NodeJS.ProcessEnv = process.env): string {
  const existing = loadTelemetryState(env);
  if (existing !== undefined) return existing.installationId;
  return createInstallationState(env).installationId;
}

/** UTC day key. The return metric is defined across UTC days, not local days. */
export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Claim the one-time `activated` event. Returns true only for the first caller
 * on an installation, and records the day locally even if delivery later fails:
 * activation is a statement about the installation, not about the network.
 */
export function claimActivation(env: NodeJS.ProcessEnv = process.env, now: Date = new Date()): string {
  const state = loadTelemetryState(env) ?? createInstallationState(env);
  if (state.activatedOn !== undefined) return "";
  const day = utcDay(now);
  saveTelemetryState({ ...state, activatedOn: day }, env);
  return state.installationId;
}

/**
 * Claim a rate-limited `active` event. Bounded to one per installation per UTC
 * day, so an agent loop or a Viewer poll cannot create event spam and a daily
 * active-installation count is exact rather than sampled.
 */
export function claimActiveEvent(env: NodeJS.ProcessEnv = process.env, now: Date = new Date()): string {
  const state = loadTelemetryState(env) ?? createInstallationState(env);
  const day = utcDay(now);
  if (state.lastActiveOn === day) return "";
  saveTelemetryState({ ...state, lastActiveOn: day }, env);
  return state.installationId;
}

/** Claim the one-time `install_completed` report emitted by the CLI installer path. */
export function claimInstallCompleted(env: NodeJS.ProcessEnv = process.env): string {
  const state = loadTelemetryState(env) ?? createInstallationState(env);
  if (state.installCompletedReported === true) return "";
  saveTelemetryState({ ...state, installCompletedReported: true }, env);
  return state.installationId;
}