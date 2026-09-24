# Campfire — Sprint 009 Result

**Status:** Complete
**Sprint:** 009 — Align Before Execution
**Date:** September 24, 2026
**Company:** Boring Infra Co.
**Depends on:** Sprint 008 — Enter the Room (**GO**)
**Recommendation:** **GO**

---

## 1. Result

Sprint 009 asked:

> Can humans and agents establish and retrieve a shared, provenance-backed
> execution boundary before implementation begins?

As amended, that boundary is the recorded alignment boundary: `open`,
`established`, or `unspecified`. It describes what the team has recorded. It is
not permission to execute, and it does not prove agreement.

Yes. `get_workspace_context` now derives that boundary from existing decision
and task status. A cold Codex process, with no transcript and an empty
workdir, named the accepted constraint, the remaining proposal, the superseded
decision as not current, the blocked task as independently unresolved, and the
status `open`. It did not claim permission to execute.

Alignment latency is diagnostic. There is no pass/fail threshold. External
line-level timing measured **5,879 ms** from the first successful
`get_workspace_context` response to the correct alignment statement. Total
process duration was 22,809 ms and is reported separately.

No schema, authorization policy, task-readiness field, execution permission,
orchestration, or writable Viewer behavior was added.

---

## 2. What landed

| Surface | Behavior |
| --- | --- |
| Application service | One pure `deriveRecordedAlignment` on `WorkspaceContext.alignment`. `open` if any proposal exists, `established` if accepted decisions exist and no proposal does, `unspecified` otherwise. Superseded decisions are omitted and never establish the boundary. `unresolvedBlockedTaskIds` lists blocked tasks with no cause link |
| Sync and async | `campfire-service` and the Workers `async-service` call the same function |
| CLI | `show` prints `Recorded alignment boundary`, the status, the fixed sentence that this is not permission to execute, and the proposed, accepted, and unresolved blocked items |
| MCP / HTTP | `get_workspace_context` returns the same `alignment` object |
| Viewer | Read-only "Recorded alignment" panel. It displays the service status and does not recompute it. Writes stay rejected |

Id lists are ordered by `updatedAt`, then `id`. `needsYou`, `needsAttention`,
`currentWork`, and `suggestedNextAction` are unchanged.

---

## 3. Validation matrix

```text
npm run typecheck          PASS
npm test                   PASS — 25 files, 292 tests
npm run test:acceptance    PASS — 8/8
npm run acceptance         GO — 19/19 checks
npm run build              PASS
```

Deterministic coverage includes `open` with proposals (including alongside
accepted decisions), `established` with accepted decisions and no proposals,
`unspecified` with no decisions, `unspecified` when the only decisions are
superseded, blocked tasks listed independently of proposals, unchanged
`needsYou` / `needsAttention` for an owner versus a viewer, one contribution
on accept and none on context read, and the same `alignment` fields from the
sync service, async service, HTTP, and MCP. CLI `show` states `open` and
`established`. The Viewer helper renders the projected status and rejects a
missing projection instead of inventing one. Viewer `add_decision` still
returns 403 `Viewer is read-only`.

Manual CLI check on a temporary workspace:

- proposals plus an accepted decision and a blocked task: `status: open`, with
  the proposal, the accepted decision, and the blocked task listed separately;
- a workspace with no decisions: `status: unspecified`.

The Viewer HTTP read of that same workspace returned:

```json
{
  "status": "open",
  "proposedDecisionIds": ["dec_000002"],
  "acceptedDecisionIds": ["dec_000001"],
  "unresolvedBlockedTaskIds": ["task_000001"]
}
```

No headless Chrome was installed, and a Safari automation attempt did not
return a rendered DOM. Layout at desktop and mobile widths was not
screenshot-verified. The panel reuses the existing orientation grid, including
the single-column breakpoint, and the read path above is what the panel
renders.

---

## 4. Cold real-harness evaluation

