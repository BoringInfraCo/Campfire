# Campfire v1.24 — NAV-003: Viewer Alignment and Human Use

**Date:** October 19, 2026  
**Status:** Proposed sprint contract; no NAV-003 implementation, result, version bump, or v1.24 release decision is recorded here. Freeze Step 0 before product code.  
**Baseline:** Published and deployed `v1.23.0`, package `1.23.0`; private annotated tag object `7a466819cdc809dab65524f19330c019459d6703` resolves to `b97b47b08d09fd14af9e0aa09e242a074ffea989`. See `docs/RELEASE_V1_23_DECISION.md`.  
**Direction:** `docs/ROADMAP.md`, post-v1.21 Navigator sequence; `docs/ARCHITECTURE.md` §§3, 12–13 and the Viewer projection boundary.  
**Visual reference:** `docs/mockups/campfire-navigator.html` illustrates hierarchy, not real counts, authorization, or an acceptance frame.  
**Release shape:** Candidate minor `v1.24.0`. A separate recorded founder decision is required to bump, tag, publish, pin, or deploy it.

## 0. Sprint question and earned claim

> Can an authorized person use the existing browser Viewer to find the same recorded work, participant relationship, source, and older contribution that the v1.23 terminal Navigator exposes, while seeing exactly which pages were read and what Campfire cannot infer?

NAV-002 shipped bounded Work, People, and record-history reads in the terminal. The Viewer still presents a long orientation and workstream, fetches the full `get_workspace` inspector during refresh, and cannot page Work or People or inspect a selected record's bounded history. NAV-003 gives the **existing actor-bound, read-only Viewer** one focused navigation path. It does not create a second work feed or turn the browser into a coding-agent console.

The bounded engineering claim is: on the frozen v1.23 fixture, the same authorized actor can reach the same source IDs, coverage, recorded human–agent ownership, and selected-record history from either surface. Human understanding is a separate observation in §8; a local UI pass does not establish it.

## 1. Shipped baseline and frozen comparison

Before changing code, record the released `v1.23.0` behavior with the same actor, workspace, clock, and seed used for the candidate:

| Surface | Released fact | NAV-003 gap |
| --- | --- | --- |
| Terminal | Work pages, on-demand People, selected Source and Recorded changes; narrow history has `j/k` over loaded events. | Reference for source truth and coverage, not a browser layout template. |
| Viewer | My work / Team work, attention, current work, alignment, shared sources, Since You Were Here, and workstream. Five read methods: `whoami`, `list_workspaces`, `get_workspace`, `get_workspace_context`, `get_activity`. | No on-demand participant or history path; no later Work page. Its periodic full `get_workspace` read is the scale pressure to remove from the normal view. |
| Source and reference safety | Needs-review and competing decision labels, source IDs, provenance, and the deliberate external-open control for the existing approved HTTPS class. | Preserve their meaning while changing navigation. A stored reference remains unverified and does not prove external access. |

Pin the `v1.23.0` Viewer at **1440×900** and **390×844**, plus one keyboard-only path, a served request trace, and the terminal's 80×24/120×36 evidence for the same fixture. Reuse `fixtures/navigator/nav-001/` (`ws_nav001_lab`: 20 humans, 37 registered agents, 64 tasks, 57 workspace participants) only after verifying it still loads against the released tag. Freeze an answer key for: a task beyond Work page 1, Ana's participating agents, the owner outside the roster, `dec_nav001_review`, its three contribution IDs and tip, a cited finding/artifact, and a denied actor. Record exact IDs and expected page totals in `docs/evidence/nav-003/step-0/`; do not invent missing links or counts. Use isolated DB/config paths and a loopback Viewer. Sanitize tokens, private prompts, transcript text, and credential-bearing URLs from captures.

## 2. Viewer interaction contract

The top-level browser navigation is **Needs You / Needs Attention**, **Work**, **Decisions**, **Sources**, **People**, and **Recent changes**. My work / Team work remains a visible perspective control over the same authorized workspace; it changes emphasis, not permission. The first panel is Needs You in My work and Needs Attention in Team work. The workspace goal, acting identity, last successful read time, and a truthful participant count remain visible without a roster fetch. Do not turn the mockup's fictional counts into product data.

Desktop uses one active section, a bounded record list, and a selected detail. A row can open a Source view with its full ID, type, lifecycle/currentness, recorded actor and time, citations or references actually present, and the service's review reason. A separate **Recorded changes** control for a selected task, decision, finding, or artifact opens that record's history. A contribution row has its ID, actor type/ID, optional agent-session ID, action, timestamp, and a safe bounded payload summary. Closing history returns to the same source and page. It is never a private conversation transcript.

