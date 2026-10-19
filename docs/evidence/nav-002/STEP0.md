# NAV-002 Step 0 — baseline, read contract, and answer sheet

**Date:** 2026-10-18  
**Status:** Freeze before product code. This is not `docs/SPRINT_NAV_002_RESULT.md` and it is not a verdict.  
**Label: FIXTURE EVIDENCE — engineering evidence only.** A scripted capture is not a human observation. The contract §7 comparison is **NOT OBSERVED**. No participant answers were invented.

Contract: `docs/Campfire-v1.23-NAV-002-Source-and-People-Drill-down.md` §3 and §4. This packet records the shapes an implementer must build. It does not add `list_workspace_participants`, `get_record_history`, or dashboard paging.

## 1. Released baseline

| Fact | Value |
| --- | --- |
| Product commit | `fd38eb20703167cbf9ea1c30b7b8cd92661a9b45` |
| Annotated tag object | `v1.22.1` → `7f23c1bc06c79e17729e3cbce1ed9d5177ba4fb7` |
| Package on that commit | `1.22.1` |
| What that commit's install channels still pin | Homebrew formula and `flake.nix` at `fd38eb2` still download **v1.22.0** archives. That is the pre-pin state named in `docs/RELEASE_V1_22_1_DECISION.md`. |
| Published install channel | Pin commit `828f51ee0e0aefa41a866d4aebe65fa46a420713` (formula and flake point at the v1.22.1 archives). Public addendum `a7fe66e37dc489cb18c9807bfbbb5df78d618854`. Tap `0e9efa308b2ff73d1d52f3248e2c3ee44ae3ad1c`. Live installer sha256 `2256bccb086d3c83e9a997de46285e5ad5175bb3f696a6641322b16ccba8a844`. Worker version `12de3762-a587-42fe-bfb2-e7d8dd5e0141`. |
| Checkout used for the capture | Detached worktree of `fd38eb2`, `npm ci --no-audit --no-fund`, then removed. Later docs commits do not redefine this baseline. `src/`, `fixtures/navigator/`, and `package.json` were identical between `fd38eb2` and the docs HEAD at capture time, before the fixture extension in this commit. |

Frames (Ana, `ws_nav001_lab`, real `campfire dashboard`, `CAMPFIRE_TELEMETRY=0`, isolated config dir, loopback-free local db, default `q` only):

| File | Window | sha256 | Widest line |
| --- | --- | --- | --- |
| `baseline/terminal/baseline-v1.22.1-ana-lab-80x24.txt` | 80×24 | `c37579509c225b6d5c91a4f78032a4a8573b551b68731fbc195c7f1b02f69e99` | 80 |
| `baseline/terminal/baseline-v1.22.1-ana-lab-120x36.txt` | 120×36 | `e64eaf51f59f294e1cb5338b0cc5fc7d80b894b2c443793d83fae0b4d8f1c75c` | 119 |

`baseline/terminal/capture-summary.json` records exit 0, alternate screen entered and left, cursor hidden and shown, `termiosRestored: true`, and zero redactions. Root and database paths are `[path]`. The `refreshed` timestamp is wall-clock, so a re-capture changes that one line and the file hashes.

Both frames show the opening screen only: Needs You for `dec_nav001_proposed`, `task_nav001_assigned_blocked_ana`, and `task_nav001_assigned_open_ana`; source `get_workspace_context`; coverage `20/64 truncated tasks · 5/5 decisions`. The 120-column footer is `p perspective   tab section   j/k move   / filter   enter inspect   r refresh   ? help   q quit`. The 80-column footer drops `p perspective`. There is no People section, no `n`/`b` page control, and no `h` history control.

The line `20 people · 37 registered agents` is a count taken from the unbounded orientation `participants` array (57 items). It is not a People section and not a paged read.

### Proved API absence (v1.22.1 source, not memory)

`CAMPFIRE_HTTP_METHODS` in `src/http/dispatch.ts` and the copy in `src/worker/async-dispatch.ts` are the same 45 names. Neither list contains `list_workspace_participants` or `get_record_history`. Dispatching either name as Ana returns `ValidationError` / `Unknown method: <name>` (`baseline/json/released-method-absence.json`).

