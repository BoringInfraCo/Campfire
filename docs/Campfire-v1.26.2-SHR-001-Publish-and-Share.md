# Campfire v1.26.2 — SHR-001: Publish and share the first local workspace

**Status:** Founder-directed candidate sprint; hosted product, implementation, and release do not yet exist  
**Opened:** October 23, 2026  
**Target:** Engineering and two-Mac release review by October 30, 2026  
**Baseline:** Published v1.26.1; pin its exact package, production Worker version, D1 migration level, and clean exported source before Step 1.

## 1. Observed failure and product outcome

**Current product reality:** The ordinary first-run experience is local SQLite
and a loopback API. Campfire has Worker/D1 service code and a deployed Worker,
but it has no customer-ready Campfire Cloud offering, self-service hosted
workspace provisioning, account recovery, or supported local-to-hosted
publication path. The presence of a Worker deployment is not evidence that a
user has a hosted workspace. This sprint starts that product path; it cannot
simply configure a Cloud service that already exists.

An installed MacBook Pro created a local Arbora workspace `ws_df6794f33efc459b` and an attributed audit finding `find_5cd543722a044c20`. The Codex agent registered its session, passed preflight, and verified the finding. It could not invite a teammate: the active API was `http://127.0.0.1:9414`, while `invite-teammate` requires a teammate-reachable HTTPS instance and a credential for that instance. The iMac cannot retrieve a MacBook-only SQLite workspace. A different URL alone cannot move its records.

This is a **first-run-to-sharing product gap**, even though the current CLI is enforcing its documented deployment prerequisite. The released installation advertises local first run and a separate remote enrollment path without a supported bridge between them. A better error message, a tunnel, or manually re-entering the finding does not meet this sprint's outcome.

**Required release path:** From an ordinary installed local profile containing work, the owner publishes that existing workspace to a newly built hosted Campfire service through a supported Campfire command or setup flow, verifies the same structured work and attribution there, invites a teammate, and continues from another Mac after the first Mac is offline. The operator should not have to configure DNS, TLS, a tunnel, Cloudflare, D1, an owner bearer token, or a second Campfire profile by hand. Architecture groundwork or an isolated backend test alone does not satisfy this user-visible outcome.

The two-machine acceptance may be run by one operator using a MacBook Pro and iMac with distinct human and agent identities. It completes this rehearsal without a second person. It does not claim the older Sprint 020 or WCO-001 two-human gates were observed.

### October 24 founder correction — recipient link and consent

The file-only teammate invitation is **not** the intended user-facing sharing flow. The owner must be able to share one private invitation **link**. A recipient on another Mac opens or pastes that link into installed Campfire, sees the workspace and inviter before joining, and explicitly accepts or declines. Accept enrolls the recipient's own human and agent identities against the hosted workspace, prepares the remote connection, and opens that workspace. Decline creates no membership or credential. The recipient must not need the owner's filesystem path, a manually supplied endpoint, a local workspace, or the owner's transcript. The MacBook and iMac may both be online during joining; a later offline phase proves the hosted workspace survives the MacBook going offline.

The link must carry or securely resolve the endpoint and a scoped, expiring, revocable, single-use invitation capability. An invitation ID alone is neither authority nor enough information to find the hosted service. The capability must not appear in server access logs, analytics, browser referrers, or ordinary Campfire status output. The owner can revoke an unused link; a used or expired link gives a clear result. Existing private-file handling may remain as a compatibility path, but cannot stand in for this release outcome. The recipient join command must not route an invitation ID to local `join_workspace` or start a local workspace as a fallback.

The 1.26.2 source now implements this link-and-consent flow. The physical two-Mac product acceptance stays on HOLD until a rebuilt installed candidate passes owner link → recipient preview → accept/decline → hosted join → shared read/write on both Macs. The public release decision must record the link flow's security and usability evidence; the earlier file-transfer rehearsal cannot satisfy this amended gate.

## 2. Scope and architectural decision

The founder selected sharing that survives the MacBook going offline. Because no
Campfire Cloud product exists yet, this is a **new hosted-product foundation and
vertical slice**, not a patch to invitation handling. It must establish one
usable hosting/provisioning path and a faithful local-workspace publication path
before it can resolve the observed user pain. It does not authorize a general
account administration console, organization search, SSO, billing, arbitrary
SQLite upload, transcript sync, or a hosted browser Viewer.

