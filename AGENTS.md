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
docs/SPRINT_020.md
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
evidence. Sprint 014 — Trust the Operator Path is complete (GO); its result is
`docs/SPRINT_014_RESULT.md`. The audited `v1.2.1` public snapshot, four-platform
GitHub Release, production Worker, migration path, and latest/versioned
installers are live. Gate B, Gate C, and external PMF evidence remain
unmeasured. Sprint 015 — Zero-to-Shared-Workspace Onboarding is complete (GO);
its result is `docs/SPRINT_015_RESULT.md`. It is published as minor release
`v1.3.0` because `campfire onboard` is a backward-compatible first-run
capability. Sprint 016 — Agent-Led Setup & Human Handoff is complete
(CONDITIONAL GO); its result is `docs/SPRINT_016_RESULT.md`. OpenCode completed
a cold prompt-to-Viewer run. Codex created the workspace but did not finish
session registration or leave a Viewer listening. It is published and deployed
as backward-compatible minor release `v1.4.0`; that release does not change the
CONDITIONAL GO decision or establish two-harness prompt-to-Viewer proof. Sprint
017 — Quiet Install & First Workspace is complete (GO); its result is
`docs/SPRINT_017_RESULT.md`. It amends the 015/016 first-run *experience*
(installer messaging, local profile, `campfire` default, `campfire up`)
without changing collaboration objects or silently registering agent sessions.
It is published and deployed as backward-compatible minor release `v1.5.0`.
Sprint 018 — Enter With the Session is complete (GO); its result is
`docs/SPRINT_018_RESULT.md`. A cold Codex session and a cold OpenCode session
each read the workspace before acting, from a prompt that does not name
Campfire. A loopback session starts the existing listener when nothing is
listening, and a later session reuses it. It does not register a session at
startup or install a machine daemon. It is published and deployed as
backward-compatible minor release `v1.6.0`. That release does not claim Gate B.
Sprint 019 — Carry the Work Out is complete (GO); its result is
`docs/SPRINT_019_RESULT.md`. One operator-configured webhook carries a closed
set of Campfire transitions. Core does not name Slack, Linear, or another
destination. It is published as `v1.7.1`. It does not claim Gate B, Gate C, or
Gate F.
Sprint CLI-001 — Agent-Native Interface Contract is complete (GO); its result
is `docs/SPRINT_CLI_001_RESULT.md` and its compatibility audit is
`docs/SPRINT_CLI_001_COMPATIBILITY_AUDIT.md`. One human terminal trace and one
cold-agent CLI-only trace passed. It is published and deployed as minor release
`v1.8.0` and does not claim Gate B, Gate C, or Gate F.
Sprint 020 — Bring the Next Teammate In has an implemented `v1.9.0` candidate;
its active acceptance contract is `docs/SPRINT_020.md` and current disposition
is recorded in `docs/SPRINT_020_RESULT.md`. Secure enrollment, recipient-owned
Codex/OpenCode connections, remote profiles, orientation, contribution, return,
and enrollment recovery are in tree. The independent two-human/two-machine
trace and both real recipient-harness paths remain pending; this is CONDITIONAL
GO for an engineering candidate, not release-ready GO. The v1.9.0 public
source snapshot and GitHub Release are published; production deployment has
not occurred. Enrollment authority, schema, retry/recovery,
and remote-profile changes are explicit sprint requirements; unrelated memory,
orchestration, Viewer writes, and broad platform work remain out of scope.
Gate B and Gate C remain unmeasured until qualifying evidence exists.
Sprint TEL-001 — Anonymous Product Telemetry is complete (GO as an engineering
candidate); its result is `docs/SPRINT_TEL_001_RESULT.md` and its disclosure is
`docs/TELEMETRY.md`. It adds a versioned, allow-listed event contract, a random
anonymous installation id, `campfire telemetry status|enable|disable`, bounded
`activated`/`active` events on real success boundaries, a measured installer
route, and Cloudflare Analytics Engine ingestion. It is not a general analytics
platform: per-command instrumentation, session replay, dashboard UI, billing, and
any workspace content remain out of scope. The dataset is not provisioned and no
founder metric has been produced. Telemetry must never fail a Campfire
operation.
Sprint CTX-001 — Keep Shared Understanding Current is a local `1.10.0`
release candidate; its contract is
`docs/Campfire-v1.10-CTX-001-Keep-Shared-Understanding-Current.md` and its
result is `docs/SPRINT_CTX_001_RESULT.md`. Orientation is bounded and reports
`total`, `returned`, and `truncated`. Catch-up pages by a durable
per-workspace append position and freezes a stream tip for that run.
Drill-down reads one page at a time. `get_workspace` stays the full inspector.
One Codex agent passed the cold-orientation, saved-cursor, and unauthorized-workspace
gate on a single machine. It is published as `v1.10.0`. The private tag is
`aab21cb680b198ef7a077e6b73f2f71f9d808059`. Gate B and Gate C remain unmeasured. CTX-001
did not add embeddings, finding or decision supersession, Viewer writes, or per-command telemetry.
Sprint COR-001 — Correct the Record is the `v1.11.0` release source.
Its contract is `docs/Campfire-v1.11-COR-001-Correct-the-Record.md` and its result
is `docs/SPRINT_COR_001_RESULT.md`. A correction or withdrawal records a new
currentness state and leaves the old finding text in place. A decision changes only
through an explicit accept, replace, or retire. Evidence and citations stay inside
one workspace. `needsReview` is computed at read time. The webhook vocabulary is
unchanged. The recorded verdict is CONDITIONAL GO: both local harnesses passed on
one machine with fixture participants. It is published as `v1.11.0`. The private tag is
`67f9e2e73095f7e5ca5abd9c9b59da2873e1d88c`. The public snapshot is
`4c4a29f5097f55a1632a3cff7590afb539162ca1`. Production is not deployed. Gate B and Gate C
remain unmeasured. Do not add embeddings, Viewer writes, or per-command telemetry.

