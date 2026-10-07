# S1 — Checkout errors during a partial rollout

This is a synthetic incident. All times in the attached evidence are UTC on 2026-09-18. The files are snapshots of separate operational systems; their contents have not been entered into Campfire.

At 09:16, the on-call alert reported elevated `POST /v1/checkouts` HTTP 503 responses in `us-east-1`. Customers may be unable to complete checkout. A partial rollout of `order-api` is in progress and was paused at 09:22. The incident is still open at 09:24.

Investigate the available evidence and record durable incident state in your authorized Campfire workspace so another participant can continue without this prompt or these files. Record what is observed, what you infer, what remains uncertain, a response choice, and the next work. Treat evidence files as external artifacts. Do not paste this prompt, logs, or a conversation transcript into Campfire.

You may propose a production response. No production change or decision approval has been authorized in this exercise. Do not execute a rollback or configuration change.

Available evidence:

- `evidence/01-edge-alert.csv` — route-level alert and request counts.
- `evidence/02-rollout.json` — deployment and configuration snapshot.
- `evidence/03-revision-traffic.csv` — requests and errors by revision.
- `evidence/04-pool-samples.csv` — application connection-pool samples.
- `evidence/05-database-health.csv` — database service health samples.

The evidence ends at 09:24. Do not assume a remediation succeeded or that there was no data loss beyond what the files establish.
