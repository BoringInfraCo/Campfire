# Frozen concurrency and ordering cases (ACT-001 §4 + §5.3)

**Label: FIXTURE EVIDENCE.** Expected post-implementation behavior; none of this is implemented.

## Concurrent approval / reservation

| Case | Setup | Expected |
| --- | --- | --- |
| Two approves, one revision | owner approves rev 3 twice concurrently, same requestKey per caller | exactly one transition to `approved`; second is an exact replay, no duplicate Contribution |
| Approve vs cancel race | owner approve rev 3 vs owner cancel rev 3 | exactly one wins; loser gets a revision conflict with a bounded recovery hint |
| Two reservations | executor reserves twice concurrently (same or different requestKey) | exactly one `dispatch_reserved`; loser conflicts; no second dispatch identity |
| Two proposals, same target/attempt | proposal P2 approved for (repo, workflow, run 11223344, attempt 2) while P1 already reserved it | P2 reservation fails with conflict naming the target key; no second dispatch under the same approval |
| Duplicate receipt append | same `record_action_outcome` bytes twice (same requestKey) | exact replay of the prior receipt; no duplicate receipt row |
| Contradictory terminal receipt | `submission_accepted` then `submission_failed` for the same reservation | rejected; original preserved; uncertainty preserved |

## Event-before-receipt

| Case | Setup | Expected |
| --- | --- | --- |
| Completion before submission report | signed `workflow_run completed` (run 11223344, attempt 2 = expectedAttempt + 1) arrives while proposal is `dispatch_reserved` and no submission receipt exists | accepted: semantic receipt + Artifact + Finding committed; later `submission_accepted` receipt records the executor fact separately; neither fabricates causation |
| Redelivery after commit | same delivery id + same bytes | `200` with the existing receipt; no new Artifact/Finding/Contribution |
| Same semantic event, new delivery id | different delivery id, identical semantic key | `200` duplicate; no new records |
| New source id, same semantic event | source rebinding attempt with a different source id | used source id cannot be rebound; new source id needs fresh authority; the semantic key still prevents a duplicate evidence pair |

## Crash / ambiguity

| Case | Expected |
| --- | --- |
| Executor crashes after POST, response lost | executor records `submission_unknown`; reconciliation with cited provider evidence resolves it; no automatic second POST |
| Conflicting external rerun (attempt 3 unreserved) | matching completion stays ambiguous; system claims no sole causation |
| Membership revoked after reservation | further authorized calls fail; Campfire cannot recall the request already sent to GitHub |
