# Red-team review — Gate E packet-evidence helper, observation template, and case log

- **Subject:** `scripts/gate-e/packet-evidence.ts`, `scripts/gate-e/README.md`,
  `docs/evidence/gate-e/TEMPLATE.md`, `docs/evidence/gate-e/LOG.md`, at commit
  `4b9202b`.
- **Question asked:** what is the path by which this apparatus records a benefit
  that did not happen?
- **Method:** read against `docs/GATE_E_PROTOCOL.md` §1, §3, §5, §6, §7, §9,
  `src/domain/recall.ts`, and `docs/SPRINT_RCL_003_RESULT.md`; then the helper was
  run against crafted packets. Every reproduction below was executed. Probe
  packets and scripts were written outside the repository and deleted. No Campfire
  agent, harness, or `~/.campfire-pilot/` material was used. No repository file
  other than this one was created or modified; there are still zero observations.
- **RCL-003 in one line:** a citation difference between arms looked like a
  benefit and was confounded by a treatment-only session instruction. The lesson
  to carry into this apparatus is that an apparatus which *re-derives a safety
  claim from attacker-controlled inputs* and prints "matched" is the same shape of
  failure as an apparatus which attributes a difference to one of two things that
  moved together. Findings GE-01 and GE-06 are that failure. The rest are smaller.

Run the helper with `node_modules/.bin/tsx scripts/gate-e/packet-evidence.ts
<file> --output json` (the repo has no npm script for it).

---

## GE-01 — critical — The decision-set "re-derivation" is fed a packet-controlled input, so the record can certify a decision safety its own members contradict

**Mechanism.** `decisionSetAt` (`scripts/gate-e/packet-evidence.ts:611-678`) calls
the domain's `deriveDecisionSetState` with `recordedTransitions` taken **verbatim
from the packet**:

```ts
const verdict = deriveDecisionSetState({
  members: members.map((member) => ({ id: member.id, lifecycle: member.lifecycle })),
  recordedTransitions,
  truncated: truncated || returned < total,
});
```

The packet is never reconciled against itself on this axis. `src/domain/recall.ts`
exports `recordedDecisionTransitions(members)` (line 642) for exactly that
purpose — it derives the supersession list from the members' `predecessorId` /
`successorId`, and `fitDecisionSet` uses `transitionsWithinMembers` (lines 868,
753) to narrow it on every refit. The helper calls neither. So both directions
fail:

- **Transitions removed.** A packet whose members carry `predecessorId` /
  `successorId` but whose `recordedTransitions` is `[]` derives
  `single-accepted-decision`. The record then asserts, and the human rendering
  prints, *"beforeActing absent linkedNextStep absent **re-derived and matched**"*.
- **Transitions fabricated.** A packet that invents an in-set transition converts
  an unresolved two-accepted-decision conflict into `linked-accepted-decisions`
  with an `operativeDecisionId` — i.e. "a recorded transition already selects the
  operative decision in this set" — while no member carries any link at all.

In both cases the emitted JSON contains a `reDerived` block that agrees with the
forged input, and the human rendering prints the words "re-derived and matched"
with no qualification. A reviewer reading only the committed record sees a
decision set whose safety verdict is certified and whose own member relations
contradict that verdict.

**Why this is the most serious thing here.** This is the exact RCL-003 failure
class. `docs/SPRINT_RCL_003_RESULT.md` records that the scored offline packet
lost `linkedNextStep`, that `basisFindingIds` was dropped by
`handoffDecisionSetMembers`, and that "no test covered it". A writer bug that
under-supplies transition or guidance metadata produces a packet this helper
certifies as safe. The helper's stated purpose is to be the thing that does not
trust the packet about its own decision safety; here the trust boundary is placed
one field short of where it needs to be.

**Reproduction (executed).** From `docs/evidence/rcl-003/packet-S2.json`, fix the
projection (superseded member → `section: historical`, no `rationale`,
`historicalExplanation` present), then:

```
p.decisionSet.recordedTransitions = [];
p.decisionSet.state = "single-accepted-decision";
p.decisionSet.operativeDecisionId = "dec_rcl003_s2_replacement";
delete p.decisionSet.linkedNextStep;
```

Result: `exit=0`. The emitted record contains

```json
"state": "single-accepted-decision",
"recordedTransitions": [],
"guidance": { "beforeActing": "absent", "linkedNextStep": "absent" },
"reDerived": { "state": "single-accepted-decision",
               "operativeDecisionId": "dec_rcl003_s2_replacement" }
```

while its own members carry
`{ id: "dec_rcl003_s2_predecessor", lifecycle: "superseded",
section: "historical", historicalExplanation: {present: true},
relations: { successorId: "dec_rcl003_s2_replacement" } }`. The mirror case,
adding a fabricated transition to `packet-S1.json`, also exits 0 and reports
`state: "linked-accepted-decisions"`, `operativeDecisionId:
"dec_rcl003_s1_fixed"`, `linkedNextStep: "linked"`, with empty `relations` on every
member.

**Remedy — code change.** Reconcile before deriving. Derive the transition list
from the members with `recordedDecisionTransitions(members)` and either use that
list as `deriveDecisionSetState`'s input or refuse when the packet's declared list
disagrees with it, in the same `invalid(...)` form used for `state` and
`operativeDecisionId`. Then also refuse any transition whose two ends are not both
members, so the declared list is not a second unauthenticated channel.

---

## GE-02 — critical — `Counts toward Gate E: yes (one case only)` is a selectable, pre-printed value on a P or H observation

