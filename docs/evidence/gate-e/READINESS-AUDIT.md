# Gate E readiness audit — can a real claim-H case be opened?

**Verdict: Yes — a real claim-H case can be opened now without repairing any rule that decides admissibility; two text repairs should precede the run because they can misdirect the operator (the directory README still calls owner dogfooding inadmissible, and the runbook's Step 1 says a `[PLAN-TIME]` field must be fillable "at open" when §5, by the apparatus's own design, can only be filled at issue).**

- **Audited at:** `0e0693d` ("Allow owner participation in genuine Gate E handoffs"), clean tree.
- **Scope:** `docs/GATE_E_PROTOCOL.md` and its five §12 amendments; `docs/evidence/gate-e/HANDOFF-RUNBOOK.md`, `TEMPLATE.md`, `LOG.md`, `README.md`, `RED-TEAM-REVIEW.md`; `fixtures/recall/decision-set-recheck/CLASSIFIER-REVIEW.md`; `scripts/gate-e/packet-evidence.ts` and its README; the frozen RCL-003 packets as inputs only.
- **Method:** documents read in full and cross-compared; the helper was executed against crafted packets written outside this repository and deleted afterward. No Campfire agent or harness was run; `~/.campfire-pilot/` was not touched.
- **This file is an audit, not an observation.** It opens no case, drafts none, and adds no row to `LOG.md`. Verified: zero case rows, zero enumeration rows, zero `gate-e-observation-*.md` files. Gate E stays unmeasured.
- **Severity** is ranked by whether a finding can make a real, honest case wrongly inadmissible or wrongly admitted.

---

## Findings

### 1. Material — the directory README still says owner dogfooding does not qualify, contradicting Amendment 5

**What disagrees.** The README's "Pre-observation clarifications" says, in the present tense and without an amendment pointer:

> Owner dogfooding may be retained as an inadmissible case with a `reported` item; it does not qualify as ordinary multi-participant evidence.

Amendment 5 records the opposite for claim H:

> **Owner ruling.** The repository owner chose the narrow scope for claim H: "Allow owner in genuine handoffs." … It resolves Amendment 3 for H, including cases where the owner is the sender and cases where the owner is the recipient.
>
> **Rule.** Owner participation alone does not disqualify a claim-H case when all of the following are true …

**Which is operative and why.** Amendment 5. It is a dated §12 ruling; the README itself says "`docs/GATE_E_PROTOCOL.md` is the authority. If this directory and the protocol ever disagree, the protocol wins and this directory is wrong." The runbook (owner callout, precondition 11, §7.1 item 5, §8.1 row) and the template (opening check owner line, §14 owner line) were both updated to Amendment 5. The README was not touched by `0e0693d` or `53511d3`.

**Consequence for a real case.** The README is the directory's front door, and this sentence reads as current. A reader who follows it can wrongly withhold the exact case Amendment 5 authorizes, or record a valid owner-involved handoff as `inadmissible — §3.2: owner dogfooding`. The case would be valid; the exclusion would be wrong. This is the one statement in the apparatus that treats owner involvement as automatically inadmissible. Repair is one dated correction in the README's own "Corrections" section.

**Secondary staleness, same file, non-operative.** The README's contents table lists only `LOG.md` and `TEMPLATE.md`, and its opening says the directory holds "the log, the template, and — currently nothing else". The directory now also holds `HANDOFF-RUNBOOK.md` and `RED-TEAM-REVIEW.md`. A navigator will not find the runbook from the README.

---

### 2. Moderate — plan-time timing is stated inconsistently: "at open" versus "before the outcome is known"

**What disagrees.** Three texts say a `[PLAN-TIME]` field must be fillable at the moment the case opens:

> **If you cannot fill a `[PLAN-TIME]` field at open, stop.** A case opened without one is inadmissible under §6, and §6 says so without an exception.  — `HANDOFF-RUNBOOK.md` §1 closing

> Do not fill a `[PLAN-TIME]` field later; a case opened without one is inadmissible under §6.  — `TEMPLATE.md` preamble

The same runbook, three items earlier, and the protocol say when §5 is actually filled:

> §5 Pre-action position is filled from the packet's own read at issue — the read the Step 3 command performs, as carried in the Step 4 packet-evidence record — dated to that moment.  — runbook Step 1 item 6

> **Fill §5 Pre-action position now**, from this read's `sourcePosition` / `sourceCursor` as carried in the record, dated to the issue time … Commit the observation file again before transporting the packet. The plan-time record is now complete and dated, and the outcome is still unknown.  — runbook Step 4

> Fields marked **[plan-time]** are captured before the outcome is known. … A missing required **[plan-time]** field makes the observation inadmissible under this protocol.  — protocol §6

And the runbook's own sequence says "Steps 0–1 happen before the packet exists."

**Which is operative and why.** Protocol §6, as read by Amendment 1 and executed by the runbook's items 6 and Step 4: the test is captured-before-the-outcome, plus not missing at adjudication. The "at open" sentences cannot be literally satisfied — §5 does not exist before the packet is issued — so they cannot be the rule. The runbook's own precedence clause ("Where this runbook and the protocol disagree, the protocol wins and this runbook is wrong") also resolves it toward §6.

**Consequence for a real case.** An honest operator following the bold sentence can pause ("I cannot fill §5, stop") or, worse, backfill §5 from the only read available at open — the sender's earlier orientation cursor — which is exactly the reading Amendment 1 forbids and which the runbook Step 2 now also forbids. A hostile reader can quote the bold sentence to argue the case was "opened without" a plan-time field. Under the operative text the case is valid if §5 is written at Step 4 and committed before the outcome, which is what the runbook's item 6 and Step 4 instruct. The same timing applies to §6's Task when the handoff request is spoken at delivery (Step 5: "If the handoff was spoken, write down what was said, verbatim, at the time. This is §6's `[plan-time]` Task for H."). Repair: replace "at open" with "before the outcome is known" in both sentences.

**Related annotation gap.** Amendment 1 names `TEMPLATE.md` §5 as a place the H rule applies, but the template's §5 shape still reads "the `sourceCursor` / `sourcePosition` reported by the read the participant used" with no pointer to Amendment 1, while §15 carries a pointer for Amendment 2. The runbook carries the Amendment 1 rule in three places (Step 1 item 6, Step 2 note, Step 4), so a runbook-followed case is filled correctly; a template-only fill can name the sender's earlier read and misstate the `[PLAN-TIME]` position.

---

### 3. Minor — the helper still asserts three things it does not check, and still refuses a valid packet on a proven false positive (GE-13, GE-14)

All four behaviors below were re-verified by execution at `0e0693d`; none is covered by `tests/unit/gate-e-packet-evidence.test.ts`.

**GE-13(1) — authority is presence-checked, not content-checked.** The red team: "A packet with `authority: "safe to execute"` exits 0 and the record still states the authority disclaimer is present." Current code checks only `typeof packet.authority === "string" && length > 0` and emits `authorityPresent: true` hardcoded. Probe result: exit 0, `"authorityPresent":true`, with the field's content never compared to the domain's frozen sentence (`src/domain/recall.ts:276`).

**GE-13(2) — the record can contradict itself.** The red team: "a packet setting it `true` exits 0 and produces a record that contradicts itself: `completeness.fullHistoryIncluded: true` beside `receipt.fullHistoryIncluded: false` (the latter hardcoded)." Probe result: exit 0, both values present as described. The top-level `packet.fullHistoryIncluded` is asserted false; the nested `completeness.fullHistoryIncluded` is only copied.

**GE-13(3) — duplicate decision-set member ids pass.** The red team: "Duplicate decision-set member ids pass." Probe result: exit 0, the record lists the same member id twice.

**GE-14 — a valid packet can be refused with a misleading reason.** The red team: "It has no notion of provenance, so a coincidental collision with a field the record legitimately copies trips it — and the stderr message … is false in that case." The behavior is now *documented* in `scripts/gate-e/README.md` ("This one **can** fire on a well-formed packet, and when it does its reason is misleading") rather than fixed. Probe result: with `records[0].text` set to `goal.title`, exit 1 with `INVALID — the record would carry 1 packet text field(s) verbatim`.

