# Campfire — Sprint 008: Enter the Room

**Status:** Contract — implementation not started; requires explicit acceptance
**Date:** September 24, 2026  
**Company:** Boring Infra Co.  
**Depends on:** Sprint 007 — Harness Readiness Preflight (**GO**)  
**Primary metric:** Time to Context  

---

## 1. Sprint question

> Can a human or agent enter an active Campfire workspace with no prior
> transcript and correctly understand the state of the work within 30 seconds?

The workspace—not the session—is the durable unit. Campfire owns shared
understanding, not execution. Agents execute elsewhere and meet at Campfire.

This sprint improves the existing orientation projection and the read-only
Viewer. It does not add a new domain object, schema, or runtime.

Measurement scope: agent Time to Context is measured with a real cold harness.
Human Time to Context is diagnostic only; Viewer comprehension is validated
structurally through deterministic derivation and review, not behaviorally, in
Sprint 008.

---

## 2. Cold-entry questions

A cold entrant must be able to answer, from Campfire state alone:

1. What are we trying to accomplish?
2. Who is participating?
3. What has happened?
4. What have we learned?
5. Which decisions constrain the work?
6. What is blocked or awaiting attention?
7. What should happen next?

---

## 3. Baseline audit

Audited against a populated workspace built through the product on a temporary
database, using `get_workspace_context`, `get_workspace`, `get_activity`, and the
Viewer data path. The deterministic seed fixture leaves the billing workspace
empty, so the audit populated goal, findings, proposed and accepted decisions,
tasks in all four states, and artifacts through CLI writes.

| Question | Baseline | Carrier | Gap |
| --- | --- | --- | --- |
| 1. Accomplish | ANSWERABLE | `WorkspaceContext.goal` (`src/service/service.ts:189-203`; `src/service/campfire-service.ts:346-378`) | Goal description present in JSON, not rendered in human CLI |
| 2. Participating | ANSWERABLE | `WorkspaceContext.participants[]` with role, harness, human owner (`campfire-service.ts:361`) | None material |
| 3. Happened | PARTIAL | `provenance[]` raw contributions, capped at 20 (`campfire-service.ts:353-357`) | No narrative summary; `provenanceSummary` exists only on `get_workspace` (`campfire-service.ts:342`); truncation has no recency anchor |
| 4. Learned | PARTIAL | `WorkspaceContext.findings[]` with summary, detail, confidence (`src/domain/types.ts:127-134`) | CLI prints id and summary only (`src/cli/index.ts:373-376`); confidence never surfaced |
| 5. Decisions | ANSWERABLE | proposed, accepted, superseded decisions (`service.ts:193-195`) | Rationale hidden behind Viewer detail; no decision-to-task linkage |
| 6. Blocked / attention | PARTIAL | `openTasks[]` status and `proposedDecisions[]` (`campfire-service.ts:362-371`) | No blocked/attention grouping or ordering; Viewer `kindLabel` collapses task and decision states (`src/viewer/static/app.js:125-140`) |
| 7. Next action | MISSING | No projection field | Must be inferred; `nextAction` exists only as an error hint (`campfire-service.ts:211-216`) |

### Viewer 002 baseline

Viewer 002 is the current read-only team journal. It fetches
`get_workspace_context` (`src/viewer/static/app.js:544-549`) and the activity
stream, and its allowlist is unchanged (`src/viewer/server.ts:31-37`). The first
screen renders people, goal, and stream (`app.js:288-311`), so the fetched
context beyond goal and participants is unused. Viewer 003 is the proposed
human entry surface; Viewer 002 is its baseline.

### Lifecycle baseline

| Object | Existing states | Transition handling |
| --- | --- | --- |
| Workspace | `active`, `completed`, `archived` | Explicit guard in `src/domain/lifecycle.ts:23-27` |
| Goal | `active`, `completed`, `abandoned` (`src/domain/types.ts:18`) | No explicit transition guard in `lifecycle.ts`; status is set through `update_goal` |
| Task | `open`, `in_progress`, `blocked`, `completed` | Explicit guard in `lifecycle.ts:10-15` |
| Decision | `proposed`, `accepted`, `superseded` | Explicit guard in `lifecycle.ts:17-21` |
| Finding | No lifecycle status; summary, detail, confidence | No lifecycle transitions |
| Artifact | No lifecycle status; type, title, uri | No lifecycle transitions |
| Participant | `owner`, `member`, `agent`, `viewer` | Membership is join/invite based; no leave/removal lifecycle |
| Agent session | `startedAt`, optional `endedAt` | Register/end only |

The baseline audit populated each lifecycle state through the product, including
a blocked task, a proposed decision, and an accepted decision.

### Baseline gaps

- No deterministic attention model for blocked tasks, proposed decisions, or
  caller-assigned work.
- Agent orientation lacks `provenanceSummary` and a recency cursor.
- `openTaskCount` conflates blocked with open (`campfire-service.ts:311-313`).
- Viewer already fetches `get_workspace_context` (`app.js:544-549`) but renders
  only goal and participants; the needed state is present and unused.
- "Needs You", "Needs Attention", "Since You Were Here", and "Current Work" do
  not exist.

### Derivability

| Surface | Derivable without schema? | Basis |
| --- | --- | --- |
| Needs You | Yes | Items the current actor is authorized to act on: proposed decisions it may accept, and blocked/open tasks assigned to it |
| Needs Attention | Yes | Team-level items the actor cannot act on directly: proposed decisions it may not accept, unassigned blocked tasks |
| Current Work | Yes | in-progress and blocked tasks + accepted decisions + goal |
| Since You Were Here | Partial | `Contribution.createdAt`; client-held cursor needs no schema change; durable server cursor or `read` contributions would require schema and are out of scope |

