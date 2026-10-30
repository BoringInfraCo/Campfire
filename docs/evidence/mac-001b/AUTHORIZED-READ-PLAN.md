# Authorized Arbora Viewer read — plan only

**Date:** 2026-10-27. This note does not perform the read. It does not start Campfire, run `campfire up`, POST to a listener, edit `campfire-desktop`, push, or choose a toolkit verdict. The current toolkit verdict remains **HOLD** in [VERDICT.md](VERDICT.md). A later read still has to meet the comparison in [COMPARISON-CHECKLIST.md](COMPARISON-CHECKLIST.md). October 25 IDs below are historical; the fresh response wins if the workspace changed.

## What this session checked

| Check | Result |
| --- | --- |
| `command -v campfire` | `/Users/sergio/.local/bin/campfire` |
| `campfire --version` | Not run. See version note below. |
| `campfire up --help` | Not run. Usage text was read from the installed catalog. Help returns before `cmdUp`. |
| Config directories | Names only. No profile, credential, or publication file was opened. |
| TCP 9415 | `lsof -nP -iTCP:9415 -sTCP:LISTEN` exited 1 with no output. Nothing is listening. No HTTP request was sent. |
| Pinned bun | `/tmp/mac-001b-bun-1.4.2/bun-darwin-aarch64/bun` exists and printed `1.4.2`. Campfire was not involved. |
| GPUIX checkout | `/Users/sergio/Documents/Developer/BoringInfraCo/campfire-desktop`. `dev:app` is `turbo run dev --filter=@campfire-desktop/gpuix`. Not launched. |

## Installed CLI, and why `--version` was skipped

`/Users/sergio/.local/bin/campfire` is a shell wrapper. It `exec`s `node` on `/Users/sergio/.local/lib/campfire/dist/src/cli/index.js`. That install's `package.json` `version` field is `1.26.1`.

`campfire --version` was not run. In this installed `runCli`, `--help` returns before any command handler, but `--version` does not. With no command it falls through to `cmdDefault`. That path can print a profile status, and on a machine with no profile it can record a human and then call `cmdUp`, which starts a listener. The current Campfire-Internal source does return early on a bare `--version`; the installed dist does not. Do not use `--version` on this binary to identify it.

[MAC-001 RESULT](../mac-001/RESULT.md) called the October 25 install a 1.26.2 candidate and recorded the Arbora read under `CAMPFIRE_CONFIG_DIR=~/.config/campfire-arbora`. This plan does not re-prove that version string by executing the CLI. Use the binary that is already on `PATH` at the path above. Do not rebuild or replace it for this read.

## Profile directory

`resolveProfilePaths` uses `CAMPFIRE_CONFIG_DIR` when it is set. Otherwise it uses `$XDG_CONFIG_HOME/campfire`, or `~/.config/campfire` when `XDG_CONFIG_HOME` is unset.

Directories present under `~/.config` on this machine:

| Directory | Role for this read |
| --- | --- |
| `~/.config/campfire-arbora` | Intended Arbora profile. October 25 remote Viewer was started with this directory. |
| `~/.config/campfire` | Default profile. RESULT.md: a bare `campfire` selected an unrelated old Ada profile with a revoked token. Do not use it. |
| `~/.config/campfire-prod-alpha` | Sibling. Not this read. |
| `~/.config/campfire-prod-alpha-decline` | Sibling. Not this read. |
| `~/.config/campfire-prod-alpha-recipient` | Sibling. Not this read. |
| `~/.config/campfire-prod-alpha-v2` | Sibling. Not this read. |

Set `CAMPFIRE_CONFIG_DIR` to the absolute Arbora directory for the one Viewer process. Do not open those directories' files, and do not print tokens or bearer secrets. Do not point the read at a sibling.

## Start only the loopback Viewer

Flags still present in the installed catalog usage string and in installed `cmdUp`:

```text
campfire up [--no-connect] [--no-open] [--port 9414] [--viewer-port 9415] [--output auto|human|json]
```

`parsed.flags.help === true` returns from `printHelp` before `maybeReportPackageManagerInstall` and before `cmdUp`. `applyDbFlag` only sets `CAMPFIRE_DB` when `--db` is a non-empty string. `campfire up --help` without `--db` does not start a listener. It was not executed; the usage line above is from `/Users/sergio/.local/lib/campfire/dist/src/cli/catalog.js`.

In installed `cmdUp`, `--no-connect` skips harness preparation (`connect` is false). `--no-open` skips `openLoopbackUrl`. The default viewer bind is `127.0.0.1:9415` (`DEFAULT_VIEWER_HOST` / `DEFAULT_VIEWER_PORT`). Do not pass `--viewer-port`. The SwiftUI prototype cannot follow another port.

On the remote branch, harness preparation runs only when `--no-connect` is absent. It calls `assertConnectionCompatible` with `rejectConflicting: true` before `startCampfireViewer`. A conflicting Codex or OpenCode block throws `Campfire harness configuration conflict; choose an isolated harness config` and does not start the Viewer. That is the October 25 refusal. The installed dist does not wrap that error with the newer source sentence that names `campfire up --no-connect`. The flag still skips the block. A later Campfire-Internal source message is not what this binary prints.

Do not run plain `campfire`, plain `campfire up`, or `campfire up --no-open` without `--no-connect`. Those can select the Ada profile or attempt to replace another profile's harness. The local (non-remote) `up` path also opens SQLite through `createRuntime`. This read is the remote Arbora Viewer only. If the process is not that Viewer, stop. Do not open SQLite to inspect it.

