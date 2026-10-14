# Gate E handoff runbook — how to run a claim-H observation

- **Protocol:** `docs/GATE_E_PROTOCOL.md`, version `gate-e-1`. Where this runbook
  and the protocol disagree, the protocol wins and this runbook is wrong.
- **Claim shape:** **H — portable handoff.** An offline recipient acted from a
  handoff packet and their resulting work matches packet contents (§1). This
  runbook covers H and nothing else.
- **Status:** **Zero observations.** No case has been opened, no candidate case
  has been enumerated, and `LOG.md` holds no rows. **Gate E is unmeasured.**
- **Date:** October 12, 2026.
- **Package:** `1.15.0`. v1.16 stays held. This document changes nothing in the
  product.

This is a **pre-execution** runbook. It says how to run one ordinary-work
handoff so that it either counts under §3.1 or is recorded as not counting, and
so that it is not lost to a technicality. It records no evidence, it opens no
case, and it authorizes no handoff. Nothing in it may be cited as though an
observation existed.

An H observation **does not close Gate E**. Only claim N can, and only with an
admissible counterfactual basis (§1, §8). An H case is an honest fact about
portable handoff. A claim-P case plus a claim-H case is two honest facts and not
partial credit (§8).

**Owner participation:** §12 Amendment 5 permits the repository owner as sender
or recipient in a genuine H handoff on ordinary non-Campfire work, with a
different human principal on the other side and full plan-time disclosure.
Owner status alone is not a disqualifier.

**Read this top to bottom before starting.** An operator who has not read the
protocol should be able to follow this file alone. An operator who has read the
protocol will notice that this file cites it on every claim and adds nothing to
it.

---

## 1. Preconditions — tick every line before the packet is issued

Every line below is checked **before the handoff starts**, and the answers are
dated into the observation's opening check (`TEMPLATE.md`). A `no` or a `yes`
on a disqualifier line ends the case; the enumeration row still goes in
`LOG.md` (§7.1), and a disqualified case is recorded with its disqualifier named
rather than dropped (§3.2, §8).

The last column says what happens if the answer turns out to be wrong **after**
the case is opened. Read that column before you tick anything.

### 1.1 The case can be enumerated first

| # | Precondition | Clause | If wrong after opening |
| --- | --- | --- | --- |
| 1 | The candidate handoff is appended to the §7.1 enumeration register in `LOG.md`, dated, **before** anyone examines it for qualification. | §7.1 | **Disqualifying.** A case examined before it was enumerated, or opened because its outcome looked good, is inadmissible. Not repairable by a write-up. |
| 2 | The recorder does **not** know the outcome yet. | §3.2 (last bullet), §7.1 | **Disqualifying.** A case opened when its outcome was already known to the recorder is inadmissible. |
| 3 | This is the **first** attempt with this workspace and these participants. No case is being re-run. | §7.9 | **Disqualifying.** A second attempt is not a retry; it is a different case, and it must be enumerated on its own. A withdrawn case keeps its row. |
| 4 | The claim shape is fixed as **H** now, before the packet is issued, and will not be relabelled later. | §1 | **Disqualifying** to relabel. An H case cannot become an N case after its outcome is known, even if a counterfactual turns up. |
| 5 | The observation will not be written into a sprint result as that sprint's evidence. | §7.10, §9 | **Disqualifying.** RCL-001/002/003 stay frozen. |

### 1.2 The work is ordinary work

| # | Precondition | Clause | If wrong after opening |
| --- | --- | --- | --- |
| 6 | The work is **real work the participants were doing anyway** — a task, a question, an incident — and its outcome existed outside this measurement. | §3.1.1 | **Disqualifying.** Work manufactured for a measurement has no independent outcome. |
| 7 | The workspace is a **pre-existing** workspace carrying that real work. It was not created, seeded, renamed, or populated for the purpose of this measurement. | §7.5, §3.2 | **Disqualifying.** A workspace created for the measurement is not ordinary work. |
| 8 | Nothing in the chain touches `fixtures/**` or `docs/evidence/rcl-00*/**`, and no RCL scenario, key, rubric, or frozen packet is involved. | §3.2, §7.5 | **Disqualifying.** Seeded and pilot material is test material by construction. |
| 9 | This is not a **pilot run, a replay, a resumed session**, or a rerun of anything in RCL-001/002/003. | §3.2 | **Disqualifying.** |
| 10 | The recipient has ordinary work of their **own** that this handoff lands in, and that work continues after the packet is delivered. | §3.1.1, §3.1.4 | **Disqualifying.** With nothing to do, there is no outcome to depend on the packet. |
| 11 | If the repository owner is **either** sender or recipient, the work is ordinary, pre-existing, and outside Campfire's own repository; the other side has a different human principal; the owner's role and measurement knowledge will be disclosed. Owner involvement alone is not a failure. | §3.2; §12 Amendment 5 | **Disqualifying** if the owner-involved work is Campfire repository work, staged for measurement, or one principal acting on both sides. Retain the case and reason. Other §3.1 and §7 checks still apply. |

### 1.3 Both sides are voluntary, unsupplied, and authorized

| # | Precondition | Clause | If wrong after opening |
| --- | --- | --- | --- |
| 12 | The sender is making the packet **of their own accord during ordinary work**. Nobody asked them to look for prior work, and nobody asked them to write a packet. | §3.1.2 (H clause) | **Disqualifying.** A packet produced at the recorder's request is prompted use. |
| 13 | The sender is **not re-prompted** after a quiet moment, and is not told that a packet would help. | §3.1.2, §7.2 | **Disqualifying.** See §8.1 of this runbook: the protocol's explicit re-prompt clause is written for P and N, and §3.1.2's H clause is the requirement that applies. A re-prompt that produced the packet breaks it. |
| 14 | The recipient receives the packet **as part of an ordinary handoff** and nothing else. | §3.1.2, §7.2 | **Disqualifying.** Giving the recipient the packet is inherent to H; **giving them the desired answer is not**. |
| 15 | The handoff message carries **no answer**. No finding, no conclusion, no decision, no next action is restated in prose next to the packet file. | §3.1.3, §3.2 (restatement), §7.2 | **Disqualifying, or at minimum fatal to the claim.** If the sender's message contains the substance the recipient reproduces, the work cannot be shown to depend on the packet's records. See §5.4. |
| 16 | The recipient is a **genuinely separate participant** in a separate session, with a different human principal from the sender, not the sender resuming their own work through another agent. | §3.2 (second bullet); §12 Amendment 5 | **Disqualifying.** One principal on both ends is not a genuine owner-involved handoff. |
| 17 | The recipient is **already enrolled in the sender's workspace** as a participant with `workspace:read`. The Step 3 command authorizes the recipient before it projects anything; a recipient who is not a participant fails there and no packet is written. | §2 (`workspace:read`-gated); Step 3 command | **Disqualifying.** Without the recipient's `workspace:read` there is no packet and no H case. Who enrolls them, and when, is ordinary workspace administration, not part of this observation. |
| 18 | The Step 3 command will be run as the **sender's own identity** — `--actor` / `--type` (or `CAMPFIRE_ACTOR_ID` / `CAMPFIRE_ACTOR_TYPE`) set to the sender, not left to the CLI's built-in default. The receipt does not name the issuer, so a wrong identity surfaces only when §2 is written, and re-issuing to correct it is a re-run (§7.9). | Step 3 command; §7.9 | **Disqualifying** to the H claim if the packet's issuer is not the sender. The packet cannot be re-issued to correct it. |
| 19 | The recipient does **not** reuse their own prior work in the same session with no intervening separate session boundary. | §3.2 (second bullet) | **Disqualifying.** |

