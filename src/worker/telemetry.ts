/**
 * Anonymous product telemetry: Cloudflare ingestion (TEL-001F) and
 * installer-request measurement (TEL-001D).
 *
 * This adapter is thin on purpose. It validates the payload against the
 * schema in `src/telemetry/contract.ts` and writes one Analytics Engine data
 * point. It performs no authorization lookup, touches no D1 row, and makes no
 * outbound request, because telemetry must never become a way to observe or
 * delay a Campfire call. The only privacy-relevant decisions here are the ones
 * spelled out below; everything else — the allow-list, the vocabulary, the
 * blob positions — belongs to the contract module, which the CLI and the
 * installer share. AE allows one sampling index, so the dimensions do not
 * live in `indexes`.
 *
 * Note the contract is imported directly rather than through
 * `src/telemetry/index.ts`: that barrel also pulls in the local state file and
 * the Node-only HTTP client, which must never enter the Worker bundle.
 */
import {
  buildTelemetryEvent,
  isTelemetryVersionBelowFloor,
  parseTelemetryEventV1,
  TELEMETRY_MAX_PAYLOAD_BYTES,
  telemetryDataPoint,
  type TelemetryEventV1,
} from "../telemetry/contract.js";
import { telemetryReleaseAt } from "../telemetry/releases.js";
import { activeClaimDate, type TelemetryGuard } from "../telemetry/guard.js";

/**
 * Optional Analytics Engine dataset binding
 * (`[[analytics_engine_datasets]] binding = "TELEMETRY"`). Structural type
 * only: `writeDataPoint` is the entire API this adapter uses, and declaring it
 * here keeps the worker free of `@cloudflare/workers-types`.
 */
export interface AnalyticsEngineDataset {
  writeDataPoint(point: { indexes?: string[]; blobs?: string[]; doubles?: number[] }): void;
}

/**
 * Ingestion path, unprefixed. The zone route carries a `/campfire` prefix that
 * `apiPath` strips, so one constant spells the route for the router, the
 * installer's `CAMPFIRE_TELEMETRY_URL`, and the tests.
 */
export const TELEMETRY_PATH = "/v1/telemetry";

/**
 * Optional Workers Rate Limiting binding (`[[ratelimits]]`). Structural type
 * only, for the same reason as the dataset binding: this is the whole surface
 * the adapter uses, so the Worker stays free of `@cloudflare/workers-types`.
 *
 * Absent binding means no limiting, which keeps local `wrangler dev` and any
 * deployment that has not added the binding working exactly as before.
 */
export interface RateLimiterBinding {
  limit(input: { key: string }): Promise<{ success: boolean }>;
}

/**
 * How the integrity guard disposes of a failing event.
 *
 * - `enforce`: violations are rejected (`recorded: false`); duplicates are
 *   deduplicated. Counts stay clean at the cost of dropping shadow-phase
 *   traffic that carries no token yet.
 * - `shadow`: violations are measured (`would_reject` in the ops dataset) but
 *   the event still flows through, so counts are unchanged while the funnel
 *   is observed. Duplicates are still deduplicated in shadow: idempotency is
 *   not a policy decision.
 * - `off`: the pre-integrity behavior — floor, IP limiter, and the write
 *   only. Used when no guard is configured.
 */
export type TelemetryGateMode = "enforce" | "shadow" | "off";

export interface TelemetryIngestOptions {
  dataset?: AnalyticsEngineDataset;
  rateLimiter?: RateLimiterBinding;
  /** Integrity outcome measurement. Absent means outcomes are not measured. */
  opsDataset?: AnalyticsEngineDataset;
  /** Optional per-installation budget, keyed by an opaque hash of the id. */
  idRateLimiter?: RateLimiterBinding;
  /** Optional idempotency guard. Absent means the gate is off. */
  guard?: TelemetryGuard;
  /** Defaults to `shadow` when a guard is present, else `off`. */
  gateMode?: TelemetryGateMode;
  /** Milliseconds since epoch. Injected in tests for release-time checks. */
  now?: () => number;
}

