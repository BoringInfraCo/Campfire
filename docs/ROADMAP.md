# Campfire — Roadmap

**Status:** Revised  
**Version:** 0.2  
**Date:** October 3, 2026; sequence revised October 9 after published `v1.14.0`, extended October 10 with an implemented v1.16 candidate, updated October 11 (local; run timestamps cross October 12 UTC) with the RCL-001, RCL-002, and RCL-003 pilot verdicts NO-GO / REFRAME; October 13 founder release preparation direction recorded (Gate E open; not published); October 13 v1.16.0 published and deployed; October 13 post-v1.16 direction added for v1.17; October 14 v1.17 Shared Work Home implemented as an engineering candidate with D1–D7 deterministic checks passing (controlled human traces and reference observations still open; not published); October 14 founder direction recorded for the v1.17 release path (two controlled traces first; a separate recorded founder override is required to publish with open observations); October 14 founder authorized a public v1.17.0 release under the recorded release-scope override; October 15 v1.17.0 published and deployed (see `docs/RELEASE_V1_17_DECISION.md`); October 15 v1.18 work-continuity contract drafted; October 15 WCO-001 baseline recorded and a labeled single-operator rehearsal run (eligible two-human case NOT OBSERVED), Amendment 1's bounded guidance/schema repair implemented with D1–D6 passing, recorded as CONDITIONAL GO — engineering candidate; October 15 v1.18.0 published and deployed under the recorded release-scope override in `docs/RELEASE_V1_18_DECISION.md`; October 15 v1.19 team-attention contract proposed (unimplemented and unscored); October 15 ATT-001 baseline frozen (fixture v2), engineering candidate implemented with D1–D6 passing and independent verification, two-person trace NOT OBSERVED, recorded as CONDITIONAL GO — engineering candidate; October 15 founder directed a full public v1.19.0 release under the recorded release-scope override (docs/RELEASE_V1_19_DECISION.md); October 15 v1.19.0 published and deployed under that override
**Company:** Boring Infra Co.  
**Depends on:** Product Definition v0.2, Vision v0.2, Architecture v0.2

---

## 1. Purpose

This roadmap defines how Campfire should grow from a narrow proof of cross-human/cross-agent continuity into infrastructure for teams of people and agents.

Campfire's north star is:

> **Make agents work like they are part of the team.**

The roadmap is intentionally evidence-driven.

Campfire should not begin by building a generalized multi-agent platform, enterprise memory system, orchestration engine, or complete organizational knowledge graph.

It should earn those capabilities by first proving one small behavior:

> One human and agent can contribute durable work state that another authorized human and a different agent can use to continue the work without receiving the original conversation transcript or a manually prepared handoff.

Everything after that should deepen the same core product thesis.

---

## 2. Roadmap Thesis

The product progression is:

```text
Cross-Agent Continuity
        ↓
Shared Team Workspaces
        ↓
Identity + Authorization
        ↓
Richer Collaboration State
        ↓
Organizational Memory
        ↓
Coordination + Capabilities
        ↓
Organizational Learning
```

Each stage answers a different question.

```text
Stage 1
Can work survive the originating agent session?

Stage 2
Can a team collaborate around that durable state?

Stage 3
Can the right humans and agents receive the right state?

Stage 4
Can Campfire represent real collaborative work well enough
to become useful every day?

Stage 5
Can prior work improve future work across the organization?

Stage 6
Can humans and agents safely coordinate action?

Stage 7
Can the organization learn from the accumulated behavior,
outcomes, decisions, and evidence of its people and agents?
```

Campfire should not skip these layers.

---

# Phase 0 — Thesis Alignment

**Status:** Complete

The original Campfire thesis centered on harness-independent agent collaboration.

The revised thesis expands the collaboration boundary:

> **Campfire is the shared workspace where people and their agents work together.**

The important change is that humans and agents are both first-class participants in collaborative work.

### Completed foundation

- Product Definition v0.2
- Vision v0.2
- Architecture v0.2
- Revised Sprint 001
- North star established
- Workspace established as primary collaboration boundary
- Human and agent identities separated
- Shared work state separated from private transcripts
- MCP positioned as an interface rather than the product
- Provenance and authorization established as architectural invariants

### Exit condition

Campfire has a coherent product and architecture thesis sufficient to begin implementation.

**Result:** complete.

---

# Phase 1 — Prove Continuity

## Sprint 001 — Cross-Harness Team Handoff

**Status:** Complete (GO)

### Goal

Prove that structured Campfire state can carry useful work between two different human-agent relationships.

### Reference flow

```text
Human A + Agent A
        |
        | contributes
        v
    Campfire
        |
        | retrieves
        v
Human B + Agent B
```

The two agents must use genuinely different harnesses.

Agent B must not receive:

- Agent A's transcript,
- a manually written summary,
- a copied prompt containing the answer,
- or harness-specific session state.

### Minimum product surface

Campfire should support:

- organization
- team
- human
- agent
- workspace
- participant
- goal
- task
- finding
- decision
- artifact
- contribution/provenance

Minimum interface:

```text
list_workspaces
get_workspace
get_workspace_context
create_finding
create_decision
create_task
update_task
attach_artifact
```

### Technical constraints

Prefer:

```text
MCP
  ↓
thin interface layer
  ↓
application services
  ↓
authorization
  ↓
domain
  ↓
SQLite
```

Avoid premature:

- vector databases,
- cloud control planes,
- orchestration,
- autonomous memory extraction,
- transcript synchronization,
- semantic ranking,
- generalized knowledge graphs.

### Success criteria

Sprint 001 is successful if:

1. Agent A performs meaningful work.
2. Agent A contributes durable structured state.
3. Agent A's transcript remains isolated.
4. Agent B enters through another harness.
5. Agent B retrieves authorized workspace context.
6. Agent B correctly continues the work.
7. Campfire preserves provenance across the handoff.
8. A human can inspect what happened.

### Decision

At the end of Sprint 001:

```text
GO
The continuation experience is clearly useful.

CONDITIONAL GO
The thesis works but the domain model or interface needs revision.

NO-GO / REFRAME
Structured shared state does not materially improve cross-agent continuation.
```

Do not begin the next major phase until this evidence exists.

**Result:** complete (GO). See `docs/SPRINT_001_RESULT.md` and `docs/SPRINT_002_RESULT.md`.

---

# Phase 2 — Make the Workspace Useful

## Sprint 002+ — Collaboration State

