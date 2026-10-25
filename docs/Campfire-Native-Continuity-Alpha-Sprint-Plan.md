# Campfire local, Cloud, and native continuity — phased sprint plan

**Status:** Proposed cross-sprint plan. Only SHR-001 has an active sprint contract; later sprint definitions below are planning briefs, not release authorization.  
**Revised:** October 24, 2026  
**Current baseline:** [SHR-001, v1.26.2 publish and share](Campfire-v1.26.2-SHR-001-Publish-and-Share.md) has an installed link-and-consent candidate on an isolated rehearsal Worker. The [October 24 two-Mac trace](evidence/shr-001/rehearsal/README.md) observed the iMac create an attributed task from the hosted Arbora finding and a fresh MacBook session read it back. The public release and controlled-alpha operating gates remain open.  
**Target:** Try for an October 30 public **Campfire download** with local use and a controlled hosted sharing alpha. Open Cloud signup, paid plans, and the Mac app each need their own later release decision. The dates below are earliest review targets, subject to their exit gates.  
**Founder choice:** “Public release” on October 30 means a public download with Cloud sharing limited to an invited alpha group, not open Cloud signup.

**October 24 operating review:** The isolated rehearsal Worker now has a live
dedicated invitation limiter, and a D1 export was restored into temporary local
SQLite. The [v1.26.2 readiness review](RELEASE_V1_26_2_READINESS_REVIEW.md)
records the remaining CLO-001 gates and a production-promotion HOLD. The
required owner-facing link begins
`https://boringinfra.company/campfire/join#v1.…` only when the workspace is
actually served by the production `/campfire` route; the current rehearsal
workspace and links still use the isolated endpoint.

## The two product outcomes

**SHR-001 is the sharing product.** A user publishes an existing local workspace to a hosted Campfire service, invites a remote teammate, and both people's agents read and contribute to the same authorized records while the original Mac is offline. The installed CLI and MCP path must pass this test without a native app. The Mac app cannot compensate for a failed publish, invitation, identity, or cross-machine read.

**Recipient entry is link-based.** The October 24 [SHR-001 founder correction](Campfire-v1.26.2-SHR-001-Publish-and-Share.md) requires an owner-shareable invitation link and an explicit accept/decline step on the recipient Mac. The installed candidate now supports link preview, acceptance, and decline in its CLI and rejects an invitation ID as a local join. The browser landing page gives CLI instructions; a browser click-to-accept surface is not yet implemented. The earlier file-based candidate remains engineering evidence only.

**The Mac app is a view of that work.** It should make authorized workspace state useful to a person on macOS. Its first job is to show what the workspace contains, what needs attention, and why, with correct source and attribution. It does not create the hosted service or resume an agent run. Pi Durable's runner checkpoints are a separate topic.

One operator may run the two-Mac rehearsal with a MacBook Pro and iMac. This is enough for the rehearsal and does not claim the older two-human acceptance gates passed.

## Cloud alpha boundary and operating gates

