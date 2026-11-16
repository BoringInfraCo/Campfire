/**
 * Bundled counterpart of migrations/0013_enrollment_issue_request.sql.
 * V5_SQL (the enrollment table) does not contain this column. SQLite adds it through the idempotent,
 * unversioned ensureEnrollmentIssueRequest in migrations.ts (fresh and existing databases alike);
 * D1 adds it through migrateD1 and migrations/0013. The partial unique index makes a duplicate request id
 * for one owner and workspace impossible to insert, which is what makes issuance atomic.
 */
export const ENROLLMENT_ISSUE_REQUEST_COLUMN_SQL =
  "ALTER TABLE enrollment_invitations ADD COLUMN issue_request_id TEXT";

export const V13_SQL = `
CREATE UNIQUE INDEX IF NOT EXISTS idx_enrollment_issue_request
  ON enrollment_invitations(workspace_id, issued_by_human_id, issue_request_id)
  WHERE issue_request_id IS NOT NULL;
`.trim();
