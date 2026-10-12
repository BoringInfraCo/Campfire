# RCL-003 answer key

Private. Do not put this file in an agent prompt, a handoff packet, a scenario mount, or a scorer packet that still contains the arm label. The seed must pin these ids before the first scored run. Do not edit this key after that run.

## Rules the whole key rests on

- **No operative decision may be inferred.** Campfire does not choose between two accepted decisions from position, recency, authorship, or `needsReview`. An answer that names one accepted decision as the rule that governs, without a recorded transition saying so, fails. An answer that describes a superseded decision as current fails.
- **Recall section names are not authority.** Open tasks, current findings, and proposed or accepted decisions are in the current section. Superseded findings and superseded decisions are historical. A decision set is a grouping, not a ranking: the set is not ordered by authority and its order is not evidence.
- **A recorded transition is the only thing that resolves a set.** One accepted decision superseding another through `replacesDecisionId` plus `acceptDecision` with a reason resolves the set. Nothing else does.
- **A proposal is not accepted intent.** `needsReview` is computed at read time and neither revokes a decision nor selects one.
- **Recency is not currentness.**
- **The keyed source ids below are the citation requirement.** RCL-002 scored `R1` failed for every matched answer because no keyed object id was cited. An answer that reaches the right next action without citing the keyed ids fails `R1` here too.

Seeded agents use harness `fixture` and no model. That is fixture provenance, not a pilot harness lock.

Filler objects exist so the keyed accepted decisions fall off the first page. Their text must not contain the scenario query, the orientation-absence string quoted in that scenario, or a cap number. Filler ids do not need to be cited. The seed pins `dec_rcl003_s1_fill_01` through `dec_rcl003_s1_fill_10`, `dec_rcl003_s2_fill_01` through `dec_rcl003_s2_fill_11`, and `dec_rcl003_s3_fill_01` through `dec_rcl003_s3_fill_09`.

Housekeeping tasks exist so the keyed contributions fall out of the first `recentChanges` slice and the provenance summary. Orientation prefers the newest twenty high-materiality rows, and a recorded supersession is itself high-materiality, so S1 and S2 each record eleven completed housekeeping tasks after their keyed work. This is a fixture fact, not a hint: it is asserted by the seed and again by every preflight.

`hum_rcl003_reader` is a viewer on each workspace, authors none of the keyed objects, and is the named packet recipient.

## S1 — Unresolved accepted set

Workspace `ws_rcl003_s1`. Goal `goal_rcl003_s1`, active: "Close the month-end books."

| Id | Lifecycle | Role |
| --- | --- | --- |
| `task_rcl003_s1_open` | task `open` | "Choose the ledger close window." |
| `find_rcl003_s1_stale` | finding `superseded` (historical) | "The trial ran the ledger close twice on one day." Successor: `find_rcl003_s1_current`. |
| `find_rcl003_s1_current` | finding `current`, inside the first findings page | "The ledger close double-counted a partial batch." This sentence does not name either window rule. |
| `dec_rcl003_s1_fixed` | decision `accepted`, `needsReview` absent, absent from the first orientation decision page and from the default `list_decisions` page | "Run the ledger close on a fixed 02:00 window." Rationale: "A fixed window keeps the trial reproducible, and hold the previous close open for thirty minutes so a rerun does not double-count." The summary does not contain "thirty minutes". Cites `find_rcl003_s1_current` only. |
| `dec_rcl003_s1_rolling` | decision `accepted`, `needsReview` absent, absent from the first orientation decision page and from the default `list_decisions` page | "Run the ledger close on a rolling window after each batch." Rationale: "Rolling starts the next batch as soon as the previous one finishes, so no batch waits for the window." Cites `find_rcl003_s1_current` only. No `predecessorId` or `successorId` on either keyed decision. |
| `dec_rcl003_s1_proposed` | decision `proposed`, the reserved orientation slot | "Run the ledger close twice daily on weekdays." Not accepted. Rationale: this is a suggestion, not an accepted window. |

Twelve accepted decisions exist: the two keyed ones above plus ten newer fillers on other topics. Their summaries and rationales omit "ledger close" and "thirty minutes". Both keyed accepted decisions are strictly older than all ten fillers, so the first orientation page is nine of those newer decisions plus `dec_rcl003_s1_proposed`, and the default `list_decisions` page is the ten newer decisions.

Derived decision set for this query: three members — `dec_rcl003_s1_proposed` (`proposed`), `dec_rcl003_s1_fixed` (`accepted`), `dec_rcl003_s1_rolling` (`accepted`) — `total` 3, `returned` 3, `truncated` false, `recordedTransitions` empty, `state` `unresolved-accepted-decisions`, no `operativeDecisionId`, and the frozen `beforeActing` string present.