- Harness: real `codex-cli 0.150.1`, fresh ephemeral process, read-only
  sandbox, empty workdir, no transcript or handoff.
- Identity: agent `agt_000001` (Codex), session injected through the MCP
  environment. The decisions and the blocked task were recorded by human
  `hum_000001`. The prompt named the six questions and the legal status words.
  It did not name ids, summaries, or which status applied.
- Exit: 0. Campfire MCP calls: 3 (`list_workspaces`, `get_workspace`,
  `get_workspace_context`). Non-Campfire tools: 0. Write tools: 0.
  Contribution count stayed 12.
- First `get_workspace_context` response: 15,875 ms after process start.
- Correct alignment statement: 21,754 ms after process start.
- **Alignment latency (diagnostic): 5,879 ms.** No threshold.
- Total process duration: 22,809 ms, recorded separately.
- Calls after the first context response: 0. The 5,879 ms is model synthesis.
- The context payload contained `alignment.status = "open"` and the exact id
  sets. The statement is traceable to that read.

Accuracy against the pre-run snapshot, 4 of 4 buckets:

| Bucket | Ground truth | Cold statement |
| --- | --- | --- |
| Accepted | `dec_000001` Ack ledger webhooks within 2 seconds through the queue worker. | Named as the accepted constraint |
| Proposed | `dec_000002` Store idempotency keys in a durable table keyed by provider event id. | Named as still proposed. The summary's last word was capitalized (`ID`) |
| Superseded, excluded | `dec_000003` Deduplicate ledger posts only in process memory. | Named, and stated not a current constraint |
| Unresolved blocked | `task_000001` Ship the ledger writer change. | Named, and Campfire does not record the proposal as the cause |

The statement also said the recorded boundary does not grant permission to
execute. It did not start implementation.

Evidence: `evidence/sprint-009/cold-harness.md` (private, gitignored). Raw
capture remains at `/tmp/campfire-sprint-009-LyNISX`.

---

## 5. Architecture and scope

- No schema or migration changed.
- No `Alignment` object, relationship, or lifecycle was added.
- No authorization policy changed.
- No per-task readiness field and no permission-to-execute field.
- No accept, supersede, approve, or execute action was added. Accept remains
  the existing command.
- No Viewer writes. The read allowlist is unchanged.
- No orchestration, scheduling, notifications, or execution dispatch.
- No Sprint 010 work.

The conditional rubric clause says a sprint can be conditional when the
per-task boundary remains unanswerable and the work is limited to the recorded
workspace boundary. That limit was accepted before implementation as a
non-goal, not discovered as a miss. The accepted GO bar is the recorded
workspace boundary, and this run meets it. Per-task readiness stays parked.

---

## 6. Limitations

1. Alignment latency is one fresh run, one harness, and one model. Parent
   arrival timing has no variance estimate. This contract defines no latency
   threshold.
2. Setup populated the workspace through the application service. That is not
   a handoff. The superseded row was then marked through the store, because
   no supersede command exists. Current state and the projection show
   `superseded`. That status change has no contribution record.
3. The cold run used one workspace whose boundary was `open`. `established`
   and `unspecified` were checked deterministically and on the CLI, not by a
   second cold process.
4. Semantic matching can false-pass. Here the decision and task ids matched
   exactly. One summary word differed only in capitalization.
5. The entrant was a participant agent who could have called `accept_decision`.
   It did not. This run does not prove a viewer-role cold entry.
6. Viewer rendering was checked through the HTTP projection, the read-only
   rejection, and the sandbox tests. It was not checked as a painted page at
   two viewport sizes.

---

## 7. Recommendation

```text
GO
```

The recorded boundary is deterministic, shared across the service, CLI, MCP,
HTTP, Workers, and the read-only Viewer, and a cold agent reported it without
treating a missing proposal as agreement or the boundary as permission to
execute. Stop here. Sprint 010 is not started.