**Status:** Sprint 002 GO. Sprint 003 orientation partial (deterministic exit
met, in tree; real-harness rerun + Claude Code outstanding). Sprint 004 living
workspace GO. Sprint 005 hosted Stage B GO. Sprint 006 Gate C product-surface
GO (v1.0). Viewer-002 team journal GO. v1.1 ships its Campfire theme and
logomark. Sprint 007 harness readiness GO. Sprint 008 Enter the Room GO
(precise Time to Context 19.8 s). Sprint 009 Align Before Execution GO
(recorded alignment boundary). Field Trace 001 was cancelled by founder
decision; Gate B and Gate C external behavioral evidence remain unmeasured.
Sprint 010 Return to the Workspace GO (caller-supplied return cursor;
Workers contribution writes awaited). Sprint 011 Natural Contribution GO
(agent-interface guidance; cold contributor + downstream trace). Sprint 012
Close the Workspace GO (session-bound lifecycle; cold closer + downstream
trace). Sprint 013 Public Release GO (`v1.2.0`). Sprint 014 Trust the Operator
Path is GO. `v1.2.1` is released and deployed; the live migration path,
four-platform assets, latest and pinned installs, and production Worker were
verified. Sprint 015 Zero-to-Shared-Workspace Onboarding is GO. One local
`campfire onboard` command creates the first human, agent, workspace, and
goal. It is published as minor release `v1.3.0`. It does not claim Gate B,
Gate C, or external adoption. Sprint 016 Agent-Led Setup & Human Handoff is
complete (CONDITIONAL GO). OpenCode completed a cold prompt-to-Viewer run.
Codex created the workspace but did not finish session registration or leave
a Viewer listening. It is published as `v1.4.0`. It remains onboarding
evidence, not Gate B/C or PMF evidence. Sprint 017 Quiet Install & First
Workspace is GO: the human-first path, local profile, installed-harness
connection, one-process API + Viewer, and token-free handoff were independently
verified. It is published and deployed as minor release `v1.5.0`. Sprint 018
Enter With the Session is GO. Cold Codex and OpenCode sessions read the
workspace before acting, and a loopback session starts or reuses the local
listener. It is published and deployed as minor release `v1.6.0`. It does
not claim Gate B. Sprint 019 — Carry the Work Out is GO and published as
`v1.7.1`. One signed webhook projects a closed set of Campfire transitions.
Sprint CLI-001 — Agent-Native Interface Contract is GO and published and
deployed as `v1.8.0`. The CLI is now a first-class human and agent client over
the existing authorized workspace model. Neither sprint is Phase 4 or Phase 5
completion. Gate B, Gate C, and Gate F remain unmeasured. Successful delivery
is not repeat-usage evidence and not controlled action.

Sprint 020 — Bring the Next Teammate In has an implemented `v1.9.0` candidate. Its contract is `docs/SPRINT_020.md`: owner-authorized
new-person enrollment, recipient-owned agent connections, existing-work
orientation, useful contribution back, and fresh-process return through one
continuous journey. The candidate is in tree; `docs/SPRINT_020_RESULT.md` records
CONDITIONAL GO with independent two-human/two-machine acceptance and both live
recipient-harness paths pending. It is not published or deployed. Enrollment
atomicity, safe retry/recovery, and remote-profile support are part of that slice; finding lifecycle, context-budget redesign, broader concurrency
work, and new integrations remain separate. Gate B and Gate C remain unmeasured
until qualifying behavior is independently observed.

Sprint CTX-001 — Keep Shared Understanding Current is published as `v1.10.0`.
Orientation, catch-up, and drill-down are in tree. One Codex agent passed the
cold-orientation, saved-cursor, and unauthorized-workspace gate on a single
machine. Gate B and Gate C remain unmeasured. Publication does not authorize
the later visual-understanding work in section 21.

If Sprint 001 proves continuity, the next goal is to make the workspace useful for ongoing team work rather than a single handoff demonstration.

### Questions

- Which objects actually matter during real work?
- What context does an incoming agent need first?
- What should humans see?
- Which state changes frequently?
- Which state needs history?
- How should decisions evolve?
- How do artifacts relate to findings and tasks?
- How should stale information appear?
- What becomes noisy when multiple agents contribute?

### Likely capabilities

- workspace lifecycle
- participant management
- richer task state
- decision lifecycle
- finding status
- artifact relationships
- contribution timeline
- current-state projection
- basic filtering
- context selection
- human-readable workspace inspection

### Potential domain refinement

Evidence may justify a generic relationship primitive:

```text
Finding
  supports
Decision
  produces
Artifact
  resolves
Task
```

Do not build a generalized graph abstraction until real traces demonstrate the need.

### Exit condition

A Campfire workspace can support a small team across multiple sessions without becoming an unstructured dumping ground.

---

# Phase 3 — Identity and Authorization

## Goal

Make team context safely shareable across multiple humans and agents.

Sprint 001 establishes the architectural boundary.

This phase makes it robust enough for actual teams.

### Capabilities

- durable human identity
- durable agent identity
- agent-to-human attribution
- team membership
- workspace membership
- role-based permissions
- explicit read/write scopes
- capability grants
- authorization-aware retrieval
- revocation
- provenance inspection
- authorization event logging

### Core model

```text
Organization
    ↓
Team
    ↓
Human
    ↓
Agent

Actor + Workspace + Operation + Resource
                    ↓
                Allow / Deny
```

### Important distinction

An agent should not automatically inherit every capability or piece of context available to its human.

Campfire should support narrower delegated authority.

### Future enterprise direction

Only after the internal model is stable should Campfire consider:

- SSO
- SCIM
- identity provider integration
- organization policy
- service principals
- enterprise audit controls

### Exit condition

A team can confidently answer:

> Who can see this, who can change this, which agent acted, on whose behalf, and why was this context returned?

---

# Phase 4 — Real Team Collaboration

## Goal

Move from handoff infrastructure to a persistent environment for human-agent teamwork.

Campfire should begin to feel less like storage and more like a shared operational workspace.

### Candidate capabilities

- workspace activity
- assignments
- mentions or subscriptions
- handoff signals
- human approvals
- agent proposals
- blockers
- workspace status
- decision review
- artifact review
- participant presence
- explicit ownership
- structured outcomes

### Collaboration pattern

```text
Human
  ↓
sets goal

Agent A
  ↓
investigates

Agent B
  ↓
contributes another finding

Human
  ↓
approves decision

Agent C
  ↓
continues implementation

Campfire
  ↓
preserves shared state + provenance
```

### Product test

Campfire should reduce the amount of:

- repeated explanation,
- transcript forwarding,
- manual summarization,
- duplicated investigation,
- lost rationale,
- agent reorientation.

### Exit condition

A team chooses to keep a Campfire workspace active because it improves ongoing work, not merely because the product requires it for a demo.

---

# Phase 5 — Integrate the Existing Work Environment

## Goal

Allow Campfire to understand and reference the systems where teams already work without attempting to replace them.

Sprint 019 is not this phase. It only projects facts Campfire has already
recorded, through one vendor-neutral webhook. It does not create external
issues, messages, or documents, and it does not establish Gate F.

### Likely integrations

- GitHub
- issue/project systems
- engineering documentation
- incident systems
- deployment systems
- communication systems
- infrastructure context

### Integration principle

> Campfire owns collaboration state. External systems continue to own their native artifacts.

Example:

```text
Campfire Decision
      |
      references
      v
GitHub PR

Campfire Finding
      |
      references
      v
Sentry event

Campfire Task
      |
      references
      v
Linear issue
```

Avoid unnecessary duplication.

### Combie relationship

This phase is a natural point to test composition with Combie.

Combie can answer:

> What engineering resources exist and how are they related?

Campfire can answer:

> What is the team doing, learning, and deciding about those resources?

The systems should compose without becoming mutually dependent.

### Exit condition

Agents can enter a workspace and understand both the team's collaborative state and the relevant external engineering resources without humans manually assembling every reference.

