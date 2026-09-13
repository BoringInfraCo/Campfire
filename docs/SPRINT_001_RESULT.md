# Campfire — Sprint 001 Result

**Status:** Complete  
**Sprint:** 001 — Cross-Harness Team Handoff  
**Date:** September 11, 2026  
**Company:** Boring Infra Co.  
**Recommendation:** **GO**

---

## 1. Summary

Sprint 001's thesis was:

> Two humans using two different agent harnesses can participate in the same
> bounded workspace and continue the same work through structured,
> provenance-backed shared state — without sharing the originating transcript.

The acceptance run passes. Agent B, in a separate process with a different
captured harness identity, discovered the billing workspace through Campfire,
recovered the goal, findings, accepted decision, outstanding task, artifact, and
provenance, continued the outstanding task, and wrote new state back. Agent A's
original contributions and provenance were preserved, and Agent B received no
part of Agent A's private conversation.

The machine-readable evidence is produced by `npm run acceptance` to
`evidence/sprint-001-acceptance.json`. All 19 acceptance checks pass.

---

## 2. Environment

| Component | Version |
|---|---|
| Node.js | v22.23.0 |
| Platform | darwin / arm64 |
| TypeScript | 5.9.3 |
| `@modelcontextprotocol/sdk` | 1.30.0 |
| better-sqlite3 | 13.0.7 |
| Vitest | 5.0.0 |
| Storage | SQLite (local file) |
| Transport | MCP over stdio |

### Harness substitution

The reference scenario prefers Codex (Harness A) and OpenCode/Claude Code
(Harness B). The vendor binaries were not available in the execution
environment, so the acceptance run uses **two genuinely separate MCP client
processes** that exercise the real stdio Campfire MCP server:

- **Harness A** — an independent process labelled `codex`, acting as
  `agt_codex_sergio` on behalf of `hum_sergio`.
- **Harness B** — a second, independent process labelled `opencode`, acting as
  `agt_opencode_alice` on behalf of `hum_alice`.

Harness A's process is fully terminated before Harness B is spawned. They share
only the Campfire SQLite database. This is a harness *client* substitution, not
a handoff substitution: the transport, server, domain, authorization, and
persistence are all real. Configuring real harnesses against the same server is
documented in `README.md`.

---

## 3. Acceptance Scenario

Canonical fixture: **Billing deploy investigation**.

```text
Human A (Sergio) + Agent A (Codex)
        |
        | structured contributions
        v
   Campfire workspace: billing-deploy-failure (ws_billing_deploy)
        |
        | authorized structured retrieval
        v
Human B (Alice) + Agent B (OpenCode)
```

`seedFixture` creates the organization, team, both humans, both agents, the
billing workspace with four participants, and an unrelated
`auth-token-rotation` workspace (`ws_auth_migration`) whose only participant is
Sergio and which contains the sentinel
`UNRELATED_FINDING_SENTINEL_auth_token_rotation`.

---

## 4. What Agent A Contributed

Harness A registered an agent session and recorded (each with `createdBy`,
`agentSessionId`, and timestamp):

| Object | Content |
|---|---|
| Session | `codex` session for `agt_codex_sergio` / `hum_sergio` |
| Finding | "Migration 284 holds a database lock longer than the deployment timeout." (confidence 0.9) |
| Finding | "The billing deploy times out after 120 seconds." |
| Decision | "Do not increase the global deployment timeout; split the migration instead." — then **accepted**, `approvedBy = agt_codex_sergio` |
| Task | "Prepare the migration split." (`open`) |
| Artifact | `file` → `fixtures/billing/migration-284.sql` |

Harness A also holds a private constant,
`PRIVATE_TRANSCRIPT_SENTINEL_A_never_shared`, which is never sent to Campfire.
It exists solely to prove transcript isolation.

---

## 5. What Agent B Recovered

Harness B, in a clean process with no access to A's session, called
`campfire.list_workspaces` and `campfire.get_workspace_context` and correctly
identified:

- **Goal:** "Determine why billing-service deploys fail."
- **Core finding:** migration 284 holds a lock longer than the deploy timeout.
- **Accepted decision:** do not raise the global timeout; split the migration.
- **Outstanding task:** "Prepare the migration split." (`open`)
- **Artifact:** `fixtures/billing/migration-284.sql`
- **Provenance:** the finding and decision were produced by agent
  `agt_codex_sergio` (harness `codex`) on behalf of `hum_sergio`, in session
  `ses_...`.

Harness B derived the outstanding task from Campfire's `openTasks`, not from a
hard-coded id or a handoff summary.

---

## 6. What Agent B Continued

Harness B left the workspace better than it found it:

- advanced "Prepare the migration split." from `open` → `in_progress`;
- added a new finding: "Split migration 284 into two phases: schema change
  first, backfill second.";
- attached a new artifact: `document` → `fixtures/billing/migration-284-split-plan.md`;
- produced three new contributions with distinct provenance
  (`agt_opencode_alice`, harness `opencode`, its own session), all recorded after
  Agent A's contributions.

---

