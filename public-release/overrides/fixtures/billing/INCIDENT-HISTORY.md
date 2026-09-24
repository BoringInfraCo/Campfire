# Billing Service — Synthetic Incident History

These fictional incident notes support deterministic Campfire tests. They are not records from a real service or customer environment.

## INC-2026-021 — The timeout increase that was reverted

During a busy billing window, deployments kept failing because migrations ran
long, so the team raised the timeout from 120s to 300s. The change made the
modeled failure worse: a second deployment overlapped the first migration,
briefly serving stale balances and forcing a rollback.

The timeout returned to 120s. The scenario's constraint is to understand and
split the migration rather than raise the global timeout again.

## Recurring synthetic pattern

- the migration runner wraps each migration file in one transaction;
- one migration combines a schema change with a large backfill;
- the transaction holds an `ACCESS EXCLUSIVE` lock for the whole run;
- the run exceeds the 120s deployment timeout and rolls back.
