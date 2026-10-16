# Campfire v1.19 — ATT-001: Trustworthy Team Attention

**Status:** Proposed sprint contract; no implementation, observation, verdict, or release decision recorded.  
**Date:** October 15, 2026  
**Target release:** v1.19.0, subject to this contract and a separate release decision.  
**Baseline:** Published v1.18.0 (`docs/RELEASE_V1_18_DECISION.md`).  
**Result record:** `docs/SPRINT_ATT_001_RESULT.md` when work begins.

## 1. Sprint question

> Can a workspace participant see which **recorded** work calls for their attention or the team's attention, and tell when that view is incomplete, without Campfire implying an owner, permission, urgency, or decision transition that the records do not establish?

The roadmap's next question after work continuity is **team attention**. v1.17 made My work and Team work visible; v1.18 clarified that `needsAttention` is an ordering cue, not an access boundary. Neither release established that the attention lists are complete or that people interpret them correctly. WCO-001's eligible two-human case is still NOT OBSERVED. ATT-001 addresses a narrower source-fidelity problem in the existing workspace view; it does not count as WCO-001 human continuation, Gate B/C/E/F evidence, or resolution of the older Viewer observations.

## 2. Baseline and code-level gaps

Before implementation, pin the v1.18.0 source, package, service response, Viewer static files, and test fixture used for comparison. Retain a sanitized response and screenshot or text capture for each baseline case below. The current code provides these reasons to inspect, not a claim that a human has encountered each one:

1. `get_workspace_context` derives `needsYou`, `needsAttention`, and `suggestedNextAction` from the **returned task and decision pages**. Those pages may be truncated. The lists can therefore be empty even while an omitted task or decision would qualify under the same rules. The Viewer currently renders “You're all caught up” and “Nothing needs attention” for empty lists without qualifying their coverage.
2. Accepted decisions with `needsReview` are shown in decision surfaces but are absent from the attention lists. A citation to a non-current finding can therefore be visible elsewhere without a team review cue. `needsReview` does not revoke acceptance or pick an operative decision.
3. A task assigned to another participant may appear under team attention even when the caller can update it. The cue's grouping describes recorded assignment and orientation, not authorization. No structured reviewer assignment, ownership-conflict object, urgency score, or live agent presence exists.
4. October 15 self-build dogfooding shows a different empty-state case: the authorized `campfire-self-build` context returned all 3 tasks and its 1 decision, including one **unassigned open** WCO-001 human-case task, while both `needsYou` and `needsAttention` were empty. This is complete coverage under the current selection rules, not truncation or proof that no work remains. The owner's terminal screenshots show the open task and empty attention lists together. They are a product observation, not a scored ATT-001 human trace or evidence of a two-human WCO-001 case.

Record whether the baseline actually reproduces each expected gap. If one does not reproduce, amend this contract before building a fix for it; preserve the original observation.

## 3. Product slice

### 3.1 Attention coverage

Make the coverage of both attention lists explicit using the existing authorized task and decision slice metadata. State which source pages were inspected, their returned and total counts, and whether either page was truncated. A list is **complete under its stated selection rules** only when both source pages are complete. A complete empty list means “No recorded attention cues match these rules”; it does not mean all work is done. An incomplete empty list must say that no cue was found **in the returned records** and that more matching records may exist. Apply the qualification to nonempty lists too; a visible cue does not prove the list exhaustive.

The service remains the source of attention-item selection. The Viewer may render coverage from the service's `slices.tasks` and `slices.decisions`; it must not duplicate authorization or silently search beyond the returned pages. If a shared `attentionCoverage` field proves necessary for CLI/MCP parity, derive it from those same slice values in the service, preserve sync/async parity, and record the additive response change. No extra query or unbounded scan is authorized by this contract.

### 3.2 Review cue

Add a **team-level review cue** for an accepted decision whose existing `needsReview` flag is true in the returned decision page. The cue must carry the decision ID, accepted status, a distinct reason such as `accepted_decision_needs_review`, and the cited non-current finding IDs already available on that decision. It belongs in `needsAttention`, never `needsYou`, because Campfire has no recorded reviewer assignment. It must say that the accepted decision cites non-current evidence and needs human review; it must not say the decision is withdrawn, superseded, invalid, or replaced unless a separate recorded transition says so.

