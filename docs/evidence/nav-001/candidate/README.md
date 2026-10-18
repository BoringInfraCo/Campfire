# NAV-001 candidate terminal frames — reshaped read-only `campfire dashboard`

**Label: FIXTURE EVIDENCE — engineering evidence only.** These frames are
scripted captures of the read-only `campfire dashboard` from the NAV-001
candidate working tree, produced by a python3 PTY harness. They are NOT
human-observation evidence; they cannot establish Gate B, Gate C, or Gate E,
and they are not the contract §6 two-human comparison (that comparison is
**NOT OBSERVED**). A scripted capture is a debugging rehearsal. The companion
"before" frames are pinned in `docs/evidence/nav-001/baseline/BASELINE_PIN.md`;
expected values are keyed by `docs/evidence/nav-001/FIXTURE_KEY.md`.

## What is captured

- **Candidate source:** the NAV-001 candidate working tree — the reshaped
  read-only terminal navigator (one active section + SOURCE block). No product
  schema, service read, CLI JSON, MCP, Viewer, or installer surface changes.
- **Method:** the real `campfire dashboard` (main tree `src/cli/index.ts` via
  `npx tsx`) spawned in a python3 PTY at 80×24 and 120×36, `CAMPFIRE_TELEMETRY=0`
  with isolated `CAMPFIRE_CONFIG_DIR`/`CAMPFIRE_DATA_DIR`; the driver waits for
  the goal-id marker, applies the scripted key sequence, then sends `q`. The
  frame is the text after the last clear with controls stripped.
- **Actor / workspace:** `hum_nav001_ana` (human) / `ws_nav001_lab`.
- **Database:** freshly re-seeded `fixtures/navigator/nav-001/.tmp/run-a`
  (`--force`; the seed asserts the frozen key before writing). The three runs
  share this one served database; only the key script differs.
- **Key scripts:** `attention` = default (no keys beyond the wake-up `q`);
  `decisions` = `--keys "tab,tab"` (RECORDED DECISIONS);
  `references` = `--keys "tab,tab,tab"` (ARTIFACT REFERENCES). `--keys` is
  **comma-separated**; `tab`/`enter`/`esc` are named keys and every other token
  is sent literally. A space-separated `"tab tab"` would be sent as one literal
  string and would not navigate.
- **Capture session:** re-captured wall clock `2026-10-18T01:08:35–39Z`
  (PTY-side) after the two verifier-driven adjustments (input
  escape-sequence stripping, `ctrl-c quits` typing hint). With the header
  `refreshed` line masked, all six frames are byte-identical to the
  independently verified first capture.

## Files (capture-time sha256)

`docs/evidence/nav-001/candidate/terminal/` contains exactly:

| File | sha256 |
| --- | --- |
| `candidate-nav001-ana-attention-80x24.txt` | `1fc85dd4446680db1b10aa23d9f4a9217a700d3f4b27e5010dd29ef04ac617cb` |
| `candidate-nav001-ana-attention-120x36.txt` | `7400cc93e6d7d0774cc7eeffe3c07d96a6ed2acecdddfbb72cb1ef226c7e7b9b` |
| `candidate-nav001-ana-decisions-80x24.txt` | `274cea67c1a3d797b1216ebbce2cd77caab3f013ada6130603326bf25bf549b7` |
| `candidate-nav001-ana-decisions-120x36.txt` | `68aba092736b2886de43ebe602f3bf02f9cf15104db5c36887387d8698c6c97d` |
| `candidate-nav001-ana-references-80x24.txt` | `90544b201d0b5d6b54f3a90181fc35387272904c1a939de5f13adb030fb7ec4f` |
| `candidate-nav001-ana-references-120x36.txt` | `38300b40f749a88f779d80538861eebc438c348414dea7f02139a7ce5763d57a` |
| `capture-summary-attention.json` | the per-run capture record for both attention frames |
| `capture-summary-decisions.json` | the per-run capture record for both decisions frames |
| `capture-summary-references.json` | the per-run capture record for both references frames |

Each summary embeds the recorded sha256, the PTY flags (exit 0, alt-screen
enter/leave, cursor hide/show, `termiosRestored: true`), and the hard-fail
redaction checks for its two frames. `root`/`db` are recorded as `[path]`.

## Frame facts

- **Header (all frames):** title + workspace id, actor + wall-clock
  `refreshed` line, `GOAL` block (goal text, `goal_nav001_focus`, and the
  goal-slice line `20/64 truncated tasks · 5/5 decisions`), and the
  `20 people · 37 registered agents` count line. No agent rows and no eager
  artifact block on the attention frame (D3).
