/**
 * Best-effort telemetry transport (TEL-001C).
 *
 * The contract this module enforces is simple: telemetry can fail completely
 * without affecting Campfire. `postTelemetryEvent` never throws, never retries,
 * never queues, and never awaits on a caller's critical path. There is no local
 * outbox for telemetry precisely because a retry queue would need to persist
 * payloads, and persisted payloads are a place workspace content could later
 * leak into.
 *
 * The timeout is deliberately short (well under any CLI command's own budget) so
 * a hung endpoint delays nothing a user can perceive.
 */
import {
  buildTelemetryEvent,
  serializeTelemetryEvent,
  TELEMETRY_MAX_PAYLOAD_BYTES,
  type TelemetryEventName,
  type TelemetrySurface,
} from "./contract.js";

/** Short on purpose: telemetry latency is never worth a user's time. */
export const TELEMETRY_TIMEOUT_MS = 2_000;

/** Bounded diagnostic. Never echoes a URL beyond its origin. */
const MAX_ERROR_CHARS = 120;

export interface TelemetryDeliveryResult {
  ok: boolean;
  error?: string;
}

export interface TelemetryPostInput {
  endpoint: string;
  event: TelemetryEventName;
  installationId?: string;
  campfireVersion?: string;
  os?: string;
  arch?: string;
  installMethod?: string;
  surface?: TelemetrySurface;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

function sanitizeError(error: unknown): string {
  if (typeof error === "object" && error !== null && "name" in error) {
    const name = (error as { name?: unknown }).name;
    if (name === "TimeoutError" || name === "AbortError") return "timeout";
  }
  const message = error instanceof Error ? error.message : String(error);
  const originOnly = message.replace(
    /\b([a-z][a-z0-9+.-]*:\/\/[^\s/?#]+)[^\s]*/gi,
    "$1",
  );
  return originOnly.slice(0, MAX_ERROR_CHARS);
}

function discardBody(response: Response): void {
  try {
    void response.body?.cancel();
  } catch {
    // The status was already observed. Disposing of the body cannot change it.
  }
}

/**
 * Send one event. Resolves with a result instead of throwing, so a caller can
 * `await` it inside a fire-and-forget path without a try/catch, or ignore it.
 *
 * Redirects are refused rather than followed: a redirect target is not the
 * documented ingestion endpoint, and following one would let a 30x move a
 * content-free payload to an unvetted host.
 */
export async function postTelemetryEvent(input: TelemetryPostInput): Promise<TelemetryDeliveryResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const event = buildTelemetryEvent(input);
  const body = serializeTelemetryEvent(event);
  if (new TextEncoder().encode(body).length > TELEMETRY_MAX_PAYLOAD_BYTES) {
    return { ok: false, error: "payload too large" };
  }
  try {
    const response = await fetchImpl(input.endpoint, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(input.timeoutMs ?? TELEMETRY_TIMEOUT_MS),
    });
    discardBody(response);
    if (response.status === 0 || (response.status >= 300 && response.status < 400)) {
      return { ok: false, error: "redirect refused" };
    }
    if (response.status >= 200 && response.status < 300) return { ok: true };
    return { ok: false, error: `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, error: sanitizeError(error) };
  }
}