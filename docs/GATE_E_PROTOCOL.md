# Gate E — historical-reuse observation protocol

- **Status:** Protocol only. No observation has been recorded under it. Gate E is
  **unmeasured**.
- **Date:** October 12, 2026.
- **Package at protocol creation:** `1.15.0`; v1.16 was held. On October 13
  the founder directed v1.16 public release preparation under a separate
  release-scope override (`docs/RELEASE_V1_16_DECISION.md`). Gate E remains
  unmeasured. This protocol changes nothing in the product.
- **Applies to:** `docs/GATE_E_PROTOCOL.md`, version `gate-e-1`.
- **Frozen history:** `docs/SPRINT_RCL_001_RESULT.md`, `docs/SPRINT_RCL_002_RESULT.md`,
  and `docs/SPRINT_RCL_003_RESULT.md` are NO-GO / REFRAME and stay frozen. Nothing
  in this protocol edits or rescores them.
- **Pre-observation clarification, October 12:** With zero cases opened, §1 and
  §6 now separate case verdicts from §4.4 item labels and separate a Basis 2
  reconstruction's later write from the plan-time decision to use it. The
  `gate-e-1` protocol version remains because no observation used the earlier
  wording.

Gate E asks one question: **does prior completed work materially improve new work?**
This document defines what an observation of that is, what it must contain, and what
may not be counted as one.

This is not a sprint contract, not a pilot design, and not a verdict.

## 0. What this protocol is for

Three synthetic pilots have run against the Recall and handoff-packet surface. All
three were NO-GO:

- RCL-001: zero of three matched arms made a better justified next-action choice than
  the orientation arm; all three pairs chose the same action.
- RCL-002: the same. The treatment found history the control missed and then produced
  an unsafe recommendation from it.
- RCL-003: zero qualified treatment wins. Every control reached the keyed next action
  within budget by paging and drilling down.

The one behavioural difference that looked like a benefit — treatment arms citing
record ids, controls not — is **confounded**. The RCL-003 treatment build carried a
session instruction, `When you state a next action from Campfire state, cite the
record ids you relied on.`, that the control build did not, and both arms had
id-bearing tools registered. The evidence cannot separate the instruction from the
decision set, so citation is not recorded as a Recall benefit.

The current evidence supports treating Recall as a **provenance and portable-handoff
product bet**, not as a demonstrated improvement in choosing the next action.
The founder's later release-scope override is recorded separately. This
protocol is written so the bet can be tested honestly and cannot manufacture
a pass.

## 1. Claim shapes

An observation is recorded against exactly one of three claim shapes. They are not
interchangeable and they do not substitute for each other.

| Claim | Statement | Counterfactual needed |
| --- | --- | --- |
| **P — provenance** | Prior Campfire work was reused and that reuse became a durable, checkable record naming the source ids | none |
| **H — portable handoff** | An offline recipient acted from a handoff packet and their resulting work matches packet contents | none |
| **N — next action** | The reuse materially changed the real next action, or avoided a named investigation | yes, under §4 |

Only claim **N** can close Gate E. RCL-001 §5 defines the Gate E bar in claim-N
terms. Claims P and H can be observed today at low cost and are honest statements
about what the product delivers. They are recorded as such and they **do not** close
Gate E, are not scored toward it, and must never be presented as though they do.

**Verdict vocabulary.** An admissible case has one §6 verdict label:
`supports` when its claim is demonstrated, `weak` when its retained evidence is
checkable but inconclusive, or `null` when the case shows no material reuse or
change. An inadmissible or withdrawn case has no verdict label; its disposition
and reason remain in the log. The words `reported` and `none` in §4.4 label
individual weaker statements: `reported` is an unverified account, and `none`
is an agreeing or otherwise absent effect. They are not case verdict labels.
An agreeing Basis 2 reconstruction therefore gives a claim-N case a `null`
verdict and may give that reconstruction item the label `none`.
Claim shape is fixed when the case opens. A withdrawn case keeps that shape in
the log, with disposition `withdrawn` and no verdict label. A P or H case may
retain a normal-work plan as context, but it records `N/A` for the claim-N
counterfactual field and cannot be relabelled N after its outcome is known.

This split is not a lowering of the bar. It is a refusal to let a claim the data can
support stand in for a claim it cannot.

## 2. Terminology

Terms are the product's. Nothing here introduces a new object.

- **Workspace** — the collaboration boundary. All reads are `workspace:read`-gated.
- **Goal, Task, Finding, Decision, Artifact, Contribution** — the durable work objects.
- **Prior completed work** — a Finding, Decision, Task, or Artifact created before the
  observation's pre-action position and not created by the observing participant's
  current session.
- **Reuse** — the observing participant took a later action whose content depends on
  the content of a named prior record.
- **Materialized** — the reuse left a durable Campfire record that names or depends on
  the source ids (§3).
- **Pre-action position** — the workspace append position, or the `sourceCursor` /
  `sourcePosition` reported by the read the participant used, captured before the next
  action was taken.

  *Amendment 1, October 13, 2026: for claim H, this position comes from the packet's
  own read at issue. See §12. The wording above stands as written and is unchanged
  for P and N.*
- **Surface** — the way the prior work was reached: an orientation page from
  `get_workspace_context`, a catch-up page from `get_workspace_changes`, an object read,
  a `recall_workspace` hit or `decisionSet` member, or a handoff packet file written by
  `campfire handoff-packet`.

## 3. What counts as an observation

### 3.1 Qualifies

An observation qualifies when **all** of the following hold.

1. **Ordinary work.** The work is real work the participant was doing anyway: a task,
   question, or incident with an outcome that existed outside this measurement.
2. **Voluntary use.** For P and N, the participant chose to reach for prior
   Campfire work; they were not asked to look for it or re-prompted. For H, the
   sender chose to make a packet during ordinary work and the recipient used it
   during an ordinary handoff. Giving the recipient the packet is inherent to H;
   a prompt that supplies the desired answer is not.
3. **A real dependency.** The later action is incoherent, wrong, or unsupportable
   without the content of the named prior records. "Would have been nice to have",
   "confirmed what I already believed", and "I read it while I was there" do not
   qualify.
4. **Checkable result.** P and N leave a durable, typed Campfire record that
   resolves when checked (§5). H leaves a dated, recipient-authored work product
   or action that can be checked against the packet's source ids and relevant
   contents. The packet or a recipient's answer alone is not resulting work.
