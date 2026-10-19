# INDEPENDENT REVIEW — engineering evidence only, not a human observation

This is a read-only review of the NAV-003 product diff. It is not a human observation, not a sprint verdict, and not a release decision.

- Commit reviewed: `6ed7a6b7eb9e00696fc3153f41c91d0c832ccf20` (`git rev-parse HEAD`)
- Range: `2f042afc281de6ba88ceca6bb879cb3daf101a86`..`HEAD`
- Product commits: `975f790` (allowlist and refresh), `6ed7a6b` (Viewer navigation)
- Contract read: `docs/Campfire-v1.24-NAV-003-Viewer-Alignment-and-Human-Use.md` §§3, 4, 6, and 7
- `src/viewer/static/` and `public/` `app.js`, `app.css`, and `index.html` are byte-for-byte identical
- No files under `src/` or `tests/` were modified by this review

## Gate statement

| Question | Found? |
| --- | --- |
| D1 authorization leak (count, row, name, title, payload, or secret on a denied actor or wrong-workspace read) | No |
| False complete page or history (truncated, failed first load, or `total === 0` presented as the whole workspace) | No |
| False owner or live-presence claim | No |
| Decision-safety error | **Yes — must-fix** |
| Unsafe external-open control | No |
| Unbounded normal refresh (`get_workspace`, full roster, task list, or history on initial load or poll) | No |

Must-fix count: **1**.

## Findings

### 1. must-fix — source detail says acceptance is unchanged for any decision that carries `needsReview`

The decisions list gates that sentence on an accepted status. The new source panel does not.

`decisionRowHtml` only adds it when the status is accepted (`src/viewer/static/app.js` lines 2150–2152). `sourceRecordHtml` adds it for every decision whose record has `needsReview === true` or a non-empty `needsReviewFindingIds` array, with no status check (lines 2306–2307).

Path:

1. `decorateDecisions` / `decorateDecision` call `attachCitations` (`src/service/campfire-service.ts` lines 746–757).
2. `attachCitations` skips only `superseded`. A proposed, rejected, or retired decision with a citation to a non-current finding is returned with `needsReview: true` and `needsReviewFindingIds` (`src/service/correction-read.ts` lines 40–44).
3. The Viewer puts those proposed decisions in the decisions section (`decisionSectionRows`, `app.js` lines 2122–2138).
4. `selectRecord` treats a local decision as full when it has `createdAt`, `rationale`, or `citations` (`recordIsFull`, lines 2246–2248), so the orientation object is rendered without another read.
5. `sourceRecordHtml` prints `needs review — acceptance is unchanged` even when the line above is `proposed — not accepted, not an instruction` (`DECISION_STATUS_LABELS`, lines 1973–1978, and the status line at 2293).

That sentence states an acceptance fact the record does not have. It does not by itself pick an operative decision or turn the suggested next action into a control, but it is a decision-safety error on the new source path. The same block then calls `attentionReasonFor` (lines 2261–2266, 2308–2309), which returns the first attention hit for that id. A proposed decision’s reason is `proposed_decision_actionable` (“actionable by you, not accepted”, lines 911–912), shown under the acceptance sentence.

### 2. should-fix — a failed refresh of an already loaded Work or People page still states the old page boundary

`coverageSentence` returns `not complete` only when the `failed` argument is true (`app.js` lines 2041–2046). Work and People pass `failed` only when there is an error and no `readAt` (lines 2699–2702 and 2718–2722). After a successful page, a later failure sets `error` and `stale` but keeps `readAt` (`fetchWorkPage` lines 2387–2392, `fetchPeoplePage` lines 2452–2457). The coverage line stays `no further API page` or `another API page exists`, plus ` · stale`.

History does pass `Boolean(history.error)` into `pageContinuation` (line 2672), so a failed history read says `not complete`. Work and People should do the same once `error` is set. The rows on screen are still the last good page, which matches the stale-retain rule, but the continuation clause reads as a current completeness fact. A first failure with no `readAt` does say the read is not complete (lines 2056 and 2707). A truncated successful page says `another API page exists` (line 2044). This is not a truncated page labeled complete.

### 3. should-fix — history payload redaction is a four-key name filter, and the browser still receives the full row

`get_record_history` is allowlisted and the Viewer returns `options.call` unchanged (`src/viewer/server.ts` lines 409–411). The store selects `SELECT * FROM contributions` (`src/store/context-queries.ts` lines 504–516). The page then keeps a 160-character `JSON.stringify` summary and drops only keys matching `transcript`, `privatetranscript`, `prompt`, or `messages` (`app.js` lines 1969–1971 and 2069–2093). The summary is escaped in `historyRowHtml` (line 2660). A transcript stored under another key is still shown up to 160 characters, and the full payload remains in the response the page holds. Display is bounded. It is not a reliable transcript exclusion.