---

# Phase 6 — Team Memory

## Goal

Allow completed Campfire work to improve future work.

Until this phase, Campfire primarily optimizes for continuity within active workspaces.

Now it begins to connect work across time.

### Capabilities

- completed workspace retrieval
- related prior work
- decision history
- prior attempts
- superseded findings
- artifact history
- context freshness
- workspace relationships
- reusable outcomes
- historical provenance

### Example

A new workspace begins:

```text
investigate-worker-timeout-2026-11
```

Campfire discovers:

```text
Related prior workspace:
worker-timeout-2026-08

Relevant state:
- same service
- similar failure mode
- approach X failed
- decision Y fixed the incident
- configuration changed afterward
```

The agent does not need the old transcripts.

It receives relevant durable organizational work state.

### Retrieval evolution

Only now should richer retrieval become a serious focus.

Potential techniques:

- explicit relationships
- metadata filtering
- recency
- resource relationships
- semantic retrieval
- ranking
- freshness scoring

Embeddings are an implementation option, not the product.

### Exit condition

Campfire can answer:

> Has this team learned something relevant before?

with useful, provenance-backed state.

---

# Phase 7 — Organizational Memory

## Goal

Expand useful memory from individual teams and workspaces toward the organization while preserving boundaries.

### Model

```text
Workspace Memory
      ↓
Team Memory
      ↓
Organizational Memory
```

This is not a universal context pool.

Retrieval remains authorization-aware.

### Candidate capabilities

- cross-team workspace discovery
- organizational decision history
- reusable patterns
- system-specific historical context
- ownership discovery
- expertise signals
- recurring failure patterns
- organizational conventions
- policy-linked context
- historical outcome comparison

### Questions Campfire may answer

- Why does the organization use this architecture?
- Has another team solved this problem?
- Who has worked on this system before?
- Which decisions affect this resource?
- What approaches repeatedly fail?
- Which artifacts are authoritative?
- Which findings are now stale?
- What work changed this system?

### Exit condition

Organizational knowledge generated through human-agent work survives team and session boundaries without flattening security or provenance.

---

# Phase 8 — Coordination and Capabilities

## Goal

Allow Campfire to coordinate not just shared understanding, but controlled action.

This phase should occur only after identity, authorization, provenance, and collaboration state are mature.

### Potential capabilities

- agent capability registration
- delegated authority
- action proposals
- human approval gates
- agent-to-agent task delegation
- capability discovery
- execution boundaries
- action outcomes
- retries and recovery
- policy evaluation

### Model

```text
Goal
 ↓
Task
 ↓
Assigned Agent
 ↓
Capability
 ↓
Action
 ↓
Outcome
 ↓
Shared Campfire State
```

Campfire does not need to become an agent runtime.

It can coordinate work while external harnesses and runtimes execute it.

### Pico relationship

Pico becomes especially relevant here.

Campfire may know:

> Agent X wants to perform action Y.

Pico may help determine:

> What authority and attack paths exist around that action?

Composition should remain explicit rather than collapsing product boundaries.

### Exit condition

Agents can safely coordinate meaningful work through Campfire with clear identity, authority, approval, and outcome provenance.

---

# Phase 9 — Verification-Aware Collaboration

## Goal

Distinguish what the team believes from what the available evidence supports.

### Potential capabilities

- evidence-linked findings
- claim state
- verification state
- evidence freshness
- decision confidence
- artifact validation
- outcome validation

### Meno relationship

Meno can provide verification semantics while Campfire provides the collaboration environment.

```text
Campfire
Finding:
"Migration 284 caused the failure."

        ↓

Meno
Evidence:
logs + migration state + reproduction

        ↓

Campfire
Finding:
verified
```

Campfire should not recreate Meno internally if composition works.

### Exit condition

Humans and agents can distinguish assertions, evidence, verified conclusions, and stale conclusions inside collaborative work.

---

# Phase 10 — Behavioral Understanding

## Goal

Understand how agents behave across collaborative work, not merely what state they produce.

### Potential questions

- Which agents repeatedly loop?
- Which tasks require human intervention?
- Which agents recover effectively?
- Which strategies lead to successful outcomes?
- Where do agents repeatedly fail?
- How does behavior change after feedback?
- Which workflows are safe to delegate further?

### Agent Observability relationship

The behavioral observability product can provide action/outcome/loop/recovery state.

Campfire provides the organizational work context surrounding that behavior.

Together:

```text
What was the team trying to do?
        +
How did the agent behave?
        +
What happened?
```

### Exit condition

Agent behavior can be evaluated in the context of actual organizational goals and outcomes.

---

# Phase 11 — Organizational Learning

## Goal

Turn accumulated collaboration history into infrastructure that makes the organization better at working with agents over time.

This is the long-term frontier, not an MVP feature.

### Progression

```text
Shared Context
      ↓
Work Continuity
      ↓
Team Memory
      ↓
Organizational Memory
      ↓
Observed Outcomes
      ↓
Organizational Learning
```

### Possible capabilities

Campfire may eventually help determine:

- which approaches tend to work,
- which decisions repeatedly produce failures,
- which agents perform well for particular classes of work,
- which tasks should require human review,
- which evidence should be gathered before a decision,
- which historical context predicts an issue,
- which workflows can safely become more autonomous,
- and how organizational practices evolve.

This is where Campfire begins moving from:

> “The team remembers.”

toward:

> **“The organization learns.”**

### Constraint

Campfire should not claim organizational learning merely because it can summarize old work.

Learning requires outcomes, corrections, provenance, and evidence that prior experience changes future behavior.

---

# 12. Human Interface Roadmap

Campfire begins agent-facing because cross-harness continuation is the first proof.

But humans are first-class participants.

A human interface should emerge as the domain model stabilizes.

### Early interface

A simple inspector can show:

```text
Workspace
Goal
Participants
Open tasks
Findings
Decisions
Artifacts
Timeline
Provenance
```

### Later interface

The UI may evolve toward:

- workspace overview,
- team activity,
- agent activity,
- approval queue,
- decisions,
- related work,
- organizational memory,
- capability management,
- policy visibility,
- provenance inspection.

### Principle

Do not build a collaboration dashboard before knowing what humans actually need to inspect or control.

The UI should expose the collaboration model rather than invent a second product model.

> Campfire should make shared work state tangible without making the interface the source of truth.

### Visible understanding

v1.10 made Orient, Catch Up, and Drill Down the context contract. The Viewer
may later become a visual projection of that same contract. It stays read-only.
`docs/SPRINT_VIEWER_001.md` still defines it as a projection, not a dashboard
and not a second store.

Workspace remains the only collection primitive. A Channel, or any second
collection of artifacts, would duplicate it.

```text
Workspace state
        |
        | authorized read
        v
Viewer projection
├── visual orientation
├── visual catch-up
├── workspace overview
├── current versus historical state
├── safe artifact previews
├── shared highlights
└── the existing activity timeline
```

Views are derived from Campfire state. The workspace remains canonical.
Artifact stays a typed reference. Renderer selection, preview, safe fetching,
and interaction stay in the Viewer. A highlight means "keep this visible."
Currentness is a separate fact. Highlights are not introduced before v1.11
correction and currentness semantics exist, and the first form is a shared
workspace highlight with provenance.

