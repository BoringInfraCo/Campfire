# Campfire v1.12 — Make Shared Understanding Visible

**Sprint ID:** VIS-001  
**Target release:** v1.12.0  
**Status:** Contract retained as written. The evidence gate remains open (condition 4 NOT met). On October 7, 2026 the owner issued a founder implementation override (§0 of the result) and a release-scope override authorizing publication of the bounded condition-3 slice with a CONDITIONAL verdict and usability unverified (§13 of the result). Read literally, this contract's own rubric yields NO-GO, because its NO-GO clause treats an unmet entry gate as disqualifying; that discrepancy is recorded rather than resolved by rewriting the rubric below. Artifact previews and shared highlights remain deferred.  
**Depends on:** CTX-001 / v1.10.0 and COR-001 / v1.11.0  
**Theme:** Visual orientation, catch-up, and source inspection in the existing read-only Viewer

---

## 1. Sprint question

> Can a teammate open a mature workspace, see what the team currently believes, understand what changed since their last visit, and inspect the source behind a claim without mistaking old state for current state?

v1.10 bounded orientation, catch-up, and drill-down. v1.11 made corrections and decision replacement explicit. The Viewer already has a team journal, compact orientation, activity, and correction labels. This sprint should improve a demonstrated comprehension problem in that existing surface, not create another source of truth.

The desired outcome is a participant who can answer, from an authorized workspace alone: What is the goal? What is current? What needs review? What changed? Why? Which artifact can I inspect? What is the next useful action? The participant must be able to tell when an answer is incomplete because a collection or change page is truncated.

## 2. Entry gate and evidence boundary

The roadmap says v1.12 is not sprint scope until all four conditions below are met. Record the evidence and gate decision in a VIS-001 result before implementation begins.

| Roadmap condition | Current record | Evidence needed |
| --- | --- | --- |
| v1.10 cold-agent evidence on a realistically large workspace beyond its single-machine gate | CTX-001 passed one cold Codex trace on one machine. | A live cold-agent run on a realistic shared workspace, with size, authorization boundary, operations, and outcome recorded. A larger synthetic fixture on the same machine does not satisfy this condition. |
| v1.11 correction and currentness semantics in the release source | Met: `v1.11.0` is published with a CONDITIONAL GO result. Production is not deployed. | Retain the release and result references; do not upgrade the verdict from publication alone. |
| At least one observed human difficulty understanding otherwise correct Campfire state | No qualifying observation is recorded in the roadmap or COR-001 result. | Record the participant, task, state presented, what they tried, where they became confused, and the correct state. Distinguish a comprehension problem from missing or incorrect data. |
| Evidence about which artifacts people actually try to open | No qualifying artifact-use observation is recorded in the roadmap or COR-001 result. | Record attempted artifact types/references, why the participant opened them, whether access succeeded, and which safe preview would have helped. Do not use fixture frequency as user demand. |

Gate B voluntary repeat use and Gate C ordinary multi-participant value remain unmeasured. They are not inferred from a visual usability trace. The roadmap also treats Gate B as a prerequisite for heavy collaboration UX investment. Therefore, if the four entry conditions are met but Gate B remains unmeasured, keep implementation to the smallest observed Viewer improvement and explicitly record that decision. Do not claim broad visual investment is validated.

If the entry evidence points to a data or correction defect rather than a presentation defect, repair or reframe that problem before starting VIS-001. If artifact observations do not support a preview type, defer previews rather than choosing one from the roadmap list.

## 3. Smallest product journey

1. A participant opens the existing Viewer under their own authorized Campfire identity. They see one workspace's goal, people, current work, current findings, accepted decisions, review markers, and explicit completeness indicators.
2. They return after a saved cursor. The Viewer pages through changes to a frozen tip, distinguishes new current state from historical transitions, and identifies corrections, withdrawals, replacements, and decisions needing review. A gap or failed page is visible; the cursor does not advance past unread changes.
3. They select a current assertion or accepted choice and inspect its predecessor, reason, evidence or cited basis, actor, and timestamp. Historical records stay available and clearly labeled. The interface never promotes a recent but superseded assertion into current truth.
4. They open one artifact reference relevant to the observed task. The Viewer either presents a safe, bounded preview of an evidenced type or shows the reference and a clear access limitation. It does not imply that workspace access grants access to an external artifact.
5. Another authorized participant can explain the current position and one next action without the originating private transcript or a prepared handoff.

