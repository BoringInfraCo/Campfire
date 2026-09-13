# Campfire — Product Definition v0.2

**Status:** Product Definition  
**Company:** Boring Infra Co.  
**Version:** 0.2  
**Date:** September 11, 2026

---

## 1. Thesis

**Campfire is the shared workspace where people and their agents work together.**

Software teams are increasingly becoming mixed teams of humans and autonomous agents. A single engineer may work with Codex, Claude Code, OpenCode, Cursor, internal agents, or other harnesses, while their teammates use a different combination of agents.

Today, those human-agent relationships are largely isolated. An agent can accumulate substantial context while working with one person, but another teammate's agent does not naturally inherit the resulting findings, decisions, tasks, artifacts, or operational knowledge.

The organization may share a repository, issue tracker, documentation system, chat, and infrastructure, but the **working state created while humans and agents do the work remains fragmented across users, sessions, and harnesses.**

Campfire creates a secure, harness-independent collaboration boundary where humans and agents can participate in the same work.

> **Your agent should know what your team knows — within the boundaries of what it is authorized to know.**

---

## 2. The Shift

The first generation of agent tooling optimized for:

> **one person → one agent**

The emerging organizational model is:

> **teams of people → teams of agents → shared work**

This creates a new infrastructure problem.

Agents need more than access to the same source systems. They need a shared understanding of the work occurring across those systems:

- what the team is trying to accomplish;
- what has already been investigated;
- what was discovered;
- what decisions were made and why;
- what remains unresolved;
- which artifacts were created;
- who or what produced a piece of information;
- what has been verified;
- what capabilities an agent may exercise;
- and which information is appropriate for a given human, agent, team, or task.

Campfire exists to provide that collaboration layer.

---

## 3. Product Definition

Campfire is a **secure, harness-independent workspace for human-agent teams**.

It provides a shared collaboration boundary for:

- goals;
- tasks;
- context;
- findings;
- decisions;
- artifacts;
- provenance;
- capabilities *(future — Era II coordination, not in v1.0)*;
- checkpoints *(future — Era II, not in v1.0)*;
- interventions *(future — Era II, not in v1.0)*;
- and team memory *(future — Era II, not in v1.0; v1.0 keeps workspace-scoped
  history only, no cross-workspace memory)*.

Humans and agents can enter a Campfire workspace from different tools and harnesses while operating against the same authorized work state.

Campfire does **not** attempt to make every agent share one conversation or one global memory. Instead, it gives agents access to structured, scoped, provenance-backed organizational work state.

---

## 4. Core Problem

Consider a five-person engineering team.

```text
Sergio  ───── Codex
Alice   ───── Claude Code
Marcus  ───── OpenCode
Priya   ───── Cursor
James   ───── Internal Agent
```

They share the same company and may work on the same services, incidents, features, and infrastructure.

But each human-agent relationship can become its own information island.

For example, Sergio and Codex investigate a production failure and discover:

- migration 284 is holding a database lock;
- increasing the global timeout was previously attempted and caused another failure;
- the safer fix is to split the migration;
- PR #882 contains the proposed change.

Two hours later, Alice asks Claude Code about the same incident.

Claude should not have to rediscover everything from scratch, nor should Sergio need to manually produce a perfect handoff document.

With Campfire, both interactions participate in the same authorized workspace.

```text
Sergio + Codex
      │
      │ findings / decisions / artifacts
      ▼
┌─────────────────────┐
│      CAMPFIRE       │
│ billing-deploy      │
│                     │
│ Goal                │
│ Findings            │
│ Decisions           │
│ Tasks               │
│ Artifacts           │
│ Provenance          │
│ Capabilities (future)│
└─────────────────────┘
      │
      │ authorized work state
      ▼
Alice + Claude Code
```

Campfire turns isolated agent sessions into participation in shared organizational work.

---

## 5. The Product Primitive: Workspace

The primary Campfire primitive is a **Workspace**.