5. **Recorded under §6 and §7.** The case is opened before its outcome is known.
   A claim-N counterfactual also meets §4.

### 3.2 Does not qualify

- Reading, retrieving, paging past, or citing a record without acting differently.
- Reuse of the participant's own prior work in the same session with no intervening
  separate session boundary.
- Reuse that only restates prior Campfire text into new Campfire text.
- Anything inside a seeded fixture. `fixtures/**` and `docs/evidence/rcl-00*/**` are
  test material by construction, not ordinary work.
- The repository owner's own dogfooding on Campfire. It is real work and may be
  retained with an inadmissible disposition and any account marked `reported`,
  but it is one participant working on the product's own repository in a
  session that knows about the measurement. It does not
  qualify as ordinary multi-participant evidence.

  *Amendment 5, October 13, 2026: for claim H, the owner may be either side of
  a genuine handoff on ordinary non-Campfire work. Solo work on Campfire's own
  repository remains inadmissible. See §12 for the exact scope and safeguards.*
- A pilot run, a replay, a resumed session, or any case whose outcome was already
  known to the recorder when the case was opened.

## 4. What "materially changes a real next action or avoids investigation" means

This section is the crux. It is operational on purpose.

### 4.1 The counterfactual problem, stated plainly

A change claim needs two states: the action actually taken **with** reuse, and the
action that was available **without** it. The first is observed. The second is not.

**The same person cannot be run twice.** In the three synthetic pilots that was solved
by seeding identical workspace state and running a matched control arm on a separate
harness session with the same model and budget. That design is why their zero results
are trustworthy. Ordinary work has no such clone. Any protocol that claims otherwise
in ordinary work is describing a synthetic pilot and calling it something else.

The honest consequence: an ordinary-work observation can only ever support a **bounded**
claim about a specific case. It cannot support a rate, a general claim about next-action
quality, or a claim about people in general. The RCL-001 contract asks for "at least
one" case. One case establishes existence and nothing more. Do not report a rate from
it, and do not write words like "typically", "consistently", or "clearly" about it.

### 4.2 Admissible counterfactual bases

A claim-N observation must name the basis it used. Exactly two bases are admissible.

**Basis 1 — plan-time recorded counterfactual, resolved later.**

Before accessing the reused records, a normal-work plan records the intended
next step: a specific query to run, a specific record to create, or a specific
question to put to an owner. It is retained as the counterfactual only if it
was written for the work itself, without an observer asking the participant to
construct a comparison. The entry is dated before the outcome is known.
Afterward, the deferred item is either performed and its result recorded, or
abandoned with a recorded reason.

This is the only ordinary-work basis that cannot be retrofitted, because the claim is
written before the participant knows whether it was right.

- *Establishes:* the reuse changed the recorded plan and the executed action, relative
  to what the participant themselves had committed to before seeing the outcome.
- *Does not establish:* that the same participant, absent Recall, would actually have
  executed the deferred item. A participant may have skipped it for unrelated reasons
  and then found a use for the citation. Basis 1 supports a **plan-level** claim.

**Basis 2 — independent bounded reconstruction.**

After the observation closes, a second qualified reader reconstructs the admissible
next actions from the frozen pre-action position, using only the pre-Recall surface:
`get_workspace_context`, `get_workspace_changes`, and object reads. No
`recall_workspace`, no handoff packet. The reconstruction is written and committed
**before** it is compared to the observed action, and its author did not see the
observed next-action text before writing theirs. The reconstruction states which
actions the pre-action workspace supported, which it did not support, and what
investigation each supported action would have required.

- *Establishes:* whether the pre-reuse surface supported an action materially different
  from the one taken.
- *Does not establish:* that the original participant would have reached the
  reconstruction's answer.
- *Expected result:* given RCL-001/002/003, a reconstruction will often support the
  same action. **That null is a valid result and is recorded as one.** Do not treat a
  reconstruction that agrees as a failed attempt; treat it as a measurement.

A claim-N observation must use Basis 1, Basis 2, or both, and must say which. Basis 1
alone supports a plan-level claim. Basis 2 alone supports a surface-level claim.
Neither supports a general claim.

### 4.3 What "avoids investigation" means

An avoided investigation is a specific, nameable inquiry that was going to be
performed, was not performed, and that a record shows the reuse made unnecessary.

It is **not**:

- fewer tool calls. RCL-003's controls paged and drilled down and still reached the
  keyed answer. Call counts measure navigation style, not avoided work.
- less elapsed time, absent a named task that was going to be performed.
- "the answer felt already known".
- an experiment the participant would have run if they had had more time.

If the avoided item was never named before the fact, no investigation was avoided. It
was only described afterwards.

### 4.4 What only supports a weaker claim

These are admissible to **record** and inadmissible to **count**:

| Reported | Label | Counts toward Gate E |
| --- | --- | --- |
| "Recall helped", "it felt faster", "the agent was more confident" | `reported` | no |
| "I would have had to search again without it" | `reported` | no |
| Citation happened, cause unattributed | `reported` | no |
| A reconstruction agrees with the observed action | `none` | no, and recorded as a null |
| Reuse is materialized and checkable | `P` | no |
| Packet contents determined a recipient's action | `H` | no |

*Amendment 2, October 13, 2026: `P` and `H` in this table are claim shapes,
not §4.4 item labels. The item labels are `reported` and `none`; see §12.*

The RCL-003 citation split is exactly the third row: a real behavioural difference
between arms whose cause cannot be separated from a treatment-only instruction. It is
recorded as a lesson about pilot design. It is not evidence.

### 4.5 Fabricated counterfactuals

The following are inadmissible and their presence invalidates the observation:

- A counterfactual written after the fact by the participant, from memory, describing
  what they would have done.
- A counterfactual that assumes the participant would have opened a page, run a
  command, or asked a question they had no reason to open, run, or ask.
- A counterfactual describing an inquiry that no available surface and no prior record
  would have surfaced.
- "Would have taken longer" with no named task.
- A reconstruction written after reading the observed action, or written by someone who
  chose the case.

## 5. Materialization and handoff evidence

For P and N, historical reuse becomes materially visible when something is
**created and cites**. H is an offline handoff claim; its resulting work is
checked against the packet and does not imply an in-product citation.

### 5.1 Minimum requirement

For P and N, at least one durable Campfire record in the observing workspace must
exist at the time the observation is checked, and it must:

- carry its own id, kind, workspace, actor, actor type, and `created_at`;
- name the reused source ids through a typed relation, not only through prose;
- still resolve, unmodified, when a reviewer with no knowledge of the observation reads
  it back.

Prose is not materialization. "As noted in the earlier finding" is prose.

### 5.2 Strongest forms the current model supports

| Materialization | Surface | Verdict |
| --- | --- | --- |
| A **Decision** citing the reused **Finding**(s) | `cite_decision_basis`, `decision_citations`, optional note bounded to 500 characters | supported |
| A **Finding** supported by the reused **Artifact** | `cite_finding_evidence`, `finding_evidence`, `supports` / `contradicts` | supported |
| A **Decision** citing a Finding that is no longer current | same table; `needsReview` is computed at read time and flags the cited ids | supported, and it is the honest way to show reuse of historical work |

Citing a superseded Finding is a first-class, checkable demonstration that historical
work was reused. The citation does not revoke the decision; `needsReview` marks it for
the owner. That is the mechanism, used as designed.

### 5.3 Forms the current model does not support

These do not materialize under the current data model and cannot be counted:

- A new **Finding** that reuses an older **Finding**. There is no finding-to-finding
  relation.
- A **Task** updated because of a reused Decision or Finding. Tasks carry no source
  relation at all.
- An **Artifact** derived from reused work. Artifacts carry a typed reference and
  provenance only.
- Any reuse that crosses a workspace boundary, including the entire handoff-packet
  path. Citations and evidence are workspace-scoped and foreign ids are dropped by
  design. Packet provenance exists only in a local `0600` file that Campfire does not
  store.

### 5.4 What is not materialization

A `recall_workspace` hit, a `decisionSet` member, a handoff packet file, a transcript,
a chat message, an install, a Viewer page, or a telemetry event. None of these is a
typed Campfire record. A packet plus an answer is also insufficient for H:
the recipient must produce a checkable work product or take a checkable action
in ordinary work. H evidence does not become P or N evidence by being retained.

## 6. Recording requirements

The observation log entry must carry all of the following. Fields marked **[plan-time]**
are captured before the outcome is known. Claim-specific fields are marked
`N/A` with a reason when they do not apply; a P or H observation is not
required to invent an avoided investigation or a typed relation it cannot have.

| Field | Content |
| --- | --- |
| Observation id | protocol version, open and close timestamps |
| Participant | actor id, actor type; for an agent: harness, version, model, reasoning setting, `agentSessionId`, and the human principal |
| Workspace | workspace id and name, and the `workspace:read` basis for every read in the observation |
| Build | Campfire package version and git commit |
| **[plan-time]** Pre-action position | append position, or the `sourceCursor` / `sourcePosition` reported by the read used |
| **[plan-time]** Task | the prompt or task, verbatim; for P/N confirm that it named neither Recall, nor `recall_workspace`, nor "prior work"; for H record the ordinary handoff request |
| **[plan-time, N only]** Counterfactual basis plan | Basis 1's pre-retrieval normal-work plan, if available, or the decision to use a blinded Basis 2 reconstruction; timestamp the choice before the outcome |
| Counterfactual evidence (N only) | Basis 1's verbatim plan and later resolution, or Basis 2's independent reconstruction committed after the action but before comparison; include timestamps (§4.2) |
| Reused sources | each source id with kind, and the surface it was reached through — orientation, catch-up, object read, `recall_workspace`, `decisionSet`, packet file — or `unknown` |
| Materialized record (P/N) | kind and id of the new record; the `decision_citations` or `finding_evidence` rows; the note text verbatim |
| Resulting work (H) | dated recipient-authored work product or action; its reference and reviewer access condition; bounded, sanitized excerpts of both the packet fields and the dependent or contradicting work-product parts; source ids; recipient consent and any attestation; the retention grade and its verdict ceiling (§12 Amendment 6) |
| Next action taken | verbatim, as written in the record or in the plan |
| Investigation avoided | the named item, why it was deferred, and how that was settled |
| Outcome | what happened afterwards, dated |
| Attribution notes | contamination, dropped reads, replacements, withdrawals, standing session instructions in effect |
| Verdict | claim shape P / H / N, basis or bases used, case disposition, and for an admissible case the label `supports` / `weak` / `null`; §4.4 item labels are separate |

A missing required **[plan-time]** field makes the observation inadmissible under
this protocol. A missing counterfactual basis makes a claim-N observation
inadmissible; a testimonial account may be retained as a `reported` item, with
no case verdict. P and H do not require a counterfactual.

## 7. Admissibility rules

Strict. An observation that violates any of these is inadmissible under this
protocol. Even admissible P and H observations do not close Gate E.

1. **No outcome-conditioned case selection.** Cases are enumerated in a dated list
   before any of them is examined for qualification. Every case in the log is recorded,
   including the ones that did not qualify. A case opened because its outcome looked
   good is inadmissible.
2. **No prompting to use Recall in P or N.** The participant is not told to use
   Recall, asked to look for prior work, or re-prompted after a quiet moment.
   An H recipient may receive a packet as part of the handoff but is not given
   the desired answer. Prompt text is retained verbatim. The standing session
   instruction in `src/mcp/instructions.ts` — cite the record ids you relied on —
   is product text present in every Campfire session and is **not** voluntary
   behaviour. Every observation records whether that instruction was in effect.
3. **No attribution from the absence of a control arm.** An ordinary-work observation
   can show that prior Campfire work changed a next action. It cannot show that
   `recall_workspace` was the surface that made the difference rather than orientation,
   paging, or an object read. Surface attribution requires a matched design, which
   ordinary work does not have.
4. **No immaterial reuse.** Work that prior Campfire records did not materially affect does not count,
   however much reading preceded it.
5. **No fixtures or synthetic runs.** Seeded workspaces, `fixtures/**`, pilot
   directories, and any workspace created for the purpose of the measurement are not
   ordinary work.
6. **No telemetry or install counts.** Install totals, `activated` / `active` events,
   install-route counts, and session counts are never Gate E evidence. There is no
   reuse telemetry event and none is authorized to be added.
7. **No subjective substitution.** "It felt faster", "it saved me", and "the agent
   seemed sharper" are not a material change. They may be retained as `reported` items and
   they count toward nothing.
8. **No post-hoc counterfactual.** Basis 1 must be dated before the outcome; Basis 2
   must be written before comparison and by someone who did not see the observed
   action. See §4.5 for the inadmissible forms.
