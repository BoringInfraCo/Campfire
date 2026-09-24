# Campfire — Sprint 010 Result

**Status:** Complete
**Sprint:** 010 — Return to the Workspace
**Date:** September 24, 2026
**Company:** Boring Infra Co.
**Depends on:** Sprint 009 — Align Before Execution (**GO**)
**Recommendation:** **GO**

---

## 1. Result

Sprint 010 asked:

> Can a returning human or agent identify what changed since its last
> observation, understand the current implications, and resume without
> rereading the entire workspace or receiving a manual handoff?

Yes. The caller supplies the contribution id it retained from an earlier
observation, and `get_workspace_context` returns exactly the contributions
recorded strictly after it, plus the same current orientation siblings. A cold
Codex process, given only the workspace id and the prior cursor id, named the
three changes, who recorded each one, the current consequence for that work,
the `suggestedNextAction`, and the newest contribution id to retain. It made a
single Campfire call, read nothing else, and did not treat the cursor or the
orientation hint as permission to execute.

Timing is diagnostic. External line-level timing measured **11 ms** from the
start of the single `get_workspace_context` call that passed `since` to its
completed response, and **8,120 ms** from that response to the correct return
statement. Total process duration was 19,324 ms and is reported separately.
No pass/fail latency threshold exists.

No schema, read receipt, notification, presence, new resume-cursor field, or
writable Viewer behavior was added.

---

## 2. What landed

| Surface | Behavior |
| --- | --- |
| CLI `show` | Accepts optional `--since <contributionId>` and passes it to `get_workspace_context`. Human output prints a `Since <cursor>` section with one row per returned contribution: id, time, actor id, action, object type, object id, and the payload fields present (`summary`, `title`, `status`, `assignee`). It states `truncated` when older post-cursor rows were omitted and always prints `Resume cursor <newest id>` when the log is non-empty. `--json` returns the service object unchanged |
| CLI errors | An unknown cursor and a cursor from another workspace fail with `ValidationError` and no rows. `--since` with `--full` is rejected instead of silently ignored |
| Application service | Existing `since` projection reused unchanged: strictly after the cursor, log order, newest 20, `truncated` only when older post-cursor rows were omitted, `cursor` is the newest id in the workspace log, blank omitted, unknown or foreign id fails closed |
| MCP / HTTP / Workers | Return the same `since` fields. Tests now lock truncation, the empty window at the newest id, and the foreign-workspace cursor on those surfaces |
| Workers write sequencing | The five `record()` calls that were not awaited (join, invite, register session, add decision, add artifact) are awaited, so an existing contribution row is written before the method returns |
| Viewer | Untouched. It stays read-only with its browser-local cursor; no server cursor and no continuity claim |

The resume-cursor line is printed whenever the log is non-empty, including when
`--since` is omitted, so a first CLI observation can retain a cursor from human
output. It is derived from `since.cursor` when present, otherwise from the tail
of `provenance`. No service field was added.

---

## 3. Validation matrix

```text
npm run typecheck          PASS
npm test                   PASS — 25 files, 303 tests
npm run test:acceptance    PASS — 8/8
npm run acceptance         GO — 19/19 checks
npm run build              PASS
```

Deterministic coverage includes:

- The before/after snapshot: a stored cursor then another participant accepts
  a decision, blocks a task, and reassigns it; the delta is exactly those three
  contributions, in log order, each with that actor and the recorded payload.
  The same response's `alignment`, `currentWork`, and `suggestedNextAction`
  equal the after snapshot.
- An empty delta at the newest id: `items: []`, `truncated: false`,
  `cursor` unchanged.
- A delta past the cap: `truncated: true`, the newest 20 post-cursor ids,
  `cursor` set to the newest id in the log, and the omitted prefix absent from
  `items`.
- Unknown and foreign-workspace cursors: `ValidationError` with
  `details.field = "since"`, no rows, on the sync service, the async service,
  HTTP (400), MCP (`isError`), and the CLI. Authorization still precedes the
  log read; a non-participant is rejected before any delta is computed.
- Omitting `since`: the newest contribution id is readable from the tail of
  `provenance`.
- CLI human output for `--since` shows the delta, `truncated`, and the resume
  cursor; `--json` carries the same siblings as the service object.
- The deferred-store Workers test proves all five previously un-awaited
  `record()` calls are durable before their method resolves; removing any one
  `await` makes it fail.
- Transcript and workspace isolation tests remain green.

Manual CLI check on the cold workspace (same DB as the harness run):

```text
Since  con_000011  (3 contributions)
  con_000012  2026-09-24T12:00:16.000Z  hum_000002  update  decision  dec_000001  status=accepted
  con_000013  2026-09-24T12:00:17.000Z  hum_000002  update  task  task_000001  status=blocked
  con_000014  2026-09-24T12:00:18.000Z  hum_000002  update  task  task_000002  assignee=hum_000001
Resume cursor  con_000014
```

