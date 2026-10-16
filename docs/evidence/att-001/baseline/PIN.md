# ATT-001 baseline pin — v1.18.0

FIXTURE EVIDENCE — calibrates UI and rubric; cannot establish Gate B, C, or E.

## Pin summary

| Item | Value |
| --- | --- |
| Source pin | Tag `v1.18.0`, commit `7f606493dc7af958ae75fbc80fd6ed5065be786d` (the published release tag) |
| Capture worktree | Clean detached git worktree at tag `v1.18.0`, created outside the repository (OpenCode temp dir) and discarded after capture; product source byte-identical to the published tag |
| Package version | `1.18.0` (`package.json`, from the tag) |
| Product source | Unmodified: the six pinned files (`src/service/campfire-service.ts`, `src/service/context-assembly.ts`, `src/worker/async-service.ts`, `src/viewer/static/app.js`, `src/viewer/static/index.html`, `public/app.js`) hash identically in the worktree and in `git show v1.18.0:<path>` (hashes in `served-state/seed-log.txt`) |
| Main worktree at capture | Carried the in-flight v1.19 ATT-001 candidate change (modified `src/` files, untracked contract, fixture, and test file); it was not used to produce this baseline |
| Scenario version | Fixture v2 — the dated scenario repair (lab proposed decision removed) is recorded in `SCENARIO_REPAIR.md`; this capture set was re-produced fresh after it |
| Seed clock | base `2026-10-15T16:00:00.000Z`, +1 s per write, final `2026-10-15T16:04:19.000Z` |
| Frozen read clock | `SERVED_AT = 2026-10-15T18:00:00.000Z` |
| Determinism | Two fresh seeds (`run-a`, `run-b`) and two dumps; `diff -r` over the dump directories printed nothing (byte-identical, 24 files per run) |
| Fixture | `fixtures/attention/att-001/` (`seed.ts`, `dump.ts`, `capture-viewer.ts`, `README.md`) |
| Served state | `served-state/` — 20 context/workspace dumps, `whoami-ana.json`, `whoami-ben.json`, `denials.json`, `dump-summary.json`, `seed-log.txt` |
| Captures | `captures/` — 20 full-page PNGs and 20 `#orientation` text captures (Ana, Ben × 5 workspaces × My work / Team work) |
| Write probe | `probe/ana-updates-opencode-task.json` — allowed; recorded contribution actor `hum_att001_ana` |
| Checksums | `SHA256SUMS` covers every file in this directory except itself |

## Statement

The baseline was produced from a clean git worktree at tag `v1.18.0`
(commit `7f60649`), not from the repository's main worktree. At capture time
the main worktree carried the in-flight v1.19 ATT-001 candidate change
(modified `src/` and `tests/` files, an untracked contract document, the
untracked fixture, and an untracked test file), so its `src/` was no longer
byte-identical to the published release. In the capture worktree no product
file differed from the tag: the six pinned product files hash identically in
the worktree and in `git show v1.18.0:<path>`. The only files added to the
worktree were the ATT-001 fixture scripts (scenario v2) and a `node_modules`
symlink.

This capture set was re-produced fresh against the repaired fixture (scenario
repair v2, `SCENARIO_REPAIR.md`, dated 2026-10-15 local / 2026-10-16 UTC): the
repaired lab workspace has no proposed decision, so the lab decisions slice is
7 total / 7 returned, Ana's attention lists contain only tasks, and the
incomplete-empty observation (Ben, truncated task page) belongs to the fixture
v2 design. The previous capture set was replaced with this re-produced one;
`SHA256SUMS` was regenerated from it.

The captures therefore show the **published v1.18.0 behavior**, and the frozen
fixture reproduces the contract §2 gaps (see `GAP_PROBES.md`). This pin is
fixture evidence: it cannot establish Gate B, C, or E, and it is not a
human-comprehension result.
