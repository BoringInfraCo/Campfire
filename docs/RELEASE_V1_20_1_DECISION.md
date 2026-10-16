# v1.20.1 release decision — Shared Work Console

**Date:** October 16, 2026

**Status:** Founder-directed public release; prep checks recorded below. Publication, channel pins, and production deployment are separate promotion steps and are recorded in the promotion table as they complete.
**Package target:** `1.20.1`
**Contract:** `docs/Campfire-v1.20-UIX-001-Shared-Work-Console.md`
**Sprint result:** `docs/SPRINT_UIX_001_RESULT.md` (CONDITIONAL GO — engineering candidate)
**Candidate commits:** `6df822c` (UIX-001 candidate), `70f4023` (terminal evidence-capture test repaired after the v1.20.0 hold)

## Why v1.20.1 exists

On October 16, 2026, the repository owner directed the UIX-001 candidate and a
public release, recorded as `docs/RELEASE_V1_20_DECISION.md`. The
pre-promotion export review found that the new
`tests/unit/uix-001-dashboard-pty.test.ts` required a machine-local Playwright
`node_modules` path and ran its evidence-capture test unconditionally, so
`npm test` failed on any clean machine (`Cannot find module 'playwright'`;
private CI run `38944995759`). Rather than retarget the pushed tag, the founder
froze `v1.20.0` unpublished and directed, verbatim:

> "Keep v1.20.0 unchanged and unpublished. Remove the machine-specific Playwright path from the required test suite. Keep PTY behavior assertions mandatory; make screenshot capture an explicit optional evidence step. Commit the fix, run clean-machine CI, then prepare a new v1.20.1 release decision and tag. Record why v1.20.0 was abandoned before promotion."

The abandonment record is in `docs/RELEASE_V1_20_DECISION.md`. This document is
the release decision for the repaired source. It is the **separate, recorded
release decision** that contract §8 requires for publication with an open
human observation, and it is a release-scope override of the UIX-001 evidence
hold. It is **not** a GO verdict:

- UIX-001 remains **CONDITIONAL GO — engineering candidate**
  (`docs/SPRINT_UIX_001_RESULT.md`).
- The five pre-registered cold tasks are **NOT OBSERVED**; one operator was
  available, and contract §8 requires at least two non-builder humans.
  Candidate frames and the visual review are fixture evidence, not
  comprehension results.
- D1–D6 pass at `6df822c` + `70f4023` and support the implementation behavior
  only. v1.20.1 changes no product behavior from the v1.20.0 candidate; it
  repairs the test suite so the release can be verified on a clean machine.

The bounded release surface is the UIX-001 change plus the test repair and
nothing else:

- `campfire dashboard [workspace]`: read-only interactive-TTY console over one
  authorized `get_workspace_context` read; `p` perspectives, `tab` sections,
  `j`/`k` movement, `enter` source detail, a rate-limited automatic `r` refresh
  (15 s, paused while the process is not the foreground process group), and `q`
  quit restoring terminal state on every exit path. A non-TTY call returns the
  `campfire status --output human|json` instruction and writes no cursor
  controls; `status` JSON is unchanged. Record text is stripped of terminal
  control sequences before it is written.
- `src/presentation/work-console.ts`: shared display labels for attention
  reason, coverage, empty lists, lifecycle phrases, and artifact references,
  with a drift test that fails if the Viewer sentences diverge.
- Viewer refresh: attention beside current work on wide screens, stacked panels
  on narrow screens, recorded participant counts, the goal id, and a local
  density preference (`campfire-viewer-density`); `public/` stays byte-identical
  to `src/viewer/static/`.
- `tests/unit/uix-001-dashboard-pty.test.ts`: the PTY behavior assertions
  (truthful frames at 80×24 and 120×36, terminal restore on q / Ctrl-C /
  SIGINT) are mandatory in the default suite and need no external tooling;
  terminal evidence capture (txt frames + PNG screenshots) is an explicit
  opt-in step (`CAMPFIRE_UIX_CAPTURE=1` plus `CAMPFIRE_PLAYWRIGHT_NODE_PATH`),
  skipped by default.
- No schema, migration, MCP tool, write path, or Viewer read-method change.

## Evidence that remains adverse or absent

| Evidence | Release record |
| --- | --- |
| UIX-001 five pre-registered cold tasks | **NOT OBSERVED.** Recorded reason: one operator and coding agents; contract §8 requires two non-builder humans. Frozen tasks: `docs/evidence/uix-001/FIELD_MAP.md`. |
| Visual review of candidate frames | Fixture captures at 80×24, 120×36, 1440×900, and 390×844; hierarchy and clipping only, not a cold-task score. The terminal frames carry a live refresh timestamp and regenerate only via the opt-in capture step. |
| Clean-machine CI (`ci` on `70f4023`, run `38948832973`) | **Pass except the expected install-channel assertion** awaiting the v1.20.1 archives: 1,125 passed, 1 skipped optional capture, 1 expected failure; not loosened. |
| D1–D6 deterministic checks | **Pass** at `6df822c` + `70f4023`: typecheck clean; full suite 93 files / 1,127 tests. |
| v1.19 versus candidate human comparison | **Not recorded**; no matched human times. |
| Gate B / C / E / F | **Unmeasured.** Publication satisfies none. |
| ATT-001 H1–H6; WCO-001 C1–C7; SWH-001; VIS-001 condition 4 | **Not observed** (unchanged). |

