# Campfire v1.26 — ACT-001: Propose and Follow Up

**Date:** October 21, 2026
**Status:** Frozen sprint contract with a local engineering candidate. The [result](SPRINT_ACT_001_RESULT.md) records D1–D9, the Step 0 sequencing deviation, and open live observations. No release decision is recorded.
**Baseline:** Published and deployed `v1.25.0`. Private annotated tag `de4d447d243356d0c7ebdb8258803e8d167f7689` → release source `4e6b7e714960f90cf5d78ee43a8f7e95bf8fe12f`. See [release record](RELEASE_V1_25_DECISION.md). CAP-001 remains CONDITIONAL GO; automatic adoption and improved continuation remain unproven.
**Direction:** [Roadmap](ROADMAP.md), Phase 8 and the two-cycle capability sequence; [Architecture](ARCHITECTURE.md), planned ACT-001 boundary.
**Release shape:** Candidate minor `v1.26.0`. Implementation keeps the current package version until separate release preparation is authorized. Planning this sprint does not authorize an external CI rerun, webhook installation, version bump, tag, publication, migration of production, or deployment.

## 0. Product question and bounded claim

> Can a teammate propose one concrete external verification action, have a human approve its exact effect, and let another harness inspect its execution receipt and signed completion evidence without sharing a private transcript?

This sprint pairs **action proposals and outcome receipts** with **event-driven follow-up** in one vertical slice. The selected pilot is **retry the failed jobs of one GitHub Actions verification workflow**, followed by that run's signed `workflow_run` completion event. This is the sprint's proposed pilot choice; freeze the exact repository, workflow, fixture, and schemas in Step 0 before implementation. The user-selected roadmap cycle authorizes planning this bounded controlled-action probe; it does not establish Gate F demand or authorize a broader capability system.

Campfire records intent, human approval, a single dispatch reservation, submission receipts, and cited external observations. The external harness owns GitHub credentials and performs the rerun. GitHub remains the source of truth for the workflow result. A submission receipt is not proof the tests passed; a successful test run is not permission to merge, release, deploy, complete a task, or accept a decision.

The earned release claim is: **one workspace can record a human-approved verification retry and continue from attributed submission receipts and deduplicated signed completion evidence.** Ordinary team demand, automatic agent adoption, and faster incident resolution require separate observations.

## 1. Step 0 — freeze before product code

Commit `docs/evidence/act-001/step-0/` with:

1. The v1.25.0 tag/source pin, installed CLI manifest, MCP inventory and schemas, HTTP method list, Viewer allowlist, orientation projection, contribution/event vocabulary, and local/D1 schema snapshots. Mask credentials and machine-specific paths.
2. An exact pilot allowlist: one numeric GitHub repository id, its configured owner/name, one numeric verification workflow id/path, allowed originating event, and a dedicated test repository for any external mutation. Use a workflow with no deployment, publication, release, downstream privileged workflow, or production mutation. Inspect the workflow and its dependent jobs at the approved revision; a workflow filename alone is insufficient evidence of its effect.
3. A synthetic workspace with a goal, task, current and superseded findings, cited artifact, owner human, member human, viewer, proposing agent, designated executing agent in another supported harness, expired/unregistered agent, and non-participant. Include a second workspace and conflicting/delayed provider attempts. Freeze all expected ids and contribution counts.
4. Canonical proposal JSON, digest test vectors, authority matrix, transitions, schema bounds, idempotency keys, pagination/error shapes, signed payload fixtures, and the exact new interface inventory. Freeze concurrent approval/reservation and event-before-receipt cases.
5. A baseline continuation task: explain who authorized the rerun, exactly which commit/run it covers, what was submitted versus observed, and what remains unknown. Capture the v1.25 path and distinguish absent product support from a harness failure.
6. The test-host ingress arrangement for native signed webhooks. Isolated fixtures must not rewrite real harness profiles, start the normal `campfire up` profile, use production credentials, or mutate a public repository. A real-provider test requires a dedicated test target and explicit operator authorization for that action.

Step 0 must resolve any mismatch between the proposed pilot and provider behavior before code. Changing an answer key after a run requires a dated amendment and new evidence, not rescoring the old trace.

## 2. The smallest end-to-end experience

