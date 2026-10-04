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
 * reordering is not. The stored layout is `telemetryDataPoint`. blob9–blob11
 * are Worker-derived (region, installer route, client family) and are not
 * client payload fields. blob12 is the closed harness enum. blob13 is
 * deployment mode (`local`/`remote`). blob14 is the participant bucket
 * (`1`/`2`/`3plus`) on `active` and `contributed`.
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
  "teammate_joined",
  "contributed",
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
 * Closed harness vocabulary on `activated`, `active`, `teammate_joined`, and
 * `contributed`. Anything else is dropped, so a free-text harness name cannot
 * become a dimension.
 */
export const TELEMETRY_HARNESSES = ["codex", "opencode"] as const;
export type TelemetryHarness = (typeof TELEMETRY_HARNESSES)[number];

export const TELEMETRY_INSTALLER_ROUTES = ["latest", "versioned"] as const;
export type TelemetryInstallerRoute = (typeof TELEMETRY_INSTALLER_ROUTES)[number];

export const TELEMETRY_CLIENT_FAMILIES = ["curl", "wget", "browser", "ci", "unknown"] as const;
export type TelemetryClientFamily = (typeof TELEMETRY_CLIENT_FAMILIES)[number];

/**
 * Whether this installation talked to a local SQLite service or a hosted
 * endpoint. Closed so a URL cannot become a dimension.
 */
export const TELEMETRY_DEPLOYMENT_MODES = ["local", "remote"] as const;
export type TelemetryDeploymentMode = (typeof TELEMETRY_DEPLOYMENT_MODES)[number];

/**
 * Distinct workspace participants at the moment of the event, bucketed so an
 * exact headcount never leaves the machine. Used on `active` and `contributed`.
 */
export const TELEMETRY_PARTICIPANT_BUCKETS = ["1", "2", "3plus"] as const;
export type TelemetryParticipantBucket = (typeof TELEMETRY_PARTICIPANT_BUCKETS)[number];

/**
 * Durable object writes that count as `contributed`. Citations, identity,
 * enrollment, and reads are excluded: this is "shared work was recorded".
 */
export const TELEMETRY_CONTRIBUTION_METHODS: ReadonlySet<string> = new Set([
  "create_goal",
  "update_goal",
  "add_finding",
  "correct_finding",
  "withdraw_finding",
  "add_decision",
  "accept_decision",
  "retire_decision",
  "create_task",
  "update_task",
  "add_artifact",
]);

export function telemetryParticipantBucket(count: number): TelemetryParticipantBucket | undefined {
  if (!Number.isFinite(count) || count < 1) return undefined;
  if (count === 1) return "1";
  if (count === 2) return "2";
  return "3plus";
}

/** Read a `participants` array off a Campfire result without copying names. */
export function participantBucketFromUnknown(value: unknown): TelemetryParticipantBucket | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const participants = (value as { participants?: unknown }).participants;
  if (!Array.isArray(participants)) return undefined;
  return telemetryParticipantBucket(participants.length);
}

