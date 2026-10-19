# NAV-003 Step 0 — v1.23.0 Viewer baseline, answer key, and read matrix

**Date:** 2026-10-19  
**Status:** Freeze before product code. This is not `docs/SPRINT_NAV_003_RESULT.md` and it is not a verdict.  
**Label: FIXTURE EVIDENCE — engineering evidence only.** A scripted capture is not a human observation. Contract §8 is **NOT OBSERVED**. No participant answers were invented.

Contract: `docs/Campfire-v1.24-NAV-003-Viewer-Alignment-and-Human-Use.md` §§0, 1, 5 (Step 0), 6, and 9. Reads below are the v1.23.0 worktree's `dispatchCampfireMethod` with the clock frozen at `2026-10-17T14:00:00.000Z`. Where this packet and an older note disagree, the live read wins. The named NAV-002 answer-sheet ids agreed with that read.

## 1. Released baseline

| Fact | Value |
| --- | --- |
| Product commit | `b97b47b08d09fd14af9e0aa09e242a074ffea989` |
| Annotated tag object | `v1.23.0` → `7a466819cdc809dab65524f19330c019459d6703` (resolves to that commit) |
| Package on that commit | `1.23.0` (`npm ci` prepare printed `campfire@1.23.0`) |
| What that commit's Viewer allowlist is | `whoami`, `list_workspaces`, `get_workspace`, `get_workspace_context`, `get_activity` (`VIEWER_READ_METHODS` on this commit) |
| Publication record | `docs/RELEASE_V1_23_DECISION.md` (public snapshot `8c146213f7f8dc407f7d571fb64bdbcb7e5e19af`, pin `8c2a5468c549ed8f730ee5cf920577f056ea991a`, tap `483a8fd5c99dfb5107e55530b2aa1a5017c83b89`, Worker `da752833-53c0-4011-91c7-f9e49e5c45e1`) |
| Checkout used for the capture | Detached worktree of `b97b47b`, `npm ci --no-audit --no-fund`, then removed. `src/`, `fixtures/navigator/`, and `package.json` matched that commit. Later docs commits do not redefine this baseline. |

The tag seed is already the NAV-002 extended fixture. `fixtures/navigator/nav-001/seed.ts` on this commit asserts `agt_nav001_03` is owned by `hum_nav001_zed`, and the live `list_workspace_participants` filter returned that owner. Do not re-apply the v1.22.1 owner edit. The v1.22.1 packet's "released seed still has `hum_nav001_h03`" split does not apply here.

`CAMPFIRE_TELEMETRY=0`. Terminal config and data dirs were an isolated temp directory created by `capture-dashboard.ts`. The Viewer was `startCampfireViewer({ port: 0, host: "127.0.0.1" })` with the actor bound in `options.call`. No token was passed to the browser. Playwright was installed under `/tmp/nav003-playwright` and loaded with `NODE_PATH`. It is not a Campfire dependency and was not added to `package.json`.

### Reproduce

```sh
git worktree add --detach "$WT" b97b47b08d09fd14af9e0aa09e242a074ffea989
cd "$WT" && npm ci --no-audit --no-fund
cd "$WT" && CAMPFIRE_TELEMETRY=0 ./node_modules/.bin/tsx fixtures/navigator/nav-001/seed.ts \
  --out fixtures/navigator/nav-001/.tmp/released --force
# opening frames, from the worktree so the dashboard binary is v1.23.0:
cd "$WT" && CAMPFIRE_TELEMETRY=0 ./node_modules/.bin/tsx fixtures/navigator/nav-001/capture-dashboard.ts \
  --root "$(realpath "$WT")" \
  --db "$(realpath "$WT")/fixtures/navigator/nav-001/.tmp/released/campfire.db" \
  --workspace ws_nav001_lab --actor hum_nav001_ana \
  --out docs/evidence/nav-003/step-0/terminal \
  --label baseline-v1.23.0-ana-lab
git worktree remove --force "$WT"
```

Authorized JSON was read through that worktree's `dispatchCampfireMethod` and `createCampfireService({ clock: () => "2026-10-17T14:00:00.000Z" })`. The Viewer was started from the same worktree. Do not commit `tokens.json` or the database.

The terminal `refreshed` line is wall-clock, so a re-capture changes that line and the frame hashes.

## 2. Terminal opening screen (v1.23.0 already has Work, People, and history)

