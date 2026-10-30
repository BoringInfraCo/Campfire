# MAC-001B — Campfire GPUIX shell comparison

**Status:** HOLD on 2026-10-27. The Campfire shell is the GPUIX entry, but the running window body was not readable and no fresh real-profile read was taken. The toolkit is not frozen. The two-Mac MAC-002 exit stays unclaimed. A local read-only slice is scoped separately: [scope](evidence/mac-002/SCOPE.md). Evidence: [verdict](evidence/mac-001b/VERDICT.md).
**Date:** October 26, 2026
**Parent plan:** [Campfire native continuity alpha](Campfire-Native-Continuity-Alpha-Sprint-Plan.md)
**Baseline:** [MAC-001 SwiftUI result](evidence/mac-001/RESULT.md)
**Candidate checkout:** `../campfire-desktop` at `3525f456e263cf02040dbc19fcd9d3959ff809cf` when this contract was drafted. At that draft, its `origin` pointed to `https://github.com/1bye/1git.git`; no Campfire-owned remote was recorded then. The previously reviewed upstream revision was `6243465c2161769f162c5ccd528d32c6a37172a0`. That draft pin was 33 commits and 142 paths beyond the reviewed revision.

**Implementation base, frozen 2026-10-26:** `5b88d4c7caccef523f14ecd54e7fa372fe34fa92` on `master`, level with local `origin/master`. That is 38 commits and 156 paths after `6243465`, and five commits after the draft pin (`8db19870`, `1976837b`, `6240b629`, `535dddff`, `5b88d4c7`). Step 0 audited that delta and launched the unchanged tree once with Bun 1.4.2. The first launch failed on a dirty gitignored native cache; after that cache was moved aside, `bun run dev:app` printed `[gpuix] created native window` in about 128 seconds. No repository was opened and no host account was connected. Evidence: [upstream delta](evidence/mac-001b/UPSTREAM-DELTA.md), [stock build](evidence/mac-001b/STOCK-BUILD.md). Later steps build on this hash. On the evening of 2026-10-27 the founder replaced the local checkout with a fresh clone of that same commit. `origin` now fetches and pushes `https://github.com/BoringInfraCo/Campfire-Desktop.git`. The 1Git remote is `upstream` and its push URL is disabled. Nothing has been pushed. That GitHub repository is private and contains only an unrelated initial commit on `main` (`ecf3f42c2209944feb4da486ea2cc8125c84ac36`). Root `package.json` `repository.url` points at the Campfire repository. The earlier naming pass and Campfire shell are not in this checkout. The toolkit status remains HOLD.

## Question and decision

Can a small, isolated 1Git-derived GPUIX shell render **the same authorized Campfire slice** as MAC-001 with acceptable build reliability, accessibility, behavior, security boundary, and maintenance cost? At exit, record exactly one verdict: `GPUIX`, `SwiftUI`, or `HOLD`, with evidence. This sprint compares toolkits. It does not distribute a Campfire Mac app or reopen MAC-001's canceled iMac procedure.

## Frozen vertical slice

Build a single native window with three areas:

1. A rail for **Workspaces**, **Needs You**, and **People & Agents**. Only Workspaces needs functional navigation in this comparison; other labels may be visible as nonfunctional destinations, clearly marked so they do not imply new Campfire capabilities.
2. A contextual list of the current actor's authorized workspaces and the selected workspace.
3. A main surface answering **what are we trying to accomplish, what changed, and what needs me?** with the returned goal, bounded task/finding counts, and one selected task or finding detail. Only render claims supported by returned records. If the Viewer response does not supply complete change or attention data, label those sections unavailable or incomplete; do not invent a summary.

Use only the installed Campfire profile's loopback, actor-bound Viewer proxy: `POST /api/call` with `list_workspaces` and `get_workspace_context`. Keep the response adapter narrow and typed. Compare exact workspace, task, and finding IDs plus returned/total counts against the same actor's Viewer/CLI read. Fixture data may prove renderer behavior; one authorized real-profile read is required for the verdict. The prototype must not open Campfire SQLite or profile files, receive a bearer token, call the hosted Worker directly, or write workspace state. It must not add a second workspace schema.

