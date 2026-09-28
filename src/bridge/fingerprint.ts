/**
 * Non-secret fingerprint of the destination a delivery was queued for.
 *
 * The hash covers the bridge id, URL, and signing secret. Reusing a bridge id
 * with a different URL or secret does not match, so queued events stay put.
 * Restoring the same three values resumes them. The secret is not recoverable
 * from the hash and is not stored beside the row.
 */
import { createHash } from "node:crypto";

export function destinationFingerprint(bridge: { id: string; url: string; secret: string }): string {
  return createHash("sha256").update(`${bridge.id}\n${bridge.url}\n${bridge.secret}`, "utf8").digest("hex");
}
