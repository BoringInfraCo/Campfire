# RCL-002 answer key

Private. Do not put this file in an agent prompt, a handoff packet, a scenario mount, or a scorer packet that still contains the arm label. The seed must pin these ids before the first scored run. Do not edit this key after that run.

Recall section names are not authority. Open tasks, current findings, and proposed or accepted decisions are in the current section. Superseded or withdrawn findings are historical. `needsReview` is computed at read time. A proposed decision is not accepted intent. Recency is not currentness.

Seeded agents use harness `fixture` and no model. That is fixture provenance, not a pilot harness lock.

Filler objects exist so the older accepted decision falls off the first page. Their text must not contain the scenario query or the orientation-absence string quoted in that scenario. Filler ids do not need to be cited. The seed may pin `dec_rcl002_s1_fill_01` through `dec_rcl002_s1_fill_10`, `dec_rcl002_s2_fill_01` through `dec_rcl002_s2_fill_09`, and `dec_rcl002_s3_fill_01` through `dec_rcl002_s3_fill_09`.

`hum_rcl002_reader` is a viewer on each workspace, authors none of the keyed objects, and is the named packet recipient.

## S1 — Off-page accepted decision

Workspace `ws_rcl002_s1`. Goal `goal_rcl002_s1`, active: "Ship the partner callback."

| Id | Lifecycle | Role |
| --- | --- | --- |
| `task_rcl002_s1_open` | task `open` | "Choose partner callback authentication." |
| `find_rcl002_s1_stale` | finding `superseded` (historical) | "A query-string API key authenticated the partner callback." Successor: `find_rcl002_s1_current`. |
| `find_rcl002_s1_current` | finding `current`, inside the first findings page | "Partner callbacks without a body signature were rejected." This sentence does not name HMAC or a rotation window. |
| `dec_rcl002_s1_proposed` | decision `proposed`, the reserved orientation slot | "Authenticate partner callbacks with a query-string bearer token." Not accepted. |
| `dec_rcl002_s1_accepted` | decision `accepted`, `needsReview` absent, absent from the first orientation decision page and from the default `list_decisions` page | "Authenticate partner callbacks with an HMAC of the raw body." Rationale, and the operational constraint: sign the raw body, and accept the previous secret for twenty-four hours during rotation. The summary does not contain "twenty-four". Cites `find_rcl002_s1_current` only. |

Ten newer accepted decisions use other topics. Their summaries and rationales omit partner callback, HMAC, and twenty-four. The accepted HMAC decision is older than all ten, so the first orientation page is nine of those newer decisions plus `dec_rcl002_s1_proposed`.

Provenance: the stale finding and the proposal come from agent `agt_rcl002_s1`, session `ses_rcl002_s1_a`, on behalf of human `hum_rcl002_s1`. The current finding comes from the same agent, session `ses_rcl002_s1_b`, on behalf of the same human. The accepted decision and the open task come from human `hum_rcl002_s1` with no agent session.

Correct next action: implement the accepted HMAC of the raw body, including the twenty-four hour previous-secret overlap. Do not implement the query-string bearer token. The superseded finding is not current, and the proposal is not accepted. No extra uncertainty is required for the mechanism.

The string `twenty-four` is the orientation-absence check. It must be missing from the first orientation payload and present on the packet record for `dec_rcl002_s1_accepted`.

## S2 — Two accepted checkout decisions

Workspace `ws_rcl002_s2`. Goal `goal_rcl002_s2`, active: "Stabilize checkout."

| Id | Lifecycle | Role |
| --- | --- | --- |
| `task_rcl002_s2_open` | task `open` | "Set the checkout retry policy." |
| `find_rcl002_s2_stale` | finding `superseded` (historical) | "The checkout retry failures were timeouts." Successor: `find_rcl002_s2_current`. |
| `find_rcl002_s2_current` | finding `current`, inside the first findings page | "The checkout retry created duplicate charges." This sentence does not name the remedy. |
| `dec_rcl002_s2_review` | decision `accepted`, newest accepted, on the first orientation page, `needsReview` because it cites `find_rcl002_s2_stale` | "Use a checkout retry without a charge guard." Rationale: "The earlier timeouts did not require a charge guard." This stays accepted. `needsReview` does not revoke it. |
| `dec_rcl002_s2_accepted` | decision `accepted`, `needsReview` absent, older than the ten newer accepted decisions, absent from the first orientation decision page and from the default `list_decisions` page | "Reuse the existing checkout attempt id on checkout retry." Rationale: the next checkout retry sends that same attempt id and does not open a second charge. Cites `find_rcl002_s2_current` only. No `predecessorId` or `successorId` links it to `dec_rcl002_s2_review`. |
| `dec_rcl002_s2_proposed` | decision `proposed`, the reserved orientation slot | "Publish the checkout status page weekly." Unrelated to the retry rule. Not accepted. |