**Make Shared Understanding Visible** shipped as `v1.12.0` under a founder
override. The published slice is a bounded read-only Viewer clarification of
decisions, tasks, reasons, cited evidence, and truncated sections. Artifact
previews and shared highlights stayed deferred. A human comprehension trace
on that surface is still open. Section 21 records the override and the
evidence still required.

After v1.16, the proposed v1.17 Shared Work Home makes this existing
projection easier to use from a personal or team perspective. Its attention
items must be derived from authorized recorded state; it cannot infer live
agent presence from a session timestamp or turn the Viewer into a process
manager. Section 21 defines the proposed scope and its open evidence gates.

Generated workspace views stay later. They are derived from authorized
structured state, sandboxed, and non-canonical. They receive no Campfire
credentials and no unrestricted writes. Arbitrary HTML is untrusted:
agent-authored markup needs sandboxing, a content security policy, capability
isolation, and no path to Campfire credentials. Campfire is a multi-principal
authorization boundary, so a personal-agent rendering model does not transfer.
Section 21 states the evidence required before that work becomes sprint scope.
The published `v1.13.0` playbook does not supply that evidence.

---

# 13. Deployment Roadmap

Campfire should earn deployment complexity.

### Stage A — Local proof

```text
local service
SQLite
MCP
two harnesses
```

### Stage B — Shared development environment

```text
team-hosted service
persistent database
basic authentication
workspace membership
```

**Implementation status:** Sprint 005 GO on the team-hosted SQLite/HTTP path.
The Workers/D1 path adds a deployable remote store and API, but does not by
itself prove sustained team usage or the full Stage C product.

### Stage C — Hosted team product

```text
multi-user
remote state
organization/team boundaries
authorization
audit
```

### Stage D — Enterprise

Potentially:

```text
SSO
SCIM
policy integration
service identities
tenant controls
audit export
regional/data controls
advanced capability policy
```

Do not build Stage D architecture into Stage A unless a domain invariant requires it.

---

# 14. What We Should Explicitly Not Roadmap Yet

Campfire should resist adding fashionable capabilities without evidence.

Do not commit yet to:

- autonomous agent swarms,
- a proprietary agent harness,
- model hosting,
- universal company search,
- generic RAG,
- a vector database product,
- a replacement for Slack,
- a replacement for GitHub,
- a replacement for Linear,
- full workflow automation,
- a generalized agent runtime,
- agent marketplaces,
- no-code agent builders,
- autonomous company management,
- a Channel object beside Workspace,
- canonical presentation or hosted content inside Artifact,
- a skills platform or workflow engine,
- broader generated workspace views without evidence beyond the bounded v1.14 founder override,
- highlights that override correction and currentness,
- treating MCP compatibility as identity, membership, or authorization.

One incident-investigation playbook was tested after currentness existed and
published, opt-in, as `v1.13.0`. On three frozen synthetic incidents it
improved recording and left continuation unchanged. Continuation was already
at the rubric ceiling in both arms. That result is guidance for recording.
It is not a skills platform, and it does not authorize a second playbook.
Section 21 sequences what the result leaves open. The pilot does not meet
the entry gate for generated workspace views.

Some may eventually interact with Campfire.

None is required to establish the product category.

---

# 15. Evidence Gates

Every major phase should have an explicit evidence gate.

## Gate A — Continuity

**Question:** Can Agent B continue Agent A's work?

Required before Phase 2.

## Gate B — Repeat Usage

**Question:** Do humans/agents choose to reuse the workspace across multiple sessions?

Required before investing heavily in collaboration UX. The v1.12 visual
surface shipped under an explicit founder override while this gate was
unmeasured. That override does not retire the gate. A generated workspace
view is the same class of investment. The bounded v1.14 page shipped under a
separate founder override while Gate B remained unmeasured; that exception does
not retire the gate for broader collaboration UX.

Sprint 004 showed repeat-session behavior in a deterministic trace. Field
Trace 001 was cancelled by founder decision before a qualifying multi-day human
run. Gate B remains unmeasured; future design-partner evidence must establish
voluntary return.

## Gate C — Multi-Participant Value

**Question:** Does Campfire become more useful when multiple humans and agents contribute?

Required before broad team features.

Sprint 006 showed a third human's contribution changing a second agent's
continuation on the hosted token/invite path. That controlled result is GO for
the product surface; Field Trace 001 was cancelled by founder decision before a
qualifying multi-participant run. Gate C remains unmeasured for ordinary team
value.

## Gate D — Authorization Need

**Question:** Do real collaboration scenarios produce meaningfully different access requirements?

Required before sophisticated policy infrastructure.

## Gate E — Historical Reuse

**Question:** Does prior completed work materially improve new work?

Required before deep organizational-memory investment.

## Gate F — Controlled Action

**Question:** Do teams want agents to coordinate actions through the shared workspace?

Required before capability/orchestration investment.

## Gate G — Learning

**Question:** Can accumulated outcomes measurably improve future agent behavior or team decisions?

Required before claiming organizational learning.

---

# 16. Success Metrics by Maturity

Campfire's metrics should evolve with the product.

### Early proof

Measure:

- successful cross-harness continuations,
- context retrieved,
- transcript-free handoffs,
- provenance completeness,
- incorrect/missing context.

### Team collaboration

Measure:

- reused workspaces,
- number of distinct human participants,
- number of distinct agent/harness participants,
- repeated investigations avoided,
- manual handoffs avoided,
- workspace continuation rate.

For the proposed personal-to-team path, also measure a dated sequence:
voluntary return to a workspace, an invited second human's authorized use,
and a subsequent human-agent continuation. Define each denominator before
calling it conversion or weekly team usage. Installation identifiers and
agent sessions do not establish unique humans or active teams.

### Team memory

Measure:

- prior work reused,
- related-work retrieval success,
- historical decisions referenced,
- stale context detected,
- time-to-orientation reduction.

### Coordination

Measure:

- delegated tasks,
- approvals,
- successful actions,
- interventions,
- failed/blocked actions,
- capability violations prevented.

### Organizational learning

Eventually measure:

- repeated failure reduction,
- improved task completion,
- reduced human intervention,
- improved evidence quality,
- better agent routing/selection,
- changes in behavior based on prior outcomes.

Avoid vanity metrics such as raw token volume or number of stored memories.

---

# 17. Relationship to the Boring Infra Portfolio

The roadmap should allow Campfire to compose with the broader Boring Infra thesis without becoming a forced umbrella product.

```text
Combie
Engineering context
        \

Harnie ----\
Work state  \
             \
Meno ---------> Campfire
Verification  / Collaboration
             /
Pico --------/
Authority
        \
         \
Agent Observability
Behavior + outcomes
```

The products answer different questions:

```text
Combie:
What exists and how does it relate?

Harnie:
What was the agent doing?

Meno:
What claims are actually supported?

Pico:
What can the agent reach and where is that dangerous?

Agent Observability:
How is the agent behaving?

Campfire:
How do people and their agents work together?
```

The portfolio becomes more coherent if each product proves its primitive independently before deeper integration.

Campfire should be designed for composition, not dependency.

