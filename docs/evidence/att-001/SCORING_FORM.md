# ATT-001 item-level scoring form (H1–H6) and deterministic matrix (D1–D6)

**FIXTURE EVIDENCE — cannot establish Gate B, C, E, or F; no human trace has been run.**

One sheet per participant. Score against `SCENARIO_KEY.md` **before** discussing answers with the participant; keep this form and the key out of the participant packet. Each item is **PASS**, **FAIL**, or **NOT OBSERVED**; missing evidence is not a pass. A hint that supplies an answer fails that item. A timeout, a refusal, or no answer is **NOT OBSERVED**, not a pass. Never edit the key or thresholds to fit candidate results (contract §4).

## Pass rule (frozen — contract §6, verbatim)

> Both people must pass H1–H6 for a bounded comprehension GO. A failure of H3, H4, or H5 is a safety failure: repair the defect and run a **fresh** trace before claiming GO. Report each participant's path and score; do not average away a failure.

Also frozen: the trace shows whether these two people understood this frozen case — not retention, not causal improvement over v1.18, not generalized team demand. Do not claim more. Report P1 and P2 separately.

## Rubric items (fixed by contract §6; not editable here)

| Item | PASS requires |
| --- | --- |
| **H1 — my versus team** | Participant distinguishes their recorded tasks from another person's and unassigned tasks, without treating group placement as an access rule. |
| **H2 — real blocker** | Participant names one assigned or team blocked task, its source ID, recorded assignee/status, and a safe next investigation step. |
| **H3 — review without revocation** (safety) | Participant finds the accepted decision needing review, identifies the non-current citation, and states that acceptance remains recorded until an explicit transition. |
| **H4 — coverage** (safety) | Participant recognizes that a truncated attention source page may hide additional cues and does not interpret an incomplete empty list as team completion. |
| **H5 — decision boundary** (safety) | Participant does not select an operative winner from two accepted decisions or promote a superseded rule. |
| **H6 — no invented owner/action** | Participant does not infer an assigned reviewer, live agent, notification, or permission from the attention cue. |

## Sheet — Participant P1

| Field | Value |
| --- | --- |
| Participant code | P1 |
| Actor identity | `hum_att001_ana` (Ana) — P1's own actor-bound Viewer identity |
| Candidate commit | *fill — candidate commit under test* |
| Fixture label | `att-001 fixture v2` (scenario repair in `baseline/SCENARIO_REPAIR.md`) |
| Visible source position | *fill — `orientationCursor` + `generatedAt` recorded from the served context before either participant read (runbook §4)* |
| Perspective opened first | My work (counterbalanced) |
| Browser / viewport | *fill* |
| Start / end time (UTC) | *fill* / *fill* |
| Scenario | *fill — frozen workspace; expected facts live only in `SCENARIO_KEY.md`* |

| Item | Verbatim answer (retained) | Expected fact (scorer fills from `SCENARIO_KEY.md`) | PASS / FAIL / NOT OBSERVED | Reason | Reviewer | Second reviewer (H3/H4/H5 or any ambiguous pass) |
| --- | --- | --- | --- | --- | --- | --- |
| **H1 — my versus team** | | | | | | n/a |
| **H2 — real blocker** | | | | | | n/a |
| **H3 — review without revocation** (safety) | | | | | | |
| **H4 — coverage** (safety) | | | | | | |
| **H5 — decision boundary** (safety) | | | | | | |
| **H6 — no invented owner/action** | | | | | | n/a |

Expected-fact cells are intentionally blank in the frozen form; the scorer transcribes them from the frozen key before scoring. No key fact appears in this document.

### Second review — P1 (H3, H4, H5, and any ambiguous pass)

| Item | First reviewer verdict | Second reviewer verdict | Agreement? Disagreement resolved against `SCENARIO_KEY.md` (both readings retained) | Second reviewer signature | Notes |
| --- | --- | --- | --- | --- | --- |
| H3 | | | | | |
| H4 | | | | | |
| H5 | | | | | |
| *ambiguous pass (item: ___)* | | | | | |

### Session notes — P1

| Field | Value |
| --- | --- |
| Hints given (and to which item) | *fill; a hint that supplies an answer fails that item* |
| Anything supplied outside Campfire (confound) | *fill / none* |
| Errors / blocked interactions | *fill* |
| Deviations from protocol or perspective order | *fill* |
| Participant result | *PASS only if all six items PASS; otherwise FAIL with the failing items listed; NOT OBSERVED where an item has no retained evidence* |

## Sheet — Participant P2

| Field | Value |
| --- | --- |
| Participant code | P2 |
| Actor identity | `hum_att001_ben` (Ben) — the other human; must be a distinct person, and at least one participant did not build the candidate |
| Candidate commit | *fill — candidate commit under test* |
| Fixture label | `att-001 fixture v2` (scenario repair in `baseline/SCENARIO_REPAIR.md`) |
| Visible source position | *fill — same recorded source position as P1; if it differs, stop (runbook §4)* |
| Perspective opened first | **Team work** (counterbalanced) |
| Browser / viewport | *fill* |
| Start / end time (UTC) | *fill* / *fill* |
| Scenario | *fill — the same frozen workspace as P1* |

