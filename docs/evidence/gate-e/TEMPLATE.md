# gate-e-observation-<YYYY-MM-DD>-<id>

Copy this file to `docs/evidence/gate-e/gate-e-observation-<YYYY-MM-DD>-<id>.md`
and fill it in place. The file name is fixed by §9 and is not negotiable. A copy
of this template left under any other name is not an observation.

**`[PLAN-TIME]` marks a field that must be filled in, dated, and committed before
the outcome is known** (§4.2 Basis 1, §6, §7.8). Everything above the
**Closing** heading belongs to the open record. Everything below it is written
afterward. A Basis 2 reconstruction belongs below that heading: it is written
after the action, independently and before comparison. A `[PLAN-TIME]` field the
material cannot support at open is completed as soon as it can exist and dated
to that moment — §4a and §5 are filled at issue, and §6's Task when the handoff
request is made — but never after the outcome and never reconstructed
afterwards; a case whose plan-time record is written late is inadmissible under
§6.

Unfilled slots read `not recorded`. A slot left at `not recorded` at close is a
result and is recorded as one — with a reason — rather than quietly dropped.

Angle brackets mark a shape, never a value. Do not paste an example into a slot
from this template and leave it there.

---

## Opening check — `[PLAN-TIME]`

Every line is checked before the case is opened, and the answers are dated. The
numbered rows are runbook `HANDOFF-RUNBOOK.md` §1's preconditions, in §1's
numbering; §1 governs if the two ever drift. A `yes` on a disqualifier row ends
the case: the row still goes in `LOG.md`, with the disqualifier named. The
runbook covers claim H; for a P or N case under the protocol, answer the rows
that apply to it and write `n/a — not a claim-H line` with a reason on the
others.

**The dependency test (§3.1.3 — protocol; runbook §7.1 item 7 checks it after
the fact).** "Would have been nice to have", "confirmed what I already
believed", and "I read it while I was there" do not qualify. This is the
condition that separates reuse from a restatement, and a `supports` verdict has
no test without it — so answer it before the outcome and do not answer it after
you have seen how the comparison came out. A `no` here ends the case, the same
as a `yes` on a disqualifier row below:
<yes / no — what would be incoherent, wrong, or unsupportable without them>

| # | Precondition (`HANDOFF-RUNBOOK.md` §1) | Answer |
| --- | --- | --- |
| 1 | The candidate is appended to the §7.1 enumeration register, dated, **before** anyone examines it for qualification. | <yes / no — one line why> |
| 2 | The recorder does not know the outcome yet. | <yes / no — one line why> |
| 3 | This is the first attempt with this workspace and these participants; no case is being re-run. | <yes / no — one line why> |
| 4 | The claim shape is fixed now as `P` / `H` / `N`, before the packet or the reuse. | <shape — choosing it after the outcome is not allowed> |
| 5 | The observation will not be written into a sprint result as that sprint's evidence. | <acknowledged> |
| 6 | The work is real work the participants were doing anyway, with an outcome that existed outside this measurement. | <yes / no — one line why> |
| 7 | The workspace is pre-existing and carrying that real work; not created, seeded, renamed, or populated for the measurement. | <yes / no — one line why> |
| 8 | Nothing in the chain touches `fixtures/**` or `docs/evidence/rcl-00*/**`. | <yes / no — one line why> |
| 9 | This is not a pilot run, a replay, a resumed session, or a rerun of anything in RCL-001/002/003. | <yes / no — one line why> |
| 10 | The recipient has ordinary work of their own that this handoff lands in and that continues after delivery. | <yes / no — one line why; `n/a` for P/N> |
| 11 | Owner involvement, if any, is permitted (§12 Amendment 5): ordinary pre-existing non-Campfire work, a different human principal on the other side, and the owner's role and measurement knowledge disclosed. Record before opening: sender <actor id and type, human principal>; recipient <actor id and type, human principal>; owner role <none / sender / recipient>; work and repository <one line>. Solo owner work or work on Campfire's own repository is inadmissible; for P or N, Amendment 5 supplies no ruling. | <none / role — one line why> |
| 12 | The packet or the reuse was voluntary: for H, the sender made the packet of their own accord during ordinary work; for P/N, the participant chose to reach for prior work, and no prompt named Recall, `recall_workspace`, or "prior work". | <yes / no — one line why> |
| 13 | Nobody re-prompted after a quiet moment, and nobody told the participant a packet or prior work would help. | <yes / no — one line why> |
| 14 | The recipient receives the packet as part of an ordinary handoff and nothing else; the desired answer was not supplied. | <yes / no — one line why; `n/a` for P/N> |
| 15 | The handoff message carries no answer — no finding, conclusion, decision, or next action in prose next to the packet. | <yes / no — one line why; `n/a` for P/N> |
| 16 | The recipient is a genuinely separate participant in a separate session, with a different human principal from the sender. | <yes / no — one line why; `n/a` for P/N> |
| 17 | The recipient is already enrolled in the sender's workspace as a participant with `workspace:read`; the Step 3 command refuses a non-participant. | <yes / no — one line why; `n/a` for P/N> |
| 18 | The Step 3 command will be run as the sender's own identity — `--actor` / `--type` set to the sender, not left to the CLI's built-in default. | <yes / no — one line why; `n/a` for P/N> |
| 19 | The recipient does not reuse their own prior work in the same session with no intervening separate session boundary. | <yes / no — one line why; `n/a` for P/N> |
| 20 | There is a plan to retain what §7.13 requires: source ids, the plan-time entries, and the H work product with its sanitized correspondence. | <yes / no — one line why> |
| 21 | The private packet bytes will stay out of the repository; there is somewhere outside the tree to keep them. | <yes / no — one line why> |
| 22 | A recorder is present and will write the handoff request and any prompt text **verbatim**. | <yes / no — one line why> |
| 23 | The Campfire package version and the git commit the participants ran against will be recorded. | <yes / no — one line why> |
| 24 | Everyone involved understands the outcome will not close Gate E, whatever it is. | <acknowledged> |

