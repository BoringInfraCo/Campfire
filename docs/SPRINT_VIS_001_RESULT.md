# Campfire — Sprint VIS-001 Result: Make Shared Understanding Visible

**Status:** Entry gate **NOT fully met** — condition 4 remains open. Decision:
**REFRAME**, then **FOUNDER OVERRIDE** on October 7, 2026 authorizing the
condition-3 Viewer slice, then **RELEASE-SCOPE OVERRIDE** the same day
authorizing publication of that bounded slice. Verdict: **CONDITIONAL**. Usability
is **unverified**.

**Date:** October 4, 2026. Corrected October 7, 2026 — see §11. Slice implemented
and prepared for release under founder override — see §12 and §13.

**Contract:** `docs/Campfire-v1.12-VIS-001-Make-Shared-Understanding-Visible.md`

**Preserved evidence:** `docs/evidence/vis-001/` (sanitized, tracked)

**Package version:** `1.12.0` in the isolated release candidate. `v1.12.0` is
**authorized but not yet published** — the release is staged, not cut. See
§13.6 for the sequencing constraint that leaves install-channel pins at the
last published version until new archives exist. The October 4 gate work
made no product-source changes. The October 7 slice changes
`src/service/campfire-service.ts` and the Viewer static assets under an explicit
founder override; see §12. Separate sprint-002 evidence-manifest work is present
in the working tree and is unrelated to both; see §9.

---

## 0. Founder override, October 7, 2026

**The gate is still open. Condition 4 was never met.** This section exists so
that no reader mistakes the shipped slice for gate satisfaction.

The repository owner exercised a founder override and directed implementation to
proceed without closing condition 4, on the grounds that the product now has an
installed user base that will supply feedback faster than the observation could
be collected.

What that changes and what it does not:

| | |
| --- | --- |
| Condition 4 (artifact-open evidence) | **Still NOT MET.** No participant has attempted to open an artifact reference. |
| Condition 3 (observed comprehension failure) | **MET** — the only basis for the slice in §12. |
| Contract §8.1 "do not start product implementation while the gate is open" | **Waived by the owner**, not satisfied. |
| Gate B (voluntary repeat use) | **Still unmeasured.** |
| Gate C (ordinary multi-participant value) | **Still unmeasured.** |
| Release verdict | **Unchanged: none.** See §8. |

Scope was held to condition 3's actual findings — the presentation defects
observed on correct data. **Nothing gated on condition 4 was built**: no artifact
preview, no preview type, no external fetch, no change to `VIEWER_READ_METHODS`,
no §4.4 threat surface, and no shared highlight. Previews remain deferred
pending an observation that has still not occurred.

One factual conflict is recorded rather than resolved: `AGENTS.md` and
`docs/TELEMETRY.md` state that telemetry is unprovisioned and that no founder
metric has been produced, while the override cites an installed base of 550+
users. If that base is real, real artifact-use feedback likely already exists and
condition 4 could be closed cheaply. That is the owner's call; the discrepancy is
surfaced, not silently reconciled.

---

## 1. Gate decision

The contract's section 2 states that v1.12 is not sprint scope until all four
entry conditions are met, and section 8.1 forbids starting product
implementation while the gate is open. The gate was resolved with dated,
source-linked observations before any implementation decision.

| # | Condition | Verdict | Evidence |
| --- | --- | --- | --- |
| 1 | Live cold-agent evidence on a realistically large workspace beyond the single-machine gate | **MET** | `docs/evidence/vis-001/condition1-cold-agent-shared-instance.md` — two cold harnesses against a remote Worker + D1 shared instance |
| 2 | v1.11 correction and currentness semantics in the release source | **MET** (pre-existing) | `v1.11.0` published, CONDITIONAL GO, `docs/SPRINT_COR_001_RESULT.md` |
| 3 | At least one observed human difficulty understanding otherwise correct Campfire state | **MET** | `docs/evidence/vis-001/visit1-human-answers.md` — one real human, single machine |
| 4 | Evidence about which artifacts people actually try to open | **NOT MET** | No artifact-open attempt was recorded by any participant. See section 4. |

**Decision: REFRAME.** Three of four conditions are met, including the one this
sprint exists to answer. Condition 4 remains open, so the gate as written is
not closed and product implementation does not begin. This is a deliberate
refusal, not a deferral for capacity: the contract states that if artifact
observations do not support a preview type, previews are deferred rather than
chosen from the roadmap list, and no observation exists at all.

