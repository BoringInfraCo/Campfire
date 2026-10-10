# Sprint PSA-001 — Result

**Contract:** `docs/Campfire-v1.15-PSA-001-Performance-and-Security-Hardening.md`

**Audit:** `docs/SPRINT_PSA_001_AUDIT.md`

**Date:** October 9–10, 2026

**Base:** local `main` at `1a3457e` (v1.14.0 published)

**Verdict: GO as an engineering candidate.** All five scope items are implemented
and verified. This is **not** a release or deployment authorization; §5 of the
contract reserves those to their own promotion checks. No Gate B, Gate C, or
production performance claim is made.

---

## 1. What changed

| Item | Audit | Change |
| --- | --- | --- |
| Viewer Host boundary | S1 | `src/viewer/server.ts`: `isAllowedViewerHost` rejects any `Host` that is not the bound address/port or a loopback spelling, before static, generated, and API routes |
| Worker body bound | S2 | `src/worker/handler.ts`: `readBoundedBody` counts bytes while streaming and cancels past 1 MiB, replacing `request.text()` |
| Error boundary | S3 | Node HTTP, Viewer, and Worker 500s return fixed bodies; operator logs retain route/stage and failure kind without arbitrary exception text |
| Bounded delivery | P1 | `LIMIT` in both the SQLite and D1 due-delivery reads; Worker and Node HTTP schedule immediate sweeps only after successful delivery-eligible writes |
| Dependencies | §2.5 | MCP SDK `1.30.0` → `1.32.1`; wrangler `4.131.1` → `4.149.0`; lockfile refreshed |

---

## 2. Verification against contract §3

### Security regression

| Requirement | Result |
| --- | --- |
| An unrelated `Host` receives no actor-bound Viewer data | **PASS** — `POST /api/call`, the static shell, and the generated page all return 403 with no workspace id or name in the body |
| Valid loopback host forms continue to work | **PASS** — `127.0.0.1:port`, `localhost:port`, `LOCALHOST:port` all return 200 with data |
| A synthetic internal error string never appears in a 500 body | **PASS** — `audit-private-path/db.sqlite` absent from Viewer and Node HTTP 500 bodies |
| A Worker call with omitted or false `Content-Length` stops at the cap | **PASS** — both rejected 400 |
| Valid calls still dispatch | **PASS** — `whoami` still returns 200 |

### Delivery regression

| Requirement | Result |
| --- | --- |
| Backlog > one batch fetches at most the batch size per sweep | **PASS** — 60-row backlog returns exactly 20 |
| Drains across scheduled sweeps | **PASS** — second sweep resumes at row 20, not row 0 |
| Preserves claim/retry and deduplication | **PASS** — no delivered row is re-offered; claim/retry suite unchanged (952 → 981, no regressions) |
| A read-only Worker request schedules no delivery sweep | **PASS** — authenticated `whoami` through `POST /v1/call` produces zero `waitUntil`; installer and unauthenticated Viewer API reads also produce none |
| Scheduled retry sweep retained | **PASS** |
| Immediate delivery after a successful write retained | **PASS** |

### Suite and toolchain

`npm run typecheck` · `npm test` (981 tests / 81 files) · `npm run build` ·
`npm run deploy:dry-run` · `npm audit --omit=dev` (**0**) · `npm audit` (**0**).

---

## 3. Performance evidence

`scripts/psa-001-delivery-bench.ts` (repeatable; 20 iterations, in-memory SQLite):

| Workload | Rows read before | Rows read after | Median before | Median after |
| --- | --- | --- | --- | --- |
| Empty queue | 0 | 0 | 0.002 ms | 0.017 ms |
| Backlog (10,000 due) | 10,000 | **20** | 7.458 ms | **1.515 ms** |

**Claimed:** for a 10,000-row backlog, one sweep reads 20 rows instead of 10,000.
Query count per sweep is unchanged at 1 — the bound is on rows, not round trips.

The latency ratio is **not claimed as a stable figure.** Repeat runs of the same
benchmark on the same machine ranged from 4.76x to 5.51x; the table above is one
run, recorded as-is. The rows-read reduction is the stable result and is what this
sprint asserts. Latency on an in-memory SQLite fixture is dominated by row
materialization, so the ratio tracks the 500x row reduction only loosely.

**Not claimed:** this is local SQLite. It is not a production D1 measurement, not
a full pump benchmark, and not evidence of any production latency change. The
row-count reduction is the figure that transfers: on D1, rows read are rows
billed. No production observation was available for this sprint.

