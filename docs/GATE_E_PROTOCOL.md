# Gate E — historical-reuse observation protocol

- **Status:** Protocol only. No observation has been recorded under it. Gate E is
  **unmeasured**.
- **Date:** October 12, 2026.
- **Package:** `1.15.0`. v1.16 stays held. This document changes nothing in the
  product.
- **Applies to:** `docs/GATE_E_PROTOCOL.md`, version `gate-e-1`.
- **Frozen history:** `docs/SPRINT_RCL_001_RESULT.md`, `docs/SPRINT_RCL_002_RESULT.md`,
  and `docs/SPRINT_RCL_003_RESULT.md` are NO-GO / REFRAME and stay frozen. Nothing
  in this protocol edits or rescores them.

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
The owner has not made a new release decision on that basis. This protocol is
written so the bet can be tested honestly and cannot manufacture a pass.

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
  recorded as an observation, but it is one participant working on the product's own
  repository in a session that knows about the measurement. It is labeled as such and
  it is not ordinary multi-participant work.
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
| **[plan-time, N only]** Counterfactual | the basis used (§4.2), the verbatim counterfactual text, and its timestamp |
| Reused sources | each source id with kind, and the surface it was reached through — orientation, catch-up, object read, `recall_workspace`, `decisionSet`, packet file — or `unknown` |
| Materialized record (P/N) | kind and id of the new record; the `decision_citations` or `finding_evidence` rows; the note text verbatim |
| Resulting work (H) | dated recipient-authored work product or action, its location or id, and the packet source ids and bounded content needed to verify correspondence |
| Next action taken | verbatim, as written in the record or in the plan |
| Investigation avoided | the named item, why it was deferred, and how that was settled |
| Outcome | what happened afterwards, dated |
| Attribution notes | contamination, dropped reads, replacements, withdrawals, standing session instructions in effect |
| Verdict | claim shape P / H / N, basis or bases used, and the label `supports` / `weak` / `null` |

A missing required **[plan-time]** field makes the observation inadmissible under
this protocol. A missing counterfactual basis makes a claim-N observation
inadmissible; it may be recorded as `reported` instead. P and H do not require
a counterfactual.

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
   seemed sharper" are not a material change. They may be recorded as `reported` and
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
13. **Retained evidence.** The source ids, the materialized record, and the plan-time
    entries must be readable by a reviewer with no access to the observer's memory. If
    they are not retained, the observation is downgraded to `reported`.
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
- **An unresolved reconstruction is a result.** If a Basis 2 reconstruction supports the
  same next action, that is the expected finding given three consecutive NO-GO pilots,
  and it is recorded as `none`.
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
- For H, retain a sanitized account of the packet fields used and a checkable
  reference to the recipient's resulting work. A packet alone, or a model answer
  without resulting work, is insufficient. Keep private packet bytes outside
  the repository.
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
  deployment. v1.16 stays held and the package stays `1.15.0`.
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

---

Gate E is the question, not the answer. This document makes the answer harder to
claim and easier to check. It records no evidence, and no document may cite it as
though it did.