---

# 18. Long-Term Product Shape

If the roadmap succeeds, Campfire evolves through three recognizable product eras.

## Era I — Continuity

> **Your agent knows what the team already figured out.**

Primary value:

- cross-harness handoff,
- shared work state,
- provenance.

## Era II — Collaboration

> **People and agents work from the same operational context.**

Primary value:

- persistent workspaces,
- identity,
- authorization,
- tasks,
- decisions,
- artifacts,
- approvals,
- team memory.

## Era III — Learning

> **The organization gets better at working with agents because of everything it has learned before.**

Primary value:

- organizational memory,
- related prior work,
- outcomes,
- verification,
- behavior,
- controlled autonomy,
- organizational learning.

This progression keeps the long-term ambition large without making the first product vague.

---

# 19. v1.0 Cut

The docs originally never named a v1.0. The first shippable product is:

> **A team-hosted, harness-independent shared workspace a 3–20 person engineering team would keep using for ongoing work.**

v1.0 is Era I complete plus the smallest Era II slice that makes a small multi-harness team keep a workspace alive. It is **not** organizational memory, a dashboard, GitHub sync, SSO, or orchestration.

Evidence already in hand:

- Gate A (continuity) — Sprint 001 GO, Sprint 002 GO

The v1.0 product cut used these sprint acceptance results:

- Gate B product surface — Sprint 004
- Gate C product surface — Sprint 006
- Deployment Stage B (team-hosted process, actor tokens, invite membership) — Sprint 005

Sprint 004 and 006 results explicitly did not claim week-long team dogfood.
Field Trace 001 was cancelled by founder decision before a qualifying run, so
Gate B and Gate C external behavioral evidence remains unmeasured. Sprint 002's
real cross-harness proof used Codex and OpenCode; the planned Claude Code live
rerun was blocked by expired OAuth credentials and remains separate harness
validation.

Sequence:

```text
003 Agent orientation          in tree
004 Living workspace           GO (Gate B product surface)
005 Team identity + hosted     GO (Stage B)
006 Multi-participant value    GO (Gate C product surface) → 1.0.0
```

---

# 20. v1.1 Cut and Next Evidence

v1.1.0 is a Viewer visual release: the read-only `campfire view` journal
defaults to the Campfire palette and logomark, with `--theme fx` preserving the
earlier palette. The Worker serves installer downloads and authenticated APIs,
not a public browser journal.
The work-state model, workspace authorization boundary, and sprint acceptance
gates are unchanged. Workers/D1 is an available deployment path, not a claim
that the hosted-team Stage C product or daily team retention has been proven.

Field Trace 001 was cancelled by founder decision before a qualifying run. The
required two independently operating humans were not available, so its pilot
evidence is preserved but excluded from Gate B and Gate C. It does not establish
retention, ordinary team value, or external PMF.

The next product sequence is founder-led internal validation. Sprint 008 — Enter
the Room is GO (precise Time to Context 19.8 s). Sprint 009 — Align Before
Execution is GO (recorded alignment boundary). Sprint 010 — Return to the
Workspace is GO (caller-supplied return cursor). Sprint 011 — Natural
Contribution is GO (agent-interface guidance; cold contributor + downstream
trace). Sprint 012 — Close the Workspace is GO (session-bound lifecycle;
cold closer + downstream trace). By founder decision, Sprint 013 was a
release-only contract: the proven state shipped as `v1.2.0` without requiring
a design-partner trace. Gate B repeat usage and Gate C multi-participant value
remain externally unmeasured, and the release makes no PMF claim. Sprint 014
— Trust the Operator Path is GO as a narrow operator-path fix. Its audited
`v1.2.1` patch is published and deployed. It does not introduce collaboration
behavior or establish external product evidence. Sprint 015 —
Zero-to-Shared-Workspace Onboarding is the next narrow product slice: replace
the fixture-led first run with one deterministic setup composition over the
existing identity, token, Workspace, Goal, invite, membership, session, and
preflight boundaries. It is GO and published as minor release `v1.3.0`.
It does not establish Gate B/C or PMF evidence.

Sprint 016 — Agent-Led Setup & Human Handoff is complete (CONDITIONAL GO).
It adds setup, connect, doctor, and handoff at the interface boundary so an
agent can prepare a Codex or OpenCode connection and a token-free Viewer
receipt. Hosted doctor requires the registered session id. OpenCode completed
prompt-to-Viewer; Codex did not. Campfire does not become a runtime
supervisor or orchestration engine. This sprint does not establish repeat
usage, multi-participant value, or PMF. It is published and deployed as
backward-compatible minor release `v1.4.0`; publication does not upgrade the
sprint's CONDITIONAL GO evidence.

---

# 21. Near-Term Sequence

The immediate sequence should remain disciplined:

```text
Product Definition v0.2   ✓
        ↓
Vision v0.2               ✓
        ↓
Architecture v0.2         ✓
        ↓
Roadmap v0.2              ✓
        ↓
Sprint 001 GO             ✓
        ↓
Sprint 002 GO             ✓ (deterministic + real-harness evidence; see result doc
        ↓                   for what was real vs synthetic)
Sprint 003 — Agent orientation (PARTIAL: deterministic exit met, in tree;
        ↓                   real-harness rerun + Claude Code outstanding)
Sprint 004 — Living workspace (Gate B surface)   GO ✓
        ↓
Sprint 005 — Team identity + hosted instance (Stage B)   GO ✓
        ↓
Sprint 006 — Multi-participant surface (Gate C surface) → v1.0   GO ✓
        ↓
Viewer-002 — Team journal   GO ✓
        ↓
v1.1.0 — Viewer Campfire theme + logomark   shipped ✓
        ↓
Sprint 007 — Harness readiness preflight   GO ✓
        ↓
Field Trace 001 — cancelled by founder decision; Gate B/C unmeasured
        ↓
Sprint 008 — Enter the Room   GO ✓ (Time to Context 19.8 s)
        ↓
Sprint 009 — Align Before Execution   GO ✓
        ↓
Sprint 010 — Return to the Workspace   GO ✓
        ↓
Sprint 011 — Natural Contribution   GO ✓
        ↓
Sprint 012 — Close the Workspace   GO ✓
        ↓
Sprint 013 — Public Release v1.2.0   GO ✓; Gate B/C remain unmeasured
        ↓
Sprint 014 — Trust the Operator Path   GO ✓; v1.2.1 released + deployed; live operator path verified
        ↓
Sprint 015 — Zero-to-Shared-Workspace Onboarding   GO ✓; v1.3.0 minor release
        ↓
Sprint 016 — Agent-Led Setup & Human Handoff   CONDITIONAL GO; v1.4.0 released + deployed; OpenCode prompt-to-Viewer validated; Codex setup incomplete; Gate B/C remain unmeasured
        ↓
Sprint 017 — Quiet Install & First Workspace   GO ✓; v1.5.0 released + deployed; cold human-first path + Codex auto-connect + real Viewer verified
        ↓
Sprint 018 — Enter With the Session   GO ✓; v1.6.0 released + deployed; cold Codex + OpenCode read before acting; loopback listener start and reuse; Gate B unmeasured
        ↓
Sprint 019 — Carry the Work Out   GO ✓; v1.7.1 released; one signed webhook for a closed event vocabulary; not Phase 4/5; Gate B/C/F unmeasured
        ↓
Sprint CLI-001 — Agent-Native Interface Contract   GO ✓; v1.8.0 released + deployed; first-class CLI for humans and agents; Gate B/C/F unmeasured
        ↓
Sprint 020 — Bring the Next Teammate In   IMPLEMENTED CANDIDATE; v1.9.0; CONDITIONAL GO pending independent two-human/two-machine and both live recipient paths; not published/deployed; see docs/SPRINT_020_RESULT.md; Gate B/C unmeasured
        ↓
Sprint CTX-001 — Keep Shared Understanding Current   GO for the local release gate; published v1.10.0; one Codex agent passed scenarios A/B/C; see docs/SPRINT_CTX_001_RESULT.md; Gate B/C unmeasured
        ↓
Sprint COR-001 — Correct the Record   CONDITIONAL GO; published v1.11.0; production not deployed; one operator, one machine; Codex and OpenCode cold and catch-up traces passed; fixture participants only; see docs/SPRINT_COR_001_RESULT.md; Gate B/C unmeasured
        ↓
Sprint VIS-001 — Make Shared Understanding Visible   CONDITIONAL; bounded condition-3 Viewer slice published and deployed as v1.12.0 under founder override; condition 4 and human comprehension trace open; see docs/SPRINT_VIS_001_RESULT.md
        ↓
Sprint WOW-001 — Prove a Way of Working   GO on a frozen synthetic pilot; published and deployed as v1.13.0; recording gain on 3/3 matched pairs; continuation at ceiling in both arms; no second playbook; see docs/SPRINT_WOW_001_RESULT.md; Gate B/C unmeasured
        ↓
Next evidence — Viewer comprehension and which references are opened   not a release; open from v1.12; review the reference observation by October 14, 2026
        ↓
v1.14 — Generated workspace views   published and deployed under founder override; original evidence gate open; see docs/SPRINT_GWV_001_RESULT.md
        ↓
v1.15 — Performance and security hardening   published and deployed as v1.15.0; no new product surface; see docs/SPRINT_PSA_001_RESULT.md
        ↓
v1.16 — Recall and portable handoff   published and deployed as v1.16.0 under October 13 founder release direction; RCL-001, RCL-002, and RCL-003 NO-GO / REFRAME remain; Gate E open; see docs/RELEASE_V1_16_DECISION.md
        ↓
v1.17 — Shared Work Home   published and deployed as v1.17.0 under the October 14 founder release-scope override; D1–D7 deterministic checks pass; controlled human traces and observations still open; see docs/RELEASE_V1_17_DECISION.md
        ↓
v1.18 — Continue the Work   WCO-001: baseline and labeled rehearsal recorded (eligible human case not observed); Amendment 1 bounded guidance/schema repair implemented, D1–D6 pass; CONDITIONAL GO — engineering candidate; published and deployed as v1.18.0 under the recorded founder release-scope override (docs/RELEASE_V1_18_DECISION.md); human case still not observed
        ↓
v1.19 — Trustworthy Team Attention   ATT-001: v1.18.0 baseline frozen (fixture v2), engineering candidate implemented, D1–D6 pass, independently verified; two-person comprehension trace NOT OBSERVED; recorded as CONDITIONAL GO — engineering candidate; published and deployed as v1.19.0 under the recorded founder release-scope override (docs/RELEASE_V1_19_DECISION.md); human trace still not observed
```

The sequence adopted on October 3, revised on October 9 after `v1.14.0`, and extended on October 10 with the implemented-candidate v1.16 sprint is:

```text
v1.10 — KEEP SHARED UNDERSTANDING CURRENT
        shipped
        Orient, Catch Up, and Drill Down
        one cold Codex trace on one machine
        Gate B and Gate C unmeasured

v1.11 — CORRECT THE RECORD
        published v1.11.0
        CONDITIONAL GO
        supersession, correction, evidence relationships, visible currentness
        one operator, one machine, both local harnesses
        production not deployed
        Gate B and Gate C unmeasured
        see docs/SPRINT_COR_001_RESULT.md

v1.12 — MAKE SHARED UNDERSTANDING VISIBLE
        published and deployed v1.12.0, CONDITIONAL
        bounded read-only Viewer clarity fixes for decisions, tasks,
        reasons, cited evidence, and truncated sections
        artifact previews and shared highlights deferred
        condition 4 and human comprehension trace outstanding
        Gate B and Gate C unmeasured
        see docs/SPRINT_VIS_001_RESULT.md

v1.13 — PROVE A WAY OF WORKING
        published and deployed as v1.13.0
        one opt-in incident-investigation playbook, version 1.0.0
        default off; CLI `campfire playbook` and MCP `get_playbook`
        static guidance; no new domain object and no workflow execution
        contract: docs/Campfire-v1.13-WOW-001-Prove-a-Way-of-Working.md
        frozen pilot fixtures: fixtures/incidents/wow-001/
        synthetic pilot GO; 3/3 treatment passes and 3/3 matched recording gains
        continuation already at the rubric ceiling in both arms
        no measured continuation gain
        the GO does not authorize a second playbook
        Gate B and Gate C unmeasured
        see docs/SPRINT_WOW_001_RESULT.md

NEXT EVIDENCE — before another surface
        not a release and not a new projection
        one human comprehension trace on the shipped v1.12 Viewer
        which references a person tries to open
        review the reference observation by October 14, 2026
        a recorded absence is a result
        if no opportunity occurs, the only build is a read-only Viewer
        reference affordance that records the attempt
        that affordance fetches nothing and previews nothing
        previews and highlights stay deferred; the bounded generated view proceeds under the founder override below
        these observations are v1.12 evidence; they are not credited to v1.13

v1.14 — GENERATED WORKSPACE VIEWS
        published and deployed as v1.14.0 under the October 9 founder override
        entry evidence remains open; Gate B and Gate C unmeasured
        not a GO, Gate B, or Gate C result
        publication record: docs/SPRINT_GWV_001_RESULT.md
        one derived view of authorized workspace state
        sandboxed and non-canonical
        no Campfire credentials and no unrestricted writes
        no second store and no new domain object
        the workspace remains complete when the view is absent
        see docs/ARCHITECTURE.md

v1.15 — BOUND WORK AND PROTECT READ BOUNDARIES
        published and deployed as v1.15.0 from the October 9 audit
        guard the local Viewer request Host boundary
        enforce the Worker call-body limit while streaming
        keep unexpected internal errors out of client responses
        bound webhook delivery reads and request-time work
        remediate and triage production dependency advisories
        no new collaboration surface or Gate B/C claim
        audit: docs/SPRINT_PSA_001_AUDIT.md
        contract: docs/Campfire-v1.15-PSA-001-Performance-and-Security-Hardening.md

v1.16 — RECALL AND PORTABLE HANDOFF
        published and deployed as v1.16.0 under founder release-scope override
        see docs/RELEASE_V1_16_DECISION.md
        RCL-001, RCL-002, and RCL-003 NO-GO / REFRAME remain; Gate E open
        one authorized workspace search with currentness and provenance
        one explicit offline JSON packet for a named authorized participant
        bounded decision rationale appears in the live recall response and offline packet; RCL-003 added query-matched decision sets
        RCL-002 scored nine locked arms and did not meet the synthetic pass bar; it does not rescore RCL-001
        RCL-003 scored nine new locked arms; no qualified next-action win was measured, citation was confounded by treatment-only guidance, and one offline recipient promoted a superseded rationale
        post-verdict packet projection was corrected; one unscored recipient recheck used the corrected packet without promoting the historical rationale, but is not a matched before/after result; prioritize an ordinary-work Gate E observation before another synthetic next-action pilot
        no cross-workspace index, transcripts, embeddings, or packet import
        contract: docs/Campfire-v1.16-RCL-001-Recall-and-Portable-Handoff.md
        second measurement: docs/Campfire-v1.16-RCL-002-Recall-Over-Orientation.md; result: docs/SPRINT_RCL_002_RESULT.md
        decision-safety measurement: docs/Campfire-v1.16-RCL-003-Decision-Safety-and-Source-Use.md; result: docs/SPRINT_RCL_003_RESULT.md

v1.17 — SHARED WORK HOME (PUBLISHED AND DEPLOYED AS v1.17.0 UNDER FOUNDER OVERRIDE)
        contract: docs/Campfire-v1.17-SWH-001-Shared-Work-Home.md
        result: docs/SPRINT_SWH_001_RESULT.md
        release decision: docs/RELEASE_V1_17_DECISION.md
        one read-only home for an authorized workspace
        make existing goal, current work, participants, ownership,
        attention derived from recorded state, decisions, and source
        references legible
        personal and team perspectives are projections of the same state
        My work / Team work in the existing Viewer; shared decision boundary;
        bounded completeness per slice; inert artifact references
        no raw prompts, transcripts, terminal output, inferred agent presence,
        agent process control, new collection primitive, or hosted multi-tenancy
        D1–D7 deterministic checks pass on the recorded candidate; the
        two-human controlled trace, the shipped-v1.16 Viewer trace, the
        reference-open observation, and an ordinary-work continuation are
        not yet scored; the candidate is unscored, not CONDITIONAL GO
        published and deployed as v1.17.0 under the October 14 founder
        release-scope override; the override is recorded in
        docs/RELEASE_V1_17_DECISION.md and is not a GO verdict; it ships the
        read-only Viewer home, not a hosted shared-login service
        Gate B, Gate C, Gate E, and the v1.12 human/reference observations remain open
```

