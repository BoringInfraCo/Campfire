# Campfire v1.17 — Shared Work Home

**Sprint ID:** SWH-001  
**Target release:** v1.17.0  
**Status:** Implemented engineering candidate, October 14, 2026. D1–D7 deterministic checks pass; the controlled human traces and ordinary-work observations are not yet scored; not published. Package remains `1.16.0`. See `docs/SPRINT_SWH_001_RESULT.md`.  
**Date:** October 13, 2026  
**Theme:** Make one authorized workspace understandable to a person working alone or with teammates and their agents  
**Depends on:** Published v1.16.0; CTX-001 bounded orientation; COR-001 currentness; VIS-001 Viewer clarity; existing participant and agent ownership records

This contract scopes the v1.17 work proposed in `docs/ROADMAP.md` §21. It does not change the RCL-001/002/003 NO-GO / REFRAME verdicts, close Gate B, C, or E, or authorize publication. The v1.12 human comprehension trace and artifact-open observation remain open. The owner's direction to prepare v1.17 permits this bounded read-only sprint to proceed while those observations are collected; it does not turn their absence into evidence or authorize a broader collaboration dashboard. Record a separate founder release decision if publication is requested with an open criterion.

---

## 1. Sprint question

> Can two authorized teammates, each using their own coding agent, understand the same recorded work, identify who owns it and what needs attention, and choose a safe next step without reading one another's private sessions?

The immediate build is a **work-centered home inside the existing Viewer**. It is a projection of one workspace's authorized state. A person alone sees their work and agents; a teammate sees the same shared workspace from their own identity. The workspace, not the page, remains the record of goals, tasks, findings, decisions, artifacts, and provenance.

This sprint tests legibility and a bounded handoff. It does not claim that Campfire supervises running agents, infers live presence, discovers hidden dependencies, or improves historical next-action choice. Recall remains an experimental v1.16 surface with Gate E unmeasured.

## 2. Current state and evidence boundary

- The v1.16 Viewer already shows a goal, participants, recorded alignment, `Needs You`, `Needs Attention`, current work, catch-up, and the activity stream. `get_workspace_context` supplies bounded slices, `needsYou`, `needsAttention`, `currentWork`, and `alignment`. The proposed home reorganizes and clarifies those facts; it does not invent a new attention engine.
- Agents have identities and optional `humanId` owners. Workspace participants expose a `humanOwnerId` for an owned agent; tasks may have an assignee. A registered agent session has start/end timestamps. None of these fields proves that an agent is presently running, waiting, or blocked.
- The Viewer is read-only, loopback by default, and bound to the operator actor chosen at startup. Its browser holds no token. `VIEWER_READ_METHODS` contains `whoami`, `list_workspaces`, `get_workspace`, `get_workspace_context`, and `get_activity`. A Viewer URL is **not** a multi-user login or a safe share link. Each human observation must use that person's own authorized actor-bound Viewer, never a teammate's listener.
- `docs/SPRINT_VIS_001_RESULT.md` records a pre-slice comprehension failure, but no human comprehension trace on the shipped Viewer. Its condition 4 still lacks a real attempt to open an accessible artifact. Collect both without presenting the earlier fixture as a new observation. The existing generated page is separate and remains non-canonical.
- Gate B voluntary repeat use, Gate C ordinary multi-participant value, and Gate E historical next-action benefit remain unmeasured. A controlled two-person usability trace or a single ordinary handoff does not by itself close any of them. Installation IDs, page opens, and agent-session counts are not unique people or collaborating teams.

**Scope decision:** Gate B precedes heavy collaboration UX. SWH-001 is a bounded read-only rearrangement of already authorized workspace data, with no new shared object, write operation, or hosted multi-tenant service. Broader team surfaces wait for ordinary use evidence. A product finding that requires new state or policy is a REFRAME, not permission to add it during this sprint.

## 3. Smallest product journey

1. Human A opens their own loopback Viewer for a workspace in which they participate. They see the goal, their owned participating agents, their assigned work, `Needs You`, and what is incomplete in the bounded read.
2. They switch to the team perspective of **the same workspace**. It shows authorized human participants and their participating agents, recorded task ownership and status, team-level attention, decision state, and the existing activity trail. Unknown ownership is labelled unknown. The page does not claim an agent is online or currently executing.
3. Human A checks an accepted decision marked `needsReview`, its cited non-current finding, and any other accepted or proposed decision. The page does not choose an operative decision from order or recency. Human A can name the source IDs and a safe next step, including an explicit transition when accepted decisions conflict.
4. Human B opens **their own** authorized Viewer for the same workspace. They can identify Human A's recorded work at a useful level without seeing Human A's agent prompt, answer, tool calls, or terminal output. Their own agent can use existing Campfire reads to continue from the recorded state.
5. If a real artifact matters, a person attempts to open an accessible reference during ordinary work. Record the attempt separately for VIS-001 condition 4. The v1.17 page shows the record and reference; it neither fetches nor previews the target.

