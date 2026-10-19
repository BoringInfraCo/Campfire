# Campfire — Sprint NAV-003 Result: Viewer Alignment and Human Use

**Date:** October 19, 2026

**Status:** **CONDITIONAL GO — engineering candidate.** D1–D8 pass on the repaired candidate. Contract §8 human comprehension is **NOT OBSERVED**. Package version stays `1.23.0` in this result. This result does not bump a version, tag, publish a snapshot, pin an installer, or deploy. A `v1.24.0` bump, tag, public snapshot, installer pin, or deployment needs a separate recorded founder decision — recorded October 19, 2026 in `docs/RELEASE_V1_24_DECISION.md`; v1.24.0 was published and deployed that day. Publication does not change this verdict or the NOT OBSERVED human outcome. This record does not claim human comprehension, live presence, Gate B/C/E/F, or a rescore of NAV-001, NAV-002, UIX-001, ATT-001, SWH-001, WCO-001, ARH-001, or VIS-001 condition 4.

**Contract:** `docs/Campfire-v1.24-NAV-003-Viewer-Alignment-and-Human-Use.md`
**Evidence:** `docs/evidence/nav-003/step-0/` (answer key) and `docs/evidence/nav-003/candidate/` (this candidate)
**Independent review:** `docs/evidence/nav-003/independent-review.md` (read-only review of `6ed7a6b`; facts agreed; must-fix repaired below)
**Baseline:** published `v1.23.0`. Package stays `1.23.0` in this result; the separate v1.24.0 release decision is `docs/RELEASE_V1_24_DECISION.md`.
**Fixture:** `fixtures/navigator/nav-001/` — `ws_nav001_lab`: 20 humans, 37 registered agents, 64 tasks, 57 participants. Clock `2026-10-17T14:00:00.000Z`. Actor `hum_nav001_ana` unless a denial says otherwise.

## 0. Verdict and what it does not claim

Contract §8: **CONDITIONAL GO — engineering candidate** applies when D1–D8 pass and the eligible human comparison is unavailable for a recorded reason. That is this case.

- **Recorded reason:** this session had one operator and used coding agents. §8 requires two non-builder humans, order counterbalanced, on the released v1.23 Viewer and this candidate. No eligible pair was available. §8 forbids substituting the builder, a coding agent, a screenshot, or a scripted browser run. The five cold tasks are **NOT OBSERVED**. No times, clicks, or participant answers are invented here.
- Frames under `docs/evidence/nav-003/candidate/` are **FIXTURE / AUTOMATED BROWSER / BUILDER REHEARSAL**. They are engineering evidence.
- The candidate commit is the commit that adds this result. It contains the D4 repair on top of `6ed7a6b7eb9e00696fc3153f41c91d0c832ccf20`. Earlier commits are listed in §1.

## 1. What is in the tree

| Commit | What |
| --- | --- |
| `2f042afc281de6ba88ceca6bb879cb3daf101a86` | Step 0 freeze: v1.23.0 Viewer baseline, answer key, read matrix |
| `975f790f80eaa22ada8fb10bc33fc8935ebea7fb` | Twelve-method Viewer allowlist; normal refresh uses `participants: "omit"` and does not call `get_workspace` |
| `6ed7a6b7eb9e00696fc3153f41c91d0c832ccf20` | Viewer Work, People, source, and history navigation |
| this result commit | D4/coverage repair, regression tests, candidate evidence, this result |

`6ed7a6b` is the commit the independent review read. The repair is in this result commit, not in `6ed7a6b`.

## 2. Failed check, then repair

**D4 failed on `6ed7a6b` before any repair.** The independent review (must-fix) found that `sourceRecordHtml` printed `needs review — acceptance is unchanged` for every decision with `needsReview` or a non-empty `needsReviewFindingIds` list. `attachCitations` sets that flag on a proposed, rejected, or retired decision that cites non-current evidence, not only on an accepted one. The decisions list already limited the sentence to `status === "accepted"`. The new source panel did not. That sentence states an acceptance the record does not have. It is a decision-safety error. The fixture frame for `dec_nav001_review` is an accepted decision, so that capture still shows the sentence correctly and did not expose the bug.

