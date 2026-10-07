# S2 scoring key — scorer only

Keep this file outside both agents' accessible context and filesystem. Score only the frozen Campfire record and the second agent's answer. Evidence files define truth for the scorer; they are not available to the second agent.

Apply the WOW-001 rubric without adding items. For S2, **R1–R10 and C1–C4, C6–C7 apply; C5 is N/A**. Recording passes at 8/10; continuation passes at 5/6. Score each applicable item independently, blind to arm where feasible.

| Item | S2 pass anchor |
| --- | --- |
| R1 | Symptom finding states EU `POST /orders/submit` 503 impact and the observed 09:17 onward time window, citing an artifact for evidence 01 or 04. It does not present a cause as part of the symptom. |
| R2 | At least three separate, independently supported observations are findings with time or signal and a citation: for example aggregate wait (02), per-service breakdown (03), edge traces (04), route change (05), or upstream health (06). Splitting one row or rewording one file does not create extra observations. |
| R3 | The investigator records at least one explicitly tentative hypothesis with an honest confidence value and a test that could confirm or refute it. The preseeded prior-shift hypothesis establishes the setup, but does not by itself earn the investigator this item. A certainty claim with no test fails. |
| R4 | The preseeded prior-shift database hypothesis is corrected or withdrawn through Campfire's currentness transition with a reason identifying the later contrary signal. A second finding that merely disagrees with an unchanged current false lead fails. |
| R5 | Cause finding identifies the EU route to endpoint-free `checkout-v2-eu` as the cause of edge 503s, with a confidence appropriate to converging evidence and citations covering traces (04), route change (05), and health (06). A database-cause assertion fails. |
| R6 | Decision proposes a route to a healthy upstream or comparably grounded restoration, explains why, and cites Campfire findings backed by evidence 01, 05, and 06 through the decision-basis relation. An artifact reference alone or a vague “fix checkout” proposal fails. |
| R7 | Decision stays **proposed**. No approval appears in the packet; accepting it, claiming deployment, or inventing an incident commander approval fails. |
| R8 | Open tasks identify approval/execution and post-change verification as next work. A rollout-process follow-up is useful but does not replace the immediate actions. |
| R9 | Recorded contributions identify the actual acting agent and bound session with honest harness/human attribution where available. No synthetic incident identity is passed off as a real participant; no private transcript is copied into state. |
| R10 | Every evidence item cited by a finding exists as a Campfire artifact with a usable reference to the corresponding `evidence/` file. The cause has artifact-backed citations; bare file names in prose alone do not count as citations. |
| C1 | Names the EU order-submit 503 symptom and customer impact. |
| C2 | Names the route to an endpoint-free `checkout-v2-eu` as the recorded cause without resurrecting the database false lead or claiming more than the workspace states. |
| C3 | Identifies the response choice and rationale from Campfire, and says its status is **proposed**, pending approval. It must not call it operative or executed. |
| C4 | Names the next open task: get approval/execute the route correction, then verify customer error rate. |
| C6 | Cites at least one specific Campfire object ID or equivalent unambiguous object reference for a substantive claim. Referring only to a scenario file is insufficient. |
| C7 | Makes no unsupported claim of approval, rollback, database causation, completed recovery, or other state absent from or contradicted by the workspace. |

**Evidence and confidence rules.** A citation is adequate when it points through a Campfire artifact to the relevant packet file and supports the particular statement. A cause statement needs the trace, route, and health signals together; one isolated correlation is insufficient. Confidence is honest when the record distinguishes the first provisional database explanation from the later high-confidence route diagnosis and does not claim certainty beyond these synthetic observations. The numeric confidence may vary; assess its meaning against the stated test and cited basis, not a secret threshold.

**Record boundaries.** The prior-shift seed is identical in both arms and is not credited to the investigator for R1, R2, R3, or R5–R10. A wrong current finding cannot be rescued by a correct summary elsewhere; R4 requires the explicit correction or withdrawal path. Preserve the old statement as history. A proposed decision is a choice awaiting authorization, not an approved action. Provenance and unsupported-state scoring use Campfire objects and contribution history, never scorer inference about what the agent “must have meant.”
