# SWH-001 evidence — Shared Work Home

Evidence for contract `docs/Campfire-v1.17-SWH-001-Shared-Work-Home.md` §§6.1–6.3
and §9 steps 1–2. **FIXTURE EVIDENCE — calibrates UI and rubric; cannot
establish Gate B, C, or E.** The controlled scenario is synthetic; it is not
ordinary use and not gate evidence.

## Contents

| Path | What it is | Audience |
| --- | --- | --- |
| `BASELINE_V1_16.md` | Committed v1.16.0 source baseline (`db3a121…`), Viewer hashes + surface, and the two explicit records: shipped-Viewer comprehension trace NOT run; no reference-open attempt observed | Recorder / reviewer |
| `SCENARIO_KEY.md` | Frozen answer key for `swh-billing-deploy`: source position, actors, exact IDs, decision/finding/artifact facts, slice counts, per-participant attention, H1–H7 expected answers, frozen H7 safe next step | **Restricted** — never in participant or agent context |
| `PARTICIPANT_PACKET.md` | Neutral prompts and task instructions only | Participant |
| `SCORING_FORM.md` | Item-level scoring sheets (P1/P2), critical second review, D1–D7 matrix, pass rule | Recorder / second reviewer |
| `TRACE_RUNBOOK.md` | Verified seed, dump, two-viewer binding, whoami check, reset commands | Recorder |
| `REFERENCE_OBSERVATION.md` | VIS-001 condition 4 status page: what to record, redaction, current open status | Recorder |
| `served-state/` | Frozen `get_workspace_context` dumps (Dana, Rowan), `get_workspace` inspector, and `seed-log.txt` with commands, hashes, cursor, ids | Reviewer |
| `../../../fixtures/swh-001/` | Deterministic `seed.ts` + `dump.ts`; outputs live under gitignored `.tmp/` | Implementer |

The scenario fixture (`fixtures/swh-001/`) and this directory were frozen before
candidate testing per contract §6.1. If the served ground truth is wrong or
missing an item, repair or replace it **before** a scored trace and record the
change; never alter the key to fit candidate output after a participant begins.

## Consent and minimization plan (contract §6.3)

For real participants:

- **Retained:** the participants' answers, source IDs, sanitized UI state, the
  visible workspace source position, session times, hints, and the access
  outcome needed to audit the claim.
- **Never retained here:** raw agent prompts or responses, terminal transcripts,
  tokens or credentials (including their token files), external artifact
  contents, customer secrets, or another workspace's records.
- The two human tokens exist only in the gitignored
  `fixtures/swh-001/.tmp/*/tokens.json` (mode 0600) while a trace runs; no
  committed file in this directory contains a token value or hash. No
  credential-shaped token string (`cft_` followed by 16+ hex chars) exists in
  `served-state/`; the only occurrence of the 4-character substring `cft_`
  there is the warning in `seed-log.txt` that no token value, token hash, or
  `cft_` string appears in the directory.
- A participant's refusal to record is respected and yields **no scored
  observation**; no partial record is kept over their objection.
- The controlled trace requires two distinct humans; each uses their own
  actor-bound loopback Viewer, never a shared listener or a teammate's token.

## What this evidence cannot establish

- Not Gate B (voluntary repeat use), Gate C (ordinary multi-participant value),
  or Gate E (historical next-action benefit); those require ordinary-work
  evidence under their own protocols.
- Not the overdue v1.16 shipped-Viewer comprehension result, and not VIS-001
  condition 4; see `BASELINE_V1_16.md` and `REFERENCE_OBSERVATION.md`.
- Not a causal improvement over v1.16; the controlled result measures
  comprehension of this one scenario only.
