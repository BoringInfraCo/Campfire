# Campfire — Sprint 001: Cross-Harness Team Handoff

**Status:** Complete (GO)  
**Company:** Boring Infra Co.  
**Product:** Campfire  
**Sprint:** 001 (Revised for Product Definition v0.2)  
**Date:** September 11, 2026

---

## 1. Sprint Thesis

Campfire's first proof is not agent-to-agent messaging and it is not shared chat history.

The sprint must prove that **two humans using two different agent harnesses can participate in the same bounded workspace and continue the same work through structured, provenance-backed shared state.**

> **Two humans. Two different agent harnesses. One shared Campfire workspace.**

The second human-agent pair must be able to understand and continue work created by the first pair **without access to the first pair's raw conversation transcript.**

---

## 2. Why This Sprint Exists

Product Definition v0.2 expands Campfire from an agent collaboration tool into a shared workspace for **people and their agents**.

Sprint 001 therefore needs to validate the smallest end-to-end version of that product promise:

```text
Human A                    Human B
   │                          │
Agent A                    Agent B
Harness A                  Harness B
   │                          │
   └──────────┐    ┌──────────┘
              ▼    ▼
        ┌────────────────┐
        │    CAMPFIRE    │
        │   Workspace    │
        │                │
        │ Goal           │
        │ Tasks          │
        │ Findings       │
        │ Decisions      │
        │ Artifacts      │
        │ Provenance     │
        └────────────────┘
```

If this flow works, Campfire has demonstrated its core primitive: **durable team work state that survives the human, agent, session, and harness that created it.**

---

## 3. Sprint Question

Can Agent B, operating for Human B in a different harness, enter a workspace previously used by Human A + Agent A and correctly continue the work using only Campfire's structured shared state?

The answer at the end of Sprint 001 must be either:

- **GO** — the core handoff works with sufficient fidelity;
- **CONDITIONAL GO** — the thesis is supported but a specific limitation must be resolved next;
- **NO-GO** — structured shared state is insufficient for meaningful continuation under the tested conditions.

---

## 4. Primary Hypothesis

A small normalized work-state model consisting of **Goal, Task, Finding, Decision, Artifact, Participant, Agent Session, and Provenance** is sufficient for one human-agent pair to hand meaningful engineering work to another pair without transcript sharing.

### Supporting hypotheses

1. An agent can reliably write useful structured state while doing real work.
2. Another harness can retrieve and interpret that state without harness-specific translation.
3. Provenance is sufficient to distinguish who or what produced each contribution.
4. Workspace boundaries prevent unrelated state from leaking into the handoff.
5. Append-only activity preserves the history of collaboration without requiring a shared chat transcript.
6. The second pair can add new work without overwriting or corrupting the first pair's contributions.

---

## 5. Reference Scenario

Use one realistic engineering task as the canonical Sprint 001 fixture.

### Scenario: Billing deploy investigation

Human A asks Agent A to investigate why a billing-service deployment is failing.

During the investigation, Agent A establishes:

```text
GOAL
Determine why billing-service deploys fail.

FINDING
Migration 284 holds a database lock longer than the deployment timeout.

DECISION
Do not increase the global deployment timeout; split the migration instead.

TASK
Prepare the migration split.

ARTIFACT
fixtures/billing/migration-284.sql
```

Agent A records those objects in Campfire with participant, session, timestamp, and source provenance.

Human B then starts a **separate agent session in a different harness**. Agent B receives no transcript from Agent A.

Agent B must be able to:

1. discover the billing workspace;
2. retrieve its current state;
3. explain the goal and current understanding;
4. identify which participant produced the finding and decision;
5. identify the outstanding task;
6. inspect the referenced artifact;
7. continue the outstanding task;
8. write a new contribution back to Campfire.

---

## 6. Scope

### In scope

Sprint 001 implements only what is required to prove the reference flow.

#### Campfire server

- local development server;
- persistent local store;
- deterministic identifiers;
- append-only activity history;
- workspace-scoped reads and writes.

#### Core domain objects

