# Campfire — Sprint 002: Real Team Handoff

**Status:** Complete (GO)  
**Sprint:** 002 — Real Team Handoff  
**Date:** September 11, 2026  
**Company:** Boring Infra Co.  
**Depends on:** Sprint 001 — Cross-Harness Team Handoff (**GO**)

---

## 1. Sprint Thesis

Sprint 001 proved that Campfire's structured, provenance-backed work state can carry useful context between two isolated MCP clients without sharing the originating transcript.

Sprint 002 must prove the next layer:

> **A real agent harness can naturally consume Campfire's shared work state, understand prior team work, continue it correctly, and contribute new durable state back.**

Sprint 001 validated the **state model and boundary**.

Sprint 002 validates the **agent experience**.

The core question is:

> **Does a real cross-harness Campfire handoff work when the incoming agent must reason from the shared workspace rather than from a scripted continuation?**

Do not widen this sprint into organizational memory, semantic search, orchestration, enterprise authorization, or a polished UI.

---

## 2. Evidence From Sprint 001

Sprint 001 ended with a **GO**.

It demonstrated:

- two separate MCP client processes;
- real MCP over stdio;
- real Campfire domain, service, authorization, and persistence layers;
- workspace-scoped discovery;
- structured context retrieval;
- transcript isolation;
- provenance preservation;
- append-only contribution history;
- Agent B continuation;
- unrelated workspace isolation;
- 63 passing tests;
- 19 passing acceptance checks.

The handoff preserved:

```text
Goal
Finding
Decision
Task
Artifact
Provenance
```

Agent B recovered that state and wrote new state back.

Sprint 001 intentionally left two limitations:

1. the clients were independent MCP processes labelled as Codex and OpenCode rather than actual vendor harnesses;
2. Agent B's continuation was deterministic fixture logic rather than an LLM naturally reasoning over retrieved Campfire state.

Sprint 002 exists specifically to close those gaps.

---

## 3. Sprint Question

> **Can a real Agent B, running in a different harness from Agent A, enter a Campfire workspace, understand what the team already figured out, determine the correct next step, continue the work, and contribute its own state without access to Agent A's transcript?**

The important phrase is:

> **determine the correct next step**

The continuation must not be encoded into Agent B's test harness.

Agent B should reason from:

- its own minimal task instruction;
- the repository or fixture;
- authorized Campfire state;
- normal tools available through its harness.

---

## 4. Product Magic Moment

```text
Human A
   |
   v
Real Agent A
   |
   | investigates
   | records useful team state
   v
Campfire Workspace
   |
   | Agent A session ends
   v
Real Agent B
   |
   | enters through another harness
   | retrieves Campfire context
   | understands prior work
   | determines what remains
   | continues the task
   v
Campfire Workspace
   |
   | new finding / task state / artifact
   v
Human B
```

Human B should be able to say approximately:

> "Continue the billing deploy investigation using the Campfire workspace."

Agent B should not need:

- Agent A's transcript;
- a human-written summary;
- a prompt explaining Agent A's conclusion;
- a hard-coded task ID;
- hidden fixture logic containing the expected answer.

The desired experience is:

> **It already knows what the team figured out.**

---

## 5. Primary Hypothesis

The current Campfire workspace model contains enough durable state for a real incoming agent to:

1. understand the workspace objective;
2. identify important prior findings;
3. respect accepted decisions;
4. identify unresolved work;
5. locate relevant artifacts;
6. understand who produced prior state;
7. determine an appropriate next action;
8. perform meaningful continuation;
9. record that continuation back into Campfire.

The current primitives under test are:

```text
Workspace
Goal
Task
Finding
Decision
Artifact
Contribution
Provenance
```

---

## 6. Secondary Hypotheses

### H2.1 — Context ergonomics

Sprint 001 showed that `get_workspace_context` is complete, but a real agent may reveal that it is verbose, poorly ordered, or missing an obvious entry point.

Observe:

- what Agent B reads first;
- what it ignores;
- what it requests repeatedly;
- whether important information is buried;
- whether the projection causes confusion.

Do not optimize before observing real behavior.

### H2.2 — Finding lifecycle

Sprint 001 findings are append-only assertions.

Observe whether real work creates a need to express:

```text
active
superseded
stale
disputed
verified
```

Do not implement a full lifecycle unless the real handoff demonstrates the need.

### H2.3 — Object relationships

Sprint 001 suggested relationships such as:

```text
Finding --supports--> Decision
Artifact --resolves--> Task
Finding --produces--> Artifact
```

