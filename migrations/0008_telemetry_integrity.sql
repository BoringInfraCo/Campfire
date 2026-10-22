-- Telemetry integrity: server-side idempotency claims and single-use install tokens (digests only, never raw ids or tokens).
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
  ON telemetry_install_tokens(expires_at);
