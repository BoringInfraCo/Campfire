# ACT-001 Step 0 — v1.25.0 baseline, pilot allowlist, fixture answer key, proposed contract

**Date:** 2026-10-21
**Status:** Freeze before product code. This is not a result record and it is not a verdict.
**Label: FIXTURE EVIDENCE — engineering evidence only.** No live harness or provider observation was made.

Contract: `docs/Campfire-v1.26-ACT-001-Propose-and-Follow-Up.md` §1 (items 1–6).
Exemplar pattern: `docs/evidence/cap-001/step-0/`. Package version stays `1.25.0`; no
version bump, tag, publication, deployment, or `src/` change is part of this step.

## 1. Released baseline (contract §1 item 1)

| Fact | Value |
| --- | --- |
| HEAD at capture | `1fb4d790c0cd1fc9d2d1729a14cf7b32049055ec` |
| Annotated tag object | `v1.25.0` → `de4d447d243356d0c7ebdb8258803e8d167f7689` |
| Tag resolves to (source pin) | `4e6b7e714960f90cf5d78ee43a8f7e95bf8fe12f` |
| Package on tag source | `1.25.0` |
| What was captured | An isolated worktree of the tag commit, so post-tag commits do not leak into the pin |

`CAMPFIRE_TELEMETRY=0` on every capture invocation. No token, secret, home path,
or machine credential appears in the frozen files; the MCP capture used a synthetic
in-memory identity (`hum_probe`). Digests are exact file bytes.

### Reproduce

```sh
cd <repo>
git cat-file -p de4d447d243356d0c7ebdb8258803e8d167f7689  # tag -> 4e6b7e714960f90cf5d78ee43a8f7e95bf8fe12f
git worktree add --detach /tmp/act001-tag v1.25.0
ln -s <repo>/node_modules /tmp/act001-tag/node_modules
cd /tmp/act001-tag
CAMPFIRE_TELEMETRY=0 ./node_modules/.bin/tsx src/cli/index.ts capabilities --output json
CAMPFIRE_TELEMETRY=0 CAMPFIRE_PLAYBOOK=1 ./node_modules/.bin/tsx src/cli/index.ts capabilities --output json
# MCP tools/list via Client + InMemoryTransport + createCampfireMcpServer (see cap-001 STEP0 §reproduce)
node <repo>/fixtures/act-001/verify.mjs
```

### Frozen baseline facts

- Installed CLI manifest: 59 commands playbook-off, 60 playbook-on (`playbook` inserted at index 20). `baseline/cli-manifest-*.json`, `baseline/cli-command-names-*.txt`.
- MCP inventory + schemas: 40 tools playbook-off, 41 playbook-on; `get_playbook` is the only gated addition. `baseline/mcp-tools-*.json`, `baseline/mcp-tool-names-*.txt`.
- HTTP method list: 47 methods in `src/http/dispatch.ts` @ tag. `baseline/http-methods.json`.
- Viewer allowlist: 12 reads (`VIEWER_READ_METHODS` @ tag). `baseline/viewer-allowlist.json`.
- Orientation projection: 26 top-level keys from a live seeded `getWorkspaceContext` @ tag. `baseline/orientation-projection.json`.
- Contribution/event vocabulary: 8 outbound events, 5 contribution actions, 10 object types. `baseline/event-vocabulary.json`.
- Schema snapshots: `baseline/local-schema-base.sql`, `baseline/local-schema-deltas.sql`, `baseline/d1-schema-composition.ts.txt`. Latest D1 migration **at tag**: `0007_contribution_object_position.sql`.
- Migration reservation: the contract (§7) names `0008_telemetry_integrity.sql` as current, which is true at HEAD but post-tag; ACT-001 therefore reserves **0009**. See open mismatches.

## 2. Pilot allowlist (contract §1 item 2)

`pilot-allowlist.json`. EXACT synthetic values: repo id `123456789`, `example-org/verification-sandbox`, workflow id `9876543` (`.github/workflows/verify.yml`), originating event `workflow_run`, run `11223344` (failed attempt 1 → `expectedAttempt` 2), SHA `deadbeef…` (64 hex). Verification-only workflow: inspected jobs `verify-unit` (`npm run typecheck && npm test`) and `verify-build` (`npm run build`); no deploy, publication, release, downstream privileged workflow, or production mutation at the inspected revision. Filename alone was not accepted as evidence — jobs are recorded. Dedicated test repository for any external mutation: the allowlisted synthetic repo itself. Real-provider run: **NOT AUTHORIZED**.

## 3. Synthetic workspace fixture (contract §1 item 3)

