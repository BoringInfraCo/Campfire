# MAC-001B upstream delta

Audit date: 2026-10-26. Read-only on `/Users/sergio/Documents/Developer/BoringInfraCo/campfire-desktop`. No fetch, clone, checkout, reset, install, build, or commit. Local `HEAD` is the hash the parent already observed; it did not move during this audit.

## 1. Implementation base

| Fact | Evidence |
| --- | --- |
| HEAD | `5b88d4c7caccef523f14ecd54e7fa372fe34fa92` |
| Subject | `chore(release): refresh 0.1.0 candidate` (Yurii Hulyk, 2026-10-26 22:58:05 +0000) |
| Branch | `master` |
| Upstream | `origin/master` |
| `origin` URL | `https://github.com/1bye/1git.git` (fetch and push) |
| Local `origin/master` | `5b88d4c7caccef523f14ecd54e7fa372fe34fa92` |
| Ahead/behind | `git rev-list --left-right --count origin/master...HEAD` → `0 0` |
| Worktree | `git status --porcelain` empty; `git diff --quiet` and `git diff --cached --quiet` both clean |
| Remotes | `git remote` prints only `origin`. No Campfire-owned remote. None was added. |
| Reviewed revision | `6243465c2161769f162c5ccd528d32c6a37172a0` `feat(gpuix): add tree file navigation (#7)`, ancestor of HEAD |
| Contract pin | `3525f456e263cf02040dbc19fcd9d3959ff809cf` `fix(gpuix): skip missing editor applications`, ancestor of HEAD and of local `origin/master` |

Commit counts (`git rev-list --count A..B`) and tree file counts (`git diff --name-only A B | wc -l`; `--find-renames` did not change the full-range count):

| Range | Commits | Paths differing between the two trees |
| --- | --- | --- |
| `6243465..HEAD` | 38 | 156 |
| `6243465..3525f456` | 33 | 142 |
| `3525f456..HEAD` | 5 | 43 |

The 38 commits include merge `360629749e0f45f2ce44e9142b66847a6567d16f` (`Merge origin/master into master`, parents `557697827534ecd9f62865a364642c4971214956` and `c958548043dd552339a47099d65617d0405a417d`). `git log --name-only` shows no files for that merge.

The contract pin is behind local `origin/master` by these five commits, newest last:

1. `8db198708b2c42469648a7d1687b55471fff806b` `perf(gpuix): reduce grain texture memory`
2. `1976837b5bbfdbc214cbce0bd66eae240fa17045` `chore(release): prepare 0.1.0 candidate`
3. `6240b629175a7c1dd4979b467d92bf7e6e7692f6` `test(updater): match fixture helper signatures`
4. `535dddff0767c4e34057b3384a22f389eac299d0` `fix(gpuix): restore smooth file navigation`
5. `5b88d4c7caccef523f14ecd54e7fa372fe34fa92` `chore(release): refresh 0.1.0 candidate`

The stock build must use this live HEAD. It is the unchanged checkout, and the contract pin is no longer `origin/master`. This audit did not run `git fetch`, so GitHub was not re-contacted; the local remote-tracking ref already equals HEAD.

## 2. Substrate inventory at HEAD

Host, toolchain, and launch timing are left to the stock-build report. Nothing below is a build that this audit ran.

### License and notices

- `/Users/sergio/Documents/Developer/BoringInfraCo/campfire-desktop/LICENSE` — MIT, copyright 2026 1bye and 1git contributors.
- `/Users/sergio/Documents/Developer/BoringInfraCo/campfire-desktop/THIRD_PARTY_NOTICES.md` — GPUIX Apache-2.0, GPUI via the GPUIX pin, Sparkle (copied into the app at package time as `Sparkle-LICENSE.txt`), Phosphor, Lucide/Feather artwork, Inter, Instrument Serif, Apple marketing artwork.
- `apps/gpuix/LICENSES/GPUIX-Apache-2.0.txt`
- `apps/gpuix/LICENSES/Phosphor-Icons.txt`
- `apps/gpuix/src/feature/repository-appearance/pattern-artwork.LICENSE`
- `apps/web/public/licenses/inter-OFL.txt`
- `apps/web/public/licenses/instrument-serif-OFL.txt`
- `apps/web/public/licenses/phosphor-icons.txt`
- `.agents/skills/turborepo/LICENSE` is a vendored skill license, not an app notice.

