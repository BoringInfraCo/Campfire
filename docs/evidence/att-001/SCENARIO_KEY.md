# ATT-001 answer key — RESTRICTED

**FIXTURE EVIDENCE — cannot establish Gate B, C, E, or F. Never shown to participants.**

Sprint: ATT-001 — Trustworthy Team Attention.
Contract: `docs/Campfire-v1.19-ATT-001-Trustworthy-Team-Attention.md` (§4 frozen evaluation, §5 D1–D6, §6 H1–H6).
Fixture: `fixtures/attention/att-001/` **scenario v2** (the dated scenario repair is recorded in `baseline/SCENARIO_REPAIR.md`).
Baseline: `baseline/` — v1.18.0 pin, served state, and captures.
Frozen: this key is derived from the fixture records and the contract's attention rules only. It was written **before any candidate result or human answer existed**. Do not edit it after a participant begins; a scenario, rule, or scoring change is dated, explained, and applies only to a fresh run.

## 1. How to use

- The deterministic checks D1–D6 are scored by running `tests/integration/att-001.test.ts`, the focused suites, and the compatibility checks against the candidate commit (see `SCORING_FORM.md`).
- The human trace H1–H6 is scored against §5 below. The recorder re-seeds the fixture at the candidate commit, starts each participant's own actor-bound Viewer, and records the served `generatedAt` / `orientationCursor` on the scoring form. Record IDs below are stable across re-seeds (pinned deterministic seed).
- **Missed cue**: score only when a record **in the returned page** meets a frozen rule but no cue appears. An eligible record **outside** the returned page is a **coverage limitation**, not a missed cue; it becomes a false "all clear" only if the surface implies completeness. **False cue**: an item that does not meet the rule, misstates lifecycle/citation/assignee, or claims an owner or permission without a recorded basis (contract §4).
- Order within a list is not normative beyond the existing category order (review cues follow the existing task/decision categories); score on membership, reason, and ids.
- **Correction, October 16, 2026 (UTC).** The Ben/lab `suggestedNextAction` cell in §4 originally read `task_att001_open_ana` (`team_open_task`). That was an authoring error: the frozen `deriveSuggestedNextAction` precedence — unchanged by the candidate and pinned by the existing precedence tests — prefers the `needsAttention` `unassigned_blocked_task` cue over the oldest-open `team_open_task` fallback, so the correct value is `task_att001_blocked_noassignee` (`unassigned_blocked_task`). Evidence verification found the discrepancy; this correction was applied **before any scored trace**, no participant has read this key, no attention-cue expectation, H item, or D threshold changed, and no result was rescored.

## 2. Actors (fixture)

| Actor | Type | Role in the lab | Owns |
| --- | --- | --- | --- |
| `hum_att001_ana` | human | owner (P1 candidate) | `agt_att001_codex` |
| `hum_att001_ben` | human | member (P2 candidate) | `agt_att001_opencode` |
| `agt_att001_codex` | agent (harness codex) | participant | — |
| `agt_att001_opencode` | agent (harness opencode) | participant | — |
| `hum_att001_zed` | human | participant only of `ws_att001_unrelated` | — |

## 3. Frozen records

### 3.1 `ws_att001_lab` (the trace workspace)

Tasks — 21 total, 20 returned, **truncated** (default task budget 20; ranking blocked → in_progress → open → completed, then `updatedAt` desc):

| Task ID | Status | Recorded assignee |
| --- | --- | --- |
| `task_att001_blocked_ana` | blocked | `hum_att001_ana` |
| `task_att001_open_ana` | open | `hum_att001_ana` |
| `task_att001_open_noassignee` | open | none |
| `task_att001_blocked_opencode` | blocked | `agt_att001_opencode` |
| `task_att001_blocked_noassignee` | blocked | none |
| `task_att001_filler_inprogress` | in_progress | none |
| `task_att001_filler_open_codex` | open | `agt_att001_codex` |
| `task_att001_filler_completed_01…14` | completed | none |

Findings:

| Finding ID | Currentness | Note |
| --- | --- | --- |
| `find_att001_current` | current | successor of `find_att001_superseded` |
| `find_att001_superseded` | superseded | corrected into `find_att001_current` with a recorded reason |
| `find_att001_withdrawn` | withdrawn | recorded reason |

