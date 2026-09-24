# Campfire — Vision

**Status:** Revised  
**Version:** 0.2  
**Date:** September 11, 2026  
**Company:** Boring Infra Co.

## Vision

Software teams are becoming teams of **people and agents**.

Most agent experiences are still designed around an individual relationship:

> one person → one agent → one conversation

That model works for individual work. It breaks down when agents become part of how an entire team operates.

An engineer may spend hours with Codex investigating a production problem. Another teammate may later ask Claude Code to work on the same system. Both agents may have access to the same repository and company tools, yet the second agent does not naturally inherit the useful working state produced by the first relationship: what was discovered, attempted, rejected, decided, and what remains unresolved.

The organization owns the work, but the context surrounding that work remains fragmented across individual human-agent relationships.

**Campfire exists to change that.**

Campfire is the shared workspace where **people and their agents work together**.

Its purpose is to give teams a durable, secure, harness-independent collaboration boundary for the work humans and agents perform together.

> **North Star: Make agents work like they are part of the team.**

---

## The World Campfire Assumes

Campfire is designed for a world where every teammate may work with one or more agents.

```text
Team
├── Sergio
│   ├── Codex
│   └── OpenCode
├── Alice
│   └── Claude Code
├── Marcus
│   ├── Cursor
│   └── internal deployment agent
└── Priya
    └── company-specific agent
```

The harnesses, models, and vendors will change. The organizational problem will not.

Every agent needs some understanding of what the team is trying to accomplish, what work has happened, what was discovered, which decisions were made, which artifacts were produced, what remains unresolved, who contributed each piece of state, what information it may access, and what capabilities it may exercise.

Without infrastructure for this, organizations accumulate isolated agent relationships rather than coherent agent-enabled teams.

Campfire provides that missing collaboration layer.

---

## The Problem

Shared repositories are not shared working context.

Shared Slack channels are not shared working context.

Shared ticket trackers are not shared working context.

Shared documents are not shared working context.

And shared conversation transcripts are not a sufficient solution.

These systems contain organizational artifacts, but the state created while humans and agents reason about and act on those artifacts is often lost, duplicated, manually summarized, or trapped inside a particular agent session.

```text
Human A ↔ Agent A
       isolated work state

Human B ↔ Agent B
       isolated work state

Human C ↔ Agent C
       isolated work state
```

Teams reconstruct context their organization has already learned. Agents repeat investigations. Decisions lose rationale. Failed approaches are attempted again. Humans become manual routers between agents.

The problem is not merely that agents need more memory.

> **Teams need shared, structured collaboration state that both humans and authorized agents can participate in.**

---

## The Campfire Model

Campfire introduces a shared workspace between the people, agents, tools, and resources involved in a piece of work.

```text
                 TEAM

          Humans       Agents
             \         /
              \       /
               CAMPFIRE
                  |
        Shared Workspaces
                  |
    +-------------+-------------+
    |             |             |
  Tasks        Context       Findings
  Decisions    Artifacts      Goals
  Evidence     Capabilities   History
  Provenance   Status         Outcomes
```

A Campfire workspace is not a shared chat room.

It is a **durable representation of collaborative work**.

Humans and agents contribute to the same workspace while remaining distinct actors with their own identities, permissions, capabilities, and provenance.

An agent can leave. A different agent can arrive. A teammate can continue the work.

The useful state remains.

---

## Shared Work State, Not Shared Transcripts

One of Campfire's foundational principles is:

> **The unit of collaboration is work state, not conversation history.**

Campfire should not require organizations to pool everyone's private agent transcripts into one giant context window. Instead, it captures the durable state produced by collaboration.

