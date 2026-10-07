# S3 — Export requests timing out in IAD

This is a synthetic incident. All times are UTC on 2026-09-18. You are the on-call investigator for the Atlas Reports API. The incident lead is unavailable during this investigation; no one has approved a remediation or a response decision. Investigate the supplied evidence, record the work in the assigned Campfire workspace, and leave the next investigator enough state to continue. Do not change production systems.

The `/v1/exports` endpoint creates a downloadable report. Support reports that some customers using the IAD region receive a timeout while requesting an export. Ordinary dashboard reads appear to work for the reporters. The available evidence is limited to the files below; further diagnostic results are not yet available.

Evidence supplied to the investigator:

- `evidence/support-report.md` — timestamped customer observations.
- `evidence/gateway-requests.csv` — a small request sample and a regional aggregate.
- `evidence/database-metrics.csv` — aggregate database latency measurements.
- `evidence/trace-coverage.md` — current application trace coverage and one sampled successful request.

The next shift starts at 10:30 UTC. Leave an actionable next step and distinguish a proposed response from an approved one.