Work loads `list_tasks` only when selected, 20 per page. People loads `list_workspace_participants` only when selected, 20 per page. The Viewer shows `returned X of Y`, page number, and whether another API page exists; Next/Previous follow opaque cursors with a bounded local back stack. Filters, if retained, match **loaded rows only** and say so. People rows distinguish humans from registered agents; a selected human pages only their workspace-participating agents through `humanOwnerId`. A selected agent shows the recorded owner and whether that owner participates in this workspace. An owner outside the roster is not inserted into People. Until all relevant pages or an authoritative split have been read, the header says `57 workspace participants`, not `20 people / 37 agents` inferred from page 1.

History defaults to the service's 10-record page and honors its frozen-tip cursor. Its heading says the returned and total count and whether more API pages exist. A loaded page allows every contribution to be selected, including at narrow width. Next/Previous history page calls are distinct from moving among loaded contributions. Empty history says no contributions **recorded for this record**; a failed or truncated read never says complete. The Viewer does not infer a person's full contribution history from this record-scoped API.

At 390×844, the same path becomes a list → source → history stack with an explicit Back control; no horizontal overflow or clipped source/contribution ID. At 1440×900, the active list and detail fit side by side without a workstream occupying the first screen. Existing alignment, Since You Were Here, and workstream remain reachable from their own section rather than being silently deleted.

Use native buttons/links and visible focus. Tab and Shift-Tab reach every control; Enter/Space activate the focused control; Escape closes history/detail and restores focus to the originating row. Arrow or `j/k` shortcuts may operate only inside an explicitly focused list and must not hijack text entry, select controls, screen-reader commands, or ordinary page scrolling. A pointer or touch user gets equivalent controls. Browser Back behavior is not added unless Step 0 demonstrates a concrete need; local panel Back must work.

## 3. Read boundary and data contract

The Viewer remains token-free in the browser; its process-bound `options.call` supplies the actor. All workspace reads authorize before returning any count, row, cursor diagnostic, or detail. `src/viewer/server.ts` keeps an exact read allowlist and rejects every write before dispatch. The proposed NAV-003 allowlist is the existing five methods **plus exactly seven existing read methods**:

| Added method | Viewer use | Fetch rule |
| --- | --- | --- |
| `list_tasks` | Work pages | On Work selection/page only; `limit: 20`, opaque cursor. |
| `list_workspace_participants` | People pages and owner-filtered agent pages | On People or selected human only; `limit: 20`, server-side `humanOwnerId` filter. |
| `get_task`, `get_decision`, `get_finding`, `get_artifact` | Source detail when the selected authorized row or citation lacks its full record | One ID at a time; no broad list scan or cross-workspace fallback. |
| `get_record_history` | Recorded changes for one selected task, decision, finding, or artifact | On explicit open/page only; `limit: 10`, bound to workspace/type/ID and frozen tip. |

`get_workspace_context({workspaceId, participants: "omit"})` becomes the normal orientation read. Its `participantsCoverage` supplies the workspace participant total; `participants: []` is never treated as an empty roster. My work retains its released assignment semantics: the caller comes from `whoami`, and any owned-agent relationship needed beyond orientation comes from the bounded owner-filtered participant read. If that page is incomplete, My work says so instead of claiming all owned-agent work. `get_activity` remains the bounded Recent changes/return-visit read. `get_workspace` remains allowlisted for compatibility but **is not requested on initial load or every poll**; remove the existing normal-refresh full-inspector call. Any exceptional use of it needs a measured reason recorded in the result, not a hidden fallback.

Keep the v1.23 service, HTTP, MCP, SQLite/D1, cursor, authorization, and default JSON contracts unchanged. This sprint adds no write method, schema, migration, credential in HTML/JS, client-side actor selector, organization directory, transcript endpoint, or generated-view authority. Server-side Viewer tests must assert the seven additions are read-only and the previous five remain available. Review the browser-exposed payloads for credential/private content before allowing each method. A denied actor or wrong-workspace/cursor request reveals no count or row. Host validation, loopback default, remote-bind opt-in, and generated-view isolation stay intact.

## 4. Source truth and state rules

