/**
 * v8 per-record history access path.
 *
 * `idx_contributions_workspace_position` constrains only `workspace_id` when a
 * query also filters object type and id, so it walks every contribution in the
 * workspace. This index is the workspace/type/id/position path. Catch-up keeps
 * using the append-position index. The statement is idempotent.
 */
export const V8_SQL = `
CREATE INDEX IF NOT EXISTS idx_contributions_object_position
  ON contributions(workspace_id, object_type, object_id, append_position)
`.trim();
