# Campfire — Sprint 010: Return to the Workspace

**Status:** Complete (GO) — see `docs/SPRINT_010_RESULT.md`
**Date:** September 24, 2026
**Company:** Boring Infra Co.
**Depends on:** Sprint 009 — Align Before Execution (**GO**)
**Primary metric:** Return accuracy. Changed-state retrieval time and model synthesis time are diagnostic and are reported separately. This contract defines no pass/fail latency threshold.

---

## 1. Sprint question

> Can a returning human or agent identify what changed since its last
> observation, understand the current implications, and resume without
> rereading the entire workspace or receiving a manual handoff?

Here "return" means the client or harness supplies the contribution id it
retained from an earlier observation. That id is the prior cursor. Campfire
does not remember who has read what.

Resume means the caller can state, from Campfire state alone:

- which contributions were recorded strictly after that cursor;
- who recorded each one;
- what the workspace's current orientation implies now, including the
  recorded alignment boundary and the orientation hint;
- which contribution id a later session should retain.

The cursor is an observation pointer. It is not a summary of the changes, and
it is not permission to execute.

A browser-local Viewer cursor is not cross-device or cross-client continuity.
Two browsers, the CLI, and an agent process do not share it. An agent returns
only when its harness kept the cursor.

This sprint uses the existing contribution log and the existing `since`
argument on `get_workspace_context`. It does not add a read-receipt object,
a last-seen table, notifications, subscriptions, presence, or analytics.

---

## 2. Baseline audit

Audited at commit `22560f3` across service, CLI, MCP, HTTP, Workers, and the
read-only Viewer.

| Question | Baseline | Evidence |
| --- | --- | --- |
| Where is `since` accepted? | Optional contribution id on MCP, HTTP, and Workers. The same `optionalStr` rule: missing, null, or blank becomes omitted; a non-string is `ValidationError`. CLI `show` sends only `{ workspaceId }`. A passed `--since` is ignored. | `src/mcp/tools.ts:204-205`; `src/http/dispatch.ts:77-89,208-212`; `src/worker/async-dispatch.ts:77-89,208-212`; `src/cli/index.ts:652-666,962` |
| What does `since` return? | `SinceProjection`: `{ cursor, items, truncated }`. Items are contributions strictly after the id. Order is `created_at`, then `rowid`. Both services duplicate `buildSince`. | `src/service/service.ts:249-254,187`; `src/service/campfire-service.ts:422-435`; `src/worker/async-service.ts:460-473`; `src/store/sqlite-store.ts:851-855`; `src/worker/d1-store.ts:741-743` |
| Newest cursor | Empty `items`, `truncated: false`, `cursor` equals that id. | `src/service/campfire-service.ts:430-434` |
| Unknown cursor | `ValidationError` with `field: "since"`. HTTP and Workers return 400. MCP returns `isError` and `details.field`. No contribution rows are returned. | `src/service/campfire-service.ts:424-428`; `src/http/server.ts:51-71`; `tests/integration/http.test.ts:445-457`; `tests/integration/mcp.test.ts:360-382` |
| Cap | `ORIENTATION_PROVENANCE_LIMIT` is 20. A longer delta keeps the newest 20 and sets `truncated: true`. `cursor` is still the newest id in the whole log, so storing it skips the omitted prefix. | `src/service/service.ts:187`; `src/service/campfire-service.ts:430-434`; `tests/unit/service.test.ts:1008-1020` |
| Omitted `since` | The field is absent. A blank string never reaches `buildSince`. | `src/service/campfire-service.ts:611-613`; `src/service/service.ts:280-281`; `tests/unit/service.test.ts:862-863` |
| Resume cursor without `since` | No labeled field. The last `provenance` id is the newest contribution id whenever the log is non-empty, because provenance keeps the newest 20. Human `show` prints provenance lines without contribution ids. | `src/service/campfire-service.ts:578-581`; `src/cli/index.ts:322-329,468-473` |
| Cross-workspace cursor | `listContributions` is scoped by `workspace_id`. A foreign id is the unknown-cursor error. Authorization runs before the log is read. No test yet passes workspace A's id into workspace B. | `src/store/sqlite-store.ts:851-855`; `src/service/campfire-service.ts:570-577` |
| Another participant's changes | The log records actor id and type, optional `agentSessionId`, action, object type, object id, and a new-value payload. Current orientation (`alignment`, `needsYou`, `currentWork`, `suggestedNextAction`) is derived from current rows, not from `since.items`. | `src/domain/types.ts:193-204`; `src/service/campfire-service.ts:105-124,345-419`; `src/service/service.ts:366-397` |
| Viewer last-seen | `localStorage` key `campfire.viewer.lastSeen.<workspaceId>`, falling back to `sessionStorage` for that tab if `localStorage` throws. Sent only on the first fetch of a visit. The panel then stays frozen while polls advance the stored id to the newest contribution. Not per actor. Not shared with CLI or agents. | `src/viewer/static/app.js:4,221-266,870-889` |
| Viewer writes | Allowlist is `whoami`, `list_workspaces`, `get_workspace`, `get_workspace_context`, `get_activity`. Other methods return 403 before the service. | `src/viewer/server.ts:31-37,246-248` |
| Read receipts | `ContributionAction` includes `"read"`. Nothing writes it. Schema has no last-seen table. | `src/domain/types.ts:155-160`; `src/store/schema.sql:6-155`; `migrations/0001_campfire.sql` |

