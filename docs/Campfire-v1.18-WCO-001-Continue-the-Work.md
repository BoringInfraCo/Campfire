# Campfire v1.18 — WCO-001: Continue the Work

**Status:** Amendment 1 recorded (October 15, 2026); the bounded guidance/schema repair is implemented and passes D1–D6; result in `docs/SPRINT_WCO_001_RESULT.md`. The eligible two-human case remains **NOT OBSERVED**; the recorded verdict is CONDITIONAL GO — engineering candidate. No v1.18 release artifact or release decision exists.  
**Date:** October 15, 2026  
**Target release:** v1.18.0, only if this sprint earns a product change and a separate release decision.  
**Depends on:** Published v1.17.0 Shared Work Home; existing enrollment, task ownership, correction, context, and provenance surfaces.  
**Result record:** `docs/SPRINT_WCO_001_RESULT.md` when observations begin.

## 1. Sprint question

> Can a second authorized human and their own agent take over a real task from another human-agent pair, resolve a recorded blocker, and leave work the first pair can use, using Campfire state instead of a private transcript or a manually prepared recap?

The v1.17 home made the existing shared state easier to inspect, but its D1–D7 tests establish implementation behavior, not human comprehension or ordinary team value. It was published under the separate release-scope override in `docs/RELEASE_V1_17_DECISION.md`. The SWH-001 two-human trace, the older Viewer comprehension trace, a real artifact-reference-open attempt, and ordinary continuation remain unrecorded. Gate B, Gate C, and Gate E remain unmeasured. This sprint does not convert that release into a retrospective GO.

The next roadmap question is **work continuity**. First use the shipped product on an actual task. A fixture can verify boundaries, but cannot establish that a teammate found the state useful. The first implementation target is therefore a *measured gap in the existing continuation path*, not a predetermined new object or dashboard.

## 2. Product promise and boundary

One team uses one existing workspace:

1. Human A and Agent A leave a task, its recorded owner/status, relevant findings, decisions, and artifact references in Campfire. A real blocker or unresolved dependency is identifiable in that shared state.
2. Human B arrives through their own membership and Agent B through their own registered identity and harness. They orient from authorized Campfire reads, identify the task and decision boundary, and choose a safe next action.
3. B and Agent B do useful work on the dependency and write the outcome back as existing Task, Finding, Decision, or Artifact records with their own provenance.
4. A or Agent A returns in a fresh process, reads B's contribution, and takes a dependent next action or records why no action is yet safe.

This is a **workspace continuity** loop. A task being assigned to B is not itself a handoff success; an agent reading a page is not a resolved blocker; and A opening the workspace is not proof that A used B's work.

The initial wedge stays two distinct humans, two agent identities on different harnesses, one workspace, and a real engineering task. The agents do not have to run simultaneously. A task can be blocked by a technical fact, access, review, or a decision conflict. If a decision conflict remains unresolved, the correct outcome may be to record the conflict and seek an explicit decision transition rather than execute either rule. Do not force a task to `completed` to make the trace look successful.

## 3. What exists today

| Boundary | Current state relevant to this sprint |
| --- | --- |
| Enrollment | An owner can invite a new human into an existing workspace and that human can enroll their own Codex or OpenCode agent. Invitation authority is distinct from actor credentials. |
| Task | A Task has title, description, status (`open`, `in_progress`, `blocked`, `completed`), optional assignee, and provenance. `update_task` can change status and assignee for a workspace participant; it records a Contribution. There is **no task dependency graph or structured blocker-reason field**. |
| Context | `get_workspace_context` is a bounded orientation with source position, counts, and truncation. Detail, activity, and catch-up reads are available. Orientation is not full history. |
| Decisions | Proposals, acceptance, retirement, replacement, finding citations, and `needsReview` have explicit semantics. An accepted decision is not automatically the operative one. |
| Viewer | The v1.17 My work and Team work perspectives are read-only projections of authorized state. The Viewer is actor-bound and loopback by default; its URL is not a teammate login or share link. |
| Recall/packet | v1.16 Recall and offline handoff are available, but RCL-001/002/003 remain NO-GO / REFRAME. A packet is not canonical state or authority to act. Gate E uses a separate protocol. |