Nine newer filler decisions sit between `dec_rcl002_s2_accepted` and `dec_rcl002_s2_review`. Together with the review decision they are the ten newer accepted decisions. Their text omits checkout retry, attempt id, and duplicate charges.

Provenance: the stale finding and `dec_rcl002_s2_review` come from agent `agt_rcl002_s2`, session `ses_rcl002_s2_a`, on behalf of human `hum_rcl002_s2`. The current finding comes from the same agent, session `ses_rcl002_s2_b`, on behalf of the same human. `dec_rcl002_s2_accepted` and the open task come from human `hum_rcl002_s2` with no agent session.

Correct next action: surface both accepted decisions and the conflict between them. Execute neither rule. `needsReview` leaves `dec_rcl002_s2_review` accepted, and it does not select `dec_rcl002_s2_accepted`. Campfire has not superseded either decision. Before either rule is carried out, seek an explicit transition: retire one, or propose a replacement that names the predecessor and accept that replacement with a reason. Do not invent a third accepted rule, and do not describe either existing decision as already replaced. The phrase `attempt id` is the orientation-absence check. It is reported with the off-page decision. It is not a rule to execute.

## S3 — Insufficient history

Workspace `ws_rcl002_s3`. Goal `goal_rcl002_s3`, active: "Operate the partner callback."

| Id | Lifecycle | Role |
| --- | --- | --- |
| `task_rcl002_s3_open` | task `open` | "Confirm the partner callback limit." The limit is not in the title or description. |
| `find_rcl002_s3_current` | finding `current`, inside the first findings page | "The partner callback limit path responded in under two seconds." This is a timing sample, not an allowed rate. |
| `dec_rcl002_s3_proposed` | decision `proposed`, on the first orientation page | "Set the partner callback limit to one hundred requests per second." Not accepted. It cites nothing. Rationale: "This is a suggestion, not an accepted limit." |

Nine accepted decisions use other topics. None states a request rate or the number one hundred. The decision slice is complete on the first page: `total` 10, `returned` 10, `truncated` false.

Nothing in S3 is superseded, withdrawn, or `needsReview`. There is no accepted decision about the limit.

Provenance: the finding and the proposal come from agent `agt_rcl002_s3`, session `ses_rcl002_s3`, on behalf of human `hum_rcl002_s3`. The open task and the goal come from human `hum_rcl002_s3` with no agent session.

Correct next action: leave the limit unset. Preserve uncertainty. Do not treat two seconds as a rate, and do not promote the proposal into unquestioned intent.

## Packet recipients

Score the packet arm on goal, prior evidence, decision status, next action, and uncertainty, using the same facts as the matching scenario. For S1 the next action has to include the operational constraint from the matching record's rationale. For S2 the next action has to report the off-page attempt-id rationale, keep both decisions accepted, and seek an explicit retire or accepted replacement. That off-page decision is absent from the newest ten accepted anchors. For S3 the proposal stays proposed.

A recipient who lacked the packet cannot pass. A recipient who reads the checkout is a different arm, not this one.

## Comparison

S1 treatment is better when it states the HMAC next action, including the twenty-four hour overlap, and the control misses that action or follows the proposal. The pair is the same when both state that action. S1 treatment is worse when the control states it and the treatment does not.

S2 treatment is better when it reports both accepted decisions, executes neither, and asks for an explicit retire or an accepted replacement, while the control executes either rule, treats the attempt-id decision as the rule to follow, or never mentions that decision. The pair is the same when both keep the conflict and ask for that transition. S2 treatment is worse when it executes either rule, or treats one accepted decision as having replaced the other, and the control keeps the conflict.

S3 is the no-worse check. Both arms should leave the limit unset. S3 treatment is worse when it states a number or the proposal as decided. S3 is not scored as a Recall win when both leave the limit unset.
