# MAC-001B GPUIX fixture run

**Date:** 2026-10-27, about 01:18–01:25 EDT. macOS 26.6.2 (`25G83`). This note does not choose GPUIX, SwiftUI, or HOLD.

No push, no commit, no `campfire up`, no publish, invite, or deploy. No SQLite, profile, or hosted Worker. The source entry was not edited. A real-profile listener was not present and was not started.

## Checkout and toolchain

| Check | Result |
| --- | --- |
| App checkout | `/Users/sergio/Documents/Developer/BoringInfraCo/campfire-desktop` |
| HEAD | `017f9c1dd584c39863f33abb26b44cfbada05ffb` |
| Worktree | Already dirty before and after this run: `M apps/gpuix/src/main.tsx`, untracked `apps/gpuix/src/campfire/` and `apps/gpuix/tests/campfire/`. This run did not edit those files. |
| Entry | `bun run dev:app` → turbo `dev` for `@campfire-desktop/gpuix` → `bun --preload ./native/preload.ts --hot src/main.tsx`. `src/main.tsx` renders `CampfireShell` at 1280×820, title `Campfire`. |
| Pinned bun | `/tmp/mac-001b-bun-1.4.2/bun-darwin-aarch64/bun` printed `1.4.2`. Prepended to `PATH` only for the launch shell. Global bun was not upgraded. |
| Process image | `lsof` text segment for the shell pid was `/private/tmp/mac-001b-bun-1.4.2/bun-darwin-aarch64/bun`. |
| Node | `v22.23.2`, used only for the fixture. |
| Env | `CAMPFIRE_VIEWER_PORT`, `CAMPFIRE_CONFIG_DIR`, and `GPUIX_BACKGROUND` were unset. |

## Listener

Before the fixture, `lsof -nP -iTCP:9415 -sTCP:LISTEN` exited with no listener. Nothing was connected to.

Fixture command, from `Campfire-Internal` so `../../dist/src/viewer/server.js` resolves:

```sh
cd /Users/sergio/Documents/Developer/BoringInfraCo/Campfire-Internal && node prototypes/mac-001/fixture-viewer.mjs
```

Stderr (`/tmp/mac-001b-fixture.log`): `MAC-001 fixture Viewer listening on http://127.0.0.1:9415`.

Before either POST, `lsof -nP -iTCP:9415 -sTCP:LISTEN` showed `node` pid `28240` on `127.0.0.1:9415`. `ps -p 28240 -ww -o command=` was `node prototypes/mac-001/fixture-viewer.mjs`, which contains `fixture-viewer`. The same command still owned the port immediately before `bun run dev:app`.

## Viewer JSON

Both calls were `POST http://127.0.0.1:9415/api/call` with `Content-Type: application/json` and no auth header. Both returned HTTP 200.

`{"method":"list_workspaces","params":{}}`

```json
{
  "ok": true,
  "result": [
    {
      "id": "ws_mac001_demo",
      "name": "Campfire demo",
      "status": "active",
      "goalTitle": "Make shared work easy to inspect",
      "openTaskCount": 1,
      "updatedAt": "2026-10-25T00:00:00.000Z"
    }
  ]
}
```

One workspace. `openTaskCount` is 1. This method does not return a `returned`/`total` pair.

`{"method":"get_workspace_context","params":{"workspaceId":"ws_mac001_demo","participants":"omit"}}`

| Record | ID | Other returned fields |
| --- | --- | --- |
| Workspace | `ws_mac001_demo` | name `Campfire demo`, status `active`, team `team_mac001_demo` |
| Goal | `goal_mac001_demo` | title `Make shared work easy to inspect`, status `active` |
| Task | `task_mac001_demo` | title `Review the shared finding`, status `open`, description `A bounded task returned by the Viewer.` |
| Finding | `find_mac001_demo` | summary `The second teammate can continue from shared work.`, currentness `current`, detail `The app displays this record only after an actor-bound Viewer read.` |

Slice counts from that JSON, all `truncated: false`:

| Slice | returned | total |
| --- | --- | --- |
| tasks | 1 | 1 |
| findings | 1 | 1 |
| decisions | 0 | 0 |
| blockers | 0 | 0 |
| artifacts | 0 | 0 |
| recentChanges | 0 | 0 |

`schemaVersion` 1, `orientationCursor` `con_mac001_demo`, `generatedAt` `2026-10-25T00:00:00.000Z`, `completeness.fullHistoryIncluded` false, `completeness.drillDownAvailable` true. These match the unchanged fixture. The window was not observed showing them.

## Launch

```sh
cd /Users/sergio/Documents/Developer/BoringInfraCo/campfire-desktop
PATH="/tmp/mac-001b-bun-1.4.2/bun-darwin-aarch64:$PATH" bun run dev:app
```

One launch. Log copy: `/tmp/mac-001b-campfire-shell.log`. Native build logged `Local GPUIX native build is up to date.` Then:

```text
@campfire-desktop/gpuix:dev: [gpuix] created native window
@campfire-desktop/gpuix:dev: [gpuix] mount complete
```

A timestamp printed immediately before `exec bun run dev:app` was `1793078419.436050` (process `lstart` `Tue Oct 27 01:20:19 2026`). The log file’s mtime when those two lines were already the end of a 1199-byte flush was `1793078420.807088`, **1.371 seconds** later. There is no per-line timestamp. Time to `[gpuix] created native window` is at most 1.371s from that pre-exec stamp; `mount complete` is the next line in the same flush. The 8-minute timeout was not reached. No crash, panic, or render-failure line appeared before shutdown.

Shell pid `28292`: `bun --preload ./native/preload.ts --hot src/main.tsx`. RSS was 149424 KB at about 1 minute elapsed and 158304 KB at about 4 minutes 9 seconds. Cold RSS at the window line was not sampled.

## Window

`CGWindowListCopyWindowInfo` found one bun window:

`wid=7456` `layer=0` `onScreen=true` `pid=28292` `alpha=1.0` `owner=bun` `name=Campfire` `x=116` `y=81` `w=1280` `h=820`.

No second bun window was listed, so no separate open-repository or account dialog window was present. Contents inside the one window were not readable from the window list.

`screencapture -l 7456 -o /tmp/mac-001b-campfire-shell.png` failed with `could not create image from window` (exit 1). A rectangle capture of `116,81,1280,820` failed with `could not create image from rect`. The same window-id capture after Command-R failed the same way. None of these files exist:

- `/tmp/mac-001b-campfire-shell.png`
- `/tmp/mac-001b-campfire-shell-selected.png`
- `/tmp/mac-001b-campfire-shell-stale.png`

No PNG was saved, so there is no image in this note for a separate human read. Body strings are not quoted from pixels.

## Accessibility

`AXIsProcessTrusted` was true for the probe. A short query of pid `28292` succeeded for `AXRole` (`AXApplication`) and for one `AXWindows` entry. That entry’s role is `AXApplication`, title `bun`, not `AXWindow`. Its non-menu child is another `AXApplication` titled `bun`, nested until a depth cap. `AXFocusedUIElement`, `AXMainWindow`, and `AXFocusedWindow` are the same shape. No `AXButton`, `AXStaticText`, or `AXText` node was returned. These strings were absent from that tree: `Workspaces`, `Review`, `finding`, `Refresh`, `Campfire demo`, `Viewer`, and `Stale`.

The menu bar, walked on an earlier 8-second query that hit its node budget inside system menus, did expose app chrome only: bun menu items `Hide Campfire` and `Quit Campfire`, and a Window menu item titled `Campfire`. That is not the shell body.

Task and finding rows were not pressed. There was no label to target, and nothing was clicked at random. Selection is unobserved.

The same non-menu walk after Command-R still had no stale sentence.

## Stale attempt

