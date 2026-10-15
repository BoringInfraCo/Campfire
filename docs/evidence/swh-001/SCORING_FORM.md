# SWH-001 item-level scoring form

One sheet per participant. Score against `SCENARIO_KEY.md` **before** discussing
answers with the participant. Keep this form and the key out of the participant
packet. A claim that cannot be checked against the frozen key and the retained
served state is FAIL. A hint that supplies an answer fails that item. A timeout
or no answer is a fail, not N/A.

**Participant pass rule (frozen):** H2, H4, H6, and H7 must all PASS **and** at
least 6 of 7 items PASS. A missing or invalid critical item is not a pass. Do not
average away a critical failure. Report each participant separately.

### Recorder note — H4 historical record

The superseded decision required by H4 is **not** returned by the orientation
read; it is reachable only through the workstream/detail drill-down. Do not
point to it, name it, or open it for the participant. If the participant does
not reach it, the keyed fact is not met and **H4 scores FAIL**; record the miss
as an observed usability result. A hint that supplies an answer fails that item;
never coach, correct, or re-ask after a hint.

## Sheet — Participant 1

| Field | Value |
| --- | --- |
| Participant code | P1 |
| Actor identity | *fill: e.g. Dana (`hum_swh001_dana`) or Rowan (`hum_swh001_rowan`)* |
| Candidate commit | *fill: v1.17 candidate commit under test* |
| Visible source position | *fill: `orientationCursor` + `generatedAt` from the Viewer / served dumps* |
| Perspective opened first | My work (counterbalanced) |
| Browser / viewport | *fill* |
| Start time / end time (UTC) | *fill* / *fill* |
| Scenario | `swh-billing-deploy`, frozen in `SCENARIO_KEY.md` (fixture evidence) |

| Item | Verbatim response (retained) | Expected facts / IDs (from key) | PASS/FAIL | Reason | Reviewer |
| --- | --- | --- | --- | --- | --- |
| H1 current work | | Goal "Make billing-service deploys rollback-safe before Friday's release."; open `task_swh001_rollback_job`, `task_swh001_review_drill`, `task_swh001_health_checks`, `task_swh001_release_checklist`; in progress `task_swh001_reproduce_failure`; blocked `task_swh001_staging_check`, `task_swh001_escalation_owner`; completed `task_swh001_staging_env` not called active | | | |
| **H2 ownership (critical)** | | Dana: `staging_check`, `reproduce_failure`, `staging_env`; Codex: `rollback_job`; Rowan: `review_drill`; OpenCode: `health_checks`; no owner: `escalation_owner`, `release_checklist`; creation ≠ assignment | | | |
| H3 attention | | needsYou: p1 `dec_swh001_friday_windows` for both; Dana + `assigned_blocked_task` `staging_check`; Rowan + `assigned_open_task` `review_drill`. needsAttention: `unassigned_blocked_task` `escalation_owner` for both; Rowan also `team_blocked_task` `staging_check`. No live-agent-state inference | | | |
| **H4 decision safety (critical)** | | Accepted d1 `dec_swh001_blue_green` (`needsReview`, cites non-current f1 `find_swh001_draining_window`), d2 `dec_swh001_canary` (clean), d4 `dec_swh001_automated_rollback` (predecessor d3); proposed p1 `dec_swh001_friday_windows`; historical d3 `dec_swh001_manual_rollback` superseded by d4 with reason; d1/d2 unresolved conflict, no single operative decision, do not execute either rule | | | |
| H5 source trail | | e.g. f2 `find_swh001_drain_clean` evidence `fev_swh001_0040` → a2 `art_swh001_drill_report` `supports`; reference `https://internal.example/billing/reports/rollback-drill-17`; or d1 basis f1 non-current / a1 `art_swh001_trace_284`; f3 explicit absence; does not claim fetch/verify/accessibility | | | |
| **H6 completeness (critical)** | | Complete: tasks 8/8, findings 2/2, decisions 4/4, blockers 2/2. Truncated: artifacts 10/12 (`truncated: true`); secondary recentChanges 20/51, provenance 20/51. Empty complete section: Rowan has no blocked task, so "none" is honest. Missing item → existing drill-down | | | |
| **H7 next step (critical)** | | §7 frozen step: seek explicit retirement or accepted replacement naming predecessor + reason before executing d1/d2; cite d1 `needsReview` + non-current f1; p1 is a hint/proposal, not a task or permission | | | |

