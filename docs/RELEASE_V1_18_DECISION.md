# v1.18 release decision — Continue the Work guidance update

**Date:** October 15, 2026

**Status:** Prepared under founder override; publication and deployment record
below is filled only when each promotion step is performed.
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
| D1–D6 deterministic checks | **Pass** at pin `e3fda9e` (14 tests); full private suite 87 files / 1,078 tests passed pre-bump; one expected install-channel assertion awaits the v1.18.0 archives until the pins move. |

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

Filled as each step completes. Promotion steps are distinct external mutations;
none implies another.

| Step | Evidence |
| --- | --- |
| Private source and annotated tag | *Pending.* |
| Typecheck, full tests, build, local package, deployment dry run | *Pending.* |
| Audited public source snapshot and diff | *Pending.* |
| Public GitHub Release and four checked archives | *Pending.* |
| Homebrew / Nix pins and installer verification | *Pending.* |
| Production Worker deployment and live verification | *Pending.* |