/** Outcome vocabulary for the ops dataset. Never carries an id or address. */
export type TelemetryIngestOutcome =
  | "accepted"
  | "deduplicated"
  | "dropped"
  | "rejected"
  | "would_reject"
  | "error";

/** Same envelope as `handler.ts`; duplicated rather than imported to avoid an adapter cycle. */
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function fail(status: number, code: string, message: string): Response {
  return json(status, { ok: false, error: code, message });
}

/**
 * Read the body under a hard byte ceiling, streaming rather than trusting
 * `content-length`. A client that omits or understates the header must not be
 * able to make the Worker buffer an arbitrary body, so the cap is enforced
 * against bytes actually received and the stream is cancelled on breach.
 */
async function readBoundedJson(request: Request): Promise<
  | { ok: true; value: unknown }
  | { ok: false; response: Response }
> {
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  if (reader !== undefined) {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      length += item.value.byteLength;
      if (length > TELEMETRY_MAX_PAYLOAD_BYTES) {
        await reader.cancel();
        return { ok: false, response: fail(413, "ValidationError", "Telemetry payload too large") };
      }
      chunks.push(item.value);
    }
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false, response: fail(400, "ValidationError", "Telemetry payload must be JSON") };
  }
}

/**
 * Per-source request budget for the anonymous ingestion route.
 *
 * This route carries no credential by design, so it is open to anyone who
 * learns the URL. The budget exists to bound the damage from a flood, not to
 * identify anyone: the key is an opaque hash of Cloudflare's own
 * `CF-Connecting-IP` header, used only as a rate-limit key and never stored,
 * logged, or written to a data point.
 *
 * It is deliberately generous. A legitimate installation sends a handful of
 * events across its whole life — `install_completed` and `activated` are each
 * claimed once per installation, and `active` at most once per UTC day. CI
 * and corporate NAT can put many
 * real installations behind one address, so a tight limit would silently drop
 * honest traffic to punish a flood. Failing open when the binding errors keeps
 * telemetry a measurement rather than a new way for Campfire to fail.
 *
 * The same binding also budgets installer token minting (TEL-001D), under a
 * distinct `install-token:` key prefix so a mint never consumes the
 * ingestion-budget key and vice versa. Both share the 120/min binding budget
 * per source: one installer fetch can mint at most one token, so farming
 * tokens costs one fetch per fake id and at most 120 mints per minute per
 * source address (NAT-shared, hence generous).
 */
export const TELEMETRY_RATE_LIMIT_PER_MINUTE = 120;

/** Any nonempty address; the value itself is hashed below and never retained. */
function clientAddress(request: Request): string | undefined {
  const header = request.headers.get("CF-Connecting-IP")?.trim();
  return header === undefined || header.length === 0 ? undefined : header;
}

/**
 * FNV-1a, so the rate-limit key is a short opaque token rather than a network
 * address sitting inside a binding. It is not a security primitive and is not
 * used as one: the only requirement is that the same source maps to the same
 * key and different sources usually do not collide.
 */
function opaqueKey(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `t${hash.toString(16)}`;
}

/**
 * Consume one unit of a budget keyed by an explicit opaque key.
 *
 * Fails open in every ambiguous case — no binding, or a binding that throws.
 * Shared by the per-source limiter (keyed by address hash) and the
 * per-installation limiter (keyed by id hash).
 */
async function isRateLimitedKey(
  rateLimiter: RateLimiterBinding | undefined,
  key: string | undefined,
): Promise<boolean> {
  if (rateLimiter === undefined || key === undefined) return false;
  try {
    const verdict = await rateLimiter.limit({ key });
    return !verdict.success;
  } catch {
    return false;
  }
}

/**
 * Consume one unit of the caller's budget.
 *
 * Fails open in every ambiguous case — no binding, no address header, or a
 * binding that throws. A measurement path must never become a new way for a
 * Campfire operation to fail, and a limiter that errors must not be able to
 * silence telemetry for everyone.
 */
async function isRateLimited(
  rateLimiter: RateLimiterBinding | undefined,
  request: Request,
): Promise<boolean> {
  const address = clientAddress(request);
  if (address === undefined) return false;
  return isRateLimitedKey(rateLimiter, opaqueKey(address));
}