**Repair:** the source panel prints `needs review — acceptance is unchanged` only when the status is `accepted`. A proposed decision keeps `proposed — not accepted, not an instruction`, the non-current citation ids, and any attention reason, and does not claim an unchanged acceptance. Regression: `tests/integration/nav-003-viewer.test.ts` (“reserves the unchanged-acceptance sentence for an accepted decision”).

**Same commit, review should-fix 2:** after a successful Work or People page, a later failure kept `readAt` and the coverage line still said `another API page exists` or `no further API page`, plus `stale`. History already passed the error into `pageContinuation`. Work and People now do the same, so a failed refresh says `not complete` while the last good counts stay on screen. The review said this was not a truncated page labeled complete. Regression: the same test file (“says a failed Work or People refresh is not complete”).

The review’s should-fix 3 is **not repaired**. `get_record_history` still returns the contribution row, and the page summarizes payload JSON to 160 characters after dropping keys named `transcript`, `privatetranscript`, `prompt`, or `messages`. A private string under another key can still appear in that summary. Display is escaped. This is not a transcript boundary.

The pre-repair suite on `6ed7a6b` passed and did not catch the D4 sentence: **100 files, 1246 passed, 1 skipped**. The skip is the opt-in Playwright test in `tests/unit/uix-001-dashboard-pty.test.ts`.

## 3. Deterministic checks after the repair

Run on macOS, Node `v22.23.2`, Vitest 5.0.0, after the repair.

| Command | Result |
| --- | --- |
| `npm run typecheck` | pass |
| `npm test` | **100 files, 1248 passed, 1 skipped** (1249) |
| `npm run build` | pass. `src/viewer/static/` and `public/` are byte-identical for the four Viewer assets |
| `npm run pack:tarball` | pass. Gitignored `release/campfire-darwin-arm64.tar.gz`, sha256 `4d2b26b33f43980717c8377a85e13740af30414150e97c54186ec78648e5b053`. Package `1.23.0`. `public/campfire/v1.23.0/install.sh` was not rewritten. The immutable installer guard was not weakened |
| `npm run export:public -- --ref d5020586454e09051a3c262354d45e8c331a1838` | pass. v1.23.0, 340 files, no forbidden-path or secret finding. Temp directory removed. This sentence was inserted by amend; the amended HEAD was exported again with the same 340-file clean result. This result file is outside the public snapshot |
| `npm run deploy:dry-run` | pass. Wrangler 4.149.0 stopped at `--dry-run: exiting now`. No remote deploy |

The one skip is the existing opt-in Playwright capture in `tests/unit/uix-001-dashboard-pty.test.ts` (5 tests, 1 skipped). Playwright is not a project dependency. The candidate browser capture used a temporary Playwright 1.64.1 install outside `package.json`.

Static sha256 after build:

| File | Bytes | sha256 |
| --- | ---: | --- |
| `index.html` | 8570 | `3683b33d1e2323e6c657658a0f1cc4bd99ffdaa07174e198489e2e6221e32183` |
| `app.css` | 18028 | `f6d00d217ce1e86f983b4cffc9ebb5f229549751643e1de3bb2564c6649f5b87` |
| `app.js` | 134265 | `d319964413432cb4c055e3d93f11ab8874a3287f397bfa83a72be3ceb2bbecb1` |
| `campfire-mark.svg` | 6411 | `a845ec975a6f58a5e9583d157445849a6900fd53cda0965cf5e21c94af44f311` |

An earlier tarball of `6ed7a6b` (`e9c311e8404413729c68daab0847b9ed6fdd7b224593a97bb323dc9c69a7a3ad`) was replaced after `app.js` changed. The sha256 above is the repaired tree.

### Measurements (one sample, Ana, served Viewer, frozen clock)

Label: **FIXTURE / AUTOMATED BROWSER**. One sample on this fixture. Not a claim about larger teams. Not a human observation. Source: `docs/evidence/nav-003/candidate/viewer/measurements.json`. Compact bytes are `JSON.stringify` of the result. Elapsed time is server-side.