A workspace represents a bounded unit of collaborative work involving humans, agents, or both.

Examples:

- an incident investigation;
- a feature implementation;
- a migration;
- a security investigation;
- a customer escalation;
- an infrastructure change;
- a release;
- a research task.

A workspace may contain:

```text
Workspace
├── Goal
├── Participants
│   ├── Humans
│   └── Agents
├── Tasks
├── Context
├── Findings
├── Decisions
├── Artifacts
├── Capabilities (future — Era II)
├── Checkpoints (future — Era II)
├── Provenance
└── Activity
```

The workspace is not a chat room.

Conversation may be one interface into it, but Campfire stores the **meaningful state of the work**, rather than treating the transcript as the product.

---

## 6. Participants and Identity

Campfire treats humans and agents as distinct participants.

The initial identity hierarchy is:

```text
Organization
    ↓
Team
    ↓
Human
    ↓
Agent
    ↓
Agent Session
```

An agent must be attributable to its operating context.

Campfire should be able to answer:

- Which organization does this participant belong to?
- Which team owns this workspace?
- Which human initiated or owns this agent interaction?
- Which harness is the agent using?
- Which agent/session produced this contribution?
- What capabilities was the agent granted at the time?
- Which workspace was it operating within?

Example:

```text
Sergio
├── Codex / session-827
├── OpenCode / session-144
└── deploy-agent / run-992

Alice
├── Claude Code / session-93
└── Cursor / session-771
```

Identity and provenance must survive across agent and harness boundaries.

---

## 7. Shared State, Not Shared Everything

Campfire should **not** create a giant organization-wide memory bucket.

Shared state must be intentionally bounded.

Access may depend on:

- organization;
- team;
- workspace;
- participant;
- role;
- resource;
- capability;
- sensitivity;
- provenance;
- and policy.

A human being able to access something does not automatically imply that every agent acting on their behalf should receive the same access.

The system must distinguish:

> **human authority** from **delegated agent authority**.

This becomes foundational for enterprise adoption.

---

## 8. Work State Model

Campfire's shared state should initially normalize a small number of high-value objects.

### Goal
What is the team trying to accomplish?

### Task
What work needs to happen, is happening, or has been completed?

### Finding
What did a participant discover?

A finding should include evidence or provenance whenever possible.

### Decision
What did the team decide, and why?

### Artifact
What was produced or referenced?

Examples include:

- pull requests;
- commits;
- files;
- logs;
- traces;
- documents;
- deployments;
- screenshots;
- reports.

### Participant
Which human or agent is participating in the workspace?

### Capability
What is a participant permitted to access or execute?
*(Future — Era II coordination. v1.0 has roles + invite membership only.)*

### Checkpoint
What is the current recoverable state of the work?
*(Future — Era II, not in v1.0.)*

### Provenance
Where did information come from, who produced it, and under what context?

---

## 9. Example Workspace

```text
WORKSPACE
billing-service incident

GOAL
Determine why billing deploys fail.

PARTICIPANTS
Sergio
Codex / session-827
Alice
Claude Code / session-93

FINDINGS
✓ migration 284 introduces a database lock
✓ deploy timeout is 120 seconds
✓ previous migration exhibited similar behavior

DECISIONS
✓ do not increase the global timeout
✓ split the migration

TASKS
✓ investigate database behavior
✓ inspect previous incidents
○ prepare migration fix
○ review fix

ARTIFACTS
PR #882
migration.sql
deploy logs
incident notes

CAPABILITIES
GitHub       read/write
Sentry       read
Cloudflare   read
ProductionDB denied

PROVENANCE
Codex discovered migration lock
Alice confirmed historical incident
Sergio approved proposed direction
Claude generated review artifact
```

A second agent entering the workspace can retrieve the relevant authorized state without requiring the first agent's proprietary conversation history.

---

## 10. Harness Independence

Campfire must not require a team to standardize on one agent provider or harness.

