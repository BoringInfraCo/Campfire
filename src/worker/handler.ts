import { normalizeRedeemEnrollmentInput } from "../domain/enrollment.js";
/**
 * Cloudflare Workers fetch handler for Campfire.
 *
 * Layering (AGENTS.md invariant 7): this adapter is thin. It parses HTTP,
 * resolves the bearer token via the application service, and dispatches
 * through the existing method mapping — it contains no collaboration
 * semantics and no authorization rules of its own.
 *
 * - `POST /v1/call` — full method set, bearer required. Reuses
 *   `dispatchCampfireMethod` + `CampfireService` (sync, local SQLite/tests).
 * - `POST /api/call` and `GET /api/<viewerMethod>` — bearer-authenticated,
 *   read-only compatibility APIs for non-browser clients.
 * - `GET /campfire/install` (`/install`) — the measured installer route: same
 *   installer asset, plus one anonymous `install_requested` data point.
 * - `POST /v1/telemetry` — anonymous telemetry ingestion (TEL-001F). No
 *   bearer: it authenticates no Campfire state and writes only Analytics
 *   Engine data points.
 * - `GET /campfire/install.sh` and versioned installer paths — the same
 *   measured, tokenized serving path: one anonymous `install_requested` per
 *   served 2xx plus a baked-in single-use install token, with minting bounded
 *   per source by the shared IP limiter under a distinct key prefix.
 *   The journal itself is
 *   served by the loopback Viewer process, where the bearer stays server-side.
 *
 * `createD1WorkerHandler` is the production entry: same routes over
 * `AsyncCampfireService` (D1). Same validation, same status mapping.
 */
import { CampfireError, type CampfireErrorCode } from "../domain/errors.js";
import { createId, nowIso, type IdSource } from "../domain/ids.js";
import { readGithubSourceConfig } from "../integrations/github-source-config.js";
import {
  GITHUB_INGRESS_BODY_DEADLINE_MS,
  GITHUB_INGRESS_MAX_BODY_BYTES,
  ingressContentTypeAllowed,
  ingressEncodingAllowed,
  ingressTransportAllowed,
} from "../integrations/github-workflow-run.js";
import {
  githubIngressPathSourceId,
  ingestGithubWorkflowRun,
  ingestGithubWorkflowRunAsync,
} from "../service/github-ingress.js";
import { collectBridgeReport } from "../bridge/report.js";
import {
  bridgeOperatorTokenMatches,
  readBridgeOperatorToken,
  readWebhookBridgeConfig,
} from "../bridge/config.js";
import type { ActorContext } from "../service/authorization.js";
import type { CampfireService } from "../service/service.js";
import { dispatchCampfireMethod, isCampfireHttpMethod, isDeliveryEligibleMethod } from "../http/dispatch.js";
import { dispatchCampfireMethodAsync } from "./async-dispatch.js";
import { createAsyncCampfireService, type AsyncCampfireService } from "./async-service.js";
import type { AsyncCampfireStore } from "./d1-store.js";
import {
  handleTelemetryEvent,
  isInstallTokenRateLimited,
  recordInstallRequested,
  TELEMETRY_PATH,
  type AnalyticsEngineDataset,
  type RateLimiterBinding,
  type TelemetryGateMode,
} from "./telemetry.js";
import type { TelemetryGuard } from "../telemetry/guard.js";
import { projectViewerRecordHistory } from "../viewer/history-view.js";

const MAX_BODY_BYTES = 1_048_576;

/**
 * Viewer read methods (mirrors `VIEWER_READ_METHODS` in
 * `src/viewer/server.ts`, duplicated here so the worker bundle does not
 * import `node:http`/`node:fs`). The Viewer is a read-only team journal.
 */
const VIEWER_READ_METHODS = [
  "whoami",
  "list_workspaces",
  "get_workspace",
  "get_workspace_context",
  "get_activity",
  "list_tasks",
  "list_workspace_participants",
  "get_task",
  "get_decision",
  "get_finding",
  "get_artifact",
  "get_record_history",
] as const;

type ViewerReadMethod = (typeof VIEWER_READ_METHODS)[number];

const VIEWER_READ_SET: ReadonlySet<string> = new Set(VIEWER_READ_METHODS);

/**
 * Worker-served installer scripts (TEL-001D): the asset path, the short
 * route's asset, and versioned snapshots. All are measured and tokenized on
 * 2xx through the same serving path; a 404 or 502 records nothing.
 */
const INSTALLER_ASSET_PATH = "/campfire/install.sh";

function isInstallerPath(path: string): boolean {
  return path === INSTALLER_ASSET_PATH ||
    /^\/campfire\/v\d+\.\d+\.\d+\/install\.sh$/.test(path);
}

/**
 * The short measured installer route (TEL-001D). It serves the same asset as
 * `INSTALLER_ASSET_PATH` under a shorter path. Both spellings are matched —
 * the zone-prefixed original and the prefix-stripped one — so the route
 * behaves the same on the production zone and on a custom domain. Every
 * installer route (`/install`, `/campfire/install`, the asset path, and
 * versioned snapshots) is measured: each records one `install_requested` per
 * served 2xx.
 */
