# Campfire — Sprint 009: Align Before Execution

**Status:** Complete (GO) — see `docs/SPRINT_009_RESULT.md`
**Date:** September 24, 2026
**Company:** Boring Infra Co.
**Depends on:** Sprint 008 — Enter the Room (**GO**)
**Primary metric:** Recorded alignment accuracy; alignment latency is diagnostic

---

## 1. Sprint question

> Can humans and agents establish and retrieve a shared, provenance-backed
> execution boundary before implementation begins?

Here "execution boundary" means the recorded alignment boundary: what the team
has recorded as proposed, accepted, or unspecified. It is not permission to
execute.

Alignment means the team can see, from Campfire state alone:

- which decisions remain proposed;
- which decisions are accepted and recorded as constraints;
- whether the recorded alignment boundary is `open`, `established`, or
  `unspecified`;
- what remains unresolved.

The recorded boundary describes what the team has recorded. It is not permission
to execute, and it does not prove agreement.

This sprint uses existing Goal, Finding, Decision, Task, Artifact, and
Contribution semantics. It does not add an `Alignment` object, relationships,
schema, approval infrastructure, orchestration, or a planning system.

---

## 2. Baseline audit

Audited at commit `2e88881` across service, CLI, MCP, HTTP, Workers, and the
read-only Viewer.

| Question | Baseline | Evidence |
| --- | --- | --- |
| Goal and intent | Goal exists with `active/completed/abandoned`; no explicit transition guard; returned in the orientation projection | `src/domain/types.ts:18,108-115`; `src/service/service.ts:241` |
| Finding and evidence | Finding exists with summary, detail, confidence, optional `sourceArtifactId`; no status or decision link | `src/domain/types.ts:127-134`; `src/store/schema.sql:102-113` |
| How are proposed decisions visible? | `WorkspaceContext.proposedDecisions`; CLI `show` has a proposed section; Viewer shows proposals through attention items and stream labels, with no dedicated panel | `src/service/service.ts:242`; `src/cli/index.ts:400`; `src/viewer/static/app.js:549-555` |
| What defines task readiness? | Nothing. `ready` exists only as harness readiness (`checkReadiness`), not task readiness | `src/service/campfire-service.ts:437-461`; `src/domain/types.ts:19` |
| Does a blocked task identify its blocker? | No. `updateTask` accepts status/title/description/assignee only; blocked state has no reason or link | `src/service/service.ts:124-131`; `src/domain/lifecycle.ts:10-15` |
| Can accepted constraints be separated from proposals? | Deterministically derivable from `Decision.status` and projection membership; cold-agent comprehension is the sprint question, not yet proven | `src/service/service.ts:242-244`; `src/service/campfire-service.ts:586-594` |
| Are existing primitives sufficient? | Workspace-level signal yes; per-task boundary no | `src/service/campfire-service.ts:356-411` |
| Who may accept a decision? | `decision:update`: owner/member/agent (agent needs an active registered session); viewer denied | `src/service/simple-authorizer.ts:20-31,88-109,142-168`; `src/service/campfire-service.ts:1132-1133` |
| Can a decision be superseded? | Lifecycle and store support it; no service, CLI, MCP, or HTTP surface exposes it | `src/domain/lifecycle.ts:17-21`; `src/service/service.ts:289-324` |
| Is alignment workspace-scoped and transcript-independent? | Yes. Every object carries `workspace_id`; no transcript storage exists | `src/store/schema.sql:2,74-155` |
| MCP / HTTP / Workers parity | The same `get_workspace_context` projection is exposed and dispatched on every surface | `src/mcp/tools.ts:200-208`; `src/http/dispatch.ts:208-213`; `src/worker/async-dispatch.ts:208-213`; `src/worker/async-service.ts:644-652` |

### Baseline gaps

- No execution-boundary primitive: no per-task readiness, no task-to-decision or
  task-to-finding link, no blocked reason.
- Blocked tasks are descriptive (`blocked`) but not explanatory (why, waiting
  on what, unblock condition).
- Accepted vs proposed is coarse but workable; superseded summaries drop rationale
  and approver in the orientation projection.
- Viewer has no dedicated proposed-decisions panel.
- `openTasks` conflates blocked with open; only `currentWork.blockedTasks`
  distinguishes them.
- No durable alignment acknowledgment; no per-decision approver policy.

### Derivative rules that work today

| Rule | Derivation |
| --- | --- |
| Pending alignment exists | `proposedDecisions.length > 0` |
| Actor must resolve a proposal | `needsYou` reason `proposed_decision_actionable` |
| Actor cannot resolve a proposal | `needsAttention` reason `team_proposed_decision` |
| Accepted constraints | `acceptedDecisions` / `currentWork.acceptedDecisions` |
| Work in flight or blocked | `currentWork.inProgressTasks` / `currentWork.blockedTasks` |
| Recency ordering | `updatedAt` then `id` |

### Hard requirements parked for explicit review

These are recorded as candidates only. Sprint 009 does not implement them.

1. Task-to-decision/finding dependency, `blocked_reason`, or
   `blocking_decision_id` for a per-task readiness statement. Requires schema.
2. Finding-to-decision support relation or a generic relationship primitive.
   Requires schema; validate with a real trace first.