**Which is operative.** The helper is the §9 sanitized account. Its README states the intended guarantees; the red team's remedies (compare `authority` to the domain literal, assert the nested flag false, require unique member ids, exclude copied-by-design fields from `packetTextValues`) remain unimplemented and untested.

**Consequence for a real case.** Today's packet writer is correct, so an honest case is not corrupted by GE-13's gaps; a regression or crafted packet can produce a record that certifies structure it never checked. GE-14 is the one with an honest-case path: a finding whose summary coincides with the goal, query, workspace name, or an omission line gets refused, and runbook §8.2 then tells the operator to record the exit and treat the sanitized field account as incomplete — a valid handoff can be pushed toward an inadmissible disposition by a false positive the operator cannot repair without re-running (§7.9) or re-issuing the packet (forbidden). Rare, but real; the fixes are cheap.

---

### 4. Minor — template hardening gaps from the red team remain, and the two opening-check lists diverge

**GE-08 (no commit binding).** The review's remedy: "Add `Opened commit: <sha>` to §1 and `Closed commit: <sha>` to §15 … Add a line to §15's retained-evidence check: `Plan-time fields match the opened commit: yes / no`." The template carries none of these; its retained-evidence check still asks only "Plan-time entries dated before the outcome: yes / no". The runbook commits the file at open (Step 1 item 7) and again at Step 4, so Git history supports the check — but the file does not point a reviewer at the commit.

**GE-09 (selection invisible).** The review: add a per-field table and "`Fields considered and excluded: <list> — reason`" to §10. Template §10 still records one boolean (`Correspondence verified: yes / no / unresolved`). The runbook §5.1/§5.5 requires the per-field selection and verdicts in the observation, so the required content exists only when the operator follows the runbook; a reviewer reading the file alone cannot see why fields were chosen.

**GE-10 (one participant table).** The review: "Make §2 a two-row table (`issuer` / `recipient`) for H, and mark §14's standing-instruction line as per-participant." Template §2 is one table of one participant's keys; §14's standing-`cite` line is one yes/no. The runbook says to fill the sender's identity now and the recipient's when known, and to record the standing-instruction status for each participant, so a careful operator improvises a second row set — but the instrument does not separate the two participants, and the standing-instruction answer can describe only one side.

**GE-11 (ordering not in the file).** The review: add `Produced after the packet's generatedAt and after Opened: yes / no — <dates>` under §10, disqualifying on `no`. Template §10 has only `Date:`. Runbook Step 6 and §8.1 do require the ordering check, so the runbook-covered case is fine.

**GE-07, partially applied.** The template now has the §3.1.3 real-dependency opening line and §15's `Label follows from` binding. The review's three §3.2 opening lines were not added; they live in runbook §7.1 items 1-3 instead. `supports` remains self-assessed; the only guard is the template's prose, "A `supports` label with no such field is a claim the file does not carry."

**Opening-check drift.** The template's committed opening check (9 lines) and the runbook's precondition tables (22 lines) are not the same set. The runbook has no §3.1.3 line that the template added; the template has no enumeration acknowledgment (§7.1), no general recipient-own-work line (§3.1.1/§3.1.4, present only inside the owner clause), and no no-answer-message line. Runbook Step 1 item 3 has the operator run the template's check, so both get exercised in practice; the committed artifact, however, does not show the answers the runbook's extra preconditions require.

**Consequence.** None of these invalidates a case run per the runbook. They thin the committed record: a reviewer can lose the field-selection rationale, the work-product ordering, the second participant's environment, and any pointer to the plan-time commit. A reviewer relying only on `TEMPLATE.md` would reproduce the gaps.

---

### 5. Minor — the log's status captions and case numbering will go stale at the first case (GE-15, GE-16)

**GE-15.** `LOG.md` says "It is append-only. A wrong row is corrected by appending a dated correction, never by editing the row", and carries hand-maintained `**Rows: zero.**` captions under both tables plus a `**Status:** **Zero observations.**` header. Nothing tells the operator what to do at the first append: the captions become false, and the append-only/correction rules govern rows and cells, not captions. The log's "Record" column also explicitly permits `—` "when the case opened and no file was written", so a completed row need not point at an artifact.