The same workspace should eventually support participation from environments such as:

```text
Codex ───────────┐
Claude Code ─────┤
OpenCode ────────┤
Cursor ──────────┼── Campfire
Internal Agent ──┤
Custom Runtime ──┤
Human UI ────────┤
CLI ─────────────┘
```

Campfire owns the collaboration model, not the model runtime.

This allows organizations to change models and agent harnesses without losing their shared collaboration state.

---

## 11. MCP Strategy

MCP should be a primary interface into Campfire, but **MCP is not the product**.

Campfire should expose capabilities through MCP so compatible agents can:

- discover workspaces;
- join an authorized workspace;
- retrieve relevant work state;
- contribute findings;
- create or update tasks;
- record decisions;
- register artifacts;
- inspect participants;
- request capabilities;
- and retrieve provenance.

Conceptually:

```text
Agent Harness
     │
     MCP
     │
     ▼
Campfire Protocol/API
     │
     ▼
Workspace + Policy + State
```

Other interfaces may include an SDK, API, CLI, and human-facing application.

The durable product value lives in Campfire's **state model, collaboration semantics, identity, authorization, provenance, and coordination behavior** — not in the transport protocol.

---

## 12. What Campfire Is Not

Campfire is **not**:

### A shared chat application
Chat may expose Campfire state, but conversation transcripts are not the core abstraction.

### A generic memory database
Memory is one component of collaboration state, not the product itself.

### An agent framework
Campfire does not dictate how agents reason, plan, or execute.

### A model provider
Teams bring their existing agents and models.

### A replacement for GitHub, Linear, Slack, or infrastructure systems
Campfire should understand and reference existing organizational systems rather than recreate them.

### An unrestricted organizational knowledge graph
Access must remain bounded by identity, workspace, policy, and delegated authority.

### An agent-to-agent messaging protocol
Agent communication may occur, but the core product is the shared environment in which collaborative work becomes durable and understandable.

---

## 13. Initial User

The initial user is a software team already using multiple AI coding agents or agent harnesses.

The strongest early profile is likely:

- 3–20 engineers;
- heavy agent usage;
- multiple agent tools or harnesses;
- shared repositories and infrastructure;
- meaningful parallel engineering work;
- recurring handoff or duplicated-context problems.

The initial pain is simple:

> **Our agents work with us individually, but they don't work like they're part of our team.**

---

## 14. Initial Wedge

Campfire should not begin by solving organization-wide agent collaboration.

The first wedge is:

> **Two humans. Two different agent harnesses. One shared workspace.**

The first experience should prove that useful work produced through one human-agent relationship can become safely available to another human-agent relationship without copying conversation history or manually producing a handoff.

### Reference Flow

1. Human A creates or joins a Campfire workspace.
2. Agent A joins through its harness.
3. Human A and Agent A perform work.
4. Agent A records a finding, decision, task, and artifact.
5. Human B joins the same workspace.
6. Agent B joins from a different harness.
7. Agent B retrieves the relevant authorized state.
8. Human B asks Agent B about the work.
9. Agent B can accurately continue from the team's current state.
10. Agent B contributes additional work back into Campfire.

The key moment is:

> **Agent B knows what happened without having participated in Agent A's conversation.**

That is the first Campfire magic moment.

---

## 15. MVP Scope

The first implementation should intentionally remain narrow.

### Required

- local or development Campfire server;
- Workspace primitive;
- Human identity;
- Agent identity;
- Agent Session identity;
- Goal;
- Task;
- Finding;
- Decision;
- Artifact;
- provenance on every contribution;
- workspace-scoped access;
- MCP interface;
- two supported agent harnesses;
- read shared workspace state;
- write shared workspace state;
- append-only activity history;
- deterministic test fixtures demonstrating cross-harness handoff.

### Explicitly Deferred