9. **No case reuse.** A workspace, participant, or case is not re-run as a second
   attempt. A withdrawn observation stays in the log with its withdrawal reason.
10. **No retrofit.** An observation is never written into a sprint result as though it
    were that sprint's evidence. See §9.
11. **No generalization from one case.** One admissible claim-N observation establishes
    that the effect occurred at least once. It does not establish a rate, a direction,
    or a mechanism, and the write-up must not imply one.
12. **Agent cases are agent cases.** An agent's reuse is evidence about that harness,
    model, and date. It says nothing about human participants unless a human case is
    separately recorded.
13. **Retained evidence.** The source ids, the materialized record or H work product,
    and the plan-time entries must be readable by a reviewer with no access to the
    observer's memory. If they are not retained, the case is inadmissible; a
    testimonial account may remain as a `reported` item.
14. **Nulls are recorded at the same rigour.** A case that produced no material
    difference is a result, not a discard.

## 8. Honest negative outcomes

A failed, ambiguous, or null observation is a valid and useful result. It is expected
to be the common one.

- **A failed or ambiguous observation must be recorded as one**, in the same log, with
  the same fields, dated and attributed the same way.
- **Partial evidence does not close Gate E.** A claim-P observation plus a claim-H
  observation is two honest facts about provenance and handoff. It is not a Gate E pass
  and must not be reported as partial credit against the gate.
- **An agreeing reconstruction is a result.** If a Basis 2 reconstruction supports the
  same next action, that is the expected finding given three consecutive NO-GO pilots.
  The case verdict is `null`; the reconstruction item may be labeled `none`.
- **An expected null.** The honest prediction of this protocol, read alongside
  RCL-001/002/003, is that most ordinary-work cases will materialize as claim P or H and
  fail to produce an admissible claim-N counterfactual. Recording that expectation
  before any case is opened is itself part of the discipline.
- **No number of nulls authorizes an inference in the other direction.** Absence of
  claim-N observations means Gate E is unmeasured, not that Recall is harmful.
- **Gate E stays open.** It stays open until at least one claim-N observation with an
  admissible counterfactual basis exists. Until then the correct status line, in every
  document that mentions it, is that Gate E is unmeasured.

## 9. Where the record is kept

- Observations are written under `docs/evidence/gate-e/`, one file per observation,
  named `gate-e-observation-<YYYY-MM-DD>-<id>.md`, plus one `LOG.md` that lists every
  case ever opened with its verdict, including the ones that did not qualify.
- Each observation file carries the protocol version, the recorder's name, the open and
  close timestamps, and every §6 field. Entries are appended, not rewritten.
- Raw transcripts, credentials, and packet contents stay out of the repository, as in
  the RCL evidence trees. A reviewer without the private directory must still be able
  to check the plan-time entries and the P/N materialized record, or the H work product
  and its correspondence to sanitized packet fields, from what is committed.
- For H, retain a sanitized account of the packet fields used, the dependent
  or contradicting parts of the recipient's resulting work, and its reference
  with a stated reviewer access condition. Include bounded excerpts on both
  sides of every substantive correspondence; ids and text lengths alone cannot
  show what the recipient used. A safety field recorded `not borne on` needs a
  reasoned verdict, not an invented excerpt. A reviewer-reachable artifact may
  be public or accessible through the reviewer's own named and verified
  organization access. An excerpt-only private artifact caps the case at
  `weak`; no reachable artifact and no work-product excerpts makes it
  inadmissible (§12 Amendment 6). A packet alone, or a model answer without
  resulting work, is insufficient. Keep private packet bytes outside the
  repository.
- The record is **never retrofitted into a sprint result**. A sprint result may cite an
  observation by id and may state that it exists. It may not absorb it, summarize it as
  its own evidence, or be edited after the fact to include it. `docs/SPRINT_RCL_001_RESULT.md`,
  `docs/SPRINT_RCL_002_RESULT.md`, and `docs/SPRINT_RCL_003_RESULT.md` are frozen.
- Correcting a false statement in an observation is done by appending a dated
  correction inside that observation, not by editing the original text silently.

## 10. Gaps in the current product

Recorded because the protocol cannot honestly observe Gate E without them. **This
document proposes no change.** Each item is a statement of what is missing, for a
future decision that has not been made.

1. **No finding-to-finding relation.** Reuse that materializes as a new Finding built
   on an older Finding has nowhere to name the source ids. Only prose is available.
2. **No source relation on Task or Artifact.** A Task updated because of a reused
   Decision, or an Artifact derived from reused work, records provenance of the actor
   but not the prior work it depends on.
3. **The recall read writes no Contribution.** Retrieval leaves no workspace record.
   After the fact it cannot be shown that a recall query ran, on what workspace, or
   over which text. Application logs record actor, workspace, operation, and allow or
   deny only, never query text or record ids. There is therefore no product-level
   evidence that the reused ids were ever surfaced; the surface attribution must come
   from the observer.
4. **Cross-workspace reuse cannot be materialized.** Citations and evidence are
   workspace-scoped and foreign ids are dropped by design, so the handoff-packet path
   can never leave a checkable in-product trace of what was reused.
5. **No next-action object.** Nothing in the model ties a concrete next action to the
   evidence behind it. A Task status change is the closest available approximation.
6. **No counterfactual field.** Nothing in the product records what was going to happen
   absent the reuse. Every counterfactual lives in this observation log, outside the
   product, and depends on operator discipline rather than system enforcement.
7. **No distinction between recalled and paged reuse.** The model cannot tell whether a
   participant found prior work through `recall_workspace` or through
   `get_workspace_context`. Claim N cannot attribute the difference, and rule §7.3
   forbids claiming that it did.
8. **The standing citation instruction.** `src/mcp/instructions.ts` instructs every
   agent session to cite the record ids it relied on. This makes citation expected
   behaviour rather than voluntary behaviour, and it is exactly the confound that made
   the RCL-003 citation split uninterpretable. It is recorded here so that no future
   observation mistakes it for evidence of voluntary reuse.

## 11. What this protocol does not do

- It does **not** claim Gate E is passed, partially passed, or closable. Gate E is
  unmeasured. The honest position of this product today is provenance and portable
  handoff, not a demonstrated improvement in choosing the next action.
- It does **not** authorize a release, a tag, a public snapshot, a push, or a
  deployment. At this protocol's creation v1.16 was held at `1.15.0`; the
  October 13 release-scope direction is a separate decision recorded in
  `docs/RELEASE_V1_16_DECISION.md` and does not change this protocol's gates.