Observe whether a real agent needs these relationships to understand the workspace.

If justified, implement only the smallest useful relationship model.

### H2.4 — Session identity binding

Real harnesses must preserve:

```text
Human
Agent
Harness
Agent Session
Contribution
```

without asking the model to invent identity on every tool call.

Determine how each real harness should establish trusted actor/session identity.

---

## 7. Reference Scenario

Reuse the Sprint 001 billing deployment scenario.

### Workspace

```text
billing-deploy-failure
```

### Goal

```text
Determine why billing-service deploys fail and prepare the correct remediation.
```

### Agent A

Agent A investigates and contributes state semantically equivalent to:

```text
Finding:
Migration 284 holds a database lock longer than the deployment timeout.

Finding:
The billing deployment times out after 120 seconds.

Decision:
Do not increase the global deployment timeout.
Split the migration instead.

Task:
Prepare the migration split.

Artifact:
fixtures/billing/migration-284.sql
```

Exact wording is not required.

### Agent B

Agent B enters later through a different real harness.

Its initial human instruction should be minimal:

```text
Continue the billing deploy investigation using the Campfire workspace.
```

Agent B must determine:

- the goal;
- what Agent A discovered;
- which decision is accepted;
- what remains unresolved;
- which artifact matters;
- what next action is appropriate.

A valid continuation might include:

```text
Task:
Prepare the migration split
open -> in_progress

New finding:
Migration 284 should be split into a schema phase and backfill phase.

New artifact:
migration-284-split-plan.md
```

Semantic correctness matters more than exact strings.

---

## 8. Real Harness Requirement

Sprint 002 must include real agent harnesses in the acceptance path.

Preferred:

```text
Real Codex
   |
   v
Campfire
   |
   v
Real OpenCode / Claude Code
```

A full **GO** requires two distinct real agent harness environments.

If environment constraints allow only one real harness plus an independent MCP test client, the sprint may still validate useful behavior, but the real-harness hypothesis remains incomplete and the recommendation should be **CONDITIONAL GO**.

Record exact harness versions and configuration.

---

## 9. Harness Independence

The two clients must not share:

- conversation history;
- session exports;
- hidden prompt state;
- model memory;
- manually copied summaries;
- temporary handoff files containing Agent A's conclusions.

They may share:

- the repository/fixture;
- authorized Campfire state;
- external resources normally available to both teammates.

The handoff boundary is Campfire.

---

## 10. Transcript Isolation

Retain the private Agent A sentinel:

```text
PRIVATE_TRANSCRIPT_SENTINEL_A_never_shared
```

It must never be:

- written to Campfire;
- included in workspace context;
- included in activity;
- included in Agent B's prompt;
- included in Agent B's retrieved context;
- included in Agent B's output.

### Invariant

> **Agent B may learn what Agent A contributed to the team's work without learning Agent A's private conversation.**

---

## 11. Workspace Isolation

Retain an unrelated workspace such as:

```text
auth-token-rotation
```

with sentinel:

```text
UNRELATED_FINDING_SENTINEL_auth_token_rotation
```

Agent B should be authorized for `billing-deploy-failure` and unauthorized for the unrelated workspace.

Acceptance must verify:

- unauthorized workspace content is not discoverable;
- direct unauthorized retrieval is denied;
- the unrelated sentinel never appears in Agent B's context.

> **Shared does not mean global.**

---

## 12. Context Ergonomics Evaluation

Capture how Agent B actually orients.

### Observe

What does it inspect first?

```text
workspace?
goal?
tasks?
findings?
decisions?
artifacts?
activity?
```

Does it repeatedly request information already returned?

Does it need information Campfire possesses but does not expose conveniently?

Does it spend reasoning effort sorting irrelevant state?

A possible future projection might prioritize:

```text
Goal
Accepted Decisions
Open Tasks
Active Findings
Relevant Artifacts
Recent Activity
Provenance
```

Do not implement that ordering merely because it appears here.

Use the real trace.

---

## 13. Agent B Reasoning Evaluation

Distinguish:

### Retrieval success

Campfire returned the correct state.

### Reasoning success

Agent B used the state appropriately.

Agent B should comprehend:

```text
Goal
Core Finding
Accepted Decision
Outstanding Task
Relevant Artifact
Provenance
```

Then choose a continuation consistent with those facts.

### Failure examples

Agent B fails the reasoning test if it:

- proposes increasing the global timeout despite the accepted decision;
- unnecessarily repeats Agent A's investigation;
- ignores the open task and starts unrelated work;
- invents unsupported findings;
- modifies an unrelated workspace;
- cannot determine what remains.

---

## 14. Human Intervention Budget

The human must not become a manual context router.

During Agent B's run, normal operational interaction is allowed.

Do not tell Agent B:

- Agent A's findings;
- Agent A's decision;
- which task is open;
- what artifact matters;
- what solution to implement.

If Agent B asks:

> "What did the previous agent discover?"

direct it to Campfire rather than answering.

Record every human intervention after the initial instruction.

A strong result requires minimal intervention.

---

## 15. MCP Surface

Begin with the existing Sprint 001 surface:

```text
campfire.list_workspaces
campfire.get_workspace
campfire.get_workspace_context
campfire.join_workspace
campfire.add_finding
campfire.add_decision
campfire.create_task
campfire.update_task
campfire.add_artifact
campfire.get_activity
```

Do not add tools preemptively.

Any MCP change must document:

```text
Observed behavior
Why the current surface failed
Smallest change
Result after change
```

Sprint 002 is partly an API ergonomics test.

---

## 16. Identity and Session Binding

Every meaningful real-harness contribution should resolve to:

```text
Human
Agent
Harness
Agent Session
Timestamp
Workspace
Object
Action
```

Investigate trusted identity binding through mechanisms such as:

```text
MCP server configuration
environment configuration
connection/session initialization
client metadata
Campfire-specific setup
```

Avoid model-controlled identity arguments where possible.

Desired:

```text
campfire.add_finding(...)
```

Avoid:

```text
campfire.add_finding(
  pretend_i_am="agt_codex_sergio",
  acting_for="hum_sergio",
  session="whatever_the_model_says"
)
```

Identity should come from the trusted client/session boundary.

---

## 17. Finding Lifecycle Investigation

Observe whether Agent B needs to express that a finding is:

```text
active
superseded
stale
disputed
verified
```

If genuine friction appears, prefer the smallest useful lifecycle.

For example:

```text
active
superseded
```

may be enough.

Do not build a rich lifecycle spec without evidence.

---

## 18. Relationship Investigation

Observe whether Agent B needs explicit semantics such as:

```text
Artifact A --resolves--> Task T
Finding F --supports--> Decision D
Finding F --produces--> Artifact A
```

Before adding a generic relationship primitive, ask whether the relationship can be represented directly on the relevant domain object.

If multiple real object types justify a shared relationship primitive, keep the initial vocabulary tiny:

```text
supports
resolves
produces
```

No generalized knowledge graph.

---

## 19. Implementation Workstreams

### Workstream A — Real Harness Setup

- configure Campfire for Harness A;
- configure Campfire for Harness B;
- document exact versions;
- verify each independently calls Campfire;
- verify identity/session binding.

### Workstream B — Agent A Real Run

- start clean fixture;
- begin real Agent A session;
- give Agent A the investigation goal;
- allow repository/fixture inspection;
- allow normal Campfire use;
- terminate Agent A session;
- preserve private transcript separately for evaluation only.

### Workstream C — Agent B Real Run

- start a fresh isolated Harness B session;
- provide only the minimal continuation instruction;
- allow Campfire discovery/retrieval;
- observe orientation;
- allow repository/artifact inspection;
- allow meaningful continuation;
- require useful state to be written back.

### Workstream D — Ergonomics

- record Campfire tool calls;
- record repeated reads;
- record missing state;
- record context noise;
- make only evidence-backed changes;
- rerun acceptance after changes.

### Workstream E — Domain Friction

Observe:

- finding lifecycle;
- relationships;
- task semantics;
- decision semantics;
- artifact semantics;
- provenance usability.

Implement only refinements required by observed behavior.

### Workstream F — Evidence

Produce:

```text
evidence/sprint-002/
├── environment.md
├── harness-a.md
├── harness-b.md
├── campfire-state-before-b.json
├── campfire-state-after-b.json
├── acceptance.json
└── notes.md
```

Do not commit secrets or private transcript contents.

---

## 20. Test Plan

All Sprint 001 tests must remain green.

Run:

```bash
npm run typecheck
npm test
npm run acceptance
```

Add deterministic tests only for implementation changes introduced by Sprint 002.

Potential areas:

- trusted session identity binding;
- context projection changes;
- any lifecycle state introduced;
- any relationship primitive introduced.

The primary Sprint 002 acceptance test is the captured real-agent interaction.

---

