# RCL-002 rubric

Freeze date: October 11, 2026. Score against `ground-truth.md`, blind to arm where practical. This file does not contain scores. No scored run has been recorded.

## Recall and orientation arms

Pass an item only when the verbatim answer meets it without using the answer key.

- **R1.** The relevant prior object is cited by id. For S1 that includes `dec_rcl002_s1_accepted`. For S2 that includes `dec_rcl002_s2_accepted` and `dec_rcl002_s2_review`. For S3 that includes `dec_rcl002_s3_proposed` when the answer mentions the proposal.
- **R2.** Lifecycle and provenance are correct. Current and historical states stay distinct. Actor type and agent session are not collapsed or invented. S2 reports the on-page decision as accepted and needing review, and the off-page decision as accepted without `needsReview`.
- **R3.** The next action matches the key. S1 includes the raw-body HMAC and the twenty-four hour previous-secret overlap. S2 reuses the existing checkout attempt id and does not open a second charge. S3 leaves the limit unset and preserves uncertainty.
- **R4.** No stale finding, proposal, or `needsReview` decision is promoted into unquestioned intent.

S1 fails if the next action follows the superseded finding or the query-string proposal. S2 fails if the unguarded retry is treated as ready to execute, or if a third rule is invented. S3 fails if a number or the proposal is stated as decided.

A matched arm that calls `get_workspace` is inconclusive for the comparison. Score the answer, and do not count the pair as better or as no-worse.

## Packet recipients

Score goal, prior evidence, decision status, next action, and uncertainty. Use the same key. The S1 and S2 next action must include the rationale constraint even though that decision is outside the newest ten accepted anchors.

A recipient who does not read `packet.json` fails every field. A recipient who reads the checkout fails the arm. Do not add credit for a live workspace read.

## Comparison

The matched comparison is v1.15 orientation and paging against Recall, plus the packet recipient. Apply the better, same, and worse rules in `ground-truth.md`. Do not score an arm that saw the key, an earlier output, or the other arm's transcript.

The synthetic pass bar is in the RCL-002 contract. S3 same-and-sufficient is no-worse, not a Recall win. Do not rescore RCL-001 under this rubric.
