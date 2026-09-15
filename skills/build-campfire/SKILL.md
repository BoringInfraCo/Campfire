---
name: build-campfire
description: The canonical engineering playbook for building Campfire. Use for every substantive implementation, architectural review, sprint execution, refactor, documentation update, harness integration, and engineering decision.
---

# SKILL.md

# Build Campfire

> Engineering Constitution

This document defines how Campfire is engineered.

It is the canonical engineering playbook for both human engineers and AI coding agents.

Its purpose is not to maximize code generation.

Its purpose is to maximize shipping velocity **without sacrificing architectural coherence**.

Campfire should move fast because the product stays focused.

Every meaningful implementation should follow this document.

---

# Why This Document Exists

Software projects become complicated gradually.

Not because engineers intentionally overbuild them.

Because small local decisions accumulate:

- abstractions are introduced too early
- future Era II / Era III concepts leak into current implementation
- harness-specific logic spreads into the domain
- transcripts become the canonical representation by accident
- documentation grows faster than the product
- AI agents optimize for completeness instead of scope
- implementation begins to redefine the architecture

Campfire intentionally avoids this.

The product should remain understandable.

The architecture should remain small.

The active Sprint should remain narrow.

The code should reflect what Campfire needs **today**, not everything it may need someday.

---

# The Engineering North Star

Every implementation should make Campfire better at one or more of these things:

```text
Share
Continue
Authorize
Attribute
Inspect
Remember
```

But only the capability required by the current sprint phase should be implemented.

Whenever multiple implementation choices exist:

> Choose the smallest design that satisfies the active Sprint while preserving Campfire's architectural boundaries.

---

# What Campfire Is

Campfire is the shared workspace where people and their agents work together.

Campfire provides a secure, harness-independent collaboration boundary for durable work state shared across humans and agents.

The north star is:

> **Make agents work like they are part of the team.**

The immediate proof is narrow:

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

Campfire stores structured work state such as:

- Goal
- Task
- Finding
- Decision
- Artifact
- Contribution / provenance

Campfire works across harnesses such as:

- Codex
- Claude Code
- OpenCode
- Cursor / internal agents
- CLI / human UI

These harnesses remain clients.

They never define Campfire.

---

# What Campfire Is Not

Campfire is not:

- a shared chat application
- a transcript synchronization service
- a generic memory database
- a generic vector database / RAG product
- an agent framework
- a model provider
- an agent-to-agent messaging protocol
- a multi-agent chat room
- an agent orchestration / scheduling engine
- a replacement for GitHub, Linear, Slack, or infrastructure systems
- an unrestricted organizational knowledge graph
- a proprietary agent harness
- a hosted multi-tenant control plane (in v1.x)
- autonomous company management

Campfire may compose with these systems.

It may expose itself through MCP.

It may reference GitHub, Sentry, Cloudflare, Linear, or Combie resources.

It may eventually coordinate controlled action.

None of those capabilities define the product.

---

# Product Philosophy

Campfire begins with one belief:

> Teams need shared, structured collaboration state that both humans and authorized agents can participate in.

Campfire exists to make work survive the session that produced it.

The product should remain valuable without AI inference.

Workspace state, authorization, provenance, identity, and lifecycle should be deterministic wherever possible.

AI may summarize, extract, rank, or derive memory later.

It must not be required for correctness today.

---

# Engineering Philosophy

Campfire should be built through short feedback loops.

Prefer shipping over predicting.

Prefer vertical slices over platform building.

Prefer real harness behavior over theoretical abstractions.

Prefer explicit behavior over hidden magic.

Prefer boring infrastructure over unnecessary cleverness.

Prefer changing code over maintaining speculative documentation.

The fastest path is not the one with the most code.

The fastest path is the one with the fewest wrong assumptions.

---

# The Campfire Canon

Campfire deliberately keeps its permanent documentation small.

The canonical product documents are:

1. `docs/PRODUCT_DEFINITION.md`
2. `docs/VISION.md`
3. `docs/ARCHITECTURE.md`
4. `docs/ROADMAP.md`
5. this `SKILL.md`

`AGENTS.md` is the operator instruction sheet that points at this Canon. It does not replace it.

These are the guiding lights.

Everything else should exist only when it earns the right to exist.

---

# Product Canon

Read first:

- `docs/PRODUCT_DEFINITION.md`

This answers:

> What is Campfire?

> Why does it exist?

> What does it deliberately not become?

> What principles should remain true as the implementation evolves?

---

# Vision Canon

Read second:

- `docs/VISION.md`

This answers:

> What world does Campfire assume?

> What is shared work state vs shared transcripts?

> Why is identity infrastructure?

> What does the Era I → Era II → Era III progression mean?

---

# Architecture Canon

Read third:

- `docs/ARCHITECTURE.md`

This answers:

> How is Campfire structured?

> What belongs in interfaces vs application services vs domain?

> What does the Workspace own?

> How do identity, authorization, provenance, retrieval, and persistence fit together?

> What are the architectural invariants?

---

# Roadmap Canon

Read fourth:

- `docs/ROADMAP.md`

This answers:

> What are we proving now?

> What comes later?

The Roadmap describes direction.

It is **not permission to implement future features early**.

Future Era II / Era III concepts must not leak into the active Sprint unless explicitly required.

The Roadmap is directional and should not be treated as committed sprint scope.

---

# Execution Canon

Read fifth:

- Active Sprint under `docs/SPRINT_*.md` or `docs/SPRINT_VIEWER_*.md`
- Its result doc under `docs/SPRINT_*_RESULT.md` when present

This answers:

> What exactly are we building now?

> What is the GO / CONDITIONAL GO / NO-GO rubric?

The Sprint defines today's implementation boundary.

The Sprint never overrides the Architecture or Product Definition.

---

# Source of Truth Order

Campfire follows the `AGENTS.md` conflict order, not the Combie order.

When sources disagree, use this order:

```text
Active Sprint acceptance criteria
    ↓
ARCHITECTURE.md  (system boundaries)
    ↓
PRODUCT_DEFINITION.md  (product semantics)
    ↓
VISION.md  (long-term direction)
    ↓
ROADMAP.md  (directional, not committed scope)
    ↓
Current Code
```

The code reflects implementation reality.

It does not automatically redefine product direction.

If code conflicts with the Canon:

report the conflict.

Do not silently change the Canon to match the implementation.

Do not silently resolve meaningful contradictions. Surface them.

---

# Core Product Progression

Campfire evolves in this order:

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

This order is intentional.

Do not skip ahead.

The Era shorthand for the same progression is:

```text
Era I — Continuity
  "Your agent knows what the team already figured out."
    ↓
Era II — Collaboration
  "People and agents work from the same operational context."
    ↓
Era III — Learning
  "The organization gets better at working with agents
   because of everything it has learned before."
```

Each roadmap version earns the next capability.

v1.0 is Era I complete plus the smallest Era II slice that makes a small multi-harness team keep a workspace alive. It is not organizational memory, a dashboard, GitHub sync, SSO, or orchestration.

---

# Architectural Invariants

These rules must remain true.

## Invariant 1 — Workspace Is the Collaboration Boundary

Shared state belongs to an explicit workspace:

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

There is no implicit organization-wide memory pool.

Do not introduce implicit organization-wide retrieval. Cross-workspace memory is future work.

## Invariant 2 — Humans and Agents Are Distinct Identities

Do not collapse humans and agents into one generic anonymous author.

The conceptual hierarchy is:

```text
Organization
└── Team
    ├── Human
    │   └── Agent
    └── Workspace
```

An agent contribution must preserve:

- the agent identity,
- the harness where relevant,
- and the human or organizational principal the agent acted on behalf of where applicable.

Do not model `created_by = "codex"` as sufficient provenance.

## Invariant 3 — Shared Work State Is Not Shared Transcript State

Do not make raw conversation transcripts the canonical Campfire collaboration representation.

```text
Shared Finding
    !=
Access to Private Conversation
```

A private conversation may produce shared state.

Access to that shared state must not imply access to the originating transcript.

## Invariant 4 — Authorization Happens Before Retrieval

Do not retrieve unauthorized state into a harness and rely on the model to ignore it.

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

Filtering happens **before** state crosses the Campfire boundary. The boundary must still be real even when the rule is simple.

## Invariant 5 — Provenance Is First-Class

Meaningful shared state must preserve who or what contributed it.

Campfire should eventually be able to explain:

```text
who contributed this?
when?
through which agent?
on whose behalf?
what changed?
```

