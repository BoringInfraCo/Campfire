# budget-enforcement (dry check)

Dated 2026-10-07.

## Purpose

A dry check of the runner's locked budget enforcement for WOW-001, **not a
scored run**. A staged run tree was pointed at the disposable authenticated
database, and the runner's `probe-budget` path ran a real OpenCode session with
tiny tool-call and time limits to confirm the hard stop mechanics before any
scored run exists. No scenario was investigated and no scoring occurred.

## Budgets under test

Locked from `fixtures/incidents/wow-001/RUN-LOCK.md` and implemented as
compile-time constants (`PILOT_BUDGETS` in `scripts/wow-001/pilot-lib.ts`,
consumed by `budgetFor(role)` in `pilot.ts run`):

| Role | Time | Tool calls |
| --- | --- | --- |
| First agent | 30 min | 100 |
| Second agent | 10 min | 30 |

The earlier limit stops the run. `pilot.ts run` exposes **no override flags**
for these budgets; only `probe-budget` accepts `--max-tool-calls` (1..20) and
`--max-minutes`, and both default to the tiny dry-check values used here.

Dry-check limits used: **3 tool calls, 2 minutes**. The prompt asks the model
to call `list_workspaces` at least 30 times, one at a time, so the tool-call
limit is the binding constraint.

## Commands

```text
npx tsx scripts/wow-001/pilot.ts stage --scenario S1 --arm control --role first --run-id budget-probe-1 --campfire-db /campfire/campfire.db --campfire-token-file /campfire/agent.token --workspace-id ws_abc33b1d54d44de1 --deadline "2 minutes"
cp <auth-check>/campfire/campfire.db <run>/campfire/campfire.db
cp <auth-check>/campfire/agent.token <run>/campfire/agent.token && chmod 600 <run>/campfire/agent.token
npx tsx scripts/wow-001/pilot.ts probe-budget --run-id budget-probe-1
```

- exit code: `0` (`ok: true`, `failures: []`)
- image (asserted by the runner before the session):
  `campfire-wow-001-agent:977c0e3-opencode1.18.35`
  (`sha256:349b90635fd4b584599aba5e01f989f44c38689f857eb217b1fbcb3fc078943a`)
- model: `opencode-go/deepseek-v4.1-flash`
- sanitized transcript: `<home>/.campfire-pilot/wow-001/runs/budget-probe-1/probe-budget-first.log`

## Exact sanitized report

Runner stdout (exit 0):

```json
{"ok":true,"role":"first","scenario":"S1","arm":"control","startedAt":"2026-10-08T04:07:26.154Z","endedAt":"2026-10-08T04:07:34.051Z","durationMs":7897,"stopReason":"tool_budget","toolCallCount":3,"sessionToolCallCount":3,"overshoot":false,"exitCode":137,"logPath":"<home>/.campfire-pilot/wow-001/runs/budget-probe-1/probe-budget-first.log","budget":{"toolCalls":3,"minutes":2},"failures":[]}
```

## Result

The runner stopped the container at the tool-call limit with no overshoot:
`stopReason: "tool_budget"`, `toolCallCount: 3` (<= 3),
`sessionToolCallCount: 3` (<= 3, independent cross-check of the session
database), `overshoot: false`, and no failures. The log shows exactly three
`campfire_list_workspaces` calls before the runner removed the container; the
model never reached the 2-minute time limit. The default budgets for real runs
(30 min/100 calls and 10 min/30 calls) cannot be relaxed from the command line:
they are compile-time constants consumed by `pilot.ts run`, which has no
budget flags.

## Scope

This is a mechanics check on one machine. It establishes that the locked stop
rule fires at the tool-call budget and that counts agree between the streamed
capture and the session database; it scores nothing and says nothing about
model performance under the real budgets.
