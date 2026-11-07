/**
 * Reuse a Campfire already listening on this host, or start one for this process.
 *
 * A `/health` version means another Campfire owns the port. `close()` must not
 * stop that process. A pinned address that is taken is reported without the
 * raw Node listen error; the default port may move to an ephemeral bind once.
 */
import type { CampfireRuntime } from "../runtime.js";
import { ValidationError } from "../domain/errors.js";
import type { ActorContext } from "../service/authorization.js";
import { startLocalWorkspace, type RunningLocalWorkspace } from "./local-workspace.js";

const DEFAULT_PROBE_TIMEOUT_MS = 400;

export function isAddrInUse(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "EADDRINUSE";
}

/** GET `${baseUrl}/health`. Return the version when it is a non-empty string. Any failure, non-JSON, or missing version returns undefined. Never throws. Timeout about 400ms. Send no token. */
export async function probeCampfireVersion(baseUrl: string, timeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS): Promise<string | undefined> {
  const origin = baseUrl.replace(/\/+$/, "");
  try {
    const response = await fetch(`${origin}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return undefined;
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null || !("version" in body)) return undefined;
    const version = (body as { version?: unknown }).version;
    if (typeof version !== "string" || version.length === 0) return undefined;
    return version;
  } catch {
    return undefined;
  }
}

export interface OpenLocalListenerInput {
  runtime: CampfireRuntime;
  human: ActorContext;
  httpHost: string;
  httpPort: number;
  viewerPort: number;
  /** True only when the user passed --port. The default port is not pinned. */
  portPinned: boolean;
  /** True only when the user passed --viewer-port. */
  viewerPortPinned: boolean;
  probe?: (url: string) => Promise<string | undefined>;
  start?: typeof startLocalWorkspace;
}

export interface OpenLocalListenerResult extends RunningLocalWorkspace {
  /** False when an existing Campfire /health version was reused. close() must not stop that process. */
  owned: boolean;
}

function originFor(host: string, port: number): string {
  const bracketed = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `http://${bracketed}:${port}`;
}

function addressInUse(host: string, port: number, field: "port" | "viewer-port"): ValidationError {
  return new ValidationError(
    `Campfire cannot listen on ${host}:${port}. Another process is using that address.`,
    { field, host, port },
  );
}

function hasVersion(version: string | undefined): version is string {
  return typeof version === "string" && version.length > 0;
}

function listenOptions(input: OpenLocalListenerInput, httpPort: number, viewerPort: number) {
  return {
    runtime: input.runtime,
    human: input.human,
    httpHost: input.httpHost,
    httpPort,
    viewerHost: input.httpHost,
    viewerPort,
  };
}

export async function openLocalListener(input: OpenLocalListenerInput): Promise<OpenLocalListenerResult> {
  const probe = input.probe ?? probeCampfireVersion;
  const start = input.start ?? startLocalWorkspace;

  if (input.httpPort !== 0) {
    const apiOrigin = originFor(input.httpHost, input.httpPort);
    const apiVersion = await probe(apiOrigin);
    if (hasVersion(apiVersion)) {
      let viewerUrl = "";
      if (input.viewerPort !== 0) {
        const viewerOrigin = originFor(input.httpHost, input.viewerPort);
        const viewerVersion = await probe(viewerOrigin);
        if (hasVersion(viewerVersion)) viewerUrl = viewerOrigin;
      }
      return {
        owned: false,
        apiUrl: apiOrigin,
        viewerUrl,
        async close(): Promise<void> {
          // The existing process keeps the port. This session does not own it.
        },
      };
    }
  }

  try {
    const running = await start(listenOptions(input, input.httpPort, input.viewerPort));
    return { ...running, owned: true };
  } catch (error) {
    if (!isAddrInUse(error)) throw error;
    if (input.portPinned) throw addressInUse(input.httpHost, input.httpPort, "port");
    const viewerPort = input.viewerPortPinned ? input.viewerPort : 0;
    try {
      const running = await start(listenOptions(input, 0, viewerPort));
      return { ...running, owned: true };
    } catch (retryError) {
      if (!isAddrInUse(retryError)) throw retryError;
      if (input.viewerPortPinned) throw addressInUse(input.httpHost, input.viewerPort, "viewer-port");
      throw addressInUse(input.httpHost, input.httpPort, "port");
    }
  }
}