function isInstallRequestPath(path: string): boolean {
  return path === "/campfire/install" || apiPath(path) === "/install";
}

/**
 * The production zone route is `boringinfra.company/campfire/*`, which reaches
 * the Worker with a `/campfire` prefix, while custom domains and local runs use
 * the origin root. Accept both for API routes; the installer is matched against
 * the original request path so `/campfire/install.sh` keeps working.
 */
function apiPath(pathname: string): string {
  if (pathname === "/campfire") return "/";
  if (pathname.startsWith("/campfire/")) return pathname.slice("/campfire".length);
  return pathname;
}

export function isViewerReadMethod(value: string): value is ViewerReadMethod {
  return VIEWER_READ_SET.has(value);
}

export interface AssetsFetch {
  (request: Request): Promise<Response>;
}

function statusFor(code: CampfireErrorCode, unauthenticated: boolean): number {
  if (unauthenticated) {
    return 401;
  }
  switch (code) {
    case "Unauthorized":
    case "ParticipantRequired":
      return 403;
    case "WorkspaceNotFound":
    case "ActorNotFound":
    case "SessionNotFound":
    case "TeamNotFound":
    case "ArtifactNotFound":
    case "TaskNotFound":
    case "GoalNotFound":
    case "FindingNotFound":
    case "DecisionNotFound":
      return 404;
    case "RecallRestart":
      return 409;
    default:
      return 400;
  }
}

/** Viewer history must not carry a raw contribution payload. Other methods are unchanged. */
function projectViewerResult(method: string, result: unknown): unknown {
  return method === "get_record_history" ? projectViewerRecordHistory(result) : result;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function fail(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): Response {
  return json(
    status,
    details === undefined ? { ok: false, error: code, message } : { ok: false, error: code, message, details },
  );
}

function bearerToken(request: Request): string | undefined {
  const header = request.headers.get("authorization");
  if (header === null) return undefined;
  const match = /^Bearer\s+(\S+)/i.exec(header.trim());
  const token = match?.[1]?.trim();
  return token !== undefined && token.length > 0 ? token : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read at most `MAX_BODY_BYTES` from the request stream, cancelling as soon as
 * the cap is crossed.
 *
 * PSA-001 (S2): `Content-Length` is attacker-controlled and routinely absent on
 * a chunked request, so a declared length can never be the enforcement point.
 * Counting bytes as they arrive means an oversized body is abandoned mid-flight
 * rather than buffered and decoded in full — the distinction that matters on a
 * Worker, where buffering more than the per-request limit is a failure, not a
 * slow path. The count is on bytes, not characters, so multibyte content cannot
 * slip past by encoding narrow.
 */
async function readBoundedBody(
  request: Request,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; reason: "too_large" | "unreadable" }> {
  const reader = request.body?.getReader();
  if (reader === undefined) {
    return { ok: true, bytes: new Uint8Array(0) };
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    let item: { done?: boolean; value?: Uint8Array };
    try {
      item = await reader.read();
    } catch {
      return { ok: false, reason: "unreadable" };
    }
    if (item.done === true || item.value === undefined) break;
    length += item.value.byteLength;
    if (length > MAX_BODY_BYTES) {
      // Stop pulling. `cancel` propagates to the client connection.
      await reader.cancel().catch(() => undefined);
      return { ok: false, reason: "too_large" };
    }
    chunks.push(item.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

/**
 * PSA-001 (S3): a body read that fails is an internal condition, not a
 * statement about the caller's JSON. Keep a stable failure type and stage in
 * the operator channel; arbitrary exception text can itself contain secrets.
 */
function logInternalError(context: { route: string; stage: string }, error: unknown): void {
  console.error(
    JSON.stringify({ allow: false, error: "InternalError", route: context.route, stage: context.stage, kind: error instanceof Error ? "exception" : "non_exception" }),
  );
}

async function readJsonBody(request: Request): Promise<
  | { ok: true; method: unknown; params: unknown }
  | { ok: false; response: Response }
> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > MAX_BODY_BYTES) {
    return { ok: false, response: fail(400, "ValidationError", "Request body too large") };
  }
  const body = await readBoundedBody(request);
  if (!body.ok) {
    if (body.reason === "too_large") {
      return { ok: false, response: fail(400, "ValidationError", "Request body too large") };
    }
    return { ok: false, response: fail(400, "ValidationError", "Request body could not be read") };
  }
  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: false }).decode(body.bytes);
  } catch (error) {
    logInternalError({ route: "/v1/call", stage: "decode_body" }, error);
    return { ok: false, response: fail(400, "ValidationError", "Request body must be UTF-8 JSON") };
  }
  try {
    const parsed = raw.trim().length === 0 ? {} : (JSON.parse(raw) as { method?: unknown; params?: unknown });
    return { ok: true, method: parsed.method, params: parsed.params };
  } catch {
    return { ok: false, response: fail(400, "ValidationError", "Request body must be JSON") };
  }
}

/** Query params for GET /api/*; `limit` is coerced to a number. */
function queryParams(url: URL): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const [key, value] of url.searchParams) {
    if (key === "limit") {
      const n = Number(value);
      params[key] = Number.isInteger(n) ? n : value;
    } else {
      params[key] = value;
    }
  }
  return params;
}