### 1.4 The evidence can be retained

| # | Precondition | Clause | If wrong after opening |
| --- | --- | --- | --- |
| 20 | There is a plan to retain what §7.13 requires: source ids, the plan-time entries, and the H work product with its sanitized correspondence, readable by a reviewer with **no access to the recorder's memory**. | §7.13, §9 | **Disqualifying** at close. If it cannot be retained, the case is inadmissible and a testimonial account may remain as a `reported` item. |
| 21 | The private packet bytes will **stay out of the repository**. There is somewhere outside the tree to keep them. | §9 | **Disqualifying** if committed. A committed packet is a §9 violation, not a formatting preference. |
| 22 | A recorder is present, and will write the handoff request and any prompt text **verbatim**. | §6, §7.2 | **Weakening, then disqualifying.** Verbatim prompt text is required. A paraphrase is not the retained text §7.13 asks for. |
| 23 | The Campfire package version and git commit the participants ran against will be recorded. | §6 (Build) | **Weakening.** A missing `[plan-time]` field is inadmissible (§6); Build is not marked `[plan-time]`, but a missing required field is a gap in the record and is recorded as one. |
| 24 | Everyone involved understands the outcome will not close Gate E, whatever it is. | §1, §8 | Not a defect. Stated so nobody edits the write-up afterwards to make it sound like more. |

### 1.5 If any line fails

Do not issue the packet. If a case was already opened, fill the opening check
honestly, set the disposition, and append the row. A case that fails §3.1 before
the handoff produces any reuse is still a dated enumeration entry (§7.1) and,
if opened, still a row (§8).

**Nothing in §1 is repairable by writing it up better.** A disclosed
disqualifier is a recorded result. A concealed one invalidates the case and the
record.

---

## 2. The capture sequence

Follow in order. Steps 0–1 happen before the packet exists. Step 2 happens
before the packet exists. Steps 3–4 happen at the moment of issue. Steps 5–8
happen while the recipient works and afterwards. A step done out of order cannot
be put back.

### Step 0 — Enumerate

Append the candidate to the **Case enumeration register** table in `LOG.md`,
dated, with disposition `—`. Do this before examining the candidate for
qualification (§7.1). This is the act that starts the count; writing it after
the outcome is known does not satisfy §7.1.

### Step 1 — Open the case and commit it

1. Assign the id `gate-e-<YYYYMMDD>-<nnn>`. The date is the **open** date (§9).
2. Create `docs/evidence/gate-e/gate-e-observation-<YYYY-MM-DD>-gate-e-<YYYYMMDD>-<nnn>.md`
   from `TEMPLATE.md`. The file name is fixed by §9 and is not negotiable.
3. Run the **Opening check** at the top of `TEMPLATE.md` against §1 above. The
   check prints one numbered line per §1 precondition, in §1's numbering: tick
   each line in §1's tables, write the same answer and the one-line reason on
   the matching line of the check, and date the check. §1 governs if the two
   ever drift. A `yes` on a disqualifier line ends the case here: the row still
   goes in `LOG.md`.
4. Fix the claim shape as `H`.
5. Fill and date every `[PLAN-TIME]` field that can be filled now:
   - §1 Observation id — id, protocol version, recorder, `Opened`, `Closed: open`
   - §2 Participant — two blocks for H: the sender's (the packet issuer's) full
     identity now, and the recipient's as soon as it is known. Both identities,
     roles, and the Amendment 5 safeguards are recorded in the opening check
     before opening; §2 carries the full environment fields.
   - §3 Workspace — sender's workspace id and name; note the crossed boundary (§5.3)
   - §4 Build — package version and the git commit the participants ran against,
     **not** the commit that adds the observation file
   - §6 Task — the ordinary handoff request, **verbatim**, recorded when the
     handoff request is made (Step 5). For H, confirm in the same slot that the
     request supplied no answer and that the sender was not prompted or
     re-prompted (preconditions 12–15); the named-Recall confirmation is a P/N
     check, written `n/a` for H. The sender's `--query` is not this field — it is
     recorded at Step 3 and carried by the evidence record in §4a.
   - §7 Counterfactual basis plan — `N/A` with a reason. H does not require a
     counterfactual (§6). It is not a gap.
6. §5 Pre-action position is filled from the packet's own read at issue — the
   read the Step 3 command performs, as carried in the Step 4 packet-evidence
   record, pasted into §4a of the observation — dated to that moment. Do not
   leave it blank, and do not backfill it.
7. **Commit the opened file.** `TEMPLATE.md` requires every `[PLAN-TIME]` field
   to be filled, dated, and committed **before the outcome is known**.
8. Append the row to **Every case ever opened** in `LOG.md` and a dated entry
   under **Appended entries**. `Closed` is `—` while the case is open.
9. Let ordinary work proceed to Steps 2–5, recording each event when it occurs.
   Do not prompt or re-prompt reuse, add a control arm (§7.2), or look for a
   better case after seeing this one's result (§7.1).

**Open establishes the case; issue completes the pre-action position. Neither
may be backfilled after the outcome.** At open, record the enumeration, the
qualification, and every `[PLAN-TIME]` field the material supports then —
including the pre-action position only as far as it is available. A field that
cannot exist until the handoff happens is completed then, dated to that
moment: §5 comes from the packet's own read at issue (item 6 above; §12
Amendment 1), and §6's Task is recorded when the handoff request is made
(Step 5). The operative test under §6 is that the entry is **captured before
the outcome is known**, not that every field is known at open. An entry
written for the first time after the outcome, or reconstructed afterwards
from memory, is invalid: a case with one is inadmissible under §6, and §6 says
so without an exception.

### Step 2 — The sender reads, before the next action