/**
 * Distinct key prefix for the installer token-mint budget (TEL-001D).
 *
 * Token minting reuses the existing per-source IP limiter binding, so no new
 * binding is provisioned and no route shape changes. The prefix keeps mint
 * keys disjoint from ingestion keys: a token mint never consumes the
 * ingestion-budget key for the same source, and ingestion traffic never
 * consumes the mint budget. The raw address never reaches the binding — only
 * this opaque derived key — and nothing is stored, logged, or written to a
 * data point.
 */
export const INSTALL_TOKEN_RATE_LIMIT_PREFIX = "install-token:";

/**
 * Consume one unit of the installer's per-source token-mint budget.
 *
 * Over budget means the installer is still served, unchanged and unmeasured
 * except for the usual `install_requested`: a flood can never mint unbounded
 * tokens, and a legit fetch is never broken (its telemetry proof degrades to
 * a retry). Fails open in every ambiguous case — no binding, no address
 * header, or a binding that throws — so the limiter can never break installs.
 */
export async function isInstallTokenRateLimited(
  rateLimiter: RateLimiterBinding | undefined,
  request: Request,
): Promise<boolean> {
  const address = clientAddress(request);
  if (address === undefined) return false;
  return isRateLimitedKey(rateLimiter, `${INSTALL_TOKEN_RATE_LIMIT_PREFIX}${opaqueKey(address)}`);
}

/**
 * Record one ingestion outcome in the ops dataset.
 *
 * The point carries only the outcome, the reason, and the event name —
 * `indexes: ["ingest_outcome"]`, `blobs: [outcome, reason, event]`,
 * `doubles: [1]`. No installation id, no address, no token, no version: the
 * ops dataset measures the gate, not the installations. A failed write is
 * swallowed: outcome measurement must never change the caller's response.
 */
export function recordTelemetryOutcome(
  opsDataset: AnalyticsEngineDataset | undefined,
  outcome: TelemetryIngestOutcome,
  reason: string,
  event: string,
): void {
  if (opsDataset === undefined) return;
  try {
    opsDataset.writeDataPoint({ indexes: ["ingest_outcome"], blobs: [outcome, reason, event], doubles: [1] });
  } catch {
    // Outcome measurement is best-effort, like the measurement itself.
  }
}

/** The gate that actually applies: explicit mode wins, else guard ⇒ shadow. */
export function effectiveGateMode(options: Pick<TelemetryIngestOptions, "guard" | "gateMode">): TelemetryGateMode {
  if (options.gateMode !== undefined) return options.gateMode;
  return options.guard !== undefined ? "shadow" : "off";
}

/**
 * Accept one schema-v1 event.
 *
 * An undocumented field is a rejection rather than a silent drop: ignoring it
 * would let a future client smuggle content past the allow-list while still
 * being told it succeeded, which is exactly what the acceptance criteria
 * ("server accepts only documented events/fields") rule out.
 *
 * Responses are truthful about what happened. With no dataset bound — local
 * dev, or a deployment where the operator has not provisioned the dataset — the
 * event is accepted and reported as `recorded: false`, so the installer's
 * best-effort POST does not look like a failure and retry. `recorded: true`
 * means the binding accepted `writeDataPoint`; Analytics Engine persists it
 * asynchronously and does not provide a per-event durability acknowledgement.
 */