### How state changes appear

Payloads are the new value only. The sync service and the Workers service use
the same shapes, except the Workers calls marked below do not await the write.

| Change | Contribution | What the row shows |
| --- | --- | --- |
| Propose a decision | One `create` / `decision` | `summary`, `status: "proposed"`. Rationale stays on the decision row. |
| Accept a decision | One `update` / `decision` | `status: "accepted"`. The actor is the approver. Previous status is not stored. |
| Supersede a decision | None | No service, CLI, MCP, or HTTP path. `store.updateDecision` can set `superseded` and writes no contribution. Current context still lists `id`, `summary`, `updatedAt` on `supersededDecisions`. |
| Create a task | One `create` / `task` | `{ title }` only. Status and assignee stay on the task row. |
| Block, complete, or reopen | One `update` / `task` when `status` is sent | New `status`. No blocked reason. |
| Reassign or clear assignee | One `update` / `task` | New assignee, or `null` when cleared. Not the previous assignee. CLI `update-task` also sends `--status`, so a CLI reassignment records status too. MCP and HTTP can set assignee alone. |
| Goal update, finding, artifact | One each | New title, description, or status that was sent; finding `{ summary }`; artifact `{ title, type }`. |
| Invite, join, register session | One each, in the same log | Distinguishable by `action` and `objectType`. Register-session payload includes `humanId`. Other work rows do not. |
| Empty task or goal update | None | The current object is returned and no row is appended. |

`describeContribution` names the actor and, for a work update, prefers
`summary`, then `title`, then `status`. An assignee-only payload produces no
detail in that sentence. The raw contribution still carries `payload.assignee`.
"On behalf of" is on the participant projection (`humanOwnerId`) and on the
register-session payload. It is not a column on the work contribution. Agent
writes require a session, so `agentSessionId` is present and can be joined to
`agent_sessions.human_id`.

Contribution ids are random. They are not an order. The log order is
`created_at`, then `rowid`.

### Workers write sequencing

Five Workers `record()` calls are not awaited inside the async transaction:
join, invite, register session, add decision, and add artifact
(`src/worker/async-service.ts:896,945,1005,1174,1304`). The method can return
before that contribution insert finishes. Accept and task update do await
their writes. SQLite awaits every `record()`.

### Baseline gaps

- CLI cannot request or print a `since` delta, and human lines omit
  contribution ids, so a CLI caller cannot retain a resume cursor from human
  output.
- `since.cursor` on a truncated window is the newest id. The omitted prefix
  is not available from a later `since` call with that cursor. `get_activity`
  can page older rows with `before`, and those pages also include history at
  and before the original cursor.
- `since.items` does not include `alignment`, `needsYou`, `currentWork`, or
  `suggestedNextAction`. Those are siblings on the same context response.
