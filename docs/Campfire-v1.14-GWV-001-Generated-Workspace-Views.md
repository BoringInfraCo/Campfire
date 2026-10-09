# Campfire v1.14 — Generated Workspace Views

**Sprint ID:** GWV-001
**Target release:** v1.14.0
**Status:** Contract. On October 9, 2026 the entry gate in §2 is open. This slice is not sprint scope, and product implementation stays unstarted. The October 7 VIS-001 overrides authorized the bounded `v1.12.0` Viewer slice only. The `v1.13.0` playbook GO is a frozen synthetic recording result and is not this gate.

**Depends on:** VIS-001 / published `v1.12.0` (CONDITIONAL; human comprehension trace and condition 4 open) and WOW-001 / published `v1.13.0` (GO on the frozen synthetic pilot)

**Theme:** One derived, sandboxed, non-canonical read of one authorized workspace

This document follows `docs/ROADMAP.md` §21 and `docs/ARCHITECTURE.md` §19 and §22 as revised on October 9, 2026. It does not change that sequence, close a gate, or authorize a release.

---

## 1. Sprint question

> Can one authorized actor read a single derived view of a workspace, see the current position the service already returns, and still have a complete workspace when that view is absent?

v1.10 bounded orientation, catch-up, and drill-down. v1.11 made currentness explicit. v1.12 published a bounded read-only journal clarification. v1.13 published one opt-in recording playbook. Once §2 is recorded, this sprint adds one derived page for one actor. The page projects authorized workspace state. The workspace remains what the team believes.

The page addresses a recorded presentation defect of state a trace could already explain. Missing or incorrect workspace state is a different repair.

## 2. Entry gate and evidence boundary

`docs/ROADMAP.md` §21 keeps generated views behind this gate. Record the evidence and the gate decision in `docs/SPRINT_GWV_001_RESULT.md` before implementation begins.

| Roadmap condition | Record on October 9, 2026 | Evidence needed |
| --- | --- | --- |
| A human comprehension trace on the shipped v1.12 Viewer | Unmet. `docs/SPRINT_VIS_001_RESULT.md` records that usability of the shipped surface is unverified. The earlier human observation predates that slice. | One person, on the shipped Viewer, pursuing an ordinary task. Record the participant, the state presented, what they tried, where understanding failed, and the correct state. |
| A reference-open observation, including a recorded absence on or after October 14, 2026 | Unmet. Condition 4 has no attempt to open a real, accessible artifact reference. October 14, 2026 has not arrived, so an absence is not yet a result. | The attempted type and reference, why the person opened it, whether access succeeded, and what content would have helped. A dated record that no opportunity occurred, written on or after October 14, 2026, is also a result. |
| The defect is presentation of state the trace could already explain | Unmet. It waits on the two rows above. | The result distinguishes a presentation defect from missing or incorrect workspace state. When the state itself is wrong, reframe and repair that state. |
| The v1.13 recording gain is not this evidence, and the absence of a continuation gain stays visible | Standing. WOW-001 improved recording on 3/3 matched pairs. Continuation was already at the rubric ceiling in both arms. | Cite `docs/SPRINT_WOW_001_RESULT.md`. Leave that GO as a recording result. |
| Gate B may remain unmeasured. The view does not claim it. | Standing. Gate B and Gate C are unmeasured. | State both gates separately from the sprint verdict. |

Until those rows are true, GWV-001 is not sprint scope.

The roadmap's next evidence, before any new projection, is a v1.12 matter: the comprehension trace and the reference observation. A recorded absence counts on or after October 14, 2026. If no opportunity has occurred by that review, the only build is a read-only Viewer reference affordance that records the attempt, fetches nothing, and previews nothing. That affordance is v1.12 evidence. It is outside GWV-001, and this contract does not schedule it. On October 9, 2026 that build waits, because the review date has not arrived.

Two October 9 sentences about Gate B are both in the roadmap. This contract leaves them standing. §21 says Gate B may still be unmeasured and the view does not claim it. §15 says a generated view stays behind the §21 entry gate while Gate B is unmeasured. Implementation stays unstarted under either reading, because the first three rows are unmet. The result, before any implementation, records which reading the founder adopts.

These canon tensions stay recorded and unresolved:

- `docs/VISION.md` leaves a later sprint room for an explicit bounded write. `docs/ARCHITECTURE.md` §22 describes the page as one authorized read that holds no credential and is non-canonical. This contract grants no write or persistence.
- Highlights remain later projection work. v1.11 currentness does not pull them into this sprint. v1.12 and v1.13 left them out.
- `docs/ROADMAP.md` §12 draws previews, highlights, and generated views as one projection tree. §21 and `docs/ARCHITECTURE.md` §22 commit this release to one view. Previews and highlights stay deferred.
- `docs/PRODUCT_DEFINITION.md` still describes the incident-investigation playbook as a possible later experiment. The roadmap and `docs/SPRINT_WOW_001_RESULT.md` record it as published `v1.13.0`. A second playbook is a separate founder decision and is outside this gate.

## 3. Smallest product journey

This journey is the boundary. After the gate, the result freezes the smallest page that addresses the recorded defect. The layout waits for that evidence.

1. The loopback server is already running for an authorized actor. The browser holds no Campfire credential.
2. The actor opens one generated view of one workspace. The server authorizes that actor, that workspace, and the read before it renders.
3. The page shows the current position the orientation read already returns: goal, current work, current findings, accepted decisions, `needsReview` where the service computed it, and the suggested next action as a hint, not permission to execute. For each bounded section it presents `total` / `returned` / `truncated`; a truncated section is visibly incomplete.
4. The orientation read is not full history. The page does not present a superseded finding or decision as a returned orientation item; it may show the service's historical counts with an explicit label that the records require the existing drill-down. Currentness stays the service's fact. Recency, confidence, highlight status, and a model summary do not choose it.
5. The actor closes the page. The workspace, its contributions, and the team journal are unchanged. The same question is answerable from `campfire context`, `campfire show`, or the existing journal, with the generated view never opened.
6. A request for a workspace the server's actor does not participate in returns a denial. The response contains no title, id, count, or markup from that workspace.
7. A second authorized participant continues the work from the workspace. The generated page is not the handoff. The originating private transcript stays in its own session.

## 4. Product and interface contract

### 4.1 One derived read

The view is one HTML document produced at read time for one actor and one workspace. Its facts are the fields of the existing orientation read, `get_workspace_context`, through the authorized service. A truncated section names the existing drill-down without calling it from the generated document. The document does not fill gaps from `get_workspace`, and it adds no truth computation of its own. It does not claim to show all current records when an orientation slice is truncated.

The document is produced for that read. It is stored nowhere. It is not a Contribution. It is not a domain object. There is no second store. The workspace is complete when the document is absent.

The team journal stays the Viewer: `campfire view`, loopback by default, a token-free browser, and the read methods `whoami`, `list_workspaces`, `get_workspace`, `get_workspace_context`, and `get_activity`. This sprint adds no Viewer read method and no Viewer write.

No new MCP tool. No new webhook event. No telemetry event. `campfire playbook` and `get_playbook` stay the opt-in static `incident-investigation` 1.0.0 read.

### 4.2 Sandbox

Arbitrary HTML is untrusted. That includes text an agent contributed as a finding, a title, or metadata. The document is sandboxed, with a content security policy and capability isolation. Treat its origin as untrusted: it must not inherit the journal origin's ability to call `/api/call` through the loopback server's bound actor. It carries no Campfire credential in the body, the URL, storage, or a cookie. It has no path to Campfire methods. Contributed text stays text: it does not execute, and it does not fetch. The result must record the concrete isolation design and test it in a browser before serving the page.

Do not treat possession of a loopback Viewer URL as actor authentication: the existing server binds calls to its operator's actor without a browser token. The generated route must not widen that authority or turn a shareable URL into a cross-principal read. Remote exposure remains an explicit operator choice, as it is for the journal.

A rendering model built for one personal agent does not transfer. Campfire authorizes more than one principal. The page is the projection for the actor the server already authorized.

### 4.3 What stays where it is

Artifact stays identity, type, title, reference, metadata, and provenance. The page may show a reference the orientation read already returned. It leaves the target unfetched. Preview bytes and presentation stay off the artifact.

Highlights stay out. The page has no salience control.

Playbook text stays guidance for recording. It is not rendered as workspace state.

## 5. Architecture and compatibility

- Workspace remains the only collection and the authorization boundary. The server decides allow or deny before any workspace field is rendered.
- Humans and agents stay distinct. The page preserves the provenance the service already returns.
- Orientation, catch-up, drill-down, and `get_workspace` stay their present contracts. The view projects the orientation read.
- Model inference plays no part in contents, currentness, authorization, or lifecycle.
- Schema stays still. No SQLite migration, no D1 migration, and no new table. The closed webhook vocabulary stays closed.
- Existing CLI, MCP, HTTP, Worker, enrollment, local profiles, and the playbook flag remain compatible.
- The journal's read-only allowlist stays the five methods named in §4.1.

## 6. Acceptance scenarios

### Deterministic and security checks

