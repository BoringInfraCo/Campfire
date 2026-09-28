/**
 * Campfire HTTP adapter.
 *
 * Thin `node:http` front for CampfireService. One writer process; SQLite stays
 * on local disk. The bearer token is the actor — body actor ids are not used
 * as the acting principal.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { pumpWebhookDeliveries, type DeliveryPumpStore } from "../bridge/pump.js";
import {
  bridgeOperatorTokenMatches,
  readBridgeOperatorToken,
  readWebhookBridgeConfig,
} from "../bridge/config.js";
import { collectBridgeReport } from "../bridge/report.js";
import { CampfireError, Unauthorized, type CampfireErrorCode } from "../domain/errors.js";
import type { ActorContext } from "../service/authorization.js";
import { bridgeFromEnv } from "../service/outbox.js";
import type { CampfireRuntime } from "../runtime.js";
import type { CampfireStore } from "../store/store.js";
import { dispatchCampfireMethod, isCampfireHttpMethod } from "./dispatch.js";

export const DEFAULT_HTTP_HOST = "127.0.0.1";
export const DEFAULT_HTTP_PORT = 9414;

const MAX_BODY_BYTES = 1_048_576;

export interface HttpServerOptions {
  runtime: CampfireRuntime;
  host?: string;
  port?: number;
}

export interface RunningHttpServer {
  server: Server;
  host: string;
  port: number;
  url: string;
  close(): Promise<void>;
}

interface CallBody {
  method?: unknown;
  params?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
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

function logAccess(entry: {
  allow: boolean;
  method?: string;
  actorId?: string;
  actorType?: string;
  error?: string;
}): void {
  console.error(JSON.stringify(entry));
}

function bearerToken(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (typeof header !== "string") {
    return undefined;
  }
  const match = /^Bearer\s+(\S+)/i.exec(header.trim());
  const token = match?.[1]?.trim();
  return token !== undefined && token.length > 0 ? token : undefined;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > MAX_BODY_BYTES) {
      throw new CampfireError("ValidationError", "Request body too large");
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function fail(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
  access: { method?: string; actorId?: string; actorType?: string },
  details?: Record<string, unknown>,
): void {
  logAccess({ allow: false, error: code, ...access });
  writeJson(
    res,
    status,
    details === undefined ? { ok: false, error: code, message } : { ok: false, error: code, message, details },
  );
}

function asPumpStore(store: CampfireStore): DeliveryPumpStore {
  return {
    listDueWebhookDeliveries: (input) => Promise.resolve(store.listDueWebhookDeliveries(input)),
    getDomainEvent: (id) => Promise.resolve(store.getDomainEvent(id)),
    claimWebhookDelivery: (id, input) => Promise.resolve(store.claimWebhookDelivery(id, input)),
    markWebhookDeliveryDelivered: (id, claimToken, deliveredAt) =>
      Promise.resolve(store.markWebhookDeliveryDelivered(id, claimToken, deliveredAt)),
    markWebhookDeliveryRetry: (id, claimToken, input) =>
      Promise.resolve(store.markWebhookDeliveryRetry(id, claimToken, input)),
  };
}

/**
 * Operator-only inspection of delivery state for a hosted listener. The
 * credential is the instance bridge operator token, not an actor token:
 * bridge configuration and delivery metadata are instance-level operator
 * state, so no actor — human or agent — may read it through workspace
 * authorization. The shared report builder redacts the webhook URL to an
 * origin and never includes the signing secret.
 */
async function handleBridgeReport(
  req: IncomingMessage,
  res: ServerResponse,
  store: CampfireStore,
): Promise<void> {
  if (req.method !== "GET") {
    fail(res, 405, "ValidationError", `Method not allowed: ${req.method ?? "unknown"}`, {});
    return;
  }
  const expected = readBridgeOperatorToken(process.env);
  if (expected === undefined) {
    fail(res, 503, "Unauthorized", "Bridge inspection is not configured", {});
    return;
  }
  if (!bridgeOperatorTokenMatches(bearerToken(req), expected)) {
    fail(res, 401, "Unauthorized", "Bridge inspection requires the operator token", {});
    return;
  }
  const report = await collectBridgeReport(readWebhookBridgeConfig(process.env), store);
  writeJson(res, 200, { ok: true, result: report });
}

