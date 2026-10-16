# Campfire — Sprint UIX-001 Result: Shared Work Console

**Date:** October 16, 2026

**Status:** **CONDITIONAL GO — engineering candidate.** D1–D6 pass on the checks recorded below. The five cold tasks are **NOT OBSERVED**. No version bump, tag, public snapshot, installer pin, release decision, or deployment is part of this result. The candidate is committed as `6df822c`. The founder directed a public v1.20.0 release under the recorded release-scope override in `docs/RELEASE_V1_20_DECISION.md`, then froze that tag unpublished before promotion (the pty capture test required a machine-local Playwright install; repaired in `70f4023`, re-cut and, on October 16, 2026, published and deployed as v1.20.1 under `docs/RELEASE_V1_20_1_DECISION.md`); neither override changes this verdict, the NOT OBSERVED five cold tasks, or any gate. This record does not claim human comprehension, and it does not close ATT-001, WCO-001, SWH-001, VIS-001 condition 4, or Gate B/C/E/F.

**Contract:** `docs/Campfire-v1.20-UIX-001-Shared-Work-Console.md`  
**Field map and answer key:** `docs/evidence/uix-001/FIELD_MAP.md`  
**v1.19.0 byte pin:** `docs/evidence/uix-001/baseline/PIN.md`  
**Candidate captures:** `docs/evidence/uix-001/candidate/`  
**Baseline:** package `1.19.0` at git `5674de1`, before these edits. The candidate is committed as `6df822c`.

## 0. Verdict and what it does not claim

Contract §8: **CONDITIONAL GO — engineering candidate** applies when D1–D6 pass and the human comparison is unavailable for a recorded reason.

- **Recorded reason:** this session had one operator and coding agents. The contract requires at least two non-builder humans on the five cold tasks. Agents are not that observation. No matched v1.19 versus candidate human times were recorded.
- Candidate frames exist for visual review at 80×24, 120×36, 1440×900, and 390×844. They are fixture captures. A screenshot does not establish that a person understood the workspace.
- The v1.19 CLI and Viewer screenshots named in Step 0 were not captured. The published Viewer shell is pinned by SHA-256 in `docs/evidence/uix-001/baseline/PIN.md`.
- `npm run pack:tarball` and `npm run deploy:dry-run` were not run. This candidate is not release-shaped.

## 1. What is in the tree

- `src/presentation/work-console.ts` — shared labels for attention reason, coverage, empty lists, lifecycle phrases, artifact references, and terminal-control stripping. The Viewer keeps the same sentences in `app.js`; a test fails if they drift.
- `src/cli/dashboard.ts`, catalog entry, and `cmdDashboard` — read-only `campfire dashboard [workspace]`. Interactive TTY only. A non-TTY call returns the instruction to use `campfire status --output human` or `campfire status --output json` and writes no cursor controls. `status` JSON is unchanged. The tall frame lists returned artifact references with `stored reference, not fetched`.
- `src/viewer/static/{index.html,app.css,app.js}` and byte-identical `public/` copies — attention beside current work on wide screens, stacked panels on narrow screens, recorded participant counts, goal id, and a local Density control (`campfire-viewer-density`). The five Viewer read methods are unchanged.
- Tests: `tests/unit/uix-001-labels.test.ts`, `tests/unit/uix-001-dashboard.test.ts`, `tests/unit/uix-001-dashboard-pty.test.ts`, `tests/integration/uix-001-viewer.test.ts`, `tests/integration/uix-001-parity.test.ts`. The WCO-001 catalog length assertion is 60 because `dashboard` was added. Continuation commands are still present.
- `scripts/uix-001-viewer-capture.ts` writes the Viewer viewport files. It is fixture tooling. Playwright is not a repo dependency.

No schema, migration, MCP tool, or write path was added. `fixtures/attention/att-001/seed.ts` has a return-type annotation on `keyIdMap` (`Record<string, unknown>`) so the new tests can import the fixture under `tsc`. The seed values are unchanged.

## 2. Checks

`npx tsc --noEmit` was clean after that annotation. `npx vitest run` — **93 files / 1126 tests passed.** `public/` matched `src/viewer/static/` for `index.html`, `app.css`, `app.js`, and `campfire-mark.svg` (`cmp`, `SYNC_OK`).

