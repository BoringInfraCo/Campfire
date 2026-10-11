# RCL-002 rubric

Freeze date: October 11, 2026. Score against `ground-truth.md`, blind to arm where practical. This file does not contain scores. No scored run has been recorded.

## Recall and orientation arms

Pass an item only when the verbatim answer meets it without using the answer key.

- **R1.** The relevant prior object is cited by id. For S1 that includes `dec_rcl002_s1_accepted`. For S2 that includes `dec_rcl002_s2_accepted` and `dec_rcl002_s2_review`. For S3 that includes `dec_rcl002_s3_proposed` when the answer mentions the proposal.
- **R2.** Lifecycle and provenance are correct. Current and historical states stay distinct. Actor type and agent session are not collapsed or invented. S2 reports both checkout decisions as accepted. It reports `needsReview` on the newer one. It does not treat `needsReview` as a revocation or as a choice of the older decision.
- **R3.** The next action matches the key. S1 includes the raw-body HMAC and the twenty-four hour previous-secret overlap. S2 executes neither checkout rule and asks for an explicit retire, or for a replacement proposal that is accepted with a reason. S3 leaves the limit unset and preserves uncertainty.
- **R4.** No stale finding, proposal, or `needsReview` decision is promoted into unquestioned intent. An accepted decision is not described as already replaced unless a supersession is recorded.

S1 fails if the next action follows the superseded finding or the query-string proposal. S2 fails if either accepted checkout rule is treated as ready to execute, or if one is described as having replaced the other. S3 fails if a number or the proposal is stated as decided.

A matched arm that calls `get_workspace` is inconclusive for the comparison. Score the answer, and do not count the pair as better or as no-worse.

## Packet recipients

Score goal, prior evidence, decision status, next action, and uncertainty. Use the same key. The S1 next action must include the rationale constraint even though that decision is outside the newest ten accepted anchors. The S2 next action must report the off-page rationale, keep both decisions accepted, and seek an explicit transition.

A recipient who does not read `packet.json` fails every field. A recipient who reads the checkout fails the arm. Do not add credit for a live workspace read.

## Comparison

The matched comparison is v1.15 orientation and paging against Recall, plus the packet recipient. Apply the better, same, and worse rules in `ground-truth.md`. Do not score an arm that saw the key, an earlier output, or the other arm's transcript.

The synthetic pass bar is in the RCL-002 contract. S3 same-and-sufficient is no-worse, not a Recall win. Do not rescore RCL-001 under this rubric.
