/**
 * Finite webhook retry policy.
 *
 * Five delivery attempts, then the row stays exhausted and inspectable.
 * Failure 5 does not schedule the last backoff slot.
 */

export const WEBHOOK_MAX_ATTEMPTS = 5;
export const WEBHOOK_BACKOFF_MS = [1000, 2000, 4000, 8000, 16000] as const;
export const WEBHOOK_TIMEOUT_MS = 10_000;
export const WEBHOOK_CLAIM_LEASE_MS = 30_000;
export const WEBHOOK_ERROR_MAX_CHARS = 200;

/**
 * Rows one delivery sweep may select (PSA-001 / P1).
 *
 * Delivery work is now proportional to one batch: a sweep reads at most this
 * many due rows, claims at most this many, and the rest of a backlog waits for
 * the next scheduled sweep. Previously the read was unbounded and only the claim
 * loop was capped, so a backlog cost a full table read per eligible request.
 */
export const WEBHOOK_DELIVERY_BATCH = 20;

/**
 * Normalize a caller-supplied batch size to a positive integer.
 *
 * The value reaches `LIMIT` in SQL, so it is coerced rather than trusted: a
 * non-integer, negative, or absent value must not become an unbounded read, and
 * `LIMIT -1` in SQLite means "no limit" — the exact behavior this sprint removes.
 */
export function normalizeDeliveryLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return WEBHOOK_DELIVERY_BATCH;
  const whole = Math.floor(limit);
  if (whole < 1) return WEBHOOK_DELIVERY_BATCH;
  return whole;
}

const TOKEN_PATTERN = /cft_[A-Za-z0-9]+/g;
const USERINFO_PATTERN = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi;
const URL_ORIGIN_PATTERN = /\b([a-z][a-z0-9+.-]*:\/\/[^\s/?#]+)[^\s]*/gi;

function parseTime(nowIso: string): number {
  const parsed = Date.parse(nowIso);
  if (Number.isNaN(parsed)) {
    throw new Error("invalid timestamp");
  }
  return parsed;
}

export function nextRetry(
  nowIso: string,
  attemptCountAfterFailure: number,
): { status: "pending"; nextAttemptAt: string } | { status: "exhausted" } {
  const now = parseTime(nowIso);
  if (attemptCountAfterFailure >= WEBHOOK_MAX_ATTEMPTS) {
    return { status: "exhausted" };
  }
  const delay = WEBHOOK_BACKOFF_MS[attemptCountAfterFailure - 1];
  if (delay === undefined) {
    throw new Error("invalid attempt count");
  }
  return {
    status: "pending",
    nextAttemptAt: new Date(now + delay).toISOString(),
  };
}

function errorParts(error: unknown): { name?: string; message: string } {
  if (typeof error === "string") return { message: error };
  if (typeof error === "object" && error !== null) {
    const name = "name" in error && typeof error.name === "string" ? error.name : undefined;
    if ("message" in error && typeof error.message === "string") {
      return { name, message: error.message };
    }
  }
  return { message: "delivery failed" };
}

/** Bounded diagnostic. Never echoes the signing secret, a cft_ token, or any URL beyond its origin. */
export function sanitizeDeliveryError(error: unknown, secret?: string): string {
  const { name, message } = errorParts(error);
  if (name === "TimeoutError" || name === "AbortError" || message === "timeout") {
    return "timeout";
  }
  if (message.startsWith("redirect refused")) {
    return "redirect refused";
  }
  const http = /^HTTP (\d{3})\b/.exec(message);
  if (http?.[1] !== undefined) {
    return `HTTP ${http[1]}`;
  }

  let text = message;
  if (secret !== undefined && secret.length > 0) {
    text = text.split(secret).join("[redacted]");
  }
  text = text
    .replace(TOKEN_PATTERN, "[redacted]")
    .replace(USERINFO_PATTERN, "$1")
    // Webhook paths and query strings can carry credentials; keep only origin.
    .replace(URL_ORIGIN_PATTERN, "$1")
    .trim();
  if (text.length === 0) return "delivery failed";
  if (text.length > WEBHOOK_ERROR_MAX_CHARS) {
    return text.slice(0, WEBHOOK_ERROR_MAX_CHARS);
  }
  return text;
}

/** Instant before which a `delivering` claim is stale and may be taken again. */
export function leaseBefore(nowIso: string, leaseMs: number = WEBHOOK_CLAIM_LEASE_MS): string {
  return new Date(parseTime(nowIso) - leaseMs).toISOString();
}
