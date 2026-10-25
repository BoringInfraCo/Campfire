# Campfire v1.26.2 — controlled Cloud alpha readiness review

**Reviewed:** October 24, 2026  
**Decision:** **HOLD** as of this October 24 review. On October 25, 2026 the
founder recorded **CONDITIONAL GO** in `docs/RELEASE_V1_26_2_DECISION.md`.
This review does not itself move a tag.  
**Release target:** Public Campfire download with Cloud sharing limited to a
controlled alpha of admitted users; the installed CLI previews, accepts, or
declines an invitation link. No browser click-to-accept and no open Cloud signup

This is a dated operating and release review. It records completed evidence and
explicit remaining gates. The isolated rehearsal service remains available for
testing.

## User path and branded URL

The supported link format takes the issuing workspace's API base URL and adds
`/join#v1.…`; the capability stays in the fragment. When the API base is
`https://boringinfra.company/campfire`, the link begins
`https://boringinfra.company/campfire/join#v1.…`. The existing link parser
returns that same API base for preview, decline, and redeem. The static landing
page neither receives nor sends the fragment, and acceptance takes place in the
installed CLI. Tests cover the `/campfire` prefix and branded link format.

The **Arbora rehearsal workspace remains on the isolated rehearsal D1** and its
existing invitation links continue to point to the isolated Worker. Production
migrations `0010_workspace_publication.sql` and `0011_alpha_usage.sql` are
applied, and the branded Worker currently serves `GET /campfire/join` as the
static invitation page.

On October 25, the production service was moved to Worker version
`d4ad841c-97f4-4806-962b-0162ed4bd464` for the SHR-001 production evidence run.
`CAMPFIRE_PUBLICATION_ALPHA` is now `"1"` with an operator-held admission code
(the hash is a Worker secret), and `CAMPFIRE_ALPHA_EXPENSIVE_WRITES` is `"1"`.
This is **operator-gated admission, not open signup**. A fresh workspace
`ws_c5687463e8624498` was published and a branded
`https://boringinfra.company/campfire/join#v1.…` link was issued and accepted on
a same-machine second profile; the physical iMac acceptance is still unproven.
See `docs/evidence/shr-001/production/README.md`. Changing the host in an
existing rehearsal link would not move its workspace or invitation.

## Evidence matrix

| Gate | Result | Evidence / limitation |
| --- | --- | --- |
| Real MacBook → isolated Cloud → iMac → fresh MacBook continuation | **PASS, operator reported** | Original finding `find_5cd543722a044c20`, iMac task `task_3795d9d37d3842e9`, contribution `con_09640a17b9b14ea7`, and agent/session provenance were read back in `ws_df6794f33efc459b`. No machine-level offline interval capture is attached. |
| Invitation capability abuse guard | **PASS on rehearsal** | Dedicated `INVITATION_RATE_LIMITER`, 30 requests/60 seconds/source. Worker `ec754f1e-5766-411a-bb88-6d21965f4b9d`. A persistent 100-request probe yielded 43×401, then 57×429. Missing binding, missing client address, and binding failure yield 503 on deployed Workers; route tests cover both handler paths. |
| Publication admission | **PASS for rehearsal** | Alpha flag plus operator-held code hash; prior missing/wrong-code matrix rejected enrollment, and per-source admission limits apply. This is an operator-controlled rehearsal policy, not verified public account ownership. |
| Hosted tenant and import safety | **PASS in engineering tests** | SHR-001 tests cover ownership, cross-tenant denial, atomic import, digest mismatch, retry, size/row caps, and credential recovery. The isolated D1 has migration `0010`. |
| Data recovery | **PARTIAL** | Isolated D1 export restored into temporary SQLite with integrity `ok` and one each of workspace, finding, task, and contribution. No remote Time Travel restore or scoped restoration with a second tenant was exercised. The original MacBook database predates the iMac task. |
| Usage measurement | **PARTIAL** | Isolated D1 read-only 24-hour snapshot: 1,139 queries read, 135 written, 4,144 rows read, 392 written; database 495,616 bytes. Seven Cloudflare policies are active (`docs/evidence/shr-001/clo-001/README.md`). No per-route/tenant Worker CPU report or cost-per-team estimate is recorded. |
| Cloud alpha budgets | **OPEN** | One-workspace and publication/import caps exist; invitation edge rate limiting is approximate. Bounded ongoing writes, invitation issuance, and context reads per alpha namespace, plus an operator switch for expensive writes, remain unverified. |
| Branded production URL | **PARTIAL** | `https://boringinfra.company/campfire/join` returns the static page. A fresh production workspace `ws_c5687463e8624498` was published on October 25 and a branded link was issued and accepted on a same-machine second profile. The physical iMac acceptance is **NOT OBSERVED**. Seven notification policies are active; per-team CPU, the 5% invitation ratio, and D1 growth stay outside Cloudflare Notifications. |
| Pinned distributable | **PARTIAL** | Local Darwin ARM64 verification archive SHA-256 `523054058c2a62f7f0e8168349e841e0adb4b1a947e4539bce1d391dd54c2a75` carries the controlled-alpha `releaseNote`. Do not publish `7087e5c4…` or `c0347b2d…`. Published checksums come from the public release workflow. Homebrew and Nix stay on 1.26.1. |
| Regression suite | **PASS after fixture repair** | See validation note below; the acceptance fixture used an October 23 clock and its invitation had expired by this review. The test now uses the current run time. |

