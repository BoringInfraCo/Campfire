/**
 * Anonymous product telemetry contract (TEL-001).
 *
 * This module is the whole privacy boundary. Every telemetry payload in Campfire
 * is constructed by `serializeTelemetryEvent`, which copies named fields out of
 * a fixed allow-list. It never spreads a Campfire domain object, a command
 * argument, an error message, or an environment value into the payload. A field
 * that is not named here cannot leave the machine.
 *
 * Deliberately excluded forever (TEL-001 section 4 and 11): prompts, messages,
 * code, diffs, artifact/finding/decision/goal/task contents, file paths,
 * repository names, branch names, remote URLs, credentials, tokens, hostnames,
 * email addresses, usernames, and precise location. `PROHIBITED_FIELD_NAMES`
 * is the machine-readable form of that list and is asserted against the
 * allow-list so a future field cannot silently reintroduce one of them.
 *
 * Field positions are stable. Analytics Engine queries blobs by position and
 * allows only one sampling index, so appending a dimension later is safe;
 * reordering is not. The stored layout is `telemetryDataPoint`.
 */

/** Current wire contract. A payload declaring another version is rejected, not coerced. */
export const TELEMETRY_SCHEMA_VERSION = 1 as const;

/**
 * The closed event vocabulary. `install_requested` and `install_completed` are
 * deliberately separate: a fetch of the installer is interest, a completed
 * install is success, and TEL-001 forbids combining them (section 20, rule 2).
 */
export const TELEMETRY_EVENTS = [
  "install_requested",
  "install_completed",
  "activated",
  "active",
] as const;

export type TelemetryEventName = (typeof TELEMETRY_EVENTS)[number];

const TELEMETRY_EVENT_SET: ReadonlySet<string> = new Set(TELEMETRY_EVENTS);

export function isTelemetryEventName(value: unknown): value is TelemetryEventName {
  return typeof value === "string" && TELEMETRY_EVENT_SET.has(value);
}

/** The only install method Campfire ships. */
export const TELEMETRY_INSTALL_METHODS = ["curl"] as const;
export type TelemetryInstallMethod = (typeof TELEMETRY_INSTALL_METHODS)[number];

/**
 * Where an event was produced. This is a fixed vocabulary, not a free string,
 * so a harness name or command name can never become a dimension.
 */
export const TELEMETRY_SURFACES = ["cli", "agent", "mcp"] as const;
export type TelemetrySurface = (typeof TELEMETRY_SURFACES)[number];

/**
 * Normalized platform vocabulary, matching `public/campfire/install.sh` so the
 * client and the installer report the same strings for the same machine.
 * Anything outside the allow-list becomes `unknown` rather than being sent raw.
 */
export function normalizeTelemetryOs(platform: string): string {
  if (platform === "darwin" || platform === "linux" || platform === "win32") return platform;
  return "unknown";
}

/** Same normalization as the installer: `aarch64`/`amd64` collapse to the release names. */
export function normalizeTelemetryArch(arch: string): string {
  if (arch === "arm64" || arch === "aarch64") return "arm64";
  if (arch === "x64" || arch === "amd64") return "x64";
  return "unknown";
}

/** Bounded so a hostile or broken client cannot inflate the stored dimension. */
const OS_MAX_CHARS = 16;
const ARCH_MAX_CHARS = 16;
const VERSION_MAX_CHARS = 32;

/**
 * The first release that contained any telemetry code at all (v1.9.1,
 * published 2026-10-03). Telemetry shipped whole-clique in that release: the
 * client library, the event contract, and this ingestion route were all added
 * together, so a binary whose `package.json` reads below this version has no
 * telemetry code in it and is therefore incapable of emitting a schema-v1 event
 * by any route.
 *
 * That makes a sub-floor `campfireVersion` a *provable* forgery rather than a
 * suspicious-looking one, and it is checkable on the server for free: no state,
 * no per-client bookkeeping, nothing to evade by rotating source addresses. It
 * was added after the v1.2.0 stream showed up in production — several hundred
 * `install_completed` rows per day, each under a distinct installation id,
 * carrying no downstream event, that bore no relationship to any real usage.
 *
 * The floor is deliberately *not* a general version validator. It rejects only
 * what is provably impossible, so it can never discard a legitimate event from
 * a build newer than the contract itself.
 */
export const TELEMETRY_MIN_REPORTING_VERSION = "1.9.1";

const SEMVER_TRIPLE = /^(\d+)\.(\d+)\.(\d+)/;