## 4. Product and interface contract

### 4.1 One home, two perspectives

Use one workspace selection and two clearly named perspectives, **My work** and **Team work**, inside the existing Viewer. Both are projections of the same authorized `get_workspace_context` response. They are navigation, not privacy modes or new collections. Do not add a new page family, domain object, database table, MCP tool, or API method for this layout.

Keep the existing journal, detail inspection, catch-up, generated-view link, and workspace switcher available. Preserve keyboard access and a visible focus indicator when perspectives change. The initial perspective may be chosen for clarity, but it must be deterministic and must not silently hide the other. A person using only the keyboard or a screen reader can identify the selected perspective and reach every item it displays.

**My work** leads with `needsYou`, then tasks assigned to the caller or their participating owned agents, with the goal and decision boundary visible. An unassigned task is not called mine. **Team work** leads with `needsAttention`, then people, their participating agents, and open/in-progress/blocked tasks grouped by recorded assignee. Show unassigned tasks separately. A task created by an actor is not assigned to that actor unless its `assignee` says so. Both perspectives expose a route to the same decision, finding, artifact, and activity details. Do not duplicate records or make one perspective the source of truth.

If the Viewer is bound to an agent actor, **My work** means tasks assigned to that agent; it does not infer a human owner for the caller or acquire the owner's other work. The scored human trace uses human actors.

### 4.2 Ownership, status, and attention

Use the authenticated `whoami` result to determine the caller. Derive agent ownership only from the participant's recorded `humanOwnerId`; an agent without that field appears as ownership unknown, not as the current human's agent. Preserve human and agent actor types and the recorded task assignee. If a referenced assignee is absent from the returned participant list, show the actor ID/type and an explicit unknown-name state rather than guessing a human owner.

Render task `open`, `in_progress`, `blocked`, and `completed` according to stored status. Render `needsYou` and `needsAttention` according to the service projection, preserving its reason and source ID. The Viewer does not recalculate who may act. Do not label an agent “working,” “idle,” “waiting,” or “online” from task status, an open session, last contribution, or polling. “Last recorded contribution” is acceptable when accompanied by its timestamp and actor.

An attention item is a cue to inspect recorded state, not an instruction to execute. A suggested next action remains an orientation hint with kind and ID. If a task or decision has no explicit relation to another, the page must not assert that one blocks or affects the other.

### 4.3 Decision safety and source inspection

Show proposed, accepted, accepted-needing-review, and historical/superseded records with distinct text labels that survive without color. Keep `needsReview` and cited non-current finding IDs visible. Show recorded replacement links and reasons when the existing authorized detail supplies them. Do not infer a single operative decision when multiple accepted decisions remain or when a cited finding is stale. A proposed decision is not a task or permission to act.

Keep source IDs, actor/provenance, and recorded evidence/basis IDs reachable from a summary. Show an artifact's type, title, and stored reference only for an authorized workspace read. The reference is **not** proof that the target exists, is true, or is separately accessible to the viewer. No automatic code-to-task link, commit ingest, external fetch, preview, or clickable file/URL affordance is in the default v1.17 build. Observe a real reference-open attempt outside the Viewer first. If that evidence later justifies a link, record a named scope amendment and security review before code: explicit safe scheme/source rules, no server fetch, no token forwarding, and no `VIEWER_READ_METHODS` change. Previews remain deferred.

### 4.4 Boundedness, empty states, and navigation

The home uses bounded orientation data. For every displayed slice, preserve `total`, `returned`, and `truncated` or an equally explicit completeness statement. A group filtered from a truncated slice cannot claim “none in workspace” merely because no matching row was returned. A zero-row complete section may say “none”; an incomplete one must say “more may exist” and offer the existing drill-down path. Do not call the unbounded `get_workspace` on each refresh to make the home look complete.

Keep current and historical state separate. A person can inspect the exact task, decision, finding, artifact, or contribution behind a home row through the existing Viewer behavior. A failed detail read must not be replaced by guessed text. Avoid new polling loops; the home consumes the current orientation refresh and does not increase the number of service reads per refresh.

