/**
 * Actor token hashing and generation.
 *
 * Raw secrets are shown once. Persistence stores only the SHA-256 hex digest.
 *
 * `generateRawToken` uses WebCrypto `getRandomValues` so it runs in Node 22
 * and in Cloudflare Workers. `hashToken` is the synchronous Node/SQLite path
 * (node:crypto). Workers must use `hashTokenAsync` (WebCrypto subtle) because
 * `crypto.subtle.digest` is async-only; see `src/worker/crypto.ts`.
 */
import { createHash } from "node:crypto";

const TOKEN_PREFIX = "cft_";
const TOKEN_RANDOM_BYTES = 16;

export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

/** WebCrypto SHA-256 hex digest for Workers (async-only subtle API). */
export async function hashTokenAsync(rawToken: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(rawToken),
  );
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Raw token format `cft_<32+ hex>`. Never persist the return value. */
export function generateRawToken(): string {
  const bytes = new Uint8Array(TOKEN_RANDOM_BYTES);
  globalThis.crypto.getRandomValues(bytes);
  return `${TOKEN_PREFIX}${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}
