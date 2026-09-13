# Campfire — Sprint 002 Result

**Status:** Complete  
**Sprint:** 002 — Real Team Handoff  
**Date:** September 12, 2026  
**Company:** Boring Infra Co.  
**Depends on:** Sprint 001 — Cross-Harness Team Handoff (**GO**)  
**Recommendation:** **GO**

---

## 1. Result

Sprint 002 asked:

> **Can a real Agent B, running in a different harness from Agent A, enter a
> Campfire workspace, understand what the team already figured out, determine
> the correct next step, continue the work, and contribute its own state without
> access to Agent A's transcript?**

Yes. A real **Codex** process acted as Agent A and a real **OpenCode** process
acted as Agent B, sharing only one Campfire SQLite database. Agent A
investigated the billing fixtures and recorded findings, an accepted decision, a
task, and an artifact. Agent B then discovered the workspace from Campfire,
recovered the goal, findings, accepted decision, outstanding task, artifact, and
provenance, reasoned about the correct remediation, completed the task, and wrote
new findings, artifacts, and a follow-up decision and task back.

No transcript was shared. No human handoff occurred. Workspace isolation held.

**All 31 Sprint 002 acceptance checks pass.** Evidence:
`evidence/sprint-002/`.

Regression: Sprint 001 remains green (typecheck clean; full deterministic suite
passing).

---

## 2. Environment

| Item | Value |
|---|---|
| OS / runtime | macOS (darwin), arm64, Node.js v22.23.0 |
| Campfire revision | `d7e160d` |
| Storage | SQLite (local file) |
| MCP transport | stdio |
| Harness A | `codex` — codex-cli 0.149.1 (ChatGPT-authenticated) |
| Harness B | `opencode` — OpenCode 1.18.30 |
| Harness A model | Codex provider default (not reported by CLI) |
| Harness B model | OpenCode configured default (not reported in stream) |
| Acceptance duration | 240,499 ms |

### Harness substitution (material to the recommendation)

The sprint prefers **Real Codex → Real OpenCode / Claude Code**. The plan was
Codex + Claude Code, but Claude Code's OAuth access token had expired and
required interactive re-authentication that could not be performed
non-interactively. To keep the proof honest and unblocked, **OpenCode was used
as the second real harness**. This still satisfies the two-distinct-real-harness
requirement:

- Agent A is a genuine Codex process.
- Agent B is a genuine OpenCode process.

They are different vendors, different processes, and different native session
IDs. The Claude Code substitution is recorded as a limitation, not hidden.

### Identity / session binding

Identity came from the **trusted process boundary**, never from model-controlled
tool arguments:

- Each harness runs its own MCP server with
  `CAMPFIRE_ACTOR_ID`, `CAMPFIRE_ACTOR_TYPE`, `CAMPFIRE_HARNESS`, and a
  pre-created `CAMPFIRE_SESSION_ID` in its environment.
- No Campfire tool accepts an actor id. `campfire.add_finding(...)` is enough;
  the server attributes it.
- Agent sessions (`ses_harness_a_codex`, `ses_harness_b_opencode`) were created
  before each harness started, so every contribution carries human, agent,
  harness, session, and timestamp provenance.

### Codex MCP configuration (no global config mutation)

Codex was configured entirely through `-c` overrides:

```text
mcp_servers.campfire.command = "<repo>/node_modules/.bin/tsx"
mcp_servers.campfire.args    = ["<repo>/src/mcp/stdio.ts"]
mcp_servers.campfire.env     = { CAMPFIRE_DB, CAMPFIRE_ACTOR_ID, ... }
mcp_servers.campfire.default_tools_approval_mode = "approve"
```

`approval_policy="never"` alone caused every MCP call to be rejected with
*"MCP tool call requires approval"*. `default_tools_approval_mode = "approve"`
made MCP tools usable under the non-interactive run while the filesystem sandbox
stayed `read-only`. This is a concrete, reusable finding for any headless Codex +
MCP integration.

---

## 3. Exact Scenario

**Human A → Agent A (Codex):**

