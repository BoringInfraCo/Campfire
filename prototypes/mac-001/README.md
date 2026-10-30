# MAC-001 disposable Mac client

This is a one-window SwiftUI feasibility client, not a Campfire release. It
reads the existing actor-bound Viewer on `127.0.0.1:9415`; it never opens the
Campfire profile or database and carries no bearer token. The installed
`campfire up --no-open` process must own the Viewer for an actual user run.
The port is fixed at 9415 in this throwaway build; a custom Viewer port is
not supported.

## Build and run

On an Apple Silicon Mac with Xcode installed:

```sh
sh prototypes/mac-001/build.sh
open '/tmp/campfire-mac-001/Campfire MAC-001.app'
```

The local bundle is ad hoc signed. Its deployment target is macOS 13, but only
macOS 26.6.2 on this Mac has been observed. The iMac needs its own run.

For a disposable fixture-backed check, run `npm run build` first, then start
`node prototypes/mac-001/fixture-viewer.mjs` in a separate terminal before
opening the app. The fixture starts the **actual Viewer proxy** with fixed demo
records and no profile or SQLite connection. Stop it before starting the real
Campfire Viewer because both use port 9415.

For a real profile, start `campfire up --no-open` with the intended
`CAMPFIRE_CONFIG_DIR` in a continuing terminal, then open the app. If an
existing Codex or OpenCode connection belongs to another Campfire profile,
use `campfire up --no-open --no-connect` to open only this profile's read-only
Viewer without replacing that connection. Compare
workspace IDs, task/finding IDs and counts with `campfire status` and the
browser Viewer under that same profile. MAC-001 cannot claim this run until it
is observed.

The app makes only `list_workspaces` and `get_workspace_context` calls via
`POST /api/call`. Refresh is manual (`⌘R`); it does not poll. It shows a stale
label and retains the last good context when the proxy disappears. A workspace
switch clears the old context. It cancels late results logically with a request
generation check. More complete detail, provenance, citations, paging, and
hosted-profile parity belong to MAC-002.
