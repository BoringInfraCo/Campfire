# Campfire — Sprint 019 Result: Carry the Work Out

**Status:** Complete
**Decision:** GO
**Date:** September 28, 2026
**Release:** not tagged, not published, not deployed. Target remains `v1.7.0`.

---

## 1. Outcome

Sprint 019 is **GO**.

A qualifying Campfire mutation commits the object change, its Contribution, and
one domain event together. After that commit, one operator-configured webhook
receives the signed event. A failed delivery does not undo the Campfire write.
Retries keep the same event id. Core does not name Slack, Linear, GitHub, or
email.

This is not Gate B, Gate C, or Gate F. Delivery is not repeat use, and it is
not permission to change an external system.

---

## 2. Review remediation

Two independent review rounds recommended **CONDITIONAL GO** until four gaps
were closed. All four are addressed, the trace was rerun, and the result is
promoted back to **GO**.

1. **Hosted delivery state is now inspectable.** The Worker/D1 instance serves
   the same redacted bridge report at `GET /v1/bridge`. `campfire bridge` calls
   that route when `CAMPFIRE_URL` is set and reads the local SQLite outbox
   otherwise. The trace inspects the hosted report and the hosted CLI path.
2. **Pending rows are bound to their destination.** Every queued delivery
   stores a SHA-256 fingerprint of the bridge id, URL, and signing secret at
   queue time (non-secret, not reversible). SQLite and D1 list and claim only
   rows whose fingerprint matches the configured destination. Rows queued
   before the fingerprint migration are marked `exhausted` instead of being
   sent to a destination they were not queued for. The trace reuses the bridge
   id with a second receiver while the failed finding is pending and shows
   nothing is sent there before the original destination is restored.
3. **Webhook URLs are redacted from status output.** The shared report builder
   reports only scheme, host, and port. JSON and text output never include the
   path, query, raw URL, or secret. Delivery diagnostics also reduce any URL to
   its origin before the bounded error is stored. Sentinel tests cover the
   report builder, the Worker route, and the trace CLI output.
4. **Bridge inspection uses a distinct operator credential.** The hosted route
   requires `CAMPFIRE_BRIDGE_TOKEN`, an instance-operator credential that is
   not an actor token. Resolving a human identity is not operator
   authorization: an unrelated human, the owning human, and an agent are all
   refused with `401`, and the route fails closed with `503` when the
   credential is unset. Regression tests cover an unrelated human on both the
   Worker handler and the local listener. The Worker also accepts API routes
   under the production `/campfire` zone-route prefix, so a hosted
   `CAMPFIRE_URL` can be either an origin root or that prefix.

---

## 3. Trace

`tests/integration/sprint-019-webhook.test.ts` starts the local Campfire HTTP
server and a receiver in a separate Node process.

An authorized human recorded a finding, proposed and accepted a decision, and
moved a task to `blocked`. The receiver got `finding.recorded`,
`decision.proposed`, `decision.accepted`, and `task.blocked`. Each signature
matched HMAC-SHA256 over the timestamp and the exact body.

The receiver answered 500 to the first POST. That finding stayed committed.
While its delivery was pending, the same bridge id was pointed at a second
receiver; nothing was sent there. Restoring the original destination delivered
the same event id on the next attempt (`attemptCount` 2). A finding in a
workspace that was not allowlisted, and a `task.completed` event that was not
allowlisted, were not delivered.

The configured URL carried a path and query sentinel. `GET /v1/bridge` with the
instance operator token returned the report with origin only; the same report
was fetched through `campfire bridge --json` both locally and with
`CAMPFIRE_URL` set. The owning human token, an unrelated human token, and an
agent token were all refused with `401`. No report or request body contained the
signing secret, the bearer token, the URL sentinels, or the transcript
sentinel. Reopening the database still showed the delivered rows.

The trace is an automated receiver. It is not a message in Slack or an issue
in Linear.

---

## 4. What shipped

- Closed vocabulary: `finding.recorded`, `decision.proposed`,
  `decision.accepted`, `task.blocked`, `task.completed`, `goal.completed`,
  `artifact.attached`, `workspace.completed`.
- SQLite migration v3 and D1 `migrations/0002_domain_events.sql`; SQLite v4 and
  D1 `migrations/0003_webhook_fingerprint.sql` bind queued rows to their
  destination and quarantine pre-fingerprint queued rows.
- D1 writes inside a service transaction are sent as one `db.batch`.
- Webhook config is five environment variables. Nothing is subscribed by
  default. Agents have no MCP tool for it.
- Signature header `X-Campfire-Signature: v1=<hex>`. Redirects are not followed.
  Timeout is 10 seconds. Five attempts, then the row is `exhausted`. Waits
  after the first four failures are 1s, 2s, 4s, and 8s.
- Delivery rows store a non-secret destination fingerprint (bridge id + URL +
  secret hash). A changed URL or secret stops pending sends until the exact
  configuration is restored.
- `campfire up` / `campfire serve` pumps deliveries. The Worker runs the same
  pump with `waitUntil` and a `*/5 * * * *` cron. Neither path is a machine
  daemon.
- `campfire bridge` is the operator inspection command. It reads SQLite
  locally, uses `GET /v1/bridge` when `CAMPFIRE_URL` is set, reports the webhook
  origin only, and requires the `CAMPFIRE_BRIDGE_TOKEN` instance-operator
  credential — never an actor token — in hosted mode.

---

## 5. Validation

- `npx tsc --noEmit` passed.
- `npm test`: 42 files, 460 tests passed.
- `git diff --check` passed.
- The existing suite passes with no webhook configured.

Not done in this session: remote D1 migration, Worker deploy, tag, or public
release. The Worker scheduled function was executed against a fake D1 binding,
not production.

---

## 6. Canon

Architecture, Roadmap, and the operator runbook describe the outbox, the
fingerprint, the inspection path, and the webhook boundary. Product Definition
and Vision are unchanged. Gate B, Gate C, and Gate F stay unmeasured.
