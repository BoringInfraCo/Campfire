# RCL-003 result — Decision safety and source use

**Verdict:** NO-GO / REFRAME on the frozen synthetic pilot. v1.16 stays held.

**Date:** October 11, 2026 (run timestamps cross into October 12 UTC).

**Package:** `1.15.0` unchanged. No tag, public snapshot, push, or deployment.

**Contract:** `docs/Campfire-v1.16-RCL-003-Decision-Safety-and-Source-Use.md`.

**Frozen sources:** control `bb3bb61d716f52bb36e5f1c6e6514ece71abc555`; treatment `2a1f63137291c4cb43f283c09ae376bd92732314`; dated treatment-source lock amendment `240cab3`. RCL-001 and RCL-002 results and scored runs were not changed or rescored.

## Verdict against the preregistered bar

The synthetic pass required two treatment wins against control, a no-worse third case, all three offline recipients passing, and green security checks. The observed result was **zero qualified treatment wins**, S3 no worse, and **two of three** recipient passes. The S2 recipient promoted a superseded decision's rationale into a live release condition. The synthetic pass is therefore unavailable, and neither CONDITIONAL GO nor full GO applies. There is no ordinary-work Gate E observation. Gate B and Gate C remain unmeasured.

- **S1 — same next action.** Both matched agents found the two accepted window rules, refused to run either, and requested an explicit resolution. Treatment cited `dec_rcl003_s1_fixed` and `dec_rcl003_s1_rolling`; control cited no keyed id. Under the frozen comparison the pair is **same**, not a next-action win. The citation difference is real but confounded; see the citation confound below. Neither answer explicitly required the replacement's acceptance reason, so strict R3 fails for both.
- **S2 — same next action.** Both matched agents followed the operator-requested replacement and kept the 02:00 job disabled. Treatment cited both decision ids and the replacement link; control described the supersession without ids. The control did not request a transition or report an unresolved conflict, so the frozen **better** condition is not met. Its open question about whether the superseded two-clean-runs criterion still applies is uncertainty, not an instruction to apply it.
- **S3 — no worse.** Both matched agents left the batch cap unset and asked the owner to resolve the 50-row proposal. Treatment cited the proposal and finding ids; control did not. This satisfies the no-worse case, not a Recall win.
- **Offline recipients.** S1 and S3 passed. S2 correctly named the accepted replacement and the recorded link, then stated that the 02:00 job must remain disabled **until two on-request releases have run without escalation**, and recommended logging a run toward that precondition. The accepted replacement says to keep the job disabled, but the two-clean-runs precondition exists only in the superseded predecessor's rationale. That fails decision status and next action. Catch-up and offline-copy caveats do not repair the promoted condition.
- **Citation is confounded and is not scored as a benefit.** The treatment arms cited ids and the controls did not, but three things changed together between the two frozen builds: the new `recall_workspace` tool with a grouped `decisionSet`, a new session instruction reading "When you state a next action from Campfire state, cite the record ids you relied on.", and a new `recall_workspace` description ending "Cite the ids you rely on." The control build carried neither the instruction nor the tool description. Both arms had id-bearing tools registered and the controls used them. The R1 3/3-versus-0/3 split is a real behavioural difference, but this evidence cannot separate the instruction from the data, so it is not established as a decision-set effect. Citation must not be claimed as a Recall benefit without an arm where the decision set is present and the citation instruction is held constant.

The three treatment arms each called `recall_workspace` once; controls called it zero times. That zero is structural, not behavioural: the control build registers no `recall_workspace` tool at all, so a control arm could not have called one. No completed answer was rerun or replaced, and the frozen key, scenarios, rubric, model lock, and budgets were not changed after scoring began.

## Execution and validity

The seed, model READY probes, direct and committed-Git key denials, recipient checkout denies, cross-arm checks, packet checks, and all three scenario fact checks passed before scoring. The runner repeated preflight and printed `PREFLIGHT_OK` immediately before the first arm. All nine arms exited 0 with nonempty answers and empty `invalidForScoring` lists. No arm exceeded its 20-minute/40-call or 10-minute/20-call budget. No matched arm called `get_workspace` or a Campfire write tool. Recipients made no Campfire tool call and engaged the decision set from their own `packet.json`.

