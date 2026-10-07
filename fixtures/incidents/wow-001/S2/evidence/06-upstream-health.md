# Synthetic evidence 06 — EU upstream health snapshot

**Observed:** 2026-10-06 09:31 UTC

**Source:** Edge upstream health snapshot and rollout status for `rollout-842`

At 09:16–09:30 UTC, `checkout-v2-eu` has zero registered endpoints and zero healthy endpoints. The rollout status says `paused_before_eu_endpoint_registration` at 09:14 UTC. During the same interval, `checkout-v1-eu` has six registered endpoints, all healthy. A synthetic edge probe routed explicitly to `checkout-v1-eu` at 09:30 UTC returned HTTP 200; a probe routed explicitly to `checkout-v2-eu` returned HTTP 503 with `no_healthy_upstream`.

These are diagnostic probes. They did not change the live customer route.
