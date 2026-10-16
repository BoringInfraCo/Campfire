# ATT-001 evidence — Trustworthy Team Attention

Sprint **ATT-001** — Trustworthy Team Attention (target `v1.19.0`, subject to a separate release decision).
Contract: `docs/Campfire-v1.19-ATT-001-Trustworthy-Team-Attention.md` (§4 frozen evaluation, §5 deterministic matrix D1–D6, §6 human observation rubric H1–H6).
Date: **October 15, 2026**.

**Status: materials frozen before implementation.** The v1.18.0 baseline captures are in `baseline/`; the participant packet, scoring form, and trace runbook in this directory were frozen with this index before any product change. **The controlled human trace is NOT OBSERVED as of this writing.**

**FIXTURE EVIDENCE — calibrates UI and rubric; cannot establish Gate B, C, E, or F; no human trace has been run.** The scenario is synthetic; it is not ordinary use and not gate evidence.

## Contents

| Path | What it is | Audience |
| --- | --- | --- |
| [`baseline/PIN.md`](baseline/PIN.md) | Exact v1.18.0 pin: source commit, package version, service response, Viewer static files, and test fixture used for comparison (contract §2) | Recorder / reviewer |
| [`baseline/GAP_PROBES.md`](baseline/GAP_PROBES.md) | Which contract §2 baseline gaps actually reproduce, with the sanitized response/text capture per case; a gap that does not reproduce triggers a dated contract amendment before any fix is built | Recorder / reviewer |
| `PARTICIPANT_PACKET.md` | Neutral prompts (one per H item), session rules, counterbalanced perspective order, and the recorder checklist | Participant |
| `SCORING_FORM.md` | Item-level H1–H6 sheets for P1/P2, safety second review (H3/H4/H5 plus any ambiguous pass), the D1–D6 matrix, and the verdict cover sheet | Recorder / second reviewer |
| `TRACE_RUNBOOK.md` | Turnkey seed → viewer → `whoami` → source position → session → score → reset steps, plus sanitization rules | Recorder |
| `SCENARIO_KEY.md` | The restricted frozen answer key, written by the sprint owner from the frozen fixture receipt; holds the exact keyed IDs and expected facts | **Restricted** — never in participant or agent context |

Related paths: `fixtures/attention/att-001/` (frozen `seed.ts`, `dump.ts`, `capture-viewer.ts`; all outputs under the gitignored `.tmp/`), `tests/integration/att-001.test.ts` (the focused deterministic suite cited by D1–D6), and `docs/SPRINT_ATT_001_RESULT.md` (the sprint result record that will cite this directory).

## Consent and minimization

For the two human participants:

- **Retained:** item-level answers in the participant's own words, cited source IDs, the read path (perspectives and records inspected, in order), sanitized UI captures and served-state text, session start/end times, perspective order, hints, and the candidate commit + fixture label needed to audit the claim.
- **Never retained:** raw agent prompts or responses, private messages, actor tokens or token hashes, invitation secrets, terminal transcripts, customer data, other-workspace records, and the contents of artifacts the workspace cannot access.
- Tokens exist only in the gitignored `fixtures/attention/att-001/.tmp/` directory (`tokens.json`, mode 0600) while a trace runs; no committed file in this directory contains a token value or hash.
- A participant's refusal or withdrawal is respected and yields **no scored observation**; no partial record is kept over their objection.
- The controlled trace requires two distinct humans; each uses their own actor-bound loopback Viewer — never a shared listener and never a teammate's token — and at least one participant did not build the candidate.

## What this evidence can and cannot establish

- **Can:** bounded comprehension of **one frozen case** by the observed participants only (H1–H6 as run and scored), plus deterministic behavior of the candidate on the frozen fixture (D1–D6).
- **Cannot:**
  - Not retention, not causal improvement over v1.18, and not general team demand or ordinary-work value.
  - No Gate B, C, E, or F movement; a passing trace does not close any gate.
  - Does not touch the open WCO-001 two-human case (still NOT OBSERVED) or the open SWH-001 observations (two-human trace, shipped-v1.16 trace, reference-open observation).
  - A deterministic D1–D6 pass is implementation evidence, not human understanding (contract §5).
- If two eligible humans are unavailable, the trace stays **NOT OBSERVED** with the recorded reason; agents and the builder are never substituted (contract §6).
