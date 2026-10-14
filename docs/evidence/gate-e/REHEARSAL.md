# Gate E handoff runbook — rehearsal report

**This is a rehearsal. It produced zero observations. Gate E is unmeasured.
Nothing in this file may be cited as evidence, quoted as an observation, or
counted toward any gate.** The rehearsal built a throwaway seeded workspace,
walked `docs/evidence/gate-e/HANDOFF-RUNBOOK.md` end to end as an operator with
no prior context, tested the helper and the comparison method, attempted
`TEMPLATE.md`, and deleted everything it made. A case built this way is
disqualified by protocol §3.2/§7.5; the point of the exercise was only to find
defects in the instructions. No `gate-e-observation-*.md` file was created, no
row was added to `LOG.md`, and no committed artifact other than this report was
produced.

---

## What was rehearsed, and against which revision

- **Documents rehearsed:** the committed `0e0693d` blobs —
  `HANDOFF-RUNBOOK.md` `11013e9d`, `GATE_E_PROTOCOL.md` `69cb9e1a`,
  `TEMPLATE.md` `91be5748`, `README.md` `1cbe1152`, `LOG.md` `5bce7c4b`. All
  quotes below are from that revision.
- **Workspace:** one throwaway SQLite database and packet/evidence directory
  under the approved temp root. Built with the real `createCampfireService`:
  org/team via the real bootstrap, two humans with different principals, two
  agents (sender harness `opencode`, recipient `codex`), an active sender agent
  session, a goal, an artifact, three findings (one corrected/superseded), two
  decisions with a recorded accepted transition, and two tasks. No raw insert.
- **Packet path:** the real `campfire handoff-packet` CLI (package `1.15.0`,
  repo commit `0e0693d`) and the real `scripts/gate-e/packet-evidence.ts`.
- **Repository state caveat:** at session start the working tree matched the
  committed revision. **During the rehearsal, uncommitted edits appeared in the
  working tree** (`HANDOFF-RUNBOOK.md` §2 and `README.md`) and an untracked
  `READINESS-AUDIT.md` appeared — none of it mine. I did not edit, revert, or
  build on any of it. Where one of my findings is already touched by that
  concurrent edit, the finding says so. Everything else is against the
  committed text I actually executed.
- **Rehearsal-imposed deviations (not runbook defects):** exercise ground rules
  forbade writing to `LOG.md`, creating `gate-e-observation-*.md`, or
  committing. Steps 0, 1, 4, 9 and 10 were therefore performed against
  clearly-labelled stand-ins inside the temp directory. The *instructions* at
  those steps were still walked literally; only their repository writes were
  simulated.
- **Deliverable:** this file. The temp workspace, packets, case copy, and
  evidence files were deleted afterwards.

---

## Step-by-step log