- It does **not** reopen, edit, or rescore RCL-001, RCL-002, or RCL-003. Their results,
  fixtures, and runs stay frozen.
- It does **not** replace a scored pilot. If a claim about next-action quality is ever
  contested, that question needs a preregistered matched pilot with frozen scenarios,
  key, rubric, budgets, and arm order, decided on its own merits. This protocol governs
  observation, not comparison.
- It does **not** add a product feature, a schema field, a tool, a CLI command, or code.
  §10 records gaps. It does not fill them.
- It does **not** claim Gate B, Gate C, or the open v1.12 Viewer observations. Those are
  separate and stay separate.
- It does **not** authorize embedding, cross-workspace retrieval, an organization-wide
  memory index, packet import, or per-command telemetry. `SKILL.md` places Gate E as the
  gate for that investment, not as the authorization for it.

## 12. Amendments

An amendment is appended, dated, and names the section it amends. The amended
wording stays on the page; the amendment states the change and what it means for
an operator. This section is pre-observation: no case has been opened and no
observation has been recorded under any earlier wording, so the protocol version
stays `gate-e-1` and no section body is rewritten.

### Amendment 1 — October 13, 2026 — whose read supplies the pre-action position for claim H

**The ambiguity.** §2 defines the pre-action position as "the workspace append
position, or the `sourceCursor` / `sourcePosition` reported by the read the
participant used, captured before the next action was taken." Claim H (§1) has
two participants: the sender who makes the packet, and the offline recipient who
acts from it. §2 says "the participant" in the singular and does not say whose
read supplies the position for H. Two readings have looked compliant:

1. **The sender's earlier orientation cursor.** During their own ordinary work
   the sender did a `get_workspace_context` or catch-up read; that read's cursor
   is recorded before the packet is issued.
2. **The packet's own read.** At issue, `campfire handoff-packet` performs one
   authorized service read of the sender's workspace. The packet's `sourceCursor`
   and `sourcePosition` are that read's, and the packet-evidence record generated
   at issue carries them.

**Resolution.** For claim H, the pre-action position is the packet's own read,
captured and dated at issue. The operator records the read and the `sourceCursor`
/ `sourcePosition` it reports, as carried in the packet-evidence record. A
sender's earlier orientation cursor is not the H pre-action position and is not
recorded in that field.

This is resolved here, not left to the owner, because the requirement decides it:
§7.13 and §9 require a reviewer with no access to the private directory to be
able to check the plan-time entries from what is committed, and only the packet's
read is carried by a committed artifact generated from the packet — the
packet-evidence record taken at issue. The two readings are not equal under that
test.

**Reasoning.** Three reasons, strongest first.

1. **It is the read the observed action rests on.** For H, the next action (§6)
   is the recipient's work product or action (§3.1.4), and the recipient reaches
   the prior work through the packet file — the surface §2 names — not through a
   workspace read of their own. The packet's read is the workspace read that
   produced that file, so it is the read behind the action the case observes.
   This holds under either reading of "the participant": the recipient's route
   to the prior work is the packet, and the sender's read that populates the
   packet is the packet command's read, made on the sender's query and
   credential. A sender's earlier orientation read belongs to the sender's other
   work; the packet is not drawn from it, and its cursor does not bound the
   packet's contents.
2. **It is the read the committed material carries.** §6 makes the position a
   `[PLAN-TIME]` field, and §7.13 and §9 require the plan-time entries to be
   checkable from what is committed. The packet-evidence record, generated at
   issue and pasted into the observation, carries `packet.sourcePosition` and
   `packet.sourceCursor` decoded to position, phase, tip, and whether it matches
   the position. A sender's earlier cursor exists only as the recorder's
   transcription — an orientation read writes no record of itself, as §10.3
   records for the recall read — and nothing else in the committed record
   corroborates it; the packet-evidence record carries a different position.
   That is the shape §7.13 refuses.
3. **It keeps §2's own boundary coherent.** §2 defines prior completed work as
   created before the pre-action position. The packet's read is
   snapshot-consistent with its `sourcePosition` — the read is refused if the
   position moves during it — and the packet draws only from state at or below
   that position. Every source it carries is inside that boundary. An earlier
   orientation cursor can predate records the packet nevertheless carries, so
   some of the reuse's own sources would sit after the recorded position, and the
   position and the reused work would disagree about the same records.

**What this changes for an operator.**

- The `[plan-time]` Pre-action position (§6, `TEMPLATE.md` §5) is filled from
  the packet's own read, dated at the issue time. One shape, not both: the read
  is named (`campfire handoff-packet`) and its reported `sourceCursor` /
  `sourcePosition` are recorded. It is not the append position measured at any
  other moment, and not a reconstruction written afterwards.
- A sender's earlier orientation cursor is not recorded as the pre-action
  position. `HANDOFF-RUNBOOK.md` Step 2 offered it as an alternative; the same
  runbook's Step 1 item 6 and Step 4 already fill §5 from the issuing read, and
  Step 2 now carries a dated note pointing here.
- P and N are unchanged. For those claims there is one participant whose action
  is observed, and "the read the participant used" stays as written.

**Limits.** This amendment answers one question and changes nothing else. It does
not make the H plan-time record independently verifiable: the packet bytes stay
private, and the packet-evidence record remains the recorder's attested capture
of the packet fields. It does not change the definition, a field, an admissibility
rule, or the protocol version. It answers the open question recorded in
`HANDOFF-RUNBOOK.md` §9 item 2.

### Amendment 2 — October 13, 2026 — case verdict labels and §4.4 item labels are separate fields

**The ambiguity.** §6 gives an admissible case one verdict label from `supports`,
`weak`, or `null`, and its Verdict row says "§4.4 item labels are separate". §1
says the words `reported` and `none` in §4.4 "label individual weaker statements"
and "are not case verdict labels", and §8 says an agreeing Basis 2 reconstruction
gives the case the verdict `null` and may give the reconstruction item the label
`none`. The statements do not fix the field-level mapping. §4.4's table carries
four tokens in its Label column — `reported`, `none`, `P`, `H` — and nothing in
§1 or §6 says what the last two are doing there or whether they are item labels.
Nothing states whether the `none` item is recorded when the agreeing
reconstruction that produced the `null` verdict exists, or whether the item
field may sit at `n/a` in that case. `TEMPLATE.md` §15 carries two separate
fields, so an operator can fill one and leave the other telling a different
story about the same reconstruction without breaking a stated rule.

