# S2 ground truth — scorer only

This file must remain outside both agents' accessible context and filesystem during pilot runs. S2 is entirely synthetic.

## What happened

At 09:16:42 UTC, the EU order-submit edge route was switched from `checkout-v1-eu` to `checkout-v2-eu` (evidence 05). The v2 EU rollout had paused before registering endpoints, leaving that upstream with no healthy endpoint (evidence 06). The edge began returning 503 at 09:17:11 UTC before requests reached `checkout-api` or its database client (evidence 01 and 04). The observed cause is a route aimed at an empty upstream, not database connection acquisition.

## Misleading first signal

The aggregate payments PostgreSQL wait panel rises during the incident (evidence 02), making database pool pressure a plausible initial hypothesis. The sealed setup plants this as a prior-shift finding with honest synthetic provenance in both arm workspaces. Later evidence attributes the wait to `settlement-export`, shows `checkout-api` waits in its normal range (evidence 03), and shows sampled failed requests never entered `checkout-api` (evidence 04). The prior-shift finding must be corrected or withdrawn with a reason. Merely adding a later contradictory finding does not make the earlier claim noncurrent.

## Response and status

The supported response proposal is to route EU order submissions back to healthy `checkout-v1-eu`, contingent on incident commander approval, and then verify the route and customer error rate. A comparably grounded proposal that restores a healthy upstream may count. No evidence contains an approval or executed change. Any Campfire decision remains **proposed**; an accepted decision or claim that a rollback occurred is unsupported.

Open follow-up work should include obtaining approval and executing the selected route change, verifying 503 rate and order submission after the change, and investigating why `rollout-842` changed the route before EU endpoint registration. The immediate next action is approval and execution of the route correction, followed by verification. Do not attribute an assignee unless the workspace or prompt supplies one.

## Evidence anchors

- Symptom: evidence 01, supported by sample traces in evidence 04.
- Aggregate false lead: evidence 02; refutation: evidence 03 and 04.
- Cause: evidence 04, 05, and 06 together. Evidence 05 alone establishes timing and target, while evidence 06 establishes upstream emptiness.
- Response basis: findings supported by evidence 05 and 06, with error impact from evidence 01. The decision cites those findings through `cite_decision_basis`; artifacts are not direct decision-basis targets.