### 4. note — allowlist, dispatch, and normal refresh match the contract

Both copies are the previous five (`whoami`, `list_workspaces`, `get_workspace`, `get_workspace_context`, `get_activity`) plus exactly `list_tasks`, `list_workspace_participants`, `get_task`, `get_decision`, `get_finding`, `get_artifact`, and `get_record_history` (`src/viewer/server.ts` lines 37–50, `src/worker/handler.ts` lines 55–68). Unknown and write methods hit `isViewerReadMethod` and return read-only before `options.call` or `dispatchCampfireMethod` (`server.ts` lines 399–410; worker lines 600–612, 632–644, and the GET gates at 660 and 686). No schema, migration, or generated-view file is in the diff. `refresh` and the 2s poll call `list_workspaces`, `get_workspace_context` with `participants: "omit"`, and `get_activity` only (`app.js` lines 2985–3015 and 3314–3315). There is no `api("get_workspace"` in `app.js`. `list_tasks` uses limit 20 and runs from `setSection("work")` / paging (lines 2376–2383). `list_workspace_participants` and `get_record_history` are likewise on demand (lines 2440–2448 and 2592–2602), at limits 20 and 10.

### 5. note — omit is not an empty roster, and the owner outside the roster is not inserted

`omittedParticipantCoverage` requires `participantsCoverage.omitted === true` and renders the authorized total, not a human/agent split (`app.js` lines 849–864). Team work and the owned-agent block say the roster or relationship is not loaded (lines 1381–1384 and 1469–1476). They do not invent a 20/37 split. People rows print the recorded `humanOwnerId` and, when `humanOwnerIsParticipant === false`, `owner is outside the roster` (lines 2112–2118 and 2280–2285). They do not add a roster button for that owner. Every agent row says registration is not presence (line 2118). No online or live-execution field is rendered.

### 6. note — late responses are dropped; denied and wrong-workspace reads do not render a count or row

Work, People, detail, and history capture a generation and the workspace id and discard a response when the generation, workspace, section, or open history target no longer matches (`fetchWorkPage` lines 2379–2388, `fetchPeoplePage` lines 2443–2453, `selectRecord` lines 2558–2580, `fetchHistory` lines 2598–2609). `setWorkspace` and `ensureWorkspace` clear page state and bump those generations (lines 744–776 and 788–792). Page cursors live on that page object and are not sent after the workspace changes. Service reads authorize before the page or cursor decode (`listTasksPage` at `campfire-service.ts` lines 1476–1480, `listWorkspaceParticipants` at 1222–1229, `getRecordHistory` at 1258–1267). A wrong-workspace object becomes `*NotFound` for the caller-supplied id (`readInWorkspace`, lines 773–779), not the other workspace’s title. A bad cursor throws `Cursor belongs to a different workspace` with no items (`context-policy.ts` lines 284–289). The Viewer `fail` helper sends `error` and `message` only (`server.ts` lines 218–219). A failed first page keeps `readAt` null and renders the error plus “not complete”, not the in-memory `returned: 0` (lines 2394–2408 and 2706–2707).

The detail error path (lines 2583–2584) does not repeat the workspace check. Workspace changes bump `detailGen` first, so the generation check still drops the response.

### 7. note — hostile text and the external-open control

New row and source strings go through `esc` (quotes and angle brackets; lines 118–124) and free text also through `stripControls` / `visibleText` (lines 1981–1996). The hostile-title path in `workRowHtml` (lines 2096–2100) cannot close the attribute or insert a tag. `esc` does not escape `'`; the new attributes are double-quoted. Record ids are escaped but not passed through `stripControls`.

The only external anchor is `artifactOpenControlHtml` (lines 1567–1568): `target="_blank"`, `rel="noopener noreferrer"`, `referrerpolicy="no-referrer"`. `classifyArtifactReference` sets `openable` only for `https` that matches the labeled host, and control characters force `openable` false (lines 235–245 and 281–284). The sole `fetch` in `app.js` is `POST /api/call` (line 726). Browser storage is the existing perspective preference, density preference, per-workspace return cursor, and last workspace id (`setItem` at lines 318, 558, 785, 791, and 3096). No token and no actor selector.

### 8. note — history `total === 0` short-circuit

`historyHeadingText` and the history list treat `total === 0` with no error as “No contributions were recorded” without also requiring `truncated !== true` (lines 2668 and 2783–2784). `getRecordHistory` sets `truncated` from `page.hasMore` (service lines 1290–1296), which is not true for an empty page. Not a reachable false complete on the current service. A defensive check would still refuse that sentence when `truncated` is true.

## What this review did not do

No human task was run. D1–D8 were not re-executed here. The decision-safety defect above is enough that this review does not call the candidate clear.