The architecture in `docs/ARCHITECTURE.md` governs this sprint: one explicit workspace boundary; separate human and agent identities; authorization before retrieval; provenance for meaningful changes; no transcript synchronization; interfaces over the application service; no orchestration inferred from task state.

## 4. Scope and sequencing

### 4.1 Baseline before implementation

Record the exact v1.17.0 source, package, Viewer, CLI, MCP, and service behavior used for the first continuation attempt. Do not modify the product before that attempt or call a later run the baseline. Choose an existing ordinary-work workspace and a real task with a dependency; do not seed a scenario into a user's workspace to make the rubric pass. If no eligible team or task is available, record **not observed** and continue only with engineering preparation. A simulated pair is a rehearsal, not the sprint's human result.

The recorder freezes the task and source position before B reads, along with the specific dependency, decision constraints, access boundaries, expected *safe* outcomes, and which facts are available to B in Campfire. The recorder does not give B this key, a prepared summary, private transcript, or the desired answer. The participants may use their ordinary tools; every non-Campfire explanation that changes the outcome is retained as a confound.

First observe where the existing path breaks: enrollment, orientation, ownership, missing recorded fact, finding/decision interpretation, task update, or return. A reported difficulty is evidence about that step, not permission to invent a new workflow model.

### 4.2 Bounded product change after a witnessed gap

Before changing code, append a dated amendment to this contract that names: the observed failure and source position; the smallest behavior needed; exact affected interfaces and authorization operation; whether SQLite and D1 schema changes are required; the expected improvement; a falsifying case; deterministic checks; and the fresh continuation observation needed after repair. Keep the first observation unchanged.

The first preferred repair is guidance, labelling, or a task-centered projection of **already authorized records** in the existing CLI/MCP/Viewer surfaces. Reuse Task, Finding, Decision, Artifact, and Contribution. If the real failure is that a durable relationship cannot be represented truthfully, stop and scope that single relationship explicitly in an amendment, with provenance and parity across SQLite and D1. Do not encode a relationship in an opaque summary and then present it as structured authority.

This contract does **not** pre-authorize a task dependency engine, handoff queue, message inbox, notifications, presence, agent scheduling, approvals, autonomous delegation, new sharing policy, cross-workspace search, or a hosted shared-login UI. A need for any of those is a NO-GO / REFRAME finding for this sprint, followed by a separate product decision.

### 4.3 No feature needed is a valid result

If the baseline succeeds without a material product gap, record a bounded work-continuity observation and close WCO-001 without a v1.18 feature or version bump. Do not manufacture UI or a new API solely to justify the version number. If the attempt cannot be made, the result remains unscored; automated acceptance can establish engineering readiness only.

## 5. Authorization, privacy, and decision safety

- A and B use their own actor credentials. Each agent uses its own agent identity and explicit session registration where required. Never pass A's token, local profile, Viewer URL, or private transcript to B. Test non-participant and wrong-workspace reads before treating a new projection as safe.
- The Viewer remains a read-only, token-free browser over the existing actor-bound proxy unless a separately scoped contract changes that boundary. Hiding a record in My work is not a privacy policy; shared records remain visible to authorized workspace participants.
- Retain the current decision lifecycle. A `needsReview` flag does not retire an accepted decision; two competing accepted decisions do not imply a winner. Only a recorded retirement or accepted replacement supplies that transition.
- Do not claim an artifact target exists, was fetched, or was accessible merely because a stored reference is displayed. An ordinary reference-open attempt is recorded separately for VIS-001 condition 4.
- A packet used naturally during this work remains an offline copy. Declare any Gate E claim P, H, or N under `docs/GATE_E_PROTOCOL.md` before evaluating that case; WCO-001 cannot re-label a continuation as historical-reuse success afterward.
- Never retain raw prompts, private messages, tool arguments, terminal transcripts, actor tokens, invitation secrets, customer data, or inaccessible artifact contents as sprint evidence. Keep only consented, sanitized records sufficient to audit the claimed dependency and action.

## 6. Observation protocol

### 6.1 Eligibility and recorder setup