Decisions in the orientation slice — 7 total, 7 returned, **complete**:

| Decision ID | Status | Citations | `needsReview` |
| --- | --- | --- | --- |
| `dec_att001_accepted_current` | accepted | `find_att001_current` (current) | no |
| `dec_att001_review_superseded` | accepted | `find_att001_superseded` (non-current) | **yes** — `needsReviewFindingIds = [find_att001_superseded]` |
| `dec_att001_review_withdrawn` | accepted | `find_att001_withdrawn` (non-current) | **yes** — `needsReviewFindingIds = [find_att001_withdrawn]` |
| `dec_att001_competing_a` | accepted | none | no — conflicting rationale with B; **no recorded transition** |
| `dec_att001_competing_b` | accepted | none | no — see above |
| `dec_att001_plain` | accepted | none | no |
| `dec_att001_new` | accepted | none | no — replaces `dec_att001_old`; recorded reason |
| `dec_att001_old` | superseded | none | excluded from the orientation slice; successor `dec_att001_new` |

There is **no proposed decision** in the lab (scenario v2). `historicalCounts = { findings: 2, decisions: 1 }`.

### 3.2 Other workspaces (deterministic cases)

| Workspace | Keyed records | Page coverage |
| --- | --- | --- |
| `ws_att001_quiet` | `task_att001_quiet_open` (open, unassigned), 2 completed tasks; `dec_att001_quiet_accepted` accepted citing `find_att001_quiet_current` (current) | tasks 3/3, decisions 1/1, both **complete** |
| `ws_att001_trunc_tasks` | 20 in_progress fillers + `task_att001_beyond_open_ana` (open, assignee Ana) **outside the page** + 1 completed; no decisions | tasks 22/20 **truncated**; decisions 0/0 |
| `ws_att001_trunc_decisions` | 12 accepted: `dec_att001_page_review` (cites `find_att001_td_withdrawn`, **inside** the page), 10 plain, `dec_att001_beyond_review` (cites `find_att001_td_superseded`, **outside** the page); findings `find_att001_td_superseded` / `find_att001_td_withdrawn` | decisions 12/10 **truncated**; tasks 0/0 |
| `ws_att001_trunc_both` | the trunc_tasks task recipe + the trunc_decisions decision recipe (`dec_att001_tb_page_review` cites `find_att001_tb_withdrawn` inside the page; `dec_att001_tb_beyond_review` cites `find_att001_tb_superseded` outside) | tasks 22/20 and decisions 12/10, both **truncated** |
| `ws_att001_unrelated` | `find_att001_unrelated_sentinel` carries `UNRELATED_FINDING_SENTINEL_att001_do_not_leak`; only `hum_att001_zed` participates | any read by Ana/Ben must be denied with no record, count, participant, review ID, or attention metadata leak |

## 4. Frozen expected candidate attention (rules applied before results)

Coverage rule: `attentionCoverage` must equal the returned slices (`total`/`returned`/`truncated`) and `completeUnderRules` is true only when **both** pages are complete. An incomplete empty list must say no cue was found **in the returned records** and that more may exist; a complete empty list means only that no recorded cue matches these rules — never that all work is done.

Cue rules: `needsYou` = proposed decisions (if the caller may update decisions) + blocked/open tasks assigned to the caller (if the caller may update tasks). `needsAttention` = unassigned blocked tasks, proposed decisions the caller cannot update, blocked tasks assigned to others, demoted caller-assigned tasks for non-writing callers, **and** a review cue `accepted_decision_needs_review` for each **returned accepted** decision with `needsReview = true` (carrying its `needsReviewFindingIds`). Never in `needsYou`; never for a superseded decision; never elevated to `suggestedNextAction`.