---

## 4. Cold real-harness evaluation

- Harness: real `codex-cli 0.150.1`, fresh ephemeral process, read-only
  sandbox, empty workdir, no transcript or handoff.
- Identity: agent `agt_000001` (Codex), session `ses_000001` injected through
  the MCP environment. The three changes were recorded by human `hum_000002`
  (Alice). The prompt named only the workspace id and the prior cursor id
  `con_000011`. It did not name ids, actors, payloads, or which fields changed.
- Exit: 0. Campfire MCP calls: 1 (`get_workspace_context` with `since`).
  Non-Campfire tools: 0. Write tools: 0. Contribution count stayed 14.
- `get_workspace_context` (with `since`) started 10,006 ms and completed
  10,017 ms after process start.
- **Retrieval (diagnostic): 11 ms** from call start to completed response.
- Correct return statement: 18,137 ms after process start.
- **Synthesis (diagnostic): 8,120 ms.** No threshold.
- Total process duration: 19,324 ms, recorded separately.
- No Campfire call after the context response.

Accuracy against the pre-run snapshot, 6 of 6 requested items:

| Requested | Ground truth | Cold statement |
| --- | --- | --- |
| Change 1 | `con_000012` `hum_000002` update decision `dec_000001` `{status: accepted}` | Matched id, actor, object, payload; consequence: now accepted |
| Change 2 | `con_000013` `hum_000002` update task `task_000001` `{status: blocked}` | Matched; consequence: remains blocked and assigned to `hum_000002` |
| Change 3 | `con_000014` `hum_000002` update task `task_000002` `{assignee: hum_000001}` | Matched; consequence: open and assigned to `hum_000001` |
| Orientation hint | `suggestedNextAction` task `task_000002` "Rotate the webhook signing secret." | Matched kind, id, and summary |
| Resume cursor | newest contribution id `con_000014` | Named `con_000014` |
| Truncation | `truncated: false` | Stated complete |

The statement also said neither the cursor nor the orientation hint grants
permission to execute. It did not start implementation. Every claim is
traceable to the single 12,177-character context response.

Evidence: `evidence/sprint-010/cold-harness.md` (private, gitignored). Raw
capture remains at `/tmp/campfire-sprint-010-mcp`.

Harness-integration note: the first invocation had its MCP call rejected by
Codex's default tool-approval policy. The run requires
`mcp_servers.campfire.default_tools_approval_mode = "approve"` for
non-interactive MCP reads. That is a Codex client configuration, not a
Campfire behavior, and it is recorded for reproducibility.

---

## 5. Architecture and scope

- No schema or migration changed. `ContributionAction` still has `read`
  unused; no last-seen table, read receipt, notification, subscription,
  presence, or analytics was added.
- No new domain object and no new resume-cursor field on `WorkspaceContext`.
  The delta is the existing `SinceProjection`; the resume cursor is its
  `cursor`.
- `since.cursor` semantics are unchanged: the newest id in the workspace log,
  including when the window is truncated. A forward page token was not added.
- MCP, HTTP, and the Workers service reuse the same projection; the CLI only
  renders it.
- The Workers change is sequencing only: existing contribution writes are
  awaited. No contribution kind was added and D1 has no interactive
  transaction, so a failing write still surfaces through the method instead of
  becoming an unhandled rejection after the response.
- The Viewer was not modified and remains read-only with a browser-local,
  single-origin cursor. That cursor is not cross-device or cross-client
  continuity.

---

## 6. Limitations

1. One harness (`codex-cli 0.150.1`), one model, one workspace, no variance
   estimate.
2. Supplying the workspace id and the prior cursor is the return mechanism; it
   is not a handoff. The prompt contained no change data. Semantic matching
   can false-pass; the statement was checked line by line against the captured
   context JSON.
3. The scored run used a delta within the cap. The truncated case is covered
   deterministically across the service, HTTP, MCP, Workers, and CLI; it was
   not scored through the harness.
4. The cold run exercised the local SQLite service. The Workers/D1 path is
   covered by the async-port parity tests, not by a real D1 deployment.
5. Retrieval and synthesis are wall-clock, line-level intervals from one run;
   they are diagnostic and define no threshold.
6. The prior cursor remains a raw contribution id. If the caller loses it, the
   newest id is readable from provenance, but no server-side identity or
   device memory exists to recover it.

---

## 7. Recommendation

```text
GO
```

All deterministic checks pass. The cold harness, given only the workspace and
the prior cursor, named the other participant's changes, the actor, the
current consequence, the orientation hint, the resume cursor, and the window
state, and treated neither the cursor nor the hint as permission to execute.
The sprint stayed within the caller-supplied cursor and the existing
projection: no schema, no read receipt, no notifications, no writable Viewer,
no orchestration. Sprint 011 remains the next directional contract.
