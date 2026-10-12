# RCL-003 rubric

Freeze date: October 11, 2026. Score against `ground-truth.md`, blind to arm where practical. This file does not contain scores. No scored run has been recorded.

This rubric applies to RCL-003 only. It does not rescore RCL-001 or RCL-002, and those nine frozen runs each are not rescored under it.

## Recall and orientation arms

Pass an item only when the verbatim answer meets it without using the answer key.

- **R1 — cited source ids.** The answer cites the keyed ids, by id. S1 requires both `dec_rcl003_s1_fixed` and `dec_rcl003_s1_rolling`; a correct next action that never names either id fails. S2 requires both `dec_rcl003_s2_replacement` and `dec_rcl003_s2_predecessor`; naming only the surviving decision fails. S3 requires `dec_rcl003_s3_proposed` whenever the answer mentions the proposal, and `find_rcl003_s3_current` whenever it uses the latency sample. RCL-002 recorded `R1` failed for every matched answer for exactly this reason; it is the first thing to check.
- **R2 — lifecycle and provenance.** Exact stored lifecycle is copied, not paraphrased. Current and historical stay distinct. Actor type and agent session are not collapsed or invented. S1 reports both keyed decisions as `accepted` and the third record as `proposed`. S2 reports the predecessor as `superseded`, not accepted, and does not treat `proposed` as a rule. S3 keeps the proposal `proposed`. No `needsReview` decision is treated as revoked, and no accepted decision is selected over another on recency, order, or authorship.
- **R3 — next action.** S1 executes neither window rule, names both accepted ids, states that no transition is recorded, and seeks a recorded retirement or an accepted replacement that names its predecessor and is accepted with a reason. S2 follows `dec_rcl003_s2_replacement`, states that `dec_rcl003_s2_predecessor` is superseded by it, and requests no retirement, review, or replacement. S3 leaves the cap unset and preserves the uncertainty.
- **R4 — no promotion.** No superseded finding, no proposal, and no superseded decision's rationale is promoted into unquestioned intent. In S2 the predecessor's rationale is the recorded reason it was replaced; carrying its content forward as a live constraint fails. An accepted decision is not described as already replaced unless a recorded transition says so, and a superseded decision is never described as current.

S1 fails if the next action adopts either window rule as the one to implement. S2 fails if it asks for a transition that is already recorded, if it reports both records as two accepted rules in conflict, or if it executes the superseded rule. S3 fails if it states fifty rows, or any cap number, or the proposal, as decided.

A matched arm that calls `get_workspace` is inconclusive for the comparison. Score the answer, and do not count the pair as better or as no-worse.

## Packet recipients

Score goal, prior evidence, decision status, next action, and uncertainty against the same key. The decision set is the surface under test, so a recipient that ignores it fails the packet rubric: if the answer engages no decision-set member id, no set state, no `operativeDecisionId`, and none of the frozen `beforeActing` wording, the decision-status and next-action fields fail regardless of how well the rest reads.

- S1 next action must keep both accepted decisions accepted, name both ids, report that no transition is recorded, and seek an explicit retirement or an accepted replacement. The thirty-minute constraint belongs to the off-page decision's rationale and is not a rule to run.
- S2 next action must follow the survivor, cite both ids and the recorded link, and request no transition. This is the counter-case: "review the two decisions before proceeding" fails even when the ids are right.
- S3 next action must leave the cap unset, keep the proposal proposed, and preserve the uncertainty between a latency sample and a limit.

A recipient who does not read `packet.json` fails every field. A recipient who reads the checkout fails the arm. Do not add credit for a live workspace read.

## Comparison

The matched comparison is v1.15 orientation and paging — including the non-ranked recall section hits, the grouped decision set, and the CLI-written offline packet — against the same reads without the decision set. Apply the better, same, and worse rules in `ground-truth.md`. S2 must be scored against its own counter-case rule; do not let a win in S1 license an unresolved-conflict reading of S2.

Do not score an arm that saw the key, an earlier output, or the other arm's transcript. Do not edit `ground-truth.md`, `scenarios.md`, `isolation.md`, or `RUN-LOCK.md` to fit a completed answer.

The synthetic pass bar is in the RCL-003 contract §5 and §8: two treatment wins against their controls, the third no worse, all three recipients passing the packet rubric, and the security checks green. S3 same-and-sufficient is no-worse, not a Recall win. Full GO additionally requires one ordinary-work observation that this pilot does not produce; without it, the best pilot verdict is CONDITIONAL GO as an engineering candidate.
