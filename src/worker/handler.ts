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
 * - `GET /campfire/install.sh` and versioned installer paths — the installer
 *   assets served through `env.ASSETS.fetch`. The journal itself is
 *   served by the loopback Viewer process, where the bearer stays server-side.
 *
 * `createD1WorkerHandler` is the production entry: same routes over
 * `AsyncCampfireService` (D1). Same validation, same status mapping.
 */
import { CampfireError, type CampfireErrorCode } from "../domain/errors.js";
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
  recordInstallRequested,
  TELEMETRY_PATH,
  type AnalyticsEngineDataset,
  type RateLimiterBinding,
} from "./telemetry.js";
import type { IdSource } from "../domain/ids.js";

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
] as const;

type ViewerReadMethod = (typeof VIEWER_READ_METHODS)[number];

const VIEWER_READ_SET: ReadonlySet<string> = new Set(VIEWER_READ_METHODS);

/** The one installer asset. `/campfire/install` serves this file under a shorter path. */
const INSTALLER_ASSET_PATH = "/campfire/install.sh";

function isInstallerPath(path: string): boolean {
  return path === INSTALLER_ASSET_PATH ||
    /^\/campfire\/v\d+\.\d+\.\d+\/install\.sh$/.test(path);
}

/**
 * The measured installer route (TEL-001D). Deliberately not an
 * `isInstallerPath` case: those `.sh` paths serve an asset unchanged and stay
 * unmeasured, while this one additionally records `install_requested`. Both
 * spellings are matched — the zone-prefixed original and the prefix-stripped
 * one — so the route behaves the same on the production zone and on a custom
 * domain.
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
    default:
      return 400;
  }
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

export interface SyncWorkerHandlerOptions {
  service: CampfireService;
  assetsFetch?: AssetsFetch;
  /** Optional Analytics Engine dataset. Absent means telemetry is not provisioned. */
  telemetryDataset?: AnalyticsEngineDataset;
  /** Optional per-source budget for the anonymous ingestion route. */
  telemetryRateLimiter?: RateLimiterBinding;
}

export interface D1WorkerHandlerOptions {
  store: AsyncCampfireStore;
  assetsFetch?: AssetsFetch;
  idSource?: IdSource;
  clock?: () => string;
  webhookEnv?: Record<string, string | undefined>;
  telemetryDataset?: AnalyticsEngineDataset;
  /** Optional per-source budget for the anonymous ingestion route. */
  telemetryRateLimiter?: RateLimiterBinding;
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
): Promise<Response | undefined> {
  const path = new URL(request.url).pathname;
  if (!isInstallerPath(path)) return undefined;
  return fetchInstallerAsset(request, assetsFetch, path);
}

/**
 * `GET /install` — the official installer, measured (TEL-001D).
 *
 * The request is recorded only after the installer response has been produced,
 * and only when an installer body was actually served: a 404 or 502 is a
 * routing failure, not an installer request, and counting it would inflate the
 * top of the funnel against nothing. The write is deferred so measurement can
 * never delay or fail the download.
 */
async function handleInstallRequest(
  request: Request,
  assetsFetch: AssetsFetch | undefined,
  telemetryDataset: AnalyticsEngineDataset | undefined,
): Promise<Response | undefined> {
  const path = new URL(request.url).pathname;
  if (!isInstallRequestPath(path)) return undefined;
  const response = await fetchInstallerAsset(request, assetsFetch, INSTALLER_ASSET_PATH);
  if (response.status >= 200 && response.status < 300) {
    void recordInstallRequested(telemetryDataset).catch(() => undefined);
  }
  return response;
}

/**
 * Sync handler: reuses `CampfireService.resolveToken` +
 * `dispatchCampfireMethod` directly (local SQLite path, Vitest).
 */
export function createWorkerHandler(options: SyncWorkerHandlerOptions): (request: Request) => Promise<Response> {
  const { service, assetsFetch, telemetryDataset, telemetryRateLimiter } = options;

  return async function handle(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const path = apiPath(url.pathname);
      url.pathname = path;

      // Matched ahead of the method split so a non-POST to the ingestion route
      // answers 405 from the adapter rather than falling through to the 404 the
      // GET branch produces for unknown paths. A 404 here would hide that the
      // route exists and that it requires POST.
      if (path === TELEMETRY_PATH) return await handleTelemetryEvent({ dataset: telemetryDataset, rateLimiter: telemetryRateLimiter }, request);

      if (request.method === "GET") {
        const installRequest = await handleInstallRequest(request, assetsFetch, telemetryDataset);
        if (installRequest !== undefined) return installRequest;
        const installerResponse = await handleInstaller(request, assetsFetch);
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
  const telemetryDataset = options.telemetryDataset;
  const telemetryRateLimiter = options.telemetryRateLimiter;
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
      if (path === TELEMETRY_PATH) return await handleTelemetryEvent({ dataset: telemetryDataset, rateLimiter: telemetryRateLimiter }, request);

      if (request.method === "GET") {
        const installRequest = await handleInstallRequest(request, assetsFetch, telemetryDataset);
        if (installRequest !== undefined) return installRequest;
        const installerResponse = await handleInstaller(request, assetsFetch);
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
    return json(200, { ok: true, result });
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
    return json(200, { ok: true, result });
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
    return json(200, { ok: true, result });
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
    return json(200, { ok: true, result });
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
