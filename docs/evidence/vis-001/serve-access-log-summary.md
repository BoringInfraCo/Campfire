# VIS-001 Viewer access log — derived summary

**Source:** `.campfire/traces/harbor/serve-trace.log` (local, gitignored, not
committed — 26,585 lines / 2.5 MB of polling noise).
**Derived:** October 7, 2026, by parsing the retained log.
**Covers:** the human Viewer trace and the agent-side return read, both against
`http://127.0.0.1:19415` backed by `campfire serve` on `127.0.0.1:19414`.

The raw log is not preserved because it is almost entirely repeated poll
traffic. This summary is the retained, checkable part.

## Verified tallies

| Measure | Value |
| --- | --- |
| Total log lines | 26,585 |
| Allowlisted read-method invocations | 13,293 |
| Authorization decisions, allow | 13,290 |
| Authorization decisions, deny | 0 |
| Distinct methods invoked | 5 |

Per method:

| Method | Invocations |
| --- | --- |
| `get_workspace_context` | 3,324 |
| `get_activity` | 3,323 |
| `list_workspaces` | 3,322 |
| `get_workspace` | 3,321 |
| `whoami` | 3 |

Per operation:

| Operation | Count | Allowed |
| --- | --- | --- |
| `workspace:read` | 6,645 | all |
| `activity:read` | 3,323 | all |
| `workspace:list` | 3,322 | all |

## What this establishes

- The Viewer invoked **only** the five methods in `VIEWER_READ_METHODS`
  (`whoami`, `list_workspaces`, `get_workspace`, `get_workspace_context`,
  `get_activity`). No other method name appears anywhere in the log.
- **Zero write operations.** No create, update, accept, or contribution method
  was invoked during the trace.
- **Zero denials**, so this log says nothing about how the Viewer behaves on an
  unauthorized read. Authorization denial evidence comes from the cold-agent
  probe instead (`probe-opencode-transcript.txt`), not from this trace.
- All authorization decisions were taken **before** the method returned, and
  every call was for `hum_grace` on `ws_e844657c1dcc4e5a` only.

## Correction to a prior figure

`docs/SPRINT_VIS_001_RESULT.md` previously recorded "2,925 poll cycles". That
number does not match the retained log. The log contains 13,293 read-method
invocations across 3,321–3,324 repetitions of each polling method, so the cycle
count is larger than originally recorded. The qualitative claims it supported —
five allowlisted methods, zero writes, zero denials — are all confirmed above.