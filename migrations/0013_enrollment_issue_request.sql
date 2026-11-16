-- Idempotent invitation issuance: the owner's client-stable request id. Distinct from the
-- consumption columns (request_id/request_digest/receipt_json). No secret is stored.
ALTER TABLE enrollment_invitations ADD COLUMN issue_request_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_enrollment_issue_request
  ON enrollment_invitations(workspace_id, issued_by_human_id, issue_request_id)
  WHERE issue_request_id IS NOT NULL;
