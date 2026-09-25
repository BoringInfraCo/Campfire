# AGENTS.md

This file defines the operating instructions for coding agents working in the Campfire repository.

Campfire is a Boring Infra Co. project.

---

## Product Context

Campfire is:

> **The shared workspace where people and their agents work together.**

Campfire provides a secure, harness-independent collaboration boundary for durable work state shared across humans and agents.

The north star is:

> **Make agents work like they are part of the team.**

The current product thesis is **not** generic multi-agent orchestration.

The immediate proof is much narrower:

```text
Human A + Agent A
        |
        | contributes durable work state
        v
     Campfire
        |
        | authorized retrieval
        v
Human B + Agent B
```

Agent B must be able to continue the work without receiving Agent A's private transcript or a manually prepared handoff.

---

## Read Before Implementing

Per `skills/build-campfire/SKILL.md` (the canonical Engineering Constitution), read in this order before any substantive change:

1. `skills/build-campfire/SKILL.md`
2. `README.md`
3. `docs/PRODUCT_DEFINITION.md`
4. `docs/VISION.md`
5. `docs/ARCHITECTURE.md`
6. `docs/ROADMAP.md`
7. Active Sprint under `docs/SPRINT_*.md` / `docs/SPRINT_VIEWER_*.md`
8. Relevant code and tests under `src/` and `tests/`

```text
skills/build-campfire/SKILL.md
README.md
docs/PRODUCT_DEFINITION.md
docs/VISION.md
docs/ARCHITECTURE.md
docs/ROADMAP.md
docs/SPRINT_013.md
```

Sprint 009 — Align Before Execution is complete (GO); its result is
`docs/SPRINT_009_RESULT.md`. Sprint 008 — Enter the Room is complete (GO,
precise Time to Context 19.8 s); its result is `docs/SPRINT_008_RESULT.md`.
Sprint 007 is complete; its result is `docs/SPRINT_007_RESULT.md`. Sprint 010
— Return to the Workspace is complete (GO); its result is
`docs/SPRINT_010_RESULT.md`. Sprint 011 — Natural Contribution is complete
(GO); its result is `docs/SPRINT_011_RESULT.md`. Sprint 012 — Close the
Workspace is complete (GO); its result is `docs/SPRINT_012_RESULT.md`.
Sprint 013 — Public Release is complete (GO); its result is
`docs/SPRINT_013_RESULT.md`. The `v1.2.0` public snapshot, GitHub Release, and
production installer are live. Its contract explicitly defers design-partner
evidence. Sprint 014 remains undefined and is not authorized.

The Viewer is a read-only team journal. Do not add writes, Constraint/Instruction,
Electron, or a second store unless a new sprint doc requires it.

Higher-level documents establish the product invariants that sprints must not violate.

If documents conflict:

1. explicit current sprint acceptance criteria govern sprint scope,
2. architecture governs system boundaries,
3. product definition governs product semantics,
4. vision governs long-term direction,
5. roadmap is directional and should not be treated as committed sprint scope.

Do not silently resolve meaningful contradictions. Surface them.

---

# Product Invariants

These invariants are non-negotiable unless the product documents are explicitly revised.

## 1. Shared work state is not shared transcript state

Do not make raw conversation transcripts the canonical Campfire collaboration representation.

The system should preserve durable objects such as:

```text
Goal
Task
Finding
Decision
Artifact
Contribution
```

A private conversation may produce shared state.

Access to that shared state must not imply access to the originating transcript.

### Required invariant

```text
Shared Finding
    !=
Access to Private Conversation
```

---

## 2. Humans and agents are distinct identities

Do not collapse humans and agents into one generic anonymous author.

The conceptual hierarchy is:

```text
Organization
└── Team
    ├── Human
    │   └── Agent
    └── Workspace
```

An agent contribution should preserve:

- the agent identity,
- the harness where relevant,
- and the human or organizational principal the agent acted on behalf of where applicable.

Do not model `created_by = "codex"` as sufficient provenance.

---

## 3. Workspace is the collaboration boundary

Campfire does not begin with one universal organizational memory pool.

Shared state belongs to an explicit workspace.

```text
Workspace
├── participants
├── goal
├── tasks
├── findings
├── decisions
├── artifacts
└── contributions
```

Cross-workspace memory is future work.

Do not introduce implicit organization-wide retrieval during the current sprint. Cross-workspace memory is future work.

---

## 4. Authorization happens before retrieval