Checked by <recorder> at <ISO-8601 UTC>.

---

## Opening

### 1. Observation id — `[PLAN-TIME]`

**Shape.** One id, the protocol version, an open timestamp, and a close timestamp
that is `open` until the case closes. §9 requires the protocol version, the
recorder's name, and both timestamps on the file itself.

```text
Observation id:    gate-e-<YYYYMMDD>-<nnn>
File:              gate-e-observation-<YYYY-MM-DD>-gate-e-<YYYYMMDD>-<nnn>.md
Protocol version:  gate-e-1
Recorder:          <name, and whether they are the observer, the participant, or both>
Opened:            <ISO-8601 UTC>
Closed:            open
Log row:           LOG.md, Case <n>, appended at open
```

Opener signature is not required and is not collected. The timestamps are.

### 2. Participant

**Shape.** Actor id and actor type. For an agent, add harness, harness version,
model, reasoning setting, `agentSessionId`, and the human principal. §7.12: an
agent's reuse is evidence about that harness, model, and date only. **Claim H
has two participants.** Fill both blocks below — the sender (the packet's
issuer) and the recipient — and label them; a claim with only the sender's
identity cannot show who acted on the packet. For a P or N case, fill one block
for the observing participant. The owner's role and the Amendment 5 safeguards
are recorded in the opening check before opening; these blocks carry the full
identities.

**Sender (packet issuer) — claim H:**

| Key | Value |
| --- | --- |
| Actor id | `<id>` |
| Actor type | `human` / `agent` |
| Harness | `<codex / opencode / — for human>` |
| Harness version | `<version>` |
| Model | `<model id>` |
| Reasoning setting | `<setting>` |
| `agentSessionId` | `<session id>` |
| Human principal | `<actor id or name>` |

**Recipient — claim H:**

| Key | Value |
| --- | --- |
| Actor id | `<id>` |
| Actor type | `human` / `agent` |
| Harness | `<codex / opencode / — for human>` |
| Harness version | `<version>` |
| Model | `<model id>` |
| Reasoning setting | `<setting>` |
| `agentSessionId` | `<session id>` |
| Human principal | `<actor id or name>` |

An `—` is written where a value does not apply. Nothing is left blank.

### 3. Workspace

**Shape.** Workspace id and name, plus the `workspace:read` basis for **every**
read in the observation — one line per read, not a summary. For an H case whose
reuse crossed a workspace boundary, write that the boundary was crossed and note
§5.3: citations and evidence are workspace-scoped and foreign ids are dropped, so
this path cannot materialize in-product.

| Key | Value |
| --- | --- |
| Workspace id | `<id>` |
| Workspace name | `<name>` |
| Reads and their `workspace:read` basis | `<one line per read>` |

### 4. Build

**Shape.** The Campfire package version and the git commit the participant ran
against. Not the commit that adds this file.

```text
Package version: <1.15.0>
Git commit:      <sha>
```

---