1. An authorized agent reads the existing task and evidence, then proposes retrying a failed verification run. Campfire records a proposal with immutable target, intended effect, evidence, and designated executor.
2. A human workspace owner inspects that exact proposal through the CLI and approves or rejects it. Approval displays the repository, workflow, run id, original attempt, commit SHA, executor, expiry, and evidence. There is no browser approval or agent-mediated human token.
3. The designated executor reads the proposal from either supported harness and reserves its one dispatch slot. Campfire rechecks current authority and returns the approved intent, not a GitHub credential or an executable script.
4. The external client verifies that the provider target still matches, submits the retry once using its own credential, and records whether submission was accepted, definitely failed without dispatch, or is unknown.
5. A valid, correlated completion webhook records a bounded Artifact reference and Finding in the same workspace. Redelivery returns the existing receipt and creates no additional records.
6. Another authorized human or agent reads the proposal, submission receipts, event evidence, and existing task. It can explain the result without the original transcript. It performs any task/decision transition through the existing explicit method and authority checks.

## 3. Proposal and receipt model

Add one workspace-owned **ActionProposal** aggregate, with append-only receipts and review transitions. Do not encode approval as a Task status, a Finding assertion, an accepted Decision, or the outbound bridge queue. These existing objects keep their meanings.

| Field | Contract |
| --- | --- |
| `id`, `workspaceId`, `createdAt`, `updatedAt`, `revision` | Server-generated identity/time and monotonic revision. Every transition uses an expected revision. |
| `kind` | Exactly `ci.retry_verification` in ACT-001. Core treats provider data as a bounded validated intent; provider-specific validation belongs in an integration adapter. No plugin registry or generic executor. |
| `intentVersion`, `intent`, `intentDigest` | Version 1 canonical approval envelope, immutable after proposal. SHA-256 covers intent/version, reason, task/evidence ids and their captured versions/currentness, and source-binding authority revision, in a fixed-order normalized encoding pinned by Step 0 vectors. No executable command, credential, free-form URL, or script. |
| `intent.target` | Adapter-validated GitHub repository id, configured repository name, workflow id, run id, full commit SHA, and `expectedAttempt`. Numeric provider ids are represented as validated decimal strings. The target identifies a completed failed verification run, never a moving branch. |
| `intent.executor` | Exactly one existing human or agent participant. Agent ownership and acting principal remain distinct. Execution rights do not follow from sharing a human owner. |
| `intent.expiresAt` | Server-clock approval/dispatch deadline, at most 24 hours after creation. Expiry before reservation prevents dispatch; expiry afterward does not prove an external request was cancelled. |
| `reason`, `taskId`, `findingIds`, `artifactIds` | Required short reason and one same-workspace task; at least one cited finding or artifact, at most 10 total references. Validate access and membership of every referenced record. |
| `proposedBy`, review and reservation identity | Actor type/id, agent session reference and human principal where applicable, server time, revision and digest. Clients cannot supply another actor as the author. |
| `status` | `proposed`, `approved`, `rejected`, `cancelled`, `dispatch_reserved`, `submission_accepted`, `submission_failed`, or `submission_unknown`. Provider completion is a separate observation; none of these statuses means tests passed. |

Approval binds the entire normalized intent, the evidence references and their relevant currentness/version, and the designated executor. Edits require a new proposal and fresh approval. Before reservation, changed/withdrawn cited evidence, a changed task state/version, an expired approval, disabled source configuration, or lost proposer/approver/executor authority invalidates dispatch and returns a conflict with a bounded recovery hint. No auto-reapproval. The reservation captures the approved evidence snapshot so later corrections remain inspectable without pretending they retroactively prevented an already dispatched action.

Campfire validates structure, configured target identifiers and local cited state; it makes no network request to prove the provider run failed. The proposal labels remote run facts as the proposer's evidence-backed assertions until the human/client verifies them externally. `get_action_proposal` returns the human review and reservation facts plus bounded latest submission and signed-observation references. `list_action_receipts` pages the review/reservation/submission/reconciliation trail with references to linked provider observations; it never flattens those different authorities into one success boolean.

