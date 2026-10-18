# v1.22.0 release decision — Focused Terminal Navigator (scoped candidate)

**Date:** October 17, 2026

**Status:** Founder-directed public release, recorded under the founder delivery rule in `docs/ROADMAP.md`. Publication, channel pins, and production deployment are recorded in the promotion table as they complete.
**Package target:** `1.22.0`
**Contract:** `docs/Campfire-v1.22-NAV-001-Focused-Terminal-Navigator.md` (frozen scope §1, D1–D6 §5, verdict rules §6, deliverables §7)
**Sprint result:** `docs/SPRINT_NAV_001_RESULT.md` — **CONDITIONAL GO — engineering candidate**; the contract §6 two-person comparison is **NOT OBSERVED**
**Candidate commits:** scope freeze / Step 0 `ff8c327`; implementation `64cc5a4` (the independently verified revision); verifier-driven input/label adjustments `c2ff97e`; result record `11d6122`; first-run docs/help alignment `448c9a8`

## Why this release exists

On October 17, 2026 the founder amended the roadmap delivery rule: passing local engineering checks can support a separately approved, accurately described release while multi-person observations remain open; known authorization, credential, data-leak, or decision-safety defects still block publication. NAV-001 was subsequently frozen before product code (`ff8c327`), implemented (`64cc5a4`), independently verified against D1–D6 (all PASS, no blockers, fresh runs at the recorded revision), adjusted where the verifier found input-handling and hint issues (`c2ff97e`), and recorded as **CONDITIONAL GO — engineering candidate** (`11d6122`). The founder then directed, verbatim (October 17, 2026, acting in the `Campfire-Internal` repository):

> "lets commit/push/release please lets do it! use subagents!"

This document is that recorded release decision. It is **not a human-outcome result and is not a verdict change**:

- NAV-001 §6's two-person comparison remains **NOT OBSERVED** (one operator was available; §6 forbids substituting agents or the builder for a human answer). Nothing is rescored; the five pre-registered cold tasks are neither passed nor failed.
- The candidate's engineering checks state only that the tested behavior works as governed (D1–D6 at the recorded commits, typecheck, the full suite, build, packaging, and deployment dry run). They do not state that any person comprehends the navigator, follows work faster, or resumes interrupted work.
- Human observations may follow publication when eligible people and tasks exist, under the contract's own procedures; any later observation is recorded under its own date and never rewrites this record.

## The exact release surface (nothing else)

The published v1.21.0 surface gains exactly the NAV-001 candidate (`64cc5a4` plus the verifier-driven adjustments `c2ff97e`) and the first-run documentation/help corrections (`448c9a8`):

- **Focused dashboard**: the read-only `campfire dashboard` now shows one focused section at a time (`attention`, `work`, `decisions`, `references`, `changes`) with a selected-record summary; `tab` cycles sections, `p` toggles My/Team, `j`/`k` move over the shown rows, `enter` inspects, `r` refreshes while preserving selection, `?` opens help, and `q`/Ctrl-C exits with the terminal state restored.
- **Selection-preserving refresh and stale labeling**: a refresh reloads the same authorized read; when the read is replaced, the previously selected record is re-found by identity where present, and stale state is labeled instead of silently shown as current.
- **Bounded shown-records filter** (`/`): filters the loaded rows of the current section only — it is not a workspace search — states "filters shown records, not the workspace" and "showing X of Y loaded rows", clears with `esc`, and accepts every letter while typing (in typing mode `q` is text; Ctrl-C quits from every mode). This is the one contract-interpretation deviation from the frozen §1 literal wording, recorded in the result §6, not silently.
- **Read-only boundary unchanged**: no new write path, schema or migration, service method, Viewer change, CLI JSON shape, MCP tool/contract, installer change, or telemetry event; non-TTY behavior is unchanged; record text remains stripped of control sequences, terminal state is restored on every exit path, and escape-led input chunks are stripped rather than leaking sequence bytes.
- **First-run docs/help correction (shipped in this release)**: `README.md`, `docs/OPERATOR.md` (and the public OPERATOR variant), and the `campfire --help` global notes now state the implemented behavior — a first interactive `campfire` run records the human once and starts the local API and Viewer in that same invocation; later runs print status and `campfire up` reopens. The behavior itself is unchanged by this release; the text previously lagged it.

## Evidence that remains open or unmeasured