- Workspace;
- Goal;
- Participant;
- Human identity;
- Agent identity;
- Agent Session;
- Task;
- Finding;
- Decision;
- Artifact;
- Provenance / Contribution metadata.

#### Interfaces

- MCP server as the primary agent interface;
- minimal developer CLI or debug interface for setup and inspection;
- two distinct harness adapters or validated MCP clients.

#### Required operations

- create workspace;
- list/discover workspaces available to a participant;
- get workspace state;
- join/register participant or agent session;
- add finding;
- add decision;
- create/update task;
- register artifact;
- read activity/provenance;
- append a new contribution.

### Explicitly out of scope

Do **not** add these unless they are strictly necessary to complete the proof:

- hosted SaaS control plane;
- production multi-tenancy;
- enterprise SSO;
- complex RBAC;
- organization-wide memory search;
- vector/semantic memory ranking;
- agent-to-agent direct messaging;
- autonomous agent assignment;
- agent negotiation;
- real-time multiplayer UI;
- Slack/Linear/GitHub integrations;
- Combie/Harnie/Meno/Pico integration;
- sophisticated conflict resolution;
- long-term learning;
- billing;
- polished dashboard.

Sprint 001 is a **product-thesis proof**, not a platform build.

---

## 7. Minimal Domain Model

The implementation should keep the schema deliberately small.

```text
Organization (fixture only)
└── Team (fixture only)
    └── Workspace
        ├── Goal
        ├── Participants
        │   ├── Human
        │   └── Agent
        │       └── AgentSession
        ├── Tasks
        ├── Findings
        ├── Decisions
        ├── Artifacts
        └── Activity
```

### Workspace

Minimum fields:

```text
id
name
team_id
status
created_at
updated_at
```

### Participant

Minimum fields:

```text
id
type: human | agent
name
human_owner_id?      # for delegated agent identity
harness?             # codex, claude-code, opencode, etc.
created_at
```

### Agent Session

```text
id
agent_participant_id
human_owner_id
workspace_id
harness
started_at
ended_at?
```

### Contribution objects

Goal, Task, Finding, Decision, and Artifact must all carry enough metadata to answer:

> Who or what added this, in which session, and when?

At minimum:

```text
id
workspace_id
created_by_participant_id
agent_session_id?
created_at
```

Object-specific payloads should remain intentionally simple.

---

## 8. Provenance Contract

**No meaningful Campfire contribution may exist without provenance.**

For Sprint 001, provenance must allow Campfire to identify:

- the human participant involved;
- the agent participant, if applicable;
- the agent session;
- the harness;
- the workspace;
- the contribution timestamp;
- the referenced artifact/source when one exists.

Example:

```json
{
  "finding": "Migration 284 exceeds the deploy timeout because it holds a database lock.",
  "workspace": "billing-deploy",
  "created_by": {
    "human": "human-a",
    "agent": "agent-a",
    "session": "session-a-001",
    "harness": "harness-a"
  },
  "source": "fixtures/billing/migration-284.sql"
}
```

The exact storage representation may differ. The semantic guarantee may not.

---

## 9. Workspace Boundary

Sprint 001 must demonstrate that Campfire state is **workspace-scoped**, not globally shared.

Create at least one unrelated fixture workspace containing a distinctive finding.

Agent B must not receive that finding when reading the billing workspace.

This is not intended to prove enterprise authorization. It proves the more fundamental invariant:

> **Shared does not mean global.**

---

## 10. MCP Surface

Keep the MCP API narrow and semantic.

A suggested initial surface:

```text
campfire.list_workspaces
campfire.get_workspace
campfire.join_workspace
campfire.add_finding
campfire.add_decision
campfire.create_task
campfire.update_task
campfire.add_artifact
campfire.get_activity
```

The exact names may change during implementation, but avoid generic database-shaped tools such as `insert_record` or `query_table`.

The MCP surface should express **collaboration concepts**, not storage implementation.

### `get_workspace` response

The response should provide a compact current-state representation suitable for agent consumption:

```text
Workspace
Goal
Participants
Open Tasks
Recent / Relevant Findings
Decisions
Artifacts
Provenance
```

