# v1.26.1 release decision — ACT-001 Propose and Follow Up (patch repair)

**Date:** October 21, 2026

**Status:** Founder-directed public release; prep checks recorded below. Publication, channel pins, and production deployment are separate promotion steps and are recorded in the promotion table as they complete.
**Package target:** `1.26.1`
**Contract:** `docs/Campfire-v1.26-ACT-001-Propose-and-Follow-Up.md` (§9 D1–D9, §10, §11)
**Sprint result:** `docs/SPRINT_ACT_001_RESULT.md` — **CONDITIONAL GO — engineering candidate**
**Candidate commits:** `3080907` (Step 0), `862da8d` (implementation), `932af8a` (scored candidate), `ff1a54d` (result record), `79f2038` (v1.26.0 release prep), plus the v1.26.1 export repair.

## Why v1.26.1 exists

The founder directed the v1.26.0 release on October 21, 2026, recorded in
`docs/RELEASE_V1_26_DECISION.md`. The v1.26.0 private tag (`f282f0a` → `79f2038`)
and public snapshot (`21869b6`) were promoted, and the GitHub Release was
published. The public build then failed on every job:

- Public CI `39718638147` and `39718640348` failed at `npm ci` with
  `tests/unit/backfill-telemetry-claims.test.ts(23,8): error TS2307: Cannot find
  module '../../scripts/backfill-telemetry-claims.mjs'`.
- Release workflow `39718658102` failed all four platform jobs for the same
  reason; no archives were attached.

The export allowlist omitted `scripts/backfill-telemetry-claims.mjs` (and its
`.d.mts`), which is referenced by an exported test and by the exported
`docs/OPERATOR.md`. The missing file existed in the private repository, so the
private suite passed; only a clean build of the exported snapshot exposes it.

v1.26.0 is frozen as a failed candidate. Its tag and snapshot are provenance and
are not retargeted or force-pushed. This document is the release decision for
the repaired source. It is **not** a GO verdict:

- ACT-001 remains **CONDITIONAL GO — engineering candidate**.
- Live Codex and OpenCode paths remain **NOT OBSERVED**.
- The real-provider verification round trip remains **NOT AUTHORIZED**.
- Step 0's sequencing deviation remains recorded.
- No gate is moved; no earlier sprint or gate result is rescored.

## The exact repair

The published v1.26.0 surface is unchanged except for the export repair and the
version bump:

- `scripts/export-public-release.mjs` adds
  `scripts/backfill-telemetry-claims.mjs` and
  `scripts/backfill-telemetry-claims.d.mts` to the exact export allowlist.
- The release-prep battery now includes a **clean export build**: export from
  the release commit, run `npm ci` in the exported directory, and run the
  exported ACT-001 tests there. This is the check that v1.26.0 lacked.
- No product behavior, schema, migration, CLI, MCP, HTTP, Viewer, or event
  change is introduced by this patch.

## Evidence status in this release

| Evidence | Status in this release |
| --- | --- |
| D1 — baseline preservation | PASS. Same v1.26.0 product surface; the repair is export-only. |
| D2 — authority and isolation | PASS. Unchanged from the v1.26.0 candidate and its tests. |
| D3 — immutable approval and lifecycle | PASS. Unchanged. |
| D4 — reservation, receipts, uncertain effects | PASS. Unchanged. |
| D5 — signed ingress and replay | PASS. Unchanged. |
| D6 — provenance and bounded retrieval | PASS. Unchanged. |
| D7 — continuation fixture | PASS (fixture). Unchanged. |
| D8 — migration and service parity | PASS. Unchanged. |
| D9 — distribution and regression | PASS at the repaired release commit. The battery includes typecheck, full suite, build, deploy dry run, isolated packaging, the audited export, and a clean `npm ci` + build + exported ACT-001 test run in the export. |
| Live Codex / OpenCode paths | **NOT OBSERVED.** |
| Real-provider round trip | **NOT AUTHORIZED.** |
| v1.26.0 candidate | **FAILED / FROZEN.** No archives, no channel pin, no deployment; superseded by v1.26.1. |

## Public release notes (v1.26.1)

Used verbatim for the GitHub Release body:

```markdown
Campfire v1.26.1 — Propose and Follow Up (packaging repair)

v1.26.1 republishes the v1.26.0 ACT-001 candidate after repairing the public
export allowlist. The v1.26.0 snapshot could not build: an exported telemetry
test imported `scripts/backfill-telemetry-claims.mjs`, which the exporter
omitted. The v1.26.0 tag and snapshot remain as provenance; no v1.26.0 archive
was produced and no install channel pinned it.

- Record one human-approved verification retry in a workspace and let another
  authorized teammate or harness continue from attributed submission receipts
  and signed completion evidence, without sharing a private transcript. A human
  workspace owner approves the exact repository, workflow, run, commit SHA,
  expected attempt, executor, expiry, and cited evidence through the CLI.
- An approved proposal has exactly one dispatch reservation for its provider
  target and attempt. The external client submits the retry once with its own
  GitHub credential and records accepted, definite failure before submission, or
  unknown. Campfire stores no GitHub credential and never calls GitHub. A
  submission receipt is not proof the tests passed; a lost response stays
  unknown and is never retried automatically.
- The operator-configured `POST /v1/integrations/github/:sourceId` ingress
  verifies the raw-body HMAC, correlates a signed `workflow_run` completion to
  one reserved proposal, and creates one cited Finding plus one Artifact
  reference atomically. Redelivery returns the existing receipt. Failure,
  cancellation, skipped, and unknown outcomes stay explicit; only provider
  `success` is reported as verification success.
- Review and cancellation remain human CLI actions; there is no MCP approval
  tool and no Campfire execute endpoint. No new Viewer tab and no new outbound
  event are added.
- The bounded result is **CONDITIONAL GO — engineering candidate**. D1–D9 pass
  at the repaired release commit, including a clean export build and the
  exported ACT-001 tests. Live Codex and OpenCode sessions are **NOT OBSERVED**,
  the real-provider round trip is **NOT AUTHORIZED**, and Step 0 was captured
  with partial product code already uncommitted. This release does not claim
  provider interoperability, live cross-harness continuation, human demand, or
  usefulness.

Darwin and Linux archives for ARM64 and x64, with SHA-256 checksum files, are
produced by the release workflow. The versioned installer at
`campfire/v1.26.1/install.sh` pins this release.
```

## What users should know

- Do not install v1.26.0; it has no archives. Use v1.26.1.
- A proposal records intent, not permission to merge, release, deploy, complete
  a task, or accept a decision. A submission receipt records that a request was
  accepted, not that verification passed.
- Nothing is dispatched until an approved proposal is reserved by its designated
  executor, and the executor still needs its own GitHub authorization.
- The ingress is disabled unless a complete operator source binding is
  configured. Campfire never stores or prints the webhook secret or a GitHub
  credential.

## Promotion record

| Step | Evidence |
| --- | --- |
| v1.26.0 failure and freeze | Public CI `39718638147`/`39718640348` and release workflow `39718658102` failed at `npm ci`; no archives attached; `docs/RELEASE_V1_26_DECISION.md` carries the abandonment notice. |
| Founder repair direction | The founder's release instruction remains the v1.26 decision; this document records the packaging repair and keeps the same bounded claim. |
| Release-prep verification battery | PASS at `9a359ca`: `npm run typecheck`; full `npm test` 119 files / 1,492 tests with 1,490 passed, 1 pre-recorded pre-pin install-channel failure, 1 opt-in skip; `npm run build`; `npm run deploy:dry-run` (75 assets, stopped at `--dry-run: exiting now`); `npm run pack:tarball` (package `1.26.1`, Darwin ARM64); audited public export wrote **404 files** including `scripts/backfill-telemetry-claims.mjs`; clean `npm ci` in the export passed and the exported ACT-001 tests passed **105/105**. The pre-pin install-channel assertion is expected and was not loosened. |
| Private annotated `v1.26.1` tag | **PENDING.** |
| Audited public source snapshot and tag | **PENDING.** |
| Public GitHub Release and four checked archives | **PENDING.** |
| Homebrew / Nix pins, tap promotion, installer checks | **PENDING.** |
| Production Worker deployment and live verification | **PENDING.** |
