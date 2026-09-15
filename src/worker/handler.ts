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
 * - `POST /api/call` — viewer read-methods only (compat with the local
 *   Viewer client), bearer required in Workers (no process identity here).
 * - `GET /api/<viewerMethod>` — read-gated viewer APIs with query params.
 * - `GET /, /app.css, /app.js` — viewer static via Workers Assets
 *   (`env.ASSETS.fetch`); the handler takes the fetcher as a dependency so
 *   tests can inject a mock.
 *
 * `createD1WorkerHandler` is the production entry: same routes over
 * `AsyncCampfireService` (D1). Same validation, same status mapping.
 */
import { CampfireError, type CampfireErrorCode } from "../domain/errors.js";
import type { ActorContext } from "../service/authorization.js";
import type { CampfireService } from "../service/service.js";
import { dispatchCampfireMethod, isCampfireHttpMethod } from "../http/dispatch.js";
import { dispatchCampfireMethodAsync } from "./async-dispatch.js";
import { createAsyncCampfireService, type AsyncCampfireService } from "./async-service.js";
import type { AsyncCampfireStore } from "./d1-store.js";
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

const STATIC_PATHS: ReadonlySet<string> = new Set([
  "/",
  "/app.css",
  "/app.js",
  "/campfire-mark.svg",
]);

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

function fail(status: number, code: string, message: string): Response {
  return json(status, { ok: false, error: code, message });
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

async function readJsonBody(request: Request): Promise<
  | { ok: true; method: unknown; params: unknown }
  | { ok: false; response: Response }
> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > MAX_BODY_BYTES) {
    return { ok: false, response: fail(400, "ValidationError", "Request body too large") };
  }
  let raw: string;
  try {
    raw = await request.text();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, response: fail(400, "ValidationError", message) };
  }
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return { ok: false, response: fail(400, "ValidationError", "Request body too large") };
  }
  try {
    const parsed = raw.length === 0 ? {} : (JSON.parse(raw) as { method?: unknown; params?: unknown });
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
}

export interface D1WorkerHandlerOptions {
  store: AsyncCampfireStore;
  assetsFetch?: AssetsFetch;
  idSource?: IdSource;
  clock?: () => string;
}

async function handleStatic(
  request: Request,
  assetsFetch: AssetsFetch | undefined,
): Promise<Response | undefined> {
  const path = new URL(request.url).pathname;
  if (!STATIC_PATHS.has(path)) return undefined;
  if (assetsFetch === undefined) {
    return fail(404, "ValidationError", `No asset binding for: ${path}`);
  }
  try {
    return await assetsFetch(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(502, "ValidationError", `Asset fetch failed: ${message}`);
  }
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
      const path = url.pathname;

      if (request.method === "GET") {
        const staticResponse = await handleStatic(request, assetsFetch);
        if (staticResponse !== undefined) return staticResponse;
        if (path.startsWith("/api/")) {
          return await handleSyncViewerGet(service, request, url);
        }
        return fail(404, "ValidationError", `Not found: ${path}`);
      }

      if (request.method !== "POST") {
        return fail(405, "ValidationError", `Method not allowed: ${request.method}`);
      }

      if (path === "/v1/call") {
        return await handleSyncCall(service, request);
      }
      if (path === "/api/call") {
        return await handleSyncViewerPost(service, request);
      }
      return fail(404, "ValidationError", `Not found: ${path}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return fail(500, "InternalError", message);
    }
  };
}

/** Production handler: same routes over D1-backed `AsyncCampfireService`. */
export function createD1WorkerHandler(options: D1WorkerHandlerOptions): (request: Request) => Promise<Response> {
  const service: AsyncCampfireService = createAsyncCampfireService({
    store: options.store,
    ...(options.idSource !== undefined ? { idSource: options.idSource } : {}),
    ...(options.clock !== undefined ? { clock: options.clock } : {}),
  });
  const assetsFetch = options.assetsFetch;

  return async function handle(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      if (request.method === "GET") {
        const staticResponse = await handleStatic(request, assetsFetch);
        if (staticResponse !== undefined) return staticResponse;
        if (path.startsWith("/api/")) {
          return await handleAsyncViewerGet(service, request, url);
        }
        return fail(404, "ValidationError", `Not found: ${path}`);
      }

      if (request.method !== "POST") {
        return fail(405, "ValidationError", `Method not allowed: ${request.method}`);
      }

      if (path === "/v1/call") {
        return await handleAsyncCall(service, request);
      }
      if (path === "/api/call") {
        return await handleAsyncViewerPost(service, request);
      }
      return fail(404, "ValidationError", `Not found: ${path}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return fail(500, "InternalError", message);
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
      return fail(statusFor(error.code, false), error.code, error.message);
    }
    throw error;
  }
}

async function handleAsyncCall(service: AsyncCampfireService, request: Request): Promise<Response> {
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
    return json(200, { ok: true, result });
  } catch (error) {
    if (error instanceof CampfireError) {
      return fail(statusFor(error.code, false), error.code, error.message);
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