```text
Workspace: billing-deploy-failure

Goal
└── Determine why billing deployments are failing

Findings
├── Migration 284 introduces a long database lock
└── Deploy timeout occurs after 120 seconds

Decisions
├── Do not increase the global deployment timeout
└── Split the migration into two phases

Tasks
├── [done] inspect deployment logs
├── [done] compare previous migrations
├── [open] prepare migration fix
└── [open] review fix

Artifacts
├── PR #882
├── deployment logs
└── migration.sql

Provenance
├── Codex / Sergio discovered migration lock
├── Alice confirmed previous incident pattern
├── Sergio approved migration strategy
└── Claude Code produced proposed fix
```

The conversations that produced this state may remain private to their respective human-agent relationships.

The work the team needs to continue becomes durable.

This distinction is essential for privacy, security, context quality, and scalability.

---

## Identity Is Infrastructure

Campfire does not treat every agent as an interchangeable process.

```text
Organization
    |
   Team
    |
  Human
    |
  Agent
```

An agent operates **on behalf of someone, within a team, inside a workspace, under a particular set of capabilities and policies**.

Campfire should be able to answer:

- Which human initiated this agent?
- Which team does it belong to?
- Which workspace is it operating within?
- Which harness is it using?
- What information may it retrieve?
- What actions may it perform?
- What did it contribute?
- Which claims came from it?
- Which human approved an important action?
- What happened after its action?

Identity and provenance are part of the collaboration model itself.

---

## Authorization Is Context

Agents should not automatically know everything their organization knows.

Campfire must make shared context **authorization-aware**.

A workspace establishes a collaboration boundary. Within it, policies determine which people and agents can discover the workspace, inspect its state, contribute findings, modify tasks, attach artifacts, propose or approve decisions, invoke capabilities, access sensitive resources, or retrieve particular classes of context.

The goal is not:

> Give every agent all company context.

The goal is:

> Give each agent the **right team context for the work it is authorized to perform**.

This becomes increasingly important as agents gain the ability to act rather than merely answer questions.

---

## Harness Independence

Campfire should not require a team to standardize on one agent vendor.

```text
Codex -----------+
Claude Code -----+
OpenCode --------+--> Campfire
Cursor -----------+
Internal Agents --+
Human UI ---------+
```

A team may use Codex today, Claude Code tomorrow, an open-source harness for another workflow, and internal agents for specialized systems.

Campfire belongs **between those experiences**, not inside one of them.

The collaboration state should outlive any individual harness.

---

## MCP Is an Interface, Not the Product

MCP is a natural interface for agents to interact with Campfire.

A Campfire MCP surface may eventually expose operations such as:

```text
discover_workspaces
get_workspace_context
get_open_tasks
record_finding
record_decision
attach_artifact
update_task
get_related_work
```

But Campfire is not simply an MCP server.

The durable value is underneath the protocol:

- shared workspaces,
- collaboration semantics,
- identity,
- authorization,
- provenance,
- structured work state,
- lifecycle,
- relationships,
- and organizational memory.

Protocols and harnesses can evolve without invalidating that state.

---

## The Magic Moment

The first Campfire experience should prove something extremely small and extremely important.

Human A works with Agent A. Together they discover something useful and contribute it to a Campfire workspace.

Later, Human B works with Agent B in a different harness.

Agent B enters the same authorized workspace and understands enough of the prior work to continue productively **without receiving Human A's original conversation transcript and without Human A preparing a manual handoff**.

```text
Human A + Agent A
        |
        v
    CAMPFIRE
  shared work state
        |
        v
Human B + Agent B
```

If that experience works, Campfire has demonstrated the foundation of a new team-agent relationship.

The second agent is no longer starting from the knowledge boundary of its individual user.

It is beginning from the authorized working knowledge of the team.

---

## What Campfire Is Not

Campfire is not:

- a shared prompt library,
- a transcript synchronization service,
- a generic vector database,
- another agent harness,
- a replacement for GitHub, Slack, or Linear,
- a multi-agent chat room,
- an agent framework,
- or an orchestration engine disguised as collaboration.

Those systems may connect to Campfire. They do not define it.

