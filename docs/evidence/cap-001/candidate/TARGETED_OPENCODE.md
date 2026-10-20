# CAP-001 targeted OpenCode smoke

**Date:** 2026-10-20  
**Label: FIXTURE EVIDENCE — one harness smoke.** Not a human observation, not a sprint verdict, and not a release. No product source was edited. Nothing was committed or pushed. No version was bumped. `campfire up` was not run. Nothing listened on port 9414. The already running `opencode serve` was left running and was not reconfigured.

**Score: pass.** No clause missed.

A pass required capability discovery (`discover_capabilities` or `campfire capabilities --search`), at least one read-recipe fetch (`get_read_recipe` or `campfire capabilities --recipe`), `task_cap001_blocked_later` named as blocked and off a truncated first page, `dec_cap001_selected` accepted with `needsReview` because `find_cap001_stale` is not current, `find_cap001_current` still current, and no write tool. All of those held. Contributions stayed 55.

## Run

| | |
| --- | --- |
| Binary | `opencode v2.1.1` |
| Command | `HOME=[path] XDG_CONFIG_HOME=[path] XDG_DATA_HOME=[path] XDG_STATE_HOME=[path] XDG_CACHE_HOME=[path] CAMPFIRE_DB=[path] CAMPFIRE_ACTOR_ID=hum_cap001_ada CAMPFIRE_ACTOR_TYPE=human CAMPFIRE_HARNESS=opencode CAMPFIRE_TELEMETRY=0 opencode run --standalone --auto --format json` from a temp directory, not the repo |
| Model | `opencode/big-pickle` (session record: provider `opencode`, id `big-pickle`; not passed on the command line) |
| Duration | 84.446 s wall clock. The process was allowed 20 minutes and exited on its own. |
| Exit code | 0 |
| Output size | JSONL stream 205,381 bytes; final answer text 4,050 bytes; stderr 0 bytes |

`CAMPFIRE_URL` and `CAMPFIRE_TOKEN` were unset. The local MCP block lived only under the isolated XDG config. Its shape matched `prepareOpenCode`: `type` `local`, `enabled` true, and a command array of the repo `tsx` binary, `src/cli/index.ts`, and `mcp`. The environment was `CAMPFIRE_DB`, `CAMPFIRE_ACTOR_ID`, `CAMPFIRE_ACTOR_TYPE`, `CAMPFIRE_HARNESS=opencode`, and `CAMPFIRE_TELEMETRY=0`. The database was a fresh seed under `/tmp`, not the Codex database and not the earlier OpenCode smoke database. Auth was copied into the isolated data home so the CLI could authenticate. It was not printed and was not written into the repo.

mtimes for `[path]/.config/opencode/opencode.json`, `[path]/.config/opencode/opencode.jsonc`, and `[path]/.local/share/opencode/auth.json` matched before and after (nanoseconds and sizes). `--standalone` plus the isolated `HOME` / `XDG_*` homes kept this run off the real config and off the background server.

**Preflight, before the model call.** An in-process MCP client (`InMemoryTransport` against this database) listed 40 tools, including `discover_capabilities` and `get_read_recipe`. A separate stdio client using the same command array also listed those two tools. The prompt named neither tool, nor a command, a recipe id, or a fixture id.

## Campfire operations

Completed calls below are invocations that reached Campfire. One `discover_capabilities` call sent `limit` 20 and came back `ValidationError` (`Limit must be an integer from 1 to 10`); the second query in that same script did not run. One later harness `execute` failed JSON parsing and was not executed, so its `list_tasks` text never became a Campfire call.

| Operation | Calls | Failed |
| --- | --- | --- |
| `discover_capabilities` | 5 | 1 |
| `get_read_recipe` | 2 | 0 |
| `list_workspaces` | 1 | 0 |
| `get_workspace_context` | 1 | 0 |
| `list_tasks` | 3 | 0 |
| `get_task` | 1 | 0 |
| `get_decision` | 1 | 0 |
| `get_finding` | 2 | 0 |

`get_finding` is two reads inside one execute. `list_tasks` is one first page, then the same page again plus the cursor page. No Campfire write tool was called. `campfire up` was not called. `get_activity` was not used as a history substitute. `get_record_history` was not called.

Harness calls that are not Campfire operations: `list_mcp_resources` 1, `glob` 1, and a tool-index `search` 2. Those happened around discovery. They did not read or write a workspace record before discovery.

**Discovery.** Called, via `discover_capabilities` only. Not via `campfire capabilities --search`. Queries, in order:

- `read recipe continuing blocked work decision basis` (limit 10): 0 matches.
- `read recipe` (limit 20): validation error, as above.
- `read recipe` (limit 10): 0 matches.
- `blocked task` (limit 10): entries `get_task` and `list_tasks`; recipe summary `continue-blocked-work`.
- `decision basis review` (limit 10): recipe summary `review-decision-basis`.

**Recipes fetched.** Yes. `get_read_recipe` returned `continue-blocked-work` and `review-decision-basis` (`kind: read_recipe`). Not via `campfire capabilities --recipe`.

**Ids the answer named.** `task_cap001_blocked_later` is `blocked` and was not on the first page. That page was not complete (`returned` 20, `total` 21, `truncated` true, `nextCursor` present). Page 2 returned that one task, `truncated` true, and no `nextCursor`. `dec_cap001_selected` is accepted, not proposed, with `needsReview` true because `find_cap001_stale` is superseded. `find_cap001_current` stays current. Workspace `ws_cap001_lab` was the only membership returned.

**Wrong inferences.** The assignee cell for the later task says none recorded, which is right, but it parenthetically attaches the cue `unassigned_blocked_task` to that task. On this fixture that cue is `suggestedNextAction` for `task_cap001_b01` on page 1, not for the later task. The answer also says no other tool names were used; the trace still has the harness `glob`, `search`, and `list_mcp_resources` calls above. It did not treat `needsReview` as revocation or as permission to act, did not treat a missing assignee as a live person, and did not treat `truncated` true with no `nextCursor` as another page.

**Contributions.** 55 before the model call and 55 after. The count stayed unchanged.

Quoted coverage from the final answer:

> Task id `task_cap001_blocked_later`. Status `blocked`. First page complete? No.

> `get_workspace_context` task slice: `returned 20`, `total 21`, `truncated true`, `nextCursor` present. `list_tasks` page 1: `returned 20`, `total 21`, `truncated true`, `nextCursor` present. `list_tasks` page 2: `returned 1` → `task_cap001_blocked_later`; `truncated true` with no `nextCursor`.

> Decision id `dec_cap001_selected`. Status `accepted` (not proposed). `needsReview` `true`. `find_cap001_stale` is superseded — not current. `find_cap001_current` is current.

## Recipe stop rule, from the tool trace

Yes. After discovery, the `continue-blocked-work` text returned by `get_read_recipe` told the model, on `get_workspace_context`: if `slices.tasks.truncated` is true or the selected task id is absent from `slices.tasks.items`, continue to `list_tasks`. The same payload's `list_tasks` step says to page only while `nextCursor` is present, and that `truncated` true with no `nextCursor` is the end of the traversal.

The model did that. `get_workspace_context` reported the task slice truncated (20 of 21, cursor present). The next Campfire reads were `list_tasks` for that page and then `list_tasks` with the returned cursor, which produced `task_cap001_blocked_later`.
