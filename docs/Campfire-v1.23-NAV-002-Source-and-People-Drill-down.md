# Campfire v1.23 — NAV-002: Source and People Drill-down

**Date:** October 18, 2026  
**Status:** Proposed sprint contract. No NAV-002 implementation, result, version bump, or v1.23 release decision is recorded here. Freeze this contract and Step 0 evidence before product code.  
**Baseline:** Published and deployed `v1.22.1`, package `1.22.1`; private annotated tag object `7f23c1bc06c79e17729e3cbce1ed9d5177ba4fb7` resolves to `fd38eb20703167cbf9ea1c30b7b8cd92661a9b45`. See `docs/RELEASE_V1_22_1_DECISION.md`. The current checkout may contain later documentation; it does not redefine the product baseline.  
**Roadmap and architecture:** `docs/ROADMAP.md`, post-v1.21 Navigator sequence; `docs/ARCHITECTURE.md` §§12–13.  
**Visual reference:** `docs/mockups/campfire-navigator.html` is an illustration with fictional counts and relationships, not a data source or acceptance frame.  
**Release shape:** Candidate minor `v1.23.0`. A separate recorded founder decision is required to publish, pin, or deploy it.

## 0. Sprint question and earned claim

> In a workspace with 20 people, 37 registered agents, and 64 tasks, can an authorized person stay in the focused terminal Navigator, reach work beyond the first orientation page, find a recorded human–agent relationship, and inspect the selected record's actual evidence and contribution history without mistaking a partial read for the whole story?

NAV-001 made `campfire dashboard [workspace]` a focused, read-only terminal client. ONB-001 repaired first-run guidance; neither sprint added a People directory, later work pages, or a per-record history read. NAV-002 adds those three drill-downs while preserving the current work-first opening screen. The bounded product claim is **navigable recorded work, people, sources, and history at the frozen fixture size**. It is not a live agent fleet, organization-wide directory, audit guarantee, exhaustive relationship graph, or proof of human comprehension.

The existing `get_workspace_context` reports bounded task/decision/finding/artifact slices and `fullHistoryIncluded=false`, but carries an unbounded `participants` array. `list_tasks` already pages authorized task records. `get_activity` pages contributions across the workspace, not by selected record; scanning it client-side cannot truthfully or efficiently claim complete per-record history. This contract therefore freezes two small authorized read additions and one backward-compatible orientation option in §3 before implementation.

## 1. Terminal experience

### 1.1 Opening screen and navigation

- Keep NAV-001's default **Needs You** / **Needs Attention** focus, My work / Team work perspective, one active section, goal, actor, selected full source ID, source coverage, stale label, and quit/help keys. Do not show a roster, agent panes, or history timeline on launch.
- Add **People** as an on-demand section after the existing work and source sections. Its rows are workspace participants, grouped or labeled by human versus agent. Selecting a human pages their **workspace-participating** registered agents whose recorded `humanOwnerId` equals that human ID; selecting an agent shows its recorded human owner, whether that owner participates in this workspace, harness, workspace role, and join time. An owner who is not a participant is labeled as such, not silently added to the workspace roster. No team-wide `listHumans`/`listAgents` dump, inferred job title, implied online state, or fake person-to-work relationship.
- Keep `tab`/reverse-section navigation, `j/k`, `enter`, `/`, `r`, `?`, `q`, and Ctrl-C behavior from NAV-001. Reserve `n`/`b` for next/previous page in Work, People, or an open history panel; `h` opens/closes selected-record history when a task, decision, finding, or artifact is selected, and `esc` closes that panel when no filter is being typed. Record the context-sensitive key map in help and the footer. A key used while a filter is being typed remains text input; modal typing wins. An unavailable page or history action explains why and does not change selection.
- The `/` filter remains **local to the currently loaded page**. Show `matching / loaded / workspace total` as separate concepts. Clearing a filter reveals the same loaded page. It is never called workspace search.

### 1.2 Work pages