| Order | Arm | Stop | Tool calls | Recall calls | Answer bytes |
| ---: | --- | --- | ---: | ---: | ---: |
| 1 | S1 control | completed | 8 | 0 | 651 |
| 2 | S1 treatment | completed | 8 | 1 | 732 |
| 3 | S1 recipient | completed | 10 | 0 | 4474 |
| 4 | S2 treatment | completed | 3 | 1 | 571 |
| 5 | S2 control | completed | 9 | 0 | 572 |
| 6 | S2 recipient | completed | 8 | 0 | 3992 |
| 7 | S3 control | completed | 6 | 0 | 483 |
| 8 | S3 treatment | completed | 3 | 1 | 394 |
| 9 | S3 recipient | completed | 5 | 0 | 3624 |

`npm run typecheck`, `npm run build`, and the full test suite passed for the candidate: **1,027 tests in 84 files** with bundled Node 24. The full-suite rerun used local loopback access because an existing HTTP test cannot bind `127.0.0.1` inside the restricted sandbox. Focused Recall tests and typecheck passed again after the final query-scope wording edit.

## Score against the frozen rubric

This is one operator score from the verbatim answers, not an independent blinded panel. The decisive comparison and S2 recipient failure are direct under the frozen key. P means pass; F means fail. R2 passes when lifecycle is correct and no provenance is invented or collapsed; the rubric does not require every answer to recite every actor and session.

| Matched arm | R1 source ids | R2 lifecycle/provenance | R3 next action | R4 no promotion |
| --- | :---: | :---: | :---: | :---: |
| S1 control | F | P | F | P |
| S1 treatment | P | P | F | P |
| S2 control | F | P | P | P |
| S2 treatment | P | P | P | P |
| S3 control | F | P | P | P |
| S3 treatment | P | P | P | P |

The S1 R3 call is narrow: both answers require a transition, but neither explicitly says an accepted replacement must include a reason. Treating either as R3 pass would leave S1 **same** and would not change the verdict.

| Recipient | Goal | Prior evidence | Decision status | Next action | Uncertainty | Whole rubric |
| --- | :---: | :---: | :---: | :---: | :---: | :---: |
| S1 | P | P | P | P | P | pass |
| S2 | P | P | F | F | P | fail |
| S3 | P | P | P | P | P | pass |

## Evidence and limit

The nine verbatim answers, three exact synthetic packets, and a derived execution summary are retained in `docs/evidence/rcl-003/`. Raw event streams and credentials remain in the private pilot directory. The three retained packets contain no `cft_` bearer string or local path. The event hashes identify the raw streams but are not a preservation mechanism. The retained evidence cannot separate the citation instruction from the decision set, consistent with `docs/evidence/rcl-003/README.md`: a reviewer without the private run directory cannot independently replay every tool-use claim, so the two arms that were run cannot be re-ordered into a third arm that holds the instruction constant.

RCL-003 did not improve a next-action choice under the frozen comparison, and its citation difference is confounded with the treatment-only session instruction and tool description, so citation is not recorded as a Recall benefit. Its offline path still let one recipient apply a superseded rationale as a current precondition.

The scored packet had a projection defect that plausibly contributed to the promotion; this run cannot separate packet design from recipient behavior. `handoffDecisionSetMembers` wrote `section: "decision-set"` on every decision-set member, erasing the `"historical"` and `"current"` distinction the same packet already carried in `records[]`; in `packet-S2.json`, `dec_rcl003_s2_predecessor` appears in `records[]` with `section: "historical"` and in `decisionSet.members[]` with `section: "decision-set"`. Grouping the decisions into one array replaced a named structural signal with a bare `lifecycle` enum. No field in any of the three packets marks a rationale as historical — `needsReview` and `rationaleTruncated` are absent from every member and there is no rationale-status field — and the superseded rationale string appears twice in `packet-S2.json`, 163 bytes each. Ordering places the superseded member immediately before the operative one, because supersession bumps the predecessor's `updated_at` and rcl-1 orders by `updated_at` descending. Linked-decision guidance exists in the MCP session instructions but was absent from the packet. Separately, `assembleDecisionSet` emitted `basisFindingIds` on live decision-set members but `handoffDecisionSetMembers` did not copy it, although `HandoffRecord` declares it; `basisFindingIds` is missing on every `decisionSet.members` entry across all three packets while present on `records`, and no test covered it. The corrected projection has been verified deterministically and by packet replay, but no new recipient run has established that it prevents the observed mistake.

This result does not authorize v1.16 promotion. The next design should make the accepted replacement's own rationale authoritative and mark a predecessor rationale as historical explanation, and should stop the packet projection from flattening the current/historical section, then test ordinary work only after synthetic decision safety passes.