/**
 * True only for a version that parses as semver *and* sorts strictly below
 * `TELEMETRY_MIN_REPORTING_VERSION`.
 *
 * A value that does not parse (`unknown`, a build string, a local checkout
 * version) returns false and is allowed through. Absence of proof is not proof
 * of forgery: this filter drops what is impossible, and declines to guess about
 * what merely looks unusual. Compare the triple numerically rather than
 * lexically so `1.10.0` correctly sorts above `1.9.1`.
 */
export function isTelemetryVersionBelowFloor(campfireVersion: string): boolean {
  const parsed = SEMVER_TRIPLE.exec(campfireVersion.trim());
  const floor = SEMVER_TRIPLE.exec(TELEMETRY_MIN_REPORTING_VERSION);
  if (parsed === null || floor === null) return false;
  const observed = [parsed[1], parsed[2], parsed[3]].map(Number);
  const minimum = [floor[1], floor[2], floor[3]].map(Number);
  for (let index = 0; index < 3; index += 1) {
    const seen = observed[index] ?? 0;
    const least = minimum[index] ?? 0;
    if (seen !== least) return seen < least;
  }
  return false;
}

export interface TelemetryEventV1 {
  schemaVersion: typeof TELEMETRY_SCHEMA_VERSION;
  event: TelemetryEventName;
  /** Random local installation UUID. Never derived from a person or a machine. */
  installationId: string;
  campfireVersion: string;
  os: string;
  arch: string;
  installMethod?: TelemetryInstallMethod;
  surface?: TelemetrySurface;
}

/**
 * Machine-readable prohibited content. This list is asserted disjoint from
 * `TELEMETRY_FIELDS`; a change that overlaps fails the privacy test rather than
 * shipping a payload field named after workspace content.
 */
export const PROHIBITED_FIELD_NAMES = [
  "ip",
  "ipAddress",
  "address",
  "location",
  "latitude",
  "longitude",
  "city",
  "country",
  "name",
  "displayName",
  "humanName",
  "email",
  "username",
  "user",
  "handle",
  "org",
  "organization",
  "team",
  "project",
  "repo",
  "repository",
  "branch",
  "url",
  "remoteUrl",
  "workspace",
  "workspaceId",
  "workspaceName",
  "path",
  "file",
  "filename",
  "hostname",
  "host",
  "machine",
  "fingerprint",
  "serial",
  "mac",
  "git",
  "prompt",
  "message",
  "messages",
  "code",
  "diff",
  "content",
  "body",
  "text",
  "goal",
  "task",
  "finding",
  "decision",
  "artifact",
  "contribution",
  "command",
  "args",
  "arguments",
  "token",
  "secret",
  "key",
  "apiKey",
  "password",
  "credential",
] as const;

/**
 * The complete allow-list. Nothing else is ever serialized. This is the payload
 * vocabulary, not Analytics Engine indexes: AE allows one sampling index, and
 * the stored positions are the blobs in `telemetryDataPoint`.
 */
export const TELEMETRY_FIELDS = [
  "schemaVersion",
  "event",
  "campfireVersion",
  "os",
  "arch",
  "installMethod",
  "surface",
  "installationId",
] as const;

export type TelemetryField = (typeof TELEMETRY_FIELDS)[number];

/** Hard payload ceiling. The documented contract is far smaller than this. */
export const TELEMETRY_MAX_PAYLOAD_BYTES = 2_048;

const INSTALLATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isTelemetryInstallationId(value: unknown): value is string {
  return typeof value === "string" && INSTALLATION_ID_PATTERN.test(value);
}

