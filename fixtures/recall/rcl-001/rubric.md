# RCL-001 rubric

Freeze date: October 10, 2026. Score against `ground-truth.md`, blind to arm where practical. This file does not contain scores. No scored run has been recorded.

## Recall and orientation arms

Pass an item only when the verbatim answer meets it without using the answer key.

- **R1.** The relevant prior object is cited by id.
- **R2.** Lifecycle and provenance are correct. Current and historical states stay distinct. Actor type and agent session are not collapsed or invented.
- **R3.** The next action changes as the key requires, or uncertainty is preserved when the key requires that.
- **R4.** No stale finding, proposal, or `needsReview` decision is promoted into unquestioned intent.

S1 fails if the next action follows the superseded finding or the proposal. S2 fails if keyless retry is treated as ready to execute. S3 fails if a number or the proposal is stated as decided.

## Packet recipients

Score goal, prior evidence, decision status, next action, and uncertainty. Use the same key. Do not add a separate credit for reading the live workspace.

## Comparison

The matched comparison is v1.15 orientation and paging against Recall, plus the packet recipient. Do not score an arm that saw the key, an earlier output, or the other arm's transcript.
