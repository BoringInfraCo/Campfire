# VIS-001 durable evidence

Sanitized primary evidence for the v1.12 VIS-001 entry gate, preserved in the
repository because the raw traces are gitignored, unbacked, and the temporary
probe Worker and D1 database that produced part of this evidence have been
deleted.

`docs/SPRINT_VIS_001_RESULT.md` is the gate record. This directory holds what it
cites.

## Why this exists

The gate decision rests on observations that were originally recorded only in
`.campfire/traces/harbor/`, which is gitignored and survives on one disk only.
`evidence/` is also gitignored, and `evidence/MANIFEST.json` records hashes of
files that are not themselves committed — a tripwire, not a copy. The remote
probe's Worker (`campfire-vis-001-probe`) and D1 database
(`campfire_vis001_probe`) were deleted after the runs were recorded, so those
traces cannot be regenerated. `docs/SPRINT_002_RESULT.md` §21 records the same
loss for the September 12 acceptance run.

## Contents

| File | What it is |
| --- | --- |
| `visit1-human-answers.md` | Condition 3. One real human participant's verbatim answers and the observed comprehension failures. |
| `visit2-agent-read.md` | Return read. **Agent-side, not a human return visit.** Corroborates the presentation defect; does not satisfy the human return half of the product trace. |
| `condition1-cold-agent-shared-instance.md` | Condition 1. Two cold harnesses against the remote Worker + D1 probe. |
| `probe-codex-answer.md` | Codex 0.150.1 final answer, verbatim. |
| `probe-opencode-answer.md` | OpenCode 1.18.34 final answer, verbatim. |
| `probe-codex-transcript.txt` | Codex prompt and harness trace. |
| `probe-opencode-transcript.txt` | OpenCode tool-call trace, including the two real `ParticipantRequired` denials. |
| `probe-prompt-codex.txt` | The exact prompt given to Codex. |
| `probe-prompt-opencode.txt` | The exact prompt given to OpenCode. |
| `serve-access-log-summary.md` | Verified tallies derived from the Viewer access log. Corrects a cycle count in the result doc. |
| `state-presented-visit1-context.json` | Raw `get_workspace_context` payload as served during visit 1. |
| `state-presented-grace.json` | `campfire status --output json` for `hum_grace` at visit 1. |
| `viewer-session-marker.txt` | Viewer session start marker. |

## Sanitization applied

- ANSI escape sequences stripped.
- Absolute local paths replaced with `<repo>` / `<home>`.
- **No credential is present.** Verified: zero `cft_` strings and zero
  `VAULT_SENTINEL` occurrences across every file here.
- Workspace content is fixture data from the Harbor gate workspace
  (`ws_e844657c1dcc4e5a`).

## Credential handling

`.campfire/traces/harbor/grace.token` held a `cft_` bearer token for fixture
human `hum_grace`. Resolved October 7, 2026:

- It hashes to `tok_e0adc974511c464d` (`hum_grace`, human) in the local trace
  database `harbor-trace.db`, created 2026-10-04T04:30:53Z, `revoked_at` null.
- Production D1 `campfire` was queried directly for that token hash:
  **0 matching rows**, and **0 total rows in `actor_tokens`**. The production
  database has no actor tokens at all, so this token never authorized anything
  in production.
- The probe D1 database was already deleted.
- The plaintext file was found in exactly one location repo-wide and has been
  **deleted**. The local token row is now revoked.

## What this evidence does not establish

- **Gate B (voluntary repeat use) and Gate C (ordinary multi-participant value)
  remain unmeasured.** One participant, one machine, one day, fixture identity.
- **Condition 4 remains open.** No participant attempted to open an artifact
  reference. See `SPRINT_VIS_001_RESULT.md` §4.
- **Section 3 security results are operator-attested.** The probe Worker and D1
  are gone and the transcripts here are what survives. They are the operator's
  own record of runs the operator performed; no independent party re-verified
  them.