| Read | Compact bytes | Shape | Server elapsed |
| --- | ---: | --- | ---: |
| Initial load | 70725 | `whoami` 1, `list_workspaces` 1, `get_workspace_context` 1, `get_activity` 1. No `get_workspace`, roster, or history | — |
| One poll | 70667 | `list_workspaces` 1, `get_workspace_context` 1, `get_activity` 1. Same absences | — |
| `get_workspace_context` `participants: "omit"` | 55806 | participants length 0; coverage `{returned: 0, total: 57, truncated: true, omitted: true}`; goal `goal_nav001_focus` | 3.359 ms |
| `list_tasks` page 1, limit 20 | 6496 | returned 20 of 64, truncated, next cursor present. `task_nav001_f051` is absent | 0.841 ms |
| `list_tasks` page 2, limit 20 | 6516 | returned 20 of 64, first id `task_nav001_f051` | 0.887 ms |
| `list_workspace_participants` page 1 | 4518 | returned 20 of 57. `agt_nav001_03` is the only row in that page with `humanOwnerIsParticipant` false | 0.908 ms |
| owner filter `humanOwnerId=hum_nav001_ana` | 563 | returned 2 of 2: `agt_nav001_01`, `agt_nav001_21`. Both owners participate | 0.689 ms |
| `get_finding` `find_nav001_superseded` | 593 | `currentness` `superseded` | 3.682 ms |
| `get_task` `task_nav001_f027` | 311 | status `open`, title `Display-pressure filler task 27` | 0.284 ms |
| `get_record_history` `dec_nav001_review` limit 10 | 1164 | returned 3 of 3, no next cursor: `con_nav001_0283`, `con_nav001_0279`, `con_nav001_0276` | 1.386 ms |
| same history, limit 1, served call | — | returned 1 of 3, first id `con_nav001_0283`, cursor `tip` **217**. The browser did not request limit 1 | — |

`detailCallsBeforeChangesSection: 2` in that file counts `get_finding` and `get_record_history`. It is not two detail gets. Selecting `task_nav001_f051` does not call `get_task`, because the list row already has `createdAt` and `createdBy`. The detail get for the review decision is `get_finding`. The `get_task` in the trace is a later Recent-changes click on `task_nav001_f027`.

