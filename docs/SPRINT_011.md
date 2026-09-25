# Campfire — Sprint 011: Natural Contribution

**Status:** Complete (**GO**) — see `SPRINT_011_RESULT.md`
**Date:** September 24, 2026
**Company:** Boring Infra Co.
**Depends on:** Sprint 010 — Return to the Workspace (**GO**)
**Primary metric:** Contribution accuracy and usefulness. Write timing and tool-call count are diagnostic; this contract defines no pass/fail latency or call-count threshold.

---

## 1. Sprint question

> Can an agent doing ordinary work recognize what belongs to the team and
> contribute that durable state to Campfire without being given a list of
> Campfire write calls or an end-of-session handoff template?

Here "natural contribution" means the agent is given a workspace, a bounded
task, and access to the normal Campfire tools. The work instruction may say to
keep the shared workspace current, but it does not name the objects to create,
the calls to make, or the expected answer.

The agent must decide, from the work itself:

- which newly discovered fact is durable enough to record as a Finding;
- whether the assigned Task is now `in_progress`, `blocked`, or `completed`;
- whether an output should be referenced as an Artifact;
- whether a proposed direction should be recorded as a Decision rather than
  silently treated as accepted;
- what should remain private session detail instead of shared state.

Contribution is part of the work loop, not a transcript export and not a
manual handoff document. The useful state must be visible to a later authorized
participant through the existing workspace projection and contribution log.

This sprint tests the contributor side of the same loop proven by Sprints
008–010:

```text
Enter the workspace
        ↓
Understand recorded alignment
        ↓
Do one bounded unit of work
        ↓
Contribute durable team state
        ↓
A later participant returns and continues
```

---

## 2. Baseline audit

Audited at commit `f22d912` across the domain, application services, MCP,
HTTP, Workers, CLI, authorization, and acceptance tests.

| Question | Baseline | Evidence |
| --- | --- | --- |
| Which write primitives exist? | Goal create/update, Finding create, Decision propose/accept, Task create/update, and Artifact attach are separate operations. | `src/service/service.ts`; `src/mcp/tools.ts:283-389`; `src/http/dispatch.ts:260-308` |
| Can an agent use them? | Yes, after workspace membership and active session checks. Agent writes require a registered session. | `src/service/campfire-service.ts:1059-1256`; `src/service/simple-authorizer.ts:88-108,142-168` |
| Is each write provenance-backed? | Yes. Each meaningful write records one append-only Contribution with actor, optional agent session, object, payload, and time. | `src/domain/types.ts:155-204`; `src/service/campfire-service.ts:1084-1087,1114-1124,1138-1140,1167-1169,1218-1220,1244-1254` |
| Are sync and Workers semantics aligned? | Yes. The async service exposes the same object writes and awaits their contribution records before returning. | `src/worker/async-service.ts:1117-1314`; `docs/SPRINT_010_RESULT.md` |
| Does the agent receive contribution guidance? | Only terse tool descriptions such as “Record a durable finding” and “Record a decision.” They describe mechanics, not when information belongs in each object or what must stay private. | `src/mcp/tools.ts:309-389` |
| Is there a generic contribution endpoint? | No. Writes preserve the lifecycle, authorization, and provenance rules of their domain objects. | `src/service/service.ts:325-342`; `src/http/dispatch.ts:260-308` |
| Can a later participant retrieve the result? | Yes. `get_workspace_context` returns current orientation, recent provenance, and an optional post-cursor delta. Sprint 010 proved a cold agent can resume from it. | `src/mcp/tools.ts:200-208`; `docs/SPRINT_010_RESULT.md` |
| Does the Viewer accept contributions? | No. It remains a read-only journal and rejects write methods before the service. | `src/viewer/server.ts`; `tests/integration/viewer.test.ts` |

### Existing object semantics

| Work result | Existing representation | Important boundary |
| --- | --- | --- |
| A fact learned through investigation | Finding | Record the durable conclusion and useful evidence, not the transcript or scratch reasoning. |
| A change in owned work | Task update | Use the real lifecycle state. Do not mark incomplete work completed. |
| A produced or relevant external output | Artifact | Store a stable reference and metadata, not copied secret material. |
| A direction needing team alignment | Proposed Decision | Creation is always `proposed`; acceptance remains a separate explicit transition. |
| Session narration, failed guesses, or ephemeral scratch work | No shared object by default | Private session state does not become shared merely because it exists. |