**Mechanism.** `TEMPLATE.md` §15 offers the Gate E column as a two-option menu
whose **first option is the false pass**:

```text
Verdict label:                   supports / weak / null / N/A (inadmissible or withdrawn)
§4.4 label for weaker items:    reported / none / n/a
Counts toward Gate E:            yes (one case only) / no
```

The surrounding prose says a P or H observation "is `no` at the Gate E column and
says why", but the field itself has no validator and nothing in the repository
checks it. §1 forbids P and H from closing Gate E, and the only mechanical
expression of that rule is a free-text cell a recorder can set to the passing
value with one edit.

The log repeats the same cell. `LOG.md`'s **Counts toward Gate E** column
definition does constrain it in prose — "always `no` for P/H … `yes (one case
only)` is available only for an admissible claim-N observation" — but the column
itself is free text in the row, so a P row reading `yes (one case only)` is
written by a log whose own rules forbid it. The two files do not contradict each
other; each contains a rule and an unguarded field that breaks it.

Three fields in the same block are pre-seeded with their passing options, and in
every case the pass comes first: `Case disposition: admissible / inadmissible /
withdrawn`, `Verdict label: supports / weak / null / N/A`, and the Gate E column.
The preamble's rule that "unfilled slots read `not recorded`" does not reach them,
because they are not blank — they are menus whose first entry is a verdict.
Combined with `Closed: open` in §1, which the template says stays `open` until the
case closes and which nothing prevents a reader from ignoring, a **half-finished**
observation file reads as a passing one: `Closed: open`, `admissible`, `supports`,
`yes (one case only)`. No dishonesty is required, and the template's own
instruction — "A copy of this template left under any other name is not an
observation" — is about the filename, not about unfilled fields.

This is also the direct answer to "could a P or H observation be presented as
though it advanced the gate". Yes: not by argument, but by filling a cell. The
field is the gate, and nothing under it.

**Reproduction.** No execution required; this is a field-value reading. Copy
`TEMPLATE.md`, leave §15 untouched, fill nothing else. The file is a valid
markdown document that claims to be an admissible, supporting, Gate-E-counting
observation.

**Remedy — doc change, small and worth doing.** Make the Gate E column a derived
value rather than a typed one: replace the menu with a single statement the
recorder cannot fill optimistically, e.g. `Counts toward Gate E: no — claim P/H
does not close Gate E (§1, §8)` for P and H, and for N a menu that includes the
claim shape in the option text so the wrong shape is visible in the cell
(`yes (one case only) — claim N`). Do the same for `Case disposition` and
`Verdict label`: put the permitted values in angle brackets so an unedited slot
reads `not recorded`, and make the passing value require an extra clause rather
than being the first token on the line. If a menu must remain, reorder it so the
null/default is first and add `—` to the end of the line, so an unedited slot
reads as an empty slot.

---

## GE-03 — major — The credential detector's `\b` anchor is defeated by `_`, in exactly the id-shaped fields the record copies verbatim

**Mechanism.** `CREDENTIAL_SHAPE = /\bcf[te]_[A-Za-z0-9]+/` (line 103). The word
boundary requires a non-word character before `c`. `_` is a word character, and
`_` is the separator in every Campfire id prefix (`agent_`, `hum_`, `ses_`,
`dec_`, `find_`, `task_`, `art_`). Any credential-shaped string that appears
after a prefix or after any word character is not detected — and those are exactly
the fields the record copies verbatim into the committed evidence file:
`recipient.actorId`, `issuer.actorId`, `provenance.agentSessionId`, `record.id`,
`record.lifecycle`, `basisFindingIds`, `evidenceArtifactIds`,
`predecessorId`, `successorId`.

The belt-and-braces scan on the emitted record (`refuseEmitted`, line 1064) uses
the same regex on the same values, so it does not catch it either.

**Reproduction (executed).** `packet-S1.json` with
`recipient.actorId = "agent_cft_ZZZ999"` → **exit 0**. The emitted JSON contains
`"recipient":{"actorId":"agent_cft_ZZZ999","actorType":"human"}`. Likewise
`records[2].id = "dec_cft_ABCD1234"` and
`records[0].provenance.agentSessionId = "ses_cft_QQQWWW111"` and
`records[0].lifecycle = "x_cft_ABCD1234"` all exit 0 and are emitted verbatim.
For contrast, a token at the start of a value, or after whitespace inside a
longer value, is correctly refused in eleven other placements — including in a
field name, in an unknown key at the packet root, in a nested unknown key, in an
anchor record's text, in an omission line, in `authority`, and as a `cfe_`
enrollment secret. The gap is exactly the id-shaped placements.

**Honest scoping.** This needs a token adjacent to a word character, which is not
how `generateRawToken` output normally appears. It is a defect in the detector's
anchor, not a demonstrated leak from the product. The cost of fixing it is one
character class.

**Remedy — code change.** Drop the `\b` and anchor on a non-alphanumeric-or-start
lookbehind: `/(?<![A-Za-z0-9])cf[te]_[A-Za-z0-9_-]+/`. Keep the conservative bias
the README states; this is strictly more sensitive. Add the id-shaped fields to
the table in the README's "Refusal rules" so the coverage is legible.

---

## GE-04 — major — The path and URI rules miss ordinary single-slash URIs and non-ASCII path forms, and those strings are copied into the record verbatim

**Mechanism.** Three separate gaps, all producing exit 0 with the offending string
in the emitted record.

1. `uri-opaque` enumerates five schemes (`mailto`, `tel`, `data`, `javascript`,
   `vscode`, `obsidian`), and `uri-authority` requires `://`. A single-slash URI
   such as `file:/Users/...` or `sqlite:/var/lib/x.db` matches neither. The
   comment on `absolute-path` (line 113) says `:` is deliberately excluded from
   the preceding-delimiter class "because a URI, which the first rule above
   already reports" — so `path:/private/var/db` is reported by nothing either.