- The opening Attention cues remain from the authorized orientation and retain their existing coverage caveat. The **Work** section may request `list_tasks` with a fixed page limit of 20 and opaque cursor, using the same actor and workspace as orientation. Show each page's returned count, authorized total, page number, and whether another page exists. A list page is not an attention recomputation or an all-clear.
- `n` reaches the next page and `b` returns through a bounded local cursor stack. Keep only the current page and cursor stack in the terminal state; no eager 64-task fetch or client-side full-workspace scan. Preserve a selected task by ID when it is still on the refreshed page; otherwise choose the first row and say the previous selection is no longer on this page.
- Tasks in a later page use `get_task` by full ID for detail. Do not treat orientation-only `openTasks` as the only tasks in the workspace. Preserve recorded task status and assignee actor type; `in_progress` is a record state, not a running process.
- The current object-list cursor does not freeze a multi-page snapshot. If records change between reads, label each page with its own read time; do not claim a consistent 64-row census, guaranteed no duplicates across a concurrent write, or an exact absolute row range. A stale or rejected cursor offers a fresh first-page read. A failed read keeps the last successful page visibly stale and does not merge it with new orientation data.

### 1.3 People pages

- People is fetched only when selected, with at most 20 participant rows per page. Use the new workspace-scoped participant read in §3; render its own total/returned/next-page coverage. The list includes human and agent participant identities only. A `20 people / 37 agents` split is shown only after all relevant participant pages have been read or through authoritative split counts returned by the service; a first-page count cannot stand for the workspace total.
- Human detail uses the same authorized participant read with `humanOwnerId` set to the selected human's ID. Its `total` is the number of that human's **workspace-participating** agents; `items` are a bounded page, with an explicit next-page indicator. Do not infer the count from the unfiltered current page, or include agents that belong to the human but not this workspace.
- Participant pages are current reads, not a frozen membership snapshot. Show when the current page was loaded; if joins or role changes happen during traversal, refresh from page one before claiming a complete roster.
- `joinedAt`, role, harness, and `humanOwnerId` are recorded facts. Registration and prior contributions are **not** presence, availability, current harness connection, permission to act, or a guarantee that a human has seen the work. Membership and authorization remain separate. Unresolvable names fall back to typed IDs and remain inspectable.

### 1.4 Selected source and history

- `enter` opens the selected task, decision, finding, or artifact through the existing workspace-scoped get-by-ID read when the row is not already complete. Show record type, **full ID**, current recorded status/currentness, actor provenance where present, and relevant explicit relationships. A finding's `sourceArtifactId` and evidence rows, a decision's citations and supersession fields, and an artifact's stored reference class are shown as recorded; no relationship is invented by matching text or timestamps.
- `h` opens **Recorded changes for this record** using §3's bounded record-history read. Each row shows contribution ID, action, actor type/ID, optional recorded agent-session ID, timestamp, and a safely bounded payload summary. The heading states `returned of total`, `more changes` or `complete for recorded contributions`, and the page's read time. Empty means **No contributions recorded for this record**, not “no earlier work happened.” A failed or denied read says history is unavailable; it never silently falls back to a complete-looking timeline.
- A citation to a changed finding can make an accepted decision need review; it does not revoke acceptance. The finding's withdrawal contribution belongs in **that finding's** history; decision detail links to the finding rather than copying its event into decision history. Competing accepted decisions are not silently resolved. Source/history rows are evidence of Campfire writes, not proof that an external report was fetched, that a task was done, or that a person approved something outside the recorded transition.
- Artifact references retain the v1.21 classifier and inert terminal display. NAV-002 does not open, probe, preview, download, or verify an external target. The separately approved Viewer reference-open behavior remains unchanged.

## 2. Source-of-truth and state rules

| Displayed fact | Authorized source | Rule |
| --- | --- | --- |
| Attention / next cue | `get_workspace_context` | Keep its existing selection, coverage, and permission caveats; later task pages do not expand the cue set. |
| Work page | `list_tasks` | Show `items`, `returned`, `total`, `truncated`/`nextCursor` from that read; scope filter to loaded items. |
| People page | `list_workspace_participants` (§3) | Show only workspace participants; owner links use recorded `humanOwnerId`, not name matching. |
| Selected record | Matching `get_task`, `get_decision`, `get_finding`, or `get_artifact` | Full typed ID and workspace check; use recorded currentness/citations/evidence. |
| Record history | `get_record_history` (§3) | Only matching contribution object type/ID; total and continuation belong to that same selection. |
| Recent changes | Existing context/catch-up | Workspace activity remains a different view from selected-record history. |

