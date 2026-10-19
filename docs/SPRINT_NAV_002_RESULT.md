# Campfire — Sprint NAV-002 Result: Source and People Drill-down

**Date:** October 18, 2026 (local; capture timestamps cross October 19 UTC)

**Status:** **CONDITIONAL GO — engineering candidate.** D1–D7 pass on the recorded candidate. The contract §7 two-person comparison is **NOT OBSERVED**. No version bump, tag, public snapshot, installer pin, release decision, or deployment is part of this result. A `v1.23.0` bump, tag, snapshot, channel pin, or deployment requires a separate recorded founder decision. This record does not claim human comprehension, live presence, a transitive history graph, Gate B/C/E/F, or a rescore of any earlier sprint.

**Contract:** `docs/Campfire-v1.23-NAV-002-Source-and-People-Drill-down.md`
**Evidence:** `docs/evidence/nav-002/` — Step 0 freeze, v1.22.1 baseline frames and JSON, candidate PTY frames
**Baseline:** published `v1.22.1` — annotated tag object `7f23c1bc06c79e17729e3cbce1ed9d5177ba4fb7`, commit `fd38eb20703167cbf9ea1c30b7b8cd92661a9b45`, package `1.22.1`
**Fixture:** extended `fixtures/navigator/nav-001/` — `ws_nav001_lab`: 20 humans, 37 registered agents, 64 tasks, 57 participants

## 0. Verdict and what it does not claim

Contract §7: **CONDITIONAL GO — engineering candidate** applies when D1–D7 pass and the eligible human comparison is unavailable for a recorded reason. That is this case.

- **Recorded reason:** this implementation session had one operator and used coding agents. §7 requires two non-builder humans, order counterbalanced, on the released v1.22.1 dashboard and this candidate. No eligible pair was available. §7 forbids substituting the builder, agents, or scripted captures. The five cold tasks are **NOT OBSERVED**.
- The frames under `docs/evidence/nav-002/` are scripted PTY captures. They are engineering evidence.
- Package version stays `1.22.1`.
- NAV-001, ONB-001, UIX-001, ATT-001, SWH-001, WCO-001, ARH-001, VIS-001 condition 4, and Gates B/C/E/F keep their own evidence rules.
- NAV-003 still owns Viewer alignment and any Viewer allowlist expansion.

## 1. What is in the tree

| Commit | What |
| --- | --- |
| `073b674` | Step 0 freeze: contract, v1.22.1 frames and authorized JSON, extended fixture (`agt_nav001_03` owned by non-participant `hum_nav001_zed`), answer sheet |
| `edeab41` | `list_workspace_participants`, `get_record_history`, opt-in `participants: "omit"`, SQLite/D1 index `idx_contributions_object_position` |
| `02eed76` | Terminal People section, paged Work, selected-record history, dashboard passes `participants: "omit"` |
| `b2321e9` | ATT-001 and WCO-001 catalog locks expect the two new MCP reads and no removals. Viewer allowlist stays five methods |

`campfire agents` still calls `get_workspace_context` without `participants: "omit"`.

## 2. Deterministic checks

Run on macOS after `b2321e9`. Focused reads, dashboard, nav-001, and D1 parity passed before the catalog update (4 files, 40 tests) and again inside the full suite.

| Command | Result |
| --- | --- |
| `npm run typecheck` | pass |
| `npm test` | **99 files, 1233 passed, 1 skipped** |
| `npm run build` | pass (`02eed76`, before the test-only commit) |
| `npm run pack:tarball` | pass. Gitignored `release/campfire-darwin-arm64.tar.gz`, sha256 `d82ea5e1b297e772ca1c9d003ab6c0373154e2363e7cecd681c2aaf3e554a997`. Built from `02eed76`. `public/campfire/v1.22.1/install.sh` was not rewritten |
| `npm run export:public -- --ref 02eed76 --output /tmp/nav-002-export` | pass. 338 files. No forbidden-path or secret finding. Export directory removed |
| `npm run deploy:dry-run` | pass. Wrangler stopped at `--dry-run: exiting now`. No remote deploy |

The one skip is the existing opt-in Playwright capture in `tests/unit/uix-001-dashboard-pty.test.ts`.

The first full-suite run on `02eed76` failed two older MCP catalog assertions (length 36, and the WCO-001 name list). Those tests were updated in `b2321e9` to require every previous tool plus `list_workspace_participants` and `get_record_history`. The suite above is the rerun.

### Measurements (extended seed, clock `2026-10-17T14:00:00.000Z`, Ana, one sample)

| Read | Compact bytes | Shape | Elapsed |
| --- | ---: | --- | ---: |
| Default `get_workspace_context` | 64920 | 57 participants, no `participantsCoverage` | 3.178 ms |
| `participants: "omit"` | 55806 | `{returned: 0, total: 57, truncated: true, omitted: true}` | 2.418 ms |
| `list_tasks` page 1, limit 20 | 6496 | 20 of 64, truncated | 0.374 ms |
| `list_workspace_participants` page 1 | 4518 | 20 of 57, truncated | 0.433 ms |
| `get_record_history` `dec_nav001_review` | 1164 | 3 of 3, tip 217 | 0.561 ms |

64920 matches the Step 0 default. Omit size is under the 56000 ceiling. History `EXPLAIN` uses `idx_contributions_object_position (workspace_id=? AND object_type=? AND object_id=? AND append_position<?)`. Participant `EXPLAIN` uses `idx_participants_workspace (workspace_id=?)` plus a temp b-tree. No participant sort index was added. These times are one fixture sample, not a claim about larger teams.