Avoid destructive updates that erase meaningful provenance. Prefer append-before-overwrite: important mutations create inspectable contribution/history records even when materialized current state is updated.

## Invariant 6 — Campfire Is Harness-Independent

Core domain objects must not depend on proprietary Codex, Claude Code, OpenCode, Cursor, or other harness session schemas.

Harness-specific logic belongs at interface/adaptation boundaries.

The domain should remain usable if every current agent vendor disappears.

## Invariant 7 — MCP Is an Interface

MCP is a primary agent-facing interface. MCP is not the product.

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

MCP handlers must remain thin. Future CLI, HTTP, SDK, or UI clients must be able to use the same application/domain layer.

Do not place core collaboration semantics directly inside MCP handlers.

## Invariant 8 — Campfire Is Not an Orchestration Engine

Do not add agent scheduling, swarms, autonomous delegation, runtime management, or complex workflow execution unless explicitly required by the active sprint.

The product proof is collaboration continuity, not orchestration.

## Invariant 9 — Model Inference Is Not Required for Correctness

Storage, authorization, provenance, identity, and lifecycle correctness must be deterministic.

Do not require an LLM to decide whether state exists, who created it, whether a transition is valid, or whether an actor is authorized.

LLM-assisted extraction, summarization, ranking, and memory derivation are future product capabilities.

## Invariant 10 — Campfire Remains Independently Useful

Do not introduce required dependencies on Combie, Harnie, Meno, Pico, or other Boring Infra projects.

Those systems may compose with Campfire later:

```text
What exists?                  → Combie
What is happening?            → Harnie
What is true?                 → Meno
What can this agent reach?    → Pico
How is the agent behaving?    → Observability
How are we working together?  → Campfire
```

Campfire must prove its own primitive first.

---

# The Anti-Speculation Rule

Before creating any new abstraction, ask:

> Does the active Sprint require this abstraction today?

If the answer is no:

Do not create it.

Examples of premature abstractions include:

```text
VectorStore
SemanticRanker
EmbeddingRetriever
TranscriptIngester
LLMMemoryExtractor
OrchestrationEngine
AgentScheduler
CapabilityEngine
ApprovalQueueEngine
CrossWorkspaceGraph
NotificationHub
PresenceService
EnterpriseIAM
KubernetesOperator
```

These concepts may be correct later.

That does not make them correct now.

Let real requirements earn abstractions.

---

# Harness Development Philosophy

Harness adapters should evolve from real integrations.

Do not design a universal harness framework from imagination.

If Sprint 001 uses Codex + OpenCode (or Claude Code):

build the smallest adapter contract those harnesses prove we need.

When Cursor arrives:

test the abstraction.

When an internal agent arrives:

test it again.

The abstraction should become stronger through evidence.

Not prediction.

Harness-specific session schemas must never leak into:

- `src/domain/`
- `src/service/`
- authorization decisions
- provenance records
- SQLite schema semantics

---

# Vertical Slice Discipline

Campfire is built through complete vertical slices.

Every Sprint should leave the repository in a working and demonstrable state.

Prefer:

```text
One workspace
↓
Real human + agent identities
↓
Real structured contribution
↓
SQLite persistence + contribution record
↓
Authorized retrieval
↓
Cross-harness continuation with provenance
```

over:

```text
Five unfinished surfaces
+
future memory layer
+
partial orchestration
+
placeholder intelligence
```

Depth wins over breadth.

---

# Documentation Discipline

Permanent documentation should remain intentionally small.

Do not create new permanent architectural documents unless explicitly requested or clearly justified by complexity.

Examples of documents that should **not** be created speculatively:

- `MEMORY_MODEL.md`
- `RETRIEVAL_MODEL.md`
- `POLICY_MODEL.md`
- `MCP_SPEC.md`
- `LEARNING_MODEL.md`
- `ORCHESTRATION_MODEL.md`

If a subsystem eventually becomes complicated enough that contributors cannot understand it from:

- `ARCHITECTURE.md`
- code
- tests

then a dedicated document may be warranted.

Documentation must be earned by complexity.

---

# Documentation Update Rules

During implementation:

### If collaboration semantics changed materially

Update:

- `docs/PRODUCT_DEFINITION.md`

### If long-term direction changed materially

Update:

- `docs/VISION.md`

### If system boundaries changed materially

Update:

- `docs/ARCHITECTURE.md`

### If release sequencing changed materially

Update:

- `docs/ROADMAP.md`

### If implementation details changed

Prefer:

- code
- tests
- inline documentation

### If nothing canonical changed

Do not touch the canonical docs.

Avoid documentation churn.

When implementation evidence changes a product assumption, record why the assumption changed and keep terminology consistent. Do not silently let code and docs diverge.

---

# Repository Reading Order

Before implementing any meaningful change:

1. Read `AGENTS.md`
2. Read this `SKILL.md`
3. Read `docs/PRODUCT_DEFINITION.md`
4. Read `docs/VISION.md`
5. Read `docs/ARCHITECTURE.md`
6. Read `docs/ROADMAP.md`
7. Read the Active Sprint (`docs/SPRINT_*.md` / `docs/SPRINT_VIEWER_*.md`)
8. Inspect relevant source code and tests

Do not read every historical sprint unless required.

Do not let old implementation plans override current architecture.

---

# Sprint Execution Protocol

When the user says:

```text
Implement Sprint X
```

or requests a substantive implementation belonging to an active Sprint, the coding agent MUST:

1. Read `AGENTS.md`
2. Read `SKILL.md`
3. Read `docs/PRODUCT_DEFINITION.md`
4. Read `docs/VISION.md`
5. Read `docs/ARCHITECTURE.md`
6. Read `docs/ROADMAP.md`
7. Read the Active Sprint (and its result doc if present)
8. Inspect the repository
9. Produce the Repository Understanding Report
10. Validate architecture and Sprint scope
11. Produce an implementation plan
12. Implement using Red → Green → Refactor
13. Perform architecture review
14. Perform engineering review
15. Run focused validation
16. Run the full relevant test suite
17. Perform manual verification (including the two-harness proof where applicable)
18. Review the complete diff
19. Update documentation only when required
20. Commit when authorized
21. Verify repository state
22. Stop after the active Sprint

Do not continue into future Sprint work.

---

# Phase 1 — Understand Campfire

Before changing code, understand the current product boundary.

Answer:

- What problem is this Sprint solving?
- Which roadmap phase / gate does it belong to (A–G, Stage A–D, Era I–III)?
- Which Canon documents govern this work?
- Which architectural invariants apply?
- What is explicitly out of scope?
- What is the GO / CONDITIONAL GO / NO-GO rubric?

If the Sprint conflicts with the Canon:

STOP.

Explain the conflict.

Do not silently choose one interpretation.

---

# Phase 2 — Repository Understanding

Inspect the current repository.

Campfire layout (authoritative at time of writing; verify against tree):

```text
src/
  cli/        CLI entry and commands (init, seed, show, serve, view, mcp, ...)
  mcp/        MCP stdio + tools (thin adapters over the service)
  service/    Application services + authorization
  domain/     Workspace, identity, task/finding/decision/artifact, contributions
  store/      SQLite store + schema.sql + deterministic migrations
  http/       Hosted HTTP API (serve, POST /v1/call, bearer tokens)
  viewer/     Read-only team journal (loopback, never holds a token)
  worker/     Cloudflare Worker + D1 path
  bootstrap/  init/seed fixtures
  config.ts / runtime.ts / types/
tests/
  unit/
  integration/
  acceptance/   two-harness continuation proofs
  fixtures/     deterministic fixtures (label provenance honestly)
migrations/     D1 migrations
scripts/        run-acceptance, wrangler-deploy, packaging
docs/           Canon + SPRINT_*.md + SPRINT_VIEWER_*.md + OPERATOR.md
```

Produce a concise Repository Understanding Report.

Include:

## Repository Summary

- repository structure
- important modules
- current implementation maturity
- relevant tests
- relevant commands

## Sprint Readiness

- what already exists
- what can be reused
- what must be added
- what should remain untouched

## Canon Alignment

- whether current implementation matches the Product Definition and Architecture
- any architectural drift relevant to the Sprint

## Risks

Identify concrete implementation risks.

Do not invent theoretical risks unrelated to the active work.

---

# Phase 3 — Scope Validation

Confirm:

- the Sprint belongs to the current Roadmap phase / gate
- the Sprint is a complete vertical slice
- no future Era II / Era III work is being introduced
- no unnecessary harness abstraction is being introduced
- no embedding / orchestration / transcript-ingestion layer is being added unless required
- no cross-workspace retrieval is being added unless required
- no Boring Infra dependency is being added unless required
- no execution / orchestration capability is being added unless required
- canonical documentation does not need speculative expansion

If the proposed implementation exceeds Sprint scope:

reduce it.

---

# Phase 4 — Implementation Plan

Before modifying code, produce a concise implementation plan.

Include:

- files or modules to modify
- new modules if required
- responsibilities
- public interfaces (CLI, MCP tools, HTTP routes, viewer reads)
- tests to add
- migration considerations (SQLite + D1)
- meaningful risks

Avoid long implementation essays.

The plan should make the change understandable.

Then implement.

---

# Phase 5 — Red → Green → Refactor

Use test-driven development where practical.

Stack: TypeScript + Node 22+, `better-sqlite3`, `zod`, `vitest`, `tsx`. No live harness credentials required for the suite.

## Red

Add or update tests that express the required Sprint behavior.

Confirm the required behavior is not already satisfied.

Prioritize domain invariants and the continuation proof:

```text
workspace creation
human identity
agent identity
human-agent attribution
participant membership
finding / decision creation
task lifecycle
artifact attachment
contribution / provenance creation
authorized context retrieval
unauthorized retrieval rejection
cross-harness continuation fixture
transcript-isolation assumptions
```

## Green

Implement the smallest amount of code required to satisfy the Sprint.

Do not build future capability.

## Refactor

Improve:

- naming
- organization
- clarity
- error handling
- duplication

without increasing scope.

---

# Phase 6 — Architecture Review

After implementation, review the system architecture.

Ask:

- Did harness-specific concepts leak into the domain?
- Did transcripts become the canonical representation?
- Did human and agent identity collapse?
- Did we violate the workspace boundary (org-wide retrieval)?
- Did authorization happen before retrieval, or did the harness receive state it should ignore?
- Did we lose provenance on update?
- Did we introduce intelligence where deterministic state was enough?
- Did we accidentally create orchestration / scheduling?
- Did we add speculative abstractions?
- Did we weaken token / invite / membership boundaries?
- Did we make MCP (or viewer, or HTTP) part of the core?
- Did we add a required Combie / Harnie / Meno / Pico dependency?
- Did we stay within the active Sprint?

Resolve architectural drift before declaring completion.

---

# Phase 7 — Engineering Review

Review implementation quality.

Evaluate:

- readability
- naming (match product language: workspace, goal, task, finding, decision, artifact, contribution)
- module boundaries (MCP → service → auth → domain → repo → SQLite)
- error handling
- test quality
- dead code
- duplication
- complexity
- unnecessary dependencies
- hidden state
- performance concerns relevant to the Sprint

Prefer simplification whenever possible.

---

# Phase 8 — Testing

Run focused validation first.

```bash
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:acceptance
```

Then run the full relevant project suite:

```bash
npm test
```

All required tests must pass.

Do not hide failing tests.

Do not disable tests merely to make the build green.

Tests must run without live harness credentials (fixtures/mocks). Prefer deterministic fixtures. Do not claim real-world evidence from synthetic fixtures. Label fixture provenance accurately.

---

# Phase 9 — Manual Verification

Perform representative manual verification whenever the Sprint produces user-visible or integration behavior.

Examples:

```text
campfire init
campfire seed --reset
campfire show ws_billing_deploy
campfire activity ws_billing_deploy
campfire serve                  # hosted HTTP API on 127.0.0.1:9414
campfire view                   # read-only team journal (loopback)
campfire mcp                    # MCP stdio (two harnesses, two tokens)
npm run acceptance              # deterministic two-harness run + evidence
```

Verify:

- expected workflow succeeds
- errors are understandable
- state persists correctly
- authorization precedes retrieval (unauthorized actor gets denial, not filtered prose)
- provenance is inspectable (who / through which agent / on whose behalf / what changed)
- transcript isolation holds (Agent B continuation uses Campfire state, not Session A text)
- existing behavior remains unchanged
- the Sprint is demonstrable against its GO rubric

Automated tests do not replace representative manual verification.

For continuation sprints, the deliverable is the experience:

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

