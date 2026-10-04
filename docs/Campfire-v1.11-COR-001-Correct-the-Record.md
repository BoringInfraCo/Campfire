# Campfire v1.11 — Correct the Record

**Sprint ID:** COR-001  
**Target release:** v1.11.0  
**Status:** Published as `v1.11.0`. CONDITIONAL GO. See `docs/SPRINT_COR_001_RESULT.md`. The private tag remains the source commit. Production is not deployed.  
**Depends on:** CTX-001 / v1.10.0  
**Theme:** Explicit correction, supersession, evidence, and currentness

---

## 1. Sprint question

> When a team learns that a shared finding is wrong or a decision has changed, can a cold participant see what the team believes now, inspect what changed and why, and avoid acting on the old record?

v1.10 made orientation, catch-up, and drill-down bounded. It did not give findings a lifecycle or connect a decision to the evidence behind it. A wrong finding remains beside a later correction, and an accepted decision can be marked `superseded` without identifying its replacement or reason. A compact response can therefore be complete as a page but misleading as an account of current work.

v1.11 makes correction an explicit, authorized change to workspace state. History stays inspectable. Currentness is stored and projected deterministically; a model does not decide which assertion replaced another.

## 2. Outcome and scope

The smallest useful journey is:

1. A participant records a finding and its artifact evidence. A decision cites that finding and is accepted through the existing approval path.
2. New evidence contradicts the finding. An authorized participant records a replacement finding, identifies the old finding, and explains the correction.
3. The decision owner or another authorized decision actor proposes a replacement decision. Accepting it explicitly supersedes the old accepted decision with a reason.
4. A cold agent or human sees only current findings and accepted decisions in the main orientation, with clear counts of historical items. Catch-up reports both changes. Drill-down exposes the old records, replacement links, evidence, actors, sessions, and reasons.
5. Another participant can explain what changed without a private transcript or a prepared handoff.

This sprint covers Findings and Decisions. Task and Goal lifecycle, Artifact content, and workspace membership keep their existing semantics. The roadmap's later visual release depends on these correction and currentness semantics, but visual redesign is not part of this sprint.

## 3. Existing contracts to preserve

- Workspace remains the authorization boundary; human and agent identities stay distinct. Agent writes require an explicit registered session.
- A Finding currently has `summary`, optional `detail`, `confidence`, and one optional `sourceArtifactId`, with no lifecycle. A Decision has `proposed | accepted | superseded`, but only creation and acceptance are exposed as service mutations.
- Every material mutation appends a Contribution with provenance. Current state is materialized and history remains inspectable.
- `get_workspace_context` has bounded slices with `total`, `returned`, and `truncated`; `get_workspace_changes` pages by append position and freezes a stream tip. `get_workspace` remains the full inspector.
- CLI, MCP, HTTP, SQLite, and Worker/D1 must agree on domain semantics. The read-only Viewer may display derived currentness, but gains no write path.
- The existing webhook vocabulary is closed. Correction events must not be silently mapped to `finding.recorded` or `decision.accepted`; adding outbound event types requires a separately explicit contract.

## 4. Domain contract

### 4.1 Findings: correct, replace, or withdraw

A Finding has a deterministic currentness state: `current`, `superseded`, or `withdrawn`. Existing rows migrate to `current`. A current Finding may be:

- **superseded** by a newly created Finding in the same workspace, with a required correction reason; or
- **withdrawn** with a required reason when there is no defensible replacement.

The replacement gets a new ID and its own author/session provenance. The old summary, detail, evidence, and original provenance are never overwritten. Store a direct old-to-new link and the correction reason on the transition; expose the reverse link on the new Finding. A replacement cannot itself be historical at creation. Correcting a superseded or withdrawn Finding, linking across workspaces, creating a cycle, or declaring two replacements for one old Finding fails explicitly.

The correction operation is atomic: creation of the new Finding, historical transition of the old one, relation, Contribution records, and any applicable internal event/outbox record commit together or not at all. Withdrawal has the same history and provenance requirements. A caller may create an independent Finding without implying that it corrects another.

### 4.2 Decisions: explicit replacement or retirement

Keep `proposed`, `accepted`, and `superseded`. A proposed replacement Decision may identify one accepted Decision in the same workspace. It must have its own summary, rationale, and proposer provenance. Acceptance remains an explicit, authorized action. When that replacement is accepted, the predecessor becomes `superseded` in the same transaction, with a required reason and a direct successor link. The new acceptance retains the existing `approvedBy` and Contribution semantics.

