# WOW-001 operator initial score — unblinded, provisional

October 8, 2026. This is one initial application of the frozen rubric by the
operator who ran the pilot and therefore knew the arm labels. It is **not**
the required pair of independent, arm-blind score sheets, is not a resolved
score, and does not set a verdict. The independent scorer launch was blocked
before data transfer. Preserve this sheet as an initial judgment rather than
retroactively changing it after other scorers respond.

`P` = pass, `F` = fail, `—` = preregistered N/A. The workspace exports and
verbatim second-agent answers are in `runs/<run-id>/`.

| Run | R1 | R2 | R3 | R4 | R5 | R6 | R7 | R8 | R9 | R10 | Initial recording |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | ---: |
| S1 control | P | P | F | — | P | P | P | F | P | P | 7/9 |
| S1 treatment | P | F | F | — | P | P | P | P | P | P | 7/9 |
| S2 control | F | F | F | P | F | F | P | P | P | F | 4/10 |
| S2 treatment | F | F | F | P | F | F | P | P | P | P | 5/10 |
| S3 control | P | P | F | — | F | P | P | P | P | P | 7/9 |
| S3 treatment | P | F | P | — | P | P | P | P | P | F | 7/9 |

All applicable continuation items were initially marked P: S1 and S2 are
6/6 each (C5 N/A); S3 is 7/7 each. The second agents named the recorded
cause or uncertainty, identified proposed rather than accepted decisions,
cited Campfire IDs, and named open tasks. This needs independent review,
especially C7 where a response paraphrases artifact support.

## Decisive recording reasons and borderline calls

- **S1 control:** R3 fails because no distinct finding labels a testable
  hypothesis or gives a confirmation/refutation test; the cause finding is an
  inference. R8 fails because open tasks cover confirmation, approval, impact,
  and monitoring after the rollout pause but do not record the authorized
  remediation and post-remediation pool/503 verification as next work.
- **S1 treatment:** R2 fails because the distinct rollout, revision, pool,
  and database observation findings have no `finding_evidence` relations;
  citations attach to the symptom and synthesis instead. R3 is a borderline
  fail: `find_67bfd43a9081400e` has confidence and confirm/refute tests, but
  labels itself a likely cause rather than explicitly a hypothesis. It can be
  reconsidered against the frozen key by independent scorers.
- **S2 control:** The first agent recorded a cause, a correction, a proposed
  decision, and a complete follow-up task, but no separate cited symptom or
  three cited observations (R1/R2). It authored no new testable hypothesis
  (R3). `find_392e265849f54d51` has no formal artifact citation, so the
  route/traces/health requirement for R5 and the artifact-backed decision
  basis for R6 fail; R10 fails for an asserted cause without such a citation.
  R4 passes because the prior finding was superseded with a reason.
- **S2 treatment:** R4 passes because the prior finding was withdrawn with a
  reason tied to the contrary DB split and edge traces. R1/R2 fail because
  the symptom and separate observed facts lack formal artifact citations;
  R3 fails because the only tentative hypothesis is the preseeded one. The
  cause cites traces and health but lacks a formal citation to the route
  change artifact (05), so R5 and the required 01/05/06-backed decision
  basis in R6 fail. R10 is an initial pass because the cause does have
  registered, linked evidence for its other signals; assess this separately
  from the stricter R5 coverage requirement.
- **S3 control:** R3 fails because no finding explicitly labels a tentative
  hypothesis with a refuting test. R5 is a borderline fail: the unresolved
  cause finding cites the evidence gap but does not itself state the
  discriminating diagnostic; that appears in the decision and task. R1 is
  an initial pass by reading the cited support finding together with the
  gateway failure finding as the user-visible timeout symptom.
- **S3 treatment:** R2 fails because the distinct aggregate, trace-coverage,
  gateway sample, and database observation findings lack their own formal
  evidence relations. R10 is a borderline fail: several such findings and
  one decision basis use evidence described in prose without the appropriate
  direct relation, even though their artifacts are registered and the
  inconclusive conclusion itself is cited. Two decisions remain proposed;
  the second agent correctly reports both, rather than inventing an
  operative decision.

The initial thresholds would fail for all three treatment arms, and only
one pair (S2) would show a strict recording gain. **That is not the pilot
verdict.** Borderline calls, independent sheets, and frozen-key resolutions
are outstanding. In particular, S1 R3, S3 R1/R5/R10, and the exact scope
of S2 R10 could change after the required review.
