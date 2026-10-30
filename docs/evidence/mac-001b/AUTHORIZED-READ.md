# Authorized Arbora Viewer read

**Date:** 2026-10-27, about 10:29–10:36 EDT. This note records one read. It does not choose GPUIX, SwiftUI, or HOLD, and it does not change [VERDICT.md](VERDICT.md).

No push. No edit under `campfire-desktop`. No publish, invite, deploy, workspace write, SQLite open, or profile-file open. No `--token`, `--url`, or `--db`. No plain `campfire`, plain `campfire up`, or `campfire up --no-open` without `--no-connect`. No second profile and no fixture Viewer.

## Port before start

```sh
lsof -nP -iTCP:9415 -sTCP:LISTEN
```

At 10:29:17 EDT that command exited 1 with no output. Nothing was listening. No HTTP request was sent before the start below.

## Start

```sh
CAMPFIRE_CONFIG_DIR="$HOME/.config/campfire-arbora" campfire up --no-open --no-connect
```

`campfire` was `/Users/sergio/.local/bin/campfire`. The process stayed up. It did not error or refuse. Stdout, with no credential field in this object:

```json
{"mode":"remote","human":"Sergio","workspaceId":"ws_df6794f33efc459b","workspaces":[{"id":"ws_df6794f33efc459b","name":"Arbora","goal":"Identify the smallest useful user-facing feature to build next"}],"agents":[],"connectionPrepared":false,"reloadRequired":false,"sessionRegistered":false,"apiUrl":"https://campfire-shr001-rehearsal.sunbeam-redraft-7j.workers.dev","viewerUrl":"http://127.0.0.1:9415","openedBrowser":false,"pastSessionsImported":false}
```

Stderr: `[campfire] remote workspace  viewer http://127.0.0.1:9415`.

`agents` here is the startup field and was an empty array. That is not the later participant-coverage count.

## Listener gate

Before either POST:

```text
node    50409 sergio   18u  IPv4  TCP 127.0.0.1:9415 (LISTEN)
```

```text
ps -p 50409 -ww -o command=
node /Users/sergio/.local/lib/campfire/dist/src/cli/index.js up --no-open --no-connect
```

Filtered process environment: `CAMPFIRE_CONFIG_DIR=/Users/sergio/.config/campfire-arbora`. `CAMPFIRE_DB`, `CAMPFIRE_URL`, and `CAMPFIRE_TOKEN` were absent. The command is not `fixture-viewer`. The same pid still owned `127.0.0.1:9415` immediately before shutdown.

## Viewer JSON

Both calls were `POST http://127.0.0.1:9415/api/call` with `Content-Type: application/json` and no auth header. Both returned HTTP 200.

```sh
curl -sS -D - \
  -X POST http://127.0.0.1:9415/api/call \
  -H 'Content-Type: application/json' \
  --data '{"method":"list_workspaces","params":{}}'
```

`content-length: 219`. One workspace:

| Field | Value |
| --- | --- |
| id | `ws_df6794f33efc459b` |
| name | Arbora |
| status | active |
| goalTitle | Identify the smallest useful user-facing feature to build next |
| openTaskCount | 1 |
| updatedAt | `2026-10-24T00:58:24.183Z` |

This method has no `returned` / `total` pair. No token-like key was in the body.

```sh
curl -sS -D - \
  -X POST http://127.0.0.1:9415/api/call \
  -H 'Content-Type: application/json' \
  --data '{"method":"get_workspace_context","params":{"workspaceId":"ws_df6794f33efc459b","participants":"omit"}}'
```

`content-length: 23164`. `ok` true. `schemaVersion` 1. `generatedAt` `2026-10-27T14:30:25.873Z`. `completeness.fullHistoryIncluded` false. `completeness.drillDownAvailable` true. The orientation cursor value is not copied here.

| Record | ID | Other fields |
| --- | --- | --- |
| Workspace | `ws_df6794f33efc459b` | name Arbora, status `active`, team `team_8202752e97e94122` |
| Goal | `goal_4c89cc049e7445c7` | title `Identify the smallest useful user-facing feature to build next`, status `active` |
| Task | `task_3795d9d37d3842e9` | title `Implement address search and selection on a real satellite map`, status `open` |
| Finding | `find_5cd543722a044c20` | summary `Build address search and selection into a real satellite map as the next smallest user-facing feature.`, currentness `current` |

Task description from that JSON: `Smallest user-facing feature scoped from audit finding find_5cd543722a044c20: add address search + selection with an interactive satellite/aerial map, selected-location marker/context, and loading/error/empty states. Excludes parcel geometry, analysis, and scoring. No Arbora code changes in this task record; implementation to follow in a separate change.`