The sender is doing ordinary work, and **nothing from this read is held or
forwarded**. For claim H the pre-action position is **the packet's own read at
issue**, not the sender's read (`docs/GATE_E_PROTOCOL.md` §12, amendment 1).
So there is no cursor to hold here. Fill §5 of the observation at Step 4, from
the packet's own `sourceCursor` / `sourcePosition` as carried in the
packet-evidence record, dated to the issue time. Do not record the sender's
earlier orientation cursor as the pre-action position.

If the sender happens to hold an orientation cursor from that work, it is
**context only**: it is not the H pre-action position, it does not bound the
packet's contents, and it is not passed to the command. Nothing about it goes
into §5.

> **Amended October 13, 2026 — `docs/GATE_E_PROTOCOL.md` §12, amendment 1.**
> This step previously recorded the sender's earlier orientation cursor as the
> pre-action position and had the operator pass it to `--cursor`. Both were
> wrong: the orientation cursor is `cf1.`-prefixed and `--cursor` rejects it as
> malformed, and the packet's `sourceCursor` / `sourcePosition` always come from
> the packet's own read. The question this runbook used to record as open at §9
> item 2 is answered by the amendment.

### Step 3 — Issue the packet

```text
campfire handoff-packet <workspaceId> \
  --actor <the sender's actor id> \
  --type <human|agent> \
  --query <the sender's own query text> \
  --recipient-type human|agent \
  --recipient <actorId> \
  --out <file> \
  [--output auto|human|json]
```

**Run it as the sender, explicitly.** `--actor` / `--type` are the acting
identity; `CAMPFIRE_ACTOR_ID` / `CAMPFIRE_ACTOR_TYPE` set the same values. When
neither is supplied the CLI resolves a built-in default (`hum_sergio`, type
`human`), so on a prepared machine a literal run can issue the packet as someone
other than the sender. The packet carries the actual issuer and the receipt does
not, so a wrong identity is invisible until §2 is written — and the H claim
rests on who issued the packet. Pass the sender's own actor id and type, and
record what you ran (precondition 18; a wrong identity cannot be fixed by
re-issuing, §7.9).

**Both sides must already be participants.** The command authorizes the issuer
against `workspace:read` and then the recipient, before it projects anything
(precondition 17; §2). A recipient who is not enrolled in the sender's
workspace fails here and no packet is written.

**Do not pass `--cursor` unless you already hold a recall cursor from a
`campfire recall` call in this same session — and for an ordinary handoff,
omit it.** `--cursor` accepts exactly one thing: an `rcl1.` recall-paging
cursor (the kind `campfire recall` returns for a truncated section), for this
workspace and this query. The sender's orientation cursor is `cf1.`-prefixed,
and passing it fails immediately with **"Cursor is malformed"**. Even a valid
recall cursor does not tie the packet to an earlier position: the packet's own
`sourceCursor` / `sourcePosition` still come from the packet command's own read,
and a passed cursor must match the current append position or the command fails
with a restart error. The flag changes nothing an ordinary handoff needs, so the
runbook's path omits it.

What this does, in terms that matter here:

- It performs one authorized service read and writes **one new file, mode
  `0600`**. It refuses overwrite and refuses symlinks.
- Stdout is a **token-free receipt**, never the packet. It carries the kind, the
  workspace id, the recipient, the byte count, the omission count, and the path.
- The file is a **sensitive offline copy**. Not a credential, not a live
  guarantee, not permission to execute.
- **Campfire does not send the file.** Transport it the way ordinary work
  transports it. The transport is part of the ordinary handoff and is retained.

**Capture now:**

- The receipt verbatim. Keep the path out of anything committed.
- The **acting identity** you ran with (`--actor` / `--type`, or the environment
  variables). The receipt does not carry the issuer; §2 must match this, and the
  packet's `issuer` is what a reviewer will check.
- The **issue timestamp**, to the second.
- The byte count from the receipt. It must equal the packet file's byte length.
  Cross-check it against `receipt.packetBytes` in the evidence record at Step 4.
- The sender's query text, verbatim. The packet echoes it in `query.text`; this
  is the sender's ordinary intent, recorded as such. It is **not** §6's Task —
  for H that is the handoff request (Step 5). Record the query in §4a of the
  observation.
- The `workspace:read` basis for the read behind the packet, one line per read
  (§6). The packet does not carry the authorization basis; only the operator
  does.

**The trap.** `campfire handoff-packet` refuses overwrite. If you need the
packet again you must re-issue, and re-issuing is a **new packet with a new
`generatedAt`**, not a copy of the old one. Do not re-issue to tidy up, to get a
second receipt, or to get a cleaner record. That is a re-run (§7.9) and it is not
the packet the recipient read.

### Step 4 — Generate the packet-evidence record, at the moment of issue

```text
npx tsx scripts/gate-e/packet-evidence.ts <packet-file> --output json
```

Run it **now**, before the packet is transported, before the recipient sees
anything, and never later in the run. It writes nothing; the record is on stdout,
so capture stdout into the observation file.

- **Exit 0** — a record was emitted. Paste it into the observation file.
- **Exit 1** — invalid packet or unreadable file. See §8.2.
- **Exit 2** — refused. The packet is well formed but must not be committed: it
  carries a credential shape, a path or URI, or a workspace id other than its
  own. See §8.3.

**Why "at the moment of issue" is not a formality.** The record is a pure
function of the packet. It carries no run timestamp, no input path, no file
name, and no machine identity, so the same bytes always produce byte-identical
output — that determinism is exactly what lets a reviewer re-run the tool and
compare. Its consequence is equally plain: **the record does not say when it was
produced and does not say which file it came from.** If it is generated later,
against a re-issued packet or a file that has been touched, the determinism
certifies nothing about the bytes the recipient actually received, and nothing in
the committed evidence would let a reviewer tell the difference. Generating at
issue is what makes the committed record a statement about the right file.

**Capture now:**

- The full JSON record, pasted into the observation file as a fenced block. The
  helper writes nothing; if you do not paste it, it does not exist for a reviewer.
- The **generation timestamp**, recorded by you, not by the tool. This is the
  only record of when the record was made.
- The packet's identity: the file name and path **in the private material only**,
  never in the commit; and in the commit, the things the record itself carries —
  `packet.generatedAt`, `packet.sourcePosition`, `packet.workspace.id`,
  `receipt.packetBytes`, `receipt.omissions`. Naming the packet is the
  recorder's job, not the tool's.
- Exit code, whatever it was.

The record **copies no record text and no decision rationale at all.** For every
record it keeps the id, kind, section, lifecycle, the byte size and truncation
flag of `text` and `rationale`, whether a rationale is present, whether a
`historicalExplanation` is present, `needsReview` and its finding ids, full
provenance, and the relation ids. Sizes are kept so that a reviewer checking the
recipient's work knows whether the field the recipient claims to have relied on
was whole or was cut by a byte cap. The bounded text it does copy is
`query.text`, `workspace.name`, `goal.title`, `goal.description`, and each
`omissions` line, each marked when truncated.

