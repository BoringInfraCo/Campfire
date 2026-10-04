# Campfire v1.10 — Keep Shared Understanding Current

**Sprint ID:** CTX-001  
**Release:** v1.10.0  
**Status:** Proposed  
**Priority:** P0  
**Depends on:** v1.9–v1.9.3 shipped  
**Theme:** Bounded orientation, catch-up, drill-down, and deterministic current-state retrieval

---

## 1. Release Thesis

Campfire v1.9 made it possible for additional participants to join existing work.

v1.10 must make that shared workspace remain understandable as it grows.

The problem is no longer only:

> Can another person or agent enter the workspace?

The problem becomes:

> Can a cold or returning participant understand what matters **now** without reading everything that has ever happened?

Campfire should provide a bounded, explicit, deterministic view of current shared work:

```text
What are we trying to do?
        ↓
What do we currently believe?
        ↓
What materially changed?
        ↓
What should happen next?
```

v1.10 turns Campfire context from a growing history dump into a reliable orientation layer.

---

## 2. Current-State Assumptions

This sprint is scoped against the following known state:

- Campfire v1.9 through v1.9.3 are already implemented.
- The second-participant / teammate flow is therefore treated as an existing capability, not part of this sprint.
- Campfire already has structured workspace objects including goals, tasks, decisions, findings, artifacts, participants/sessions, and provenance.
- Prior audit evidence found that compact context bounded some provenance while still including every finding and artifact, and that contribution history could be loaded before limiting.
- This sprint does **not** assume the exact current internal method names or file paths remain unchanged after v1.9.3. Implementation should map the contracts below onto the current codebase rather than restoring old audit-era structure.

The internal repository could not be inspected live while this document was generated, so code-level filenames below are intentionally expressed as responsibilities and interfaces rather than false current-path claims.

---

## 3. Primary Product Question

A completely cold agent enters a workspace containing several weeks of human and agent work.

Without a prepared summary and without receiving the full journal, can it correctly identify:

- the current goal,
- accepted/current decisions,
- important current findings,
- open tasks,
- blockers,
- relevant artifacts,
- what changed recently,
- whether anything has been truncated,
- and the next useful action?

Then a returning agent enters the same workspace.

Can it answer:

> What materially changed since my previous participation?

If both experiences work reliably, v1.10 succeeds.

---

## 4. Goals

### Product goals

1. Make initial workspace orientation small and bounded.
2. Make truncation/completeness explicit rather than silent.
3. Give humans and agents precise drill-down paths from summary to source objects.
4. Let returning participants catch up from a stable cursor/checkpoint.
5. Select context deterministically from Campfire's structured state.
6. Preserve authorization and provenance across every context surface.
7. Keep important current decisions, blockers, and active work discoverable as history grows.
8. Provide the same underlying context contract across CLI, MCP/agent surfaces, and hosted/local execution where applicable.
9. Create evaluation fixtures that prove a cold participant can understand a mature workspace without full-history ingestion.

### Engineering goals

1. Avoid loading unbounded collections merely to truncate them afterward.
2. Add query-level pagination/cursors where lists can grow.
3. Make context budgeting observable and testable.
4. Keep SQLite/local and hosted/D1 behavior semantically aligned.
5. Avoid introducing semantic search or embeddings before structured retrieval is proven insufficient.

---

## 5. Non-Goals

v1.10 does **not** include:

- semantic/vector search,
- embeddings,
- organization-wide memory,
- cross-workspace semantic retrieval,
- AI-generated freeform workspace summaries as source of truth,
- automatic correction of findings,
- decision supersession workflows,
- finding lifecycle/supersession,
- presence indicators,
- live cursors,
- swarm orchestration,
- workflow-engine behavior,
- agent ranking,
- enterprise IAM,
- external integrations unrelated to context retrieval,
- redesigning the entire Viewer,
- replacing existing structured domain objects with a new “memory” abstraction.

Finding correction and explicit supersession belong in the next lifecycle milestone rather than being folded into v1.10.

---

## 6. Core Concepts

v1.10 introduces three explicit context modes:

```text
ORIENT
small, bounded current-state view
        ↓
DRILL DOWN
specific object/list retrieval
        ↓
CATCH UP
what changed since a known cursor
```

These are separate contracts.

### 6.1 Orient

For a cold or newly joined participant.

Answers:

- What is the goal?
- What is active?
- What currently matters?
- What is blocked?
- What is incomplete?
- Where can I drill deeper?

### 6.2 Drill Down

For targeted retrieval after orientation.

Examples:

```text
list current decisions
get decision <id>
list findings for task <id>
get finding <id>
list artifacts related to finding <id>
list open tasks
page through workspace history
```

### 6.3 Catch Up

For a returning participant.

Answers:

- What changed since cursor X?
- What changed since my previous Campfire session/checkpoint?
- Which changes are likely to affect my next action?
- Is the result complete or truncated?

---

## 7. Context Contract

The context response must make completeness explicit.

Conceptual shape:

```ts
type ContextSlice<T> = {
  items: T[]
  total: number
  returned: number
  truncated: boolean
  nextCursor?: string
}

type WorkspaceOrientation = {
  schemaVersion: 1
  workspaceId: string

  goal: GoalSummary | null

  decisions: ContextSlice<DecisionSummary>
  findings: ContextSlice<FindingSummary>
  tasks: ContextSlice<TaskSummary>
  blockers: ContextSlice<TaskSummary>
  artifacts: ContextSlice<ArtifactSummary>
  recentChanges: ContextSlice<ChangeSummary>

  generatedAt: string
  orientationCursor: string

  completeness: {
    fullHistoryIncluded: false
    drillDownAvailable: true
  }
}
```

The exact types should reuse current Campfire domain IDs and status enums.

### Contract requirements

- Every potentially truncated collection includes `total`, `returned`, and `truncated`.
- A caller must never infer completeness from array length.
- Context responses must not silently omit older state without signaling it.
- IDs required for drill-down must be present.
- Authorization must be checked before selection.
- Provenance summaries must not expose information the actor could not retrieve directly.
- Ordering must be deterministic for the same authorized workspace state and context policy.

---

## 8. Orientation Content

The default orientation should contain enough state to act, but not enough history to recreate the workspace.

Recommended conceptual sections:

```text
CAMPFIRE CONTEXT

Goal
Current workspace objective

Current decisions
Accepted/current decisions that affect active work

Current findings
Relevant findings tied to active/current work

Open work
Open and in-progress tasks

Blockers
Blocked work or unresolved dependencies

Relevant artifacts
Artifacts directly connected to current work

Recent changes
Material changes within the recent window

Completeness
Counts, truncation, and drill-down instructions
```

### Example

```text
Goal
Fix intermittent checkout failures

Decisions
Showing 2 of 2
- dec_17: Do not increase DB pool size yet
- dec_22: Investigate cache invalidation next

Findings
Showing 4 of 19
- fnd_31: DB saturation did not correlate with failures
- fnd_35: failures correlate with stale cache entries
...

Tasks
Showing 5 of 11
- tsk_44: inspect invalidation path [in_progress]
- tsk_47: reproduce against staging [open]
...

Recent changes
Showing 8 of 37 since orientation window began

History is not fully included.
Use drill-down or catch-up for additional authorized context.
```

---

## 9. Context Budgets

The system should use explicit budgets rather than implicit/unbounded collection behavior.

Initial defaults should be conservative and treated as policy, not immutable product truth.

Example policy:

```ts
const DEFAULT_CONTEXT_BUDGET = {
  goals: 1,
  decisions: 10,
  findings: 10,
  tasks: 20,
  blockers: 10,
  artifacts: 10,
  recentChanges: 20
}
```

These exact numbers are implementation defaults, not acceptance criteria.

### Requirements

- Budgets live in one policy/configuration layer.
- Tests can override budgets.
- Selection logic receives a budget explicitly.
- Storage queries should apply limits as close to persistence as practical.
- The service must know the total count separately from returned rows.
- Context construction must not fetch an unbounded table just to slice it in memory.
- Changes to default budgets must be easy to evaluate.

---

## 10. Deterministic Selection Policy

v1.10 should use Campfire's structured state before introducing semantic relevance.