No `tauri.conf.json`. No checked-in `Info.plist`; packaging writes one.

### Lockfile and package manager

- Lockfile: `bun.lock` at the repo root (195831 bytes at audit time). No `package-lock.json`, `yarn.lock`, or `pnpm-lock.yaml` at the root.
- Root `package.json` field `packageManager` is `bun@1.4.2`. That line is outside this delta (`git diff 6243465 HEAD -- package.json` is empty). `apps/gpuix/package.json` has no `packageManager` field.
- Root `patchedDependencies`: `"@gpuix/native@0.10.0": "patches/@gpuix%2Fnative@0.10.0.patch"`.

`bun.lock` in this delta only moves workspace versions: `@1git/gpuix` `0.0.1` → `0.1.0`, `@1git/git` `0.0.0` → `0.0.1`.

### GPUIX / GPUI / `@gpuix/native`

There is no npm package named `@gpui`. Manifest versions:

| Package | Where | Version |
| --- | --- | --- |
| `@gpuix/native` | `apps/gpuix` dependency; `packages/gpuix-ui` and `packages/gpuix-stylesheet` dev and peer | `0.10.0` |
| `@gpuix/react` | same | `0.10.0` |
| `@1git/gpuix` | `apps/gpuix/package.json` | `0.1.0` (was `0.0.1` at `6243465`) |
| `@1git/git` | `packages/git/package.json` | `0.0.1` (was `0.0.0`) |
| `@1git/gpuix-ui` | `packages/gpuix-ui/package.json` | `0.0.1` (unchanged; its `test` script now preloads `apps/gpuix/native/preload.ts`) |
| `@1git/analytics` | `packages/analytics/package.json` | `0.0.1` |
| `@1git/hosting` | `packages/hosting/package.json` | `0.0.0` |

Source pins, unchanged in this delta (`nativeRevision` is not in the `config.ts` diff; the README hash lines are not in the README diff):

- GPUIX source: `apps/gpuix/native/config.ts` `nativeRevision = "9fcd628863e354e9c58019fc3bf38981a1e64158"`.
- Documented GPUI fork (`zed` submodule): `81c99f816b4a5f69d3c014774068034c24d1d7af` in `docs/gpuix-upstream/README.md` and `apps/gpuix/README.md`.
- On-disk cache already present at audit time, not created by this audit: `apps/gpuix/.cache/native-source` HEAD is `9fcd628863e354e9c58019fc3bf38981a1e64158`, and `git submodule status` shows `81c99f816b4a5f69d3c014774068034c24d1d7af zed`. Submodule URL in that cache: `https://github.com/remorses/zed.git`, branch `gpuix`.

### `patches/`

One file: `patches/@gpuix%2Fnative@0.10.0.patch` (12851 bytes, 248 lines). It is a Bun patch of the published `@gpuix/native@0.10.0` JavaScript package, not the Rust tree. It edits `dist/host.d.ts`, `dist/mutations.js`, `dist/testing.d.ts`, `dist/testing.js`, and `index.d.ts`.

Category: native API. It widens the host/renderer typings and test-renderer wrappers (focus, bounds, scroll, images, window chrome, path prompt, debug overlay). It does not add network, credential, startup, or packaging code.

This delta adds two bindings to that file:

- `getApplicationIcon(path: string): Buffer | null` (`ab89e1cb0fb935cc1648174d9f9103f308be1269`).
- `getElementBounds(elementId, refresh = true)` (`535dddff0767c4e34057b3384a22f389eac299d0`).

The Rust patches that the native build applies live under `apps/gpuix/native/*.patch` (46 files) and are hashed into `nativeBuildId` by `apps/gpuix/native/config.ts`. `apps/gpuix/native/build.ts` applies `*-platform.patch` files inside the `zed` submodule and the others at the GPUIX root. None of those files is a network patch. Categories:

- Credential (native API over Keychain / secure input): `accounts.patch`, `accounts-platform.patch`. Unchanged in this delta.
- Native API: `titlebar-drag.patch`, `checkbox-a11y.patch`, `diff-scroll.patch`, `diff-context.patch`, `diff-split.patch`, `diff-split-layout.patch`, `diff-inclusion.patch`, `diff-syntax.patch`, `diff-inclusion-theme.patch`, `diff-rails.patch`, `diff-trailing-context.patch`, `textarea-viewport.patch`, `textarea-decorations.patch`, `window-activation.patch`, `close-protection.patch`, `close-platform.patch`, `context-menu.patch`, `context-menu-platform.patch`, `context-menu-items.patch`, `context-menu-items-platform.patch`, `context-menu-owner.patch`, `context-menu-owner-platform.patch`, `context-menu-icons.patch`, `context-menu-icons-platform.patch`, `test-session.patch`, `test-session-platform.patch`, `live-frame-platform.patch`, `element-bounds.patch`, `anchored-center.patch`, `workspace-shortcuts.patch`, `menu-placement-platform.patch`, `scroll-metrics.patch`, `text-scale.patch`, `font-families.patch`, `application-icons.patch`, `application-icons-platform.patch`.
- Cosmetic / appearance: `sidebar-vibrancy-platform.patch`, `rounded-overflow-platform.patch`, `window-appearance.patch`, `window-appearance-platform.patch`, `system-appearance.patch`, `system-appearance-platform.patch`, `frame-scrollbar.patch`, `scrollbar-visibility.patch`.

Changed in this delta:

- Added `application-icons.patch`: N-API `get_application_icon` on the GPUIX renderer and test renderer. Calls `gpui_macos::application_icon_png`. Comment in the patch: return a bounded AppKit PNG without launching the application.
- Added `application-icons-platform.patch`: new `crates/gpui_macos/src/application_icons.rs`. Rasterizes an installed `.app` icon. Rejects empty, overlong, non-absolute, non-`.app`, `.` / `..`, or missing-bundle paths before AppKit. Requires the main thread.
- Modified `element-bounds.patch`: test renderer `get_element_bounds` takes `refresh: Option<bool>` and skips `flush()` when `refresh` is false. Default remains refresh-first. `docs/gpuix-upstream/08-element-bounds.md` describes this as a last-paint read so input-frame benchmarks do not draw extra frames.

`build.ts` and `config.ts` add those two icon patches to the apply list and to `nativeBuildId`. `application-icons-platform.patch` is applied under `zed`. A native binary built at the contract pin does not match this HEAD's build id.

### Scripts that start, package, update, or release

Root `package.json`:

- `dev` → `turbo run dev`
- `dev:app` → `turbo run dev --filter=@1git/gpuix`
- `build` → `turbo run build`
- `package:macos` → `turbo run package:macos --filter=@1git/gpuix`
- `setup:signing:macos`, `test:signing:macos`, `test:package:macos`, `test:updates:macos`
- `prepare:updates:macos` → `turbo run prepare:updates:macos --filter=@1git/gpuix`
- `release:macos` → `turbo run release:macos --filter=@1git/gpuix --`
- `test:release:transport`, `test:release:macos`
- `deploy:updates` → `turbo run deploy:updates --filter=@1git/releases --`

`apps/gpuix/package.json` (`@1git/gpuix@0.1.0`):

- `dev` → `MallocLargeCache=0 MallocAggressiveMadvise=1 bun --preload ./native/preload.ts --hot src/main.tsx`
- `start` → same malloc flags, `bun --preload ./native/preload.ts dist/main.js`
- `build:native` → `bun native/build.ts`
- `build:remote-helpers` → `bun native/build-remote-helpers.ts`
- `package:macos` → `bun native/package-macos.ts`
- `prepare:updates:macos` → `bun native/prepare-updates.ts`
- `release:macos` → `bun native/release-macos.ts`
- `setup:signing:macos` → `bun native/setup-signing.ts`
- `test:package:macos`, `test:updates:macos`, `test:release:macos`, `test:release:transport` as in the manifest