### 4.5 Privacy and authorization

Workspace membership authorizes the existing shared work records. It does **not** create field-level secrecy within one workspace. “My work” and “Team work” are presentation filters over already authorized records, not a promise that task titles, summaries, or artifact names are hidden from teammates. Sensitive words put into shared workspace records may be visible to every authorized participant. Do not claim otherwise in UI copy or product messaging.

Private session prompts, responses, tool arguments, terminal output, credentials, and unshared files remain outside the home. Do not retrieve them and hide them with CSS. Authorization happens before retrieval through the existing service; the browser never receives another workspace's records to filter locally. Maintain loopback default, the Host boundary, the token-free browser, read-only Viewer, and the five-method allowlist. Non-loopback exposure remains an explicit operator action and is **not** a team hosting solution. Contributed titles and summaries render as inert text, including in labels, attributes, and generated markup.

## 5. Architecture and compatibility

- The workspace remains the only collection and authorization boundary. Reuse existing orientation, participant, task, decision, finding, artifact, and activity contracts. No schema or migration in SQLite or D1.
- No change to CLI JSON, MCP tools, HTTP method names, webhook vocabulary, telemetry allowlist, playbook flag, Recall selection, handoff packet schema, or generated workspace page.
- No Viewer write, new Viewer read method, browser-held credential, account/login system, shared Viewer URL, team-wide session stream, or cross-workspace aggregation.
- A home layout can be absent and the CLI/MCP/workspace state remain complete. The page is not a Contribution and is not persisted as team state. Local UI preference, if stored, is not shared work state and must not include workspace content.
- Keep the existing release and install-channel process. A v1.17 package bump, tag, public export, and production deployment are separate promotion steps after a recorded result and release decision.

## 6. Observation protocol — freeze before judging the build

### 6.1 Preflight and ground truth

Before changing the Viewer, record the current v1.16 source commit and Viewer behavior in `docs/evidence/swh-001/`. Run a human trace on the shipped Viewer if a participant is available. This is the overdue VIS-001 comprehension observation, **not** a treatment arm or proof that the new home helps. If it cannot happen before code, record why; do not later call a post-build trace a v1.16 baseline.

Freeze one controlled, realistic workspace scenario and its answer key before candidate testing. It must have two human participants, each with a participating owned agent using a different harness; assigned and unassigned tasks across open/in-progress/blocked states; a personal attention cue for each participant and a team attention cue; at least two accepted decisions whose recorded rationales conflict, with no recorded transition resolving them and one marked `needsReview`; a proposal and a historical record; one complete empty section and one truncated section; and an artifact reference whose separate access status is known. The keyed safe next step is to seek an explicit retirement or an accepted replacement naming its predecessor and reason before executing either conflicting rule. Seed data may calibrate the UI and rubric, but it is labelled **fixture evidence** and cannot establish Gate B, C, or E. Freeze expected IDs, actor/owner mapping, statuses, decision relationships, counts, source position, and safe next action in a key the participants cannot read.

If the service ground truth is wrong or the scenario lacks a required item, repair or replace it **before** a scored trace and record the change. Do not alter the key to fit candidate output after a participant begins. If work changes the workspace during a trace, retain the before/after source positions and rescore against the state actually served; if that cannot be reconstructed, mark the affected item invalid and rerun with a fresh scenario.

### 6.2 Controlled human comprehension trace

Recruit **two distinct humans**, at least one who did not build the page. Each opens a separate actor-bound Viewer as an authorized participant. Do not share one operator-bound listener. Give both the same neutral questions in §7, without coaching, an answer key, a prepared summary, or private session transcript. Counterbalance which perspective they open first. Allow up to 15 minutes per participant and the normal Viewer inspection controls; no CLI or MCP during the comprehension task. Record the exact candidate commit, browser/viewport, actor role, start and end time, visible workspace source position, click/inspection path, verbatim answers, hints given, errors, and rubric scores. A hint that supplies an answer fails that item. A timeout or no answer is a fail, not N/A.

The recorder scores each response against the frozen key before discussing answers with the participant. Retain sanitized evidence in `docs/evidence/swh-001/` and an item-level result in `docs/SPRINT_SWH_001_RESULT.md`. A second reviewer independently checks all four critical items H2, H4, H6, and H7 and every claimed pass where the answer is ambiguous. Disagreements resolve against the frozen key, with both readings retained. Do not substitute automated fixture tests for a human trace.

### 6.3 Ordinary-work observations, kept separate

