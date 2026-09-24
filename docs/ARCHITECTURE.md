# Campfire — Architecture

**Status:** Revised  
**Version:** 0.2  
**Date:** September 11, 2026  
**Company:** Boring Infra Co.  
**Depends on:** Product Definition v0.2, Vision v0.2

---

## 1. Purpose

This document defines the architectural direction for Campfire.

Campfire is a **secure, harness-independent shared workspace where people and their agents work together**.

The architecture exists to support one fundamental property:

> Work that belongs to the team must be able to survive the individual human-agent session that produced it.

Campfire therefore does not primarily synchronize conversations. It stores and serves durable, structured collaboration state across humans, agents, harnesses, and organizational systems.

The initial architecture should remain intentionally small enough to prove the Sprint 001 interaction while establishing boundaries that can grow toward team identity, authorization, organizational memory, and richer agent collaboration.

---

## 2. Architectural Thesis

The dominant agent interaction today is:

```text
Human
  |
Agent
  |
Session
```

Campfire introduces an organizational layer:

```text
                    Organization
                         |
                        Team
                         |
                     Workspace
                         |
              +----------+----------+
              |                     |
            Humans                 Agents
              |                     |
              +----------+----------+
                         |
                 Collaboration State
```

The workspace, rather than the agent session, becomes the durable boundary around shared work.

A human-agent conversation may disappear, remain private, or occur in a completely different harness.

The useful work state can remain available to authorized participants.

---

## 3. Architectural Principles

### 3.1 Shared work state, not shared transcripts

Campfire stores durable collaboration objects rather than treating complete chat histories as the canonical shared representation.

### 3.2 Humans and agents are distinct actors

A contribution must preserve whether it originated from a human or an agent and, for an agent, which human or organizational principal it operated on behalf of.

### 3.3 Workspaces are explicit collaboration boundaries

Shared state belongs to a workspace. There is no implicit organization-wide context pool.

### 3.4 Authorization precedes retrieval

The system determines whether an actor may access state before that state is returned to a harness.

### 3.5 Provenance is first-class

Meaningful state must retain enough provenance to answer who or what contributed it and when.

### 3.6 Harnesses are clients

Codex, Claude Code, OpenCode, Cursor, internal agents, a CLI, and future interfaces interact with Campfire. None defines Campfire's storage model.

### 3.7 Protocols are replaceable

MCP is an important interface, not the domain architecture.

### 3.8 Start local and explicit

Sprint 001 should prefer inspectable local state and deterministic behavior over premature distributed-system complexity.

### 3.9 Append before overwrite

Where practical, important collaboration changes should produce immutable contribution/history records even when a materialized current state is updated.

### 3.10 Evidence before intelligence

The first system should prove reliable state sharing and continuation before adding autonomous summarization, ranking, inference, or organizational learning.

---

## 4. System Context

```text
 +-------------------+             +-------------------+
 | Human A           |             | Human B           |
 |                   |             |                   |
 | Codex             |             | Claude/OpenCode   |
 +---------+---------+             +---------+---------+
           |                                 |
           | MCP / client adapter            | MCP / client adapter
           |                                 |
           +---------------+-----------------+
                           |
                    +------v------+
                    |  CAMPFIRE   |
                    |             |
                    | Workspace   |
                    | Service     |
                    +------+------+
                           |
              +------------+------------+
              |                         |
       +------v------+           +------v------+
       | State Store |           | History /   |
       | SQLite      |           | Provenance  |
       +-------------+           +-------------+
```

For Sprint 001, Campfire can operate as a single local service backed by SQLite.

The architecture should not require a cloud control plane to prove the product thesis.

Future deployments may introduce remote/team-hosted services, but those concerns should not distort the first domain model.

---

## 5. Core Domain Model

The minimum conceptual hierarchy is:

```text
Organization
└── Team
    ├── Human
    │   └── Agent
    └── Workspace
        ├── Participants
        ├── Goals
        ├── Tasks
        ├── Findings
        ├── Decisions
        ├── Artifacts
        └── Contributions
```

Sprint 001 does not need every future enterprise feature attached to these entities.

It does need their semantics to remain distinct.

---

## 6. Identity Model

### Organization

Top-level ownership and policy boundary.

```text
Organization
- id
- name
- created_at
```

For Sprint 001, a single local organization may be sufficient.

### Team