Validation on the frozen pin `ffbb30b`: the focused SHR/CLO set passed 21
files / 129 tests, and the full suite passed 132 files / 1,581 tests (1,580
passing, one opt-in terminal-capture skip). An earlier October 24 check on the
working tree recorded `npm run typecheck` and `npm run build` passing, a
128-file / 1,567-test full suite, and a `npm run deploy:dry-run` that listed the
production D1, assets, and dedicated `INVITATION_RATE_LIMITER` without
deploying. The link-flow and limiter changes are now frozen in `ffbb30b`; no
installed archive has been rebuilt from that pin.

## Operating contract for the invited alpha

- **Admission owner:** The Campfire operator holds the publication admission
  code and controls which users receive it. Do not enable open enrollment from
  the public download. Keep `CAMPFIRE_PUBLICATION_ALPHA=0` on production until
  the separate production promotion review.
- **Emergency stop:** Turn off new publication admission with the alpha flag.
  Preserve existing authorized reads and recovery. If ongoing writes need to
  stop while reads remain available, implement and test that switch before
  promotion; the publication flag alone does not provide it.
- **Invitation budget:** Keep the dedicated binding in the deployment config.
  The binding protects unauthenticated preview, decline, and redeem from bursts
  but does not implement hard account quotas: [Cloudflare's Workers Rate
  Limiting documentation](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
  describes limits as approximate and local to a Cloudflare location. A missing
  or failed binding makes those routes return 503, which should be monitored.
- **Recovery:** Retain D1 Time Travel/export procedures and a private backup
  plan for remote contributions. The local pre-publication database is not a
  current Cloud backup. Test restore into an isolated D1 and confirm tenant
  boundaries before calling the recovery gate complete.
- **Usage and alert owner:** Before promotion, assign an operator, thresholds,
  and a response action for Worker requests/CPU, D1 rows read/written,
  database growth, 429/503 rates, and publication failures. Review costs against
  the actual invited-user count. [Workers Paid pricing](https://developers.cloudflare.com/workers/platform/pricing/)
  includes usage overages; its monthly base charge is not a hard spending cap.

### Operator-assigned alert thresholds (CLO-001 — policies active)

The operator-assigned alert spec for the controlled hosted alpha. Seven
notification policies were created on October 25, 2026 and each test call
returned success. Policy ids are in `docs/evidence/shr-001/clo-001/README.md`.
Per-team CPU, the 5% invitation ratio, and D1 size growth remain native gaps.

**Operator:** the Campfire operator (founder) holding the publication admission
code and recovery authority.

| Alert | Metric | Threshold | Window | Response |
| --- | --- | --- | --- | --- |
| Worker requests | Alpha-ops outcomes (`server_error`, `unavailable`) and alpha-route volume | Any `server_error` or `unavailable` outcome alerts; alpha-route requests above **5,000** alert | Rolling **24h** | Operator acknowledges within **15 minutes**, investigates via the read-only `campfire_alpha_ops` report (`scripts/alpha-ops-report.mjs`), and applies the emergency stop or expensive-write switch as needed |
| Worker CPU | Worker CPU time | Above **5 CPU-seconds** per team per UTC day alerts | UTC day | Operator reviews; expensive-write switch governs writes |
| D1 rows read/written | Published-team daily usage rows | Reads above **3,000** or writes above **300** (the enforced alpha caps) alert | UTC day | Operator reviews the usage report; the enforced caps already answer limited/stopped |
| D1 database growth | D1 database size | Growth above **256 KiB** alerts | Rolling **24h** | Operator reviews; restore and ownership checks follow |
| 429 rate | Invitation routes (`limited`) | Above **5%** of attempts, or above **30** attempts per source per **60s** (the limiter ceiling) alerts | Rolling hour | Operator runs abuse response; limiter behavior is reviewed |
| 503 rate | Invitation routes and alpha usage control (`unavailable`) | Any `unavailable` outcome alerts immediately | Immediate | Operator checks limiter binding and control availability |
| Publication failures | Publication routes (`server_error`) | Any `server_error` on `publication_enroll`, `publication_import`, or `publication_recover` alerts | Rolling **24h** | Operator reviews failure counts; 400/403 outcomes are operator rejections, not failures |

#### Cloudflare configuration state (verified October 25, 2026)

Account `1c1597c473c77c9ea49a53b4d62fdb2d`
(`sunbeam-redraft-7j@icloud.com`).

- An earlier read of `GET /accounts/{id}/alerting/v3/policies` returned an
  empty list: **zero notification policies** at that check. The 2026-10-25
  Wrangler OAuth recheck could not list them (HTTP 403, below).
- Eligible destinations: email is `eligible: true` and `ready: true`; webhooks
  are eligible and ready but none are configured; PagerDuty is not eligible.
  The intended email destination is `sunbeam-redraft-7j@icloud.com`. No
  destination is attached to a policy because no policy exists.
- `POST /accounts/{id}/alerting/v3/policies` was attempted earlier and rejected
  before body/schema validation. That response was HTTP 401/403
  `Authentication error` with: "This connection was not granted a scope this
  endpoint accepts. Reconnect and grant one of: `account-settings.write`
  (Account Settings Write), `notifications.write` (Notifications Write)."
- Rechecked 2026-10-25 after a fresh `wrangler login`. `GET /accounts`
  returned HTTP 200 for account `1c1597c473c77c9ea49a53b4d62fdb2d`.
  `GET /accounts/{id}/alerting/v3/policies`, `available_alerts`, and
  `destinations/eligible` each returned HTTP 403, code `10000`,
  `Authentication error`. `whoami` lists Workers, D1, and account read. It
  does not list Notifications Write. `wrangler login --scopes-list` has no
  notifications scope, so another Wrangler login cannot grant it. Creation
  was not retried. The create-policy docs require Notifications Write or
  Account Settings Write.
- The Cloudflare API MCP OAuth grant available to this review is read-only (194
  read scopes, zero write scopes). No API token with Notifications Write is
  present in the operator environment. No policies were created.
- No policy IDs, test notification, or alert delivery exist. The table above is
  therefore a **recorded specification**, not an active configuration. Policy
  bodies could not be schema-validated because authorization failed first.
- The `campfire_alpha_ops` dataset is populated: a read-only 24-hour aggregate
  returned route/outcome rows, so the custom-analytics source is available once
  a write-capable grant exists.

**To activate:** reconnect the Cloudflare API MCP grant with **Notifications
Write** (and **Account Settings Write** if offered), or create a
least-privilege Cloudflare API token with *Account → Notifications → Edit*.
Then create and attach the policies below, attach the account email, and send a
test notification for each. Do not mark CLO-001's alert gate closed until the
policies exist and the test notifications are recorded.

Prepared policies (not yet created):

| Planned policy name | Alert type / source | Filter / threshold | Window | Response |
| --- | --- | --- | --- | --- |
| `Campfire alpha — Worker errors` | `custom_analytics`, `workers_analytics_engine`, dataset `campfire_alpha_ops` | `outcome` is `server_error` or `unavailable`; threshold `>= 1` | 5m, re-alert 1h | Acknowledge within 15 minutes; inspect route/status; apply the emergency stop for publication paths |
| `Campfire alpha — request volume` | `custom_analytics`, same dataset | Alpha-route request count `> 5,000` | Rolling 24h | Review route mix and invited-user count |
| `Campfire alpha — Worker CPU` | `workers_observability_alert` (Worker `campfire`) if available | Worker-level CPU; per-team `> 5 CPU-seconds/UTC day` is not exposed by the dataset | UTC day | Review Workers Observability; per-team value from the daily report |
| `Campfire alpha — D1 rows` | App enforcement + daily report (native gap) | `> 3,000` reads or `> 300` writes per team per UTC day | UTC day | `alpha-usage.ts` already returns `limited`/`stopped`; review the daily report |
| `Campfire alpha — D1 growth` | `billing_usage_alert` on D1 if supported; otherwise daily report (native gap) | Growth `> 256 KiB` | Rolling 24h | Compare D1 size snapshots; investigate unexpected writes |
| `Campfire alpha — invitation 429` | `custom_analytics`, same dataset | `outcome = limited` on `invitation_preview`/`decline`/`redeem`; above **30 aggregate in 60s** or **5% of invitation attempts in 1h** | 60s / 1h | Run abuse response; the edge limiter enforces 30/60s per source |
| `Campfire alpha — 503s` | `custom_analytics`, same dataset | `outcome = unavailable`; threshold `>= 1` | 5m | Check the limiter binding and usage-control availability |
| `Campfire alpha — publication failures` | `custom_analytics`, same dataset | `outcome = server_error` on `publication_enroll`, `publication_import`, or `publication_recover`; threshold `>= 1` | 5m, re-alert 1h | Review failure counts; 400/403 are operator rejections, not failures |

**Native gaps (recorded, not silently substituted):**

- **Worker CPU per team:** `campfire_alpha_ops` records `elapsedMs` wall time and
  route/outcome only. It has no CPU or team dimension.
  `workers_observability_alert` is Worker-level and requires Workers
  Observability Write plus Notifications Write. The 5 CPU-second per-team
  threshold can only come from the daily usage report until the app records a
  bounded CPU/team aggregate.
- **D1 rows read/written:** the dataset does not contain D1 row counts. The hard
  caps in `src/worker/alpha-usage.ts` (3,000 reads, 300 writes per team per UTC
  day) are the enforcement point; `limited` is observable, but the per-team row
  total is not. Daily `scripts/alpha-ops-report.mjs` must report it.
- **D1 database growth:** Cloudflare Notifications has no D1 storage-size alert
  type. `billing_usage_alert` is usage/cost-oriented, not a size alarm. Record D1
  `file_size` daily and compare against 256 KiB/24h. Production `campfire` D1
  reported `file_size` **503,808 bytes** on October 25; no prior-day baseline is
  recorded yet.
- **429 ratio and per-source ceiling:** `campfire_alpha_ops` deliberately has no
  source/IP or attempt-denominator dimension, so a true 5% ratio or a per-source
  30/60s alert cannot be expressed over it. The edge
  `INVITATION_RATE_LIMITER` enforces 30/60s; the alert is an aggregate `limited`
  count plus the daily ratio.
- **Test notifications:** each of the seven policies returned success from
  `POST /policies/{id}/test` on October 25. Inbox delivery was not read back
  from the mailbox. Policy ids are in `docs/evidence/shr-001/clo-001/README.md`.

Every alert response is owned by the Campfire operator: acknowledge within
**15 minutes**, investigate through the read-only reporting surface
(`scripts/alpha-ops-report.mjs` over the `campfire_alpha_ops` dataset), and apply
the recorded emergency stop (`CAMPFIRE_PUBLICATION_ALPHA=0`) or the expensive
write switch (`CAMPFIRE_ALPHA_EXPENSIVE_WRITES`) as needed.

## October 25 position

The founder decision is **CONDITIONAL GO**. These items from the October 24
sequence are done, with the limits named in the decision:

- Alpha budgets, the expensive-write stop, the invitation limiter, and the
  scoped restore drill are recorded. Seven notification policies are active.
  Per-team CPU, the 5% invitation ratio, and D1 growth remain native gaps.
- Production migrations `0010` and `0011` are applied. Worker
  `f8e4f3f9-d178-4957-a2c3-76b24d4be43f` has publication alpha `"1"` and
  expensive writes `"0"`. Do not deploy committed `wrangler.toml` over it.
- A fresh production workspace was published. Arbora stays on the isolated
  rehearsal D1. The physical iMac acceptance is not observed.
- Homebrew and Nix stay on 1.26.1 until all four release archives exist.
  `releaseStatus` stays `candidate`.

The October 30 target remains a **review target**. No open Cloud signup,
billing, managed agent runtime, or Mac app release is approved here.
