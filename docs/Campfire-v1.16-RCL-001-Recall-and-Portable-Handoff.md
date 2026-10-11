# Campfire v1.16 — Recall and Portable Handoff

- **Sprint ID:** RCL-001
- **Target release:** v1.16.0
- **Status:** Implemented candidate, October 10, 2026. The scored pilot has not been run. This is not a release.
- **Theme:** Find relevant prior work in one workspace and carry a bounded copy to another authorized participant.
- **Depends on:** CTX-001 orientation and catch-up; COR-001 currentness and citations; CLI-001 JSON output; PSA-001 read-boundary hardening.

## 1. Sprint question

> Can an authorized person or agent find relevant earlier work in the same workspace, tell whether it is still current, and hand that evidence to another authorized participant without a private transcript?

Build **one read-only retrieval path** with two outputs: Recall through CLI/MCP and a portable JSON handoff packet written explicitly by the CLI. The packet uses Recall's selected records and existing orientation facts. It is a bounded copy of work state, not a new canonical object, full database export, or invitation.

The owner requested both features in this sprint on October 10. This authorizes a bounded **Gate E historical-reuse experiment** before Gate E has been established. It does not declare Gate E passed or authorize cross-workspace search, an organization-wide memory index, embeddings, transcript ingestion, or autonomous handoff.

## 2. Current state and evidence boundary

- `get_workspace_context` already supplies bounded current orientation and an append-position cursor. `get_workspace_changes` catches up from it. Workspace-scoped object reads page decisions, findings, tasks, and artifacts; correction and citation records preserve history. CLI JSON and MCP use the authorized service.
- There is no topic-based workspace retrieval. A caller can page and inspect records but must discover relevant prior work manually. `campfire capabilities` is the CLI catalog, not an agent capability registry.
- v1.15.0 is published and deployed with bounded request and delivery work. This sprint preserves those limits on SQLite and Worker/D1.
- Gate E asks whether prior completed work materially improves new work. It is unmeasured. Gate B/C and the v1.12 Viewer comprehension and reference-open observations remain separate and open.

The result must distinguish deterministic checks, synthetic cross-harness runs, and observed ordinary work. Retrieving a seeded fixture proves an interface works; it does not by itself establish Gate E or repeat usage.

## 3. Smallest product journey

1. An authorized participant asks, “What did this workspace learn about the authentication callback?” Campfire returns matching current and historical records with IDs, lifecycle state, provenance, relationships, and completeness.
2. The participant inspects a cited object when the excerpt is insufficient. Superseded findings, superseded decisions, proposals, and accepted decisions marked `needsReview` remain distinct. Campfire does not infer an “operative decision” from position or recency.
3. The participant explicitly names an authorized recipient and output file. Campfire checks both participants, then writes a compact JSON packet containing the goal, selected records, source IDs, and omissions.
4. The recipient reads the file in a fresh harness session, without the originating transcript. The file grants no Campfire authority; the recipient needs their own credential for drill-down or catch-up. Campfire does not upload or store the file.

## 4. Product contract

### 4.1 Workspace Recall

Input is one explicit `workspaceId`, nonempty bounded query, and optional limit/cursor. Authorize `workspace:read` **before search or count**. Unknown or unauthorized workspaces reveal no names, counts, snippets, or fallback result. Search only that workspace's structured text: goal title/description for context; task title/description; finding summary/detail; decision summary/rationale; artifact title/type. Do not search private transcripts, credentials, artifact contents, external URLs, arbitrary metadata, or another workspace.

Return a versioned `WorkspaceRecall` with query, workspace, generated time, source contribution cursor, goal, and three bounded sections: **current work**, **historical work**, and **artifact references**. Each hit carries kind, ID, matching excerpt, exact lifecycle state, available provenance, and explicit predecessor/successor or evidence/basis IDs. Related IDs do not cause unbounded expansion. Accepted decisions retain `needsReview` and its cited non-current finding IDs. Proposed decisions remain proposals; historical text is never promoted to current fact.

Selection and order are deterministic and shared by SQLite and D1. Freeze normalization, match tiers, field precedence, recency tie-break, and ID tie-break before the first pilot. Recency is a tie-break, not authority. Report `total`, `returned`, `truncated`, and a next cursor per section. Bind each cursor to workspace, normalized query, ordering version, and source position; if the source changes, return a typed restart instead of silently mixing revisions. Empty matches are explicit emptiness, not a fabricated summary or full workspace dump.

