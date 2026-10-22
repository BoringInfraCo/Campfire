# ACT-001 Step 0 evidence

**Date:** 2026-10-21
**Status:** Freeze before product code. This is not a result record and not a verdict.
**Label: FIXTURE EVIDENCE — engineering evidence only.** No live harness or provider observation was made.

The dated record is `STEP0.md`. It freezes the v1.25.0 baseline, the pilot allowlist, the synthetic workspace, the proposal/event contract with digest vectors, the continuation task, and the ingress arrangement.

## Files

| Path | What it is |
| --- | --- |
| `STEP0.md` | Release pin, reproduction, digests, open mismatches. |
| `baseline/` | Tag-source CLI manifests, command names, MCP tools + names, HTTP methods, Viewer allowlist, orientation projection shape, event vocabulary, schema snapshots, pins. |
| `pilot-allowlist.json` | Exact synthetic repo/workflow/run allowlist + inspected jobs. |
| `workspace-fixture.json` | Synthetic workspace, actors, second workspace, provider attempts, frozen contribution counts. |
| `proposal/` | Canonical proposal, digest vectors, authority matrix, transitions, bounds, interface inventory, signed payloads, frozen race/ordering cases. |
| `continuation-task.md` | Frozen second-harness prompt + v1.25 CAN/CANNOT rubric. |
| `ingress-arrangement.md` | Test-host isolation rules + real-provider gate (NOT AUTHORIZED). |
| `HARNESS_BASELINE.md` | Codex/OpenCode paths, both NOT OBSERVED. |
| `answer-key.json`, `ANSWER_KEY.md` | Frozen ids, counts, digests, and handoff limits. |
| `SHA256SUMS` | sha256 of every frozen file in this step. |

Verifier: `node fixtures/act-001/verify.mjs` (recomputes digests/HMACs, cross-checks the answer key).
