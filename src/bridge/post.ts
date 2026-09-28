/**
 * Signed webhook POST.
 *
 * The signature covers the unix timestamp and the exact body bytes.
 * Redirects are not followed, and response bodies are discarded.
 */
import { sanitizeDeliveryError, WEBHOOK_TIMEOUT_MS } from "./retry.js";

export interface WebhookPostResult {
  ok: boolean;
  error?: string;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return bytesToHex(new Uint8Array(signature));
}

function discardBody(response: Response): void {
  try {
    void response.body?.cancel();
  } catch {
    // Status was already observed. Disposing of the body must not change it.
  }
}

function isTimeout(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("name" in error)) return false;
  const name = error.name;
  return name === "TimeoutError" || name === "AbortError";
}

export async function postSignedWebhook(input: {
  url: string;
  secret: string;
  eventId: string;
  eventType: string;
  body: string;
  timestampSeconds: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<WebhookPostResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? WEBHOOK_TIMEOUT_MS;
  try {
    const signature = await hmacSha256Hex(input.secret, `${input.timestampSeconds}.${input.body}`);
    const response = await fetchImpl(input.url, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        "X-Campfire-Event-Id": input.eventId,
        "X-Campfire-Event-Type": input.eventType,
        "X-Campfire-Timestamp": input.timestampSeconds,
        "X-Campfire-Signature": `v1=${signature}`,
      },
      body: input.body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const redirected =
      response.status === 0 ||
      (response.status >= 300 && response.status < 400) ||
      response.type === "opaqueredirect";
    discardBody(response);
    if (redirected) return { ok: false, error: "redirect refused" };
    if (response.status >= 200 && response.status < 300) return { ok: true };
    return { ok: false, error: `HTTP ${response.status}` };
  } catch (error) {
    if (isTimeout(error)) return { ok: false, error: "timeout" };
    return { ok: false, error: sanitizeDeliveryError(error, input.secret) };
  }
}