## 7. Transcript Isolation Evidence

Campfire stores no conversation transcript. The database schema has no
transcript/session-export table or column.

The acceptance run records:

```json
{
  "sentinel": "PRIVATE_TRANSCRIPT_SENTINEL_A_never_shared",
  "presentInHarnessBRetrieval": false,
  "checkedSources": [
    "harnessB.workspaceIds",
    "harnessB.context",
    "harnessB.workspace",
    "harnessB.activity",
    "harnessB.activityAfterWrites"
  ]
}
```

Harness B received only its own instructions, fixture/repository access, and
authorized Campfire state. No transcript, session export, or manually prepared
handoff summary crossed the boundary.

---

## 8. Workspace Boundary Evidence

```json
{
  "visibleWorkspaceIds": ["ws_billing_deploy"],
  "unrelatedWorkspaceId": "ws_auth_migration",
  "unrelatedCallDenied": true
}
```

Agent B is not a participant of the unrelated workspace, so it neither discovers
it nor retrieves its content. The unrelated sentinel never appeared in the
billing projection. The invariant holds: **shared does not mean global**.

---

## 9. Test Results

`npx vitest run` — **6 files, 63 tests, all passing**:

| Suite | Tests | Covers |
|---|---|---|
| `tests/unit/persistence.test.ts` | 15 | store round-trips, JSON columns, workspace-scoped lists, actor id+type filtering, partial updates, persistence across restart, FK integrity, append-only contributions |
| `tests/unit/service.test.ts` | 26 | authorization, workspace isolation, no inherited human→agent permission, viewer denial, provenance/session, lifecycle transitions, cross-workspace references, projections |
| `tests/unit/seed.test.ts` | 6 | deterministic, idempotent fixtures and workspace membership |
| `tests/integration/mcp.test.ts` | 6 | full dotted MCP surface, cross-harness continuation, typed errors, privacy sentinel |
| `tests/integration/isolation.test.ts` | 4 | workspace boundary, append-only ordering, agent permission separation |
| `tests/acceptance/handoff.test.ts` | 6 | end-to-end two-process acceptance via real stdio MCP |

Additional checks: `npx tsc --noEmit` is clean.

### Acceptance checks (all pass)

```text
comprehension.workspace_goal
comprehension.core_finding
comprehension.accepted_decision
comprehension.outstanding_task
comprehension.referenced_artifact
comprehension.provenance_producer
continuation.task_advanced
continuation.new_finding_recorded
continuation.new_artifact_recorded
continuation.contribution_recorded
preservation.original_finding_intact
preservation.original_decision_intact
preservation.original_artifact_intact
preservation.provenance_distinct
preservation.activity_append_only_ordered
isolation.workspace_list_scoped
isolation.unrelated_workspace_denied
isolation.no_unrelated_sentinel
transcript.sentinel_absent_from_harness_b
```

### Reproduce

```bash
npm install
npm run typecheck
npm test
npm run acceptance        # writes evidence/sprint-001-acceptance.json
```

---

## 10. Evaluation Against the Rubric

| Requirement | Result |
|---|---|
| Does not require raw transcript access | Pass |
| Recovers all required work-state facts | Pass |
| Preserves provenance across the handoff | Pass |
| Holds workspace isolation | Pass |
| Writes back without corrupting history | Pass |
| Article references survive the handoff | Pass |
| Independent of any single harness | Pass (harness-independent domain + MCP) |

No condition is left unresolved, so the recommendation is **GO**, not
CONDITIONAL GO.

---

## 11. Limitations

1. Harnesses are independent MCP client processes labelled `codex`/`opencode`,
   not the vendor binaries (see §2). A follow-up should run at least one real
   vendor harness.
2. Agent B's continuation is deterministic fixture logic, not an LLM reasoning
   over retrieved state. Sprint 001 validates the *state model*, not model
   reasoning.
3. Artifacts are references only. Campfire does not read or authorize file
   contents in Sprint 001.
4. Authorization is intentionally simple (workspace membership + role). It is a
   real boundary, not an enterprise policy engine.
5. Workspace existence is revealed to a participant/non-participant as
   `WorkspaceNotFound`; no workspace *content* is returned before authorization.

---

## 12. Sprint 002 Focus (from observed friction)

1. **Real harness acceptance.** Run the same flow with an actual Codex and an
   actual OpenCode/Claude Code client against the stdio server.
2. **Context ergonomics.** `get_workspace_context` is complete but verbose.
   Determine what an incoming agent reads first and whether tasks/findings need
   status/freshness signals.
3. **Finding status.** Sprint 001 findings are append-only assertions. A
   superseded/stale lifecycle is the most likely next domain refinement.
4. **Objective relationships.** B's split-plan artifact clearly *resolves* A's
   task and is *produced by* a finding. A minimal explicit relationship
   (`resolves`, `supports`, `produces`) may be justified by this trace.
5. **Session binding in real clients.** Confirm how each harness supplies its
   actor/session identity so provenance stays correct without per-call actor
   parameters.

Do not widen sprint scope until these are validated against real harness use.