2. `home-path` requires `~` to be followed by `/` or end-of-string, so a
   `~user/…` reference is not a match.
3. Every path rule is ASCII-only. A fullwidth-slash path passes.

The record copies `query.text`, `workspace.name`, `goal.title`,
`goal.description`, and every `omissions` line verbatim (bounded). Those are the
fields where a surviving string becomes a committed line.

**Reproduction (executed).** All exit 0, all emitted:

| Crafted value | Field | Emitted? |
| --- | --- | --- |
| `file:/Users/sergio/.campfire` | `goal.title` | yes, verbatim |
| `path:/private/var/db` | `goal.title` | yes, verbatim |
| `sqlite:/var/lib/x.db` | `goal.title` | yes, verbatim |
| `notes in file:/Users/sergio/x` | `query.text` | yes, verbatim |
| `／Users／sergio／.campfire` | `goal.title` | yes, verbatim |
| `~sergio/private` | `goal.title` | yes, verbatim |
| `"C"` in one record + `":\Users\sergio\key.pem"` in another | `records[].text` | not copied (record text is dropped) |

`query.text` is the operator's own recall text. An operator who types or pastes a
`file:` URI into a query is the realistic instance. `sqlite:` and `postgres:` are
the two forms an engineering workspace most plausibly carries; `postgres://…` is
correctly refused by `uri-authority` and only the single-slash variants survive.

**Remedy — code change.** Add an opaque-URI rule matching any
`scheme:` prefix, e.g. `/\b[a-zA-Z][a-zA-Z0-9+.-]{1,31}:(?!\/\/)[^\s]*/`, and keep
the scheme allow-list only if there is a reason to; if the conservative bias is
wanted, prefer a false refusal here. For the delimiter anchoring, relax the
preceding class to "anywhere in the string" for the drive-letter and
absolute-path rules rather than requiring whitespace or a delimiter.

---

## GE-05 — major — The tool's own truncation marker trips the path detector, so any packet with a truncated bounded field is refused

**Mechanism.** `markedText` (line 903) renders a truncated field as
`` `${text} [truncated ${bytes}/${maxBytes} bytes]` ``. `main` (line 1135-1141)
builds **both** renderings, scans **both**, and refuses on either — regardless of
`--output`. The substring `1024/1024` in that marker is matched by
`relative-segment-path`:

```ts
{ rule: "relative-segment-path", ...,
  pattern: /(?:^|[\s("'\[=,;])(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+(?=$|[\s)"'\],;])/ }
```

so a well-formed packet is refused with `exit 2` and
`relative-segment-path: a slash-separated relative path — record.human` — naming
the tool's own rendering as the leaked path. The refusal fires whichever
rendering was requested, because `main` builds and scans both before choosing.

**Reproduction (executed).** All exit 2, identical stderr, even with
`--output json`:

- `query.text = "é".repeat(200)`
- `omissions = ["O".repeat(300)]`
- `workspace.name = "W".repeat(300)`
- `goal.description = "D".repeat(1100)`

**Scope, stated precisely.** Of those four, one is reachable from the product's
own writer. `prepareRecallQuery` bounds `query.text` in **characters**
(`RECALL_QUERY_MAX_CHARS = 200`) and stores it unchanged; the helper re-bounds the
same value in **bytes** at the same numeric limit. A 200-character non-ASCII
query — Japanese, Arabic, or emoji, which the writer accepts and the recipient
sees in full — is legal at the writer and truncated by the helper. The other three
are not reachable from today's writer: `assembleRecall`
(`src/service/recall-assembly.ts:306`) already bounds the workspace name to
`RECALL_NAME_MAX_BYTES` (256), `goalFromRow` bounds the goal title and
description to `RECALL_GOAL_TEXT_MAX_BYTES` (1024), and the generated omission
lines are short and fixed-shape. Those three need a crafted packet.

The production case is therefore narrow but real, and the failure mode is worse
than the reachability suggests: the operator gets `REFUSED — a slash-separated
relative path — record.human`, which names the tool's own output as the leak and
gives them nothing to act on. There is a second, worse consequence on the same
path: because the bound is applied in bytes rather than characters, a
multi-byte query is silently cut at a point the recipient never saw, and if the
truncation marker did not trip the detector the record would understate what the
recipient had.

**Remedy — code change.** Three independent fixes, all cheap: (a) scan only the
rendering that is actually printed, or scan the record's structured values rather
than the formatted text; (b) render the marker without a bare `N/M` fraction —
`[truncated N of M bytes]` — so it cannot look like a path segment; (c) as a
belt, exempt the emitted-record scan from the path rules entirely, since every
value in the record has already passed the packet-level scan and the record adds
no new text of its own. Separately, align `query.text` with the domain: bound it
in characters at `RECALL_QUERY_MAX_CHARS`, or add a byte-bounded constant and use
it, so the record never shows less of the query than the recipient saw.

---

## GE-06 — major — `lifecycle` is an unvalidated free string, and the superseded-projection guard is keyed on one literal