| Check | Result |
| --- | --- |
| **D1** | PASS after the existing Step 1 tests, plus the served denial capture. `tests/integration/nav-003-viewer.test.ts` keeps the twelve-method allowlist, rejects writes and unknown methods, and denies Zed and wrong-workspace reads with no lab payload. Served Viewer for `hum_nav001_zed` on `ws_nav001_lab`: ten reads, each HTTP 403, 123 bytes, `leaked` empty (`viewer/zed-denial.json`). The Zed page text does not contain the lab goal. The unrelated workspace body was not recorded. Browser assets in the capture trace carry no token. Loopback Host checks stay in the server tests. An authorized agent read of the same history returns the same three contribution ids. |
| **D2** | PASS on the served frames. My work and Team work open on attention with `57 workspace participants`, `Participant roster is not in this read.`, and `goal_nav001_focus`. Team attention shows `dec_nav001_review` with the plain-language non-current-evidence reason. Work page 2 shows `returned 20 of 64 · page 2 · another API page exists` and `task_nav001_f051` (`Display-pressure filler task 51`), not 64 tasks at once. |
| **D3** | PASS for the captured pages. People page 1 is 20 of 57 and does not say `20 people` / `37 registered agents`. `agt_nav001_03` names `hum_nav001_zed` and `owner is outside the roster` and does not insert Zed. Ana’s owner page is `returned 2 of 2` with `agt_nav001_01` and `agt_nav001_21`, and says registration is not presence. The browser capture did not walk every later People page; the first page’s next cursor and total 57 are the paging evidence, with the owner page complete. |
| **D4** | PASS on the repaired source. It **failed on `6ed7a6b`** for non-accepted `needsReview` decisions (§2). After the repair, an accepted `dec_nav001_review` frame still says `needs review — acceptance is unchanged`, cites `find_nav001_superseded`, and after `get_finding` says `currentness superseded` and names successor `find_nav001_current`. The runbook source says the HTTPS reference is stored, not fetched, and `Open example.com (external, unverified)`. The regression test covers a proposed decision that needs review. |
| **D5** | PASS for this record’s page. History shows `con_nav001_0283`, `con_nav001_0279`, `con_nav001_0276` newest first and `returned 3 of 3` (the narrow heading’s CSS uppercases it to `RETURNED 3 OF 3. NO FURTHER API PAGE.`). Tip 217 is the `tip` inside the limit-1 cursor, not a heading and not a field of the default limit-10 page, which has no `nextCursor`. The 390 frame contains all three ids. A late history response for a record the actor already left is dropped by the existing navigation test. The fixture page is complete, so the frames do not show a later history API page, a zero-row record, or a write after tip 217. |
| **D6** | PASS on the captured viewports. Every saved shot has `scrollWidth <= clientWidth` and `clipped: []` at 1440×900 or 390×844 (`viewer/capture-summary.json`). The narrow text contains `task_nav001_f051`, `hum_nav001_zed`, `agt_nav001_01`, `agt_nav001_21`, and the three contribution ids in full. At 390 the list pane is hidden on the source and history layers, so the Work coverage sentence is in the 1440 frame. Hostile titles stay inert in the navigation test. The keyboard path is scripted: Tab through the real controls, Space opens source on `task_nav001_blocked_noassignee`, Tab reaches Recorded changes, Enter opens history, Escape returns focus to that same row. One Escape closes history and leaves the layer on source. A further Tab lands on `task_nav001_f013`. Tab, Enter, and Space are native. The decision source frame is 1440 only; the 390 history frame is the history layer. |
| **D7** | PASS for the commands in the table. Package stays `1.23.0`. The five previous Viewer reads remain on the allowlist with the seven additions. The versioned `v1.23.0` installer copy was not rewritten. Default context size on this fixture stays the Step 0 value 64920; the omit read is the 55806-byte row above. |
| **D8** | PASS for the measured limits in the table. Initial load is 4 calls / 70725 compact bytes. One poll is 3 calls / 70667 compact bytes. Neither includes `get_workspace`, a participant roster, `list_tasks`, or `get_record_history`. Viewer, terminal rehearsal, and the authorized JSON agree on `task_nav001_f051` at returned 20 of 64, Ana’s two agents at returned 2 of 2, and the three contribution ids at returned 3 of 3. |

## 4. Independent review

`docs/evidence/nav-003/independent-review.md` was in the tree before this result commit. It reviewed `6ed7a6b` only. It is engineering evidence, not a human observation, and it did not re-run D1–D8.

Agreed facts: no D1 leak in the reviewed diff; no false complete page from `truncated` or `total === 0`; no false owner or live-presence claim; no unsafe external-open control; normal refresh does not call `get_workspace`, the roster, tasks, or history; the allowlist is the previous five plus the seven named reads; late responses are dropped on generation and workspace change; hostile text goes through the existing escape and control stripping.

The must-fix decision-safety finding is the D4 failure in §2, repaired in this commit. Should-fix 2 (failed Work/People refresh coverage) is repaired in the same commit. Should-fix 3 (payload key filter) remains. The review’s note that `total === 0` does not also require `truncated !== true` stays a defensive gap on an empty page the current service does not mark truncated.

## 5. Capture labels and harness notes

| Kind | Path |
| --- | --- |
| Source fixture / answer key | `docs/evidence/nav-003/step-0/` |
| Automated browser | `docs/evidence/nav-003/candidate/viewer/` — png, innerText, `request-trace.json` (24 calls), `measurements.json`, `keyboard-path.json`, `zed-denial.json`, `capture-summary.json` |
| Builder rehearsal (scripted PTY) | `docs/evidence/nav-003/candidate/terminal/{opening,work-f051,people-ana,history-review,history-review-j,history-review-jj}/` |
| Check log | `docs/evidence/nav-003/candidate/checks.json` (`failures: []`) |

Terminal keys, via `fixtures/navigator/nav-001/capture-dashboard.ts`, key delay 0.2s. `wait:` pauses until the pty shows that text. These are scripted, not observed human keys.

