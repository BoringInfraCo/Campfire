Investigation complete and recorded. The prior shift's payments-connection hypothesis was refuted and withdrawn; the supported cause is the route cutover to an upstream with zero healthy endpoints.

Cause: chg-eu-2048 (rollout-842) moved eu-west-1 `POST /orders/submit` to `checkout-v2-eu` at 09:16:42 UTC; that upstream had zero registered/healthy endpoints (rollout paused before EU endpoint registration), so the edge returned `no_healthy_upstream` 503s starting 09:17:11. The payments DB wait belonged to `settlement-export`, not `checkout-api`.

Campfire objects created/changed (workspace `ws_8ac7734081754950`):
- Session: `ses_48421111760a486f`
- Artifacts: `art_7f525e1d87544f48` (01), `art_504640121a4942fb` (03), `art_77c933497e9e4552` (04), `art_ece5ac999e3647b2` (05), `art_b0598ec9c7bd43de` (06) — plus existing `art_99c0826af0814f97` (02)
- Findings: symptom `find_ddd41c03c6624470`; facts `find_985de55d52f44a66`, `find_bfefeee8f5864646`, `find_63adc11dc89749a2`, `find_4e0f04e4cc304b98`, `find_70ca0c8f745d47e5`; cause `find_b700efa3c5ba42c3`; withdrawn prior hypothesis `find_b77e52e19b884d58`
- Decision (proposed, not accepted): `dec_12821ac6eed34c4f`
- Tasks (open): `task_9e009a9a9e994297` (next action), `task_35b93469d82d48e4`, `task_897d2d76205448f9`

Next action for on-call: await IC approval of `dec_12821ac6eed34c4f`, then revert `chg-eu-2048` to restore `checkout-v1-eu`. No decision was accepted and no production change was made.