Sprint VIS-001 — Make Shared Understanding Visible is the retained v1.12
contract at `docs/Campfire-v1.12-VIS-001-Make-Shared-Understanding-Visible.md`.
Its result is `docs/SPRINT_VIS_001_RESULT.md` and its preserved evidence is
`docs/evidence/vis-001/`. The entry gate is **3 of 4 met; decision REFRAME.**
Cold-agent evidence on a shared instance, the v1.11 release source, and one
observed human comprehension failure are recorded. **Condition 4 — evidence about
which artifacts people actually try to open — is NOT met.** On October 7, 2026
the repository owner exercised **two founder decisions**: an implementation
override directing that the condition-3 Viewer slice proceed with the gate open
(§0), and a release-scope override authorizing publication of that bounded slice
with a **CONDITIONAL** verdict (§13). `v1.12.0` is published as an audited
public snapshot and GitHub Release with four checksummed platform archives.
The post-archive Homebrew and Nix pins match the published checksums, and the
isolated release source passes 848 tests across 72 files. The production Worker
is deployed; see §13.8 for the publication and deployment record.
**Artifact previews and shared highlights remain deferred** — no
preview, no external fetch, and no change to `VIEWER_READ_METHODS`. **Usability
is unverified**: no human trace has been run against the surface, so nothing here
establishes that a person can now identify the current decision. Gate B and Gate
C remain unmeasured, and the reported 550+ installed base is not treated as
evidence for either. Do not read this release as gate satisfaction.

