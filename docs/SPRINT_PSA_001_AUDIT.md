# Campfire — PSA-001 Performance and Security Audit

**Date:** October 9, 2026

**Source:** local `main` at `81876eb` (`v1.14.0` release record)

**Purpose:** select a bounded v1.15 sprint from observed code and dependency risks.

## Method and limits

Reviewed the local HTTP and Viewer adapters, the Workers fetch handler and configuration, the D1 and SQLite webhook delivery queries, the generated view boundary, the MCP entrypoint, and the production dependency tree. Ran `npm audit --omit=dev` against the npm registry. Used synthetic, loopback-only requests to verify two response-boundary findings; no user workspace data was read. This is a source and local-behavior audit. It does not measure production latency, traffic, D1 cost, or prove a browser exploit against a deployed user.

For the delivery read, an in-memory SQLite fixture with 10,000 due rows ran the current `SELECT` and a `LIMIT 20` variant 20 times each. The current query returned 10,000 rows at a 5.69 ms median; the bounded variant returned 20 at a 1.32 ms median. This is a local query comparison, not a measured production speedup or a complete delivery-pump benchmark.

## Confirmed findings

| ID | Priority | Evidence and impact | v1.15 disposition |
| --- | --- | --- | --- |
| S1 — Viewer accepts an unrelated Host | High | `src/viewer/server.ts` checks the **bind address** at startup but does not check each request's `Host`. A local synthetic `POST /api/call` with `Host: attacker.example` returned HTTP 200 and the bound actor's test response. This is a DNS-rebinding exposure if browser and network conditions permit the attacker-controlled origin to resolve to loopback. The test proves the server behavior, not a complete browser exploit. | Reject unexpected Host values before static, generated, and API routes on the default loopback Viewer. Cover IPv4, IPv6, localhost, and the actual listening port. Keep the explicit remote-bind contract separately documented and tested. |
| S2 — Worker buffers a body before enforcing the cap | High (availability) | `src/worker/handler.ts` `readJsonBody` checks the declared length, then calls `request.text()` and checks the received byte count only afterward. An absent or understated `Content-Length` can cause a body much larger than 1 MiB to be buffered and decoded first. The telemetry and enrollment paths already demonstrate streaming bounded reads. [Cloudflare documents a Worker memory limit and failure on excessive buffering](https://developers.cloudflare.com/workers/platform/limits/). | Enforce the byte cap while reading the stream; cancel once exceeded. Verify absent and false length headers, multibyte content, malformed JSON, and unchanged valid requests. |
| S3 — Unexpected exception text reaches clients | Medium | The catch-all handlers in `src/http/server.ts`, `src/viewer/server.ts`, and `src/worker/handler.ts` return `error.message` in HTTP 500 responses. A synthetic Viewer dependency error containing `audit-private-path` appeared verbatim in the response. Runtime, database, or filesystem details could be disclosed when such an error occurs. | Return a stable generic 500 body. Preserve actionable diagnostics only in an operator channel with no credentials or workspace content. Keep typed `CampfireError` responses that are intentionally client-facing. |
| P1 — Webhook pump reads every due row and runs after every Worker request | Medium | `src/worker/index.ts` attaches `deliverPending` to every fetch, including reads and public installer requests, while a five-minute scheduled trigger also exists. When the bridge is configured, the pump queries D1. Both `src/worker/d1-store.ts` and `src/store/sqlite-store.ts` select **all** due delivery rows and only then does `pumpWebhookDeliveries` stop after its default 20 claims. A backlog therefore makes each eligible request read and map unbounded rows. | Bound the SQL batch, preserve oldest-due ordering and retries, and trigger request-time delivery only after a successful state change that can enqueue work. Keep the scheduled retry path. Compare D1 query count and rows read before/after on a representative backlog. |

## Dependency triage

The production dependency audit reported **four advisories**: one critical (`proxy-addr`), one high (`@modelcontextprotocol/sdk`), and two moderate (`ip-address`, `fast-uri`). The installed paths all lead through `@modelcontextprotocol/sdk@1.30.0`. The [SDK advisory](https://github.com/advisories/GHSA-6qxp-vccf-f47h) explicitly says MCP servers and stdio clients are unaffected by its OAuth-client issue; Campfire imports the SDK server and stdio transport, not its OAuth client. The `proxy-addr` alert is under the SDK's Express dependency; Campfire does not mount that Express server. These package alerts are real maintenance findings, but this audit has **not** established an exploitable Campfire route for them. Upgrade the SDK to a patched compatible version and resolve reachable transitive advisories, then rerun the full MCP compatibility suite and production audit. Do not equate the package severity labels with Campfire exposure without a reachable path.

The full audit, including development tooling, reported **nine package alerts total**: the four above plus `wrangler`, `miniflare`, `sharp`, `source-map-js`, and `undici`. They are not automatically shipped runtime paths, but the release and local test tools still need a compatible patch update and validation. `npm audit` marks fixes available for all nine packages; no lockfile was changed in this audit.

## What was checked without a finding

- Actor identity for hosted calls is resolved from bearer credentials, not caller-supplied actor IDs. Worker `/api` reads require a bearer; the local Viewer keeps its credential server-side and its method allowlist is read-only.
- The v1.14 generated page escapes contributed text, has a restrictive CSP, makes one authorized context read, and stores no page or Contribution. Existing integration tests cover denial and hostile markup.
- Local HTTP and Viewer request readers already enforce their 1 MiB cap while streaming. The Worker telemetry and enrollment readers do likewise. S2 is specific to the general Worker call reader.
- The context page size is bounded at 100 and key workspace query paths have index-plan tests. No context-read regression is claimed without representative timing and D1 query measurements.

## Audit outcome

Create a **bounded v1.15 hardening sprint** for S1–S3 and P1, plus compatible dependency remediation. Measure the webhook work before claiming a performance gain. Avoid unrelated Viewer features, schema/domain changes, or speculative caching. No product code was changed by this audit.
