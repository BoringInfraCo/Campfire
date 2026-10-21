# CAP-001 harness smoke

**Date:** 2026-10-20  
**Label: FIXTURE EVIDENCE — usability check only.** Not a human observation, not a sprint verdict, and not a release. No product source was edited. This evidence file was committed later; no version was bumped during the smoke. `campfire up` was not run. Port 9414 was down before the runs and was still down after them.

The prompt was the same for both harnesses. It named no fixture id and included no tool inventory. Each harness had its own seeded database. Local `campfire mcp` was started with `CAMPFIRE_URL` and `CAMPFIRE_TOKEN` unset. A direct SQLite read confirmed `hum_cap001_ada` and `ws_cap001_lab` in each database before the model calls.

Real harness homes were not modified. mtimes for `[path]/.codex/config.toml`, `[path]/.codex/auth.json`, `[path]/.config/opencode/opencode.json`, and `[path]/.local/share/opencode/auth.json` matched before and after. Isolated homes received a copy of existing auth material so the CLIs could authenticate. Codex then wrote its own session files under the isolated `CODEX_HOME`.

**Preflight, before either model call.** An in-process MCP client spawned `node [path]/tsx/dist/cli.mjs [path]/src/cli/index.ts mcp` against each database. Both lists contained 40 tools, including `discover_capabilities` and `get_read_recipe`. `campfire capabilities --search "blocked work" --output json` did not need a database and returned `get_task`, `list_tasks`, and recipe summary `continue-blocked-work`.

**Score.** A pass needs the later blocked task `task_cap001_blocked_later` with status `blocked` and a first page that is truncated / not complete; decision `dec_cap001_selected` accepted with `needsReview` true because `find_cap001_stale` is not current; `find_cap001_current` still current; no write tools called; and discovery through `discover_capabilities` or `campfire capabilities --search`. A recipe fetch is a plus, not required when the reads are correct. Both databases still have 55 contributions, so neither session persisted a write.

## Codex — fail

| | |
| --- | --- |
| Binary | `codex-cli 0.163.0` |
| Command | `CODEX_HOME=[path] CAMPFIRE_DB=[path] CAMPFIRE_ACTOR_ID=hum_cap001_ada CAMPFIRE_ACTOR_TYPE=human CAMPFIRE_HARNESS=codex CAMPFIRE_TELEMETRY=0 codex exec --json --skip-git-repo-check --sandbox workspace-write --cd [path] --add-dir [path] --output-last-message [path]` |
| Model | `gpt-6.1-sol` (session record; not passed on the command line) |
| Duration | 37.95 s (`real` from `time`) |
| Exit code | 0 |
| Output size | JSONL stream 71,517 bytes; final answer file 1,021 bytes; stderr 82 bytes |
| Sandbox | `workspace-write` plus `--add-dir` for the database directory. MCP calls completed. No bypass rerun. |

Stderr also printed `Reading additional input from stdin...` because the process stdin was not a terminal. The turn still completed and the process exited 0. That was not a second run.

Completed Campfire MCP calls, no failures:

| Tool | Calls | Failed |
| --- | --- | --- |
| `list_workspaces` | 1 | 0 |
| `get_workspace_context` | 1 | 0 |

`discover_capabilities`, `get_read_recipe`, and `campfire capabilities --search` were not used. No write tool was called.

Ids: the later blocked task was **not** named, so its id and status were not established. The decision id was correct: `dec_cap001_selected`, accepted, `needsReview` true. `find_cap001_current` was called current from the context slice. `find_cap001_stale` was named as the review trigger, but its currentness was not read.

Quoted coverage from the final answer:

> The task slice returned 20 of 21, with `truncated: true` and a next cursor. The first page was not complete. I did not read the later page, so I cannot identify its task id or verify its status.

> `dec_cap001_selected` is accepted and has `needsReview: true`, identifying `find_cap001_stale` as the review trigger. `find_cap001_current` [is] visibly current. `find_cap001_stale` [currentness] was not read.

Wrong inference / gap: the session treated the truncated orientation as a stop, which the prompt allows, and so it never identified `task_cap001_blocked_later`. It also did not show that `needsReview` is specifically because `find_cap001_stale` is not current. It did not treat `needsReview` as revocation.

## OpenCode — ids pass; discovery requirement not met

| | |
| --- | --- |
| Binary | `opencode v2.1.1` |
| Command | `HOME=[path] XDG_CONFIG_HOME=[path] XDG_DATA_HOME=[path] XDG_STATE_HOME=[path] XDG_CACHE_HOME=[path] CAMPFIRE_DB=[path] CAMPFIRE_ACTOR_ID=hum_cap001_ada CAMPFIRE_ACTOR_TYPE=human CAMPFIRE_HARNESS=opencode CAMPFIRE_TELEMETRY=0 opencode run --standalone --auto --format json` from a temp directory, not the repo |
| Model | `opencode/big-pickle` (session record: provider `opencode`, id `big-pickle`) |
| Duration | 36.35 s (`real` from `time`) |
| Exit code | 0 |
| Output size | JSONL stream 156,947 bytes; final answer text 2,537 bytes; stderr 46 bytes (`time` only) |

`--standalone` and the isolated `HOME` / `XDG_*` homes were used so the run would not attach to the already running `opencode serve` or the real OpenCode config. The background server was left running and was not reconfigured.

Tool calls were eight `execute` calls, all completed, none failed. The Campfire operations inside them were reads:

| Operation | Calls | Failed |
| --- | --- | --- |
| harness `tools.search` (`namespace: campfire`) | 1 | 0 |
| `list_workspaces` | 1 | 0 |
| `get_workspace_context` | 1 | 0 |
| `list_tasks` (page 2 cursor) | 1 | 0 |
| `get_decision` | 1 | 0 |
| `get_finding` | 2 | 0 |
| `get_task` | 1 | 0 |

One earlier `execute` called `tools.opencode.list_mcp_resources`. No Campfire write tool was invoked. `campfire up` was not called. `get_activity` was not used as a history substitute.

Discovery bullet: **not met as specified.** The session did not call `discover_capabilities`, `get_read_recipe`, or `campfire capabilities --search`. It searched the harness tool index for the connected Campfire tools, then performed the reads. The reads match the answer key, so the usability result is a pass and the missing catalog call is recorded rather than treated as a wrong answer.

Ids were correct: `task_cap001_blocked_later` is `blocked`; the first task page was not complete (`total` 21, `returned` 20, `truncated` true); `dec_cap001_selected` is accepted with `needsReview` true because `find_cap001_stale` is superseded; `find_cap001_current` stays current. No material wrong inference. It did not treat `needsReview` as revocation or as permission to act, and it did not treat an assignee as a live person.

Quoted coverage from the final answer:

> `task_cap001_blocked_later` — status blocked. Was the first page complete? No. The orientation task slice reported total 21, returned 20, truncated true.

> `dec_cap001_selected` — accepted, not proposed. Needs review: yes — `needsReview: true`, `needsReviewFindingIds: ["find_cap001_stale"]`. Current: `find_cap001_current`. Not current: `find_cap001_stale` — `currentness: "superseded"`.