**Paste the record into §4a of the observation** as a fenced block, then **fill
§5 Pre-action position now**, from this read's `sourcePosition` /
`sourceCursor` as carried in the record, dated to the issue time, and note in §3
that the position is the issuer's read and that the boundary was crossed.

**Pre-transport content check — required, before the commit and before
transport.** A sender's ordinary wording can match nothing: recall matching is
whole-phrase substring matching, so a natural query can produce a valid, exit-0
packet carrying **zero records**, and neither the receipt nor the file's shape
says it is empty. Confirm from the evidence record that the packet carries the
handoff:

- `records` is **not empty** — the record lists them, and the human rendering
  prints `Records (n)`.
- The ids the handoff is about are present: in `records[].id`, or, for a
  decision, in `decisionSet.members[].id` (the set is independent of paging) or
  as `decisionSet.operativeDecisionId`. Name the expected ids — or the records
  the handoff is about — before reading the check's result; this is the
  sender's ordinary knowledge of the work, not a list fitted to whatever the
  packet happened to carry.
- Read the counts too: each recall section's `returned` / `total` /
  `truncated` under `completeness.recall`, each anchor's count, the decision
  set's `returned` / `total` / `truncated`, and `omissions`. `returned: 0` in
  every section is the empty packet however good the receipt looks.
- Record the check's result in §4a: `pass` with the record count and the
  expected ids, or `fail` with what the record carried instead.

If the check fails, **do not transport the packet**, and **do not re-issue
it**: re-issuing is a re-run (§7.9), and a corrected packet is not the packet
this case issued (the Step 3 trap stands). Record the counts and the ids the
record did carry in §4a. If the case was opened, close it with no resulting
work — the checklist's §3.1.4 line (runbook §7.1 item 8) governs the
disposition, because the handoff never reached the recipient — and append the
row (Step 10). A failed check is a recorded result (§7.14, §8), not a gap and
not a plumbing detail to fix quietly.

**Commit the observation file again** before transporting the packet. The
plan-time record is now complete and dated, and the outcome is still unknown.

### Step 5 — The recipient works from the packet only

The packet crosses a workspace boundary. The recipient is offline. They get the
packet file and the ordinary handoff request, and nothing else — no token, no
database, no URL, no sender's transcript, and no prose answer (§7.2, and the
product invariant that a shared Finding is not access to a private
conversation).

**Capture now:**

- The handoff message or request **verbatim**, and the transport, and the
  delivery time. This — the ordinary handoff request delivered with the packet
  — is §6's `[plan-time]` Task for H. The sender's Step 3 `--query` is a
  different string: it is the packet's matching key, not the task, and it is
  recorded in §4a. If the handoff was spoken, write down what was said,
  verbatim, at the time.
- The recipient's identity: actor id, actor type, harness, harness version,
  model, reasoning setting, `agentSessionId`, and human principal if the
  recipient is an agent (§6, §7.12).
- Whether the standing `cite the record ids you relied on` instruction in
  `src/mcp/instructions.ts` was in effect **for each participant**. It is
  product text present in every Campfire session. An offline recipient with no
  Campfire session does not have it; an agent recipient with one does (§7.2,
  §10.8).
- Anything the sender said in reply to a question mid-task. That is ordinary.
  Record it verbatim, because it bears on §5.4.

**Do not prompt.** Not the recipient, not the sender. Not a nudge, not a
reminder, not a "did you see if there was anything relevant". §7.2.

### Step 6 — The recipient produces a dated work product

§3.1.4 requires a **dated, recipient-authored** work product or action that can
be checked against the packet's source ids and relevant contents. A packet, or a
recipient's answer, alone is not resulting work (§5.4).

Qualifying shapes, in the owner's terms: a commit, a pull request, or a durable
Campfire record. A chat reply, a plan, a summary, or a spoken answer is **not**
resulting work.

**Capture now:**

- What it was, in one line.
- Author: the recipient's actor id and actor type. If it is an agent's output,
  the human principal too (§6).
- Location or id a reviewer can check: a commit sha, a PR number or URL, or a
  Campfire record id with its `created_at`.
- The date, in ISO-8601.
- The date it was produced, **relative to** the packet's `generatedAt`. Work
  dated before the packet was issued is not this handoff's work product.

If the recipient is working inside Campfire and writes a record that would
normally carry a citation to the sender's ids: §5.3 says citations and evidence
are workspace-scoped and foreign ids are dropped by design, so that citation
will not appear. It is not a defect of the observation. H does not require a
typed relation; §9 of the template takes `N/A` with a reason. Do not force a
citation the product drops by design, and do not read its absence as a finding
about reuse.

### Step 7 — Compare the work product to the packet fields

Do this by hand. §5 of this runbook. The helper does not do it and cannot: it
carries structure, not meaning.

### Step 8 — Run the post-handoff disqualification checklist

§7 of this runbook, and record its results in §14a of `TEMPLATE.md`. **Before**
any write-up.

### Step 9 — Write the observation

1. Fill the closing fields of `TEMPLATE.md` from what was captured: §8 reused
   sources with their surface (`packet file`), §10 resulting work with the
   sanitized packet fields and the bounded, sanitized excerpts the work depends
   on, §11 next action taken **verbatim**, §12 `N/A` with a reason (P and H
   record `N/A` here, §6), §13 outcome dated, §14 attribution notes including
   the standing-instruction line, §15 verdict.
2. Run the **§7.13 retained-evidence check** at the bottom of `TEMPLATE.md`. If a
   reviewer without your memory cannot check it from what is committed, the
   disposition is `inadmissible`.
3. Write **What this observation does not establish**, in the observation's own
   words (§7.11, §8). Do not leave it to the sprint result.
4. Correct anything wrong by appending a dated correction inside the observation,
   never by editing the original text silently (§9).

### Step 10 — Append to the log

1. Complete the row in **Every case ever opened**: `Closed`, disposition,
   verdict label, `Counts toward Gate E` = **no**, and one plain dated line for
   the outcome.
2. Append a dated entry under **Appended entries** in `LOG.md`.
3. If the outcome diverges from the pre-registered expectation, append under
   **Deviation from the pre-registered expectation**. Do not edit the prediction.
4. Nothing in the log closes Gate E (§8).

---

## 3. What must be captured at each step, and the trap of capturing it afterwards

