# Gate E handoff runbook — second rehearsal report (verification pass)

**Post-rehearsal disposition — October 13, 2026.** The findings and counts
below describe the committed `3fc1ae3` documents that were rehearsed; they are
preserved as the historical result. The subsequent runbook and template edits
resolved original defect 9 by keeping every safety field in scope with an
explicit per-field verdict, expanded the illustration to all 24 preconditions,
and stated that a failed pre-transport check spends the Gate E attempt for the
workspace and participants. The runbook's precondition 3 and §8.4 now also
agree with protocol §7.9: changing a recipient alone cannot make a retry
admissible. The unopened-packet path now also separates an inadmissible
disposition from a `null` verdict (original defect 19). Defect 13, reviewer
access to a private recipient work product, still needs a retention plan before
a real case is opened. None of these edits
turns this rehearsal into an observation.

**This is a rehearsal. It produced zero observations. Gate E is unmeasured.
Nothing in this file may be cited as evidence, quoted as an observation, or
counted toward any gate.** The rehearsal built a throwaway workspace outside the
repository with the real `createCampfireService`, walked
`docs/evidence/gate-e/HANDOFF-RUNBOOK.md` end to end as an operator with no
prior context, produced a genuinely empty packet and a record-carrying packet,
ran the repaired pre-transport content check on both, attempted `TEMPLATE.md`
and the §5 comparison, and deleted everything it made. A case built this way is
disqualified by protocol §3.2/§7.5; the point was only to test the corrected
instructions. No `gate-e-observation-*.md` file was created, no row was added to
`LOG.md`, and no committed artifact other than this report was produced.

**Verdict: the corrected runbook is executable end to end and the empty-packet
trap is genuinely closed — but it is not yet clean for a real operator: the
§5.1 safety-scope conflict (original defect 9) is unresolved and can change a
comparison verdict, and a failed pre-transport check leaves the workspace's
future status undefined.**

---

## What was rehearsed, and against which revision

- **Documents rehearsed:** the committed `3fc1ae3` blobs —
  `HANDOFF-RUNBOOK.md` `510fa9fa`, `TEMPLATE.md` `698bfb27`,
  `GATE_E_PROTOCOL.md` `69cb9e1a` (unchanged from the first rehearsal; the five
  §12 amendments were already present), `LOG.md` `5bce7c4b`, `README.md`
  `bb6b06af`, `READINESS-AUDIT.md` `39fc5daa`, `REHEARSAL.md` `0aa67f28`.
  All quotes below are from that revision.
- **Workspace:** one throwaway SQLite database and packet/evidence directory
  under the approved temp root. Built with the real `createCampfireService` and
  the real `bootstrapOrganizationTeam` — no raw inserts: org/team, two humans
  with different principals (Dana Sender, Rae Recipient), two agents (sender
  harness `opencode` owned by Dana; recipient harness `codex` owned by Rae), an
  active sender agent session, a pre-existing incident workspace, a goal, an
  artifact, three findings (one corrected/superseded), two decisions with a
  recorded accepted replacement (D1 superseded by D2), and two tasks.
- **Packets:** the real `campfire handoff-packet` CLI (package `1.15.0`, repo
  commit `3fc1ae3`) and the real `scripts/gate-e/packet-evidence.ts`. Two
  packets were issued: an empty one (natural query
  `duplicate charge webhook retry idempotency key`) and a record-carrying one
  (query `provider`).
- **Rehearsal-imposed deviations (not runbook defects):** exercise ground rules
  forbade writing to `LOG.md`, creating `gate-e-observation-*.md`, or
  committing. Steps 0, 1, 4, 9 and 10 were performed against clearly-labelled
  stand-ins in the temp directory (a register/log stand-in and a temp git repo
  for the two "commit the observation file" steps). The *instructions* at those
  steps were walked literally; only their repository writes were simulated.
- **Process note, stated because it is a deviation:** in wall-clock order I
  issued both packets before generating the filled case files (the fill script
  ran last). The runbook's order is open → issue → record, and that order is
  executable; the case files carry the intended `Opened`/`Issued at`/`Captured
  at` timestamps. No in-file plan-time value was fabricated after the fact: the
  rehearsed values are the real packet values.
