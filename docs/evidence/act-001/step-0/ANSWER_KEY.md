# ACT-001 fixture answer key

**Date:** 2026-10-21
**Label: FIXTURE EVIDENCE — engineering evidence only.** Not a human answer and not a sprint verdict. Machine detail is `answer-key.json`. Recompute with `node fixtures/act-001/verify.mjs`.

## Baseline (v1.25.0, tag source)

Package `1.25.0`; tag object `de4d447d…` → commit `4e6b7e7149…`. CLI manifest 59 commands (60 with opt-in `playbook`); MCP 40 tools (41 with opt-in `get_playbook`); HTTP dispatch 47 methods; Viewer allowlist 12 reads; orientation projection 26 top-level keys; outbound event vocabulary 8. Latest D1 migration at tag: `0007_contribution_object_position.sql`.

## Pilot allowlist (all synthetic)

Repo id `123456789`, `example-org/verification-sandbox`, workflow id `9876543` (`.github/workflows/verify.yml`), originating event `workflow_run`. Frozen target: run `11223344`, failed attempt 1, `expectedAttempt` 2, SHA `deadbeef…` (64 hex). Inspected jobs `verify-unit` + `verify-build`, verification-only, no deploy/publish/release step. Real-provider run: NOT AUTHORIZED.

## Workspace fixture

`ws_act001_lab` (14 contributions) + `ws_act001_other` (1). Goal `goal_act001_verify`; task `task_act001_verify` (`in_progress`, updated `2026-10-21T12:00:40.000Z`); current findings `find_act001_baseline`, `find_act001_logs`; superseded `find_act001_stale` → successor `find_act001_baseline`; cited artifact `art_act001_runref`. Owner `hum_act001_ada`, member `hum_act001_ben`, viewer `hum_act001_val`, non-participant `hum_act001_zed`. Proposing agent `agt_act001_codex_ada` (codex), executing agent `agt_act001_opencode_ben` (opencode), expired session `ses_act001_expired_01`, unregistered `agt_act001_ghost`, integration agent `agt_act001_integration` / `ses_act001_integration_01`.

## Proposal and event digests

- Intent V1 (minimal): `1b940e4d…ac5cba`; V2 (multi-reference): `37bd64f0…07d6c`; V3 tamper: `6fec0002…f009` (differs from V1).
- Source authority fingerprint (`src_act001_github`): `276838dc…89b7898`.
- Semantic dedup example: `act001:github:123456789:9876543:11223344:2:failure`.
- `requestKey` rule: `^[\x20-\x7E]{1,128}$`. Bounds: intent ≤4KiB, reason ≤500ch, receipt ≤2KiB, projection ≤16KiB, pages default 20/max 100 ≤64KiB.
- Interfaces: 8 service methods, 6 MCP tools, `campfire actions` CLI family, `POST /v1/integrations/github/:sourceId`.

## Continuation and ingress

v1.25 CAN read existing records and report the approval/receipt/observation gap; CANNOT name proposals or verify the run. Any invented proposal id is a harness failure, not a product gap. Real-provider test: NOT AUTHORIZED (needs dedicated target + explicit operator auth).

## What a continuation must say / must not say

Must say: proposal id, human reviewer, executor, receipt outcome, signed-observation ids with actor/session/principal provenance; submission ≠ test success; only provider `success` is verification success; residual unknowns (revocation, attempt-3 conflict, crash gaps).
Must not say: that a submission proves tests passed; that a signed completion grants merge/deploy/decision authority; that the v1.25 fixture contains any proposal or receipt; any fact from `ws_act001_other`.