MCP `registerTool` names on that commit also omit both methods. They do include `list_tasks`, `get_task`, `get_decision`, `get_finding`, `get_artifact`, and `get_activity`. `get_playbook` is registered. `project_handoff_packet` is HTTP-only.

`VIEWER_READ_METHODS` is `whoami`, `list_workspaces`, `get_workspace`, `get_workspace_context`, `get_activity`. NAV-002 must not add the new methods there.

`src/cli/dashboard.ts` does not call `list_tasks`, `get_activity`, or a People read. `src/cli/index.ts` on that commit does not mention the two new method names. `get_workspace_context` options are only `since` and `budget`. There is no `participantsCoverage` field in the captured orientation.

`list_tasks` itself already pages. The gap is the dashboard, not the task API.

### Captured authorized JSON

Actor `hum_nav001_ana`, workspace `ws_nav001_lab`, clock `2026-10-17T14:00:00.000Z`, released (unextended) seed. Cursors are `cf1.` base64url JSON of ids and timestamps. They are not secrets. Files:

| File | What it is |
| --- | --- |
| `baseline/json/get-workspace-context-ana.json` | Full orientation. `participants` length 57. `completeness.fullHistoryIncluded` is false. No `participantsCoverage`. |
| `baseline/json/list-tasks-page-1-ana.json` | `limit` 20. `total` 64, `returned` 20, `truncated` true. Cursor shape has `v`, `kind: "task"`, `workspaceId`, `rank`, `at`, `id`. No high-water `tip`. |
| `baseline/json/list-tasks-page-2-ana.json` | The following page. First id `task_nav001_f051`. Same coverage numbers, still truncated. |
| `baseline/json/get-task-beyond-page-1-ana.json` | `task_nav001_f051`, status `open`. |
| `baseline/json/get-decision-review-ana.json` | `dec_nav001_review`, accepted, `needsReview`, citation of `find_nav001_superseded`. |
| `baseline/json/get-finding-superseded-ana.json` | That finding, `currentness: "superseded"`. |
| `baseline/json/get-finding-current-ana.json` | Successor, evidence `fev_nav001_0271` supports `art_nav001_runbook`. |
| `baseline/json/get-artifact-runbook-ana.json` | Stored reference only. |
| `baseline/json/get-activity-limit-10-ana.json` | Workspace activity, not per-record history. `total` 217, `returned` 10, `truncated` true, `nextBefore` `con_nav001_0372`. The ten rows are task updates. `dec_nav001_review` is absent. |
| `baseline/json/authorization-samples.json` | Zed and the cross-workspace call fail with `ParticipantRequired` before a cursor error. A lab task cursor passed to `list_decisions` is `ValidationError` "Cursor is not a decision cursor". |
| `baseline/json/cursor-and-object-binding.json` | Ana on the lab: a task cursor minted for `ws_nav001_unrelated` is `ValidationError` "Cursor belongs to a different workspace" and the details name the **requested** workspace only. A malformed cursor is `ValidationError`. `ws_does_not_exist` is `WorkspaceNotFound`. `task_missing` is `TaskNotFound`. `find_nav001_unrelated` read in the lab is `FindingNotFound` and does not return the unrelated text. |
| `baseline/json/measurements.json` | Census, owners, keyed contribution ids, compact payload sizes, `EXPLAIN QUERY PLAN`. |

The released seed's agent 03 owner is `hum_nav001_h03`. Section 4's outside-owner row is the extended seed, not this JSON file.

## 2. Fixture extension

Census stays 20 lab humans, 37 agents, 64 tasks, 57 lab participants (20+37), 217 lab contributions, max `append_position` 217. Two extended seeds produced byte-identical dumps. Attention membership matches `docs/evidence/nav-001/FIXTURE_KEY.md`. The first task-page id list is now asserted by the seed.

`agt_nav001_03` is created by Zed (`hum_nav001_zed`) instead of `hum_nav001_h03`. The domain allows it: `createAgent` requires the acting human to be the owner and to be on the team; it does not require workspace membership. Zed is on `team_nav001` and is a participant only of `ws_nav001_unrelated`. Agent 03 remains a lab participant (`role` `agent`, harness `codex`, name `Agent 03`, `joinedAt` `2026-10-17T12:01:45.000Z`). No 38th agent and no 21st lab human were added. Agent 03 is not on the first task page and is not an attention assignee. `hum_nav001_h03` keeps `agt_nav001_23`.