## 21. Acceptance Checks

### Environment

```text
environment.harness_a_real
environment.harness_b_real
environment.harnesses_distinct
environment.sessions_isolated
```

### Comprehension

```text
comprehension.workspace_goal
comprehension.core_finding
comprehension.accepted_decision
comprehension.outstanding_task
comprehension.referenced_artifact
comprehension.provenance
```

### Reasoning

```text
reasoning.correct_next_step
reasoning.respects_prior_decision
reasoning.avoids_redundant_investigation
reasoning.uses_relevant_artifact
```

### Continuation

```text
continuation.meaningful_work_performed
continuation.task_state_advanced
continuation.new_state_recorded
continuation.new_provenance_recorded
```

### Preservation

```text
preservation.agent_a_state_intact
preservation.provenance_distinct
preservation.activity_ordered
```

### Isolation

```text
isolation.private_transcript_absent
isolation.unrelated_workspace_hidden
isolation.unrelated_workspace_denied
isolation.unrelated_sentinel_absent
```

### Human intervention

```text
intervention.no_manual_handoff
intervention.no_answer_leakage
```

### Ergonomics

Record observational metrics:

```text
ergonomics.orientation_tool_calls
ergonomics.redundant_reads
ergonomics.missing_context
ergonomics.context_noise
```

---

## 22. Definition of Done

Sprint 002 is complete when:

- [ ] Sprint 001 regression suite remains green.
- [ ] Two distinct real agent harnesses are used for the final GO path.
- [ ] Agent A performs a real investigation.
- [ ] Agent A records structured work state through Campfire.
- [ ] Agent A's session ends before Agent B begins.
- [ ] Agent B has no access to Agent A's transcript.
- [ ] Agent B receives only a minimal continuation instruction.
- [ ] Agent B discovers the correct workspace.
- [ ] Agent B retrieves authorized structured context.
- [ ] Agent B identifies the goal.
- [ ] Agent B identifies the core finding.
- [ ] Agent B respects the accepted decision.
- [ ] Agent B identifies the outstanding task.
- [ ] Agent B identifies and uses the relevant artifact.
- [ ] Agent B determines an appropriate next step through model reasoning.
- [ ] Agent B performs meaningful continuation.
- [ ] Agent B writes new durable state to Campfire.
- [ ] Agent B's contributions have correct distinct provenance.
- [ ] Unrelated workspace state remains inaccessible.
- [ ] Private transcript sentinel remains absent.
- [ ] Human intervention is recorded.
- [ ] Context/tool ergonomics are evaluated from the real trace.
- [ ] Domain changes are justified by observed friction.
- [ ] `SPRINT_002_RESULT.md` is written.
- [ ] Final recommendation is GO, CONDITIONAL GO, or NO-GO.

---

## 23. GO Criteria

Recommend **GO** if:

1. two distinct real agent harnesses complete the handoff;
2. Agent B receives no private Agent A transcript;
3. Agent B correctly understands prior team state;
4. Agent B determines the correct continuation through its own reasoning;
5. Agent B performs meaningful work rather than echoing context;
6. Agent B writes useful new state back;
7. provenance remains correct;
8. workspace authorization and isolation remain intact;
9. no manual human handoff is required;
10. ergonomics problems are refinements rather than thesis failures.

A GO means:

> **Campfire's structured work state works as a real cross-harness collaboration primitive, not merely as a deterministic state-transfer mechanism.**

---

## 24. CONDITIONAL GO Criteria

Recommend **CONDITIONAL GO** if the core experience works but a meaningful condition remains.

Examples:

- only one side uses a real harness;
- context retrieval requires excessive tool calls;
- identity binding remains partially manual;
- Agent B needs a small context-projection change;
- a missing relationship creates narrow, fixable friction;
- the agent requires modest prompting to inspect Campfire.

The result must name the unresolved condition and smallest next validation.

---

## 25. NO-GO / REFRAME Criteria

Recommend **NO-GO / REFRAME** if:

- real agents cannot reliably orient from Campfire state;
- Agent B requires a transcript or human-written handoff;
- the domain model loses critical reasoning context;
- agents repeatedly misunderstand accepted decisions;
- the workspace projection is too lossy for continuation;
- harness identity cannot be bound safely;
- useful continuation effectively requires reconstructing the original conversation;
- Campfire adds more coordination burden than it removes.

---

## 26. Guardrails

Do not turn Sprint 002 into:

- organizational memory;
- cross-workspace semantic search;
- vector retrieval;
- a generalized knowledge graph;
- enterprise IAM;
- SSO;
- a polished human dashboard;
- an agent orchestration runtime;
- autonomous agent assignment;
- agent negotiation;
- Slack integration;
- Linear integration;
- GitHub synchronization;
- Combie integration;
- Harnie integration;
- Meno integration;
- Pico integration;
- behavioral observability;
- long-term learning.

> **The sprint is about one real handoff.**

---

## 27. Expected Deliverables

```text
docs/
├── SPRINT-002.md
└── SPRINT-002-RESULT.md

evidence/
└── sprint-002/
    ├── environment.md
    ├── harness-a.md
    ├── harness-b.md
    ├── campfire-state-before-b.json
    ├── campfire-state-after-b.json
    ├── acceptance.json
    └── notes.md
```

Plus only source and test changes justified by the sprint.

---

## 28. SPRINT_002_RESULT Requirements

`SPRINT_002_RESULT.md` must include:

### Environment

- OS/runtime;
- Campfire revision;
- Harness A name/version;
- Harness B name/version;
- models used where observable;
- MCP transport/configuration;
- identity/session-binding approach.

### Exact scenario

Record exactly what Human A asked Agent A and Human B asked Agent B.

### What Agent A discovered

Record durable state contributed to Campfire.

### What Agent B received

Record the Campfire projection available to Agent B.

### What Agent B understood

Evaluate:

- goal;
- finding;
- decision;
- task;
- artifact;
- provenance.

### What Agent B decided

Explain the next action selected and why.

### What Agent B did

Record the actual continuation.

### What Agent B contributed

Record new Campfire state and provenance.

### Transcript isolation

Document how Agent A's private session was isolated.

### Workspace isolation

Document unrelated-workspace behavior.

### Human intervention

List every human intervention after Agent B's initial instruction.

Classify each as:

```text
operational
clarification
context leakage
manual handoff
```

Any `context leakage` or `manual handoff` is material to the recommendation.

### Context ergonomics

Document:

- first Campfire call;
- total Campfire reads;
- repeated reads;
- missing context;
- noisy context;
- tool/API friction.

### Domain observations

Document evidence for or against:

- finding lifecycle;
- object relationships;
- task lifecycle changes;
- artifact semantics;
- decision semantics.

### Tests

Include:

```text
typecheck
unit/integration tests
Sprint 001 acceptance
Sprint 002 real-harness acceptance
```

### Recommendation

End with exactly one:

```text
GO
CONDITIONAL GO
NO-GO / REFRAME
```

and explain why.

---

## 29. Questions Sprint 002 Must Teach Us

By the end of this sprint, we should have evidence-backed answers to:

1. Can a real incoming agent orient from Campfire without a manual handoff?
2. Is structured work state enough for model reasoning?
3. Which workspace state does an agent actually use first?
4. Is `get_workspace_context` shaped correctly?
5. Does the incoming agent understand accepted decisions as constraints?
6. Can it infer outstanding work without being told the answer?
7. Does provenance help the agent, the human, or both?
8. How should real harness identity/session binding work?
9. Do findings need lifecycle state now?
10. Do object relationships deserve to become a first-class primitive?
11. How much human intervention is actually required?
12. Does Campfire reduce reorientation work enough to feel valuable?

---

## 30. What Comes After Sprint 002

Do not define Sprint 003 in detail before Sprint 002 completes.

If Sprint 002 is a GO, use its real traces to refine the domain model.

Likely sequence:

```text
Sprint 002 evidence
        |
        v
Domain Model Refinement
        |
        v
DOMAIN_MODEL.md
        |
        v
Sprint 003 based on strongest observed friction
```

Possible evidence-driven directions include:

```text
context ergonomics
finding lifecycle
object relationships
human workspace inspection
identity / authorization
repeat multi-session collaboration
```

The trace decides.

The roadmap does not.

---

## 31. Sprint North Star

Sprint 001 proved:

> **Campfire can carry the state.**

Sprint 002 must prove:

> **A real agent can use that state naturally.**

The acceptance moment should feel almost boring:

```text
Human B:
"Continue the billing deploy investigation using Campfire."

Agent B:
- discovers the workspace
- understands what happened
- respects the prior decision
- sees what remains
- opens the relevant artifact
- continues the work
- records what it learned
```

No transcript forwarding.

No manual summary.

No hidden answer.

No shared session.

Just durable team work surviving across humans, agents, and harnesses.

> **Make agents work like they are part of the team.**
