# WOW-001 scored-run preparation check — October 8, 2026

This is a disposable setup check, not a scored pilot run. No incident agent
investigated a scenario and no rubric item was scored.

The new `pilot.ts prepare` command created a fresh S1 control workspace with
one goal, an investigator, a distinct continuing agent, both memberships, and
private tokens. Its setup stream tip was 7. A synthetic completed-run receipt
then exercised `prepare-second`: a consistent read-only backup was taken at
stream tip 7 and staged for a fresh second-agent container with its own token.
The synthetic receipt existed only in the `smoke-prep-s1` scratch directory.

The first S2 setup attempt stopped before any model run because the seeded
artifact used `/run/evidence/02-database-dashboard.md`. Campfire correctly
rejected that absolute path. The setup now records the portable
`evidence/02-database-dashboard.md` reference, which resolves within the
agent's `/run` directory. A fresh S2 treatment setup then completed at stream
tip 13 with the exact prior-shift agent session, report artifact, provisional
finding, and supporting citation specified by `S2/setup.md`.

The S1 and S2 smoke run directories, including their databases and tokens,
were deleted after these checks. Existing boundary-probe directories were not
changed. The locked model, image, prompts, arm order, budgets, rubric, and
sealed answer keys were not changed.

Focused preparation tests also pass for S1 identity separation, S2 seeded
session provenance, a frozen second-agent copy, and refusal to hand off an
invalid first run. The scored runner now marks missing or mismatched session
tool-call counts and budget overshoot invalid, and refuses to overwrite a
run's existing evidence. These are pre-run integrity checks, not pilot scores.