| Evidence | Status in this release |
| --- | --- |
| NAV-001 §6 two-person comparison | **NOT OBSERVED** (unchanged; no verdict change) |
| Deterministic D1–D6 candidate checks, typecheck, full suite, build, `pack:tarball`, `deploy:dry-run`, PTY behavior | **Engineering PASS**, recorded in `docs/SPRINT_NAV_001_RESULT.md` §2–§5 with the independent-verification record (§4) and the release-prep runs (the sole interim failure is the expected install-channel assertion, green after the pin) |
| Human comprehension of the focused navigator | **Unmeasured.** Later observations record it under their own date, per the contract. |
| UIX-001 five cold tasks; Gate B/C/E/F; ATT-001/WCO-001/SWH-001/VIS-001 condition 4 | **Unchanged/unobserved.** This release satisfies none of them and moves none. |
| A live interactive human walk of the released surface | **Unmeasured.** Candidate frames are fixture/engineering evidence, never human evidence. |

## The exact public claim

Campfire v1.22.0 focuses the terminal dashboard into one section at a time over the same authorized workspace read. `campfire dashboard` now shows a single focused section (`tab`) with a selected-record summary, `j`/`k` over the shown rows, `enter` to inspect, `r` to refresh while preserving selection and labeling stale records, and a bounded `/` filter that states it filters the shown records rather than the workspace; the dashboard remains read-only, and non-TTY behavior, CLI JSON, MCP, the Viewer, schemas, and installers are unchanged. The operator documentation and `campfire --help` also now match the implemented first-run behavior (the first interactive `campfire` run records the human and starts the local API and Viewer in the same invocation; later runs print status and `campfire up` reopens). **It is experimental**: NAV-001 is CONDITIONAL GO — engineering candidate; D1–D6 pass and the implementation was independently verified, but no person has yet been observed using the navigator (the two-person comparison is NOT OBSERVED — one operator was available, and the contract forbids substituting agents or the builder for a human answer). Gate B/C/E/F, ATT-001, WCO-001, SWH-001, VIS-001 condition 4, and the UIX-001 cold tasks remain open or unobserved. Nothing in this release claims a comprehension, continuation, or team-value result.

## What users should know

- The navigator is keyboard-only over the same authorized read; it adds no capability beyond reading what you are already authorized to see.
- The filter is deliberately local to what the dashboard has loaded; it is not a search over the workspace, and it says so on screen.
- A refresh can change what is loaded; selected rows are re-found by identity and stale rows are labeled. Nothing is inferred.
- Agents see no new tool, method, or credential; the dashboard remains read-only; non-TTY output is unchanged.
- No object, schema, migration, notification, or write path is added.

## Promotion record

Each step is recorded with its evidence as it completes; no check is loosened. The private-repository CI install-channel assertion is expected to fail until the post-release pin commit (pre-recorded as the expected failure, not a defect).

