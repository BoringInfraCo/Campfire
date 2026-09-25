# Campfire — Sprint 012 Result

**Status:** Complete
**Sprint:** 012 — Close the Workspace
**Date:** September 25, 2026
**Company:** Boring Infra Co.
**Depends on:** Sprint 011 — Natural Contribution (**GO**)
**Recommendation:** **GO**

---

## 1. Result

Sprint 012 asked:

> Can an authorized human or agent recognize when a workspace's recorded work
> is genuinely finished, close it explicitly, and leave its outcome and
> history available to later participants?

Yes. A cold Codex process, given only the workspace id, ordinary Campfire
tools, and one neutral request to review whether the workspace should remain
active, read the full state and history, cited the recorded completion
signals, and marked the workspace `completed` with exactly one lifecycle
write — not `archived`, with no unrelated writes and no success overclaim. A
second cold agent (OpenCode), given only the workspace id, reported the
workspace `completed`, named the completed goal and task, recovered the
finding and artifact, identified the closer from history, confirmed nothing
remains proposed or actionable, and correctly wrote nothing.

Timing and tool-call counts are diagnostic. Closer wall clock ~24 s
(4 reads + 1 write); downstream ~20 s (2 reads + 0 writes). No pass/fail
latency or call-count threshold exists.

No service-enforced completion policy, closure object, required summary,
automatic transition, list filtering, approval workflow, writable Viewer,
schema, or migration was added.

---

## 2. What landed

| Surface | Behavior |
| --- | --- |
| Sync + Workers services | `updateWorkspace` now requires an active registered agent session for agent actors, matching the existing collaboration-object write boundary. Humans unaffected; viewers and non-participants still denied before mutation |
| MCP `update_workspace` description | States the lifecycle choice at selection time: `completed` only after inspecting recorded state with a finished goal and nothing remaining; completion preserves history; `active` for ongoing/reopened work; `archived` is terminal retirement; quiet state never grants permission or proves success |
| Evaluator `src/acceptance/sprint-012/` | Neutral closer / workspace-only downstream prompts, sentinels, pure closure-rule (`isReadyToClose`) + `computeSprint012Checks` / `recommend012` (accuracy, retention, provenance, selectivity, isolation) |
| Deterministic tests `tests/unit/sprint-012.test.ts` | Post-work closure with one provenance-backed contribution, session/viewer/non-participant rejection, explicit reopen with `archived` terminal, counterexample matrix, Workers session parity, MCP description boundaries |
| HTTP / CLI / Viewer | Unchanged behavior; session flows through the existing caller-supplied context on every surface |

---

## 3. Validation matrix

```text
npm run typecheck          PASS
npm test                   PASS — 27 files, 313 tests (incl. 6 sprint-012)
npm run build              PASS
evaluator vs cold snapshot PASS — 7/7 checks → GO
```

Deterministic coverage includes:

- The post-work fixture satisfies all six closure signals while `active`;
  an authorized session agent transitions it to `completed` with exactly one
  Workspace update Contribution (actor, session, id, `status: completed`,
  time), visible in `get_workspace`, `get_workspace_context`,
  `get_activity`, and `list_workspaces` with all prior objects intact.
- Sessionless agents, viewers, and non-participants cannot change lifecycle
  status; failed attempts record nothing.
- `completed → active` reopen records one new Contribution; `archived` is
  terminal in both directions. The scored run did not reopen.
- Counterexamples stay not-ready: active or missing goal, open/in-progress/
  blocked tasks, proposed decisions, and non-`none` next actions. Quietness
  alone never qualifies.
- Workers lifecycle writes enforce the identical session boundary with
  identical provenance.

Manual checks on the cold-run database (same DB as both harness runs):

```text
con_df783c5a7b14472f  agt_000001  ses_000002  update  workspace  ws_000001  {status: completed}
```

Activity grew 17 → 18; findings 1→1, tasks 1→1, artifacts 1→1, decisions
0→0.

---

## 4. Cold real-harness evaluation

- Closer harness: real `codex-cli 0.150.1`, fresh ephemeral process,
  `read-only` sandbox, empty workdir, identity `agt_000001` / `ses_000002`
  injected through the MCP environment. Exit 0. Campfire calls: `preflight`,
  `get_workspace`, `get_workspace_context`, `get_activity`,
  `update_workspace{completed}`, plus a post-close `since`-cursor
  verification read — 0 failures.
- Downstream harness: real `opencode 1.18.32` (a genuinely different
  harness), fresh process, empty workdir, identity `agt_000002` /
  `ses_000003`, native session distinct from the closer thread. Exit 0.
  Campfire calls: `get_workspace`, `get_workspace_context` — 0 writes;
  contribution count stayed 18.
- Closure accuracy: read before writing, cited goal/task/finding/artifact
  completion and the empty proposal queue, selected `completed` exactly
  once, never touched `archived`.
- History retention: one lifecycle Contribution added, none removed or
  obscured; all prior objects readable after completion.
- Provenance: closer contribution carries the correct actor and session.
- Selectivity: one lifecycle mutation only; no Goal/Task rewrites, no
  redundant summary, Finding, Artifact, or Decision.
- Downstream usefulness: reported `completed` with timestamp, closer
  attribution from history, completed goal/task, finding, artifact, empty
  decision state, and the honest next action (none — leave closed).
- Isolation: closer transcript sentinel and unrelated sentinel absent from
  all workspace state (independently re-verified).
- Interventions after the initial prompts: 0 in every class (operational,
  clarification, context leakage, manual handoff).

Evidence: `evidence/sprint-012/cold-harness.md` (private, gitignored). Raw
capture remains at
`/var/folders/b5/wj2djqx569x96bjvf5wclxf80000gn/T/opencode/campfire-sprint-012-20250925`.

---

## 5. Architecture and scope

- One guard line per service (`requireAgentSession` in sync
  `updateWorkspace`, awaited in Workers) plus MCP guidance prose. No new
  service method, domain object, projection, status, database column,
  migration, model call, background process, or automatic transition.
- No universal completion policy: the six-signal rule is a fixture
  acceptance rule, and the service still validates only the lifecycle edge.
- HTTP and Workers enforce the same session-bound semantics through the
  existing caller-supplied context; CLI and Viewer behavior unchanged.
- The Viewer was not modified and remains read-only.

---

## 6. Limitations

1. One positive real-harness closure case, one downstream harness, no
   variance estimate. Negative cases are deterministic only.
2. Second-resolution wall-clock timings from one run each; diagnostic only,
   and per-call latencies are not captured by the event parsers.
3. The cold runs exercised the local SQLite service; Workers/D1 parity is
   covered by deterministic tests, not a live deployment.
4. A successful prompted run does not prove an unprompted closure habit or
   external team retention. Gate B and Gate C external behavioral evidence
   remains unmeasured.

---

## 7. Recommendation

```text
GO
```

All deterministic checks pass. The cold closer read the genuinely finished
workspace, explicitly marked it `completed` exactly once, preserved all
prior state and history, recorded correct provenance, performed no
unrelated writes, and did not archive or overclaim success. A second cold
harness retrieved the completed outcome and closer attribution from Campfire
alone. Sprint 013 remains undefined; design-partner release work is
unchanged.