- **Decision boundary:** Proposed, accepted, accepted-needing-review, retired/replaced, and competing accepted decisions remain distinct. A needs-review accepted decision still has its accepted status; its non-current cited finding is shown with the service's reason. The Viewer does not select an operative instruction from competing decisions or convert a suggested next action into permission.
- **Recorded relationships:** Task assignment, agent registration, harness, owner, join time, and contribution age are records, not online status, current execution, action authority, or proof a human saw the work. My work / Team work is presentation, not an authorization boundary.
- **Citations and references:** Show only recorded finding/decision/artifact links and currentness. Preserve the released artifact classifier and deliberate HTTPS open control; render inert classes as text. Rendering performs no fetch, preview, or authorization check against the external destination. Keep the destination host label, `noopener noreferrer`, no referrer, and the unverified-target caveat.
- **Completeness:** Orientation slices, task/participant/history pages, and activity each keep their own `total`, `returned`, `truncated`, and read time. A first page does not stand for the workspace. No-results, not-loaded, stale, denied, and complete-empty are different states. Historical contribution completeness is only for the selected record at that frozen tip.
- **Async isolation:** Workspace, perspective, section, selected ID, page, and history target have separate request generations. A late response from a workspace or record the person left is discarded. Selection survives refresh only by stable ID if still in the loaded result; otherwise show a truthful selection-lost state. On refresh failure retain the last good view visibly stale with its last-read time and an actionable retry; never replace it with a false empty state. Do not persist a credential, full roster, or payload in browser storage. Existing local display preference and return cursor remain convenience state only.
- **Untrusted text:** Escape record names, IDs, rationale, citation notes, contribution payload summaries, and URLs in every HTML and attribute context. No record text can create controls, script, styles, navigation, or Viewer chrome. Keep displayed payloads bounded and do not render raw JSON or HTML supplied by a record.

## 5. Step sequence

| Step | Work | Exit |
| --- | --- | --- |
| **0 — freeze** | Commit released-tag screenshots/request trace, fixture answer key, source field map shared with the terminal, exact twelve-method allowlist, actor/denial matrix, desktop/mobile/keyboard paths, and response-size budget. | Another engineer can reproduce the Viewer gap and name the authorized IDs, coverage, and expected source facts before UI code. |
| **1 — read boundary** | Add exactly the seven read methods to the Viewer gate; verify actor-bound dispatch, denial, wrong-workspace/cursor behavior, and no write path. Replace the normal full-inspector refresh with `participants: "omit"`; preserve old read defaults. | Served Viewer returns only authorized bounded data; initial and periodic traces have no `get_workspace` or eager People/history page. |
| **2 — navigation state** | Build active section, Work/People cursor stacks, selected source, history page and contribution selection, request-generation invalidation, and stale/return behavior. | Later-page task and older history are reachable with exact coverage; late responses cannot change a different selection. |
| **3 — responsive Viewer** | Compose desktop and narrow layouts, accessible controls and focus restoration, source/decision/reference copy, and existing alignment/return/workstream access. Sync `src/viewer/static/` and `public/` byte-for-byte through the build. | Real served frames at both frozen viewport sizes show the same source IDs and caveats; keyboard and touch paths work. |
| **4 — verify and observe** | Run D1–D8, focused Viewer/service tests, typecheck, full suite, build/static parity, package, public-export audit, and deploy dry run; independently review new browser exposure and state races. Run §8 human tasks separately if eligible people are available. | `docs/SPRINT_NAV_003_RESULT.md` records exact commit, measurements, deviations, engineering verdict, and distinct human outcome. |

## 6. Deterministic acceptance checks

| Check | Required evidence |
| --- | --- |
| **D1 — authorization and browser boundary** | For an authorized human and agent, served Viewer calls use the bound actor and return only their workspace. Non-participant, wrong-workspace source ID, and wrong-workspace/type/record cursor return no count, name, title, payload, or secret. The twelve-method allowlist rejects every write and unknown method. Browser assets contain no token. Loopback Host and remote-bind rules remain enforced. |
| **D2 — work-first navigation** | Initial My work and Team work frames focus the correct service attention list with reason, source ID, coverage, and goal. Work reaches and inspects `task_nav001_f051` on a later authorized page without loading 64 tasks at once. Selection/back/refresh do not silently change workspace or perspective. |
| **D3 — People and ownership** | On the frozen 57-participant fixture, on-demand pages can reach every participant. Ana's owner-filtered page returns the two participating agents; `agt_nav001_03` names Zed as an owner outside the roster. First-page rows never create a false 20/37 split or live-status claim. |
| **D4 — source, decision, and reference truth** | For the same actor and IDs, Viewer detail agrees with v1.23 terminal and authorized get-by-ID JSON on lifecycle, needs-review reason, cited finding currentness, competing decision boundary, provenance, and artifact-reference classification. No unrecorded link or external access claim appears. |
| **D5 — selected-record history** | `dec_nav001_review` shows the three frozen contribution IDs newest first and an exact `returned 3 of 3` at tip 217. Every loaded contribution is reachable at 390×844; later API pages, zero rows, stale/error, and a write after the frozen tip keep truthful coverage. A late read for a closed record is dropped. |
| **D6 — interaction and responsive safety** | At 1440×900 and 390×844, real served captures have no horizontal overflow, clipped IDs, hidden essential caveats, or focus traps. Tab/Enter/Space/Escape and focus return work without hijacking inputs or native controls. Hostile record strings cannot inject HTML, attributes, script, control characters, or fake chrome. |
| **D7 — compatibility** | Existing CLI/MCP/HTTP JSON and default context, old workspace DBs, generated view, Viewer theme/density/return cursor, approved artifact open behavior, installer copies, and five old Viewer reads are unchanged. `src/viewer/static/` and `public/` agree after build. Package, export/public-copy audit, and deploy dry run pass from the candidate revision. |
| **D8 — bounded reads and parity** | Capture method counts, compact response bytes, and elapsed time on the frozen fixture for initial load, one Work page, one People page, owner-filtered page, detail, and history. Initial/periodic Viewer traces make no `get_workspace`, full-roster, or history call. Same actor's Viewer, terminal, and authorized JSON agree on IDs and totals. Report measured limits; do not claim arbitrary team scale. |

