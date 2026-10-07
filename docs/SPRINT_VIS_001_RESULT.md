# Campfire — Sprint VIS-001 Result: Make Shared Understanding Visible

**Status:** Entry gate **NOT fully met**. Decision: **REFRAME — no product
implementation was started.** No release, no tag, no deployment.

**Date:** October 4, 2026. Corrected October 7, 2026 — see §11.

**Contract:** `docs/Campfire-v1.12-VIS-001-Make-Shared-Understanding-Visible.md`

**Preserved evidence:** `docs/evidence/vis-001/` (sanitized, tracked)

**Package version:** unchanged at `1.11.0`. **VIS-001 made no product-source
changes**: no file under `src/`, no migration, no canonical product document, and
no release artifact. Separate sprint-002 evidence-manifest work is present in the
working tree and is unrelated to this gate; see §9.

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

- **Artifact previews: excluded.** No observed artifact-open attempt.
- **Shared highlights: excluded.** No observation warrants shared salience.
  Per contract section 4.3 they are left out and the reason is recorded here.
- **Workspace overview, catch-up paging, currentness/history presentation:
  justified by condition 3 but not started**, because the gate is not closed.

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

**No release verdict. Nothing shipped.** No tag was created, no public snapshot
was exported, no GitHub Release was published, and no Worker was deployed to
production.

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