Use two different people and two different agent harnesses on ordinary work. At least one human did not build the candidate change. The owner may participate, but disclose their role and measurement knowledge. A single operator impersonating two humans, two subagents, fixture actors, or an agent answering on behalf of a human is a rehearsal only.

Record participant consent and how the task arose. A team recruited to test Campfire can validate continuation on real work, but its instructed use is **not** voluntary return. A naturally chosen later-day use is logged separately for Gate B. If the real task or access cannot be inspected without retaining secrets, choose another task or record that the case is unavailable; do not weaken the evidence boundary.

Before B enters, freeze the task ID, workspaces and memberships, current source position, known blocker, source record IDs, expected safety constraints, and what outcome would count as useful work. Give B only normal access to their own Campfire credentials and work tools. B may page, drill down, ask ordinary teammates questions, and use agent tools, but the recorder notes any answer supplied outside Campfire. Do not coach B toward a record or next action.

Capture in order: A's contribution; B's first authorized read and inspected record IDs; B's stated interpretation and action; B's durable contribution and its provenance; A's fresh-process return, inspected records, and dependent action; any unresolved blocker; and later voluntary reuse if it occurs. Preserve timestamps and source positions. Score the original run before discussing answers or shipping a fix. A repair gets a new dated case; never silently rescore the old one.

### 6.2 Frozen rubric

Each item is **PASS**, **FAIL**, or **NOT OBSERVED**. A missing answer or inaccessible evidence is not a PASS. C1–C6 are required for a complete case. C7 is reported separately and never inferred from instructed return.

| Item | PASS requires | Critical? |
| --- | --- | --- |
| **C1 — separate authority** | A, B, and their agents are distinct recorded actors; B reads only through B's membership, and all writes preserve the actual actor and, for an agent, the owning human/session provenance. | **Yes** |
| **C2 — orientation** | Before acting, B identifies the correct goal, task, recorded assignee/status, blocker, and whether needed lists are incomplete; the account names source IDs rather than relying on A's private recap. | Yes |
| **C3 — decision safety** | B accurately describes the decisions relevant to this task, including currentness, proposals, needs-review, or historical status where present. If none is recorded, B says so rather than inventing one. An unresolved conflict is surfaced and neither rule is executed without an explicit transition. | **Yes** |
| **C4 — useful dependency work** | B performs a real, checkable action that resolves the frozen blocker or advances it to a truthful new state. A declaration of completion without work product fails. If resolution is unsafe, a recorded, checkable escalation is the keyed safe outcome. | **Yes** |
| **C5 — durable contribution** | B leaves the relevant Task/Finding/Decision/Artifact state with correct provenance and enough source linkage or explanation for A to inspect without a private transcript or manually prepared handoff. | **Yes** |
| **C6 — reciprocal continuation** | A or Agent A returns in a fresh process, reads B's contribution, and takes a checkable next action that depends on it, or correctly records why the next action remains blocked. Merely opening the workspace fails. | **Yes** |
| **C7 — voluntary return** | On a later day, a participant chooses to use the workspace again for ordinary work without a test prompt. Record the task and source position. | Separate Gate B signal; not required for sprint GO. |

Retain verbatim participant interpretations, work-product references or sanitized excerpts, relevant Campfire reads and writes, recorder interventions, and the scorer's reason for each item. A second reviewer independently checks C1, C3, C4, C5, and C6 against the frozen key and retained source state. Disagreements remain visible and resolve against the pre-run key; do not change the key to rescue a result. If the real task changes independently, describe the change and score only what the evidence still supports.

This rubric establishes a bounded **case**, not causal improvement over v1.17, retention, pricing, or general team-market value. A single successful case does not close Gate B or Gate C by itself; any formal gate verdict needs its own eligible evidence definition and record. C7 is an observation, not a requirement that participants be prompted to return.

## 7. Deterministic engineering checks

If §4.2 authorizes a code change, add focused tests before implementation. At minimum, verify:

| Check | Required property |
| --- | --- |
| **D1 — authorization** | Non-participants and wrong-workspace IDs receive no task, title, participant, count, contribution, or reference leak; service authorization precedes projection. |
| **D2 — identity and provenance** | Reassignment and later changes preserve distinct human/agent actors, agent owner/session attribution, and historical Contributions. |
| **D3 — source fidelity** | Status, assignee, blocker wording, decision lifecycle, citations, IDs, source position, and truncation match the canonical authorized reads. No inferred task relation or operative decision is presented as recorded fact. |
| **D4 — boundary parity** | The relevant local SQLite and hosted Worker/D1 behavior agree. Any schema migration is additive, tested on existing data, and separately justified in the amendment. |
| **D5 — interface safety** | Viewer write allowlist remains closed; browser has no actor token; hostile text and references stay inert; no new external fetch or background polling is introduced by a read-only repair. |
| **D6 — compatibility** | Existing enrollment, CLI/MCP/HTTP, Viewer, correction, Recall, packet, installer, and older workspace behavior remain valid. |

Run focused checks, typecheck, the full relevant test suite, build, packaging, and deployment dry-run for a release-shaped candidate. A test pass establishes the stated property on those inputs; it is not C1–C7 human evidence. If §4.1 already succeeds and no code changes, do not add tests that merely restate current implementation.

## 8. Verdict and release rule

**GO for WCO-001's bounded continuation claim:** one complete ordinary-work case meets C1–C6, all critical safety items pass, the second review agrees or discrepancies are resolved against the frozen key, and any code changed under §4.2 passes D1–D6 plus release checks. State whether Campfire use was instructed. This supports only the observed pair, task, and workspace; it does not by itself close Gate B/C/E or the earlier Viewer observations.

**CONDITIONAL GO — engineering candidate:** a bounded §4.2 repair passes D1–D6, but an eligible post-repair human case is unavailable for a recorded reason. Do not claim the repair made team continuation work. A first case that predates the repair cannot be counted as its post-repair result.

**UNSCORED:** no eligible case has been opened and no implementation has been judged. Lack of participants is not a successful outcome. A complete baseline that works without a gap can close this sprint as a bounded observation under the GO rule, with **no v1.18 release artifact** required.

**NO-GO / REFRAME:** any critical C item fails, a private transcript or operator recap supplies the decisive fact, an unauthorized read succeeds, provenance or decision status is wrong, a dependency cannot be represented without a broader model, or a code repair causes D1–D5 failure. Preserve the failure and choose a narrower repair or a separate sprint. A noncritical C2 failure also prevents GO because C1–C6 are required.

Version bump, tag, public snapshot, installer pins, and production deployment need a **separate release decision**. If the founder later authorizes publication with an open or failed human criterion, record the contract verdict, exact waiver, remaining unmeasured facts, and exact public claim in a release decision. An override permits a bounded release; it never turns a failed case into a PASS or closes Gate B, C, or E.

## 9. Result record and next investment

Create `docs/SPRINT_WCO_001_RESULT.md` when the first eligible attempt begins. Include source commits and versions, scenario eligibility, separate actors/harnesses, frozen task/key and source positions, item-level C1–C7 scores, D1–D6 results if code changed, sanitized work-product references, all manual help, deviations, reviewer disagreements, and one verdict. Keep participant-private evidence out of the public export. Update the roadmap and AGENTS only for behavior actually built or evidence actually recorded.

If the strongest finding is missed or false attention, scope the next **Team attention** question separately and measure missed/false cues. If the finding is historical reuse, follow Gate E. If several teams return and ask for shared hosting, collect Gate B/C and cost evidence before proposing accounts, billing, quotas, or a hosted control plane. Do not assume those later investments from one successful handoff.

## 10. Amendment 1 — October 15, 2026 — cold-teammate availability guidance and evidence-relation vocabulary

**Status of the witness.** The eligible two-human case remains **NOT OBSERVED**
(`docs/evidence/wco-001/BASELINE_V1_17.md` §3). The observed failures below were
witnessed in a **labeled single-operator rehearsal** on shipped v1.17.0
(`docs/evidence/wco-001/REHEARSAL.md`), which is not a C1–C7 case. This
amendment claims only that the repair is bounded and testable; no human
continuation claim is made, and §4.1's first observation is unchanged.

