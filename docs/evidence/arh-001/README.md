# ARH-001 evidence — Artifact Reference Handoff

Sprint **ARH-001** — Artifact Reference Handoff (proposed `v1.21` contract; no implementation, score, verdict, version bump, or release decision is recorded).
Contract: `docs/Campfire-v1.21-ARH-001-Artifact-Reference-Handoff.md` (§3.1 baseline/fixture freeze, §3.2 ordinary-work attempt, §4 authorization and evidence handling, §5 D1–D6, §6 H1–H6, §7 verdicts).
Date: **October 16, 2026**.

**Status: materials frozen before any product change.**
- The v1.20.1 baseline capture is frozen in `baseline/` (recorded by the baseline pass; see the files inside).
- The deterministic fixture is frozen at `fixtures/artifact-handoff/arh-001/` (`seed.ts`, `dump.ts`, `README.md`; pinned ids and clock; verified byte-identical across two fresh seeds).
- **The ordinary-work reference-open attempt (§3.2) is NOT OBSERVED as of this writing.** Recorded reason: this has been an engineering session — no real participant attempt has been recorded, and agents, subagents, and synthetic fixtures do not qualify (contract §3.2: "A synthetic fixture, a fabricated URL, a scripted builder walkthrough, or an agent acting as the sole 'human' does not qualify"). The materials below exist so the attempt can be run and scored when a real participant and a real external output are available. *Dated update (2026-10-16, later UTC): a founder-directed execution under this procedure stopped at the recorder preflight — the live workspace held no eligible attempt subject (both open tasks are protocol exercises; no pending task depends on an externally stored output) — so no participant instruction was issued and nothing was opened; full addendum in `docs/SPRINT_ARH_001_RESULT.md` §5.*
- The two-human/two-harness handoff case (§6) is likewise **NOT OBSERVED**; it requires two distinct people and two different agent harnesses on real work.

**FIXTURE EVIDENCE — cannot establish ordinary use or external access.** The scenario is synthetic (`example.com` targets whose external state is never asserted); fixture runs with participants are rehearsals, not eligible observations, and cannot close VIS-001 condition 4 or move any gate.

## Contents

| Path | What it is | Audience |
| --- | --- | --- |
| [`baseline/`](baseline/) | Frozen v1.20.1 baseline capture (pin + served state) recorded by the baseline pass | Recorder / reviewer |
| [`EVIDENCE_PLAN.md`](EVIDENCE_PLAN.md) | Sanitized evidence plan (§4): what is retained, what is never retained, consent/decline, authorization handling, the unscored rule, and the per-attempt ledger format | Recorder / reviewer |
| [`PARTICIPANT_PACKET.md`](PARTICIPANT_PACKET.md) | Part A: §3.2 recorder instructions and checklist; Part B: the frozen §6 Human B / Agent B prompts and session rules (participant blocks contain no key facts) | Recorder; extracted prompt blocks for participants |
| [`SCENARIO_KEY.md`](SCENARIO_KEY.md) | The restricted frozen answer key transcribed from the fixture receipt (ids, served facts, chain, lifecycle, denials, inert classes, rehearsal limits) | **Restricted** — never in participant or agent context; never shown to B before scoring |
| [`SCORING_FORM.md`](SCORING_FORM.md) | §3.2 classification sheet; H1–H6 item sheets with critical flags; diagnostics; H2–H5 second review; D1–D6 baseline matrix; §7 verdict cover sheet | Recorder / second reviewer |
| [`TRACE_RUNBOOK.md`](TRACE_RUNBOOK.md) | Turnkey rehearsal commands and the eligible §3.2 / §6 real-work procedures; reset; sanitization checklist; prohibitions | Recorder |

Related paths: `fixtures/artifact-handoff/arh-001/` (frozen fixture; all outputs under its gitignored `.tmp/`), and the future `docs/SPRINT_ARH_001_RESULT.md` (the result record that will cite this directory).

## Consent and minimization

For any real participant (§3.2 participant or §6 Human B):

- **Retained:** source IDs, timestamps, access outcomes, the participant's verbatim interpretation, the minimum sanitized external work-product reference needed to audit a claim, the first Campfire read, the path to the reference, the attempted open, hints and manual help, and capture times (contract §4).
- **Never retained:** raw prompts, raw transcripts (human or agent), external contents, tokens, signed URLs, credentials, sensitive query strings, or customer data — and, in this directory, no other-workspace records or unrelated-workspace content.
- A participant can **decline capture** at any time; the recorder logs the missing evidence and no partial record is kept over their objection. **Consent is not inferred from Campfire workspace membership.**
- If the access result cannot be evidenced safely (auditing it would require retaining unsafe material), the attempt is marked **unscored** — never silently converted into a pass.
- The two §6 participants are distinct people on different harnesses; each uses their own actor-bound Viewer, credentials, and tools; at least one did not build the candidate.

## What this evidence can and cannot establish

- **Can (once run):** a bounded observation of **one workspace, one reference, and one target system** by the actual participants — the §3.2 failure classification, or the §6 H1–H6 item scores as run and second-reviewed. The fixture additionally calibrates the materials and the deterministic checks (D1–D6 on the shipped surface) as engineering evidence only.
- **Cannot:**
  - Fixture material cannot establish ordinary use or external access: the target URLs are synthetic and their external state is never asserted. A fixture-only run with participants is a rehearsal.
  - No **causal gain over v1.20.1** without a matched comparison.
  - No **Gate B, C, E, or F** movement; an observation may be considered under another gate only through that gate's separately applicable protocol and record.
  - **VIS-001 condition 4** is decided under VIS-001's own rule and result if an actual attempt is later reviewed against it; **ARH-001 never declares condition 4 met on its behalf**.
  - No general team demand, retention, or accessibility claim for "all referenced content"; one case supports only its participants, workspace, reference, and target system.
- If no eligible attempt occurs, the observation stays **NOT OBSERVED** with a recorded reason; agents, fixtures, rehearsals, and builder walkthroughs are never substituted (contract §3.2, §6).

## Verdict boundary

`SCORING_FORM.md` §8 lists the exact §7 verdicts (GO / CONDITIONAL GO / UNSCORED / NO-GO — REFRAME) and the conditions. A version bump, tag, public snapshot, installer pins, or deployment require a **separate release decision** after the result is recorded; an override cannot turn NOT OBSERVED or FAIL into PASS.