function agentSessionIdOf(params: Record<string, unknown>): string | undefined {
  const v = params.agentSessionId;
  return typeof v === "string" && v.trim().length > 0 ? v : undefined;
}

/** Shared telemetry options for both handlers; see `TelemetryIngestOptions`. */
interface TelemetryHandlerOptions {
  /** Optional Analytics Engine dataset. Absent means telemetry is not provisioned. */
  telemetryDataset?: AnalyticsEngineDataset;
  /** Optional per-source budget for the anonymous ingestion route. */
  telemetryRateLimiter?: RateLimiterBinding;
  /** Optional integrity outcome measurement. */
  telemetryOpsDataset?: AnalyticsEngineDataset;
  /** Optional per-installation budget for the ingestion route. */
  telemetryIdRateLimiter?: RateLimiterBinding;
  /** Optional server-side idempotency guard (D1). Absent means the gate is off. */
  telemetryGuard?: TelemetryGuard;
  /** Defaults to `shadow` when a guard is present, else `off`. */
  telemetryGateMode?: TelemetryGateMode;
  /** Milliseconds since epoch, for release-time checks. Defaults to `Date.now`. */
  telemetryNow?: () => number;
}

function telemetryOptions(options: TelemetryHandlerOptions): {
  dataset?: AnalyticsEngineDataset;
  rateLimiter?: RateLimiterBinding;
  opsDataset?: AnalyticsEngineDataset;
  idRateLimiter?: RateLimiterBinding;
  guard?: TelemetryGuard;
  gateMode?: TelemetryGateMode;
  now?: () => number;
} {
  return {
    ...(options.telemetryDataset !== undefined ? { dataset: options.telemetryDataset } : {}),
    ...(options.telemetryRateLimiter !== undefined ? { rateLimiter: options.telemetryRateLimiter } : {}),
    ...(options.telemetryOpsDataset !== undefined ? { opsDataset: options.telemetryOpsDataset } : {}),
    ...(options.telemetryIdRateLimiter !== undefined ? { idRateLimiter: options.telemetryIdRateLimiter } : {}),
    ...(options.telemetryGuard !== undefined ? { guard: options.telemetryGuard } : {}),
    ...(options.telemetryGateMode !== undefined ? { gateMode: options.telemetryGateMode } : {}),
    ...(options.telemetryNow !== undefined ? { now: options.telemetryNow } : {}),
  };
}

export interface SyncWorkerHandlerOptions extends TelemetryHandlerOptions {
  service: CampfireService;
  assetsFetch?: AssetsFetch;
  store?: import("../store/store.js").CampfireStore;
  sourceEnv?: Record<string, string | undefined>;
  clock?: () => string;
  idSource?: IdSource;
  ingressBodyTimeoutMs?: number;
}

export interface D1WorkerHandlerOptions extends TelemetryHandlerOptions {
  store: AsyncCampfireStore;
  assetsFetch?: AssetsFetch;
  idSource?: IdSource;
  clock?: () => string;
  webhookEnv?: Record<string, string | undefined>;
  sourceEnv?: Record<string, string | undefined>;
  ingressBodyTimeoutMs?: number;
  /**
   * Called once a mutation that can enqueue a delivery has committed
   * (PSA-001 / P1). The Worker entrypoint uses it to schedule a delivery sweep
   * after writes only — reads, the installer, and telemetry cannot enqueue a
   * delivery, so sweeping after them only cost a D1 query. Fires after the
   * transaction commits and before the response is returned; a throw from the
   * callback must not change the caller's response, so it is swallowed.
   */
  onWriteCommitted?: () => void;
}

/** Re-point an installer request at `path`, preserving the original request when it already matches. */
function assetRequest(request: Request, path: string): Request {
  const url = new URL(request.url);
  if (url.pathname === path) return request;
  url.pathname = path;
  return new Request(url.toString(), { method: request.method, headers: request.headers });
}

async function fetchInstallerAsset(
  request: Request,
  assetsFetch: AssetsFetch | undefined,
  path: string,
): Promise<Response> {
  if (assetsFetch === undefined) {
    return fail(404, "ValidationError", `No asset binding for: ${path}`);
  }
  try {
    return await assetsFetch(assetRequest(request, path));
  } catch (error) {
    // The asset binding's error text describes Worker runtime internals, not the
    // caller's request. Same PSA-001 (S3) rule as the 500s.
    logInternalError({ route: path, stage: "assets_fetch" }, error);
    return fail(502, "ValidationError", "Installer asset is temporarily unavailable");
  }
}

async function handleInstaller(
  request: Request,
  assetsFetch: AssetsFetch | undefined,
  installer: InstallerServeOptions,
): Promise<Response | undefined> {
  const path = new URL(request.url).pathname;
  if (!isInstallerPath(path)) return undefined;
  return serveInstallerBytes(request, assetsFetch, path, installer);
}