Keep the cue tied to the current decorated decision and its recorded citations. Do not surface a superseded decision as a live review cue. If the decision page omits a qualifying decision, coverage must disclose the possible omission; do not manufacture a cue from a count. Do not elevate this cue to an executable `suggestedNextAction` without a separate observed need and contract amendment.

### 3.3 Ownership and permissions

Preserve the current split between work assigned to the caller and work that needs team attention. Label the reason in plain language on the human surface, and keep the source ID available for drill-down. Explain that recorded assignment is not a permission grant or denial. The actual write operation remains subject to the existing service authorization check and provenance. No inferred “ownership conflict” cue is in scope: a conflict must first have a truthful recorded representation and an observed use case.

### 3.4 Surfaces and exclusions

The target is the existing `get_workspace_context` service projection and the read-only Viewer My work / Team work attention areas. Keep CLI JSON and MCP consumers compatible; if their human-readable guidance displays attention, align it with the same coverage and reason semantics. Do not add a new Viewer read method, browser token, write control, polling loop, notification, inbox, controlled request, agent dispatch, presence indicator, priority score, cross-workspace aggregate, schema migration, or hosted shared-login UI. Artifact references remain inert. Private prompts and agent transcripts remain outside the workspace.

If a baseline case shows the needed fact is not representable through current Task/Decision records, record a NO-GO / REFRAME finding instead of encoding an invented fact in an attention label.

## 4. Frozen evaluation before implementation

Freeze the fixture, answer key, baseline captures, and scoring form under `fixtures/attention/att-001/` and `docs/evidence/att-001/` before changing product behavior. Use one workspace with two human participants and two owned agents, plus a separate unauthorized workspace. The case set must include:

| Case | Keyed fact |
| --- | --- |
| Assigned blocked and open tasks | The caller's recorded assignee matches exactly; status and source IDs are preserved. |
| Other-assigned and unassigned blocked tasks | Team attention shows recorded assignment without implying the caller lacks write permission. |
| Accepted decision citing a superseded or withdrawn finding | It stays accepted, has `needsReview`, and gains a team review cue citing the non-current finding IDs. |
| Accepted decision with current citations | No review cue is invented. |
| Superseded decision and competing accepted decisions | Historical status stays historical; no operative winner is inferred. |
| Truncated task page, truncated decision page, and both | A cue beyond the returned page may be absent, but the view cannot claim exhaustive attention. |
| Complete empty pages and incomplete empty returned pages | Their empty messages are visibly different and accurately qualified. |
| Complete page with an unassigned open task but no matching attention cue | The task remains visible in Current Work; empty attention means only that no item matches the current cue rules, not that the team is finished. Do not label every unassigned open task urgent without a recorded basis. |
| Unauthorized or wrong-workspace read | No record, count, participant, review ID, or attention metadata leaks. |

Record both the full authorized source set and the exact returned page for each actor. Score **missed cue** only when a record in the returned page meets a frozen attention rule but no corresponding cue appears. An eligible record outside the returned page is a **coverage limitation**, and becomes a false “all clear” only if the surface implies completeness. Score **false cue** when an item does not meet the rule, misstates lifecycle/citation/assignee, or claims a specific owner or permission without a recorded basis. This distinction keeps a bounded page from being judged as full history while still catching misleading empty states.

Do not change the key or thresholds after seeing candidate results. Any change to scenario, rule, or scoring is dated, explained, and applied only to a fresh run. Keep baseline and candidate source commits, page budgets, actor identities, and sanitized captures together.

## 5. Deterministic acceptance matrix

All checks are required for an engineering candidate. Add focused tests for behavior that changes; avoid tests that merely mirror static labels.

| Check | Required result |
| --- | --- |
| **D1 — coverage truth** | Complete and truncated task/decision combinations produce correct coverage and empty/nonempty wording; no truncated page gets an unqualified “all clear.” |
| **D2 — review source fidelity** | Exactly the returned accepted `needsReview` decisions receive team review cues with correct IDs and non-current citations; current and historical counterexamples do not. |
| **D3 — authority separation** | Assignment, `needsYou`, and `needsAttention` do not change `canAct`; an unauthorized actor sees no cue or count; writes still carry the real actor's provenance. |
| **D4 — decision safety** | Acceptance, needs-review, proposal, supersession, and recorded replacement remain distinct; no cue or ordering chooses an operative decision. |
| **D5 — surface parity and accessibility** | Service sync/async paths, CLI JSON/MCP response, and Viewer agree on source IDs, reasons, and coverage. The Viewer expresses state in text and accessible labels, including without color. |
| **D6 — boundedness and compatibility** | Existing page budgets/cursors, five Viewer read methods, Viewer security boundary, older response fields, and SQLite/D1 behavior remain valid; no unbounded read, fetch, or background polling appears. |