## Opening, continued — record before outcome

### 4a. Packet issue and evidence record — `[PLAN-TIME]`

**Shape.** For claim H: the packet's issue details and the full packet-evidence
record `scripts/gate-e/packet-evidence.ts` emitted at the moment of issue
(runbook Step 4), pasted unedited. Fill this at issue, before the packet is
transported and before the outcome is known, and commit it with the rest of the
plan-time record. `N/A` for P and N — no packet is issued. Nothing here carries
the packet path or the packet bytes into the commit: the path stays in the
private material, and the record itself carries no path, no token, and no run
timestamp.

```text
Private packet path:            omitted from this committed record; retained only in private material
Issued at:                      <ISO-8601 UTC, to the second>
Receipt, path removed:          kind <kind>; workspace <workspace id>; recipient <actor id, type>; bytes <n>; omissions <n>
Acting identity run as:         <actor id and type — must match §2's sender; the receipt does not name the issuer>
Sender's query text, verbatim:  <the --query text; the record carries it as packet.query.text>
Evidence record generated at:   <ISO-8601 UTC, recorded by you, not by the tool>
Helper exit code:               <0 / 1 / 2>
Pre-transport content check:    <pass — records <n>, expected ids <ids> present / fail — what was found and what was done (runbook Step 4)>
```

Packet-evidence record (paste the full JSON output, unedited):

```json
<paste>
```

### 5. Pre-action position — `[PLAN-TIME]`

**Shape.** For claim H, the packet's own read at issue — the read the Step 3
command performs — as carried in the packet-evidence record in §4a: the read is
named (`campfire handoff-packet`), and its reported `sourcePosition` and
`sourceCursor` are recorded as the record carries them. The record carries no
cursor string; it carries the cursor **decoded**, so record the decoded fields
it supplies. Do not record a sender's earlier orientation cursor here, and do
not fill this from any other read (`docs/GATE_E_PROTOCOL.md` §12, amendment 1;
runbook Step 2). For claim P or N, the workspace append position, or the
`sourceCursor` / `sourcePosition` reported by the read the participant used,
captured **before** the next action was taken — one of the two, not both, and
not a reconstruction written afterward.

```text
Append position (P/N, append-position shape):       <int / —>
Read used (P/N, read shape):                        <operation / —>
  reported sourceCursor (P/N):                      <the read's cursor / —>
  reported sourcePosition (P/N):                    <the read's position / —>

For H — the packet's own read at issue (fill from §4a, not from any other read):
  read used:                                        campfire handoff-packet
  reported sourcePosition:                          <packet.sourcePosition from the record>
  reported sourceCursor, as the record decodes it:  decoded only; the record carries no cursor string
    decoded:                                        <packet.sourceCursor.decoded>
    position:                                       <packet.sourceCursor.position>
    phase:                                          <packet.sourceCursor.phase>
    tip:                                            <packet.sourceCursor.tip>
    workspaceMatches:                               <packet.sourceCursor.workspaceMatches>
    matchesSourcePosition:                          <packet.sourceCursor.matchesSourcePosition>

Captured at:                                        <ISO-8601 UTC — for H, the issue time>
```

### 6. Task — `[PLAN-TIME]`

**Shape.** The prompt or task, verbatim; the prompt text is retained verbatim
(§7.2). For H, this field is the **ordinary handoff request delivered with the
packet** (runbook Step 5) — not the sender's `--query`, which is the packet's
matching key and is recorded in §4a. For P and N, it is the participant's prompt
or task. The P/N confirmations below are `n/a` for H; H has its own two lines.

```text
Verbatim prompt or task (for H: the handoff request delivered with the packet):

> <the participant's prompt, task, or handoff request, verbatim, nothing paraphrased>

Named Recall or recall_workspace or "prior work" (P/N):     no / yes — <why> / n/a for H
Re-prompted after a quiet moment (§7.2) (P/N):              no / yes — <why> / n/a for H
For H — the request supplied no answer (§3.1.3, §3.2, §7.2):           yes / no — <one line>
For H — the sender chose the packet in ordinary work, not at a request (§3.1.2): yes / no — <one line>
Recorded at:                                                <ISO-8601 UTC>
```

The sender's `--query` is recorded in §4a with the packet-evidence record, not
here.

### 7. Counterfactual basis plan — `[PLAN-TIME, claim N only]`

**Shape.** Choose Basis 1, Basis 2, or both before the outcome. For P and H this
field is `N/A` with a reason. A claim-N observation with no basis here is
inadmissible; a testimonial account may remain as a `reported` item (§6). The later Basis 2
reconstruction text is **not** a plan-time field.