A group of humans and agents collaborating within an organization.

```text
Team
- id
- organization_id
- name
- created_at
```

### Human

A person participating in Campfire.

```text
Human
- id
- team_id
- display_name
- external_identity? 
- created_at
```

### Agent

An agent identity participating on behalf of a human or organizational principal.

```text
Agent
- id
- team_id
- human_id?
- name
- harness
- model?
- instance_metadata?
- created_at
```

An agent identity is **not** the same thing as a model.

Examples:

```text
agent: codex-sergio
harness: codex
human: sergio

agent: claude-alice
harness: claude-code
human: alice
```

The architecture should eventually support organization-owned autonomous agents with no direct human owner, but Sprint 001 should optimize for human-associated agents.

### Actor

Internally, contribution and authorization systems benefit from a common actor abstraction:

```text
Actor =
  Human
  | Agent
```

An actor reference should never erase the underlying actor type.

---

## 7. Workspace

The **Workspace** is Campfire's primary collaboration boundary.

```text
Workspace
- id
- team_id
- name
- description?
- status
- created_by_actor_id
- created_at
- updated_at
```

A workspace represents a bounded piece of collaborative work.

Examples:

```text
billing-deploy-failure
auth-migration
release-2026-09
investigate-worker-timeouts
```

A workspace owns or references its collaboration state.

It should be possible to answer:

```text
What is this workspace trying to accomplish?
Who is participating?
What has been learned?
What has been decided?
What remains open?
What artifacts matter?
Who contributed each thing?
```

### Workspace membership

```text
WorkspaceParticipant
- workspace_id
- actor_id
- role
- joined_at
```

Membership and authorization are conceptually separate.

Membership means an actor participates in the workspace.

Authorization determines what that actor may see or do.

---

## 8. Collaboration Objects

Sprint 001 should use a deliberately small set of structured objects.

### Goal

Represents the intended outcome of the workspace.

```text
Goal
- id
- workspace_id
- title
- description?
- status
- created_by
- created_at
- updated_at
```

### Task

Represents actionable work.

```text
Task
- id
- workspace_id
- title
- description?
- status
- assignee_actor_id?
- created_by
- created_at
- updated_at
```

Initial status set:

```text
open
in_progress
completed
blocked
```

### Finding

Represents something learned during the work.

```text
Finding
- id
- workspace_id
- summary
- detail?
- confidence?
- source_artifact_id?
- created_by
- created_at
```

A finding is not automatically truth.

It is a provenance-backed contribution to shared work state.

### Decision

Represents a choice made during the work.

```text
Decision
- id
- workspace_id
- summary
- rationale?
- status
- proposed_by
- approved_by?
- created_at
- updated_at
```

Initial decision states may remain minimal:

```text
proposed
accepted
superseded
```

### Artifact

Represents or references a work product or external resource.

```text
Artifact
- id
- workspace_id
- type
- title
- uri_or_path
- metadata?
- created_by
- created_at
```

Campfire should reference artifacts where possible rather than copying every external system into its own store.

---

## 9. Contribution and Provenance Model

Every meaningful mutation should generate a contribution record.

```text
Contribution
- id
- workspace_id
- actor_id
- actor_type
- action
- object_type
- object_id
- payload?
- created_at
```

Examples:

```text
codex-sergio created finding F-18
alice accepted decision D-4
claude-alice attached artifact A-9
sergio completed task T-7
```

This creates two useful representations:

### Materialized state

The current workspace state optimized for retrieval.

### Historical contribution log

An append-oriented record optimized for provenance, inspection, and future reconstruction.

```text
Contribution log
        |
        +----> current workspace state
        |
        +----> timeline
        |
        +----> provenance
        |
        +----> future audit / learning
```

Campfire does not need full event sourcing in Sprint 001.

It should, however, avoid designing itself into a state model where important provenance is destroyed on update.

---

## 10. Transcript Isolation

Transcript isolation is an architectural requirement, not merely a UX preference.

Campfire must prove that cross-agent continuation can happen without sharing the originating conversation transcript.

```text
Private Session A
Human A <------> Agent A
                    |
                    | explicit durable contributions
                    v
               Campfire
                    |
                    | authorized structured retrieval
                    v
Private Session B
Human B <------> Agent B
```

The Campfire store should not require raw transcripts to construct the Sprint 001 workspace.