Before a release-shaped candidate, run focused tests, typecheck, the full relevant suite, build, packaging, and deployment dry-run. Record failures and known flakes. Passing D1–D6 is evidence of implementation behavior, not human understanding or ordinary team value.

## 6. Human observation rubric

Run a controlled comprehension trace with two **different people**, at least one of whom did not build the candidate. Each uses their own actor-bound Viewer against the frozen workspace, starting from the same permitted participant packet. Counterbalance which person starts in My work or Team work. No CLI/MCP, source code, private key, or answer key is given to participants. Give each up to 15 minutes; do not coach, reveal IDs, or re-ask a failed item. Preserve verbatim answers and the read path in sanitized form. Score before discussion.

Each item is **PASS**, **FAIL**, or **NOT OBSERVED**; missing evidence is not a pass:

| Item | PASS requires |
| --- | --- |
| **H1 — my versus team** | Participant distinguishes their recorded tasks from another person's and unassigned tasks, without treating group placement as an access rule. |
| **H2 — real blocker** | Participant names one assigned or team blocked task, its source ID, recorded assignee/status, and a safe next investigation step. |
| **H3 — review without revocation** | Participant finds the accepted decision needing review, identifies the non-current citation, and states that acceptance remains recorded until an explicit transition. |
| **H4 — coverage** | Participant recognizes that a truncated attention source page may hide additional cues and does not interpret an incomplete empty list as team completion. |
| **H5 — decision boundary** | Participant does not select an operative winner from two accepted decisions or promote a superseded rule. |
| **H6 — no invented owner/action** | Participant does not infer an assigned reviewer, live agent, notification, or permission from the attention cue. |

Both people must pass H1–H6 for a bounded comprehension GO. A failure of H3, H4, or H5 is a safety failure: repair the defect and run a **fresh** trace before claiming GO. A fixture-only subagent rehearsal may help debug but cannot substitute for a human answer. Report each participant's path and score; do not average away a failure. The trace shows whether these two people understood this frozen case, not retention, causal improvement over v1.18, or generalized team demand.

Separately, collect ordinary-work attention events when they arise: which cue was seen, whether a person took a dependent action, what relevant work was missed, whether a cue proved false, and what they would have done without it. State when use was prompted. This is follow-up evidence, not a manufactured completion criterion or a way to close Gate B/C/F by assertion.

## 7. Verdict and release boundary

- **GO — bounded attention comprehension:** D1–D6 pass, both human traces pass H1–H6, and no authorization or decision-safety defect remains. Claim only that these participants correctly read the frozen attention case.
- **CONDITIONAL GO — engineering candidate:** D1–D6 pass, no known safety failure remains, and the eligible human trace is unavailable for a recorded reason. Do not claim people understood the cues or that team attention improved ordinary work.
- **UNSCORED:** the fixture or candidate has not been evaluated; a document or implementation alone is not a verdict.
- **NO-GO / REFRAME:** an authorization leak, false complete state, decision-status error, H3/H4/H5 failure, or an unrepresentable required fact blocks the proposed claim. Preserve the failure and fix or rescope before a fresh evaluation.

A version bump, tag, public snapshot, installer pins, and deployment require a **separate release decision** after the result is recorded. If the founder authorizes a bounded release with an open or failed observation, record the exact waiver, remaining unmeasured facts, and public claim. An override does not turn a FAIL into a PASS or close Gate B, C, E, or F; WCO-001 and SWH-001 retain their own open observations. Notifications, controlled requests, and agent coordination require a later contract and Gate F evidence.

## 8. Deliverables

1. Frozen v1.18 baseline, fixture, key, scoring form, and sanitized captures.
2. The smallest service and Viewer change satisfying §3, with focused D1–D6 tests and compatibility checks.
3. `docs/SPRINT_ATT_001_RESULT.md` with exact source commit, deterministic scores, human scores or NOT OBSERVED reason, deviations, verdict, and residual risks.
4. A separate release decision if v1.19.0 is to be published.