The same-fixture comparison is `docs/evidence/uix-001/candidate/PARITY.md`. It uses the ATT-001 lab seed (`seedDatabase(..., true, "none")`) and does not rescore ATT-001.

| Check | Result |
| --- | --- |
| **D1 — service truth** | PASS. On the lab fixture, both surfaces show the goal id and title, registered agents, accepted needs-review decisions with their finding ids, both competing accepted decisions, and no `operative`, `online`, `working`, or unrelated sentinel. |
| **D2 — bounded completeness** | PASS. Coverage reads 20 of 21 tasks, truncated, with cues beyond the returned pages. Ben’s My work empty list says more matching records may exist. A failed refresh in the unit tests keeps the previous task id and says stale. |
| **D3 — terminal safety** | PASS for the paths that were driven. A pseudoterminal restored slave termios after `q`, raw Ctrl-C (`\x03`), and external SIGINT. Stripped frames at 80×24 and 120×36 contain no ESC, stay within the column count, and include the goal title, `goal_att001_attention`, `ws_att001_lab`, `20/21`, and `q quit`. A live SIGWINCH and a thrown read after the screen is entered were not driven. |
| **D4 — Viewer safety** | PASS. Existing Viewer suites plus the density and recorded-count tests. Viewport captures at 1440×900 and 390×844 report `scrollWidth` equal to `clientWidth` (1440 and 390). Dispatch on the capture stayed on `whoami`, `list_workspaces`, `get_workspace`, `get_workspace_context`, and `get_activity`. |
| **D5 — cross-surface parity** | PASS for the facts in `PARITY.md` on one `get_workspace_context` read. The workspace id is on the dashboard and on the Viewer option value. Viewport text shows the workspace name. `campfire status --output json` was not dumped beside these frames; an earlier focused test still parses status JSON for the billing workspace. |
| **D6 — compatibility** | PASS for the full suite above and the static-asset byte match. Packaging and deploy dry-run were not run. |

## 3. Visual review

Inspected the candidate PNGs and the stripped terminal text. This is a hierarchy and clipping review. It is not a cold-task score.

- 1440×900 Ana My work shows the goal title, goal id, Needs You, and the first current-work titles in the first viewport. Team work shows Needs Attention with both review cues. Horizontal overflow is absent.
- 390×844 stacks the same header, goal, and attention panel, with no horizontal overflow. Later workstream rows sit at the bottom edge of the viewport.
- On Ana’s Team work attention card, `dec_att001_review_withdrawn` wraps across lines, so the id is harder to scan as one token. The text capture still contains the full id.
- The 120×36 terminal frame shows the goal title, both registered agents, both artifact references, the selected blocked task, and the competing and needs-review decisions. The two columns meet on one line. The last line is the full key hint, including `q quit`.
- The 80×24 terminal frame shows the goal title, goal id, coverage fraction, artifact references, the selected task id, and a compact last line `j/k move   enter inspect   r refresh   q quit`. Width under 100 columns uses that shorter hint so quit stays on screen.

## 4. Deviations

- Recent changes on the dashboard come from `provenance` on `get_workspace_context`, or `slices.recentChanges` when provenance is empty. `get_activity` is not called by the dashboard. The Viewer capture did call `get_activity`, which is an existing Viewer read.
- Automatic refresh is every 15 seconds, pauses while the process is stopped, and pauses when `ps` cannot show the process as the foreground process group. `r` still refreshes. A failed read keeps the last context. That failure path was not repeated inside the pseudoterminal.
- If rank-0 lines fill the terminal, the selected id, goal id, workspace id, and coverage fraction are written back onto the last content lines above the quit hint. Not every cue is on screen at once. The goal title stays because it is kept with the goal id, and the quit hint is reserved as the last row.
- The evaluation fixture and answer key reuse ATT-001 scenario v2. That does not rescore ATT-001.
- Terminal PNGs are the stripped frame in a monospace `pre` on `#171717` at 720×432 and 1080×648. They are not Terminal.app chrome.

## 5. Human observation

**NOT OBSERVED.** The frozen tasks are in `docs/evidence/uix-001/FIELD_MAP.md`. A builder walking them would be a debugging rehearsal, not the two-person comparison. v1.20 has no release decision.
