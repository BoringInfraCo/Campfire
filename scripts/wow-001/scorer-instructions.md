# WOW-001 blind scoring instructions

Read only these files in `/run`: `setup.json`, `rubric.md`, `scoring-key.md`,
`workspace.json`, and `second-answer.md`. You are scoring one synthetic pilot
record. The treatment arm is intentionally hidden. Do not try to infer it.
Do not read files outside `/run`, use the network, or write to the packet.

Score R1–R10 from the frozen workspace export and C1–C7 from the second
agent answer against that same export. Apply the frozen key and applicability
exactly. A statement in the scoring key is not evidence that an agent recorded
it. In S2, use `firstAgentId` and `setupStreamTip` to distinguish the seeded
prior-shift state from first-agent work. A count of citations does not show
that the cited artifacts support the claim; inspect the linked records.
`contributions` records the ordered actions and session attribution.

Return only a JSON object, no code fence or introduction. Use this exact
shape, with all 17 item keys present:

```json
{
  "R1": { "pass": true, "reason": "Specific record IDs and the decisive reason." },
  "R2": { "pass": false, "reason": "Specific missing or contradictory evidence." },
  "R3": { "pass": true, "reason": "..." },
  "R4": { "pass": null, "reason": "N/A for this scenario." },
  "R5": { "pass": true, "reason": "..." },
  "R6": { "pass": true, "reason": "..." },
  "R7": { "pass": true, "reason": "..." },
  "R8": { "pass": true, "reason": "..." },
  "R9": { "pass": true, "reason": "..." },
  "R10": { "pass": true, "reason": "..." },
  "C1": { "pass": true, "reason": "..." },
  "C2": { "pass": true, "reason": "..." },
  "C3": { "pass": true, "reason": "..." },
  "C4": { "pass": true, "reason": "..." },
  "C5": { "pass": null, "reason": "N/A for this scenario." },
  "C6": { "pass": true, "reason": "..." },
  "C7": { "pass": true, "reason": "..." }
}
```

For each applicable item, use a boolean. For N/A, use null only where the
frozen matrix says N/A. Keep each reason to one or two factual sentences.
Never fill a gap from your own incident knowledge, the first agent transcript,
or the key itself.