An accepted Decision may also be retired without a replacement through an explicit supersede operation with a required reason. A proposed Decision may be rejected/retired under an explicit transition; it was never an accepted team choice. A superseded Decision cannot be accepted again or superseded twice. The accepted-to-superseded transition is never inferred from text similarity, timestamps, or an agent's assertion.

At most one accepted current successor may replace an accepted Decision. Concurrent attempts resolve to one committed transition; the losing request returns a stable conflict with the current state. Failure leaves neither a partially accepted replacement nor a detached predecessor. Existing accepted Decisions remain accepted after migration until an authorized transition changes them.

Decision acceptance records a team choice in Campfire. It does not authorize external execution or prove that every affected human approved the choice.

### 4.3 Evidence relationships

Preserve `sourceArtifactId` as a backward-compatible primary source on existing Findings. Add only two explicit workspace-scoped relationship types:

- `Finding -> Artifact`: an evidence reference, marked `supports` or `contradicts`, with an optional short note. The Artifact remains a typed reference; its external content is not copied into Campfire.
- `Decision -> Finding`: a cited basis for the choice, with an optional short note. A citation records what the decision relied on at the time; it does not automatically validate or revoke the Decision.

Relations are created or removed by authorized writes with Contribution history. Both endpoints must exist in the same workspace; duplicate and cross-workspace links fail. Reads expose stable IDs, relation type, note, creator, and timestamp. A Finding can have multiple evidence Artifacts. A historical Finding keeps its historical evidence. If a cited Finding is later superseded or withdrawn, the Decision is flagged for review in current projections, while its lifecycle remains unchanged until an explicit decision transition. Evidence availability and truth are not inferred from a URI, confidence score, or citation count.

Do not introduce a general graph, evidence scoring engine, artifact ingestion, or automatic fact checking for this slice.

## 5. Read and currentness contract

Currentness must be visible wherever a Finding or Decision is returned: orientation, list, detail, catch-up payload, CLI human/JSON output, MCP, HTTP, and the read-only Viewer. A historical object exposes its state, transition reason, transition actor/session/time, and replacement ID when present. A current replacement exposes its predecessor ID. The direct chain can be followed one object at a time; no unbounded recursive expansion is required.

`get_workspace_context` prioritizes current Findings and accepted current Decisions. Historical counts are explicit and do not consume the current-item budget. Proposed Decisions keep their existing discoverability. Each slice still reports `total`, `returned`, and `truncated`, with totals defined for the stated filter. A response must not label an assertion current solely because it appeared in a recent change. If a current Decision cites a historical Finding, show a compact `needsReview` marker and the cited IDs; do not silently remove the Decision or synthesize a replacement.

Paged lists accept an explicit currentness/status filter and keep stable cursor behavior. Get-by-ID and full inspection can retrieve historical objects under the same workspace authorization. Catch-up emits each correction, withdrawal, acceptance, and supersession as distinct, provenance-backed changes in append order. It preserves v1.10's frozen-tip guarantee, so a correction occurring during a run appears in the next run rather than being skipped. The activity journal and Viewer may show a compact reason and linked IDs, without exposing private transcripts or secret-bearing Artifact content.

All new reads authorize the requesting actor before fetching or projecting target objects. An inaccessible workspace's IDs, evidence notes, reasons, and relationship existence must not leak through errors or counts.

## 6. Interface and persistence boundary

Expose narrow named operations for finding correction/withdrawal, decision replacement/retirement, and evidence citation management. Use the application service for authorization, lifecycle validation, and provenance; CLI, MCP, HTTP, and Worker routes adapt to that service. Human CLI help and agent tool descriptions must distinguish recording a correction from editing an old assertion.

Add deterministic, reversible schema migrations for SQLite and D1. Use explicit columns/constraints or narrow relation tables rather than hiding lifecycle state in arbitrary JSON. Backfill old Findings as current and preserve all existing IDs, Decisions, Contributions, and append positions. Enforce the one-successor invariant at the store level as well as in the service, including concurrent Worker/D1 claims. New writes must keep state, relationships, Contributions, and any new internal outbox rows transactionally aligned. Existing profiles, enrollment, Viewer reads, and webhook delivery remain compatible.

## 7. Acceptance scenarios

### Deterministic checks