The context selector should prefer, in broad order:

### Decisions

1. accepted/current decisions,
2. decisions attached to active work,
3. recent proposed decisions where relevant,
4. historical/non-current decisions only through drill-down unless required for current understanding.

### Tasks

1. blocked,
2. in-progress,
3. open/unassigned,
4. recently completed,
5. older completed work through drill-down.

### Findings

Prefer findings that are:

1. attached to active/in-progress tasks,
2. referenced by current decisions,
3. tied to current blockers,
4. recently contributed,
5. otherwise discoverable via drill-down.

### Artifacts

Prefer artifacts directly referenced by:

- current decisions,
- current findings,
- open/in-progress tasks,
- recent material changes.

### Recent changes

Prefer material domain changes over low-value noise.

Examples of higher-value changes:

```text
decision accepted
task blocked
task unblocked
task completed
new finding added
artifact attached
goal changed/reactivated
participant contributed material work
```

Avoid letting repeated low-information events crowd out meaningful state.

### Determinism requirement

Given:

- the same authorized workspace state,
- the same context policy,
- the same cursor/time boundary where applicable,

the ordered result should be stable.

---

## 11. Material Change Model

Catch-up requires a normalized concept of change.

Introduce or derive a `ChangeSummary` representation from existing provenance/journal records.

Conceptual shape:

```ts
type ChangeSummary = {
  cursor: string
  occurredAt: string
  actorId: string
  actorType: "human" | "agent"
  objectType:
    | "goal"
    | "task"
    | "decision"
    | "finding"
    | "artifact"
    | "participant"
  objectId: string
  changeType: string
  summary: string
  materiality: "high" | "normal"
}
```

Do not create a second canonical history if Campfire already has an append-only provenance/contribution record capable of supporting this.

The preferred implementation is a projection over existing source-of-truth history.

---

## 12. Catch-Up Contract

Catch-up should be cursor-based.

Conceptual API:

```ts
getWorkspaceChanges({
  workspaceId,
  after: cursor,
  limit
})
```

Response:

```ts
type WorkspaceCatchUp = {
  workspaceId: string
  fromCursor: string
  toCursor: string

  changes: ContextSlice<ChangeSummary>

  affected: {
    decisions: string[]
    findings: string[]
    tasks: string[]
    artifacts: string[]
  }

  generatedAt: string
}
```

### Cursor requirements

A cursor must be:

- opaque to callers,
- stable enough for pagination/catch-up,
- scoped to a workspace,
- monotonically ordered for the workspace's change stream,
- rejected if malformed or unauthorized,
- usable across process restarts,
- semantically aligned between SQLite and hosted/D1.

Do not use an in-memory sequence or process-local timestamp as the only cursor.

---

## 13. Returning Participant Experience

When possible, Campfire should know the last successfully acknowledged context/catch-up boundary for a participant or session.

However, v1.10 should not require hidden state for correctness.

At minimum:

```text
campfire catch-up --after <cursor>
```

or equivalent MCP/service call must be explicit and deterministic.

An optional convenience surface may resolve:

```text
since my last session/checkpoint
```

using existing session state if that state is already trustworthy.

### Example

```text
CATCH UP

Since cursor c_01J...

2 findings added
1 decision accepted
1 task completed
1 task became blocked

Important changes

- fnd_35: failures correlate with stale cache entries
- dec_22 accepted: investigate cache invalidation next
- tsk_44 is now blocked by missing staging trace

Showing 4 of 14 material changes.
Next cursor available.
```

---

## 14. Drill-Down Surface

Do not make orientation carry the whole workspace.

Every summarized object should support a direct retrieval path.

The implementation should reuse existing CLI/MCP operations wherever possible.

Required logical capabilities:

```text
list decisions with pagination/filtering
get decision by ID

list findings with pagination/filtering
get finding by ID

list tasks with pagination/filtering
get task by ID

list artifacts with pagination/filtering
get artifact by ID

list history/changes with cursor pagination
```

### Filters

Support only high-value structured filters required by this sprint, such as:

```text
status
task ID
decision ID
finding ID
created/changed after cursor
current/open state
```