| Step | Capture | Why it cannot be reconstructed later |
| --- | --- | --- |
| 0 | Enumeration row, dated. | §7.1 is about order. A row written after the outcome is known is not an enumeration. |
| 1 | Opening check, claim shape `H`, `[PLAN-TIME]` fields, open timestamp. | §6: a missing required `[PLAN-TIME]` field makes the observation inadmissible. Not "weaker" — inadmissible. |
| 2 | Nothing. The sender's read supplies no H field; no cursor is held or forwarded. | For H the pre-action position is the packet's own read at issue (§12 Amendment 1), recorded at Step 4 — not the sender's read, and **not a reconstruction written afterward**. |
| 3 | Receipt verbatim, acting identity, issue timestamp, byte count, query text, `workspace:read` basis per read. The packet's own `sourceCursor` / `sourcePosition` are captured at Step 4. | The receipt is the only product-side trace that a packet was issued; §10.3 records that the read writes no Contribution, and the receipt does not name the issuer. |
| 4 | The full evidence record in §4a, the generation timestamp, the packet's identifying fields, the exit code, and the result of the pre-transport content check. | The record carries **no timestamp and no filename** by design. A reviewer cannot tell when it was made or from which file. Only the recorder can say, and only if it is written down now. An empty packet looks exactly like a full one to every mechanical check; the content check is the one that does not. |
| 5 | Handoff message verbatim, transport, delivery time, recipient identity, standing-instruction status per participant. | §7.2 requires prompt text retained verbatim. A paraphrase is not the text. |
| 6 | Work product: what, author, location or id, date, ordering against `generatedAt`. | An undated artifact cannot satisfy §3.1.4. "I saw it on Tuesday" is not a date. |
| 7 | The comparison: selected fields, retained sanitized excerpts, per-field verdicts — written into §10a of the observation. | §9: **ids and text lengths alone cannot show what the recipient used.** Once the packet is gone, the excerpts are unrecoverable. |
| 8 | Disqualification checklist results, into §14a of the observation. | — |
| 9 | Retained-evidence check, verdict, and what the case does not establish. | §7.13: unretained evidence makes the case inadmissible. |

**The trap, stated once.** Almost everything above is cheap to capture at the
moment and impossible to reconstruct afterwards: the pre-action position, the
verbatim handoff, the identity of the standing instruction in effect, the date
on the work product, and the bounded excerpts the recipient actually used. Each
of them looks available later and is not. A reconstructed entry is not a weaker
entry; for the `[PLAN-TIME]` fields it is an inadmissible one (§6).

---

## 4. The recipient's surface

Every reused source for an H case is reached through the **packet file** — the
surface §2 lists as "a handoff packet file written by `campfire handoff-packet`".
Record that in §8 of the observation.

Two things not to write:

- Do **not** record that `recall_workspace` made the difference. §7.3 forbids
  attributing an ordinary-work change to a surface without a matched design,
  and §10.7 records that the model cannot even distinguish recalled reuse from
  paged reuse. The field records the surface; it does not claim causation.
- Do **not** record the sender's own retrieval surface as the recipient's. If
  the sender reached the records by `recall_workspace` and wrote them into a
  packet, the **recipient's** surface is still the packet file.

---

## 5. Comparing the recipient's work to the packet

This is manual and reviewable. It is not generated, and nothing in
`scripts/gate-e/` performs it. A generated comparison would be a check that
cannot fail, and a check that cannot fail is not evidence.

### 5.1 Select the fields the comparison must cover

Selection is driven by the **recipient's work**, not chosen in advance and not
chosen to look good. Cover:

1. **Every field the work product could not be right without.** For each
   substantive claim, value, constraint, instruction, status, and next action in
   the work product, ask whether it traces to a packet field. If removing that
   field would make the work product wrong or unsupportable, the field is in
   scope. That test is §3.1.3's real-dependency test, applied to H.
2. **Every field carrying safety structure**, whether or not the work mentions
   it: the decision set's `state`, `operativeDecisionId`, `beforeActing`, and
   `linkedNextStep`; each `decisionSet.members[]` member's `section` and
   `lifecycle`; whether that member carries a `rationale` and whether it carries
   a `historicalExplanation`; `needsReview`. A decision reached twice arrives in
   **two projections, and they are not interchangeable.** In
   `decisionSet.members[]`, a superseded decision is `section: historical`,
   `lifecycle: superseded`, **carries no `rationale`**, and carries a
   `historicalExplanation`. In `records[]`, the same decision's historical text
   — including its `rationale` — is carried as history. Check each projection's
   own fields; do not ask one projection to supply what the other carries. The
   mismatch to catch is unchanged: RCL-003's scored S2 recipient applied a
   superseded decision's rationale as a live condition.
3. **Every field the work product contradicts or appears to ignore** where the
   ignoring matters.
4. **Every field the recipient named** — ids in particular. §6's Reused sources.

A packet field the work product simply does not bear on is **not** in scope, and
its absence from the work is **not** a mismatch. Say so once in the observation
rather than listing every untouched field.

Write the selection down with the reason for each field — §10a of `TEMPLATE.md`
carries the selection table and the verdicts. A reviewer must be able to see why
these fields were compared.

### 5.2 Retain the bounded, sanitized excerpts

For every field in scope whose content the work depends on, copy the **bounded,
sanitized excerpt** the work actually depends on into §10 of the observation;
the selection and the per-field verdicts go in §10a.

- §9: "ids and text lengths alone cannot show what the recipient used." The
  helper copies no record text; **this copy is the operator's job**.
- Copy only what the correspondence needs. A field the work does not depend on is
  covered by the structural record and needs no excerpt.
- Sanitize: no `cft_` or `cfe_` credential shape, no URI, no filesystem path,
  no home directory reference, no workspace id other than the packet's own. Those
  are the same shapes the helper refuses, and a refusal reason never quotes the
  text — so if the helper refused a field, **that is the field not to copy.**
- Respect the packet's own bounds and its `truncated` flags. If a record's `text`
  was cut by a byte cap, the recipient only ever saw the visible part. A match
  cannot rest on bytes they never received. The helper keeps `text.bytes` and
  `text.truncated` precisely so this is checkable.
- Packet bytes themselves stay outside the repository (§9).

### 5.3 What counts as a match

Write the verdict for each field, using the packet field's own content, not a
summary of the work product.

- **Structural fields** — id, kind, section, lifecycle, rationale presence,
  `historicalExplanation` presence, `needsReview`, decision-set `state`,
  `operativeDecisionId`, guidance presence, recorded transitions. Exact
  agreement, **per projection** where the packet carries a decision twice: a
  `decisionSet.members[]` entry's rationale presence is its own fact (absent
  when the member is superseded), and the `records[]` entry's is the other
  (present when the historical text carries it; §5.1 rule 2). For the guidance
  fields, agreement with the guidance the set's own members derive.
