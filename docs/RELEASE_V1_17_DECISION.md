# v1.17 release decision — Shared Work Home

**Date:** October 14, 2026

**Status:** Published and deployed as v1.17.0 (October 14–15, 2026).
**Package target:** `1.17.0`

## Founder direction and scope

On October 14, 2026, the repository owner directed a public v1.17.0 release:

> "lets launch v1.17 to the public now! lets tag it and make sure our install commands have the updated version!"

This is the **separate, recorded founder override** that the October 14
direction in `docs/SPRINT_SWH_001_RESULT.md` §9 and contract §8 require for a
bounded publication with open observations. It is a release-scope override of
the SWH-001 evidence hold. It is **not** a GO verdict: the contract requires
two controlled human comprehension traces before GO or CONDITIONAL GO, and
those traces have not been run. The override does not turn any absent
observation into a pass.

The bounded release surface is the implemented one: the read-only **Shared
Work Home** in the local actor-bound Viewer — My work and Team work
perspectives over the same authorized `get_workspace_context` read, a shared
decision boundary, bounded completeness for every displayed slice, and inert
artifact references. It is not a hosted or shared-login team experience. No
new read method, write, page family, schema, CLI, MCP, worker, or telemetry
change is included; the five-method Viewer allowlist and the token-free
browser are unchanged.

## Evidence that remains adverse or absent

| Evidence | Release record |
| --- | --- |
| SWH-001 controlled human trace (H1–H7) | **Not run.** Both required participants and the item-level scoring are outstanding. |
| Shipped-v1.16 Viewer comprehension trace | **Not run.** Owed since VIS-001; the v1.16 baseline records why. |
| Reference-open observation (VIS-001 condition 4) | **Open.** No ordinary-work attempt has been observed. |
| Ordinary two-human/two-agent continuation | **Not observed.** |
| Gate B / Gate C / Gate E | **Unmeasured.** Publication does not satisfy any gate. |
| D1–D7 deterministic checks | **Pass** on the pinned candidate `d7e3b62`; full suite 1,064 tests at pin; one expected install-channel assertion awaits the v1.17 archives until the pins move. |

The contract's §8 GO and CONDITIONAL GO criteria are **not met**. The
override waives only the publication hold and the trace-before-publication
sequence for this bounded candidate. A critical human failure found later is
repaired and retraced; it is not retroactively treated as a pass.

## The exact public claim

Campfire v1.17 adds a read-only **Shared Work Home** to the local actor-bound
Viewer: My work and Team work perspectives over one authorized workspace, a
shared decision boundary for proposed, accepted, needs-review, and historical
records, per-slice completeness, and inert artifact references. It is
**experimental**: no human comprehension evidence has been recorded yet, and
the frozen H1–H7 rubric is unscored. It is not a hosted shared-login team
service. No Gate B, Gate C, or Gate E claim follows.

## What users should know

- The perspectives are presentation filters over already-authorized workspace
  records, not privacy modes. Sensitive words placed in shared records are
  visible to every authorized participant.
- Artifact references are stored references, not proof of existence or access;
  the page does not fetch, preview, or link them.
- The Viewer stays loopback by default and bound to one actor; a Viewer URL is
  not a share link.
- A task or decision is "mine" only when its recorded assignee says so; the
  page never infers agent presence or unrecorded relations.

## Promotion record

All promotion steps completed October 15, 2026 (UTC; begun under the October 14 direction).

| Step | Evidence |
| --- | --- |
| Private source and annotated tag | Pushed. Private tag `v1.17.0` on commit `2b98c75`. |
| Typecheck, full tests, build, package, deployment dry run | Node 24: typecheck passed; build and Darwin ARM64 packaging passed; Worker dry run passed. A local install from the archive reported `1.17.0`. Pre-pin suite: 1,063 passed with one expected install-channel assertion awaiting the four v1.17.0 checksums; that assertion was not loosened. Local archive SHA-256: `f5105a00f5b844b32952b06a51336ee19a4ca58bfacf18ddcbec8b0a1b7cd151`. |
| Audited public source snapshot and diff | Export passed audit with 286 manifest files; compared against the fetched public v1.16 branch as 5 added, 13 changed, 0 removed. Public tag `v1.17.0` on commit `f0cc47f`. Versioned installer parity verified. |
| Public GitHub Release and four checked archives | Published. Release workflow `38679133301` passed all four platforms (Darwin ARM64, Darwin x64, Linux ARM64, Linux x64). Four archives and four checksum files attached. The published `campfire-darwin-arm64.tar.gz` independently passed `shasum -a 256 -c` against its attached checksum (`b9e4c272…`). |
| Homebrew / Nix pins and installer verification | Private pins committed as `3491e3c`; public post-tag addendum `e598003`; Homebrew tap promoted as `09e0707`. Public CI passed on the pin addendum (`38679471088`); the snapshot CI failure was the expected pre-pin assertion, and it was not loosened. Post-pin private suite: 1,064 passed across 86 files. Live `/campfire/install.sh` and `/campfire/v1.17.0/install.sh` match the tracked files byte for byte. Clean installs from both URLs installed package version `1.17.0` with telemetry disabled. |
| Production Worker deployment and live verification | Deployed. Cloudflare Worker version `a7fb2bcc-7292-47a5-8498-04c9cbecdf74`. No schema or migration changes between v1.16 and v1.17. |