Finding detail from that JSON: `Today the home page only shows the product identity, an empty property-analysis state, and health/status links; there is no address input, map, or real property view (app/page.tsx). README.md states Mapbox, address search, and maps are unimplemented. docs/roadmap.md Sprint 0.3 specifies real-address search/selection, interactive satellite or aerial view, selected-location marker/context, and loading/error/empty states, while excluding parcel geometry, analysis, and scoring. This is a truthful first user workflow, not a property recommendation.`

Slice counts, all with a `truncated` field:

| Slice | returned | total | truncated |
| --- | --- | --- | --- |
| tasks | 1 | 1 | false |
| findings | 1 | 1 | false |
| decisions | 0 | 0 | false |
| blockers | 0 | 0 | false |
| artifacts | 0 | 0 | false |
| recentChanges | 17 | 17 | false |

`participants` was an empty list. `participantsCoverage` was `returned` 0, `total` 4, `truncated` true, `omitted` true. `provenanceTotal` 17. `provenanceTruncated` false. `attentionCoverage.tasks` was 1 / 1 / false. `attentionCoverage.decisions` was 0 / 0 / false. `needsYou` and `needsAttention` were empty lists. No token, secret, password, or authorization key was present. October 25 ids `ws_df6794f33efc459b`, `task_3795d9d37d3842e9`, and `find_5cd543722a044c20` happen to be this response. They were not required.

`suggestedNextAction` was kind `task`, id `task_3795d9d37d3842e9`. That line was not looked for in either accessibility tree.

## SwiftUI

```sh
sh /Users/sergio/Documents/Developer/BoringInfraCo/Campfire-Internal/prototypes/mac-001/build.sh
open '/tmp/campfire-mac-001/Campfire MAC-001.app'
```

`build.sh` printed `/tmp/campfire-mac-001/Campfire MAC-001.app: replacing existing signature` and the app path. `codesign -dv` reported `Format=app bundle with Mach-O thin (arm64)`, `Signature=adhoc`, `TeamIdentifier=not set`, identifier `company.boringinfra.campfire.mac001`. Bundle byte size was not measured.

Process `50507`: `/private/tmp/campfire-mac-001/Campfire MAC-001.app/Contents/MacOS/CampfireReadOnly`. RSS was 96288 KB at about 1:05 elapsed and 90064 KB at 4:08. Cold RSS at first paint was not sampled.

On-screen window `7546`, owner `Campfire MAC-001`, name `Campfire MAC-001`, layer 0, alpha 1, bounds x=306 y=181 width=900 height=552.

`/tmp/mac-001b-axdump 50507` was trusted. Refresh is a button. Its title attribute is empty. The accessible description is the label:

```text
AXWindows[0].0.1 d=3 role=AXButton subrole=err:-25212 title=err:-25212 desc=Refresh Campfire workspace value=err:-25212 id=err:-25212 pos=1111.0,237.0 children=0 children_err=0
```

Other body lines from that first dump:

```text
AXWindows[0].0.4 d=3 role=AXPopUpButton subrole=err:-25205 title=err:-25205 desc=err:-25205 value=Arbora id=err:-25212 pos=405.5,304.0 children=0 children_err=0
AXWindows[0].0.7 d=3 role=AXStaticText subrole=err:-25212 title=err:-25212 desc=err:-25212 value=Workspace ws_df6794f33efc459b · active id=err:-25212 pos=330.0,397.5 children=0 children_err=0
AXWindows[0].0.8 d=3 role=AXStaticText subrole=err:-25212 title=err:-25212 desc=err:-25212 value=Identify the smallest useful user-facing feature to build next id=err:-25212 pos=330.0,426.5 children=0 children_err=0
AXWindows[0].0.9 d=3 role=AXStaticText subrole=err:-25212 title=err:-25212 desc=err:-25212 value=Tasks 1 of 1 id=err:-25212 pos=330.0,458.5 children=0 children_err=0
AXWindows[0].0.10 d=3 role=AXStaticText subrole=err:-25212 title=err:-25212 desc=err:-25212 value=Findings 1 of 1 id=err:-25212 pos=408.0,458.5 children=0 children_err=0
AXWindows[0].0.11.1 d=4 role=AXButton subrole=err:-25212 title=err:-25212 desc=Implement address search and selection on a real satellite map, open, task_3795d9d37d3842e9 value=err:-25212 id=err:-25212 pos=330.0,533.5 children=0 children_err=0
AXWindows[0].0.11.3 d=4 role=AXButton subrole=err:-25212 title=err:-25212 desc=Build address search and selection into a real satellite map as the next smallest user-facing feature., current, find_5cd543722a044c20 value=err:-25212 id=err:-25212 pos=330.0,652.5 children=0 children_err=0
AXWindows[0].0.13 d=3 role=AXStaticText subrole=err:-25212 title=err:-25212 desc=err:-25212 value=Select a task or finding to inspect its returned summary. id=err:-25212 pos=776.5,531.5 children=0 children_err=0
AXWindows[0].0.14 d=3 role=AXStaticText subrole=err:-25212 title=err:-25212 desc=err:-25212 value=Orientation generated 2026-10-27T14:30:52.717Z id=err:-25212 pos=776.5,696.0 children=0 children_err=0
```