| Actor / workspace | Expected `needsYou` | Expected `needsAttention` | `suggestedNextAction` | Coverage |
| --- | --- | --- | --- | --- |
| Ana / lab | `assigned_blocked_task task_att001_blocked_ana`; `assigned_open_task task_att001_open_ana` | `unassigned_blocked_task task_att001_blocked_noassignee`; `team_blocked_task task_att001_blocked_opencode`; review cue `dec_att001_review_superseded` → `[find_att001_superseded]`; review cue `dec_att001_review_withdrawn` → `[find_att001_withdrawn]` | task `task_att001_blocked_ana` (`assigned_blocked_task`) | tasks 20/21 truncated; decisions 7/7 complete; `completeUnderRules = false` |
| Ben / lab | `[]` (no assigned tasks; no proposals) | `unassigned_blocked_task task_att001_blocked_noassignee`; `team_blocked_task task_att001_blocked_ana`; `team_blocked_task task_att001_blocked_opencode`; both review cues | task `task_att001_blocked_noassignee` (`unassigned_blocked_task` — the existing precedence prefers that cue over the oldest-open fallback) | same as Ana |
| Ana & Ben / quiet | `[]` | `[]` | task `task_att001_quiet_open` (`team_open_task`) | complete; empty means no recorded cue matches — `task_att001_quiet_open` stays visible and is **not** a blocker |
| Ana & Ben / trunc_tasks | `[]` | `[]` | none | tasks truncated; empty list is incomplete; the omitted `task_att001_beyond_open_ana` cue is a **coverage limitation** |
| Ana & Ben / trunc_decisions | `[]` | review cue `dec_att001_page_review` → `[find_att001_td_withdrawn]` | none | decisions truncated; `dec_att001_beyond_review` has no in-page cue (coverage limitation) |
| Ana & Ben / trunc_both | `[]` | review cue `dec_att001_tb_page_review` → `[find_att001_tb_withdrawn]` | none | both truncated |
| Ana or Ben / unrelated | denied (`Unauthorized`); nothing leaks | — | — | — |

Not-cues (counterexamples): `dec_att001_accepted_current` (current citation), `dec_att001_competing_a`/`_b` (accepted, no flags), `dec_att001_plain`, `dec_att001_new`, `dec_att001_old` (superseded), `task_att001_open_noassignee`/`filler_open_codex` (open tasks are not cues), every `in_progress`/`completed` task.

## 5. H1–H6 expected facts (scored before discussion)

- **H1** — Ana: `task_att001_blocked_ana` and `task_att001_open_ana` are hers by recorded assignee; `task_att001_blocked_opencode` belongs to Ben's agent; `task_att001_open_noassignee`/`task_att001_blocked_noassignee` have no recorded assignee; group placement is orientation, not an access rule (Ben's agent's blocked task is writable by a writing participant; see `baseline/probe/ana-updates-opencode-task.json`). Ben: no recorded tasks of his own; same others/unassigned split.
- **H2** — Safe examples: `task_att001_blocked_ana` (blocked, assignee `hum_att001_ana`) or `task_att001_blocked_opencode` (blocked, assignee `agt_att001_opencode`). A safe next step is inspecting the recorded state / the trace notes and proposing an update through the normal write path — not an invented owner or priority.
- **H3** — `dec_att001_review_superseded` cites the superseded `find_att001_superseded`; `dec_att001_review_withdrawn` cites the withdrawn `find_att001_withdrawn`. Both remain **accepted**; the review cue does not retire, revoke, or replace them; only an explicit recorded transition (accept a replacement / retire) changes acceptance.
- **H4** — The lab task page is truncated (21 total / 20 returned): the attention lists may omit matching cues, and the coverage statement must say so. Ben's My work list is empty **and incomplete** — that means no cue matched in the returned records, not that the team is done. The quiet workspace is the complete-empty counterexample.
- **H5** — `dec_att001_competing_a`/`_b` are both accepted with conflicting rationales and **no recorded transition**: no operative winner may be chosen. `dec_att001_old` is superseded and must not be promoted back to live; `dec_att001_new` is the recorded replacement.
- **H6** — A team attention cue records assignment/orientation only: it does not name a reviewer, does not mean an agent is running, is not a notification, and neither grants nor denies permission (writes still pass the workspace authorization check and are recorded with the real actor's provenance).

## 6. Verdict inputs

Both participants must pass H1–H6; H3/H4/H5 are safety items (a failure requires repair and a **fresh** trace). D1–D6 must pass with no authorization leak, false complete state, or decision-status error. The `SCORING_FORM.md` verdict cover sheet records the outcome; a version bump, tag, or publication needs a separate release decision.

---

**Provenance note:** fixture v2; baseline captured from tag `v1.18.0` (see `baseline/PIN.md`); expected candidate behavior derived from the ATT-001 contract §3 rules, not from any candidate run. If a candidate differs, record missed/false cues — do not edit this key.