/**
 * Token baked into served installer bytes: a single-use install claim.
 *
 * Fifteen minutes is headroom, not a session: the token only has to survive
 * the gap between fetching the script and the script's own completion POST on
 * the same machine. A stale token fails closed at the guard (`invalid_token`)
 * and the install still succeeds — only its measurement is lost.
 */
export const INSTALL_TOKEN_TTL_MS = 900_000;

/**
 * The exact bytes every telemetry-era installer script (v1.9.1 and later)
 * sends as its completion body. Replacing the first occurrence bakes the
 * token into the script's own POST without touching any stored script —
 * current and versioned snapshots are all covered by the same replacement.
 */
export const INSTALL_TOKEN_MARKER = `"installMethod":"curl"}`;

/** What the installer needs from the Worker to serve measured bytes. */
export interface InstallerServeOptions {
  telemetryDataset?: AnalyticsEngineDataset;
  guard?: TelemetryGuard;
  now?: () => number;
  /**
   * Optional per-source token-mint budget (TEL-001D): the same IP rate-limiter
   * binding the ingestion route uses, checked under a distinct
   * `install-token:` key prefix. Absent means minting is unbounded, exactly as
   * before the budget existed. Never stored; only an opaque derived key
   * reaches the binding.
   */
  rateLimiter?: RateLimiterBinding;
}

/**
 * Bake one single-use install token into served installer bytes.
 *
 * Anything unexpected — no guard, no token from the platform, an unreadable
 * body, a missing marker, a refused mint — serves the bytes unchanged. A
 * tokenized response carries `cache-control: no-store` so a shared cache can
 * never hand one installation's single-use token to another machine.
 * Content type and status are preserved either way. Per-source mint budgeting
 * lives one layer up in `serveInstallerBytes`, which skips this bake entirely
 * when the source is over budget.
 */
export async function withInstallToken(
  response: Response,
  guard: TelemetryGuard | undefined,
  nowMs: number,
): Promise<Response> {
  if (guard === undefined) return response;
  let token: string;
  try {
    token = crypto.randomUUID();
  } catch {
    return response;
  }
  let text: string;
  try {
    text = await response.text();
  } catch {
    return response;
  }
  // The body is consumed above, so every path below rebuilds it: the bytes
  // served are identical either way.
  const passthrough = (): Response =>
    new Response(text, { status: response.status, headers: response.headers });
  if (!text.includes(INSTALL_TOKEN_MARKER)) return passthrough();
  const issuedAt = new Date(nowMs).toISOString();
  const issued = await guard.issueInstallToken({
    token,
    issuedAt,
    expiresAt: new Date(nowMs + INSTALL_TOKEN_TTL_MS).toISOString(),
  });
  if (issued !== "issued") return passthrough();
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  return new Response(text.replace(INSTALL_TOKEN_MARKER, `"installMethod":"curl","installToken":"${token}"}`), {
    status: response.status,
    headers,
  });
}

/**
 * Serve installer bytes for one route: measured and tokenized on 2xx only.
 *
 * A 404 or 502 is a routing failure, not an installer fetch, and the bytes
 * pass through untouched — no measurement, no token — so a failure can never
 * inflate the top of the funnel or mint a claim for a download that failed.
 *
 * Token farming bound (TEL-001D): token minting consumes one unit of the
 * per-source budget under a distinct `install-token:` key prefix sharing the
 * 120/min binding budget. Over budget the bytes are served UNCHANGED — no
 * token, still one `install_requested` on 2xx, existing cache behavior for
 * untokenized bytes (no `no-store`) — so a flood cannot mint unbounded tokens
 * and a legit fetch is never broken; only its telemetry proof is deferred to
 * a retry. Limiter errors fail open (mint as today). No IP is stored anywhere;
 * only an opaque derived key reaches the binding.
 */
async function serveInstallerBytes(
  request: Request,
  assetsFetch: AssetsFetch | undefined,
  assetPath: string,
  installer: InstallerServeOptions,
): Promise<Response> {
  const response = await fetchInstallerAsset(request, assetsFetch, assetPath);
  if (response.status < 200 || response.status >= 300) return response;
  // Deferred so measurement can never delay or fail the download; the token
  // bake awaits the bytes because it rewrites them.
  void recordInstallRequested(installer.telemetryDataset).catch(() => undefined);
  if (await isInstallTokenRateLimited(installer.rateLimiter, request)) return response;
  return withInstallToken(response, installer.guard, (installer.now ?? Date.now)());
}

/**
 * `GET /install` — the official installer, measured (TEL-001D).
 *
 * The request is recorded only after the installer response has been produced,
 * and only when an installer body was actually served: a 404 or 502 is a
 * routing failure, not an installer request, and counting it would inflate the
 * top of the funnel against nothing. The record is deferred so measurement can
 * never delay or fail the download.
 */
async function handleInstallRequest(
  request: Request,
  assetsFetch: AssetsFetch | undefined,
  installer: InstallerServeOptions,
): Promise<Response | undefined> {
  const path = new URL(request.url).pathname;
  if (!isInstallRequestPath(path)) return undefined;
  // The short route serves the same asset, so it shares the measured,
  // tokenized serving path — one record per served 2xx either way.
  return serveInstallerBytes(request, assetsFetch, INSTALLER_ASSET_PATH, installer);
}

