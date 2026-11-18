-- Idempotent workspace create: one client-stable request id per acting actor.
-- The row stores the actor, the request id, a digest of team/name/description, and the workspace id.
-- It does not store tokens or secrets.
CREATE TABLE IF NOT EXISTS workspace_create_requests (
  actor_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  request_id TEXT NOT NULL,
  body_digest TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_create_request
  ON workspace_create_requests(actor_id, actor_type, request_id);