| Check | Result |
| --- | --- |
| **D1** | PASS. `workspace:read` runs before participant count, items, owner lookup, limit, or cursor errors. History calls `workspace:read`, then `activity:read`, then object-exists-in-workspace, then the page. Zed on the lab is `ParticipantRequired` with no count or payload. A cross-workspace object is `*NotFound`. A bad cursor returns no items. HTTP/MCP reject a bad `objectType` as a schema error before service auth; that error names the caller's value and no workspace row. |
| **D2** | PASS. Opening frames stay on Needs You. Header is `57 workspace participants` plus a note that the human/agent split is not in that read. Work page 2 selects `task_nav001_f051`, `returned 20 of 64`. People page 1 is `returned 20 of 57` and says it is not the workspace split. The initial dashboard call omits the roster. |
| **D3** | PASS. Ana's filtered read is `agt_nav001_01` and `agt_nav001_21`, `humanOwnerIsParticipant` true, total 2. `agt_nav001_03` is owned by `hum_nav001_zed`, who is not a lab participant; the selected-agent source says the owner is outside the roster. The list row does not add Zed. Registration, role, and `in_progress` copy say they are records, not presence or permission. |
| **D4** | PASS. `dec_nav001_review` history is `con_nav001_0283`, `con_nav001_0279`, `con_nav001_0276`, newest first, total 3 at tip 217. A later write stays out of that traversal (unit test). Empty history text is `No contributions recorded for this record`. Failed and stale history do not say complete. Needs-review does not un-accept the decision. The fixture has no zero-contribution object; the empty sentence is tested, not seeded. |
| **D5** | PASS. Task, people, history, and inspect responses apply only when their generation still matches. A failed page keeps the last page and marks it stale. Filter typing accepts letters. Frames have no ESC. Quit, Ctrl-C, and resize cleanup stay on the existing session runner. Filter text says `filters shown records, not the workspace` with matching, loaded, and workspace total. |
| **D6** | PASS. Default orientation JSON stays 64920 bytes with no `participantsCoverage`. Viewer methods stay `whoami`, `list_workspaces`, `get_workspace`, `get_workspace_context`, `get_activity`. New methods are read-only. Export audit and deploy dry-run passed. The published v1.22.1 installer was not overwritten. |
| **D7** | PASS for this fixture. Plans and sizes are the table above. The dashboard does not scan workspace activity or the full participant directory on launch. |

## 3. Independent review

A separate read-only review of `02eed76` checked both the sync and async services, the history cursor and index, the omit path, dashboard generation, the candidate frames, and the Viewer allowlist. It reported no must-fix defect: no D1 leak, no false complete-history label, no false owner, no live-presence claim, and no unbounded read. It did not re-run the suite. The catalog-test failure and the rerun in §2 happened after that review and do not change the product code it read.

## 4. Deviations and limits

- At 80×24, history for `dec_nav001_review` keeps the true heading (`returned 3 of 3`, complete for recorded contributions) and `con_nav001_0283`. The other two rows are rank 1 and drop out of the 24-line fit. The 120×36 frame shows all three ids. There is no separate "rows omitted for space" line.
- A later-page task row is the full `list_tasks` record, so `enter` does not issue a second `get_task`. The work frame's source line says `list_tasks  task_nav001_f051`. The capture keys were tab, `n`, quit. They did not press `enter`.
- The outside-roster sentence is on the selected agent, not on every list row. The people frames leave `agt_nav001_01` selected. The Zed case is in `tests/unit/nav-002-dashboard.test.ts`.
- Malformed `objectType` is rejected at HTTP and MCP before authorization. The error does not include workspace data.

## 5. Human outcome

**NOT OBSERVED.** No non-builder pair ran the five cold tasks. Scripted frames are not that comparison.

## 6. October 18 narrow-history follow-up (not the scored candidate)

The §4 80×24 limitation exposed a usability gap: the API returned all three
contributions on one complete page, but two were cut from the frame and `n/b`
had no further API page to request. The result above remains the record for
`8552976`; this follow-up does not retroactively change that commit or its
independent review.

The follow-up repair focuses the open history panel. `j/k` moves among
contributions **within** the loaded page; `n/b` continues to move between API
pages; `h` or `esc` closes history. The panel shows one selected contribution,
its payload summary, and `event N of M on this loaded page` while retaining the
authorized `returned 3 of 3` heading and selected record ID. Three real 80×24
PTY frames in `docs/evidence/nav-002/followup-history/` show
`con_nav001_0283`, `con_nav001_0279`, and `con_nav001_0276` reachable in order.
The original §4 frame remains in place as the pre-repair evidence.

Local checks on this follow-up revision: focused NAV-001/NAV-002
dashboard tests **31 passed** (including the new 80×24 traversal assertion);
typecheck passed; full suite **99 files / 1234 passed / 1 skipped**; build
passed. The full suite required the normal Node 22 environment outside the
filesystem sandbox after an in-sandbox run made no progress; no remote action
was taken. The read APIs, authorization, default JSON, package version, and
Viewer allowlist were not changed by this repair. No new independent review,
public-export audit, release decision, tag, publication, or deployment is
claimed for this working-tree revision. The two-person comparison remains
**NOT OBSERVED**.
