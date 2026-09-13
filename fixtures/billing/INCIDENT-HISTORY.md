# Billing Service — Incident History

On-call notes kept for the billing-service deploy path. These are real incident
notes, not a diagnosis.

## INC-2026-021 — The timeout increase we reverted

During a busy billing window, deploys kept failing because migrations ran long,
so we raised the deploy timeout from 120s to 300s to give the migration work room
to finish. That change made the failure mode worse rather than better.

With a 300s window the deploy runner allowed a second deploy to start while the
first migration still held its lock. The two deploys overlapped: the older
process kept writing backfilled balances after the newer process had begun
serving traffic, so some accounts were briefly served stale balances. The overlap
also forced a rollback of the second deploy.

After that we reverted the timeout to 120s and it has stayed there. We are not
willing to raise it again without understanding why a deploy runs long in the
first place.

## Recurring pattern — INC-2026-034, INC-2026-041, INC-2026-047

Since the revert, several deploys have failed through the same path:

- the migration runner wraps each migration file in a single transaction;
- a single migration performs a schema change and a large backfill together;
- the transaction therefore holds an `ACCESS EXCLUSIVE` lock for the whole run;
- the run outlives the 120s deploy timeout, so the deploy aborts and rolls back.

The failures cluster around migrations that mix schema changes with data
backfill in one transaction.