3. Durable alignment/read acknowledgment. Requires schema and was out of scope
   for Sprint 008.
4. First-class `Alignment` object. Requires domain and schema change.
5. Supersede surface. Needs no schema change, but requires an explicit product
   and authorization decision about who may supersede and whether a
   superseding decision id is recorded.

If implementation demonstrates any of these as a hard requirement, stop and
amend this contract rather than adding schema or relationships silently.

---

## 3. Smallest implementation

Derive one recorded alignment boundary in the application service and render it
identically across CLI, MCP, HTTP, Workers, and the read-only Viewer.

Deterministic recorded-boundary rule, using existing state only:

- `open`: one or more proposed decisions exist.
- `established`: no proposals exist and at least one accepted decision exists.
- `unspecified`: neither proposed nor accepted decisions exist.
- Superseded decisions never establish the current boundary. A workspace whose
  only decisions are superseded is `unspecified`.

The boundary describes the recorded state, not permission to execute and not
proof of agreement. Sprint 009 does not infer task-level readiness.

Projection additions to `WorkspaceContext`, derived without schema:

- `alignment: { status: "open" | "established" | "unspecified";
  proposedDecisionIds: string[]; acceptedDecisionIds: string[];
  unresolvedBlockedTaskIds: string[] }`;
- blocked tasks remain independently unresolved; the projection does not claim
  that a proposal causes a block;
- reuse `needsYou`, `needsAttention`, `acceptedDecisions`, `currentWork`, and
  `provenanceSummary` rather than duplicating rules;
- keep `suggestedNextAction` authorization-aware and orientation-only.

Surface behavior:

- CLI human output states the recorded boundary and unresolved items.
- Viewer renders the recorded boundary with proposed decisions and blocked work,
  still read-only.
- MCP and HTTP return the same projection; Workers/D1 parity is required.
- No surface offers accept, supersede, approve, or execute actions; accept
  remains the existing explicit command.

---

## 4. Acceptance criteria

Deterministic:

- `get_workspace_context` returns the recorded boundary status and exact
  proposed and accepted decision id sets: `open` with proposals, `established`
  with accepted decisions and no proposals, and `unspecified` with neither.
- A workspace whose only decisions are superseded is `unspecified`; superseded
  decisions never establish the boundary.
- An actor with `decision:update` sees actionable proposals under `needsYou`; a
  viewer or unauthorized actor sees them under `needsAttention`; no policy
  change.
- No per-task readiness field or permission-to-execute field is added; blocked
  tasks are reported as independently unresolved.
- CLI, MCP, HTTP, and Workers return equivalent alignment fields; Viewer renders
  the same status read-only and rejects writes.
- Every alignment-relevant mutation still records exactly one contribution with
  correct provenance.
- Transcript and workspace isolation tests remain unchanged and green.

Cold real-harness:

- A fresh cold agent with no transcript or handoff, given only the workspace,
  correctly names the accepted constraints, the remaining proposals, and the
  recorded boundary status: `open`, `established`, or `unspecified`.
- The agent does not treat superseded decisions as binding, does not claim the
  boundary grants permission to execute, and does not claim a proposal causes a
  blocked task.
- All statements are traceable to Campfire reads; no manual handoff or context
  leakage.
- Alignment latency is measured externally from the first successful
  `get_workspace_context` response to the correct alignment statement, with
  orientation call count and total process duration recorded separately.

---

## 5. Measurement plan

- **Latency:** diagnostic only. Use external line-level timing as in the
  Sprint 008 closure run, report the precise interval, and keep process duration
  separate. This contract defines no pass/fail latency threshold; adding one
  requires an explicit amendment.
- **Accuracy:** deterministic ground truth from the pre-run snapshot; score
  correctly classified items across established, proposed, superseded-excluded,
  and unresolved/blocked buckets.
- **Limitations:** one harness, one model, one workspace, no variance estimate;
  setup is not a handoff; semantic matching can false-pass. Report all of them.

---

## 6. Non-goals

- Schema or migration changes, relationships, or a new domain object.
- An `Alignment` object, approval infrastructure, or approver policy.
- Writable Viewer behavior or any new Viewer action.
- Orchestration, execution dispatch, scheduling, or notifications.
- Automatic acceptance, blocking, or unblocking.
- A generic planning system or task dependency graph.
- Sprint 010–011 implementation.

---

## 7. Rubric

- **GO:** all deterministic checks pass; the cold harness correctly separates
  accepted, proposed, and superseded decisions, reports the recorded boundary
  as `open`, `established`, or `unspecified`, does not claim permission to
  execute, and requires no manual explanation or transcript leakage.
- **CONDITIONAL GO:** separation and boundary reporting are correct, but require
  repeated reads or manual explanation, or the per-task boundary remains
  unanswerable and the sprint is explicitly limited to the recorded
  workspace-level boundary.
- **NO-GO / REFRAME:** cold agents conflate proposals with accepted constraints,
  treat superseded decisions as binding or as establishing the boundary, claim
  the boundary grants permission to execute, or cannot determine the recorded
  status without a handoff; or the sprint attempts task-level readiness without
  first accepting a parked hard requirement in explicit review.

Implementation begins only after this contract is reviewed and explicitly
accepted.
