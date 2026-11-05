/**
 * Campfire intent bridge: the desktop app's narrowly authenticated write
 * channel (Phase C).
 *
 * The visual app runs read-only today (Viewer proxy on 127.0.0.1:9415). This
 * bridge is the separate, explicit-start command channel: the desktop sends
 * typed intents over loopback, and the bridge forwards ONLY the allowlisted
 * methods (src/intent/allowlist.ts) through the operator's own call closure —
 * the same pre-authorized process-closure pattern as the Viewer
 * (`campfire view`) and `campfire up`.
 *
 * Boundary invariants:
 * - The desktop holds no token to any Campfire surface. Identity is entirely
 *   the process that starts the bridge (local operator human or hosted human
 *   credential); requests carry no token and no acting actor id, and the
 *   bridge is bound to the operator human at startup.
 * - Allowlist enforcement happens BEFORE options.call, so no unallowlisted
 *   method can even reach the service dispatch.
 * - The bridge NEVER reads the database itself. It has no runtime, no store,
 *   and no read closure; every result comes from options.call.
 * - Loopback-only with no --allow-remote escape hatch (unlike the Viewer: a
 *   Viewer bounds viewers to read data, this bridge carries the operator's
 *   WRITE authority), Host-header checked, 256 KiB body cap, per-request
 *   8s deadline, and the same `{ok:true,result}` / `{ok:false,error,message}`
 *   envelope as the Viewer and `campfireHttpCall` (src/http/client.ts), so a
 *   desktop client speaks one error contract for both channels.
 *
 * // OPEN: end-to-end conflict precondition (SQLite + D1 proof pending MAC evidence)
 * - `expected` handling today: the bridge validates the shape of
 *   `{ workspaceId, updatedAt? }` and serializes every invoke in this process
 *   through one in-process promise queue. Record methods do not carry a
 *   verified workspace id, so a per-workspace split would race. It cannot compare
 *   `expected.updatedAt` against current state because it has no read
 *   closure — a pre-read would be a second authorization path and a TOCTOU
 *   window of its own. End-to-end conflict handling (a concurrent agenda
 *   change via CLI or MCP while the desktop acts) therefore still requires a
 *   service-level precondition (compare-and-set on the record's updatedAt)
 *   in CampfireService.updateTask and the async (D1) service. Until that
 *   lands, the bridge is serialized per process, not per record, and
 *   `expected.updatedAt` is transported shape-checked metadata only.
 * - Publication blockage: every allowlisted method is write-classed by
 *   isPublicationBlockedMethod (src/publication/state.ts). The bridge does
 *   not bypass or pre-screen that gate; it forwards, and the underlying call
 *   closure (local: assertLocalWritesAllowed; hosted: the Worker's alpha
 *   pause) fails closed upstream.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { installedCampfireVersion } from "../bootstrap/version.js";
import { CampfireError, type CampfireErrorCode } from "../domain/errors.js";
import type { ActorRef } from "../domain/types.js";
import { INTENT_METHODS, intentAllowlistMessage, isIntentMethod } from "./allowlist.js";
import { isAllowedViewerHost, isLoopbackHost } from "../viewer/server.js";

export const DEFAULT_INTENT_HOST = "127.0.0.1";
export const DEFAULT_INTENT_PORT = 9416;

/** Bounded bodies: intents are typed envelopes, not file uploads. 256 KiB. */
const MAX_BODY_BYTES = 262_144;

/** Per-request deadline. A stuck upstream must not hold the desktop's UI. */
const REQUEST_TIMEOUT_MS = 8_000;

export interface RunningIntentBridge {
  url: string;
  host: string;
  port: number;
  close(): Promise<void>;
}

export interface IntentBridgeOptions {
  /**
   * The pre-authorized operator call closure. Locally this closes over the
   * operator human actor context (no token on any HTTP surface); with a
   * hosted profile it relays the SAME narrow allowlist through
   * `campfireHttpCall` using the operator's own human credential.
   */
  call: (method: string, params: Record<string, unknown>) => Promise<unknown>;
  host?: string;
  port?: number;
  /** The operator identity the process closure resolved, for access receipts only. */
  actor: ActorRef;
  /** Access receipt hook. Default: structured JSON on stderr, like the HTTP server. */
  log?: (entry: IntentBridgeLogEntry) => void;
}