- enterprise SSO;
- complex RBAC;
- organization-wide knowledge retrieval;
- autonomous task assignment;
- agent negotiation;
- real-time multiplayer UI;
- sophisticated conflict resolution;
- semantic memory ranking;
- long-term behavioral learning;
- billing;
- hosted multi-tenant control plane;
- deep integrations across the entire engineering stack.

These may become important, but they are not necessary to validate the core thesis.

---

## 16. Sprint 001 Hypothesis

### Hypothesis

A structured shared workspace can allow agents operating through different harnesses and for different humans to continue collaborative engineering work without sharing proprietary session history.

### Sprint 001 Proof

```text
Human A
   ↓
Agent A / Harness A
   ↓
Campfire Workspace
   ↓
Agent B / Harness B
   ↓
Human B
```

Agent A must contribute at minimum:

- one finding;
- one decision;
- one task;
- one artifact.

Agent B must subsequently:

- discover the workspace;
- retrieve those objects;
- identify their provenance;
- correctly summarize the current work state;
- continue one outstanding task;
- contribute new state without corrupting the original history.

### Success Condition

Sprint 001 succeeds if the second human-agent pair can meaningfully continue the first pair's work **without access to the first pair's raw conversation transcript**.

---

## 17. Design Principles

### Structured state over transcript sharing
Store what matters about the work, not every token exchanged while producing it.

### Provenance by default
Every meaningful contribution should be attributable.

### Humans and agents are both participants
Neither should be treated as invisible metadata around the other.

### Harness independence
Campfire should survive changes in models, providers, and agent interfaces.

### Least delegated authority
Agents receive the minimum capabilities required for their work.

### Shared does not mean global
Collaboration happens inside explicit boundaries.

### Durable work over durable sessions
Sessions end. The team's work state should not.

### Existing tools remain sources of truth
Campfire connects and coordinates rather than unnecessarily replacing the engineering stack.

---

## 18. Relationship to Boring Infra Co.

Campfire fits into the broader Boring Infra thesis as the **collaboration state layer** for autonomous software engineering.

The portfolio can be understood as different infrastructure primitives required by increasingly autonomous agents:

```text
Combie      → engineering context
Harnie      → work state
Meno        → verification state
Pico        → authority / security state
Observability → behavioral state
Campfire    → collaboration state
```

These products should remain independently useful and independently testable.

Campfire should not become a premature wrapper around every Boring Infra project.

However, the primitives are intentionally complementary.

Over time, they may form parts of a broader agent infrastructure layer capable of answering:

```text
What exists?                  → Combie
What is happening?            → Harnie
What is true?                 → Meno
What can this agent reach?    → Pico
How is the agent behaving?    → Observability
How are we working together?  → Campfire
```

Campfire provides the collaborative environment in which many of those signals can eventually become useful to an entire team.

---

## 19. Long-Term Direction

The long-term opportunity is larger than agent collaboration.

As organizations adopt autonomous agents, agents increasingly become operational participants in the company itself.

They will need infrastructure for:

- identity;
- context;
- collaboration;
- authority;
- verification;
- observability;
- memory;
- provenance;
- coordination;
- and organizational learning.

Campfire's role in that world is to make collaborative work between humans and agents **shared, durable, inspectable, portable, and governable**.

The long-term experience should feel less like connecting several AI assistants to company tools and more like adding capable new participants to an existing team.

---

## 20. Product Promise

**Campfire gives people and their agents a shared place to work.**

Bring the agents your team already uses. Campfire gives them a common collaboration boundary for goals, tasks, context, findings, decisions, artifacts, and provenance — so work can move across people and agents without losing what the team has already learned. (Capabilities, checkpoints, and team memory are Era II futures, not v1.0.)

---

## 21. North Star

> **Make agents work like they're part of the team.**

Not because every agent sees everything.

Not because every conversation becomes shared memory.

But because the right participant can enter the right workspace and understand the right work, with the right provenance and authority, at the right time.

That is the team-agent relationship Campfire exists to make possible.