`apps/gpuix` `test` gained `--timeout 30000` in `535dddff`. That is the only script change in `apps/gpuix/package.json` besides the version bump. Root release/update script names did not change. `apps/releases/package.json` (`@1git/releases@0.0.0`) still has `deploy:updates`: `alchemy deploy`. Not modified in this delta.

### macOS minimum

- README badge: `README.md` line 13, `https://img.shields.io/badge/macOS-13%2B-black`. Body text: "Requires macOS 13+, an Apple Silicon Mac, and Git."
- `apps/gpuix/README.md`: "Runtime support starts at macOS 13".
- Generated bundle plist template `apps/gpuix/native/package-resources.ts`: `LSMinimumSystemVersion` = `13.0`, `CFBundleIdentifier` = `dev.1git.gpuix`. Unchanged in this delta.
- `apps/gpuix/native/package-macos.ts` passes `actool --minimum-deployment-target 13.0`. Unchanged.
- `apps/gpuix/native/sparkle.ts` compiles `native/updater.m` with `-mmacosx-version-min=13.0` and `-arch arm64`. Unchanged.
- `apps/gpuix/native/build-remote-helpers.ts` sets `MACOSX_DEPLOYMENT_TARGET` to `13.0`. Unchanged.
- No Tauri config.

## 3. Delta since `6243465`

`apps/gpuix/src/main.tsx` is not in the 156-path diff. `git diff --stat 6243465 HEAD -- apps/gpuix/src/main.tsx` is empty. Startup calls are the same as at the reviewed revision.

`apps/gpuix/src/main.tsx` still does all of the following:

```tsx
DesktopAnalytics.start(preview);
const restored = session?.load();
discoverRepositories={preview ? undefined : RepositoryDiscovery.scan}
AppUpdater.start();
```

Lines: `DesktopAnalytics.start` at line 18, `session?.load()` at line 24 (`WorkspaceSessionStore` when `GPUIX_PREVIEW` is not `1`), `RepositoryDiscovery.scan` at line 49, `AppUpdater.start()` at line 58. Also unchanged and still constructed on that path: `RepositoryDiscoveryCache` at `repository-discovery-v1` next to the session file (lines 26–30), and `RepositoryWatcher.watch` (line 48).

These paths have an empty diff against `6243465`: `apps/gpuix/src/app-updater.ts`, `packages/analytics`, `apps/gpuix/src/feature/machines`, `apps/gpuix/native/build-remote-helpers.ts`, `apps/gpuix/native/package-macos.ts`, `apps/gpuix/native/release-macos.ts`, `apps/gpuix/native/prepare-updates.ts`, `apps/gpuix/native/sparkle.ts`, `packages/hosting`.

### Startup

No startup-sequence change. `window-options.ts` only inserts two earlier `onKeyDown` handlers (`cfd3d1b` keybind recording, `37e9b88` sync-review keys). They run before existing handlers. They do not start services.

### Native addon

- `ab89e1cb` adds the application-icon N-API and wires it into `build.ts`, `config.ts` (`nativeBuildId`), and `patches/@gpuix%2Fnative@0.10.0.patch`. JS callers are editor settings (`apps/gpuix/src/feature/editor-settings/application-icons.ts`, `editor-application-icon.tsx`). Behavior: read an installed app icon without launching it.
- `535dddff` changes `element-bounds.patch` and the same published JS patch so `getElementBounds` can skip a refresh. Same commit changes `apps/gpuix/src/fixture/overflowing-label.tsx`, `repository-list.tsx`, and `repository-change-details.tsx`, and adds `apps/gpuix/tests/native-session/bounds.component.test.tsx` plus `apps/gpuix/tests/_shared/native-input-frame.ts`. `packages/gpuix-ui` tests now load the native preload.
- `3525f456` does not touch the addon. It changes `apps/gpuix/src/feature/editor-settings/external-editors.ts`: `detectApplication` returns null when `existsSync` is false or `application()` throws, so missing bundles are skipped during discovery. Saved missing editors stay visible as unavailable (`apps/gpuix/CHANGELOG.md` patch note for `3525f45`).

