# v1.26.0 release decision — ACT-001 Propose and Follow Up (minor)

**Date:** October 21, 2026

**Status:** Founder-directed release preparation recorded; publication steps tracked below as they complete. This revision claims no tag, public snapshot, GitHub Release, channel pin, or deployment.
**Package target:** `1.26.0`
**Contract:** `docs/Campfire-v1.26-ACT-001-Propose-and-Follow-Up.md` (§9 D1–D9, §10, §11)
**Sprint result:** `docs/SPRINT_ACT_001_RESULT.md` — **CONDITIONAL GO — engineering candidate**: D1–D9 pass on the recorded candidate `932af8afca52b8921636ffd69a572d6240ba74d7`; the live Codex path, the live OpenCode path, and the real-provider round trip are unrun.
**Candidate commits:** Step 0 `3080907`; implementation `862da8d`; portable telemetry fixture correction `932af8a` (scored candidate); result record `ff1a54d`; release-prep revision pending on `main`.

## Founder direction and release boundary

On October 21, 2026 the founder directed this release in the `Campfire-Internal` repository, verbatim:

> "lets commit/push/tag/release both @Campfire-Internal/ and @Campfire/ public repo! ACT-001 is now a CONDITIONAL GO engineering candidate."

This is the separate founder release decision that contract §10 requires before a version bump, tag, public snapshot, channel pin, or deployment. It authorizes the private commit and push, the `1.26.0` version bump and annotated tag, the audited public snapshot and GitHub Release, install-channel promotion, and the production deploy. Those steps are recorded in the promotion table only as they complete.

This document does **not** convert the sprint verdict to GO. The recorded postures bound every claim:

- Live Codex path: **NOT OBSERVED**. Live OpenCode path: **NOT OBSERVED**. No live cross-harness continuation is claimed.
- Real-provider verification retry: **NOT AUTHORIZED**. No provider interoperability is claimed. The synthetic stub exercises the client procedure only.
- Step 0 sequencing deviation: the evidence was captured while partial product code already existed uncommitted, so the contract's pre-code freeze was not achieved retroactively. This is a process deviation, not a failed behavior check.
- These limits do not convert D9 to a failure and do not create a human-testing veto for this release. They bound the public claim.
- No gate is moved. Gate B/C/E/F, CAP-001's open observations, and every earlier sprint verdict keep their recorded status.

## The exact release surface (nothing else)

The published v1.25.0 surface gains exactly the ACT-001 candidate plus release-prep documentation and the version bump:

- **ActionProposal aggregate** (`src/domain/action-proposal.ts`) on migration `migrations/0009_action_proposals.sql`: one workspace-owned proposal with an immutable `ACT001-INTENT-V1` canonical intent and fixed-order SHA-256 digest, bounded evidence and reason, a designated executor, expiry, review transitions, an append-only transition and submission-receipt trail, mutation idempotency receipts, and normalized ingress receipts. Matching local schema/bootstrap and D1 paths are included.
- **Eight service methods**: `propose_action`, `review_action`, `cancel_action`, `reserve_action_execution`, `record_action_outcome`, `get_action_proposal`, `list_action_proposals`, and `list_action_receipts`, with in-transaction authority, revision, digest, evidence, and configuration rechecks.
- **Six MCP tools**: `propose_action`, `reserve_action_execution`, `record_action_outcome`, `get_action_proposal`, `list_action_proposals`, and `list_action_receipts`. `review_action` and `cancel_action` are deliberately absent from MCP; human approval and cancellation remain CLI-only.
- **`campfire actions` CLI family**: `propose`, `approve`, `reject`, `cancel`, `reserve`, `receipt`, `inspect`, `list`, and `receipts`, with explicit `--revision`, `--digest`, and `--request-key` on mutations. Input files are bounded structured JSON and are never executed.
- **Catalog entries** in the shared CAP-001 semantic catalog for the installed proposal, review, receipt, and follow-up paths, including the human-only review precondition and the absent MCP approval surfaces.
- **Operator-bound inbound ingress** `POST /v1/integrations/github/:sourceId` on both the local serve path and the Worker path: raw-byte HMAC-SHA256 verification, 256 KiB body bound, ten-second read deadline, source-authority fingerprint binding, semantic deduplication, and one atomic cited Finding plus Artifact reference per accepted completion.
- **No new Viewer tab or write path.** Existing Viewer reads may show the ordinary Finding and Artifact through their current surfaces.
- **No new outbound event.** The eight existing outbound event names are unchanged; an inbound provider event is neither an outbound DomainEvent nor an approval.
- **No provider credential in Campfire.** Campfire makes no GitHub API call, stores no token, and exposes no `execute`, `run`, or GitHub dispatch endpoint.
- **Compatibility preserved**: existing v1.25.0 CLI JSON shapes, MCP tool names and schemas, HTTP `/v1/call` methods, Viewer allowlist, orientation and attention selection, session instructions, playbook gate, CAP-001 recipe content, and outbound event vocabulary remain unchanged except for the explicit additive entries above.
- **Versioned installer**: `public/campfire/v1.26.0/install.sh` is tracked from the current installer; published installer copies for earlier versions remain immutable.
- **Release-prep fixture copies**: the public export excludes `docs/evidence/`, so the frozen Step 0 `answer-key.json`, baseline comparison files, and proposal signing vectors needed by the exported ACT-001 tests are copied to `fixtures/act-001/step-0/`. A private-only parity test (`tests/unit/act-001-step0-parity.test.ts`) keeps every copy byte-equal to the canonical evidence and is excluded from the public snapshot.

## Evidence status in this release

| Evidence | Status in this release |
| --- | --- |
| D1 — baseline preservation | PASS. v1.25.0 CLI JSON, MCP schemas, HTTP methods, Viewer allowlist, orientation/attention selection, session instructions, playbook gate, CAP-001 recipe content, and outbound event vocabulary are unchanged except by explicit additive change. The eight service methods, six MCP tools, `actions` CLI family, catalog additions, and dedicated ingress are covered by the baseline and interface tests. |
| D2 — authority and isolation | PASS. The full §4 matrix passes locally and in D1: agent owner, viewer, expired session, wrong workspace, forged author, approver/executor membership removal, and closed workspace. No cross-workspace leakage. Human-only review fails through every agent path, including direct `/v1/call`. |
| D3 — immutable approval and lifecycle | PASS. Digests match the frozen Step 0 vectors; mutated intent, evidence, version, executor, or expiry cannot reuse approval. All transitions and forbidden reversals are tested. No Decision, task assignment, signed event, or outbound DomainEvent grants dispatch authority. |
| D4 — reservation, receipts, uncertain effects | PASS. Concurrent approval/cancel/reservation and duplicate mutation tests in SQLite and D1 establish one dispatch slot and exact replay, including two separately approved proposals for the same provider target/attempt. Crash-before-submission, lost response, event-before-receipt, conflicting external attempt, and reconciliation preserve ambiguity or evidence. No automatic second POST, timeout requeue, or exactly-once external claim. |
| D5 — signed ingress and replay | PASS. Raw-byte HMAC, tampering, missing signature, forged/reused delivery ids, semantic duplicates under a new delivery/source id, source rebinding, wrong repo/workflow/SHA/attempt, unknown source, rotated secret, timestamp bounds, invalid/oversized/chunked body, unavailable integration session, and unrelated events are covered. Concurrent valid deliveries create exactly one evidence pair; rollback/retry leaves no orphan. |
| D6 — provenance and bounded retrieval | PASS. A second actor identifies the proposal, human reviewer, executor, submission receipt, and signed observation from record ids alone. Actor/session/principal, uncertainty, and provider conclusion are preserved. Long histories page with cursor misuse failing. No raw payload, log, token, CLI output, public asset, or Viewer read leaks. Failure/cancelled runs never appear as success. |
| D7 — continuation fixture | PASS (fixture). The isolated client procedure completes propose → human review → external-stub submission → signed completion → second-client inspection without a transcript, including reject, no-dispatch, unknown-submission, and failed-verification branches. The stub's only simulated authority is labeled; fixtures are not live GitHub or human demand. |
| D8 — migration and service parity | PASS. Fresh and upgraded local and D1 stores preserve v1.25.0 content and run identical action, event, and race answer keys. No provider request runs in a DB transaction. A disabled integration accepts no event writes; enabling it grants no other source, action, or workspace. No new background process or outbound event. |
| D9 — distribution and regression | PASS on `932af8a`. Focused tests (127 passed), full suite (118 files, 1,482 passed / 1 skipped), typecheck, build, source/public asset parity, isolated `pack:tarball`, audited 391-file public export, and `deploy:dry-run` pass. Export includes source, migration, and synthetic tests and excludes private evidence/config/secrets. No live migration or deploy occurred. |
| Live Codex / OpenCode paths | **NOT OBSERVED.** Same frozen continuation prompt, isolated workspaces, no fixture ids — unrun. |
| Real-provider round trip | **NOT AUTHORIZED.** One verification retry plus matching native webhook against a dedicated test target requires explicit operator authorization for that action, which was not given. |
| Step 0 sequencing | **DEVIATION RECORDED.** Evidence was captured while partial product code already existed uncommitted; the candidate commits do not make that an earlier freeze. |
| Gates and earlier sprint verdicts | **Unchanged.** This release satisfies none of them and rescores none of them. |

