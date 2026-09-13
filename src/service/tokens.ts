/**
 * Actor token hashing and generation.
 *
 * Raw secrets are shown once. Persistence stores only the SHA-256 hex digest.
 */
import { createHash, randomBytes } from "node:crypto";

const TOKEN_PREFIX = "cft_";
const TOKEN_RANDOM_BYTES = 16;

export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

/** Raw token format `cft_<32+ hex>`. Never persist the return value. */
export function generateRawToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(TOKEN_RANDOM_BYTES).toString("hex")}`;
}