Actor `hum_nav001_ana`, workspace `ws_nav001_lab`, real `campfire dashboard`, default `q` only.

| File | Window | sha256 | Widest line |
| --- | --- | --- | --- |
| `terminal/baseline-v1.23.0-ana-lab-80x24.txt` | 80×24 | `9a18570c7130494947a0fed38db92690c824abd836b8bb29a97d16b0f842ca1d` | 80 |
| `terminal/baseline-v1.23.0-ana-lab-120x36.txt` | 120×36 | `b713cc097cef88d130345ca6d8a802106d644c50cf0cf762dfda34896e7fdcfe` | 119 |

`terminal/capture-summary.json`: exit 0, alternate screen entered and left, cursor hidden and shown, `termiosRestored: true`, zero redactions. Root and database paths are `[path]`.

Both opening frames are My work / Needs You only. They show `dec_nav001_proposed`, `task_nav001_assigned_blocked_ana`, and `task_nav001_assigned_open_ana`. Source is `get_workspace_context` for `dec_nav001_proposed`. Coverage is `20/64 truncated tasks · 5/5 decisions` and `57 workspace participants` with the line `human/agent split is not in this read`. The 120-column footer is `p perspective   tab section   j/k move   n/b page   h history   / filter   enter   r refresh   ? help   esc   q quit`. The 80-column footer drops the `p perspective` label (`tab  j/k move  n/b page  h history  / filter  enter  r  ?  esc  q quit`). `p` still switches perspective at 80 columns; the history path below was captured at 80×24.

The opening screen does not show a later Work page, a People page, or record history. Those paths exist on this commit. Section order in `src/cli/dashboard.ts` (`SECTIONS`) is attention, work, decisions, references, people, changes. `tab` advances that list. `n` pages Work, People, or an open history panel. `h` toggles history for the selected task, decision, finding, or artifact. `enter` on a human participant calls `openHumanAgents`. A scripted PTY on this worktree (not a human, frames not committed) confirmed:

| Target | Keys from the opening screen | Observed |
| --- | --- | --- |
| Later Work page | `tab`, then `n` | `CURRENT WORK`, `returned 20 of 64`, `page 2`, first row `task_nav001_f051` |
| Ana's agents | `tab` `tab` `tab` `tab`, `n`, `j` seventeen times, `enter` | People page 2 selects `hum_nav001_ana`, then `WORKSPACE-PARTICIPATING AGENTS hum_nav001_ana total 2 returned 2 of 2` with `agt_nav001_01` and `agt_nav001_21` |
| `dec_nav001_review` history | `p`, `j` six times, `h` | Team attention lands on `dec_nav001_review`; history says `returned 3 of 3` and the first event is `con_nav001_0283` |

Seventeen `j` presses is the distance from `agt_nav001_21` (first row of People page 2) to `hum_nav001_ana`. Six `j` presses is the distance from the first Team-work cue to `dec_nav001_review` (the seventh needs-attention cue). Those counts are fixture order, not a stable shortcut. `src/cli/dashboard.ts` on `b97b47b` is the source of the key names; the PTY only checked that those names reach the ids.

Selecting `agt_nav001_03` (People page 1, third row) is the source path that prints `owner is outside the roster` when `humanOwnerIsParticipant` is false. That label was not a separate committed frame. The API read below is the frozen fact.

## 3. Viewer gap

Viewport-only screenshots (`fullPage: false`, device scale 1). Body text is `document.body.innerText`. Horizontal overflow: `scrollWidth === clientWidth` at both sizes (1440 and 390).

| File | sha256 (png) | Body-text sha256 |
| --- | --- | --- |
| `viewer/ana-lab-mine-1440x900.png` | `26194f46b9e5d7453fab419cf60e28e8d5f27ac19efcd0790e15ceed6c55ec92` | `d4d8b900faeb1b9d057b9251a4fd30d779fdd29f9a3a792385222dbf70c34ff5` |
| `viewer/ana-lab-mine-390x844.png` | `e9849492ded99849596c4cbc7111dbfa77cdedea4d372453f3b8e204008b7d4a` | same text as 1440×900 |
| `viewer/ana-lab-keyboard-1440x900.png` | `e98ef4db8ff7219b8eedf3c49f47d624d8716fe1707915a61337e6791ba2039a` | `241865edb18473079082c264c500399f2560b1127f192295de992eeaf2e0a52c` |

