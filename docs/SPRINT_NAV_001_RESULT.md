# Campfire — Sprint NAV-001 Result: Focused Terminal Navigator

**Date:** October 17, 2026 (local; capture and run timestamps cross October 18 UTC)

**Status:** **CONDITIONAL GO — engineering candidate.** The D1–D6 deterministic checks pass on the recorded candidate and no known safety failure remains; the contract §6 two-person comparison is **NOT OBSERVED** (recorded reason below). No version bump, tag, public snapshot, installer pin, release decision, or deployment is part of this result. Per contract §6, a v1.22.0 version bump, tag, snapshot, channel pin, or deployment requires a separate recorded founder release decision naming the shipped slice and the human outcome. This record does not claim human comprehension, a universal speedup, Gate B/C/E/F, VIS-001 condition 4, or resolution of any earlier open observation.

**Contract:** `docs/Campfire-v1.22-NAV-001-Focused-Terminal-Navigator.md`
**Evidence:** `docs/evidence/nav-001/` — fixture key, v1.21.0 baseline pin + frames, candidate frames + per-run summaries
**Baseline:** published `v1.21.0` — annotated tag object `38e03e8`, commit `5523305`, package `1.21.0`; pinned in `docs/evidence/nav-001/baseline/BASELINE_PIN.md`
**Fixture:** `fixtures/navigator/nav-001/` — `ws_nav001_lab`: 20 humans, 37 registered agents, 64 tasks (58 fillers + 6 keyed), 5 decisions, 12 artifacts

## 0. Verdict and what it does not claim

Contract §6: **CONDITIONAL GO — engineering candidate** applies when D1–D6 pass, no known safety failure remains, and the two-human comparison is unavailable for a recorded reason. That is this case:

- **Recorded reason for the missing human comparison:** the engineering session had one human operator, and contract §6 requires **two non-builder humans** running the five pre-registered cold tasks in both the released v1.21.0 dashboard and this candidate, order counterbalanced. No eligible pair was available. §6 forbids substituting the builder, agents, or scripted captures; the five tasks are therefore **NOT OBSERVED** — not passed, not failed.
- The terminal frames in `docs/evidence/nav-001/` are scripted PTY captures: labeled engineering evidence, never human-observation evidence and not the §6 comparison.
- No release decision was requested or recorded for v1.22.0; the package stays `1.21.0`.
- Gate B, Gate C, Gate E, Gate F, VIS-001 condition 4, the UIX-001 five cold tasks, the ATT-001/SWH-001 comprehension traces, the WCO-001 two-human case, and the ARH-001 reference-open/handoff attempts keep their own rubrics and are untouched.

## 1. What is in the tree

**Step 0 freeze (commit `ff8c327`):**

- `docs/Campfire-v1.22-NAV-001-Focused-Terminal-Navigator.md` — the frozen contract.
- `fixtures/navigator/nav-001/` — deterministic seed (hard-asserts the frozen key before writing), read-only served-state dump, PTY capture driver, README.
- `docs/evidence/nav-001/FIXTURE_KEY.md` — frozen answer key; `docs/evidence/nav-001/baseline/` — v1.21.0 pin with stripped 80×24 and 120×36 frames and their capture summary.

**Product change (candidate commits `64cc5a4`, refined by `c2ff97e`; local on `main`, not pushed):**

- `src/cli/dashboard.ts` — the read-only `campfire dashboard` renders **one active section** plus a `SOURCE` selected-record block instead of the eager multi-section frame. Sections: `attention`, `work`, `decisions`, `references`, `changes` (`tab` cycles; `p` switches My work/Team work). The header keeps the workspace, actor, goal block, and the `20 people · 37 registered agents` count line without enumerating agent rows. A local `/` filter narrows the shown rows, labeled `filters shown records, not the workspace` with `shown of loaded` counts; `esc` clears, `enter` confirms, Ctrl-C quits from every mode. Refresh reconciles the selected row ID against the new shown list (a surviving ID is kept; a missing one selects the top shown row and drops stale detail); a failed refresh keeps the last snapshot labeled **stale** with the error.
- `tests/unit/nav-001-dashboard.test.ts` — 19 focused tests: five-section cycle, filter entry/typing/confirm/clear, shown-row movement, selection-preserving refresh, stale-on-failure, filtered-empty honesty, chunked input, escape-sequence stripping.
- Adapted tests: `tests/unit/uix-001-dashboard.test.ts`, `tests/integration/uix-001-parity.test.ts` (five-section loop), `tests/integration/arh-001-surfaces.test.ts` (References scoping). `tests/unit/uix-001-dashboard-pty.test.ts` is **unchanged** and still spawns the real dashboard and asserts termios restore and alt-screen ordering.
- `docs/evidence/nav-001/candidate/` — README, six stripped frames at 80×24 and 120×36, and three per-run capture summaries from the final revision.

**What did not change:** SQLite/D1 schema and migrations, service/domain/persistence reads, CLI JSON, MCP, HTTP/Worker, Viewer files and the five `VIEWER_READ_METHODS`, installer channels, telemetry, webhook vocabulary, and the package version. The dashboard uses only the existing authorized `get_workspace_context` read and the existing get-by-ID methods. No new write path or workspace object.