Submission receipts are append-only children of the proposal. Each has `id`, `proposalId`, `reservationId`, `intentDigest`, reporting actor/session, `recordedAt`, `outcome`, a bounded safe provider reference, and `requestKey`. Outcomes distinguish accepted submission, definite failure before submission, and unknown submission. Store no request headers, response bodies, logs, token, or shell text. A later reconciliation receipt may resolve an unknown submission with cited provider evidence; preserve the original uncertainty. Reject contradictory terminal receipts instead of overwriting them. A signed completion remains identifiable as provider evidence rather than an executor assertion.

Limits: intent ≤4 KiB; reason ≤500 characters; each receipt ≤2 KiB; proposal projection ≤16 KiB; read pages default 20/max 100 and ≤64 KiB. Receipt/history pages are separate from the selected proposal's summary. Long histories must not silently expand an orientation read. All user/provider labels are untrusted display text.

## 4. Authority, transitions, concurrency, and retries

| Caller | Read | Propose | Approve/reject/cancel before reservation | Reserve and report submission |
| --- | --- | --- | --- | --- |
| Human owner | Same-workspace records | Yes | Yes, with their own human credential | Only when designated executor |
| Human member | Same-workspace records | Yes | No | Only when designated executor |
| Registered agent member/owner | Same-workspace records | Yes | No, including approval of its own proposal | Only when designated executor, with its own valid session |
| Viewer, including agent viewer | Same-workspace records | No | No | No |
| Non-participant, wrong workspace, invalid credential | No | No | No | No |

An agent's role named `owner` never passes a human-only approval check. An instance-operator or webhook signing secret is not a workspace human credential. Recheck current membership, role, session, workspace `active` lifecycle, revision, digest, evidence snapshot, and configuration when committing a mutation; a check followed by an unguarded write is insufficient. Closed workspaces remain readable under existing policy and accept no new ACT-001 mutations. Failed/denied requests create no collaboration contribution.

Allowed transitions:

```text
proposed -> approved | rejected | cancelled
approved -> cancelled | dispatch_reserved
dispatch_reserved -> submission_accepted | submission_failed | submission_unknown
submission_unknown -> reconciliation receipt (accepted or definite failure)
```

Terminal rejected/cancelled proposals cannot reopen. A human may propose another action after inspecting a failed result. Once reserved, cancellation cannot claim to stop external execution. No automatic reservation expiry, executor takeover, background retry, or second dispatch under the same approval. A crashed executor leaves a reservation requiring reconciliation. Membership revocation prevents further authorized calls; Campfire cannot recall a request already sent to GitHub. Document that boundary directly.

Reservation also enforces a workspace-wide unique provider target key over repository, workflow, run id and expected attempt, so two separately approved proposals cannot reserve the same retry. This key survives terminal receipts and crashes. ACT-001 permits one dispatch reservation for that exact target/attempt; a genuinely new provider run/attempt needs a new proposal and approval. Retrying a definite no-submission outcome for the same target is deferred rather than silently creating another dispatch path. An inbound completion must correlate to exactly one reserved proposal.

Every mutation accepts a caller-generated `requestKey` of 1–128 printable ASCII characters. Scope deduplication to workspace, actor, method and key; equal normalized input returns the prior result, unequal input conflicts. Authenticate and recheck current access before returning a replay; after that, a committed replay does not rerun transitions or fail merely because the revision already advanced. The reservation itself is the one dispatch identity. Concurrent callers cannot reserve twice, approve two revisions, or append the same receipt twice. Do not hold a database transaction open across the provider request.

The external retry endpoint provides no Campfire exactly-once guarantee. After a timeout or lost response, record `submission_unknown` and inspect the exact provider run/attempt. Do not POST again merely because a response was lost. A conflicting external rerun or unverifiable attempt stays ambiguous; the system must not claim sole causation from a matching completion event.

## 5. Selected external action and signed event

### 5.1 External execution