Show loading, empty, denied, stale/unreachable, and incomplete-page states distinctly. A lost Viewer may retain the last good projection only with an explicit stale label. A denied read or workspace switch clears old selected content. Refresh by keyboard and control; selected records need inspectable labels and source IDs. The default Viewer port may be fixed for this throwaway comparison if disclosed. Check listener ownership before trusting a real profile; do not silently connect to an unrelated local process.

## Execution sequence

### 0. Freeze and audit the substrate

- Record the full upstream commit, license and notice files, lockfile, GPUIX/GPUI versions, native patch stack, package scripts, macOS minimum, and build host. Review the 33-commit delta since the earlier source review, especially startup, network, updater, analytics, credential, native addon, and packaging changes.
- Keep the candidate in `campfire-desktop`, separate from the Campfire service repository. Configure a Campfire-owned development remote before any push; never push this product transformation to the existing upstream `origin` by accident.
- Build and launch the unchanged checkout once using its documented, pinned Bun toolchain. Record command, result, app startup time, and failures. Do not connect 1Git hosting accounts or import a real repository for this baseline.

### 1. Isolate a Campfire application root

- Replace the Git product root rather than re-skinning its repository pages. Retain only GPUIX build/preload, native window/sidebar composition, theme and design-token machinery, reusable controls, keyboard/focus behavior, and local packaging that the comparison actually needs.
- Remove or make unreachable in the candidate the 1Git repository, branch, diff, worktree, hosting-account, SSH machine/remote-helper, AI commit, analytics, and update/release paths. In particular, `apps/gpuix/src/main.tsx` currently starts `DesktopAnalytics`, restores repository sessions, discovers repositories, and starts `AppUpdater`; the Campfire entry point must not do those things.
- Preserve the upstream MIT notice and applicable third-party notices. Record retained dependencies and the native patch stack; do not copy upstream product names, release URLs, artwork, telemetry settings, or identifiers into a Campfire package.

### 2. Render the authorized slice

- Implement the typed Viewer adapter and the bounded three-area screen against the same fixture and real-profile data used for MAC-001. Keep networking off the UI thread and ignore late responses after workspace or selection changes.
- Record the exact IDs/counts displayed by GPUIX, Viewer/CLI, and the SwiftUI baseline. Exercise keyboard selection, refresh, screen-reader/accessibility tree, stale Viewer, denied response, empty list, incomplete context, and workspace change. A code path without an observed result is labeled unobserved.
- Run only local, read-only checks. Do not publish, invite, change a hosted workspace, deploy a Worker, or enable a release feed to evaluate the shell.

### 3. Compare and decide

Use one dated evidence report with the same MacBook, authorized actor, Viewer response, and task/finding IDs for both candidates. Record the numbers and observations, not just a preference.

| Dimension | Required evidence |
| --- | --- |
| Build and maintenance | Reproducible clean build; pinned Bun, GPUIX/GPUI, patch stack; retained dependency and license inventory; estimated work to maintain upstream patches. |
| Runtime | Cold launch and steady memory for the same bounded screen; app bundle size; notable crashes or rendering failures. |
| Native usability | Keyboard navigation, focus, readable layout, accessibility tree and actual VoiceOver navigation where available. Unobserved checks stay open. |
| Data and safety | Same actor and record IDs/counts; source/currentness and page-completeness labels; denied, stale, empty, and workspace-change behavior; no bearer, SQLite, direct Worker call, or write path. |
| Product fit | Time and code needed to express Campfire's Workspaces / Needs You / People & Agents grammar without carrying the Git product model. |
| Packaging | Local `.app` launch and signature check if built; no notarization, installer, update, or iMac claim from this sprint. |

Choose `GPUIX` only if the read-only slice is real, accessible enough for the next alpha, and its native/dependency cost is justified by a material interface benefit. Choose `SwiftUI` if it gives the same Campfire result with lower risk or effort. Choose `HOLD` if neither candidate meets the Viewer, data, accessibility, or maintenance boundary. Explain any missing evidence and what MAC-002 would have to close.

## Exit and release boundary

The exit artifacts are a pinned candidate and upstream-delta audit, one runnable GPUIX Campfire slice or a documented build blocker, a side-by-side comparison with MAC-001, and a dated toolkit verdict. MAC-002 opens only after the verdict and the phased plan's released-profile review. MAC-002 owns integrated two-Mac native parity; MAC-003 owns native signing, notarization, installation, updating, and release. The physical branded Cloud handoff and two-Mac CLI update checks remain separate open evidence gates.
