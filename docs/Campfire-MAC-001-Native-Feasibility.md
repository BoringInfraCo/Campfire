# MAC-001 — one-screen native feasibility

**Status:** Feasibility GO under the October 26 revised scope: one real-data MacBook screen and a safe Viewer boundary. The iMac prototype run was canceled by the founder, not passed.
**Source:** The native track in [the phased plan](Campfire-Native-Continuity-Alpha-Sprint-Plan.md).
**Result:** [October 25 evidence and October 26 disposition](evidence/mac-001/RESULT.md). The [prepared iMac procedure](evidence/mac-001/IMAC-RUN.md) is superseded.

## Question

Can a small macOS app show useful, authorized Campfire work through the installed CLI's local actor-bound Viewer proxy without handling a bearer token, opening SQLite, or calling the hosted Worker directly? The final toolkit choice for the next native slice belongs to MAC-001B.

## Slice

Build one disposable window that selects an authorized workspace, shows its goal plus bounded task and finding counts, and opens a returned task or finding summary. Show loading, empty, stale/unreachable, and denied states. Preserve the last good read with an explicit stale label when the Viewer disappears, but clear it when the actor loses access or changes workspace. Keyboard refresh and accessible labels are required. The app reads only the Viewer's allowlisted `list_workspaces` and `get_workspace_context` methods.

The Viewer remains the authority boundary. The app never reads a Campfire profile, SQLite file, human/agent token, or private transcript. It does not write workspace state, start or manage agents, enroll a teammate, or provide a public installer. One fixed default loopback port is acceptable for this throwaway prototype if documented.

## Acceptance and evidence

| Gate | Proof required | Current state |
| --- | --- | --- |
| Build | A runnable Apple Silicon `.app`, verified bundle metadata and local signature | Passed on this Mac; see result. |
| Authorized read | Workspace, task, and finding IDs/counts in app match the same actor's Viewer/CLI responses | Passed on the MacBook against the hosted Arbora profile. |
| Read-only boundary | App has no write path; a write sent to the Viewer proxy is denied | Passed against the fixture-backed actual proxy. |
| Failure handling | Offline/stale, denied, empty, and workspace-change states are distinguishable and do not silently show unauthorized old context | Offline/stale observed; revocation branch code reviewed; real-profile denial open. |
| Native usability | One screen inspected visually and through accessibility controls; keyboard refresh works | Basic MacBook inspection passed; VoiceOver navigation remains untested. |
| Toolkit baseline | Record the built SwiftUI result and the researched alternative | SwiftUI baseline recorded; a built GPUIX comparison and final toolkit verdict belong to MAC-001B. |

The observed MacBook is Apple Silicon on macOS 26.6.2. The founder removed the physical iMac run from MAC-001 on October 26. This revised GO means only that a real-data, read-only Mac screen is feasible through the Viewer boundary; it does not establish iMac compatibility, VoiceOver usability, revoked-access behavior in a real profile, or readiness to distribute a Mac app. MAC-001B compares toolkits; MAC-002 and MAC-003 own integrated cross-device and packaged-app acceptance.

## Release boundary

MAC-001 produces a prototype and a SwiftUI baseline, not a distributed Mac app or final toolkit decision. MAC-001B owns the final toolkit comparison. MAC-002 requires its own bounded read-only alpha contract and the released Cloud profile review. MAC-003 owns signing, notarization, installer, updater, and support decisions. The prototype work began from the plan's MAC-001 brief before this standalone contract was written; this document records the revised scope without representing a pre-code freeze.
