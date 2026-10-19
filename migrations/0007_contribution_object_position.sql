-- NAV-002: per-record history is keyed by workspace, object, and append position.
CREATE INDEX IF NOT EXISTS idx_contributions_object_position
  ON contributions(workspace_id, object_type, object_id, append_position);
