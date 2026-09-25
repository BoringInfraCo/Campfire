# Campfire — Sprint 011 Result

**Status:** Complete
**Sprint:** 011 — Natural Contribution
**Date:** September 25, 2026
**Company:** Boring Infra Co.
**Depends on:** Sprint 010 — Return to the Workspace (**GO**)
**Recommendation:** **GO**

---

## 1. Result

Sprint 011 asked:

> Can an agent doing ordinary work recognize what belongs to the team and
> contribute that durable state to Campfire without being given a list of
> Campfire write calls or an end-of-session handoff template?

Yes. A cold Codex process, given only the workspace id, the bounded webhook
investigation, the fixture files, and one neutral instruction to keep durable
shared state current, investigated the logs, wrote `./diagnosis.md`, oriented
with `get_workspace_context` before writing, and recorded an evidence-linked
Finding (confidence 0.97, sourced to its Artifact), the diagnosis Artifact
reference, a truthful Task `completed`, and a Goal `completed` — 4 writes, 0
failed calls, no duplicates, no secrets, no unrelated-workspace writes, no
auto-accepted decision. A second cold agent (OpenCode), given only the
workspace id, recovered the fact, the task outcome, the artifact, the
(still empty) decision state, and the correct next action from Campfire alone,
then correctly wrote nothing.

Timing and tool-call counts are diagnostic. Contributor wall clock ~72 s
(2 reads + 4 writes); downstream ~20 s (4 reads + 0 writes). No pass/fail
latency or call-count threshold exists.

No generic contribution endpoint, transcript extraction, finding lifecycle,
reminder/hook, writable Viewer, schema, or migration was added.

---

## 2. What landed

| Surface | Behavior |
| --- | --- |
| MCP tool descriptions | `add_finding`, `add_decision`, `accept_decision`, `create_task`, `update_task`, `add_artifact`, `update_goal` now state object choice and safety boundaries (durable vs transcript, propose vs approve, truthful lifecycle, reference vs secret material, intent-change-only goal updates). Guidance only; service semantics unchanged |
| Fixture `fixtures/sprint-011/` | Webhook-delay task: `README.md` (neutral instruction, observable `./diagnosis.md` path), `webhook.log` (fixed-0s backoff, lock contention, bearer-token leak trap), `queue-config.json`, evaluator-only `EXPECTED.md` (predeclared fact, completion condition, forbidden strings) |
| Evaluator `src/acceptance/sprint-011/` | Neutral contributor / workspace-only downstream prompts, sentinels, pure `computeSprint011Checks` + `recommend011` (accuracy, usefulness, selectivity, provenance, isolation) |
| Deterministic tests `tests/unit/sprint-011.test.ts` | Contribution provenance + ordered `since` delta, session/viewer/non-participant rejection, downstream continuation from state alone, MCP description boundaries |
| HTTP / CLI / Workers / Viewer | Unchanged behavior; existing parity, isolation, lifecycle, and read-only tests remain green |

---

## 3. Validation matrix

```text
npm run typecheck          PASS
npm test                   PASS — 26 files, 307 tests (incl. 4 sprint-011)
npm run build              PASS
evaluator vs cold snapshot PASS — 9/9 checks → GO
```

Deterministic coverage includes:

- Pre-work cursor returns exactly the new contributions in order, each with
  the correct actor, agent session, workspace, object, payload, and time.
- Agent writes without a session rejected; viewer and non-participant cannot
  write; authorization precedes exposure/mutation.
- Proposed Decisions stay proposed; the cold run recorded none and accepted
  none.
- No transcript sentinel, bearer token, or unrelated-workspace state in any
  object or Contribution payload.
- Sync and Workers write semantics unchanged.

Manual checks on the cold-run database (same DB as both harness runs):

```text
con_8a4003e1579e4fe0  agt_000001  create  artifact  art_6b7d305e3dd04d9f  title=Webhook delivery delay diagnosis
con_7c914f2d9f554498  agt_000001  create  finding   find_a5b57c21e34144b2  summary=Zero-backoff retries collide with a Redis lock…
con_92d631f8695540f9  agt_000001  update  task      task_000001  status=completed
con_81043650a5c54910  agt_000001  update  goal      goal_000001  status=completed
```