The client validates the exact allowlisted repository/workflow, full SHA, failed completed run, expected attempt, and verification-only effect before submitting `POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun-failed-jobs`. GitHub authorization is independent of Campfire approval. The client owns the minimum required GitHub credential; Campfire stores none of it. Recheck the provider immediately before dispatch and stop on drift. A provider response accepting the request records submission only. Pin the API version and the observed response/attempt behavior in Step 0. See [GitHub workflow-run API](https://docs.github.com/en/rest/actions/workflow-runs#re-run-failed-jobs-from-a-workflow-run).

Ship recording/inspection commands and a documented client procedure, not a Campfire `execute`, `run`, or GitHub dispatch endpoint. No provider credential, outbound GitHub API call, command launcher, watcher, or CI polling loop belongs in the Campfire service. A test driver may submit once against a specifically authorized test repository; it is not installed as a daemon or a generic product runner.

### 5.2 Operator-bound inbound source

Add a dedicated HTTP ingress `POST /v1/integrations/github/:sourceId` on both the local serve and Worker paths. Keep it outside `/v1/call`, MCP, the Viewer proxy, and the outbound webhook bridge. It is disabled unless one complete source binding is configured. Bind a non-secret source id to exactly one workspace, repository id/name, workflow id, action kind, signing secret, and a dedicated existing integration-agent identity/session. Use different inbound and outbound secrets. Source bindings and secrets are operator configuration, not an agent-editable workspace setting or discovery result. Configuration may not route by a workspace id supplied in the webhook body.

Persist a non-secret authority fingerprint when the source is first used. A used source id cannot be rebound to another workspace, provider target, or integration actor; changed authority needs a new source id and fresh approval for new actions. Secret/session renewal may keep the same authority binding, and never clears event deduplication. Step 0 defines that canonical fingerprint alongside the proposal digest.

The integration agent must already be a non-viewer workspace participant with an explicitly registered, valid session. The operator provisions it using existing identity/session methods; no silent session registration or invented `system` human. The ingress maps signature authority to this constrained server-side context, rechecks it on every write, and records the source's provider identity separately. Expired/revoked integration authority rejects the write with an operational error; it does not fall back to another participant.

Accept only `X-GitHub-Event: workflow_run`, payload `action: completed`, for the configured repository/workflow and an existing reserved proposal with the matching run id/SHA and `run_attempt == expectedAttempt + 1`. A matching event may arrive before the executor reports submission; reservation correlation is sufficient, and both facts remain separate. Unrelated/unreserved attempts and other event/action types create no workspace records. A native GitHub `ping` may return a bounded acknowledgement without creating state. Review current [GitHub webhook payload semantics](https://docs.github.com/en/webhooks/webhook-events-and-payloads#workflow_run) before freezing the adapter.

Stream-limit the raw body at 256 KiB before parsing; enforce a ten-second body-read deadline using the existing server primitives. Accept `application/json` with identity encoding only. Verify `X-Hub-Signature-256` against the exact raw bytes using HMAC-SHA256 and a timing-safe comparison before processing fields. Reject unsupported encoding, malformed JSON and missing/invalid signatures. HTTPS is required beyond explicit loopback tests. A signature proves integrity under the configured source secret; it does not grant approval or validate arbitrary instructions embedded in provider text. See [GitHub signature validation](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries).

### 5.3 Deduplication, attribution, and follow-up

Persist normalized ingress receipts with unique source/delivery identity and a second semantic uniqueness key over workspace, provider, repository, workflow, run id, attempt, and completion event. The semantic key is independent of source id and secret, so source replacement cannot duplicate the same workspace evidence. A delivery header alone is insufficient replay protection. Reusing a delivery id for different bytes conflicts; the same semantic event with a fresh delivery id cannot create another finding. Persist receipt keys with the evidence for the lifetime of the workspace; secret rotation never clears them. Verify signature and current source authority, then check retained duplicates before the first-seen timestamp rule. Reject first-seen completion timestamps more than 24 hours old or over five minutes in the future. These signed payload timestamps are an admission bound, not a cryptographic delivery timestamp. Old retained duplicates remain harmless acknowledgements. Conflicting conclusions for the same semantic attempt are conflicts, never silent updates to the original evidence.

In one atomic commit, reserve the semantic receipt, create one fixed-format Artifact reference to the configured GitHub run/attempt, create one cited Finding, and append the corresponding Contributions and existing applicable domain events. Rollback leaves none of them committed; a redelivery can retry safely. Concurrent duplicates produce exactly one pair. Discard raw webhook bytes after verification and normalization; store only digest, safe provider ids, attempt, conclusion, provider timestamp, receive time, source binding id, proposal/reservation ids and resulting finding/artifact ids.

Construct the Artifact URL from the configured GitHub repository and validated numeric run id; never fetch a payload-supplied URL. Store no logs, job output, user biographies, commit messages, raw webhook JSON, or provider credentials. The Finding uses a fixed summary such as `Verification attempt 2 completed: failure`, and distinguishes the signed source observation from a participant's assessment. The source binding's integration agent is the Campfire author; GitHub `sender` text does not impersonate a human approver or executor.

Every supported conclusion, including failure, cancellation, skipped or other terminal outcomes, stays explicit. Only provider `success` is reported as verification success; unrecognized strings normalize to `unknown` without a success claim. The ingress creates no task, approval, accepted decision, automatic correction/withdrawal, task completion, next action dispatch, or agent presence claim. One cited Finding is the sole automatic follow-up in ACT-001. Another participant chooses subsequent work.

For known configured sources return bounded outcomes: `200` accepted/duplicate/ignored, `400` malformed or inadmissible timestamp, `401` signature failure, `408` read timeout, `409` conflicting identity/conclusion, `413` too large, `415` unsupported content type/encoding, and `503` unavailable store or integration authority. Responses expose no workspace or record content; unknown sources return `404`. Operational logs omit bodies, secrets and provider text. Retriable failures create no partial state. Exact error envelopes and redaction are frozen in Step 0.

## 6. Interfaces and discoverability

All ordinary actor calls use the same service methods and authorization in local SQLite and hosted D1 paths. Pin these additions before implementation:

| Service / HTTP method | CLI | MCP |
| --- | --- | --- |
| `propose_action` | `campfire actions propose --workspace <id> --input <json-file>` | `propose_action` |
| `review_action` (`approve` or `reject`) | `campfire actions approve\|reject <id> --workspace <id> --revision <n> --digest <sha256> --request-key <key>`; rejection requires `--reason` | Unavailable: human operator CLI only |
| `cancel_action` | `campfire actions cancel <id>` with workspace/revision/digest/key and reason | Unavailable: human operator CLI only |
| `reserve_action_execution` | `campfire actions reserve <id>` with workspace/revision/digest/key | `reserve_action_execution` |
| `record_action_outcome` | `campfire actions receipt <id> --workspace <id> --input <json-file>` | `record_action_outcome` |
| `get_action_proposal` | `campfire actions inspect <id> --workspace <id>` | `get_action_proposal` |
| `list_action_proposals` | `campfire actions list --workspace <id> [--limit <n>] [--cursor <cursor>]` | `list_action_proposals` |
| `list_action_receipts` | `campfire actions receipts <id> --workspace <id> [--limit <n>] [--cursor <cursor>]` | `list_action_receipts` |

These are eight service methods and six MCP tools. Input files contain bounded structured data only and are never executed. Every mutation includes `requestKey`; revision/digest are required for review, cancellation, reservation and outcome recording as applicable. An actor's identity comes from credentials/session, not input JSON. Reads require explicit workspace and object ids. Lists are workspace-scoped, cursor-bound to actor/query/workspace and a frozen traversal tip, report `total`, `returned`, `truncated`, and `nextCursor` when another page exists, and never scan another workspace. CLI modes follow the existing auto/human/json contract; no approval prompt or secret is printed to a pipe.

Extend CAP-001's shared semantic catalog with truthful entries for these installed paths, including human-only review and source configuration preconditions. Mark absent MCP approval paths explicitly. Queries `action proposal`, `approve action`, `execution receipt`, and `verification follow up` must find the relevant operation or unavailable-surface explanation. Fetching static descriptions grants no authority and opens no store. ACT-001 does not expand the two CAP-001 read recipes or silently change their frozen answer keys. The recorded `read recipe` search gap remains a separately scoped follow-up.

No new Viewer tab or write path. No new dashboard attention selector, orientation keys, automatic full inspector read, per-command telemetry, or outbound bridge vocabulary is needed. Participants inspect actions through the new bounded CLI/MCP reads and existing Finding/Artifact/contribution reads. Existing Viewer surfaces may show the new ordinary Finding/Artifact through their current reads.

## 7. Persistence and implementation ownership

The current latest D1 migration is `0008_telemetry_integrity.sql`; reserve the next available migration number at Step 0 rather than colliding with concurrent work. Add matching local schema/bootstrap and D1 migration paths. Minimum records are proposal current state, append-only proposal transitions/submission receipts, mutation idempotency receipts, and normalized inbound event receipts. Keep relationships and unique constraints explicit; bounded canonical intent and provider metadata may use JSON. Do not add a general workflow graph, grant engine, scheduler or durable execution runtime.

Each mutation commits materialized state, its provenance and idempotency receipt atomically. The event-to-Finding/Artifact transaction also owns the semantic dedup receipt. D1 parity requires a real atomic batch/conditional-write design and concurrent tests; sequential awaits or local-only transaction wrappers do not establish it. Preserve all preexisting records/cursors; a fresh database and upgraded v1.25 database must produce equivalent ACT-001 semantics. Record action transitions under an explicit contribution object type without pretending they are Decision transitions. Use the bounded new receipt/history read rather than expanding existing `get_record_history` object types or the Viewer allowlist.

Layers: integration adapter verifies and normalizes provider bytes → application service applies configured source authority and proposal correlation → authorization/domain rules → repository transaction → SQLite/D1. Action proposal adapters are thin. Core makes no provider network call and contains no GitHub signature or endpoint-specific logic. Keep the eight existing outbound event names unchanged; an inbound event is neither an outbound DomainEvent nor an action approval.

## 8. Implementation sequence

| Step | Work | Exit evidence |
| --- | --- | --- |
| 0 | Freeze baseline, pilot effects, authority, schemas, digests, event bodies/signatures and fixture answer key. | Reproducible v1.25 baseline and reviewed ACT-001 amendment before product code. |
| 1 | Proposal/receipt model, migrations, guarded transitions, idempotency, local/D1 services. | Authority and race tests pass; denied calls commit no state. |
| 2 | CLI/MCP/HTTP methods and catalog mappings. | Human reviews exact effect; another harness reads/reserves/reports it without approval authority. |
| 3 | Operator-bound ingress, HMAC, bounded normalization, correlation and atomic follow-up. | Valid completion creates one evidence pair; forgery/replay/cross-workspace cases do not. |
| 4 | Client procedure, isolated provider stub, two-harness continuation and optional dedicated-provider run. | Submission versus completion/unknown is understood from records; no normal profile or production mutation. |
| 5 | Full checks, independent review and result record. | `docs/SPRINT_ACT_001_RESULT.md` names exact revision, D1–D9, limitations and separate release status. |

## 9. Deterministic acceptance contract

| Check | Required evidence |
| --- | --- |
| **D1 — baseline preservation** | Existing v1.25 CLI JSON, MCP schemas, orientation/attention selection, HTTP methods, session instructions, Viewer allowlist, playbook gate, CAP-001 recipe content and outbound event vocabulary remain compatible. The eight service/six MCP methods, `actions` CLI family, catalog additions and dedicated ingress are explicit additive changes. |
| **D2 — authority and isolation** | Test the full §4 matrix locally and in hosted services, including agent owner, viewer, expired session, wrong workspace, forged author, approver/executor membership removal and completed/archived workspace. No state or referenced id leaks across workspaces. Human-only review fails through every agent path, including direct `/v1/call`. |
| **D3 — immutable approval and lifecycle** | Digests match canonical vectors. Mutated intent/evidence/version/executor/expiry cannot reuse approval. All transitions and forbidden reversals are tested; an accepted Decision, task assignment, signed event or outbound DomainEvent never grants dispatch authority. |
| **D4 — reservation, receipts and uncertain effects** | Concurrent approval/cancel/reservation and duplicate mutation tests in SQLite and D1 establish one dispatch slot and exact replay, including two separately approved proposals for the same provider target/attempt. Crash before submission, lost provider response, event-before-receipt, conflicting external attempt and reconciliation preserve ambiguity or evidence. No automatic second POST, timeout requeue or claim of exactly-once external execution. |
| **D5 — signed ingress and replay** | Verify raw-byte HMAC, tampering, missing signature, forged/reused delivery ids, semantic duplicate with new delivery/source id, source rebinding, wrong repo/workflow/SHA/attempt, unknown source, rotated secret, timestamp bounds, invalid/oversized/chunked body, unavailable integration session and unrelated events. Concurrent valid deliveries create exactly one evidence pair; rollback/retry leaves no orphan. |
| **D6 — provenance and bounded retrieval** | Second actor identifies proposal, human reviewer, executor, submission receipt and signed observation from returned ids alone. Preserve actor/session/principal, uncertainty and provider conclusion. Page long action/receipt histories; cursor misuse fails. No raw payload/log/token reaches reads, errors, CLI output, public assets or Viewer. A failure/cancelled run never appears as success. |
| **D7 — continuation fixture** | Two isolated harness-shaped clients over the real service complete propose → human review → external-stub submission → signed completion → second-client inspection without a private transcript. Include reject, no dispatch, unknown submission and failed verification branches. The stub's only simulated authority is clearly labeled; fixtures do not count as live GitHub or human demand. |
| **D8 — migration and service parity** | Fresh/upgraded local and D1 stores preserve v1.25 content and run identical action, event and race answer keys. No provider request runs in a DB transaction. Disabled integration accepts no event writes; enabling it grants no other source/action/workspace. No new background process or extra outbound event is introduced. |
| **D9 — distribution and regression** | Focused tests, full suite, typecheck, build, source/public asset parity, isolated `pack:tarball`, audited public export and deploy dry run pass. Export includes source/migration and synthetic tests, excludes private evidence/config/secrets. Published installer copies remain immutable. A packaging refusal is pending evidence, never a waived pass; separately approved release preparation must close it. No live migration/deploy occurs during this gate. |

Independent review must inspect human approval bypasses, provider effect drift, actor/session attribution, replay, atomicity and the distinction between requested/observed outcomes. Record findings and fixes on the exact scored revision. Do not substitute a model's description of a simulated run for the required service assertions.

## 10. Live observations, verdict and release

After deterministic checks, run one real Codex and one real OpenCode session on isolated workspaces, using the same frozen continuation prompt and no fixture ids. Ask for the action/receipt path explicitly for this integration check; spontaneous discovery is a separate observation. A human operator uses their own isolated credential for approval. The harness must never receive that credential. Use the external stub unless a dedicated provider target and external mutation are explicitly authorized. Record setup, versions/models, exact calls, source ids, contributions and whether the action was simulated or real.

Separately, when authorized test infrastructure is available, record one real verification retry and matching native GitHub webhook. A signed synthetic payload validates the ingress contract but does not establish provider interoperability. Observe ordinary team demand for this approval/receipt path under Gate F when available. Missing demand/human-use evidence is NOT OBSERVED and does not itself veto an engineering release.

- **GO — bounded engineering and integration claim:** D1–D9 pass; both real harness paths correctly distinguish approval, submission and observation; the dedicated real-provider round trip passes. Any usefulness claim requires its own observed evidence.
- **CONDITIONAL GO — engineering candidate:** D1–D9 pass, but a live harness or real-provider path is unrun/unavailable, or a harness stops honestly without completing the task. Name each gap and preserve failed traces. Do not claim provider interoperability or complete cross-harness continuation for a missing/unsuccessful path. This label does not convert an authorization, corruption, replay or false-success defect into a pass.
- **NO-GO / REFRAME:** A deterministic check fails, a live path bypasses human approval or crosses a workspace boundary, duplicates an external effect through automatic retry, loses provenance, fabricates source ids, or reports a submission/failed run as verified success. Fix the concrete defect and rerun affected checks on a new recorded revision.

The result records engineering checks, harness behavior, provider interoperability and human demand separately. A separate founder release decision can authorize accurately scoped publication of a conditional candidate; no additional human-use veto is implied. No contract gate changes retrospectively, and no prior sprint or Gate B/C/E/F result is rescored.

## 11. Deliverables and stop

Deliver the Step 0 bundle; one proposal/receipt aggregate and matching migrations; eight service methods/six MCP tools and the CLI family; catalog mappings; one configured native signed source and atomic cited Finding follow-up; isolated fixtures and client procedure; D1–D9 evidence; live observations or named gaps; and the result record.

Stop after this pilot. Broader action classes, deployment/merge/release operations, arbitrary shell/code execution, agent approval, automatic reruns, provider polling, generic plugins, task automation, organization-wide discovery, Viewer writes and a capability/grant engine require another scoped decision. Implementation does not authorize production operation or publication.
