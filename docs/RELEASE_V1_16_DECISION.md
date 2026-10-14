# v1.16 release decision — Recall and portable handoff

**Date:** October 13, 2026

**Status:** Local release candidate; no public promotion is recorded here.
**Package target:** `1.16.0`

## Founder direction and scope

The repository owner directed the team to press toward a public v1.16 release
so existing users can test Recall and portable handoffs during real work. This
is a **release-scope override of the RCL-001 publication hold**, not a change to
any pilot score or a claim that a failed gate passed. Public promotion and
production deployment are distinct steps and will be recorded here only when
they occur.

The bounded release surface is the implemented one-workspace authorized read:
`campfire recall`, MCP `recall_workspace`, the explicit
`campfire handoff-packet` file writer, and HTTP `recall_workspace` /
`project_handoff_packet`. The packet is local, private, addressed to one named
authorized recipient, and carries no credential or artifact path. The Viewer,
schema, contribution writes, and telemetry allow-list are unchanged. No
cross-workspace search, embeddings, packet import, or automatic answer is added.

## Evidence that remains adverse or absent

| Evidence | Release record |
| --- | --- |
| RCL-001 | **NO-GO:** no next-action improvement in three matched scenarios; no offline recipient passed its original packet rubric. |
| RCL-002 | **NO-GO / REFRAME:** controls again reached the keyed action; the S2 treatment and offline recipient missed a required decision transition. |
| RCL-003 | **NO-GO / REFRAME:** zero qualified treatment wins; two of three offline recipients passed. S2 promoted a superseded rationale into a current precondition. The citation difference was confounded by treatment-only instructions. |
| Post-verdict repair | The packet projection now preserves `historical`/`current`, omits a superseded member's live rationale, and carries linked-next-step guidance. Deterministic checks and one unscored recipient recheck support this repair. They do not replace the scored result or establish an error rate. |
| Gate E | **Unmeasured:** zero ordinary-work observations. Existing users and publication do not themselves satisfy it. |
| Gate B / Gate C | **Unmeasured.** No repeat-use or multi-participant value claim follows from this release. |

The contract's §8 GO and CONDITIONAL GO criteria are **not met**. Its §6
verification and authorization checks still apply. The founder's direction
waives the publication hold for the bounded candidate only. The external
release should say *experimental Recall and portable handoff*, and should not
claim improved next-action choices, safe autonomous execution from a packet,
or proven historical-reuse value.

## User testing after publication

User testing is the reason for this override and a source of future product
evidence. It cannot retroactively repair the three frozen pilots. A real
handoff can be observed under `docs/GATE_E_PROTOCOL.md` if its plan-time,
participant, consent, and retained-evidence requirements are met. Unstructured
feedback may guide fixes, but it is not a Gate E observation by itself.

Users should inspect decision lifecycle and recorded replacements before
acting on a recalled rule. A query-matched `decisionSet` is scoped to its query;
it does not declare an operative decision for the whole workspace. An
unresolved set requires an explicit recorded transition before either rule is
executed. A handoff packet is a bounded view of authorized state, not authority
to act or proof that it contains every relevant record.

## Promotion record

Fill this section as each external step completes; absence means it has not
occurred.

| Step | Evidence |
| --- | --- |
| Private source and annotated tag | Pending. |
| Typecheck, full tests, build, package, deployment dry run | Node 24: typecheck passed; build and Darwin ARM64 packaging passed; Worker dry run passed. A local install from the archive verified its SHA-256 and reported `1.16.0`. Full suite: 1,053 passed, one expected install-channel assertion failed because Homebrew and Nix still pin published v1.15 archives. Do not loosen it; rerun after v1.16 archives exist and the pins are updated. Local archive SHA-256: `f95c0bd74bbc6a35919c19d025fac3d6aaea0172b24bf7f1be6c95b462cc6163`. |
| Audited public source snapshot and diff | The first export refused `tests/unit/gate-e-packet-evidence.test.ts` because its private adversarial fixture contains a macOS user path. The exact private test was excluded; no audit check was bypassed. The next export passed: 281 manifest files, compared against the fetched public v1.15 branch as 9 added, 25 changed, 0 removed. Private Gate E files, frozen pilot fixtures, and `AGENTS.md` were absent. The exact final tag must be exported and audited again before public promotion. |
| Public GitHub Release and four checked archives | Pending. |
| Homebrew / Nix pins and installer verification | Pending. |
| Production Worker deployment and live verification | Pending. |

The release decision is about **shipping a bounded experimental surface with
its limits visible**. It is not a GO verdict, Gate E result, or permission to
rewrite frozen evidence.