Selection is keyed by `(workspaceId, section, recordType, recordId)`, not screen row or title. Switching workspace, actor, perspective, section, page, or selected record invalidates incompatible detail/history and any pending response. An old async response cannot replace a newer selection. Refresh updates the orientation and the active page as separate authorized reads; if either fails, label the affected surface stale with its last successful timestamp. No empty state may be interpreted as a complete workspace when a read is truncated, denied, stale, or pending.

## 3. Frozen minimal read changes

### 3.1 Bounded workspace participants

Add `list_workspace_participants({workspaceId, limit?, cursor?, humanOwnerId?})` at the service, transport, and MCP read boundaries. Without `humanOwnerId`, it pages all workspace participants. With it, it pages only workspace **agent participants** whose recorded `Agent.humanId` matches that human ID. It returns `schemaVersion: 1`, `workspaceId`, the applied filter, `items`, `total`, `returned`, `truncated`, and opaque `nextCursor?`, matching existing object-page coverage language. Each item retains the `ParticipantView` facts; agent items also include a computed `humanOwnerIsParticipant` boolean from workspace membership, so an owner outside the roster can be labeled without scanning other pages. Page size defaults to 20 and is capped at 100. Stable keyset order is `(actorType, actorId)` within one workspace; cursor binds workspace, filter, and sort position. A wrong-workspace, wrong-filter, or malformed cursor fails explicitly. Return no token, email, active session, presence, or team-wide directory fields. Apply `workspace:read` authorization before a count, item, owner lookup, or cursor error can reveal workspace data. The SQL/Store path must use a workspace-bounded keyset query and count, not `get_workspace` followed by an in-memory slice. As with existing task pages, concurrent membership changes can alter later-page totals; the terminal must not call a traversal a fixed snapshot.

The existing `get_workspace_context` defaults and response stay compatible for current callers. Add an **opt-in** `participants: "omit"` read option for the dashboard; when used, return `participants: []` together with an explicit `participantsCoverage` value `{returned: 0, total: <authorized count>, truncated: <total > 0>, omitted: true}`. Without the option, the historical full participant array remains and `participantsCoverage` may be omitted. The dashboard must not use the omitted array as a zero-person claim. Validate this option at HTTP/MCP boundaries, keep old JSON snapshots unchanged by default, and measure the resulting orientation payload. If this compatible option cannot be implemented without changing current callers' semantics, stop and amend this contract before product code rather than shipping an unbounded “on-demand” directory.

### 3.2 Bounded record contributions

Add `get_record_history({workspaceId, objectType, objectId, limit?, cursor?})` for `task | decision | finding | artifact` only. Require both workspace read and activity read; verify the selected object exists **in that workspace** before returning history, total, or cursor diagnostics. Return the matching append-only `Contribution` rows newest first, with `schemaVersion: 1`, the exact selection tuple, `items`, `total`, `returned`, `truncated`, and opaque `nextCursor?`. Default limit 10, maximum 50. Cursor binds workspace, object type, object ID, order, and a frozen append-position high-water mark for that traversal. Every page's `total` counts matching contributions at or below that same high-water mark, so a new write does not enter an older traversal. A cursor from another selection or workspace is rejected. A new first-page request starts a new traversal; no false cross-refresh snapshot guarantee.

Use a workspace/type/ID/append-position access path in SQLite and D1 if the existing index is insufficient; measure the query and add only the needed index/migration. The read cannot scan all workspace activity in the CLI or transport. Keep contribution payload summaries bounded and escaped in the terminal; the API may return existing structured contribution fields, but must not add private transcript text. This is a history of Campfire contributions **whose `objectType` and `objectId` equal the selected record**. It is not transitive history of cited findings, referenced artifacts, a human, or an external system. A separate linked source is inspected through its own ID and history.

### 3.3 Compatibility and security boundary

These are **read-only extensions**, not a new canonical object or write path. New methods need service types, SQLite/D1 store parity, HTTP dispatch/validation, MCP tool schemas/descriptions, and CLI dashboard wiring. Existing `get_workspace_context`, `get_activity`, object list/get methods, CLI JSON, Viewer allowlist and assets, public installer behavior, and old workspace data must keep their default contracts. Do not add the new methods to the Viewer allowlist in NAV-002; NAV-003 owns an explicit Viewer parity/security review. No implicit elevation from an agent's ownership of a human or from workspace membership to permission.