The two My work body texts are byte-identical. The keyboard frame is Team work after Enter. None of the three texts contains `task_nav001_f051`, `con_nav001_0283`, `get_record_history`, or `list_tasks`.

What the released page shows instead:

- My work / Team work, the goal, Needs You, Needs Attention, current work, shared sources, Since You Were Here, and the workstream.
- The mast counts `20 people · 37 registered agents` from the full orientation `participants` array and then lists every participant (Ana through Agent 37). That is not a People page and not `returned 20 of 57`.
- No Work pager, no owner-filtered agent page, and no selected-record history panel (`[data-history], #history, .history` was absent).

### Keyboard path actually observed

`viewer/keyboard-path.json`. Storage was cleared. Focus started on `body`. Tab order:

1. `#density` button
2. `#workspace` select
3. `#generated-view-link` (`Workspace view ↗`, an anchor, not activated)
4. `#perspective-mine`
5. `#perspective-team`

Enter on `#perspective-team` set `data-perspective` to `team` and `aria-pressed` to true. Shift-Tab moved focus back to `#perspective-mine` and did not restore My work. Escape left focus and Team work unchanged. There is no history layer for Escape to close.

`src/viewer/static/app.js` on this commit handles `j` / `k` / arrows, Enter (except when the target is a `button`, `select`, `input`, or `textarea`), `p`, `[` / `]`, and digits. It does not handle Tab, Shift-Tab, or Escape. Tab is native focus. Stream rows are `div.item` without `tabindex`, so this trace never focused a task, decision, or contribution. This path cannot open a later Work page, Ana's agents, or `dec_nav001_review` history.

## 4. Served request trace

`viewer/request-trace.json`. One 1440×900 load, actor bound in the Viewer process. Phase `initial` is boot through 600ms after the goal text was visible. Phase `poll` is the next 2600ms (`POLL_MS` is 2000). No tokens, cursors, or bodies.

