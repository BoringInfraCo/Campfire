/**
 * v6 contribution append order, shared by local migrations and the Worker bundle.
 * `migrations.ts` reads `schema.sql` with `node:fs`, which Workers do not have.
 * Catch-up pages this order. Contribution ids are random, so they are not monotonic.
 * The backfill follows `created_at, rowid` and does not rewrite payloads.
 */
export const V6_ADD_COLUMN_SQL = "ALTER TABLE contributions ADD COLUMN append_position INTEGER NOT NULL DEFAULT 0";

export const V6_BACKFILL_SQL = `
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
WHERE append_position = 0
`.trim();

export const V6_INDEX_SQL = `
CREATE UNIQUE INDEX IF NOT EXISTS idx_contributions_workspace_position
  ON contributions(workspace_id, append_position)
`.trim();

export const V6_SQL = `${V6_ADD_COLUMN_SQL};\n\n${V6_BACKFILL_SQL};\n\n${V6_INDEX_SQL}`;