- Opening: no keys, 80×24 and 120×36.
- Later work page: `tab`, `n`, until `task_nav001_f051`. Both sizes. Heading `returned 20 of 64` page 2.
- Ana’s agents: `tab` four times, `wait:PEOPLE`, `n`, `wait:agt_nav001_21`, `j` seventeen times, `enter`, until `total 2`. 120×36 shows `returned 2 of 2` for `hum_nav001_ana`.
- History: `p`, `wait:Needs Attention`, `j` six times, `wait:dec_nav001_review`, `h`, `wait:con_nav001_0283`. Both sizes select `con_nav001_0283` under `returned 3 of 3`. One more `j` selects `con_nav001_0279`. Two `j` presses select `con_nav001_0276`.

Harness notes that were not product failures:

- An early history wait used `innerText`. `.panel-title` is `text-transform: uppercase`, so the visible heading is `RETURNED 3 OF 3` while `textContent` stays `returned 3 of 3`. The assertion was corrected. The served coverage was already right.
- The first decision screenshot was taken before `get_finding` returned and said currentness was not in the read. The committed frame waits until `currentness superseded`.
- Terminal keys sent before a section fetch returned were dropped. The successful run waits for section text before `n`, `j`, and `h`.
- `Last successful read` timestamps in the frames are the client clock (`2026-10-19T…Z`). The service clock stays `2026-10-17T14:00:00.000Z`.

## 6. Human outcome

**NOT OBSERVED.** No two eligible non-builder humans ran the five cold tasks. Scripted captures are not that comparison.

## 7. What D1–D8 did not demonstrate

- Any human time, click path, or answer on the five §8 tasks.
- A browser walk of all 57 participants or all 64 tasks. The captured pages are 20 rows, with totals and cursors.
- Tip 217 as on-screen text. It is inside the limit-1 history cursor from a served call the browser did not make.
- A `get_task` for `task_nav001_f051`. That row is already complete in `list_tasks`.
- A second Escape closing the source layer. The keyboard capture stops after one Escape, which closes history and restores the originating row.
- A 390 screenshot of the decision source itself. The 390 history frame shows the three contribution ids. The decision source text is the 1440 frame.
- A rendered denial page for the lab. Zed’s evidence is the served 403 responses and the absence of the lab goal in the page text.
- The remaining payload-key limit in §4, and an empty history page that is both `total === 0` and `truncated: true`. Both are closed by the follow-up in §8. This sentence records what D1–D8 on `6ed8b00` did not demonstrate. It is not a later pass of those checks.

## 8. Follow-up: Viewer history payload

Previous candidate: `6ed8b00c138fc57dbe53cd92a1b87992d44dfacb`.

The commit that adds this follow-up closes the payload-key limit and the empty-and-truncated history sentence left open in §2, §4, and §7. Viewer `get_record_history` no longer returns the contribution `payload`. Each item may carry `payloadSummary`: allowlisted short tokens (`status`, `currentness`, `findingId`, `artifactId`, `decisionId`, `taskId`, `objectId`, `objectType`, `fromStatus`, `toStatus`) joined as `key value` with ` · `, at most 160 characters, or `recorded payload omitted` when a payload existed and nothing allowlisted remained. The summary is omitted when there is no payload. The browser renders `payloadSummary` only and does not keep a payload object. HTTP `/v1/call`, MCP, and the CLI still return `payload`. The terminal dashboard is unchanged. An empty history says no contributions were recorded only when `total` is 0, there is no error, and `truncated` is not true. When `truncated` is true, the heading says the read is not complete.

Verdict is unchanged: **CONDITIONAL GO — engineering candidate**. Human outcome remains **NOT OBSERVED**. This follow-up does not rewrite the D4 failure on `6ed7a6b` into a pass. It does not itself bump a version, tag, publish, or deploy. `npm run typecheck` passed. `tests/integration/nav-003-viewer.test.ts`, `tests/worker/handler.test.ts`, and `tests/unit/nav-002-reads.test.ts` passed (33 tests). The separate founder release decision (`docs/RELEASE_V1_24_DECISION.md`) later published and deployed v1.24.0; it does not change this verdict or the NOT OBSERVED human outcome.