No contribution rows were added. `dec_nav001_review` already has three contributions and one citation. A zero-contribution task, decision, finding, or artifact does not exist in this seed, because every one of those objects was created through the service. That empty-history case is a required read behavior, not a fixture row. Do not insert an object without a contribution just to manufacture it.

## 3. Frozen read contract

Existing `list_tasks`, `get_activity`, `get_workspace_context` defaults, and contribution `append_position` stay as they are. New behavior below is the contract to implement.

Wire cursors stay in the existing `cf1.` family (`encodeContextCursor`: `v: 1` JSON, base64url). Do not add a second codec.

### 3.1 `list_workspace_participants`

Request:

```text
workspaceId: string
limit?: integer          default 20, maximum 100 (existing MAX_PAGE_SIZE)
cursor?: string
humanOwnerId?: string    omit the key for the unfiltered roster
```

An empty `humanOwnerId` is `ValidationError`, not "match everyone".

Response, `schemaVersion: 1`:

```text
workspaceId
filter               { humanOwnerId } when the filter was applied; omit the key otherwise
items                ParticipantView fields already returned today:
                     actor { actorId, actorType }, name, role, joinedAt,
                     and for agents harness and humanOwnerId
                     Agent items also include humanOwnerIsParticipant: boolean
total, returned, truncated, nextCursor?
```

No token, email, session, presence, or team-wide directory field.

Unfiltered items are workspace participants. `humanOwnerId` restricts items to workspace **agent** participants whose `Agent.humanId` equals that id. `total` counts that same set. An owner who matches no workspace agent returns `total: 0` and `items: []`. That is not `HumanNotFound`, and it does not add the owner to the roster.

`humanOwnerIsParticipant` is true when that agent's `humanId` is a human participant of **this** workspace. It is computed for the item, not by scanning other pages. Humans do not get the boolean.

Order is `(actorType, actorId)` ascending, byte/Unicode order. `"agent"` sorts before `"human"`. Cursor binds `workspaceId`, the filter (`humanOwnerId` or null), and the last returned `(actorType, actorId)`. The next page is strictly after that position. A cursor from another workspace, another filter, or a malformed token fails explicitly and returns no items.

SQL is a workspace-bounded keyset query plus a workspace-bounded count. Do not call `get_workspace` and slice. Current `listParticipants` is `ORDER BY joined_at` and is not this read.

Authorization: `workspace:read` before limit validation, cursor decoding, count, items, or the owner-participant lookup. A non-participant receives `ParticipantRequired` naming only the caller and the workspace, even if the cursor or limit is also wrong. Unknown workspace is `WorkspaceNotFound` and returns no rows.

### 3.2 `get_workspace_context` option `participants: "omit"`

Today the options object is `{ since?, budget? }` and `participants` is the full array. Keep that default. Callers who omit the new option get the same participant array and **no** `participantsCoverage` key.

The dashboard may pass `participants: "omit"`. The response then has `participants: []` and:

```text
participantsCoverage: { returned: 0, total: <authorized participant count>, truncated: <total > 0>, omitted: true }
```

Any other `participants` value is `ValidationError`. Validate it at the HTTP and MCP boundaries. The empty array must not be rendered as "zero people". `total` on this fixture is 57, so `truncated` is true.

### 3.3 `get_record_history`

Request:

```text
workspaceId: string
objectType: "task" | "decision" | "finding" | "artifact"
objectId: string
limit?: integer          default 10, maximum 50
cursor?: string
```

The maximum is **50**, not `MAX_PAGE_SIZE` (100). `clampPageLimit` must not be reused unchanged.

Response, `schemaVersion: 1`:

```text
workspaceId, objectType, objectId
items          existing Contribution objects, newest append_position first
total, returned, truncated, nextCursor?
```

Items keep the stored contribution fields (`id`, `workspaceId`, `actor`, `agentSessionId?`, `action`, `objectType`, `objectId`, `payload?`, `appendPosition`, `createdAt`). Do not add transcript text. Payload summaries in the terminal stay bounded and escaped. The API does not invent a second summary type.

Rows match `objectType` and `objectId` only. Cited findings, referenced artifacts, and the actor's other writes are not included.

