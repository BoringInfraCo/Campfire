# Campfire — Sprint ACT-001 Result: Propose and Follow Up

**Date:** October 21, 2026

**Status:** **CONDITIONAL GO — engineering candidate.** D1–D9 pass on recorded candidate `932af8afca52b8921636ffd69a572d6240ba74d7`. Package version stays `1.25.0`. This result does not bump a version, tag, publish a snapshot, or deploy. No release decision is recorded. No live harness path and no real-provider round trip was run.

**Contract:** `docs/Campfire-v1.26-ACT-001-Propose-and-Follow-Up.md` (§9 D1–D9, §10, §11)
**Step 0:** `docs/evidence/act-001/step-0/` (`STEP0.md`, committed as `3080907`; baseline HEAD `1fb4d79`, tag/source pin `de4d447d` → `4e6b7e7`). The capture began while partial product code was already uncommitted; this was not a clean pre-code freeze (§3).
**Implementation:** `862da8d`, followed by portable telemetry test-fixture correction `932af8a` (package `1.25.0`). The scored source revision is `932af8afca52b8921636ffd69a572d6240ba74d7`.
**Baseline:** published and deployed `v1.25.0`, package `1.25.0`.

## 0. Verdict and what it does not claim

Contract §10 defines **CONDITIONAL GO — engineering candidate** as D1–D9 passing with a live harness or real-provider path unrun. That is this record: all deterministic checks pass; the live Codex path, the live OpenCode path, and the dedicated real-provider retry are unrun.

- This record claims no GO, no provider interoperability, and no human demand or usefulness. The synthetic stub (`fixtures/act-001/github-rerun-stub.ts`) exercises the client procedure only; it is not a live GitHub observation and not human evidence.
- This record authorizes no release, version bump, tag, publication, migration of production, or deployment. D9's audited export is complete on the recorded candidate; publication still needs a separate release decision.
- Step 0 mismatches 1, 2 and 4 were resolved in the committed implementation. The pre-code freeze sequencing deviation remains visible (§3); no prior sprint or gate result is rescored.

## 1. What landed