**Resolution.** They are two separate axes with disjoint vocabularies, recorded
in separate fields, and both are recorded when both apply.

- The **case verdict** (§6; `TEMPLATE.md` §15 "Verdict label") is one value for
  an admissible case: `supports`, `weak`, or `null`. Nothing else goes in that
  field. An inadmissible or withdrawn case has no verdict label and carries
  `N/A` with its disposition.
- The **§4.4 item label** (`TEMPLATE.md` §15 "§4.4 label for weaker items", and
  its items table) is `reported` or `none`, one per retained weaker item; `n/a`
  when the case retained none. `null`, `weak`, `supports`, `P`, and `H` are not
  item labels.
- The `P` and `H` rows of §4.4's table are not item rows. They state whole-case
  facts and name the claim shape the fact belongs to. Claim shape is the §6
  field fixed at open (§1); it is recorded there and never in the item field.
- An **agreeing Basis 2 reconstruction** is recorded in both fields because it
  is two facts. The case verdict is `null` — the case shows no material reuse or
  change — and the reconstruction item is recorded in the §4.4 field with the
  label `none`. `none` is a result, not a failure: §4.4 records it as "no, and
  recorded as a null", and §8 calls the agreeing reconstruction the expected
  finding. The item field stays at `n/a` only when no weaker item was retained,
  never when a reconstruction agreed, and `none` never substitutes for the
  `null` verdict, or the reverse.

**Reasoning.**

1. **The protocol already assigns the fields; this amendment states the
   mapping.** §6's Verdict row describes a case-level field and says item labels
   are separate; §1 calls `reported` and `none` item labels and not verdict
   labels; `TEMPLATE.md` implements exactly two fields. Nothing here introduces
   a vocabulary or a field the apparatus does not already carry.
2. **The two labels answer different questions, so neither can stand for the
   other.** The verdict answers whether the case's claim is demonstrated. An
   item label says what a retained weaker item is. A `null` verdict and a `none`
   item stand side by side because they describe the case and the reconstruction
   separately.
3. **`none` is a result and belongs in the results field.** §8 makes the
   agreeing reconstruction the expected finding given three consecutive NO-GO
   pilots; §4.4 counts it as "no, and recorded as a null". Filing `none` as the
   verdict would replace the case-level result; omitting it would lose the
   item-level one, against §7.14's rule that nulls are recorded at the same
   rigour.
4. **The `P` and `H` rows cannot be item labels.** Claim shape is already a
   required §6 field fixed at open, and the template's item menu excludes them.
   Reading them as item labels would give one fact two label slots and would
   invite the case-label / item-label substitution the pre-observation
   clarification removed.

**What this changes for an operator.**

- Fill both fields. Verdict: `supports` / `weak` / `null`, or `N/A` for a case
  with no verdict. Items: `reported` and/or `none`, one row per item; `n/a` only
  when no weaker item was retained.
- If the case's evidence includes an agreeing reconstruction, the verdict field
  reads `null` and the item field and items table carry `none`. Both are
  written. Do not write `none` as the verdict, and do not leave the item field
  at `n/a` for that case.
- `P` and `H` are written in the claim-shape slot. They are not item labels and
  never appear in the item field.
- `TEMPLATE.md` §15's two fields are the fields this amendment reads. No field
  is added, and the log's verdict column keeps the same vocabulary.

**Limits.** Vocabulary and field mapping only. This amendment changes no
admissibility rule, no §4.2 basis rule, and nothing about what counts toward
Gate E; `none` remains a recorded, non-counting result. It does not decide how a
case records a Basis 1 result and a Basis 2 result that disagree — each item is
labeled on its own record, and §1's and §8's verdict rules are unchanged. It
adds no label, no field, and no protocol version change.

### Amendment 3 — October 13, 2026 — owner-dogfooding scope: not resolved; the repository owner decides

*Historical status: Amendment 5 below records the owner's subsequent ruling for
claim H. This section remains as the dated record of the earlier open question;
its instruction to hold owner-involved H cases no longer applies.*

**This item is not resolved here.** §3.2's fifth bullet has two readable scopes,
and the text does not select between them. The repository owner must decide.
What follows records the question, the two scopes, and what each changes. No
case is opened under an assumed scope.

**The ambiguity.** §3.2's fifth bullet reads, in full: "The repository owner's
own dogfooding on Campfire. It is real work and may be retained with an
inadmissible disposition and any account marked `reported`, but it is one
participant working on the product's own repository in a session that knows
about the measurement. It does not qualify as ordinary multi-participant
evidence."

Two scopes are readable from that text, and they do not select the same cases.

1. **Broad — the owner using Campfire at all.** The bullet's subject is "the
   repository owner's own dogfooding on Campfire": the owner's use of the
   product, on whichever side of a case the owner stands. Under this reading an
   owner→non-owner handoff on ordinary, non-Campfire work is inadmissible,
   because the owner's part in it — issuing or receiving the packet — is the
   owner using the product in a session that knows about the measurement.
2. **Narrow — the owner working on the product's own repository, alone.** The
   bullet's description is its scope: "one participant working on the product's
   own repository in a session that knows about the measurement." Under this
   reading an owner→non-owner handoff on ordinary, non-Campfire work is not
   covered by the bullet: the handoff has two participants by construction (a
   sender and a separate recipient), and the work is not the product's own
   repository work.

The bullet's two sentences do not have the same extension. The label can cover
any owner use; the description names a one-participant, measurement-aware loop
on the product itself. Neither is stated to govern the other, and no other
section supplies the missing scope: §3.1.1 requires ordinary work, §3.1.2
requires the sender's voluntary packet and the recipient's ordinary handoff, and
§7.2 governs prompting. None of them says whether the repository owner may be
one of a handoff's two participants.

The companion documents sit on different sides. `TEMPLATE.md`'s opening check
renders the line as "Not owner dogfooding on Campfire's own repository" — the
owner, the product, and the product's repository, without the bullet's "one
participant" or measurement clause. The runbook applies the broad reading
operationally: precondition 11 tests the sender, §7.1 item 5 tests the case, and
§8.1's table tests the recipient. Three renderings, different scopes.

**Resolution — none. Left to the repository owner.** The text does not decide
it, so it is not resolved here. It is also not a clerical question: the choice
sets an evidence policy — who may supply Gate E's evidence — and it has a
material consequence either way.