Do not turn CTX-001 into a general query language.

---

## 15. CLI Surface

Exact commands may adapt to current v1.9.3 conventions.

Desired logical UX:

```bash
campfire context
campfire context --json

campfire catch-up --after <cursor>
campfire catch-up --after <cursor> --json

campfire decisions list --limit 20 --cursor <cursor>
campfire findings list --limit 20 --cursor <cursor>
campfire tasks list --limit 20 --cursor <cursor>
campfire artifacts list --limit 20 --cursor <cursor>
```

If equivalent commands already exist, extend them rather than duplicating them.

### CLI requirements

- Human-readable output includes truncation/completeness.
- JSON output is stable/versioned enough for agents.
- Cursor values are exposed for continuation.
- Unauthorized objects never appear in counts or summaries.
- Exit behavior remains consistent with current CLI conventions.

---

## 16. MCP / Agent Surface

Agents are a primary consumer.

Expose the same underlying contracts through MCP/service tools.

Recommended logical tools:

```text
get_workspace_context
get_workspace_changes
list_decisions
get_decision
list_findings
get_finding
list_tasks
get_task
list_artifacts
get_artifact
```

Do not create parallel selection logic in MCP handlers.

Architecture:

```text
CLI ─────┐
         │
MCP ─────┼── context service ── selection policy ── stores
         │
Viewer ──┘
```

All surfaces should share the same service-level context and pagination behavior.

---

## 17. Authorization

Context is not a shortcut around object authorization.

For every orientation, list, drill-down, or catch-up request:

1. authenticate actor/session,
2. authorize workspace access,
3. apply object-level/team visibility rules already present,
4. compute counts from the **authorized set**,
5. select/order authorized objects,
6. return only authorized provenance.

### Critical invariant

If an actor cannot retrieve object `X` directly, `X` must not leak through:

- orientation summaries,
- total counts,
- recent-change summaries,
- relationship IDs,
- provenance text,
- catch-up output.

---

## 18. Storage Requirements

### SQLite/local

Add or verify indexed query paths for:

- active/current decisions,
- open/in-progress/blocked tasks,
- findings by relevant relationship/status/time,
- artifacts by relationship/time,
- contribution/change stream after cursor,
- total counts corresponding to paginated queries.

### Hosted/D1

Hosted behavior must match local semantics.

Avoid patterns that:

```text
SELECT all rows
→ hydrate all domain objects
→ sort everything in application memory
→ slice to 10
```

Prefer:

```text
authorized/filterable query
→ deterministic ORDER BY
→ LIMIT + cursor
→ separate/count metadata as needed
```

### Index review

Implementation should profile/query-plan the real schema before adding indexes.

Likely index dimensions include combinations around:

- workspace ID,
- status,
- created/updated sequence,
- relationship foreign keys,
- provenance/contribution sequence.

Do not add speculative indexes unrelated to measured query paths.

---

## 19. Pagination

All growing collections must support pagination at the service/storage boundary.

Cursor pagination is preferred over offset pagination where concurrent writes can make offsets unstable.

Conceptual page:

```ts
type Page<T> = {
  items: T[]
  nextCursor?: string
  hasMore: boolean
}
```

For orientation slices, also expose:

```ts
total
returned
truncated
```

### Requirements

- stable ordering,
- no duplicate rows across consecutive pages,
- no skipped rows under ordinary append-only changes,
- documented behavior if an existing object is mutated while paging,
- cursor validation,
- bounded maximum page size.

---

## 20. No Silent Full-History Reads

This is a release-level invariant.

The context path must not perform an unbounded read of:

- all findings,
- all artifacts,
- all contributions,
- all provenance,
- all tasks,

merely to build the default orientation response.

Tests should fail if default orientation regresses into known full-history query paths.

Implementation may use aggregate counts, limited queries, and targeted relationship lookups.

---

## 21. Evaluation Suite

v1.10 requires product/evaluation fixtures, not only unit tests.

Create deterministic mature-workspace fixtures.

### Fixture A — Small Workspace

Contains:

- 1 goal,
- 2 decisions,
- 3 findings,
- 4 tasks,
- 2 artifacts.