### Critical-item second review (H2, H4, H6, H7)

| Item | First reviewer verdict | Second reviewer verdict | Disagreement resolved against key (both readings retained)? | Second reviewer | Notes |
| --- | --- | --- | --- | --- | --- |
| H2 | | | | | |
| H4 | | | | | |
| H6 | | | | | |
| H7 | | | | | |

### Session notes

| Field | Value |
| --- | --- |
| Hints given (and to which item) | *fill; a hint that supplies an answer fails that item* |
| Reference-open attempt during the task (VIS-001 condition 4 candidate) | *none / describe: type, why sought, reached with own authority, content needed (record separately in `REFERENCE_OBSERVATION.md`; the Viewer task itself must not fetch)* |
| Errors / blocked interactions | *fill* |
| Deviations from protocol | *fill* |
| Result | *PASS / FAIL per rule above; list failing items* |

## Sheet — Participant 2

Copy the Participant 1 sheet with:

| Field | Value |
| --- | --- |
| Participant code | P2 |
| Actor identity | *the other human participant — must be a distinct person; at least one participant did not build the page* |
| Perspective opened first | **Team work** (counterbalanced) |
| Other fields | same structure as Participant 1 |

Both participants use **their own** actor-bound loopback Viewer (see
`TRACE_RUNBOOK.md`), never one shared listener and never a teammate's token.

## Deterministic acceptance matrix (D1–D7)

Mandatory regardless of human scores. Run against the candidate commit and the
same source position; "result" is PASS/FAIL with the observed evidence, and a
test pass is implementation evidence, not a human comprehension result.

| Check | Required observation (contract §7) | Result | Evidence pointer |
| --- | --- | --- | --- |
| D1 — authorization | Workspace list contains only workspaces authorized for the actor; home reads only the selected authorized workspace; non-participant, unknown workspace, forged selection, wrong-workspace object ID reveal no title, participant, count, reference, or activity; filtering after retrieval is not accepted | | |
| D2 — identity | Two actor-bound Viewer instances show different `My work` / `Needs You` where the service says they differ; both show the same shared facts; owned, unowned, and unknown agents remain distinct (this scenario covers owned only; unowned/unknown via tests) | | |
| D3 — source parity | Every displayed status, reason, ID, count, provenance field, and decision label matches the authorized service read at one recorded source position; truncated lists remain incomplete in both perspectives | | |
| D4 — read boundary | `VIEWER_READ_METHODS` remains the same five methods; no write accepted; no browser token; no new schema row, Contribution, webhook, or telemetry event from viewing | | |
| D5 — hostile text and reference | Markup in task/participant/finding/decision/artifact renders inert; unsafe/missing target not fetched or auto-opened; Host/loopback restrictions pass | | |
| D6 — accessibility and compatibility | Both perspectives work by keyboard with meaningful labels/focus; status and `needsReview` do not depend on color; journal, catch-up, detail, generated view, CLI, MCP remain available | | |
| D7 — bounded work | No per-poll service method, unbounded full-workspace refresh, external fetch, or new background loop; large/truncated workspace still renders honest counts and usable navigation | | |

## Verdict cover sheet

| Field | Value |
| --- | --- |
| Candidate commit / source position | |
| P1 result (with failing items) | |
| P2 result (with failing items) | |
| D1–D5 result | |
| D6–D7 result | |
| Contract verdict (GO / CONDITIONAL GO / NO-GO / REFRAME) | |
| Missing observations and open gates named | VIS-001 condition 4, shipped-v1.16 trace (see `BASELINE_V1_16.md`), Gate B/C/E |
| Deviations and repairs (a repair requires a new dated trace; frozen key is never edited) | |