A persistent authorization leak, false complete page/history, false owner or live-presence claim, decision-safety error, unsafe external-open control, or unbounded normal refresh is **NO-GO / REFRAME**. Do not weaken checks to make the fixture pass. Repair the defect and rerun the affected gate.

## 7. Review and evidence handling

Use served Viewer requests and real browser captures in addition to unit tests. The result must distinguish a source fixture, automated browser interaction, builder rehearsal, and eligible human observation. Keep a request trace showing the normal-refresh method set and the first use of each on-demand read. Record bytes and read counts rather than asserting that a visually lighter page is computationally lighter. Independently review the seven-method Viewer expansion, hostile-text rendering, external-open behavior, actor/cursor isolation, and stale-response handling. Preserve exact failed checks and repairs in the result; later fixes do not retroactively change an earlier candidate's review.

## 8. Human observation and verdict

Pre-register five cold tasks for **two non-builder humans** on the released v1.23 Viewer and NAV-003 candidate, order counterbalanced when both are available: (1) reach and identify a later-page task; (2) explain a needs-review or competing accepted decision with its cited source IDs; (3) find a cited output and say what its external reference does and does not prove; (4) distinguish a named human from their registered participating agents and avoid a live-presence inference; (5) find an older contribution for a selected record and say whether the shown history is complete. The released Viewer may lack a direct route; record the actual path or inability, not a fabricated completion time. Record starting surface, clicks/keys, time, named IDs, wrong inferences, source coverage noticed, and any private explanation. A builder, coding agent, screenshot, or scripted browser run is engineering evidence, never a substitute participant.

- **GO — bounded human-use claim:** D1–D8 pass; both eligible people complete the five candidate tasks with correct source IDs and without false completeness, decision, presence, permission, or external-access claims. Report times, errors, and regressions without generalizing from two people.
- **CONDITIONAL GO — engineering candidate:** D1–D8 pass but eligible human comparison is unavailable for a recorded reason. Human comprehension is **NOT OBSERVED**. Under the roadmap's founder delivery rule, this may still support a separately approved, accurately labeled engineering release.
- **NO-GO / REFRAME:** A deterministic source/security check fails, a critical observed task fails, or the needed read cannot fit the bounded authorization and Viewer boundary.

This sprint does not rescore NAV-001/002, UIX-001, ATT-001, SWH-001, WCO-001, ARH-001, VIS-001 condition 4, or Gates B/C/E/F. Later ordinary use is welcome evidence, but publication alone moves none of those gates.

## 9. Deliverables and stop boundary

1. Committed Step 0 release pin, comparison captures, request trace, answer key, and twelve-method read/denial matrix.
2. One actor-bound, read-only Viewer path for bounded Work, People, selected Source, and selected-record history, with the normal full-inspector refresh removed.
3. D1–D8 evidence, real desktop/mobile/keyboard captures, cross-surface answer sheet, response-size measurements, independent security/state review, and compatibility checks.
4. `docs/SPRINT_NAV_003_RESULT.md` with exact candidate commit, deviations, engineering verdict, and observed human result or **NOT OBSERVED** reason.
5. A separate recorded founder decision before any `v1.24.0` bump, tag, public snapshot, installer pin, or deployment.

Keep workspace writes, approvals, notifications, agent process control, live presence, transcript sharing, external previews or downloads, organization-wide search, generalized relationship graphs, and new generated views outside NAV-003. An observed need for one of them requires a separately scoped contract; it is not permission to widen this sprint.
