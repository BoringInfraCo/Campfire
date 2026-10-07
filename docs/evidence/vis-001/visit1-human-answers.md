# VIS-001 entry-gate evidence — Visit 1 (real human, single participant)

**Date:** 2026-10-04 (UTC)
**Participant:** repo operator (single human), operating as fixture identity `hum_grace`
  (Harbor participant; fixture humans were created by the operator in the COR-001 gate).
  Fixture identity used because the Harbor gate workspace's participants are fixtures.
**Machines:** one (this machine). **Harnesses in play for this visit:** none (human only).
**Viewer:** http://127.0.0.1:19415 (loopback), read-method allowlist, browser token-free,
  backed through `campfire serve` on 127.0.0.1:19414 with Grace's token; server access log
  retained as `serve-trace.log`.

## State presented (service reads, not browser filtering)

Orientation (`get_workspace_context`, actor hum_grace, workspace ws_e844657c1dcc4e5a):

- findings: 10 returned of 15 (truncated true); current finding `find_bc006e9c442a4f1a`
  "The March export dropped rows because the export window overlapped a reload"
- decisions: 10 returned of 14 (truncated true); current accepted `dec_f9bd16ad4d8f44e6`
  "Skip the cache flush and rerun the export after the reload window"; also
  `dec_80dad7d77e47449d` accepted + needsReview (precaution, cites superseded finding)
- tasks: 20 returned of 22 (truncated true); all `open`; top `task_235f9612e64c4b20`
  "Reload the March export"
- artifacts: 10 returned of 14 (truncated true); all type `log`, URIs are relative paths
- historicalCounts: findings 1, decisions 1
- needsYou / needsAttention: the proposed chalkboard decision (`dec_4798a7cd9c314b29`)
- suggestedNextAction: the proposed chalkboard decision

Raw context payload: `state-presented-raw-context.json`.

## Participant answers (verbatim)

> 1. the march export dropped rows because the tide table was stable, the tide table was
>    current. the export overlapped the cache reload.
> 2. ada and grace agreed
> 3. the march export dropped rows, accepted decisions
>    accepted
>    Keep the tide-table check before every export as a precaution
> 4. i dont see anything else unless the tide-tabble check after every export as precaution
> 5. i opened every action and got a good overview of what was happening
> 6. im not sure
> 7. nothing really

## Observed comprehension failures (correct data, divergent understanding)

Data correctness: the service returned the current finding, the current decision, the
needsReview decision with its cited superseded finding, and the next task. All values
below were present in `state-presented-raw-context.json`. No value was missing or wrong.

1. **Current decision misidentified.** The participant named the accepted-but-`needsReview`
   precaution decision (`dec_80dad7d77e47449d`) as the team's decision. The actual current
   decision is `dec_f9bd16ad4d8f44e6` ("Skip the cache flush..."), which superseded the
   obsolete flush decision. The participant did not distinguish a current accepted position
   from an accepted decision flagged for review. This is a currentness/salience comprehension
   failure on correct state.
2. **Current finding reconstructed from the correction reason, not read as the finding's own
   summary.** The participant's answer mirrors the correction *reason* text ("The tide table
   was current. The export overlapped the cache reload.") rather than quoting the current
   finding summary. Same failure mode as the COR-001 OpenCode catch-up deviation: a compact
   label read as the object title.
3. **Next action not identifiable.** The participant answered "im not sure." The work-relevant
   next step is task `task_235f9612e64c4b20` "Reload the March export" (open). 22 tasks are all
   `open`; the relevant one is buried. The service's suggestedNextAction points at a proposed
   decision, not the work step.
4. **Basis/evidence not surfaced.** The participant could not name the decision's reason or its
   supporting/contradicting evidence artifacts in Visit 1.

## Evidence boundary

- This is one real human on one machine operating as a fixture identity. It is not Gate B
  (repeat use) or Gate C (multi-participant ordinary value) evidence.
- Visit 1 alone does not satisfy the "return visit / catch-up" half of the product trace.
- Artifact-open behavior was not probed with a specific reference in Visit 1; condition 4 is
  not yet satisfied.