- **Deliverable:** this file. The temp workspace, packets, case copies, and
  evidence files were deleted afterwards.

---

## The empty-packet trap, verified (original defect 1)

This was the most serious original defect and it is **genuinely closed**. The
rehearsal reproduced the trap and then followed the corrected check exactly as
written.

**The trap still exists in the product.** A natural sender query —
`duplicate charge webhook retry idempotency key`, ordinary wording for the work
— produced:

- exit 0, a valid mode-`0600` packet, **3,171 bytes**, `0` omissions;
- a token-free receipt that looks perfect
  (`{"kind":"CampfireHandoffReceipt",…,"bytes":3171,"omissions":0}`);
- helper exit 0, and a sanitized evidence record that is structurally
  indistinguishable from a good one;
- `records: []`; `completeness.recall`: current 0/0, historical 0/0,
  artifacts 0/0; `decisionSet`: `total 0, returned 0, truncated true,
  state "truncated"`; `omissions: []`;
- anchors that are **not** query-filtered: `openTasks 1/1`,
  `acceptedDecisions 1/1` — the packet still carries a task and an accepted
  decision id under `anchors` even though no record matched.

**The repaired check catches it, at the first bullet.** The check as written
(runbook Step 4):

> **Pre-transport content check — required, before the commit and before
> transport.** … Confirm from the evidence record that the packet carries the
> handoff:
>
> - `records` is **not empty** — the record lists them, and the human rendering
>   prints `Records (n)`.
> - The ids the handoff is about are present: in `records[].id`, or, for a
>   decision, in `decisionSet.members[].id` (the set is independent of paging)
>   or as `decisionSet.operativeDecisionId`. …
> - Read the counts too: each recall section's `returned` / `total` /
>   `truncated` under `completeness.recall`, each anchor's count, the decision
>   set's `returned` / `total` / `truncated`, and `omissions`. `returned: 0` in
>   every section is the empty packet however good the receipt looks.

The first bullet fails decisively (`records: []`); the second fails; the third
fails on all three recall sections. The helper's human rendering was verified
and does print `Records (0)`. An operator who reads the counts before `records`
can be briefly misled by the nonzero anchor counts, but the first bullet is
first and decisive, and `returned: 0` in every recall section is unambiguous.

**The operator has a defined, rule-compliant action, and it was exercised.** The
same Step 4 text says:

> If the check fails, **do not transport the packet**, and **do not re-issue
> it**: re-issuing is a re-run (§7.9) … close it with no resulting work — the
> checklist's §3.1.4 line (runbook §7.1 item 8) governs the disposition,
> because the handoff never reached the recipient — and append the row
> (Step 10). A failed check is a recorded result (§7.14, §8), not a gap and not
> a plumbing detail to fix quietly.

