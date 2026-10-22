# Baseline continuation task (ACT-001 §1 item 5)

**Label: FIXTURE EVIDENCE.** Frozen prompt and v1.25-path answer rubric for the
second-harness continuation check. No live run is recorded in Step 0.

## Frozen prompt (given to a second harness with no private transcript)

> Using only authorized Campfire reads in workspace `ws_act001_lab`, explain:
> who authorized the rerun of verification run 11223344, exactly which commit
> and run/attempt it covers, what was submitted versus what was observed, and
> what remains unknown. Cite proposal, receipt, and signed-observation record
> ids. Then perform any task/decision transition only through the existing
> explicit method and authority checks.

## What a correct v1.26 continuation must say (post-implementation)

- Proposal id, human reviewer (`hum_act001_ada`), executor (`agt_act001_opencode_ben`), submission receipt outcome, and signed-observation Artifact/Finding ids, each with actor/session/principal provenance.
- Submission `accepted` means the provider accepted the request, not that tests passed.
- Only provider `success` is verification success; `failure` stays failure.
- Residual unknowns: external effects after revocation, conflicting attempt 3, crash-before-report gaps.

## The v1.25 baseline path (what a second harness CAN vs CANNOT do today)

CAN (supported today):

- Read goal/task/findings/artifact and record history through existing authorized reads.
- Report that NO ActionProposal, receipt, or signed completion record exists for run 11223344.
- Identify the human authorization gap: v1.25 has no human-approval record for an external retry.
- Distinguish absent support from a harness failure (see below).

CANNOT (absent product support, not a harness failure):

- Name a proposal, reviewer digest, reservation, receipt, or correlated signed Finding, because those objects do not exist in v1.25.
- Verify provider run facts from Campfire state: the frozen `find_act001_logs` is a same-workspace assertion, not a signed provider observation.
- Approve, reserve, or reconcile anything: no such methods exist.

## Harness-failure vs absent-support rule

If the second harness invents proposal/receipt ids, claims a retry was approved,
or reports run 11223344 as verified success from the frozen fixture, that is a
HARNESS FAILURE (fabrication), not a product gap. If it truthfully reports the
objects as absent and explains the authorization unknowns above, that is the
correct v1.25 baseline outcome.