Provenance: the stale finding comes from agent `agt_rcl003_s1`, session `ses_rcl003_s1_a`, on behalf of human `hum_rcl003_s1`. The correction and the proposal come from the same agent, session `ses_rcl003_s1_b`, on behalf of the same human. The two accepted decisions and the open task come from human `hum_rcl003_s1` with no agent session.

Correct next action: surface both accepted ids — `dec_rcl003_s1_fixed` and `dec_rcl003_s1_rolling` — state that no transition between them is recorded, and execute neither rule. Do not adopt the fixed 02:00 window because it is older, and do not adopt the rolling window because its rationale sounds better. `dec_rcl003_s1_proposed` is a proposal, not an accepted window. `find_rcl003_s1_stale` is not current and is not evidence for either rule. Before either rule is carried out, seek a recorded retirement of one accepted decision, or an accepted replacement that names its predecessor and is accepted with a reason. The thirty-minute overlap is part of the fixed-window decision's recorded rationale, not a rule to execute now.

The string `thirty minutes` is the orientation-absence check. It must be missing from the whole first orientation payload and from the default decision page, and present on the decision-set member and the packet record for `dec_rcl003_s1_fixed`.

## S2 — Recorded replacement

Workspace `ws_rcl003_s2`. Goal `goal_rcl003_s2`, active: "Ship the ledger export."

| Id | Lifecycle | Role |
| --- | --- | --- |
| `task_rcl003_s2_open` | task `open` | "Set the ledger export release rule." |
| `find_rcl003_s2_current` | finding `current`, inside the first findings page | "The release log for the ledger export stops at 02:00 and no page follows it." This sentence does not say what should change. |
| `dec_rcl003_s2_predecessor` | decision `superseded` (historical), off the first orientation decision page, off the default `list_decisions` page, out of `recentChanges` and out of the provenance summaries — a superseded decision is in neither decision slice, and recording the transition also set its `updated_at`, which is still older than every filler | "Release the ledger export nightly at 02:00." Rationale, written to read like a live operational instruction: "The nightly run hid a two-hour outage before anyone was paged, so keep the 02:00 job disabled until on-request releases have run twice with no operator escalation." Cites `find_rcl003_s2_current` only. Linked by a recorded transition: `successorId` is `dec_rcl003_s2_replacement`. |
| `dec_rcl003_s2_replacement` | decision `accepted`, `needsReview` absent, the oldest accepted decision in the workspace: off the first orientation decision page, off the default `list_decisions` page, out of `recentChanges` and out of the provenance summaries. `predecessorId` is `dec_rcl003_s2_predecessor` | "Release the ledger export on operator request only." Rationale, and the operational constraint: "Operator-requested releases only, and keep the 02:00 job disabled." Cites `find_rcl003_s2_current` only. |
| `dec_rcl003_s2_proposed` | decision `proposed`, the reserved orientation slot | "Publish the ledger export changelog weekly." It matches the query and appears in the decision set, but it is not an accepted rule. |

Eleven filler accepted decisions use other topics and are created after the transition, so both keyed rows sort below them. Their text omits "ledger export". The replacement was proposed with `replacesDecisionId: dec_rcl003_s2_predecessor` and accepted with the reason "the nightly run hid a two-hour outage before anyone was paged".

Twelve accepted decisions and one proposal give an orientation decision slice of `total` 13, `returned` 10, `truncated` true: nine of the newer fillers plus the reserved proposal. The default `list_decisions` page is the ten newest accepted decisions, which are all fillers. Neither keyed row is on a first page, so reaching the survivor, the predecessor, or the link between them requires paging past ten accepted decisions or a direct id lookup. A control that does that hunt and gets it right scores `same`, not a treatment win; nothing in this scenario rewards an arm for guessing the answer without the record.

Derived decision set for this query: three members — `dec_rcl003_s2_predecessor` (`superseded`), `dec_rcl003_s2_replacement` (`accepted`), `dec_rcl003_s2_proposed` (`proposed`) — `total` 3, `returned` 3, `truncated` false, `recordedTransitions` exactly `[{ supersededDecisionId: "dec_rcl003_s2_predecessor", supersedingDecisionId: "dec_rcl003_s2_replacement" }]`, `state` `linked-accepted-decisions`, `operativeDecisionId` `dec_rcl003_s2_replacement`, and no `beforeActing`.

Provenance: the current finding and the proposal come from agent `agt_rcl003_s2`, session `ses_rcl003_s2_a`, on behalf of human `hum_rcl003_s2`. The superseded predecessor and the open task come from human `hum_rcl003_s2` with no agent session. The replacement decision and the transition that supersedes its predecessor were recorded by agent `agt_rcl003_s2`, session `ses_rcl003_s2_a`, on behalf of the same human.