## 4. Step 0 — baseline and answer key before code

Commit a dated packet under `docs/evidence/nav-002/` before implementation:

1. Resolve the private `v1.22.1` tag object/commit, package, and published install channel. Capture sanitized released-dashboard frames at **80×24** and **120×36**, plus exact authorized JSON for orientation, `list_tasks` pages, get-by-ID detail, and a bounded `get_activity` comparison. Record the released gaps: no later-page dashboard control, no People section, and no per-record history API.
2. Reuse `fixtures/navigator/nav-001/` and its frozen answer key. Extend it only as needed with a task whose ID is beyond the first 20 tasks, a human with multiple participating agents, an agent whose owner is not a participant if the supported seed path allows that case, and a selected record with multiple contributions and explicit citation/evidence. Freeze exact IDs, page order, counts, owner mapping, contribution IDs, currentness, and the unauthorized actor. Label any unsupported edge case as a limitation rather than fabricating it.
3. Freeze the new read contracts in §3, expected authorization matrix, cursor behavior, payload-size and query-plan targets, and a same-fixture terminal/JSON answer sheet. Use isolated database/config paths and loopback ports. Redact tokens, invitation secrets, private prompts/transcripts, and credential-bearing URLs. A deterministic fixture or a builder rehearsal is engineering evidence, not human observation.

## 5. Build sequence and exit

| Step | Work | Exit |
| --- | --- | --- |
| **0 — freeze** | Baseline tag, frames, fixture extension, answer key, method shapes, authorization matrix, and measurable bounds. | Another engineer can reproduce the released gap and name every expected ID and coverage number. |
| **1 — authorized reads** | Implement §3's participant and record-history reads plus the opt-in participant omission. Check service, store, SQLite/D1, HTTP, and MCP parity. | Page/cursor/count/denial tests pass before terminal presentation uses the reads; unchanged defaults compare equal to v1.22.1. |
| **2 — dashboard state** | Add Work/People page state, cursor stack, request generation, ID-based selection, and per-surface stale state. Wire existing get-by-ID inspection and selected-record history. | No eager full-workspace scan; responses from a prior selection/workspace cannot overwrite current detail. |
| **3 — terminal composition** | Add on-demand People, visible page coverage, selected Sources and Recorded changes, help/key map, and narrow layout. Reuse NAV-001 rendering and artifact safety helpers. | Real PTY frames remain focused and readable at both frozen sizes with full IDs and correct caveats. |
| **4 — verify and observe** | Run D1–D7, focused PTY/transport/store tests, typecheck, full suite, build, package, export/public-copy review, and deploy dry run. Independently review authorization, cursor isolation, and source truth. Run eligible human tasks separately. | `docs/SPRINT_NAV_002_RESULT.md` records exact candidate commit, deviations, deterministic evidence, human outcome, and verdict. |

## 6. Deterministic acceptance checks

| Check | Required evidence |
| --- | --- |
| **D1 — read authorization and isolation** | Authorized human and agent see only their workspace's participant, task, object, and contribution rows. Non-participant, wrong-workspace IDs, wrong-object IDs, and cross-workspace/type/record cursors yield no count, title, name, or payload. Both `workspace:read` and `activity:read` are checked for history. HTTP/MCP validation rejects malformed input. |
| **D2 — paging and scale** | On 20 humans/37 agents/64 tasks, default frame remains work-first; a task beyond the first 20 is reached, inspected, and returned from by keyboard. People pages reach all 57 participants without an eager full roster in the initial dashboard response. Counts and `more` indicators match the authorized page reads. The same bounded queries run through SQLite and D1; record query plans and payload sizes, with no workspace-wide client scan. |
| **D3 — recorded relationships** | Human and agent detail show only actual workspace participant/owner fields. The owner-filtered read reaches all of one human's participating agents and labels its own page coverage. Owner outside the workspace is identified as outside the roster, not silently included. Registration, role, task status, and contribution age never become live presence or execution permission. |
| **D4 — selected source and history truth** | Task/decision/finding/artifact detail matches matching get-by-ID JSON, including lifecycle, citation/evidence and currentness. Record-history pages contain only matching contributions, with correct actor/session, order, total, and continuation. A zero-row read says no contributions recorded for this object; truncated, denied, stale, and failed reads cannot render as complete recorded history. Historical or competing decision states do not become operative instructions. |
| **D5 — state and terminal safety** | Page/section/perspective/workspace changes invalidate mismatched selection and pending responses. Refresh failure retains last good page visibly stale. Hostile names, IDs, titles, citation notes, payloads, and references cannot inject controls or forge chrome. Filter typing accepts all letters, non-TTY has no screen controls, and quit/Ctrl-C/SIGINT/resize/read-error cleanup remains reliable. Inspect real 80×24 and 120×36 PTY frames. |
| **D6 — backward compatibility** | Default `get_workspace_context`, `get_activity`, list/get JSON, status/onboarding/join CLI, old workspace DBs, MCP tools, Viewer read allowlist/assets, and versioned installer copies retain released behavior. New read methods are additive and read-only. Packaging, export/public-copy audit, and deployment dry run pass from the candidate revision; an immutable prior installer is never overwritten. |
| **D7 — performance and source parity** | Freeze and compare per-call query plan, result size, and elapsed time on the 57-participant/64-task fixture; page reads must not materialize unrelated workspace activity or the whole participant directory in the CLI or service. Indexed total counts are allowed and measured separately. The selected IDs, totals, relationships, and history match the same actor's authorized service/CLI JSON; a denied actor has no inferred count. State the measured values and any limit rather than claiming arbitrary team scale. |