## 2. Baseline (§3)

The baseline was captured from a disposable detached worktree at annotated tag `v1.21.0` (commit `5523305`, package `1.21.0`), and a check recorded in the pin shows the main tree's product files dashboard-identical to the tag at the freeze. Stripped frames at 80×24 and 120×36 with sha256s are in `docs/evidence/nav-001/baseline/BASELINE_PIN.md` (frames `a871dfba…` and `c0c148dc…`).

The display-pressure fixture was seeded before implementation and frozen with the key:

- **`ws_nav001_lab`** — 20 humans, 37 registered agents, 64 tasks (58 fillers + 6 keyed), 2 findings, 5 decisions, 12 artifacts.
- **Served task page** — 20 of 64 rows (`7 blocked + 5 in_progress + 8 open`), reported as `20/64 truncated tasks · 5/5 decisions`; all six keyed tasks returned (including `task_nav001_assigned_open_ana`).
- **Ana's needsYou** — three cues in order: `dec_nav001_proposed`, `task_nav001_assigned_blocked_ana`, `task_nav001_assigned_open_ana`.
- **Decisions** — five distinct states: proposed, plain accepted, a competing accepted pair, and accepted-needing-review whose cited finding `find_nav001_superseded` is no longer current.
- **References** — `art_nav001_notes` (local path), the hostile-title artifact (unparsed, rendered inert), and `art_nav001_runbook` (openable https, host `example.com`, `cited by find_nav001_current (supports)`); artifact page 10 of 12 truncated.
- **Denial case** — Zed is the only participant of `ws_nav001_unrelated` and is denied the lab (`ParticipantRequired`, both denial records in `denials.json`); the unrelated sentinel stays confined to `ws_nav001_unrelated`.
- **Recorded limitation (deliberate):** the filler status mix is a weighted `N % 13` cycle, not a uniform cycle, so blocked fillers stay at 4 and the 20-row page keeps all six keyed tasks returned; any redesign of the filler mix must re-verify the frozen page shape, not just the ID list (`FIXTURE_KEY.md`).

## 3. Deterministic checks D1–D6 (§5)

Run record on the recorded candidate `c2ff97e` (macOS, Node 22.23.2, vitest 5.0.0):

- `npm run typecheck` — clean.
- Focused five files (`nav-001-dashboard`, `uix-001-dashboard`, `uix-001-dashboard-pty`, `uix-001-parity`, `arh-001-surfaces`) — **53 passed | 1 skipped** (the skip is the opt-in Playwright capture).
- Full suite — **96 files, 1184 passed | 1 skipped**.
- `npm run build` — clean. `npm run pack:tarball` — `release/campfire-darwin-arm64.tar.gz`, sha256 `5dace00987297fb1a1d97684bf108e7f01715e1fdef9c86ee8aca3455a13747e`. `npm run deploy:dry-run` — bindings resolved, exits before deployment.

| Check | Result and evidence |
| --- | --- |
| **D1 — authorized source truth** | PASS. Frames match `FIXTURE_KEY.md` exactly: goal `goal_nav001_focus`, Ana's three cues with kind/ID/status/assignee, the five decisions with currentness and cited finding, and the typed reference classes with host and cited-by. The dashboard reads through the same authorized `get_workspace_context`/get-by-ID paths with the existing `sameWorkspace` guard; the fixture's non-participant denial records and the unrelated-sentinel confinement are asserted by the seed, and the candidate evidence sweep contains no unrelated-workspace string. |
| **D2 — honest completeness** | PASS. Frames render `tasks 20 of 64 (truncated)`, `artifacts 10 of 12  truncated`, `decisions 5 of 5`; the filter indicator says `filters shown records, not the workspace` with `showing X of Y loaded rows`; a filtered-empty list prints `no shown row matches the filter` while keeping the section coverage and caveat lines; a failed refresh keeps the previous list labeled **stale** and never renders a false empty state (unit tests). |
| **D3 — navigation and scale** | PASS. All five sections and the selected source are reachable by keyboard; at 80×24 and 120×36 the frames carry the goal, active section, selected full ID, status/review reason, coverage, and `q quit` (footers 79 and 95 chars). In the 20-human/37-agent/64-task fixture the first screen shows the cues and the count line — no participant, agent, artifact, or decision dump ahead of work. |
| **D4 — terminal safety** | PASS. Non-TTY keeps the existing plain instruction with no controls (path unchanged, verified in diff). The hostile-title artifact renders inert (`class unparsed`), all six frames are byte-checked free of ESC/BEL, and control stripping runs before output. The unchanged PTY suite spawns the real dashboard and asserts termios restore, cursor, and alt-screen ordering for `q`, Ctrl-C, and SIGINT; the candidate summaries record `exit 0`, `termiosRestored: true`, alt-screen enter/leave, cursor hide/show, and **0 redactions needed**. |
| **D5 — v1.21 and decision safety** | PASS. References keep the shipped classifier (`class local path`, `class unparsed`, `class openable https  host example.com`) and the recorded `cited by find_nav001_current (supports)` relation; the terminal never opens or fetches. Decisions keep proposed, accepted, competing accepted, and accepted-needs-review distinct (`needs review  find_nav001_superseded` shown); no operative decision is chosen. Registered agents appear only as a count; task `blocked` stays a lifecycle state. |
| **D6 — compatibility** | PASS. No schema, migration, service, method, Viewer, installer, or telemetry diff (reviewed); `tests/unit/uix-001-dashboard-pty.test.ts` is unchanged; full suite, build, package tarball, and deploy dry-run are green; the package version stays `1.21.0` and `status --output json`, other CLI JSON, MCP, and the Viewer allowlist are untouched. |