- Viewer "since you were here" is one browser profile and one origin. The
  stored id advances when the response arrives, including on polls, whether
  or not the human read the panel. An unknown stored id leaves `sincePending`
  true, so the Viewer retries it.
- Supersede, blocked reason, previous values, and task-to-decision links are
  not in the log.
- A cross-workspace `since` id is fail-closed by construction and is not yet
  tested.

### Rules that already hold

| Rule | Derivation |
| --- | --- |
| Delta membership | Contributions in that workspace with index strictly after the cursor, oldest first |
| Complete delta | `since.truncated === false` |
| Partial delta | Newest 20 after the cursor, `since.truncated === true` |
| Next observation pointer | Newest contribution id: `since.cursor` when `since` was supplied, otherwise the last `provenance` id |
| Current implications | The rest of the same `get_workspace_context` response |
| Unknown or foreign cursor | `ValidationError`, no rows |
| Blank `since` | Treated as omitted |

### Hard requirements parked for explicit review

These are candidates only. Sprint 010 does not implement them.

1. Durable server-side last-seen or read receipt, per actor and per device.
   Requires schema. Browser-local state cannot provide it.
2. A forward page token that resumes at the first omitted delta row, so a
   truncated window can be walked without skipping it and without rereading
   older history. The current `since.cursor` does the opposite on purpose.
   Changing that rule requires an explicit amendment.
3. Notifications, subscriptions, presence, or analytics.
4. A supersede command and its contribution. Already parked in Sprint 009.
   Current `supersededDecisions` remain visible; the transition itself is not
   an event.
5. Field-level before/after diffs, blocked reason, or task-to-decision links.
   Already parked where they need schema.
6. Embedding the human principal on every work contribution. The session id
   and the participant list already support the join.

If implementation demonstrates any of these as a hard requirement, stop and
amend this contract rather than adding schema or a new object silently.

---

## 3. Smallest implementation

Keep one caller-supplied cursor. Render the existing `since` projection on the
CLI, and keep MCP, HTTP, Workers, and the Viewer on the same object.

Deterministic return rule, using existing rows only:

- The caller passes a contribution id from an earlier observation of that
  workspace.
- `since.items` are the contributions strictly after it, in log order, capped
  at 20, keeping the newest 20 when the cap is exceeded.
- `since.truncated` is true only when older post-cursor rows were omitted.
- `since.cursor` remains the newest contribution id in the workspace, including
  when the window is truncated. Storing it moves the observation point to the
  end of the log, including rows the window did not show.
- A cursor equal to the newest id returns an empty delta and `truncated: false`.
- An unknown id, including an id from another workspace, is `ValidationError`.
  The response contains no contribution rows.
- A blank `since` stays omitted. The context has no `since` field.
- Current implications are the existing siblings on that response:
  `alignment`, `needsYou`, `needsAttention`, `currentWork`, and
  `suggestedNextAction`. `since.items` alone is not the orientation.
- The resume cursor the caller retains is the newest contribution id. Do not
  add a new field for it.

Surface behavior:

- CLI `show` accepts optional `--since <contributionId>` and passes it to
  `get_workspace_context`.
- Human output lists each returned contribution with its id, time, actor id,
  action, object type, object id, and the payload fields that exist (`summary`,
  `title`, `status`, `assignee`). It states `truncated` when the window is
  partial, and it prints the newest contribution id as the resume cursor.
- `--json` returns the service object unchanged.
- MCP, HTTP, and Workers already return that object. Tests must lock the same
  fields, including truncation and the unknown-cursor error.
- Workers `record()` calls that are not awaited today must be awaited, so an
  existing contribution row is written before the method returns. Do not add
  contribution kinds.
- The Viewer stays read-only and keeps its browser-local cursor. Do not write
  a server cursor. Do not describe that cursor as cross-device continuity.
  Copy may state that the panel is this browser only. No new Viewer action.

No surface offers execute, notify, or mark-as-read.

---

## 4. Acceptance criteria

Deterministic:

- A before snapshot stores the newest contribution id. Another participant
  then accepts a decision, blocks or completes a task, and reassigns a task.
  `get_workspace_context` with that cursor returns exactly those new
  contribution ids, in log order, with that actor on each row.
