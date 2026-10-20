# CAP-001 targeted Codex smoke

**Date:** 2026-10-20  
**Label: FIXTURE EVIDENCE — one targeted usability check.** Not a human observation, not a sprint verdict, and not a release. No product source was edited. Nothing was committed or pushed. No version was bumped. `campfire up` was not run. Nothing listened on port 9414 (it was not listening before the run).

**Score: pass.** No scoring clause missed.

A pass required capability discovery, at least one read-recipe fetch, `task_cap001_blocked_later` named as blocked and off a truncated first page, `dec_cap001_selected` accepted with `needsReview` because `find_cap001_stale` is not current, `find_cap001_current` still current, and no write tool. All of those are in the tool trace and the final answer.

## Run

| | |
| --- | --- |
| Binary | `codex-cli 0.163.0` |
| Command | `env -u CAMPFIRE_URL -u CAMPFIRE_TOKEN CODEX_HOME=[path] CAMPFIRE_DB=[path] CAMPFIRE_ACTOR_ID=hum_cap001_ada CAMPFIRE_ACTOR_TYPE=human CAMPFIRE_HARNESS=codex CAMPFIRE_TELEMETRY=0 codex exec --json --skip-git-repo-check --sandbox workspace-write --cd [path] --add-dir [path] --output-last-message [path] -` |
| Model | `gpt-6.1-sol` (session record; not passed on the command line). Provider `openai`. |
| Duration | 36.20 s (`real` from `/usr/bin/time -p`) |
| Exit code | 0 |
| Output size | JSONL stream 104,803 bytes; final answer file 1,457 bytes; stderr 30 bytes (`time` only) |
| Sandbox | `workspace-write` plus `--add-dir` for the database directory. `--cd` was an empty temp directory, not the Campfire repo. |

The prompt was the required text and named no tool, command, recipe id, or fixture id. It was the process stdin via `-`, so it was not appended to another prompt. `CAMPFIRE_URL` and `CAMPFIRE_TOKEN` were unset. The MCP server was `node [tsx] [repo]/src/cli/index.ts mcp` with the local actor env above.

Real harness files were not modified. mtimes of `[home]/.codex/config.toml` and `[home]/.codex/auth.json` matched before the seed, after the isolated config was written, and after Codex exited. Auth was copied into the isolated `CODEX_HOME` only. Codex wrote its own session files there. The isolated config is not the user config.

**Preflight, before the model call.** An in-process MCP client spawned the same `node [tsx] src/cli/index.ts mcp` command against the fresh temp database. The list contained 40 tools, including `discover_capabilities` and `get_read_recipe`.

## Campfire tools

Completed MCP calls only. No shell Campfire CLI. No write tool.

| Tool | Calls | Failed |
| --- | --- | --- |
| `discover_capabilities` | 4 | 1 |
| `get_read_recipe` | 2 | 0 |
| `list_workspaces` | 1 | 0 |
| `get_workspace_context` | 1 | 0 |
| `list_tasks` | 2 | 0 |
| `get_decision` | 1 | 0 |
| `get_finding` | 2 | 0 |
| `get_task` | 1 | 0 |

Discovery was called, before any workspace read. Queries, in order:

1. `continuing blocked work reviewing a decision basis` with `limit` 12 — failed validation (`Limit must be an integer from 1 to 10`).
2. `continuing blocked work reviewing a decision basis` with `limit` 10 — completed.
3. `basis` with `limit` 10 — completed.
4. `blocked` with `limit` 10 — completed.

`campfire capabilities --search` was not used. The successful discovery calls satisfy the discovery clause.

Recipe ids fetched with `get_read_recipe`: `continue-blocked-work`, then `review-decision-basis`. `campfire capabilities --recipe` was not used.

## Ids the answer named

- `task_cap001_blocked_later`, status blocked, not on the first page. First page returned 20 of total 21, `truncated` true, with a next cursor. The later page returned that one task (1 of 21, `truncated` true, no next cursor).
- `dec_cap001_selected`, accepted, not proposed, `needsReview` true.
- Cited `find_cap001_stale` superseded, so not current. That is why the decision needs review.
- Cited `find_cap001_current` stays current.

The tool results match those statements: `get_task` returned status `blocked` and assignee null; `get_decision` returned accepted and `needsReview` true with `needsReviewFindingIds` `find_cap001_stale`; the two `get_finding` calls returned `superseded` and `current`.

Quoted id and coverage sentences from the final answer:

> `task_cap001_blocked_later`, “Blocked work past the first page,” has status **blocked**. The first task page was **incomplete**: returned 20 of 21, `truncated: true`, with `nextCursor`. The next page returned this task: returned 1, total 21, `truncated: true`, with no next cursor.

> `dec_cap001_selected` is **accepted**, with **`needsReview: true`**.

> `find_cap001_stale`: **superseded**, hence non-current.

> `find_cap001_current`: **current**.

## Wrong inferences

No scoring miss. `needsReview` was not treated as revocation or as permission to act. No assignee was invented, and none was treated as a live person. Page 2 `truncated: true` with no next cursor was treated as the end of pagination, which matches the recipe, not as proof of another page.

One mild over-read: the final answer attributes “there are 21 blocked tasks against a default page budget of 20” to `find_cap001_current`. The page counts are right. The finding record itself only says a blocked task remains on a later page. That does not change currentness.

## Contribution count

`contributions` was 55 after seed and 55 after the session. The count stayed unchanged.

## Recipe follow-through

After discovery, the `continue-blocked-work` recipe text the model received did say to continue to `list_tasks` when orientation tasks are truncated. Its `get_workspace_context` step `stopWhen` was: if `slices.tasks.truncated` is true, or the selected task id is absent from `slices.tasks.items`, continue to `list_tasks`. The `review-decision-basis` recipe text did not mention `list_tasks`.

The model did that. After both recipes and `get_workspace_context` (tasks returned 20 of 21, truncated), it called `list_tasks` with no cursor, then `list_tasks` again with that page’s cursor, and then `get_task` for `task_cap001_blocked_later`.