- **Content fields** — the retained excerpt's content appears in, or determines,
  the corresponding part of the work product. The recipient may legitimately
  paraphrase or reformat; string identity is not the test. The test is whether
  the work product is consistent with the field and would have been different if
  the field were different.
- **Omission lines** — if the work product relied on a record the packet said it
  omitted, or behaved as though an omitted record had been read, that is a
  mismatch.

### 5.4 What counts as a mismatch

The work product states, implies, or does something the packet's field does not
support, or contradicts it. Concretely:

- A superseded decision's rationale applied as a live condition. The packet's
  `decisionSet.members[]` entry for that decision is `section: historical`,
  `lifecycle: superseded`, carries no `rationale`, and carries a
  `historicalExplanation`; the same decision's `records[]` entry carries its
  historical text and `rationale` only as history. Treating that rationale as a
  current condition is the mismatch — the RCL-003 S2 failure.
- A proposed decision treated as operative, where `state` says otherwise.
- A transition requested that the packet's `linkedNextStep` says is not needed,
  or a transition **not** requested that `beforeActing` requires.
- A work product whose content came from the sender's handoff prose rather than
  from the packet. §3.1.3 requires the action to be incoherent, wrong, or
  unsupportable without the named prior records; if the message alone would have
  produced it, it does not qualify. Record the message verbatim in §14 and say
  which it was.
- A claim that a record said something the retained excerpt does not say.

A mismatch is a **result**. It is recorded, dated, and attributed. It is not
re-read until it reads differently, and it is not explained away as a
misunderstanding.

### 5.5 When the work only partly reflects the packet

This is the common case and the protocol expects it (§8).

1. Record each in-scope field's own verdict. Do not average them and do not drop
   the fields that did not match.
2. Label the case from §1's vocabulary, not from the proportion that matched:
   - `supports` — the H claim is demonstrated: the recipient acted from the
     packet and their resulting work matches the packet contents (§1).
   - `weak` — the retained evidence is checkable but inconclusive (§1).
     Partial correspondence lands here.
   - `null` — the case shows no material reuse or change (§1).
3. A partial correspondence is `weak`, not `supports`. Do not promote the one
   field that matched. Do not demote the case because not every field matched.
4. If **every** substantive line in the work product could have been produced
   without the packet's content, the case does not qualify under §3.1.3 and is
   recorded as `inadmissible` with that reason, not as a weak success.
5. If the correspondence cannot be resolved either way, it is `weak`, and the
   observation says what would have settled it.

---

## 6. Worked example — an illustration of the form, not an observation

> **This section is not an observation.** No case has been opened. `LOG.md`
> holds zero rows in both tables. No file matching `gate-e-observation-*.md`
> exists in this directory, and none will exist until a real handoff is run
> under §1 of this runbook.
>
> Every value below is **invented for illustration**. Nothing here is real data,
> no packet was issued, no recipient worked, and nothing here may be copied into
> an observation, cited as a result, or read as implying that an H observation
> exists. The placeholders are deliberately non-Campfire in shape
> (`ws_<example>`, `dec_<example-a>`) so that nothing here can be mistaken for a
> real identifier that resolves.
>
> It is here to show the **shape** of the capture and the comparison, and to
> show a partial correspondence recorded honestly rather than dressed up.

### 6.1 Shape of the opened record — ILLUSTRATION ONLY

```text
Observation id:    gate-e-<YYYYMMDD>-<nnn>          # invented
File:              gate-e-observation-<YYYY-MM-DD>-gate-e-<YYYYMMDD>-<nnn>.md
Protocol version:  gate-e-1
Recorder:          <name>, observer only, not a participant
Opened:            <ISO-8601 UTC>
Closed:            open
Log row:           LOG.md, Case <n>, appended at open

Claim shape:       H          (fixed at open, §1)
Counterfactual:    N/A — claim H does not require one (§6)
```

Opening check, in the abbreviated form the template asks for:

```text
Ordinary work, real, outcome outside the measurement (§3.1.1):  yes — one line
Voluntary: sender chose the packet in ordinary work; recipient got the packet
  and the handoff request, no answer supplied (§3.1.2, §7.2):     yes — one line
Owner role (§12 Amendment 5):                                      none
Sender and recipient have different human principals:             yes — one line
Not a fixture, pilot, replay, resumed session, or measurement workspace
  (§3.2, §7.5):                                                     yes — one line
Outcome not already known to the recorder at open (§3.2):          yes — one line
First attempt (§7.9):                                               yes — one line
Claim shape fixed now (§1):                                         H
Not to be written into a sprint result (§7.10, §9):                acknowledged
```

### 6.2 Shape of the comparison — ILLUSTRATION ONLY

Packet source ids, in the shape the evidence record supplies them and §8 of the
template records them. Invented:

```text
| Source id            | Kind     | Section    | Lifecycle   | Surface      |
| dec_<example-a>      | decision | current    | accepted    | packet file  |
| dec_<example-b>      | decision | historical | superseded  | packet file  |
```

Fields selected for comparison, with the reason for each — this is the §5.1
selection, shown as a table an operator can hand to a reviewer:

```text
| Field                                  | Why in scope                                          | Verdict |
| dec_<example-a> section + lifecycle    | safety structure (§5.1 rule 2)                        | match   |
| decisionSet.operativeDecisionId        | safety structure; names which rule governs             | match   |
| decisionSet.linkedNextStep             | safety structure; governs whether a transition is asked | match |
| dec_<example-b> `decisionSet.members[]` — no rationale present | safety structure; the superseded member carries none | match |
| dec_<example-b> `records[]` — rationale present as history | the other projection; history, not a live condition | match |
| omissions[0]                           | the work names a record the packet says it omitted    | mismatch|
```

Two lines of the recipient's work, against the retained excerpt for the field
each depends on:

```text
Retained excerpt, dec_<example-b> historicalExplanation:
> <bounded, sanitized excerpt — invented>

Work product, the part that depends on it:
> <recipient's own words — invented>
```

The mismatch, in the words the observation would use: the work product treats a
record the packet listed under `omissions` as if it had been carried in the
packet. That is §5.4's omission case. It is recorded as written. It is not
explained by the sender's handoff prose, because the prose is retained verbatim
and does not contain it.

Verdict, in §1's vocabulary, for a case where the structural fields match and
one content field does not: **`weak`** — the retained evidence is checkable but
inconclusive. `Counts toward Gate E: no`.

### 6.3 What the illustration would have to say — ILLUSTRATION ONLY

