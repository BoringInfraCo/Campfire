/**
 * v9 telemetry integrity tables.
 *
 * Server-side idempotency for anonymous ingestion: `telemetry_claims` records
 * which (kind, claim) pairs have already been counted, and
 * `telemetry_install_tokens` holds single-use install claims. Only SHA-256
 * hashes are stored — never a raw installation id or token — so the tables
 * cannot become an identity registry. The statement is idempotent.
 */
export const V9_SQL = `
CREATE TABLE IF NOT EXISTS telemetry_claims (
  kind TEXT NOT NULL,
  claim_key TEXT NOT NULL,
  claimed_at TEXT NOT NULL,
  PRIMARY KEY (kind, claim_key)
);
CREATE TABLE IF NOT EXISTS telemetry_install_tokens (
  token_hash TEXT PRIMARY KEY,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_telemetry_install_tokens_expiry
  ON telemetry_install_tokens(expires_at)
`.trim();