**Case numbering.** The log defines "**Case** — sequence number in the enumeration register, assigned at open", but the register has no number column and lists candidates, not opened cases. If a candidate is screened out, the first opened case's number and its register row ordinal diverge; a reader cannot cross-reference by number.

**GE-16.** No denominator: a handoff considered and screened out before enumeration leaves no trace, and the register itself only records candidates someone chose to write down. Open by design; the honest limit is stated here so the owner can decide whether a dated "candidates screened" note is wanted.

**Consequence.** The log's own text will contradict its table at the first case until someone decides how to maintain the captions. No admissibility effect.

---

### 6. Minor — Amendment 2 did not annotate §1's and §8's permissive "may", which it makes mandatory

**What disagrees.** Protocol §1:

> An agreeing Basis 2 reconstruction therefore gives a claim-N case a `null` verdict and **may** give that reconstruction item the label `none`.

Protocol §8:

> The case verdict is `null`; the reconstruction item **may** be labeled `none`.

Amendment 2:

> An agreeing Basis 2 reconstruction is recorded in both fields because it is two facts. … The item field stays at `n/a` only when no weaker item was retained, **never** when a reconstruction agreed … An agreeing reconstruction gives the case the verdict `null` and the reconstruction item the label `none` — **record both**, in these fields.

**Which is operative and why.** Amendment 2 is later, explicitly maps the fields, and the template §15 carries its pointer. §4.4 got an amendment note; §1 and §8 did not.

**Consequence for a real case.** A reader of §1 or §8 alone can leave the item field at `n/a` for an agreeing reconstruction. The case verdict is unaffected and the case is not invalid, but §7.14's "nulls are recorded at the same rigour" loses the item-level record. A one-line pointer at each site, as §4.4 has, closes it.

---

## Status of the adversarial reviews at 0e0693d

The red-team review is a snapshot at `4b9202b` with no fix ledger; this table is the status checked against the current code and documents. "Case impact" asks whether the open item can corrupt a real claim-H case.

| Finding | Status | Case impact if left |
| --- | --- | --- |
| GE-01 transition reconciliation | Fixed (code + tests) | — |
| GE-02 template pass-values | Fixed (§15 derived Gate E line, conservative-first menus, angle brackets) | — |
| GE-03 credential anchor | Fixed (regex + tests) | — |
| GE-04 path/URI shapes | Fixed (rules + tests) | — |
| GE-05 truncation self-refusal | Fixed (marker + char bound + tests) | — |
| GE-06 lifecycle vocabulary | Fixed (kind-aware validation + tests) | — |
| GE-07 `supports` test | Partial: §3.1.3 line and `Label follows from` added; §3.2 lines live in runbook §7.1 | Thin evidence, no invalidation |
| GE-08 commit binding | Open | Plan-time integrity rests on Git history without a pointer |
| GE-09 selection record | Open in template; runbook §5 covers | Committed selection can be thin |
| GE-10 two participants | Open in template; runbook Step 5 covers | Second participant's fields improvised |
| GE-11 work-product ordering | Open in template; runbook Step 6 covers | Runbook covers |
| GE-12 item vocabulary | Fixed by Amendment 2 | — |
| GE-13 unverified assertions | Open (all three re-verified by execution) | Crafted/regressed packet can certify unverified structure |
| GE-14 false refusal | Open, documented in scripts README (re-verified by execution) | A valid packet can be refused; §8.2 then applies |
| GE-15 log captions | Open | Captions contradict the first row |
| GE-16 denominator | Open by design | No denominator |
| GE-17 helper tests | Fixed (`tests/unit/gate-e-packet-evidence.test.ts`) | — |