export async function handleTelemetryEvent(
  options: TelemetryIngestOptions,
  request: Request,
): Promise<Response> {
  if (request.method !== "POST") {
    return fail(405, "ValidationError", `Method not allowed: ${request.method}`);
  }

  // Bounded before the body is read, so a flood costs a header check rather
  // than a buffered parse per request. The caller is told honestly that it was
  // throttled: the client posts fire-and-forget and surfaces a 429 as
  // `HTTP 429` without affecting the Campfire operation that triggered it.
  // No outcome is recorded here: nothing has been parsed yet, so there is no
  // trustworthy event name to record.
  const throttled = await isRateLimited(options.rateLimiter, request);
  if (throttled) {
    return fail(429, "RateLimited", "Telemetry ingestion is rate limited for this source");
  }

  const body = await readBoundedJson(request);
  if (!body.ok) return body.response;

  const parsed = parseTelemetryEventV1(body.value);
  if (!parsed.ok) {
    return parsed.reason === "unknown_field"
      ? fail(400, "ValidationError", "Telemetry payload contains an undocumented field")
      : fail(400, "ValidationError", "Telemetry payload does not match schema version 1");
  }

  const ops = options.opsDataset;
  const gateMode = effectiveGateMode(options);
  const gated = gateMode !== "off";
  const nowMs = (options.now ?? Date.now)();

  // A version below the release that introduced telemetry cannot emit an event
  // by any code path, so the payload is fabricated. It is dropped silently —
  // reported as `recorded: false` rather than an error — because a rejection
  // here would teach a prober exactly which field gave it away.
  if (isTelemetryVersionBelowFloor(parsed.event.campfireVersion)) {
    recordTelemetryOutcome(ops, "dropped", "floor", parsed.event.event);
    return json(200, { ok: true, result: { recorded: false } });
  }

  // A known version whose release instant is still in the future cannot have
  // been emitted by a real binary either. An unknown version is allowed
  // through: `unknown`, a build string, or a release newer than the static
  // table is an honest possibility, recorded under `unknown_release`.
  const releaseAt = telemetryReleaseAt(parsed.event.campfireVersion);
  let releaseReason = "ok";
  if (releaseAt !== undefined) {
    if (gated && nowMs < Date.parse(releaseAt)) {
      if (gateMode === "enforce") {
        recordTelemetryOutcome(ops, "rejected", "version_not_released", parsed.event.event);
        return json(200, { ok: true, result: { recorded: false } });
      }
      return await writeTelemetryPoint(options, parsed.event, ops, "would_reject", "version_not_released");
    }
  } else if (gated) {
    releaseReason = "unknown_release";
  }

  // Per-installation budget, keyed by `id:` plus the opaque id hash — the raw
  // id never reaches the binding. `install_requested` carries no id and
  // skips this limiter. Fails open; a 429 tells the client it was throttled.
  if (gated && parsed.event.installationId.length > 0) {
    const idThrottled = await isRateLimitedKey(
      options.idRateLimiter,
      `id:${opaqueKey(parsed.event.installationId)}`,
    );
    if (idThrottled) {
      recordTelemetryOutcome(ops, "rejected", "rate_limited_id", parsed.event.event);
      return fail(429, "RateLimited", "Telemetry ingestion is rate limited for this installation");
    }
  }

  // Server-side idempotency. Duplicates are deduplicated in every mode —
  // idempotency is not a policy decision. Other guard verdicts reject in
  // enforce mode and measure-and-continue in shadow mode; a guard outage
  // fails open.
  if (gated && options.guard !== undefined) {
    const guard = options.guard;
    const nowIso = new Date(nowMs).toISOString();
    if (parsed.event.event === "install_completed") {
      // Closed rule: a tokenless install is accepted IFF the method is `brew`
      // or `nix`. The `curl` channel (including an absent or unknown method,
      // which normalizes to `undefined`) must present a valid single-use
      // token; anything else is a forgery, a replay, or an unmeasured fetch.
      const method = parsed.event.installMethod;
      if (method === "brew" || method === "nix") {
        // Package-manager bootstrap: self-reported, never token-proven. Any
        // token present is ignored and deliberately NOT consumed — a brew/nix
        // client has no legitimate way to hold one, so consuming it would let
        // token theft burn installer tokens. The claim lands directly, with
        // no read or write to the token table.
        const bootstrapReason = method === "brew" ? "bootstrap_brew" : "bootstrap_nix";
        const direct = await guard.claimInstallDirect({
          installationId: parsed.event.installationId,
          now: nowIso,
        });
        if (direct === "duplicate") {
          recordTelemetryOutcome(ops, "deduplicated", "duplicate_install", parsed.event.event);
          return json(200, { ok: true, result: { recorded: false } });
        }
        // `error` fails open like every other guard outage: measurement must
        // never become a new way for an install to fail.
        return await writeTelemetryPoint(options, parsed.event, ops, "accepted", bootstrapReason);
      }
      const completed = await guard.completeInstall({
        installationId: parsed.event.installationId,
        ...(parsed.event.installToken !== undefined ? { installToken: parsed.event.installToken } : {}),
        now: nowIso,
      });
      if (completed === "duplicate") {
        recordTelemetryOutcome(ops, "deduplicated", "duplicate_install", parsed.event.event);
        return json(200, { ok: true, result: { recorded: false } });
      }
      if (completed === "invalid_token") {
        if (gateMode === "enforce") {
          recordTelemetryOutcome(ops, "rejected", "invalid_token", parsed.event.event);
          return json(200, { ok: true, result: { recorded: false } });
        }
        return await writeTelemetryPoint(options, parsed.event, ops, "would_reject", "invalid_token");
      }
    } else if (parsed.event.event === "activated" || parsed.event.event === "active") {
      const claim =
        parsed.event.event === "activated"
          ? await guard.claimActivation({ installationId: parsed.event.installationId })
          : await guard.claimActive({
              installationId: parsed.event.installationId,
              date: activeClaimDate(new Date(nowMs)),
            });
      if (claim === "duplicate") {
        const reason = parsed.event.event === "activated" ? "duplicate_activation" : "duplicate_active";
        recordTelemetryOutcome(ops, "deduplicated", reason, parsed.event.event);
        return json(200, { ok: true, result: { recorded: false } });
      }
      if (claim === "no_install") {
        if (gateMode === "enforce") {
          recordTelemetryOutcome(ops, "rejected", "no_install", parsed.event.event);
          return json(200, { ok: true, result: { recorded: false } });
        }
        return await writeTelemetryPoint(options, parsed.event, ops, "would_reject", "no_install");
      }
    }
  }

  return await writeTelemetryPoint(options, parsed.event, ops, "accepted", releaseReason);
}

