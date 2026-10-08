## Campfire workspace `ws_50a315301f434e6b` — "WOW-001 S2 Incident"

Goal: *Investigate the incident and record supported work* (`goal_d78872738e9a43b6`), created by the human owner.

### What happened
EU traffic to `POST /orders/submit` in eu-west-1 began failing with HTTP 503. The first 503 is at 09:17:11 UTC, immediately after a 09:16:42 UTC edge route cut; the alert `eu-orders-submit-5xx` fired at 09:21 UTC (`art_86b4240e93a54ecb`, evidence 01).

### What the team currently believes the cause is
Current root-cause finding `find_392e265849f54d51` (confidence 0.85): route change `chg-eu-2048` (deployment `rollout-842`) switched the upstream at 09:16:42 from the healthy `checkout-v1-eu` (six healthy endpoints) to `checkout-v2-eu`, which had **zero registered/healthy endpoints** (`rollout-842` was `paused_before_eu_endpoint_registration` at 09:14). The edge returned `503 no_healthy_upstream` before any application span. Supporting artifacts: `art_00f561834b4146be` (05 route change), `art_494a6713c74d43c3` (06 upstream health), `art_fd813e3ccb8347b0` (04 edge traces).

The prior shift's hypothesis (checkout-api waiting on a payments PostgreSQL connection, `find_bc3248b208ac44c2`) was **corrected/refuted** into `find_c2833b67250e4e81` (confidence 0.2). Its contradicting evidence cites `art_991a453966b944d9` (03 DB client breakdown — checkout-api DB wait was normal 17–23 ms; the aggregate rise came from settlement-export) and `art_fd813e3ccb8347b0` (04 — 503s emitted at the edge with no checkout-api/DB span). The original aggregate dashboard `art_6a8f00f63d49483f` (02) was confounded.

### Recorded response and its actual decision status
Decision `dec_f09b0b6a950d4c0b`: revert the eu-west-1 `POST /orders/submit` route from `checkout-v2-eu` back to `checkout-v1-eu`, and keep `rollout-842` paused until `checkout-v2-eu` registers healthy endpoints. It cites `find_392e265849f54d51` (`cit_382ac7cae7404800`). **Status: `proposed` only — not accepted and not executed.** `acceptedDecisions` is empty; it appears in `needsYou` as `proposed_decision_actionable`.

### Next action
Open task `task_bfe056ab4e9349d7` (assignee `agt_9d67e3f667294acd`): incident commander reviews `dec_f09b0b6a950d4c0b`; on approval, execute the rollback, keep `rollout-842` paused, and verify the `eu-orders-submit-5xx` rate returns to baseline. It explicitly says no production change is authorized without explicit approval.

### What remains uncertain / needs review
- Root cause is confidence 0.85, not certain; not independently corroborated beyond the four cited evidence artifacts.
- The response is unapproved — an incident commander must review/accept the proposed decision before any production change; nothing is authorized or executed.
- The prior-shift finding was corrected (reason: per-service DB split and edge traces refuted it); the aggregate DB panel's settlement-export confound should not be re-used as evidence.
- An alternative path is recorded: if `checkout-v2-eu` is intended to serve, complete `rollout-842` endpoint registration before re-cutting — never re-cut to an upstream with zero healthy endpoints.

No Campfire state was modified.