- **Broad** keeps the product's builder out of the evidence base. It costs the
  easiest honest H handoffs, because the owner is the participant most available
  to run one. Owner-involved work is retained only as inadmissible material,
  with any account marked `reported`, and counts toward nothing.
- **Narrow** admits owner-involved handoffs where the recipient is a separate
  participant and the work is not the product's own repository work, if the
  other §3.1 conditions hold. It accepts that the packet's construction is the
  builder's, made in a session that knows about the measurement, and that the
  observation must disclose this in §14 rather than argue it away. It does not
  make such a case stronger than one with no owner involved.

The owner should state the decision, its date, and its scope — which side or
sides of a handoff and which claim shapes it covers — and record it under §12,
as a dated note or a further amendment. Until it exists, no owner-involved case
is opened.

**Reasoning — why this is left to the owner.**

1. **The bullet's label and description disagree, and no requirement selects
   between them.** Amendment 1 was resolved here because §7.13 and §9 made only
   one reading checkable from what is committed. Both readings here retain
   evidence and satisfy §7.13 equally. No section prefers either, so quoting the
   bullet cannot produce an answer the bullet does not contain.
2. **A recorder cannot be left to choose.** Under an undecided bullet, a
   recorder who wants a case in reads the narrow scope; one who wants it out
   reads the broad scope; §7.1's enumeration discipline cannot see a scope
   chosen at reading time. The honest move is to put the choice where the
   protocol puts evidence policy — with the repository owner.
3. **For H the bullet states no scope at all.** The bullet describes "one
   participant"; an H case has a sender and a separate recipient. The bullet's
   description does not fit that shape, so extending it to either end of a
   handoff is a policy choice, not a reading. P and N cases can match the
   description; the owner's decision should say what it means for them too.

**What this changes for an operator.**

- Until the owner decides, do not open an owner-involved observation under
  either scope. The opening check's owner line cannot be answered honestly
  without the rule. If such a candidate appears, enumerate it (§7.1) and note
  that the scope is undecided; the enumeration starts the count and pre-judges
  nothing.
- Do not open a case under one reading and record its disposition under the
  other.
- After the decision: a candidate enumerated while the question was open may be
  opened under the decided scope if it still meets §3.1; until the decision
  exists, it stays unopened. Cases opened after the decision follow it.
- When the decision is recorded, the template's opening-check line and the
  runbook's precondition 11, §7.1 item 5, and §8.1 row will need pointed notes
  to match it. This amendment stays on the page as the record of the open
  question either way.

**Limits.** This amendment decides nothing. It does not change §3.2 or any
other section body, does not make owner dogfooding admissible or inadmissible,
does not alter the template or the runbook, and does not lower or raise any
other bar. It does not say an owner→non-owner handoff would qualify under the
narrow reading; each §3.1 condition would still have to hold. It records an open
question that the text does not answer, with both answers and their
consequences, for the owner to decide.

### Amendment 4 — October 13, 2026 — restatement versus correspondence for claim H work products

**The ambiguity.** §3.2 disqualifies "Reuse that only restates prior Campfire
text into new Campfire text." §3.1.4 requires claim H to leave "a dated,
recipient-authored work product or action that can be checked against the
packet's source ids and relevant contents." §5 says H's resulting work "is
checked against the packet and does not imply an in-product citation." For H the
work product will often be a commit, a pull request, or an external artifact,
and it will often carry the packet's content — a decision's rule, a constraint,
a value, sometimes verbatim. The protocol does not say whether that carrying is
a legitimate correspondence (the match §5 asks for) or a disqualifying
restatement. Two readings have looked compliant:

1. **Any carried packet text is restatement.** The work product's substantive
   content came from prior Campfire text, so the reuse only restated it.
2. **Restatement requires its own shape: prior Campfire text moved into new
   Campfire text with nothing else.** A commit, a PR, or an external artifact
   is not Campfire text, and a work product that enacts the packet's decision is
   a dependent action, not a restatement.

**Resolution.** The second reading is the one the document supports. Carrying
packet content through a dependent action is legitimate H work; copying it in
place of one is the disqualifying shape.

- The §3.2 bullet is scoped by its own words: "into new **Campfire** text", and
  by "only". A commit, a pull request, or an external artifact is not Campfire
  text, and a case whose reuse also produced a dependent action is not "only"
  restating. The bullet does not reach those outputs. §3.1.3, §3.1.4, and §5
  govern them.
- For H, the work product is a match when the recipient's action depends on the
  packet's records and can be checked against them: §3.1.3's test — the code,
  configuration, or external change would be incoherent, wrong, or unsupportable
  without the packet content — and §3.1.4's dated, recipient-authored, checkable
  product. Implementing the packet's decision is exactly the action §1's H
  claim and §5's check are written for.
- **Carrying packet content verbatim into a commit does not convert the match
  into a restatement.** The correspondence test is dependency, not originality
  of wording: if replacing the packet field would leave the work product wrong
  or unsupportable, the field is in scope and the correspondence can be a match
  even where the recipient used the field's exact words. If the same work
  product could have been produced from the sender's handoff prose alone, it
  fails §3.1.3 and §5.4 whether or not words were copied.
- **Copying with no dependent action is restatement and nothing else.** A
  recipient who moves packet text into a new document and takes no action that
  turns on it has produced no action §3.1.3 can measure and no §3.1.4 work
  product; the reuse only restated prior text. Recorded `inadmissible`, not
  `weak`. The runbook's §8.1 already records the packet-summary case this way.

**Reasoning.** Three reasons, strongest first.

1. **It is what H is for.** §1 defines H as an offline recipient acting from a
   packet so that "their resulting work matches packet contents." An offline
   recipient acting will typically act in a commit, a PR, or an external
   artifact — the shapes the runbook names — and the work will carry the
   packet's content by necessity. If carrying the content disqualified the
   case, H could be evidenced only by work that avoided the packet's words,
   which is the opposite of the correspondence §5 asks a reviewer to check.
2. **The bullet's text cannot reach non-Campfire outputs.** "New Campfire text"
   is explicit, and §5's "does not imply an in-product citation" confirms that
   H's work product sits outside the product. The disqualifier targets the
   closed loop where Campfire text is recycled into more Campfire text with no
   dependent action — text movement, not handoff use.