- The same response's `alignment`, `currentWork`, and `suggestedNextAction`
  match the after snapshot.
- Cursor equal to the newest id returns `items: []` and `truncated: false`.
- A delta longer than 20 sets `truncated: true`, returns the newest 20 ids
  after the cursor, and sets `cursor` to the newest id in the log. The omitted
  ids are absent from `items`.
- An unknown id, and a contribution id from another workspace, fail with
  `ValidationError` and return no rows from either workspace.
- A caller who omits `since` can still read the newest contribution id from
  the tail of `provenance`.
- CLI human output for `--since` shows the delta, the truncation flag, and the
  resume cursor. `--json` matches the service object. MCP, HTTP, and Workers
  return the same `since` fields.
- Accept, task update, and the other alignment-relevant mutations still record
  their existing single contribution. The five previously un-awaited Workers
  writes are awaited and the row is visible to a following read.
- Authorization is unchanged. A non-participant is rejected before the log is
  read. The Viewer allowlist is unchanged and rejects writes.
- Transcript and workspace isolation tests remain green.

Cold real-harness:

- A fresh process with no transcript and no change summary receives only the
  workspace and the prior cursor id.
- It names what the other participant changed, who changed it, the current
  consequence for that work, and the `suggestedNextAction` from the context
  response.
- It names the resume cursor as the newest contribution id.
- It does not describe a truncated window as the complete delta. The scored
  run uses a delta within the cap; the truncated case is the deterministic
  check above.
- It does not treat the cursor or the orientation hint as permission to execute.
- Every statement is traceable to Campfire reads. The prior cursor is an
  observation pointer, not a handoff of the changes.
- Changed-state retrieval and model synthesis are timed separately, as defined
  in the measurement plan.

---

## 5. Measurement plan

- **Retrieval:** external line-level timing from the start of the first
  successful `get_workspace_context` call that passes `since` to that call's
  completed response. Report the precise interval. Keep process start and
  total process duration separate.
- **Synthesis:** external line-level timing from that completed response to
  the correct return statement. Report the precise interval.
- **Accuracy:** score the pre-run after snapshot. A correct item names the
  contribution id, the actor, the action, and the current consequence that
  snapshot records. Also score the orientation hint and the resume cursor.
- **Limitations:** one harness, one model, one workspace, no variance estimate.
  Supplying the cursor is the return mechanism, not a handoff. Semantic
  matching can false-pass. Report all of them.
- This contract defines no pass/fail latency threshold. Adding one requires
  an explicit amendment.

---

## 6. Non-goals

- Schema or migration changes, a last-seen table, or a read-receipt
  contribution (`action: "read"` stays unused).
- Notifications, subscriptions, presence, or analytics.
- A new domain object, or a new resume-cursor field on `WorkspaceContext`.
- Changing `since.cursor` so that a truncated window can be continued.
- Cross-device or cross-client continuity derived from Viewer `localStorage`.
- A supersede command, blocked reason, task link, or before/after diff.
- Writable Viewer behavior, or any new Viewer action.
- Mark-as-read, execute, or applying `suggestedNextAction`.
- Orchestration, scheduling, or Sprint 011 implementation.

---

## 7. Rubric

- **GO:** all deterministic checks pass. The cold harness, given the workspace
  and the prior cursor only, names the other participant's changes, the actor,
  the current consequence, the orientation hint, and the resume cursor. It
  does not treat a truncated window as complete, does not read an unrelated
  workspace, and needs no manual change summary or transcript.
- **CONDITIONAL GO:** the delta and the current consequence are correct, but
  the harness rereads the full activity or the full workspace inspector even
  though the delta fit in the cap, or it needs a manual explanation. The
  sprint stays limited to the caller-supplied cursor and the current
  projection.
- **NO-GO / REFRAME:** the harness cannot say what changed without a handoff,
  attributes a change to the wrong actor, treats an unknown cursor as an empty
  delta, treats a truncated window as the whole delta, or receives another
  workspace's rows. Also NO-GO if the sprint adds schema, read receipts,
  notifications, or a writable Viewer to make the return succeed.

Implementation begins only after this contract is reviewed and explicitly
accepted.