## 4. Product and interface contract

### 4.1 Workspace overview

Use the existing read-only Viewer and the same authorized workspace boundary. Present the goal and participants with a compact current-state overview: active or blocked work, current findings, accepted decisions, proposed decisions where relevant, and `needsReview` markers. Show totals, returned counts, and truncation for bounded sections. A section with zero rows and a section with undisplayed rows must look different. Link each summary to a specific authorized list page or object detail; do not rely on an unbounded `get_workspace` response to fill the overview.

The overview is a projection of the service's currentness and lifecycle rules. It does not compute truth from recency, confidence, highlight status, or a model summary. Keep the workstream journal available; do not turn the Viewer into a second task board or object store.

### 4.2 Catch-up and activity

Use the v1.10 append-position cursor and frozen-tip contract for returning readers. The Viewer may persist a per-workspace last-seen cursor locally, but it must page to completion before advancing it. Show incomplete, loading, and error states, and allow a retry from the last committed cursor. A correction event can point to the old and new records; compact event text is a label, not a substitute for their full summaries and reasons. Keep the existing activity timeline and refine its hierarchy around material work changes without hiding historical transitions.

### 4.3 Currentness, history, and salience

Current and historical findings and decisions use distinct, accessible labels. Detail exposes predecessor/successor links, transition reason, provenance, and evidence or basis citations. `needsReview` remains computed by the application read path; the Viewer presents it without silently retiring a decision.

If the observed human difficulty warrants shared highlights, add one narrow workspace-scoped highlight operation for an existing object. A highlight records target ID/type, a short reason, creator/session, and creation/removal history. Its creation and removal go through the service authorization and Contribution path, with SQLite/D1 parity and an atomic write. A highlighted historical object remains historical and is visibly marked as such. Do not use browser local storage as the canonical shared highlight store. If no observation warrants shared salience, leave highlights out and record why in the result.

### 4.4 Artifact inspection

Choose preview types only from observed artifact-open attempts. Artifact remains a registry record with identity, type, title, reference, metadata, and provenance; fetched content and presentation do not become Artifact fields. Prefer a plain reference with an explicit access message when a safe preview cannot be provided.

Any preview must be read-only, bounded in bytes and time, and selected by an explicit allowlist of type and source. Authorize the Artifact record before returning its reference. Treat the external target as separately authorized: do not forward a Campfire token, follow an arbitrary URL or local path from agent-authored metadata, fetch private network addresses, or render active HTML/scripts in the Viewer origin. Render text as text; isolate any richer content with a sandbox and content security policy. A preview failure must not suppress the Artifact's title, reference, or provenance. Never treat a URI as proof of truth or permission.

The browser remains token-free. The Viewer server's read-method allowlist stays explicit, loopback remains the default bind, and remote exposure remains an explicit operator choice. A highlight, if implemented, uses an authenticated CLI/MCP/HTTP service operation; the Viewer itself stays read-only in this sprint.

## 5. Architecture and compatibility

- Workspace is the only collection and authorization boundary. Filter before retrieval; never fetch another workspace's rows and hide them in browser code.
- Keep human and agent identities distinct, and preserve actor, principal, harness, and session attribution where available. A shared highlight write by an agent requires a registered session.
- Keep orientation, catch-up, drill-down, and full inspection as separate contracts. Bound queries at the store, preserve stable paging, and make completeness visible at the interface.
- Reuse the service's currentness, citation, and `needsReview` semantics. The Viewer is a derived projection; no Viewer-only correction or decision rule.
- If highlights require persistence, add narrow migrations in SQLite and D1 with compatible service methods and a rollback test. Do not introduce a general salience framework or a second store.
- Existing CLI, MCP, HTTP, Worker, local profiles, enrollment, and closed webhook vocabulary remain compatible. Do not turn a visual event into a new outbound webhook implicitly.

## 6. Acceptance scenarios

### Deterministic and security checks