Expected:

- nothing truncated,
- complete orientation,
- no pagination required.

### Fixture B — Mature Workspace

Contains approximately:

- 1 active goal,
- 40+ decisions across statuses/history,
- 100+ findings,
- 100+ tasks,
- 50+ artifacts,
- hundreds of provenance/change records,
- multiple humans and agents,
- old completed work plus current active work.

Expected:

- orientation remains bounded,
- current decisions remain visible,
- blockers remain visible,
- unrelated old history does not dominate,
- counts reveal truncation,
- drill-down can retrieve omitted objects.

### Fixture C — Returning Participant

Create a cursor midway through Fixture B, then append:

- one accepted decision,
- one important finding,
- one blocked task,
- one completed task,
- several low-value/noisy changes.

Expected:

- catch-up includes all high-value changes,
- noise does not crowd out material changes,
- paging remains complete.

### Fixture D — Authorization

Create objects visible to different authorized participants.

Expected:

- orientation counts and summaries do not leak inaccessible objects,
- catch-up does not leak them,
- drill-down rejects them.

---

## 22. Cold-Agent Acceptance Evaluation

The strongest v1.10 eval should use a cold agent with no prior workspace transcript.

Provide only:

1. access to Campfire's v1.10 agent tools,
2. the workspace ID / authorized session,
3. an instruction to continue the work.

The agent should be able to identify:

- current goal,
- current accepted decisions,
- strongest relevant findings,
- current blockers,
- open next work,
- important recent changes,
- which sections are incomplete/truncated,
- what to inspect next.

### Pass criteria

The agent must not need:

- a manually prepared founder summary,
- raw database access,
- complete history dump,
- hidden prompt context describing the workspace.

Record this evaluation as a repeatable fixture/test procedure.

---

## 23. Work Breakdown

### CTX-001A — Contract & Inventory

Audit current v1.9.3 context, list, provenance, session, CLI, MCP, SQLite, and hosted/D1 paths.

Deliver:

- current architecture map,
- retained existing commands/tools,
- identified unbounded reads,
- final v1.10 response schemas,
- context budget policy.

**Exit:** implementation plan is mapped to current code rather than audit-era filenames.

---

### CTX-001B — Paginated Store Queries

Add/normalize bounded store operations for growing collections.

Deliver:

- deterministic ordering,
- limit validation,
- cursor support,
- total/count support where orientation needs it,
- SQLite + D1 parity tests.

**Exit:** the context service no longer needs full-table reads for default orientation.

---

### CTX-001C — Orientation Service

Implement shared service-level `getWorkspaceContext` / equivalent.

Deliver:

- goal,
- decisions,
- findings,
- tasks,
- blockers,
- artifacts,
- recent changes,
- explicit completeness metadata,
- orientation cursor.

**Exit:** a mature workspace produces bounded deterministic context.

---

### CTX-001D — Deterministic Selection

Centralize relevance/order policy over structured Campfire state.

Deliver:

- decision ordering,
- task/blocker ordering,
- finding relevance,
- artifact relevance,
- recent-change materiality,
- policy unit tests.

**Exit:** selection behavior is explainable and stable.

---

### CTX-001E — Catch-Up Stream

Implement cursor-based workspace change retrieval.

Deliver:

- stable workspace cursor,
- `after` query,
- bounded changes,
- affected-object IDs,
- SQLite/D1 semantic parity.

**Exit:** returning participants can retrieve changes without replaying full history.

---

### CTX-001F — Drill-Down & Pagination Surfaces

Extend existing list/get operations rather than creating duplicates where possible.

Deliver paginated/filterable access to:

- decisions,
- findings,
- tasks,
- artifacts,
- change/history records.

**Exit:** every orientation summary has an authorized path to deeper detail.

---

### CTX-001G — CLI & MCP Exposure

Expose orientation, catch-up, cursors, counts, and drill-down through current user/agent surfaces.

Deliver:

- human-readable CLI,
- JSON mode,
- MCP tools,
- shared service implementation.

**Exit:** humans and agents receive semantically equivalent context.

---

### CTX-001H — Mature Workspace Eval Suite

