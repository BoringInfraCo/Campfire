# ATT-001 scenario repair v2 — record

FIXTURE EVIDENCE — calibrates UI and rubric; cannot establish Gate B, C, or E.

**Dated:** October 15, 2026 (local, America/New_York; October 16, 2026 UTC —
the fixture README dates the repair v2 section in UTC).

## What changed

The ATT-001 fixture originally seeded a proposed decision
(`dec_att001_proposed`) in the lab workspace `ws_att001_lab`.

During answer-key authoring — while calibrating the frozen rubric against the
fixture, before any candidate result or human trace existed — the lab
workspace was found to give **both** human participants nonempty attention
lists (Ana: the proposed decision plus assigned tasks; Ben: an assigned
blocked task plus team cues). That made rubric H4's incomplete-empty clause
("does not interpret an incomplete empty list as team completion") impossible
to observe directly in the single trace workspace: no participant saw an
attention list that was empty while its source page was truncated.

The lab proposed decision was therefore removed from the fixture (scenario
repair v2). The contract §4 case set does not require a proposal: every keyed
case — truncated task and decision pages, accepted decisions with
`needsReview`, team-cued tasks, and the complete quiet page — is provided
without one. After the repair, lab Ben has no assigned tasks and no cues while
the lab task page is truncated (21 total / 20 returned), so his My work
attention list is an incomplete empty — the direct H4 observation the trace
workspace must provide — while Ana's lists stay nonempty and truncated. The
repair changed only the scenario inputs: the fixture's seed script and README;
no application source was touched.

## Status of the evidence

- The repair was made **before any candidate result or human trace existed**.
- **Nothing was rescored because nothing had been scored.** No candidate run,
  trace participant, or H-item verdict predates this repair; the ATT-001
  evaluation is unscored at the time of this record.
- The v1.18.0 baseline evidence (`docs/evidence/att-001/baseline/`) was
  **re-produced fresh** against the repaired fixture, from a clean git
  worktree at tag `v1.18.0` (commit `7f60649`), and the previous capture set
  was replaced rather than patched. See `PIN.md` and
  `served-state/seed-log.txt`.
- The four contract §2 baseline gaps still reproduce on the re-produced
  captures, all with unchanged verdicts (`GAP_PROBES.md`).
