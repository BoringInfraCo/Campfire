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
- **Capture session:** one session, wall clock `2026-10-18T00:51:33–34Z`
  (PTY-side); the header `refreshed` line is wall-clock and differs between
  frames and on any re-capture.

## Files (capture-time sha256)

`docs/evidence/nav-001/candidate/terminal/` contains exactly:

| File | sha256 |
| --- | --- |
| `candidate-nav001-ana-attention-80x24.txt` | `75bfbf58ea804ece5a310591c624ce8391ad50e56cb1cf2890d3ee2bdbd74047` |
| `candidate-nav001-ana-attention-120x36.txt` | `cc205d0bc70f4896d2750298f113ac1f7fd91d9d7964ee8ba2c1ab5107e373ff` |
| `candidate-nav001-ana-decisions-80x24.txt` | `815cff961da4b0dc8e41bc26666ffc4378d6ad77c065356f7e3ae17079a0aba2` |
| `candidate-nav001-ana-decisions-120x36.txt` | `33c4a40211e65b6b19078a53b1a3a8c7324d0bb9a639e5f26958b6e7f183a5e8` |
| `candidate-nav001-ana-references-80x24.txt` | `eb30d020430117ade24c1b7023ee0865bf22a5c9be1a7a5205a9e4768de63a7b` |
| `candidate-nav001-ana-references-120x36.txt` | `6538e24d82ae710c0547405271d217673773dbd5e968e5bf0093a3cc765a2dfc` |
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
content except that one line per frame.

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
