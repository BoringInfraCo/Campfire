# ARH-001 evidence plan — sanitized retention for the ordinary-work reference handoff

**FIXTURE EVIDENCE in this directory is engineering-only; it can never establish ordinary use or external access.**
This plan itself is recorder/reviewer material and was frozen with the other ARH-001 materials before any product change. It governs what may be retained in `docs/evidence/arh-001/` (and in any later public export of the sprint result).

Sprint: ARH-001 — Artifact Reference Handoff (proposed v1.21 contract; no implementation, score, verdict, or release decision is recorded).
Contract: `docs/Campfire-v1.21-ARH-001-Artifact-Reference-Handoff.md` §3.2 (ordinary-work attempt), §4 (authorization and evidence handling), §6 (H1–H6), §7 (verdicts), §8.1.
Fixture: `fixtures/artifact-handoff/arh-001/`. Baseline capture: `baseline/` (recorded by the baseline pass).

## 1. Scope and principles

- Two observations can produce evidence for ARH-001: the **§3.2 ordinary-work reference-open attempt** (one real human) and the **§6 two-human/two-harness handoff** (two distinct humans, two different agent harnesses). Both use **real work and real external outputs**. The deterministic fixture is rehearsal and calibration material only: a fixture-only run with participants is a **rehearsal, not an eligible observation** (contract §3.2, §6).
- The workspace record belongs to Campfire; the file, report, PR, or deployment belongs to the external system. Campfire authorizes reading the **Artifact record**; the external system independently authorizes **opening the target**. Workspace membership must never be described as an external access grant, and a failed external open is never converted into a successful Campfire read (contract §4).
- One case supports only its participants, its workspace, its reference, and its target system. It does not establish a causal gain over v1.20.1 without a matched comparison (contract §6).
- An actual attempt on a real accessible artifact may later be reviewed against **VIS-001 condition 4** — but that decision is recorded in the VIS-001 result under VIS-001's own rule. **ARH-001 never declares VIS-001 condition 4 met**, and nothing in this directory scores it on VIS-001's behalf.

## 2. What is retained (contract §4)

Only the minimum needed to audit a claim:

| Retained | Detail |
| --- | --- |
| Source IDs | Campfire record IDs (workspace, task, artifact, finding, evidence row, decision, citation) at the frozen source position; the real attempt's own workspace/source position |
| Timestamps | Attempt start/end, first-read time, attempted-open time, score time (UTC) |
| Access outcomes | The external outcome as observed: opened / denied / stale / unavailable, with the visible reason; denied attempts preserved as denied |
| Verbatim participant interpretation | The participant's own words, sanitized of secrets; never a paraphrase substituted for the first interpretation |
| Minimum sanitized external work-product reference | The least external detail needed to audit the claim — e.g., the stored reference after redacting credentials and sensitive query strings, the target-system class/name, and the external outcome; never the external contents |
| Read path | The participant's first Campfire read and the records inspected, in order, up to and including the path taken to the reference |
| Hints and manual help | Every hint or manual help given, when, by whom, and what it supplied |
| Capture context | Capture times, surfaces used, attempt id, classification per §3.2 |
| Consent record | The participant's consent or decline for capture, and any withdrawal |

## 3. What is never retained (contract §4)

- Raw prompts, raw session transcripts (human or agent), private messages.
- External contents — never fetch or store the target's bytes to "prove" an attempt.
- Tokens, token hashes, invitation secrets, signed URLs, credentials (including demo credentials in stored references), sensitive query strings.
- Customer data, other-workspace records, and the contents of artifacts a workspace cannot access.
- Terminal transcripts and screenshots containing any of the above.

Fixture outputs (`fixtures/artifact-handoff/arh-001/.tmp/`) stay gitignored; only sanitized copies are ever committed. A committed evidence file is copied from a run, never regenerated in place.

## 4. Consent, decline, and withdrawal

