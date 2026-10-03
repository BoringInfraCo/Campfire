/**
 * Telemetry reporting entry points (TEL-001C/E).
 *
 * Every public function here is total: it resolves rather than throws, writes
 * no files outside the local config directory, and never rejects. Callers wire
 * them to fire-and-forget paths so the surrounding Campfire operation cannot be
 * delayed, failed, or rolled back by measurement.
 *
 * Endpoint resolution is operator-controlled and validated with the same
 * endpoint rules as the rest of Campfire: HTTPS, except loopback HTTP for local
 * testing. An unset endpoint disables delivery rather than defaulting to a
 * hard-coded host, so a fork or an offline install never reports anywhere.
 */
import { canonicalEndpoint } from "../bootstrap/endpoint.js";
import { installedCampfireVersion } from "../bootstrap/version.js";
import type { TelemetryEventName, TelemetrySurface } from "./contract.js";
import { postTelemetryEvent } from "./post.js";
import {
  claimActivation,
  claimActiveEvent,
  claimInstallCompleted,
  ensureInstallationId,
  isTelemetryEnabled,
} from "./state.js";

export const TELEMETRY_ENDPOINT_ENV_VAR = "CAMPFIRE_TELEMETRY_URL";

export interface TelemetryTarget {
  endpoint: string;
  installationId: string;
  campfireVersion: string;
  os: string;
  arch: string;
}

export interface TelemetryReportOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: Date;
}

/** The version is read from disk and can throw in an unusual layout; telemetry must not. */
function safeVersion(): string {
  try {
    return installedCampfireVersion();
  } catch {
    return "unknown";
  }
}

/**
 * The documented production ingestion endpoint, as a fallback for the operator
 * override. Overridable so local and staged deployments report elsewhere.
 */
export const DEFAULT_TELEMETRY_ENDPOINT =
  "https://boringinfra.company/campfire/v1/telemetry";

/**
 * Resolve everything a send needs, or return undefined when delivery must not
 * happen: telemetry disabled, no endpoint configured, or an endpoint that fails
 * validation. An invalid endpoint disables delivery; it is never repaired by
 * guessing a different host.
 */
export function resolveTelemetryTarget(
  options: TelemetryReportOptions & { env?: NodeJS.ProcessEnv } = {},
): TelemetryTarget | undefined {
  const env = options.env ?? process.env;
  if (!isTelemetryEnabled(env)) return undefined;
  const configured = env[TELEMETRY_ENDPOINT_ENV_VAR]?.trim();
  const raw = configured !== undefined && configured.length > 0
    ? configured
    : DEFAULT_TELEMETRY_ENDPOINT;
  let endpoint: string;
  try {
    endpoint = canonicalEndpoint(raw, { allowLoopbackHttp: true });
  } catch {
    return undefined;
  }
  return {
    endpoint,
    installationId: ensureInstallationId(env),
    campfireVersion: safeVersion(),
    os: process.platform,
    arch: process.arch,
  };
}

/**
 * Report one event. Returns undefined when nothing was sent, which is the normal
 * case for a disabled installation and is not an error.
 */
export async function reportTelemetryEvent(
  event: TelemetryEventName,
  extra: { installMethod?: "curl"; surface?: TelemetrySurface },
  options: TelemetryReportOptions = {},
): Promise<{ ok: boolean; error?: string } | undefined> {
  const target = resolveTelemetryTarget(options);
  if (target === undefined) return undefined;
  const result = await postTelemetryEvent({
    endpoint: target.endpoint,
    event,
    installationId: target.installationId,
    campfireVersion: target.campfireVersion,
    os: target.os,
    arch: target.arch,
    installMethod: extra.installMethod,
    surface: extra.surface,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
  });
  return result;
}

/**
 * First meaningful Campfire use. Fires at most once per installation, tracked
 * locally, so a repeated command or a reinstall cannot inflate activation.
 */
export async function reportActivated(
  surface: TelemetrySurface,
  options: TelemetryReportOptions = {},
): Promise<void> {
  const env = options.env ?? process.env;
  if (!isTelemetryEnabled(env)) return;
  const installationId = claimActivation(env, options.now ?? new Date());
  if (installationId === "") return;
  await reportTelemetryEvent("activated", { surface }, { ...options, env });
}

/**
 * Meaningful use after activation, bounded locally to one event per installation
 * per UTC day. This is what makes daily active-installation counts exact and
 * keeps an agent loop or a polling Viewer from creating event spam.
 */
export async function reportActive(
  surface: TelemetrySurface,
  options: TelemetryReportOptions = {},
): Promise<void> {
  const env = options.env ?? process.env;
  if (!isTelemetryEnabled(env)) return;
  const installationId = claimActiveEvent(env, options.now ?? new Date());
  if (installationId === "") return;
  await reportTelemetryEvent("active", { surface }, { ...options, env });
}

/**
 * A successful local install. The official curl installer performs its own
 * best-effort POST from `install.sh`; this is the equivalent for a CLI-side
 * completion, and both are locally claimed so one installation reports once.
 */
export async function reportInstallCompleted(
  options: TelemetryReportOptions = {},
): Promise<void> {
  const env = options.env ?? process.env;
  if (!isTelemetryEnabled(env)) return;
  const installationId = claimInstallCompleted(env);
  if (installationId === "") return;
  await reportTelemetryEvent("install_completed", { installMethod: "curl" }, { ...options, env });
}

/**
 * Attach to a Campfire success boundary without changing its result.
 *
 * The returned promise is deliberately not awaited by callers: measurement is
 * fire-and-forget, and a slow or dead endpoint must not extend the command that
 * succeeded. `void` on the call site documents that.
 */
export function telemetryInBackground(promise: Promise<unknown>): void {
  void promise.catch(() => undefined);
}