| Step | Evidence |
| --- | --- |
| Founder direction, candidate chain, and prep checks | This document; prep commits `448c9a8` (first-run doc/help alignment) and the decision commit `1b9432dca9e2900bee2378e2672ca93df07200de` (decision + `1.22.0` bump + public claim + versioned installer; pre-verification: typecheck PASS; full suite 96 files / 1,185 tests — 1,183 passed, 1 opt-in capture skipped, 1 expected install-channel assertion awaiting the v1.22.0 archives, **not loosened**; build PASS with `public/` byte-identical to `src/viewer/static/`; deploy dry-run PASS, wrangler 4.149.0, 65 public assets read, Total Upload 345.91 KiB / gzip 65.62 KiB; Darwin ARM64 packaging sha256 `3334d39358da6930050d459bfb1dce0895ae672c02c03c8773e41635a1be114c` with extracted package `1.22.0`; live/versioned installer bytes identical (`ba8603bd106277bf520b1789b77e4e95c8b2bc9c9cae5db5059965bf25d26900`)) |
| Private annotated `v1.22.0` tag | Pushed origin `main` (`63ef3c9..1b9432d`) and tag. Annotated tag object `83d0602ac43c801390f8001b5330c2c237814621` → commit `1b9432dca9e2900bee2378e2672ca93df07200de`. Private CI at both pushes (runs `39095522705`, `39095523394`) failed only on the expected install-channel assertion (`AssertionError: expected 'class Campfire < Formula…' to contain '/v1.22.0/'` at `tests/unit/install-channels.test.ts:31:21`) — pre-recorded, not loosened. |
| Audited public source snapshot | Published. Public commit `6050561e05c2883b84728b3f65ce854b70dccf20` on top of `f051099` (19 files changed: 7 added — the 5-file `fixtures/navigator/nav-001/` fixture, `tests/unit/nav-001-dashboard.test.ts`, and the tracked `public/campfire/v1.22.0/install.sh` — and 12 modified: public docs, `PUBLIC_SNAPSHOT_MANIFEST.json`, `package.json`/`package-lock.json`, `src/cli/catalog.ts`, `src/cli/dashboard.ts`, and the three adapted UIX/ARH tests; `+3,370/−201`); public annotated tag `v1.22.0` (object `f1a5696e41ffd6d10d48866ab9f5b7af2971d243`). Export manifest: 322 files; `sourceCommit` `1b9432d…`. The push's rule-bypass note for the required pre-pin `ci` check (`Bypassed rule violations for refs/heads/main: - Required status check "ci" is expected.`) is the documented pre-pin state; public `ci` runs `39095755555` (main) and `39095758704` (tag) then failed only on the same expected install-channel assertion. |
| Public GitHub Release and four checked archives | Published. Release `v1.22.0` live at `github.com/BoringInfraCo/Campfire/releases/tag/v1.22.0` (published 2026-10-18T04:03:24Z; title `v1.22.0`, the recorded notes; not draft/prerelease). Workflow `39095762811` (4/4 platform jobs: darwin-arm64, darwin-x64, linux-x64, linux-arm64) attached eight assets (four archives + four `.sha256`). `shasum -a 256 -c` on all four downloaded checksum files passed: darwin-arm64 `da98a10e273b02403fb33b12e2292e1006d6ddd61b5eac92c43007eddc2229f2`, darwin-x64 `8a19e9aaef00a106778c16c5fd70631b2c0389bc3e7c8e35398d89626f83d5a8`, linux-arm64 `5770dd8a7be55cc376272cf83d3fe10c603bb105bdf8e2b1c4dd305ddbb3dc12`, linux-x64 `a5cc431978353709fdf5a5c58cd218221545388a322b4a902d20aef64c41dcf9`. Extracted darwin-arm64 archive reports package `1.22.0`. |
| Homebrew / Nix pins, tap promotion, installer checks | Private pin commit `971fe3d740f2a8c76e84a22f8ac801b787b7589c` (formula + flake pinned from the published checksums; private CI run `39095943094` — **success**; post-pin full suite 96 files / 1,185 tests — 1,184 passed, 1 opt-in capture skipped — the expected install-channel assertion went green). Public addendum `c493eda536f85400d279a0dde2dd2c8b7e702779` records `installChannelsCommit` `971fe3d…` (manifest + flake + formula only; no new tag; public `ci` run `39096083408` on the addendum — **success**, so the required check is satisfied at the pinned snapshot). Homebrew tap `BoringInfraCo/homebrew-campfire` promoted as `d5f84b11f999fbb8ee1c83ab35308d2c926dcbc8` (`campfire 1.22.0`; the four checksums match the published archives). |
| Production Worker deployment and live verification | Deployed. `npm run deploy` exit 0 from `1b9432d` (wrangler 4.149.0; 65 public assets read, no updated blobs to upload — content-addressed store; Total Upload 345.91 KiB / gzip 65.62 KiB; `env.DB (campfire)` D1 binding resolved from the gitignored local config via ephemeral wrangler config; route `boringinfra.company/campfire/*`). New version `eae6d2de-a44a-49d7-b523-2cc37600a205` at 100% traffic (previous `d4e537cd-e465-4c15-a847-36efde627175`, the v1.21.0 deploy), created 2026-10-18T04:04:51Z. Live installer checks: `boringinfra.company/campfire/install.sh` and `…/campfire/v1.22.0/install.sh` both byte-identical to the tracked files (`ba8603bd106277bf520b1789b77e4e95c8b2bc9c9cae5db5059965bf25d26900`). `…/campfire/live` returned HTTP 404 with the deployed Worker's own JSON (`{"ok":false,"error":"ValidationError","message":"Not found: /live"}`; `server: cloudflare`) — the live-touch evidence. Clean install from the versioned URL into an isolated `CAMPREFIX` with `CAMPFIRE_TELEMETRY=0`: checksum verified (`da98a10e…29f2`), installed `campfire 1.22.0` (darwin/arm64), `campfire --help` exit 0. |