Implement Fixtures A–D and the cold-agent evaluation procedure.

Deliver:

- deterministic seed/builders,
- boundedness assertions,
- authorization assertions,
- pagination assertions,
- catch-up assertions,
- cold-agent evaluation instructions/results template.

**Exit:** v1.10 can be evaluated against realistic workspace growth.

---

### CTX-001I — Performance & Regression

Measure:

- default context query count,
- rows read,
- response size,
- latency on mature fixture,
- local/hosted consistency.

Verify:

- no full-history orientation reads,
- existing v1.9.3 teammate/join flows remain green,
- existing authorization behavior remains green.

**Exit:** shared understanding improves without making normal Campfire startup/context retrieval expensive.

---

### CTX-001J — Docs & Release

Update:

- README/current usage docs,
- MCP/tool docs,
- CLI docs,
- roadmap,
- release notes,
- architecture/context contract documentation.

Document explicitly:

> Campfire context is an orientation view, not the complete workspace history.

**Exit:** users and agents understand how to orient, drill down, and catch up.

---

## 24. Acceptance Criteria

### Orientation

- [ ] Default workspace context is bounded.
- [ ] Goal/current objective is discoverable.
- [ ] Accepted/current decisions are prioritized.
- [ ] Open/in-progress work is prioritized.
- [ ] Blockers are explicit.
- [ ] Relevant current findings are discoverable.
- [ ] Relevant artifacts are discoverable.
- [ ] Recent material changes are included.
- [ ] Every collection reports `total`, `returned`, and `truncated`.
- [ ] Orientation exposes a usable cursor.
- [ ] Same state + policy yields deterministic ordering.

### Storage / performance

- [ ] Default orientation does not load all findings.
- [ ] Default orientation does not load all artifacts.
- [ ] Default orientation does not load complete contribution/provenance history.
- [ ] Growing list queries are bounded at the persistence/service boundary.
- [ ] SQLite and D1 semantics match.
- [ ] Relevant query paths have justified indexes.
- [ ] Maximum page/context sizes are enforced.

### Catch-up

- [ ] Caller can request changes after a cursor.
- [ ] Cursor survives process restart.
- [ ] Cursor is workspace-scoped.
- [ ] Invalid/foreign cursor is rejected.
- [ ] Material changes remain visible in noisy history.
- [ ] Catch-up pagination is stable.
- [ ] Returned `toCursor` can be used for the next request.

### Drill-down

- [ ] Decisions can be listed/paged and fetched by ID.
- [ ] Findings can be listed/paged and fetched by ID.
- [ ] Tasks can be listed/paged and fetched by ID.
- [ ] Artifacts can be listed/paged and fetched by ID.
- [ ] History/change stream can be paged.

### Authorization

- [ ] Orientation does not leak unauthorized objects.
- [ ] Counts do not leak unauthorized objects.
- [ ] Catch-up does not leak unauthorized objects.
- [ ] Relationship IDs do not leak unauthorized objects.
- [ ] Drill-down enforces existing authorization.

### Surfaces

- [ ] CLI exposes orientation.
- [ ] CLI exposes catch-up.
- [ ] CLI exposes completeness/cursors.
- [ ] JSON output is deterministic and documented.
- [ ] MCP/agent tools expose the same core contracts.
- [ ] No duplicate context-selection implementation exists per surface.

### Evaluation

- [ ] Small fixture is complete without truncation.
- [ ] Mature fixture stays within context budgets.
- [ ] Mature fixture preserves critical current state.
- [ ] Omitted content is reachable through drill-down.
- [ ] Returning-participant fixture returns correct changes.
- [ ] Authorization fixture proves no leakage.
- [ ] Cold-agent evaluation succeeds without full-history dump.

### Regression

- [ ] Existing v1.9–v1.9.3 tests remain green.
- [ ] Existing teammate/join flow remains green.
- [ ] Build/typecheck/lint remain green.
- [ ] Clean local bootstrap still works.
- [ ] Hosted/D1 smoke path remains green.

---

## 25. Test Plan

### Unit tests

