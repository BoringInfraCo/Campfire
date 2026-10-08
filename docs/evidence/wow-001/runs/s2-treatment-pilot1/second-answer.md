Read-only inspection of `ws_8ac7734081754950` ("WOW-001 S2 Incident", goal `goal_0a4c6b645a3e4740`: "Investigate the incident and record supported work"). I made no writes.

## What happened
Customers in eu-west-1 submitting `POST /orders/submit` got HTTP 503s on 2026-10-06 from 09:17:11 UTC; the 5-min 503 rate rose from <0.2% to 21.8% (09:17–09:21), eu-west-1 only (`find_ddd41c03c6624470`, evidence `art_7f525e1d87544f48`). At 09:16:42 UTC edge change `chg-eu-2048` (`rollout-842`) switched the route from `checkout-v1-eu` (weight 100) to `checkout-v2-eu` (weight 100) — the only route change in 09:00–09:24 (`find_985de55d52f44a66`, `art_ece5ac999e3647b2`). `checkout-v2-eu` had zero registered/healthy endpoints (rollout paused before EU endpoint registration at 09:14) while `checkout-v1-eu` had six healthy endpoints (`find_bfefeee8f5864646`, `art_b0598ec9c7bd43de`). All three sampled failures were edge `no_healthy_upstream` 503s emitted before any checkout-api span, with no DB span (`find_63adc11dc89749a2`, `art_77c933497e9e4552`).

## What the team currently believes
Current, non-withdrawn cause finding `find_b700efa3c5ba42c3` (confidence 0.9): the 503s were caused by `chg-eu-2048`/`rollout-842` routing all eu-west-1 traffic to `checkout-v2-eu`, which had zero healthy endpoints because the rollout was paused before EU endpoint registration, so the edge returned `no_healthy_upstream`. The earlier prior-shift hypothesis that checkout-api was waiting on a payments PostgreSQL connection (`find_b77e52e19b884d58`) was **withdrawn/refuted**: split by service the elevated DB wait was settlement-export, not checkout-api (`find_4e0f04e4cc304b98`, `art_504640121a4942fb`).

## Recorded response and its actual decision status
`dec_12821ac6eed34c4f` proposes reverting `chg-eu-2048` so eu-west-1 `POST /orders/submit` routes back to the healthy `checkout-v1-eu`, keeping `rollout-842`/`checkout-v2-eu` out until EU endpoints register healthy. Its status is **`proposed` only** — not accepted, and no response has been approved or executed (the rationale states acceptance requires explicit incident-commander approval). Confirmed: `list_decisions` returns total 1, all proposed; `acceptedDecisions` and `supersededDecisions` are empty.

## Next action
`task_9e009a9a9e994297`: after explicit IC approval of `dec_12821ac6eed34c4f`, revert `chg-eu-2048` (do not execute before approval). Then `task_35b93469d82d48e4` (verify 503 rate returns below 0.2% and checkout-v1-eu stays healthy; correct the cause finding if the symptom does not clear).

## Uncertain / needs review
- Why the rollout/route advanced eu-west-1 traffic to a zero-healthy-endpoint upstream before EU endpoint registration, and the guardrail that should have blocked it — open `task_897d2d76205448f9`; also flagged unknown in `find_b700efa3c5ba42c3` detail.
- No live rollback / recovery verification yet (`task_35b93469d82d48e4`), and the proposed decision is unapproved.
- The payments DB dashboard artifact `art_99c0826af0814f97` only backs the now-withdrawn hypothesis; it should not be used as current cause evidence.

All three open tasks are assigned to `agt_23ebad7ddb924c71` (Continuing Agent), and the cause/response work was authored by `agt_55bd9c6044454837` (Incident Investigator).
