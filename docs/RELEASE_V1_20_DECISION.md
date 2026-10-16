# v1.20 release decision — Shared Work Console

**Date:** October 16, 2026

**Status:** **Withdrawn before promotion** (October 16, 2026). The `v1.20.0` tag was frozen unpublished after the pre-promotion export review and clean-machine CI found a CI-blocking, machine-local test dependency; see the abandonment record below. No promotion step was performed. The repaired source is released as v1.20.1 under `docs/RELEASE_V1_20_1_DECISION.md`.
**Package target:** `1.20.0`
**Contract:** `docs/Campfire-v1.20-UIX-001-Shared-Work-Console.md`
**Sprint result:** `docs/SPRINT_UIX_001_RESULT.md` (CONDITIONAL GO — engineering candidate)
**Candidate commit:** `6df822c`
**Tag:** private annotated `v1.20.0` (object `0d397dc` → commit `eab6c65`), frozen unpublished

## Founder direction and scope

On October 16, 2026, the repository owner directed committing the UIX-001
candidate to `main` and a public v1.20.0 release following the release
guidelines:

> "lets go ahead and commit/push this work to main and also release v1.20 work please following our release guidelines!"

This is the **separate, recorded release decision** that contract §8 requires
for publication with an open human observation. It is a release-scope override
of the UIX-001 evidence hold. It is **not** a GO verdict:

- UIX-001 remains **CONDITIONAL GO — engineering candidate**
  (`docs/SPRINT_UIX_001_RESULT.md`).
- The five pre-registered cold tasks are **NOT OBSERVED**; one operator was
  available, and contract §8 requires at least two non-builder humans.
  Candidate frames and the visual review are fixture evidence, not
  comprehension results.
- D1–D6 pass on the recorded candidate (`6df822c`) and support the
  implementation behavior only.

The bounded release surface is the UIX-001 change and nothing else:

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
- No schema, migration, MCP tool, write path, or Viewer read-method change.

## Abandonment record — why v1.20.0 was never promoted

The annotated private tag `v1.20.0` (object `0d397dc` → commit `eab6c65`)
remains in the private repository as a frozen, unpublished record. Nothing was
promoted from it: no public snapshot, no public tag, no GitHub Release, no
channel pins, and no deployment.

The step-6 export review before promotion (and private CI run `38944995759`,
which reproduced it on the candidate commit `6df822c`) found that the new
`tests/unit/uix-001-dashboard-pty.test.ts` required a machine-local Playwright
`node_modules` path for its evidence-capture test and ran it unconditionally.
On any clean machine, `npm test` failed with `Cannot find module 'playwright'`,
so promoting as-is would have shipped a red public `ci` run and the machine
path in the exported source.

SKILL.md says a pushed release tag is the source boundary and must not be
retargeted. On October 16, 2026 the founder therefore directed, verbatim:

> "Keep v1.20.0 unchanged and unpublished. Remove the machine-specific Playwright path from the required test suite. Keep PTY behavior assertions mandatory; make screenshot capture an explicit optional evidence step. Commit the fix, run clean-machine CI, then prepare a new v1.20.1 release decision and tag. Record why v1.20.0 was abandoned before promotion."

The repair landed as `70f4023`: PTY behavior assertions are mandatory in the
default suite with no external tooling, and terminal evidence capture (txt
frames + PNG screenshots) is an explicit opt-in step
(`CAMPFIRE_UIX_CAPTURE=1`, `CAMPFIRE_PLAYWRIGHT_NODE_PATH`). Clean-machine CI
at `70f4023` (run `38948832973`) shows the repair: 1,125 passed, the optional
capture skipped, and the only failure is the expected install-channel
assertion awaiting the archives (not loosened). The release was re-cut as
v1.20.1; see `docs/RELEASE_V1_20_1_DECISION.md`.

## Evidence that remains adverse or absent

| Evidence | Release record |
| --- | --- |
| UIX-001 five pre-registered cold tasks | **NOT OBSERVED.** Recorded reason: one operator and coding agents; contract §8 requires two non-builder humans. Frozen tasks: `docs/evidence/uix-001/FIELD_MAP.md`. |
| Visual review of candidate frames | Fixture captures at 80×24, 120×36, 1440×900, and 390×844; hierarchy and clipping only, not a cold-task score. The terminal frames are regenerated by `tests/unit/uix-001-dashboard-pty.test.ts` and carry a live refresh timestamp. |
| D1–D6 deterministic checks | **Pass** at `6df822c`: typecheck clean; full suite 93 files / 1,126 tests. The prep state has one expected install-channel assertion awaiting the v1.20.0 archives (not loosened). |
| v1.19 versus candidate human comparison | **Not recorded**; no matched human times. |
| Gate B / C / E / F | **Unmeasured.** Publication satisfies none. |
| ATT-001 H1–H6; WCO-001 C1–C7; SWH-001; VIS-001 condition 4 | **Not observed** (unchanged). |

## The exact public claim

Campfire v1.20 adds a read-only terminal console and refreshes the local
Viewer: `campfire dashboard` renders one authorized `get_workspace_context`
read as an interactive TTY screen — goal, recorded participants, attention
beside current work, decisions, source detail, and recent changes — and the
Viewer presents the same facts with clearer hierarchy and responsive layout
while keeping its five read methods. Both surfaces project existing authorized
workspace state, keep private agent sessions private, and never infer live
agent presence from registration or recent activity. It is **experimental**:
the five cold-task comprehension observations are not recorded, UIX-001
remains CONDITIONAL GO — engineering candidate, and Gate B, Gate C, Gate E,
and Gate F remain open.

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
| Founder direction and prep checks | This document; prep commit `eab6c65` on private `main`. |
| Private annotated `v1.20.0` tag | Frozen unpublished (object `0d397dc` → commit `eab6c65`); not retargeted. |
| Audited public source snapshot | Not performed — v1.20.0 was withdrawn before promotion (see the abandonment record). |
| Public GitHub Release and four checked archives | Not performed — v1.20.0 was withdrawn before promotion (see the abandonment record). |
| Homebrew / Nix pins, tap promotion, installer checks | Not performed — v1.20.0 was withdrawn before promotion (see the abandonment record). |
| Production Worker deployment and live verification | Not performed — v1.20.0 was withdrawn before promotion (see the abandonment record). |