No other native patch file changed.

### Network, credentials, SSH, hosting

No new client, feed URL, credential store, SSH helper, or hosting package change.

Repository behavior that does change, all local git:

- `37e9b884` `packages/git/src/contracts.ts`: `ResolveConflictInput.expectedSideOid`. `packages/git/src/repository.ts`: when a side is chosen, load `:${stage}:${path}` through `loadFileContent` instead of `git show` stdout; if `expectedSideOid` is set and `source.revision` differs, throw `The indexed version changed since the preview. Refresh before choosing it.`; still reject oversized, non-utf8, NUL, or nested-marker content before `writeFile`. UI for that review is `repository-comparison/repository-sync-review.tsx`, `repository-conflict-files.tsx`, `repository-conflict-preview.tsx`, `repository-sync-button.tsx`, `use-repository-mutations.ts`. Changelog text: push stays a separate action.
- `55769782` only adjusts `repository-sync-button.tsx` (publish-branch dialog copy and single-remote selection). No git-library change.
- `2df65132` adds session field `autoIncludeChanges` (default false in `workspace-session.ts`) and a Git settings toggle. Not a network change.
- Account, Git identity, and AI files in this range are settings layout. `git diff` on `apps/gpuix/src/feature/accounts` and `remote-account.tsx` does not change token, OAuth, Keychain, or SSH calls. AI diffs move existing provider controls (`chatgpt`, `api`, `opencode`, CLI notice) into the shared settings layout. Claude Code / Codex / compatible-API behavior is `a2080ab`, which is an ancestor of `6243465`, not part of this delta. `docs/releases/0.1.0.md` still lists it because the 0.1.0 notes cover older commits.

### Analytics

`packages/analytics` is unchanged, and `DesktopAnalytics.start` is unchanged.

`c977f6e9`, `a92055a4`, and `ab89e1cb` edit `apps/gpuix/src/feature/analytics/privacy-settings.tsx` (90 insertions, 77 deletions). `analytics.setEnabled` and `analytics.enabled` remain. The visible footer still says random identifiers stay in memory and rotate, there are no session recordings or automatic click tracking, disabling stops new events and cancels pending requests, and events already received by PostHog remain there. `apps/gpuix/tests/analytics/privacy.component.test.tsx` is touched again by `535dddff` (fixture/helper fallout, not a new analytics pipeline).

### Updater and release

`app-updater.ts`, Sparkle embed, `prepare-updates.ts`, and `release-macos.ts` are unchanged.

- `1976837b` consumes the pending changesets, sets `@1git/gpuix` to `0.1.0` and `@1git/git` to `0.0.1`, writes `apps/gpuix/CHANGELOG.md`, `packages/git/CHANGELOG.md`, and `docs/releases/0.1.0.md`, and updates `bun.lock`.
- `5b88d4c7` folds `535dddff`'s changeset into that changelog and release note. No further version bump.
- `6240b629` only edits `apps/gpuix/tests/updater/install.integration.test.ts` and a release-note line. The test, before `codesign --verify --deep --strict`, re-signs `Frameworks/Sparkle.framework` (including `Versions/B/XPCServices/Downloader.xpc`, `Installer.xpc`, `Versions/B/Updater.app`, `Versions/B/Autoupdate`, and the framework root) and `Frameworks/1git-updater.dylib` with the disposable fixture signer. Comment in the test: copied Developer ID helpers must match that signer or XPC rejects the fixture before installation is tested. Downloader.xpc keeps its entitlements. This does not change the shipping updater.

`docs/releases/0.1.0.md` at HEAD links `https://git.1bye.dev/1git-0.1.0-macos-arm64.zip`, says the beta is Developer ID signed and notarized, and tells existing users to update with **1git → Check for Updates…**. It also says an upgrade from an ad-hoc build such as 0.0.25 may prompt once for Keychain access because the new signing identity does not inherit the old credential ACL. That is release copy. The signing scripts were not edited in this range.