> You are Agent A ("Codex") working for Sergio in the Campfire workspace
> "billing-deploy-failure".
>
> Goal: Determine why billing-service deploys fail and prepare the correct
> remediation.
>
> A local copy of the billing service fixtures is in `./fixtures`. Investigate
> them with your normal read and search tools before drawing any conclusions.
>
> Record the durable team state you discover using the Campfire MCP tools
> (`add_finding`, `add_decision` then `accept_decision`, `create_task`,
> `add_artifact`). Base every finding and the decision on what the fixture
> evidence actually shows, not on guesses.
>
> Private session note for your own reasoning — do not treat as a finding:
> session token `PRIVATE_TRANSCRIPT_SENTINEL_A_never_shared`.
>
> When you have recorded the state, stop.

**Human B → Agent B (OpenCode):**

> You are Agent B (OpenCode) working for Alice. Continue the billing deploy
> investigation using the Campfire workspace. Use the Campfire MCP tools to
> discover the workspace, understand the current state, and continue the
> outstanding work. A local copy of the billing service fixtures is in
> `./fixtures`. Record meaningful new state back into Campfire before you stop.

The Agent B instruction names Campfire and the fixture directory but reveals
none of Agent A's findings, the decision, the task, the artifact, or the
solution.

Agent A's process was fully terminated before Agent B started.

---

## 4. What Agent A Discovered (Campfire state before B)

Agent A read the fixtures and recorded:

**Findings**

1. "Migration 284 exceeds the 120-second deploy limit during the invoice backfill
   and is rolled back."
2. "Migration 284 puts the schema change and large data work in one transaction,
   holding the invoices lock until commit."
3. "Raising the deploy timeout is an unsafe recurrence, not a remediation."

**Decision (accepted)** — "Keep the 120-second deploy timeout and replace
migration 284 with a staged rollout that separates the schema change from
resumable, bounded backfill work."

**Task (open)** — "Implement and validate staged replacement for billing
migration 284."

**Artifact (file)** — `fixtures/billing/migration-284.sql`.

Every object carried `createdBy = agt_codex_sergio`, `agentSessionId =
ses_harness_a_codex`, harness `codex`, and a timestamp.

This is the same shape as the Sprint 001 fixture, but produced by a real agent
reasoning over the fixtures rather than by deterministic fixture logic.

---

## 5. What Agent B Received

Agent B called `campfire.whoami`, `campfire.list_workspaces`,
`campfire.get_workspace`, and `campfire.get_workspace_context`.