One workspace-owned **ActionProposal** aggregate with append-only receipts and review transitions, on migration `migrations/0009_action_proposals.sql` (reserving Step 0's contested number by implementing it) with matching local schema/bootstrap and D1 paths:

- `src/domain/action-proposal.ts` — canonical `ACT001-INTENT-V1` envelope, fixed-order digest, bounds, authority rules.
- `src/store/action-proposal-schema.ts`, `src/store/action-proposal-records.ts` — proposal/receipt/mutation-idempotency/ingress-receipt records and constraints.
- `src/service/action-proposal-actions.ts`, `src/service/async-action-proposal-actions.ts` — eight service methods with in-commit-transaction rechecks.
- `src/service/github-ingress.ts`, `src/integrations/github-source-config.ts`, `src/integrations/github-workflow-run.ts` — operator-bound `POST /v1/integrations/github/:sourceId` ingress on local and Worker paths, HMAC verification, bounded normalization, atomic finding/artifact follow-up.
- CLI `campfire actions` family, six MCP tools, catalog mappings; no new Viewer tab or write path; eight existing outbound event names unchanged.
- Fixtures and client procedure: `fixtures/act-001/seed.ts`, `github-rerun-stub.ts`, `CLIENT.md`, `README.md`, `verify.mjs`.

Session fixes landed in the implementation: frozen digest envelope match; receipt-dedup scope; projection bounds; disabled-source recheck; D1 error mapping; fingerprint enforcement with session-rotation update; worker deadline race; 503 unification; review-TOCTOU in-transaction recheck; ingress in-transaction authority recheck; receipt ordering tiebreak (`recorded_at DESC, rowid DESC` in both SQLite and D1 receipt reads).

## 2. Checks actually run

Initial implementation checks ran on the uncommitted macOS tree over `1fb4d79`. After commits, the checks below were repeated on clean detached candidate `932af8a` with Node 22.23.2 and an offline `npm ci` for isolated packaging. Package version remained `1.25.0`.

| Command | Result |
| --- | --- |
| `node fixtures/act-001/verify.mjs` | pass, all 19 frozen-value checks (V1/V2 digests, V3 tamper-differs, 4 KiB bound, source fingerprint, HMAC accept/tamper/replay/wrong-repo/wrong-attempt/stale-timestamp, answer-key values, requestKey rule) |
| `npm run typecheck` | pass (`tsc --noEmit` exit 0; closes Step 0 mismatch 4) |
| `npm test` | **118 files, 1482 passed, 1 skipped** (1483). The skip is the existing opt-in Playwright test |
| ACT-001 focused files (`tests/unit/act-001-*.test.ts`, `tests/worker/act-001-*.test.ts`, `tests/integration/act-001-http.test.ts`) | pass inside the full suite above |
| `npm run build` | pass; served Viewer assets match `src/viewer/static/` |
| `npm run deploy:dry-run` | pass; Wrangler stopped at `--dry-run: exiting now`. No remote deploy |
| `npm run pack:tarball` | pass in the clean checkout after offline `npm ci`; Darwin ARM64 archive SHA-256 `ba36168590d10a01bc5ce3c9c9ea0523802168575d2b067cf8a76e646bd19fbe`, extracted package `1.25.0`. Output is gitignored under `release/`; no tracked archive overwritten |
| `node scripts/export-public-release.mjs --ref 932af8afca52b8921636ffd69a572d6240ba74d7 --output /tmp/act001-public-export-932af8a` | pass; audited 391 files, including migration `0009` and synthetic ACT-001 tests, excluding private Step 0 evidence. Manifest source commit matches the scored revision. No snapshot was published |
| Manual audit, 471 files | pass with disposition (see below) |

The initial manual 471-file scan covered the would-be source set and exporter exclusions. The first automated export exposed an absolute macOS user path in a post-tag telemetry test fixture. Commit `932af8a` replaced it with a portable synthetic path; the focused 22-test file passed. The unchanged forbidden-content audit then passed on the 391-file export. No ACT-001 new or modified file introduced key, token, credential, or machine-path material.

Verification environment notes: a sandboxed focused run could not bind its local `127.0.0.1` fixture listener (`EPERM`); rerunning with loopback permitted passed all 127 focused tests and the full suite. An initial isolated pack using a symlink to the development `node_modules` failed `npm ls`; a fresh offline `npm ci` in that checkout closed the setup issue and the tarball passed. The deploy dry run exited 0 and reached Wrangler's `--dry-run: exiting now`; Wrangler also printed an `EPERM` warning because sandbox policy blocked writing its optional log under the user's home directory. No remote deploy was attempted.

| Check | Result |
| --- | --- |
| **D1** | PASS. v1.25.0 CLI JSON, MCP schemas, HTTP methods, Viewer allowlist, orientation/attention selection, session instructions, playbook gate, CAP-001 recipe content, and outbound event vocabulary unchanged except by explicit additive change. Eight service methods, six MCP tools, the `actions` CLI family, catalog additions, and the dedicated ingress are covered by `tests/unit/act-001-baseline.test.ts` and `tests/unit/act-001-interfaces.test.ts` |
| **D2** | PASS. Full §4 matrix in `tests/unit/act-001-service.test.ts` and `tests/worker/act-001-d1.test.ts`: agent owner, viewer, expired session, wrong workspace, forged author, approver/executor membership removal, closed workspace. No cross-workspace leakage. Human-only review fails through every agent path including direct `/v1/call` |
| **D3** | PASS. Digests match the frozen Step 0 vectors (`verify.mjs` V1/V2/tamper). Mutated intent, evidence, version, executor, or expiry cannot reuse approval. All transitions and forbidden reversals tested; no Decision, task assignment, signed event, or outbound DomainEvent grants dispatch authority |
| **D4** | PASS. Concurrent approval/cancel/reservation and duplicate mutation tests in SQLite and D1 establish one dispatch slot and exact replay, including two separately approved proposals for the same provider target/attempt. Crash-before-submission, lost-response (`submission_unknown`), event-before-receipt, conflicting external attempt, and reconciliation preserve ambiguity or evidence. No automatic second POST, timeout requeue, or exactly-once external claim |
| **D5** | PASS. Raw-byte HMAC, tampering, missing signature, forged/reused delivery ids, semantic duplicate under new delivery/source id, source rebinding, wrong repo/workflow/SHA/attempt, unknown source, rotated secret, timestamp bounds, invalid/oversized/chunked body, unavailable integration session, and unrelated events — covered in `tests/unit/act-001-ingress.test.ts`, `tests/worker/act-001-ingress.test.ts`, and `tests/integration/act-001-http.test.ts`. Concurrent valid deliveries create exactly one evidence pair; rollback/retry leaves no orphan |
| **D6** | PASS. Second actor identifies proposal, human reviewer, executor, submission receipt, and signed observation from record ids alone. Actor/session/principal, uncertainty, and provider conclusion preserved. Long action/receipt histories page with cursor misuse failing. No raw payload, log, token, CLI output, public asset, or Viewer read leaks. Failure/cancelled runs never appear as success |
| **D7** | PASS (fixture). `tests/unit/act-001-continuation.test.ts` over `fixtures/act-001/seed.ts` completes propose → human review → external-stub submission → signed completion → second-client inspection without a transcript, including reject, no-dispatch, unknown-submission, and failed-verification branches. The stub's only simulated authority is labeled; fixtures are not live GitHub or human demand |
| **D8** | PASS. Fresh and upgraded local and D1 stores preserve v1.25.0 content and run identical action, event, and race answer keys (`tests/unit/migrations.test.ts` plus ACT-001 D1 suites). No provider request runs in a DB transaction. Disabled integration accepts no event writes; enabling grants no other source/action/workspace. No new background process or outbound event |
| **D9** | PASS on `932af8a`. Focused tests (127 passed), full suite (118 files, 1482 passed / 1 skipped), typecheck, build, source/public asset parity, isolated `pack:tarball`, audited 391-file public export, and `deploy:dry-run` pass. Export includes source, migration, and synthetic tests and excludes private evidence/config/secrets by allowlist. No live migration or deploy occurred |

## 3. Deviations

- Migration `0009_action_proposals.sql` implements Step 0's reserved number (closing the reservation contest in mismatch 2); it is in `862da8d`.
- Step 0 Amendment: none filed. Mismatches 1 and 2 were resolved by implementation, not by a pre-code amendment. Partial product code already existed as uncommitted files when Step 0 was captured, so the contract's pre-code freeze sequence was not achieved retroactively by committing the evidence first. The released v1.25.0 tag/source pin, fixture vectors, and answer key remained unchanged. This is a process deviation, not evidence of a failed D1–D9 behavior check.
- The `recorded_at DESC, rowid DESC` receipt tiebreak and the in-transaction rechecks (review path, ingress authority path) go beyond the contract's letter to close TOCTOU and pagination-determinism gaps found during implementation and review. No contract acceptance rule changed.

## 4. Independent review

Review inspected human-approval bypasses, provider effect drift, actor/session attribution, replay, atomicity, and the requested-versus-observed distinction on the implementation tree.

- **FINDING-1 (fixed, regression test):** receipt history pagination was non-deterministic when two receipts shared a timestamp — no tiebreak, so a later row could drop or repeat across pages. Fixed with `ORDER BY recorded_at DESC, rowid DESC` in both the SQLite (`src/store/sqlite-store.ts`) and D1 (`src/worker/d1-store.ts`) receipt reads; covered by the receipt cursor-pagination tests in the service and D1 suites.
- **FINDING-2 (fixed):** the review path and the ingress follow-up path rechecked authority outside the commit transaction, leaving a check-then-act window (membership/session/workspace revocation between recheck and write). Fixed with in-transaction rechecks (`action-proposal-actions.ts` review/reserve commit paths; `recheckIntegrationAuthorityInTxn` / async mirror in `github-ingress.ts`); verified by the revocation race tests. No defect was waived; no finding remains open.

## 5. Gaps carried (NOT OBSERVED / NOT AUTHORIZED / sequencing)

- Live Codex path: **NOT OBSERVED**. Live OpenCode path: **NOT OBSERVED**. Same frozen continuation prompt, isolated workspaces, no fixture ids — unrun.
- Real-provider path: **NOT AUTHORIZED**. One verification retry plus matching native webhook against a dedicated test target requires explicit operator authorization for that action, which was not given. The synthetic stub stands in for the client procedure only.
- Step 0 timing: the evidence was captured while partial product code already existed uncommitted. The candidate commits do not make that an earlier freeze (§3).

## 6. Release boundary, deliverables, and stop

No release decision. No version bump (package `1.25.0`), no tag, no push, no production migration or deploy. The `/tmp` tarball is a local check, not a published artifact.

Contract §11 deliverables: Step 0 bundle (`3080907`) plus recorded implementation source (`932af8a`); one proposal/receipt aggregate and migration `0009`; eight service methods / six MCP tools and the CLI family; catalog mappings; one configured native signed source and atomic cited Finding follow-up; isolated fixtures and client procedure; D1–D9 evidence above; named gaps; this result record.

Stop after this pilot. Broader action classes, deployment/merge/release operations, arbitrary shell/code execution, agent approval, automatic reruns, provider polling, generic plugins, task automation, organization-wide discovery, Viewer writes, and a capability/grant engine require another scoped decision. Implementation does not authorize production operation or publication.
