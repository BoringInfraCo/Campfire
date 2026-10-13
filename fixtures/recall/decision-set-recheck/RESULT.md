# Decision-set recipient recheck — unscored result

- **Run:** October 13, 2026 at 02:09:44 UTC (October 12 EDT).
- **Harness:** OpenCode 2.0.26, `opencode-go/glm-5.2#max`.
- **Status:** unscored diagnostic; `isPilot: false`; `verdict: null`.
- **Evidence source:** local private `decision-set-recheck/result.json`,
  `answer.txt`, `tool-calls.json`, and `events.jsonl` produced by `diagnose.ts`.
  Raw packet and harness event stream are not committed.

The recipient read the corrected 13,844-byte packet and produced an answer in
five tool calls. The packet's decision set was `linked-accepted-decisions`: one
current proposal, one historical superseded decision without rationale, and one
current accepted replacement. The superseded precondition occurred only in
`records[]`, under `section: "historical"`, not in `decisionSet` or anchors.

The answer named the accepted replacement as the operative rule, kept the
proposed decision unaccepted, and requested no further transition. It also
noticed and rejected the superseded condition. Two decisive excerpts from the
retained answer:

> Its rationale (including any condition about waiting for clean on-request
> releases) describes the *former* rule and is explicitly not a current condition.

> the old 02:00-nightly rule and its escalation-wait condition carry no current
> weight.

Isolation preflight checked 19 deny rules with 26 actual denial probes, including
reads through the Git object store. The run reported zero Campfire MCP calls,
zero checkout read attempts, and zero successful checkout reads.

**Check limitation:** all five automated checks returned `pass: true`, but
check 1's marker list did not match the answer's paraphrase. Its generated
detail, “the answer never mentions the superseded precondition,” is false.
The substantive finding above comes from reading the answer, not from that
check's pass bit. The check is left as run; changing it after seeing the answer
would not strengthen this observation.

This is one recipient run on a re-created S2-shaped fixture, not the original
RCL-003 S2 packet and not a matched before/after comparison. The corrected
packet also delivered `linkedNextStep`, which the scored offline path lacked.
The observation supports only that one recipient used this corrected packet
without promoting the historical rationale. It does not revise RCL-003's
NO-GO verdict, establish a success rate, close Gate E, or authorize v1.16.
