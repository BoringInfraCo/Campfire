-- Catch-up must follow append order. Random contribution ids are not monotonic.

ALTER TABLE contributions ADD COLUMN append_position INTEGER NOT NULL DEFAULT 0;

UPDATE contributions
SET append_position = (
  SELECT COUNT(*)
  FROM contributions AS earlier
  WHERE earlier.workspace_id = contributions.workspace_id
    AND (
      earlier.created_at < contributions.created_at
      OR (earlier.created_at = contributions.created_at AND earlier.rowid <= contributions.rowid)
    )
)
WHERE append_position = 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contributions_workspace_position
  ON contributions(workspace_id, append_position);