## Public release notes (v1.26.0)

Used verbatim for the GitHub Release body:

```markdown
Campfire v1.26.0 — Propose and Follow Up

Campfire can now record one human-approved verification retry in a workspace and let another authorized teammate or harness continue from attributed submission receipts and signed completion evidence, without sharing a private transcript.

- A workspace-owned action proposal records an immutable intent for retrying the failed jobs of one GitHub Actions verification workflow: repository, workflow, run, commit SHA, expected attempt, designated executor, expiry, reason, and cited local evidence. A human workspace owner reviews that exact intent and approves or rejects it through the CLI. Approval binds the normalized intent, evidence, and executor; edits require a new proposal and fresh approval.
- An approved proposal has exactly one dispatch reservation for its provider target and attempt. The external client verifies the target, submits the retry once with its own GitHub credential, and records accepted, definite failure before submission, or unknown. Campfire stores no GitHub credential and never calls GitHub. A submission receipt means the request was accepted; it is not proof the tests passed. A lost or timed-out response stays unknown and is never retried automatically.
- The operator-configured `POST /v1/integrations/github/:sourceId` ingress verifies the raw-body HMAC signature for a configured repository and workflow, then correlates a signed `workflow_run` completion to one reserved proposal. In one transaction it creates one cited Finding and one Artifact reference; a redelivery returns the existing receipt. Unsigned, replayed, uncorrelated, or conflicting deliveries create no workspace records. Campfire discards raw webhook bytes and logs no bodies.
- Failure, cancellation, skipped, and unknown outcomes remain explicit; only provider `success` is reported as verification success. The ingress creates no task, decision, approval, automatic rerun, or presence claim. Review and cancellation remain human CLI actions: there is no MCP approval tool and no Campfire execute endpoint. No new Viewer tab and no new outbound event are added.
- The bounded result is **CONDITIONAL GO — engineering candidate**. D1–D9 pass on the recorded candidate, including a 391-file audited public export and 19 frozen fixture checks. Live Codex and OpenCode sessions are **NOT OBSERVED**, the real-provider round trip is **NOT AUTHORIZED**, and Step 0 was captured with partial product code already uncommitted. This release does not claim provider interoperability, live cross-harness continuation, human demand, or usefulness.

Darwin and Linux archives for ARM64 and x64, with SHA-256 checksum files, are produced by the release workflow. The versioned installer at `campfire/v1.26.0/install.sh` pins this release.
```

