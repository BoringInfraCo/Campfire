# MAC-002 RESULT — surface parity run

- Date / machine: 2026-10-29 (UTC). This Mac. Arbora remote profile via `CAMPFIRE_CONFIG_DIR=~/.config/campfire-arbora`. Started with `campfire up --no-open --no-connect` so the default Ada profile and harness configs were not touched. Viewer listened on `127.0.0.1:9415` (node). No browser was opened.
- Viewer version (GET /health) / CLI version: the installed Viewer returns HTTP 404 `Not found: /health`. The desktop client records that as "Viewer did not report a version" and does not treat it as a revoked workspace. CLI version was not probed with `campfire --version` (that flag can fall through to `cmdUp` on the installed binary).
- workspaceId: `ws_df6794f33efc459b` (Arbora)

| Check | Viewer | GPUIX client | CLI | SwiftUI | Verdict |
| --- | --- | --- | --- | --- | --- |
| workspace id/name | Arbora `ws_df6794f33efc459b` active | same | same | not opened | PASS for Viewer, desktop client, CLI |
| task ids/counts | `task_3795d9d37d3842e9` open, 1 of 1, not truncated; openTaskCount 1 | same slice | same slice and task page | not opened | PASS |
| finding ids/currentness | `find_5cd543722a044c20` current, 1 of 1 | same | same | not opened | PASS |
| decision bands/needs review | proposed 0, accepted 0, superseded 0, needs-review ids empty | same | same | not opened | PASS |
| artifact ids/type | empty slice, total 0 | same empty slice | same | not opened | PASS |
| attention reason ids | none returned | same | same | not opened | PASS |
| returned/total/truncated | task and finding slices 1/1 false; provenance 17, not truncated | same on the cells the client exposes | same, plus page reads | not opened | PASS on compared cells |
| contribution positions | activity page total 17 | orientation provenance total 17 | activity page total 17 | not opened | PASS |
| participants | 4 identities with roles and human owners. Page order is actor type then id. Context order is join order. | roster page is a separate read; orientation omits the roster and keeps omitted total 4 | context roster, same 4 identities | not opened | PASS after the harness compared the identity set, not display order |

- parity artifact: `prototypes/mac-002/out/parity-snapshot-ws_df6794f33efc459b-2026-10-29T02-27-21-359Z.json`
- Harness: exit 0. A==B compared 41, diffs 0. A==C compared 61, skips 27, diffs 0. Skips are cells only one surface's command returns (desktop context does not call `whoami` or the paged list commands; the raw Viewer snapshot does not call `campfire findings` / `decisions` / `artifacts` / `changes`). A later harness edit fails the run when a Viewer, desktop, or CLI leg reports an error. `--selfcheck` still skips the CLI leg on purpose. Alignment ids, citation ids, and append positions are still not cells. The desktop parser keeps `alignmentStatus` and drops the id lists.
- Selfcheck after the same harness edit: exit 0, A==B compared 41, diffs 0.
- stale / denied / revoked observations: a live `get_workspace_context` for `ws_not_a_member` is HTTP 404 `WorkspaceNotFound`. The desktop client classifies that as denied. A missing task on the real workspace (`task_missing`) is HTTP 404 `TaskNotFound` and stays a record error, so it does not clear the workspace. Stopping the Viewer, revoking this profile, and the second-profile revocation checklist were not performed. The component test still covers labeled stale data and denial clearing against a double.
- accessibility observations: not walked. VoiceOver was not enabled. The GPUIX window and the SwiftUI prototype were not opened in this run. Code now keeps Overview / Work / Decisions / Sources / People / Activity reachable while Needs You is selected, and the rail handles up/down. That is not an accessibility-tree pass.
- Two-Mac screen: NOT OBSERVED (separate gate)
- Toolkit verdict: unchanged HOLD. Preconditions 3 and 4 in `docs/evidence/mac-001b/VERDICT.md` are still open. This file does not edit that verdict.

## Fixes applied before the passing run

- Roster comparison uses identity, role, name, and recorded human owner, sorted. Join order and cursor order are not treated as different facts.
- The desktop snapshot now includes the artifacts slice, including an empty one.
- A missing record is not a workspace denial. A missing `/health` route is not a revoked workspace.
- "Show more participants" appends the next cursor page.
- An in-flight read cannot commit after a workspace switch or refresh. Catch-up `since` is sent only for the same workspace.
- A denial on roster, record, history, or activity clears the shell.
- Superseded summaries with no recorded status render "status unrecorded". Missing finding currentness renders "currentness unrecorded". An agent with no `humanOwnerId` says "no recorded owner".
- Overview is a real section (workspace id, status, goal, slice counts). Recent changes fall back to the orientation change window when provenance is empty. Decision headings keep returned-of-total when rows are visible.
