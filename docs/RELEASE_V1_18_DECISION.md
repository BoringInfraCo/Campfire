# v1.18 release decision — Continue the Work guidance update

**Date:** October 15, 2026

**Status:** Published and deployed as v1.18.0 (October 15, 2026).
**Package target:** `1.18.0`

## Founder direction and scope

On October 15, 2026, the repository owner directed a full public v1.18.0
release:

> "i want the full v1.18 release im pushing it through as the founder!"

The owner also forwarded and endorsed the bounded public-claim framing from an
independent review: the release may state that v1.18 improves MCP guidance for
teammate tasks and makes finding-evidence relation options explicit — **not**
that human team continuation has been validated.

This is the **separate, recorded founder override** that contract §8 requires
for publication with an open human criterion. It is a release-scope override of
the WCO-001 evidence hold. It is **not** a GO verdict:

- The contract's GO rule requires one complete ordinary-work two-human case
  meeting C1–C6. That case is **NOT OBSERVED**.
- The witness for the Amendment 1 repair was a labeled single-operator rehearsal
  (`docs/evidence/wco-001/REHEARSAL.md`), which produces zero C1–C7
  observations.
- WCO-001 remains **CONDITIONAL GO — engineering candidate**
  (`docs/SPRINT_WCO_001_RESULT.md`). The override does not turn any absent
  observation into a pass.

The bounded release surface is the Amendment 1 guidance/schema repair:

- MCP session guidance and the `get_workspace_context` description state that
  `needsAttention` is attention ordering, not an access boundary, and that a
  writing participant may take up a blocked or open task assigned to another
  participant with `update_task`, recorded with their own provenance.
- `cite_finding_evidence.relation` and `correct_finding.evidence[].relation`
  enumerate the closed `supports|contradicts` vocabulary, backed by one shared
  domain constant and the unchanged service validator.

No orientation selection rule, attention reason label, CLI, Viewer, HTTP,
Worker, or schema change is included. No migration.

## Evidence that remains adverse or absent

| Evidence | Release record |
| --- | --- |
| WCO-001 C1–C7 ordinary two-human case | **NOT OBSERVED.** No eligible two-human/two-harness pair was available; the amendment witness is a rehearsal. |
| WCO-001 rehearsal | **Recorded as rehearsal only** (`docs/evidence/wco-001/REHEARSAL.md`); zero sprint observations. |
| Gate B / Gate C / Gate E | **Unmeasured.** Publication does not satisfy any gate. |
| VIS-001 condition 4 (reference-open) | **Open.** The rehearsal's reference-open attempt is not eligible evidence. |
| SWH-001 controlled traces and shipped-v1.16 Viewer trace | **Not run** (unchanged by this release). |
| D1–D6 deterministic checks | **Pass** at pin `e3fda9e` (14 tests); full private suite 1,078 tests across 87 files passed post-pin (October 15). |

## The exact public claim

Campfire v1.18 makes the MCP boundary for continuing a teammate's work more
honest and more explicit: `needsAttention` is documented as attention ordering
rather than an access boundary, a writing participant is told they may take up
a blocked or open task assigned to another participant (recorded with their own
provenance), and finding-evidence citations now enumerate the accepted
`supports` or `contradicts` relation in their tool schemas. It is
**experimental**: no human team-continuation evidence has been recorded for this
sprint, and WCO-001 remains CONDITIONAL GO. No Gate B, Gate C, or Gate E claim
follows.

## What users should know

- `needsAttention` lists team records not actionably assigned to the caller;
  the label orders attention, and authorization still decides what a caller can
  write. Viewer-role participants and unregistered agents remain denied task
  writes.
- The evidence vocabulary is closed: `supports` or `contradicts`. Citations and
  corrections are additive records; they never edit the old assertion.
- The release contains no new read surface, no new object, and no schema or
  migration change.

## Promotion record

All promotion steps completed October 15, 2026 (UTC).

| Step | Evidence |
| --- | --- |
| Private source and annotated tag | Pushed. Private tag `v1.18.0` on commit `7f60649`; post-pin commit `c9882ef`. |
| Typecheck, full tests, build, local package, deployment dry run | Node 22: typecheck passed; build passed; Darwin ARM64 packaging passed (local archive SHA-256 `c6ecef202938a32c98b9c0632bc9136e33859e25115e3c38e00fda66e2720463`, versioned installer created); Worker deployment dry run passed. Pre-pin suite: 1,077 passed with the one expected install-channel assertion awaiting the four v1.18.0 checksums; that assertion was not loosened. Post-pin suite: 1,078 passed across 87 files. |
| Audited public source snapshot and diff | Export passed audit with 288 manifest files; compared against the fetched public v1.17 branch as 2 added, 14 changed, 0 removed. Public tag `v1.18.0` on commit `e575002`. |
| Public GitHub Release and four checked archives | Published. Release workflow `38832670863` passed all four platforms (Darwin ARM64, Darwin x64, Linux ARM64, Linux x64); eight assets attached. The published `campfire-darwin-arm64.tar.gz` independently passed `shasum -a 256 -c` against its attached checksum (`891a1e5b…`). The pre-pin tag CI failure (`38832652497`) was the expected install-channel assertion and was not loosened. |
| Homebrew / Nix pins and installer verification | Private pins committed as `c9882ef`; public post-tag addendum `dd60eef` (manifest records `installChannelsCommit`); Homebrew tap promoted as `9144b1c`. Post-pin public CI passed (`38833112569`). Live `/campfire/install.sh` and `/campfire/v1.18.0/install.sh` are byte-identical to the tracked files (SHA-256 `ba8603bd106277bf520b1789b77e4e95c8b2bc9c9cae5db5059965bf25d26900`). Clean installs from both URLs into isolated prefixes installed package version `1.18.0` with telemetry disabled; the installed CLI passed a `capabilities` smoke check (58 commands). |
| Production Worker deployment and live verification | Deployed. Cloudflare Worker version `43db08c6-04ae-4d79-887e-7f1403639796`. No schema or migration changes; the installer URLs above were served from this deployment and verified byte-identical. |