```text
This observation does not establish:
- a rate, a direction, or a mechanism (§4.1, §7.11);
- that recall_workspace was the surface that made the difference (§7.3, §10.7);
- anything about a person, harness, model, or date other than the one named
  in §2 (§7.12);
- any release, tag, deployment, or sprint-level inference (§7.10, §11);
- that Gate E is anything but unmeasured (§1, §8).
```

### 6.4 Why this illustration is partial, on purpose

A worked example showing a clean match would be more satisfying to read and more
dangerous to have on the page. It would look like a template for the outcome
someone wants, and the next person to write an observation would have a shape to
fill in. §8 already predicts that most ordinary-work cases will materialize as
claim P or H and fail to produce an admissible claim-N counterfactual, and that
prediction was recorded before any case existed. An illustration that shows a
clean pass works against it.

---

## 7. Post-handoff disqualification checklist — before any write-up

Run this after the recipient has produced their work, before §9 of §2 begins. A
`yes` on any disqualifier line sets the disposition to `inadmissible` with the
clause named, or `withdrawn` with the reason. The case is still written and
still gets its row (§7.1, §7.9, §7.14).

### 7.1 §3.2 — does not qualify

| # | Check | Clause | If yes |
| --- | --- | --- | --- |
| 1 | Did the recipient read, retrieve, page past, or cite the packet **without acting differently**? | §3.2 (first bullet) | `inadmissible — §3.2: no material change` |
| 2 | Did the reuse come from the participant's **own prior work in the same session**, with no intervening separate session boundary? | §3.2 (second bullet) | `inadmissible — §3.2: same-session reuse` |
| 3 | Does the work product **only restate** prior Campfire text into new Campfire text? | §3.2 (third bullet) | `inadmissible — §3.2: restatement only` |
| 4 | Is anything in the chain **inside a seeded fixture**, `fixtures/**`, or `docs/evidence/rcl-00*/**`? | §3.2 (fourth bullet), §7.5 | `inadmissible — §3.2, §7.5: fixture material` |
| 5 | If the repository owner is sender or recipient, is this one principal acting on both sides, Campfire repository work, work staged for measurement, or an undisclosed owner role? Owner participation alone is permitted for genuine H handoffs on ordinary non-Campfire work. | §3.2 (fifth bullet); §12 Amendment 5 | Retain. `inadmissible` with the actual failing clause; mark any account `reported` (§4.4). Do not delete. |
| 6 | Is this a **pilot run, a replay, a resumed session**, or a case whose **outcome was already known to the recorder** when it was opened? | §3.2 (sixth bullet) | `inadmissible — §3.2` |
| 7 | Does §3.1.3 fail — would the work product have been coherent, correct, and supportable **without** the packet's records? | §3.1.3 | `inadmissible — §3.1.3: no real dependency` |
| 8 | Does §3.1.4 fail — is there a **dated, recipient-authored work product** that can be checked against the packet? No answer, no chat reply, no undated artifact. | §3.1.4, §5.4 | `inadmissible — §3.1.4, §5.4: no resulting work` |
| 9 | Is any `[PLAN-TIME]` field missing, backfilled, or reconstructed after the outcome was known? | §6 | `inadmissible — §6: missing or late plan-time field` |

### 7.2 §7 — admissibility rules that apply after the fact

These are not §3.2 clauses but they make the case inadmissible, so check them
before writing the verdict.

| # | Check | Clause | If yes |
| --- | --- | --- | --- |
| 10 | Was the recipient **given the desired answer**, or was the sender prompted or re-prompted into making the packet? | §7.2, §3.1.2 | `inadmissible — §7.2: prompting` |
| 11 | Was the write-up going to attribute the change to `recall_workspace` as **the surface that made the difference**? | §7.3 | Rewrite the attribution to record the surface only. Not disqualifying; a surface claim without a matched arm is. |
| 12 | Is any **materialized record** being claimed as H evidence — a packet, an answer, a `recall_workspace` hit, a `decisionSet` member, a transcript, an install, a Viewer page, a telemetry event? | §5.4 | Rewrite. None of these is a work product or materialization. |
| 13 | Is the **telemetry**, an install count, a session count, or an `activated`/`active` event anywhere in the reasoning? | §7.6 | Delete it. It is never Gate E evidence and none is authorized to be added. |
| 14 | Is any **subjective** statement standing in for a material change — "it felt faster", "it saved me", "the agent seemed sharper"? | §7.7 | Retain only as a `reported` item (§4.4). It counts toward nothing. |
| 15 | Is this case being **re-run** as a second attempt, or was a withdrawn case deleted from the log? | §7.9 | Stop. A withdrawn case keeps its row and its reason. |
| 16 | Is the observation being written **into a sprint result** as that sprint's evidence? | §7.10, §9 | Stop. A sprint result may cite an id and state that it exists. It may not absorb it. |
| 17 | Does the write-up imply a **rate, a direction, or a mechanism** — "typically", "consistently", "clearly"? | §7.11, §4.1 | Rewrite the sentence. One case establishes existence and nothing more. |
| 18 | Is an **agent's** reuse being written as a statement about people in general? | §7.12 | Rewrite as a statement about that harness, model, and date. |
| 19 | Can a reviewer with **no access to the recorder's memory** check the source ids, the plan-time entries, and the H work product with its sanitized correspondence — from what is committed? | §7.13 | `inadmissible — §7.13: evidence not retained`. A testimonial account may remain as a `reported` item. |
| 20 | Was a case that produced **no material difference** dropped instead of recorded? | §7.14, §8 | Record it. A null is a result. |

### 7.3 Recording the result either way

Whatever the checklist finds, the case is written. `Counts toward Gate E` is
**`no`** on every H row, without exception (§1, §8). If the outcome diverges from
the §8 expectation recorded in `LOG.md`, append under **Deviation from the
pre-registered expectation**; do not edit the prediction.

---

## 8. When the handoff fails

**The rule, first.** A failed, ambiguous, or null observation is recorded as
one, in the same log, with the same fields, dated and attributed the same way
(§8). It is not repaired, re-read until it reads differently, or re-run
(§7.9). A discarded null is an admissibility failure of its own (§7.14).

### 8.1 Realistic failure modes