If future features ingest transcripts to derive candidate work state, the raw transcript and derived shared state must remain separate concepts with explicit policy boundaries.

### Invariant

> A participant may access a shared finding without gaining access to the private conversation that produced the finding.

---

## 11. Authorization Model

Sprint 001 can implement a simple authorization layer while preserving the correct architecture.

Authorization evaluates:

```text
Actor
  +
Workspace
  +
Operation
  +
Resource
  =
Allow / Deny
```

Conceptual operations include:

```text
workspace:discover
workspace:read
finding:create
decision:create
decision:approve
task:create
task:update
artifact:attach
```

Initial implementation may use role-based rules:

```text
owner
member
agent
viewer
```

Future versions may incorporate:

- organization policy,
- team policy,
- workspace policy,
- delegated authority,
- capability grants,
- resource-level restrictions,
- human approval requirements,
- agent-specific restrictions,
- external identity providers.

### Critical invariant

A harness must never receive unauthorized workspace state and then be expected to ignore it.

Filtering happens **before retrieval crosses the Campfire boundary**.

---

## 12. Context Retrieval

Agents should not receive the entire workspace database on every request.

Campfire should expose a deterministic workspace context projection.

For Sprint 001:

```text
WorkspaceContext
- workspace
- goal
- open_tasks
- recent_or_active_findings
- accepted_decisions
- relevant_artifacts
- provenance_summary
```

The first implementation can be simple and explicit.

No embeddings or semantic ranking are required to prove the thesis.

Example:

```text
get_workspace_context(workspace_id)
```

returns enough structured state for Agent B to continue Agent A's work.

Later retrieval can evolve toward:

```text
get_related_work
get_decision_history
get_findings_for_resource
get_prior_attempts
get_relevant_context
```

But retrieval intelligence should follow evidence from actual use.

---

## 13. MCP Boundary

MCP is the primary agent-facing interface for the first implementation.

A minimal Sprint 001 surface could be:

```text
campfire.list_workspaces
campfire.get_workspace
campfire.get_workspace_context

campfire.create_finding
campfire.create_decision
campfire.create_task
campfire.update_task
campfire.attach_artifact
```

The exact naming may change during implementation.

The architectural rule is more important:

```text
MCP Handler
    |
Application Service
    |
Authorization
    |
Domain
    |
Repository
    |
SQLite
```

MCP handlers should remain thin.

They should not contain Campfire's core collaboration semantics.

That allows future interfaces:

```text
MCP
CLI
HTTP API
SDK
Human UI
Internal integrations
```

to operate over the same domain layer.

---

## 14. Application Layers

Recommended initial structure:

```text
+--------------------------------------------------+
| Interfaces                                       |
| MCP | CLI | future HTTP/UI                       |
+------------------------+-------------------------+
                         |
+------------------------v-------------------------+
| Application Services                             |
| workspace | context | contribution | membership |
+------------------------+-------------------------+
                         |
+------------------------v-------------------------+
| Authorization                                    |
| actor + operation + workspace + resource         |
+------------------------+-------------------------+
                         |
+------------------------v-------------------------+
| Domain                                           |
| workspace | task | finding | decision | artifact |
| actor | contribution                             |
+------------------------+-------------------------+
                         |
+------------------------v-------------------------+
| Repositories                                     |
+------------------------+-------------------------+
                         |
+------------------------v-------------------------+
| SQLite                                           |
+--------------------------------------------------+
```

This is intentionally boring.

Campfire's novelty should live in its collaboration model and experience, not unnecessary infrastructure complexity.

---

## 15. Persistence

SQLite is sufficient for Sprint 001.

Suggested logical tables:

```text
organizations
teams
humans
agents

workspaces
workspace_participants

goals
tasks
findings
decisions
artifacts

contributions
```

Potential supporting tables can be added only when required:

```text
workspace_permissions
capability_grants
artifact_links
object_relationships
```

### Persistence requirements

The store should provide:

- stable IDs,
- timestamps,
- foreign-key integrity,
- deterministic migrations,
- transaction safety,
- inspectable local state,
- no dependency on model inference for correctness.

---

## 16. Object Relationships

Campfire will eventually need richer relationships between collaboration objects.

For example:

```text
Finding F-18
    supports
       |
       v
Decision D-4
       |
    produces
       v
Artifact A-9
       |
    resolves
       v
Task T-7
```