/**
 * Sync handler: reuses `CampfireService.resolveToken` +
 * `dispatchCampfireMethod` directly (local SQLite path, Vitest).
 */
export function createWorkerHandler(options: SyncWorkerHandlerOptions): (request: Request) => Promise<Response> {
  const { service, assetsFetch } = options;

  return async function handle(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const path = apiPath(url.pathname);
      url.pathname = path;

      // Matched ahead of the method split so a non-POST to the ingestion route
      // answers 405 from the adapter rather than falling through to the 404 the
      // GET branch produces for unknown paths. A 404 here would hide that the
      // route exists and that it requires POST.
      if (path === TELEMETRY_PATH) return await handleTelemetryEvent(telemetryOptions(options), request);
      const githubSourceId = githubIngressPathSourceId(path);
      if (githubSourceId !== undefined) {
        return await handleWorkerGithubIngress(request, githubSourceId, {
          mode: "sync",
          store: options.store,
          sourceEnv: options.sourceEnv,
          clock: options.clock,
          idSource: options.idSource,
          ingressBodyTimeoutMs: options.ingressBodyTimeoutMs,
        });
      }

      if (request.method === "GET") {
        // Every installer route is measured and tokenized through the same
        // serving path: the short route, the asset route, and versioned
        // snapshots each record one install_requested per served 2xx.
        const installer: InstallerServeOptions = {
          ...(options.telemetryDataset !== undefined ? { telemetryDataset: options.telemetryDataset } : {}),
          ...(options.telemetryGuard !== undefined ? { guard: options.telemetryGuard } : {}),
          ...(options.telemetryNow !== undefined ? { now: options.telemetryNow } : {}),
          // Token-mint budget reuses the ingestion IP limiter binding under a
          // distinct key prefix; no new binding, no route-shape change.
          ...(options.telemetryRateLimiter !== undefined ? { rateLimiter: options.telemetryRateLimiter } : {}),
        };
        const installRequest = await handleInstallRequest(request, assetsFetch, installer);
        if (installRequest !== undefined) return installRequest;
        const installerResponse = await handleInstaller(request, assetsFetch, installer);
        if (installerResponse !== undefined) return installerResponse;
        if (path.startsWith("/api/")) {
          return await handleSyncViewerGet(service, request, url);
        }
        return fail(404, "ValidationError", `Not found: ${path}`);
      }

      if (request.method !== "POST") {
        return fail(405, "ValidationError", `Method not allowed: ${request.method}`);
      }

      if (path === "/v1/enrollment/redeem") return await handleEnrollmentRedeem(service, request);
      if (path === "/v1/call") {
        return await handleSyncCall(service, request);
      }
      if (path === "/api/call") {
        return await handleSyncViewerPost(service, request);
      }
      return fail(404, "ValidationError", `Not found: ${path}`);
    } catch (error) {
      logInternalError({ route: apiPath(new URL(request.url).pathname), stage: "dispatch" }, error);
      return fail(500, "InternalError", "The request could not be completed");
    }
  };
}

/** Production handler: same routes over D1-backed `AsyncCampfireService`. */
export function createD1WorkerHandler(options: D1WorkerHandlerOptions): (request: Request) => Promise<Response> {
  const service: AsyncCampfireService = createAsyncCampfireService({
    store: options.store,
    ...(options.idSource !== undefined ? { idSource: options.idSource } : {}),
    ...(options.clock !== undefined ? { clock: options.clock } : {}),
    ...(options.webhookEnv !== undefined ? { webhookEnv: options.webhookEnv } : {}),
  });
  const assetsFetch = options.assetsFetch;
  const notifyWrite = (): void => {
    try {
      options.onWriteCommitted?.();
    } catch {
      // Delivery scheduling is an operational side effect; it must never be
      // able to change the outcome of a committed Campfire write.
    }
  };

  return async function handle(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const path = apiPath(url.pathname);
      url.pathname = path;

      if (path === "/v1/bridge") {
        return await handleAsyncBridgeReport(options.store, options.webhookEnv ?? {}, request);
      }

      // Matched ahead of the method split so a non-POST to the ingestion route
      // answers 405 rather than the 404 the GET branch produces (see the sync
      // handler above).
      if (path === TELEMETRY_PATH) return await handleTelemetryEvent(telemetryOptions(options), request);
      const githubSourceId = githubIngressPathSourceId(path);
      if (githubSourceId !== undefined) {
        return await handleWorkerGithubIngress(request, githubSourceId, {
          mode: "d1",
          store: options.store,
          sourceEnv: options.sourceEnv ?? options.webhookEnv,
          clock: options.clock,
          idSource: options.idSource,
          ingressBodyTimeoutMs: options.ingressBodyTimeoutMs,
        });
      }

      if (request.method === "GET") {
        const installer: InstallerServeOptions = {
          ...(options.telemetryDataset !== undefined ? { telemetryDataset: options.telemetryDataset } : {}),
          ...(options.telemetryGuard !== undefined ? { guard: options.telemetryGuard } : {}),
          ...(options.telemetryNow !== undefined ? { now: options.telemetryNow } : {}),
          // Same token-mint budget wiring as the sync handler above.
          ...(options.telemetryRateLimiter !== undefined ? { rateLimiter: options.telemetryRateLimiter } : {}),
        };
        const installRequest = await handleInstallRequest(request, assetsFetch, installer);
        if (installRequest !== undefined) return installRequest;
        const installerResponse = await handleInstaller(request, assetsFetch, installer);
        if (installerResponse !== undefined) return installerResponse;
        if (path.startsWith("/api/")) {
          return await handleAsyncViewerGet(service, request, url);
        }
        return fail(404, "ValidationError", `Not found: ${path}`);
      }

      if (request.method !== "POST") {
        return fail(405, "ValidationError", `Method not allowed: ${request.method}`);
      }

      if (path === "/v1/enrollment/redeem") return await handleEnrollmentRedeem(service, request);
      if (path === "/v1/call") {
        return await handleAsyncCall(service, request, notifyWrite);
      }
      if (path === "/api/call") {
        return await handleAsyncViewerPost(service, request);
      }
      return fail(404, "ValidationError", `Not found: ${path}`);
    } catch (error) {
      logInternalError({ route: apiPath(new URL(request.url).pathname), stage: "dispatch" }, error);
      return fail(500, "InternalError", "The request could not be completed");
    }
  };
}