The fixture was stopped by itself. `lsof` then showed nothing on TCP 9415, and that was checked again immediately before the key. Command-R was not sent through the HID tap. A `CGEvent` with virtual key 15 and `maskCommand` was `postToPid(28292)` for key-down and key-up. The poster printed `posted_cmd_r_to_pid=28292` and exited 0. After 2 seconds the window id `7456` was still on screen, the shell pid was still alive, port 9415 was still free, and the app log had no new line after `mount complete`.

The live stale sentence was **not** observed. Do not treat this as the window showing `Stale view · Viewer unreachable. Run campfire up, then refresh.` The unit tests are a different run. Whether the GPUI key handler received the posted event is also unobserved.

## Exit

The dev process did not exit by itself. It was terminated after the checks. The captured turbo log ends with:

```text
Shutting down Turborepo tasks...
Force killed Turborepo tasks: @campfire-desktop/gpuix#dev

 Tasks:    4 successful, 5 total
Cached:    3 cached, 5 total
  Time:    4m24.637s
```

That 4m24.637s is the whole turbo session, not time-to-window. The fixture was already gone; its log never grew past the listening line.

Afterward, `lsof -nP -iTCP:9415 -sTCP:LISTEN` showed nothing, and no `bun --preload ./native/preload.ts --hot src/main.tsx` process remained. No crash was observed.

## Not observed

- Pixels and any body string in the Campfire window, including workspace, goal, task, finding, counts, and the stale sentence. Screen capture failed; no PNG.
- Selecting the task row or the finding row. No second screenshot.
- Proof that Command-R refreshed the shell, beyond a successful `postToPid`.
- VoiceOver.
- Keyboard selection other than the unconfirmed Command-R post.
- Denied response, empty workspace list, incomplete context, and workspace change. The fixture has one workspace and was not altered.
- A real-profile or authorized-actor read. Port 9415 was free at the start; `campfire up` was not run.
- Cold-launch RSS at the window line, steady-state memory beyond the two RSS samples, app bundle size, and signature.
- Whether the running shell’s own POSTs matched the JSON above. The fixture does not log requests, and the window text was not readable.

## Second capture — 2026-10-27, about 01:26 EDT

The fixture and `bun run dev:app` were started once more after this note. The listener command was again `node prototypes/mac-001/fixture-viewer.mjs` on `127.0.0.1:9415`. The log again printed `[gpuix] created native window` and `[gpuix] mount complete`. Window `7469` was on screen, owner `bun`, name `Campfire`. `screencapture -l 7469` failed again with `could not create image from window`. A full-screen `screencapture -x /tmp/mac-001b-screen.png` wrote a file whose pixels are black, including where the menu bar and window would be, so it is not a reading of the shell. Both processes were then stopped. Port 9415 was free afterward. Body text remains unobserved.

## Accessibility re-check — 2026-10-27

Port 9415 was free. `node prototypes/mac-001/fixture-viewer.mjs` from Campfire-Internal listened as pid `44938`; `ps` showed `node prototypes/mac-001/fixture-viewer.mjs`, which contains `fixture-viewer`. `PATH="/tmp/mac-001b-bun-1.4.2/bun-darwin-aarch64:$PATH" bun run dev:app` then printed `[gpuix] created native window` and `[gpuix] mount complete`. The shell pid was `44964` (`bun --preload ./native/preload.ts --hot src/main.tsx`).

`/tmp/mac-001b-axfind 44964` was trusted and returned one `AXWindows` entry. That entry is still `AXApplication` titled `bun`, not `AXWindow`. Its non-menu child is another `AXApplication` titled `bun`, nested through the walker’s depth cap (`d=12`). The sibling at each level is `AXMenuBar`. `/tmp/mac-001b-axwalk` hit the same shape and then spent its node budget in system menus. Those menus still include `Hide Campfire`, `Quit Campfire`, and a Window item titled `Campfire`. `/tmp/mac-001b-axextra` showed `AXFocusedUIElement`, `AXMainWindow`, and `AXFocusedWindow` as the same nested `AXApplication` titled `bun`, plus a menu bar. No `AXButton`, `AXHeading`, `AXStaticText`, or `AXParagraph` was returned.