Do not retrieve unauthorized state into a harness and rely on the model to ignore it.

Authorization must occur before information crosses the Campfire boundary.

Conceptually:

```text
Actor
  +
Workspace
  +
Operation
  +
Resource
  ↓
Allow / Deny
```

Sprint 001 authorization may be simple.

The boundary must still be real.

---

## 5. Provenance is first-class

Meaningful shared state must preserve who or what contributed it.

Important mutations should create inspectable contribution/history records.

Campfire should eventually be able to explain:

```text
who contributed this?
when?
through which agent?
on whose behalf?
what changed?
```

Avoid destructive updates that erase meaningful provenance.

---

## 6. Campfire is harness-independent

Core domain objects must not depend on proprietary Codex, Claude Code, OpenCode, Cursor, or other harness session schemas.

Harness-specific logic belongs at interface/adaptation boundaries.

The domain should remain usable if every current agent vendor disappears.

---

## 7. MCP is an interface

Do not place Campfire's core collaboration semantics directly inside MCP handlers.

Preferred dependency direction:

```text
MCP Handler
    ↓
Application Service
    ↓
Authorization
    ↓
Domain
    ↓
Repository
    ↓
Persistence
```

MCP handlers should remain thin.

Future CLI, HTTP, SDK, or UI clients should be able to use the same application/domain layer.

---

## 8. Campfire is not an orchestration engine

Do not add agent scheduling, swarms, autonomous delegation, runtime management, or complex workflow execution unless explicitly required by the active sprint.

The current product proof is collaboration continuity.

---

## 9. Model inference is not required for correctness

Storage, authorization, provenance, identity, and lifecycle correctness must be deterministic.

Do not require an LLM to decide whether state exists, who created it, whether a transition is valid, or whether an actor is authorized.

LLM-assisted extraction, summarization, ranking, and memory derivation are future product capabilities.

---

## 10. Campfire must remain independently useful

Do not introduce required dependencies on Combie, Harnie, Meno, Pico, or other Boring Infra projects.

Those systems may compose with Campfire later.

Campfire must prove its own primitive first.

---

# Foundational Constraints

Sprint 001 proved the smallest end-to-end Campfire interaction. These constraints still apply.

Use two genuinely different agent harnesses.

The implementation should prefer:

```text
MCP
  ↓
thin adapters
  ↓
application services
  ↓
simple authorization
  ↓
domain
  ↓
SQLite
```

Do not add unless the sprint demonstrates a hard requirement:

```text
vector database
cloud control plane
distributed services
generalized graph database
automatic transcript ingestion
LLM memory extraction
semantic ranking
agent orchestration
complex policy language
enterprise IAM
```

Complexity is not evidence of product progress.

---

# Domain Model

The initial conceptual entities are:

```text
Organization
Team
Human
Agent
Workspace
WorkspaceParticipant
Goal
Task
Finding
Decision
Artifact
Contribution
```

Do not introduce a generic abstraction merely because multiple objects share fields.

Prefer explicit domain semantics during the first sprint.

A generalized relationship primitive should only be introduced if real implementation traces require it.

---

# State and History

Campfire needs both:

```text
Current State
```

and

```text
Historical Contributions
```

The current state should be easy for agents to retrieve.

The history should make provenance inspectable.

Full event sourcing is not required.

However, avoid architectures where updating an object destroys the ability to understand meaningful prior state.

---

# Lifecycle

Use explicit states where lifecycle matters.

For example:

```text
Task

open
  ↓
in_progress
  ├──> blocked
  ↓
completed
```

Reject invalid transitions.

Do not silently normalize contradictory state.

If reopening or superseding behavior is required, model it explicitly and test it.

---

# Context Retrieval

Sprint 001 context retrieval should be simple and deterministic.

A workspace context projection may include:

```text
workspace
goal
open tasks
active findings
accepted decisions
relevant artifacts
provenance
```

Do not add embeddings simply to retrieve a small known workspace.

The first question is whether the **state model** enables continuation, not whether semantic search can hide a weak state model.

---

# Transcript Isolation

Treat transcript isolation as a testable property.

The reference flow is:

```text
Private Session A
Human A <------> Agent A
                    |
                    | structured contribution
                    v
                Campfire
                    |
                    | structured retrieval
                    v
Private Session B
Human B <------> Agent B
```

Agent B must not require Session A's transcript.

Tests and demo fixtures should make this boundary obvious.

If the demo works only because information was copied from Session A into Session B outside Campfire, the sprint has failed.