The 0.1.0 notes also name commits that are **not** in `6243465..HEAD`: `a2080ab` (AI CLIs and compatible APIs), `6243465` itself (tree file navigation), `8cf56d3` (Changesets), `299b8b3` (search grid), `41d4d2d` (strip native override from hooks). Those behaviors are already in the reviewed tree.

### Product surface MAC-001B step 1 still has to remove or make unreachable

Still started or still present, and not removed by this delta:

| Surface | Still reachable because | What this delta did |
| --- | --- | --- |
| Repository, branch, diff, worktree | `main.tsx` still restores the workspace session, watches repositories, and scans for them. Feature tree under `apps/gpuix/src/feature/repository-*` remains. | Adds sync/conflict review (`37e9b88`), publish-dialog polish (`5576978`), off-by-default auto-include (`2df6513`), copyable commit/hook output (`ce9953f`), smoother file-list scroll and labels (`535dddf`), compact close notice (`c958548`). |
| Hosting accounts | `packages/hosting` unchanged. Account settings still mounted from the settings shell. | Layout only (`f9e0b2f`, `ad29046d`, `db0607be`, and later settings commits). |
| SSH / remote helper | `apps/gpuix/src/feature/machines` and `build-remote-helpers.ts` unchanged. README still lists "Work over SSH". | Nothing. |
| AI commit | AI settings and `@earendil-works/pi-ai` / `pi-agent-core` dependencies remain. Provider implementation predates this range. | Settings layout only (`cd183c8b`, `6d157eee`, `ad29046d`). |
| Analytics | `DesktopAnalytics.start(preview)` still runs before `render`. | Privacy page regrouped. Same `setEnabled` behavior. |
| Update / release | `AppUpdater.start()` still runs after `render`. Package, Sparkle, and release scripts unchanged. | App version is now `0.1.0`. Release note advertises the 0.1.0 zip and Check for Updates. Updater test re-signs fixture helpers. |

Also new, and in the same shell step 1 has to hide if the slice is not the full 1git app: keybinds (`cfd3d1b`, persisted on the session), custom-space delete (`b25eab2`), repository appearance previews (`4cb913c`, `e8b26ee`), grain toggle (`0f705e2`, default on, persisted as `showGrain`).

Session document additions in `apps/gpuix/src/feature/workspace-tabs/lib/workspace-session.ts`: optional `autoIncludeChanges`, `showGrain`, and `keybinds`. Restore still goes through the unchanged `main.tsx` `session.load()`.

### Commit groups

Settings shell, presentation only unless noted: `0fd55b16` shared layouts; `a92055a4` privacy and editor; `24e30d16` appearance; `cd183c8b` AI; `a8b27be4` Git settings; `f9e0b2f0` accounts; `871894e3` ignored history, keybinds, repository appearance, spaces; `db0607be` settings navigation; `d6d3f153` grouped patterns; `6d157eee` add-action alignment; `c977f6e9` privacy groups; `72e8b10b` edit spaces in settings; `6579e447` editor choices; `ad29046d` saved identities (accounts, AI, git); `a32f04ce` ignored-history split; `b0dc4847` settings scrollbars; `ab89e1cb` settings polish plus the new icon native API above.

Repository and git behavior: `37e9b884` sync and conflict review; `55769782` publish dialog; `2df65132` automatic inclusion; `ce9953f3` copyable commit output; `535dddff` file navigation and element-bounds; `c9585480` close notice; `3525f456` skip missing editors.

Other product: `b25eab2c` delete custom spaces; `cfd3d1b0` keybinds; `4cb913cc` and `e8b26ee6` appearance previews; `0f705e2b` grain toggle; `8db19870` smaller grain texture (`apps/gpuix/src/fixture/chrome-grain.ts`, `app-shell.tsx`).

Release: `1976837b`, `6240b629`, `5b88d4c7`. Docs only: `421e56dc` README and `ROADMAP.md`; `12045c55` roadmap; `b41f6c03` and `14e3b2fb` README banner SVG. Empty merge: `36062974`.