## What users should know

- Approval is a human-only CLI action. An agent token cannot approve, reject, or cancel a proposal, including for its own proposal or through direct `/v1/call`.
- A submission receipt records what the executor reported to Campfire. It is not evidence that tests passed; signed provider completion evidence is a separate observation, and only provider `success` is reported as verification success.
- One approval yields one dispatch slot for one exact provider target and attempt. Campfire does not retry automatically. A lost response is recorded as unknown and must be reconciled against the provider; Campfire does not claim exactly-once external execution.
- Campfire stores no GitHub credential and calls no GitHub API. The external client owns its credential and its GitHub authorization is independent of Campfire approval.
- The signed ingress is disabled unless one complete operator binding is configured. It requires a dedicated existing integration agent that is already a non-viewer workspace participant with a registered live session, uses a secret distinct from the outbound webhook secret, and cannot be rebound to another workspace or target under the same source id.
- The ingress verifies the raw body with HMAC-SHA256 before parsing, bounds the body at 256 KiB, and stores no raw payload or logs. Responses are bounded and expose no workspace or record content; unknown sources return 404.
- There is no MCP review or cancel tool, no Campfire execute endpoint, no provider polling loop, no new Viewer write path, and no new outbound event name.
- The live harness paths and the real-provider path are unproven. This is a bounded engineering claim, not a provider-interoperability or ordinary-team-demand result, and it moves no gate.

## Promotion record

Each step is recorded with its evidence as it completes; no check is loosened. Nothing below is claimed as performed until its row names the evidence. The release-prep verification battery is expected to show the pre-pin install-channel assertion until the four v1.26.0 release checksums are pinned; that assertion is not to be loosened.

| Step | Evidence |
| --- | --- |
| Founder direction and release-prep revision | PASS. Release-prep commits `019db92` (version `1.26.0`, tracked `public/campfire/v1.26.0/install.sh`) and `bace39d` (public copies of the frozen Step 0 fixtures plus a private-only parity test). `package.json`/`package-lock.json` are `1.26.0`; `git diff` shows no change to any earlier `public/campfire/v*/install.sh`. |
| Release-prep verification battery | PASS at `bace39d`: `npm run typecheck`; full `npm test` 119 files / 1,490 passed / 1 pre-recorded install-channel failure / 1 opt-in skip (1,492); `npm run build`; `npm run deploy:dry-run` (75 assets, stopped at `--dry-run: exiting now`); `npm run pack:tarball` (extracted package `1.26.0`, Darwin ARM64); audited public export wrote **401 files** with no forbidden path or secret-pattern match; the exported ACT-001 tests passed **105/105**. The pre-pin install-channel failure remains the expected assertion and was not loosened. |
| Private annotated `v1.26.0` tag | **PENDING.** To record the tag object and the exact release-prep commit it points to, plus the private `main` and tag push. The tag will not move. |
| Audited public source snapshot and tag | **PENDING.** To record manifest-file parity, `sourceCommit`, forbidden-path and secret-pattern results, the public snapshot commit, the annotated tag object, and the public CI result. |
| Public GitHub Release and four checked archives | **PENDING.** To record the Release URL, draft/prerelease state, workflow run, four platform jobs, eight attached assets, downloaded checksum verification, extracted package version, and SHA-256 values. |
| Homebrew / Nix pins, tap promotion, installer checks | **PENDING.** To record `sync-install-channels.mjs --version 1.26.0`, `--check`, the post-pin private suite, the private pin commit, the public addendum with immutable `sourceCommit`, public CI, and the tap commit. |
| Production Worker deployment and live verification | **PENDING.** To record the deployed Worker version, live route checks, current and `/v1.26.0/` installer byte identity, immutable prior installer, and a clean isolated install reporting `1.26.0`. The Viewer remains loopback-only. |
