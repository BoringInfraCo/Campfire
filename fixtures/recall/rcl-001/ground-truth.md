# RCL-001 answer key

Private. Do not put this file in an agent prompt, a handoff packet, a scenario mount, or a scorer packet that still contains the arm label. Seed these ids before the first scored run. Do not edit this key after that run.

Recall section names are not authority. Open tasks, current findings, and proposed or accepted decisions are in the current section. Superseded or withdrawn findings, superseded decisions, and completed tasks are historical. `needsReview` is computed at read time. A proposed decision is not accepted intent. Recency is not currentness.

Seeded agents use harness `fixture` and no model. That is fixture provenance, not a pilot harness lock.

## S1 — Useful prior decision

Workspace `ws_rcl001_s1`. Goal `goal_rcl001_s1`, active: "Ship the partner callback."

| Id | Lifecycle | Role |
| --- | --- | --- |
| `task_rcl001_s1_open` | task `open` (current section) | "Choose partner callback authentication." |
| `find_rcl001_s1_stale` | finding `superseded` (historical) | "A query-string API key authenticated the partner callback." Successor: `find_rcl001_s1_current`. |
| `find_rcl001_s1_current` | finding `current` | "Partner callbacks without a body signature were rejected." Predecessor: `find_rcl001_s1_stale`. |
| `dec_rcl001_s1_proposed` | decision `proposed` (current section, not accepted) | "Authenticate partner callbacks with a query-string bearer token." |
| `dec_rcl001_s1_accepted` | decision `accepted`, `needsReview` absent | "Authenticate partner callbacks with an HMAC of the raw body." Rationale: do not put a bearer token in the query string; sign the raw body, and accept the previous secret for twenty-four hours during rotation. Cites `find_rcl001_s1_current` only. |

Provenance: `find_rcl001_s1_stale` and `dec_rcl001_s1_proposed` come from agent `agt_rcl001_s1`, session `ses_rcl001_s1_a`, on behalf of human `hum_rcl001_s1`. `find_rcl001_s1_current` comes from the same agent, session `ses_rcl001_s1_b`, on behalf of the same human. The accepted decision and the open task come from human `hum_rcl001_s1` with no agent session.

Correct next action: implement the accepted HMAC of the raw body, including the twenty-four hour previous-secret overlap. Do not implement the query-string bearer token. The superseded finding is not current, and the proposal is not accepted. No extra uncertainty is required for the mechanism.

## S2 — Stale lead

Workspace `ws_rcl001_s2`. Goal `goal_rcl001_s2`, active: "Stabilize checkout."

| Id | Lifecycle | Role |
| --- | --- | --- |
| `task_rcl001_s2_open` | task `open` | "Set the checkout retry policy." |
| `find_rcl001_s2_stale` | finding `superseded` (historical) | "The checkout retry should run without an idempotency key because the failures were timeouts." Successor: `find_rcl001_s2_current`. |
| `find_rcl001_s2_current` | finding `current` | "The checkout retry without an idempotency key created duplicate charges." Predecessor: `find_rcl001_s2_stale`. |
| `dec_rcl001_s2_review` | decision `accepted`, `needsReview` because it cites `find_rcl001_s2_stale` | "Use a checkout retry without an idempotency key." This stays `accepted`. It is not unquestioned intent. |

Provenance: the stale finding comes from agent `agt_rcl001_s2`, session `ses_rcl001_s2_a`, on behalf of human `hum_rcl001_s2`. The current finding comes from the same agent, session `ses_rcl001_s2_b`, on behalf of the same human. The decision and the open task come from human `hum_rcl001_s2` with no agent session.

Correct next action: do not repeat keyless checkout retry. Cite the current duplicate-charge finding, not the superseded timeout finding, as the current evidence. Report the decision as accepted and needing review. No replacement decision is accepted. Preserve that uncertainty; do not invent a new accepted rule.

## S3 — Insufficient history

Workspace `ws_rcl001_s3`. Goal `goal_rcl001_s3`, active: "Operate the partner callback."

| Id | Lifecycle | Role |
| --- | --- | --- |
| `task_rcl001_s3_open` | task `open` | "Confirm the partner callback limit." The limit is not in the title or description. |
| `find_rcl001_s3_current` | finding `current` | "The partner callback limit path responded in under two seconds." This is a timing sample, not an allowed rate. |
| `dec_rcl001_s3_proposed` | decision `proposed` | "Set the partner callback limit to one hundred requests per second." Not accepted. It cites nothing. |

Nothing in S3 is superseded, withdrawn, or `needsReview`. There is no accepted decision and no stale lifecycle. The current finding stays current and still does not answer the limit.

Provenance: the finding and the proposal come from agent `agt_rcl001_s3`, session `ses_rcl001_s3`, on behalf of human `hum_rcl001_s3`. The open task and the goal come from human `hum_rcl001_s3` with no agent session.

Correct next action: leave the limit unset. Preserve uncertainty. Do not treat two seconds as a rate, and do not promote the proposal into unquestioned intent.

## Packet recipients

Score the packet arm on goal, prior evidence, decision status, next action, and uncertainty, using the same lifecycle facts as the matching scenario above. A recipient who lacked the packet cannot pass. A recipient who adds a live workspace read is a different arm, not this one.