### Baseline gaps

- The write tools are operationally complete but their descriptions do not
  distinguish a durable Finding from session narration, a proposed Decision
  from approval, or an Artifact reference from embedded content.
- Existing acceptance tests prescribe exact write calls. They prove that the
  APIs work, not that an agent recognizes contribution moments during ordinary
  work.
- Sprint 002 showed that an incoming agent could write state back, but its
  workstream explicitly required useful state to be written back. It did not
  isolate whether the current interface makes object selection feel natural.
- There is no accepted measurement for useful selectivity: recording too
  little loses team state, while recording every observation creates noise.
- The system cannot infer durable team state from a transcript, and this sprint
  must not add that behavior.

### Hard requirements parked for explicit review

These are candidates only. Sprint 011 does not implement them.

1. A batch or generic `contribute` endpoint. It would combine objects with
   different lifecycle and authorization rules and needs evidence beyond one
   trace.
2. Automatic transcript extraction, end-of-session summarization, or an LLM
   memory pipeline. These would violate the current deterministic product
   boundary without a separate policy design.
3. Finding lifecycle, generic relationships, blocked reasons, or
   task-to-decision links. These require explicit domain or schema review.
4. Agent reminders, hooks, notifications, background jobs, or automatic
   contribution on process exit.
5. A write-capable Viewer.

If the real trace demonstrates one of these as a hard requirement, stop and
amend this contract rather than adding it silently.

---

## 3. Smallest implementation

Keep the existing domain objects and atomic write operations. Improve the
agent-facing MCP descriptions so object choice and safety boundaries are clear
at the moment a tool is selected.

The descriptions should communicate, concisely:

- `add_finding`: record a durable fact or conclusion useful to later
  participants; include evidence or confidence when useful; do not paste a
  private transcript;
- `add_decision`: record a direction that still needs explicit acceptance;
  creating it does not approve it;
- `accept_decision`: use only for an explicit approval decision, never as an
  automatic follow-up to proposing;
- `create_task` / `update_task`: represent actionable shared work and its
  truthful current lifecycle or assignee;
- `add_artifact`: attach a stable reference to a useful output or source;
  avoid secrets and private session material;
- `update_goal`: change shared intent only when the team's goal actually
  changed, not to narrate progress.

Do not add a new service method, domain object, database column, migration,
background process, or model call. HTTP, CLI, and Workers behavior stays the
same because the change is agent-interface guidance over existing semantics.

The implementation may add a focused real-harness fixture and evaluator for
this sprint. Deterministic tests should validate the domain outcomes and
provenance, not exact descriptive prose.

### Natural-work instruction boundary

The scored agent receives:

- the workspace id;
- the bounded task request;
- access to the task fixture and ordinary Campfire tools;
- one neutral instruction to keep durable shared state current as it works.

It does **not** receive:

- the expected root cause;
- a list of Campfire calls;
- object ids other than the workspace id;
- a required number of writes;
- a handoff template;
- a summary of what should become a Finding, Decision, Task update, or
  Artifact.

The task fixture must contain one discoverable, deterministic fact not already
present in Campfire and one clear completion condition. If the work produces a
stable output, the fixture must make its path observable without telling the
agent to call `add_artifact`.

---

## 4. Acceptance criteria

### Deterministic

- The existing Finding, Decision, Task, Goal, and Artifact write semantics are
  unchanged across the sync service and Workers service.
- A participant agent with an active session can record the selected objects;
  an agent without an active session is rejected.
- A viewer and a non-participant cannot write. Authorization occurs before
  workspace state is exposed or mutated.
- Each accepted write records exactly one Contribution with the correct actor,
  agent session, workspace, object type, object id, payload, and time.
- A proposed Decision remains proposed until a separate authorized actor
  explicitly accepts it. The test does not auto-accept a proposal.
- The resulting objects appear in `get_workspace_context`, and a read with the
  pre-work cursor returns the new contributions in order.
- No raw transcript, bearer token, unrelated-workspace state, or fixture secret
  is stored in any object or Contribution payload.
- Existing transcript isolation, workspace isolation, lifecycle, HTTP, MCP,
  Workers, CLI, Viewer read-only, and acceptance tests remain green.

### Cold real-harness contributor

- A fresh agent process receives only the natural-work instruction boundary
  above and performs the bounded task.