3. **The line that survives is already in the protocol.** §3.1.3 is the real
   dependency test, and `TEMPLATE.md`'s opening check says in its own words that
   it "is the condition that separates reuse from a restatement." A copy with
   no dependent action fails it; an enactment passes it. This amendment commits
   the protocol to that line rather than to a medium test or a wording test.

**What this changes for an operator.**

- Do not mark an H case inadmissible merely because the recipient's commit, PR,
  or external artifact uses the packet's wording, including verbatim wording.
  Apply the §3.2 restatement check as written: "new Campfire text." The
  runbook's §7.1 item 3 already asks the question in those terms.
- Apply the dependency check: name the packet field(s) the worked artifact
  could not be right without, and retain their bounded, sanitized excerpts in
  §10 of the observation (§9). If nothing substantive in the work product turns
  on the packet's records, the case is `inadmissible` — restatement, whatever
  the medium.
- The comparison stays manual (the runbook's §5). A verbatim carry is the
  cheapest correspondence to check, not the easiest to fake: the reviewer checks
  the field the work depends on against the excerpt and asks what would have
  changed if the field were different.
- Keep §3.1.4's authorship requirement: the commit, PR, or artifact must be the
  recipient's work product. A change the sender wrote is not the recipient's
  action.
- P and N are unchanged. The §3.2 bullet continues to disqualify Campfire-text
  reuse that produces only new Campfire text.

**Limits.** This amendment reads the existing lines; it does not lower §3.1.3 or
§3.1.4. A document that copies packet text and nothing else remains inadmissible.
It does not decide how much dependence is enough for a given work product, how
much paraphrase is allowed, or which external artifact is checkable; those stay
with §5's manual comparison. It does not alter §5.4's sender-prose mismatch or
the rule that the packet, not the handoff message, must carry the substance. It
adds no field, no rule, and no protocol version change.

### Amendment 5 — October 13, 2026 — owner participation in genuine claim-H handoffs

**Owner ruling.** The repository owner chose the narrow scope for claim H:
"Allow owner in genuine handoffs." The choice was made before any Gate E case
was opened. It resolves Amendment 3 for H, including cases where the owner is
the sender and cases where the owner is the recipient.

**Rule.** Owner participation alone does not disqualify a claim-H case when all
of the following are true:

1. The sender and recipient are genuinely separate participants in separate
   sessions, with **different human principals**. An agent may act on either
   side, but the owner's own agent is not an independent second participant.
   The recipient has ordinary work of their own after delivery.
2. The work is ordinary, pre-existing work **outside Campfire's own repository**.
   It was not created, seeded, or selected for the measurement.
3. The sender makes the packet voluntarily during that work; the recipient
   receives it through an ordinary handoff, without being supplied the desired
   answer. The recorder did not prompt or re-prompt either side into reuse.
4. The owner is identified as sender or recipient in the plan-time opening
   check. §14 discloses the owner's product knowledge, any knowledge of this
   measurement, and any resulting contamination. The case retains the evidence
   §6, §7, and §9 require, including the recipient-authored work product.

Every other §3.1, §3.2, and §7 condition still applies. This ruling makes such a
case **eligible to be assessed**, not automatically admissible or supporting.
The owner and the other participant are not treated as independent scorers, and
an owner-involved case is never described as evidence from people generally.

**Still excluded.** The owner's solo dogfooding on Campfire's own repository is
the §3.2 case and remains inadmissible. A handoff about developing Campfire's
own repository is outside this ruling, even if another participant is present.
A sender and recipient who are the same actor or share one human principal, a
scripted recipient, prompted packet use, or work created for measurement fail
the existing rules regardless of owner involvement. Such candidates and opened
cases are retained under §7.1 and §8 with their actual disposition; they are not
silently dropped.

**Scope.** This ruling covers claim H only and both owner roles. It does not
decide owner participation in claim P or N. An owner-involved P or N candidate
must not be opened under an assumed extension of this H ruling; the owner would
need a separate dated decision for those shapes. Claims P and H still do not
close Gate E, and this amendment records no observation.

**Operator effect.** `HANDOFF-RUNBOOK.md` precondition 11 and its post-handoff
checks now test the conditions above rather than treating either owner role as
an automatic failure. `TEMPLATE.md` records the owner's role and the basis for
calling the work ordinary and outside Campfire's repository. The dated ruling
is the policy; Amendment 3 remains visible as the history of how the ambiguity
was found. Protocol version `gate-e-1` remains: there were zero cases opened
under the earlier wording.

### Amendment 6 — October 13, 2026 — retained evidence for private H work

This amendment fixes the work-product side of §7.13 before any case is opened.
It does not turn a private reference or a recipient's statement into verified
authorship. The runbook §5.6 and the observation template carry the full
capture instructions.

- **Grade A:** The recipient's artifact is reachable by the reviewer through
  the reviewer's own access, named and verified at review time. Public access
  is sufficient; organization access is sufficient only when its reviewer
  role, system, and access path are recorded. Retain bounded excerpts on both
  sides of each substantive correspondence. A case may reach `supports` under
  the existing §1 and §5 tests.
- **Grade B:** The artifact is not reviewer-reachable, but the recipient
  consents to retain bounded, sanitized excerpts of the dependent work, with
  a reference and an explicit attestation of origin, authorship, and timing.
  A reviewer can check correspondence to those excerpts, while the link to
  the private artifact remains attested. The case may be admissible but its
  verdict cannot exceed `weak`; a per-field match applies to the excerpt only.
- **Grade C:** Neither a reviewer-reachable artifact nor dependent work-product
  excerpts can be retained. The case is inadmissible under §7.13, with no
  case-verdict label. A testimonial account may remain as a `reported` item.

The recipient may decline access, excerpts, or consent without pressure; the
ordinary handoff continues. A redaction that removes the decisive work content
is `unresolved`, never a match. Safety fields remain in scope even when the
work does not bear on them: record `not borne on` with a reason, and do not
invent a dependent excerpt. An inaccessible reference alone is not Grade A.
Grade B does not prove the private artifact existed as described, was unchanged
after excerpting, or was authored by the recipient. No grade establishes that
the packet caused the recipient's action. These limits belong in each case's
own "does not establish" section.

This is a pre-observation clarification of what §7.13 can support. It preserves
the claim-H shape and the `supports` / `weak` / `null` vocabulary. It does not
alter RCL pilot verdicts or close Gate E.

---

Gate E is the question, not the answer. This document makes the answer harder to
claim and easier to check. It records no evidence, and no document may cite it as
though it did.
