## WOW-001 S1 Incident — `ws_03abec922ce74395`

Read-only inspection; no Campfire writes made. Goal `goal_b872e22fc4464b5d` ("Investigate the incident and record supported work"). Actor is the "Continuing Agent" `agt_07f5fbc83acf4679`; I have no active agent session (preflight returned `register_agent_session`), so this is an unregistered read.

**What happened**
Elevated HTTP 503s on `POST /v1/checkouts` in us-east-1, first seen in the 5-min window ending 2026-09-18T09:15Z (3078 503s, ~10.3% of ~30k requests), reaching 3154 at 09:20Z; `GET /health` unaffected (`find_487c49f010e2462f`, artifact `art_7cde44ac92ff4e47`). The 503s are confined to revision `order-api-r184`: ~40% error rate vs ~0.4% on `order-api-r183`, which matches pre-rollout baseline (`find_bdd8be12049749aa`, `art_fee50746f4304069`). Onset coincides with r184 first taking traffic; the rollout (started 09:10Z, target 25%) was paused at 09:22Z but r184 was still serving 25% (`find_115021c202d04b63`, `art_65daedc5950c46c5`).

**What the team currently believes the cause is**
Most likely application connection-pool exhaustion in r184, not DB capacity: r184 is configured `DB_POOL_MAX=4` vs r183's 24 (`find_122fad635ca64392`); r184 pods are saturated (in_use=4, pending 38–44, `pool_wait_p95_ms=3000` equal to `CHECKOUT_TIMEOUT_MS=3000`, ~291–322 pool-wait timeouts/min) while the database stayed healthy (cpu ~31–34%, 181–188 free connections, 0 errors) (`find_f9bfdcfb99e04917`, `find_0bea8b50bf5f4db5`, `art_21329a1f063e4eed`, `art_ab369b6019b548a8`). Synthesis is `find_67bfd43a9081400e`, confidence 0.85, explicitly inferred from correlational metrics, not confirmed by error logs/traces.

**Recorded response and its actual decision status**
Proposal `dec_948d10692b3f4595`: shift all us-east-1 order-api traffic off r184 back to r183 and keep the rollout paused until r184 is fixed. **Status: `proposed` only — not accepted.** `acceptedDecisions` is empty; no production change has been authorized, and the rationale itself says do not execute without explicit approval. It cites `find_487c49f010e2462f`, `find_bdd8be12049749aa`, `find_115021c202d04b63`, `find_67bfd43a9081400e`, `find_6eb550ba79804a86`.

**Next action**
`task_6c5227845eff4695` (open, assigned to human owner `hum_ad7b513a4a9747bf`): obtain explicit authorized accept/reject of `dec_948d10692b3f4595` with a reason; an agent must not approve its own proposal and no rollback/config change may run beforehand. Four supporting tasks are open, all assigned to `agt_07f5fbc83acf4679`: `task_0c8d6277cee64ce0` (get r184 error logs/traces), `task_41e32820aca84e8b` (find why DB_POOL_MAX=4; prepare corrected config), `task_5c0de7b1fa00453a` (customer impact / possible lost or double-charged checkouts), `task_dd4149e1cb474603` (post-mitigation verification: 503 rate back to baseline and r184 pool timeouts 0 for ≥15 min).

**Remains uncertain / needs review** (`find_6eb550ba79804a86`, confidence 0.7)
1. Why r184 set `DB_POOL_MAX=4` — not established by evidence.
2. Whether pausing at 09:22Z stopped 503 growth — unconfirmed; evidence ends 09:24Z.
3. Whether any checkouts were lost or double-charged — unknown.
4. No application error-log/trace artifact available, so the failure is inferred from metrics correlation only (the 0.85 cause finding is not independently confirmed).

**Governance note:** goal, findings, decision, tasks, and artifacts were all authored by `agt_4c8b57d1b1a04528` (Incident Investigator); this workspace also has no approved decision or human acceptance recorded yet, so the recorded response is a proposal pending owner review.