The original v1.12 entry contract required all of these before sprint scope:

- v1.10 has live cold-agent evidence against a realistically large workspace, beyond the single-machine CTX-001 gate;
- v1.11 correction and currentness semantics exist in the v1.11.0 release source, CONDITIONAL GO;
- at least one observation shows that humans struggle to understand Campfire state that is otherwise correct;
- there is evidence about which artifacts people actually try to open.

Condition 4 remains unmet. On October 7, 2026, the founder authorized the
bounded condition-3 Viewer slice and its release despite that open condition.
This was an explicit override of the contract's implementation and release
sequence, not evidence that the entry gate passed. The remaining visual scope
remains deferred; the v1.12.0 verdict is CONDITIONAL until a human trace
tests comprehension on the shipped surface. See `docs/SPRINT_VIS_001_RESULT.md`.

The sequence originally adopted on October 9, 2026, after published `v1.13.0`, set this entry gate for generated views:

- the human comprehension trace on the shipped v1.12 Viewer is recorded;
- the reference-open observation is recorded, including a recorded absence on or after October 14, 2026;
- that evidence says the defect is presentation of state the trace could already explain, rather than missing or incorrect workspace state;
- the v1.13 pilot's recording gain is not that evidence, and the absence of a continuation gain stays visible;
- Gate B may still be unmeasured. A generated view does not claim it.

On October 9, the founder explicitly overrode the entry sequence for the bounded GWV-001 candidate, then confirmed that Campfire has users, they have personally tested it, it is working as planned, and work should continue. The candidate is published and deployed as v1.14.0 under that decision. The listed observations remain unrecorded; this override does not claim Gate B or Gate C. See `docs/SPRINT_GWV_001_RESULT.md` for the decision, implementation, and checks. A second playbook is a separate founder decision and is not part of this scope.

The product risk is polishing a surface before teams repeatedly rely on the collaboration state. Leaving that state in structured form for another release is acceptable.

These boundaries govern the sequence:

- Workspace stays the only collection primitive.
- Artifact stays identity, type, title, reference, metadata, and provenance. Presentation is a Viewer concern. See `docs/ARCHITECTURE.md` and `docs/PRODUCT_DEFINITION.md`.
- A highlight is shared workspace salience with provenance. It does not make a superseded finding or a rejected decision current. Introduce highlights with or after v1.11. v1.12 and v1.13 did not introduce them.
- Setup may disappear into the agent's normal workflow. Authorization stays visible. The promise is: if an agent supports MCP, it can work from the caller's authorized Campfire context. Enrollment and the session boundary stay explicit.
- A playbook is guidance for how to record useful state. It is not workflow execution and not new domain machinery. `incident-investigation` 1.0.0 is published opt-in. Further playbooks wait on a continuation gain, or on a founder decision that names what else would be measured. Call it a workspace playbook, not a harness skill.

## Post-v1.16 direction — make shared work legible

The next product question is whether two people using different coding agents
can understand each other's recorded work, identify where they need to
coordinate, and continue without sharing private agent sessions. Campfire
should make that possible through the workspace they already use, rather than
requiring a new coding environment or a new kind of thread. A developer alone
should find the same workspace useful with their own agents; inviting a
teammate should add a team perspective, not migrate the work to another
product or plan. "Personal" and "team" describe views of authorized state,
not new storage or automatic privacy classes.

Solo, Delta, and Agentbox sharpen this direction in different ways:

| Reference | Lesson for Campfire | Boundary |
| --- | --- | --- |
| [Solo](https://github.com/soloterm/solo) | One compact place to navigate work can reduce the cost of checking several concurrent activities. | Solo is a Laravel command manager. Campfire is not adding a terminal multiplexer or agent start/stop controls in v1.17. |
| [Delta](https://zed.dev/blog/introducing-delta) | Shared work is easier to understand when decisions, code references, and review context stay connected. | Delta is also pursuing external agents; harness independence alone is not a proven moat. Campfire does not need synchronized worktrees, conversation sharing, or a new version-control layer. |
| [Agentbox](https://github.com/savannahfeder/agentbox) | Put actionable attention derived from recorded work ahead of a stream of agent activity. | Campfire does not become an agent runner, scheduler, queue, or source of inferred live status. Study the interaction pattern; do not reuse its GPL code without a license review. |

### v1.17 — Shared Work Home

Start with one authorized workspace and the existing read-only Viewer. The
first view should answer: What is the goal? What work is open or blocked? What
needs me or the team based on recorded state? Which human or agent owns a task?
Which decisions and cited findings affect it? Where is the recorded artifact or code
reference? Preserve source IDs, currentness, provenance, and completeness
signals when a list is truncated. Use existing workspace participants, agent
ownership, tasks, orientation, attention items, and activity rather than
inventing agent presence or a second canonical work feed. A session timestamp
does not establish that an agent is working, waiting, or blocked now.

The personal perspective emphasizes a caller's owned agents and actionable
items. The team perspective shows the other authorized participants and their
**recorded** work at a useful level of detail. Workspace records are shared
with authorized participants under the existing membership model; merely
hiding a field in the Viewer is not a privacy boundary. Private prompts,
responses, tool arguments, terminal output, and unshared local files must not
be pulled into that model or exposed through a new read path. Task titles,
artifact names, and summaries can themselves reveal information, so any new
shared field needs service-side authorization and a deliberate write/share
contract. The Viewer must continue to use its bounded read allowlist and
server-side credential handling.

Link a decision or finding to a code, test, commit, or artifact reference only
when that relationship was recorded. Make the reference inspectable without
claiming Campfire fetched, verified, or synchronized its target. First observe
an actual attempt to open a real accessible reference, as VIS-001 condition 4
requires. If the missing affordance is the obstacle, scope a read-only link
that performs no preview or external fetch, and record its security review in
the v1.17 sprint. Rich previews, automatic code ingestion, inline code review,
and cross-workspace dependency detection remain later questions.

The v1.17 sprint contract freezes this slice, the authorization and privacy
checks, a human comprehension task, a real
reference-open observation path, and release criteria before implementation
is judged. See `docs/Campfire-v1.17-SWH-001-Shared-Work-Home.md`. The bounded
slice is implemented as an engineering candidate; `docs/SPRINT_SWH_001_RESULT.md`
records the D1–D7 deterministic checks and the still-unscored human
observations. The
observation should test whether a person can identify the
current work and unresolved or competing decisions **without** Campfire
inventing an operative decision. It should include a genuine two-person,
two-agent continuation in ordinary work when available. Count voluntary
return and real cross-human use separately from installation activity. If a
prior evidence gate is bypassed to ship a bounded slice, record the founder
decision as an override, not as a GO or gate satisfaction. v1.16 publication
did not change the RCL-001/002/003 NO-GO / REFRAME verdicts or close Gate E.

### Direction after v1.17

The v1.18 work-continuity sprint is `docs/Campfire-v1.18-WCO-001-Continue-the-Work.md`. It began with the shipped v1.17 behavior and allowed a dated, evidence-backed amendment for the smallest repair. The contract did not close Gate B/C/E or the open v1.17 human observations by declaration. Its recorded status is CONDITIONAL GO — engineering candidate: the eligible two-human case is NOT OBSERVED, the witnessed gap comes from a labeled rehearsal, and the bounded Amendment 1 repair passes D1–D6 without claiming human continuation; see `docs/SPRINT_WCO_001_RESULT.md`. v1.18.0 was separately released under the recorded founder override.

The v1.19 team-attention sprint is `docs/Campfire-v1.19-ATT-001-Trustworthy-Team-Attention.md`. It targets two inspectable gaps in the shipped context projection: attention derived from bounded task/decision pages can appear exhaustive when those pages are truncated, and an accepted decision citing non-current evidence has no team review cue. The contract froze a v1.18.0 baseline (fixture v2), limits the change to existing service and read-only Viewer surfaces, and scores both deterministic source fidelity (D1–D6) and a two-person comprehension trace (H1–H6). Its recorded status is **CONDITIONAL GO — engineering candidate**: D1–D6 pass on the recorded candidate (`b18a536`, `bb007c7`, `d7addb2`), independent verification closed two mutation survivors, and the two-person trace is **NOT OBSERVED** because the engineering session had one operator and §6 forbids substituting agents or the builder; see `docs/SPRINT_ATT_001_RESULT.md`. The founder subsequently directed a full public v1.19.0 release, published and deployed on October 15, 2026 under the recorded release-scope override in `docs/RELEASE_V1_19_DECISION.md`; that override moves no gate. It introduces no notifications, ownership inference, controlled requests, coordination, or Gate F evidence, and it does not close Gate B/C/E/F or the WCO-001/SWH-001 observations.

| Order | Product question | Evidence before expansion |
| --- | --- | --- |
| Work continuity | Can an invited teammate and their agent take over recorded work, resolve a real dependency, and leave the next person oriented? Build on existing enrollment, task ownership, corrections, and handoff. | Voluntary repeat use (Gate B) and ordinary multi-participant value (Gate C), not another fixture-only pass. |
| Team attention | Which recorded blockers, reviews, or ownership conflicts need a particular human or team? Consider notifications or controlled requests only after the work view is useful. | Measure missed and false attention; Gate F precedes coordination or action. |
| Historical reuse | Does prior completed work materially improve a new task, and can a recipient safely use a portable packet? | Collect ordinary-work Gate E observations under `docs/GATE_E_PROTOCOL.md`; the v1.16 synthetic NO-GO results stay visible. |
| Hosted team offering | Does a team return, invite others, and value durable shared state enough to pay? | Gate B/C evidence, a cost and retention picture, and an explicit product/architecture decision before accounts, tenant boundaries, billing, or quotas. |

The commercial hypothesis is a free downloadable core and, later, a paid team
service for the collaboration that teams repeatedly use. A small free hosted
allowance (for example, up to three humans and five registered agent
identities per team) and a founding-team price are experiments, not a v1.17
entitlement or pricing commitment. An installation ID is not a unique person,
an active team, or a paying customer. Billing and a hosted multi-tenant
control plane remain explicitly deferred in the Product Definition and the
engineering skill for v1.x; moving them into a numbered release requires a
separate amendment and evidence. Do not assign them v1.19 or v1.20 merely
because that sequence sounds convenient.

## Other adjacent references

Television is an adjacent personal-agent product that organizes persistent interactive artifacts into Channels and pins those Channels. Its repository is [telepath-computer/television](https://github.com/telepath-computer/television), and its channel specification is [channels.md](https://github.com/telepath-computer/television/blob/main/specs/product/channels.md). That contrast is useful. It is not a roadmap to copy.

> Television organizes things. Campfire should organize understanding.

Telepath Stash is worth monitoring and not worth adopting. It describes shared planning files, artifacts, and coordination state across agents, and it points toward indexing, meaning, versioning, and collaboration layers. The note is [Introducing Stash](https://buttondown.com/telepath/archive/introducing-stash-local-first-sync-for-agents/). That territory is adjacent to Campfire. It does not change this sequence.

## Roadmap and sprint boundary

The roadmap provides direction.

The sprint provides commitment.

Those should remain separate.

---

# 22. North Star

Campfire should move toward a world where this interaction feels normal:

```text
Yesterday

Sergio + Codex
discovered why a service was failing.

        ↓

Campfire retained the useful team state.

        ↓

Today

Alice + Claude Code
continue from that understanding.

        ↓

Tomorrow

Another teammate + another agent
can continue again.

        ↓

Over time

The organization remembers what happened,
understands why,
and learns from the outcome.
```

No transcript forwarding.

No manual handoff document.

No dependence on a single harness.

No loss of provenance.

No assumption that every agent may access everything.

The first milestone is continuity.

The long-term destination is infrastructure for organizations where humans and agents genuinely work as one team.

> **Make agents work like they are part of the team.**