export interface IntentBridgeLogEntry {
  allow: boolean;
  method?: string;
  actorId?: string;
  actorType?: string;
  error?: string;
}

interface IntentBody {
  method?: unknown;
  params?: unknown;
  expected?: unknown;
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

/**
 * Mirrors the status mapping of src/http/server.ts (`statusFor`, not
 * exported). No Campfire domain code raises a deadline expiry, so 504 for
 * `Timeout` is the bridge's own addition, mapped by string at the call site.
 */
function statusFor(code: CampfireErrorCode, unauthenticated: boolean): number {
  if (unauthenticated) {
    return 401;
  }
  switch (code) {
    case "RateLimited":
      return 429;
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

/**
 * One queue for this bridge process.
 *
 * `update_task`, `accept_decision`, and `retire_decision` do not carry
 * `params.workspaceId`. `expected.workspaceId` is shape-checked only and is
 * not looked up against the record, so using it as a mutex key would let
 * those writes run beside a `create_task` for the same workspace. Until the
 * service compare-and-set exists, every intent in this process waits on one
 * queue.
 */
function serializationKeyOf(): string {
  return "intent";
}

export interface IntentExpected {
  workspaceId: string;
  updatedAt?: string;
}

/**
 * Validate the `expected` envelope: `{ workspaceId: string, updatedAt?: string }`.
 * The bridge cannot check freshness (no read closure — see the OPEN comment
 * in the module doc), so passing shape validation means the envelope was
 * transported faithfully and the workspace id is at least well-formed.
 */
export function parseIntentExpected(value: unknown): IntentExpected | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new CampfireError("ValidationError", "expected must be an object", { field: "expected" });
  }
  const workspaceId = value.workspaceId;
  if (typeof workspaceId !== "string" || workspaceId.trim().length === 0) {
    throw new CampfireError("ValidationError", "expected.workspaceId is required", { field: "expected" });
  }
  const updatedAt = value.updatedAt;
  if (updatedAt !== undefined && updatedAt !== null) {
    if (typeof updatedAt !== "string" || updatedAt.trim().length === 0) {
      throw new CampfireError("ValidationError", "expected.updatedAt must be a string", { field: "expected" });
    }
    return { workspaceId, updatedAt };
  }
  return { workspaceId };
}

export function assertIntentHost(host: string): void {
  if (!isLoopbackHost(host)) {
    throw new CampfireError(
      "Unauthorized",
      `Refusing non-loopback intent host "${host}" (the intent bridge binds loopback only: 127.0.0.1, ::1, localhost)`,
    );
  }
}

export async function startCampfireIntentBridge(options: IntentBridgeOptions): Promise<RunningIntentBridge> {
  if (options.actor.actorType !== "human") {
    throw new CampfireError("Unauthorized", "Intent bridge is bound to the operator human actor");
  }
  const host = options.host ?? DEFAULT_INTENT_HOST;
  const requestedPort = options.port ?? DEFAULT_INTENT_PORT;
  assertIntentHost(host);
  const log = options.log ?? ((entry: IntentBridgeLogEntry) => console.error(JSON.stringify(entry)));
  const actor = options.actor;

  // Per-workspace single-writer serialization inside this bridge process.
  // OPEN: end-to-end conflict precondition (SQLite + D1 proof pending MAC
  // evidence) — this queue is process-local; it is not a substitute for a
  // service-level compare-and-set (see the module comment above).
  const queues = new Map<string, Promise<void>>();

  function serialize<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = queues.get(key) ?? Promise.resolve();
    // A rejected predecessor must not poison the queue: each invoke runs
    // regardless, and its own caller receives its own failure.
    const run = previous.then(task, task);
    const tracked = run.then(
      () => undefined,
      () => undefined,
    );
    queues.set(key, tracked);
    void tracked.finally(() => {
      if (queues.get(key) === tracked) queues.delete(key);
    });
    return run;
  }

  let listeningPort = requestedPort;