- Correct a current Finding with a new evidence-backed Finding. Orientation shows the replacement; old detail shows the reason, actor/session, evidence, and successor; the replacement points back. A withdrawal without a replacement is equally clear.
- Propose and accept a replacement Decision. Before acceptance, the old accepted Decision remains current. After acceptance, exactly one current accepted Decision remains in that chain, and both sides expose the reason/link and approval provenance.
- A Decision citing a subsequently superseded or withdrawn Finding remains accepted but is marked `needsReview`. Explicitly superseding it clears that stale-basis condition from the current projection; historical citations remain visible.
- Existing rows migrate without invented correction actors/reasons. Current and historical filters, totals, pagination, catch-up cursors, and full inspection agree in SQLite and D1.
- An unauthorized actor, absent agent session, invalid endpoint type, cross-workspace relation, repeated transition, cycle, duplicate successor, and racing replacement are rejected without partial state or information leakage.
- Injected transaction failure leaves no replacement, lifecycle transition, relationship, Contribution, or outbox fragment. Existing v1.10 orientation/catch-up and closed webhook behavior still pass.

### Product trace

Use a realistic workspace with enough Findings, Decisions, Artifacts, and Contributions to truncate orientation. One participant records an evidence-backed assertion and accepted choice; another participant corrects the assertion and updates or retires the choice. A cold Codex or OpenCode process receives a natural request to continue the work. From Campfire alone it identifies the current position, the old position, the new evidence, the reason for the change, and one next action that avoids repeating the obsolete work. A returning process catches up from a saved pre-correction cursor and reaches the same account through the paged change stream. Verify an unrelated workspace remains invisible.

Record exact runtime, versions, operation order, truncation/cursor behavior, actor/session/provenance links, and whether an independent human and second harness actually participated. A one-operator fixture or single-machine run is useful engineering evidence, not Gate B or Gate C evidence.

## 8. Non-goals

- Automatic extraction or correction from transcripts, LLM summaries as truth, semantic search, embeddings, cross-workspace memory, or organization-wide evidence graphs.
- Verification state, confidence scoring, external artifact validation, or automatic decision invalidation.
- Visual orientation redesign, previews, highlights, generated views, or a writable Viewer; those remain in the later roadmap sequence.
- Playbooks, workflow execution, external action authority, orchestration, or new harnesses.
- General mutation versioning or a broad concurrency framework beyond the transitions in this sprint.
- Expansion of public webhook vocabulary or per-command telemetry.

## 9. Implementation and validation

1. Freeze lifecycle, relation, currentness, and output schemas against the current code; write failing domain, authorization, concurrency, migration, and retrieval tests.
2. Implement shared domain/application semantics and SQLite/D1 persistence with atomic transitions and backfill.
3. Add CLI, MCP, HTTP, and Worker adapters and safe human/agent guidance.
4. Update orientation, drill-down, catch-up, activity, and read-only Viewer projections; preserve bounded query behavior.
5. Run focused suites, then `npm run typecheck`, `npm test`, `npm run build`, and `npm run pack:tarball`. Test a clean upgraded store and a clean new store in both persistence paths.
6. Run the product trace, inspect the complete diff, and write `docs/SPRINT_COR_001_RESULT.md` with actual versus synthetic evidence, contract deviations, failures, migration results, gate status, and verdict.

Update Architecture, README/operator/help, Roadmap status, and `AGENTS.md` only where the implemented behavior changes them. A proposed sprint doc alone does not mark v1.11 implemented or authorize release promotion/deployment.

## 10. GO / CONDITIONAL GO / NO-GO

**GO:** Correcting or withdrawing a Finding and explicitly replacing or retiring a Decision work through the packaged product. Current projections, history, evidence links, and catch-up tell the same story. Authorization, session/provenance, atomicity, concurrency, migration, bounded retrieval, and SQLite/D1 parity pass. A cold participant can use the corrected record to avoid an obsolete next step. State the trace's human/harness limits precisely.

**CONDITIONAL GO:** The deterministic, security, persistence, and compatibility checks pass, but a real second participant, second harness, or shared-instance trace is unavailable for a recorded external reason. Mark that evidence incomplete and do not claim team value, repeat use, or a fully proven release journey.

**NO-GO / REFRAME:** Old assertions are overwritten or remain unlabeled in current orientation; a Decision changes without explicit authority; a failed/racing transition leaves partial state; historical reasons, evidence, or provenance disappear; catch-up skips a correction; cross-workspace evidence leaks; or an agent needs the originating private transcript to identify the corrected position. Security and atomicity failures require repair before GO.

Gate B (repeat usage) and Gate C (multi-participant value) remain separate measurements. Passing this sprint's functional trace does not establish either gate by itself.