`workspace-fixture.json`. Goal `goal_act001_verify`; task `task_act001_verify` (`in_progress`); current findings `find_act001_baseline`, `find_act001_logs`; superseded `find_act001_stale` → successor `find_act001_baseline`; cited artifact `art_act001_runref`. Owner `hum_act001_ada`, member `hum_act001_ben`, viewer `hum_act001_val`, proposing agent `agt_act001_codex_ada` (codex), executing agent `agt_act001_opencode_ben` (opencode, other harness), expired agent session `ses_act001_expired_01`, unregistered agent `agt_act001_ghost`, non-participant `hum_act001_zed`, second workspace `ws_act001_other`, conflicting attempt-3 and delayed event-before-receipt provider attempts. Frozen contribution counts: `ws_act001_lab` 14, `ws_act001_other` 1.

## 4. Proposal, digest, authority, transitions, bounds, interfaces, payloads (contract §1 item 4)

`proposal/`. Canonical envelope `ACT001-INTENT-V1` (fixed-order `key=value` lines, UTF-8, SHA-256 hex). Vectors: V1 `1b940e4d…ac5cba` (524 B), V2 `37bd64f0…07d6c` (571 B), V3 tamper `6fec0002…f009` ≠ V1 — all under 4 KiB. Source authority fingerprint `276838dc…89b7898` (secret material excluded, stable across rotation). Semantic dedup key `act001:github:123456789:9876543:11223344:2:failure`. Authority matrix (§4 incl. agent-owner-never-approves), transitions + terminal rules, bounds (intent ≤4KiB, reason ≤500ch, receipt ≤2KiB, projection ≤16KiB, pages 20/100 ≤64KiB), `requestKey` `^[\x20-\x7E]{1,128}$`, pagination/error shapes, 8 signed-payload fixtures (workflow_run completed + ping + tampered/401 + replay/409 + duplicate + wrong repo/attempt + stale/400; test-only secret labeled), interface inventory (8 service / 6 MCP / `actions` CLI / `POST /v1/integrations/github/:sourceId`), frozen concurrent approval/reservation and event-before-receipt cases.

## 5. Baseline continuation task (contract §1 item 5)

`continuation-task.md`. Frozen second-harness prompt (no transcript): who authorized the rerun, exact commit/run/attempt, submitted vs observed, residual unknowns, all from record ids. v1.25 CAN read existing records and truthfully report the approval/receipt/observation gap; CANNOT name proposals or verify the run. Fabrication rule: invented proposal/receipt ids or a verified-success claim from the fixture is a HARNESS FAILURE, not a product gap.

## 6. Test-host ingress arrangement (contract §1 item 6)

`ingress-arrangement.md`. Isolated fixtures must not rewrite harness profiles, start the normal `campfire up` profile, use production credentials, or mutate a public repository. Real-provider test needs the dedicated target + explicit operator auth. Status: **NOT AUTHORIZED**.

## 7. Verification

```sh
npm run typecheck   # see open mismatch 4: working tree currently FAILS on out-of-scope files; tag source passes
node fixtures/act-001/verify.mjs   # 19/19 frozen-value checks
```

## 8. Open mismatches (must resolve before code; amendments, never rescoring)

1. The working tree holds uncommitted ACT-001 product files outside Step 0 scope (modified `src/domain/ids.ts`, `src/domain/types.ts`, `src/service/authorization.ts`, `src/service/simple-authorizer.ts`, `src/store/migrations.ts`, `src/worker/async-authorizer.ts`, `src/worker/schema.ts`; untracked `src/domain/action-proposal.ts`, `src/store/action-proposal-schema.ts`, `migrations/0009_action_proposals.sql`). Step 0 neither authorizes nor reviews them; the baseline pin is unaffected (tag worktree). Before Step 1, reconcile or revert them and confirm migration-number reservation.
2. Contract §7 names `0008_telemetry_integrity.sql` as latest; at the v1.25.0 tag the latest is `0007`. Step 0 reserves **0009** counting the post-tag `0008` — but an untracked `0009_action_proposals.sql` already exists in the working tree and is NOT part of Step 0. The reservation is contested until mismatch 1 is resolved.
3. Real-provider path and both live harness paths are NOT AUTHORIZED / NOT OBSERVED (§10 D7, D9 gaps carried into implementation).
4. `npm run typecheck` on the working tree FAILS at capture time on the out-of-scope files from mismatch 1 (`WebhookDeliveryRow` not found in `src/store/sqlite-store.ts`; `AsyncCampfireStore` missing `createActionProposal` et al. in `src/worker/d1-store.ts`). This step made no `src/` change (`git status -- src/` shows only the foreign files). The isolated `v1.25.0` tag worktree typechecks clean (`tsc --noEmit` exit 0). Resolve with mismatch 1; do not paper over it.