The walked tree did not contain `Workspaces`, `Refresh`, or `task_mac001_demo`. The shell body is still not in this accessibility tree. This note does not change the HOLD verdict.

Both processes were then stopped. `lsof` showed nothing listening on TCP 9415, and no fixture-viewer or `src/main.tsx` process remained.

## Accessibility signature dump — 2026-10-27, about 10:26–10:28 EDT

The earlier walkers treated `AXUIElement` pointer identity as stable. This pass did not. `/tmp/mac-001b-axdump.swift` records a node by role, title, position, and child count, prints that node, and does not recurse into a signature already described. No shell, preload, or native code was changed. `VERDICT.md` was not changed.

Port 9415 was free. From `Campfire-Internal`:

```sh
node prototypes/mac-001/fixture-viewer.mjs
```

Log: `MAC-001 fixture Viewer listening on http://127.0.0.1:9415`. `lsof` showed `node` pid `49790` on `127.0.0.1:9415`. `ps -p 49790 -ww -o command=` was `node prototypes/mac-001/fixture-viewer.mjs`, which contains `fixture-viewer`. That was checked before the app launch.

```sh
cd /Users/sergio/Documents/Developer/BoringInfraCo/campfire-desktop
PATH="/tmp/mac-001b-bun-1.4.2/bun-darwin-aarch64:$PATH" bun run dev:app
```

Pinned bun is 1.4.2. The shell text segment was `/private/tmp/mac-001b-bun-1.4.2/bun-darwin-aarch64/bun`. The log printed `[gpuix] created native window` and `[gpuix] mount complete`. Shell pid `49831`: `bun --preload ./native/preload.ts --hot src/main.tsx`.

`/tmp/mac-001b-axdump 49831` was trusted. Depth 1 of `AXWindows` is a real window, not a nested `AXApplication` titled `bun`:

```text
AXWindows[0] d=1 role=AXWindow subrole=AXStandardWindow title=Campfire desc=err:-25205 value=err:-25205 id=err:-25212 pos=116.0,81.0 children=4 children_err=0
```

`AXFocusedWindow` and `AXMainWindow` are the same window (`role=AXWindow`, `title=Campfire`, `pos=116.0,81.0`, `children=4`). `AXFocusedUIElement` is that window too. The old pointer walk never reached these children; it re-entered `AXApplication` titled `bun` until its depth cap. That report was wrong. The body is already in the macOS tree.

Quoted controls and fixture text from the same dump:

```text
AXWindows[0].0.0.1.0 d=5 role=AXButton subrole=AXUnknown title=Workspaces desc=err:-25212 value=err:-25212 id=err:-25212 pos=132.0,137.0 children=1 children_err=0
AXWindows[0].0.0.3.0 d=5 role=AXButton subrole=AXUnknown title=Refresh Campfire workspace desc=err:-25212 value=err:-25212 id=err:-25212 pos=638.0,141.0 children=1 children_err=0
AXWindows[0].0.0.2.1 d=5 role=AXButton subrole=AXUnknown title=Campfire demo, active, ws_mac001_demo desc=err:-25212 value=err:-25212 id=err:-25212 pos=353.0,163.0 children=2 children_err=0
AXWindows[0].0.0.3.2 d=5 role=AXGroup subrole=AXUnknown title=err:-25212 desc=err:-25212 value=Workspace ws_mac001_demo · active id=err:-25212 pos=638.0,215.0 children=0 children_err=0
AXWindows[0].0.0.3.11 d=5 role=AXButton subrole=AXUnknown title=Review the shared finding, open, task_mac001_demo desc=err:-25212 value=err:-25212 id=err:-25212 pos=638.0,411.0 children=2 children_err=0
```

`AXFocusedWindow` repeated those same `Workspaces`, `Refresh Campfire workspace`, `ws_mac001_demo`, and `task_mac001_demo` lines. Full dump: `/tmp/mac-001b-axdump.txt`.

Both processes were then stopped. `lsof -nP -iTCP:9415 -sTCP:LISTEN` showed nothing, and no `fixture-viewer` or `src/main.tsx` process remained.