**Basis 1 — plan-time recorded counterfactual, resolved later.** Recorded before
accessing the reused records. Must be a specific query to run, a specific record
to create, or a specific question to put to an owner, written for the work itself
without an observer asking the participant to construct a comparison.

```text
Basis:                    Basis 1
Deferred next step, verbatim:

> <the specific query, record, or question>

Written at:               <ISO-8601 UTC>   (must precede the outcome)
Written for the work itself, not at an observer's request:   yes / no
```

Basis 1 alone supports a **plan-level** claim only. It does not establish that the
participant absent Recall would have executed the deferred item (§4.2).

**Basis 2 plan — independent bounded reconstruction.** Commit the choice and
identify a qualified reader who has not seen the outcome. The reconstruction
itself is written after the action and before comparison (§4.2).

```text
Basis:                     Basis 2
Reconstructor selected:    <name; not the participant, not the case selector (§4.5)>
Choice committed at:       <ISO-8601 UTC>   (before outcome)
Pre-action position frozen: <position or cursor from §5>
```

**Both bases:** record both opening entries. Do not select a basis after seeing
which comparison looks more favorable.

## Closing

### 7a. Counterfactual evidence — claim N only

For Basis 1, record whether the deferred item was performed and its result, or
abandoned with a dated reason. For Basis 2, a second qualified reader writes and
commits a reconstruction from the frozen pre-action position using only
`get_workspace_context`, `get_workspace_changes`, and object reads. No
`recall_workspace`, no packet. The author must not see the observed next-action
text before the reconstruction is committed. Compare only afterward.

```text
Basis 1 resolution:        performed — <result and date> / abandoned — <reason and date> / N/A
Basis 2 author had not seen observed action: yes / no / N/A
Basis 2 written and committed at:  <ISO-8601 UTC> / N/A
Basis 2 compared at:       <ISO-8601 UTC> (must be later) / N/A
Surfaces used:             get_workspace_context, get_workspace_changes, object reads / N/A
Actions supported:         <list> / N/A
Actions not supported:     <list> / N/A
Investigation each supported action required: <list> / N/A
Result:                    different / same / unresolved / N/A
```

Basis 2 alone supports a **surface-level** claim only. A reconstruction that
supports the same next action is a valid null result, not a failed attempt (§4.2,
§8).

**Both bases**, or state which one was used and why the other was not available.

### 8. Reused sources

**Shape.** Each source id with its kind, and the surface it was reached through:
orientation, catch-up, object read, `recall_workspace`, `decisionSet`, packet
file — or `unknown`. §7.3 forbids attributing the change to a surface in
ordinary work; this field records the surface, it does not claim causation.

| Source id | Kind | Surface |
| --- | --- | --- |
| `<id>` | `finding` / `decision` / `task` / `artifact` | `orientation` / `catch-up` / `object read` / `recall_workspace` / `decisionSet` / `packet file` / `unknown` |

Prose references that name no id are not reuse evidence and are not listed here
(§5.4).

### 9. Materialized record — P and N

**Shape.** The kind and id of the new durable Campfire record, the
`decision_citations` or `finding_evidence` rows, and the note text verbatim.
`N/A` with a reason for H.

The record must carry its own id, kind, workspace, actor, actor type, and
`created_at`; must name the reused source ids through a **typed relation**, not
only prose; and must still resolve, unmodified, when a reviewer with no knowledge
of the observation reads it back (§5.1). A `recall_workspace` hit, a
`decisionSet` member, a packet file, a transcript, a chat message, an install, a
Viewer page, or a telemetry event is not materialization (§5.4).

```text
New record kind:           decision / finding
New record id:             <id>
Typed relation rows:       decision_citations: <from, to, relation> / finding_evidence: <...>
Note text, verbatim:

> <the note, verbatim, bounded to 500 characters where the model requires it>

Read-back check:           resolves unmodified, unmodified at <ISO-8601 UTC>
```

Reuse that cannot be materialized under the current model — finding-to-finding,
a Task updated from a reused Decision, an Artifact derived from reused work, any
cross-workspace reuse — is recorded as unsupported (§5.3), not forced into a prose
note.

### 10. Resulting work — H

**Shape.** A dated recipient-authored work product or action, its location or id,
and the packet source ids and bounded content needed to verify correspondence.
`N/A` with a reason for P and N.

