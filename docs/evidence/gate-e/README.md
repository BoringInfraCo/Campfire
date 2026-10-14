# Gate E observation record

- **Protocol:** `docs/GATE_E_PROTOCOL.md`, version `gate-e-1`. This directory is
  the storage layer §9 of that protocol requires. It is not a second protocol and
  it does not interpret the first one.
- **Status:** **Zero observations.** `LOG.md` holds no cases. No
  `gate-e-observation-*.md` file exists here. **Gate E is unmeasured.**
- **Date:** October 12, 2026.
- **Package:** `1.15.0`. v1.16 stays held. Nothing here changes the product.

## What this directory is for

One place where ordinary-work observations of historical reuse are written down
in the shape §6 defines, so that a reviewer with no access to anyone's memory can
check them. It holds the log, the template, the handoff runbook, review records,
and — when a case is opened — observation files.

`docs/GATE_E_PROTOCOL.md` is the authority. If this directory and the protocol
ever disagree, the protocol wins and this directory is wrong.

## Contents

| File | What it is |
| --- | --- |
| `LOG.md` | Every case ever opened, with its verdict, including the cases that did not qualify. Currently zero rows. Carries the §8 pre-registered expectation. |
| `TEMPLATE.md` | The skeleton for `gate-e-observation-<YYYY-MM-DD>-<id>.md`, with every §6 field and its expected shape. A template is not an observation. |
| `HANDOFF-RUNBOOK.md` | The capture sequence and comparison rules for a real claim-H handoff. |
| `READINESS-AUDIT.md` | Dated audit against `0e0693d`; findings are a snapshot, not an observation. |
| `REHEARSAL.md` | Dated simulated run against `0e0693d`; its defects motivated later repairs and it is not an observation. |
| `RED-TEAM-REVIEW.md` | Adversarial review of the packet-evidence helper and observation apparatus. |

## What lives here

- One observation file per case, named `gate-e-observation-<YYYY-MM-DD>-<id>.md`
  (§9). The date is the open date. The id is assigned at open, before the outcome
  is known.
- Verbatim prompt text, verbatim counterfactual text, and verbatim next actions
  (§6, §7.2).
- Source ids, their kinds, and the surface each was reached through (§6).
- The materialized record's id, kind, typed relation rows, and note text, for P
  and N (§6, §5.1).
- For H, a sanitized account of the packet fields used, selected bounded source
  excerpts needed to check the recipient's substantive use, and a checkable
  reference to the recipient's resulting work (§9). The packet helper supplies
  structural fields only; text lengths are not evidence of meaning.
- Plan-time entries with the timestamps that make them plan-time (§4.2 Basis 1,
  §6, §7.8).
- Dated appends: log rows, withdrawals, corrections (§7.9, §9).

## What does not live here

- **Raw transcripts.** They stay outside the repository, as in the RCL evidence
  trees (§9). Retained verbatim prompt and next-action text is the exception, and
  it is what §6 and §7.2 require; a session transcript is not.
- **Credentials.** No `cft_` bearer string, no token, no local path, no
  authentication file, no database. As in `docs/evidence/rcl-003/README.md`.
- **Packet bytes.** Handoff packets are mode `0600` local files. Commit a
  sanitized account of the fields used, not the packet (§9).
- **Anything from `fixtures/**` or `docs/evidence/rcl-00*/`.** That is test
  material by construction and cannot be an ordinary-work observation (§3.2).
- **Private pilot material** from `~/.campfire-pilot/`. Hashes identify those
  streams; they do not copy them.
- **Rates, directions, mechanisms, or claims about people in general.** Those are
  not established by one case and are not written into a record (§4.1, §7.11).
- **Retrofit evidence.** An observation is never written into a sprint result as
  that sprint's evidence (§7.10, §9).

A reviewer without the private directory must still be able to check the plan-time
entries and the P/N materialized record — or the H work product and its
correspondence to sanitized packet fields — from what is committed here. If they
cannot, the case is inadmissible; an account may remain as a `reported` item (§7.13).

## How to open a new observation

1. **Enumerate the candidate in `LOG.md`** under the §7.1 register, dated, before
   examining it for qualification.
2. **Run the opening check** at the top of `TEMPLATE.md`. A disqualifier ends the
   case; the row still goes in the log, with the disqualifier named.
3. **Fix the claim shape** — `P`, `H`, or `N`. It is chosen now and is not
   relabelled later (§1).
4. **Create the file** `gate-e-observation-<YYYY-MM-DD>-<id>.md` from
   `TEMPLATE.md`.
5. **Fill and date the `[PLAN-TIME]` fields available at open.** For claim H,
   the packet issue, its own read position, and the ordinary handoff request
   are captured when they happen, before the outcome is known; follow
   `HANDOFF-RUNBOOK.md` Steps 3–5 and commit the completed issue record before
   transport. Do not substitute an earlier orientation cursor or reconstruct a
   field afterwards. For claim N, record a normal-work Basis 1 plan if it
   already exists, or commit the choice to use a blinded Basis 2 reconstruction.
   The reconstruction itself is written later, before comparison. For P and N,
   the prompt must be verbatim and must name neither Recall, nor
   `recall_workspace`, nor "prior work" (§6, §7.2).
6. **Append the log row** in `LOG.md` and open the case in the table.
7. **Let ordinary work proceed.** For H, the sender may issue the packet
   voluntarily and the recipient may work from it; record each plan-time event
   when it happens. Do not prompt reuse, re-prompt after a quiet moment, or add
   a control arm (§7.2, §7.3).
8. **At close**, fill the closing fields, state the verdict and its label, and
   write what the observation does not establish (§7.11).
9. **Append corrections, never edits.** A wrong statement is fixed by a dated
   correction inside the observation or a dated note under `LOG.md` (§9).