If the demo works only because information was copied from Session A into Session B outside Campfire, the sprint has failed.

---

# Phase 10 — Documentation Review

Ask:

Did collaboration semantics change?

Did system boundaries change?

Did long-term direction change?

Did roadmap sequencing change?

If no:

leave canonical docs unchanged.

If yes:

update only the affected canonical document.

Do not create new permanent documentation by default.

Keep terminology consistent (`Goal`, `Task`, `Finding`, `Decision`, `Artifact`, `Contribution`, `WorkspaceParticipant`, `Actor`).

---

# Phase 11 — Review the Complete Diff

Review every modified file.

Remove:

- temporary debugging
- abandoned experiments
- unnecessary TODOs
- commented-out code
- unused imports
- unused abstractions
- future-facing placeholders
- dead configuration

The final diff should read like one coherent implementation.

---

# Phase 12 — Commit

Commit only when authorized by repository policy or the user.

Commits should represent meaningful engineering steps.

Prefer messages such as:

```text
feat(domain): add task assignee transition
feat(service): enforce invite-only workspace join
fix(store): preserve contribution provenance on task update
feat(mcp): expose authorized workspace context projection
feat(viewer): collapse membership plumbing into workstream
```

Avoid generic messages such as:

```text
update
fix
changes
stuff
```

---

# Phase 13 — Push

Push only when:

- repository policy explicitly allows it

or

- the user explicitly requests it

Never assume pushing is desired.

---

# Phase 14 — Verification

After committing or pushing, verify:

- correct repository
- correct branch
- expected commit
- clean working tree
- tests remain passing
- only intended files changed

Report exactly what was completed.

---

# Phase 15 — Sprint Completion

A completed Sprint should record enough implementation context for the next Sprint to begin safely.

Update the Sprint result doc (`docs/SPRINT_*_RESULT.md` / `docs/SPRINT_VIEWER_*_RESULT.md`) with concise Implemented / Deviations / Validation / Learnings / Canon Changes notes if that is the repository practice.

Record the GO / CONDITIONAL GO / NO-GO decision honestly, including what was real-harness evidence vs deterministic fixture evidence and any explicit dogfood limitation.

Do not rewrite historical Sprint intent.

Do not begin the next Sprint.

---

# Phase 16 — Stop

Stop after the active Sprint.

Never:

- partially implement the next Sprint
- create scaffolding for later roadmap phases
- add cross-workspace memory "while already here"
- build generic systems for hypothetical needs
- introduce orchestration / autonomous execution early
- introduce embeddings / transcript ingestion early
- silently redesign Campfire

One finished vertical slice is better than several partial ones.

---

# Definition of Done

A Sprint is complete only when:

✓ Sprint requirements and acceptance rubric are satisfied.

✓ Canon remains intact.

✓ Scope remains narrow.

✓ Workspace boundary remains explicit.

✓ Human / agent identity remains distinct.

✓ Transcript isolation holds.

✓ Authorization precedes retrieval.

✓ Provenance is inspectable.

✓ No speculative future work was introduced.

✓ Tests pass (`npm run typecheck`, `npm test`, acceptance where applicable).

✓ Manual verification succeeds where applicable (two-harness proof where applicable).

✓ Documentation is accurate.

✓ The full diff was reviewed.

✓ Repository state is clean.

Anything less is incomplete.

---

# Engineering Decision Rules

Before implementing anything substantial, ask:

### Product

Does this strengthen Campfire's ability to share, continue, authorize, attribute, inspect, or remember work state?

Is that capability part of the current roadmap phase / gate?

### Architecture

Does this belong in:

- interface (MCP / CLI / HTTP / viewer)
- application service
- authorization
- domain
- repository
- persistence (SQLite / D1)

Is ownership clear? Does the dependency point MCP → service → auth → domain → repo → persistence?

### Scope

Does the active Sprint require it?

If not:

do not build it.

### Harnesses

Is this abstraction based on real harness behavior?

Or are we guessing about future harnesses?

### AI

Do we need model reasoning?

Or can deterministic state solve it?

### Retrieval

Do we need semantic retrieval?

Or does the deterministic workspace context projection (`workspace`, `goal`, open tasks, active findings, accepted decisions, relevant artifacts, provenance) already enable continuation?

### Documentation

Did something canonical actually change?