Gate B (voluntary repeat usage) and Gate C (ordinary multi-participant value)
remain **unmeasured**. This trace is not evidence for either: it is one
participant, on one machine, over a single day, operating as a fixture identity.
Per the contract's section 2, even a closed gate would have limited
implementation to the smallest observed Viewer improvement.

## 2. The exact comprehension failure (condition 3)

One real human participant opened the read-only Viewer
(`http://127.0.0.1:19415`, loopback, browser token-free, read-method allowlist,
backed through `campfire serve` with a fixture participant's token) against a
mature, corrected workspace with truncated orientation.

The server access log for the trace is retained and summarized at
`docs/evidence/vis-001/serve-access-log-summary.md`. Verified from that log:
**13,293 allowlisted read-method invocations** (3,321–3,324 repetitions of each
of the five polling methods, plus 3 `whoami`), **13,290 authorization decisions,
all allowed**, **zero denials**, and **zero write operations**. An earlier draft
of this document recorded "2,925 poll cycles"; that figure does not match the
retained log and is corrected here. The substantive claims it supported — five
allowlisted methods, zero writes, zero denials — are confirmed.

State presented, verified by service read and retained as
`docs/evidence/vis-001/state-presented-visit1-context.json`: findings 10 of 15
returned and truncated, decisions 10 of 14 returned and truncated, tasks 20 of
22, artifacts 10 of 14, one historical finding and one historical decision, one
accepted decision flagged `needsReview`, next task `task_235f9612e64c4b20`
"Reload the March export" in **`open`** status.

**The human trace and the later remote probe (§3) used different task states.**
During the human visit `task_235f9612e64c4b20` was `open`, and all 22 tasks were
`open` with none in progress — which is why finding 2 below is a live defect
rather than a hypothetical. The workspace was then advanced by three later
contributions (append positions 97–99), one of which moved that task to
`in_progress`, so the cold agents read it as in-progress. The two traces describe
the same workspace at different points, not the same snapshot.

**The service data was correct in every case below.** The failures were in
comprehension of correctly served state, confirmed by a UI-cause analysis of
`src/viewer/static/app.js` against the recorded payload:

1. **The participant named the wrong decision as current.** They reported the
   accepted-but-`needsReview` precaution decision `dec_80dad7d77e47449d` as the
   team's decision. The operative decision is `dec_f9bd16ad4d8f44e6` ("Skip the
   cache flush and rerun the export after the reload window").

   **Cause A — no salience rule exists, and the two panels contradict each
   other.** `workDecisionHtml` (`app.js:565-574`) renders `currentWork`'s
   accepted decisions in the order the service supplies them. That array is built
   at `src/service/campfire-service.ts:493` by filtering `decisions` with **no
   sort at all**, so it inherits whatever order the orientation page query
   returns — and `pageDecisionsSql` (`src/store/context-queries.ts:151`) orders by
   `status_rank ASC, updated_at DESC, id ASC`, where `status_rank` is a *status*
   bucket (`accepted` → 0, `src/store/context-queries.ts:12`), not a recency
   rank. Within the accepted bucket the page is therefore **newest-first**. So
   the current-work panel lists decisions by most recently *touched*, not by
   operative relevance, and the precaution decision surfaced first.

   The alignment panel reaches the opposite order. `deriveRecordedAlignment`
   (`src/service/service.ts:516-519`) explicitly sorts accepted decision ids with
   `compareByUpdatedThenId`, which is **ascending** by `updatedAt`
   (`src/service/service.ts:489-490`), i.e. **oldest-first**. That panel renders
   at `app.js:630-631`.

   So one order is *incidental* (inherited from a page query's recency
   tiebreak) and the other is *deliberate* (an explicit oldest-first sort), and
   they disagree. Nothing in the codebase defines which accepted decision is
   operative. **This cannot be fixed in the service alone:** the service holds
   two inconsistent orderings, and the Viewer renders both lists without a rule
   reconciling them. A fix must establish one salience notion in the
   projection *and* present it consistently in the Viewer.

   **Cause B — the `needsReview` marker is both low-contrast and clipped.**
   `workDecisionHtml` emits the marker as `<span class="oreason">`. That class
   (`app.css:474-482`) sets `color: var(--dim)`, which is `#595752` on `#171717`
   in the default and `campfire` themes — roughly **2.5:1** contrast — and
   `#3a3835` on `#0e0e0e` in the `fx` theme, roughly **1.7:1**. There is no
   colour, badge, border, or `aria-*` distinction in any theme. Worse, the same
   rule sets `overflow: hidden`, `text-overflow: ellipsis`, and
   `white-space: nowrap`, so the marker text `needs review find_<id>` — the very
   IDs that explain *why* a decision is suspect — is **truncated with an
   ellipsis** and can be cut off entirely.

   Raising contrast alone does not close this defect; the IDs must be fully
   visible.
2. **The next action was not identifiable.** The participant answered "im not
   sure". Cause: `renderCurrentWork` (`app.js:581-588`) renders only
   `inProgressTasks`, `blockedTasks`, and `acceptedDecisions`. The 20 `open`
   tasks the service returned are read only by id lookup and never enumerated,
   so the next action was structurally unreachable. Separately,
   `renderNextAction` (`app.js:615-618`) drops the hint's `kind` and `id`, so the
   service's `suggestedNextAction` pointed at a proposed decision without saying
   so.
3. **The basis was not surfaced.** The participant could not name the
   decision's reason or its cited evidence. Cause: reason and evidence appear
   only inside inspect expansion, unlabelled, and evidence is reduced to a
   count (`evidence 1`, `app.js:680-683`); artifact id, relation, and note are
   never rendered.
4. **The current finding was read as the correction reason.** The participant
   paraphrased the correction reason rather than the finding's own summary.
   Cause: `compactRecordLines` (`app.js:657-685`) pushes the reason as an
   unlabelled line directly beneath the summary, with identical styling, and the
   same reason text appears on both the superseded and the current row.

Additionally, the Viewer **discards every completeness field** it receives:
`slices.*.{total,returned,truncated}`, `budget`, `completeness`,
`provenanceTotal`/`provenanceTruncated` are read nowhere in `app.js`. A truncated
section is therefore indistinguishable from an empty one.

This is a comprehension defect on correct data. The same state, read through
authorized drill-down methods, was answered correctly and without ambiguity by
two cold agents on a shared instance (section 3). That isolates the defect to
how state is *presented*, not to the state model — the underlying records were
sufficient to answer every question. Note that the presentation layer is not
only `src/viewer/`: per cause A in finding 1, the absent salience rule originates
in the service projection and the store query, so a correct fix spans both the
projection and the Viewer.

### Data-modelling note (not a VIS-001 presentation fix)

After adding a second current finding without recording a supersession, two
findings were simultaneously `current` and nothing flagged that the operative
decision might now be questionable. That ambiguity is in the data, not the
Viewer. It is recorded here as a candidate COR-001 follow-up and was **not**
treated as a VIS-001 defect.

## 3. Condition 1 evidence (shared instance, beyond one machine)

A temporary shared instance was provisioned for the gate probe and is not a
production promotion:

- Worker `campfire-vis-001-probe`, D1 `campfire_vis001_probe`, served at
  `https://campfire-vis-001-probe.sunbeam-redraft-7j.workers.dev`
- the production `campfire` Worker, its `boringinfra.company/campfire/*` route,
  and the production D1 `campfire` were **not** touched
- the workspace was seeded from the COR-001 gate state plus the return-visit
  changes: 16 findings, 15 decisions, 22 tasks, 15 artifacts, 102 contributions
- both probe resources were deleted after the runs were recorded, so the shared
  instance no longer exists and **these runs cannot be reproduced**. The
  sanitized transcripts, prompts, and verbatim answers are preserved under
  `docs/evidence/vis-001/`; see that directory's `README.md`.

Two cold harnesses ran with isolated configs containing only the Campfire MCP
server and a real agent bearer token, with no prepared summary:

| Harness | Outcome |
| --- | --- |
| Codex 0.150.1 | Named the operative decision, the needs-review decision and its cited superseded finding, the in-progress next task, and the newest artifact. Reported truncation for all four sections. Its authorization probe hit an inferred nonexistent id, so it did not exercise the real denial. |
| OpenCode 1.18.34 | Independently named the same operative decision and needs-review decision, and probed the real unauthorized workspace twice. |

Both agents agreed on currentness and provenance. Neither ever received the
originating private transcript or a prepared handoff.

Security results on the shared instance: no token returned HTTP 401; agent token
resolved identity through `whoami`; `list_workspaces` returned Harbor only;
`get_workspace_context` and `get_finding` against the unauthorized workspace both
returned `ParticipantRequired` (HTTP 403) with no content. The sentinel string
`VAULT_SENTINEL_do_not_leak` exists in the shared store and appears in neither
agent transcript nor stderr. Authorization preceded retrieval in every case.

**These results are operator-attested, not independently re-verifiable.** The
probe Worker and D1 database are deleted, so the runs cannot be repeated. The
transcripts under `docs/evidence/vis-001/` are the operator's own record of runs
the operator performed; the denial and sentinel claims rest on those transcripts
alone. They are labelled as such rather than presented as third-party verified.

Local Viewer security was unchanged during the human trace: loopback bind, five
allowlisted read methods, browser token-free, and zero writes across 13,293 read
invocations (`docs/evidence/vis-001/serve-access-log-summary.md`).

## 4. Condition 4: artifact inspection (open, previews deferred)

No qualifying artifact-use observation exists.

- The human participant reported opening "every action", which the Viewer renders
  as activity rows, and named no artifact.
- The cold agents each *selected* an artifact to verify and reported its
  reference, but no participant *attempted to open* one.
- The Viewer offers no artifact affordance to attempt: artifact rows render the
  reference as plain text on expansion (`app.js:397-400` emits only `uriOrPath`),
  there is no link or handler, and `get_artifact` is not in the read allowlist
  (`src/viewer/server.ts:31-37`). All workspace artifacts are relative paths to
  files that do not exist in the store.

Per contract sections 2 and 4.4, **previews are deferred**. No preview type was
chosen, because choosing one from the roadmap list without an observed attempt is
exactly what the contract prohibits. The contract's preview test matrix
(oversized content, timeout, unsafe scheme, private-network target, hostile
markup, missing external permission, failure fallback) was therefore **not**
written, because writing speculative tests is also prohibited.

To close condition 4, one observation is needed: a participant attempts to open a
**real, accessible** artifact reference relevant to their task, and the trace
records the attempted type and reference, why they opened it, whether access
succeeded, and which preview content would have helped.

**This is harder to collect than it looks, and that is a finding.** Every
artifact in the gate workspace is a relative path to a file that does not exist,
and the Viewer provides no way to attempt opening one. As shipped, the Viewer
cannot produce this observation at all. Two routes close it:

1. **Observe outside the Viewer**, during ordinary work, against a *real*
   accessible artifact — a log or export that genuinely exists and is reachable.
   This is the preferred route: it needs no code change and it observes the
   underlying need rather than the Viewer's affordance.
2. **Add a Viewer reference affordance** purely as an observation instrument.
   If chosen, it must be recorded as a small scoped change with its own checks
   while the gate is open. Scope boundary: render the existing `uriOrPath`
   reference and an explicit access-limitation message. It must **not** fetch the
   target, add a preview type, change `VIEWER_READ_METHODS`, or introduce any
   section 4.4 threat surface. It is an instrument for the study, not a VIS-001
   feature, and shipping it does not close the gate on its own.

Note that making both decision panels newest-first would **not** satisfy
condition 3 on its own — see section 5.

## 5. Scope decisions recorded at the gate

- **Artifact previews: excluded.** No observed artifact-open attempt. Still
  excluded after the October 7 slice; the override did not extend to anything
  gated on condition 4.
- **Shared highlights: excluded.** No observation warrants shared salience.
  Per contract section 4.3 they are left out and the reason is recorded here.
- **Workspace overview, catch-up paging, currentness/history presentation:
  justified by condition 3**, implemented October 7, 2026 under the founder
  override in §0. See §12. The gate itself is still open on condition 4.

  If the gate closes, the smallest observed improvement is bounded by condition
  3's actual finding — five items, in priority order:

  1. **Establish one salience notion for accepted decisions and present it
     consistently in both panels.** Currently the current-work panel inherits
     newest-first page order and the alignment panel applies an explicit
     oldest-first sort, and neither encodes which decision is operative. This
     spans the service projection and the Viewer. **Making both panels
     newest-first would not be a fix**: it would leave the participant's original
     confusion intact, because the confusion was caused by a *recently touched*
     decision outranking the *operative* one. The presentation must distinguish
     decisions needing review from the operative current position.
  2. **Make `needsReview` and its cited finding IDs fully visible.** The `.oreason`
     rule clips `needs review find_<id>` with an ellipsis and renders it at ~2.5:1
     (~1.7:1 in the `fx` theme) with no non-color channel. Contrast, clipping, and
     a non-color distinction all need addressing; contrast alone is insufficient.
  3. **Make the next action reachable.** Enumerate open work, not only in-progress
     and blocked, and surface the `suggestedNextAction` hint's `kind` and `id`.
  4. **Label reason and evidence with their cited references**, instead of an
     unlabelled line under the summary and a bare `evidence 1` count.
  5. **Render the completeness fields the service already returns**
     (`total`/`returned`/`truncated`, `budget`, `completeness`,
     `provenanceTotal`/`provenanceTruncated`), so a truncated section cannot look
     empty.

## 6. Deviations from the contract's own plan

- The human return visit was not completed by a participant. An agent-side
  return read was recorded instead
  (`docs/evidence/vis-001/visit2-agent-read.md`) and is labelled as agent
  evidence. It corroborates the presentation defect; it does not substitute for
  the required real human return visit.
- The human trace and the remote probe read the workspace at **different points
  in its history**, so their task statuses differ. See section 2.
- Section 3's security results are **operator-attested**; the probe instance is
  deleted and cannot be re-run to confirm them independently.
- An earlier draft recorded "2,925 poll cycles" for the Viewer access log. The
  retained log shows 13,293 read invocations; the figure is corrected in
  section 2 and the derived summary is preserved.
- A fixture identity (`hum_grace`) carried the participant session. Labelled
  accordingly. The fixture workspace's participants are fixtures.
- One accepted decision citing a superseded finding was added during state
  preparation so that a `needsReview` marker existed to be observed. It was
  created by a fixture human through the ordinary service write path, and
  `needsReview` remained computed at read time.

## 7. Not established

- Gate B and Gate C remain unmeasured. No voluntary later-day return occurred
  and no second human participated.
- Condition 4 remains open, so artifact preview usefulness is unclaimed. As
  shipped, the Viewer cannot produce this observation at all; see section 4.
- The shared instance is a probe. It is not a deployment, not a hosted team
  environment, and does not establish hosted Stage C.
- Section 3's authorization and sentinel results are operator-attested only.
- No production deployment occurred. `v1.12` remains directional in the roadmap
  and its gate remains open on condition 4.

## 8. Release verdict

**Superseded by §13.** As originally recorded on October 4, 2026: no tag, no
public snapshot, no GitHub Release, no deployment. The October 7 release-scope
override authorized publishing the bounded condition-3 slice as `v1.12.0` with a
CONDITIONAL verdict; see §13 for the release record and the exact set of claims
that remain unverified.

The temporary probe resources were torn down after the evidence was recorded:
Worker `campfire-vis-001-probe` and D1 `campfire_vis001_probe` were both deleted,
the temporary Wrangler config was removed, and the single `.gitignore` line added
to protect that config's D1 id was reverted. Re-verified October 7, 2026: the
only D1 database remaining in the account is the production `campfire`, no probe
D1 id appears in any tracked file, and the local trace servers are stopped
(ports 19414 and 19415 closed).

### Credential disposition

`.campfire/traces/harbor/grace.token` held a plaintext `cft_` bearer token for
fixture human `hum_grace`. Resolved October 7, 2026:

- The token hashes to `tok_e0adc974511c464d` (`hum_grace`, human) in the local
  trace database `harbor-trace.db`; that row's `revoked_at` was null.
- Production D1 `campfire` was queried directly for that token hash: **0 matching
  rows, and 0 total rows in `actor_tokens`.** The production database holds no
  actor tokens, so this token never authorized anything in production. No
  revocation against production was necessary or possible.
- The probe D1 database had already been deleted.
- The plaintext file existed in exactly one location repo-wide and has been
  **deleted**; the local token row is now revoked.

## 9. Working-tree scope

VIS-001 made no product-source changes. The working tree also contains
**unrelated sprint-002 evidence-manifest work** (`scripts/evidence-manifest.mjs`,
changes to `src/acceptance/real/evidence.ts`, `package.json`, `.gitignore`,
`README.md`, `scripts/run-acceptance-002.ts`, `tests/unit/real-checks.test.ts`,
and an addendum to `docs/SPRINT_002_RESULT.md`). That work concerns preserving
sprint-002 acceptance evidence and is deliberately kept separate from this gate
record. It is not part of VIS-001 and does not bear on any gate condition.

## 10. Next step

Not implementation. Condition 4 must be decided on evidence: one participant
attempts to open a **real, accessible** artifact reference during ordinary work,
and the trace records the attempted type and reference, why they opened it,
whether access succeeded, and what content would have helped. Per section 4,
this can be observed outside the Viewer; if a Viewer reference affordance is added
to enable the observation, it is recorded as a small scoped change with its own
checks while the gate is open.

Preserved evidence for this gate is under `docs/evidence/vis-001/`.

## 11. Corrections, October 7, 2026

A review of this document found four inaccuracies and two evidence-retention
gaps. All are corrected above; the gate decision is unchanged.

1. **Access-log cycle count.** "2,925 poll cycles" did not match the retained
   log, which contains 13,293 read-method invocations. Corrected in §2, with the
   derived tally preserved at `docs/evidence/vis-001/serve-access-log-summary.md`.
2. **Accepted-decision ordering, cause A.** An earlier draft attributed the
   ordering confusion to the Viewer rendering "in pure recency order" and stated
   that the two panels did not contradict each other. Both halves were wrong.
   The two panels genuinely contradict each other: the current-work panel
   inherits newest-first order from `pageDecisionsSql`, while
   `deriveRecordedAlignment` applies an explicit oldest-first sort. Full
   mechanism and citations in §2, finding 1.
3. **Clipped review markers, cause B.** The `.oreason` rule truncates
   `needs review find_<id>` with an ellipsis and renders it at ~2.5:1 (~1.7:1 in
   the `fx` theme) with no non-color channel. The original draft cited low
   contrast only and omitted the clipping and the `fx` theme.
4. **Differing task states.** The human trace and the remote probe read the
   workspace at different points; `task_235f9612e64c4b20` was `open` during the
   human visit and `in_progress` during the probe. Now stated in §2.
5. **Evidence preservation.** The raw traces were gitignored and unbacked while
   the probe instance was deleted. Sanitized evidence is now tracked under
   `docs/evidence/vis-001/`; §3 is labelled operator-attested rather than
   independently verified.
6. **Working-tree scope.** "Changed no source file under `src/`" was not accurate
   as a statement about the tree, because unrelated sprint-002 evidence work is
   present. Narrowed to "VIS-001 made no product-source changes" and disclosed
   in §9. The `grace.token` credential was resolved and revoked; see §8.
## 12. Condition-3 Viewer slice, October 7, 2026

Implemented under the founder override in §0. Scope is exactly condition 3's five
recorded findings. Nothing here depends on condition 4.

### 12.1 What changed

**Service** — `src/service/campfire-service.ts`. `currentWork.acceptedDecisions`
is now sorted explicitly with `compareByUpdatedThenId` instead of inheriting the
orientation page's recency tiebreak. This is the half of the ordering fix the
Viewer cannot make on its own: the current-work panel and the alignment panel now
agree, because both derive from one comparator. Order remains presentation only
and never decides which decision is operative.

**Viewer** — `src/viewer/static/app.js`, `src/viewer/static/app.css`:

| Finding | Change |
| --- | --- |
| 1 — conflicting order, no salience notion | Accepted decisions are partitioned into settled and needing-review groups in **both** the current-work and alignment panels. |
| 1 — marker unreadable | `needsReview` is a bordered `.oreview` badge with `aria-label`, not dim text. |
| 2 — clipped IDs | `.oreason` now wraps (`overflow-wrap: anywhere`, no `nowrap`/`ellipsis`) and uses `--muted` instead of `--dim`. Cited finding IDs render in full. |
| 2 — next action unreachable | `open` tasks are enumerated in the current-work panel, newest first, de-duplicated against in-progress and blocked. |
| 2 — hint kind dropped | `renderNextAction` shows the hint's `kind` and `id`, so a proposed-decision hint cannot read as a work step. |
| 3 — basis not surfaced | Reason renders as `reason: …` rather than as an unlabelled line, and evidence/citations name their referenced IDs instead of counting rows. |
| Completeness discarded | `slices.*.{total,returned,truncated}` now render per bounded slice in an `orientation completeness` block: `showing N of M · more available`. A truncated section can no longer look empty. |

Two review findings were fixed on October 7, 2026, both from the same commit review:

- **"cites withdrawn finding" was wrong for the fixture.** The stale-citation
  rule is `findings.currentness <> 'current'`
  (`src/store/correction-records.ts:258-266`), which covers both `superseded`
  and `withdrawn` findings. The VIS-001 fixture cites a **superseded** finding,
  so the Viewer asserted a state that was not true. Now reads
  "cites non-current finding", which is true for either case.
- **The completeness note disappeared when its group had no rows.** Counts were
  attached to a group heading, so a flagged-only decision list lost its decision
  count and a truncated section could still read as empty — the exact defect the
  slice set out to close. Counts now render in their own `orientation
  completeness` block, independent of whether any group has rows, and the
  zero-rows case shows both "No current work" and the completeness figures.

The pre-existing build failure is also fixed: `scripts/sync-install-channels.mjs`
had no type declaration, so `tests/unit/install-channels.test.ts` failed
typecheck with TS7016 and `npm run build` could not complete. Added
`scripts/sync-install-channels.d.mts`. `npm run typecheck`, `npm run build`,
`npm test` and `npm run pack:tarball` succeeded in the prior working tree.
That test run included an unrelated, untracked sprint-002 test file; the
isolated release-source results are stated in §13.5.

Deliberately **not** done, and why:

- **Both panels newest-first.** Explicitly rejected: it leaves the original
  confusion intact, because the confusion came from a recently *touched* decision
  outranking the *operative* one. Grouping distinguishes them; sorting alone does
  not.
- **Deciding which decision is "operative."** No such rule exists in the data, and
  inventing one in the Viewer would violate the contract's rule against
  Viewer-only decision logic. The two-current-findings ambiguity from the
  data-modelling note above remains a COR-001 follow-up, untouched.
- **Anything in §4.4.** No preview, no fetch, no allowlist change.

### 12.2 Verification

`npm test` — **883 passed, 73 files, 0 failures in the prior working tree**, which
included an unrelated, untracked sprint-002 test file. See §13.5 for the
isolated release candidate. `node --check` on the Viewer bundle.
`public/` re-synced from `src/viewer/static/`.

New `tests/integration/viewer-vis-001.test.ts` — 16 checks, one per observed
failure, including that the review marker survives without color (badge border
plus `aria-label`), that `.oreason` carries no clipping rule, that a flagged
decision cannot appear in the settled group, that the distinction holds in the
alignment panel too, and that the surface still renders no write control and
escapes injected markup. Two added after review cover the flagged-only decision
list and the zero-rows case, where completeness must still be stated.

One existing assertion in `tests/integration/viewer-cor-001.test.ts` was updated:
it pinned the old unlabelled `reason` and the bare `evidence 1` count, both of
which this slice deliberately changes. Updated to assert the labelled form.

`tests/unit/service.test.ts` gains a check that `currentWork.acceptedDecisions`
and `alignment.acceptedDecisionIds` return the same order, which is the
regression this slice exists to prevent.

### 12.3 Known limits

- **Build fixed.** `npm run build` failed before this slice on TS7016 in
  `tests/unit/install-channels.test.ts`, because `scripts/sync-install-channels.mjs`
  had no type declaration. Resolved with `scripts/sync-install-channels.d.mts`.
  `typecheck`, `build`, and `pack:tarball` now all succeed.
- **No human trace.** Per the override, the product trace in contract §6 was not
  run. The slice is verified deterministically, not against a participant, so it
  is **not** evidence that a human now understands the state better.
- **Not a release.** No version bump, no tag, no snapshot, no deployment. The
  package remains `1.11.0`. *(Superseded by §13: the release-scope override of
  October 7, 2026 authorized publishing this slice as `v1.12.0` with a
  CONDITIONAL verdict.)*

## 13. Release-scope override and conditional verdict, October 7, 2026

A second founder decision, distinct from the implementation override in §0. The
first authorized *writing* the slice. This one authorizes *shipping* it.

### 13.1 What is authorized

Publish the bounded condition-3 slice to existing users as `v1.12.0`, with a
CONDITIONAL verdict and usability recorded as unverified.

**Verdict: CONDITIONAL.** Not GO. Not NO-GO.

### 13.2 What is explicitly not claimed

This is the load-bearing part of the record. Shipping does not close anything the
gate left open.

| Claim | Status |
| --- | --- |
| A human can now identify the current work and decision from the Viewer | **UNVERIFIED.** No human trace has been run against the shipped surface. |
| The slice resolves the observed comprehension failure | **UNVERIFIED in practice.** The underlying defects are fixed and deterministically tested; whether a person reads the screen correctly is untested. |
| Condition 4 (artifact-open evidence) | **NOT MET.** Unchanged by this release. |
| Artifact previews | **Deferred.** Not built. |
| Shared highlights | **Deferred.** Not built. |
| Gate B (voluntary repeat use) | **Unmeasured.** |
| Gate C (ordinary multi-participant value) | **Unmeasured.** The 550+ installed-base figure is **not** treated as evidence for either gate, and is not inferred from Campfire's unprovisioned telemetry. |
| Which accepted decision is "operative" | **Still undetermined.** No such rule exists in the data; see §12.1. |

### 13.3 Relationship to the contract's own rubric

Worth stating plainly, because the contract and this verdict do not line up.

The contract's NO-GO clause lists "the entry gate is not met" as a NO-GO trigger,
and the gate is not met. The contract's CONDITIONAL GO clause contemplates the
entry evidence *passing* with the human trace unavailable — which is not this
situation, because the entry evidence has not fully passed.

So the contract, read literally, yields **NO-GO** for this release. The owner has
overridden that on release scope and issued a CONDITIONAL verdict instead. This
is recorded as an override rather than as contract compliance, and the
discrepancy is left visible rather than resolved by rewriting the rubric.

### 13.4 Shipping scope

Everything in §12.1, plus the build fix. Concretely:

- `src/service/campfire-service.ts` — `currentWork.acceptedDecisions` sorted
  explicitly.
- `src/viewer/static/app.{js,css}` and the synced `public/` copies — decision
  grouping, review badge, wrapping review markers, enumerated open tasks, hint
  kind/id, labelled reason, cited references, unconditional completeness block.
- `scripts/sync-install-channels.d.mts` — build fix, no runtime effect.

**No database migration. No schema change. No new read method. No new
authorization rule.** The Viewer remains read-only and its
`VIEWER_READ_METHODS` allowlist is unchanged.

The release source also reverses the two post-v1.11 telemetry expansion commits
(`fbff49e` and `37cac65`). Those changes were present on the development
mainline but were outside this founder-approved Viewer release scope. The
existing v1.9.3 telemetry contract remains; the reversed expansions can be
reviewed and reapplied in a separate release.

One behavior change is visible to non-browser consumers: `currentWork.acceptedDecisions`
now returns in `updatedAt` order rather than the orientation page's incidental
order. Any agent that inferred salience from array position would see different
results. No consumer could have relied on the old order meaningfully — it was a
page-query tiebreak — but this is a real contract-visible change and is called
out here rather than left to be discovered.

### 13.5 Verification at release time

On the isolated `1.12.0` release candidate, `npm run typecheck`, `npm run build`,
`npm run pack:tarball`, and `npm run deploy:dry-run` succeed. The 71 test files
outside `install-channels.test.ts` pass (**844 tests**). The install-channel
file has three passing checks and one expected version-pin failure; the
remaining test cannot pass until the four new release checksums exist. The
earlier 883-test count included an untracked sprint-002 test and later telemetry
commits absent from this scoped release. It is not a reproducible release-source
count. `node --check` passes on the Viewer bundle.
Security posture unchanged from `v1.11.0`: no write path added, no
credential handling touched, no external fetch introduced.

### 13.6 Release sequencing constraint, found during preparation

**The version bump cannot be committed on its own.** `packaging/homebrew/campfire.rb`
and `flake.nix` are pinned to the released version's checksums, and
`tests/unit/install-channels.test.ts` asserts the pin matches `package.json`.
Bumping to `1.12.0` with the pin still at `1.11.0` fails that test.

`scripts/sync-install-channels.mjs` resolves real digests by fetching
`<release>/v1.12.0/<archive>.sha256` from GitHub, so **the pin can only be
updated after the release archives are published.** `docs/OPERATOR.md` documents
this order: publish first, then pin, then commit the pin.

Consequence: between the version bump and the pin commit, `npm test` is expected
to fail on `install-channels.test.ts`. That is the designed sequence, not a
regression, and it must not be "fixed" by loosening the assertion. The correct
order is:

1. Commit the version bump and the slice.
2. Tag `v1.12.0`, export the public snapshot, publish the GitHub Release so the
   release workflow builds and attaches the four archives.
3. Run `node scripts/sync-install-channels.mjs --version 1.12.0`, commit the pin.
4. Record the promotion in this section.

The version was reverted in the main working tree after this was discovered.
An isolated release candidate now carries the `1.12.0` version bump and
versioned installer; no tag or public release has been created.

### 13.7 Trace collection is decoupled

The human participant trace is no longer a release blocker; it is an outstanding
evidence obligation that can be collected from ordinary use by any participant,
not necessarily the repository owner. Until it is collected, every usability
claim in §13.2 stays unverified, and this verdict stays CONDITIONAL.

A trace is still worth having. If it fails — if a participant still cannot tell
which decision is operative — the honest response is to fix the surface, not to
quieten the verdict.
