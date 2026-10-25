-- CLO-001: strict UTC-day budgets for published Cloud alpha teams.
-- Only category counters and team ids are stored; no request content or tokens.
CREATE TABLE IF NOT EXISTS alpha_usage_buckets (
  team_id TEXT NOT NULL REFERENCES teams(id),
  category TEXT NOT NULL CHECK (category IN ('write', 'invitation', 'read')),
  window_start TEXT NOT NULL,
  used INTEGER NOT NULL CHECK (used >= 1),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (team_id, category, window_start)
);