- It retrieves the workspace before writing and respects the accepted
  constraint and recorded alignment boundary.
- Without being told which calls to make, it records the deterministic new
  fact as a Finding whose summary is useful without the private transcript.
- It moves the assigned Task to the truthful terminal state: `completed` only
  if the fixture's completion condition is met, otherwise `blocked`.
- If it produces a stable output, it attaches that output as an Artifact. If
  the task reveals a direction requiring team agreement, it records a proposed
  Decision and does not accept it automatically. Neither optional object is
  required when the scenario does not earn it.
- It does not create duplicate objects, narrate every tool call, dump scratch
  reasoning, or write to an unrelated workspace.
- Every shared claim is traceable to the fixture or a produced artifact, and
  every mutation is attributable to the agent session.

### Cold downstream continuation

- A second fresh agent receives only the workspace id after the contributor
  finishes. It receives no contributor transcript, no change summary, and no
  list of writes.
- From Campfire state alone, it names the discovered fact, the Task outcome,
  any produced Artifact, and any still-proposed Decision.
- It distinguishes recorded fact from proposal and does not treat either the
  alignment projection or a proposed Decision as permission to execute.
- It can state the next honest action without rereading the contributor's
  private session.

---

## 5. Measurement plan

- **Contribution accuracy:** compare the final workspace snapshot with the
  fixture's predeclared fact and completion condition. Score the Finding,
  Task outcome, optional Artifact, optional Decision status, workspace, and
  provenance independently.
- **Usefulness:** score the downstream cold agent's statement against the same
  snapshot. A state write is useful only if the later participant can recover
  its meaning without the first transcript.
- **Selectivity:** report duplicate, unsupported, overly broad, transcript-like,
  or irrelevant writes. Do not reward raw object count.
- **Friction:** report Campfire reads, writes, failed calls, retries, human
  interventions, and whether the agent needed object-selection clarification.
  Tool-call count is diagnostic, not a target.
- **Timing:** report orientation, task work, contribution, and downstream
  synthesis intervals separately. This contract defines no pass/fail latency
  threshold.
- **Limitations:** one fixture, one contributor harness/model, one downstream
  harness/model, and no variance estimate. A successful prompted run does not
  prove an unprompted long-term habit or external team retention.

Human interventions after the initial task are classified as:

```text
operational
clarification
context leakage
manual handoff
```

Any `context leakage` or `manual handoff` is material to the recommendation.

---

## 6. Non-goals

- A generic contribution or batch-write API.
- Automatic memory extraction, transcript ingestion, summarization, or model
  inference inside Campfire.
- Mandatory writes at session end or automatic writes on process exit.
- A new Contribution action, object type, domain object, schema, or migration.
- Finding lifecycle, generic relationships, blocked reasons, or dependency
  graphs.
- Notifications, reminders, subscriptions, presence, analytics, or scoring
  stored in the product.
- Automatic Decision acceptance or inferred human approval.
- Writable Viewer behavior.
- Cross-workspace or organizational memory.
- Orchestration, scheduling, delegated execution, or capability management.
- Claiming Gate B or Gate C external behavioral evidence from this controlled
  founder-led trace.
- Design-partner release work or Sprint 012.

---

## 7. Rubric

- **GO:** all deterministic checks pass. The cold contributor discovers the
  fixture fact, records a useful Finding, truthfully updates the Task, records
  only earned optional state, and preserves workspace, identity, authorization,
  provenance, and transcript boundaries without prescribed write calls or a
  handoff template. A second cold agent recovers the result from Campfire alone
  and can continue correctly.
- **CONDITIONAL GO:** the correct durable state reaches Campfire and the second
  agent can continue, but the contributor requires one object-selection
  clarification, makes a recoverable duplicate/noisy write, or omits an earned
  optional Artifact or proposed Decision. Address only the observed interface
  friction; do not add inference, schema, or a generic contribution endpoint.
- **NO-GO / REFRAME:** the contributor completes the work but leaves no useful
  shared state; records the wrong Task outcome; treats a proposal as accepted;
  stores transcript-like, secret, unsupported, or unrelated-workspace content;
  cannot contribute without a prescribed call list or handoff template; or the
  downstream agent still needs the private transcript or a manual summary.
  Also NO-GO if success requires automatic transcript extraction, a writable
  Viewer, cross-workspace memory, or orchestration.

Implementation begins only after this contract is reviewed and explicitly
accepted.
