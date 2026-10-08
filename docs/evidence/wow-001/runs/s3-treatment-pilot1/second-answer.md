## What happened
Customers in region **IAD** received gateway timeouts (HTTP 504) when creating exports (`POST /v1/exports`), while ordinary dashboard/report-list reads succeeded. Earliest failure 09:44 UTC; aggregate window 09:45–10:00 UTC. Scope was IAD-only as observed. (`find_4834f659837b4366`) Two sampled IAD requests returned 504 at exactly the 30000 ms gateway upstream timeout (`find_7267d5d770a94f53`); aggregate was 26/402 IAD export 504s vs 0/388 in ORD (`find_128ca2d0ca984431`).

## What the team currently believes the cause is
It is **not established**. The recorded conclusion is that evidence supports only "IAD-scoped failures time-coincident with a ~7x IAD DB p95 elevation," with no correlated gateway+application+database trace for any failure (`find_5c5b5222d8d34862`). Two live hypotheses:
- Elevated IAD DB latency contributes — *not established*, confidence 0.35 (`find_59e9cd2eb5cd4c9a`). DB p95 rose 140→1090→980 ms, but is all-routes aggregate and ~1 s, far below the 30 s timeout (`find_bce58bec5aa242a1`).
- Failures stall before reaching the application, or spans simply weren't sampled — *inconclusive*, confidence 0.2 (`find_4228073accd84466`); absence of app spans for gw-084/gw-093 is uninformative at ~10% sampling (`find_2672022d7a6a46b1`).

## Recorded response and its actual decision status
Two decisions are recorded, **both only `proposed` — neither accepted**; `acceptedDecisions` is empty and no authorized actor has approved anything:
- `dec_82ef0d50fb394a8a`: acquire correlated end-to-end evidence (100% tracing + export-specific DB/pool metrics) before choosing remediation; no production change without incident-lead approval.
- `dec_44cd603a30a54b97`: proposed interim mitigation (bounded retry/backoff or async job + polling) to reduce customer-visible 504s — speculative about root cause.

Supporting artifacts: `art_6aa8bc75b3c74f73` (support report), `art_24d569d1427e486f` (gateway sample/aggregate), `art_039c358aaf434d7c` (DB metrics), `art_7546bacd9f654b9d` (trace coverage).

## Next action
The immediate next step is the open approval gate: `task_f9f0f12445ac45d2` — obtain incident-lead approval before any production change (assigned to `hum_e2f26110e7474afd`; not to be self-approved). In parallel, evidence-gathering tasks are open: `task_3f84f2537b5744a3` (capture correlated traces for failed IAD exports) and `task_31c304e8327b4f11` (export-specific DB latency/p99/pool metrics), both assigned to `agt_ee09d75ea6504e20`; `task_3ff4477d51344c7e` (confirm tenant retry outcomes and check other regions).

## What remains uncertain / needs review
- Whether failures occur inside the application or before it (`find_5c5b5222d8d34862`, `find_4228073accd84466`).
- Export-route-specific DB latency, p99, and connection-pool state — current data is all-routes p95 only (`find_bce58bec5aa242a1`).
- Whether the 30 s stalls are caused by DB, connection saturation, or another upstream dependency (`find_5c5b5222d8d34862`).
- Whether tenant retries (northstar/willow) succeeded, and whether non-IAD regions had unreported failures — the 10:02 "no other-region reports" is a report count, not zero-failure evidence (`find_4834f659837b4366`, `task_3ff4477d51344c7e`).
- Both decisions await explicit human acceptance; the interim mitigation is speculative and must not be applied.

No Campfire writes were made.
