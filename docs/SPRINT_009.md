# Campfire — Sprint 009: Align Before Execution

**Status:** Contract — implementation not started; requires explicit acceptance  
**Date:** September 24, 2026  
**Company:** Boring Infra Co.  
**Depends on:** Sprint 008 — Enter the Room (**GO**)  
**Primary metric:** Alignment latency and accuracy  

---

## 1. Sprint question

> Can humans and agents establish and retrieve a shared, provenance-backed
> execution boundary before implementation begins?

Alignment means the team can see, from Campfire state alone:

- which decisions remain proposed;
- which decisions are accepted and therefore constrain execution;
- whether work may proceed under the agreed boundary;
- what remains unresolved when it may not.

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
| Can agreed constraints be separated from proposals? | Deterministically derivable from `Decision.status` and projection membership; cold-agent comprehension is the sprint question, not yet proven | `src/service/service.ts:242-244`; `src/service/campfire-service.ts:586-594` |
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
- Agreed vs proposed is coarse but workable; superseded summaries drop rationale
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
| Agreed constraints | `acceptedDecisions` / `currentWork.acceptedDecisions` |
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

Derive one workspace-level alignment boundary in the application service and
render it identically across CLI, MCP, HTTP, Workers, and the read-only Viewer.

Deterministic alignment rule, using existing state only:

- Alignment is **open** when any proposed decision exists in the workspace.
- Alignment is **agreed** when no proposed decision exists.
- A task may be treated as execution-ready only when alignment is agreed and the
  task status is not `blocked`.
- Blocked tasks and open proposals are listed as unresolved, without claiming
  which proposal blocks which task, because no link exists.

Projection additions to `WorkspaceContext`, derived without schema:

- `alignment: { status: "open" | "agreed"; proposedDecisionIds: string[];
  acceptedDecisionIds: string[]; unresolvedBlockedTaskIds: string[] }`;
- reuse `needsYou`, `needsAttention`, `acceptedDecisions`, `currentWork`, and
  `provenanceSummary` rather than duplicating rules;
- keep `suggestedNextAction` authorization-aware and orientation-only.

Surface behavior:

- CLI human output states the alignment status and unresolved items.
- Viewer renders alignment status with proposed decisions and blocked work,
  still read-only.
- MCP and HTTP return the same projection; Workers/D1 parity is required.
- No surface offers accept, supersede, approve, or execute actions; accept
  remains the existing explicit command.

---

## 4. Acceptance criteria

Deterministic:

- `get_workspace_context` returns the alignment status and exact proposed and
  accepted decision id sets; with no proposals the status is `agreed`.
- An actor with `decision:update` sees actionable proposals under `needsYou`; a
  viewer or unauthorized actor sees them under `needsAttention`; no policy
  change.
- No per-task readiness field is invented; the workspace-level rule is asserted
  explicitly, and blocked tasks without a link are reported as unresolved.
- CLI, MCP, HTTP, and Workers return equivalent alignment fields; Viewer renders
  the same status read-only and rejects writes.
- Every alignment-relevant mutation still records exactly one contribution with
  correct provenance.
- Transcript and workspace isolation tests remain unchanged and green.

Cold real-harness:

- A fresh cold agent with no transcript or handoff, given only the workspace,
  correctly names the accepted constraints, the remaining proposals, and
  whether execution may proceed under the workspace-level rule.
- The agent does not treat superseded decisions as binding and does not start
  blocked work before stating the alignment boundary.
- All statements are traceable to Campfire reads; no manual handoff or context
  leakage.
- Alignment latency is measured externally from the first successful
  `get_workspace_context` response to the correct alignment statement, with
  orientation call count and total process duration recorded separately.

---

## 5. Measurement plan

- **Latency:** external line-level timing as used for the Sprint 008 closure
  run; report the precise interval and keep process duration separate.
- **Accuracy:** deterministic ground truth from the pre-run snapshot; score
  correctly classified items across agreed, proposed, superseded-excluded, and
  unresolved/blocked buckets.
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

- **GO:** all deterministic checks pass; the cold harness separates agreed,
  proposed, and superseded decisions, correctly states the workspace-level
  execution boundary, and executes nothing prematurely without manual
  explanation or transcript leakage.
- **CONDITIONAL GO:** separation and boundary statement are correct, but
  require repeated reads, manual explanation, or the per-task boundary remains
  unanswerable and the sprint is explicitly limited to workspace-level
  alignment.
- **NO-GO / REFRAME:** cold agents conflate proposals with agreed constraints,
  treat superseded decisions as binding, or cannot determine the boundary
  without a handoff; or the sprint attempts per-task readiness without first
  accepting a parked hard requirement in explicit review.

Implementation begins only after this contract is reviewed and explicitly
accepted.