function resolveSyncActor(service: CampfireService, token: string | undefined, method: string): ActorContext | Response {
  if (token === undefined) {
    return fail(401, "Unauthorized", "Missing bearer token");
  }
  try {
    return { actor: service.resolveToken(token) };
  } catch (error) {
    if (error instanceof CampfireError) {
      return fail(statusFor(error.code, true), error.code, error.message);
    }
    throw error;
  }
}

async function resolveAsyncActor(
  service: AsyncCampfireService,
  token: string | undefined,
): Promise<ActorContext | Response> {
  if (token === undefined) {
    return fail(401, "Unauthorized", "Missing bearer token");
  }
  try {
    return { actor: await service.resolveToken(token) };
  } catch (error) {
    if (error instanceof CampfireError) {
      return fail(statusFor(error.code, true), error.code, error.message);
    }
    throw error;
  }
}

async function handleSyncCall(service: CampfireService, request: Request): Promise<Response> {
  const token = bearerToken(request);
  const resolved = resolveSyncActor(service, token, "call");
  if (resolved instanceof Response) return resolved;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  if (typeof body.method !== "string" || body.method.trim().length === 0) {
    return fail(400, "ValidationError", "method is required");
  }
  const method = body.method.trim();
  if (!isCampfireHttpMethod(method)) {
    return fail(400, "ValidationError", `Unknown method: ${method}`);
  }
  if (body.params !== undefined && !isRecord(body.params)) {
    return fail(400, "ValidationError", "params must be an object");
  }
  const params: Record<string, unknown> = body.params ?? {};
  const ctx: ActorContext = { actor: resolved.actor };
  const sessionId = agentSessionIdOf(params);
  if (sessionId !== undefined) ctx.agentSessionId = sessionId;

  try {
    const result = dispatchCampfireMethod(service, ctx, method, params);
    return json(200, { ok: true, result });
  } catch (error) {
    if (error instanceof CampfireError) {
      return fail(
        statusFor(error.code, false),
        error.code,
        error.message,
        method === "preflight" ? error.details : undefined,
      );
    }
    throw error;
  }
}

async function handleAsyncCall(
  service: AsyncCampfireService,
  request: Request,
  onWriteCommitted?: () => void,
): Promise<Response> {
  const resolved = await resolveAsyncActor(service, bearerToken(request));
  if (resolved instanceof Response) return resolved;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  if (typeof body.method !== "string" || body.method.trim().length === 0) {
    return fail(400, "ValidationError", "method is required");
  }
  const method = body.method.trim();
  if (!isCampfireHttpMethod(method)) {
    return fail(400, "ValidationError", `Unknown method: ${method}`);
  }
  if (body.params !== undefined && !isRecord(body.params)) {
    return fail(400, "ValidationError", "params must be an object");
  }
  const params: Record<string, unknown> = body.params ?? {};
  const ctx: ActorContext = { actor: resolved.actor };
  const sessionId = agentSessionIdOf(params);
  if (sessionId !== undefined) ctx.agentSessionId = sessionId;

  try {
    const result = await dispatchCampfireMethodAsync(service, ctx, method, params);
    // A successful read (including /v1/call reads) cannot enqueue a delivery.
    // The closed event vocabulary determines which writes may have done so.
    if (isDeliveryEligibleMethod(method)) onWriteCommitted?.();
    return json(200, { ok: true, result });
  } catch (error) {
    if (error instanceof CampfireError) {
      return fail(
        statusFor(error.code, false),
        error.code,
        error.message,
        method === "preflight" ? error.details : undefined,
      );
    }
    throw error;
  }
}

