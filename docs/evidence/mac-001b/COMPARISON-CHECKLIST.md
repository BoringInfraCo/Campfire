# MAC-001B comparison checklist

**Date:** 2026-10-27. Preparation only. No toolkit verdict.

Compare the isolated GPUIX shell with the MAC-001 SwiftUI baseline on one dated evidence report. Use the same MacBook, the same authorized actor, and the same Viewer response for GPUIX, SwiftUI, and a Viewer/CLI read. Record IDs, returned/total counts, and what each surface showed. A code path that was not run stays **unobserved**. Fixture data may prove the renderer. A verdict needs one authorized real-profile read. Do not publish, invite, deploy, write workspace data, or push. Do not change a workspace so the IDs match.

Both shells use only `POST http://127.0.0.1:9415/api/call` with `list_workspaces` and `get_workspace_context`. No bearer, no Campfire SQLite or profile files, no direct Worker call, no write. The SwiftUI client sends `participants: omit` on the context read and cannot follow a custom `--viewer-port`. Probe listener ownership with `lsof` before trusting the port. Do not connect to an unrelated process. Do not run the fixture Viewer beside a user's Viewer.

## Listener — 2026-10-27

`lsof -nP -iTCP:9415 -sTCP:LISTEN` exited 1 with no output. Nothing is listening on TCP 9415, including 127.0.0.1:9415. There is no process command. Nothing on that port contains `campfire` or `fixture-viewer`. No HTTP request was sent. This note did not start or stop Campfire.

Before a comparison run, probe again. Treat the listener as the fixture only when the command is `fixture-viewer`. Treat it as the real profile only when the command is the intended Campfire Viewer. Any other command is not evidence.

## IDs that must match

Match workspace, task, and finding IDs plus returned/total counts across Viewer/CLI, SwiftUI, and GPUIX. Also record the goal text, truncation, and the selected record's title or summary, status or currentness, source ID, and detail.

### Fixture

Served by `prototypes/mac-001/fixture-viewer.mjs` through the real Viewer proxy. Fixed public records only.

| Record | ID | Expected display |
| --- | --- | --- |
| Workspace | `ws_mac001_demo` | Campfire demo, active |
| Goal | `goal_mac001_demo` | Make shared work easy to inspect |
| Task | `task_mac001_demo` | Review the shared finding; open; description "A bounded task returned by the Viewer." |
| Finding | `find_mac001_demo` | The second teammate can continue from shared work.; current; detail "The app displays this record only after an actor-bound Viewer read." |

Counts: tasks **1 of 1**, findings **1 of 1**, `truncated: false`. No partial-overview label. `list_workspaces` reports `openTaskCount` 1.

### Real profile — October 25, historical

From [MAC-001 RESULT](../mac-001/RESULT.md). Installed 1.26.2 candidate with `CAMPFIRE_CONFIG_DIR=~/.config/campfire-arbora`. The user started the remote Viewer with `up --no-open --no-connect` after a plain `up` refused to replace another profile's harness. The Viewer bound 127.0.0.1:9415.

| Record | ID | October 25 count |
| --- | --- | --- |
| Workspace | Arbora `ws_df6794f33efc459b` | one open task on the remote status |
| Task | `task_3795d9d37d3842e9` | complete **1 of 1** |
| Finding | `find_5cd543722a044c20` | complete **1 of 1** |

SwiftUI then showed Arbora, the goal, and Tasks 1 of 1 / Findings 1 of 1. The selected task showed its scoped implementation description and original finding reference. The selected finding showed its current detail. Those strings are not quoted in RESULT.md. The remote status also reported two humans and two agents; that is not part of the task/finding slice.

**Those real IDs are historical. A fresh read wins if the workspace changed.** Compare both shells to that fresh Viewer/CLI read. Keep the October 25 IDs as the last known Arbora slice, not as a required match after the data moves.

## What both shells must show

One window, three areas:

1. Rail: **Workspaces**, **Needs You**, **People & Agents**. Only Workspaces must navigate. Other labels may show as nonfunctional and must not imply new Campfire capabilities.
2. List of the actor's authorized workspaces and the selected workspace.
3. Main surface: goal, bounded task/finding counts, and one selected task or finding detail. Only claims the records support. If change or attention data is missing, label that section unavailable or incomplete. Do not invent a summary.

States must be distinct: loading, empty, denied, stale/unreachable, incomplete page. A lost Viewer may keep the last good projection only with an explicit stale label. SwiftUI's observed stale text was `Stale view · Viewer unreachable. Run campfire up, then refresh.` A denied read or a workspace switch clears the old selection. Refresh works from the keyboard and from a control. SwiftUI binds ⌘R. Selected records expose an inspectable label and the source ID. Late responses after a workspace or selection change are ignored.

Exercise, and mark unobserved if skipped: keyboard selection, refresh, accessibility tree, VoiceOver where available, stale Viewer, denied response, empty list, incomplete context, workspace change. MAC-001 did not test VoiceOver navigation. Revoked-list and denied-context clearing were code-reviewed, not exercised against a real revocation.

## Dimensions

Record numbers and observations, not a preference. Same actor and the same task/finding IDs in the report.

| Dimension | Required evidence |
| --- | --- |
| Build and maintenance | Reproducible clean build; pinned Bun, GPUIX/GPUI, and patch stack; retained dependency and license inventory; estimated work to maintain upstream patches. |
| Runtime | Cold launch and steady memory for this screen; app bundle size; crashes or rendering failures. |
| Native usability | Keyboard, focus, readable layout, accessibility tree, and actual VoiceOver where available. Unobserved checks stay open. |
| Data and safety | Same actor and record IDs/counts; source/currentness and page-completeness labels; denied, stale, empty, and workspace-change behavior; no bearer, SQLite, direct Worker call, or write path. |
| Product fit | Time and code to express Workspaces / Needs You / People & Agents without carrying the Git product model. |
| Packaging | Local `.app` launch and signature check if built. No notarization, installer, update, or iMac claim. |

## Verdict rule — do not apply in this note

Choose **GPUIX** only if the read-only slice is real, accessible enough, and the native cost buys a material interface benefit. Choose **SwiftUI** if it gives the same result with lower risk or effort. Choose **HOLD** if neither meets the Viewer, data, accessibility, or maintenance boundary. Explain missing evidence and what MAC-002 would have to close. This checklist does not choose one.