Nothing above authorizes work. Observing is not the same as prompting: an
observer who asks a participant to look for prior work has destroyed the case
(§7.2).

## What makes a record inadmissible

Stated here because these are the failure modes, not because this directory
enforces them. The product has no counterfactual field and no enforcement
mechanism; every one of these depends on operator discipline (§10.6).

- A missing `[PLAN-TIME]` field (§6).
- A claim-N observation with no counterfactual basis, or a basis that cannot be
  dated (§6, §7.8).
- Any of the §4.5 fabricated counterfactuals: written after the fact from memory;
  assuming an action the participant had no reason to take; describing an inquiry
  nothing would have surfaced; "would have taken longer" with no named task; a
  reconstruction written after reading the observed action or by someone who chose
  the case.
- Outcome-conditioned case selection — any case examined before it was enumerated,
  or opened because its outcome looked good (§7.1).
- Prompting, or re-prompting, in a P or N case (§7.2).
- Attribution of the change to `recall_workspace` from an ordinary-work case with
  no matched arm (§7.3).
- Immaterial reuse, however much reading preceded it (§7.4).
- Fixtures, seeded workspaces, or synthetic runs (§7.5).
- Telemetry, install counts, or session counts (§7.6).
- A subjective statement standing in for a material change (§7.7).
- Re-running a case as a second attempt; a withdrawn case deleted from the log
  (§7.9).
- A record absorbed into a sprint result after the fact (§7.10).
- A write-up implying a rate, a direction, or a mechanism from one case (§7.11).
- An agent case generalized to humans (§7.12).
- Evidence not retained well enough for a reviewer to check (§7.13).
- Discarding a null instead of recording it (§7.14).

An inadmissible observation is still recorded, with the disqualifier written out.
It is not deleted and it is not renamed into an admissible shape.

## What this structure adds beyond the protocol

Three implementation decisions the protocol does not specify, recorded so they are
visible rather than assumed:

- **Case numbers.** `LOG.md` numbers cases `1, 2, 3…` so a reader can point at
  one unambiguously. The protocol requires a dated list, not a numbering.
- **The `<id>` format.** `gate-e-<YYYYMMDD>-<nnn>`. §9 requires an `<id>` and
  does not define its shape.
- **Separate case and item labels.** The §6 case verdict (`supports` / `weak` /
  `null`) and the §4.4 item label (`reported` / `none`) are separate fields in
  `TEMPLATE.md`, following the protocol's pre-observation clarification.

## Pre-observation clarifications

Before any case was opened, the protocol clarified the scaffold's initial
ambiguities. A withdrawn case keeps its fixed claim shape and has no verdict
label. P and H may retain a normal-work plan as context but record `N/A` for
the claim-N counterfactual. Procedural failures under §6 or §7 make a case
inadmissible even if its subject looked promising under §3. Case verdict
labels and §4.4 item labels are separate (§1).

**Owner participation in claim H.** `docs/GATE_E_PROTOCOL.md` §12
**Amendment 5** (October 13, 2026) is the operative rule; it resolves the
question Amendment 3 left to the owner ("the repository owner must decide …
no case is opened under an assumed scope"). Owner participation alone does
not disqualify a claim-H case when all four of the following are true:

1. The sender and recipient are genuinely separate participants in separate
   sessions, with **different human principals**. An agent may act on either
   side, but the owner's own agent is not an independent second participant.
   The recipient has ordinary work of their own after delivery.
2. The work is ordinary, pre-existing work **outside Campfire's own
   repository**. It was not created, seeded, or selected for the measurement.
3. The sender makes the packet voluntarily during that work; the recipient
   receives it through an ordinary handoff, without being supplied the desired
   answer. The recorder did not prompt or re-prompt either side into reuse.
4. The owner is identified as sender or recipient in the plan-time opening
   check. §14 discloses the owner's product knowledge, any knowledge of this
   measurement, and any resulting contamination. The evidence §6, §7, and §9
   require is retained, including the recipient-authored work product.

The ruling makes such a case **eligible to be assessed**, not automatically
admissible or supporting. Every other §3.1, §3.2, and §7 condition still
applies; the owner and the other participant are not independent scorers, and
the case is never described as evidence from people generally. It covers
claim H only and both owner roles — owner participation in claim P or N is
not decided by it, must not be opened under an assumed extension, and would
need a separate dated decision.

Owner work that does **not** meet the four conditions — the owner's solo
dogfooding on Campfire's own repository, a handoff about developing
Campfire's own repository even with another participant present, one actor or
one human principal on both sides, a scripted recipient, prompted packet use,
or work created for measurement — remains inadmissible under §3.2 and the
existing rules. It may be retained as an inadmissible case with a `reported`
item and counts toward nothing.

## Corrections

Append a dated note here. Do not edit an existing statement silently (§9).

- **October 13, 2026 — owner participation in claim H rewritten to §12
  Amendment 5.** This paragraph previously stated, as current: "Owner
  dogfooding may be retained as an inadmissible case with a `reported` item;
  it does not qualify as ordinary multi-participant evidence." That sentence
  read §3.2's fifth bullet with the broad scope, which Amendment 5 resolved
  against for claim H. The statement now records Amendment 5's rule and its
  four conditions as the operative rule, and keeps the retained-as-`reported`
  treatment for owner work that does not meet those conditions.

## Status

**Gate E is unmeasured.** No observation has been opened, no candidate case has
been enumerated, and no claim-N observation exists. Nothing in this directory is
evidence of anything. `docs/SPRINT_RCL_001_RESULT.md`,
`docs/SPRINT_RCL_002_RESULT.md`, and `docs/SPRINT_RCL_003_RESULT.md` are frozen
and are not edited by anything here.