async function handleSyncViewerPost(service: CampfireService, request: Request): Promise<Response> {
  const resolved = resolveSyncActor(service, bearerToken(request), "viewer");
  if (resolved instanceof Response) return resolved;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  if (typeof body.method !== "string" || body.method.trim().length === 0) {
    return fail(400, "ValidationError", "method is required");
  }
  const method = body.method.trim();
  if (!isViewerReadMethod(method)) {
    return fail(403, "Unauthorized", "Viewer is read-only");
  }
  if (body.params !== undefined && !isRecord(body.params)) {
    return fail(400, "ValidationError", "params must be an object");
  }
  const params: Record<string, unknown> = body.params ?? {};
  const ctx: ActorContext = { actor: resolved.actor };
  const sessionId = agentSessionIdOf(params);
  if (sessionId !== undefined) ctx.agentSessionId = sessionId;

  try {
    const result = dispatchCampfireMethod(service, ctx, method, params);
    return json(200, { ok: true, result: projectViewerResult(method, result) });
  } catch (error) {
    if (error instanceof CampfireError) {
      return fail(statusFor(error.code, false), error.code, error.message);
    }
    throw error;
  }
}

async function handleAsyncViewerPost(service: AsyncCampfireService, request: Request): Promise<Response> {
  const resolved = await resolveAsyncActor(service, bearerToken(request));
  if (resolved instanceof Response) return resolved;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  if (typeof body.method !== "string" || body.method.trim().length === 0) {
    return fail(400, "ValidationError", "method is required");
  }
  const method = body.method.trim();
  if (!isViewerReadMethod(method)) {
    return fail(403, "Unauthorized", "Viewer is read-only");
  }
  if (body.params !== undefined && !isRecord(body.params)) {
    return fail(400, "ValidationError", "params must be an object");
  }
  const params: Record<string, unknown> = body.params ?? {};
  const ctx: ActorContext = { actor: resolved.actor };
  const sessionId = agentSessionIdOf(params);
  if (sessionId !== undefined) ctx.agentSessionId = sessionId;

  try {
    const result = await dispatchCampfireMethodAsync(service, ctx, method, params);
    return json(200, { ok: true, result: projectViewerResult(method, result) });
  } catch (error) {
    if (error instanceof CampfireError) {
      return fail(statusFor(error.code, false), error.code, error.message);
    }
    throw error;
  }
}

async function handleSyncViewerGet(
  service: CampfireService,
  request: Request,
  url: URL,
): Promise<Response> {
  const method = url.pathname.slice("/api/".length).trim();
  if (method.length === 0 || !isViewerReadMethod(method)) {
    return fail(403, "Unauthorized", "Viewer is read-only");
  }
  const resolved = resolveSyncActor(service, bearerToken(request), method);
  if (resolved instanceof Response) return resolved;
  const params = queryParams(url);
  const ctx: ActorContext = { actor: resolved.actor };
  const sessionId = agentSessionIdOf(params);
  if (sessionId !== undefined) ctx.agentSessionId = sessionId;
  try {
    const result = dispatchCampfireMethod(service, ctx, method, params);
    return json(200, { ok: true, result: projectViewerResult(method, result) });
  } catch (error) {
    if (error instanceof CampfireError) {
      return fail(statusFor(error.code, false), error.code, error.message);
    }
    throw error;
  }
}

async function handleAsyncViewerGet(
  service: AsyncCampfireService,
  request: Request,
  url: URL,
): Promise<Response> {
  const method = url.pathname.slice("/api/".length).trim();
  if (method.length === 0 || !isViewerReadMethod(method)) {
    return fail(403, "Unauthorized", "Viewer is read-only");
  }
  const resolved = await resolveAsyncActor(service, bearerToken(request));
  if (resolved instanceof Response) return resolved;
  const params = queryParams(url);
  const ctx: ActorContext = { actor: resolved.actor };
  const sessionId = agentSessionIdOf(params);
  if (sessionId !== undefined) ctx.agentSessionId = sessionId;
  try {
    const result = await dispatchCampfireMethodAsync(service, ctx, method, params);
    return json(200, { ok: true, result: projectViewerResult(method, result) });
  } catch (error) {
    if (error instanceof CampfireError) {
      return fail(statusFor(error.code, false), error.code, error.message);
    }
    throw error;
  }
}

/**
 * Operator-only inspection of Worker/D1 delivery state. The credential is the
 * instance bridge operator token, not an actor token: bridge configuration and
 * delivery metadata are instance-level operator state, not workspace state, so
 * workspace authorization does not apply and no actor may read it. The report
 * redacts the webhook destination to an origin and never includes the signing
 * secret.
 */
async function handleAsyncBridgeReport(
  store: AsyncCampfireStore,
  webhookEnv: Record<string, string | undefined>,
  request: Request,
): Promise<Response> {
  if (request.method !== "GET") {
    return fail(405, "ValidationError", `Method not allowed: ${request.method}`);
  }
  const expected = readBridgeOperatorToken(webhookEnv);
  if (expected === undefined) {
    return fail(503, "Unauthorized", "Bridge inspection is not configured");
  }
  if (!bridgeOperatorTokenMatches(bearerToken(request), expected)) {
    return fail(401, "Unauthorized", "Bridge inspection requires the operator token");
  }
  const report = await collectBridgeReport(readWebhookBridgeConfig(webhookEnv), store);
  return json(200, { ok: true, result: report });
}

