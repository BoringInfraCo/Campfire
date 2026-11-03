# MAC-001B toolkit verdict — 2026-10-29

**Verdict: GPUIX.**

The Sunday read-only desktop alpha stays on the GPUIX shell. SwiftUI remains the earlier comparison prototype. This does not open the two-Mac exit, notarize a build, or start public distribution. See [tonight's closeout](CLOSEOUT-2026-10-29.md).

The founder inspected the running Campfire window on the evening of October 29 and accepted it. The window was the `7788220` shell, launched with `bun run dev:app` on Bun 1.4.2, against the Arbora Viewer at `127.0.0.1:9415` (`campfire up --no-open --no-connect`, config `~/.config/campfire-arbora`). That listener reported workspace `ws_df6794f33efc459b` (Arbora) and did not open a browser or replace a harness connection. The October 29 Viewer, desktop client, and CLI parity on that workspace still stands in [MAC-002 RESULT](../mac-002/RESULT.md).

A separate VoiceOver transcript was not recorded in this closeout. Keyboard, contrast, and Reduce Motion stay with CF-DESK-06. They do not reopen the toolkit choice.

## Prior verdict — 2026-10-27

**Verdict at that date: HOLD.**

This was a toolkit decision for the read-only Campfire slice. It did not open the MAC-002 two-Mac exit, distribute a Mac app, or claim the branded Cloud handoff or the two-Mac CLI update checks. A local read-only slice did not change that HOLD: [scope](../mac-002/SCOPE.md).

## What was compared

| Surface | What was observed |
| --- | --- |
| Viewer fixture | `POST http://127.0.0.1:9415/api/call` with no auth header. Workspace `ws_mac001_demo`, goal “Make shared work easy to inspect”, task `task_mac001_demo`, finding `find_mac001_demo`. Tasks 1 of 1 and findings 1 of 1, `truncated: false`. |
| GPUIX shell | Entry `apps/gpuix/src/main.tsx` renders only `CampfireShell`. Unit tests: 13 pass. A window titled Campfire opened in about 1.4 seconds on the second native-cache hit. Its body was not readable: window capture failed, the full-screen capture was black, and the accessibility tree exposed menu chrome (`Hide Campfire`, `Quit Campfire`, window title `Campfire`) but no Workspaces, Refresh, task, or finding controls. |
| SwiftUI baseline | [MAC-001 result](../mac-001/RESULT.md), October 25. The same fixture IDs, then a real Arbora read: `ws_df6794f33efc459b`, `task_3795d9d37d3842e9`, `find_5cd543722a044c20`, each complete 1 of 1. The accessibility tree exposed the workspace picker, refresh, and task and finding buttons. VoiceOver itself was not run. |
| Fresh real profile | Not run. Port 9415 was free before the fixture. `campfire up` was not started, because the October 25 run showed a plain `up` can refuse or disturb another profile’s harness. |

The GPUIX and SwiftUI apps were not open on one fresh authorized response together. The October 25 Arbora IDs stay historical.

## Remote

On the evening of 2026-10-27 the founder replaced `campfire-desktop` with a fresh clone at `5b88d4c7caccef523f14ecd54e7fa372fe34fa92` on `master`. `origin` fetches and pushes `https://github.com/BoringInfraCo/Campfire-Desktop.git`. The 1Git remote is named `upstream` and its push URL is disabled. Nothing was pushed. The Campfire repository is private and has only unrelated `main` commit `ecf3f42c2209944feb4da486ea2cc8125c84ac36`. Root `package.json` `repository.url` points at the Campfire repository and is uncommitted. The naming-pass commit `017f9c1` and the Campfire shell are not in this checkout. This does not change HOLD.

## Why not GPUIX

The contract selects GPUIX only when the read-only slice is real, accessible enough for the next alpha, and the native cost buys a material interface benefit.

- No authorized real-profile read was shown in the GPUIX window.
- The running window’s accessibility tree did not expose the shell body. VoiceOver was not run.
- The pixels of that window were not captured, so the fixture IDs are not claimed as displayed.
- The shell still builds through the 1Git GPUIX native patch stack, pinned Bun 1.4.2, and a Rust addon. That cost is not justified by an observed interface benefit. The Git product remains in the tree; the new entry simply does not start it.

## Why not SwiftUI as this sprint’s freeze

SwiftUI is the only candidate with a recorded real-profile read, and it did expose an accessibility tree. This sprint did not put that app and the GPUIX shell on the same fresh Viewer response. VoiceOver is still unobserved for both. Freezing SwiftUI here would skip the comparison the contract requires.

## What MAC-002 must not inherit

The two-Mac exit stays closed, and the toolkit stays unfrozen. A local read-only slice is not that exit. A later comparison needs all of the following before a toolkit can be frozen:

1. A user-started Viewer for the intended profile, with listener ownership checked, and no second profile’s harness replaced.
2. The same workspace, task, and finding IDs and counts from that Viewer, from SwiftUI, and from the GPUIX window text.
3. An accessibility tree or VoiceOver pass that can reach Refresh and the selected record in the GPUIX window.
4. A decision that the retained native patch stack is worth that result.

Details: [GPUIX run](GPUIX-RUN.md), [comparison checklist](COMPARISON-CHECKLIST.md), [upstream delta](UPSTREAM-DELTA.md), [stock build](STOCK-BUILD.md).