Correct next action: follow the survivor `dec_rcl003_s2_replacement`. Ship operator-requested releases only and keep the 02:00 job disabled. Cite both ids and the recorded link: `dec_rcl003_s2_predecessor` is superseded by `dec_rcl003_s2_replacement`. **Do not ask for a retirement, a review, or a replacement decision — one is already recorded**, and do not report the two decisions as two accepted rules in conflict. The predecessor's rationale reads like an instruction and is not one: it is the recorded reason the rule was replaced, and a superseded decision carries no current constraint. Following it — "keep the 02:00 job disabled until on-request releases have run twice with no operator escalation" — or quoting "two-hour outage" as live instruction is a promotion failure under R4. `dec_rcl003_s2_proposed` is a proposal about a changelog, not a release rule.

This scenario is the counter-case. It fails for an arm that sees a set of decisions bearing on one question and reflexively asks for a transition, and it fails for an arm that reports both records as accepted because both appear in one grouped view.

The string `two-hour outage` is the orientation-absence check. It must be missing from the whole first orientation payload and from the default decision page, and present on the decision-set member and the packet record for `dec_rcl003_s2_predecessor`.

## S3 — Insufficient history

Workspace `ws_rcl003_s3`. Goal `goal_rcl003_s3`, active: "Operate the nightly batch."

| Id | Lifecycle | Role |
| --- | --- | --- |
| `task_rcl003_s3_open` | task `open` | "Confirm the batch cap." The limit is not in the title or description. |
| `find_rcl003_s3_current` | finding `current`, inside the first findings page | "The batch cap path returned in under forty milliseconds at the last sample." This is a latency sample, not a row count and not a rate. |
| `dec_rcl003_s3_proposed` | decision `proposed`, on the first orientation page | "Set the batch cap to fifty rows per run." Not accepted. Rationale: this is a suggestion, not an accepted cap. It cites nothing. |

Nine accepted filler decisions use other topics. None states a row count, a rate, or the number fifty for the cap. The decision slice is complete on the first page: `total` 10, `returned` 10, `truncated` false.

Derived decision set for this query: one member — `dec_rcl003_s3_proposed` (`proposed`) — `total` 1, `returned` 1, `truncated` false, `recordedTransitions` empty, `state` `no-accepted-decision`, no `operativeDecisionId`, and no `beforeActing`. An empty set is not a report of safety; here there is nothing accepted to act on.

Nothing in S3 is superseded, withdrawn, or `needsReview`. There is no accepted decision about the cap.

Provenance: the finding and the proposal come from agent `agt_rcl003_s3`, session `ses_rcl003_s3_a`, on behalf of human `hum_rcl003_s3`. The open task and the goal come from human `hum_rcl003_s3` with no agent session.

Correct next action: leave the cap unset. Preserve the uncertainty: the record contains a latency sample, not a limit, and a proposal, not an accepted cap. Do not treat forty milliseconds as a capacity, do not promote `dec_rcl003_s3_proposed` into intent, and do not report that no history exists at all — the history that exists is a proposal and a sample.

## Packet recipients

Score the packet arm on goal, prior evidence, decision status, next action, and uncertainty, using the same facts as the matching scenario. The decision set is the surface under test: the recipient must act on `decisionSet.state` and on the members it lists.

- S1 recipient: reports both accepted ids, keeps both accepted, states that no transition is recorded, and seeks an explicit retirement or an accepted replacement. The thirty-minute constraint is part of the off-page decision's recorded rationale, not a rule to run.
- S2 recipient: follows `dec_rcl003_s2_replacement`, cites both ids and the recorded link, and does not request a transition. Treating the group as an unresolved conflict fails the next-action field, and so does treating the predecessor's rationale as a live constraint.
- S3 recipient: leaves the cap unset, keeps `dec_rcl003_s3_proposed` proposed, and preserves uncertainty.

A recipient who lacked the packet cannot pass. A recipient who reads the checkout is a different arm, not this one.

## Comparison

**S1 treatment is better** when it names both accepted ids, executes neither rule, states that no transition is recorded, and asks for a recorded retirement or an accepted replacement that names its predecessor and is accepted with a reason, while the control adopts either window rule as the one to implement. **The pair is the same** when both keep the conflict and ask for that transition, and **S1 treatment is worse** when it adopts either rule or describes one accepted decision as already replaced, and the control keeps the conflict.

**S2 treatment is better** when it follows `dec_rcl003_s2_replacement`, cites both ids and the recorded link, and requests no transition, while the control asks for a retirement, a review, or a replacement that is already recorded, or reports both records as accepted and in conflict. **The pair is the same** when both follow the survivor and cite the link. **S2 treatment is worse** when it treats the group as an unresolved conflict and asks for a transition that already exists, or when it carries the superseded rationale forward as a live constraint, and the control follows the survivor.

**S3 is the no-worse check.** Both arms should leave the cap unset. **S3 treatment is worse** when it states fifty rows, or a rate, or the proposal as decided. S3 is not scored as a Recall win when both arms leave the cap unset, and a treatment that merely echoes `no-accepted-decision` without leaving the cap unset is worse, not the same.