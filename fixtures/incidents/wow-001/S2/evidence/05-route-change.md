# Synthetic evidence 05 — EU route change record

**Observed:** 2026-10-06 09:29 UTC

**Source:** Edge configuration change record `chg-eu-2048`

The `eu-west-1` route for `POST /orders/submit` changed at 09:16:42 UTC:

```text
before: upstream=checkout-v1-eu, weight=100
after:  upstream=checkout-v2-eu, weight=100
```

The record identifies this as the only edge route change for the endpoint between 09:00 and 09:24 UTC. It lists deployment request `rollout-842`, but includes no incident response approval or rollback entry.
