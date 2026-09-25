# Campfire — Sprint 012: Close the Workspace

**Status:** Complete (**GO**) — see `SPRINT_012_RESULT.md`
**Date:** September 25, 2026
**Company:** Boring Infra Co.
**Depends on:** Sprint 011 — Natural Contribution (**GO**)
**Primary metric:** Workspace-closure accuracy. Timing and tool-call count are diagnostic; this contract defines no pass/fail latency or call-count threshold.

---

## 1. Sprint question

> Can an authorized human or agent recognize when a workspace's recorded work
> is genuinely finished, close it explicitly, and leave its outcome and
> history available to later participants?

Sprint 011 completed the Goal and Task, attached the earned Artifact, recorded
the durable Finding, and left no proposed Decision or next action. The cold
downstream agent correctly reported that no further work was required. The
Workspace itself nevertheless remained `active`.

That mismatch is the evidence for this sprint:

```text
Goal completed
Tasks completed
No proposed decision
No suggested next action
        |
        v
Workspace still active
```

Here "close" means an authorized participant deliberately transitions the
Workspace from `active` to `completed` after reading the recorded state. It
does not mean deleting, archiving, hiding, summarizing, or automatically
inferring success.

A completed Workspace remains readable. Its Findings, Decisions, Tasks,
Artifacts, participants, Contributions, provenance, and return cursor remain
available. Completion records what the team says about the workspace lifecycle;
it does not prove that the outcome was objectively successful.

`archived` remains a separate, terminal retirement action. Sprint 012 does not
archive the scored workspace.

---

## 2. Baseline audit

Audited at commit `c51991d` across the domain, lifecycle, application services,
MCP, HTTP, Workers, CLI, Viewer, and Sprint 011 evidence.

| Question | Baseline | Evidence |
| --- | --- | --- |
| Does Workspace already have lifecycle state? | Yes: `active`, `completed`, `archived`. | `src/domain/types.ts:17,90-99` |
| Which transitions are valid? | `active → completed|archived`; `completed → active|archived`; `archived` is terminal. Same-state updates are accepted. | `src/domain/lifecycle.ts:23-27,29-43` |
| Is completion exposed to agents? | Yes. `update_workspace` accepts a Workspace id and status, but its description only says it performs an explicit transition. | `src/mcp/tools.ts:179-189` |
| Is completion provenance-backed? | Yes. `updateWorkspace` authorizes `workspace:write`, validates the transition, updates current state, and records one Workspace Contribution with the new status. | `src/service/campfire-service.ts:507-523`; `src/worker/async-service.ts:545-562` |
| Who may close a Workspace? | Any participating owner, member, or agent under the current simple policy; viewers are denied. Unlike the collaboration-object write methods, `updateWorkspace` does not call the agent-session guard, so a participating agent without a registered session can currently change Workspace status. | `src/service/simple-authorizer.ts:20-31,88-108,142-168`; `src/service/campfire-service.ts:507-508,1059-1062,1174-1180` |
| Is completion visible later? | Yes. Workspace status is returned by list, full view, compact context, CLI, HTTP, MCP, Workers, and Viewer reads. | `src/service/campfire-service.ts:526-605`; `src/cli/index.ts:504-559` |
| Is completed state reversible? | Yes. A completed Workspace may be explicitly reopened to `active`; archived may not be reopened. | `src/domain/lifecycle.ts:23-27`; `tests/unit/service.test.ts:599-612` |
| Does completion erase history? | No. Objects and Contributions remain stored and readable. Completion appends a lifecycle Contribution. | `src/service/campfire-service.ts:515-523,545-614`; `tests/unit/service.test.ts:573-597` |
| Does Campfire decide when completion is truthful? | No. The service validates only the lifecycle edge, not Goal, Task, or Decision state. | `src/service/campfire-service.ts:507-518` |
| What happened in Sprint 011? | Goal and Task became `completed`, the downstream agent found no next action, but the Workspace stayed `active`. | `docs/SPRINT_011_RESULT.md` |

### Existing recorded signals

The current projection already provides the information needed for the scored
case:

- `workspace.status`;
- the current Goal and its status;
- `openTasks`;
- `proposedDecisions`;
- `alignment`;
- `needsYou` and `needsAttention`;
- `currentWork`;
- `suggestedNextAction`;
- recent provenance and the resume cursor.

No new closure projection is required to test whether an agent can interpret
those explicit fields.

### Truthful closure rule for the scored case

The Sprint 012 fixture is ready to close only when all of these recorded facts
hold at the same observation:

```text
workspace.status == active
goal.status == completed
openTasks.length == 0
proposedDecisions.length == 0
alignment.unresolvedBlockedTaskIds.length == 0
suggestedNextAction.kind == none
```

This is an acceptance rule for the controlled fixture, not a new universal
domain invariant. Real teams may intentionally keep a Workspace active after a
Goal completes, or complete one for reasons not represented by this fixture.
Campfire must not silently force either choice.

### Baseline gaps

- `update_workspace` exposes lifecycle mechanics but gives an agent no guidance
  about `completed` versus `archived`, truthful closure, or history retention.
- A quiet Workspace is not necessarily a finished Workspace. No tasks and no
  suggested action can coexist with an active or missing Goal.
- The existing lifecycle tests prove transitions and provenance, not whether a
  real agent selects the correct transition from workspace state.
- `list_workspaces` includes completed and archived work alongside active work;
  there is no status filter. This sprint does not need one to prove closure.
- The service permits `active → completed` while open Tasks or proposed
  Decisions exist. Sprint 012 tests agent judgment; it does not introduce a
  service-level completion policy from one controlled trace.
- Workspace lifecycle writes are the exception to the established agent-write
  rule: sync and Workers `updateWorkspace` omit `requireAgentSession`, so an
  agent contribution may lack session provenance.

### Hard requirements parked for explicit review

These are candidates only. Sprint 012 does not implement them.

1. Service-enforced completion prerequisites. They would turn one fixture's
   closure rule into a universal domain policy.
2. A `closure`, `outcome`, `resolution`, or `checkpoint` object or projection.
3. A required completion summary or automatic final report.
4. Automatic Workspace completion when Goal or Tasks become terminal.
5. Workspace-list filtering, retention policy, deletion, or archival automation.
6. Human-only completion authority or a new approval workflow.

If the real trace demonstrates one of these as a hard requirement, stop and
amend this contract rather than adding it silently.

---

## 3. Smallest implementation

Keep the existing Workspace lifecycle and `update_workspace` operation. Make
two narrow changes:

1. Require an active registered agent session for Workspace lifecycle writes in
   both the sync and Workers services, matching the existing collaboration-
   object write boundary.
2. Improve the agent-facing MCP description so the lifecycle choice is
   understandable at tool-selection time.

The description should communicate, concisely:

- use `completed` only after inspecting the Workspace and determining that its
  recorded Goal is finished and no recorded work or proposal remains;
- completion is explicit and preserves the Workspace and history;
- use `active` for ongoing or deliberately reopened work;
- `archived` is terminal retirement, not the normal synonym for completed;
- never infer that quiet state alone grants permission or proves success.

Do not add a new service method, domain object, projection, status, database
column, migration, model call, background process, or automatic transition.
HTTP and Workers must enforce the same session-bound lifecycle semantics as the
local service. CLI and Viewer behavior remain unchanged.

The implementation may add a focused fixture, pure evaluator, deterministic
tests, and real-harness prompts for this sprint. Tests should validate lifecycle
outcomes, authorization, provenance, history retention, and agent selection—not
exact descriptive prose beyond the required semantic boundaries.

### Closure-review instruction boundary

The scored closer receives:

- the Workspace id;
- access to the normal Campfire tools;
- one neutral request to review whether the Workspace should remain active and
  keep its lifecycle truthful.

It does **not** receive:

- the expected lifecycle status;
- a checklist of Goal, Task, Decision, or orientation fields;
- the `update_workspace` tool name;
- a required number of reads or writes;
- a completion summary or handoff;
- permission to archive or delete anything.

The scored Workspace begins in the exact post-work shape defined above. A
separate deterministic matrix covers incomplete and ambiguous states without
requiring repeated paid harness runs.

---

## 4. Acceptance criteria

### Deterministic lifecycle matrix

- The post-work fixture satisfies every recorded closure signal while the
  Workspace remains `active`.
- An authorized participant can transition that Workspace to `completed` and
  exactly one Workspace update Contribution records the actor, agent session,
  Workspace id, `status: completed`, and time.
- After completion, `get_workspace`, `get_workspace_context`, `get_activity`,
  and `list_workspaces` still expose the Workspace and its prior Goal, Tasks,
  Findings, Decisions, Artifacts, participants, and Contributions.
- A completed Workspace can be explicitly reopened to `active`, producing one
  new Contribution. The scored real-harness run does not reopen it.
- `archived` remains terminal; an archived Workspace cannot return to `active`
  or `completed`.
- A viewer and non-participant cannot change Workspace status. An agent without
  an active registered session cannot close it.