`Partial overview` was not in that tree. Strings `Workspaces`, `Needs You`, and `People & Agents` were not in that tree. The word `truncated` was not in that tree.

`/tmp/mac-001b-axpress 50507` walks by role, title, description, value, position, and child count. It does not use AXUIElement pointer identity. Press of the task button returned `axpress=0`. The selected-record texts then were:

```text
value=Implement address search and selection on a real satellite map
value=open · task_3795d9d37d3842e9
value=Smallest user-facing feature scoped from audit finding find_5cd543722a044c20: add address search + selection with an interactive satellite/aerial map, selected-location marker/context, and loading/error/empty states. Excludes parcel geometry, analysis, and scoring. No Arbora code changes in this task record; implementation to follow in a separate change.
```

Press of the finding button returned `axpress=0`. The selected-record texts then were:

```text
value=Build address search and selection into a real satellite map as the next smallest user-facing feature.
value=current · find_5cd543722a044c20
value=Today the home page only shows the product identity, an empty property-analysis state, and health/status links; there is no address input, map, or real property view (app/page.tsx). README.md states Mapbox, address search, and maps are unimplemented. docs/roadmap.md Sprint 0.3 specifies real-address search/selection, interactive satellite or aerial view, selected-location marker/context, and loading/error/empty states, while excluding parcel geometry, analysis, and scoring. This is a truthful first user workflow, not a property recommendation.
```

Those description and detail strings match the curl body. The orientation line stayed `2026-10-27T14:30:52.717Z`, which is later than the curl `generatedAt` of `2026-10-27T14:30:25.873Z`. The shell's own launch read was not captured as HTTP. The Viewer stdout did not log the request.

`screencapture -l 7546 -o /tmp/mac-001b-authread/swift-window.png` exited 0. The PNG was read. It shows a Refresh control whose visible caption is `Refresh`, workspace popup Arbora, `Workspace ws_df6794f33efc459b · active`, the goal title, `Tasks 1 of 1`, `Findings 1 of 1`, the finding row selected, and `current · find_5cd543722a044c20`. The visible detail paragraph ends in an ellipsis (`unim...`). The accessibility value above is the full paragraph. `Last read 10:30 AM` and `Orientation generated 2026-10-27T14:30:52.717Z` are on screen. No rail labeled Workspaces, Needs You, or People & Agents is in that image.

## GPUIX

Pinned bun before launch:

```text
/tmp/mac-001b-bun-1.4.2/bun-darwin-aarch64/bun --version
1.4.2
```

```sh
cd /Users/sergio/Documents/Developer/BoringInfraCo/campfire-desktop
PATH="/tmp/mac-001b-bun-1.4.2/bun-darwin-aarch64:$PATH" bun run dev:app
```

`CAMPFIRE_CONFIG_DIR` was not set for this process. The log printed `Local GPUIX native build is up to date.`, then `[gpuix] created native window` and `[gpuix] mount complete`. Shell pid `50515`: `bun --preload ./native/preload.ts --hot src/main.tsx`. Its text segment was `/private/tmp/mac-001b-bun-1.4.2/bun-darwin-aarch64/bun`. RSS was 156768 KB at about 1:05 elapsed and 165888 KB at 4:08. Cold RSS at the window line was not sampled.

The dev log then printed this line six times, and no other error:

```text
Encountered two children with the same key, `ein_inv_98c74125f8fd4b24`. Keys should be unique so that components maintain their identity across updates. Non-unique keys may cause children to be duplicated and/or omitted — the behavior is unsupported and could change in a future version.
```

On-screen window `7547`, owner `bun`, name `Campfire`, layer 0, alpha 1, bounds x=116 y=43 width=1280 height=820. One bun window.

`/tmp/mac-001b-axdump 50515` was trusted. Depth 1 is `AXWindow` title `Campfire`, not a nested `AXApplication`. Refresh is a button, and the label is the title:

```text
AXWindows[0].0.0.1.0 d=5 role=AXButton subrole=AXUnknown title=Workspaces desc=err:-25212 value=err:-25212 id=err:-25212 pos=132.0,132.5 children=1 children_err=0
AXWindows[0].0.0.1.1 d=5 role=AXGroup subrole=AXApplicationGroup title=Needs You. Not in this prototype. desc=err:-25212 value=err:-25212 id=err:-25212 pos=132.0,176.5 children=2 children_err=0
AXWindows[0].0.0.1.2 d=5 role=AXGroup subrole=AXApplicationGroup title=People & Agents. Not in this prototype. desc=err:-25212 value=err:-25212 id=err:-25212 pos=132.0,222.5 children=2 children_err=0
AXWindows[0].0.0.1.3 d=5 role=AXGroup subrole=AXUnknown title=err:-25212 desc=err:-25212 value=Read-only Viewer · 127.0.0.1:9415 id=err:-25212 pos=132.0,869.0 children=0 children_err=0
AXWindows[0].0.0.2.1 d=5 role=AXButton subrole=AXUnknown title=Arbora, active, ws_df6794f33efc459b desc=err:-25212 value=err:-25212 id=err:-25212 pos=350.0,158.5 children=2 children_err=0
AXWindows[0].0.0.3.0 d=5 role=AXButton subrole=AXUnknown title=Refresh Campfire workspace desc=err:-25212 value=err:-25212 id=err:-25212 pos=630.5,136.5 children=1 children_err=0
AXWindows[0].0.0.3.2 d=5 role=AXGroup subrole=AXUnknown title=err:-25212 desc=err:-25212 value=Workspace ws_df6794f33efc459b · active id=err:-25212 pos=630.5,210.5 children=0 children_err=0
AXWindows[0].0.0.3.4 d=5 role=AXGroup subrole=AXUnknown title=err:-25212 desc=err:-25212 value=Identify the smallest useful user-facing feature to build next id=err:-25212 pos=630.5,252.5 children=0 children_err=0
AXWindows[0].0.0.3.5 d=5 role=AXGroup subrole=AXUnknown title=err:-25212 desc=err:-25212 value=Tasks 1 of 1 · Findings 1 of 1 id=err:-25212 pos=630.5,274.5 children=0 children_err=0
AXWindows[0].0.0.3.27 d=5 role=AXButton subrole=AXUnknown title=Implement address search and selection on a real satellite map, open, task_3795d9d37d3842e9 desc=err:-25212 value=err:-25212 id=err:-25212 pos=630.5,776.5 children=2 children_err=0
AXWindows[0].0.0.3.29 d=5 role=AXButton subrole=AXUnknown title=Build address search and selection into a real satellite map as the next smallest user-facing feature., current, find_5cd543722a044c20 desc=err:-25212 value=err:-25212 id=err:-25212 pos=630.5,862.5 children=2 children_err=0
AXWindows[0].0.0.3.30 d=5 role=AXGroup subrole=AXUnknown title=err:-25212 desc=err:-25212 value=Select a task or finding to inspect its returned summary. id=err:-25212 pos=630.5,926.5 children=0 children_err=0
AXWindows[0].0.0.3.31 d=5 role=AXGroup subrole=AXUnknown title=err:-25212 desc=err:-25212 value=Orientation generated 2026-10-27T14:30:52.778Z id=err:-25212 pos=630.5,948.5 children=0 children_err=0
AXWindows[0].0.0.3.32 d=5 role=AXGroup subrole=AXUnknown title=err:-25212 desc=err:-25212 value=Last successful refresh 2026-10-27T14:30:52.904Z id=err:-25212 pos=630.5,968.5 children=0 children_err=0
```

That first dump also had 17 change rows, indexes `.7` through `.23`, including both `create enrollment_invitation ein_inv_98c74125f8fd4b24` and `update enrollment_invitation ein_inv_98c74125f8fd4b24`. `Partial overview` was not in the tree. The same 1-of-1 count line was still present after the presses below.

The depth-5 dumper stops before the selected-record children. A second dumper, `/tmp/mac-001b-axdump-deep`, uses the same signature key as `/tmp/mac-001b-axdump` (role, title, position, child count), not pointer identity, with depth 8. Press of the task button returned `axpress=0`. Selected-record children:

```text
value=Implement address search and selection on a real satellite map
value=task_3795d9d37d3842e9
value=Status open
value=Recorded by agent agt_49b4999f33424f55
value=Cited sources unavailable.
value=Smallest user-facing feature scoped from audit finding find_5cd543722a044c20: add address search + selection with an interactive satellite/aerial map, selected-location marker/context, and loading/error/empty states. Excludes parcel geometry, analysis, and scoring. No Arbora code changes in this task record; implementation to follow in a separate change.
```