export async function startCampfireHttpServer(options: HttpServerOptions): Promise<RunningHttpServer> {
  const host = options.host ?? DEFAULT_HTTP_HOST;
  const requestedPort = options.port ?? DEFAULT_HTTP_PORT;
  const { service } = options.runtime;
  const pumpStore = asPumpStore(options.runtime.store);
  let pumping = false;

  async function deliverPending(): Promise<void> {
    if (pumping) return;
    pumping = true;
    try {
      await pumpWebhookDeliveries({
        store: pumpStore,
        bridge: bridgeFromEnv(process.env),
        now: () => new Date().toISOString(),
      });
    } catch {
      // Delivery failure must not change the Campfire response. The row stays pending.
      console.error(JSON.stringify({ allow: false, error: "webhook_delivery_failed" }));
    } finally {
      pumping = false;
    }
  }

  const server = createServer((req, res) => {
    void handleRequest(req, res).catch((error: unknown) => {
      if (res.writableEnded) return;
      const message = error instanceof Error ? error.message : String(error);
      fail(res, 500, "InternalError", message, {});
    });
  });

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? "/";
    const path = url.split("?")[0];
    if (path === "/v1/bridge") {
      await handleBridgeReport(req, res, options.runtime.store);
      return;
    }
    if (path !== "/v1/call") {
      fail(res, 404, "ValidationError", `Not found: ${path}`, {});
      return;
    }
    if (req.method !== "POST") {
      fail(res, 405, "ValidationError", `Method not allowed: ${req.method ?? "unknown"}`, {});
      return;
    }

    const token = bearerToken(req);
    if (token === undefined) {
      fail(res, 401, "Unauthorized", "Missing bearer token", {});
      return;
    }

    let raw: string;
    try {
      raw = await readBody(req);
    } catch (error) {
      if (error instanceof CampfireError) {
        fail(res, 400, error.code, error.message, {});
        return;
      }
      throw error;
    }

    let parsed: CallBody;
    try {
      parsed = raw.length === 0 ? {} : (JSON.parse(raw) as CallBody);
    } catch {
      fail(res, 400, "ValidationError", "Request body must be JSON", {});
      return;
    }

    if (typeof parsed.method !== "string" || parsed.method.trim().length === 0) {
      fail(res, 400, "ValidationError", "method is required", {});
      return;
    }
    const method = parsed.method.trim();
    if (!isCampfireHttpMethod(method)) {
      fail(res, 400, "ValidationError", `Unknown method: ${method}`, { method });
      return;
    }
    if (parsed.params !== undefined && !isRecord(parsed.params)) {
      fail(res, 400, "ValidationError", "params must be an object", { method });
      return;
    }
    const params: Record<string, unknown> = parsed.params ?? {};

    let actor;
    try {
      actor = service.resolveToken(token);
    } catch (error) {
      if (error instanceof Unauthorized) {
        fail(res, 401, error.code, error.message, { method });
        return;
      }
      if (error instanceof CampfireError) {
        fail(res, statusFor(error.code, true), error.code, error.message, { method });
        return;
      }
      throw error;
    }

    // Token is the actor. Body actorId/actorType never become ctx.actor
    // (invite/issue_token still use those fields as the *subject*).
    const ctx: ActorContext = { actor };
    const sessionId = params.agentSessionId;
    if (typeof sessionId === "string" && sessionId.trim().length > 0) {
      ctx.agentSessionId = sessionId;
    }

    try {
      const result = dispatchCampfireMethod(service, ctx, method, params);
      logAccess({
        allow: true,
        method,
        actorId: actor.actorId,
        actorType: actor.actorType,
      });
      writeJson(res, 200, { ok: true, result });
      // The mutation transaction has already committed. Delivery is outside it.
      void deliverPending();
    } catch (error) {
      if (error instanceof CampfireError) {
        fail(
          res,
          statusFor(error.code, false),
          error.code,
          error.message,
          { method, actorId: actor.actorId, actorType: actor.actorType },
          method === "preflight" ? error.details : undefined,
        );
        return;
      }
      throw error;
    }
  }

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("error", onError);
      reject(error);
    };
    server.once("error", onError);
    server.listen(requestedPort, host, () => {
      server.off("error", onError);
      resolve();
    });
  });

  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : requestedPort;
  let closed = false;
  const retryTimer = setInterval(() => {
    void deliverPending();
  }, 1000);
  retryTimer.unref();

  return {
    server,
    host,
    port,
    url: `http://${host}:${port}`,
    close(): Promise<void> {
      if (closed) return Promise.resolve();
      closed = true;
      clearInterval(retryTimer);
      return new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}