Sprint 001 should not prematurely build a generalized graph engine.

If the proof requires relationships, introduce the smallest explicit representation needed.

A future generic relationship primitive may look like:

```text
Relationship
- id
- workspace_id
- source_type
- source_id
- relation
- target_type
- target_id
- created_by
- created_at
```

The need for this should be validated through actual workspace traces.

---

## 17. Lifecycle

The initial workspace lifecycle can remain small:

```text
active
completed
archived
```

Objects should have explicit state transitions where those transitions matter.

Example task lifecycle:

```text
open
  |
  v
in_progress
  |
  +------> blocked
  |
  v
completed
```

Campfire should reject invalid transitions rather than silently creating contradictory state.

Completed work should remain inspectable because historical work is part of future organizational memory.

---

## 18. The Sprint 001 Reference Flow

Sprint 001 exists to prove this architecture end-to-end.

### Step 1 — Establish team state

```text
Organization: Boring Infra Co.
Team: Engineering

Human A: Sergio
Agent A: Codex

Human B: Alice
Agent B: OpenCode/Claude Code
```

### Step 2 — Create workspace

```text
Workspace:
investigate-demo-failure
```

with a goal and initial task.

### Step 3 — Agent A works

Agent A investigates a fixture/repository and discovers a meaningful fact.

It writes a structured finding into Campfire.

It may update a task or attach an artifact.

### Step 4 — Session isolation

Agent A's conversation transcript is not given to Human B or Agent B.

### Step 5 — Agent B enters

Agent B connects through a different harness and requests authorized Campfire context.

### Step 6 — Continuation

Agent B uses the prior structured state to continue the task correctly.

### Step 7 — Provenance inspection

The resulting workspace demonstrates:

```text
finding originated from Agent A
Agent A operated for Human A
Agent B retrieved the finding
Agent B continued the work
Human B can inspect the resulting shared state
```

### Success property

> Agent B continues useful work from Agent A's contribution without receiving Agent A's private transcript or a manually prepared handoff.

That is the architectural proof.

---

## 19. Failure Modes We Must Avoid

### Shared transcript masquerading as collaboration

If Sprint 001 works only because Agent B receives Agent A's transcript, Campfire has not proven its thesis.

### Universal memory pool

Dumping all organizational information into one retrieval index destroys workspace boundaries and authorization semantics.

### Agent identity collapse

Recording only `created_by = codex` is insufficient. Campfire needs to know which agent instance/principal acted and on whose behalf.

### Harness-specific domain state

If core Campfire objects depend on Codex or Claude-specific session schemas, harness independence has failed.

### MCP business logic

If collaboration semantics live directly inside MCP handlers, future interfaces become unnecessarily expensive.

### Premature orchestration

Campfire does not need to schedule autonomous agent swarms to prove team collaboration.

### Premature intelligence

LLM-generated summaries, embeddings, automatic memory extraction, and relevance ranking can hide whether the underlying state model actually works.

### Over-modeling enterprise IAM

Sprint 001 needs authorization boundaries, not a complete enterprise identity platform.

### Silent provenance loss

Updates that erase who made a prior decision or why it changed undermine one of Campfire's core assets.

---

## 20. Security Boundaries

Even the local prototype should establish these conceptual boundaries:

```text
Private agent session
        !=
Shared Campfire workspace

Human identity
        !=
Agent identity

Workspace membership
        !=
Unlimited authorization

Artifact reference
        !=
Automatic artifact permission

Agent capability
        !=
Human capability
```

Future cloud/team architecture should assume:

- tenant isolation,
- encrypted transport,
- encrypted storage where appropriate,
- external identity integration,
- scoped service credentials,
- auditable authorization decisions,
- secret isolation,
- explicit capability grants,
- revocation,
- approval boundaries.

Those are future implementation concerns, but the domain model should not contradict them.

---

## 21. Observability

Campfire should be inspectable from the beginning.

Sprint 001 should make it possible to see:

- workspace creation,
- participant joins,
- context reads,
- object creation,
- object updates,
- authorization failures,
- contribution provenance.

This does not require a full observability product.

Structured logs plus the contribution history are enough initially.

A useful principle:

> If we cannot explain how Agent B obtained a piece of shared state, the architecture is not ready.

---

## 22. Future Architecture

