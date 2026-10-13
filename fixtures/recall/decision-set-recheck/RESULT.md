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

## October 13 amendment — diagnostic run repeated

The diagnostic was accidentally run again after check 1 was rewritten. Its
`main()` removes the private output directory before each run, so the second run
replaced the October 12 `result.json`, `answer.txt`, `tool-calls.json`, and
`events.jsonl` at the local evidence path named above. The original run's full
private files are no longer retained there. The original account and its two
answer excerpts remain in this document, but its raw trace cannot now be
independently checked from that path. This loss is a limitation of the October
12 observation, not a reason to substitute the second run for it.

The replacement `result.json` records `ranAt: 2026-10-13T03:12:05.142Z`
(October 12 EDT), `unscored: true`, `isPilot: false`, and `verdict: null`.
It records OpenCode 2.0.26 with `opencode-go/glm-5.2#max`, a 13,844-byte packet,
four tool calls, a recorded packet read, zero Campfire MCP calls, zero checkout read
attempts, and zero successful checkout reads. The packet again placed the
superseded clause only in `records[]`, under its historical section. The revised
check 1 classified two references as `raised-and-rejected`, with `passBasis:
"substance"` and `requiresHumanRead: false`. The retained second answer names
the clause as superseded and rejects it as a current re-enable condition.

This was an unplanned second diagnostic on a re-created fixture, after the
first answer and classifier weakness were known. It is neither a fresh blind
case nor a repair of the lost original trace. The five check booleans are
diagnostic output, not a scored result; the classifier still has the documented
`not-raised` absence-of-signal blind spot. Neither run is a Gate E observation.
The RCL-003 verdict and the v1.16 hold remain unchanged.
