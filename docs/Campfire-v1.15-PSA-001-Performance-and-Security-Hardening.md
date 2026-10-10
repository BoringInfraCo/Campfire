# Campfire v1.15 — PSA-001: Bound Work and Protect Read Boundaries

**Status:** Proposed sprint contract after the October 9, 2026 audit. Implementation has not started.

**Audit:** `docs/SPRINT_PSA_001_AUDIT.md`

## 1. Goal

Make the shipped Campfire read surfaces resistant to avoidable disclosure and oversized requests, and keep webhook delivery work proportional to a bounded batch. Preserve existing authorization, provenance, delivery semantics, and the v1.14 generated view.

## 2. Scope

1. **Local Viewer Host boundary.** On the default loopback server, validate every request's `Host` against the actual listening address/port and supported loopback names before any route runs. Reject unrelated hosts, including requests to `/api/call` and generated pages. Test the documented explicit remote-bind behavior separately. Do not add browser credentials or widen the Viewer method set.
2. **Worker body bound.** Replace `request.text()` in the general Worker call reader with a streaming byte cap of 1 MiB. Cancel oversized bodies before full buffering. Match the local adapter's client-visible validation behavior where practical.
3. **Unexpected error boundary.** Return generic 500 responses from Node HTTP, Viewer, and Worker adapters. Do not include raw exception text, tokens, workspace content, or local paths. Keep deliberate typed client errors useful. Make internal failures inspectable by the operator without leaking private data.
4. **Bounded webhook work.** Limit due-delivery selection in SQLite and D1 to the pump's configured batch size, retaining order, lease recovery, retry, and no duplicate delivered event. Stop scheduling a delivery sweep after unrelated Worker reads and installer/telemetry requests; retain the scheduled retry sweep and immediate delivery after successful enqueuing writes.
5. **Dependency remediation.** Update the MCP SDK, Wrangler toolchain, and lockfile to compatible patched versions. Triage each remaining production advisory against the imported runtime path and keep development-tool advisories visible. Do not introduce an HTTP MCP server or OAuth client while remediating packages.

## 3. Verification

- Security regression: an unrelated `Host` receives no actor-bound Viewer data; valid loopback host forms continue to work. A synthetic internal error string never appears in a 500 body. A Worker call with an omitted or false `Content-Length` stops at the cap, while valid calls still dispatch.
- Delivery regression: a backlog larger than one batch fetches at most the configured batch size per sweep, drains across scheduled sweeps, and preserves claim/retry and deduplication behavior. A read-only Worker request schedules no delivery sweep.
- Performance evidence: record a repeatable pre/post local or D1-simulator workload with query counts, due rows read, and latency for an empty queue and a backlog. Claim an improvement only for the measured workload. Record production observations separately if available.
- `npm run typecheck`, `npm test`, `npm run build`, `npm run deploy:dry-run`, `npm audit --omit=dev`, and the full `npm audit` pass or have an explicit advisory disposition. Verify CLI/MCP, Viewer, HTTP, Worker, and release packaging compatibility before a release verdict.

## 4. Non-goals

No new workspace object, authorization rule, generated-page capability, artifact preview, highlight, playbook, or external integration. No broad caching layer or schema rewrite. This sprint does not claim Gate B, Gate C, user growth, or a production performance gain that was not measured.

## 5. Exit

GO only when the security and delivery regressions above pass, remaining production advisories have a recorded disposition, and the before/after workload shows bounded delivery work without a correctness loss. A release and deployment require their separate promotion checks.