Or can the code and tests remain the source of truth?

---

# Working With AI Coding Agents

AI coding agents are engineering partners.

They are not autonomous product designers.

Agents should:

- understand before implementing
- inspect before assuming
- plan before modifying
- test before claiming completion
- explain architectural uncertainty
- stay inside Sprint scope
- stop when the Sprint is done

Agents should never:

- invent product requirements
- silently change architecture
- implement future roadmap phases
- create speculative abstractions
- bypass authorization for convenience
- collapse human/agent identity
- sync transcripts into shared state
- expand documentation unnecessarily

When genuinely uncertain about a canonical architectural conflict:

report it.

Do not guess.

---

# Coding Philosophy

Prefer explicit code over clever code.

Prefer small interfaces over broad frameworks.

Prefer composition.

Prefer predictable data flow.

Prefer typed domain concepts where they remove ambiguity.

Prefer boring, legible code optimized for correctness, explicit semantics, testability, inspectability, small interfaces, and reversible decisions.

Avoid:

- speculative abstractions
- premature optimization
- unnecessary dependencies
- harness-specific domain logic
- transcript-shaped domain objects
- hidden mutable state
- framework-building without evidence

Code should remain understandable months later.

Comments should explain **why**, especially around product invariants, authorization, provenance, and unusual domain decisions.

Names should match the product language used in the documentation.

---

# Dependency Philosophy

New dependencies must justify their cost.

Before adding one, ask:

- Does the standard library already solve this adequately?
- Does the current repository already contain an appropriate dependency?
- Is this dependency maintained?
- Does it materially simplify the active Sprint?
- Does it introduce unnecessary architectural commitment?

Do not add frameworks because they may be useful later.

In particular, do not add a vector database, cloud control plane, distributed runtime, graph database, or LLM pipeline unless the sprint demonstrates a hard requirement.

---

# Error Philosophy

Errors should help humans understand what failed and what to do next.

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

Prefer:

```text
Unauthorized: agent claude-alice is not a participant of workspace billing-deploy-failure (invite required)
```

over:

```text
request failed
```

Do not silently succeed when an operation did not occur.

Do not use model-generated prose as the only representation of an application error.

But avoid exposing:

- bearer tokens
- secrets
- unrelated workspace state
- private session content

---

# Security Philosophy

Workspace membership is invite-only. Retrieval is authorized before it crosses the boundary.

Security is not future cleanup.

Always:

- never commit secrets
- never log credentials
- never expose unrelated workspace state
- never assume an agent inherits every human permission
- never bypass authorization for convenience
- never treat artifact references as proof of artifact authorization
- preserve the distinctions: private session != shared workspace; human != agent; membership != unlimited authorization; artifact reference != artifact permission; human capability != agent capability
- keep bearer tokens in the server process / env (`CAMPFIRE_URL`, `CAMPFIRE_TOKEN`), never in the viewer browser
- respect the single-writer rule: the hosted `serve` process owns the SQLite file; CLI and MCP adapters call `POST /v1/call`
- keep the viewer read-only and loopback-bound; the browser never holds a token
- never commit a real D1 `database_id` (`wrangler.toml` holds a placeholder; the id lives in `$CAMPFIRE_D1_DATABASE_ID` or gitignored `wrangler.local.toml`)
- validate external input (zod at boundaries)
- avoid arbitrary command execution
- maintain auditability: which actor, which workspace, allow/deny, which object changed, which contribution was recorded

Convenience must not override trust.

---

# Persistence Philosophy

Sprint lineage uses SQLite unless the sprint document explicitly changes that decision.

Persistence should provide:

- stable IDs
- foreign keys
- deterministic migrations (local `src/store/schema.sql` + `migrations/` for D1)
- transaction safety
- timestamps
- inspectable state

Avoid storing critical domain state only inside serialized opaque blobs when explicit columns/tables would preserve useful semantics.

JSON metadata is acceptable for genuinely flexible auxiliary data.

Full event sourcing is not required. However, avoid architectures where updating an object destroys the ability to understand meaningful prior state. Keep both current state (easy retrieval) and historical contributions (inspectable provenance).

---

# Observability Philosophy

The implementation should be easy to inspect.

At minimum, make it possible to understand:

- which actor performed an operation
- which workspace was involved
- whether authorization succeeded
- which object changed
- which contribution was recorded

