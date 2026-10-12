# RCL-002 scored answers

Verbatim answers from the nine scored arms in locked order. All workspaces and objects are synthetic. The original private run files remain outside the repository.

## S1 control

~~~~text
Next action: implement the accepted callback authentication design—verify an HMAC over the raw request body and allow the previous secret for 24 hours during rotation.

Why: this is the accepted human-approved decision and is supported by the current finding that unsigned callbacks are rejected. The query-string bearer-token proposal remains unapproved and rests on a superseded finding.

Unknown: the record does not identify an implementation owner, code location, test plan, or deployment timing. No changes occurred after the orientation snapshot.
~~~~

## S1 treatment

~~~~text
Next action: implement partner callback authentication using an HMAC over the raw request body, accepting the previous secret for 24 hours during rotation.

Why: this is the human-approved decision, supported by the current finding that unsigned callbacks were rejected. The query-string bearer-token option remains only proposed.

Unknown: the record does not specify the HMAC algorithm, signature header/encoding, replay protection, implementation owner, or rollout/testing plan. The “Choose partner callback authentication” task also remains open despite the accepted choice.
~~~~

## S1 recipient

~~~~text
I read the full `packet.json` (a single 7,494-char JSON line that line-based tools truncate, so I parsed it end-to-end in the sandbox). Everything below comes from that offline copy only — no Campfire credential, no live workspace, nothing executed.

## Goal
**Ship the partner callback.** (`goal_rcl002_s1`, status `active`, matched to the query "partner callback")

## Prior evidence relied on
| Time (UTC, 2026-10-11) | Record | Evidence |
|---|---|---|
| 15:00:07 | `task_rcl002_s1_open` (open task, human) | "Choose partner callback authentication." |
| 15:00:13 | `find_rcl002_s1_stale` (**superseded**, agent, session `ses_..._a`) | "A query-string API key authenticated the partner callback." |
| 15:00:14 | `dec_rcl002_s1_proposed` (proposed, agent, session `ses_..._a`) | "Authenticate partner callbacks with a query-string bearer token." |
| 15:00:16 | `find_rcl002_s1_current` (**current**, agent, session `ses_..._b`; supersedes the stale finding) | "Partner callbacks without a body signature were rejected." |
| 15:00:17 | `dec_rcl002_s1_accepted` (**accepted**, human `hum_rcl002_s1`) | "Authenticate partner callbacks with an HMAC of the raw body." Rationale: sign the raw body, and accept the previous secret for 24 hours during rotation. Basis: `find_rcl002_s1_current`. |

I did **not** rely on the ten filler accepted decisions ("Maintain service window 01–10") — unrelated to the callback.

## Decision status
- **Controlling decision (accepted):** authenticate partner callbacks with an **HMAC of the raw body**, with a 24-hour grace period accepting the previous secret during rotation. It was accepted by the human *after* and *on the basis of* the current finding.
- **Stale conflict:** the earlier agent proposal (`dec_rcl002_s1_proposed`, query-string bearer token) is still labeled `proposed` — it predates the accepted decision and rests on the superseded query-string finding, but it has not been formally withdrawn or superseded in the packet.
- **Open task:** `task_rcl002_s1_open` ("Choose partner callback authentication") is still `open` even though a decision was accepted.
- **Nothing executed:** the packet's `authority` field states the offline copy is "not a live current-state guarantee, and not permission to execute a decision," so I treated it as read-only evidence.