Observe a real participant's attempt to open one real, accessible artifact reference during ordinary work, preferably outside the Viewer. Record the type, why they sought it, whether they reached it with their own authority, and what content they needed. Redact sensitive paths and content from retained public evidence. An observation that no such opportunity occurred is a dated **absence**, not a successful reference-open attempt; VIS-001 condition 4 stays open. A new link or preview is not justified by fixture frequency or by the home merely displaying a reference.

When available, also observe Human A and Agent A leaving recorded state, then Human B and a different agent continuing a real task from Human B's own authorization boundary. Retain which records B inspected, the work product, and any manual explanation or private transcript used. This is one bounded product observation, not automatically Gate C. Register it under a separate Gate B/C protocol only if its eligibility criteria exist and are met. If prior completed work or a v1.16 packet is involved, follow `docs/GATE_E_PROTOCOL.md` and predeclare claim P, H, or N; this sprint's trace does not close Gate E by relabelling a result after the fact.

Consent and minimization apply to real participants. Retain the answers, source IDs, sanitized UI state, and the access outcome needed to audit the claim. Do not retain their raw agent prompts, terminal transcript, tokens, external artifact contents, or customer secrets in this evidence directory. A refusal to record is respected and yields no scored observation.

## 7. Frozen human rubric

Score each item **PASS** or **FAIL** against the §6.1 key. All seven items are applicable in the controlled scenario. The participant may use the Viewer to inspect details; the correct answer need not be memorized. A claim that cannot be checked against the retained answer and served state is FAIL. Record the answer verbatim, expected IDs/facts, score, and reason; do not replace a wrong answer with an operator summary.

| Item | Neutral prompt | PASS requires | Critical? |
| --- | --- | --- | --- |
| **H1 — current work** | “What is this workspace trying to do, and which work is open, in progress, or blocked?” | Correct goal and the keyed task statuses; no historical/completed task called active. | No |
| **H2 — ownership** | “Which work is yours or your agents', which belongs to a teammate or their agent, and which has no recorded owner?” | Correct human/agent identities, task assignees, and unknown/unassigned cases; creation is not mistaken for assignment. | **Yes** |
| **H3 — attention** | “What needs you, and what needs someone on the team?” | Correctly separates `needsYou` from `needsAttention` with at least one reason and source ID; does not infer an agent's live state. | No |
| **H4 — decision safety** | “What decisions are recorded, which need review or conflict, and what can the team safely treat as settled?” | Names the keyed accepted/proposed/historical IDs and the `needsReview` or unresolved conflict; does not invent an operative decision, promote a proposal, or execute either conflicting rule. | **Yes** |
| **H5 — source trail** | “What record supports one important claim, and where would you inspect its artifact or code reference?” | Names the correct finding/decision and evidence/artifact IDs, plus the stored reference or an explicit absence; does not claim the target was fetched, verified, or accessible merely because it is listed. | No |
| **H6 — completeness** | “Which lists are complete, which are truncated, and what would you inspect next if an item is missing?” | Distinguishes the keyed empty complete section from the truncated section using counts and the existing drill-down path; does not interpret undisplayed rows as nonexistent. | **Yes** |
| **H7 — next step** | “What would you do next, and what recorded facts make that safe?” | States the keyed safe next step with source IDs and any needed explicit decision transition; treats a suggested action as a hint, not permission. | **Yes** |

**Participant pass:** H2, H4, H6, and H7 all PASS, plus at least **six of seven** items PASS overall. A missing or invalid critical item is not a pass. Report each participant separately; do not average away a critical failure. Time, number of inspections, and preference comments are diagnostic only, with no post-hoc threshold. The two-human controlled result measures comprehension of this scenario, not causal improvement over v1.16 or ordinary team value.

For each participant, the scoring sheet records: candidate commit and source position; participant code and actor identity; perspective order; H1–H7 verbatim response, expected record IDs/facts, PASS/FAIL, reason, and reviewer; critical-item second review; start/end time and hints; reference attempt if one occurred; and deviations. Keep the frozen answer key separate from the participant packet. The result reports both participant totals and every item, not only an aggregate pass rate.

### Deterministic acceptance matrix

These checks are mandatory regardless of human scores:

| Check | Required observation |
| --- | --- |
| **D1 — authorization** | The workspace list contains only workspaces authorized for the actor, and the home reads only the selected authorized workspace. A non-participant, unknown workspace, forged workspace selection, and wrong-workspace object ID reveal no title, participant, count, reference, or activity. Filtering after retrieval is not accepted. |
| **D2 — identity** | Two actor-bound Viewer instances show different `My work` and `Needs You` where the service says they differ; both show the same authorized shared facts. Owned, unowned, and unknown agents remain distinct. |
| **D3 — source parity** | Every displayed status, reason, ID, count, provenance field, and decision label matches the authorized service read at one recorded source position. Truncated lists remain incomplete in both perspectives. |
| **D4 — read boundary** | `VIEWER_READ_METHODS` remains the same five methods; no write is accepted, no browser token appears, and no new schema row, Contribution, webhook, or telemetry event is produced by viewing. |
| **D5 — hostile text and reference** | Markup in a task, participant name, finding, decision, or artifact reference renders inert; an unsafe/missing target is not fetched or opened automatically. Viewer Host/loopback restrictions still pass. |
| **D6 — accessibility and compatibility** | Both perspectives work by keyboard and with meaningful labels/focus; status and `needsReview` do not depend on color alone. Existing journal, catch-up, detail, generated view, CLI, and MCP behavior remain available. |
| **D7 — bounded work** | The home adds no per-poll service method, unbounded full-workspace refresh, external fetch, or new background loop. A large/truncated workspace still renders honest counts and usable navigation. |

Use meaningful integration tests for these boundaries and the existing Viewer regression suite. Record typecheck, full tests, build, packaging, and deployment dry-run outcomes when release-shaped. A test pass is implementation evidence, not a human comprehension result.

## 8. GO / CONDITIONAL GO / NO-GO

**GO for the bounded v1.17 sprint:** D1–D7 pass; both controlled human participants pass §7 with no critical error; the v1.12 shipped-Viewer comprehension trace and a real accessible reference-open attempt are recorded and correctly attributed to VIS-001; and at least one ordinary two-human/two-agent continuation from separately authorized Campfire state is observed without a private transcript or prepared handoff. The result states the narrow facts these cases establish. It does not claim Gate B, C, or E is closed unless those gates are separately measured under their own criteria.

**CONDITIONAL GO as an engineering candidate:** D1–D7 pass and both controlled participants pass, but the shipped-v1.16 Viewer trace, a qualifying ordinary-work continuation, or a real reference-open attempt is unavailable for a recorded reason. Name each missing observation, keep VIS-001 condition 4 and the relevant gate open, and make no validated team-value claim. This is not automatic publication authorization. If only one controlled participant is available, keep the candidate **unscored** until the second trace; do not convert one person's pass into CONDITIONAL GO.

**NO-GO / REFRAME:** Any D1–D5 safety boundary fails; either participant fails a critical H item; the page suggests a false owner, live agent state, operative decision, or complete list; source state is wrong or unavailable and the UI masks it; private session content or another workspace reaches a browser; or the task truly requires a new sharing policy, agent runtime, dependency model, preview, or hosted account. A noncritical human failure below the participant threshold is also NO-GO for the current candidate. Repair the cause and run a new, dated trace; do not edit a frozen answer key or silently rescore old answers.

Publication, tag, public snapshot, installer pins, and deployment require a **separate release decision**. A founder may explicitly override an evidence hold for a bounded release; the result must show the contract verdict, what the override waives, what remains unmeasured, and the exact public claim. An override never turns a failed or absent observation into a pass.

## 9. Execution order and result record

1. Record the v1.16 source baseline and, where possible, the overdue shipped-Viewer comprehension trace. Identify a real accessible artifact during ordinary work; keep VIS-001 condition 4 status explicit.
2. Freeze the controlled scenario, served-state key, neutral prompts, scoring form, two actor identities, and evidence-retention plan before candidate traces. Keep the key out of participant and agent context.
3. Implement only §§4–5 in the existing Viewer. Review service-side authorization and the risk of treating a shared work title as private. Add targeted D1–D7 checks without altering frozen VIS/RCL evidence.
4. Run typecheck, relevant tests, full suite, build, and release checks as appropriate. Execute the two human traces. Score against §7 before discussing answers or changing the UI; after a repair, run a new trace and preserve the earlier result.
5. Observe an ordinary two-human/two-agent continuation when available. Record voluntary return and any Gate E case separately; do not backfill gate evidence from the controlled scenario.
6. Write `docs/SPRINT_SWH_001_RESULT.md` with the item-level rubric, service source positions, security results, deviations, limitations, verdict, and open gates. Update canonical docs only for behavior actually shipped. Seek a separate release decision before promotion.

The sprint is successful only when the shared workspace becomes easier to act on **without turning private sessions into team data or presentation into authority**.
