# ACT-001 transitions (frozen, §4)

**Label: FIXTURE EVIDENCE.** Proposed contract, not implemented behavior.

```text
proposed -> approved | rejected | cancelled
approved -> cancelled | dispatch_reserved
dispatch_reserved -> submission_accepted | submission_failed | submission_unknown
submission_unknown -> reconciliation receipt (accepted or definite failure)
```

Frozen cases:

1. Terminal `rejected`/`cancelled` proposals never reopen. A new attempt needs a new proposal and fresh approval.
2. Once reserved, cancellation cannot claim to stop external execution.
3. No automatic reservation expiry, executor takeover, background retry, or second dispatch under the same approval.
4. A crashed executor leaves a reservation requiring reconciliation.
5. Retrying a definite no-submission outcome for the same target is deferred, not a silent second dispatch path.
6. One workspace-wide unique provider target key over (repository, workflow, run id, expected attempt): two separately approved proposals cannot reserve the same retry. The key survives terminal receipts and crashes. A genuinely new provider run/attempt needs a new proposal and approval.
7. An inbound completion correlates to exactly one reserved proposal.
8. Contradictory terminal receipts are rejected, never overwritten; a later reconciliation receipt may resolve `submission_unknown` with cited provider evidence while preserving the original uncertainty.
9. A provider `success` conclusion is the ONLY conclusion reported as verification success. `failure`, `cancelled`, `skipped`, and other terminal outcomes stay explicit; unrecognized strings normalize to `unknown` without a success claim. A submitted retry is not proof tests passed; a signed completion is not permission to merge, release, deploy, complete a task, or accept a decision.