/**
 * The terminal write: missing dataset and write failures are honest
 * `recorded: false` successes, never client errors. `outcome`/`reason`
 * carry the shadow verdict when the gate measured one instead of rejecting.
 */
async function writeTelemetryPoint(
  options: TelemetryIngestOptions,
  event: TelemetryEventV1,
  ops: AnalyticsEngineDataset | undefined,
  outcome: TelemetryIngestOutcome,
  reason: string,
): Promise<Response> {
  if (options.dataset === undefined) {
    recordTelemetryOutcome(ops, "dropped", "missing_dataset", event.event);
    return json(200, { ok: true, result: { recorded: false } });
  }

  try {
    options.dataset.writeDataPoint(telemetryDataPoint(event));
  } catch {
    // A measurement write must not become a client error: the caller has
    // nothing to fix, and a 500 here would make a successful install look
    // broken. Still report honestly that no data point was recorded.
    recordTelemetryOutcome(ops, "error", "write_error", event.event);
    return json(200, { ok: true, result: { recorded: false } });
  }
  recordTelemetryOutcome(ops, outcome, reason, event.event);
  return json(200, { ok: true, result: { recorded: true } });
}

/**
 * Record `install_requested` for the public installer route (TEL-001D).
 *
 * Anonymous by contract: no installation id exists yet at this point in the
 * funnel, and none is sent. The requestor is a shell pipeline, so the Worker
 * genuinely cannot know its platform — reading it from request headers (or
 * from Cloudflare-added client metadata) would be fingerprinting to fill in a
 * dimension the installer already reports truthfully in `install_completed`.
 * os/arch therefore stay `unknown`, and no address, host, or token header is
 * ever read.
 */
export function recordInstallRequested(dataset: AnalyticsEngineDataset | undefined): Promise<void> {
  if (dataset === undefined) return Promise.resolve();
  return Promise.resolve().then(() => {
    try {
      dataset.writeDataPoint(
        telemetryDataPoint(
          buildTelemetryEvent({
            event: "install_requested",
            installMethod: "curl",
            os: "unknown",
            arch: "unknown",
          }),
        ),
      );
    } catch {
      // Installer downloads must not fail because measurement failed.
    }
  });
}