Authorization and existence, in this order, before any history row, `total`, or cursor diagnostic:

1. `workspace:read`
2. `activity:read` (call it even though today's authorizer grants both to every participant, including `viewer`)
3. The object exists **in that workspace** (`TaskNotFound`, `DecisionNotFound`, `FindingNotFound`, or `ArtifactNotFound`). Details carry the requested id only. A row that belongs to another workspace is not found. Do not return a count.

A non-participant stops at step 1 with `ParticipantRequired` and never learns whether the object exists. An unknown workspace is `WorkspaceNotFound`.

Cursor binds workspace, object type, object id, order `"append-position-desc"`, and a frozen tip. The tip is `maxAppendPosition(workspaceId)` taken on the first page of that traversal and copied into every later cursor. Every page's `total` counts matching rows with `append_position <= tip`. The next page returns matching rows with `append_position < beforePosition` (the oldest position returned on the current page) and `append_position <= tip`. A new first-page request freezes a new tip. A cursor for another workspace, type, record, or order is rejected and returns no items.

This is not `get_activity`. Activity is newest-first across the workspace by `created_at, rowid`, with `before` / `nextBefore`, and it does not freeze an append-position tip.

### 3.4 Authorization matrix

| Case | Expected | No leak of |
| --- | --- | --- |
| `hum_nav001_ana` on `ws_nav001_lab` | Both new reads and the omit option succeed | — |
| `agt_nav001_01` on `ws_nav001_lab` | Same. Agent membership is not Ana's membership. | — |
| `hum_nav001_zed` on `ws_nav001_lab` | `ParticipantRequired`. Message names Zed and `ws_nav001_lab` only. Bad limit or bad cursor does not change the error. | count, title, name, payload, cursor diagnostic |
| Well-formed read of `ws_does_not_exist` | `WorkspaceNotFound` | rows |
| Ana calling the lab methods on `ws_nav001_unrelated` | `ParticipantRequired` (she is not a member), before a cursor error | unrelated finding text |
| History object id that is absent, or that exists only in the other workspace | After both auth checks, the matching `*NotFound`. `find_nav001_unrelated` on the lab is `FindingNotFound`. | body, total |
| Task cursor, or a participant/history cursor, used on the wrong method, workspace, filter, type, or record | After auth (and, for history, after the object exists), `ValidationError`. Details must not echo the other workspace's rows. | items, total |
| `participants` other than omitted or `"omit"` | `ValidationError` | — |

### 3.5 Cursor behavior to preserve

`list_tasks` cursors are a keyset of `(rank, updated_at, id)` inside one workspace. They do **not** freeze a snapshot. A later page can skip or repeat a row if a task changes between reads. The terminal must label each page with its own read time and must not claim a consistent 64-row census across a concurrent write. A rejected cursor offers a fresh first page. Captured page-1 cursor: `kind: "task"`, `rank: 2`, `at: "2026-10-17T12:04:11.000Z"`, `id: "task_nav001_f053"`, `workspaceId: "ws_nav001_lab"`.

Record-history cursors **must** freeze the append-position tip, as §3.3 says. Catch-up already does this for `get_workspace_changes` (`tip` 0 means "not frozen yet"; the service then pins `maxAppendPosition`). History uses that same position column. It does not reuse the activity `before` id.

Participant cursors bind workspace, filter, and sort position. They are current-read cursors, not a frozen membership snapshot.

### 3.6 Payload and plan targets (verify at D7)

Measured on the released fixture, compact UTF-8 JSON of the service result, clock frozen. Pretty files in `baseline/json/` are larger; use these numbers.

| Read | Compact bytes |
| --- | --- |
| `get_workspace_context` (Ana, full participants) | 64920 |
| `participants` array alone (57 items) | 9197 |
| Same context with `participants` replaced by `[]` and no coverage object | 55725 |
| `list_tasks` page 1 / page 2 (`limit` 20) | 6496 / 6516 |
| `get_activity` `limit` 10 | 2836 |

Targets for the candidate, on this same fixture, not a claim of arbitrary team scale:

- Default orientation stays compatible: 57 participant items, no `participantsCoverage`, compact size 64920 at this frozen clock.
- `participants: "omit"` compact size **≤ 56000**, `participants` length 0, coverage `{returned: 0, total: 57, truncated: true, omitted: true}`.
- A default `list_tasks` page stays under 16 KiB and returns 20 of 64, not 64.
- A default participant page returns 20 of 57, compact size under 8 KiB, and contains no other workspace. `EXPLAIN` must constrain `workspace_id`. Do not materialize `get_workspace`. A temp b-tree sort of this workspace's 57 participants is acceptable. Add `(workspace_id, actor_type, actor_id)` only if a measured plan is not workspace-bounded.
- Default history for `dec_nav001_review` returns 3 of 3, compact size under 8 KiB, and no other object's rows. The probe `SELECT` filtered by workspace, type, and id currently uses only `idx_contributions_workspace_position (workspace_id=?)`, which walks this workspace's 217 positions (`baseline/json/measurements.json`). That index is not sufficient. D7 requires a workspace/type/id/position access path. The index to add, if the new `EXPLAIN` still only constrains `workspace_id`, is `contributions(workspace_id, object_type, object_id, append_position)` on SQLite and D1. Do not add it in Step 0.
- Elapsed time is not baselined here. D7 records it on the candidate. No millisecond budget is invented in this packet.

Current task-page plan: `idx_tasks_workspace (workspace_id=?)` plus a temp b-tree for the rank/`updated_at`/`id` order. Current participant plan: `idx_participants_workspace (workspace_id=?)` plus a temp b-tree for `joined_at`.

## 4. Answer sheet (extended fixture)

Actor unless noted: `hum_nav001_ana`. Workspace: `ws_nav001_lab`. Unauthorized actor: `hum_nav001_zed`.

### Work pages (`list_tasks`, default 20)

`total` 64, page 1 `returned` 20, `truncated` true. Page 1 ids, in order:

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

The task past page 1 is **`task_nav001_f051`** (first row of page 2). `get_task` returns status `open`, title `Display-pressure filler task 51`, assignee `agt_nav001_33` (`agent`), `createdBy` `hum_nav001_ana`, `createdAt` and `updatedAt` `2026-10-17T12:04:09.000Z`. Its only contribution is `con_nav001_0352` (`create`, append position 192). Page 2 is also 20 of 64, truncated. Its ids:

```text
task_nav001_f051 task_nav001_f050 task_nav001_f049 task_nav001_f048
task_nav001_f047 task_nav001_f046 task_nav001_f044 task_nav001_f043
task_nav001_f042 task_nav001_f041 task_nav001_f040 task_nav001_f038
task_nav001_f037 task_nav001_f036 task_nav001_f035 task_nav001_f034
task_nav001_f033 task_nav001_f031 task_nav001_f030 task_nav001_f029
```

`task_nav001_f058` is on page 1 with status **`in_progress`**. That is a recorded task status, not a running process. Opening Work and pressing `n` once must land on `task_nav001_f051` without fetching all 64 tasks. The `/` filter counts matches on the loaded page only. A partial page is not workspace search. These pages are not an attention recomputation and not a frozen snapshot.

### People

Unfiltered order `(actorType, actorId)`. `total` 57.

| Page | `returned` | `truncated` | Ids |
| --- | --- | --- | --- |
| 1 | 20 | true | `agt_nav001_01` … `agt_nav001_20` |
| 2 | 20 | true | `agt_nav001_21` … `agt_nav001_37`, then `hum_nav001_ana`, `hum_nav001_ben`, `hum_nav001_h03` |
| 3 | 17 | false | `hum_nav001_h04` … `hum_nav001_h20` |

Ana is not on page 1. The first page must not be labeled "20 people".

Human with more than one workspace-participating agent: **`hum_nav001_ana`** owns `agt_nav001_01` and `agt_nav001_21`. Both are lab participants, harness `codex`, role `agent`, names `Agent 01` and `Agent 21`. Filtered read: `total` 2, `returned` 2, `truncated` false, `humanOwnerIsParticipant` true on both. `joinedAt` `2026-10-17T12:01:41.000Z` and `2026-10-17T12:02:21.000Z`. Ana herself is `role` `owner`, `joinedAt` `2026-10-17T12:01:00.000Z`. Ben (`hum_nav001_ben`) also has two agents (`agt_nav001_02`, `agt_nav001_22`); Ana is the named case.

Outside owner, real fixture fact: **`agt_nav001_03`** `humanOwnerId` **`hum_nav001_zed`**. Filtered read returns that one agent, `total` 1, `humanOwnerIsParticipant` **false**. Zed is not inserted into the lab roster. The label says the owner is outside the roster. Registration, role, and `joinedAt` are not presence or permission to act.

`hum_nav001_h03` now has only `agt_nav001_23` (codex, participant, `humanOwnerIsParticipant` true, `joinedAt` `2026-10-17T12:02:25.000Z`).

Omit option coverage: `{returned: 0, total: 57, truncated: true, omitted: true}`.

### Selected source and history

History record: **`dec_nav001_review`**.

| Field | Value |
| --- | --- |
| Status | `accepted` (acceptance is not revoked) |
| `needsReview` | true |
| `needsReviewFindingIds` | `find_nav001_superseded` |
| Citation | `cit_nav001_0282`, note `original observation`, finding `find_nav001_superseded` |
| Rationale | `Assumed the default task page returned every recorded task.` |
| `approvedBy` / `createdBy` | `hum_nav001_ana` |

Contributions on that decision only, newest first. With no writes after the seed, the frozen tip is **217**. Default `limit` 10 returns all three, `truncated` false. That means complete **for recorded contributions on this record**, not complete workspace history (217 contributions) and not the finding's history.

| Order | Id | Action | Append position | Payload |
| --- | --- | --- | --- | --- |
| 1 | `con_nav001_0283` | `update` | 135 | cites `find_nav001_superseded`, note `original observation` |
| 2 | `con_nav001_0279` | `update` | 134 | `{status: "accepted"}` |
| 3 | `con_nav001_0276` | `create` | 133 | summary of the decision, `{status: "proposed"}` |

Actor on all three is `hum_nav001_ana`. There is no `agentSessionId`.

`limit` 1 is the truncation case: item `con_nav001_0283`, `total` 3, `returned` 1, `truncated` true, then `con_nav001_0279`, then `con_nav001_0276`. A contribution appended after the first page (position greater than 217) stays out of that traversal.

The cited finding's own history is not copied onto the decision:

| Object | Contributions (newest last in this table) | Currentness |
| --- | --- | --- |
| `find_nav001_superseded` | `con_nav001_0266` create position 128; `con_nav001_0269` update position 129 | `superseded`. Successor `find_nav001_current`. |
| `find_nav001_current` | `con_nav001_0270` create position 130; `con_nav001_0272` update position 131 | `current`. Evidence `fev_nav001_0271` supports `art_nav001_runbook`. |

`dec_nav001_competing_a` and `dec_nav001_competing_b` stay accepted. Neither is operative.

Artifact: `art_nav001_runbook`, type `report`, uri `https://example.com/nav-001/runbook.html`. One contribution, `con_nav001_0257` create position 125. The terminal shows the stored reference class and does not open, fetch, or verify it. Workspace membership is not access to the URL.

`get_activity` `limit` 10 remains the workspace feed (`total` 217). It must not be presented as this decision's history.

There is no zero-contribution object in the fixture. A read that does return `total` 0 says **No contributions recorded for this record**, not that no earlier work happened. `dec_nav001_review` is not that case.

### Terminal caveats the candidate must show

- A loaded task or participant page is not a workspace search, and it is not "all clear".
- `in_progress` on `task_nav001_f058` is a record state.
- Zed's ownership of `agt_nav001_03` is labeled outside the roster and does not add Zed.
- History `3 of 3` for `dec_nav001_review` is complete only for that record's contributions. Empty history would not mean "no earlier work".
- `art_nav001_runbook` is not opened.
- `needsReview` does not un-accept the decision. The competing pair is not resolved.
- The released `20 people · 37 registered agents` line must not be rebuilt from an omitted array or from People page 1.

## 5. Checks run for this freeze

| Check | Result |
| --- | --- |
| v1.22.1 worktree `npm ci` and released seed | exit 0; worktree removed afterward |
| Dashboard capture | exit 0; frames above |
| Extended seed, twice, plus `dump.ts` | exit 0; `diff -r` byte-identical |
| `npx vitest run tests/unit/nav-001-dashboard.test.ts` | 19 passed |

No product code, version bump, tag, deploy, or push was done. Human comparison was not run.