Default to at most 20 hits; reject limits above 50. Bound each excerpt and the whole response in bytes. Do not materialize all matches in application memory. Show a query plan or equivalent bounded-work evidence on a representative 10,000-record workspace. Search technology is an implementation choice; a vector store and model call are outside scope.

### 4.2 Portable handoff packet

`CampfireHandoffPacket` is a versioned JSON **projection** from one authorized Recall selection plus bounded current orientation facts. It contains the workspace ID/name and goal, query, generation time, source cursor, issuer and named recipient; selected typed records with IDs, lifecycle, bounded text, provenance, and relationship IDs; bounded open/blocked tasks and proposed/accepted decisions as orientation anchors; and a completeness block for both the anchors and Recall matches, with counts, omissions, `fullHistoryIncluded: false`, and authorized drill-down/catch-up guidance. It states `offlineCopy: true`. It is neither a live current-state guarantee nor permission to execute a decision.

Cap the serialized file at 64 KiB. Bound every text field, including the goal; truncate at record boundaries and report omissions. If even the required header cannot fit, fail without creating a file. Never emit invalid JSON. Artifact entries include ID, type, and title, but no raw URI/path, metadata, preview, or fetched content. Do not copy credentials, invitations, signing secrets, database paths, or private session content from configuration. User-authored workspace text may itself be sensitive: Campfire does **not** promise to sanitize arbitrary authored content. Label the file and CLI receipt as a sensitive offline copy.

The issuer must have `workspace:read`. The named recipient must independently be a current workspace participant with read permission at export time. This checks the intended handoff; it cannot protect a file after copying, and later revocation cannot erase it. No automatic send, share link, import, restore, server-side packet store, or Contribution is created. A recipient's own credential remains necessary for later Campfire reads.

Require an explicit `--out` path. Write a new private file (mode `0600`) atomically; refuse overwrite, symlink targets, and destinations that cannot be secured. Print a token-free receipt, never the packet, on stdout. The JSON contains Campfire types rather than Codex/OpenCode session schemas.

### 4.3 Interfaces and layering

| Surface | Contract |
| --- | --- |
| CLI Recall | `campfire recall <workspaceId> --query <text> [--limit N] [--cursor C] [--output auto\|human\|json]`; `--json` remains an alias and explicit JSON prints one object. |
| MCP Recall | `recall_workspace` takes the same workspace, query, limit, and cursor and returns the same typed result through the authenticated adapter. |
| CLI packet | `campfire handoff-packet <workspaceId> --query <text> --recipient-type human\|agent --recipient <actorId> --out <file>`; authorized service read followed by local file creation. No Worker file-write endpoint or MCP filesystem tool. |

Use one application-service selection rule and the existing authorizer. CLI, MCP, local HTTP, and Worker handlers stay thin. Local clients continue using the single-writer listener where applicable. Viewer and `VIEWER_READ_METHODS` are unchanged.

## 5. Pilot and evidence plan

Freeze query semantics, scenarios, ground truth, prompts, applicability, rubric, harness/model settings, run budgets, and arm order **before** scored runs. Keep answer keys and earlier outputs outside agent context. Use at least three matched workspace scenarios:

1. **Useful prior decision:** earlier accepted rationale should change the next action on a related task.
2. **Stale lead:** a superseded/withdrawn finding or `needsReview` decision must not cause repetition of a rejected approach.
3. **Insufficient history:** matching records do not answer the new question; the correct response preserves uncertainty.

For each scenario, compare the v1.15 path (orientation plus paging/drill-down) with the same state and prompt using Recall. Each arm starts with a fresh session and matched harness/model. A fresh recipient in a different supported harness gets only the treatment packet and a neutral continuation task: no exporter transcript, live workspace credential, scenario file, answer key, or prepared human summary. If live drill-down is needed, test that separately with the recipient's own credential. Record calls, time, fetched IDs, packet size/omissions, verbatim answers, contamination, and replacements.

