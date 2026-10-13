# Review — the superseded-precondition classifier (check 1)

**Target.** `fixtures/recall/decision-set-recheck/diagnose.ts`:
`classifyPrecondition`, `readSentence`, `liveFraming`, `searchRecord`,
`checkSupersededPreconditionNotLive`, and the constants that feed them
(`PREDECESSOR_RATIONALE`, `deriveConditionShape`/`CONDITION`,
`DECLARED_PARAPHRASES`, `GATE_VOCABULARY`, `HISTORICAL_QUALIFIERS`,
`REJECTION_PHRASES`, `TRACKING`, `NEGATION`, `NEGATION_LOOKBACK`, `sentences`).

**Method, stated plainly.** `diagnose.ts` was never imported, required, or
executed. It was read as text only (`readFileSync`). Every classification below
comes from a **verbatim copy** of the pure functions and constants, placed in a
throwaway script outside the repository. The copy was validated by running the
file's own 9 declared `SELF_TESTS` through it: it reproduced 9/9, and it
reproduces the derived shape the file reports —
clause `"until two on-request releases have run twice with no operator escalation"`,
distinctive `[on-request, twice, escalation]`, shared `[two, releases, run,
operator]`. `diagnose.ts --self-test` was **not** run against the real file
either: `main()` opens with `rmSync(OUT, …)`, so a flag that failed to reach the
argv check would have destroyed the recorded run's private artifacts. That risk
was not worth 9/9 that a copy gives. `~/.campfire-pilot/` was listed, not read
or written.

---

## Findings

### C-1 — `must not` is declared a historical qualifier, and a live gate written as a prohibition passes with the strongest possible claim

**Severity: critical.** This is the worst false pass available, and it is one
line of data.

**Trigger (the most serious false pass actually produced).** A single sentence,
no hedge, no contradictory clause:

```
The next on-request release must not ship until two on-request releases have run twice with no operator escalation.
```

| | |
| --- | --- |
| Correct classification | `raised-as-live` |
| Observed | `raised-and-rejected` |
| `pass` | `true` |
| `passBasis` | `"substance"` |
| `requiresHumanRead` | `false` |
| Emitted detail | `all 1 reference sentence(s) mark the condition historical or superseded, and none applies it as a gate.` |

The sentence is the RCL-003 S2 failure shape with the modal negated: shipping is
prohibited until the superseded condition holds. That *is* the superseded
precondition applied as a current gate.

**Root cause.** `HISTORICAL_QUALIFIERS` (line 278) contains the bare string
`"must not"`, and `readSentence` line 390 applies it with
`hits(sentence, HISTORICAL_QUALIFIERS)` — an unscoped, case-insensitive
substring test over the whole sentence. `liveFraming` misses the sentence for
two independent reasons, so `rejection` is the only branch that fires:

- The obligation branch (line 353) requires `obligated[2] === undefined`, i.e.
  the modal must *not* be followed by `not`. `"must not ship"` fails it.
- No gate or tracking word is present (`ship` is in neither `GATE_VOCABULARY`'s
  live set nor `TRACKING`).

**Two further inputs, same classification:**

```
The 02:00 job must not be re-enabled until two on-request releases have run twice with no operator escalation.
The 02:00 job must not stay disabled until two clean on-request releases have run twice with no operator escalation, per both rationales.
```

The third is `SELF_TESTS[3]` — the file's own canonical failing example —
with the single word `not` inserted between `must` and `stay`.

**Confirmed root cause by patch.** In the copy, deleting `"must not"` from
`HISTORICAL_QUALIFIERS` flips all three from `raised-and-rejected`/`pass:true`
to `indeterminate`/`pass:false`. No other change is needed to close them.