Press of the finding button returned `axpress=0`. Selected-record children:

```text
value=Build address search and selection into a real satellite map as the next smallest user-facing feature.
value=find_5cd543722a044c20
value=current
value=Recorded by agent agt_955034ffb2544082
value=Cited sources unavailable.
value=Today the home page only shows the product identity, an empty property-analysis state, and health/status links; there is no address input, map, or real property view (app/page.tsx). README.md states Mapbox, address search, and maps are unimplemented. docs/roadmap.md Sprint 0.3 specifies real-address search/selection, interactive satellite or aerial view, selected-location marker/context, and loading/error/empty states, while excluding parcel geometry, analysis, and scoring. This is a truthful first user workflow, not a property recommendation.
```

The description and detail match the curl body. `Cited sources unavailable.` is extra interface text; it is not a curl field that was compared. By the task-selection dump, orientation had changed to `2026-10-27T14:33:25.472Z` and last successful refresh to `2026-10-27T14:33:25.581Z`. The finding press left those two timestamps in place. What caused the second refresh was not isolated. Counts stayed `Tasks 1 of 1 · Findings 1 of 1`.

`screencapture -l 7547 -o /tmp/mac-001b-authread/gpuix-window.png` exited 0. The PNG was read. It is not black. Visible text includes the rail `Workspaces`, `Needs You` / `Not in this prototype`, `People & Agents` / `Not in this prototype`, and `Read-only Viewer · 127.0.0.1:9415`; workspace `Arbora`, `active · ws_df6794f33efc459b`; the finding row selected; the finding id, `current`, `Recorded by agent agt_955034ffb2544082`, `Cited sources unavailable.`, and the full finding detail; plus `Orientation generated 2026-10-27T14:33:25.472Z` and `Last successful refresh 2026-10-27T14:33:25.581Z`. The first visible change line in that image is `join participant hum_156ff89c089f4d13`. Both enrollment rows for `ein_inv_98c74125f8fd4b24` are visible. The task row is visible with `open · task_3795d9d37d3842e9`. This capture does not show the Refresh control, the goal title, or `Tasks 1 of 1 · Findings 1 of 1`. Those three are in the accessibility tree quoted above, at positions the 820-point window does not include in this image. Menu-bar items were not walked; the dumper skips `AXMenuBar`.

## Same listener, not the same HTTP body

Curl `generatedAt` is `2026-10-27T14:30:25.873Z`. The first SwiftUI and GPUIX orientation lines are `2026-10-27T14:30:52.717Z` and `2026-10-27T14:30:52.778Z`. GPUIX later showed `2026-10-27T14:33:25.472Z`. Ids, titles, status, currentness, and the 1-of-1 task and finding counts match across the curl body and both trees. The shells' request bytes were not recorded. No other process listened on 9415 during the reads.

## Stop

SwiftUI pid 50507 was sent SIGTERM and was gone. The `bun run dev:app` process group was terminated. No `CampfireReadOnly` or `src/main.tsx` process remained. The `campfire up` process group was then terminated. Pid 50409 was gone. A following `lsof -nP -iTCP:9415 -sTCP:LISTEN` exited 1 with no output. No `lib/campfire/dist/src/cli/index.js up` process remained.

## Not observed

- VoiceOver.
- Keyboard selection, including Command-R. Selection was `AXPress` on the labeled buttons only. Refresh was not pressed in either app.
- A stale Viewer, a denied response, an empty workspace list, a second workspace, and an incomplete task or finding page. `participants: omit` was the curl request, not a denied-context exercise.
- Whether a truncated task or finding slice shows `Partial overview`. Both slices in this response were `truncated: false`, and that sentence was absent.
- Menu chrome (`Hide Campfire`, `Quit Campfire`) on this run.
- The shells' own POST bodies, and whether they byte-match the curl JSON. Timestamps differ, so they were later reads from the same listener.
- GPUIX pixels for Refresh, the goal title, and the task/finding count line. The one readable capture does not include them. Earlier runs' `could not create image from window` did not recur for window `7547`.
- The full SwiftUI finding paragraph in pixels. The capture ellipsizes it. Accessibility had the full string.
- Cold-launch RSS at the window line, steady memory beyond the two samples, and the `.app` byte size.
- A deliberate check that the running shells did not open SQLite or a profile. They were not given `CAMPFIRE_CONFIG_DIR`, `--db`, or a database path. Their files were not traced.
- Two-Mac display. Not this read.