Score against the frozen key, blind to arm where practical: **R1** relevant prior object cited by ID; **R2** lifecycle and provenance correct; **R3** appropriate changed next action or preserved uncertainty; **R4** no stale finding, proposal, or `needsReview` decision promoted into unquestioned intent. Score packet recipients on goal, prior evidence, decision status, next action, and uncertainty. Resolve disagreements against the key.

Before claiming Gate E, observe at least one ordinary work case where a participant voluntarily reuses prior completed work and the next action or avoided investigation differs materially from the supported counterfactual. Record source IDs and the basis for that comparison. A synthetic pilot alone cannot close Gate E, B, or C. Collect the open v1.12 Viewer observations in parallel and do not credit them to this sprint.

## 6. Verification

- **Authorization:** issuer and recipient checks precede search/export. Wrong-workspace IDs, forged cursors, revoked/non-participant actors, and cross-workspace relationship IDs disclose no state. Denial creates no file. A packet cannot be used as a token.
- **Lifecycle:** current/history separation, correction chains, decision replacement/retirement, citations, `needsReview`, proposed state, actor type, and agent-session provenance remain accurate. No operative-decision inference.
- **Completeness:** empty, exact-limit, over-limit, and large workspaces report true counts/omissions. JSON is valid at the byte cap. Concurrent changes yield one consistent position or a typed restart; pages do not mix revisions.
- **Parity and bounds:** CLI JSON and MCP data agree; SQLite and D1 select/order the same fixture records. Large searches do not load all matches into application memory. Existing orientation, catch-up, full inspection, CLI output, and Viewer contracts pass.
- **Offline boundary:** private atomic file, no overwrite, no credential or artifact URI/path field, no server row, Contribution, upload, artifact fetch, webhook, or content telemetry. Logs may record actor, workspace, operation, and allow/deny, but never query text, excerpts, packet bytes, or output paths. An offline agent can use the bounded packet without the originating transcript.
- **Release checks:** typecheck, full tests, build, packaging, deployment dry run, public export audit, and install-channel checks follow the normal release process. Publication and deployment require a separate promotion decision.

## 7. Non-goals

No cross-workspace or organization-wide recall; vector database, embeddings, model-generated answer, automatic summary, or transcript import; full backup/restore, packet import, sync, or share link; artifact preview or external fetch; Viewer change, highlight, second playbook, ACP gateway, capability registry, permission engine, coordinator, agent scheduling, or external action. Installation counts and synthetic fixtures do not establish Gate B/C/E.

## 8. GO / CONDITIONAL GO / NO-GO

**GO:** §6 passes; all three treatment runs identify relevant history or its insufficiency without a stale/currentness error; all three offline recipients answer the packet rubric without a transcript; at least two matched treatments make a better justified next-action choice than controls and the third is no worse; and an ordinary-work observation supports material historical reuse. Record exactly what it establishes. Gate B/C remain separate.

**CONDITIONAL GO as an engineering candidate:** deterministic checks and synthetic pilot pass, but the ordinary-work observation is unavailable or controls are already at the rubric ceiling. Name the unproven benefit and leave Gate E open. This is not automatic release authorization.

**NO-GO / REFRAME:** unauthorized state, a credential, or an artifact URI/path field enters a packet; stale work appears current; cursors mix source positions; denial creates a file or export overwrites one; packet becomes canonical/importable authority; or the measured benefit depends on a private transcript, answer-key leak, model-generated facts, or hidden cross-workspace search.

## 9. Execution order

1. Freeze scenarios, ground truth, prompts, rubric, and dated harness/model lock; demonstrate isolation before scored runs.
2. Implement one authorized, bounded selection service and matching SQLite/D1 reads; add CLI/MCP Recall parity and denial checks.
3. Implement packet projection and secure local file writer from that selection; validate recipient membership and offline-copy disclosure.
4. Run deterministic, large-workspace, concurrent-write, and security checks, then the matched synthetic and cross-harness packet pilot without editing frozen keys.
5. Record evidence and an honest GO, CONDITIONAL GO, or NO-GO verdict. Record ordinary-work reuse separately if available. Consider release promotion only after the result makes uncertainty explicit.

This contract authorizes a scoped v1.16 implementation experiment. It does not alter the v1.15 release, close earlier evidence gates, or authorize publication or deployment.