This changes a previously deferred product boundary: `PRODUCT_DEFINITION.md` and `ARCHITECTURE.md` describe hosted multi-tenant provisioning as future work, and Sprint 020 assumed an already provisioned instance. Before implementation, amend those canonical documents narrowly to describe this exception and freeze the hosted identity/provisioning trust model. Do not silently treat Sprint 020's invitation endpoint as a migration endpoint. The requested `v1.26.2` is also a founder-directed version slot for a new capability; the release decision must explicitly record that departure from ordinary patch-version expectations. The version slot does not authorize publication or deployment.

The existing Worker/D1 service, actor authorization, workspace IDs, enrollment invitation, and remote profile are reusable backend primitives, not a ready hosted product. Publication needs a separate authenticated bootstrap and import boundary. Neither installer telemetry tokens nor invitation secrets are owner credentials. The owner must receive hosted authority through a clearly specified, reviewable enrollment step. No anonymous public endpoint may write arbitrary workspace rows.

The prior Pi Durable assessment addresses a different question: restarting a
Pi-owned agent run from its own stored task/model/tool phases after process
failure. Campfire's present failure is reachability and shared workspace
persistence across computers. Pi's checkpoint journal cannot make a local
SQLite workspace available to the iMac, and its runner model is not imported
into this sprint. Keep the Pi assessment as context for future execution
continuation; SHR-001 owns team-state hosting and publication.

## 3. Required flow to design and implement

1. **Preflight locally.** Identify the selected local workspace and its owner from the active profile and credential. Show the hosted destination, workspace name, object counts, unsupported features, and whether publication is already pending or complete. Refuse ambiguous ownership, active conflicting publication, unsupported schema, or records the importer cannot preserve. Never silently skip work.
2. **Establish hosted ownership.** Build an explicit, bounded enrollment flow to bind a fresh hosted owner credential to this human and one private workspace namespace. Specify proof, expiry, abuse/rate limits, recovery, and revocation before exposing a write route. Store credentials privately and never print them into normal output, logs, invitations, or the Viewer.
3. **Take a consistent snapshot.** Capture the selected workspace and all required dependencies at one local append position, including organization/team/actor references, memberships, sessions, goals, tasks, findings, decisions, artifacts, corrections, citations, contributions, and supported newer domain records. Preserve original IDs, timestamps, source relationships, agent/human attribution, and ordered provenance. Export only allow-listed structured state. Reject external-system secrets, raw transcript material, unrecognized tables, and references that cannot be faithfully represented.
4. **Import privately and verify.** Send the bounded, integrity-checked snapshot over HTTPS to a private staging boundary in the new hosted path. The Worker validates version, schema, references, owner binding, size, workspace isolation, and a retry key. Promote only a complete validated graph. A failed or interrupted import exposes no partial workspace to ordinary reads or invitations. Same request plus same digest is idempotent; changed content under the same request conflicts. Define chunking and atomic visibility explicitly if one D1 transaction cannot hold the snapshot.
5. **Cut over safely.** Keep local data as a recoverable backup. Freeze or reject local writes during finalization, verify hosted reads as the owner and agent against counts, IDs, currentness, and the source tip, then persist the remote profile and credentials atomically enough to recover after a crash. A failed local profile write must be retryable without creating a duplicate hosted workspace. Do not let the local and hosted copies silently diverge as two writable authorities.
6. **Invite and continue.** The ordinary owner command issues a private invitation against the newly published workspace. The iMac joins with its own human and OpenCode agent identities, reads the original finding through authorized Campfire state, registers its session before writing, and creates a scoped implementation task. A fresh MacBook session reads that task from the hosted service. The MacBook local service may be stopped throughout the iMac phase.

Command names, payload schema, limits, and the exact hosted enrollment mechanism are Step 0 design outputs. They must be frozen in the interface contract before code, and the final CLI catalog/help, human/JSON receipts, README, and recovery guidance must match. `invite-teammate` must not imply that publishing occurred merely because a public URL was supplied.

## 4. Security and data integrity gates

