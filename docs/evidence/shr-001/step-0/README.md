# SHR-001 Step 0 — index

**Date:** October 23, 2026  
**Status:** Frozen engineering contract; no release claim  
**Released baseline:** v1.26.1, per `docs/RELEASE_V1_26_1_DECISION.md`

| File | Purpose |
| --- | --- |
| `STEP0.md` | Baseline pins, installed local capture, reproduction, frozen decisions, open risks |
| `INTERFACE-CONTRACT.md` | CLI/HTTP/schema/limit/receipt contract |
| `SNAPSHOT-MANIFEST.md` | Table-by-table allowlist, exclusions, relationships, boundary checks |
| `ANSWER-KEY.md` | Installed Arbora identity, counts, tip, digest, acceptance checks |
| `THREAT-MODEL.md` | Assets, threats, controls, operator responsibility, known alpha gaps |
| `SHA256SUMS` | Checksums for this bundle |

## Installed capture

The local Arbora profile was inspected read-only in this session. It contains
workspace `ws_df6794f33efc459b`, owner `hum_156ff89c089f4d13`, Codex agent
`agt_955034ffb2544082`, finding `find_5cd543722a044c20`, two sessions, one goal,
no tasks, no artifacts, and eight contributions at tip 8. The snapshot digest is
`4bb1b5fac9e284dd55fa8d185860aa771719993b420853424690ed9ecf7a477d` for
the v1.26.1 capture. The v1.26.2 candidate digest is
`4c8496e92290db32d1efe21411686e87bb6c0e26e4706dfaf9bf0091e5bba757`.

The historical consumed invite `inv_b4ad888cdf0a4b01` is provenance only. The
profile's OpenCode agent is not a workspace participant and is not invented as
one. No credential file or token was read.

## Reproduction and acceptance

The read-only reproduction is in `STEP0.md` §3. The separate engineering
acceptance is `tests/acceptance/shr-001-publish-share.test.ts`: local workspace →
publish → invite → iMac join → iMac reads the finding and creates a task → fresh
MacBook reads it with the source service offline.

This bundle freezes engineering behavior. It does not claim a hosted Arbora
copy, two-Mac pass, v1.26.2 package, deployment, or release.
