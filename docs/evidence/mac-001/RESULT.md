# MAC-001 feasibility result — October 25, 2026

**Disposition: GO for the revised one-Mac feasibility scope.** The real-profile
MacBook check passed. On October 26, the founder canceled the prepared iMac
prototype run as a MAC-001 exit gate; it was not performed or passed.
The app is a runnable, ad hoc signed one-window Mac prototype. Its first
observed data was a fixed fixture served through Campfire's actual loopback
Viewer proxy. The later MacBook run below used the real hosted Arbora workspace.
No iMac native-app result or native release is claimed.

## Contract and observed result

| Check | Result |
| --- | --- |
| Viewer boundary | `POST http://127.0.0.1:9415/api/call` with only `list_workspaces` and `get_workspace_context`; no bearer in request. Viewer binds the actor in `options.call`. |
| Response shape | `{ok:true,result}` with a workspace summary array and `WorkspaceContext.workspace`, `goal`, `slices.tasks`, `slices.findings`, `generatedAt`. The fixture read returned workspace `ws_mac001_demo`, task `task_mac001_demo`, finding `find_mac001_demo`, each count 1/1. |
| Write boundary | `add_task` sent to the same Viewer returned HTTP 403 from the Viewer allowlist. The app has no write control or write method. |
| Credentials and storage | App source contains no token, profile, SQLite, filesystem, or hosted API access. The fixture imports the Viewer server and fixed public demo records only. |
| Packaging | `sh prototypes/mac-001/build.sh` compiled an arm64 `.app` using Swift 6.2.3 and Xcode 26.2; `codesign --verify --deep --strict` and `plutil -lint` passed. The bundle is ad hoc signed, not notarized or distributed. |
| Window and accessibility | App launched on this Apple Silicon Mac running macOS 26.6.2. The accessibility tree exposed the workspace picker, refresh button, task and finding buttons, selected record, and status. A visual inspection showed a readable single window. `⌘R` is bound to refresh. VoiceOver navigation itself was not tested. |
| Network failure | After stopping the fixture Viewer and activating Refresh, the window retained the previous data and announced `Stale view · Viewer unreachable. Run campfire up, then refresh.` |
| Revocation handling | A workspace removed from a refreshed list clears its old context and selection before showing another workspace. A denied/404 context read clears the old context. These branches were code reviewed, not exercised against a real revocation. |
| Target Macs | The intended MacBook and iMac are Apple Silicon/macOS 26.6.2; only this Mac ran the prototype. The build declares macOS 13 as its minimum, but older runtime support was not exercised. |

## Real-profile MacBook check — October 25 EDT

The installed 1.26.2 candidate, with `CAMPFIRE_CONFIG_DIR=~/.config/campfire-arbora`, returned a ready remote status for hosted workspace `ws_df6794f33efc459b`, one open task, two humans, and two agents. The bare `campfire` command selected an unrelated old Ada profile with a revoked token. Normal `up --no-open` then found an existing Codex Campfire harness connection for another profile and refused to replace it. The user started the remote Viewer with `up --no-open --no-connect`, preserving that connection. The Viewer bound `127.0.0.1:9415` and served HTTP 200 at `/`.

Through the actor-bound Viewer proxy, `list_workspaces` returned Arbora `ws_df6794f33efc459b`. `get_workspace_context` returned task `task_3795d9d37d3842e9` and finding `find_5cd543722a044c20`, each in a complete 1-of-1 slice. The same already-built SwiftUI bundle was opened locally. Its accessibility state showed Arbora, the goal, and Tasks 1 of 1 / Findings 1 of 1. Selecting the task showed its scoped implementation description and original finding reference; selecting the finding showed its current detail. These IDs and counts match the Viewer reads. No Arbora or hosted record was changed by this check.

This closes the **real-data screen on the MacBook** part of MAC-001. The iMac native launch was removed from this feasibility sprint by the founder; older macOS runtime support, VoiceOver navigation, and MAC-002 authorization/provenance work remain unverified. The app is still an unsigned/disposable feasibility build for distribution purposes (ad hoc local signing only).

## Toolkit decision

**SwiftUI is the measured baseline, not the final toolkit selection.** SwiftUI produced a small buildable `.app` with
native controls and an inspectable accessibility tree without adding a Rust UI
dependency. GPUI's upstream crate is [declared Apache-2.0 and version
0.2.2](https://github.com/zed-industries/zed/blob/main/crates/gpui/Cargo.toml),
and its [README](https://github.com/zed-industries/zed/blob/main/crates/gpui/README.md)
says the framework is pre-1.0 with breaking changes and needs Xcode/Metal on
macOS. Its [accessibility documentation](https://github.com/zed-industries/zed/blob/main/crates/gpui/src/_accessibility.rs)
describes AccessKit integration. No standalone GPUI app was built here; its
minimum supported macOS version, actual accessibility behavior, packaged app
size, signing, and transitive license closure remain unverified. A GPUI choice
would need those checks before implementation. MAC-001B will compare an isolated
1Git-derived GPUIX shell against this SwiftUI result before MAC-002 selects a
toolkit.

## Exit and next verification

MAC-001's real-data screen check passed on the MacBook as described above. The
Campfire MCP connection at `127.0.0.1:9414` remained unavailable because this
is a remote profile whose `up` starts only the loopback Viewer; MCP was not
used as evidence. The prototype assumes the default Viewer port 9415; it
cannot follow a custom `--viewer-port` yet. The [October 26 iMac run procedure](IMAC-RUN.md)
records a prepared transfer artifact but was superseded before execution. It
is not MAC-001 acceptance evidence. Integrated two-Mac native behavior remains
for MAC-002 and packaged-app compatibility remains for MAC-003.
MAC-002 must still add
provenance, citations, complete paging, denied/revoked states, and hosted
parity; MAC-003 owns signing, notarization, installation, and update behavior.
The app also cannot prove which local process owns port 9415. The browser
Viewer uses the same loopback trust boundary; a distributed native app needs
an explicit endpoint-ownership check or a recorded acceptance of that boundary.

## Reproduction

```sh
npm run build
node prototypes/mac-001/fixture-viewer.mjs
# in another terminal
sh prototypes/mac-001/build.sh
open '/tmp/campfire-mac-001/Campfire MAC-001.app'
```

The fixture uses port 9415 and must not run alongside a user's Viewer. No
production Worker, profile, workspace, repository database, or release artifact
was changed by this feasibility check.
The fixture process and app were closed after validation; `/health` on 9415
then refused the connection.
