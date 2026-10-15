# WCO-001 — Continue the Work: evidence index

Sprint contract: `docs/Campfire-v1.18-WCO-001-Continue-the-Work.md`
Result record: `docs/SPRINT_WCO_001_RESULT.md`

**Evidence class:** this directory mixes a **baseline record**, a **labeled
rehearsal** (zero C1–C7 observations), and the frozen materials prepared for a
future two-human case. No two-human/two-harness case has been run; nothing here
scores C1–C7.

| File | Purpose | Class |
| --- | --- | --- |
| `README.md` | This index, consent/minimization plan, and what the evidence cannot establish | — |
| `BASELINE_V1_17.md` | Exact shipped v1.17.0 source, surfaces, and behavior used for the first continuation attempt; explicit not-observed record for the human case | Baseline |
| `REHEARSAL.md` | Single-operator, single-harness-labeled rehearsal on one machine: what ran, what is confounded, and the two witnessed frictions that led to the dated contract amendment | Rehearsal only — contains zero sprint observations |
| `TRACE_RUNBOOK.md` | Turnkey steps to run the eligible two-human/two-harness case later | Prepared materials |
| `SCORING_FORM.md` | Frozen C1–C7 scoring sheet with the second-review table | Prepared materials |
| `served-state/pre-b-agent-b-context.json` | Frozen orientation as Agent B saw it before its first action (the frozen source position) | Sanitized capture |
| `served-state/post-b-agent-a-context.json` | Orientation as Agent A saw it after B's contribution | Sanitized capture |
| `served-state/catchup-post-b-as-a.json` | Catch-up delta from A's prior cursor covering B's contribution | Sanitized capture |

## Consent and minimization

- All participants in the rehearsal are the single repository operator and two
  subagent sessions the operator instantiated. The operator consented to the
  record. No third-party participant data exists.
- Retained: actor ids, record ids, statuses, timestamps, contribution sequence,
  participants' own summary statements about their actions, and the sanitized
  served-state captures.
- Never retained in committed evidence: actor tokens or hashes, invitation
  secrets, raw prompts or private messages, tool arguments, terminal
  transcripts, or inaccessible artifact contents. Trace databases, token files,
  and the wrapper live under the gitignored `.campfire/traces/wco-001/`.

## What this evidence cannot establish

- No C1–C7 item is scored. The rehearsal is disqualified as a case by contract
  §6.1 ("A single operator impersonating two humans, two subagents ... is a
  rehearsal only").
- It does not establish Gate B, Gate C, or Gate E, does not close VIS-001
  condition 4, and does not claim ordinary team value.
- A deterministic test pass under §7 establishes the stated engineering
  property on the tested inputs only.