| Phase | Order | Method | Compact bytes | Notes |
| --- | --- | --- | --- | --- |
| initial | 1 | `whoami` | 58 | |
| initial | 2 | `list_workspaces` | 213 | |
| initial | 3 | `get_workspace_context` | 64920 | `workspaceId` only. No `since`. No `participants: "omit"`. |
| initial | 4 | `get_activity` | 14648 | `limit` 50 (the page's `LIMIT`) |
| initial | 5 | `get_workspace` | 115288 | full inspector |
| poll | 6 | `list_workspaces` | 213 | |
| poll | 7 | `get_workspace_context` | 64920 | again no `since` |
| poll | 8 | `get_activity` | 14648 | `limit` 50 |
| poll | 9 | `get_workspace` | 115288 | full inspector again |

**`get_workspace` is on the normal Viewer refresh.** It is called once on the initial load and once on the following poll. The poll does not send `since`: after the first context fetch the page sets `sincePending` false and later refreshes keep the already captured since-view without putting `since` back on the request. That matches `refresh()` in `app.js`. It is not a second full catch-up.

Initial method count: 5. Poll method count: 4. Initial compact total: 195127 bytes. Poll compact total: 195069 bytes. `get_workspace` is 115288 of those bytes on each pass. The trace contains no `list_tasks`, `list_workspace_participants`, `get_task`, `get_decision`, `get_finding`, `get_artifact`, or `get_record_history`.

## 5. Twelve-method allowlist

Released gate, five methods, unchanged on this commit:

```text
whoami
list_workspaces
get_workspace
get_workspace_context
get_activity
```

NAV-003's proposed Viewer allowlist is those five plus exactly these seven existing reads. No other method. No write.

```text
list_tasks
list_workspace_participants
get_task
get_decision
get_finding
get_artifact
get_record_history
```

`get_workspace` stays allowlisted and must not be requested on initial load or the periodic refresh. `get_workspace_context` with `participants: "omit"` is the normal orientation read. The seven additions are on demand only (contract §3).

## 6. Actor and denial matrix

Clock frozen. Messages are the domain errors. `details` is null on every `ParticipantRequired` below. None of those messages contains a count, title, task name, rationale, URI, or payload. Files: `json/denials.json`.

| Case | Result |
| --- | --- |
| `hum_nav001_ana` on `ws_nav001_lab` | The ten workspace reads in the table below succeed. `whoami` returns Ana. `list_workspaces` returns only `ws_nav001_lab`. |
| `agt_nav001_01` on `ws_nav001_lab` | `get_record_history` for `dec_nav001_review` succeeds. Ids are the same three, newest first. Agent membership is not Ana's membership. |
| `hum_nav001_zed` on `ws_nav001_lab` for `get_workspace`, `get_workspace_context`, `get_activity`, `list_tasks`, `list_workspace_participants`, `get_task`, `get_decision`, `get_finding`, `get_artifact`, `get_record_history` | `ParticipantRequired`. Message: `Actor hum_nav001_zed is not a participant of workspace ws_nav001_lab`. |
| Ana calling those same ten methods on `ws_nav001_unrelated` | `ParticipantRequired`. Message names Ana and `ws_nav001_unrelated` only. |
| Ana `get_workspace_context` on `ws_does_not_exist` | `WorkspaceNotFound`. Message: `Workspace not found: ws_does_not_exist`. Details: `{ workspaceId: "ws_does_not_exist" }`. |
| Ana `get_finding` of `find_nav001_unrelated` in the lab | `FindingNotFound`. Message names that id only. The unrelated finding body is not in the error or in `json/`. |
| Zed `whoami` | Succeeds. It is not a workspace read. |
| Zed `list_workspaces` | Succeeds with only `ws_nav001_unrelated` (`nav-001 unrelated`). The lab id is absent. |

`whoami` and `list_workspaces` do not take the lab id, so they are not in the denial rows. A denied workspace read does not fall through to a cursor or not-found error.

## 7. Answer key

Actor `hum_nav001_ana` unless noted. Workspace `ws_nav001_lab`. Full objects: `json/answer-key.json`. Census from paging every participant and from `list_tasks` `total`:

| Count | Live value |
| --- | --- |
| Humans | 20 (`hum_nav001_ana`, `hum_nav001_ben`, `hum_nav001_h03` … `hum_nav001_h20`) |
| Registered agents | 37 (`agt_nav001_01` … `agt_nav001_37`) |
| Tasks | 64 |
| Workspace participants | 57 |

### `list_tasks` limit 20

`total` 64 on every page.

| Page | returned | truncated | nextCursor | First id | Last id |
| --- | --- | --- | --- | --- | --- |
| 1 | 20 | true | present | `task_nav001_blocked_agent` | `task_nav001_f053` |
| 2 | 20 | true | present | `task_nav001_f051` | `task_nav001_f029` |
| 3 | 20 | true | present | `task_nav001_f028` | `task_nav001_f005` |
| 4 | 4 | true | **absent** | `task_nav001_f004` | `task_nav001_f001` |

Page 1 ids, in order, match `docs/evidence/nav-002/STEP0.md`:

```text
task_nav001_blocked_agent
task_nav001_blocked_noassignee
task_nav001_assigned_blocked_ana
task_nav001_f052
task_nav001_f039
task_nav001_f026
task_nav001_f013
task_nav001_f058
task_nav001_f045
task_nav001_f032
task_nav001_f019
task_nav001_f006
task_nav001_hostile
task_nav001_open_noassignee
task_nav001_assigned_open_ana
task_nav001_f057
task_nav001_f056
task_nav001_f055
task_nav001_f054
task_nav001_f053
```

The task past page 1 is `task_nav001_f051` (index 0 of page 2). `get_task`: status `open`, title `Display-pressure filler task 51`, assignee `agt_nav001_33` (`agent`), `createdBy` `hum_nav001_ana`, `createdAt` and `updatedAt` `2026-10-17T12:04:09.000Z`.

Page 4 is the live extra fact. `truncated` is true because `toContextSlice` sets `truncated` to `items.length < total` (4 < 64), and `nextCursor` is omitted because the store reports no further row. The terminal already refuses the next page unless both `truncated` and `nextCursor` are set (`No next work page.`). Do not treat `truncated: true` alone as another task page. NAV-002's answer sheet stopped at page 2 and did not state this. Participant pages do not do it: page 3 is `returned` 17, `truncated` false.

### `list_workspace_participants` limit 20

`total` 57. Order `(actorType, actorId)`.

| Page | returned | truncated | Ids |
| --- | --- | --- | --- |
| 1 | 20 | true | `agt_nav001_01` … `agt_nav001_20` |
| 2 | 20 | true | `agt_nav001_21` … `agt_nav001_37`, then `hum_nav001_ana`, `hum_nav001_ben`, `hum_nav001_h03` |
| 3 | 17 | false | `hum_nav001_h04` … `hum_nav001_h20` |

Ana's filter `humanOwnerId=hum_nav001_ana`: `total` 2, `returned` 2, `truncated` false.

| Id | Name | Harness | joinedAt | humanOwnerIsParticipant |
| --- | --- | --- | --- | --- |
| `agt_nav001_01` | Agent 01 | codex | `2026-10-17T12:01:41.000Z` | true |
| `agt_nav001_21` | Agent 21 | codex | `2026-10-17T12:02:21.000Z` | true |

Both `role` `agent`. Owner `hum_nav001_ana`.

Outside the roster: `humanOwnerId=hum_nav001_zed` returns one row, `agt_nav001_03`, name `Agent 03`, harness `codex`, `joinedAt` `2026-10-17T12:01:45.000Z`, `humanOwnerIsParticipant` **false**, `total` 1. Zed is not a lab participant.

### `participantsCoverage`

| Call | participants length | `participantsCoverage` |
| --- | --- | --- |
| `get_workspace_context` default | 57 | key absent |
| `get_workspace_context` with `participants: "omit"` | 0 | `{ returned: 0, total: 57, truncated: true, omitted: true }` |

An empty `participants` array with that coverage object is not an empty roster. The released Viewer mast line `20 people · 37 registered agents` is the default array, not page 1 and not this coverage object.

### `dec_nav001_review` history

Default `get_record_history` (limit 10): `total` 3, `returned` 3, `truncated` false, no `nextCursor`. The response has no top-level `tip`. Tip **217** is the `tip` field inside the cursor returned by `limit: 1` (`beforePosition` 135, `order` `append-position-desc`, `kind` `record-history`). Newest first:

| Order | Id | Action | Append position | Payload |
| --- | --- | --- | --- | --- |
| 1 | `con_nav001_0283` | `update` | 135 | cites `find_nav001_superseded`, note `original observation` |
| 2 | `con_nav001_0279` | `update` | 134 | `{ status: "accepted" }` |
| 3 | `con_nav001_0276` | `create` | 133 | summary plus `{ status: "proposed" }` |

Actor on all three is `hum_nav001_ana`. No `agentSessionId`. `limit` 1 returns `con_nav001_0283`, `total` 3, `returned` 1, `truncated` true. `returned 3 of 3` is this record's contributions at tip 217, not all 217 workspace contributions.

## 8. Source field map (same ids the terminal shows)

| Record | Field | Live value |
| --- | --- | --- |
| `task_nav001_f051` | lifecycle | `open`. Not `in_progress`. Not a running process. |
| `task_nav001_f051` | provenance | `createdBy` human `hum_nav001_ana`. Assignee agent `agt_nav001_33`. Both timestamps `2026-10-17T12:04:09.000Z`. |
| `dec_nav001_review` | lifecycle | `accepted`. `approvedBy` and `createdBy` are `hum_nav001_ana`. |
| `dec_nav001_review` | needs review | `needsReview` true. `needsReviewFindingIds` is `find_nav001_superseded` only. Acceptance is not revoked. Rationale: `Assumed the default task page returned every recorded task.` |
| `dec_nav001_review` | citation | `cit_nav001_0282`, finding `find_nav001_superseded`, note `original observation` |
| `find_nav001_superseded` | currentness | `superseded`. Successor `find_nav001_current`. Summary: `Every recorded lab task appeared in the first terminal read.` |
| `find_nav001_current` | currentness | `current`. Evidence `fev_nav001_0271` supports `art_nav001_runbook`. Summary: `The terminal read covers only the returned task page.` |
| `art_nav001_runbook` | reference class | type `report`, uri `https://example.com/nav-001/runbook.html`. `classifyArtifactReference`: class `openable https`, host `example.com`, `openable` true, `unsafe` false. Stored reference only. The terminal does not open it. |
| `dec_nav001_competing_a`, `dec_nav001_competing_b` | decision boundary | both `accepted`. Neither read carries `needsReview`. Neither is selected as operative. |
| `agt_nav001_01`, `agt_nav001_21` | provenance | registered agents, harness `codex`, owner Ana, owner is a lab participant. Registration is not presence. |
| `agt_nav001_03` | provenance | owner `hum_nav001_zed`, `humanOwnerIsParticipant` false. Do not insert Zed into the lab roster. |

Attention from the same context, for the opening frames: Ana `needsYou` is `dec_nav001_proposed` (`proposed_decision_actionable`), `task_nav001_assigned_blocked_ana` (`assigned_blocked_task`), `task_nav001_assigned_open_ana` (`assigned_open_task`). Team `needsAttention` ends at `dec_nav001_review` (`accepted_decision_needs_review`). Goal `goal_nav001_focus`.

## 9. Budget the candidate must report against

Compact `JSON.stringify` UTF-8 bytes of the service result at this clock. Pretty files are larger. These numbers are this fixture only. They are not a claim that the same byte counts hold for any larger team. Elapsed time was not measured. D8 on the candidate must report method counts, compact bytes, and elapsed time for initial load, one poll, one Work page, one People page, one owner-filtered page, one detail read, and one history read.

Released Viewer, this fixture:

| Pass | Methods | Compact bytes |
| --- | --- | --- |
| Initial | 5, including `get_workspace` | 195127 (of which `get_workspace` is 115288 and default context is 64920) |
| One poll | 4, including `get_workspace` again | 195069 |

The candidate's normal initial and periodic traces must not include `get_workspace`, must not include the full 57-participant array, and must not include a history read. On this fixture the full inspector is the scale pressure: 115288 bytes beside a 64920-byte default context whose `participants` array alone is 9197 bytes.

Omit orientation, same actor and workspace: **55806** bytes, `participants` length 0, coverage total 57. NAV-002's ≤ 56000 figure was a target; its 55725 figure was a context with `participants` replaced by `[]` and no coverage object. The live omit response, coverage included, is 55806. Report the candidate against 55806, not against 55725.

On-demand reads the released Viewer does not call. One page, not a workspace dump:

| Read | Compact bytes |
| --- | --- |
| `list_tasks` limit 20, pages 1–4 | 6496, 6516, 6528, 1352 |
| `list_workspace_participants` limit 20, pages 1–3 | 4518, 4259, 2244 |
| Ana's agents | 563 |
| Zed's outside-roster agent | 354 |
| `get_task` `task_nav001_f051` | 311 |
| `get_decision` `dec_nav001_review` | 780 |
| `get_finding` superseded / current | 593 / 669 |
| `get_artifact` runbook | 264 |
| `get_record_history` default / limit 1 | 1164 / 777 |
| `get_activity` limit 10 (not the Viewer's 50) | 2836 |
| `get_activity` limit 50 (what the Viewer sends) | 14648 |

A Work page that returns 64 tasks, or a refresh that still calls `get_workspace`, misses this budget. Matching these ids and totals matters more than matching a byte exactly after a harmless field reorder. Do not describe a smaller screenshot as a smaller read without these counts.

## 10. Agreement with NAV-002

The live v1.23.0 fixture agrees with `docs/evidence/nav-002/STEP0.md` §4 on: page-1 and page-2 task ids, `task_nav001_f051`, Ana's two agents, Zed owning `agt_nav001_03` with `humanOwnerIsParticipant` false, participant page ids, `dec_nav001_review` and the three contribution ids, tip 217, the superseded finding, `art_nav001_runbook`, census 20 / 37 / 64 / 57, and omit coverage `{ returned: 0, total: 57, truncated: true, omitted: true }`. Default context compact size is still 64920.

Live facts that older prose does not already state, and which this packet treats as the baseline:

- This tag's seed already has the Zed owner. The v1.22.1 "extend the seed" step is not part of reproducing v1.23.0.
- `list_tasks` page 4 is `truncated: true` with no `nextCursor`.
- The omit response that includes `participantsCoverage` is 55806 bytes, not 55725.
- The released Viewer refresh calls `get_workspace` (115288 bytes) on the initial load and on the next poll.

## 11. Checks

| Check | Result |
| --- | --- |
| Worktree `npm ci`, package `1.23.0` | exit 0; worktree removed afterward |
| Released seed asserts | exit 0, including agent 03 owned by Zed |
| Opening dashboard capture | exit 0; frames in §2 |
| Scripted key paths for f051, Ana's agents, and review history | observed on a PTY; frames not committed |
| Viewer Playwright capture | exit 0; png, text, keyboard path, request trace |
| Sanitizer | no `cft_`, home path, system-temp path, or unrelated-finding sentinel in the committed packet |

No product code, version bump, tag, deploy, or push was done. Human comparison was not run.