The October 23 competitor review reinforced a narrow first hosted slice. [AnySpace](https://anyspace.dev/) and [ServerEngine](https://serverengine.app/) emphasize local agent work; [Raft](https://docs.raft.build/features/agents/runtime/) hosts a shared team space while agents run on customers' computers and subscriptions; [Nuphos](https://nuphos.ai/) also offers managed remote or cloud runtimes. Campfire's immediate proof is durable, structured, attributed work that a different person's agent can continue. SHR-001 hosts that shared work state while Codex and OpenCode still run on the users' Macs. Agent execution, model inference, private transcripts, and session migration are not part of this Cloud alpha or prerequisites for the Mac app.

The v1.26.2 release review must distinguish **controlled alpha access** from **public self-service**. Controlled alpha may use operator-gated enrollment and one bounded hosted namespace per owner, but still needs enforced publication limits, tenant isolation, scoped and recoverable credentials, invitation revocation, abuse protection on enrollment and recovery, observable request and D1 usage, and a tested hosted recovery procedure. The local source database is a backup of the publication moment; it does not contain later iMac contributions. If those operating gates or the two-Mac continuation fail, hold the Cloud alpha release rather than counting the Worker deployment as success.

Public self-service is a later release decision. It needs verified account ownership and recovery, server-side entitlements across all write paths, account and actor usage budgets, abuse response, export and restore, and a measured cost model before open signup. Customer-facing plans and billing should follow observed usage; workspaces, members, history, and any future file storage are candidate plan units. API request and CPU budgets are internal cost and abuse controls. The [Workers Paid pricing](https://developers.cloudflare.com/workers/platform/pricing/) has a $5 monthly minimum with usage overages, not a service spending cap. Neither a checkout flow nor a complete account administration console is required to prove the controlled two-Mac alpha.

## Release sequence and claims

| Phase and earliest review | Sprint | Release claim if its gates pass | Depends on |
| --- | --- | --- | --- |
| **0 — Oct 23, recorded** | **SHR-001 engineering candidate** | Bounded publish/import path works in tests; no hosted user claim yet. | v1.26.1 baseline and frozen SHR-001 contract. |
| **1 — Oct 24–30** | **SHR-001 closure + CLO-001 operations + REL-001 distribution** | Publicly downloadable local Campfire plus **admitted Cloud alpha**: invited teams can publish and share durable structured work across Macs. | Physical two-Mac proof, deployed service, alpha admission and operating gates, release review. |
| **2 — Oct 31–Nov 3 earliest** | **IDN-001 identity + ENT-001 entitlements** | Candidate for anyone to create a bounded free hosted account; no payment required to try sharing. | Phase 1 evidence, verified account ownership/recovery, strict tenant limits and safe downgrade behavior. |
| **3 — Nov 4–6 earliest** | **PUB-001 self-service launch review** | Public Campfire Cloud signup and team sharing, only if all Phase 2 security, cost, recovery, and ordinary-user tests pass. | IDN-001, ENT-001, production-like load and restore exercise. |
| **4 — after observed use** | **BIL-001 paid plans** | Optional paid tier for measured team value, with billing and support rules; no plan or price is promised here. | Public free tier, measured usage and costs, pricing decision. |
| **Parallel, then after Phase 1** | **MAC-001 feasibility → MAC-002 read-only alpha → MAC-003 distribution** | A separate native Mac app release that presents authorized work; it is not required to use Cloud. | Shipped Viewer/proxy contract and native acceptance evidence. |
| **Later, evidence-gated** | **RUN-001 managed execution investigation** | No execution product claim until a separate runtime, security, cost, and demand gate passes. | Proof customers need Campfire to run agents, rather than connect agents they already run. |

**Meaning of “public” on October 30:** anyone may obtain the Campfire release and use local workspaces. Only admitted alpha users may use the hosted publish endpoint. Public download does not mean open Cloud account creation. The “second part a few days later” is an earliest **self-service review**, not a commitment to ship billing, native distribution, and managed execution together.

### October 30 critical path

| Date | Primary work | Decision or evidence produced |
| --- | --- | --- |
| **Oct 23** | Retain the frozen SHR-001 baseline and its CONDITIONAL GO result; pin the candidate package, Worker, schema, and known gaps. | One source-of-truth candidate and a dated gap list. |
| **Oct 24** | Reassess the prepared candidate against the founder's link-and-consent correction. Implement owner link issuance, recipient preview/accept/decline and remote enrollment, and reject invitation IDs as local joins. Retain the repaired admission, export, retry, and recovery gates. | A rebuilt installed candidate and link-based two-Mac acceptance test; file transfer is insufficient. |
| **Oct 25** | If the repairs pass, provision an isolated hosted endpoint and D1 migration path, then exercise enrollment/recovery abuse, tenant and ongoing-write limits, observability, and backup/restore. | CLO-001 evidence for cost, isolation, and recovery; unresolved high-severity gaps block hosted promotion. |
| **Oct 26–27** | Run clean installed-package publication, crash/retry and local-profile fault cases; close blockers and prepare the operator/user guide. MAC-001 feasibility may run separately. | Reproducible end-to-end setup and recovery evidence, with exact versions. |
| **Oct 28** | Run the physical MacBook → hosted → iMac → MacBook test, with the original Mac's service stopped during iMac work. | Source finding and iMac task verified by ID, actor, agent, session, contribution, and authorization. |
| **Oct 29** | Rerun affected gates, full relevant tests, clean export/build/install checks, production-like deployment rehearsal, and release-note audit. | A complete dated release matrix and cost/abuse verdict; no new unreviewed scope. |
| **Oct 30** | Founder makes the REL-001 GO/HOLD decision; promote only the pinned, audited artifacts and deliberately gated hosted service if GO. | Public download plus admitted Cloud alpha, or an accurately labeled hold/local-only release. |

The same person can run the two Macs; this rehearsal does not substitute for a separate two-human usability observation. When a gate misses its date, move the claim rather than treating a test fixture, source branch, or deployed Worker as proof that users can share.

**October 24 schedule risk:** the pre-release review found code defects and an absent admission control, not merely missing deployment configuration. The October 28 physical rehearsal and October 30 release decision stay targets only if the repairs, installed-candidate checks, and operating gates pass in order. Do not compress or waive a gate to preserve the date.

### Phase 1 — ship the first honest local + distributed release

**SHR-001 closure — publish and share, v1.26.2 candidate.** The [result](SPRINT_SHR_001_RESULT.md) records passing snapshot, authorization, import, CLI, and single-process acceptance tests; the later [pre-release HOLD](RELEASE_V1_26_2_PRERELEASE_HOLD.md) records defects those tests missed. Repair and re-test every release-blocking admission, export, retry, recovery, and contract gap before deployment. Then deploy migration `0010` and a version-pinned Worker to an isolated HTTPS endpoint, run a clean installed package against it, fault-test local profile persistence and retry/restart, and conduct the real MacBook → hosted workspace → iMac → fresh MacBook handoff with the MacBook service offline. The iMac must retrieve the original Arbora finding by ID and create an attributed scoped task without a pasted recap; the MacBook must read that task. Record the exact package, Worker version, D1 migration, IDs, source tip, and redacted command outputs. A failed import, denied actor, wrong tenant, revoked token, or lost response must have a tested, safe result. **Exit:** the SHR-001 security and data-integrity matrix plus physical two-Mac evidence pass. A one-process fixture is not the physical test.

**CLO-001 — operate the controlled hosted alpha.** Freeze the alpha admission policy and operator ownership. Put an explicit allowlist or equivalent enrollment authorization in front of the public-facing enrollment route; the current environment flag and successful-enrollment-per-source count alone are not an admission system. Bound failed enrollment and recovery attempts, recovery-secret rotation, request bodies, retries, and abandoned enrollments. Enforce the existing one-workspace, import-size, and record caps at the hosted boundary and add bounded ongoing writes, invitations, and context reads for an alpha namespace. Record requests and failures by route, D1 rows scanned/written, storage growth, and Worker CPU without logging tokens or workspace content. Set actionable alerts and an operator switch for new enrollments and expensive writes while preserving authorized reads, revocation, and recovery. Document who can turn it off and how to roll back. Exercise a D1 restore or export-and-recovery procedure; the local publication copy is stale after remote contributions. **Exit:** an abuse/load exercise, usage report, tenant-denial matrix, credential recovery, and a restore drill are recorded with explicit thresholds and owners. No public self-service claim follows from this sprint.

**REL-001 — October 30 release review and distribution.** Pin a clean source commit and version; run the focused SHR/CLO checks, full relevant suite, clean export audit, package/build checks, and installer upgrade plus fresh-install tests on both Macs. Verify local first-run and local-only use still work without a Cloud account. Publish a concise user path for admitted alpha users: preflight, publish, invite, join, read, recover, and export. Disclose the alpha limits and unsupported workspace state. Inspect the deployed endpoint, migration, secrets, and alpha admission settings before any promotion. The founder records `GO`, `CONDITIONAL GO`, or `HOLD` against the dated evidence. Only an authorized promotion publishes the package, mirrors the audited source, or deploys production. **Exit:** public artifacts and hosted service match the pinned version; the release notes say “controlled Cloud alpha” and state its access boundary. A missing physical run or operating gate means hold the hosted claim; a local-only release, if chosen, is labeled local-only.

### Phase 2 — make hosted ownership safe for open signup

**IDN-001 — verified account and team ownership.** Choose and document one supported sign-in and recovery path before implementation (for example a browser-confirmed device flow from the CLI); do not treat a client-generated Campfire human ID as proof of Cloud ownership. Bind an account to verified human principals, teams, workspace ownership, member roles, and agent credentials. Support a second device, owner credential rotation, removal of a teammate or agent, invite expiry/revocation, lost-device recovery, and account closure/export. Keep invitation, agent, and owner authority separate. Define how admitted-alpha identities become accounts without duplicate owners or changed workspace/contribution IDs. Test account takeover, replay, cross-tenant object IDs, revoked sessions, and recovery abuse. **Exit:** a new user can create and recover an account and connect two devices without operator intervention; existing alpha work remains attributed and private.

**ENT-001 — server-side entitlements, usage, and cost control.** Define a versioned free-plan policy per account: hosted workspaces, humans, active agents, invitations, stored records/bytes, publication size, and bounded API use. Start with conservative numbers from the measured alpha rather than promising “unlimited.” Apply checks to every create/import/enroll/write path and enforce them atomically enough that parallel requests cannot exceed hard storage or seat caps. Use short-window rate limits for bursts and a durable account ledger for strict daily/monthly caps; approximate edge limits are insufficient for hard entitlements. Give the owner a usage view and an actionable over-limit error. Preserve reads, export, revocation, and recovery when writes are blocked. Model account-wide Worker/D1 consumption, index hot queries, load-test agent catch-up traffic, and set global alert and emergency controls. **Exit:** concurrent quota and abuse tests, a measured cost-per-active-team range, a simulated over-limit account, and an operator cost ceiling all pass.

### Phase 3 — public Cloud self-service decision

**PUB-001 — ordinary-user signup and release.** Run a clean-machine flow with people who did not build the feature: install, local work, verified Cloud signup, publish, invite, join on another computer, continue while the origin is offline, and recover after losing one device. Test fresh Cloud workspaces as well as local-to-hosted publication. Confirm explicit consent for what structured data crosses into Cloud, accurate limits and errors, tenant isolation, record/export portability, and an incident response owner. Exercise backup and per-account recovery without overwriting unrelated tenants. Reconcile actual request, CPU, D1, support, and retained-data costs against the free-tier budget. Update documentation, privacy/retention terms, support route, and status/incident communication before promotion. **Exit:** a separate dated public-Cloud `GO`; otherwise the admitted alpha continues and signup stays closed. This sprint does not require a paid checkout.

### Phase 4 — paid Cloud plans after cost and demand evidence

**BIL-001 — paid entitlement and payment lifecycle.** Decide the value metric from usage and interviews; likely candidates are hosted team capacity, longer retained history, and future file storage. Do not charge by raw agent context calls, which would discourage continuation. Define free and paid entitlements, price, billing owner, invoice/tax/support responsibilities, upgrade and downgrade behavior, grace periods, nonpayment, refunds, and data export. Integrate a payment provider with signed, idempotent webhooks and a reconciliation job; a payment event changes entitlements only after verification. Simulate webhook delay, replay, charge failure, downgrade over quota, and account deletion. **Exit:** the measured gross margin and failure matrix are reviewed, users can inspect their plan and usage, and no billing failure silently destroys or hides existing work. Launch timing is set only after public free-tier evidence.

### Native Mac app track — separate acceptance and release

**MAC-001 — feasibility, concurrent with Phase 1.** Build one throwaway read-only real-data screen over the local actor-bound Viewer proxy. Verify GPUI suitability, target macOS versions, packaging, accessibility basics, network behavior, and that the app never handles bearer tokens or opens SQLite. **Exit:** a runnable prototype and a written continue/change-toolkit decision; it is not a product release.

**MAC-002 — read-only continuity alpha, after Phase 1.** Implement the bounded workspace overview and selected finding/task detail described below, with status, attribution, citations, paging/truncation, stale/unreachable states, and keyboard navigation. Test against both local and admitted hosted profiles with the same authorized actor; verify denied and revoked reads. **Exit:** the native and CLI/Viewer views agree on IDs, currentness, counts, and source; the integrated two-Mac screen test passes. No writing or agent process control is included.

**MAC-003 — native distribution decision.** Recheck signing, notarization, update path, crash reporting/privacy, and support for the target Macs. Run install, upgrade, offline, and revoked-credential cases from the packaged app. **Exit:** a separate public/alpha/HOLD decision for the Mac app. A successful Cloud release never silently approves native distribution.

### Managed execution track — later, not the few-days follow-on

**RUN-001 — investigate a managed runtime only after demand.** First observe teams asking Campfire to keep an agent *running* after their own computer goes offline; sharing workspace state does not imply this capability. If justified, scope a small isolated runner pilot: runtime identity, repository and secret access, per-account compute/time limits, model-subscription or API billing boundary, process lifecycle, crash resume, logs, cancellation, and abuse response. Price and threat-model compute separately from the lightweight shared-state service. **Exit:** an approved pilot contract and cost model before any managed execution offer. Pi Durable may inform runner crash recovery but does not supply cross-machine Campfire state.

## Work that can proceed in parallel

| Track | Work now | Independent result |
| --- | --- | --- |
| **Cloud and sharing — SHR-001 + CLO-001 + REL-001** | Finish controlled hosted provisioning, local publication, safe cutover, invitation, remote agent access, and the operating gates above. Run the MacBook → iMac → MacBook test with the MacBook service offline during iMac work. | A separate v1.26.2 controlled-alpha release decision. It does not approve public signup or managed agent execution. The native app is not a prerequisite. |
| **Native feasibility — MAC-001** | Explore a small macOS read-only client against the existing local, actor-bound Viewer proxy. Test packaging, macOS support, GPUI version and licensing, and the exact read response shape. | A feasibility result and one real-data screen, if practical. It makes no claim that Cloud or cross-machine sharing works. |

The Mac client may start before SHR-001 finishes because local Viewer reads already exist. Its hosted integration and final setup instructions must follow the released SHR-001 profile and proxy behavior. Avoid freezing a large screen list, a GPUI dependency, or a combined release date from the current draft alone.

## Review after the Phase 1 release decision

Before opening MAC-002, inspect the **released artifact and result**, not just the source branch:

1. Confirm the installed CLI can publish the original local workspace and preserve the Arbora finding's ID, currentness, author, agent, session reference, and contribution order.
2. Confirm the iMac joins with separate human/agent identities and can read and write while the MacBook service is offline. A fresh MacBook session must read the iMac contribution. Record any setup friction and recovery steps.
3. Inspect the shipped remote profile, credential handling, local Viewer proxy, read method allowlist, response sizes, paging, and error states. Confirm the hosted alpha's admission gate, namespace limits, usage measurements, and recovery path from the release evidence before relying on it in the app. Identify any app-specific API need as a separate, bounded change.
4. Decide the app's first user task from the observed run. Start with one workspace overview and one selected finding/task detail. Expand only after testing whether those views help the operator notice and continue work.
5. Recheck GPUI build, distribution, signing, and macOS support against the actual target machines. Keep GPUI as a candidate until a runnable app proves the fit.

If the Phase 1 hosted gates do not pass, record each blocker in its owning sprint. The Mac app can still be explored locally, but there is no integrated two-Mac alpha claim.

## MAC-002 implementation detail

Open this sprint only after the review above. Freeze its own acceptance criteria separately from v1.26.2; MAC-003 owns the distribution decision.

**First vertical slice:** A read-only macOS app selects one authorized workspace and shows a bounded overview plus the chosen work record, its status/currentness, attribution, cited sources, and last successful refresh. It distinguishes loading, empty, denied, incomplete page, stale, and unreachable states. It must not display a first page as a complete workspace or imply that a recorded participant is currently present.

**Data boundary:**

```text
macOS app (presentation and view state)
    -> local actor-bound Viewer proxy (read-only)
    -> installed Campfire profile and authorized local/hosted service
```

The app does not read SQLite, hold bearer tokens, call the hosted API directly, or copy the TypeScript domain model. It performs network work off the UI thread, ignores late responses after workspace/selection changes, and preserves last good data with an explicit stale label. If the shipped SHR-001 flow changes the proxy boundary, re-evaluate this design before building on it.

**Engineering checks:** Compare the app's object IDs, counts, currentness, and attribution against CLI/Viewer reads for the same actor. Test denied workspace and record access, token revocation, unavailable service, restart, out-of-order refresh, no credential in app assets/logs/UI, keyboard navigation, and a local `.app` build. Signing and notarization need a separate verified distribution path; a local unsigned `.app` is only an alpha artifact.

**Integrated check:** Once the app works and SHR-001 passes, open the same hosted workspace on both Macs. The iMac's agent continues the recorded work through Campfire; both apps show the resulting authorized state. Score the native presentation and setup separately from SHR-001's sharing result. No private transcript or prepared recap crosses machines.

## Decision boundary

- **Cloud alpha release:** Governed by SHR-001, CLO-001, and REL-001. It must prove sharing from installed Campfire without relying on the Mac app, and meet the controlled-alpha operating gates above. It makes no public self-service or managed-runtime claim.
- **Public Cloud signup:** Governed by IDN-001, ENT-001, and PUB-001, with a separate dated release decision. Phase 1 does not authorize it.
- **Native alpha:** Governed by MAC-001 through MAC-003 and its own evidence. A successful Cloud release does not automatically approve a native release.
- **Combined demonstration:** Run only after both paths independently pass. A failure identifies which path needs repair; it does not retroactively change the other's result.

The earlier draft's A/B/C calendar and October 30 combined native-plus-Cloud gate are withdrawn. After the Phase 1 decision, use its observed result to set the native scope, schedule, and release criteria.