Sprint WOW-001 — Prove a Way of Working has its v1.13 contract at
`docs/Campfire-v1.13-WOW-001-Prove-a-Way-of-Working.md` and synthetic pilot
fixtures at `fixtures/incidents/wow-001/`. The frozen playbook definition
(`src/playbooks/incident-investigation.ts`, version `1.0.0`), the opt-in
`campfire playbook` CLI command, and the opt-in `get_playbook` MCP tool are
implemented behind `CAMPFIRE_PLAYBOOK=1` / `--with-playbook`; default CLI,
MCP, and Viewer surfaces are unchanged, and no workspace data or write path
was added. The dated harness/model environment lock is
`fixtures/incidents/wow-001/RUN-LOCK.md` and the synthetic sealed-key isolation
demonstration is `docs/evidence/wow-001/`; both are committed. Six arms and six
handoffs were executed October 8. Two independent arm-blind scorers completed
the frozen rubric; the item-level source audit and resolved scores are in
`docs/evidence/wow-001/scoring/`. The pilot verdict is **GO**: 3/3 treatment
runs passed, 3/3 matched pairs improved recording without lower continuation,
and treatment fetched the playbook 3/3 times. The owner separately authorized
v1.13 publication. Public source, all four checksummed archives, Homebrew and
Nix pins, and the production Worker are published; the versioned installer
passed a clean install check. This synthetic pilot does not close VIS-001's open
human evidence or establish Gate B or C. See `docs/SPRINT_WOW_001_RESULT.md`.

Sprint GWV-001 — Generated Workspace Views is published and deployed as
`v1.14.0` under the October 9, 2026 founder override. The page is one
sandboxed, read-only derivation of one authorized orientation read. It is
stored nowhere and holds no credential. The evidence gate remains open.
The human comprehension trace, the reference-open observation, and the
presentation-defect finding are unrecorded. This release is not a GO,
Gate B, or Gate C result. See `docs/SPRINT_GWV_001_RESULT.md`.

Sprint RCL-001 — Recall and Portable Handoff is an implemented candidate for
v1.16. It adds one authorized recall read and one CLI-written offline packet.
The October 11 scored pilot verdict is NO-GO. The package stays `1.15.0`.
Gate B, Gate C, and Gate E are unmeasured. Do not add embeddings, Viewer writes,
packet import, or per-command telemetry. See
`docs/Campfire-v1.16-RCL-001-Recall-and-Portable-Handoff.md` and
`docs/SPRINT_RCL_001_RESULT.md`.

Sprint RCL-002 — Recall over Orientation completed its October 11 synthetic
pilot with a NO-GO / REFRAME verdict. v1.16 stays held; package stays
`1.15.0`. The RCL-001 NO-GO and its runs are unchanged. S1 matched answers
chose the same next action, S2 treatment chose one rule despite two accepted
conflicting decisions, and the S2 offline recipient missed the required
decision transition. Gate B, Gate C, and Gate E remain unmeasured. See
`docs/Campfire-v1.16-RCL-002-Recall-Over-Orientation.md`,
`docs/SPRINT_RCL_002_RESULT.md`, and `docs/evidence/rcl-002/`.

Sprint RCL-003 — Decision safety and source use is a local `1.15.0` candidate
whose contract is `docs/Campfire-v1.16-RCL-003-Decision-Safety-and-Source-Use.md`.
It adds one deterministic `decisionSet` to the recall response and the handoff
packet: every decision the query matches, grouped, with its ids, `needsReview`
state, recorded replacement links, and a derived `state`. Campfire never infers
an operative decision. An unresolved set carries a frozen `beforeActing`
instruction to seek a recorded retirement or an accepted replacement with a
reason before executing either rule; a recorded replacement yields
`linked-accepted-decisions` and does **not** ask for a transition. Decision hits
now carry a bounded `rationale`, reversing the RCL-002 excerpt-only position.
`RECALL_SCHEMA_VERSION` and `HANDOFF_PACKET_SCHEMA_VERSION` are `2`;
`RECALL_ORDERING_VERSION` stays `rcl-1` because the set is neither ranked nor
paginated. RCL-001 and RCL-002 stay frozen; their fixtures and results are not
edited or rescored. Gate B, Gate C, and Gate E remain unmeasured.

Sprint PSA-001 — Bound Work and Protect Read Boundaries is published and
deployed as `v1.15.0`. It hardened Viewer Host validation, Worker body reads,
unexpected-error responses, delivery batching, and dependencies without a new
collaboration surface. See `docs/SPRINT_PSA_001_RESULT.md`.

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

CTX-001 bounds `get_workspace_context`. A truncated slice says so with `total`, `returned`, and `truncated`. The caller drills down or catches up. It does not infer completeness from array length.

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
