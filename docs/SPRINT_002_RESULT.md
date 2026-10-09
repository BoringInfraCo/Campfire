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

**Evidence note (October 6, 2026):** `evidence/sprint-002/` now contains
the September 23 rerun, not the artifacts supporting the September 12 GO
verdict above. See section 20 for the separate run and its CONDITIONAL GO
result.

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

---

## 20. Addendum — A Second Acceptance Run (September 23, 2026)

**Addendum written:** October 6, 2026.

This section was appended after sections 1–19 were written on September 12, 2026.
The September 12 **verdict and every finding recorded above stand exactly as
written**: nothing has been softened, deleted, or restated, and the header block
still describes that run exactly as it did. Sections 1–19 remain the record of
that run.

One editorial addition has since been made above them, and it is disclosed here
rather than left for a reader to find: a dated **Evidence note** was inserted
into section 1, directly beneath the verdict, warning that `evidence/sprint-002/`
now holds the September 23 run and pointing forward here. It is additive, it
touches no verdict, no finding, no measurement, and no claim about what was
observed on September 12, and section 1 is the only section edited since.

This addendum is here because a second, later acceptance run wrote fresh
evidence into `evidence/sprint-002/`, and a reader who opens that directory will
reasonably assume it backs the verdict in section 1. It does not.

### 20.1 Two accounts, two different runs

This document and `evidence/sprint-002/acceptance.json` are both about Sprint
002's real Codex → real OpenCode handoff. They are not two descriptions of one
execution. The environment table in section 2 is itself the proof: a different
Node runtime, different harness builds on both sides, and a duration 5.5× longer
cannot all come from the same process run.

| Identifier | This document (sections 1–19) | `evidence/sprint-002/acceptance.json` |
|---|---|---|
| Run | September 12, 2026 | `2026-09-23T14:06:51.014Z` → `2026-09-23T14:28:55.505Z` |
| Duration | 240,499 ms (~4 min) | 1,324,491 ms (~22 min) |
| Node.js | v22.23.0 | v22.23.2 |
| Campfire revision | `d7e160d` | not recorded in the later evidence |
| Harness A | `codex` — codex-cli 0.149.1 | `codex` — codex-cli 0.150.1 |
| Harness A outcome | completed | exit `0`, 9 Campfire calls (2 reads / 7 writes) |
| Harness B | `opencode` — OpenCode 1.18.30 | `opencode` — OpenCode 1.18.32 |
| Harness B outcome | completed the work | exit **`124`**, `spawnSync opencode ETIMEDOUT`, 7 calls (2 reads / 5 writes) |
| Checks | 31 / 31 pass | 30 / 31 pass (`environment.harness_b_real` FAIL) |
| Verdict | **GO** | **CONDITIONAL GO** |
| Agent B ergonomics | 16 calls, 5 reads / 11 writes (section 12) | 7 calls, 2 reads / 5 writes |

On the two `16`s: the `16` in section 12 is Agent B's own total for the
September 12 run. The later run's `16` is a different measurement — 9 (Harness
A) + 7 (Harness B), split 4 reads / 12 writes. The numbers agree and mean
different things; they should not be reconciled with each other.

### 20.2 The evidence directory now holds the later run

`evidence/sprint-002/` is gitignored and was overwritten in place. Everything on
disk today — `acceptance.json`, `notes.md`, `environment.md`, `harness-a.md`,
`harness-b.md`, `campfire-state-before-b.json`,
`campfire-state-after-b.json` — is **September 23** evidence, and `notes.md`
carries its **CONDITIONAL GO**. The `evidence/sprint-002/` pointer at the end of
section 1 therefore resolves to the later run's artifacts, not the ones the
section 1 verdict was written from. The September 12 artifacts are no longer in
the tree.

This is a provenance gap in the evidence directory, not a defect in the
September 12 verdict. The verdict stands on what was observed on September 12;
it simply can no longer be re-read from the path it cites. Anyone rebuilding
Sprint 002 evidence from that directory today will rebuild the wrong run.

### 20.3 What the exit-124 termination means

Harness B in the September 23 run started at `14:08:55.514Z` and was killed at
`14:28:55.491Z` — 1,199,977 ms, essentially exactly the orchestrator's
twenty-minute wall-clock budget for the second harness. Exit `124` with
`spawnSync opencode ETIMEDOUT` is that timeout, not a crash and not an agent
failure.