- `list_workspaces` returned **only** `ws_billing_deploy`.
- `get_workspace_context` returned the goal ("Determine why billing-service
  deploys fail and prepare the correct remediation."), the goal, all findings,
  the accepted decision, the open task, the artifact, participants, and
  provenance.
- No transcript, handoff summary, or answer was provided by the human.

---

## 6. What Agent B Understood

Without a handoff, Agent B correctly identified:

| Required fact | Recovered |
|---|---|
| Workspace goal | Yes |
| Core finding (migration 284 lock / 120s timeout) | Yes |
| Accepted decision (keep timeout; stage the migration) | Yes |
| Outstanding task | Yes |
| Relevant artifact | Yes |
| Provenance (produced by Codex for Sergio) | Yes |

---

## 7. What Agent B Decided

Agent B selected the correct next step through its own reasoning:

- keep the 120-second timeout;
- replace the combined migration with an expand/contract **staged** rollout;
- make the backfill resumable and bounded rather than part of deploy;
- add a non-transactional `CREATE INDEX CONCURRENTLY` finalize step;
- gate application reads during the expand/backfill window.

It explicitly did **not** propose raising the timeout.

---

## 8. What Agent B Did and Contributed

**Continued work (files it authored in its own harness workspace):**

- `db/migrations/284_expand_add_billing_status.sql` — schema-only `ALTER`.
- `jobs/backfill_billing_status.sql` — resumable bounded batches + per-account
  balance recompute.
- `db/migrations/285_finalize_billing_status_index.sql` — guard +
  `CREATE INDEX CONCURRENTLY` (non-transactional).
- `scripts/validate_staged_rollout.mjs` — 9 local checks (bounded, resumable,
  idempotent, 120s-budget fit).

**New Campfire state:**

- 4 findings capturing the PG≥11 precondition, the non-transactional finalize
  requirement, the read-gating requirement, and an index/size precondition.
- 4 artifacts referencing the expand migration, finalize migration, backfill job,
  and validation report.
- 1 new accepted decision extending the accepted plan (expand/contract ordering +
  read-gating).
- Completed Agent A's task and opened a follow-up task for a staging Postgres
  dry run, assigned to Alice.

All attributed to `agt_opencode_alice` / harness `opencode` /
`ses_harness_b_opencode`, distinct from Agent A.

---

## 9. Transcript Isolation

The private sentinel `PRIVATE_TRANSCRIPT_SENTINEL_A_never_shared` was placed only
in Agent A's private instruction. It did not appear in:

- Agent B's final message,
- any Agent B Campfire tool output,
- Agent B's raw process stdout,
- Campfire state after the handoff.

```json
{
  "sentinel": "PRIVATE_TRANSCRIPT_SENTINEL_A_never_shared",
  "presentInHarnessBRetrieval": false,
  "presentInCampfire": false
}
```

Agent B learned what Agent A contributed to the team without learning Agent A's
private conversation.

---

## 10. Workspace Isolation

```json
{
  "visibleWorkspaceIds": ["ws_billing_deploy"],
  "unrelatedWorkspaceId": "ws_auth_migration",
  "unrelatedReadDenied": true,
  "unrelatedSentinelAbsent": true
}
```

Agent B is not a participant of the unrelated `auth-token-rotation` workspace,
so it could neither discover it nor read it, and the unrelated sentinel never
appeared in Agent B's context. **Shared does not mean global.**

---

## 11. Human Intervention

**None** after Agent B's initial instruction. No manual handoff, no answer
leakage, no clarification required. Agent B oriented entirely from Campfire.

```text
intervention.no_manual_handoff   PASS
intervention.no_answer_leakage   PASS
```

---

## 12. Context Ergonomics (observed)

| Metric | Agent B result |
|---|---|
| First Campfire call | `campfire.whoami` |
| Orientation (read) calls | 4 |
| Total Campfire calls | 16 (5 reads, 11 writes) |
| Redundant reads | 1 (`get_workspace_context` fetched twice) |
| Missing-context signal | Fetched two full projections (`get_workspace` and `get_workspace_context`) |
| Context noise | `get_workspace_context` returned ~26.9 KB; both projections returned 3 overlapping finding IDs |

Observations:

- The agent oriented correctly and cheaply, but fetched **two overlapping full
  projections**, suggesting `get_workspace` and `get_workspace_context` overlap
  enough to be confusing.
- A ~27 KB context response for a small workspace is verbose.
- OpenCode exposed the tools as `campfire_campfire_*` (server name + tool
  prefix). It worked, but the doubled namespace is cosmetic friction worth
  removing later.

These are refinements, not thesis failures.

---

## 13. Domain Observations

- **Finding lifecycle:** Agent B added a "residual gap" finding and a
  precondition finding. It did not need to mark prior findings stale or
  superseded. No lifecycle change is justified yet.
- **Object relationships:** Agent B clearly connected artifacts → task →
  findings → follow-up task, but represented the relationships in prose and task
  state. No explicit relationship primitive is justified by this trace.
- **Task semantics:** Task completion plus a new assigned follow-up worked well;
  no change needed.
- **Decision semantics:** In one valid run Agent A created its decision but did
  not accept it, while `get_workspace_context` returns only accepted decisions.
  This is a real, narrow friction: an incoming agent that fetches only the
  context projection could miss a proposed decision. Worth a small
  Sprint 003 decision (surface proposed decisions, or make acceptance explicit).
- **Artifact semantics:** Agents used harness-absolute paths for artifact URIs
  rather than workspace-relative paths. References still worked, but URI
  normalization is a candidate refinement.
- **MCP surface:** No new tools were needed. All continuation used the existing
  Sprint 001 surface.

---

## 14. Evaluation Method and Corrections

The captured run is real, unscripted agent behavior. Two corrections were made
to the **evaluation heuristics**, not to the run or the agents:

1. The initial acceptance run exposed the unrelated-workspace fixture and a
   pre-written split plan to the agents because the harness work directories
   copied the whole `fixtures/` tree. That was a harness setup bug; harnesses now
   receive only `fixtures/billing`. The current run uses the corrected setup.
2. `reasoning.correct_next_step`, `comprehension.accepted_decision`, and
   `reasoning.respects_prior_decision` originally matched the literal string
   "split". Real agents described the same decision as "staged", "separated",
   "schema-only", and "expand/contract". The checks were broadened to match the
   concept, consistent with Sprint 002 section 13 ("semantic correctness matters
   more than exact strings"). The captured run was then re-evaluated
   deterministically; the run itself was not re-scripted.

All other checks are computed directly from captured process output and Campfire
state.

---

## 15. Tests

```bash
npm run typecheck     # clean
npm test              # 10 files, 95 tests, all passing (Sprint 001 + new logic)
npm run acceptance    # Sprint 001 deterministic acceptance: GO, 19/19 checks
npm run acceptance:002 # real-harness acceptance: GO, 31/31 checks
```

Sprint 002 added deterministic tests for the pieces it introduced: harness event
parsers (OpenCode + Codex), ergonomics analysis, acceptance checks, evidence
writing, fixture/prompt isolation, and an orchestrator integration test with
stubbed harness runners.

---

## 16. Limitations

1. Harness B is real **OpenCode**, not Claude Code (Claude's OAuth token had
   expired). The final GO uses two distinct real harnesses (Codex + OpenCode);
   a Claude Code run remains future validation.
2. Agent B's task instruction is minimal but does name Campfire and the fixture
   directory; it reveals none of Agent A's state.
3. Artifacts are references only. Campfire does not read or authorize referenced
   file contents.
4. Authorization remains simple (workspace membership + role); it is a real
   boundary, not an enterprise policy engine.
5. Findings and decisions have no lifecycle states beyond accepted/superseded;
   this was sufficient for the observed handoff.

---

## 17. Recommendation

```text
GO
```

Why:

1. Two distinct real agent harnesses completed the handoff (Codex → OpenCode).
2. Agent B received no private Agent A transcript.
3. Agent B correctly understood prior team state.
4. Agent B determined the correct continuation through its own reasoning.
5. Agent B performed meaningful work (staged expand/contract rollout, backfill
   job, finalize step, validation) rather than echoing context.
6. Agent B wrote useful new state back to Campfire.
7. Provenance remained correct and distinct.
8. Workspace authorization and isolation remained intact.
9. No manual human handoff was required.
10. The only issues found are ergonomic refinements (overlapping context
    projections, verbosity, tool-name double-prefix, artifact URI paths), not
    thesis failures.

> Campfire's structured work state works as a real cross-harness collaboration
> primitive, not merely as a deterministic state-transfer mechanism.

---

## 18. Recommended Sprint 003 Focus

From the observed trace, not the roadmap:

1. **Single orientation projection.** Collapse `get_workspace` /
   `get_workspace_context` into one compact, ordered entry point
   (goal → accepted decisions → open tasks → active findings → artifacts →
   recent provenance) so an incoming agent makes one call, not two overlapping
   ones.
2. **Context size.** Cap or summarize activity/provenance in the orientation
   projection; 27 KB for a small workspace will not scale to active teams.
3. **Decision visibility.** Surface proposed decisions (or require explicit
   acceptance) so an incoming agent cannot miss an unaccepted team direction.
4. **Tool namespacing.** Drop the redundant `campfire.` tool prefix so harnesses
   show `campfire_list_workspaces`, not `campfire_campfire_list_workspaces`.
5. **Artifact URIs.** Normalize artifact references to workspace-relative paths.
6. **Claude Code validation.** Complete the originally planned Codex → Claude
   Code handoff once authentication is available.

Do not begin these until the trace above is accepted as the basis for Sprint 003.

---

## 19. North Star

Sprint 001 proved: **Campfire can carry the state.**

Sprint 002 proved: **A real agent can use that state naturally.**

No transcript forwarding. No manual summary. No hidden answer. No shared
session. Just durable team work surviving across humans, agents, and harnesses.

> **Make agents work like they are part of the team.**
