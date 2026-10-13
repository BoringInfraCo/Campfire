# Gate E observation log

- **Protocol:** `docs/GATE_E_PROTOCOL.md`, version `gate-e-1`.
- **Status:** **Zero observations.** No case has been opened, no candidate case has
  been enumerated, and no qualifying case exists. **Gate E is unmeasured.**
- **Log opened:** October 12, 2026, in the commit that adds this directory. This
  log is the storage layer §9 requires; it records nothing.
- **Last updated:** October 12, 2026.

This log lists every case ever opened under `gate-e-1`, with its verdict,
including the cases that did not qualify, the cases that were withdrawn, and the
cases that produced nothing. It is append-only. A wrong row is corrected by
appending a dated correction, never by editing the row (§9).

Nothing in this log closes Gate E. Only a claim-N observation with an admissible
counterfactual basis does that (§1, §8), and no such observation exists.

## Pre-registered expectation (§8)

Recorded **October 12, 2026**, before any case was opened and before any candidate
case was enumerated.

- **Expectation, quoted from `docs/GATE_E_PROTOCOL.md` §8, "An expected null":**

  > The honest prediction of this protocol, read alongside RCL-001/002/003, is that
  > most ordinary-work cases will materialize as claim P or H and fail to produce an
  > admissible claim-N counterfactual. Recording that expectation before any case is
  > opened is itself part of the discipline.

- **Attribution.** The prediction is the protocol's, not this log's or an
  independently stated view of the repository owner. It was recorded in
  `docs/GATE_E_PROTOCOL.md` §8 at commit `4344e75` and is transcribed here
  unchanged because §8 calls for a dated expectation before any case exists.
  The recorder of this log entry adds nothing to it.
- **What the prediction rests on.** `docs/SPRINT_RCL_001_RESULT.md`,
  `docs/SPRINT_RCL_002_RESULT.md`, and `docs/SPRINT_RCL_003_RESULT.md`, all
  NO-GO / REFRAME, plus §4.2's stated expectation that a Basis 2 reconstruction
  will often support the same next action.
- **How it may be treated.** A claim-P or claim-H row, a `reported` item, or a
  Basis 2 reconstruction that agrees with the observed action is a **result** and
  is recorded as one (§4.4, §8). It is not a failed attempt and it is not evidence
  that Recall is harmful. The expectation being right is not a Gate E pass, and the
  expectation being wrong is not recorded by editing this section: it is recorded
  by appending a dated note under **Deviation from the pre-registered expectation**
  at the end of this file.

## Case enumeration register (§7.1)

Every candidate case is enumerated here, in a dated list, **before** any of them is
examined for qualification. A case that is examined for qualification before it is
enumerated is inadmissible under §7.1.

| Candidate | Enumerated (UTC) | Disposition | Note |
| --- | --- | --- | --- |

**Rows: zero.** No candidate case has been enumerated. The first enumeration entry
is the act that starts the count; writing it here after a case's outcome is known
does not satisfy §7.1.

## Every case ever opened

One row per case ever opened, qualifying or not. A case that was opened and then
withdrawn keeps its row and gains a withdrawal reason; it is never deleted (§7.9).

| Case | Observation id | Opened (UTC) | Closed (UTC) | Participant | Workspace | Claim shape | Counterfactual basis | Disposition | Verdict label | Counts toward Gate E | Outcome in one line | Record |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

**Rows: zero.** No observation has been opened under `gate-e-1`. No file matching
`gate-e-observation-*.md` exists in this directory.

Column meanings, in the order §6 and §1 use them:

- **Case** — sequence number in the enumeration register, assigned at open. The
  protocol does not number cases; this log numbers them so that a reader can point
  at one without ambiguity.
- **Observation id** — the `gate-e-<YYYYMMDD>-<nnn>` id from the observation file
  header. The file is `gate-e-observation-<YYYY-MM-DD>-<id>.md` (§9).
- **Opened / Closed (UTC)** — ISO-8601 timestamps. `Closed` is `—` while a case is
  still open.
- **Participant** — actor id and actor type; for an agent, the harness (A) or `—`
  for a human. Full identity lives in the observation file.
- **Workspace** — workspace id (B) or `—` for an H case whose reuse crossed a
  workspace boundary, which §5.3 says cannot materialize.
- **Claim shape** — `P`, `H`, `N`, or `—` for a case that was opened and did not
  qualify. The shape is fixed at open under §1 and is not chosen after the
  outcome.
- **Counterfactual basis** — `Basis 1`, `Basis 2`, `Basis 1 + Basis 2`, or `N/A`
  with a reason. P and H do not require a counterfactual (§6).
- **Disposition** — `admissible`, `inadmissible` with a stated reason, or
  `withdrawn` with a stated reason. A case that fails §3.1 before opening keeps
  its enumeration row and has no observation row.
- **Verdict label** — `supports`, `weak`, or `null` for an admissible case; `N/A`
  for an inadmissible or withdrawn one. §4.4's `reported` and `none` belong to
  individual items in the observation, not this column.
- **Counts toward Gate E** — always `no` for P/H and for any inadmissible or
  withdrawn case. `reported` and `none` are item labels, not case verdicts.
  `yes (one case only)` is available only for an admissible
  claim-N observation, and still establishes existence and nothing more (§7.11).
- **Outcome in one line** — plain, dated, no adjectives. "Reconstruction agreed
  with the observed action" is the expected shape of a null (§4.2).
- **Record** — relative path to the observation file, or `—` when the case opened
  and no file was written. That absence is itself a row, not a gap in the table.

## Rules for this log

1. **Enumerate, then open.** Append to the enumeration register before examining a
   candidate for qualification (§7.1).
2. **Open the file before the outcome is known.** A case is opened — row written,
   file created from `TEMPLATE.md`, plan-time fields dated — while the outcome is
   still unknown. An outcome already known to the recorder makes the case
   inadmissible (§3.2).
3. **Every case gets a row.** Qualifying, non-qualifying, ambiguous, null, and
   withdrawn alike (§7.1, §7.9, §7.14).
4. **The shape is not chosen later.** A case recorded as `P` cannot be relabelled
   `N` because a counterfactual turned up (§1).
5. **P and H never count.** They are honest facts about provenance and portable
   handoff. They are not partial credit against the gate (§1, §8).
6. **No retrofit.** No sprint result may absorb a row here. A sprint result may
   cite an observation by id and state that it exists (§9).
   `docs/SPRINT_RCL_001_RESULT.md`, `docs/SPRINT_RCL_002_RESULT.md`, and
   `docs/SPRINT_RCL_003_RESULT.md` are frozen (§11).
7. **Corrections are appended.** A wrong cell gets a dated correction appended
   beneath the table, naming the case and the cell (§9).
8. **One case, one attempt.** A workspace, participant, or case is not re-run as a
   second attempt (§7.9).

## Gate E status

**Gate E is unmeasured.** It has been unmeasured since
`docs/GATE_E_PROTOCOL.md` was recorded on October 12, 2026 and it is unmeasured at
the close of this log's first entry. Zero observations have been opened. Zero
claim-N observations exist. No inference in either direction is available: absence
of claim-N observations means the question is open, not that Recall is harmful
(§8).

This log changes no product behaviour, authorizes no release, and scores nothing.

## Appended entries

Newest last. Each entry is dated.

- **October 12, 2026.** Log opened with zero rows. Pre-registered expectation from
  `docs/GATE_E_PROTOCOL.md` §8 recorded above, before any case existed. Gate E
  unmeasured.

## Deviation from the pre-registered expectation

Empty. Append here, dated, if the observed cases diverge from the prediction
recorded above. Do not edit the prediction.