Authorization-aware attention: an item is labeled "Needs You" only when the
existing authorizer would allow the current actor to perform the relevant
operation (for example, `decision:update` to accept a proposed decision, or
`task:update` for a task). If the actor cannot act on the item, it is labeled
"Needs Attention." No new authorization policy is introduced.

---

## 4. Smallest implementation

The baseline shows the entry surfaces are derivable without new schema, so
Sprint 008 adds no schema. If implementation later demonstrates a hard
requirement, stop and amend this contract rather than adding schema silently.
Derive one shared attention model in the application service and render it in
both surfaces.

Agent projection:

- extend `WorkspaceContext` with deterministic derived sections for
  authorization-aware `needsYou`, team-level `needsAttention`, `currentWork`,
  and a rule-based `suggestedNextAction`;
- label an item "Needs You" only when the existing authorizer allows the current
  actor to act on it; otherwise use "Needs Attention";
- compute `suggestedNextAction` as an orientation hint, never an instruction to
  execute, using this precedence and stable tie-breaker:
  1. actionable proposed decision the caller is authorized to accept;
  2. caller-assigned blocked task;
  3. caller-assigned open task;
  4. team-level attention item (unassigned blocked task, then proposed decision
     the caller may not accept, then oldest open task);
  5. no suggestion when none of the above exists.
  Ties resolve by oldest `updatedAt`, then by object id.
- include `provenanceSummary` by reusing existing `describeContribution`;
- support an optional caller-supplied cursor for recency;
- keep sync, async/Workers, HTTP, and MCP projections at parity.

Human Viewer 003:

- render "Needs You", "Needs Attention", "Current Work", and
  "Since You Were Here" from the already-fetched context;
- show "Needs You" only for items the current viewer actor is authorized to act
  on outside the Viewer; use "Needs Attention" otherwise;
- distinguish open, in-progress, blocked, proposed, accepted, and superseded
  states;
- keep the Viewer read-only with the existing allowlist;
- store a client-side last-seen cursor only; do not persist read state on the
  server.

Do not duplicate attention rules in the Viewer; both surfaces consume one
service-derived projection.

---

## 5. Acceptance criteria

Deterministic:

- A populated workspace built through the product returns, from one
  `get_workspace_context` call, goal, participants, distinct blocked tasks,
  distinct proposed decisions, current work, and a deterministic next action.
- "Needs You" contains only items the caller is authorized to act on; items the
  caller cannot act on appear under "Needs Attention".
- `suggestedNextAction` follows the documented precedence and tie-breaker and
  is labeled as an orientation hint, not an instruction.
- `provenanceSummary` appears in the context projection.
- Viewer derivation functions produce "Needs You", "Needs Attention",
  "Current Work", and "Since You Were Here" from a synthetic context and cursor,
  including an empty first visit.
- No schema or migration change; `VIEWER_READ_METHODS` unchanged; Viewer still
  rejects writes.
- Existing service, HTTP, MCP, worker, Viewer, seed, and acceptance suites pass.

Real-harness:

- A cold agent process with no transcript or handoff, given only the workspace,
  calls `get_workspace_context` and states the goal, a blocked task, a proposed
  decision, and a next action.
- Time to Context is recorded from first Campfire read to the correct context
  statement, along with orientation call count.
- Transcript-isolation and workspace-isolation checks remain unchanged.
- Limitations are recorded honestly, including that the populated setup is
  setup, not a handoff.

Measurement honesty:

- Agent Time to Context is measured from first Campfire read to the correct
  context statement by the real cold harness.
- Human Time to Context is diagnostic, not a behavioral gate. Sprint 008
  validates Viewer comprehension structurally through deterministic derivation
  and review; it does not claim a measured human 30-second result.

Cross-surface:

- Agent and Viewer expose the same bounded understanding from one derived
  source.

---

## 6. Doctrine

> The workspace—not the session—is the durable unit.

> Campfire owns shared understanding, not execution.

> Agents execute elsewhere and meet at Campfire.

Campfire is not an agent harness, shared IDE, cloud sandbox, agent chat,
orchestration engine, or replacement for GitHub or existing coding tools.

---

## 7. Out of scope

- Schema or migration changes.
- New domain objects, including an `Alignment` object.
- Durable server-side read cursors or recorded `read` contributions.
- Viewer writes or writable Viewer functionality.
- Orchestration, scheduling, delegation, capability management, presence,
  notifications, chat, or execution ownership.
- Automatic execution or dispatch of `suggestedNextAction`; it is an
  orientation hint only.
- Embeddings, semantic retrieval, or organizational memory.
- Changes to authorization policy.
- Field Trace 001 gate claims.
- Sprint 009–011 implementation.

Any writable Viewer functionality requires a separate explicit sprint
authorization.

---

## 8. Definition of done

Sprint 008 is complete only when:

1. The existing projection answers all seven cold-entry questions.
2. Agent and Viewer surfaces share one derived understanding.
3. Agent Time to Context and orientation calls are measured by the cold real
   harness; human Time to Context is recorded as diagnostic only.
4. Blocked tasks, proposed decisions, and next action are unmistakable without
   transcript access, and "Needs You" is authorization-aware.
5. Viewer 003 remains read-only and authorization-scoped.
6. No schema, domain-object, orchestration, or unrelated product work is added.
7. A result document records evidence, limitations, and the next decision.

Implementation begins only after this contract is reviewed and explicitly
accepted.