- **attention (default):** `MY WORK  Needs You  ATTENTION  20/64 truncated
  tasks · 5/5 decisions` with the attention-coverage caveat (cues beyond the
  returned pages may exist) and the recorded-assignment-is-not-a-permission
  line; rows are the proposed-decision cue, `task_nav001_assigned_blocked_ana`,
  and `task_nav001_assigned_open_ana`, each carrying its full id, status, and
  assignee. `SOURCE` echoes the selected row (`dec_nav001_proposed`, proposed —
  not accepted, not an instruction).
- **decisions (`tab,tab`):** `RECORDED DECISIONS  decisions 5 of 5` listing all
  five: `dec_nav001_proposed`, `dec_nav001_plain`, the competing accepted pair
  `dec_nav001_competing_b` / `dec_nav001_competing_a`, and the needs-review
  `dec_nav001_review` with `find_nav001_superseded`. No section chooses between
  the competing accepted decisions.
- **references (`tab,tab,tab`):** `ARTIFACT REFERENCES  artifacts 10 of 12
  truncated` with the three typed v1.21 classes — `class local path`
  (`art_nav001_notes`), `class unparsed` (the hostile-title artifact shown
  inert), and `class openable https  host example.com  cited by
  find_nav001_current (supports)` (`art_nav001_runbook`) — each with the
  stored-reference/inert-chrome caveat that workspace membership does not grant
  access. `SOURCE` echoes the selected artifact row.
- **Footer:** at 80 columns the compact footer
  `tab section   j/k move   / filter   enter inspect   r refresh   ? help   q quit`
  (79 chars); at 120 columns the full footer prepends `p perspective` (95
  chars).

## Recorded checks

Per the summaries: line counts exactly 24/36; widest lines 80/119 for
attention, 79/120 for decisions, 80/119 for references (within window);
`noEscapeControls: true` (nothing bell-like remains); `noCredentialShape`,
`noHomePath`, `noPrivatePath`, `noUnrelatedSentinel` all true; **0 redactions
were needed** (`redactionsAppliedBeforeWrite: 0`) — the hard-fail checks run
before writing and abort the capture instead.

Frame identity caveat: the header `refreshed` timestamp is wall-clock, so the
sha256s above pin these capture-time frames; a re-capture reproduces the same
content except that one line per frame. The A2 re-capture confirmed this
empirically: with the `refreshed` line masked, all six frames are byte-identical
to the independently verified first capture.

## Reproduction

From the repository root (candidate tree), with the fixture DB freshly seeded:

```sh
# Re-seed the display-pressure fixture (throws before writing if the frozen key asserts fail):
npx tsx fixtures/navigator/nav-001/seed.ts \
  --out fixtures/navigator/nav-001/.tmp/run-a --force

# Default attention frame (only the wake-up q is sent):
npx tsx fixtures/navigator/nav-001/capture-dashboard.ts \
  --db fixtures/navigator/nav-001/.tmp/run-a/campfire.db \
  --workspace ws_nav001_lab --actor hum_nav001_ana \
  --out fixtures/navigator/nav-001/.tmp/candidate-nav001-ana-attention \
  --label candidate-nav001-ana-attention

# Decisions frame (two named tabs, comma-separated):
npx tsx fixtures/navigator/nav-001/capture-dashboard.ts \
  --db fixtures/navigator/nav-001/.tmp/run-a/campfire.db \
  --workspace ws_nav001_lab --actor hum_nav001_ana \
  --keys "tab,tab" \
  --out fixtures/navigator/nav-001/.tmp/candidate-nav001-ana-decisions \
  --label candidate-nav001-ana-decisions

# References frame (three named tabs):
npx tsx fixtures/navigator/nav-001/capture-dashboard.ts \
  --db fixtures/navigator/nav-001/.tmp/run-a/campfire.db \
  --workspace ws_nav001_lab --actor hum_nav001_ana \
  --keys "tab,tab,tab" \
  --out fixtures/navigator/nav-001/.tmp/candidate-nav001-ana-references \
  --label candidate-nav001-ana-references
```

The tool writes `<label>-<WxH>.txt` plus `capture-summary.json` per `--out`
(25 s driver timeout; redacts before writing and hard-fails without writing if
a forbidden string survives). The fixture determinism notes and the frozen key
live in `fixtures/navigator/nav-001/README.md` and
`docs/evidence/nav-001/FIXTURE_KEY.md`.

## Caveats

- Scripted PTY captures are engineering evidence, not human observation, and
  are not the §6 two-human comparison (**NOT OBSERVED**).
- The frames were captured from an uncommitted candidate working tree; they pin
  the behavior checked by the focused tests, not a published release.
- The `refreshed` header line is the only intended between-capture variation.