Campfire owns the collaboration state that exists **across** humans, agents, harnesses, and organizational systems.

---

## Product Principles

### 1. People and agents are both participants

Humans are not merely administrators standing outside the agent system. The product models the work they perform together.

### 2. Shared state beats shared transcripts

Preserve durable work, not every token that produced it.

### 3. Provenance is mandatory

Campfire should preserve who or what contributed meaningful state.

### 4. Authorization precedes retrieval

Shared organizational context must never imply unrestricted organizational context.

### 5. Harnesses are clients

Campfire should survive changes in agent vendors, models, and interfaces.

### 6. Workspaces are explicit boundaries

Context exists because actors are participating in a piece of work, not because everything has been dumped into one universal memory pool.

### 7. Humans retain meaningful authority

Agents may investigate, contribute, propose, and eventually execute, but important organizational boundaries must support explicit human control.

### 8. Structure should emerge from work

Campfire should capture useful collaboration state without requiring humans to become database operators or constantly prepare summaries.

### 9. Continuity is the product experience

The strongest Campfire experience is:

> “It already knows what the team figured out.”

### 10. Collaboration becomes more valuable over time

Every investigation, decision, artifact, outcome, correction, and completed task should improve the organization's ability to work with agents in the future.

---

## From Team Memory to Organizational Learning

Campfire begins with continuity.

But shared work state creates a larger opportunity.

Over time, an organization can accumulate a durable graph of goals, work, decisions, evidence, failures, successful approaches, artifacts, outcomes, people, agents, systems, and the relationships between them.

Future agents can then ask:

- Has the team solved something like this before?
- Why was this architectural decision made?
- Which approach failed last time?
- Which artifact contains the strongest evidence?
- Who should approve this?
- Which agent already investigated this system?
- What changed after this decision?
- Is this finding still fresh?
- Which unresolved work blocks this goal?

The progression is:

```text
Shared Context
      ↓
Work Continuity
      ↓
Team Memory
      ↓
Organizational Memory
      ↓
Organizational Learning
```

Campfire should earn each layer rather than prematurely claiming all of them.

---

## Relationship to Boring Infra Co.

Campfire is one component of a broader Boring Infra thesis:

> **Autonomous agents require infrastructure for understanding, acting within, and learning from real software environments.**

The Boring Infra projects approach different parts of that problem:

```text
Combie
└── engineering context and relationships

Harnie
└── durable agent work state

Meno
└── verification state and evidence

Pico
└── authority, boundaries, and attack paths

Agent Observability
└── behavioral state, outcomes, loops, and recovery

Campfire
└── human + agent collaboration state
```

These products should not be artificially collapsed into one platform before their individual primitives are proven.

Together, however, they point toward a larger infrastructure layer for organizations operating autonomous software agents.

Campfire occupies an especially important position because it defines **where collaborative work becomes shared organizational state**.

---

## Long-Term Direction

The long-term Campfire opportunity is larger than helping two coding agents share findings.

As agents spread through organizations, teams will need infrastructure for shared goals, durable work state, organizational memory, cross-agent handoffs, human-agent coordination, identity, policy, provenance, capabilities, approvals, artifacts, verification, and learning from outcomes.

The organization itself becomes an environment containing both human and machine collaborators.

Campfire can become the collaboration layer for that environment.

Not by replacing the tools teams already use.

Not by forcing every agent into one harness.

Not by centralizing every private conversation.

But by providing a durable place where:

> **The work that belongs to the team can belong to the team.**

---

## North Star

> **Make agents work like they are part of the team.**

A teammate should be able to bring the agent they prefer.

An organization should be able to establish the context, boundaries, and capabilities that agent receives.

Another teammate and another agent should be able to continue the same work.

The useful state should survive every individual session.

And over time, the organization should become better at working with agents because of everything its humans and agents have already learned together.

**That is Campfire.**
