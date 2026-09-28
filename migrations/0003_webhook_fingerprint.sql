-- Sprint 019 destination fingerprint. Mirrors src/store/migrations.ts v4.

ALTER TABLE webhook_deliveries ADD COLUMN config_fingerprint TEXT;
UPDATE webhook_deliveries
SET status = 'exhausted',
    next_attempt_at = NULL,
    claim_token = NULL,
    claimed_at = NULL,
    last_error = 'queued before destination fingerprinting; repeat the mutation with the current bridge configuration',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE config_fingerprint IS NULL AND status IN ('pending', 'delivering');