## The exact public claim

Campfire v1.20.1 adds a read-only terminal console and refreshes the local
Viewer: `campfire dashboard` renders one authorized `get_workspace_context`
read as an interactive TTY screen — goal, recorded participants, attention
beside current work, decisions, source detail, and recent changes — and the
Viewer presents the same facts with clearer hierarchy and responsive layout
while keeping its five read methods. Both surfaces project existing authorized
workspace state, keep private agent sessions private, and never infer live
agent presence from registration or recent activity. It is **experimental**:
the five cold-task comprehension observations are not recorded, UIX-001
remains CONDITIONAL GO — engineering candidate, and Gate B, Gate C, Gate E,
and Gate F remain open. v1.20.1 is the first published 1.20 release; the
v1.20.0 candidate was never published and no v1.20.0 artifacts exist.

## What users should know

- The dashboard is a human read surface, not a machine protocol: scripts keep
  using `campfire status --output json|human`; a non-TTY dashboard call returns
  that instruction.
- Registered agents and recent contributions are recorded facts. Nothing on
  either surface shows "online", "working", or "blocked" from registration or
  recency, and recorded assignment is not a permission.
- Coverage labels bound what was returned; an empty attention list means no cue
  matched the returned records, never that the team is done.
- A stored artifact reference is labeled as a reference and is not fetched.
- The density control is a local display preference, not a workspace object,
  and the browser remains token-free on the same five Viewer read methods.
- No new object, schema, migration, notification, coordination action, or write
  path is included.

## Promotion record

Each step is recorded with its evidence as it completes; do not loosen a check.

| Step | Evidence |
| --- | --- |
| Founder direction and prep checks | This document; prep commit `dc3c2a4`. Typecheck clean; full suite 93 files / 1,127 (1,125 passing, 1 opt-in capture skipped, one expected install-channel assertion awaiting the v1.20.1 archives, not loosened); clean-machine CI at fix `70f4023` (run `38948832973`) failed only on that expected assertion; Darwin ARM64 packaging built (local sha256 `04cda575b2375d6a13b1058509e296ef0bf7b542d2ce57164f962ac8e3c6c04b`), archive extracts with package `1.20.1`; versioned installer created; Worker deployment dry run passed. The v1.20.0 abandonment is recorded in `docs/RELEASE_V1_20_DECISION.md`. |
| Private annotated `v1.20.1` tag | Pushed. Annotated tag object `4d74b4241ef79ce5fd9c39c0185d56840902008c` → commit `dc3c2a4`. The frozen `v1.20.0` tag stays unpublished and untouched. |
| Audited public source snapshot | Export audit passed from a clean worktree at the tag, 304 files including the manifest; independent export review found no blocking discrepancy. Public commit `d66a4e6` on top of `3b4a91a`; public annotated tag `v1.20.1` (object `25f22519a5cc2300072e539fc4b84597eaf79cf7`). |
| Public GitHub Release and four checked archives | Published. Workflow `38951095296` completed successfully; eight assets attached (four archives + four checksums). Pre-pin snapshot `ci` runs (`38951071231`, `38951074033`) failed only on the expected install-channel assertion (`expected formula to contain '/v1.20.1/'`), which was not loosened. Local `shasum -a 256 -c` on the published `campfire-darwin-arm64.tar.gz` passed and matches the pin `6262438230c43db749fc091ba28ca42a6664b245f2003d13702367e465af27f3`. |
| Homebrew / Nix pins, tap promotion, installer checks | Private pin commit `1102ff56940aebedfb4b43cc715de44ca62fbaef` (suite 1,126/1,126 passing, 1 opt-in capture skipped after pin). Public post-tag addendum `8feaa76` records `installChannelsCommit` in the manifest; post-pin public `ci` passed (run `38951527384` at `8feaa76`). Homebrew tap `BoringInfraCo/homebrew-campfire` promoted as `d0338af` (`campfire 1.20.1`). |
| Production Worker deployment and live verification | Deployed. Cloudflare Worker version `3300f315-2204-481a-98b2-16dcf95ba5b9`. Live and versioned installer URLs are byte-identical to the tracked files (sha256 `ba8603bd106277bf520b1789b77e4e95c8b2bc9c9cae5db5059965bf25d26900`). A clean install from the versioned URL into an isolated prefix verified the published archive checksum (`62624382…`), reported package `1.20.1` with telemetry disabled, and the CLI ran. |