class GithubIngressReadTimeout extends Error {
  constructor() {
    super("github-ingress-read-timeout");
    this.name = "GithubIngressReadTimeout";
  }
}

async function readGithubIngressBytes(
  request: Request,
  maxBytes: number,
  timeoutMs: number,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; reason: "too_large" | "unreadable" | "timeout" }> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > maxBytes) {
    return { ok: false, reason: "too_large" };
  }
  const reader = request.body?.getReader();
  if (reader === undefined) return { ok: true, bytes: new Uint8Array(0) };
  const chunks: Uint8Array[] = [];
  let length = 0;
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, reason: "timeout" };
    }
    // Race each read against the remaining deadline so a hung chunk cannot
    // exceed the 10s budget (mirrors the Node `server.ts` destroy timer).
    // The deadline is checked between reads AND enforced during a read.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let item: { done?: boolean; value?: Uint8Array };
    try {
      item = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new GithubIngressReadTimeout()), remaining);
        }),
      ]);
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      if (error instanceof GithubIngressReadTimeout) return { ok: false, reason: "timeout" };
      return { ok: false, reason: "unreadable" };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    if (item.done === true || item.value === undefined) break;
    length += item.value.byteLength;
    if (length > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, reason: "too_large" };
    }
    chunks.push(item.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

async function handleWorkerGithubIngress(
  request: Request,
  sourceId: string,
  options: {
    mode: "sync" | "d1";
    store?: import("../store/store.js").CampfireStore | AsyncCampfireStore;
    sourceEnv?: Record<string, string | undefined>;
    clock?: () => string;
    idSource?: IdSource;
    ingressBodyTimeoutMs?: number;
  },
): Promise<Response> {
  if (request.method !== "POST") {
    return fail(405, "ValidationError", `Method not allowed: ${request.method}`);
  }
  const config = readGithubSourceConfig(options.sourceEnv ?? {});
  if (!config.configured || config.source.sourceId !== sourceId) {
    return fail(404, "ValidationError", "Unknown source");
  }
  if (!ingressTransportAllowed(new URL(request.url))) {
    return fail(400, "ValidationError", "HTTPS required");
  }
  if (!ingressContentTypeAllowed(request.headers.get("content-type") ?? undefined)) {
    return fail(415, "ValidationError", "Unsupported media type");
  }
  if (!ingressEncodingAllowed(
    request.headers.get("content-encoding") ?? undefined,
    request.headers.get("transfer-encoding") ?? undefined,
  )) {
    return fail(415, "ValidationError", "Unsupported encoding");
  }
  if (options.store === undefined) {
    return fail(503, "Unauthorized", "Integration unavailable");
  }
  const body = await readGithubIngressBytes(
    request,
    GITHUB_INGRESS_MAX_BODY_BYTES,
    options.ingressBodyTimeoutMs ?? GITHUB_INGRESS_BODY_DEADLINE_MS,
  );
  if (!body.ok) {
    if (body.reason === "too_large") return fail(413, "ValidationError", "Payload too large");
    if (body.reason === "timeout") return fail(408, "ValidationError", "Request timeout");
    return fail(400, "ValidationError", "Request body could not be read");
  }
  const ingressRequest = {
    sourceId,
    eventName: request.headers.get("x-github-event") ?? undefined,
    deliveryId: request.headers.get("x-github-delivery") ?? undefined,
    signatureHeader: request.headers.get("x-hub-signature-256") ?? undefined,
    rawBody: body.bytes,
  };
  const deps = {
    clock: options.clock ?? nowIso,
    idSource: options.idSource ?? createId,
    webhookEnv: options.sourceEnv,
  };
  const result = options.mode === "d1"
    ? await ingestGithubWorkflowRunAsync(options.store as AsyncCampfireStore, config.source, ingressRequest, deps)
    : await ingestGithubWorkflowRun(options.store as import("../store/store.js").CampfireStore, config.source, ingressRequest, deps);
  return json(result.status, result.body);
}

async function handleEnrollmentRedeem(
  service: CampfireService | AsyncCampfireService,
  request: Request,
): Promise<Response> {
  const secret = bearerToken(request);
  if (secret === undefined) return fail(401, "Unauthorized", "Missing invitation capability");
  try {
    const body = await readBoundedBody(request);
    if (!body.ok) {
      return fail(400, "ValidationError", body.reason === "too_large" ? "Request body too large" : "Request body could not be read");
    }
    let input: unknown;
    try { input = JSON.parse(new TextDecoder().decode(body.bytes)); } catch { return fail(400, "ValidationError", "Request body must be JSON"); }
    const result = await service.redeemEnrollment(secret, normalizeRedeemEnrollmentInput(input));
    // Enrollment records participants and contributions, not domain events.
    // It cannot enqueue a webhook delivery.
    return json(200, { ok: true, result });
  } catch (error) {
    if (error instanceof CampfireError) return fail(statusFor(error.code, false), error.code, error.message, error.details);
    logInternalError({ route: "/v1/enrollment/redeem", stage: "redeem" }, error);
    return fail(500, "InternalError", "Enrollment could not be completed; retry the saved request");
  }
}
