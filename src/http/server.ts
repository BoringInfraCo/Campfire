/**
 * Campfire HTTP adapter.
 *
 * Thin `node:http` front for CampfireService. One writer process; SQLite stays
 * on local disk. The bearer token is the actor — body actor ids are not used
 * as the acting principal.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { CampfireError, Unauthorized, type CampfireErrorCode } from "../domain/errors.js";
import type { ActorContext } from "../service/authorization.js";
import type { CampfireRuntime } from "../runtime.js";
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
): void {
  logAccess({ allow: false, error: code, ...access });
  writeJson(res, status, { ok: false, error: code, message });
}

export async function startCampfireHttpServer(options: HttpServerOptions): Promise<RunningHttpServer> {
  const host = options.host ?? DEFAULT_HTTP_HOST;
  const requestedPort = options.port ?? DEFAULT_HTTP_PORT;
  const { service } = options.runtime;

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
    } catch (error) {
      if (error instanceof CampfireError) {
        fail(res, statusFor(error.code, false), error.code, error.message, {
          method,
          actorId: actor.actorId,
          actorType: actor.actorType,
        });
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

  return {
    server,
    host,
    port,
    url: `http://${host}:${port}`,
    close(): Promise<void> {
      if (closed) return Promise.resolve();
      closed = true;
      return new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}
