# fixtures/navigator/nav-001 — NAV-001 Step 0 display-pressure fixture

Deterministic fixture, sanitizer dump, and dashboard capture tooling for
**NAV-001 — Focused Terminal Navigator** Step 0 (contract
`docs/Campfire-v1.22-NAV-001-Focused-Terminal-Navigator.md`, §3 Step 0).

**Label: FIXTURE EVIDENCE — engineering evidence only.** Synthetic fixture
state can never establish Gate B, Gate C, or Gate E, and a scripted capture is
never human-observation evidence.

## Files

| File | Purpose |
| --- | --- |
| `seed.ts` | Deterministic seed: creates the lab (`ws_nav001_lab`: 20 humans, 37 agents, 64 tasks, 2 findings, 5 decisions, 12 artifacts) plus a separate unrelated workspace owned by Zed only. Hard-asserts the frozen ids, counts, page shape, cue lists, and denial cases; throws before writing the receipt if any assert fails, then writes `tokens.json` and `seed-receipt.json` (both mode 0600, nested token shape keyed by full actor ids). |
| `dump.ts` | Read-only served-state dumps per tracked actor (`context-…-<actor>.json`, `workspace-…-<actor>.json`, `whoami-…json`, plus `denials.json` with both Zed denial records). Home/system-temp absolute paths and credential-shaped tokens are redacted; the unrelated sentinel of either sprint aborts the dump. |
| `capture-dashboard.ts` | Drives the **real** `campfire dashboard` inside a python3 PTY (same approach as `tests/unit/uix-001-dashboard-pty.test.ts` and the ARH-001 capture tool). Writes one frame per size plus `capture-summary.json`; redacts before writing and hard-fails without writing if a forbidden string (credential-shaped tokens, user-home/system-temp absolute paths, either sprint's unrelated sentinel) survives. `--root` retargets the spawn at a v1.21.0 git worktree so the baseline dashboard is captured without touching the main checkout. |
| `.gitignore` | Keeps all seeded/dumped/captured scratch out of git (`.tmp/`). |

## Commands

```sh
# Seed the lab twice (determinism pair); each run asserts the frozen key, then
# writes tokens.json + seed-receipt.json (mode 0600):
npx tsx fixtures/navigator/nav-001/seed.ts --out fixtures/navigator/nav-001/.tmp/run-a --force
npx tsx fixtures/navigator/nav-001/seed.ts --out fixtures/navigator/nav-001/.tmp/run-b --force

# Sanitized served-state dumps for both runs:
npx tsx fixtures/navigator/nav-001/dump.ts fixtures/navigator/nav-001/.tmp/run-a
npx tsx fixtures/navigator/nav-001/dump.ts fixtures/navigator/nav-001/.tmp/run-b
diff -r fixtures/navigator/nav-001/.tmp/run-a/dump fixtures/navigator/nav-001/.tmp/run-b/dump   # byte-identical

# Display-pressure frames from the main tree (sanity capture; engineering evidence):
npx tsx fixtures/navigator/nav-001/capture-dashboard.ts \
  --db fixtures/navigator/nav-001/.tmp/run-a/campfire.db \
  --workspace ws_nav001_lab --actor hum_nav001_ana \
  --out fixtures/navigator/nav-001/.tmp/tree-check --label nav-001-tree-check

# v1.21.0 baseline frames (dashboard executed from a clean tag worktree):
#   git worktree add "$WT" v1.21.0 && (cd "$WT" && npm ci --no-audit --no-fund)
#   (cd "$WT" && node_modules/.bin/tsx fixtures/attention/att-001/seed.ts \
#      --out fixtures/attention/att-001/.tmp/nav-baseline --force)
npx tsx fixtures/navigator/nav-001/capture-dashboard.ts \
  --root "$WT" \
  --db "$WT/fixtures/attention/att-001/.tmp/nav-baseline/campfire.db" \
  --workspace ws_att001_lab --actor hum_att001_ana \
  --out docs/evidence/nav-001/baseline/terminal \
  --label baseline-v1.21.0-ana-lab
```

## Determinism and the recorded limitation

- Two independent seeds with differing token secrets produce **byte-identical**
  served dumps (verified over `run-a`/`run-b`, `diff -r`); the only intended
  between-run variation is the fresh token material and the receipt's
  `databasePath`. Seed clock is frozen (`2026-10-17T12:00:00.000Z` base,
  +1000 ms per write) and the served view is frozen at
  `2026-10-17T14:00:00.000Z`.
- **Filler status cycle limitation (deliberate):** filler statuses use the
  weighted cycle `N % 13` (0 → blocked, 6 → in_progress, else open) rather than
  a uniform 3-cycle. A uniform cycle over 58 fillers would yield ~22 blocked
  tasks; the task page is 20 rows ranked blocked-first, so the page would
  saturate with blocked fillers and `task_nav001_assigned_open_ana` would never
  be returned — silently removing Ana's `assigned_open_task` needs-you cue
  (attention cues derive from returned pages). The weighted mix holds the page
  at `7 blocked + 5 in_progress + 8 open` so all six keyed tasks stay returned.
  See `docs/evidence/nav-001/FIXTURE_KEY.md` for the full frozen key and the
  exact page composition.

## Frozen key

`docs/evidence/nav-001/FIXTURE_KEY.md` is the answer key: cue lists for Ana
and Ben with reasons, the proposed-decision and competing-pair answer, the
needs-review decision and its non-current citation, artifact classes and
hosts, hostile-content inertness (task title carries raw escape bytes; the
renderer strips them), and the Zed denial records (`ParticipantRequired`, two
cases, message naming only caller and workspace).

## Baseline evidence

`docs/evidence/nav-001/baseline/BASELINE_PIN.md` pins the v1.21.0 terminal
frames (80x24 + 120x36 from a clean tag worktree) with capture-time sha256s,
frame checks, and the cited release facts the NAV-001 candidate must remain
consistent with.
