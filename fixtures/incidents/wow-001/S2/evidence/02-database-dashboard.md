# Synthetic evidence 02 — Payments database dashboard

**Observed:** 2026-10-06 09:22 UTC

**Source:** Dashboard panel `payments-postgres / connection acquisition`

The panel shows connection acquisition wait p95 rising from 18 ms at 09:10 UTC to 760 ms at 09:18 UTC and 810 ms at 09:21 UTC. The panel's displayed query is `region=eu-west-1, service=*`, and its legend says `all payments clients`. The panel has no request IDs or per-service breakdown. The database's total connection count remains below its configured limit.

The dashboard alone does not show which client experienced the long waits or whether the checkout requests reached a database client.