The empty-queue case is a wash (0.002 → 0.017 ms). The bound costs a negligible
constant there; it is only meaningful under backlog.

---

## 4. Bugs found and fixed along the way

1. **`fetch` silently strips the `Host` header.** The first draft of the S1
   regression tests used `fetch`, and passed *vacuously* — undici drops `Host` as
   a forbidden header name, so every request arrived with the real listening
   address and the boundary was never exercised. Fixed by driving the Viewer with
   a raw `node:http` client, which is also what a real rebinding attacker does at
   the socket level. **Any future Host-boundary test must not use `fetch`.**
2. **Node's HTTP parser rejects a Host-less HTTP/1.1 request itself** (400, before
   the handler). The test asserts the accurate outcome rather than pretending the
   handler rejects it.
3. **An empty-string `Host` is substituted by Node's client** before reaching the
   socket, so it cannot be tested through the normal client path; the Host-less
   case is covered over a raw socket instead.
4. **Batch size reaching SQL is untrusted input.** `normalizeDeliveryLimit` clamps
   it: in SQLite `LIMIT -1` means *no limit*, which is precisely the unbounded read
   this sprint removes. An explicitly configured positive batch size is retained.
5. **A successful `/v1/call` read still scheduled delivery.** The first sweep
   guard checked only HTTP routes, so the main API still ran a D1 delivery query
   for every authenticated read. Immediate sweeps now follow only the seven
   methods capable of writing a Sprint 019 domain event. The Node HTTP adapter
   uses the same guard.
6. **`--allow-remote` on a loopback bind bypassed Host validation.** The guard
   now follows the actual bind address. An explicit non-loopback bind remains
   available; supplying the flag while bound to loopback no longer disables
   its DNS-rebinding protection.
7. **Raw exception text reached operator logs.** It could contain a credential
   or workspace content. Unexpected failures now log stable route/stage and
   failure kind, and the regression asserts the synthetic private string is
   absent from the log as well as the response.
8. **The benchmark fixture claimed strictly increasing timestamps but wrapped
   seconds after the first minute.** It now advances one millisecond per row;
   the before/after numbers above were rerun with that fixture.

---

## 5. Notes, limits, and judgment calls

- **The Host check is loopback-scoped.** It applies whenever the listener is
  bound to loopback, including when `--allow-remote` is supplied. With an actual
  non-loopback bind, the Viewer may be reached by a name the process cannot
  know, so that path remains the operator's explicit choice and is tested
  separately.
- **The Worker write hook is a callback, not a response flag.** `onWriteCommitted`
  fires after a committed mutation. Keeping it out of the response type is
  deliberate: delivery scheduling is an operational side effect and must not
  become part of the client's response contract. A throwing callback cannot change
  a committed write's outcome.
- **Enrollment redeem does not schedule a sweep.** It records participants and
  contributions in an existing workspace, without writing a domain event or
  webhook delivery.
- **Deliberate typed errors are unchanged.** `CampfireError` responses remain
  specific and client-facing (a read-only rejection is still
  `403 Unauthorized`); only *unexpected* exceptions became generic.
- **The installer 502 was also genericized.** It embedded a raw asset-binding
  error message — the same disclosure class as the 500s, found while working in
  that file.
- **SDK reachability.** Grep alone was not trusted for the dependency
  disposition; the SDK's real ESM import graph was walked from Campfire's five
  entrypoints and confirmed unreachability of the express/OAuth paths, then
  verified by inspecting `require.cache` after an actual import. `fast-uri` *was*
  genuinely reachable (via the ajv provider used by `client/index.js`) and is now
  patched.
- **No MCP API change.** All six imported SDK subpaths still resolve under
  `1.32.1`; an in-memory MCP round-trip (`registerTool` + linked transport) was
  executed against the new version, and the 981-test suite includes the full MCP
  compatibility set.

---

## 6. What this sprint does not establish

- No production latency, traffic, or D1-cost measurement.
- No browser exploit proof against a deployed user. The audit's own limit stands:
  the S1 tests prove server behavior under an attacker-chosen `Host`, not a
  complete DNS-rebinding chain in a real browser.
- No release, deployment, or version bump. `package.json` remains `1.14.0`.
- No new workspace object, authorization rule, Viewer method, generated-page
  capability, caching layer, or schema rewrite.