  const server = createServer((req, res) => {
    void handleRequest(req, res).catch((error: unknown) => {
      if (res.writableEnded) return;
      log({ allow: false, error: "InternalError", actorId: actor.actorId, actorType: actor.actorType });
      fail(res, 500, "InternalError", "The intent bridge could not complete this request");
    });
  });

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const hostHeader = typeof req.headers.host === "string" ? req.headers.host : undefined;
    if (!isAllowedViewerHost(hostHeader, { boundHost: host, port: listeningPort })) {
      log({ allow: false, error: "Unauthorized" });
      fail(res, 403, "Unauthorized", "Request Host is not the intent bridge's listening address");
      return;
    }

    const path = (req.url ?? "/").split("?")[0] ?? "/";
    if (path === "/health") {
      if (req.method !== "GET") {
        fail(res, 405, "ValidationError", "Method not allowed");
        return;
      }
      writeJson(res, 200, { version: installedCampfireVersion(), channel: "intent" });
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

    // Whole-request deadline: body read, queue wait, and upstream call.
    let settled = false;
    const settle = (status: number, code: string, message: string): void => {
      if (settled || res.writableEnded) return;
      settled = true;
      log({ allow: false, error: code, actorId: actor.actorId, actorType: actor.actorType });
      fail(res, status, code, message);
    };
    const deadline = setTimeout(() => {
      settle(
        504,
        "Timeout",
        `The intent call exceeded the ${REQUEST_TIMEOUT_MS}ms deadline; re-read workspace orientation before retrying`,
      );
    }, REQUEST_TIMEOUT_MS);
    deadline.unref();

    try {
      let raw: string;
      try {
        raw = await readBody(req);
      } catch (error) {
        if (error instanceof CampfireError) {
          settle(400, error.code, error.message);
          return;
        }
        throw error;
      }
      if (settled) return;

      let parsed: IntentBody;
      try {
        parsed = raw.length === 0 ? {} : (JSON.parse(raw) as IntentBody);
      } catch {
        fail(res, 400, "ValidationError", "Request body must be JSON");
        return;
      }

      if (typeof parsed.method !== "string" || parsed.method.trim().length === 0) {
        fail(res, 400, "ValidationError", "method is required");
        return;
      }
      const method = parsed.method.trim();

      // Authorization is an allowlist, not a denylist: an unallowlisted
      // method — read or write — gets the same bounded answer. Enforced
      // BEFORE options.call so nothing else can even reach the service.
      if (!isIntentMethod(method)) {
        log({ allow: false, method, error: "Unauthorized", actorId: actor.actorId, actorType: actor.actorType });
        fail(res, 403, "Unauthorized", intentAllowlistMessage());
        return;
      }

      if (parsed.params !== undefined && !isRecord(parsed.params)) {
        fail(res, 400, "ValidationError", "params must be an object");
        return;
      }
      const clientParams = { ...(isRecord(parsed.params) ? parsed.params : {}) };

      // `expected` may ride top-level or inside params. It is metadata the
      // bridge validates but cannot enforce (no read closure); it never
      // reaches dispatch, so upstream param schemas stay exact.
      const expectedUnknown = clientParams.expected !== undefined ? clientParams.expected : parsed.expected;
      const expected = parseIntentExpected(expectedUnknown);
      delete clientParams.expected;

      const key = serializationKeyOf();

      const result = await serialize(key, () => {
        // Serialized per workspace inside this process. The underlying write
        // can still commit after this request's deadline: a Timeout response
        // is honest about the response, not a rollback.
        return options.call(method, clientParams);
      });
      if (settled) return;
      settled = true;
      log({ allow: true, method, actorId: actor.actorId, actorType: actor.actorType });
      writeJson(res, 200, { ok: true, result });
    } catch (error) {
      if (settled) return;
      if (error instanceof CampfireError) {
        settled = true;
        log({ allow: false, method: "unknown", error: error.code, actorId: actor.actorId, actorType: actor.actorType });
        fail(res, statusFor(error.code, false), error.code, error.message);
        return;
      }
      throw error;
    } finally {
      clearTimeout(deadline);
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
  listeningPort = port;
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

export const INTENT_METHOD_COUNT = INTENT_METHODS.length;