Exact start, in a continuing terminal, only after the port probe below is still empty:

```sh
CAMPFIRE_CONFIG_DIR="$HOME/.config/campfire-arbora" \
  campfire up --no-open --no-connect
```

Leave that process in the foreground. It is the listener owner. Expected remote behavior from installed `cmdUp`: hosted `whoami` and `list_workspaces` using the profile credential, then a Viewer on `127.0.0.1:9415`, no browser, and no harness write. Stderr includes `remote workspace` and the viewer URL. Do not add `--token`, `--url`, or `--db`. Do not answer a prompt by starting a different profile.

The October 25 read of this profile returned workspace `ws_df6794f33efc459b`, task `task_3795d9d37d3842e9`, and finding `find_5cd543722a044c20`, each a complete 1-of-1 slice, plus a ready remote status with one open task, two humans, and two agents. Those values are the last known slice, not a required match.

## Listener gate

Before the start command, and again before any client connects, run only:

```sh
lsof -nP -iTCP:9415 -sTCP:LISTEN
```

This session's result: exit 1, no listener, no command line. Nothing on that port contains `campfire` or `fixture-viewer`.

After the operator starts the command above, probe again and record pid and name. Then:

```sh
ps -p <pid> -ww -o command=
```

Connect only when all of these are true:

- The listen address is `127.0.0.1:9415`.
- The command is `node` executing `lib/campfire/dist/src/cli/index.js` with arguments `up`, `--no-open`, and `--no-connect`.
- That process was started with `CAMPFIRE_CONFIG_DIR` set to `~/.config/campfire-arbora` (absolute path is fine).
- The receipt is the remote Viewer, not a local API plus SQLite workspace.

If the command is `fixture-viewer`, another `node` script, or anything else, do not connect. Do not send HTTP. Do not start `prototypes/mac-001/fixture-viewer.mjs` beside this Viewer. Both want port 9415. Do not use MCP on port 9414 as evidence. A remote `up` does not start that API.

## One read, three surfaces

Do this only after the listener gate passes. One fresh response. No second profile. Methods are only `list_workspaces` and `get_workspace_context`. No auth header. The Viewer binds the actor. Match the SwiftUI body: `Content-Type: application/json`, body `{"method":"...","params":{...}}`. Context params are `workspaceId` from the list result and `participants` set to `omit`.

```sh
curl -sS -D - \
  -X POST http://127.0.0.1:9415/api/call \
  -H 'Content-Type: application/json' \
  --data '{"method":"list_workspaces","params":{}}'
```

Then one context POST for the workspace id that list returns. Do not call `add_task` or any other method. Record workspace id, task id, finding id, and each slice's `returned` and `total` (and `truncated` if present). Also record goal text only as displayed. Do not copy tokens if any appear; they should not be in these two results.

SwiftUI, after the same listener is still the Arbora Viewer. Build does not start Campfire. The app posts only to `http://127.0.0.1:9415/api/call`.

```sh
sh /Users/sergio/Documents/Developer/BoringInfraCo/Campfire-Internal/prototypes/mac-001/build.sh
open '/tmp/campfire-mac-001/Campfire MAC-001.app'
```

`build.sh` writes an ad hoc signed arm64 bundle at `/tmp/campfire-mac-001/Campfire MAC-001.app` unless another output directory is passed. Refresh once (`⌘R` or the refresh control). Read the accessibility tree for the workspace picker, task and finding controls, selected record, and the Tasks / Findings counts. Compare those ids and returned/total counts to the curl JSON from this same Viewer process. Do not rebuild against a fixture.

GPUIX, same listener, same response. Do not edit the checkout.

```sh
cd /Users/sergio/Documents/Developer/BoringInfraCo/campfire-desktop
PATH="/tmp/mac-001b-bun-1.4.2/bun-darwin-aarch64:$PATH" \
  /tmp/mac-001b-bun-1.4.2/bun-darwin-aarch64/bun run dev:app
```

`PATH` has to prefer the pinned bun so turbo's child `bun` is 1.4.2, not another bun on `PATH`. Confirm with the process image, as in [GPUIX-RUN.md](GPUIX-RUN.md). Do not set `CAMPFIRE_CONFIG_DIR` for this app. It must read the loopback Viewer, not a profile. Compare the same workspace, task, and finding ids and returned/total counts in the accessibility tree. Menu chrome (`Hide Campfire`, `Quit Campfire`, window title) is not the window body. The prior GPUIX run did not expose Workspaces, Refresh, or task and finding controls.

## Stop conditions

- Do not publish, invite, write a workspace, deploy, or open SQLite.
- Do not push, and do not edit `campfire-desktop`.
- If the listener command is not this campfire Viewer, do not connect.
- Do not run a write method, change a record so the ids match, or open the hosted Worker or D1 directly.
- Do not start a second Viewer, the fixture, or a browser as a substitute for the three surfaces.
- Stop the foreground `campfire up` when the three reads are recorded. Do not leave 9415 occupied for a later fixture.

## What a later verdict still needs

This plan is not that verdict. HOLD stands. Choosing a toolkit still requires the GPUIX window body to be visible to accessibility on that same fresh response: Refresh and the selected record reachable, with the same ids and counts as curl and SwiftUI. Pixels that were not captured stay unobserved. VoiceOver stays unobserved until it is run. The two-Mac screen is out of scope until a verdict other than HOLD is recorded.