function nonEmptyId(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Workspace id from params or a result object, never a workspace name. */
export function workspaceIdFromUnknown(
  result: unknown,
  params?: Record<string, unknown>,
): string | undefined {
  const fromParams = nonEmptyId(params?.workspaceId);
  if (fromParams !== undefined) return fromParams;
  if (typeof result !== "object" || result === null) return undefined;
  const record = result as { workspaceId?: unknown; workspace?: { id?: unknown } };
  return nonEmptyId(record.workspaceId) ?? nonEmptyId(record.workspace?.id);
}

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

/**
 * Country-level region for an installer fetch.
 *
 * Cloudflare supplies ISO 3166-1 alpha-2 on `request.cf.country` (US, CA, MX).
 * `T1` is Cloudflare's Tor exit marker. Anything else, including a missing
 * value, a city name, or a three-letter spelling, becomes `unknown` rather
 * than being stored raw. This is not a client-payload field.
 */
export function normalizeTelemetryRegion(value: unknown): string {
  if (typeof value !== "string") return "unknown";
  const region = value.trim().toUpperCase();
  if (region === "T1") return "T1";
  if (/^[A-Z]{2}$/.test(region)) return region;
  return "unknown";
}

/** Latest curl URL vs a pinned `vX.Y.Z` installer script. */
export function normalizeTelemetryInstallerRoute(pathname: unknown): TelemetryInstallerRoute | "none" {
  if (typeof pathname !== "string") return "none";
  const path = pathname.trim();
  if (/^\/(?:campfire\/)?v\d+\.\d+\.\d+\/install\.sh$/.test(path)) return "versioned";
  if (
    path === "/install" ||
    path === "/campfire/install" ||
    path === "/campfire/install.sh" ||
    path === "/install.sh"
  ) {
    return "latest";
  }
  return "none";
}

/**
 * Coarse User-Agent family. The raw header is never stored; only this enum is.
 */
export function normalizeTelemetryClientFamily(userAgent: unknown): TelemetryClientFamily {
  if (typeof userAgent !== "string" || userAgent.trim().length === 0) return "unknown";
  const ua = userAgent.toLowerCase();
  if (/\bcurl\b/.test(ua)) return "curl";
  if (/\bwget\b/.test(ua)) return "wget";
  if (
    ua.includes("mozilla/") ||
    ua.includes("chrome/") ||
    ua.includes("safari/") ||
    ua.includes("firefox/") ||
    ua.includes("edg/") ||
    ua.includes("opera")
  ) {
    return "browser";
  }
  if (
    ua.includes("github-actions") ||
    ua.includes("github-hookshot") ||
    ua.includes("gitlab") ||
    ua.includes("jenkins") ||
    ua.includes("circleci") ||
    ua.includes("travis") ||
    ua.includes("azure-pipelines") ||
    ua.includes("buildkite") ||
    ua.includes("python-requests") ||
    ua.includes("python-urllib") ||
    ua.includes("go-http-client") ||
    ua.includes("axios/") ||
    ua.includes("node-fetch") ||
    ua.includes("httpie")
  ) {
    return "ci";
  }
  return "unknown";
}

/** Bounded so a hostile or broken client cannot inflate the stored dimension. */
const OS_MAX_CHARS = 16;
const ARCH_MAX_CHARS = 16;
const VERSION_MAX_CHARS = 32;

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
  harness?: TelemetryHarness;
  deploymentMode?: TelemetryDeploymentMode;
  participantBucket?: TelemetryParticipantBucket;
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
  "harness",
  "deploymentMode",
  "participantBucket",
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
  harness?: string;
  deploymentMode?: string;
  participantBucket?: string;
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
  const harness = normalizedEnum(input.harness, TELEMETRY_HARNESSES);
  if (harness !== undefined) event.harness = harness;
  const deploymentMode = normalizedEnum(input.deploymentMode, TELEMETRY_DEPLOYMENT_MODES);
  if (deploymentMode !== undefined) event.deploymentMode = deploymentMode;
  const participantBucket = normalizedEnum(input.participantBucket, TELEMETRY_PARTICIPANT_BUCKETS);
  if (participantBucket !== undefined) event.participantBucket = participantBucket;
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
  if (event.harness !== undefined) payload.harness = event.harness;
  if (event.deploymentMode !== undefined) payload.deploymentMode = event.deploymentMode;
  if (event.participantBucket !== undefined) payload.participantBucket = event.participantBucket;
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
  "harness",
  "deploymentMode",
  "participantBucket",
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
  const harness = normalizedEnum(source.harness, TELEMETRY_HARNESSES);
  if (harness !== undefined) event.harness = harness;
  const deploymentMode = normalizedEnum(source.deploymentMode, TELEMETRY_DEPLOYMENT_MODES);
  if (deploymentMode !== undefined) event.deploymentMode = deploymentMode;
  const participantBucket = normalizedEnum(source.participantBucket, TELEMETRY_PARTICIPANT_BUCKETS);
  if (participantBucket !== undefined) event.participantBucket = participantBucket;
  return { ok: true, event };
}

function storedInstallerRoute(value: string | undefined): string {
  if (value === undefined) return "none";
  if (value === "latest" || value === "versioned") return value;
  return normalizeTelemetryInstallerRoute(value);
}

function storedClientFamily(value: string | undefined): string {
  if (value === undefined) return "none";
  if ((TELEMETRY_CLIENT_FAMILIES as readonly string[]).includes(value)) return value;
  return normalizeTelemetryClientFamily(value);
}

/**
 * Analytics Engine data point.
 *
 * AE allows one index. That index is the sampling key, not a dimension column.
 * A per-installation id is the wrong key: Analytics Engine samples within an
 * index value, and a unique key makes aggregate queries scan one series per
 * installation. The event name is the sampling key because the funnel is a
 * handful of low-cardinality series.
 * The seven former index dimensions are blob1..blob7 in the same order (event,
 * schema version, campfire version, os, arch, install method, surface). blob1
 * repeats the sampling index so a query can filter on blobs. The installation
 * id is blob8, never an index. blob9 is country-level region, blob10 installer
 * route, blob11 client family, blob12 harness, blob13 deployment mode, blob14
 * participant bucket. `"none"` means the event does not collect that
 * dimension. These positions are the stable layout because the 7-index layout
 * never stored a row — extra indexes are rejected and the write records
 * nothing.
 */
export function telemetryDataPoint(
  event: TelemetryEventV1,
  extras?: {
    region?: string;
    installerRoute?: string;
    clientFamily?: string;
  },
): {
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
      extras?.region === undefined ? "none" : normalizeTelemetryRegion(extras.region),
      storedInstallerRoute(extras?.installerRoute),
      storedClientFamily(extras?.clientFamily),
      event.harness ?? "none",
      event.deploymentMode ?? "none",
      event.participantBucket ?? "none",
    ],
  };
}