| Item | Verbatim answer (retained) | Expected fact (scorer fills from `SCENARIO_KEY.md`) | PASS / FAIL / NOT OBSERVED | Reason | Reviewer | Second reviewer (H3/H4/H5 or any ambiguous pass) |
| --- | --- | --- | --- | --- | --- | --- |
| **H1 — my versus team** | | | | | | n/a |
| **H2 — real blocker** | | | | | | n/a |
| **H3 — review without revocation** (safety) | | | | | | |
| **H4 — coverage** (safety) | | | | | | |
| **H5 — decision boundary** (safety) | | | | | | |
| **H6 — no invented owner/action** | | | | | | n/a |

### Second review — P2 (H3, H4, H5, and any ambiguous pass)

| Item | First reviewer verdict | Second reviewer verdict | Agreement? Disagreement resolved against `SCENARIO_KEY.md` (both readings retained) | Second reviewer signature | Notes |
| --- | --- | --- | --- | --- | --- |
| H3 | | | | | |
| H4 | | | | | |
| H5 | | | | | |
| *ambiguous pass (item: ___)* | | | | | |

### Session notes — P2

| Field | Value |
| --- | --- |
| Hints given (and to which item) | *fill; a hint that supplies an answer fails that item* |
| Anything supplied outside Campfire (confound) | *fill / none* |
| Errors / blocked interactions | *fill* |
| Deviations from protocol or perspective order | *fill* |
| Participant result | *PASS only if all six items PASS; otherwise FAIL with the failing items listed; NOT OBSERVED where an item has no retained evidence* |

Both participants use **their own** actor-bound loopback Viewer (see `TRACE_RUNBOOK.md`), never one shared listener and never a teammate's token.

## Deterministic acceptance matrix (D1–D6)

Mandatory regardless of human scores. Run against the candidate commit at the recorded source position. Focused suite: `tests/integration/att-001.test.ts`; before a release-shaped candidate also run typecheck, the full relevant suite, build, packaging, and deployment dry-run (contract §5). A test pass is implementation evidence, not a human comprehension result.

Missed/false-cue scoring (contract §4): score **missed cue** only when a record in the returned page meets a frozen attention rule but no cue appears; an eligible record outside the returned page is a **coverage limitation** and only becomes a false "all clear" if the surface implies completeness. Score **false cue** when an item does not meet the rule, misstates lifecycle/citation/assignee, or claims a specific owner or permission without a recorded basis.

| Check | Required result (contract §5) | Result (PASS/FAIL) | Evidence pointer (test / capture) |
| --- | --- | --- | --- |
| **D1 — coverage truth** | Complete and truncated task/decision combinations produce correct coverage and empty/nonempty wording; no truncated page gets an unqualified “all clear.” | | |
| **D2 — review source fidelity** | Exactly the returned accepted `needsReview` decisions receive team review cues with correct IDs and non-current citations; current and historical counterexamples do not. | | |
| **D3 — authority separation** | Assignment, `needsYou`, and `needsAttention` do not change `canAct`; an unauthorized actor sees no cue or count; writes still carry the real actor's provenance. | | |
| **D4 — decision safety** | Acceptance, needs-review, proposal, supersession, and recorded replacement remain distinct; no cue or ordering chooses an operative decision. | | |
| **D5 — surface parity and accessibility** | Service sync/async paths, CLI JSON/MCP response, and Viewer agree on source IDs, reasons, and coverage. The Viewer expresses state in text and accessible labels, including without color. | | |
| **D6 — boundedness and compatibility** | Existing page budgets/cursors, five Viewer read methods, Viewer security boundary, older response fields, and SQLite/D1 behavior remain valid; no unbounded read, fetch, or background polling appears. | | |

## Verdict cover sheet

Contract §7 rules: **GO — bounded attention comprehension** requires D1–D6 pass, both human traces pass H1–H6, and no authorization or decision-safety defect remains; claim only that these participants correctly read the frozen attention case. **CONDITIONAL GO — engineering candidate** requires D1–D6 pass, no known safety failure remaining, and the eligible human trace unavailable for a **recorded reason**; do not claim people understood the cues or that team attention improved ordinary work. **UNSCORED** when the fixture or candidate has not been evaluated. **NO-GO / REFRAME** for an authorization leak, a false complete state, a decision-status error, an H3/H4/H5 failure, or an unrepresentable required fact.

| Field | Value |
| --- | --- |
| Candidate commit | |
| Fixture label | |
| Frozen source position (`orientationCursor`) | |
| P1 result (with failing items) | |
| P2 result (with failing items) | |
| D1–D6 result | |
| Contract verdict (GO / CONDITIONAL GO — engineering candidate / UNSCORED / NO-GO — REFRAME) | |
| Recorded reason if the human trace was unavailable (CONDITIONAL GO only) | |
| Deviations from protocol; key or threshold changes (dated; a repair requires a fresh trace) | |
| Residual risks and open observations (WCO-001 human case still NOT OBSERVED; SWH-001 observations; Gate B/C/E/F; VIS-001 condition 4) | |

**Release boundary:** a version bump, tag, public snapshot, installer pins, or deployment require a separate release decision after this result is recorded. An override does not turn a FAIL into a PASS and does not close Gate B, C, E, or F.
