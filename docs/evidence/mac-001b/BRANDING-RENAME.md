# MAC-001B desktop naming pass — October 27, 2026

**Status:** Local naming and package verification passed. This is not a toolkit verdict, Campfire Viewer integration, or native release.

The work started from the clean `campfire-desktop` checkout at `5b88d4c7caccef523f14ecd54e7fa372fe34fa92`. The fork still has only the upstream 1Git `origin`; no remote was added and nothing was pushed. No production website, release Worker, update feed, or Campfire service was deployed.

## Changed

- Renamed active package scopes, workspace imports, lockfile entries, app bundle/executable, native symbol and environment variable prefixes, local data keys, tests, and source references to `campfire-desktop` / `Campfire Desktop`. The old package names no longer appear in active TypeScript, Rust, manifests, or `bun.lock`.
- Renamed the inherited icon source path and website screenshot path, and removed an unused upstream banner. Visual artwork is still inherited and has **not** been approved as Campfire branding.
- Removed inherited analytics and updater startup from the desktop entry point. The local prototype package excludes the old SSH remote helpers and Sparkle runtime. Production website and release deployment now fail closed because no Campfire Desktop origin is configured. Remaining release/website source is retained scaffold, not a ready Campfire service.
- Preserved the upstream MIT copyright in `LICENSE`, third-party notices, and historical GPUIX upstream patch notes. Those historical references are intentionally not reattributed to Campfire.
- Replaced old public product URLs with an explicit `.invalid` placeholder in the retained scaffold. These are **not** user-facing Campfire links or deployment targets. The root README now describes the checkout as an unreleased prototype rather than claiming a Campfire Git product or download.

## Verification

| Check | Result |
| --- | --- |
| `bun install --lockfile-only` with pinned Bun 1.4.2 | Passed; lockfile reflects renamed workspaces. |
| `bun run check-types` | Passed: 12 tasks. |
| `bun run check` | Passed: Oxlint and Oxfmt. |
| `bun run build` | Passed: all five build tasks. |
| `bun run test:portable` in the restricted sandbox | Seven of eight package tasks passed. The Git package had 314 passes and five failures because `Bun.serve({port:0})` could not bind a loopback port (`EADDRINUSE`). |
| Targeted `packages/git/tests/authenticated-clone.integration.test.ts` with loopback access | Passed: six tests, including the five restricted-sandbox failures. |
| `packages/git/tests/repository.integration.test.ts` | Passed: 36 tests after changing fixture keys to the Git-valid `campfire-desktop.*` form. |
| `bun run package:macos` with `CAMPFIRE_DESKTOP_PACKAGE_OUTPUT_DIR=/private/tmp/campfire-desktop-package-test` | Passed. The private 42 MB archive is `campfire-desktop-macos-arm64.zip`; the `.app` is `campfire-desktop.app`. Packaging under the iCloud-synced checkout failed ad hoc signing due to extended attributes, so the test output used `/private/tmp`. |
| Bundle verification | `codesign --verify --deep --strict` passed. Info.plist reports `company.boringinfra.campfire-desktop` and `Campfire Desktop`. |
| `git diff --check` | Passed. |

The clean native build fetched the contract-pinned GPUIX and Zed revisions after an ignored dirty source cache was moved intact to `/private/tmp/campfire-desktop-native-source-before-brand-2026-10-27`. The bundle build logged an Icon Composer export warning in this sandbox, so icon appearance is not accepted. A bundled app launch and its on-screen contents were not checked after this rename. The application still contains the upstream Git workspace behavior and has no Campfire Viewer slice. MAC-001B still needs the isolated Campfire root, real authorized read, and SwiftUI comparison before `GPUIX`, `SwiftUI`, or `HOLD` can be recorded.