A packet, or a model answer without resulting work, is not sufficient (§5.4). Keep
the packet bytes outside the repository; retain a sanitized account of the fields
used and a checkable reference to the recipient's work (§9). The packet-evidence
helper records structure and text lengths, not the source text. Copy only the
bounded, sanitized excerpts that the recipient's work actually depends on;
without them, semantic correspondence is unverified.

```text
Work product or action:   <what it was>
Author:                   <recipient actor id and actor type>
Location or id:           <reference a reviewer can check>
Date:                     <ISO-8601>
Packet source ids:        <ids>
Sanitized packet fields used, bounded:

> <the field content needed to verify correspondence, sanitized>

Correspondence verified:  yes / no / unresolved — the per-field record is §10a
```

### 10a. Packet comparison — H

**Shape.** The manual comparison of runbook §5 — the operator's work, not
generated: the fields selected with the reason each is in scope, each field's own
verdict, and the fields considered and excluded. §7.13's reviewer reads this
section to see what the recipient's work was checked against and why. `N/A` for
P and N. Do not average the verdicts; record each in-scope field's own (§5.5).
Where a decision is carried in both projections, check each projection's own
fields — a superseded `decisionSet.members[]` entry carries no `rationale` and a
`historicalExplanation`, while its `records[]` entry carries the rationale as
history (runbook §5.1 rule 2).

```text
| Field (packet)     | Why in scope (runbook §5.1)                        | Verdict (runbook §5.3 / §5.4) |
| --- | --- | --- |
| <field path>       | <the work depends on it / safety structure / the work contradicts or ignores it / named by the recipient> | `match` / `mismatch` |

Fields considered and excluded:  <list with a one-line reason each> / none
Partial correspondence:          <which in-scope fields matched and which did not; §5.5 forbids averaging>
Overall read:                    <the work product against the packet, in the observation's own words>
Sanitized excerpts retained in:  §10 (bounded; ids and lengths alone cannot show what was used)
```

### 11. Next action taken

**Shape.** The next action, verbatim, as written in the record or in the plan. Not
a summary of it.

```text
> <verbatim next action>
```

### 12. Investigation avoided

**Shape.** The named item, why it was deferred, and how that was settled. For P
and H this is `N/A` with a reason.

Not an avoided investigation: fewer tool calls, less elapsed time with no named
task, "the answer felt already known", or an experiment that would have run given
more time (§4.3). If the item was never named before the fact, nothing was
avoided — it was described afterwards, and this field says so.

```text
Named investigation:   <the specific, nameable inquiry>
Deferred because:      <why>
Settled by:            <how the reuse made it unnecessary>
Named before the fact: yes / no — if no, nothing was avoided
```

### 13. Outcome

**Shape.** What happened afterwards, dated. Plain. A null, an ambiguity, or a
failure is written here as plainly as a pass would be (§8).

```text
Outcome:      <what happened afterwards>
Date:         <ISO-8601>
```

### 14. Attribution notes

**Shape.** Contamination, dropped reads, replacements, withdrawals, and the
standing session instructions in effect.

- **Standing `cite the record ids you relied on` instruction in
  `src/mcp/instructions.ts` in effect: yes / no.** It is product text present in
  every Campfire session and is **not** voluntary behaviour (§7.2, §10.8). If it
  was in effect, citation cannot be read as evidence of voluntary reuse — the
  RCL-003 citation split was confounded by exactly this.
- **Owner participation, if claim H:** <none / sender / recipient>; disclose the
  owner's product knowledge, whether they knew this measurement was under way,
  and any contamination it created (§12 Amendment 5). A plan-time owner role
  omitted from the opening check cannot be backfilled here.
- **Contamination:** <what leaked in, or `none`>
- **Dropped reads:** <reads that failed or were denied, with the error, or `none`>
- **Replacements:** <records superseded, retired, or corrected during the
  observation, or `none`>
- **Withdrawals:** <anything withdrawn, with its reason, or `none`>
- **Case chosen by the observer:** for a Basis 2 case, confirm the reconstructor
  did not choose the case (§4.5).

### 14a. Post-handoff disqualification checklist — all shapes

**Shape.** The results of the runbook's §7 checklist, run after the recipient's
work and before the write-up (runbook Step 8). Record each check that fired with
its clause and the disposition it sets, or record that none fired; the case is
written either way (§7.1, §7.9, §7.14). §7.13's reviewer reads this section to
see why the disposition in §15 was chosen.

