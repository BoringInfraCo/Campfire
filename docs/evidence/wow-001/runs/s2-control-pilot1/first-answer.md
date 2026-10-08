Investigation and record complete.

**Conclusion:** The prior shift's hypothesis is refuted. Root cause is the edge route change `chg-eu-2048` at 09:16:42 UTC, which moved eu-west-1 `POST /orders/submit` from the healthy `checkout-v1-eu` to `checkout-v2-eu` — an upstream with zero registered/healthy endpoints (`rollout-842` paused before endpoint registration) — so the edge returned `503 no_healthy_upstream` before any application span. The payments-DB connection panel rose because of `settlement-export`, not `checkout-api`.

**Campfire objects I created:**
- Session: `ses_045b424ccb43467e`
- Artifacts: `art_86b4240e93a54ecb` (01), `art_991a453966b944d9` (03), `art_fd813e3ccb8347b0` (04), `art_00f561834b4146be` (05), `art_494a6713c74d43c3` (06)
- Finding (root cause): `find_392e265849f54d51`
- Finding (correction successor): `find_c2833b67250e4e81`
- Decision (proposed, not accepted): `dec_f09b0b6a950d4c0b` + basis citation `cit_382ac7cae7404800`
- Task (next action for on-call): `task_bfe056ab4e9349d7`

**Changed:** `find_bc3248b208ac44c2` corrected (superseded by `find_c2833b67250e4e81`).

The proposed rollback decision is left in `proposed` state for incident-commander approval; no production change was made.
