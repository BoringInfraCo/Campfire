# Billing Service Fixtures

Local, read-only copies of the artifacts an on-call engineer would inspect while
debugging a billing-service deploy.

## What this is

`billing-service` owns invoices and account balances. It is deployed from a
single service image, and the deploy step applies pending database migrations
before the new version starts serving traffic.

## Migration runner

The migration runner executes the files in `db/migrations/` in order. Each
migration file is wrapped in a single transaction: everything in the file either
commits together or rolls back together. The runner holds a migration advisory
lock for the duration of that transaction.

## Files here

- `migration-284.sql` — the migration applied by the failed deploy.
- `deploy.log` — output captured from the most recent failed deploy.
- `INCIDENT-HISTORY.md` — prior incident notes for the same deploy path.

The deploy log is written to `deploy.log` in this directory.