Capture reproducibility: the frames were re-captured from the final revision; with the wall-clock `refreshed` line masked, all six frames are byte-identical to the independently verified first capture.

## 4. Independent verification

An independent agent session verified candidate revision `64cc5a4` read-only (no edits): full diff review (`git status` matched exactly the expected source and test files plus the candidate evidence), fresh focused/typecheck/full-suite runs, frame sha256 and fixture-key comparison, a forbidden-string sweep over the candidate evidence, and adversarial probes (filter-mode keys, escape-sequence leakage, refresh/stale truth, non-TTY message, teardown ordering).

**Result: D1–D6 PASS, no blockers.** It raised two observations, both resolved in `c2ff97e`:

1. **`q` types into the filter while typing** — contract §1 lists `q` as exit without a typing carve-out, but a substring filter must accept printable letters (including `q`). The visible typing hint and the help line now say `ctrl-c quits`, so the key map is truthful in the mode it describes; `esc` clears and exits, `enter` confirms, Ctrl-C quits from every mode. Recorded as an interpretation in §6 below.
2. **An unknown ESC-led chunk dropped trailing keys** (`"\u001bqj"` lost the `j`) — fixed with `stripEscapeSequences()` plus two new tests, used by both input paths; sequence bytes still never leak as text and an exact ESC chunk stays the esc key.

The verifier's remaining not-done items were closed afterwards: the re-seed + re-capture diff was run at `c2ff97e` (masked diff identical, above), and PTY/teardown behavior remains covered by the unchanged PTY suite.

## 5. Human observation (§6)

**NOT OBSERVED — recorded reason:** no two eligible non-builder humans were available in the engineering session, and contract §6 forbids substituting the builder, agents, or scripted captures. The five pre-registered cold tasks (goal/source ID; next task, assignee, and permission reading; accepted-needs-review decision with the non-current finding and no choice between competing accepted decisions; truncated attention source; cited Artifact reference with what Campfire does and does not know) were not run by any human, so no comprehension, speed, or error result exists for either the v1.21.0 baseline or this candidate. The frozen fixture, answer key, and capture tooling remain in place for a future comparison when two eligible people are available.

## 6. Deviations, limitations, and notes

1. **Contract §1 key map vs. filter typing.** The key map (`q` exits) is read as applying outside filter typing; while typing, printable letters — including `q` — append to the filter because that is what a substring filter requires. The on-screen typing hint and the help line now state `ctrl-c quits`, keeping the visible map accurate; Ctrl-C quits from every mode. Recorded here rather than editing the frozen contract.
2. **Input-chunk handling beyond the minimal spec.** `normalizeInputChunk` (chunk splitting for scripted/pasted bursts, required for comma-separated capture keys) and `stripEscapeSequences` (unknown ESC-led sequences no longer swallow the rest of a chunk) were added to the CLI input path; the PTY behavior test is unchanged.
3. **Capture key syntax.** `--keys` is comma-separated (`"tab,tab"`); a space-separated string is sent as one literal token and does not navigate. Documented in the fixture and candidate READMEs.
4. **Fixture filler-cycle limitation (deliberate).** The weighted `N % 13` filler status cycle is required to keep the 20-row page shape and all keyed rows returned; recorded with the fixture before implementation per §3.
5. **Wall-clock `refreshed` line.** The only intended frame variation; the re-capture at `c2ff97e` is byte-identical to the verified first capture with that line masked, and the evidence sha256s pin the final revision.
6. **Quit path draws before teardown.** The final draw on quit is guarded (`writeControl` swallows dead-stream errors; `leaveScreen()` always runs in `finally`; later draws are suppressed); verified safe by the independent review.
7. **No version bump.** The package stays `1.21.0`; no tag, installer pin, or release decision is recorded by this sprint.

## 7. Open gates and next steps

- **v1.22.0 publication** requires a separate recorded founder release decision (contract §6/§7.5); the delivery rule permits an accurately labeled release while human use is open, but publication does not convert NOT OBSERVED into PASS.
- **NAV-002** retains the on-demand People directory, paged work, and deeper source/history drill-down; **NAV-003** retains Viewer navigation alignment with its own human-use evaluation.
- The §6 two-human comparison remains available: the fixture, answer key, and capture tooling are frozen, so the trace can run when two eligible people are available.
- Gate B, Gate C, Gate E, Gate F, VIS-001 condition 4, and the earlier open human observations remain unmeasured/unchanged.
