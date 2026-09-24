/**
 * Campfire Viewer: loopback read-only projection.
 *
 * The browser never receives a token. Identity is bound by the process that
 * calls startCampfireViewer (CLI local SQLite actor or CAMPFIRE_URL + token).
 * Writes are rejected before options.call so the Viewer cannot mutate state.
 */
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CampfireError, type CampfireErrorCode } from "../domain/errors.js";

export const DEFAULT_VIEWER_HOST = "127.0.0.1";
export const DEFAULT_VIEWER_PORT = 9415;

export const VIEWER_THEMES = ["campfire", "fx"] as const;

export type ViewerTheme = (typeof VIEWER_THEMES)[number];

export const DEFAULT_VIEWER_THEME: ViewerTheme = "campfire";

export function isViewerTheme(value: string): value is ViewerTheme {
  return (VIEWER_THEMES as readonly string[]).includes(value);
}

export function resolveViewerTheme(value: unknown): ViewerTheme {
  return typeof value === "string" && isViewerTheme(value) ? value : DEFAULT_VIEWER_THEME;
}

export const VIEWER_READ_METHODS = [
  "whoami",
  "list_workspaces",
  "get_workspace",
  "get_workspace_context",
  "get_activity",
] as const;

export type ViewerReadMethod = (typeof VIEWER_READ_METHODS)[number];

const VIEWER_READ_METHOD_SET: ReadonlySet<string> = new Set(VIEWER_READ_METHODS);

const MAX_BODY_BYTES = 1_048_576;

const STATIC_DIR = fileURLToPath(new URL("./static/", import.meta.url));

const STATIC_ROUTES: Record<string, { file: string; type: string }> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/app.css": { file: "app.css", type: "text/css; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
  // Brand logomark (ink variant) for the masthead. Static, read-only.
  "/campfire-mark.svg": { file: "campfire-mark.svg", type: "image/svg+xml" },
};

export interface ViewerServerOptions {
  call: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  host?: string;
  port?: number;
  /** Initial color theme for the Viewer shell. Validated against VIEWER_THEMES; defaults to campfire. */
  theme?: string;
  /**
   * Non-loopback binds (anything outside 127.0.0.1 / ::1 / localhost)
   * require explicit opt-in. The Viewer carries the operator's authority
   * (options.call is pre-authorized); binding it beyond loopback without
   * intent would expose that authority to the network.
   */
  allowRemote?: boolean;
}

export interface RunningViewer {
  url: string;
  host: string;
  port: number;
  close(): Promise<void>;
}

interface CallBody {
  method?: unknown;
  params?: unknown;
}

export function isViewerReadMethod(value: string): value is ViewerReadMethod {
  return VIEWER_READ_METHOD_SET.has(value);
}

/** Loopback-only by default. Anything else requires --allow-remote. */
export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[(.*)\]$/, "$1");
  return (
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "::ffff:127.0.0.1" ||
    normalized === "localhost"
  );
}

export function assertViewerHost(host: string, allowRemote?: boolean): void {
  if (!isLoopbackHost(host) && allowRemote !== true) {
    throw new CampfireError(
      "Unauthorized",
      `Refusing non-loopback Viewer host "${host}" without --allow-remote (loopback: 127.0.0.1, ::1, localhost)`,
    );
  }
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

function fail(res: ServerResponse, status: number, code: string, message: string): void {
  writeJson(res, status, { ok: false, error: code, message });
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

export async function startCampfireViewer(options: ViewerServerOptions): Promise<RunningViewer> {
  const host = options.host ?? DEFAULT_VIEWER_HOST;
  const requestedPort = options.port ?? DEFAULT_VIEWER_PORT;
  assertViewerHost(host, options.allowRemote);

  const server = createServer((req, res) => {
    void handleRequest(req, res).catch((error: unknown) => {
      if (res.writableEnded) return;
      const message = error instanceof Error ? error.message : String(error);
      fail(res, 500, "InternalError", message);
    });
  });

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? "/";
    const path = url.split("?")[0] ?? "/";

    if (req.method === "GET") {
      const route = STATIC_ROUTES[path];
      if (route === undefined) {
        fail(res, 404, "ValidationError", `Not found: ${path}`);
        return;
      }
      const filePath = join(STATIC_DIR, route.file);
      let data: Buffer;
      try {
        data = await readFile(filePath);
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          fail(res, 404, "ValidationError", `Not found: ${path}`);
          return;
        }
        throw error;
      }
      if (route.file === "index.html") {
        const theme = resolveViewerTheme(options.theme);
        let html = data.toString("utf8");
        if (html.includes("data-theme=")) {
          html = html.replace(/data-theme="[^"]*"/, `data-theme="${theme}"`);
        } else {
          html = html.replace('<html lang="en"', `<html lang="en" data-theme="${theme}"`);
        }
        data = Buffer.from(html, "utf8");
      }
      res.writeHead(200, {
        "content-type": route.type,
        "content-length": data.byteLength,
      });
      res.end(data);
      return;
    }

    if (path !== "/api/call") {
      fail(res, 404, "ValidationError", `Not found: ${path}`);
      return;
    }
    if (req.method !== "POST") {
      fail(res, 405, "ValidationError", `Method not allowed: ${req.method ?? "unknown"}`);
      return;
    }

    // Token is not read from the request. Identity is entirely options.call.
    let raw: string;
    try {
      raw = await readBody(req);
    } catch (error) {
      if (error instanceof CampfireError) {
        fail(res, 400, error.code, error.message);
        return;
      }
      throw error;
    }

    let parsed: CallBody;
    try {
      parsed = raw.length === 0 ? {} : (JSON.parse(raw) as CallBody);
    } catch {
      fail(res, 400, "ValidationError", "Request body must be JSON");
      return;
    }

    if (typeof parsed.method !== "string" || parsed.method.trim().length === 0) {
      fail(res, 400, "ValidationError", "method is required");
      return;
    }
    const method = parsed.method.trim();
    if (!isViewerReadMethod(method)) {
      fail(res, 403, "Unauthorized", "Viewer is read-only");
      return;
    }
    if (parsed.params !== undefined && !isRecord(parsed.params)) {
      fail(res, 400, "ValidationError", "params must be an object");
      return;
    }
    const params: Record<string, unknown> | undefined = parsed.params;

    try {
      const result = await options.call(method, params);
      writeJson(res, 200, { ok: true, result });
    } catch (error) {
      if (error instanceof CampfireError) {
        fail(res, statusFor(error.code, false), error.code, error.message);
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