---

# Testing Expectations

Tests should prioritize domain invariants and the Sprint 001 proof.

At minimum, cover:

- workspace creation,
- human identity,
- agent identity,
- human-agent attribution,
- participant membership,
- finding creation,
- decision creation,
- task lifecycle,
- artifact attachment,
- contribution/provenance creation,
- authorized context retrieval,
- unauthorized retrieval rejection,
- cross-harness continuation fixture,
- transcript-isolation assumptions.

Prefer deterministic fixtures.

Do not claim real-world evidence from synthetic fixtures.

Label fixture provenance accurately.

---

# Error Handling

Errors should be explicit and actionable.

Prefer typed/domain errors for cases such as:

```text
WorkspaceNotFound
ActorNotFound
Unauthorized
InvalidTransition
InvalidContribution
ParticipantRequired
ArtifactNotFound
```

Do not silently succeed when an operation did not occur.

Do not use model-generated prose as the only representation of an application error.

---

# Persistence

Sprint 001 uses SQLite unless the sprint document explicitly changes that decision.

Persistence should provide:

- stable IDs,
- foreign keys,
- deterministic migrations,
- transaction safety,
- timestamps,
- inspectable state.

Avoid storing critical domain state only inside serialized opaque blobs when explicit columns/tables would preserve useful semantics.

JSON metadata is acceptable for genuinely flexible auxiliary data.

---

# Observability

The first implementation should be easy to inspect.

At minimum, make it possible to understand:

- which actor performed an operation,
- which workspace was involved,
- whether authorization succeeded,
- which object changed,
- which contribution was recorded.

A useful rule:

> **If we cannot explain how Agent B received a piece of context, something is wrong.**

Structured application logs plus Campfire's contribution history are sufficient for Sprint 001.

---

# Security

Never:

- commit secrets,
- log credentials,
- expose unrelated workspace state,
- assume an agent inherits every human permission,
- bypass authorization for convenience,
- treat artifact references as proof of artifact authorization.

Preserve the conceptual distinctions:

```text
Private session
    !=
Shared workspace

Human identity
    !=
Agent identity

Workspace membership
    !=
Unlimited authorization

Artifact reference
    !=
Artifact permission

Human capability
    !=
Agent capability
```

---

# Implementation Style

Prefer boring, legible code.

Optimize for:

1. correctness,
2. explicit semantics,
3. testability,
4. inspectability,
5. small interfaces,
6. reversible decisions.

Avoid speculative abstractions.

Do not build infrastructure for roadmap phases that the current sprint does not require.

Comments should explain **why**, especially around product invariants, authorization, provenance, and unusual domain decisions.

Names should match the product language used in the documentation.

---

# Scope Discipline

The roadmap is not a backlog.

Future concepts such as:

- organizational memory,
- semantic retrieval,
- capability delegation,
- human approvals,
- agent-to-agent delegation,
- verification,
- behavioral observability,
- organizational learning,

are not current-sprint requirements unless explicitly pulled into the sprint document.

When encountering an attractive adjacent idea:

1. determine whether the current sprint requires it,
2. if not, record it as a future consideration,
3. continue the current proof.

Do not widen scope implicitly.

---

# Documentation Discipline

When implementation evidence changes a product assumption:

- update the relevant documentation,
- record why the assumption changed,
- keep terminology consistent,
- do not silently let code and docs diverge.

If Sprint 001 reveals that an entity or invariant is wrong, prefer changing the model based on evidence rather than preserving the document for its own sake.

The documents are hypotheses and contracts, not scripture.

---

# Definition of Done

The implementation is not complete merely because the MCP server runs.

Sprint 001 (complete, GO) tested the end-to-end product hypothesis:

```text
1. Human A works with Agent A.

2. Agent A discovers something meaningful.

3. Agent A contributes structured state to Campfire.

4. Session A remains private.

5. Human B opens a different agent harness.

6. Agent B retrieves authorized Campfire state.

7. Agent B correctly continues the work.

8. Provenance shows where the shared state came from.

9. The result is evaluated against the sprint's
   GO / CONDITIONAL GO / NO-GO rubric.
```

That experience is the deliverable.

The code exists to test it.

---

# Final Instruction

When making a tradeoff, protect the Campfire thesis:

> **The work that belongs to the team can belong to the team.**

Build the smallest reliable system that proves people and their agents can continue shared work across harness boundaries without collapsing identity, authorization, provenance, or privacy.