The termination did not undo the run's writes. All seven Campfire calls
returned before the kill, and the last of them — the second `add_finding` —
landed at `14:28:53.908Z`, roughly 1.6 seconds before the process was killed:

| Harness B call | Result recorded before termination |
|---|---|
| `campfire.list_workspaces` | returned `ws_billing_deploy` only |
| `campfire.get_workspace_context` | read goal, findings, accepted decision, open task, artifact, provenance |
| `campfire.register_agent_session` | created `ses_46b3c75800f74f84` |
| `campfire.update_task` | `task_2d89c8a3a8f947f1` → `completed` at `14:28:44.989Z` |
| `campfire.add_artifact` | `./rollout` package recorded at `14:28:47.579Z` |
| `campfire.add_finding` (×2) | recorded at `14:28:50.449Z` and `14:28:53.908Z` |

So the September 23 run is honest evidence that state written through Campfire
survives the death of the process that wrote it — a result worth having in its
own right. It is **not** evidence of a cleanly completed end-to-end handoff.
Harness B never produced a summary; its captured `finalMessage` is a truncated
mid-step fragment (*"The `JOIN` lacks an `ON` clause — switching to `CROSS
JOIN`:"*), and the process was terminated rather than finishing. The single
failing check, `environment.harness_b_real`, is precisely that question — did
Harness B run and exit cleanly — and the honest answer is no. Hence **CONDITIONAL
GO**.

### 20.4 The isolation findings are not in question

Nothing in this addendum weakens, qualifies, or casts doubt on the isolation
findings from either run.

- **September 12 (sections 9 and 10):** the sentinel
  `PRIVATE_TRANSCRIPT_SENTINEL_A_never_shared` was absent from Agent B's final
  message, its Campfire tool output, its raw stdout, and Campfire state;
  `ws_auth_migration` was neither visible nor readable.
- **September 23:** all four `isolation.*` checks pass —
  `private_transcript_absent`, `unrelated_workspace_hidden`,
  `unrelated_workspace_denied`, `unrelated_sentinel_absent`.

The September 23 checks passing on a run whose harness was killed is not a
contradiction and not a caveat. A check evaluates the durable record a run left
behind; exit `124` is a fact about process lifetime, not about what the process
managed to write before it ended. The sentinel was absent from every checked
surface in both runs, and in the later run the unrelated workspace stayed
invisible to a process that was actively working right up to the kill. Being
terminated did not widen Agent B's visibility by one object.

One honest nuance, recorded rather than glossed over: in the September 23 run,
`transcriptIsolation.checkedSources` includes `harnessB.finalMessage`, which was
a truncated fragment at capture time. The other three surfaces
(`harnessB.mcpCalls.output`, `harnessB.rawStdoutPath`, `stateAfterB.view`) were
complete, and the Campfire-state surface is the decisive one. The September 12
run checked a finished final message.

### 20.5 What each run is good evidence for

| Use this run for | Do not use it for |
|---|---|
| **September 12, 2026** — a completed cross-harness handoff: Agent B oriented from Campfire alone, recovered goal / finding / decision / task / artifact / provenance, reasoned to the correct staged rollout, authored work in its own workspace, and wrote new state back. This is the basis for the **GO** in section 17. | A statement about the current contents of `evidence/sprint-002/`. |
| **September 23, 2026** — a second real harness under real wall-clock pressure: it was killed at twenty minutes, and the correctly attributed, isolated records it had already written survived the kill. This is the basis for **CONDITIONAL GO** in that run, and for the observation that Campfire state outlives the writing process. | Evidence of a cleanly completed end-to-end handoff. |

Read together the two runs support something the September 12 run alone could
not: durable team state survives both the harness boundary and the writer's
process lifetime. That is the same thesis as the north star in section 19, with
a second failure mode now covered.

### 20.6 Other material divergences

A reader comparing sections 5, 8, 12, 14, 16, and 18 against
`evidence/sprint-002/acceptance.json` will hit these. Each is a real difference
between two runs, not an error in either document.

1. **Check count.** Section 1's "All 31 Sprint 002 acceptance checks pass"
   describes the September 12 run. The September 23 run is 30/31. Every
   `comprehension.*`, `reasoning.*`, `continuation.*`, `preservation.*`,
   `isolation.*`, `intervention.*`, and `ergonomics.*` check passes there; the
   only failure is the Harness-B liveness check.
2. **Orientation cost.** Section 5 has Agent B calling `campfire.whoami`,
   `campfire.list_workspaces`, `campfire.get_workspace`, and
   `campfire.get_workspace_context`; section 12 records the first call as
   `campfire.whoami` with 4 orientation reads. The September 23 run's first call
   was `campfire.list_workspaces` and orientation cost 2 calls. `whoami` and
   `get_workspace` were never called in that run.
3. **Ergonomics inverted.** Section 12 reports 1 redundant read, two overlapping
   full projections, ~26.9 KB of context, and a doubled `campfire_campfire_*`
   tool namespace. The September 23 run reports 0 redundant reads, 0
   missing-context signals, 0 context-noise signals, and single-prefix names
   such as `campfire_list_workspaces`. Section 18's Sprint 003 items 1, 2, and 4
   therefore look already satisfied by the harness/server pairing used on
   September 23 — but which side changed was not recorded, so treat that as an
   observation rather than a delivered fix.
4. **Agent B's contribution volume.** Section 8 records 4 findings, 4 artifacts,
   1 new accepted decision, and a follow-up task assigned to Alice. The
   September 23 run records 2 findings, 1 artifact, 0 new decisions, and no
   follow-up task (`continuation.new_state_recorded`:
   `newFindings=2 newArtifacts=1 newDecisions=0`), consistent with a process
   killed about a minute after its third write.
   `continuation.meaningful_work_performed` still passes.
5. **Agent B's work product.** Section 8 lists
   `db/migrations/284_expand_add_billing_status.sql`,
   `jobs/backfill_billing_status.sql`,
   `db/migrations/285_finalize_billing_status_index.sql`, and
   `scripts/validate_staged_rollout.mjs`. The September 23 run recorded a single
   `./rollout` artifact covering `./rollout/*.sql` plus `./test/run_tests.sh`,
   validated against PostgreSQL 16-alpine in Docker. Both are consistent with
   the accepted expand/contract decision; they are different artifacts, and a
   film or deck should describe only one run at a time.
6. **Agent B's session attribution.** Section 2 states `ses_harness_a_codex`
   and `ses_harness_b_opencode` were pre-created before each harness started. In
   the September 23 run Agent B additionally called `register_agent_session`, and
   its own writes carry `ses_46b3c75800f74f84`. Two session ids for Agent B
   therefore appear in that run. Attribution stayed correct and distinct
   (`environment.sessions_isolated`, `preservation.provenance_distinct`, and
   `preservation.activity_ordered` all pass), but section 2's session-binding
   story does not describe what the later evidence shows.
7. **Limitations.** Section 16 lists five; the September 23 evidence lists four,
   and the two sets are not the same. The later run adds that the Campfire
   database and pre-bound agent sessions are prepared in-process before the
   harnesses start, and does not repeat section 16's authorization-simplicity or
   findings/decisions-lifecycle items. Both runs agree on the Claude Code
   substitution and on artifacts being references only.
8. **Which evidence carried the reasoning checks.** Section 14 records that the
   evaluation heuristics were broadened to match the concept rather than the
   literal string "split". In the September 23 run the broadened checks passed on
   state evidence alone: `reasoning.correct_next_step` carries
   `nextStepMessage=false`, with the correct next step evidenced by the finding
   and the completed task instead of by a closing narrative — which matters,
   because that run has no closing narrative to cite.
   `reasoning.respects_prior_decision` passed on `mentionsSplit=true` with
   `violatesIncreaseTimeout=false`.

---

## 21. Addendum — September 12 Artifacts Are Unrecoverable (October 6, 2026)

**Addendum written:** October 6, 2026.

Sections 1–19 remain the record of the September 12 run, and their **GO** verdict
and findings are unchanged. The one edit made above them since September 12 is
the dated **Evidence note** in section 1, added on October 6, 2026 to point
readers at section 20; it is disclosed in section 20's opening and alters no
verdict, finding, or number. Section 20 described the overwrite; this section
records the outcome of the recovery attempt and the convention that now prevents
a recurrence. Neither addendum weakens the September 12 verdict.

### 21.1 The GO verdict stands; its artifacts cannot be re-read

The September 12 **GO** verdict remains the historical conclusion of this
sprint. It was reached from what was observed on September 12 and that
conclusion is not withdrawn, softened, or restated here.

What is gone is the ability to **independently verify** it from the tree. The
artifacts that supported it were written to the fixed path
`evidence/sprint-002/`, were overwritten in place by the September 23 rerun,
and — because `evidence/` is gitignored — were never in Git history. The
historical verdict is therefore recorded in this document; the evidence
underlying it is no longer available for inspection or re-derivation.

Anyone rebuilding Sprint 002 evidence today will rebuild the September 23 run.
The correct way to cite the September 12 result is to cite this document's §1
and §17, and to know that the underlying artefacts are gone.

### 21.2 Recovery attempted and unsuccessful

A thorough search on October 6, 2026 for the September 12 artefacts found
nothing. Checked and ruled out:

- **Git history** — `git log --all -- evidence/` returns nothing; `evidence/`
  has never been tracked. No other branch, no stash, no worktree
  (`git worktree list` shows only the main checkout), and no dangling object
  matches the run's fingerprint.
- **Other clones** — the sibling `BoringInfraCo/Campfire` public mirror and
  other Campfire-related directories contain no Sprint 002 evidence.
- **Agent worktrees** — the local agent-worktree directory for this
  repository holds three subagent checkouts with September 12 source mtimes,
  but none contains an `evidence/` directory.
- **Temp directories** — the runner's own scratch directory
  (`campfire-sprint002-*` under the per-user temp root) survives only as empty
  harness work directories; it holds no capture files.
- **Archives, caches, and history** — no `*.tar*`/`*.zip`/`*.json.gz` referencing
  the sprint; nothing in `~/Library/Caches`; no shell history entry for
  `acceptance:002` or `evidence/sprint-002`.
- **Snapshots and CI** — `tmutil listlocalsnapshots /` reports no local
  snapshots. `.github/workflows/ci.yml` publishes no artifacts, so there is no CI
  artifact store to retrieve from.
- **Campfire traces** — `.campfire/traces/harbor/harbor-trace.db` and
  `beacon/beacon-trace.db` are October 4 fixtures from unrelated traces and
  contain no Sprint 002 records.

**Outcome: NOT FOUND.** The September 12 artefacts are not recoverable from this
machine.

### 21.3 What was reorganised, and the convention that replaces the fixed path

The September 23 run — the only surviving run — now also exists at
`evidence/sprint-002/run-2026-09-23/`, byte-identical to the files it was copied
from and verified by SHA-256. That is a reorganisation, not a rescue and not a
backup: the bytes were copied **within** `evidence/sprint-002/`, onto this same
disk, inside the same gitignored tree. The files previously written to the fixed
path were left where they were, so today the same run sits in two byte-identical
directories on one disk. That is not redundancy — it is one copy reachable by two
paths, and the loss of this directory loses both.

What the dated directory bought is **identifiability**. The run can now be named,
hashed and tracked in the manifest as `sprint-002/run-2026-09-23`, and section 1's
pointer can no longer silently resolve to the wrong run.

No copy of this evidence exists anywhere else. It is not under version control,
not in CI artifacts, not archived, and not backed up. **If `evidence/` is lost,
the September 23 artifacts are gone exactly the way the September 12 artifacts
are gone.** A durable copy requires copying them to controlled storage; that has
not been done, and the convention below does not do it.

The fix is structural rather than a one-off copy:

1. **One directory per run.** `writeRealEvidence` no longer defaults to the fixed
   path `evidence/sprint-002/`. It resolves
   `evidence/sprint-002/run-<YYYY-MM-DD>` from the run's own start time, and a
   second run on the same date escalates to `run-<date>T<hhmmss>`. It refuses to
   write into a directory that already holds a run.
2. **A tracked index.** `evidence/MANIFEST.json` is generated by
   `npm run evidence:manifest` and records each run's date, harness versions,
   verdict, check tally, and a SHA-256 per file. Raw evidence stays gitignored;
   the manifest is tracked via a targeted negation in `.gitignore`.
   `npm run acceptance:002` regenerates it automatically after a run. It is an
   index and a tripwire, **not a copy**: the hashes identify a run and reveal
   that its files have changed or disappeared. Delete the underlying files and
   the manifest simply records hashes of files that no longer exist — it would
   report the loss, not prevent or repair it. The manifest preserves nothing.
3. **An explicit unavailable record.** The manifest carries an `unavailable`
   entry for `sprint-002/run-2026-09-12` stating this same limitation, so the
   index never implies the run never happened.

The manifest's entry for September 23 records `CONDITIONAL GO`, 30/31 checks,
`codex-cli 0.150.1`, and `OpenCode 1.18.32` — matching §20, and identifying the
surviving files as that run and not the September 12 one.
