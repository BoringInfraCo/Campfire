# ARH-001 scoring form — §3.2 classification, H1–H6 item sheets, diagnostics, D1–D6 baseline matrix, verdict cover sheet

**FIXTURE EVIDENCE — cannot establish ordinary use or external access; no eligible attempt, candidate, or score has been recorded as of this writing.**

Recorder and second reviewer only. Never shown to participants; never shown to B before scoring. Score against the **pre-run frozen records** (for a real case) or the restricted `SCENARIO_KEY.md` (fixture calibration only) **before any debrief**. Each item is **PASS**, **FAIL**, or **NOT OBSERVED**; missing or unsafe-to-retain evidence is NOT OBSERVED, never PASS (contract §6). Never edit the frozen records, the key, or thresholds to fit a result.

## 1. How to score (frozen)

- Report every item and the participant's own words. A hint that supplies an expected answer means the affected item cannot be scored PASS; record the hint and its effect.
- A timeout, a refusal, or an unrecorded answer is NOT OBSERVED, not a pass.
- A fixture-only run with participants is a **rehearsal**: it scores nothing here (contract §3.2, §6).
- One successful case supports only these participants, this workspace, this reference, and this target system. It does not establish a causal gain over v1.20.1 without a matched comparison.
- A case whose reference was never expected to be available to B is an access-boundary observation, not an eligible full handoff: record H2 as **NOT OBSERVED** for the open-and-use claim and do not award GO. If access was expected but denied, **H2 is FAIL** even when B reports the denial accurately (contract §6).

## 2. §3.2 — ordinary-work reference-open attempt: observed-cause classification

Fill exactly one row from the observed attempt (contract §3.2 table, copied verbatim). A denied attempt is its own row with its own outcome.

| # | Observed cause | Sprint disposition | This attempt (mark one) | Evidence pointer (ledger / capture) |
| --- | --- | --- | --- | --- |
| 1 | Reference is reachable and correctly used with the shipped surfaces | Record a bounded successful baseline. Do not invent a v1.21 feature or version bump to fill a slot. | | |
| 2 | Reference exists and the actor has external access, but Campfire makes it hard to locate, distinguish, or deliberately open | A small inspect/open repair may be scoped under §3.3. | | |
| 3 | External system denies the recipient, target is stale, or owner did not share it there | Record the external access failure. Campfire may clarify that boundary, but must not proxy around it or claim its own membership grants external access. | | |
| 4 | Required relation, authority, or source fact is not recorded | Stop and record NO-GO / REFRAME. Do not manufacture a structured relationship from proximity, URL shape, or a model summary. | | |
| 5 | No eligible ordinary-work reference attempt occurs | Mark the observation NOT OBSERVED. Fixture preparation may continue; no product repair is justified by a fabricated attempt. | | |