- budget enforcement,
- deterministic sort policy,
- materiality classification,
- context slice metadata,
- cursor encoding/validation,
- max-page enforcement,
- relationship-aware finding/artifact selection.

### Store tests

For SQLite and D1:

- page 1/page 2 stability,
- count + limited query correctness,
- status filtering,
- after-cursor query,
- concurrent appended records,
- unauthorized row exclusion.

### Service tests

- small orientation,
- truncated orientation,
- active decision prioritization,
- blocker prioritization,
- recent-change selection,
- drill-down links/IDs,
- catch-up.

### Authorization tests

Attempt leakage through:

- counts,
- change summaries,
- relationships,
- provenance,
- cursors,
- object fetches.

### Performance regression

Use mature fixture and establish explicit baselines for:

- context response size,
- query count,
- maximum rows hydrated,
- local latency,
- hosted latency where CI/environment permits.

The goal is to detect future regressions, not prematurely promise a production SLA.

---

## 26. Observability

Add development/test diagnostics sufficient to understand context behavior without exposing workspace content externally.

Useful internal metrics/log fields:

```text
context mode
workspace ID (local logs only under existing logging policy)
budget profile
returned counts
truncated flags
store query count
duration
```

Do not add product telemetry containing workspace content.

If TEL-001 telemetry exists, v1.10 product telemetry should remain coarse and content-free. Candidate aggregate event names may include:

```text
context_requested
catch_up_requested
drill_down_requested
```

Only add these if consistent with TEL-001's established privacy contract.

---

## 27. Migration / Compatibility

Prefer additive schema changes.

Requirements:

- existing workspace data remains readable,
- old v1.9.3 workspaces do not require destructive migration,
- context/cursor metadata can be derived from existing history where possible,
- if a new monotonic sequence is required, define a deterministic backfill/migration path,
- public/API JSON additions should be versioned or backward-compatible according to current Campfire conventions.

Do not rewrite historical contributions solely to support v1.10.

---

## 28. Release Gate

v1.10 should not ship because the new commands exist.

It should ship when this scenario passes:

### Scenario A — Cold participant

A workspace has several weeks of accumulated work.

A new authorized agent gets no prepared summary.

Using Campfire alone, it correctly identifies:

1. the current goal,
2. current decisions,
3. relevant findings,
4. blockers,
5. open work,
6. recent material changes,
7. what is truncated,
8. what it should inspect/do next.

### Scenario B — Returning participant

The agent receives a prior cursor.

Several meaningful and noisy events have occurred.

Using catch-up, it identifies the material changes without replaying full history.

### Scenario C — Trust

A participant lacking authorization to some objects receives no direct or indirect evidence of those objects through orientation, counts, changes, relationships, or provenance.

All three scenarios are release gates.

---

## 29. Definition of Done

Campfire v1.10 is complete when shared work can grow substantially without making workspace entry progressively worse.

The resulting model should be:

```text
Workspace history grows
        │
        ▼
Campfire stores durable structured state
        │
        ├── ORIENT → bounded current understanding
        │
        ├── CATCH UP → changes since a cursor
        │
        └── DRILL DOWN → exact underlying objects/history
        │
        ▼
Human or agent can continue useful work
```

A participant should never have to choose between:

```text
too little context
```

and:

```text
the entire workspace history
```

Campfire should provide the smallest trustworthy view needed to understand and continue the work.

---

## 30. Release Position

Recommended sequence:

```text
v1.9.0
  ↓
v1.9.1
  ↓
v1.9.2
  ↓
v1.9.3
  ↓
v1.10.0 — Keep Shared Understanding Current
  ↓
v1.11 — Correct the Record
```

`v1.10.0` is published. The sequence adopted after that release, including the evidence gate before any visual-understanding release, is in `docs/ROADMAP.md`. This contract does not authorize that later work.

v1.10 is the bridge between **shared participation** and **trustworthy evolving shared knowledge**.

v1.9 answered:

> Can another participant enter and continue the work?

v1.10 answers:

> Can everyone still understand the work after the workspace becomes large?

The next lifecycle milestone can then answer:

> What happens when yesterday's understanding is wrong and needs to be explicitly corrected or superseded?