**Status note (Sep 2026):** the smallest Stage B slice is done — a
team-hosted process with actor tokens and invite-only membership
(Sprint 005: `campfire serve` + `POST /v1/call` with bearer token). Everything
below remains future; no other Stage C/D item is claimed.

If the Sprint 001 thesis holds, Campfire can grow toward:

```text
                     Cloud / Team Campfire
                              |
        +---------------------+---------------------+
        |                     |                     |
     Identity              Policy               Workspace
     Service               Engine               Service
        |                     |                     |
        +---------------------+---------------------+
                              |
                       Collaboration Graph
                              |
          +-------------------+-------------------+
          |                   |                   |
       Context             Memory              History
       Retrieval           Layer               / Audit
          |                   |                   |
          +-------------------+-------------------+
                              |
                     Integration Boundary
                              |
       +----------+-----------+-----------+----------+
       |          |           |           |          |
     MCP        SDK/API     GitHub      Combie     Others
```

Potential future capabilities include:

- organization-wide workspace discovery,
- cross-workspace relationships,
- context freshness,
- semantic retrieval,
- derived organizational memory,
- human approval workflows,
- capability delegation,
- workspace templates,
- external system synchronization,
- notification/subscription models,
- remote team hosting,
- audit controls,
- policy engines,
- autonomous organization-owned agents.

None is required for Sprint 001.

---

## 23. Relationship to Other Boring Infra Systems

Campfire should remain independently useful.

However, its architecture should allow future composition with other Boring Infra primitives.

```text
                    Campfire
              Collaboration State
                     / | \
                    /  |  \
                   /   |   \
                  v    v    v
              Combie Harnie Meno
              Context Work  Verification

                    |
                    v
                  Pico
            Authority / Security

                    |
                    v
          Agent Observability
              Behavior
```

Possible future relationships:

### Combie → Campfire

Campfire workspaces can reference engineering resources and relationships discovered by Combie.

### Harnie → Campfire

Agent-specific work state can become a source for explicit shared Campfire contributions.

### Meno → Campfire

Findings and decisions can carry verification/evidence state.

### Pico → Campfire

Workspace actions and agent capabilities can be evaluated against authority and security boundaries.

### Agent Observability → Campfire

Behavioral outcomes can explain how agents acted within collaborative work.

These are composition opportunities, not Sprint 001 dependencies.

Campfire must not require the rest of the Boring Infra portfolio to function.

---

## 24. Architectural Invariants

The following should remain true as Campfire evolves:

1. **A workspace is an explicit collaboration boundary.**
2. **Humans and agents retain distinct identities.**
3. **Agent contributions preserve who or what the agent acted on behalf of.**
4. **Shared state does not require shared transcripts.**
5. **Authorization occurs before context retrieval.**
6. **Meaningful shared state carries provenance.**
7. **The domain model is independent of any single harness.**
8. **MCP is an interface, not the product architecture.**
9. **Historical work remains inspectable after current state changes.**
10. **Campfire can function independently of other Boring Infra products.**
11. **Model inference is not required for storage correctness.**
12. **The system should be able to explain why an agent received a piece of context.**

These invariants matter more than any particular framework, database, or protocol choice.

---

## 25. Architecture Decision for Sprint 001

Sprint 001 should optimize for proof, inspectability, and correctness.

Recommended implementation:

```text
Two real agent harnesses
        |
       MCP
        |
Thin interface adapters
        |
Campfire application layer
        |
Simple authorization
        |
Domain objects
        |
SQLite
```

Do not add:

```text
distributed services
vector databases
agent orchestration
automatic transcript ingestion
LLM memory extraction
complex policy languages
cloud tenancy
generalized graph databases
```

unless evidence from the sprint makes one unavoidable.

The first architecture only needs to prove that Campfire can become a **durable collaboration boundary between different human-agent relationships**.

---

## 26. Architectural North Star

The architecture succeeds when this becomes ordinary:

```text
Yesterday:
Sergio + Codex discovered something.

Today:
Alice + Claude already know the relevant team state.

Tomorrow:
Another authorized teammate and another agent
can continue the work again.

No transcript forwarding.
No manual handoff document.
No dependence on one harness.
No loss of provenance.
```

Campfire should make organizational continuity a property of the infrastructure rather than a burden placed on individual humans.

> **The work that belongs to the team can belong to the team.**