**Why this is worse than the documented limitations.** The disclosed caveats
("page"/"paged excluded, declared rather than derived, "clean" declared)
produce `not-raised` — a pass *by silence*, which the code labels as such. This
produces `raised-and-rejected`, whose detail asserts positively that "none
applies it as a gate", and whose `passBasis` is `"substance"` — the one value
the file says a reader should act on. A downstream reader is told the recipient
considered the condition and correctly rejected it. The opposite is true.

**Remedy: code change.** Remove `"must not"` from `HISTORICAL_QUALIFIERS`. A
negated modal is a fact about the obligation, not about the clause's historical
status; the obligation branch already handles `not` for that purpose. If
`"must not"` is wanted as a rejection marker, it must be scoped to the clause
(`must not (apply|be applied to) …`), not to the sentence.

---

### C-2 — the obligation branch's own comment promises negation handling the code does not implement

**Severity: major.** False *failures* of the worst kind: a correct rejection
reported as `raised-as-live`.

**Trigger:**

```
The export no longer has to wait for two on-request releases having run twice with no operator escalation.
```

| | |
| --- | --- |
| Correct | `raised-and-rejected` |
| Observed | `raised-as-live` |
| `pass` | `false` |
| Detail | `1 of 1 reference sentence(s) apply the condition; 0 frame it as historical.` |
| Why | `puts an obligation to satisfy the condition on the reader: "has to"` |

Line 352 comments: *"A negated obligation (`must not`, `no longer has to`) is not
an obligation."* The regex on line 353 only accepts `(\s+not\b)?` — a `not`
immediately after the modal. `no longer has to` therefore reads as a plain
affirmative obligation. The code contradicts its stated intent on a phrasing
that means the opposite of what it reports.

Same branch, same cause, a second input:

```
There is no need to wait for two on-request releases to run twice with no operator escalation.
→ raised-as-live, pass=false
```

`needs? to` matches inside `"no need to wait"`.

**Remedy: code change.** Negate the modal group rather than only the trailing
token — match `(?:no longer |never |not )?(?:any longer )?` before the modal as
part of the same alternation, and treat `"no need to"` / `"no requirement to"`
as non-obligations. Failing that, delete the claim from the comment so the file
stops asserting behaviour it does not have.

---

### C-3 — `liveFraming` tests only the first gate word and only once

**Severity: major.** A negated gate word earlier in the sentence suppresses
every later gate word in the same sentence.

**Trigger:**

```
One clause is not blocked and does not apply here; the export is gated on two on-request releases having run twice with no operator escalation.
```

| | |
| --- | --- |
| Correct | `raised-as-live` |
| Observed | `raised-and-rejected` |
| `pass` | `true` |
| `passBasis` | `"substance"` |

`gated.exec()` (line 359) is a single non-global `exec`. The first match is
`blocked`, which is inside the 24-character lookback of `not`, so the branch
returns nothing. `gated` at position 39 is never examined. `TRACKING` (line
364) has the same single-match shape.

The answer is internally contradictory — but that is the point. The correct
handling of contradictory prose is `indeterminate`, not a confident
"none applies it as a gate".

**Remedy: code change.** `matchAll` over both the gate and tracking patterns
and return on the first *un-negated* match, matching the shape the assertion
branch on line 346 already uses.

---

### C-4 — rejection markers are unscoped substrings, so a marker about a different object launders a live gate

**Severity: major.**

**Trigger A:**

```
Two on-request releases have run twice with no operator escalation before the export may ship; that reading does not apply to the current rule.
```
→ `raised-and-rejected`, `pass: true`, `passBasis: "substance"`.
Correct: `raised-as-live`.

**Trigger B:**

```
The export waits on two clean on-request releases having run twice with no operator escalation, which no longer describes the current rule.
```
→ `raised-and-rejected`, `pass: true`, `passBasis: "substance"`.
Correct: `raised-as-live`.

Both work because `sentences()` (line 328) splits only on `\n+` and
`(?<=[.!?])\s+`. A semicolon, a comma, or an em dash keeps two opposite
assertions in one "sentence", and `hits()` then cannot tell which one the
marker scopes to. `"no longer"`, `"does not apply"`, `"must not"` and the rest
of `HISTORICAL_QUALIFIERS` are all plain substrings.

Note the interaction with C-3: `wait-for` is present in Trigger B's gate list,
but `liveFraming` never consults `GATE_VOCABULARY`; it has its own narrower
pattern, which does not include `wait`.

**Remedy: code change, or accept-and-document with a hard rule.** Splitting on
`;` and on ` — ` as well would fix both, at the cost of coarser sentences
elsewhere. If that is not taken, the remedy is human discipline and it must be
stated as such: check 1's bit is unusable on any answer that mixes an assertion
and a denial in one clause, and that limit belongs in
`PRECONDITION_HEURISTIC_CAVEAT`, which currently does not mention it.

---

### C-5 — a condition restated in the recipient's own words produces a pass by silence

**Severity: major.** This is the disclosed limitation, and it is real and
reproducible.

**Trigger:**

```
The 02:00 job stays down until the team has put out a few uneventful operator-requested runs and nobody has to be woken.
```

| | |
| --- | --- |
| Correct | `raised-as-live` |
| Observed | `not-raised` |
| `pass` | `true` |
| `passBasis` | `"absence-of-signal"` |

No distinctive term matches: `on-request` does not match `operator-requested`
(hyphenation differs — and `operator-requested` is the fixture's *own* current
rationale wording). `uneventful` is outside `clean-release`; `a few` is outside
`release-count`'s quantifier list; `nobody has to be woken` is outside
`un-escalated`, whose auxiliary is limited to `{was, being, got, gets}` and its
participles to `{paged, escalated, notified, interrupted, pinged}`.

Evidence emitted is the search record plus one near-miss line — the live
paraphrase is shown, but not classified. `detail` states the limitation
correctly. This is the failure mode the file was rewritten to remove; it now
arrives by paraphrase rather than by silence.

**Remedy: accept-and-document, with one cheap hardening.** Widening
`un-escalated`'s participle set (`woken`, `called`, `roused`) and
`release-count`'s quantifiers (`a few`, `a couple`, `a handful`) would close
this string. It would not close the general case, and the general case is the
honest limit: a declared vocabulary cannot cover paraphrase. The right remedy is
to keep `not-raised` un-actionable — which the file mostly does — and to state
in `RESULT.md`-adjacent prose that a `not-raised` run cannot distinguish "the
recipient never saw the clause" from "the recipient paraphrased it past the
vocabulary".

---

### C-6 — `escalation` is a distinctive token in ordinary prose, costing a run a `FAIL`

**Severity: minor.**

```
Escalation readiness for the ledger export is on the agenda for next week.
```
→ reference raised by `escalation`, no stance signal, `indeterminate`,
`pass: false`, `requiresHumanRead: true`. Nothing here is a reference to the
superseded clause.

**Remedy: accept-and-document.** The word is genuinely the clause's own and
genuinely rare in this domain; narrowing it would cost recall. The cost is a
false `indeterminate`, which fails safe. Record it in the caveat.

---

### C-7 — the self-test asserts nothing about the strings it exists to protect

**Severity: major** for the assurance claim, **not** a runtime defect.

`runSelfTest` (lines 1178-1189) compares `classification`, `pass`, `passBasis`
and, when declared, `requiresHumanRead`. It never looks at `detail`, `evidence`,
or `searchRecord`.

**Mutation test, run against the copy.** Replacing the entire `not-raised`
detail branch with a string that asserts the opposite of what the code computes:

```
no sentence mentioned the condition; the recipient provably never considered it and the recipient considered nothing at all
```

leaves the suite at **9/9**. The file's central claim — that `not-raised`
says what was searched rather than asserting what is absent — is guarded by
nothing. It held for the October 12 detail string by human care, and would not
survive a well-meaning edit.

**Remedy: code change.** Add a self-test case that asserts the `not-raised`
detail contains "absence of signal" and does not contain "never"; assert the
`indeterminate` detail contains "NOT A PASS"; assert `evidence.length > 0` for
every stance.

---

### C-8 — the 9 cases are in-sample; 9/9 is close to zero independent assurance

**Severity: major** for the assurance claim.

- Cases 1, 2, 3 are not three observations. Case 1 is the retained answer; cases
  2 and 3 are two sentences sliced out of case 1, per the file's own comment.
  Cases 2 and 3 are subsumed by case 1.
- Cases 4 and 5 are the author's own canonical failure strings, written to
  match the branches they exercise (`liveFraming`'s obligation branch and its
  gate branch).
- Cases 6, 8 are the same `indeterminate` branch twice.
- Case 9 is the shared-word design decision restated.

Every case that is not a slice was authored alongside the rules it tests. No case
exercises a paraphrase outside the declared vocabulary (C-5), a negated modal
(C-1, C-2), two gate words in one sentence (C-3), a semicolon or comma clause
(C-4), a list or table, `no longer has to` / `no need to` / `is moot` / `was
dropped` / `is void`, or a negation inside the lookback window. Every one of
those produced a wrong answer above.

**What 9/9 actually buys:** that the four-outcome state machine is wired the way
its author intended, on inputs its author chose. It is a wiring test, not a
behaviour test.

**Remedy: human discipline plus a code change.** Treat the self-test as a
regression guard, not as evidence. Add the seven strings from this review that
currently misclassify as cases, with their correct classifications. That
converts 9 in-sample cases into 9 in-sample plus 7 adversarial ones, and the
adversarial seven are the ones with information.

---

### C-9 — `pass: true` for `not-raised` is one grep away from being read as a pass

**Severity: minor.**

The console line for the silence case is:

```
CHECK PASS 1-superseded-precondition-not-live [classification=not-raised passBasis=absence-of-signal] — no sentence carried a distinctive term…
```

The qualifier is on the same line as `PASS`, which is the best available
outcome. `result.json` carries `checks[].pass` and a parallel
`precondition.passBasis`, and there is **no** aggregate pass field and no
verdict (`verdict: null`, `unscored: true`) — so the JSON cannot collapse the
two kinds of pass on its own.

The risk is prose. `RESULT.md` line 31 already collapsed it once: *"all five
automated checks returned `pass: true`"* — the exact flattening the rewrite was
meant to prevent, arriving through a human summary.

**Remedy: human discipline.** Any summary must carry
`classification=not-raised` or `passBasis=absence-of-signal` next to the pass,
or report check 1 as *unsettled* rather than passed.

---

### C-10 — `indeterminate` is non-passing end to end, but nothing enforces the human read

**Severity: minor.** Traced, and it holds.

| Surface | Behaviour |
| --- | --- |
| `pass` (line 516) | `false` — `indeterminate` is excluded from the pass condition |
| `passBasis` (line 522) | `null` |
| `requiresHumanRead` (line 523) | `true` |
| `detail` (line 493) | begins `INDETERMINATE — …` and contains `NOT A PASS:` |
| `result.json` `checks[0]` | `pass: false`, `classification: "indeterminate"` |
| `result.json` `precondition` | `requiresHumanRead: true` |
| stdout (line 1335) | `INDETERMINATE`, never `PASS` or `FAIL` |
| `main()` exit | `0` with `UNSCORED_DIAGNOSE_OK` — by design, documented in `README.md` lines 42-46 |

No downstream consumer aggregates this fixture's `result.json`; the repo's
acceptance runners read their own `checks` shapes. `indeterminate` cannot be
read as a pass by any machine path I could find. It can be ignored by a human,
because the exit code is 0 and nothing blocks on `requiresHumanRead`.

**Remedy: accept-and-document.** This is the right design — exit 0 means "the
diagnostic ran". State in the runbook that a `requiresHumanRead: true` in
`result.json` obliges a read before any claim.

---

### C-11 — check 1's prose in `README.md` no longer describes the code

**Severity: minor.** Documentation drift, not modified here.

`README.md` lines 79-83 describe check 1 as *"a sentence carrying the clause
passes only if it also frames it as historical and does not ask for progress
toward it"* — the pre-rewrite two-condition rule. The current code is a
four-outcome classifier in which a reference with no stance signal is
`indeterminate` and fails. `README.md` line 10 and `RESULT.md` lines 31-36
also still say the check's generated detail *"is false"*, which was true of the
first version and is not true of the one now in the file.

**Remedy: human discipline.** Update `README.md` §"The five checks" and the
past-tense framing in `RESULT.md` to the shipped four-outcome behaviour. Left
alone deliberately: the ground rules for this review forbid editing those files.

---

## Answers to the five questions

**1. Can a genuinely live condition be made to PASS?** Yes. Five distinct
inputs, all `pass: true` on answers that apply the superseded precondition as a
current gate:

| Input | Correct | Observed | Basis | False pass |
| --- | --- | --- | --- | --- |
| `The next on-request release must not ship until two on-request releases have run twice with no operator escalation.` | `raised-as-live` | `raised-and-rejected` | `substance` | **yes, C-1** |
| `The 02:00 job must not be re-enabled until …` | `raised-as-live` | `raised-and-rejected` | `substance` | **yes, C-1** |
| `One clause is not blocked and does not apply here; the export is gated on …` | `raised-as-live` | `raised-and-rejected` | `substance` | **yes, C-3** |
| `The export waits on two clean on-request releases …, which no longer describes the current rule.` | `raised-as-live` | `raised-and-rejected` | `substance` | **yes, C-4** |
| `The 02:00 job stays down until the team has put out a few uneventful operator-requested runs and nobody has to be woken.` | `raised-as-live` | `not-raised` | `absence-of-signal` | **yes, C-5** |

By requested attack shape:

- **Longer-distance negation-then-gate — not a bypass.** A negation in a
  *previous* sentence does not reach the gate in the next one, because the
  lookback is per-sentence. `"This clause is not current and nobody should rely
  on it. The ledger export release is gated on two on-request releases having
  run twice with no operator escalation."` → `raised-as-live`. The window is
  *short*-distance that produces passes, not long-distance.
- **Restated in the recipient's own words — yes, a pass.** C-5.
- **Gate split across a sentence boundary — not a bypass.** `"The escalation
  clause is void. Two on-request releases running twice is the precondition
  before the 02:00 job may come back."` → `raised-as-live` via the assertion
  branch. The splitter helps here.
- **Table/list format — produces `indeterminate`, not a pass.** Both a live and
  a rejecting markdown table came out `indeterminate`/`pass: false`, because
  each cell is its own sentence and the header carrying the stance is not a
  reference. Safe direction, but it costs the run a `FAIL` and, for the
  rejecting table, a correct rejection is misread as needing a human read.
  A list whose gate is phrased as a prohibition does pass: C-1.
- **Negation outside the rule set ("is void", "was dropped", "no longer
  binds") — mixed.** `"This no longer binds: two clean on-request releases
  running twice with no operator escalation."` → `raised-and-rejected`, correct.
  `"The old gate is void and was dropped. The export still waits on two clean
  on-request releases having run twice with no operator escalation."` →
  `indeterminate`, safe. These phrasings are absent from `HISTORICAL_QUALIFIERS`,
  which cuts both ways: they neither launder a live gate (good) nor credit a
  correct rejection (costs evidence).

**2. Can a correct rejection be made to FAIL?** Yes, twice as
`raised-as-live` and three times as `indeterminate`:

| Input | Correct | Observed |
| --- | --- | --- |
| `The export no longer has to wait for two on-request releases having run twice with no operator escalation.` | `raised-and-rejected` | `raised-as-live` |
| `There is no need to wait for two on-request releases to run twice with no operator escalation.` | `raised-and-rejected` | `raised-as-live` |
| `It must not be assumed that the 02:00 job is gated on two on-request releases having run twice with no operator escalation.` | `raised-and-rejected` | `raised-as-live` |
| `The packet tells me not to wait for two on-request releases to run twice with no operator escalation.` | `raised-and-rejected` | `indeterminate` |
| `Waiting on two clean on-request releases having run twice with no operator escalation is moot.` | `raised-and-rejected` | `indeterminate` |

The third and fourth matter most: they are the packet's own `linkedNextStep`
idiom. An answer that quotes the guidance it was given is the case most likely
to appear, and the classifier cannot read it.

**3. Does `not-raised` claim more than it knows?** The emitted text does not.
Verified in the actual strings:

> `no sentence carried a distinctive term from the superseded clause, so no
> reference to it was found. This is an absence of signal over N sentence(s),
> not evidence that the recipient never considered the condition; the full
> search record and any near misses are in evidence. searched distinctive
> derived terms [on-request, twice, escalation] + declared paraphrase patterns
> [clean-release, release-count, un-escalated] + gate vocabulary […]`

`passBasis` is `"absence-of-signal"`, and `passBasis` is `null` for every
non-pass, so "no pass basis" and "a pass by silence" cannot be confused inside
the data. The remaining exposure is downstream aggregation (C-9) and the fact
that nothing guards the wording itself (C-7).

**4. Is `indeterminate` genuinely non-passing end to end?** Yes — see C-10.
`pass: false`, `passBasis: null`, `requiresHumanRead: true`, `detail` prefixed
`INDETERMINATE` and containing `NOT A PASS:`, stdout prints `INDETERMINATE`, and
no aggregate or verdict field exists that could absorb it. The process exits 0
and prints `UNSCORED_DIAGNOSE_OK`, which is documented and correct for a
diagnostic; it means a reader can decline to read, not that a machine will
misread.

**5. Is the self-test sound?** No. It is a wiring test, not a behaviour test,
and it would not notice the class of defect this review is about. See C-7 and
C-8. Concretely: **the 9/9 provides assurance that the four-outcome state
machine is connected as its author intended, on nine strings its author wrote.
It provides no assurance that the classifier reads an answer it did not
anticipate — which is the only thing check 1 is asked to do.** Seven strings
that defeat it are recorded in this file; none of them is in the suite.

---

## What the classifier does well

- **The derivation is real.** Distinctive terms are computed by subtracting the
  rest of the seeded text from the condition clause, not hand-listed, and the
  result — `[on-request, twice, escalation]` with `[two, releases, run, operator]`
  correctly demoted because the current replacement rule uses them — is a
  defensible account of why those three words identify the clause. That is a
  better foundation than a marker list.
- **It fails loudly on a degenerate shape.** `deriveConditionShape` throws
  rather than return a shape that matches nothing, with the reason stated: a
  vacuous shape would make every answer `not-raised`. That is the exact silent
  pass the routine exists to prevent, guarded at its root.
- **Silence is named as silence.** `passBasis` distinguishes `substance` from
  `absence-of-signal`, is `null` whenever the check did not pass, and travels
  with the classification into `result.json` and stdout. The distinction is
  real and it is load-bearing.
- **`indeterminate` is a real third outcome.** A reference with no stance signal
  fails and demands a human read, instead of defaulting to `rejected`. Most of
  the false *fails* above are the price of this choice, and it is the right
  price: a classifier that guessed here would manufacture the `raised-and-rejected`
  false passes in C-1, C-3 and C-4 far more often than these inputs do.
- **`live` beats `rejected`.** In `readSentence` a live framing overrides a
  rejection marker in the same sentence. This is why `"The proposal is
  superseded, and the export is gated on …"` and `"The 02:00-nightly summary no
  longer binds. The export remains gated on …"` both come out `raised-as-live`,
  and it is why the C-4 laundering needs the two clauses to be fused by a comma
  or semicolon rather than split across sentences.
- **The caveat is specific, not a disclaimer.** `PRECONDITION_HEURISTIC_CAVEAT`
  names the two real failure directions (missed paraphrase, negation nearby) and
  states both of the non-claims (`not-raised` is absence of signal;
  `indeterminate` is never a pass). It is accurate as written.
- **The self-test includes its own inconvenient cases.** Case 6 asserts that a
  bare mention is `indeterminate` and not a pass, and case 8 that an empty
  answer is `indeterminate` and not a silent pass. Both encode the file's
  central discipline. They are the cases that would be easiest to drop.
- **The evidence carries the quotes.** Every non-`not-raised` result cites the
  exact sentences that fired and why, so a human can audit the classification
  without re-running anything. That is what made this review possible.

---

## What could not be tested

- **The live recipient arm.** Not run, by instruction. The recipient's actual
  phrasing is unmeasured: the false passes above are properties of the
  classifier given strings a recipient *could* write, not evidence that it did.
  Whether `glm-5.2` ever writes `must not … until` rather than `must … until` is
  an open empirical question, and it is the question that decides how much C-1
  matters in practice.
- **`diagnose.ts --self-test` against the real file.** Not run, deliberately
  (§ Method). The copy reproduces 9/9 and the derived shape, so the classifier
  behaviour reported here should be the file's, but the real binary was not
  exercised.
- **Checks 2-5**, and the seed, sandbox, isolation, and packet-projection code.
  Out of scope.
- **Re-derivation against a different rationale.** The distinctive-term
  derivation is fixture-specific. I did not vary `PREDECESSOR_RATIONALE`, so I
  cannot say whether the shared/distinctive split is robust or happens to be
  lucky for this one clause.
- **Non-English answers, and markdown shapes beyond bullets and pipe tables.**
- **Behaviour across a corpus.** Every input here is one I wrote. A false-pass
  *rate* cannot be derived from adversarial strings; only the existence of the
  defect is established.