If a D1 leak, false complete-history label, false owner relation, live-presence inference, or unbounded read persists, the result is NO-GO / REFRAME. Do not weaken a check or broaden scope to make the fixture pass. Broaden testing only for a concrete remaining risk or required release gate.

## 7. Human observation and verdict

Pre-register a cold comparison for **two non-builder humans**, using the same authorized frozen workspace in the released v1.22.1 dashboard and candidate, with order counterbalanced. Tasks: (1) find and inspect a task beyond the first task page; (2) identify a named human's recorded participating agents and distinguish ownership from live status; (3) locate the cited evidence and currentness behind an accepted-needs-review decision; (4) find a selected record's older contribution and say whether history is complete; (5) explain what a stored external artifact reference proves and whether Campfire can open it in this terminal. Record start surface, keystrokes/path, time, answer IDs, wrong inferences, read errors, and any private explanation. The released baseline cannot complete some tasks in the dashboard; record that fact and any CLI route used rather than awarding a fabricated time. A builder, agent, or scripted capture does not count as a human outcome.

- **GO — bounded drill-down claim:** D1–D7 pass; both eligible humans complete the five candidate tasks with correct source IDs and without false completeness, permission, presence, or external-access claims. Report actual time/error comparison and any regression; do not generalize from two people.
- **CONDITIONAL GO — engineering candidate:** D1–D7 pass, but the eligible human comparison is unavailable for a recorded reason. Human comprehension is **NOT OBSERVED**.
- **NO-GO / REFRAME:** A deterministic safety/source check fails, a critical cold task fails, or the needed read cannot fit the frozen authorization and bounded-query contract.

NAV-002 does not rescore NAV-001, ONB-001, UIX-001, ATT-001, SWH-001, WCO-001, ARH-001, VIS-001 condition 4, or Gate B/C/E/F. Each keeps its own evidence rule. The founder's delivery rule may allow a separately approved, accurately labeled engineering release with human use still open; publication cannot turn **NOT OBSERVED** into PASS.

## 8. Deliverables and stop boundary

1. Committed Step 0 baseline/answer key and frozen read contract before product code.
2. The three bounded read changes in §3, with service/SQLite/D1/HTTP/MCP authorization and compatibility evidence.
3. Focused terminal People, paged Work, selected Sources and Recorded changes; sanitized PTY frames and D1–D7 results.
4. `docs/SPRINT_NAV_002_RESULT.md` with candidate commit, exact checks and measurements, deviations, independent review, human result or NOT OBSERVED reason, and verdict.
5. A separate founder decision for any `v1.23.0` bump, tag, public snapshot, channel pin, or deployment.

Keep Viewer navigation alignment and any Viewer allowlist expansion for NAV-003. Keep agent process control, telemetry/presence, approvals, workspace writes, organization-wide search, automatic evidence ingestion, external previews, and a full transitive history graph outside NAV-002. If the fixture or real use exposes a need for one of these, record the observation and re-scope explicitly.
