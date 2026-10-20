# CAP-001 paired operations

**Date:** 2026-10-20  
**Label: FIXTURE EVIDENCE.** Not a one-to-one map of every command. Usage strings are copied from `src/cli/catalog.ts`. MCP names and inputs are copied from `src/mcp/tools.ts`.

## context ↔ get_workspace_context

CLI:

```text
campfire context [workspace] [--since <contributionId>] [--output auto|human|json]
```

MCP tool `get_workspace_context` inputs: `workspaceId`, optional `since`, optional `participants` (`omit` only).

Both call the bounded orientation read. Default task budget is 20 (`DEFAULT_CONTEXT_BUDGET.tasks`). Slices report `total`, `returned`, and `truncated`.

Not the same command:

- `campfire show <workspaceId> [--since <contributionId>] [--output auto|human|json] [--full]` is also an orientation projection. `--full` uses `get_workspace`. Do not treat `show` as `context`.
- `campfire status [workspace] [--output auto|human|json]` is a separate overview.
- `campfire agents [workspace] [--output auto|human|json]` calls `get_workspace_context` and projects recorded agents. It is not `list_workspace_participants`.

## tasks ↔ list_tasks

CLI:

```text
campfire tasks [workspace] [--status open|in_progress|blocked|completed] [--limit <n>] [--cursor <opaque>] [--output auto|human|json]
```

MCP tool `list_tasks` inputs: `workspaceId`, optional `limit`, `cursor`, `status`.

The CLI omits `limit` unless `--limit` is set. The service then uses `DEFAULT_CONTEXT_BUDGET.tasks` (20). MCP does the same when `limit` is omitted. Rank is blocked, then in progress, then open, newest first.

`campfire inspect task <id> --workspace <workspaceId>` calls `get_task`. The catalog usage for every kind is one string:

```text
campfire inspect <workspace|agent|goal|task|finding|decision|artifact|contribution> <id> --workspace <workspaceId> [--output auto|human|json]
```

Workspace, agent, goal, and contribution inspect still come from `get_workspace`. They are not `get_task`.

## decisions ↔ list_decisions

CLI:

```text
campfire decisions [workspace] [--status proposed|accepted|superseded] [--limit <n>] [--cursor <opaque>] [--output auto|human|json]
```

The catalog note says the default page size is 100. The handler sends `limit` `MAX_PAGE_SIZE` (100) when `--limit` is omitted.

MCP tool `list_decisions` inputs: `workspaceId`, optional `limit`, `cursor`, `status`. An omitted `limit` uses `DEFAULT_CONTEXT_BUDGET.decisions` (10), not 100.

`campfire inspect decision <id> --workspace <workspaceId>` calls `get_decision`. Same shared inspect usage as task inspect.

## inspect task ↔ get_task

CLI invocation: `campfire inspect task <id> --workspace <workspaceId> [--output auto|human|json]`.

MCP tool `get_task` inputs: `workspaceId`, `taskId`.

This read does not change status. A recorded assignee is not a live presence.

## Explicit non-pairs

| Surface | What it is | What it is not |
| --- | --- | --- |
| `campfire bridge [--output auto|human|json] [--db <path>] [--token <operator-token>]` | CLI-only operator delivery read. Catalog: "Does not print the signing secret and is not an agent MCP tool." | Not an MCP tool and not a grant. |
| `campfire dashboard [workspace]` | CLI-only interactive terminal. Protocol output. | Not an MCP tool. |
| `campfire help [command]` | CLI-only text. "Help stays text: --output does not change it." | Not an MCP tool. |
| `campfire capabilities [--output json]` | CLI manifest, `kind` `cli_command_manifest`. | Not MCP `tools/list`, and not a grant. |
| `get_record_history` | MCP-only. Inputs: `workspaceId`, `objectType` (`task`, `decision`, `finding`, `artifact`), `objectId`, optional `limit`, `cursor`. "Matching contributions only." | No CLI command. |
| `campfire activity [workspace] [--limit N] [--before <contributionId>] [--output auto|human|json]` and MCP `get_activity` | Workspace-wide contribution page. | Not `get_record_history`. |
| `list_workspace_participants` | MCP-only bounded roster. Optional `humanOwnerId`. | Not `campfire agents`. |
| `campfire playbook list\|incident-investigation [--output auto|human|json]` and MCP `get_playbook` | Opt-in. CLI `commandDiscoverable` hides `playbook` unless `CAMPFIRE_PLAYBOOK=1`. MCP registers `get_playbook` only when `playbookEnabled` is true. | Not one of the two read recipes. |

`tests/integration/mcp.test.ts` `EXPECTED_TOOLS` is an `arrayContaining` subset from an earlier tool list. The live playbook-off `tools/list` on this commit is 38 tools, not that array's length.
