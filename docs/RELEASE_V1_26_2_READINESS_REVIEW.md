# Campfire v1.26.2 — controlled Cloud alpha readiness review

**Reviewed:** October 24, 2026  
**Decision:** **HOLD production promotion and public v1.26.2 release**  
**Release target:** Public Campfire download with Cloud sharing limited to admitted alpha users; no open signup

This is a dated operating and release review of the current candidate. It
records completed evidence and explicit remaining gates. It does not authorize
production migration, Worker deployment, a public tag, or installer updates.
The founder makes the final `GO`, `CONDITIONAL GO`, or `HOLD` decision after the
remaining gates are closed. The isolated rehearsal service remains available
for testing.

## User path and branded URL

The supported link format takes the issuing workspace's API base URL and adds
`/join#v1.…`; the capability stays in the fragment. When the API base is
`https://boringinfra.company/campfire`, the link begins
`https://boringinfra.company/campfire/join#v1.…`. The existing link parser
returns that same API base for preview, decline, and redeem. The static landing
page neither receives nor sends the fragment, and acceptance takes place in the
installed CLI. Tests cover the `/campfire` prefix and branded link format.

The **currently published Arbora workspace is on the isolated rehearsal D1**.
Its existing invitation links correctly point to the isolated Worker. Production
migrations `0010_workspace_publication.sql` and `0011_alpha_usage.sql` are
applied, and the branded Worker version `48a620de-4dbc-4f9d-9b93-85e9599b13ce`
serves `GET /campfire/join` as the static invitation page. Publication admission
stays off (`CAMPFIRE_PUBLICATION_ALPHA=0`), so production enroll returns
"not enabled". No production workspace or invitation was created. Changing the
host in an existing rehearsal link would not move its workspace or invitation.

## Evidence matrix

| Gate | Result | Evidence / limitation |
| --- | --- | --- |
| Real MacBook → isolated Cloud → iMac → fresh MacBook continuation | **PASS, operator reported** | Original finding `find_5cd543722a044c20`, iMac task `task_3795d9d37d3842e9`, contribution `con_09640a17b9b14ea7`, and agent/session provenance were read back in `ws_df6794f33efc459b`. No machine-level offline interval capture is attached. |
| Invitation capability abuse guard | **PASS on rehearsal** | Dedicated `INVITATION_RATE_LIMITER`, 30 requests/60 seconds/source. Worker `ec754f1e-5766-411a-bb88-6d21965f4b9d`. A persistent 100-request probe yielded 43×401, then 57×429. Missing binding, missing client address, and binding failure yield 503 on deployed Workers; route tests cover both handler paths. |
| Publication admission | **PASS for rehearsal** | Alpha flag plus operator-held code hash; prior missing/wrong-code matrix rejected enrollment, and per-source admission limits apply. This is an operator-controlled rehearsal policy, not verified public account ownership. |
| Hosted tenant and import safety | **PASS in engineering tests** | SHR-001 tests cover ownership, cross-tenant denial, atomic import, digest mismatch, retry, size/row caps, and credential recovery. The isolated D1 has migration `0010`. |
| Data recovery | **PARTIAL** | Isolated D1 export restored into temporary SQLite with integrity `ok` and one each of workspace, finding, task, and contribution. No remote Time Travel restore or scoped restoration with a second tenant was exercised. The original MacBook database predates the iMac task. |
| Usage measurement | **PARTIAL** | Isolated D1 read-only 24-hour snapshot: 1,139 queries read, 135 written, 4,144 rows read, 392 written; database 495,616 bytes. No per-route/tenant Worker CPU and request report, alert thresholds, or cost-per-team estimate is recorded. |
| Cloud alpha budgets | **OPEN** | One-workspace and publication/import caps exist; invitation edge rate limiting is approximate. Bounded ongoing writes, invitation issuance, and context reads per alpha namespace, plus an operator switch for expensive writes, remain unverified. |
| Branded production URL | **PARTIAL** | `https://boringinfra.company/campfire/join` returns the static page. Preview without a capability is 401. Publication enroll is 403 while alpha is off. No production invitation has been issued, and dashboard usage alerts are not configured. |
| Pinned distributable | **OPEN** | The two-Mac candidate archive checksum is `077094a6658ff67c07d275173e6b81696e181b5a9bcc6038109305e4acc874a9`, but the later limiter change is not in that archive or a clean pinned source commit. No public artifact, tag, or channel update exists. |
| Regression suite | **PASS after fixture repair** | See validation note below; the acceptance fixture used an October 23 clock and its invitation had expired by this review. The test now uses the current run time. |

Validation on the current tree: `npm run typecheck` and `npm run build`
passed; the full suite passed 128 files with 1,567 passing and one skipped
test. `npm run deploy:dry-run` listed the production D1, assets, and dedicated
`INVITATION_RATE_LIMITER` without deploying. `git diff --check` passed. The
source tree also contains earlier candidate and link-flow changes that have not
been frozen into a new clean source pin or installed archive.

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

## Remaining release sequence

1. Close CLO-001: enforce and test ongoing alpha write, invitation issuance,
   and context-read budgets; add the expensive-write stop; record route/CPU/D1
   usage and alerts with an owner; run abuse/load and remote restore drills.
2. Freeze a clean source commit containing the link flow and limiter. Rebuild,
   checksum, and install the same v1.26.2 candidate on both Macs. Re-run the
   focused and full suite, clean install/upgrade, local-only first run, and
   branded-path tests from that pin.
3. Decide explicitly how the rehearsal workspace reaches the production data
   plane, if it must. Do not rewrite invitation URLs or copy D1 rows without a
   scoped, idempotent migration and credential plan. A fresh admitted-alpha
   workspace is an alternative for the production launch test.
4. Only after an authorized release decision, apply production migration
   `0010`, deploy the pinned Worker with its dedicated invitation binding to
   `boringinfra.company/campfire/*`, configure admission, and verify the exact
   branded join URL and accept/decline against the production data plane.
5. Publish and verify the matching public archive, installer, release notes,
   and channel pins. State that Cloud sharing is invited alpha and browser
   click-to-accept is not yet provided.

The October 30 target remains a **review target**, not evidence of release
readiness. If the hosted gates remain open, any public download must be
described as local-only. No self-service Cloud, billing, managed agent runtime,
or Mac app release is approved here.
