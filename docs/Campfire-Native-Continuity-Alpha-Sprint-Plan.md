# Campfire local, Cloud, and native continuity — phased sprint plan

**Status:** Proposed cross-sprint plan. Sprint contracts and release decisions govern each release separately.
**Revised:** October 29, 2026
**Current baseline:** [v1.26.3](RELEASE_V1_26_3_DECISION.md) is publicly downloadable under a CONDITIONAL GO for the CLI update experience. [v1.26.2](RELEASE_V1_26_2_DECISION.md) introduced controlled Cloud alpha admission. The [October 24 two-Mac trace](evidence/shr-001/rehearsal/README.md) observed the iMac create an attributed task from the hosted Arbora finding and a fresh MacBook session read it back. Physical acceptance on the branded production endpoint and a two-Mac v1.26.3 update check remain unobserved.
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

**October 25 founder sequencing:** Start MAC-001 feasibility and scope IDN-001
and ENT-001 now. Return to the physical branded production handoff and two-Mac
update check afterward. This sequencing does not mark those open observations
as passed or authorize public Cloud signup. The source contracts and release
decisions, rather than the original October 30 forecast, govern what is live.
The [IDN-001 contract](Campfire-IDN-001-Verified-Cloud-Ownership.md) and
[ENT-001 contract](Campfire-ENT-001-Cloud-Entitlements.md) are Step 0 proposals.
They may be reviewed in parallel; account-wide limits cannot be implemented
until IDN-001 freezes and proves the owner-account mapping.
The [IDN-0 auth comparison](evidence/idn-001/AUTH-CHOICE.md) selects a managed
provider as the first isolated experiment, with cost and dual-proof recovery as
hard gates; no provider or production account architecture is approved yet.
The [ENT-001 hosted route inventory](evidence/ent-001/ROUTE-INVENTORY.md) now
classifies current routes and methods, including entry points outside the alpha
usage meter. This is design evidence, not entitlement enforcement.
The [MAC-001 contract](Campfire-MAC-001-Native-Feasibility.md) and
[feasibility result](evidence/mac-001/RESULT.md) record a compiled
SwiftUI screen over the actual Viewer proxy. The October 25 real-profile
MacBook check showed the hosted Arbora task and finding by ID. On October 26,
the founder removed the prepared [iMac prototype run](evidence/mac-001/IMAC-RUN.md)
from MAC-001's exit criteria. MAC-001 is GO for one-Mac feasibility only;
iMac native compatibility was not tested, and MAC-002 is not yet authorized by
this prototype alone.

