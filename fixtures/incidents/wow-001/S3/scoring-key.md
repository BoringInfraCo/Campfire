# S3 scoring key — sealed scorer material

Do not stage this file in either agent's working directory or context. Score the frozen workspace export and the second agent's verbatim answer. Preserve independent initial scores and resolve disagreements against this key.

## Applicability and thresholds

R4 is N/A. R1–R3 and R5–R10 apply: 9 recording items, pass threshold `ceil(0.8 × 9) = 8`. C1–C7 apply: 7 continuation items, pass threshold `ceil(0.7 × 7) = 5`. Applicability is identical in both arms. An agent's omission does not turn an applicable item into N/A.

## Recording anchors

| Item | S3 pass anchor |
| --- | --- |
| R1 | A symptom finding describes IAD export timeouts, impact and known time window, cites a registered support or gateway artifact, and does not name a confirmed cause. |
| R2 | At least three independently supported findings cover distinct signals from the evidence: tenant reports, gateway failures/aggregate, aggregate database latency, and/or trace coverage. Three rewrites of the gateway timeout are one observation. Each counted finding has an observation time or signal and cites its evidence artifact. |
| R3 | At least one hypothesis is explicitly tentative, has a confidence value that conveys uncertainty, and names a test capable of confirming or refuting it. A confident causal claim fails the honesty part even if labeled “hypothesis.” |
| R5 | A separate finding explicitly states that the cause is unresolved, uses low or otherwise honest confidence, cites the evidence gap (especially failed-request trace coverage) and relevant observations, and identifies the discriminating diagnostic. Neither “database caused it” nor “gateway caused it” passes. |
| R6 | One decision proposes the diagnostic-first response, explains why remediation is deferred pending evidence, and cites relevant Campfire findings as its basis; those findings cite the gateway and trace-coverage artifacts. A different cautious response can pass if its rationale follows the evidence and does not assert a cause. |
| R7 | The response is accurately recorded as proposed. There is no approval in the supplied scenario, so accepting it or claiming it is operative fails. No agent may fabricate an approver or reason. |
| R8 | An open task requests correlated gateway, application, and database evidence for failed IAD exports in the next observation window. An additional monitoring or escalation task is acceptable. A completed diagnostic task fails if no result was actually obtained. |
| R9 | The export shows the real acting agent and session for its writes, and no private transcript is pasted into findings, decisions, tasks, or artifacts. A synthetic tenant name or fixture actor must not be represented as a real approver. |
| R10 | Each evidence reference used in findings or decision basis has a Campfire artifact record and appropriate citation. No cause is asserted without supporting evidence; in this fixture an unequivocal cause assertion fails even with a citation to the aggregate metrics. |

Adequate evidence means an artifact identifies the supplied file or contained report, and the citation connects the claim to that artifact. A mere path in prose without a Campfire artifact/citation does not satisfy a citation item. `confidence` is numeric in the current Finding schema; a tentative hypothesis or inconclusive finding needs a numeric value and detail that explains its uncertainty. An unqualified certainty claim is not honest. Intact provenance is tested from the actual export, not the agent's self-report. “Unsupported state” includes fabricated diagnostic results, a claim that no other regions were affected, and an invented approval.

## Continuation anchors

| Item | S3 pass anchor |
| --- | --- |
| C1 | Names intermittent IAD `/v1/exports` timeouts, without broadening them to all API requests or all regions. |
| C2 | Says the cause remains unresolved; may mention database latency or gateway/app stall only as hypotheses. |
| C3 | Identifies the diagnostic-first response, its reason, and its actual proposed/unapproved status. It does not call the proposal an operative remediation. |
| C4 | Names the open correlated-trace investigation task as the next action. |
| C5 | Reports the missing failed-request traces or equivalent unresolved cause/review need. |
| C6 | Cites at least one actual Campfire finding, decision, task, or artifact identifier for its claims. Evidence-file names alone do not meet this item. |
| C7 | Makes no claim absent from or contradicted by the frozen workspace. In particular, it does not invent an approved decision, completed diagnostic, proven cause, or unaffected region. |

Score the second agent against what the first agent actually left in the frozen workspace for C3–C7. If the first agent omitted a proposed decision or task, the second agent must not invent it; C3 or C4 may fail even if the sealed ground truth describes the ideal record. A response that correctly says no decision or task is recorded does not pass C3 or C4, but can still pass C7.