- Counterexamples remain `active` in the evaluator: an active or missing Goal,
  any open/in-progress/blocked Task, any proposed Decision, or a non-`none`
  suggested next action. Deterministic evaluation must not equate quietness
  alone with completion.
- Existing transcript isolation, workspace isolation, lifecycle, HTTP, MCP,
  Workers, CLI, Viewer read-only, and acceptance tests remain green.

### Cold real-harness closer

- A fresh agent process receives only the closure-review instruction boundary
  above.
- It reads the Workspace before writing and cites the recorded state supporting
  its conclusion.
- It selects `completed`, not `archived`, and calls the existing lifecycle
  operation exactly once.
- It makes no unrelated object writes, does not rewrite the Goal or Tasks, and
  does not create a redundant summary, Finding, Artifact, or Decision.
- It does not claim that the state proves objective success or that completion
  grants permission to execute anything.
- The resulting lifecycle Contribution carries the closer's correct actor and
  agent-session provenance.

### Cold downstream retrieval

- A second fresh process using a different harness receives only the Workspace
  id after closure. It receives no closer transcript or closure summary.
- It reports the Workspace as `completed`, names the completed Goal and Task,
  recovers the durable Finding and Artifact, and reports that no proposal or
  next action remains.
- It identifies who closed the Workspace from the contribution history.
- It does not write, archive, reopen, or claim that completed state erased the
  prior history.

---

## 5. Measurement plan

- **Closure accuracy:** score the selected Workspace status against the
  predeclared fixture state and deterministic counterexample matrix.
- **History retention:** compare object ids and Contributions before and after
  completion. Completion must add one lifecycle Contribution and remove none.
- **Provenance:** verify the lifecycle Contribution's actor, agent session,
  Workspace, action, object, payload, and time.
- **Selectivity:** report unrelated or redundant writes. The successful scored
  closer performs one lifecycle mutation only.
- **Downstream usefulness:** score the second harness's statement against the
  post-close snapshot, including closer attribution and retained outcome state.
- **Friction:** report reads, writes, failures, retries, and human interventions.
  Tool-call count is diagnostic except for the one expected lifecycle mutation.
- **Timing:** report closer orientation, closure, and downstream synthesis
  intervals separately. This contract defines no pass/fail latency threshold.
- **Limitations:** one positive real-harness closure case, one downstream
  harness, deterministic negative cases, and no variance estimate. This does
  not prove external retention, PMF, or a universal completion policy.

Human interventions after each initial prompt are classified as:

```text
operational
clarification
context leakage
manual handoff
```

Any `context leakage` or `manual handoff` is material to the recommendation.

---

## 6. Non-goals

- Automatic or inferred Workspace completion.
- Service-enforced completion prerequisites from the fixture rule.
- A new lifecycle status, Closure/Outcome/Resolution object, checkpoint, or
  completion projection.
- A required final summary, generated retrospective, or transcript-derived
  outcome.
- Automatic archival, deletion, retention rules, or hiding completed work.
- Workspace-list filtering, search, sorting, or pagination.
- Changing current roles or adding human approval for completion.
- A writable Viewer or Viewer lifecycle control.
- Cross-workspace retrieval, related-work discovery, or organizational memory.
- Notifications, subscriptions, presence, analytics, or orchestration.
- Claiming Gate B or Gate C external behavioral evidence from this controlled
  founder-led trace.
- Replacing or delaying the future design-partner release as the source of
  external PMF evidence.
- Sprint 013 implementation.

---

## 7. Rubric

- **GO:** all deterministic checks pass. The cold closer reads the genuinely
  finished Workspace, explicitly marks it `completed` exactly once, preserves
  all prior state and history, records correct provenance, performs no unrelated
  writes, and does not archive or overclaim success. A second cold harness
  retrieves the completed outcome and closer attribution from Campfire alone.
- **CONDITIONAL GO:** completion and history retention are correct, but the
  closer needs one lifecycle clarification, performs one harmless redundant
  read or write, or the downstream agent needs an extra Campfire read to find
  the closer. Address only the observed interface friction; do not add automatic
  completion, schema, or a universal closure policy.
- **NO-GO / REFRAME:** the closer leaves the finished Workspace active, archives
  it, closes an incomplete counterexample, mutates unrelated objects, loses or
  obscures history, records incorrect provenance, or needs a prescribed tool
  call or manual summary. Also NO-GO if success requires automatic inference,
  deletion, a writable Viewer, cross-workspace memory, or orchestration.

Implementation begins only after this contract is reviewed and explicitly
accepted.