- For an authorized participant, the document's goal, current findings, accepted decisions, `needsReview`, suggested next action, and completeness counts match `get_workspace_context` for that actor and workspace.
- A truncated section shows `total`, `returned`, and `truncated`. The document shows that the section is incomplete.
- Orientation excludes superseded findings and decisions as items. If historical counts are shown, they are labeled as counts requiring the existing drill-down. A decision that cites a finding no longer current shows `needsReview` when the service returns it.
- Requesting the document writes no row and no Contribution. A second request writes nothing either.
- `campfire context` and the team journal return the same position when the generated view has never been requested.
- A non-participant, and an unknown workspace, receive a denial with no workspace field and no derived markup.
- A finding body that contains markup or a script is text. It does not execute. In a browser test, the document cannot call the journal's `/api/call`, read its response, or fetch an artifact reference, even when opened from a URL on the loopback server.
- The response, the URL, and browser storage contain no bearer token.
- The journal allowlist, the playbook's refusal to read a workspace, and the existing orientation bounds still pass.

### Human product trace

Run this after §2 is recorded and says the defect is presentation. Use the workspace from that comprehension trace. One person opens the generated view and answers what is current, what needs review, and what the next action is. Record whether the page resolves the recorded defect. A cold authorized agent answers the same question through the existing Campfire reads, without the generated page and without a prepared summary. The human and the agent agree on currentness and provenance.

Record participant count and machines. This trace leaves Gate B and Gate C unmeasured. Label fixture identities as fixtures.

When the recorded defect requires a preview, a highlight, a fetch, a stored page, or a correction to the underlying state, stop and reframe. Those needs stay outside this sprint.

## 7. Non-goals

- Implementation while §2 is open.
- The v1.12 reference affordance, artifact previews, and fetching external targets.
- Shared highlights, a Channel, or any second collection.
- A stored page, preview bytes, or presentation on Artifact.
- A model summary as the current position, embeddings, semantic ranking, or transcript ingestion.
- A new domain object, a Viewer write, a new Viewer read method, or a new MCP tool.
- A second playbook, workflow execution, or a skills platform.
- A renderer or plugin registry, a dashboard, or a family of views.
- Cross-workspace retrieval, orchestration, or a write capability.
- A new webhook event or a telemetry event.
- A Gate B or Gate C claim.

## 8. Execution and result

1. Leave product code untouched while §2 is open. The comprehension trace and the reference observation, when they are collected, are v1.12 evidence.
2. Write the gate decision in `docs/SPRINT_GWV_001_RESULT.md`. When the evidence shows missing or incorrect state, record REFRAME and stop. When the recorded defect belongs to an agent rather than the human trace, record REFRAME before any new MCP tool is considered.
3. When the evidence shows a presentation defect of state the trace could already explain, record the founder reading of the Gate B sentences in §2. Freeze the smallest document that addresses the recorded defect. Review the sandbox boundary before any HTML is served.
4. Implement that one read through the existing service and interface layers. Add tests for authorization, completeness, currentness, non-persistence, and hostile content.
5. Run `npm run typecheck` and `npm test`. Run `npm run build` when the slice is release-shaped.
6. Run the human trace in §6. Keep observed evidence separate from fixture evidence. Update canonical docs only for behavior that actually shipped.

This document does not change the roadmap status of v1.14, mark any gate complete, or authorize release promotion or production deployment.

## 9. GO / CONDITIONAL GO / NO-GO

**GO:** §2 is recorded, the founder's reading of the Gate B sentences permits this bounded implementation, and the evidence says the defect is presentation of state the trace could already explain. The implemented document resolves that defect in a real human trace. Its facts match the authorized orientation read. Current and historical state stay distinct. The document is absent from storage and from the contribution log. The journal and CLI answer the same question with the view never opened. Sandbox, credential, and denial checks pass. Gate B and Gate C are stated separately and stay unclaimed.

**CONDITIONAL GO:** §2 is recorded, the founder's Gate B interpretation permits this bounded implementation, the deterministic and security checks pass, and the human trace on the new document is unavailable for a recorded reason. Name the unproven part. Comprehension, voluntary return, and ordinary multi-participant value stay unclaimed.

**NO-GO / REFRAME:** §2 is unmet. Or the evidence shows missing or incorrect state. Or the workspace is incomplete without the page. Or the page is stored or recorded as a Contribution. Or a model decides currentness. Or unauthorized content or a credential reaches the browser. Or contributed text executes or can call Campfire. Or the page fetches an artifact, adds a preview, or adds a highlight. Or a write path, a second playbook, or a new domain object appears. Or the person still needs a private transcript to find the current position. Repair that boundary before any release verdict.