**Mechanism.** `recordAt` reads `lifecycle` with `stringAt` — any non-empty string
(line 549). `src/domain/types.ts:20` defines
`DecisionStatus = "proposed" | "accepted" | "superseded"`: a closed set. Because
`deriveDecisionSetState` decides everything on `lifecycle === "accepted"`, a
packet that relabels an accepted decision as anything else changes the derived
safety state while remaining internally consistent. The projection guard
(lines 655-663) fires only when `member.lifecycle === "superseded"` exactly, so a
member that is superseded in substance but labelled `retired` skips the guard
entirely and keeps `section: "decision-set"` and a live `rationale`.

**Reproduction (executed).** From `packet-S1.json` — which carries two accepted
decisions in an unresolved conflict, `beforeActing` present — set
`members[0].lifecycle = "retired"`, `members[1].lifecycle = "retired"`,
`state = "single-accepted-decision"`, `operativeDecisionId =
"dec_rcl003_s1_fixed"`, drop `beforeActing`. **exit 0.** The record reads:

```json
"state": "single-accepted-decision",
"operativeDecisionId": "dec_rcl003_s1_fixed",
"guidance": { "beforeActing": "absent", "linkedNextStep": "absent" },
"reDerived": { "state": "single-accepted-decision", … }
```

A second variant adds `rationale` to a member labelled `retired` and it is
reported as `rationale: { present: true, bytes: 64 }` with no
`historicalExplanation` — the pre-RCL-003-fix shape, passing.

**Remedy — code change.** Validate `lifecycle` against the domain's status
vocabulary, kind-aware: `DecisionStatus` for `kind === "decision"`,
`FindingCurrentness` for findings, the task statuses for tasks. Import the types
rather than re-listing the strings. Then key the projection guard on
`lifecycle === "superseded"` **after** that validation, so the literal is
enforced to be the only string that can mean it. Add the projection defect that
`docs/SPRINT_RCL_003_RESULT.md` describes as a regression test while you are
there — see GE-17.

---

## GE-07 — major — §3.1.3 has no field, and `supports` has no operational test

**Mechanism.** §3.1 qualifies an observation on five conditions, and §3.2 lists six
things that disqualify. The template's opening check operationalises three of the
five §3.1 conditions — §3.1.1 (ordinary work), §3.1.2 (voluntary use), and
§3.1.5 (recorded under §6/§7), the last of which §6 carries structurally — and
three of the six §3.2 bullets: fixtures (§3.2 fourth), owner dogfooding (fifth),
and a known outcome (sixth). §3.1.4 is reachable only through §10's
resulting-work fields.

Two gaps follow, and they are the same gap seen from two sides. §3.2's first
three bullets — reading without acting differently, same-session self-reuse, and
restatement only — have no opening-check line. And **§3.1.3, a real dependency** —
"the later action is incoherent, wrong, or unsupportable without the content of
the named prior records" — has no line, no field, and no required sentence
anywhere in `TEMPLATE.md`. §3.1.3 is the single strongest disqualifier for claim
N and the one that separates reuse from a restatement, and it is the one the
template does not ask about.

The consequence is that `Verdict label: supports` has no test behind it. §1
defines `supports` as "when its claim is demonstrated"; the template supplies one
free-text verdict cell and, for H, one self-assessed boolean
(`Correspondence verified: yes / no / unresolved` in §10) that is not bound to the
label. A recorder can write `supports` next to `unresolved`, and nothing in either
file objects.

The consequence is that `Verdict label: supports` has no test behind it. §1
defines `supports` as "when its claim is demonstrated"; the template supplies one
free-text verdict cell and, for H, one self-assessed boolean
(`Correspondence verified: yes / no / unresolved` in §10) that is not bound to the
label. A recorder can write `supports` next to `unresolved`, and nothing in either
file objects.

**Reproduction.** Reading only. Take the worked shape of any H observation and
set §10's `Correspondence verified:` to `unresolved` while §15 reads `supports`.
The document is internally permitted.

**Remedy — doc change.** Add three lines to the opening check, one per missing
§3.2 bullet and one for §3.1.3:

- *§3.2 first:* did the participant read, retrieve, page past, or cite without
  acting differently? yes / no.
- *§3.2 second:* is the reuse the participant's own prior work in the same
  session with no separate session boundary? yes / no.
- *§3.2 third:* does the later action only restate prior Campfire text into new
  Campfire text? yes / no.
- *§3.1.3:* would the action be incoherent, wrong, or unsupportable without the
  named prior records? yes / no — what would be wrong without them.

Give them the same disqualifying weight as the existing lines. Then add one line
to §15 binding label to evidence: `Label follows from: <field(s) in this file
that establish it>`. For H, require §10 to carry a per-field verdict table rather
than one boolean; see GE-09.

---

## GE-08 — major — Nothing binds `[PLAN-TIME]` content to a commit, so a backfilled file is indistinguishable from an honest one

**Mechanism.** The template's defence of plan-time integrity is entirely
self-referential: `Opened:`, `Captured at:`, `Recorded at:`, `Written at:`,
`Checked by <recorder> at`, and §15's self-assessment *"Plan-time entries dated
before the outcome: yes / no"*. Every one of those is typed by the same person
into the same file. The preamble requires plan-time fields to be "filled in,
dated, and committed before the outcome is known", but **no field records the
commit**, and the `Additions and corrections` section is a convention with no
detector. A file reconstructed after the outcome gets mutually consistent
timestamps for free.