Classifier review: C-1 through C-4 have scoped rewrites and adversarial self-tests (the semicolon class now lands on the safe `indeterminate`, marked as a limitation in-file); C-7 now asserts details and evidence; C-8 added 19 adversarial cases; C-11's README drift was updated. C-5 (paraphrase past the vocabulary), C-6 (a false `indeterminate`), and C-9/C-10 (human discipline for `not-raised` and `requiresHumanRead`) remain, accepted and documented. **None of these can corrupt a Gate E case**: the classifier belongs to the unscored RCL-003 recheck fixture, and the runbook's H comparison is manual and invokes nothing from it. The recheck's disclosed loss of its original private trace (accidental rerun, `fixtures/recall/decision-set-recheck/RESULT.md`) is likewise outside the Gate E path.

---

## What the apparatus is silent on that a real handoff will force a decision about

1. **Reviewer access to an external work product, and the recipient's confidentiality.** §9 requires "a checkable reference to the recipient's resulting work"; runbook Step 6 suggests "a commit sha, a PR number or URL"; precondition 18 requires a plan for §7.13 readability. Nothing says what to retain or how to proceed when the recipient's work product lives where the reviewer cannot reach it, or when committing a separate principal's identity, work reference, and excerpts into this repository is not acceptable to them. The Amendment 5 case has exactly that shape — a different human principal on ordinary non-Campfire work. Decide before the run: a reviewer-visible artifact, a sanitized quoted excerpt of the dependent part of the work product, or no case under this setup.
2. **Who supplies the recipient's §2 agent fields.** For an agent recipient, §6 and template §2 require harness, version, model, reasoning setting, `agentSessionId`, and human principal. The recorder is usually on the sender's side (the runbook's Step 5 says capture them "now"), but no rule assigns the recipient responsibility for reporting their own environment, and `—` is only for values that "do not apply". The owner will have to agree with the other participant who collects this before opening.
3. **First-case log housekeeping.** See Finding 5: what happens to the "Rows: zero" captions and the enumeration denominator at the first append.

---

## What is sound and ready

- **The admissibility rules are coherent.** Claim shapes (§1), the verdict/item label split (Amendment 2, protocol §4.4, template §15, `LOG.md`), the two counterfactual bases (§4.2), the §7 rules, and §8's nulls all agree across the four documents. The wording that decides whether a case qualifies is unambiguous.
- **Amendment 5 is correctly traced.** The runbook's owner callout, precondition 11, precondition 16, §7.1 item 5, and §8.1 row; the template's opening-check owner line and §14 owner line; all carry the ruling. The fields the ruling requires ("role and safeguards recorded before opening") exist and are answerable: sender/recipient actor id and type, human principals, owner role, work and repository, disclosure. No other protocol text still treats owner involvement as automatically inadmissible except Finding 1's README sentence.
- **Amendments 3 and 5 read coherently.** Amendment 3 now carries a historical-status banner; its hold instruction is discharged for H and correctly left standing for P/N, which Amendment 5 does not decide. Amendment 3's four follow-up items (template line, runbook precondition 11, §7.1 item 5, §8.1 row) were all updated.
- **Amendment 1 is discharged in the runbook.** Step 1 item 6, Step 2's note, Step 3's `--cursor` text, the §3 capture table, and §9 item 2 all state the packet's-own-read rule correctly. Only the template §5 pointer is missing (Finding 2).
- **Amendment 4 reads the existing bullet and changes no operative rule.**
- **The helper's critical work is real.** GE-01, GE-03, GE-04, GE-05, GE-06, and GE-17 are fixed and tested; determinism holds; refusal reasons never quote the matched text; the frozen S2 rejection is discriminating; the record's structural/semantic split is honest about what it does not contain. The remaining defects are the minor residuals in Finding 3.
- **The template can be completed for a claim-H case under Amendment 5.** Walking it: every required field has an answer at the point the runbook fills it — including §5 at Step 4 from the packet-evidence record and the owner fields at open — provided the operator follows the runbook and not the literal "at open" sentence. No field is unanswerable; the defects are shape and annotation gaps, not missing answers.
- **The instrument's discipline holds at the start.** Zero cases, zero enumeration rows, zero observation files (verified). The pre-registered expectation is dated and attributed. Nothing in this audit opens a case.

This audit creates no observation and changes no rule. The only file it adds is this one.