- A participant can **decline capture**, at any time, including after the session. The recorder logs only the fact of missing evidence and why; no partial record is kept over the participant's objection.
- **Consent is not inferred from Campfire workspace membership.** Membership makes the read authorized; it does not make the person a consenting research participant.
- A declined or withdrawn session yields **no scored observation** (the affected items are NOT OBSERVED) and does not block the sprint from recording NOT OBSERVED with a reason.
- The participant may review and veto their quoted words before they are committed.

## 5. Authorization and boundary handling (contract §4)

- **Wrong-workspace IDs, non-participants, and unauthorized actors must not learn the title, URI/path, host, relation, counts, or access result** through a response, an error, or UI state. Authorization precedes projection.
- No new action is exposed until these denials are tested on the surface that would carry it (see the D1 row of `SCORING_FORM.md`; the fixture's `denials.json` calibrates the cases).
- The Viewer remains actor-bound, read-only, and token-free. No browser-held bearer token, server-side URL fetch, redirect endpoint, or external target content is added to the workspace.
- A denied external attempt is preserved as denied; **do not silently substitute a different link** and do not let Campfire proxy around the external system's decision.
- The two participants in §6 each use their **own** identity, credentials, and tools. Never share one listener or hand a teammate's token to another participant.

## 6. The unscored rule (contract §4)

If the access result **cannot be evidenced safely** — for example, auditing the claim would require retaining external contents, credentials, or customer data — mark the affected attempt **unscored** instead of retaining unsafe material. Record the reason. An unscored attempt is not a PASS and not a FAIL; it is missing evidence, and missing evidence is never a PASS.

## 7. The recorder's per-attempt ledger

One ledger per attempt (a denied attempt is its own attempt with its own row). Fields are frozen; fill each one or mark it "not observed — reason".

```markdown
| Field | Entry |
| --- | --- |
| Attempt id / date | |
| Participant role disclosure (founder or not; whether the work was prompted for evaluation) | |
| Recorder | |
| Workspace / source position | |
| Target system | |
| Preflight access expectation + how verified | |
| Recipient's first Campfire read | |
| Path to reference | |
| Attempted open | |
| External outcome (opened / denied / stale / unavailable) | |
| Manual help | |
| Verbatim interpretation (participant's own words, sanitized) | |
| Dependent work | |
| Classification per §3.2 table | |
| VIS-001 attribution note | |
| Second reviewer + disagreements | |
```

Field guidance:

- **Workspace / source position** — the authorized workspace id and the exact served position (e.g., orientation cursor / record ids) used for the observation; for a §3.2 attempt, the workspace records and the external system's identity.
- **Preflight access expectation + how verified** — written before the recipient starts: whether they should have external access, verified by the recorder's own means. Never show the recipient the answer, and never open the target for them.
- **Recipient's first Campfire read** — the first record or surface they read, verbatim from the session log/observation.
- **Path to reference** — how they moved from the recorded work to the stored reference (records inspected, in order).
- **Attempted open** — what action they took, on which surface (editor, browser, terminal, etc.).
- **External outcome** — the target system's own answer. Not Campfire's.
- **Verbatim interpretation** — their own words at first interpretation, before any hint or debrief.
- **Dependent work** — the checkable next step taken, or the specific safe block recorded.
- **VIS-001 attribution note** — state explicitly that the decision to review this attempt against VIS-001 condition 4 happens under VIS-001's own rule and record; ARH-001 does not declare it.
- **Second reviewer + disagreements** — name, date, and every disagreement with both readings retained.

## 8. Custody and sanitization

- Raw session material (tokens, raw dumps, private captures) stays in gitignored `.tmp/` or operator-held storage only while an attempt runs; it never enters a committed file.
- Before any evidence is committed, run the sanitization checklist in `TRACE_RUNBOOK.md` §5 (tokens, `cft_` strings, absolute home paths, the unrelated sentinel `UNRELATED_FINDING_SENTINEL_arh001_do_not_leak`, unrelated-workspace content, external contents, credentials, query strings).
- If in doubt about a capture, leave it out and note the omission in the ledger.

---

**Provenance:** frozen with the ARH-001 materials on October 16, 2026; derived from contract §4 and §8.1. No observation is recorded yet. If the contract's handling rules change, this plan is amended with a date **before** any further attempt, never edited to fit a result.