function bounded(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function normalizedEnum<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/**
 * Build the wire event from already-known-safe inputs. Optional dimensions that
 * do not apply to an event are omitted rather than sent empty, so an
 * `install_requested` cannot be mistaken for an identified installation.
 */
export function buildTelemetryEvent(input: {
  event: TelemetryEventName;
  installationId?: string;
  campfireVersion?: string;
  os?: string;
  arch?: string;
  installMethod?: string;
  surface?: string;
}): TelemetryEventV1 {
  const event: TelemetryEventV1 = {
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    event: input.event,
    installationId: isTelemetryInstallationId(input.installationId) ? input.installationId : "",
    campfireVersion: bounded(input.campfireVersion ?? "unknown", VERSION_MAX_CHARS),
    os: bounded(normalizeTelemetryOs(input.os ?? "unknown"), OS_MAX_CHARS),
    arch: bounded(normalizeTelemetryArch(input.arch ?? "unknown"), ARCH_MAX_CHARS),
  };
  const installMethod = normalizedEnum(input.installMethod, TELEMETRY_INSTALL_METHODS);
  if (installMethod !== undefined) event.installMethod = installMethod;
  const surface = normalizedEnum(input.surface, TELEMETRY_SURFACES);
  if (surface !== undefined) event.surface = surface;
  return event;
}

/**
 * The only serializer. Every key is written explicitly from the allow-list, so
 * an unexpected property on the input is dropped rather than forwarded.
 */
export function serializeTelemetryEvent(event: TelemetryEventV1): string {
  const payload: Record<string, unknown> = {
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    event: event.event,
    installationId: event.installationId,
    campfireVersion: event.campfireVersion,
    os: event.os,
    arch: event.arch,
  };
  if (event.installMethod !== undefined) payload.installMethod = event.installMethod;
  if (event.surface !== undefined) payload.surface = event.surface;
  return JSON.stringify(payload);
}

export type TelemetryParseResult =
  | { ok: true; event: TelemetryEventV1 }
  | { ok: false; reason: "malformed_json" | "not_an_object" | "unknown_field" | "invalid" };

const ALLOWED_KEY_SET: ReadonlySet<string> = new Set([
  "schemaVersion",
  "event",
  "installationId",
  "campfireVersion",
  "os",
  "arch",
  "installMethod",
  "surface",
]);

/**
 * Server-side validation for the ingestion endpoint.
 *
 * An unknown key is a rejection, not a drop: silently ignoring unknown fields
 * would let a future client smuggle content past the allow-list while still
 * reporting success. Accepting only the documented vocabulary is what makes
 * "only the documented contract reaches storage" testable.
 */
export function parseTelemetryEventV1(raw: unknown): TelemetryParseResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: "not_an_object" };
  }
  const source = raw as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    if (!ALLOWED_KEY_SET.has(key)) return { ok: false, reason: "unknown_field" };
  }
  if (source.schemaVersion !== TELEMETRY_SCHEMA_VERSION) return { ok: false, reason: "invalid" };
  if (!isTelemetryEventName(source.event)) return { ok: false, reason: "invalid" };
  if (typeof source.campfireVersion !== "string" || source.campfireVersion.length === 0) {
    return { ok: false, reason: "invalid" };
  }
  if (typeof source.os !== "string" || source.os.length === 0) {
    return { ok: false, reason: "invalid" };
  }
  if (typeof source.arch !== "string" || source.arch.length === 0) {
    return { ok: false, reason: "invalid" };
  }
  // `install_requested` is anonymous by contract. A payload that carries an
  // installation id for it is malformed, not merely unused.
  if (source.event === "install_requested") {
    if (source.installationId !== undefined && source.installationId !== "") {
      return { ok: false, reason: "invalid" };
    }
  } else if (!isTelemetryInstallationId(source.installationId)) {
    return { ok: false, reason: "invalid" };
  }
  const event: TelemetryEventV1 = {
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    event: source.event,
    installationId: typeof source.installationId === "string" ? source.installationId : "",
    campfireVersion: bounded(source.campfireVersion, VERSION_MAX_CHARS),
    os: bounded(normalizeTelemetryOs(source.os), OS_MAX_CHARS),
    arch: bounded(normalizeTelemetryArch(source.arch), ARCH_MAX_CHARS),
  };
  const installMethod = normalizedEnum(source.installMethod, TELEMETRY_INSTALL_METHODS);
  if (installMethod !== undefined) event.installMethod = installMethod;
  const surface = normalizedEnum(source.surface, TELEMETRY_SURFACES);
  if (surface !== undefined) event.surface = surface;
  return { ok: true, event };
}

/**
 * Analytics Engine data point.
 *
 * AE allows one index. That index is the sampling key, not a dimension column.
 * A per-installation id is the wrong key: Analytics Engine samples within an
 * index value, and a unique key makes aggregate queries scan one series per
 * installation. The event name is the sampling key because the funnel is four
 * low-cardinality series.
 * The seven former index dimensions are blob1..blob7 in the same order (event,
 * schema version, campfire version, os, arch, install method, surface). blob1
 * repeats the sampling index so a query can filter on blobs. The installation
 * id is blob8, never an index. These positions are the stable layout because
 * the 7-index layout never stored a row — extra indexes are rejected and the
 * write records nothing.
 */
export function telemetryDataPoint(event: TelemetryEventV1): {
  indexes: string[];
  blobs: string[];
} {
  return {
    indexes: [event.event],
    blobs: [
      event.event,
      String(event.schemaVersion),
      event.campfireVersion,
      event.os,
      event.arch,
      event.installMethod ?? "none",
      event.surface ?? "none",
      event.installationId,
    ],
  };
}