| Step | Runbook said | Rehearsal did | Matched? |
| --- | --- | --- | --- |
| 0 — Enumerate | Append the candidate to the §7.1 register, dated, disposition `—`, before qualification | Recorded in a temp register stand-in (`LOG.md` is off-limits per exercise rules) | Yes, mechanically. The word "candidate" and the row format are undefined; I invented both |
| 1 — Open | Assign `gate-e-<YYYYMMDD>-<nnn>`, copy `TEMPLATE.md`, run the opening check against §1, fix shape `H`, fill `[PLAN-TIME]` fields, commit, append log row | Copied the template to the temp case dir; filled the opening check **honestly** | The honest check failed on five lines (ordinary work, voluntary use, real dependency, not-measurement, outcome not known). Per §1.5 the literal run ends here. I continued in knowingly-disqualified mode to test the remaining mechanics |
| 1 (continued) | Fill §1, §2, §3, §4, §5, §6, §7 at open | §1, §2, §3, §4 filled by judgement; §5 **not fillable at open** (packet does not exist); §6 filled with the handoff message but the runbook also implies the query; §7 `N/A` written by improvising a line the template does not print | Partly. Three fields needed improvisation (see defects 2, 5, 6) |
| 2 — Sender reads | Nothing held or forwarded; the H position is the packet's own read at issue | Nothing captured | Yes |
| 3 — Issue packet | Run `campfire handoff-packet <ws> --query … --recipient-type … --recipient … --out …`; no `--cursor`; capture receipt, time, byte count, query, `workspace:read` basis | Ran the CLI as the sender agent (identity supplied manually — the runbook says nothing about who the command runs as). Receipt captured: 6209 bytes, 0 omissions, mode 0600. Overwrite refused on a deliberate second attempt; `--cursor cf1.…` refused with "Cursor is malformed" exactly as the runbook says | The command works, but a **first attempt with a natural multi-word query produced a valid, exit-0, 3227-byte packet carrying zero records** (see defect 1). `workspace:read` basis had to be improvised from code knowledge (defect 10) |
| 4 — Evidence record | Run the helper at the moment of issue, paste the record, fill §5, commit again | Ran the helper before transport. Exit 0. Verified: byte count matches the file; workspace/generatedAt/sourcePosition/records/decisionSet all MATCH the packet; byte-identical across two runs and two working directories; no path, credential, or foreign-workspace strings in the output. Exit codes 1 and 2 tested separately and behave as documented | Helper: yes, exemplary. §5: **not literally fillable** — the record carries the cursor only decoded, while the template asks for the "reported sourceCursor" value (defect 5) |
| 5 — Recipient works | Give the packet and the ordinary handoff request and nothing else; capture message, transport, delivery time, recipient identity, per-participant standing-instruction status | Simulated transport (file copy); all captures possible except the per-participant split (template has one line) | Mostly. Transport is inherently simulated in a desk rehearsal |
| 6 — Work product | A dated, recipient-authored commit, PR, or durable Campfire record | Wrote a clearly-labelled invented patch + changelog (no human recipient exists in a rehearsal) | The mechanics are fine. The "durable Campfire record" shape conflicts with protocol Amendment 4 (defect 12) |
| 7 — Compare | Select fields, retain bounded sanitized excerpts, write per-field verdicts (§5) | Performed by hand against the private packet | The method is executable **only with judgement the runbook does not supply**, and the template has nowhere to record its outputs (defects 8, 9; template defect 7) |
| 8 — Disqualification checklist | "Run the post-handoff disqualification checklist. §6 of this runbook." | Ran §7's checklist; inadmissible on items 4, 6, 19 | **The pointer is wrong** — the checklist is §7, not §6 (defect 14). The checklist itself is clear; it has no template slot |
| 9 — Write observation | Fill closing fields, retained-evidence check, what-it-does-not-establish, corrections append-only | Filled §8–§15 in the temp copy | §9 `N/A` and §11 next action needed improvisation; §13–§15 fillable |
| 10 — Append log | Complete the row, append entry, deviation note if needed | Recorded in the temp log stand-in | Row formatting required guessing (Participant is singular; Workspace rule conflicts with observation §3 — defects 16, 17) |

---

## Runbook defects

Ordered by severity. Each entry names the step, quotes the committed text, and
says what it cost the operator.

### 1. [most serious — wasted recipient time] No pre-transport check that the packet carries anything; a valid empty packet silently reaches the recipient

**Step 3–4.** The capture list is the receipt, issue timestamp, byte count,
query text, and read basis. Step 4 says to paste the evidence record. **At no
point does the runbook tell the operator to confirm the packet carries the
records the handoff is about** — not the record count, not the sections, not the
decision set.

Observed: the first packet issued with a natural sender query,
`"duplicate charge webhook retry idempotency key"`, exited 0, produced a
3,227-byte mode-0600 packet with **zero records, zero omissions, and a
`decisionSet` with no members**. The receipt looked perfect. A second query
(`"idempotency"`) against the same workspace produced 6,209 bytes and 4 records.
Recall matching is whole-phrase substring matching, so a sender's ordinary
phrasing can easily match nothing.