```text
Checklist run at:        <ISO-8601 UTC>
Checks that fired:       <runbook §7.1 #n / §7.2 #n — clause — disposition it sets> / none
If none fired:           all §7.1 and §7.2 checks clear
Resulting disposition:   <inadmissible — <reason> / withdrawn — <reason> / admissible — <why>>
```

### 15. Verdict

**Shape.** Claim shape, the basis or bases used, and the label. Then what the
observation does not establish, in the observation's own words, so the limit
travels with the record (§7.11, §8).

```text
Claim shape:                     <P / H / N>
Counterfactual basis used:       <Basis 1 / Basis 2 / Basis 1 + Basis 2 / none required (P or H)>
Case disposition:                <inadmissible — <reason> / withdrawn — <reason> / admissible — <why admissible>>
Verdict label:                   <null / weak / supports / N/A (inadmissible or withdrawn)>
§4.4 label for weaker items:    <none / n/a / reported>
Counts toward Gate E:            no — <claim P/H does not close Gate E (§1, §8)>
                                 or, claim N only: <no — <reason §8> / yes (one case only) — claim N, admissible>
Label follows from:              <the field(s) in this file that establish it>
Closed at:                       <ISO-8601 UTC>
```

**Read these slots as shapes, not as values.** The permitted values are in angle
brackets, so a slot left unedited reads `not recorded` under the rule at the top
of this file rather than as a verdict. In each menu the **conservative value is
first** and the passing value is last and carries an extra clause, so a
half-filled §15 — `Closed: open`, nothing else written — reads as a null, not as
a pass. Nothing in this section is filled in optimistically by filling in a menu.

An admissible P or H observation is `no` at the Gate E column and says why: only
claim N closes Gate E, and P and H are not scored toward it (§1, §8). A P plus an
H is two honest facts, not partial credit. For a P or H case the Gate E line is
therefore a statement, not a menu: `no — claim P/H does not close Gate E`. Only a
claim-N observation may reach the passing option, and reaching it requires
writing the claim shape and an admissible disposition in the same slot.

`Label follows from` names the field(s) that establish the label. A `supports`
label with no such field is a claim the file does not carry: `supports` means
"when its claim is demonstrated" (§1), and §3.1.3's real-dependency answer is
what demonstrates it.

**§4.4 items recorded in this case.** Each row is admissible to record and
inadmissible to count. "Recall helped", "it felt faster", "the agent was more
confident", "I would have had to search again without it", citation with cause
unattributed — all `reported`. A reconstruction that agrees with the observed
action — `none`, and recorded as a null.

| Reported item | Label | Counts |
| --- | --- | --- |
| `<item>` | `reported` / `none` | no |

> **Amended October 13, 2026 — see `docs/GATE_E_PROTOCOL.md` §12, amendment 2.**
> The verdict label and the §4.4 item label are separate, typed fields, not one
> menu. The verdict is `supports` / `weak` / `null` (or `N/A` with no verdict);
> this item field carries `reported` and/or `none`, or `n/a` when no weaker item
> was retained. An agreeing reconstruction gives the case the verdict `null` and
> the reconstruction item the label `none` — record both, in these fields. The
> `P` and `H` rows of protocol §4.4's table name claim shapes; record them in
> the claim-shape slot, not in the item field.

**What this observation does not establish.** Written here, not left to the
sprint result:

- A rate, a direction, or a mechanism. One case establishes that the effect
  occurred at least once and nothing more (§4.1, §7.11).
- That `recall_workspace` was the surface that made the difference. Ordinary work
  has no matched control arm (§7.3, §10.7).
- Anything about a person, harness, model, or date other than the one named in
  §2 above (§7.12).
- Any release, tag, deployment, or sprint-level inference (§7.10, §11).

**Retained evidence check (§7.13).** A reviewer with no access to the observer's
memory can read the source ids, the materialized record, and the plan-time
entries from what is committed here. If they cannot, the observation is
moved to an inadmissible disposition; a testimonial account may remain as a
`reported` item:

- Source ids readable from this file: yes / no
- P/N materialized record resolves on read-back: yes / no / n/a
- H work product and its sanitized correspondence: yes / no / n/a
- Plan-time entries dated before the outcome: yes / no
- No raw transcript, credential, or packet bytes committed here: yes / no

---

## Additions and corrections (§9)

Appended, dated. Nothing above is edited silently. A correction names the field,
gives the earlier text and the corrected text, and says why.

- <ISO-8601 UTC> — <field> — earlier: `<text>` — corrected: `<text>` — reason:
  `<why>`

Empty when there is nothing to correct.