## 4. Implications for the Campfire slice

Isolation was not started.

The startup cut is the same size as at the reviewed revision and at the contract pin: `main.tsx` still starts analytics, restores the workspace session, discovers repositories, and starts the updater. Hiding those four calls is not made larger or smaller by this delta.

The later isolation step is larger around the shell those calls feed:

- More repository UI to remove or leave unreachable: sync review, conflict side selection with `expectedSideOid`, publish dialog, auto-include, file-list scroll behavior.
- More persisted session fields (`autoIncludeChanges`, `showGrain`, `keybinds`). A slice that still loads `WorkspaceSessionStore` will see documents written by this HEAD.
- Settings navigation was regrouped, not deleted. Account, AI, Git identity, privacy, and editor pages are still in that navigation.
- `nativeBuildId` now covers two new icon patches and a changed element-bounds patch. A slice that builds the stock addon has to use this HEAD's patch stack; a pin-era addon is stale. The new native surface is an editor-icon read, not a network or credential API.
- The app version and the checked-in 0.1.0 release note now describe a Sparkle update and a public zip. The updater implementation did not change, so disabling `AppUpdater.start()` is the same edit, but the release identity of the tree is `0.1.0` rather than `0.0.1`.

Nothing in the five commits after the pin removes SSH, hosting, analytics, or the updater. Those cuts stay the same size. The post-pin commits add grain memory work, the `0.1.0` version/changelog, an updater **test** re-sign, the element-bounds refresh flag, and file-list scroll behavior.

## 5. Commands and gaps

Commands run, all with `git -C` or `cd` to the desktop checkout:

- `git rev-parse HEAD`, `git status -sb`, `git status --porcelain`, `git branch -vv`, `git remote -v`, `git config --get-regexp '^remote\.'`, `git rev-parse --abbrev-ref HEAD`, `git rev-parse --abbrev-ref --symbolic-full-name @{u}`, `git rev-parse origin/master`
- `git merge-base --is-ancestor` for `6243465` vs HEAD, `3525f456` vs HEAD, `6243465` vs `3525f456`, and `3525f456` vs `origin/master`
- `git rev-list --count` and `git diff --name-only | wc -l` for the three ranges; `git diff --name-only --find-renames` for the full range
- `git rev-list --left-right --count origin/master...HEAD` and `HEAD...origin/master`
- `git log --reverse --format` and `git log --name-only` for `6243465..HEAD`
- `git diff --stat` and `git diff` for `3525f456..HEAD` and for the risky paths named above
- `git diff --quiet` and `git diff --cached --quiet`
- File reads and `rg` of `package.json`, `main.tsx`, `config.ts`, `LICENSE`, `THIRD_PARTY_NOTICES.md`, `README.md`, `package-resources.ts`, `package-macos.ts`, `sparkle.ts`, the icon and element-bounds patches, `docs/releases/0.1.0.md`, `apps/gpuix/CHANGELOG.md`, `docs/gpuix-upstream/README.md`, `docs/gpuix-upstream/08-element-bounds.md`
- `git -C apps/gpuix/.cache/native-source rev-parse HEAD` and `submodule status` (existing cache only)

Not verified:

- No `git fetch`, `git ls-remote`, or clone. Equality with GitHub is the local `origin/master` ref, which matches HEAD and matches the parent's 2026-10-26 observation.
- No install, native build, package, or launch. Cache presence only shows a previous native source checkout at the documented pins. It is not a fresh confirmation that `remorses/gpuix` and `remorses/zed` still serve those objects.
- No signature, notarization, or update-feed check of `https://git.1bye.dev/1git-0.1.0-macos-arm64.zip`. The URL is quoted from `docs/releases/0.1.0.md` only.
- `Sparkle-LICENSE.txt` is not a source file; `THIRD_PARTY_NOTICES.md` says packaging copies it into the app.
- Did not enumerate every settings-JSX hunk. Account, AI, and privacy conclusions are from path lists plus the symbol diffs cited above, not from a line-by-line UI review.