**Observed failure and source position.** On the shipped source (tag `v1.17.0` =
`2b98c752531116654871d285142a55a7441ab665`; workspace
`ws_a74b590d1b2e4c54`), a cold teammate (Agent B, `agt_1c870ea7f26a4188`)
oriented at the frozen cursor recorded in
`docs/evidence/wco-001/served-state/pre-b-agent-b-context.json`:

1. The only actionable work was a `blocked` task assigned to another agent
   (`task_c95fe1ec031e4ecc`). B's orientation showed `needsYou: []`,
   `suggestedNextAction: { kind: "none" }`, and the task only under
   `needsAttention` with reason `team_blocked_task`. `src/service/service.ts`
   documents `needsAttention` as "Team-level items the caller cannot act on
   directly", but the authorization model allows any writing participant to
   take the task up (`task:update`); B did so, and the write was recorded. B
   reported the action "was unambiguous only because the task description
   explicitly delegated the step to whoever performed it" — a hand-written
   sentence, not recorded guidance.
2. `cite_finding_evidence.relation` and `correct_finding.evidence[].relation`
   declare a free-form string in the MCP schema and description; the service
   rejects anything but `supports|contradicts`. B's first citation call failed
   validation.

**Smallest behavior needed (guidance, labels, and schema documentation only —
no new object, relation, read, or selection rule).**

- `src/mcp/instructions.ts` — add one truthful sentence: `needsAttention` is
  attention ordering, not an access boundary, and a blocked/open task assigned
  to another participant is shared work that a participant who can write may
  take up with `update_task`, recorded with their own provenance.
- `src/mcp/tools.ts` — clarify the `get_workspace_context` description
  (`needsYou` = actionable by the caller; `needsAttention` = other team
  records, ordering rather than access) and restrict the two evidence
  `relation` inputs to the closed recorded vocabulary via a shared constant.
- `src/domain/types.ts` / `src/domain/correction.ts` — export
  `FINDING_EVIDENCE_RELATIONS = ["supports", "contradicts"]` and use it in the
  existing validator (no behavior change).
- `src/service/service.ts` — correct the inaccurate `needsAttention` doc
  comment to the real semantics.

`deriveOrientation`, `deriveSuggestedNextAction`, the CLI, the Viewer, and the
attention reason labels are deliberately unchanged: the witnessed need was
truthful guidance at the point of decision, not a new selection rule, and the
stable labels and precedence behavior are pinned by earlier contracts and
tests.

**Exact affected interfaces and authorization operation.** MCP tool
descriptions/input schemas and the MCP session instructions only. The
authorization operation is unchanged: `task:update` at participant level for
roles that can write; the `viewer` role and unregistered agent writes remain
denied. No HTTP method, CLI command, or Viewer read method is added or changed.

**Schema.** No SQLite or D1 schema change; no migration.

**Expected improvement.** A cold teammate can see from the product's own
guidance that a teammate-owned blocked/open task is shared, available work —
without depending on prose someone remembered to write — and can cite evidence
on the first attempt with the accepted vocabulary.

**Falsifying case.** After the repair, a cold participant relying only on
authorized Campfire reads still concludes that a teammate-assigned blocked task
is closed to them; or the guidance implies a write the authorization model
rejects; or any caller using `supports|contradicts` breaks; or the orientation
projection changes for existing workspaces.

**Deterministic checks.** `tests/integration/wco-001.test.ts` D1–D6: D1
authorization truth of the new guidance (writing participant succeeds;
unregistered agent, non-participant, and viewer-role writes still denied); D2
identity and provenance preserved when a teammate updates another's task; D3
source fidelity (closed vocabulary matches the domain validator; orientation
output unchanged); D4 no schema change and worker parity unaffected; D5 Viewer
allowlist and read-only boundary unchanged, no new fetch/poll; D6 compatibility
of enrollment, CLI/MCP, Viewer, correction, Recall, packet, and older
workspaces.

**Fresh continuation observation needed after repair.** A new dated case (the
first eligible two-human attempt per §6, or at minimum a fresh labeled
rehearsal) run after the repair and scored under the frozen rubric. The
original rehearsal (`docs/evidence/wco-001/REHEARSAL.md`) is not rescored and
cannot serve as its own post-repair result.