- **Owner authority:** Only the current local human owner can initiate publication; agent sessions cannot grant hosted ownership. The destination binds the imported owner and workspace before accepting data. Membership, actor tokens, and invitation secrets remain different authorities.
- **No cross-tenant reads or writes:** A second hosted owner, nonparticipant, wrong workspace, revoked token, and malicious or malformed snapshot cannot read, overwrite, or invite from this workspace. Object IDs supplied by the client are never sufficient authority.
- **Credentials:** Do not transfer local bearer tokens or token hashes as portable hosted credentials. Mint fresh endpoint-bound owner and agent tokens and rebind the local harness through the supported connection flow. Preserve actor IDs and provenance without reusing credential material. Invitation files retain their current narrow capability and 0600 handling.
- **Completeness:** Compare every selected object family, IDs, relationship edges, contribution order, currentness, and the frozen source tip. Unsupported state fails closed with a specific recovery reason. No transcript, arbitrary filesystem path, webhook secret, or provider credential enters hosted publication.
- **Failure recovery:** Test lost responses before/after hosted commit, interrupted upload, duplicate retry, changed digest, local profile persistence failure, stale local write, hosted outage, and MacBook restart. The local backup remains inspectable. Receipts distinguish `not_started`, `staged`, `committed`, `verified`, and `cut_over`; they never report success at an earlier stage.
- **Operational guard:** Bound account creation, request body/chunks, import duration, storage, retention, logging, and per-source attempts. A production write route requires an explicit abuse and cost review; a private alpha gate is insufficient to claim safe public self-service.

## 5. Sprint sequence and release gates

| Date | Work | Exit evidence |
| --- | --- | --- |
| **Oct 23–24** | Freeze v1.26.1 and the installed-user failure; decide the first hosted deployment, owner identity/recovery, tenant isolation, abuse controls, snapshot contract, and cutover protocol. Amend the Canon for this narrow hosting slice. | Reviewed architecture and threat model; if these cannot be made safe within the release window, mark the date at risk before coding a public write route. |
| **Oct 25–27** | Build and test the first hosted ownership/provisioning path, private import, local snapshot, and recoverable profile cutover on an isolated environment. | Auth, isolation, data completeness, idempotency, no-partial-visibility, crash recovery, and SQLite/D1 parity pass. A backend-only proof is an engineering milestone, not the user fix. |
| **Oct 28** | Package and run the clean-install two-machine path, MacBook to hosted service to iMac and back, with MacBook service offline. | iMac independently retrieves `find_5cd543722a044c20`, records an attributed scoped task, and fresh MacBook reads it; no hand-written recap or manual hosting. |
| **Oct 29** | Resolve observed blockers and rerun security, restart, migration, clean-export build, package, and production-like deployment checks. | A dated evidence matrix shows every gate passed or an explicit failure. |
| **Oct 30** | Separate founder release review; then resume the native continuity alpha only if SHR-001 passes. | `GO` requires all security/data-integrity and two-Mac gates. Otherwise hold v1.26.2 and report the blocker; do not relabel a tunnel or a copied finding as completion. |

Parallel UI shell work may continue, but the native alpha's shared-data gate depends on SHR-001. The October 30 date is a review target, not a credible promise that a new hosted product can be completed in a week. If the hosted identity/provisioning design or the two-Mac path does not pass, record the foundation work as incomplete and move the release; do not call groundwork alone a v1.26.2 fix.

## 6. Immediate Step 0 deliverables

- Capture a token-free reproduction from the installed v1.26.1 path and pin the source version and schema on both sides.
- Specify hosted enrollment ownership, credential recovery/revocation, abuse controls, and operator responsibility.
- Produce a table-by-table snapshot manifest with relationships, exclusions, size limits, and a validation answer key for the Arbora finding.
- Define staging, atomic visibility, idempotency, cutover, and rollback receipts before implementation.
- Add a failing end-to-end acceptance case for local creation → publish → invite → join → read with the source Mac offline. Keep it separate from the existing fixture-only invitation tests.

**Current state:** Diagnosis and sprint scope are recorded. No publish capability, migrated Arbora workspace, two-Mac pass, v1.26.2 package, or release is claimed by this document.