The trap is unrecoverable by design: Step 3 forbids re-issuing ("Do not
re-issue to tidy up, to get a second receipt, or to get a cleaner record. That
is a re-run (§7.9) and it is not the packet the recipient read."). The first
point at which anyone could notice is §5 — **after** the recipient has done the
work. This is the defect most likely to spend a real colleague's time on
nothing. A one-line pre-transport check (open the packet or read the evidence
record and confirm `records` is non-empty and contains the expected ids) would
close it.

### 2. [blocks or corrupts the case] The plan-time stop rule contradicts the runbook's own §5 instruction

**Step 1.** The committed text ended: "**If you cannot fill a `[PLAN-TIME]`
field at open, stop.** A case opened without one is inadmissible under §6, and
§6 says so without an exception." But §5's value comes from the packet's own
read at issue: "§5 Pre-action position is filled from the packet's own read at
issue … dated to that moment. Do not leave it blank, and do not backfill it."
At open the packet does not exist, so §5 cannot be filled at open. A literal
operator stops; an operator who continues and fills §5 later has "backfilled" it
on a plain reading and produced an inadmissible case either way. Protocol §6
only requires plan-time fields "before the outcome is known", so the runbook is
stricter than the protocol it says is authoritative.

*(Concurrent working-tree edit note: an uncommitted edit visible at the time of
this report replaces this paragraph with an "Open establishes the case; issue
completes the pre-action position" rule that resolves this defect. I rehearsed
the committed text above.)*

### 3. [blocks if not pre-arranged] The recipient must already be a participant of the sender's workspace, and the runbook never says so

**Step 3 and §1.3.** The command authorizes both the issuer and the recipient
against `workspace:read` before projecting a packet; a recipient who is not a
workspace participant makes `campfire handoff-packet` fail with a
`ParticipantRequired`-class error. §1's preconditions require the recipient to
be "a genuinely separate participant in a separate session" but never say the
recipient must be enrolled in the sender's workspace, nor who invites them, nor
when. An operator meeting the H scenario in the wild (recipient outside the
team) hits an error the runbook does not explain.

### 4. [misleads; integrity risk] Step 3's command omits the acting identity, and the wrong identity fails silently

**Step 3.** The command block is:

```text
campfire handoff-packet <workspaceId> \
  --query <the sender's own query text> \
  --recipient-type human|agent \
  --recipient <actorId> \
  --out <file> \
  [--output auto|human|json]
```

Nothing in the runbook says under whose identity or credential this runs. The
CLI resolves the actor from flags or `CAMPFIRE_ACTOR_ID`/`CAMPFIRE_ACTOR_TYPE`
and **falls back to a built-in default actor when they are unset**, so a
literal execution on a prepared machine can issue the packet as someone other
than the sender. The receipt does not name the issuer, so the error is
invisible until §2 is written — and preconditions 12/16 and the whole H claim
rest on who issued the packet. The rehearsal had to read the CLI code to supply
the sender's actor id.

### 5. [not literally fillable] §5's "reported sourceCursor" value is not carried by the packet-evidence record

**Step 4, and protocol §12 Amendment 1.** Amendment 1 says the pre-action
position is "recorded" with "its reported `sourceCursor` / `sourcePosition`",
"as carried in the packet-evidence record". `TEMPLATE.md` §5 prints
`reported sourceCursor: <value>`. The record does not carry the cursor string:
it carries a decoded object (`decoded`, `workspaceMatches`, `position`, `phase`,
`tip`, `matchesSourcePosition`). The operator cannot fill the slot as printed;
the rehearsal substituted a decoded rendering and said so. The amendment's
substance works — `matchesSourcePosition: true` made the packet read checkable —
but the template cannot record it in the shape it asks for.

### 6. [ambiguous] §6's `[PLAN-TIME]` Task names three different texts

**Step 1 vs Step 3 vs Step 5.** Step 1 item 5: "§6 Task — the ordinary handoff
request, **verbatim**". Step 3 requires capturing "The sender's query text,
verbatim … the sender's ordinary intent". Step 5: "The handoff message or
request … This is §6's `[plan-time]` Task for H." The sender's `--query` and the
message delivered with the file are different strings; the runbook never says
whether they must be the same, and `TEMPLATE.md` has no field for the query
text anywhere, although Step 3 requires capturing it. The rehearsal recorded
the message in §6 and kept the query only in its own notes. The working-tree
edit says §6 Task is recorded at Step 5, which settles timing but not the
query/message distinction.

### 7. [unworkable as written] "Run the opening check against §1 above. Tick every line" cannot be done: §1 has 22 preconditions, the template's opening check has 9 lines

**Step 1.** §1 says "Every line below is checked **before** the handoff starts,
and the answers are dated into the observation's opening check
(`TEMPLATE.md`)." The template's check has no line for enumeration order
(precondition 1), retention plan (18), private packet storage (19), the
recorder's presence and verbatim-prompt duty (20), build recording (21), or the
everyone-understands line (22). An operator cannot both "tick every line" of §1
and stay inside the template; the rehearsal extended the check and annotated
it.

### 8. [comparison rules do not match the artifact] A superseded decision is carried twice with contradictory safety projections

**Step 7, §5.1 rule 2 vs §5.4 bullet 1.** The packet carries the superseded
decision in `records[]` as `section: historical`, `lifecycle: superseded`,
**with its `rationale` present** and no `historicalExplanation` — and in
`decisionSet.members[]` as the same member **without** the rationale and
**with** the `historicalExplanation` "its rationale is not a current
condition". The packet-evidence record faithfully carries both, so §5.1 rule
2's "whether a `rationale` is present" yields both answers for the same id. The
runbook's mismatch definition — "where the packet marks that member `section:
historical`, `lifecycle: superseded`, with no rationale and a
`historicalExplanation`" — describes only the decision-set projection. This is
the exact shape RCL-003's S2 recipient failed on, and an operator applying §5.4
literally cannot tell which projection governs. (Root cause may be product-side;
the runbook is still wrong about what its comparison will see.)

### 9. [contradiction inside §5] Safety fields are forced into scope, then a rule says fields the work does not bear on are out of scope, and there is no verdict for "not borne on"

**Step 7.** §5.1 rule 2: "**Every field carrying safety structure**, whether or
not the work mentions it". The closing sentence of §5.1: "A packet field the
work product simply does not bear on is **not** in scope". A config patch cannot
express `decisionSet.state`, `operativeDecisionId`, `linkedNextStep`, or
`needsReview`; the operator must decide whether such a field is in scope
(rule 2) or not (closing sentence), and §5.3 offers only match/mismatch. The
rehearsal wrote "match"/"not borne on" by judgement and recorded that it did.

### 10. ["workspace:read basis" is undefined and unsourced]

**Step 1 item 5 and Step 3.** The field is required for "every read", but no
format is given, no example appears, and no product surface reports it: the
authorization decision is not retrievable as a "basis" anywhere the operator can
look. The issue command in fact performs **two** authorization checks (issuer
and recipient), which the "one line per read" rule does not anticipate. The
rehearsal supplied a sentence from code knowledge; a first-time operator cannot.

### 11. [ambiguous] Build is defined for two participants who may not both have a build

**Step 1 item 5:** "the git commit the participants ran against, **not** the
commit that adds the observation file." For H the recipient is offline and runs
no Campfire; there is one build, not two, and the runbook gives no source
(`git rev-parse`? package metadata?) or treatment for a non-git install.

### 12. [contradicts the protocol] Step 6's qualifying shape "a durable Campfire record" is the disqualifying restatement of §3.2 unless it enacts an action

**Step 6.** "Qualifying shapes, in the owner's terms: a commit, a pull request,
or a durable Campfire record." Protocol Amendment 4: "Copying with no dependent
action is restatement and nothing else… Recorded `inadmissible`." A Campfire
record is text; without a dependent action it is exactly the "new Campfire text"
§3.2 disqualifies. The runbook lists it as a qualifying shape without the
condition.

### 13. [gap that can make a real case inadmissible] "A reference a reviewer can check" is undefined when the recipient's artifact is private

**Steps 6 and 9, protocol §7.13.** The runbook asks for "a commit sha, a PR
number or URL, or a Campfire record id with its `created_at`" and requires a
reviewer with no access to the recorder's memory to be able to check it.
Nothing says whether the reviewer is assumed to have access to the recipient's
repository. The rehearsal's work product was a temp file and could not be
retained at all; a private-repo sha is the realistic version of the same
problem, and the runbook offers no rule.

### 14. [misleads] Step 8 points at the wrong section

**Step 8.** "Run the post-handoff disqualification checklist. **§6 of this
runbook.**" The checklist is §7; §6 is the worked illustration. An operator
obeying the pointer lands in a fictional example.

### 15. [ambiguous] "The date" of a non-versioned work product is undefined

**Step 6.** §3.1.4 requires a dated work product; the runbook says capture "The
date, in ISO-8601". For a commit or PR the date is intrinsic; for "a durable
Campfire record" or "an action" (authored? approved? deployed? observed?) there
is no rule.

### 16. [minor but concrete] Step 5 asks for the standing-instruction status "for each participant"; the template has one line

**Step 5, `TEMPLATE.md` §14.** One yes/no cannot hold the sender's and the
recipient's statuses, which differ by construction (the offline recipient has
no Campfire session).

### 17. [contradiction between documents] An H case's workspace is recorded in the observation but the log says `—`

**Steps 1 and 10; `LOG.md` column meanings.** `LOG.md`: "**Workspace** —
workspace id (B) or `—` for an H case whose reuse crossed a workspace boundary".
`TEMPLATE.md` §3 records the workspace id and name. The runbook says nothing
about which the log row should carry, and a reviewer comparing the two sees a
blank where the observation names a workspace.

### 18. [minor] Bookkeeping conventions are not supplied

**Steps 1, 4, 10.** The runbook says "Commit the opened file" and "Commit the
observation file again" without saying on which branch, under whose authority,
with what message, or what to do if the operator lacks commit rights; the
protocol says a push is not authorized, but nothing states commit scope. The
`<nnn>` width, the date's timezone for `gate-e-<YYYYMMDD>`, and the `Case <n>`
number are likewise left to guess (the log says the number is "assigned at
open" but the enumeration register has no number to assign from).

### 19. [minor] §8.1 mixes disposition and verdict vocabularies

**§8.1, row "The recipient never opened the packet":** "Run §7. Disposition
`inadmissible` or `null` as the clauses require." `null` is a verdict label for
an admissible case; the log's own rules keep disposition and verdict label
separate. An operator copying the phrase into the log creates an invalid row.

---

## Template defects found in use

1. **No slot for the packet-evidence record.** Step 4 says "Paste it into the
   observation file"; §1–§15 contain no section for it. Same for the receipt,
   issue timestamp, byte count, and the sender's query text that Steps 3–4
   require captured.
2. **No slot for the disqualification checklist results** (runbook step 8;
   §3's capture table), so §7.13's reviewer cannot see why the disposition was
   chosen.
3. **§2 is one participant table.** H requires the sender's and the recipient's
   identities; there is no recipient block, no instruction to add one, and
   Step 1 ("the recipient's when known") suggests adding them somewhere.
4. **§5 has no `N/A` line** although the prose and the runbook say P/H record
   `N/A`; the two Basis blocks are printed as the only shape.
5. **§6's P/N confirmation** ("Named Recall… / Re-prompted…") is one the
   runbook demands for H but the template scopes to P and N; the query itself
   has no field.
6. **§7 is a claim-N section** with no P/H `N/A` line; the Basis 1/2 menus are
   the only printed shape.
7. **§9's block is a menu with no `N/A` line** although the prose says H is
   `N/A` with a reason; the only way to fill it is to edit a menu the
   template's own rule says is "a shape, never a value".
8. **§10 cannot carry §5's required outputs.** §5.1 wants the field selection
   "written down with the reason for each field"; §5.3 wants a verdict "for each
   field"; §5.5 forbids averaging. §10 offers one `Correspondence verified`
   line and an excerpt block. The rehearsal improvised a table after §10.
9. **§10's "bounded, sanitized excerpt" gives no bound or format** for the
   hand copy, though the helper's bounds and truncation flags are what make the
   copy checkable.
10. **§11 "next action taken" is undefined for H.** Its shape ("as written in
    the record or in the plan") presumes a P/N-style plan; the rehearsal filled
    it with a changelog sentence that duplicates §10.

---

## Protocol ambiguities that made the rehearsal ambiguous

1. **Amendment 1 vs the record's shape.** "its reported `sourceCursor` /
   `sourcePosition` are recorded" — the committed artifact records the
   `sourcePosition` and a decoded cursor, not the cursor string. §2's "the read
   the participant used" remains singular for a two-participant claim.
2. **§6's Participant row is singular; Build is plural.** H has two
   participants and can have one build; the field definitions fit neither
   cleanly.
3. **§6 "bounded content needed to verify correspondence"** — no bound, unit,
   or preservation rule for the operator's excerpts.
4. **§7.13 "readable by a reviewer with no access to the observer's memory"**
   does not say whether the reviewer must reach the recipient's work product,
   or only the observation's sanitized account. For a private artifact the two
   readings differ by an access grant.
5. **§3.2's restatement bullet vs Amendment 4.** "A dependent action" is the
   line between reuse and restatement; a durable Campfire record that enacts a
   decision is still text, and nothing states what makes it the action rather
   than the restatement.
6. **§5.3/§5.4 assume one projection of a decision.** A superseded decision
   reaches the packet twice (records and decision set) with different safety
   projections; the comparison vocabulary covers only one.
7. **§7.2's standing instruction** is required "whether that instruction was in
   effect" per observation, while the runbook asks per participant and the
   template provides one line.
8. **§3.1.4's "dated, recipient-authored work product or action"** does not
   define who dates a non-versioned action, or how authorship is evidenced for
   an agent acting for the recipient.

---

## What worked (so the fix effort can be proportionate)

- **The product path is solid.** `campfire handoff-packet` writes one mode-0600
  file, refuses overwrite and symlinks, returns a token-free receipt whose byte
  count equals the file exactly, and performs the two authorization checks the
  security model calls for. The runbook's claims about the overwrite trap and
  about `cf1.`-prefixed cursors failing with "Cursor is malformed" are accurate
  — both were reproduced.
- **`scripts/gate-e/packet-evidence.ts` is exemplary against the runbook's
  requirements.** At the moment of issue it emitted a record that matched the
  packet on every structural field checked (`packetBytes` vs file size,
  `workspace.id`, `generatedAt`, `sourcePosition`, issuer, recipient, record
  count, `decisionSet.state`); two runs in two working directories were
  byte-identical; scanning found no path, credential, or foreign workspace id;
  the exit codes 0/1/2 behaved exactly as Step 4 documents; refusal reasons name
  the field path and never quote the matched text; and §8.2's concrete claim —
  the frozen `docs/evidence/rcl-003/packet-S2.json` is rejected at
  `packet.decisionSet.linkedNextStep` — was reproduced exactly.
- **Amendment 1's substance works.** The packet's own read is captured and
  checkable (`sourceCursor.matchesSourcePosition`, decoded position/phase/tip);
  only the template slot for it is wrong.
- **§5's comparison vocabulary is meaningful where it lands.** The partial
  correspondence ("per-attempt keys" and "three attempts with jitter" match; the
  cause statement contradicts the current findings) is exactly the kind of case
  §5.5 calls `weak`, and §5.4's examples would guide a careful operator.
- **The admissibility discipline itself is clear and coherent.** Enumeration
  first, no prompting, no re-runs, nulls recorded, P/H never counting, the
  §4.4-label vs verdict-label split, and Amendment 5's owner rule are
  unambiguous in the texts used, and the rehearsed log/template vocabularies are
  fillable without a protocol beside them.

---

## Bottom line

**Counts.** 19 runbook defects (2 severe: the empty-packet trap and the
plan-time stop contradiction), 10 template defects, 8 protocol ambiguities.

**Most serious single defect:** the **empty-packet trap** (defect 1). A
natural sender query can produce an exit-0, well-formed, correctly-receipted
packet carrying zero records; the runbook never asks the operator to confirm
the packet carries anything before transport, and it forbids re-issuing
afterwards as a re-run. The recipient's time is spent before anyone can notice.

**Readiness assessment.** The runbook is **not ready for a real operator as
rehearsed**. The product commands and the helper are ready; the instructions
are not. A literal first run either aborts at Step 1 over the §5 plan-time
contradiction (fixed only in an uncommitted working-tree edit at the time of
this report), or proceeds and can waste the colleague's time on an empty
packet, improvises three template fields, and cannot record the comparison the
protocol §7.13 requires in the template's own slots. The minimum fix set before
a real handoff: a pre-transport content check (defect 1); the recipient-
membership and acting-identity instructions (defects 3, 4); the §5 cursor and
plan-time wording (defects 2, 5); §6 Task identity (defect 6); opening-check
mapping (defect 7); and the superseded-rationale comparison rule (defect 8),
with template slots for the evidence record, the two participants, the
selection/verdicts, and the checklist.

*(This report creates no observation and changes no rule. Gate E remains
unmeasured.)*