| Field | Entry |
| --- | --- |
| Attempt id / date | |
| Participant (role disclosure: founder or not) | |
| External outcome (opened / denied / stale / unavailable / none observed) | |
| Was the reference expected to be available to the participant? (preflight) | |
| VIS-001 attribution note (decided under VIS-001's own rule if later reviewed; ARH-001 never declares condition 4 met) | |

## 3. §6 case header (fill before scoring)

| Field | Value |
| --- | --- |
| Attempt id / date | |
| Source commit under test | |
| Case type (unchanged baseline / post-repair) | |
| Human A / Agent A (harness) | |
| Human B / Agent B (harness) | |
| At least one human did not build the candidate | yes / no / n.a. (no candidate exists) |
| Founder a participant? (disclosed) | |
| Work prompted for evaluation? | |
| Workspace / frozen source position (recorded before B began) | |
| Reference and target system (sanitized) | |
| Preflight access expectation (should B have access?) + how verified | |
| Frozen at (UTC) / by | |
| Hints before B's first interpretation | none / recorded (detail in §4) |
| Anything supplied outside Campfire (confound) | |

## 4. H1–H6 item sheets

Critical marks below are copied from contract §6 exactly (H2–H4 are bold in the source contract).

### H1 — find the source (Critical: Yes)

> PASS requires: B locates the relevant Artifact by source ID through their own authorized Campfire read, distinguishes any similar or historical references that are present, and identifies the recorded Finding evidence relationship.

| Field | Fill |
| --- | --- |
| Human B evidence (verbatim, sanitized) | |
| Agent B evidence (verbatim, sanitized) | |
| Expected fact (from the pre-run frozen key) | |
| Verdict (PASS / FAIL / NOT OBSERVED) | |
| Reason | |

### H2 — reach with own authority (Critical: **Yes**)

> PASS requires: B attempts to open the actual target through their own external-system identity and reaches it when preflight says access should exist. A denial is reported truthfully, but is not an open-and-use pass.

| Field | Fill |
| --- | --- |
| Human B evidence (verbatim, sanitized) | |
| Agent B evidence (verbatim, sanitized) | |
| Preflight expectation vs actual external outcome | |
| Expected fact (from the pre-run frozen key) | |
| Verdict (PASS / FAIL / NOT OBSERVED) | |
| Reason | |

*Scoring note:* never expected to be available → NOT OBSERVED (no GO); expected and denied → FAIL even if reported truthfully.

### H3 — decision safety (Critical: **Yes**)

> PASS requires: B states the relevant Decision/Finding lifecycle and citations accurately, flags a conflict or `needsReview` when present, and does not promote a superseded rationale or choose an unrecorded operative winner. If none is recorded, B does not invent one.

| Field | Fill |
| --- | --- |
| Human B evidence (verbatim, sanitized) | |
| Agent B evidence (verbatim, sanitized) | |
| Expected fact (from the pre-run frozen key) | |
| Verdict (PASS / FAIL / NOT OBSERVED) | |
| Reason | |

### H4 — dependent next step (Critical: **Yes**)

> PASS requires: B takes a checkable action using the cited output, or records a specific safe block when access or decision state prevents action. Merely restating the output or copying its URL fails.

| Field | Fill |
| --- | --- |
| Human B evidence (verbatim, sanitized) | |
| Agent B evidence (verbatim, sanitized) | |
| Expected fact (from the pre-run frozen key) | |
| Verdict (PASS / FAIL / NOT OBSERVED) | |
| Reason | |

### H5 — durable handoff (Critical: Yes)

> PASS requires: B leaves the outcome in existing Task/Finding/Decision/Artifact state with B/Agent B provenance and enough source linkage or explanation for A to inspect without a private recap.

| Field | Fill |
| --- | --- |
| Human B evidence (verbatim, sanitized) | |
| Agent B evidence (verbatim, sanitized) | |
| Expected fact (from the pre-run frozen key) | |
| Verdict (PASS / FAIL / NOT OBSERVED) | |
| Reason | |

### H6 — return read (Critical: Yes)

> PASS requires: A or Agent A later reads B's contribution in a fresh process and takes a dependent action or correctly records why work remains blocked. Opening the workspace alone fails.

| Field | Fill |
| --- | --- |
| Reader (A / Agent A), fresh process, time (UTC) | |
| Evidence (what they read, what they did) | |
| Expected fact (from the pre-run frozen key) | |
| Verdict (PASS / FAIL / NOT OBSERVED) | |
| Reason | |

*Scoring note:* a later **voluntary** return is logged separately under Gate B rules (§5 diagnostics) and is never instructed; an instructed return does not count.

## 5. Diagnostics (contract §6 — no post-hoc threshold)

| Diagnostic | Record |
| --- | --- |
| Time to first correct source | |
| Time to safe action | |
| Wrong or conflicting answers | |
| Access failures | |
| Manual help | |
| Later voluntary return (logged separately under Gate B rules; never instructed) | |
| Other deviations from protocol | |

## 6. Second review — H2–H5 against the frozen key

Independently checks H2–H5 (and any ambiguous pass) against the pre-run frozen key and sanitized source state. Retain every disagreement with both readings; **resolve disagreements against the pre-run key** (contract §6).

| Item | First reviewer verdict | Second reviewer verdict | Disagreement? (both readings retained) | Resolved against the pre-run key | Second reviewer | Date |
| --- | --- | --- | --- | --- | --- | --- |
| H2 | | | | | | |
| H3 | | | | | | |
| H4 | | | | | | |
| H5 | | | | | | |
| *ambiguous pass (item: ___) | | | | | | |

## 7. D1–D6 matrix — baseline checks (no product change recorded)

**Phrasing rule for this sprint:** no product change is recorded as of this writing. Mark the applicable checks as **baseline facts** observed on the shipped v1.20.1 surface (from the frozen `baseline/` capture) — **not as candidate passes**. The fixture dumps and this matrix calibrate the checks; they are engineering evidence. A candidate column exists only after a dated §3.3 amendment authorizes a repair; then all applicable checks below become required on the candidate commit (contract §5).

| Check | Required result (contract §5, verbatim) | For this sprint (no product change) | Result / baseline fact (fill) | Evidence pointer |
| --- | --- | --- | --- | --- |
| **D1 — workspace authorization** | Authorized actors see the same workspace source facts; a non-participant or wrong-workspace ID reveals no Artifact or relation detail, including destination host and counts. Authorization precedes projection. | Baseline fact — record the shipped v1.20.1 denial behavior; the fixture `denials.json` calibrates the cases. Not a candidate pass. | | |
| **D2 — recorded chain** | Artifact ID/type/title/reference/provenance, Finding evidence relation, Decision citation and lifecycle match existing records. Missing links remain missing; historical and competing decisions are not promoted. | Baseline fact — record the actual served chain from the pin capture; missing links stay missing. Not a candidate pass. | | |
| **D3 — deliberate open** | Rendering, refresh, hover, and source inspection make no external request. Only an eligible deliberate action may navigate; unsupported schemes, local paths, credential-bearing references, and hostile markup remain inert. No server fetch or token propagation. | Baseline fact — record rendering inertia at rest (no fetch, no anchor, escaped text); a deliberate open is observable only in an eligible attempt. Not a candidate pass. | | |
| **D4 — external authority** | An external denial, stale link, redirect, or unavailable target is not reported as opened, verified, or accessible by Campfire. Campfire membership does not bypass the target system. | Baseline fact — record only the access caveat text; the external outcome can only come from a real attempt. Not a candidate pass. | | |
| **D5 — surface parity and accessibility** | Dashboard, Viewer, CLI JSON, and MCP agree on stored facts; the human surfaces state the access caveat while JSON/MCP keep their existing contracts. An action is keyboard accessible, clearly labeled without relying on color, and exposes its destination class before navigation. | Baseline fact — record parity and caveat wording from the pin capture; no new action exists to grade. Not a candidate pass. | | |
| **D6 — compatibility and bounds** | Existing Viewer methods remain five unless an amendment explicitly approves a reviewed read. Existing page budgets, status JSON, Recall/packet schemas, artifact writes, SQLite/D1 paths, installer, and public asset sync still work. No new polling, schema migration, or unbounded read is introduced by default. | Baseline fact — record page budgets, status JSON, the five Viewer read methods, and no polling/migration from the pin capture. Not a candidate pass. | | |

## 8. Verdict cover sheet (contract §7 — conditions copied verbatim)

- **GO — bounded artifact handoff:** A real post-change or unchanged-baseline case meets H1–H6, including a successful H2 on a genuinely accessible target; D1–D6 pass if code changed; no authorization or decision-safety defect remains; second review agrees or resolves against the frozen key. If the baseline already works, record GO for the observed case with **no v1.21 feature or release required**.
- **CONDITIONAL GO — engineering candidate:** A real baseline attempt identified a Campfire gap, an amendment-authorized repair passes D1–D6, and a post-repair two-human/two-harness case is unavailable for a recorded reason. Claim only the verified behavior of the repair. Do not claim a successful handoff or that external access is guaranteed.
- **UNSCORED:** No eligible ordinary-work attempt has occurred, or no candidate has been evaluated. Fixture tests and a builder walkthrough cannot turn this into a human result.
- **NO-GO / REFRAME:** Unauthorized reference exposure, unsafe automatic navigation/fetch, external credential leakage, false access claim, invented evidence relation, decision-status error, failure of H2–H4 in an eligible post-repair case, or a requirement for storage, proxying, a new sharing policy, or a broad connector blocks the bounded claim. Preserve the failure and scope a new attempt or separate decision; do not edit the frozen key to rescue a result.

| Field | Value |
| --- | --- |
| Attempt id(s) | |
| Source commit | |
| Eligibility (two humans / two harnesses / one authorized workspace; founder and prompt disclosures) | |
| §3.2 classification | |
| H1–H6 results (per item; separate Human B / Agent B evidence where relevant) | |
| H2 access expectation vs outcome | |
| D1–D6 record (baseline facts or candidate results) | |
| Second review (agreement / resolved against the pre-run key) | |
| Verdict (GO / CONDITIONAL GO — engineering candidate / UNSCORED / NO-GO — REFRAME) | |
| Recorded reason if a case was unavailable | |
| Deviations; key or threshold changes (dated; a repair requires a fresh attempt) | |
| Residual risks and open observations (VIS-001 condition 4; Gate B/C/E/F; other sprints' open cases) | |

**Release boundary:** a version bump, tag, public snapshot, installer pins, or deployment require a separate release decision after this result is recorded. A release override cannot turn NOT OBSERVED or FAIL into PASS and does not close Gate B, C, E, or F.