`§7.1 item 8` exists and its disposition is
`inadmissible — §3.1.4, §5.4: no resulting work`. I filled Case 1's file with
the failure, closed it on that disposition, and appended the row in the temp
stand-in. This is compliant with protocol §7.14 ("nulls are recorded at the same
rigour") and §8 (a failed observation is recorded as one).

**Caveat, carried as new defect 2 below:** the failure path does not say whether
the same workspace and participants can support a new enumerated case, and
precondition 3's text and consequence column point different ways on exactly
that question.

---

## Status of the 19 original defects

Ordered as in `REHEARSAL.md`. "Fixed" means the repair was verified against the
current text and, where the defect was about instructions, by attempting to
follow them.

| # | Original defect (short) | Status | Current text and verification |
| --- | --- | --- | --- |
| 1 | Empty packet silently reaches the recipient; no pre-transport content check | **Fixed** | Step 4: "**Pre-transport content check — required, before the commit and before transport.** … `records` is **not empty**". Verified by producing a genuinely empty packet (exit 0, 3,171 bytes) and running the check as written — it fails at the first bullet; the operator's action (do not transport, do not re-issue, close per §7.1 item 8, append the row) is defined and rule-compliant. See the section above. |
| 2 | Plan-time stop rule contradicts §5's "filled at issue" | **Fixed** | Step 1 closing: "**Open establishes the case; issue completes the pre-action position. Neither may be backfilled after the outcome.** … The operative test under §6 is that the entry is **captured before the outcome is known**, not that every field is known at open." The old "If you cannot fill a `[PLAN-TIME]` field at open, stop" is gone from both the runbook and `TEMPLATE.md`; the template preamble now says §4a and §5 "are filled at issue". Residual wording: "including the pre-action position only as far as it is available" is odd for §5, which is never available at open, but the next sentence resolves it. |
| 3 | Recipient must already be a workspace participant; runbook never says so | **Fixed** | Precondition 17: "The recipient is **already enrolled in the sender's workspace** as a participant with `workspace:read`. The Step 3 command authorizes the recipient before it projects anything; a recipient who is not a participant fails there and no packet is written." Step 3 repeats it: "**Both sides must already be participants.**" Verified twice: a missing actor produced `ActorNotFound`; an existing but unenrolled human produced `ParticipantRequired`; in both cases no packet file was written. |
| 4 | Step 3 omits the acting identity; the CLI's default can issue as someone else | **Fixed** | Step 3: "**Run it as the sender, explicitly.** `--actor` / `--type` are the acting identity … When neither is supplied the CLI resolves a built-in default (`hum_sergio`, type `human`)". The command block now carries `--actor`/`--type`; precondition 18 and §4a's "Acting identity run as" record it. Verified: the issued packet's `issuer` is the sender agent; a run with no identity flags resolved `hum_sergio` and failed with `ActorNotFound` in the temp DB (on a prepared machine, where `hum_sergio` exists, it would issue as that actor — the warning is accurate). |
| 5 | §5 asks for a "reported sourceCursor" the evidence record does not carry | **Fixed** | `TEMPLATE.md` §5: "The record carries no cursor string; it carries the cursor **decoded**, so record the decoded fields it supplies", with printed slots for `decoded`, `position`, `phase`, `tip`, `workspaceMatches`, `matchesSourcePosition`. Verified by filling §5 from the real record (`decoded: true, position: 24, phase: high, tip: 0, workspaceMatches: true, matchesSourcePosition: true`). |
| 6 | §6 Task names three different texts; no slot for the query | **Fixed** | Step 1 item 5: "The sender's `--query` is not this field — it is recorded at Step 3 and carried by the evidence record in §4a." Step 5: "The sender's Step 3 `--query` is a different string: it is the packet's matching key, not the task". `TEMPLATE.md` §6 now has the H lines and states the query lives in §4a. Verified by filling both (query `provider` in §4a; the handoff request in §6). |
| 7 | "Tick every line" impossible: §1 had 22 preconditions, the check 9 lines | **Fixed** | Step 1 item 3: "The check prints one numbered line per §1 precondition, in §1's numbering: tick each line in §1's tables, write the same answer and the one-line reason on the matching line of the check, and date the check." Verified mechanically: runbook §1 has preconditions 1–24 and the template's opening check has rows 1–24, one per precondition; all 24 were filled. |
| 8 | Superseded decision carried twice with contradictory projections; §5.4 described only one | **Fixed** | §5.1 rule 2: "A decision reached twice arrives in **two projections, and they are not interchangeable.** In `decisionSet.members[]`, a superseded decision is `section: historical`, `lifecycle: superseded`, **carries no `rationale`**, and carries a `historicalExplanation`. In `records[]`, the same decision's historical text — including its `rationale` — is carried as history." Verified against the packet: the superseded decision D1 in `records[]` has `rationale.present: true` and no `historicalExplanation`; in `decisionSet.members[]` it has `rationale.present: false` and a `historicalExplanation`. §5.3's "per projection" rule, §5.4's corrected first bullet, and the §10a note all match the artifact. |
| 9 | §5.1 forces safety fields into scope, then excludes fields the work does not bear on; no "not borne on" verdict | **Partly fixed** | Still both texts: rule 2 "**Every field carrying safety structure**, whether or not the work mentions it"; closing "A packet field the work product simply does not bear on is **not** in scope, and its absence from the work is **not** a mismatch." The repair added `TEMPLATE.md` §10a's "Fields considered and excluded" slot, which gives the judgment a place to be recorded, but §5.3 still offers only `match`/`mismatch` and the two runbook sentences still disagree for a work product that does not engage the decision set. My rehearsed work product *did* engage the decision set, so the conflict did not bite here; for a work product unrelated to decisions (e.g., a timeout/config change) it is undecided whether the safety fields are in scope. **This is the most serious remaining problem.** |
| 10 | "`workspace:read` basis" is undefined and unsourced; the command performs two checks | **Still open** | Step 3: "The `workspace:read` basis for the read behind the packet, one line per read (§6). The packet does not carry the authorization basis; only the operator does." No format, no example, no named source. The repair added the two-check description ("The command authorizes the issuer against `workspace:read` and then the recipient"), but not the field's shape. I improvised a sentence. Note for the record: the CLI emits authz lines on stderr (`{"event":"authz","allow":true,"actorId":…,"operation":"workspace:read","workspaceId":…}`) — an observable source the runbook never names. |
| 11 | Build defined for two participants who may not both have a build | **Still open** | `TEMPLATE.md` §4: "The Campfire package version and the git commit the participant ran against. Not the commit that adds this file." Singular; no treatment for one build/two participants or a non-git install. I filled one commit for both participants. |
| 12 | Step 6's "durable Campfire record" is the disqualifying restatement unless it enacts an action | **Still open** | Step 6 unchanged: "Qualifying shapes, in the owner's terms: a commit, a pull request, or a durable Campfire record." Protocol Amendment 4 supplies the dependent-action condition ("Copying with no dependent action is restatement and nothing else… Recorded `inadmissible`"), but Step 6 does not carry it and a runbook-only operator is told the shape qualifies without qualification. |
| 13 | "A reference a reviewer can check" undefined when the recipient's artifact is private | **Still open** | Step 6: "Location or id a reviewer can check: a commit sha, a PR number or URL, or a Campfire record id with its `created_at`." No rule for a recipient work product the reviewer cannot reach or that a different human principal does not want committed. The readiness audit still records this as an owner decision before the run. My rehearsal work product was a temp commit, deleted with the workspace — the reference is not reviewer-checkable outside the temp material, exactly the shape the rule does not cover. |
| 14 | Step 8 points at the wrong section (§6 instead of §7) | **Fixed** | Step 8: "§7 of this runbook, and record its results in §14a of `TEMPLATE.md`. **Before** any write-up." Verified: §7 is the checklist, §14a exists; I ran §7 and filled §14a. |
| 15 | "The date" of a non-versioned work product is undefined | **Still open** | Step 6: "The date, in ISO-8601. The date it was produced, **relative to** the packet's `generatedAt`." No rule distinguishing a commit date, a record `created_at`, or the date of an action; I used the commit date. |
| 16 | Standing-instruction status asked per participant; the template has one line | **Still open** | Step 5 asks "whether the standing `cite the record ids you relied on` instruction … was in effect **for each participant**"; `TEMPLATE.md` §14 still prints one line: "Standing `cite the record ids you relied on` instruction in `src/mcp/instructions.ts` in effect: yes / no." One yes/no cannot hold both sides (the offline recipient has no Campfire session; the sender may). |
| 17 | An H case's workspace is recorded in the observation but the log says `—` | **Still open** | `LOG.md`: "**Workspace** — workspace id (B) or `—` for an H case whose reuse crossed a workspace boundary, which §5.3 says cannot materialize." `TEMPLATE.md` §3 records the id and name; the runbook never says which the row takes. Exercised: §3 carries `ws_d44801f895e34ecd`; I wrote `—` in the row per the log's rule and noted the conflict. |
| 18 | Bookkeeping conventions not supplied | **Still open** | Step 1 item 7: "**Commit the opened file.**" No branch, message, authority, or no-commit-rights rule; the `<nnn>` width, the `gate-e-<YYYYMMDD>` timezone, and the source of `Case <n>` are still undefined. I improvised 001, UTC, a temp repo, and case numbers from the register order. |
| 19 | §8.1 mixes disposition and verdict vocabularies | **Still open** | §8.1, "The recipient never opened the packet": "Run §7. Disposition `inadmissible` or `null` as the clauses require." `null` is a verdict label (Amendment 2), not a disposition; copying the phrase into the log creates an invalid row. |

**Counts: 9 fixed, 1 partly fixed, 9 still open.** The nine fixed are exactly the
minimum fix set's items plus the Step 8 pointer (defects 1–8 and 14); the
remaining nine are the pre-existing gaps the minimum set did not claim to close.

---

## New defects introduced or revealed by the repairs

1. **The worked example still promises the old abbreviated opening check.**
   *Step: runbook §6.1.* The repaired template asks for a 24-row check ("The
   check prints one numbered line per §1 precondition, in §1's numbering"),
   but the illustration still opens "Opening check, in the abbreviated form the
   template asks for:" and prints a 10-line list. An operator copying the
   illustration under-fills the check; the committed artifact would not show
   the answers the runbook's Step 1 item 3 and template require. This was
   introduced by the repair (the check was repaired; the illustration was not).

2. **A failed pre-transport check consumes the workspace and participants, and
   the runbook does not say so.** *Steps: 3–4 failure path, precondition 3.* The
   repair says "do not re-issue it" and "close it with no resulting work", but
   neither it nor §7.9 says whether the same workspace and participants can
   support a new enumerated case. Precondition 3 is "This is the **first**
   attempt with this workspace and these participants", and its consequence
   column says a second attempt "is a different case, and it must be enumerated
   on its own" — the precondition marks that case disqualifying while its own
   consequence text tells the operator to enumerate it. After an empty packet,
   the operator either abandons a real workspace or opens a case that fails at
   precondition 3. The failure path is new, so the tension is now operative.

3. **The post-handoff checklist's §7.5 item does not ask §7.5's question.**
   *Step: §7.1 item 4.* It asks "Is anything in the chain **inside a seeded
   fixture**, `fixtures/**`, or `docs/evidence/rcl-00*/**`?" while the clause
   it cites (§7.5) also disqualifies "any workspace created for the purpose of
   the measurement". A workspace created for measurement outside `fixtures/**`
   answers "no" to the item even though §7.5 disqualifies it. Precondition 7
   catches that workspace at open; the post-handoff check cannot independently
   catch it. Pre-existing, revealed by walking the checklist against a temp
   workspace that is exactly that shape.

4. **The empty packet's decision set reports `truncated: true` with zero
   members, and the new check tells the operator to read it.** *Step: Step 4
   content check, third bullet.* The check says to read "the decision set's
   `returned` / `total` / `truncated`"; a zero-match packet emits
   `decisionSet: {total: 0, returned: 0, truncated: true, state: "truncated"}`
   — the writer's kept-zero-members branch reports "a decision set existed and
   is unread". The first bullet (`records` not empty) still decides, but the
   `truncated` signal suggests unread safety state where none exists. The root
   is product-side; the new check is what surfaces it.

5. **The failure path does not route to the observation write-up.** *Step: Step 4
   failure path.* It says "close it with no resulting work … and append the row
   (Step 10)" but not to complete the closing fields or §14a; §7.3 says
   "Whatever the checklist finds, the case is written." An operator following
   the failure path literally can append the row without completing the
   observation's closing sections, thinning the committed record for exactly
   the case the repair was built to record. Minor.

---

## Template and protocol defects encountered

### Original 10 template defects (`REHEARSAL.md`)

| # | Original template defect | Status |
| --- | --- | --- |
| 1 | No slot for the packet-evidence record | **Fixed** — §4a added, with issue details and a paste block |
| 2 | No slot for the disqualification checklist | **Fixed** — §14a added |
| 3 | §2 is one participant table | **Fixed** — sender and recipient blocks |
| 4 | §5 has no `N/A` line | **Fixed differently** — P/N lines with `/ —` shapes and an H block; nothing is left blank |
| 5 | §6 scoped to P/N; query has no field | **Fixed** — H lines added; query lives in §4a |
| 6 | §7 claim-N section has no printed `N/A` line | **Still open** — the prose says "For P and H this field is `N/A` with a reason", but the only printed block is the Basis 1/Basis 2 menu |
| 7 | §9 menu has no printed `N/A` line | **Still open** — same shape as #6 |
| 8 | §10 cannot carry §5's required outputs | **Fixed** — §10a added with selection, verdicts, exclusions |
| 9 | §10's excerpt gives no bound or format | **Still open** — §5.2 gives sanitize rules, not a size bound or a format for the operator's hand copy |
| 10 | §11 "next action taken" undefined for H | **Still open** — the shape still presumes "the record or the plan"; I improvised from the work product |

### New template gaps encountered

- **Opening-check row 11 has no dedicated answer slots.** The runbook says
  "Both identities, roles, and the Amendment 5 safeguards are recorded in the
  opening check before opening", but the row's answer cell is only
  `<none / role — one line why>`; the sender/recipient ids, principals, and
  work/repository line exist as shapes inside the precondition cell. Workable
  for a no-owner case (answer "none"); thin for an owner-involved case.
- **§14's standing-instruction line is one yes/no** — the same shape gap as
  runbook defect 16.

### Protocol ambiguities from the first rehearsal (8)

| # | Original ambiguity | Status |
| --- | --- | --- |
| 1 | Amendment 1 vs the record's shape (cursor string not carried) | **Resolved** — Amendment 1 plus the template's decoded-cursor slots; `matchesSourcePosition` verified `true` |
| 2 | §6 Participant row singular; Build plural | **Still open** — the log column is still singular; the template's §2 was fixed, the protocol table was not |
| 3 | §6 "bounded content" has no bound | **Still open** |
| 4 | §7.13 reviewer access to a private work product | **Still open** (readiness-audit item 1) |
| 5 | §3.2 restatement vs Amendment 4 | **Resolved for H** — Amendment 4's dependent-action line |
| 6 | §5.3/§5.4 assume one projection of a decision | **Resolved in practice** — the runbook's per-projection rules and the §10a note; the protocol text itself is unchanged but does not conflict |
| 7 | §7.2 standing instruction per observation vs per participant | **Still open** — one template line |
| 8 | §3.1.4 "dated, recipient-authored" for a non-versioned action | **Still open** |

The protocol blob is unchanged from the first rehearsal (`69cb9e1a`); the
repairs touched the runbook, template, README, audit, and rehearsal only. The
README's owner-dogfooding sentence (readiness-audit Finding 1) was corrected in
`3fc1ae3` and now matches Amendment 5.

---

## The record-carrying packet and the §5 comparison, as executed

For completeness, because the repairs touched the comparison rules:

- The second packet (query `provider`) was valid: 5,940 bytes, mode `0600`,
  0 omissions; helper exit 0; `records` 4; recall current 3/3, historical 1/1,
  artifacts 0/0; `decisionSet` 2/2, `state: linked-accepted-decisions`,
  `operativeDecisionId` = D2, `linkedNextStep` present; `omissions: []`.
  The pre-transport check **passes** with the four expected ids present.
- The recipient's work product (invented stand-in, temp git commit) enacts the
  operative decision D2, treats D1 as superseded — and, deliberately, uses
  D1's superseded rationale as the live justification for the key.
- §5 was executable as written: selection by the work, per-projection verdicts,
  the retained excerpts in §10, the table in §10a. The repaired §5.4 first
  bullet catches the exact RCL-003 S2 shape ("a superseded decision's rationale
  applied as a live condition") → `mismatch`. §5.5 then yields a partial
  correspondence → `weak` if the case were admissible (this one is inadmissible
  on the checklist: the rehearsed outcome was known at open, §3.2).
- Judgment calls the operator still has to make unaided: a paraphrase ("the
  provider redelivers each payment event up to three times with jitter") is
  consistent with a record whose packet text was truncated at "…when our end";
  and the work names a log (`payments-webhook.log`) that the packet does not
  carry at all (the artifacts section is empty). Both were recordable as
  exclusions/notes, but neither is anticipated by the runbook.

---

## What genuinely works, so the fix effort stays proportionate

- **The product path is solid.** `campfire handoff-packet` wrote one mode-`0600`
  file per packet; the receipt's byte count equals the file exactly (5,940 and
  3,171); overwrite is refused ("Refusing overwrite"); the receipt is token-free
  and carries no issuer; both authorization checks appear in the authz log
  (issuer, then recipient); the explicit `--actor`/`--type` path issued as the
  sender and the packet's `issuer` confirms it; a non-participant recipient
  fails before any file is written.
- **The helper is exemplary against the runbook's requirements.** Exit 0 on
  both packets; byte-identical output across two runs of the same packet (both
  packets); the record matched the packet on every field cross-checked
  (`packetBytes` vs file size, `workspace.id`, `generatedAt`, `sourcePosition`,
  record ids/counts, `decisionSet.state`); it copies no record text except the
  bounded `query.text`, `workspace.name`, `goal.*`, and omission lines; the
  decoded cursor and `matchesSourcePosition` make Amendment 1's substance
  checkable; the human rendering prints `Records (n)` exactly as the runbook
  says.
- **The corrected capture sequence is executable end to end.** Steps 1–4 were
  walked literally: the 24-row opening check, the two participant blocks, §4a's
  issue record and paste block, §5's decoded-cursor fill, §6's handoff request,
  the pre-transport check, and the failure path for the empty packet. No step
  required a value that does not exist.
- **The repaired comparison vocabulary works where it lands.** Per-projection
  verdicts are executable, the superseded double-projection rule matches the
  artifact exactly, and §5.4 catches the S2 failure the protocol most cares
  about.
- **The failure path is rule-compliant.** Closing the empty-packet case as
  `inadmissible — §3.1.4, §5.4: no resulting work` follows §7.1 item 8 and
  §7.14/§8; the row is still appended; nothing is re-run.
- **The template now has the four slots the first rehearsal asked for**: the
  evidence record (§4a), both participants (§2), the selection/verdicts (§10a),
  and the checklist (§14a) — all four were filled without editing the template's
  shapes.

---

## Bottom line

**Counts.** 19 original defects: **9 fixed, 1 partly fixed, 9 still open.** Five
new defects introduced or revealed by the repairs (two introduced, three
revealed/repaired-path). Of the original 10 template defects, 6 are fixed or
fixed differently and 4 remain; of the 8 protocol ambiguities, 3 are resolved
and 5 remain.

**Most serious remaining problem: defect 9 — the §5.1 safety-scope conflict.**
Rule 2 forces every safety-structure field into scope "whether or not the work
mentions it", the closing sentence excludes fields the work does not bear on,
and §5.3 has no "not borne on" verdict. The new §10a exclusion slot gives the
judgment a place to live but does not resolve it, and the choice can change a
case's verdict (a false mismatch, or a missed superseded-rationale failure).
Before a real handoff whose work product does not engage the decision set, the
operator needs a ruling on which sentence governs.

**Runners-up:** the private-work-product retention gap (defect 13, which the
readiness audit already flags as a pre-run owner decision), and new defect 2
(an empty packet leaves the workspace/participants' future undefined).

**Readiness assessment.** The minimum fix set works. The runbook's capture path
is executable end to end, the empty-packet trap is genuinely closed, and the
failure path is defined and compliant. The remaining defects are mostly the
pre-existing gaps the minimum set did not claim, but defect 9 is a genuine
comparison-scope conflict and defect 13 needs a retention decision before the
first real case. Ready to run with those caveats named; not yet clean.

*(This report creates no observation and changes no rule. Gate E remains
unmeasured.)*