**October 26 native-interface reassessment:** The SwiftUI MAC-001 result remains
the historical feasibility result: it proved the actor-bound Viewer boundary,
real-profile rendering, a small signed app bundle, and inspectable native
accessibility on the MacBook. It did not build the researched GPUI alternative.
The later review of [1Git](https://github.com/1bye/1git) identified a materially
stronger GPUI feasibility path: a working MIT-licensed macOS application built
with React, Bun, and pinned GPUIX/GPUI sources, including native window chrome,
controls, packaging, and launch tests. This evidence reopens the toolkit choice
without rewriting MAC-001's recorded result. A bounded **MAC-001B** comparison
must put real Campfire data inside an isolated 1Git-derived shell before MAC-002
selects its implementation toolkit. The [multi-surface strategy](Campfire-Multi-Surface-Strategy.md)
defines the shared information architecture and longer product sequence; this
document continues to govern the near-term Cloud and native-alpha gates.

**October 26 product direction:** The first intelligent behavior is a quiet,
deterministic workspace facilitator, expressed through the same Workspaces,
Needs You, and People & Agents grammar in TUI, Viewer, and the native shell.
The default screen should answer what the team is trying to accomplish, what
changed, and what needs the current human. Campfire preserves structured work
and provenance, not a warehouse of private agent conversations. Generated
briefs are a later, opt-in Steward decision: derived, cited, freshness-labeled,
bounded by workspace authorization and an explicit inference budget. Agent
delegation and execution require still later approval and demand evidence.
The [multi-surface strategy](Campfire-Multi-Surface-Strategy.md) holds the
cross-surface model; the sprints below define the sequence and exit gates.

**October 27 Cloud coordination direction:** The Coworkers source review
supports several later Cloud patterns—per-entity live coordination,
hibernatable WebSockets, approval cards, push delivery, background routines,
masked-secret boundaries, and a separate lower-cost background model—but not
its bot-runtime data model. Campfire keeps D1 authoritative for workspace
records, identity, authorization, provenance, contributions, and the recorded
inputs from which attention is derived. A
future per-workspace live coordinator may fan out opaque committed-position
signals; a transactional outbox and Queue may deliver privacy-minimized
attention; and a later opt-in Steward may derive cited briefs. None becomes a
second workspace store or authorizes hosted shells, browsers, transcripts,
autonomous delegation, or managed execution. The implementation sequence,
contracts, fault cases, and exit evidence are specified in the
[Cloud live coordination and Steward plan](Campfire-Cloud-Live-Coordination-and-Steward-Plan.md).

**October 28 external-session continuity direction:** The Atuin Threads review
adds one optional integration track after the native read-only workspace
interface is stable. Atuin or another external provider may own opt-in private
transcript capture, encrypted sync, search, resume, fork, and cross-harness
reconstruction. Campfire continues to own authorized structured work,
human/agent identity, provenance, currentness, and the durable outcome. The
first experiment is a local, user-initiated **Continue in…** compatibility
spike with a context-only fallback. It does not import transcripts, make an
external thread ID a Campfire identity, silently launch agents, or change the
Cloud alpha. The boundary, UX, privacy table, phased implementation, and
acceptance matrix are specified in the
[external agent-session continuity plan](Campfire-External-Agent-Session-Continuity-Plan.md).

**October 29 Shepherdr direction:** The
[canonical assessment](Campfire-Shepherdr-Assessment.md) records every adopted
and deferred track without creating a second sidebar, inbox, mobile plan,
approval model, or runtime roadmap. The current desktop hierarchy is already
the adopted interface result. This plan adds only the later RUN-000 provider
compatibility gate; Shepherdr remains optional and outside Campfire authority.

**October 29 Herder native-app direction:** The
[Herder assessment](Campfire-Herder-App-Assessment.md) distinguishes the new
`herder-sh/herder` native app from the earlier `herdr.dev` project and records
the source at the reviewed revision. Herder's repository is one monorepo with
a Rust shared client core and thin Swift app targets; it is not evidence that
Campfire needs separate Core/App repositories or a Rust/FFI rewrite. Campfire
keeps its current Core/Worker/Viewer authority boundary. For the Sunday
internal alpha, complete the existing rail/context/body shell: move workspace
sections out of the main-pane chip strip, make the second pane contextual for
Workspaces, Needs You, Activity, and People & Agents, add quiet nonzero
attention badges, and use responsive overview cards plus list/detail modes.
Badges remain derived from durable authorized attention, never inferred live
agent presence. The detailed work packets and acceptance matrix live in the
desktop repository's `docs/CAMPFIRE_ALPHA_EXECUTION.md`.

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
| **1.5 — published Oct 25, conditional** | **UPD-001, v1.26.3 update and restart** | A quiet stable-version notice and explicit `/update` confirmation in the Campfire terminal experience. | The [release decision](RELEASE_V1_26_3_DECISION.md) records the published archives and the unobserved two-Mac update check. |
| **2 — Oct 31–Nov 3 earliest** | **IDN-001 identity + ENT-001 entitlements** | Candidate for anyone to create a bounded free hosted account; no payment required to try sharing. | Phase 1 evidence, verified account ownership/recovery, strict tenant limits and safe downgrade behavior. |
| **3 — Nov 4–6 earliest** | **PUB-001 self-service launch review** | Public Campfire Cloud signup and team sharing, only if all Phase 2 security, cost, recovery, and ordinary-user tests pass. | IDN-001, ENT-001, production-like load and restore exercise. |
| **4 — after observed use** | **BIL-001 paid plans** | Optional paid tier for measured team value, with billing and support rules; no plan or price is promised here. | Public free tier, measured usage and costs, pricing decision. |
| **Parallel, then after Phase 1** | **MAC-001 feasibility → MAC-001B GPUIX comparison → MAC-002 read-only alpha → MAC-003 distribution** | A separate native Mac app release that presents authorized work; it is not required to use Cloud. | Shipped Viewer/proxy contract, an observed toolkit comparison, and native acceptance evidence. |
| **After shared semantics are proved** | **FAC-001 deterministic facilitation → STW-001 opt-in Steward decision** | Low-noise, source-backed attention and catch-up across surfaces; generated briefs only if measured need and budget justify them. | Authorized complete context, contribution ordering, currentness, and observed user comprehension. |
| **After the native read-only workspace is stable** | **CON-000 Atuin compatibility spike → CON-001 private Continue in… alpha → possible CON-002 provenance decision** | Optional local resume, fork, or cross-harness continuation while Campfire remains the structured team record. | MAC-001B/MAC-002 semantics, pinned provider and harness versions, explicit user confirmation, transcript-isolation checks, and observed need. |
| **After identity and measured delivery need** | **LIVE-001 live invalidation / NTF-001 cross-device attention** | Faster authorized refresh and optional privacy-minimized notification without changing the canonical workspace. | Released catch-up cursor, stable revocation, trusted FAC-001 attention, latency/missed-work evidence, and separate sprint contracts. |
| **After ordinary controlled-action demand** | **APR-001 approval experience** | Existing ActionProposals can be understood and answered consistently across selected surfaces. | Gate F demand and a real provider path; server authorization, reservation, receipts, and expiry remain authoritative. |
| **After APR-001 and a real provider round trip** | **RUN-000 Shepherdr compatibility spike** | Test one optional execution-provider adapter without making Shepherdr a Campfire dependency or source of truth. | Pinned provider/harness revisions, explicit approval, isolated repository fixture, provider-off fallback, and receipt/provenance evidence. |
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

### Phase 1.5 — make CLI updates understandable

**UPD-001 — v1.26.3 update and restart.** The [sprint contract](Campfire-v1.26.3-UPD-001-Update-and-Restart.md) adds a quiet notice for a newer public stable release, a human-confirmed `campfire update` command, and `/update` in the Campfire dashboard. It pins and verifies the target archive, respects Homebrew/Nix ownership, and distinguishes an automatically restarted Campfire-owned service from one that requires its external owner to restart it. The existing `/` dashboard filter remains available. **Exit:** installed-package upgrade and refusal/failure tests pass on both Macs, the displayed running version is truthful, and a separate v1.26.3 release decision is recorded. This patch does not change the hosted sharing contract or unblock public Cloud signup.

### Phase 2 — make hosted ownership safe for open signup

**IDN-001 — verified account and team ownership.** Choose and document one supported sign-in and recovery path before implementation (for example a browser-confirmed device flow from the CLI); do not treat a client-generated Campfire human ID as proof of Cloud ownership. Bind an account to verified human principals, teams, workspace ownership, member roles, and agent credentials. Support a second device, owner credential rotation, removal of a teammate or agent, invite expiry/revocation, lost-device recovery, and account closure/export. Keep invitation, agent, and owner authority separate. Define how admitted-alpha identities become accounts without duplicate owners or changed workspace/contribution IDs. Test account takeover, replay, cross-tenant object IDs, revoked sessions, and recovery abuse. **Exit:** a new user can create and recover an account and connect two devices without operator intervention; existing alpha work remains attributed and private.

**ENT-001 — server-side entitlements, usage, and cost control.** Define a versioned free-plan policy per account: hosted workspaces, humans, active agents, invitations, stored records/bytes, publication size, and bounded API use. Start with conservative numbers from the measured alpha rather than promising “unlimited.” Apply checks to every create/import/enroll/write path and enforce them atomically enough that parallel requests cannot exceed hard storage or seat caps. Use short-window rate limits for bursts and a durable account ledger for strict daily/monthly caps; approximate edge limits are insufficient for hard entitlements. Give the owner a usage view and an actionable over-limit error. Preserve reads, export, revocation, and recovery when writes are blocked. Model account-wide Worker/D1 consumption, index hot queries, load-test agent catch-up traffic, and set global alert and emergency controls. **Exit:** concurrent quota and abuse tests, a measured cost-per-active-team range, a simulated over-limit account, and an operator cost ceiling all pass.

### Phase 3 — public Cloud self-service decision

**PUB-001 — ordinary-user signup and release.** Run a clean-machine flow with people who did not build the feature: install, local work, verified Cloud signup, publish, invite, join on another computer, continue while the origin is offline, and recover after losing one device. Test fresh Cloud workspaces as well as local-to-hosted publication. Confirm explicit consent for what structured data crosses into Cloud, accurate limits and errors, tenant isolation, record/export portability, and an incident response owner. Exercise backup and per-account recovery without overwriting unrelated tenants. Reconcile actual request, CPU, D1, support, and retained-data costs against the free-tier budget. Update documentation, privacy/retention terms, support route, and status/incident communication before promotion. **Exit:** a separate dated public-Cloud `GO`; otherwise the admitted alpha continues and signup stays closed. This sprint does not require a paid checkout.

### Phase 4 — paid Cloud plans after cost and demand evidence

**BIL-001 — paid entitlement and payment lifecycle.** Decide the value metric from usage and interviews; likely candidates are hosted team capacity, longer retained history, and future file storage. Do not charge by raw agent context calls, which would discourage continuation. Define free and paid entitlements, price, billing owner, invoice/tax/support responsibilities, upgrade and downgrade behavior, grace periods, nonpayment, refunds, and data export. Integrate a payment provider with signed, idempotent webhooks and a reconciliation job; a payment event changes entitlements only after verification. Simulate webhook delay, replay, charge failure, downgrade over quota, and account deletion. **Exit:** the measured gross margin and failure matrix are reviewed, users can inspect their plan and usage, and no billing failure silently destroys or hides existing work. Launch timing is set only after public free-tier evidence.

### Native Mac app track — separate acceptance and release

**MAC-001 — feasibility, concurrent with Phase 1.** Build one throwaway read-only real-data screen over the local actor-bound Viewer proxy. Verify the MacBook build, packaging, accessibility basics, network behavior, and that the app never handles bearer tokens or opens SQLite. **Exit: GO under the revised October 26 one-Mac scope.** The [contract](Campfire-MAC-001-Native-Feasibility.md) and [result](evidence/mac-001/RESULT.md) record a real-profile MacBook read of the hosted Arbora task and finding and a SwiftUI comparison baseline. The founder canceled the prepared iMac prototype run as a MAC-001 gate; no iMac native behavior, final toolkit choice, or product release is claimed.

**MAC-001B — 1Git/GPUIX Campfire shell comparison, before MAC-002 toolkit
freeze.** The [standalone sprint contract](Campfire-MAC-001B-GPUIX-Shell-Comparison.md)
records the current `campfire-desktop` checkout, upstream-delta audit, frozen
slice, comparison matrix, and evidence requirements. Fork or vendor one exact audited 1Git revision in an isolated desktop
prototype. Preserve its required MIT and third-party notices. Reuse only the
native substrate that earns its place: GPUIX build and preload, window chrome,
theme and design-token machinery, reusable controls, keyboard/focus behavior,
and local app packaging. Replace the application root with Campfire's
Workspaces, Needs You, and People & Agents navigation, then render one real
authorized workspace overview and one selected record through the existing
Viewer proxy. Do not carry repository operations, hosting accounts, worktrees,
SSH machines, AI commit generation, 1Git analytics, or 1Git release/update
endpoints into the candidate. The prototype must not open Campfire storage,
receive a bearer token, call the hosted Worker directly, or invent a second
workspace schema. **Exit:** compare the GPUIX candidate with the recorded
SwiftUI prototype on build reproducibility, app size/startup, accessibility,
keyboard behavior, stale/denied states, packaging, dependency and license
closure, native-patch maintenance, and time to implement the same real-data
slice. Record `GPUIX`, `SwiftUI`, or `HOLD` before opening MAC-002. This is a
toolkit decision, not a native release or a completed security audit.

**MAC-002 — read-only continuity alpha, after Phase 1.** Implement the bounded workspace overview and selected finding/task detail described below, with status, attribution, citations, paging/truncation, stale/unreachable states, and keyboard navigation. Test against both local and admitted hosted profiles with the same authorized actor; verify denied and revoked reads. **Exit:** the native and CLI/Viewer views agree on IDs, currentness, counts, and source; the integrated two-Mac screen test passes. No writing or agent process control is included.

**MAC-003 — native distribution decision.** Recheck signing, notarization, update path, crash reporting/privacy, and support for the target Macs. Run install, upgrade, offline, and revoked-credential cases from the packaged app. **Exit:** a separate public/alpha/HOLD decision for the Mac app. A successful Cloud release never silently approves native distribution.

### Workspace facilitation track — after shared interface semantics

**FAC-001 — deterministic, low-noise facilitation.** Freeze the same attention
and catch-up semantics for CLI/MCP, TUI, Viewer, and native clients. Derive
"what changed" from authorized contribution order and "Needs You" only from
recorded review, blocker, and decision state; disclose incomplete pages,
source IDs, attribution, and freshness. Never infer presence or manufacture an
approval request from text alone. Test denial, revocation, stale sources,
conflicting decisions, partial context, and duplicate notification suppression.
**Exit:** a person can answer goal, changes, and required action from the same
workspace on at least two surfaces and trace each cue to canonical records;
measured noise and missed-attention cases are reviewed. No model call is
required for this sprint. Its contract and dates must be frozen separately.

**STW-001 — opt-in Campfire Steward decision, after FAC-001 use.** Observe where
people still struggle to understand long or complex work before choosing a
model/provider or promising generated briefs. If justified, scope per-workspace
policy, authorized source selection, redaction, model cost ceiling, citations,
contribution-position watermark, generated time, page-completeness disclosure,
invalidation on source change, deletion, and audit. Generated output remains a
derived proposal or brief; canonical findings, decisions, tasks, and approvals
do not change automatically. **Exit:** a separate GO/HOLD contract and measured
quality, privacy, and cost evidence before any hosted inference rollout.
Dispatching an external agent belongs to a later human-approved delegation
contract; autonomous orchestration is outside this plan's release claims.

### External agent-session continuity track — after the read-only native workspace

**CON-000 — Atuin compatibility spike.** Pin one Atuin release and exact source
and destination harness versions. On one developer machine, prove that a local
prototype can detect provider status, search a fixture-safe private session,
inspect resume/fork/cross-harness capabilities, and print the exact continuation
command without changing Campfire schema or sending a transcript, tool output,
private path, credential, or external locator into Campfire Cloud, telemetry,
logs, or Viewer payloads. Exercise disabled capture, offline, running,
divergent, missing-directory, missing-harness, and incompatible-version states.
**Exit:** a `GO`, `HOLD`, or `REJECT` compatibility matrix. GO authorizes only a
separately frozen CON-001 contract.

**CON-001 — private Continue in… alpha.** Open only after MAC-001B records the
toolkit verdict, MAC-002's workspace navigation and failure semantics are
stable, and at least one observed user need justifies retrieving private prior
work. Add a user-initiated local chooser for context-only continuation, resume,
fork, or continuation in one alternate harness. Campfire authorizes the
selected structured records first; the provider separately owns its private
session. The destination agent explicitly registers a new Campfire
`AgentSession` and contributes through existing operations. Use a stable
operation ID so an ambiguous launch retry cannot silently start a duplicate.
**Exit:** one real local trace continues work in another harness and produces an
authorized structured contribution with correct principal attribution while a
Campfire-context-only control remains functional. This is not a two-human,
cross-machine, Gate B/C/E, or managed-runtime claim.

**CON-002 — continuation provenance decision.** Open only if repeated CON-001
use proves that existing AgentSession, Contribution, and Activity reads cannot
answer a real continuation question. First attempt a projection over existing
records. Add a harness-independent continuation receipt only if evidence earns
it; keep provider locators private/local by default and require SQLite/D1,
authorization, migration, replay, and rollback parity. **Exit:** a separate
build-versus-hold decision, not a presumption that Campfire needs Atuin's thread
tree.

The [dedicated continuity plan](Campfire-External-Agent-Session-Continuity-Plan.md)
holds the data-ownership terms, Continue in… flow, adapter boundary, privacy
policy, threat model, acceptance matrix, evidence gates, and rollback behavior.
It does not authorize code or alter WCO-001's historical verdict.

### Live coordination, notification, and approval track — after their gates

**LIVE-001 — committed-position fan-out.** Open only after released identity,
revocation, and catch-up contracts exist and measured refresh latency harms
multi-person use. Add one authenticated `WorkspaceLive` coordinator per hosted
workspace. It emits opaque change envelopes after D1 commits; clients recover
every missed, duplicated, delayed, or out-of-order signal through the existing
authorized contribution cursor. **Exit:** two clients converge after reconnect,
revocation terminates access, hibernation loses no correctness-critical state,
and disabling realtime returns clients to truthful versioned refresh.

**NTF-001 — cross-device attention delivery.** Open only after FAC-001 attention
is measured and stable and users demonstrate missed work away from an active
surface. Write notification intent through a D1 transactional outbox and use an
idempotent Queue consumer for one opt-in channel and one attention class. Keep
lock-screen content minimal and reauthorize before reading the workspace.
**Exit:** retries, duplicates, expiry, resolution, quiet hours, device and
membership revocation, provider outage, dead-letter recovery, and privacy
checks pass; notification failure never blocks a contribution.

**APR-001 — approval cards over the existing action contract.** Open only after
ordinary Gate F demand and a real provider round trip. Present immutable
ActionProposals in Needs You and allow only the designated authorized human to
approve or deny them. Show expiry, reservation, submission receipt, unknown
external effect, and cited completion evidence. **Exit:** replay, concurrent
responses, revocation, changed versions, duplicate completion, and cross-surface
parity pass without introducing UI-only authority or another approval schema.

The [dedicated plan](Campfire-Cloud-Live-Coordination-and-Steward-Plan.md)
holds the authority matrix, planning contracts, workstreams, threat cases,
operating metrics, rollback behavior, and sprint-preparation checklist. These
entries establish sequence, not dates or implementation authorization.

### Managed execution track — later, not the few-days follow-on

**RUN-000 — optional Shepherdr compatibility spike.** Open only after APR-001
has a real provider round trip and ordinary demand exists. Use the pinned,
disposable, provider-on/provider-off matrix in the
[canonical assessment](Campfire-Shepherdr-Assessment.md). **Exit:** a `GO`,
`HOLD`, or `REJECT` compatibility result covering authority, duplicate
dispatch, cancellation, revocation, outage, ambiguous effect, artifact handoff,
cleanup, and reconciliation. GO authorizes only a separately frozen adapter
contract; it does not authorize a Campfire runtime or RUN-001.

**RUN-001 — investigate a managed runtime only after demand.** First observe teams asking Campfire to keep an agent *running* after their own computer goes offline; sharing workspace state does not imply this capability. If justified, scope a small isolated runner pilot: runtime identity, repository and secret access, per-account compute/time limits, model-subscription or API billing boundary, process lifecycle, crash resume, logs, cancellation, and abuse response. Price and threat-model compute separately from the lightweight shared-state service. **Exit:** an approved pilot contract and cost model before any managed execution offer. Pi Durable may inform runner crash recovery but does not supply cross-machine Campfire state.

## Work that can proceed in parallel

| Track | Work now | Independent result |
| --- | --- | --- |
| **Cloud and sharing — SHR-001 + CLO-001 + REL-001** | Finish controlled hosted provisioning, local publication, safe cutover, invitation, remote agent access, and the operating gates above. Run the MacBook → iMac → MacBook test with the MacBook service offline during iMac work. | A separate v1.26.2 controlled-alpha release decision. It does not approve public signup or managed agent execution. The native app is not a prerequisite. |
| **Native feasibility — MAC-001, closed under revised scope** | Preserve the MacBook read-only Viewer prototype and its SwiftUI baseline. The prepared iMac procedure was canceled before execution. | One real-data MacBook screen and a documented boundary; no iMac native or distribution claim. |
| **Native toolkit reassessment — MAC-001B** | Put the same bounded real Campfire slice into an isolated 1Git-derived GPUIX shell; remove unrelated product services and compare it with the recorded SwiftUI prototype. | A dated toolkit verdict and dependency/license/maintenance inventory. It does not authorize MAC-002, distribution, or mobile work. |
| **Workspace facilitation — FAC-001, then possible STW-001** | First align deterministic attention/catch-up across surfaces; observe actual need before an opt-in generated-brief contract. | Source-traceable, low-noise cues first; any Steward inference needs separate quality, privacy, and cost evidence. |
| **External session continuity — CON-000, then possible CON-001/002** | After the native workspace is useful on its own, test one pinned Atuin adapter locally with a context-only fallback and no shared transcript ingestion. | Compatibility and one real two-harness local trace first; a shared continuation receipt or cross-device session sharing waits on separate evidence. |
| **Future delivery — LIVE-001, NTF-001, APR-001** | Measure refresh latency, missed attention, notification demand, and controlled-action demand; freeze no dependency until the owning entry gate passes. | Separate live, delivery, and approval decisions that preserve D1 authority and polling/catch-up fallback. |
| **Optional execution provider — RUN-000** | Keep Shepherdr as a named compatibility candidate; design and test only after APR-001 has a live provider path and observed demand. | A provider-on/provider-off comparison and authority-boundary result. No managed-runtime or provider-dependency claim. |

The Mac client may start before SHR-001 finishes because local Viewer reads already exist. Its hosted integration and final setup instructions must follow the released SHR-001 profile and proxy behavior. Avoid freezing a large screen list, a GPUI dependency, or a combined release date from the current draft alone.

## Review after the Phase 1 release decision

Before opening MAC-002, inspect the **released artifact and result**, not just the source branch:

1. Confirm the installed CLI can publish the original local workspace and preserve the Arbora finding's ID, currentness, author, agent, session reference, and contribution order.
2. Confirm the iMac joins with separate human/agent identities and can read and write while the MacBook service is offline. A fresh MacBook session must read the iMac contribution. Record any setup friction and recovery steps.
3. Inspect the shipped remote profile, credential handling, local Viewer proxy, read method allowlist, response sizes, paging, and error states. Confirm the hosted alpha's admission gate, namespace limits, usage measurements, and recovery path from the release evidence before relying on it in the app. Identify any app-specific API need as a separate, bounded change.
4. Decide the app's first user task from the observed run. Start with one workspace overview and one selected finding/task detail. Expand only after testing whether those views help the operator notice and continue work.
5. Run MAC-001B against the exact same Viewer data and failure states as the
   SwiftUI prototype. Treat 1Git as implementation evidence, not proof that its
   patched GPUIX stack meets Campfire's accessibility, security, or maintenance
   requirements. Freeze the toolkit only after the comparison verdict.
6. Keep Continue in… out of the frozen MAC-002 slice. After the read-only
   workspace passes, use CON-000 to compare Atuin CLI and MCP boundaries with
   exact pinned versions. Campfire-context-only continuation remains the
   control and fallback; an external provider must not become required startup
   infrastructure for the desktop app.

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
- **Live coordination and notifications:** Governed by separately frozen
  LIVE-001 and NTF-001 contracts after stable identity, catch-up, attention,
  revocation, privacy, and measured user need. D1 remains canonical and every
  client retains a non-realtime recovery path.
- **Approval and Steward behavior:** APR-001 projects the existing ActionProposal
  contract only after Gate F demand. STW-001 remains opt-in, cited, derived, and
  read-only until a later explicitly approved action contract says otherwise.
- **External private-session continuity:** Governed by CON-000 and the
  [external session plan](Campfire-External-Agent-Session-Continuity-Plan.md)
  after the native workspace is useful independently. Atuin remains optional;
  no private transcript, provider credential, or external locator enters the
  canonical workspace by default.
- **External execution providers:** Governed first by RUN-000 after APR-001 and
  real demand. Shepherdr/herdr may execute a specifically approved dispatch,
  but cannot grant Campfire authority, become the canonical task lifecycle, or
  make the desktop depend on its coordinator. RUN-001 remains a separate later
  managed-runtime decision.
- **Combined demonstration:** Run only after both paths independently pass. A failure identifies which path needs repair; it does not retroactively change the other's result.

The earlier draft's A/B/C calendar and October 30 combined native-plus-Cloud gate are withdrawn. After the Phase 1 decision, use its observed result to set the native scope, schedule, and release criteria.