---

## 4. Cold real-harness evaluation

- Contributor harness: real `codex-cli 0.150.1`, fresh ephemeral process,
  `workspace-write` sandbox, workdir containing only the three agent-visible
  fixture files, identity `agt_000001` / `ses_000001` injected through the MCP
  environment. Exit 0. Campfire calls: `preflight`, `get_workspace_context`,
  `add_artifact`, `add_finding`, `update_task`, `update_goal` — 0 failures.
- Downstream harness: real `opencode 1.18.32` (a genuinely different
  harness), fresh process, empty workdir, identity `agt_000002` /
  `ses_000002`, native session distinct from the contributor thread. Exit 0.
  Campfire calls: `whoami`, `get_workspace`, `get_workspace_context`,
  `get_activity` — 0 writes; contribution count stayed 16.
- Accuracy: finding matches the predeclared fact (zero-backoff retry vs
  120 s TTL lock collision), task truthfully `completed` (diagnosis exists),
  artifact references `./diagnosis.md`, no decision earned or fabricated,
  all writes in `ws_000001` with full provenance.
- Usefulness: the downstream statement named the finding (with actor,
  session, confidence), the artifact (with path and no-credential flag), the
  completed task and goal, the empty decision state, and the correct next
  action (none required, no writes) — without the contributor transcript.
- Selectivity: 1 finding, no duplicates, no unsupported or overly broad
  writes, no transcript-like content.
- Isolation: bearer token, private-transcript sentinel, and unrelated
  sentinel absent from all workspace state (independently re-verified).
- Interventions after the initial prompts: 0 in every class (operational,
  clarification, context leakage, manual handoff).

One evaluator amendment, documented in `evidence/sprint-011/cold-harness.md`:
the fixture's literal fact regex missed the contributor's correct paraphrase
("Zero-backoff", "lock-contention"), so scoring used the concept-equivalent
pattern (Sprint 002 precedent: match the concept, not one word). It matches
the log evidence, matches the finding, and still rejects a timeout-only
answer. All other checks passed unamended.

Minor observations (not rubric triggers): the goal `completed` description
narrates progress where the guidance prefers findings/tasks/artifacts, and no
proposed Decision was recorded for the remediation direction (judged not
earned — recommendations stayed in the report and downstream confirmed no
execution was due). No clarification, duplicate, or noisy object resulted.

Evidence: `evidence/sprint-011/cold-harness.md` (private, gitignored). Raw
capture remains at
`/var/folders/b5/wj2djqx569x96bjvf5wclxf80000gn/T/opencode/campfire-sprint-011-20260925`.

---

## 5. Architecture and scope

- No service method, domain object, database column, migration, background
  process, or model call added. HTTP, CLI, and Workers behavior unchanged;
  the change is agent-interface guidance over existing semantics.
- No generic `contribute` endpoint, transcript extraction, summarization,
  session-end hooks, finding lifecycle, relationships, notifications,
  automatic acceptance, writable Viewer, cross-workspace memory,
  orchestration, or capability management.
- The Viewer was not modified and remains read-only.

---

## 6. Limitations

1. One fixture, one contributor harness/model, one downstream
   harness/model, no variance estimate.
2. Second-resolution wall-clock timings from one run each; diagnostic only,
   and per-call latencies are not captured by the event parsers.
3. The cold runs exercised the local SQLite service; Workers/D1 parity is
   covered by deterministic tests, not a live deployment.
4. A successful prompted run does not prove an unprompted long-term habit
   or external team retention. Gate B and Gate C external behavioral
   evidence remains unmeasured.
5. The scored finding used a concept-equivalent pattern after the literal
   regex missed a correct paraphrase; future fixtures should predeclare
   concept patterns up front.

---

## 7. Recommendation

```text
GO
```

All deterministic checks pass. The cold contributor discovered the fixture
fact, recorded a useful Finding, truthfully completed the Task, attached the
earned Artifact, proposed nothing it should not have (and auto-accepted
nothing), and preserved workspace, identity, authorization, provenance, and
transcript boundaries without prescribed write calls or a handoff template.
A second cold agent recovered the result from Campfire alone and continued
correctly. Sprint 012 remains future scope; design-partner release work is
unchanged.