Do not return the first agent's transcript because no such transcript should be stored as part of the proof.

---

## 11. Harness Requirement

Sprint 001 requires **two genuinely separate agent environments**.

Preferred proof:

```text
Harness A → Codex
Harness B → OpenCode or Claude Code
```

If environment availability prevents those exact choices, use any two distinct MCP-capable harnesses, but document the substitution.

The proof is invalid if both sides are merely two mocked calls through the same adapter while claiming cross-harness support.

Mocks are acceptable for unit and integration tests. The final acceptance run must use two distinct real harness clients when possible.

---

## 12. Transcript Isolation Requirement

This is a hard acceptance constraint.

Agent B must not receive:

- Agent A's conversation transcript;
- Agent A's hidden/session context;
- a manually written handoff summary created specifically for Agent B;
- a harness-native session export containing the missing context.

Agent B may receive only:

1. its own instructions;
2. repository/test fixture access required for the task;
3. authorized Campfire workspace state;
4. artifacts referenced by that state.

This prevents the demo from accidentally proving transcript portability instead of Campfire.

---

## 13. Implementation Workstreams

### Workstream A — Repository foundation

- establish package/module structure;
- add configuration;
- establish local data path;
- create test harness;
- document local run commands;
- keep setup deterministic.

### Workstream B — Domain + persistence

Implement the minimal objects and persistence layer.

Required invariants:

- workspace IDs are stable;
- contributions are attributable;
- activity is append-only;
- task state transitions do not erase history;
- objects cannot silently move between workspaces.

### Workstream C — Campfire service

Implement domain operations independent of MCP transport.

MCP handlers should call this layer rather than contain business logic directly.

### Workstream D — MCP server

Expose the minimum collaboration operations defined above.

Validate schemas and return useful errors for:

- unknown workspace;
- invalid participant/session;
- cross-workspace object reference;
- malformed contribution;
- missing provenance.

### Workstream E — Harness A proof

Connect the first real harness and have Agent A populate the reference workspace while performing the fixture task.

### Workstream F — Harness B handoff proof

Start a clean second harness session and demonstrate retrieval, comprehension, continuation, and write-back.

### Workstream G — Evidence + evaluation

Capture machine-readable evidence from the acceptance run so Sprint 001 does not depend on a subjective demo.

---

## 14. Test Plan

### Unit tests

At minimum cover:

- workspace creation;
- participant creation;
- agent-session registration;
- contribution provenance;
- task creation/update;
- finding creation;
- decision creation;
- artifact registration;
- append-only activity;
- workspace isolation;
- invalid references;
- persistence across process restart.

### Integration tests

Test the MCP surface against a real local Campfire server.

Verify that:

1. Agent A-style calls create the expected state.
2. A clean client can retrieve the same state.
3. Updates append activity rather than erase provenance.
4. unrelated workspace state is not returned.

### Acceptance test

Run the complete Human A/Agent A → Campfire → Agent B/Human B scenario.

The acceptance fixture should be reproducible from a clean repository checkout.

---

## 15. Evaluation Rubric

Agent B's continuation should be evaluated against explicit facts rather than general impression.

### Required comprehension

Without transcript access, Agent B must correctly identify:

- the workspace goal;
- the core finding;
- the existing decision;
- the outstanding task;
- the relevant artifact;
- the producer/provenance of the core finding or decision.

### Required continuation

Agent B must complete or materially advance the outstanding task and write at least one new structured contribution to Campfire.

### Required preservation

After Agent B writes state:

- Agent A's original contributions remain present;
- original provenance remains unchanged;
- Agent B's contribution has distinct provenance;
- activity reflects both sessions in order.

---

## 16. Definition of Done

Sprint 001 is complete only when all of the following are true:

- [ ] Campfire runs locally from documented commands.
- [ ] Workspace state persists across server restarts.
- [ ] Human, Agent, and Agent Session identities are represented separately.
- [ ] Goal, Task, Finding, Decision, and Artifact are implemented.
- [ ] Every meaningful contribution carries provenance.
- [ ] Activity history is append-only.
- [ ] MCP exposes the required collaboration operations.
- [ ] Workspace isolation is covered by tests.
- [ ] Harness A can create meaningful Campfire state.
- [ ] Harness B can discover and retrieve that state in a clean session.
- [ ] Harness B receives no Harness A transcript/session export.
- [ ] Harness B correctly explains the existing work state.
- [ ] Harness B continues an outstanding task.
- [ ] Harness B contributes new state back to Campfire.
- [ ] Original contributions and provenance remain intact.
- [ ] The end-to-end acceptance run is documented and reproducible.
- [ ] Sprint evidence supports an explicit GO / CONDITIONAL GO / NO-GO recommendation.

---

## 17. Success Criteria

### GO

Recommend **GO** when:

- the second harness can meaningfully continue the first pair's work;
- all required work-state facts are recovered correctly;
- provenance survives the handoff;
- workspace isolation holds;
- no transcript sharing is required;
- the second pair can write back without corrupting history;
- and the interaction demonstrates a credible path toward a real team workflow.

### CONDITIONAL GO

Recommend **CONDITIONAL GO** when the core handoff works but one bounded issue remains, such as:

- one harness requires an adapter workaround;
- state representation is too verbose;
- one object type needs refinement;
- artifact resolution is incomplete;
- provenance is semantically correct but ergonomically awkward.

The condition must be specific and testable in Sprint 002.

### NO-GO

Recommend **NO-GO** if meaningful continuation requires raw transcript access, extensive manual summarization, harness-specific hidden context, or a substantially broader state model than the sprint hypothesis predicts.

---

## 18. Non-Goals / Guardrails

During implementation, reject scope expansion that attempts to make Campfire immediately become:

- the Boring Infra unified platform;
- a universal memory layer;
- a full agent runtime;
- an orchestration framework;
- an enterprise IAM system;
- an observability suite;
- a human project-management application.

Those may connect to Campfire later.

Sprint 001 has one job:

> **Prove that team work can cross a human-agent-harness boundary through Campfire.**

---

## 19. Expected Deliverables

At sprint completion, the repository should contain:

```text
README.md
AGENTS.md

docs/
  PRODUCT_DEFINITION_v0.2.md
  SPRINT_001.md
  SPRINT_001_RESULT.md

src/ (or equivalent)
  domain/
  store/
  service/
  mcp/

fixtures/
  billing/
  unrelated-workspace/

tests/
  unit/
  integration/
  acceptance/
```

Exact implementation layout may follow the language/runtime conventions chosen for Campfire.

### `SPRINT_001_RESULT.md`

Must include:

- environment and harness versions;
- exact acceptance scenario;
- what Agent A contributed;
- what Agent B recovered;
- what Agent B continued;
- evidence that transcript isolation held;
- test results;
- limitations;
- GO / CONDITIONAL GO / NO-GO recommendation;
- recommended Sprint 002 focus.

---

## 20. What Sprint 001 Should Teach Us

This sprint is not merely asking whether MCP calls work.

It should answer deeper product questions:

1. **Is structured work state enough?**
2. **Which objects actually matter during a real handoff?**
3. **What information does the second agent immediately ask for that Campfire does not contain?**
4. **How much provenance is useful before it becomes noise?**
5. **Does the workspace feel like shared team state rather than another memory database?**
6. **Can agents contribute state naturally while working, or does recording it feel like ceremony?**
7. **What should Campfire infer versus require agents to explicitly write?**

Those observations should drive Sprint 002 rather than prematurely adding platform features.

---

## 21. Sprint 001 Magic Moment

The sprint succeeds at the product level when Human B can open a completely separate agent and ask something equivalent to:

> **"What's going on with the billing deploy, and what should we do next?"**

And Agent B can answer from Campfire:

- what the team is trying to accomplish;
- what has already been discovered;
- what was decided;
- why it was decided;
- what remains to be done;
- where the relevant artifact is;
- and who or what established that state.

Then Agent B can continue the work and leave the workspace better than it found it.

No copied transcript. No manually prepared handoff. No shared harness session.

**That is the first proof that an agent can work like it is part of the team.**