A useful rule:

> **If we cannot explain how Agent B received a piece of context, something is wrong.**

Structured application logs plus Campfire's contribution history are sufficient for now.

---

# Performance Philosophy

Do not prematurely optimize.

But do not ignore obvious scalability boundaries.

During early versions, prioritize:

- correctness
- clarity
- predictable authorization
- understandable persistence
- deterministic behavior

Optimize only after measurement or real user need.

---

# Distribution Philosophy

Campfire stays `private: true` and is **not published to npm**.

Distribution is via the install script and GitHub Release assets.

Avoid architecture that requires a hosted control plane for basic functionality.

A team-hosted `serve` process may provide convenience:

- shared SQLite writer
- bearer-token auth
- invite membership
- hosted HTTP API
- read-only viewer

But the core collaboration model must remain portable and locally inspectable.

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

The current state should be easy for agents to retrieve (workspace context projection).

The history should make provenance inspectable (contribution log, activity timeline, viewer workstream).

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

```text
Decision

proposed
  ↓
accepted
  ├──> superseded
```

```text
Workspace

active
  ↓
completed
  ↓
archived
```

Reject invalid transitions.

Do not silently normalize contradictory state.

If reopening or superseding behavior is required, model it explicitly and test it.

Completed work should remain inspectable because historical work is part of future team memory.

---

# Context Retrieval

Sprint-level context retrieval should be simple and deterministic.

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

Later retrieval (`related prior work`, `decision history`, `prior attempts`, freshness) must follow evidence from actual use. Gate E (historical reuse) is the gate for that investment, not the current sprint.

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

If future features ingest transcripts to derive candidate work state, the raw transcript and derived shared state must remain separate concepts with explicit policy boundaries.

---

# The Campfire Flywheel

The long-term system is:

```text
Goal
  ↓
Task
  ↓
Finding
  ↓
Decision
  ↓
Artifact
  ↓
Contribution (provenance)
  ↓
Authorized Retrieval
  ↓
Continuation
  ↓
Outcome
  ↓
Memory
  │
  └──────────────↺
```

Do not attempt to build the whole flywheel at once.

Each roadmap phase earns the next capability:

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

---

# Current Build Strategy

Campfire should move through narrow, workspace-backed vertical slices.

For the current stage:

```text
One workspace
   ↓
Human + agent identities + invite membership
   ↓
Structured contribution (goal/task/finding/decision/artifact)
   ↓
SQLite persistence + contribution record
   ↓
Authorized retrieval (MCP / CLI / HTTP)
   ↓
Cross-harness continuation + provenance inspection
   ↓
Read-only viewer journal
```

Then extend the same loop to the next gate.

Use each real two-harness trace to challenge and improve the domain model.

Do not design for organizational memory, coordination, or learning before continuity + repeat usage + multi-participant value are proven.

Evidence gates (must be met before the corresponding investment):

```text
Gate A — Continuity:          Can Agent B continue Agent A's work?
Gate B — Repeat Usage:        Do humans/agents reuse the workspace?
Gate C — Multi-Participant:   Does Campfire improve with more contributors?
Gate D — Authorization Need:  Do real scenarios need different access?
Gate E — Historical Reuse:    Does prior work improve new work?
Gate F — Controlled Action:   Do teams want coordinated action?
Gate G — Learning:            Do outcomes measurably improve future work?
```

---

# Success Criteria

Every Sprint should improve one of Campfire's current roadmap capabilities while preserving the architectural foundation.

A good Sprint:

- solves one clear problem
- is demonstrable against its GO rubric
- has a narrow diff
- strengthens real continuation behavior
- teaches us something about the collaboration model
- avoids future work
- leaves the repository easier to understand

The goal is not to produce the largest change.

The goal is to produce the smallest valuable learning loop.

---

# Final Principle

Campfire should move fast because it stays small.

The Product Definition defines **what collaboration means**.

The Vision defines **why Campfire exists**.

The Architecture defines **what must remain true**.

The Roadmap defines **what we prove next (direction, not commitment)**.

The Sprint defines **what we build today**.

The code brings that one slice to life.

Do not predict complexity.

Let real users, real harnesses, and real implementation pressure reveal it.

> **The work that belongs to the team can belong to the team.**