The repository has the means to close this and the template does not use them.
`git log --diff-filter=A -- <path>` gives the file's first commit; `git show
<sha>:<path>` gives the plan-time content as committed. `LOG.md` already does
something adjacent and correct — the pre-registered expectation cites commit
`4344e75` — so the pattern is present in the apparatus.

**Honest scoping.** A reviewer who reads Git history can detect a backfilled
field by diffing the first commit against the final one. The finding is that the
*file* does not point them at the commit, so the check requires prior knowledge
that it exists. §7.13's "a reviewer with no access to the observer's memory" is
satisfied; §7.8's "Basis 1 must be dated before the outcome" is not
independently checkable from the artefact.

**Reproduction.** Not executable without an observation; verified by reading the
template. There is no commit, hash, or blob reference in §1, §5, §6, §7, or §15.

**Remedy — doc change.** Add `Opened commit: <sha>` to §1 and `Closed commit:
<sha>` to §15, with one sentence: *the plan-time fields are those present in
`git show <opened commit>:<path>`; a field that differs at close is a correction
under §9.* Add a line to §15's retained-evidence check: `Plan-time fields match
the opened commit: yes / no`.

---

## GE-09 — minor — H correspondence is one unchecked boolean, and the excluded fields are not recorded

§10 records `Correspondence verified: yes / no / unresolved` as a single value and
asks for "the packet source ids and bounded content needed to verify
correspondence" as one free-text block. Two consequences.

The operator chooses which packet fields get an excerpt, and the template records
only the chosen ones. Nothing records which fields were considered and excluded,
so a comparison set chosen to look complete cannot be distinguished from a
complete one. The helper's record does list every id with its section and
lifecycle, so the *inventory* is checkable — but the *selection* is invisible, and
the selection is where a favourable comparison is constructed.

Nothing binds the boolean to the verdict label (GE-07).

**Remedy — doc change.** Add a per-field table to §10 — `field | why in scope |
match / mismatch / out of scope` — and one line `Fields considered and excluded:
<list> — reason`. The untracked `docs/evidence/gate-e/HANDOFF-RUNBOOK.md` §5.1
already uses exactly this shape, and §5.5 of that file already forbids promoting
"the one field that matched"; see the note under "What I could not attack" before
treating this as a fresh suggestion.

---

## GE-10 — minor — §2 is single-participant, so an H observation can be "complete" while the recipient's harness, model, and session are absent

§6 requires `Participant` to carry "actor id, actor type; for an agent: harness,
version, model, reasoning setting, `agentSessionId`, and the human principal".
An H observation has two participants in two workspaces. `TEMPLATE.md` §2 offers
one participant table, §3 offers one workspace row, and §10's `Author:` is free
text with no required fields. A recorder can therefore fill §2 with the sender and
put only an actor id in §10, and every §6 field is populated.

The consequence is specific and is the RCL-003 lesson again. §7.12 limits an
agent's reuse to "that harness, model, and date", and §14's
standing-instruction line — the field that exists because the RCL-003 citation
split was confounded — asks "**Standing** `cite the record ids you relied on`
instruction in `src/mcp/instructions.ts` in effect: yes / no" as one boolean for
the observation. For H there are two participants and they differ: an offline
recipient with no Campfire session does not have the instruction; an agent
recipient with a session does. Nothing forces the record to say which.

**Remedy — doc change.** Make §2 a two-row table (`issuer` / `recipient`) for H,
and mark §14's standing-instruction line as per-participant.

---

## GE-11 — minor — No ordering constraint between the work product's date and the handoff

§3.1.4 requires a *dated* recipient-authored work product. §10 has a `Date:`
field, and nothing anywhere in the template requires that date to fall after
`Opened`, after §5's pre-action position, or after the packet's `generatedAt`. A
work product that predates the handoff can be attached and `supports` recorded.
§13's `Outcome Date` has the same gap against §10's.

The untracked runbook Step 6 does say to check the ordering; the template, which
is the artefact a reviewer reads, does not.

**Remedy — doc change.** One line under §10: `Produced after the packet's
generatedAt and after Opened: yes / no — <dates>`, and treat a `no` as
disqualifying under §3.1.4.

---

## GE-12 — minor — The template narrows §4.4's item vocabulary, and the log repeats the narrowed version

§4.4's table defines four item labels: `reported`, `none`, `P` (reuse is
materialized and checkable), and `H` (packet contents determined a recipient's
action). `TEMPLATE.md` §15 offers only `reported / none / n/a` in the menu and
prints `| <item> | reported / none | no |` as the row shape. `LOG.md`'s "Verdict
label" column note says the same thing: "§4.4's `reported` and `none` belong to
individual items in the observation".

Two documents therefore disagree with the protocol on a controlled vocabulary, and
the disagreement removes the two labels that name the claim shapes. It is small,
and §4.4's own framing ("The RCL-003 citation split is exactly the third row") may
well mean the first two rows are labels of a different kind — but nothing in the
protocol says that, and the divergence sits in exactly the place where labels are
supposed to be unambiguous.

**Remedy — doc change.** Either restore `P` and `H` to the menu and the row shape,
or state in the template why §4.4's last two rows are not item labels.

---

## GE-13 — minor — The record makes three assertions it does not check

Each verified by execution:

1. `authorityPresent: true` (line 832) is emitted whenever `packet.authority` is
   a non-empty string (line 763). A packet with `authority: "safe to execute"`
   exits 0 and the record still states the authority disclaimer is present. This
   is the same "assert rather than verify" shape as GE-06.
2. `completeness.fullHistoryIncluded` is read with `booleanAt` and copied, but
   never asserted `false` the way the top-level `packet.fullHistoryIncluded` is
   (line 759). A packet setting it `true` exits 0 and produces a record that
   contradicts itself: `completeness.fullHistoryIncluded: true` beside
   `receipt.fullHistoryIncluded: false` (the latter hardcoded).
3. Duplicate decision-set member ids pass. `returned === members.length` is
   checked (line 625) but not uniqueness; `packet-S1.json` with
   `members[2]` replaced by a copy of `members[1]` exits 0 and the record lists
   the same decision twice, each counted.

None of these alone produces a benefit that did not happen. Together they show the
record asserting structural facts from unverified inputs in the same style as the
decision-safety claim, which is why they belong in one finding.

**Remedy — code change.** Compare `authority` against the domain's frozen string
(the `CampfireHandoffPacket["authority"]` literal) rather than testing for
non-emptiness; assert `completeness.fullHistoryIncluded === false`; require
decision-set member ids to be unique.

---

## GE-14 — minor — The verbatim-leak check refuses a valid packet when a record's text happens to equal a field the record does copy

`packetTextValues` (line 1074) collects every `records[].text` /
`records[].rationale` of 16 bytes or more and fails the run if the whole string
appears in either rendering. It has no notion of *provenance*, so a coincidental
collision with a field the record legitimately copies trips it — and the stderr
message, `the record would carry 1 packet text field(s) verbatim`, is false in
that case.

**Reproduction (executed).** `packet-S1.json` with `records[0].text` set to the
existing `goal.title` → `exit 1`, `INVALID — the record would carry 1 packet text
field(s) verbatim`. The record carried the goal title; the finding text never
reached it. A finding whose summary *is* the workspace goal statement is ordinary.

This is the one place where the README's claim that this check "cannot fire given
how the record is built" is falsified — and note the direction. The check fires on
a **valid** packet, so it costs an operator a run they cannot explain. A finding
whose *rationale* quotes the query does not trip it: I tested that case and it
emits, because the check requires whole-field equality, not containment.

**Remedy — code change.** Exclude the fields the record copies by design
(`query.text`, `workspace.name`, `goal.title`, `goal.description`,
`omissions[]`) from `packetTextValues`, so the check tests the record's own
behaviour rather than coincidence.

---

## GE-15 — minor — `LOG.md` append-only is a convention with no enforcement, and the file duplicates its own status in three hand-maintained places

- The log is plain markdown under version control and nothing checks it. There is
  no test, no CI step, and no script referencing `gate-e` outside
  `scripts/gate-e/packet-evidence.ts` itself (verified by grep across `tests/`,
  `scripts/`, `.github/`, `package.json`). The helper is typechecked by CI —
  `tsconfig.json` includes `scripts/**/*.ts` and `.github/workflows/ci.yml` runs
  `npm run typecheck` — but nothing checks that the log's rows match the files in
  the directory.
- The status claim appears in three separate hand-maintained places in `LOG.md`:
  the header (`**Status:** **Zero observations.**`), a caption under each table
  (`**Rows: zero.**`), and the **Gate E status** section. Adding the first row
  leaves two captions reading "Rows: zero" while the table beside them is
  populated. The captions will be deleted at some point, and the moment they are
  deleted is the moment a reader can no longer tell an empty table from a missing
  one.
- Nothing ties a row to a file. The `Record` column explicitly permits `—` "when
  the case opened and no file was written", so a completed row need not be
  backed by any artefact.

**Remedy — doc change, plus a cheap check.** State once, in the header, that the
row count and the `gate-e-observation-*.md` count must agree, and replace the
hand-maintained `**Rows: zero.**` captions with a single dated line under
**Appended entries** that records the count after each append. A ~10-line
`scripts/gate-e/` checker that counts files and rows and compares them to the
`Closed (UTC)` column would make the log's own central claim mechanical; today it
is purely disciplinary.

---

## GE-16 — minor — There is no enumeration denominator, so a case can be quietly omitted with no trace

§7.1 works by requiring a dated enumeration before qualification, and
`LOG.md` has the register — currently empty, correctly. But the register lists
*candidates*, and nothing commits *how many handoffs were considered*. A candidate
that is looked at, judged obviously non-qualifying, and never opened produces no
row in either table and no file, and the absence is indistinguishable from it
never having come up. §7.14's "nulls are recorded at the same rigour" applies to
cases that were *opened*; it does not reach candidates that were screened out
before opening.

This is the one weakness inherent to the design rather than in the execution of
it, and the honest statement is that no append-only log can detect its own
omission. The pre-registered expectation is the only thing in the file that hints
at a denominator.

**Remedy — human discipline, with a small doc change.** Require a dated
"candidates screened" note — counts only, no identifying detail — under
**Appended entries** at each attempt, so the denominator exists even when the
numerator is zero. Zero is a legitimate recorded result here; silence is not.

---

## GE-17 — minor — The helper has no automated test

`scripts/gate-e/packet-evidence.ts` has no test file. Its refusal rules, its
re-derivation guard, and its shape guard are unverified by CI, and several of
them are exactly the kind of rule that silently changes. GE-01, GE-05, GE-06,
and GE-14 are all regressions against intent that a handful of fixture packets
would have caught — the two directions of `recordedTransitions` (GE-01), a
truncated bounded field (GE-05), a relabelled `lifecycle` (GE-06), and a record
text equal to the goal title (GE-14).

`docs/SPRINT_RCL_003_RESULT.md` is the specification for two of these: it names
the dropped `basisFindingIds`, the flattened `section`, and the missing
`linkedNextStep`, and states that "no test covered it". This repository ran 1,027
tests in 84 files on the candidate build, and CI runs them. A helper whose output
is a committed evidence artefact, feeding a gate that three consecutive pilots
have failed on reasons that look a great deal like untested projection paths,
should not be the one untested file in `scripts/`.

**Remedy — code change.** A test file that runs `buildPacketEvidence` over the
frozen `docs/evidence/rcl-003/packet-S1.json` and `packet-S2.json` plus a small
set of crafted packets, asserting: the S2 rejection and its field path; the
credential and path refusals in id-shaped and value-shaped fields; a truncated
bounded field emits rather than refuses; `recordedTransitions` disagreeing with
the members' relation ids is refused in both directions; a relabelled `lifecycle`
is refused; determinism, by running twice and comparing bytes. The last four are
the regressions this review found, and each is one fixture packet.

---

## What is genuinely load-bearing and well-built

The following are not hedges. Each was tested or read closely and each does real
work against the question this apparatus exists to answer.

**The "no record or rationale text is copied" claim is true, and I checked it by
running rather than reading.** Across `packet-S1.json`, all 15 `records[].text` /
`rationale` values of 16 bytes or more, and every value shorter than 16 bytes,
appear nowhere in either the JSON or the human rendering. The claim holds on every
path I could find: anchors (ids only, line 707), goal (bounded), omissions
(bounded), decision-set members (`rationale.present` / `bytes` only), and
`historicalExplanation` (presence only). The structural/semantic split is the
right design, and the README's "Redaction rules" table accurately describes what
is and is not copied. The gap in that section is not the table — it is GE-04:
the strings it *does* copy can carry a path past the detectors.

**Determinism is real.** Two consecutive runs over `packet-S1.json` produced
byte-identical output. The record genuinely carries no run timestamp, no input
path, no file name, and no machine identity. The README states the two
consequences — it does not say when it was made and it does not say which file it
came from — rather than leaving them implied. That is the honest way to sell a
design choice.

**The credential detector fires in eleven of the twelve placements I tried**, and
the coverage that matters is deliberate. It fires at the start of a value and
after whitespace inside a longer value, in a record id, a `lifecycle`, an omission
line, a goal title, the `authority` string, an anchor record's text, a
decision-set member's rationale, an unknown key at the packet root, a nested
unknown key, and a *field name* — plus a `cfe_` enrollment secret. The single
failure is an `actorId`, which is GE-03. Scanning unknown keys and scanning field
names are separate mechanisms from scanning values, and both are present and
documented; that is a considered design, not a lucky one.

**The scan runs before shape validation.** Line 737-741: a malformed field cannot
reach an error path before its content is refused. This is a real ordering
decision and it is correct — the alternative leaks the thing you were trying not
to print.

**Refusal reasons never quote the matched text, and the catch block cannot be
traded for prose.** `describeRefusals` prints the field path only; the top-level
catch keeps a `field` only when it matches `/^packet(?:\.[A-Za-z][A-Za-z0-9]*|\[\d+\])*$/`
(line 1162) and drops the imported validator's message, which may embed packet
content. Both the packet-side and record-side paths go through the same filter.

**The frozen S2 rejection is discriminating correctly, and I verified it is
rejecting for the documented reason.** `packet-S2.json` exits 1 at
`packet.decisionSet.linkedNextStep`. Supplying only the correct
`DECISION_SET_LINKED_NEXT_STEP` string moves the failure to
`packet.decisionSet.members[1]` — the superseded-projection guard, firing on
exactly the RCL-003 defect. Two independent guards, both live, and the README's
account of which one fired is accurate. The guidance check compares against the
**domain constant**, not against presence: a packet carrying a plausible but wrong
`linkedNextStep` sentence is refused (verified). Refusing a valid old-build packet
rather than vouching for it is the right call and is stated plainly.

**Foreign workspace ids are caught in both the content and the cursor.** A
`ws_…` id in a record id is refused; the packet's own id appearing anywhere is
correctly allowed; a `sourceCursor` belonging to another workspace produces a
refusal rather than a shape error, which is the right classification and is
commented as such.

**The byte cap and the count invariants bound the blast radius.** 400 records in
one packet is refused at 64 KiB before parsing. `returned !== members.length`,
`returned > total`, and the anchor-page length vs `completeness.*.returned` cross
check all fire (verified: an anchor count mismatch is refused at
`packet.anchors.openTasks`). An out-of-set fabricated transition is caught. These
are real, and they are what keeps GE-01 from being reachable through sheer volume.

**`notEvidenceOf` travels with the record.** A reader who sees only the JSON still
reads "Recipient work or semantic correspondence … a packet is not resulting work,
and this record is not an observation", and `purpose` cites §9. The README's
"§6 field / supplied by this record / supplied by the observation file" table
names the one cell nothing in this directory fills, and says so.

**The template is honest about its own limits, and §14 bakes the RCL-003 lesson
in as a field rather than a footnote.** "Standing `cite the record ids you relied
on` instruction in `src/mcp/instructions.ts` in effect: yes / no", with the
RCL-003 citation split named in the field itself, is the right way to stop a
future reader from re-reading the citation difference as a benefit. "What this
observation does not establish" is pre-printed and correct. "A P plus an H is two
honest facts, not partial credit" appears four times across the protocol, the
template, the log, and the helper README, consistently.

**`LOG.md` is stronger than a log has to be.** The §8 expectation is
pre-registered with its source commit, attributed to the protocol rather than to
the recorder, and paired with the instruction that a wrong prediction is recorded
by appending rather than by editing. Rule 5 ("P and H never count"), rule 6 (no
retrofit), and rule 8 (one case, one attempt) are stated as rules, not as
intentions. The "Rows: zero" caption existing at all — even though it is a manual
line that will go stale (GE-15) — is an attempt at the right thing.

---

## What I could not attack

- **The helper cannot be given a lie about the workspace, and I did not try
  hard.** There is no verification path: every field it reports is either
  structurally consistent or refused, nothing is checked against Campfire, and the
  README says so in ten numbered limits. Every finding in GE-01, GE-06, and GE-13
  requires a **crafted or buggy packet file**, not a product defect — today's
  writer is correct, and I verified the writer's own projection
  (`handoffDecisionSetMembers`, `src/domain/recall.ts:935`) sets `section` to
  `current` / `historical` and omits `rationale` on a superseded member, which is
  what the helper's guard expects. So GE-01 needs a packet whose
  `recordedTransitions` was under-populated by some other means, and I am not
  claiming such a packet exists today. The severity is about what the helper is
  *for*: it is the §9 sanitized account a reviewer is meant to be able to trust
  without the private directory, and a packet that lies to it and is certified is
  worse than no record. The trust boundary is one field short of where it needs
  to be, and the fix is one call to a function that already exists.
- **The observer is not an adversary.** GE-01, GE-06, GE-13, and GE-04 assume a
  packet that lies. No deliberate actor needs to be assumed for any of them: the
  RCL-003 result records three projection defects in this exact code path and
  states that "no test covered it", and a defect that drops
  `linkedNextStep` is precisely a packet that lies to this helper. The realistic
  path to GE-01 is a regression, not an attack.
- **I did not attempt to read the private pilot directory or any raw stream**, so
  I cannot say whether a packet in that material would trip any of these
  detectors. The frozen `packet-S1.json` and `packet-S3.json` both emit cleanly;
  `packet-S2.json` is refused for the documented reason.
- **The detectors are patterns, not a parser, and the README says so in limit 9.**
  GE-03 and GE-04 are the boundary of that admission, not a contradiction of it. I
  did not try to build a general bypass — I tried sixteen shapes across the
  credential, path, workspace-id, and structural rules and found four that reach
  the record: the single-slash `scheme:` URI, `~user/`, the fullwidth slash, and
  the id-shaped credential anchor — plus the tool's own truncation marker (GE-05).
  Three of the five are realistic operator or product text. A determined adversary
  would find more; the fix is to stop enumerating shapes and start classifying
  them.
- **I did not fuzz.** I tried hand-picked shapes. A coverage-guided pass over
  `stringValues` would produce a longer list of the same kind of finding and
  nothing structurally new, which is itself part of the argument for GE-03 and
  GE-04's remedy.
- **I did not test the ordering between the helper and a real handoff**, because
  that would require running a Campfire agent. The determinism gap — that nothing
  in the committed record says when it was made or from which file — is real and
  is named in the README, but the mitigation that closes it lives in
  `docs/evidence/gate-e/HANDOFF-RUNBOOK.md`, **which is untracked** (`git status`
  shows it as `??`) and is not part of commit `4b9202b`. At the reviewed commit, a
  reviewer has the helper's README but not the runbook's "generate it at the
  moment of issue, and record the generation timestamp yourself". That is worth
  knowing before relying on the mitigation.
- **I did not test §7.2's operator-discipline requirements** — prompting,
  re-prompting, the desired answer not being supplied, the recipient not being
  the sender. Nothing in this repository can enforce any of them; §10.6 of the
  protocol says so. I read the template for fields that invite them to be ticked
  optimistically (GE-07, GE-11) and found two; I have no way to measure how often
  they would be.
- **I did not evaluate the case-selection machinery in operation.** There is one
  operator, zero cases, and no sample. GE-15 and GE-16 are structural observations
  about a plain markdown file with no enforcement, which is true of every such
  file; whether they matter depends on whether cases are ever opened and how many.
- **I did not audit `docs/evidence/gate-e/HANDOFF-RUNBOOK.md`.** It is outside the
  assigned scope and it is untracked, so it is not part of the reviewed commit. I
  cite it three times, only where it supplies a mitigation the committed artefacts
  lack (GE-09, GE-11) or where its absence at `4b9202b` matters. I have not
  checked its 22 preconditions, its 20-item disqualification checklist, or its
  worked example for false-pass paths of the same kind. If it is intended to
  commit alongside this apparatus, it should be reviewed as part of it; as it
  stands, the mitigations it contains are not available to a reviewer at
  `4b9202b`.
- **I did not review `docs/evidence/gate-e/README.md` as a primary target.** The
  task named the helper's README (`scripts/gate-e/README.md`), which I read
  closely. I read the *directory* README while orienting and relied on it for
  context; its "What makes a record inadmissible" list is, as far as I read,
  accurate, and GE-02 and GE-15 concern the template and the log rather than it.
- **I could not test the one thing that decides whether any of this matters:**
  whether a real recipient's work would actually match a packet whose decision set
  is mislabelled. That requires running a handoff, which the ground rules exclude.
  GE-01 is a defect in the evidence apparatus, not a demonstrated false H
  observation.