- A workspace larger than orientation budgets shows accurate current-state totals, returned counts, truncation, and working drill-down pages. Historical findings and decisions remain inspectable by ID and visibly historical.
- A correction and replacement appear in the journal and catch-up stream without making the old finding or decision look current. A decision citing a withdrawn finding remains accepted with `needsReview` until an authorized decision transition.
- Catch-up across several pages reaches a frozen tip without skips or duplicates. A failed middle page leaves the last-seen cursor before that page; retry recovers it. A new change after the frozen tip appears in the next run.
- An unauthorized workspace or artifact ID reveals no title, evidence note, preview bytes, relationship count, or highlight existence. An absent agent session cannot create a highlight.
- Preview tests cover the observed allowed type plus oversized content, timeout, unsafe scheme/path, private-network target, hostile markup, missing external permission, and failure fallback. If preview scope is deferred at the entry gate, document that deferral instead of writing speculative tests.
- If highlights are in scope: duplicate/removal behavior, historical target labels, cross-workspace targets, provenance, transaction rollback, migration, and SQLite/D1 parity pass.
- Existing Viewer keyboard use, polling, loopback binding, token isolation, and read-only method allowlist remain valid.

### Human and agent product trace

Use a workspace with enough current and historical state to truncate multiple sections. Capture one real human's first visit and return visit while they pursue an ordinary work objective. Ask them to identify the current finding and decision, what changed, the basis for the change, a relevant artifact, and one next action. Observe where they navigate, what they attempt to open, and whether the visual surface resolves the earlier comprehension difficulty. A cold authorized agent independently answers the same work question from Campfire, without a prepared summary; verify the human and agent agree on currentness and provenance. Check an unrelated workspace denial.

Record participant count, machines, harnesses, workspace size, cursor/page behavior, attempted artifact types, preview outcome, time to a correct answer, mistakes and recovery, and whether anyone returned voluntarily on a later day. Label fixture identities and single-operator traces accurately. Do not call an acceptance rehearsal Gate B or Gate C evidence.

## 7. Non-goals

- Writable Viewer, composer, chat, Kanban, presence, or a second workspace collection.
- Generated workspace pages, model-written summaries as truth, embeddings, semantic search, cross-workspace memory, or transcript ingestion.
- General artifact hosting, arbitrary remote fetch, a renderer/plugin registry, credential delegation, or active HTML execution.
- Automatic fact checking, confidence scoring, decision invalidation, or highlights that override currentness.
- Playbooks and workflow execution; the one incident-investigation playbook remains in the later v1.13 direction.
- New public webhook event types, per-command telemetry, or expanded external integrations.

## 8. Execution and result

1. Resolve the entry gate with dated, source-linked observations. Record a GO-to-scope or REFRAME decision, the exact comprehension failure, and observed artifact types. Do not start product implementation while the gate is open.
2. Freeze the minimal Viewer journey and preview/highlight subset supported by those observations. Review the threat boundary before adding any external fetch or rendered content.
3. Implement the smallest vertical slice, keeping read and write paths in their existing layers. Add focused tests for correctness, authorization, paging, preview isolation, and any new persistence.
4. Run focused suites, `npm run typecheck`, `npm test`, `npm run build`, and `npm run pack:tarball`. Check a clean and upgraded SQLite store and D1 path if schema changes.
5. Run the human and agent product trace. Inspect the full diff and write `docs/SPRINT_VIS_001_RESULT.md` with observed versus fixture evidence, scope decisions, security results, gate status, and release verdict. Update canonical docs and operator guidance only for behavior actually shipped.

This proposed document does not change the status of v1.12 in the roadmap, mark any gate complete, or authorize release promotion or production deployment.

## 9. GO / CONDITIONAL GO / NO-GO

**GO:** The entry evidence is recorded; the implemented surface resolves the observed comprehension problem in a real human trace. Current and historical state, catch-up, drill-down, and supported artifact inspection agree with authorized service reads. Paging, security, preview isolation, compatibility, and any SQLite/D1 write parity pass. State Gate B and Gate C separately from the sprint verdict.

**CONDITIONAL GO:** The entry evidence and deterministic/security checks pass, but the human return trace, external artifact access, second participant, or live agent path is unavailable for a recorded reason. Identify the unproven part and do not claim repeat use, ordinary team value, or that previews are useful beyond the observed types.

**NO-GO / REFRAME:** The entry gate is not met; the UI makes obsolete state look current; a missed page advances the cursor; a highlight changes currentness; unauthorized content or credentials reach the browser/preview; unsafe content executes; a preview fetch can reach arbitrary local or private targets; or the human still needs a private transcript or manual explanation to find the current position. Repair security and state correctness before a release verdict.
