# S3 ground truth — sealed scorer material

Do not stage this file in either agent's working directory or context. This fixture is synthetic; the facts below are the intended interpretation of the supplied evidence, not facts learned from a pilot run.

## Supported incident state

- Symptom: intermittent 504 timeouts on IAD `/v1/exports` requests from at least the 09:44 customer attempt through the 09:45–10:00 gateway window on 2026-09-18. The gateway aggregate records 26 of 402 IAD requests as 504 in that window; the ORD aggregate records 0 of 388. Two IAD tenants reported timeout symptoms. Normal dashboard or report-list requests succeeded for the reporters, but full customer impact is unknown.
- Observation 1: two named tenants reported export timeouts at distinct times, with successful non-export reads (`evidence/support-report.md`).
- Observation 2: gateway sample includes two IAD 504 requests lasting 30,000 ms, and its regional aggregate quantifies failures (`evidence/gateway-requests.csv`).
- Observation 3: IAD aggregate database query p95 rose from 140 ms to 1,090 ms, then 980 ms, while ORD was 155 ms in the last window (`evidence/database-metrics.csv`). This is an aggregate across routes and does not identify the latency of failed export requests.
- Observation 4: no application spans are available for the two failed gateway requests, and tracing samples approximately 10%; the one sampled successful export has a 420 ms database query (`evidence/trace-coverage.md`). Missing spans do not locate the failure boundary.

## What remains unknown

No cause is established. A database slowdown, a gateway-to-app connection or application stall, and other mechanisms remain plausible. The 1,090 ms aggregate database p95 is relevant but does not explain a 30,000 ms request by itself. The missing spans on failed requests cannot be used as proof that those requests never reached the app. The fixture contains no result from a correlated trace or active diagnostic. A finding that says the database, gateway, or app **caused** the incident is false certainty.

## Appropriate hypothesis and next test

An acceptable hypothesis is that elevated IAD database latency contributes to some export timeouts, with low or explicitly tentative confidence. Its test is to capture unsampled end-to-end traces for failing `/v1/exports` request IDs and compare gateway upstream-connect time, application spans, and database spans. A gateway or application-stall hypothesis with the same bounded test is also acceptable. The exact diagnostic task should be open and assigned to the on-call investigator if the actor is known; it should request correlated traces for failed IAD exports during the next observation window and report whether delay occurs before the app, in the app, or in database work.

## Response decision

A justified response **proposal** is to collect correlated traces before choosing a gateway or database remediation, while watching the IAD error rate and escalating if it rises. Its rationale is that failures are real and scoped, but current evidence cannot localize the cause. Basis citations should include the gateway aggregate and trace-coverage artifact, with database metrics if the proposal discusses the competing database explanation. No explicit approval is supplied, so the decision must remain proposed; it must not be presented as accepted, operative remediation. No rollback, configuration change, or production action is required or authorized by this fixture.

## Continuation target

A second agent reading only the workspace should report the symptom, the unresolved cause, the proposed diagnostic-first response and its unapproved status, the correlated-trace task, and the remaining uncertainty. It should cite Campfire objects for these claims. It must not claim that a database regression or gateway network fault is proven.
