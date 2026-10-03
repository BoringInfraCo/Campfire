# Campfire — Sprint CTX-001 Result: Keep Shared Understanding Current

**Status:** Local release candidate. Not tagged, not published, not deployed.

**Decision:** GO for the CTX-001 release gate on one machine. This is not Gate B, Gate C, or Gate F.

**Date:** October 3, 2026

**Package version:** `1.10.0` (working tree)

**Contract:** `docs/Campfire-v1.10-CTX-001-Keep-Shared-Understanding-Current.md`

## 1. Outcome and evidence boundary

A participant can orient on the current workspace, drill into one object page or one object, and catch up from an opaque cursor. Every bounded collection reports `total`, `returned`, and `truncated`. Authorization runs before the read. `get_workspace` still returns the full inspector.

An earlier candidate ordered catch-up by `created_at, id`. Contribution ids are random, so a later row with the same timestamp and a lexicographically smaller id was skipped forever. That candidate was NO-GO. Catch-up now pages by a durable per-workspace `append_position`. Each catch-up run freezes an inclusive stream tip, finishes the material phase and the normal phase through that tip, and returns a completion cursor whose position is the tip and whose tip is clear. The next run starts after it.

The release gate below is one human operator and one Codex agent on one machine. The Vault workspace existed so the unauthorized path could be probed. It is not a second person and not a second machine.

## 2. What landed

| Surface | Behavior |
| --- | --- |
| Orientation | `get_workspace_context` reads counts and limited pages. Default budgets: goals 1, decisions 10, findings 10, tasks 20, blockers 10, artifacts 10, recent changes 20. |
| Catch-up | `get_workspace_changes` pages high-material changes first, then normal changes, inside one frozen append-position tip. |
| Drill-down | `list_decisions`, `list_findings`, `list_tasks`, `list_artifacts`, and `get_decision`, `get_finding`, `get_task`, `get_artifact`. |
| CLI | `context`, `catch-up`, `findings`, `tasks`, `artifacts`. `decisions` is paged. `show` stays the orientation. `inspect` of those four kinds loads one row. |
| MCP and HTTP | The same method names on both dispatch tables. Viewer read allowlists are unchanged. No new telemetry events. |
| Schema | SQLite migration version 6 and D1 `migrations/0005_contribution_append_position.sql`. Existing rows are backfilled in journal order (`created_at`, `rowid`) with positions starting at 1. New inserts take `MAX(append_position) + 1` for that workspace. Historical payloads are not rewritten. |

SQLite and D1 execute the same page SQL from `src/store/context-queries.ts`. `since` and activity windows still follow `created_at, rowid`.

### Decisions worth keeping

- A missing task status is normal, not dropped. The materiality predicate is a `CASE` that is always 0 or 1, because `json_extract(...) IN (...)` is NULL when the key is absent and `NOT NULL` matches nothing.
- Orientation keeps the newest material rows inside a 100-row lookahead. That view is not a keyset page, so `recentChanges` reports truncation without a continuation cursor. Forward catch-up uses `orientationCursor`.
- When accepted decisions would fill a budget of at least 2, one slot stays open for a proposed decision. The list endpoint uses one keyset and does not apply that reserve.
- Findings have no task or decision foreign key. Artifact rank uses `Finding.sourceArtifactId` only.

## 3. Release gate

Disposable database `/tmp/cf-ctx001-gate-7f3a/data/gate.db`. Loopback server `http://127.0.0.1:19521`. Codex 0.150.1, model `gpt-5.6-sol`, high reasoning, isolated `CODEX_HOME`, read-only sandbox, Campfire MCP over HTTP with the agent token. The prompt did not contain a prepared summary. The agent made no writes.

Harbor ledger `ws_f20e8c6b38624f15` held an active goal, 13 accepted decisions, 4 proposed decisions, 14 findings, 22 open tasks, 2 blocked tasks, 1 completed task, and 12 artifacts. A cursor was saved from orientation before the later delta. Vault `ws_9447611c37a04c21` belonged to the same human and not to the agent. Its finding was readable with the human token and absent from every agent response.

### Scenario A — cold participant

Codex called `get_workspace_context`, then `list_decisions`, `list_findings`, `list_tasks`, `list_artifacts`, and two `get_activity` pages. From Campfire alone it named:

1. Goal: “Keep the harbor ledger reconcilable”.
2. Accepted harbor rules 1–12 and “Pin the tide table to revision 4”. Proposed chalkboard notes 1–3 and “delay the foghorn change”.
3. The missing March tide table, the stale-table row loss, and harbor findings 1–12.
4. Blockers: “Harbor export is blocked on the missing tide table” and “Reload the March export”.
5. 22 open tasks, tasks 6–8 retitled, and the completed February archive.
6. The twelve artifacts, the revision-4 decision, the stale-table finding, the blocked reload, and the completed archive. It also listed the chalkboard notes and title edits in that same section.
7. Truncation matching the workspace after the delta: decisions 10/17, findings 10/14, tasks 20/25, blockers 2/2, artifacts 10/12, recent changes 20/92.
8. Next hint: proposed “Harbor chalkboard note 3”, plus the two unassigned blocked export tasks.

### Scenario B — returning participant

The saved cursor was the only history given to the agent. It called `get_workspace_changes` once, then `get_decision`, `get_finding`, and `get_task` for the four high-material ids. It did not call `get_workspace` or `get_workspace_context`.

Material changes it named: accept “Pin the tide table to revision 4”; finding “The March export dropped rows when the tide table was stale”; blocked task “Reload the March export”; completed task “Archive the February export”.

Normal changes it separated: the creates behind those objects, three proposed chalkboard notes, and three title-only task updates. The page had 13 changes and was not truncated.

### Scenario C — unauthorized participant

`list_workspaces` returned only Harbor ledger. `get_workspace_context` and `get_workspace` on the Vault id returned HTTP 403 `ParticipantRequired`: “Actor agt_11a4bad146f641c8 is not a participant of workspace ws_9447611c37a04c21”. The same denial came back from an operator `list_findings` call with the agent token. None of those bodies contained the Vault name, goal, description, or finding. The Vault id was supplied in the prompt so the read could be attempted. Orientation did not reveal it.

## 4. Engineering validation

Node.js 22.23.2.

| Step | Command | Result |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | clean, exit 0 |
| Full suite | `npm test` | 67 files, 800 tests, exit 0 |
| Package | `npm run pack:tarball` | `release/campfire-darwin-arm64.tar.gz`, sha256 `5b1ae5d731240772d27f05aa90cb1dd5eccc803e2f8dc8bb306be2374173db7c`, installer `public/campfire/v1.10.0/install.sh` |
| Deploy dry-run | `npm run deploy:dry-run` | Wrangler exited at `--dry-run` before upload. Bindings were DB, TELEMETRY, and ASSETS. |

`scripts/package.sh` resolves the project root with `realpathSync`. On this case-insensitive volume, `pwd` and `npm ls` disagreed on path case, and the pack rejected every dependency line until those paths matched.

## 5. Not in this change

- No private tag, public snapshot, GitHub Release, or Worker deploy.
- No second human, second machine, or OpenCode pass. Gate B, Gate C, and Gate F remain unmeasured.
- No embeddings, supersession workflow, Viewer write path, or new memory model.
- `listWorkspaces` still counts open tasks by reading the task table. That was left as it was.
