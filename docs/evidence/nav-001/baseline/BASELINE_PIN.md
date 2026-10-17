# NAV-001 Step 0 Baseline Pin — published v1.21.0 terminal frames

**Label: FIXTURE EVIDENCE — engineering evidence only.** These frames are
scripted captures of the read-only `campfire dashboard` run by a python3 PTY
harness. They are NOT human-observation evidence; they cannot establish Gate
B, Gate C, or Gate E. A scripted capture is a debugging rehearsal.

## What is pinned

- Baseline source: published **v1.21.0** — annotated tag `v1.21.0`
  (tag object `38e03e88873ea742177eeb0b92ae2561fa6dae8d`) → commit
  `5523305ec1c7334d8789b4c895610ff13f266d5a`, package version `1.21.0`.
- Capture method: real `campfire dashboard` (the v1.21.0 tree's
  `src/cli/index.ts` via that tree's own `node_modules/.bin/tsx`), spawned in a
  python3 PTY at 80x24 and 120x36, `CAMPFIRE_TELEMETRY=0`, isolated
  config/data dirs, actor `hum_att001_ana`, workspace `ws_att001_lab`, waiting
  for the goal marker `goal_att001_attention`, then `q`. The PTY stream is
  confirmed to enter/leave the alternate screen and hide/show the cursor; the
  dashboard exits 0 on `q`, and the terminal is restored (`termiosRestored: true`).
- Facts pinned by v1.21.0 (visible in both frames):
  - Header with actor, wall-clock refresh line, goal block, and the
    truncation summary "20/21 truncated tasks · 7/7 decisions".
  - ARTIFACT rows carry the v1.21.0 typed labels `class openable https  host
    internal.example` (trace reference) and `class local path` (runbook
    reference), each with the inert-chrome note that workspace membership does
    not grant access.
  - MY WORK "Needs You" rows (`task_att001_blocked_ana`, then
    `task_att001_open_ana`), CURRENT WORK attention rows, SOURCE section
    naming `get_workspace_context`.
  - Footer: at 120 columns —
    `p perspective   tab section   j/k move   enter inspect   r refresh   ? help   q quit`;
    at 80 columns the compact footer drops `p perspective` and `? help`.

## Files (capture-time sha256)

`docs/evidence/nav-001/baseline/terminal/` contains exactly:

| File | sha256 |
| --- | --- |
| `baseline-v1.21.0-ana-lab-80x24.txt` | `a871dfba4501fe2dd1779e2f37eb6a4d373b4050c96d8237b141306007dff930` |
| `baseline-v1.21.0-ana-lab-120x36.txt` | `c0c148dc4effd9cfdb77fd7f33a53ba29c0c0b32c57128ea9437f52151a011ee` |
| `capture-summary.json` | (the capture record for both frames; root/db recorded as `[path]`) |

Frame checks recorded in the summary: line counts exactly 24/36; widest lines
79/120 (within window); `noEscapeControls: true` (belt check false — nothing
bell-like remains); `noCredentialShape`, `noHomePath`, `noPrivatePath`,
`noUnrelatedSentinel` all true; **0 redactions were needed** (`redactionsAppliedBeforeWrite: 0`).

Frame identity caveat: the header refresh timestamp is wall-clock, so the
sha256s above pin these capture-time frames; a re-capture reproduces the same
content except that one timestamp line.

## Provenance of the capture environment

- The dashboard was executed from a disposable detached git worktree at tag
  `v1.21.0` (registered as `nav-001-baseline-src`, discoverable with
  `git worktree list`; its absolute path is intentionally not recorded here —
  machine-local absolute paths are redacted from evidence files, which is why
  `capture-summary.json` shows `[path]` for the root and db).
- In that worktree: `npm ci --no-audit --no-fund` (package `1.21.0`,
  `prepare` build passes), then the ATT-001 seed ran from the worktree's own
  tsx and produced the served database at
  `fixtures/attention/att-001/.tmp/nav-baseline/` with `tokens.json` and
  `seed-receipt.json` written mode 0600. The main checkout was not modified.
- The captures were invoked from the main repo with `--root` pointed at that
  worktree (and `--db` at the worktree-seeded database), so the dashboard code,
  dependencies, and viewer static assets are all the v1.21.0 tree.
- At HEAD the main tree is dashboard-identical to the tag for product files:
  `git diff v1.21.0..HEAD -- src migrations public package.json tests
  fixtures/attention/att-001/seed.ts` is empty (only packaging/homebrew and
  release-doc material differ, which is pre-existing owner work outside the
  dashboard surface).

## Reproduction

Any clean worktree of the tag reproduces this:

```sh
git worktree add "$WT" v1.21.0
cd "$WT" && npm ci --no-audit --no-fund
node_modules/.bin/tsx fixtures/attention/att-001/seed.ts \
  --out fixtures/attention/att-001/.tmp/nav-baseline --force
cd <main-repo>
npx tsx fixtures/navigator/nav-001/capture-dashboard.ts \
  --root "$WT" \
  --db "$WT/fixtures/attention/att-001/.tmp/nav-baseline/campfire.db" \
  --workspace ws_att001_lab --actor hum_att001_ana \
  --out docs/evidence/nav-001/baseline/terminal \
  --label baseline-v1.21.0-ana-lab
```

(Differs from the pinned files only in the wall-clock refresh line.)

## Baseline release facts (cited, not re-derived here)

From `docs/RELEASE_V1_21_DECISION.md`, the v1.21.0 record these captures sit on top of:

- Candidate chain `5258d5b` → `d0e16f4` (dated scope before code; ARH-001 §9
  ENGINEERING PASS with human outcome NOT OBSERVED), prep `6d39a51`
  (`1.21.0` bump; full suite 95 files / 1,166 tests at that prep), and
  pre-tag fixes in `5523305`; fresh export audit at the tag PASS (315 files,
  token/home-path/sentinel sweeps clean).
- Public GitHub Release `v1.21.0` with four checksummed CI archives; local
  checksum verification passed — darwin-arm64
  `8dd62e1e0656899be58d8b177539a440985e491697991a0859a4cf899dd5e8c7`
  (the extracted archive reports package `1.21.0`); darwin-x64, linux-arm64,
  and linux-x64 pinned as `4b419a9f…`, `ab1f900d…`, `006cff15…` in the release
  record.
- Production Worker version `d4e537cd-e465-4c15-a847-36efde627175`; live and
  versioned installer URLs byte-identical to the tracked files, and a clean
  install from the versioned URL verified the published archive checksum,
  reported `1.21.0`, and ran the CLI with telemetry suppressed only via the
  documented `CAMPFIRE_TELEMETRY=0` env.
- `docs/SPRINT_ARH_001_RESULT.md` dated addendum (2026-10-17) is part of this
  baseline: the shipped §10 classifier correction (`5f2cfdb` → `ad42fb8`,
  independently verified at the tag: scope-code 6/6, all four red groups fail
  on the pre-correction classifier, focused 39/39, full suite 95 files /
  1,165 tests + 1 opt-in skip, live headless interplay on the shipped code
  with three injected corrected-case rows fully inert) including the recorded
  footnote that one sample's path text was reworded in `5523305`
  (the demo filename's root segment moved from a personal-home-style root to
  the normalized archive root; identical class and expectation) for the export
  audit — quoted exactly in `docs/RELEASE_V1_21_DECISION.md` and
  `docs/SPRINT_ARH_001_RESULT.md` §10; this pin deliberately paraphrases it so
  no evidence file here embeds that literal path shape.

These baseline frames are the frozen "before" for every NAV-001 dashboard
change; observations of them are engineering observations keyed by
`docs/evidence/nav-001/FIXTURE_KEY.md`.
