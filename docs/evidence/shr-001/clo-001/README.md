# CLO-001 operating evidence — October 25, 2026

**Result:** **PARTIAL.** Thresholds and an operator owner are recorded. Scoped
multi-tenant restore passed on a temporary D1
(`docs/evidence/shr-001/recovery/scoped-2026-10-25.md`). Notification policies
are active and each test call returned success. Per-team CPU, the 5% invitation
ratio, and D1 size growth remain native gaps. The physical iMac acceptance is
not part of this record.

**Owner:** the Campfire operator. Response time for an alert is 15 minutes.
Emergency controls are `CAMPFIRE_PUBLICATION_ALPHA` (new enrollment) and
`CAMPFIRE_ALPHA_EXPENSIVE_WRITES` (ongoing writes). Reads, revocation, and
recovery stay available when writes are paused.

## Recorded exercises

| Exercise | Threshold | Evidence | Result |
| --- | --- | --- | --- |
| Invitation abuse / load | 30 requests / 60 seconds / source on `INVITATION_RATE_LIMITER`. Above 5% limited, or any `unavailable`, is the alert line. | Rehearsal Worker probe recorded in `docs/RELEASE_V1_26_2_READINESS_REVIEW.md`: 100 requests, 43×401 then 57×429. Missing binding returns 503. | **PASS** for the edge burst limit. Not a durable per-account quota. |
| Usage report | Writes 300/UTC day, invitations 20/UTC day, content reads 3,000/UTC day. D1 growth above 256 KiB / 24h is the review line. | Isolated D1 24-hour snapshot in the readiness review: 1,139 queries read, 135 written, 4,144 rows read, 392 written, database 495,616 bytes. Enforced counters are `alpha_usage_buckets` (migration `0011`). | **PARTIAL.** No per-route Worker CPU report and no cost-per-team figure. |
| Tenant denial | A second tenant must not read, write, invite, or reuse another tenant's object ids. | `tests/worker/shr-001-publication.test.ts` and `docs/evidence/shr-001/step-0/THREAT-MODEL.md`. Rehearsal admission matrix: missing, wrong, and absent codes return 403; the per-source failure budget returns 429. | **PASS in tests and the rehearsal gate.** Not a production two-tenant drill. |
| Credential recovery | Recovery rotates the owner token and the recovery secret together. The old secret fails after commit. | `handlePublicationRecover` and `tests/worker/shr-001-publication.test.ts`, including the lost-response and simultaneous-recovery cases. | **PASS in tests.** |
| Restore drill | Full copy must preserve workspace, finding, task, contribution, and foreign keys. A second tenant must survive a scoped restore. | `docs/evidence/shr-001/recovery/README.md`: one-tenant clone, source size stayed 495,616 bytes. `docs/evidence/shr-001/recovery/scoped-2026-10-25.md`: tenant A re-applied with `INSERT OR REPLACE` into a temporary D1 that already held synthetic tenant B. B's ids and counts were unchanged, `ws_df6794f33efc459b` remained, and `PRAGMA foreign_key_check` was empty. Temporary database deleted. Source stayed 37 tables and 495,616 bytes. | **PASS** for the one-tenant clone and for this scoped two-tenant drill. Not a Worker cutover or a production two-tenant test. |

## Active notifications

Created 2026-10-25 with a Notifications Edit API token. Email destination is the
account address. `POST /policies/{id}/test` returned success for every policy.
Inbox delivery was not read back from the mailbox.

| Policy | Id | Type |
| --- | --- | --- |
| Campfire alpha — Worker issues | `0ecf4d903b684fd28a20fe626722d1af` | `workers_observability_real_time_issue` |
| Campfire alpha — Worker errors | `667a342fb9664d90ac63cc93c02da881` | `custom_analytics` on `campfire_alpha_ops`, `server_error` or `unavailable` >= 1, 5m window |
| Campfire alpha — request volume | `9af975c7c0a348adbeb16c88e6faddb3` | `custom_analytics`, count > 5000, 24h window |
| Campfire alpha — invitation 429 | `da3cc5390dd849f5a71ffb091f412b11` | `custom_analytics`, invitation `limited` > 30, 1m window |
| Campfire alpha — 503s | `a01d2910e0994adf869f7700eff92394` | `custom_analytics`, `unavailable` >= 1, 5m window |
| Campfire alpha — publication failures | `d1e203d35cdd46638a9c028674748e87` | `custom_analytics`, publication `server_error` >= 1, 5m window |
| Campfire alpha — Worker observability | `7691d3d075944892ae8bd2e4fa2ba907` | `workers_observability_alert` when status is `FIRING_FAILED` |

Not created, because the notification types cannot express them: per-team CPU
above 5 CPU-seconds, a 5% invitation ratio, and D1 growth above 256 KiB. D1
row caps stay in `alpha-usage.ts`.

`CAMPFIRE_ALPHA_EXPENSIVE_WRITES` is live as `"0"` on production Worker
`f8e4f3f9-d178-4957-a2c3-76b24d4be43f` (2026-10-25T13:17:04Z). The change was
var-only: `CAMPFIRE_PUBLICATION_ALPHA` remains `"1"`, and the Worker secret
`CAMPFIRE_PUBLICATION_REHEARSAL_CODE_HASH` is still set. Committed
`wrangler.toml` is unchanged (`"0"` / `"0"`). The pause stays in force under the
CONDITIONAL GO in `docs/RELEASE_V1_26_2_DECISION.md`.