| Failure | What it means | What to do |
| --- | --- | --- |
| The recipient never opened the packet. | No reuse at all. The helper still emits a perfectly valid record — that is one of its documented limits. | Run §7. Disposition `inadmissible` or `null` as the clauses require. Record that the packet was delivered and unopened. Do not re-issue it to the same recipient (§7.9). |
| The recipient opened it and asked the sender a question instead of working. | Ordinary. The handoff is two-way. | Record the exchange verbatim. If the sender's answer supplied the substance, §3.1.3 and §5.4 apply — see §5.4, mismatch row 4. |
| The recipient produced a **summary of the packet** and nothing else. | §3.2, restatement bullet. | `inadmissible`. A summary of the packet is not resulting work (§5.4). |
| The recipient's work reflects the packet only partly. | Expected (§8). | `weak` if the evidence is retained and checkable; `inadmissible` under §3.1.3 if nothing substantive depended on the packet. Record per §5.5. |
| The recipient's work **contradicts** a safety field. | A real result. RCL-003's S2 scored exactly this failure. | Record the mismatch verbatim, dated, with the retained excerpt on both sides. Do not repair it and do not re-ask. |
| The recipient's work product is **undated**. | §3.1.4 requires a dated work product. | No date, no case. Record it as `not recorded` at close, with a reason — `TEMPLATE.md` is explicit that a slot left at `not recorded` is a result, not a gap to quietly drop. |
| The recipient's work product predates the packet. | Not this handoff's work product. | Record the dates and the discrepancy in §14. Do not attach it to the case. |
| The sender made the packet **because the recorder was waiting**. | §3.1.2's H clause is broken. | `inadmissible`. Record it plainly. The recorder's own conduct is attribution notes (§6, §14). |
| The recipient is the repository owner. | §12 Amendment 5 permits either owner role in a genuine H handoff on ordinary non-Campfire work. | Check for different human principals, the recipient's own work, and plan-time disclosure of the owner's role and measurement knowledge. Owner status alone is not a failure. If the owner role was discovered only after opening, record the missing plan-time field as inadmissible under §6; do not backfill it. |
| The workspace turns out to be one created for the measurement. | §7.5. | `inadmissible`. Record it. Do not re-open under a fresh id with the same workspace (§7.9). |
| The recorder realises mid-run that they already knew how it would end. | §3.2, sixth bullet. | Stop. Record the case as opened on a known outcome. Do not continue and do not re-open. |
| Evidence cannot be retained — excerpts lost, packet deleted, artifact unreachable. | §7.13. | `inadmissible`. A testimonial account may remain as a `reported` item with no case verdict (§6). |

### 8.2 The helper exits 1 — invalid packet or unreadable file

The helper re-derives the decision set from the packet's own members and
transitions and refuses a packet whose `state`, `operativeDecisionId`,
`beforeActing`, or `linkedNextStep` does not match what its own contents derive.
It also refuses a packet whose superseded members are not projected as
historical, a packet from a different schema or ordering version, and anything
that does not satisfy the domain serializer.

The common real cause is version skew: a packet written by an older build of the
same schema version. The helper's own documentation records a concrete instance
— the frozen `docs/evidence/rcl-003/packet-S2.json` is rejected by the current
build because `linkedNextStep` does not match the guidance its own members
derive. A v2 packet written before a v2 projection change is not vouchable by a
later v2 build.

**Do not re-issue the packet to get a clean run.** That is a re-run (§7.9), and
the new packet is not the one the recipient read. Record the exit code and the
stderr line in §14, treat the sanitized field account as incomplete, and let
§7.13 decide the disposition. A structural half that is missing is a missing
half.

### 8.3 The helper exits 2 — refused

Refusal means the packet is well formed and must not be committed: a credential
shape (`cft_` or `cfe_`), a path or URI of any of several shapes, or a workspace
id other than the packet's own. Refusal reasons never quote the matched text —
only the field path — because a reason that printed the string it refused would
put the secret on stderr.

**Do not hand-copy the refused field into the observation.** The refusal names
the field; that field is the one not to copy. Produce the sanitized field
account from what remains, record the refusal and its field path verbatim in
§14, and let §7.13 decide. The detectors are deliberately conservative and can
be wrong in both directions: a workspace name containing a URL is refused, and a
path that looks nothing like a path will pass. A false refusal costs one edited
text field. A false pass puts a credential or a private path into a committed
file. When in doubt, refuse and record the refusal.

### 8.4 The packet cannot be transported, or is lost

The packet is a local file. Campfire does not send it. If it never reaches the
recipient, there is no reuse, the record still emits, and the case is recorded
as it stands. Do not re-issue to the same recipient (§7.9). A different
recipient is a different case and needs its own enumeration row (§7.1).

---

## 9. What this runbook exposes as a product gap

Recorded because the operator will hit them. **This document proposes no change.**
Each item is a statement of what is missing, for a decision that has not been
made.

1. **The packet's existence leaves no workspace record.** §10.3 records that the
   recall read writes no Contribution; the handoff write is a local file beside
   it. The only product-side trace is the stdout receipt, which is token-free
   but carries no query, no records, and no decision text. So "a packet was
   issued for this workspace at this time" is evidenced by the observation and
   the private file, and by nothing in the product.
2. **The H pre-action position is answered, and what remains is product-side.**
   §2 defines the pre-action position as "the `sourceCursor` / `sourcePosition`
   reported by the read the participant used", and for H
   `docs/GATE_E_PROTOCOL.md` §12 Amendment 1 resolves whose read that is: the
   packet's own read at issue, filled from the packet-evidence record at Step 4
   and dated to the issue time. A sender's earlier orientation cursor is not the
   H pre-action position and is not passed to the command. What is missing is
   product-side: the position is checkable only through the recorder's attested
   capture of the packet-evidence record, because the packet bytes stay private
   and the read writes no Contribution (§10.3).
3. **The evidence record carries no timestamp and no filename.** That is the
   price of determinism, and it means the recorder's own dated capture note is
   the only evidence of when the record was made and from which file. §10.6:
   there is no counterfactual field and no enforcement mechanism; every part of
   this runbook depends on operator discipline.
4. **Correspondence cannot be checked in-product.** §5.3 and §10.4: the entire
   handoff-packet path crosses a workspace boundary and can never leave a
   checkable in-product trace. The sanitized excerpts are the only route, and
   they are retained by hand.
5. **Truncation is visible but its consequence is not enforced.** The record
   carries `text.bytes` and `text.truncated` so a reviewer can see whether a
   relied-on field was cut. Nothing stops a claim from resting on the cut part.
   §5.2 requires the operator to check it; the product cannot.

---

## 10. Status

**Gate E is unmeasured.** Zero observations have been opened. Zero candidate
cases have been enumerated. `LOG.md` holds no rows. No claim-N observation
exists, and none is produced by anything in this runbook.

An H observation, if and when one is run honestly, is an honest fact about
portable handoff. It is not a Gate E pass, not partial credit against the gate,
and not evidence that Recall improves anything. A claim-P case plus a claim-H
case is two honest facts and no inference in either direction (§1, §8).

This runbook changes no product behaviour, authorizes no release, and scores
nothing. `docs/SPRINT_RCL_001_RESULT.md`, `docs/SPRINT_RCL_002_RESULT.md`, and
`docs/SPRINT_RCL_003_RESULT.md` are frozen and are not edited by anything here.
