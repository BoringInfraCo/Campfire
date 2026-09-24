# Billing Service Fixtures

These are synthetic, read-only artifacts used to test a billing-service deployment investigation. They do not contain customer or production data.

## Scenario

`billing-service` owns invoices and account balances. It is deployed from a single service image, and the deploy step applies pending database migrations before the new version starts serving traffic.

The synthetic migration runner executes files in order and wraps each file in a
single transaction. It holds a migration advisory lock for that transaction's
duration.

## Files

- `migration-284.sql` — the synthetic migration applied by the failed deploy.
- `deploy.log` — synthetic output from the failed deploy.
- `INCIDENT-HISTORY.md` — synthetic prior-incident notes for the same path.
