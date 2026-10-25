/** CLO-001 bundled counterpart of migrations/0011_alpha_usage.sql. */
export const V12_SQL = `
CREATE TABLE IF NOT EXISTS alpha_usage_buckets (
  team_id TEXT NOT NULL REFERENCES teams(id),
  category TEXT NOT NULL CHECK (category IN ('write', 'invitation', 'read')),
  window_start TEXT NOT NULL,
  used INTEGER NOT NULL CHECK (used >= 1),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (team_id, category, window_start)
);
`.trim();