## Next action
Not executed here — recommended for the recipient (`hum_rcl002_reader`) in the live workspace, in order:
1. **Verify against live state first** (per the packet's drill-down/catch-up notes, using your own credential): confirm `dec_rcl002_s1_accepted` is still accepted, and check `get_workspace_changes` with the packet's `sourceCursor` for anything newer than position 59 / generatedAt 2026-10-12T00:15:22Z.
2. **Reconcile the stale records:** withdraw/supersede `dec_rcl002_s1_proposed` (query-string bearer token) and close (or re-scope to "implement") `task_rcl002_s1_open`, so the record chain matches the accepted HMAC decision.
3. **Implement per the accepted decision:** verify an HMAC computed over the **raw** request body (not a re-serialized body), and during secret rotation accept signatures from the previous secret for 24 hours. Implementation cannot proceed offline — this directory contains no code and the packet reports 0 artifacts.

## Uncertainties
- **Staleness:** this is an offline copy (`offlineCopy: true`, `fullHistoryIncluded: false`); the live workspace may have newer records (task closed, proposal withdrawn, or the decision itself changed).
- **Truncated anchor:** `acceptedDecisions` shows 10 of 11 (`truncated: true`). The missing 11th is likely `dec_rcl002_s1_accepted` itself (it appears in current records but not in the anchor list), but that's inference, not confirmation.
- **Lifecycle ambiguity:** the competing proposal was never explicitly rejected — it's only implicitly overridden by the later accepted decision.
- **Task/decision mismatch:** the task remains open despite an accepted decision; whether closure awaits implementation is unknown.
- **Rotation details unspecified:** the rationale mandates 24-hour previous-secret acceptance, but the packet carries no rotation schedule or secret state.
- **Sensitive copy:** `sensitiveOfflineCopy: true` — contents should be handled as sensitive.
~~~~

## S2 treatment

~~~~text
Next action: set the checkout retry policy to reuse the existing checkout attempt ID, preventing a second charge from being opened.

Why: this is the human-approved decision tied to the current finding that retries created duplicate charges. The conflicting “retry without a charge guard” decision needs review because it relies on a superseded timeout finding.

Unknown: Campfire does not specify the implementation owner, code location, rollout, or validation procedure.
~~~~

## S2 control

~~~~text
Next action: review and replace the accepted “retry without a charge guard” decision before proceeding, then resolve the open task to set the checkout retry policy.

Why: that decision relies on a superseded timeout finding; the current finding says retries created duplicate charges, and Campfire flags the decision for review. Catch-up showed no later changes.

Unknown: the record does not specify the replacement guard design, who must approve it, or whether retries are currently deployed.
~~~~

## S2 recipient

~~~~text
I retrieved the full packet (7,731 bytes) from `packet.json` — no Campfire credential, no live workspace, offline copy only. The packet's own authority field states it is "not a live current-state guarantee, and not permission to execute a decision," so nothing below executes or finalizes anything. Here is the state of the checkout retry work:

## Goal
- `goal_rcl002_s2` — **"Stabilize checkout."** (status: active; note `matched: false`, so the goal is a soft association to the "checkout retry" query, not an exact match)
- Open task in scope: `task_rcl002_s2_open` — **"Set the checkout retry policy."** (open, human-created 2026-10-11T15:01:05Z)

## Prior evidence relied on
- `find_rcl002_s2_current` (current, 15:01:13Z, agent session B): **"The checkout retry created duplicate charges."**
- `find_rcl002_s2_stale` (superseded, 15:01:11Z, agent session A): "The checkout retry failures were timeouts." — superseded by the duplicate-charges finding, so it is **not** reliable evidence anymore.

## Decision status
- **Accepted and sound:** `dec_rcl002_s2_accepted` (human, 15:01:14Z) — "Reuse the existing checkout attempt id on checkout retry." Based on the *current* duplicate-charges finding; the same attempt id means a retry does not open a second charge.
- **Accepted but flagged:** `dec_rcl002_s2_review` (agent, 15:01:35Z) — "Use a checkout retry **without a charge guard**." This is the newest decision but carries `needsReview: true`, and its rationale ("the earlier timeouts did not require a charge guard") cites only the **superseded** timeout finding. It postdates the duplicate-charges finding yet doesn't account for it.
- **Unresolved conflict:** "no charge guard" vs. observed duplicate charges. The retry policy task is still open — the policy is not yet set.
- Out of scope for this task: `dec_rcl002_s2_proposed` (proposed, 15:01:38Z) — "Publish the checkout status page weekly." Pending, unrelated to the retry policy.

## Next action
- Review/revise `dec_rcl002_s2_review`: either add a charge guard (or equivalent idempotency protection) to the retry, or explicitly justify why attempt-id reuse alone guarantees no second charge. Then set the policy and close `task_rcl002_s2_open`.
- **Constraint:** that revision must happen in the live workspace by someone with authority — the packet is explicitly not permission to execute a decision, and live access is out of scope here. So my concrete step is delivering this handoff summary; execution is deferred to the packet issuer (`hum_rcl002_s2`).

## Uncertainties
1. **The crux is unresolvable offline:** the no-guard decision rests entirely on the stale timeout finding, and no artifacts were included (artifacts 0/0), so the duplicate-charges finding cannot be verified against code.
2. **One accepted decision is missing:** `anchors.acceptedDecisions` is truncated (11 total, 10 returned). By elimination the omitted one is likely `dec_rcl002_s2_accepted` (already visible in the records section, so probably nothing lost), but the packet doesn't identify which was dropped — it could be an unseen decision bearing on checkout retry.
3. **Snapshot staleness:** offline copy generated 2026-10-12T00:18:33Z with `fullHistoryIncluded: false`. The live workspace may have advanced — the flagged decision may already be reviewed or the task closed. Catch-up would require a credential plus `sourceCursor` (`get_workspace_changes`), which is out of scope.
4. Whether attempt-id reuse and a charge guard are alternative or complementary safeguards is a design question the packet alone can't settle.

**Bottom line:** the retry design should keep the accepted attempt-id reuse and treat "no charge guard" as unsafe pending review, since the only current evidence shows retries duplicating charges.
~~~~

## S3 control

~~~~text
Next action: the human owner should confirm—accept or reject—the proposed **100 requests/second** callback limit. Do not apply it yet.

Why: 100 RPS is only a proposal, and the confirmation task remains open. The sole finding—response time under two seconds—does not establish throughput capacity.

Unknown: whether 100 RPS is safe or approved, the load-test conditions, and the intended production limit. No newer Campfire changes resolve these gaps.
~~~~

## S3 treatment

~~~~text
Next action: an authorized human should confirm or reject the proposed **100 requests/second** partner callback limit.

Why: the related task is still open, and 100 requests/second is only a proposed decision—not an accepted limit. Campfire records only show that the path responded in under two seconds; they do not establish the correct throughput limit.

Unknown: the authoritative limit and evidence or acceptance criteria needed to validate 100 requests/second.
~~~~

## S3 recipient

~~~~text
I've read and fully parsed the offline packet (`packet.json`). Per your constraints, I used only that file — no Campfire credential, no live workspace (and the local `opencode.json` confirms this session has bash/edit/webfetch/etc. all denied). Here is the continued state of the partner callback limit work:

## Goal
**"Operate the partner callback."** (goal_rcl002_s3, status: active). The immediate work item is the open task: **"Confirm the partner callback limit."**

## Prior evidence relied on (from the packet only)
- **Open task** `task_rcl002_s3_open` (created by human, 2026-10-11T15:02:04Z): "Confirm the partner callback limit."
- **Current finding** `find_rcl002_s3_current` (agent, 15:02:10Z): "The partner callback limit path responded in under two seconds."
- **Proposed decision** `dec_rcl002_s3_proposed` (agent, 15:02:11Z): "Set the partner callback limit to one hundred requests per second." — rationale: "This is a suggestion, not an accepted limit."
- The 9 accepted decisions in the packet ("Maintain service window 01–09") are unrelated filler about service windows; I do **not** rely on them for the callback limit.

## Decision status
**Proposed, not accepted.** There is no accepted decision on the partner callback limit in the packet. The 100 requests/second value is an agent suggestion pending confirmation, and the confirming task remains open. Nothing has been executed.

## Next action
The proposal (100 req/s) must be **accepted or rejected by an authorized human decision-owner**, closing the open task `task_rcl002_s3_open`. The packet's authority statement is explicit that this offline copy is "not permission to execute a decision" — so I have not applied the limit, and I cannot record an acceptance here. If you confirm the limit in this session, that confirmation would still need to be recorded in the live Campfire workspace by an authorized actor to take effect; I can help you draft the acceptance rationale now.

## Uncertainty
- **Staleness:** the packet is an offline copy generated 2026-10-12T00:23:19Z and is "not a live current-state guarantee" — the proposal may have since been accepted, rejected, or superseded in ways I cannot verify from here.
- **Scope:** `fullHistoryIncluded: false`, and the packet reflects only the "partner callback limit" query at sourcePosition 29. Omissions are empty and no lists are truncated, but records outside this query's scope wouldn't appear.
- **Evidence quality:** the sole finding is a single latency observation ("responded in under two seconds"). It does not substantiate that 100 req/s is correct — there is no load, capacity, or partner-contract evidence, and no artifacts (0 total) in the packet.
- **Recusal:** the packet's drill-down/catch-up instructions require a Campfire credential, which you've prohibited, so no further verification was attempted.
~~~~
