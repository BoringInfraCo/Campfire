/**
 * WebCrypto-only token helpers for Cloudflare Workers.
 *
 * Duplicates the logic in `src/service/tokens.ts` without importing
 * `node:crypto` so the worker bundle stays free of Node builtins
 * (workers-best-practices: Web Crypto, nodejs_compat still enabled in
 * wrangler.toml for other deps). The hex formats match the Node path so
 * hashes are interchangeable.
 */

const TOKEN_PREFIX = "cft_";
const TOKEN_RANDOM_BYTES = 16;

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** WebCrypto SHA-256 hex digest (subtle is async-only). */
export async function hashTokenWeb(rawToken: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(rawToken),
  );
  return bytesToHex(new Uint8Array(digest));
}

/** Raw token format `cft_<32 hex>`. Never persist the return value. */
export function generateRawTokenWeb(): string {
  const bytes = new Uint8Array(TOKEN_RANDOM_BYTES);
  globalThis.crypto.getRandomValues(bytes);
  return `${TOKEN_PREFIX}${bytesToHex(bytes)}`;
}
