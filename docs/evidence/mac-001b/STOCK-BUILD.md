# MAC-001B step 0 — stock 1Git build

Scope: unchanged checkout, documented install and one launch of `bun run dev:app`. No Campfire transformation, no source edits, no commit, no push, no new git remote, no hosting sign-in, no repository opened in the app, no release / signing / notarization / deploy scripts. No toolkit verdict.

## Checkout

| Check | Result |
| --- | --- |
| Path | `/Users/sergio/Documents/Developer/BoringInfraCo/campfire-desktop` |
| Top-level | same path (own git repo, not the BoringInfraCo parent) |
| HEAD at start and after | `5b88d4c7caccef523f14ecd54e7fa372fe34fa92` |
| Branch | `master` tracking `origin/master` (`## master...origin/master`) |
| Worktree at start | clean (`git status --short` empty, no staged or unstaged diff) |
| Older pin `3525f456` | not checked out |
| Existing remote | `origin` `https://github.com/1bye/1git.git` (fetch and push). Not added or changed by this step. |

Subject line of HEAD: `chore(release): refresh 0.1.0 candidate` (Yurii Hulyk, 2026-10-26 22:58:05 +0000).

## Host and toolchain

Recorded at task start (local date `Mon Oct 26 23:48:48 EDT 2026`).

| Tool | Observed |
| --- | --- |
| macOS | 26.6.2, build `25G83` (`sw_vers`) |
| Arch | `arm64` (`uname -m`) |
| Xcode | 26.2, build `17C52` (`xcodebuild -version`) |
| SDK | `/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk` (`xcrun --show-sdk-path`) |
| Default `rustc` | `rustc 1.96.1 (31fca3adb 2026-06-26)` |
| Default `cargo` | `cargo 1.96.1 (356927216 2026-06-26)` |
| `rustup show active-toolchain` | `stable-aarch64-apple-darwin (default)` |
| Global bun | `1.3.5` at `/Users/sergio/.bun/bin/bun`. Not upgraded or replaced. Still `1.3.5` after the run. |
| Pinned bun | `1.4.2` at `/tmp/mac-001b-bun-1.4.2/bun-darwin-aarch64/bun` |

Pinned bun was the official `bun-v1.4.2` darwin-aarch64 zip from `https://github.com/oven-sh/bun/releases/download/bun-v1.4.2/bun-darwin-aarch64.zip`, unpacked under `/tmp/mac-001b-bun-1.4.2`. `bun --version` printed `1.4.2` before `bun install`. That directory was prepended to `PATH` only in the install and launch shells. `packageManager` in `package.json` is `bun@1.4.2`. README requires Bun 1.4.2, full Xcode, and Rust. Xcode and Rust were already present. Neither Xcode nor rustup was installed.

The native build’s own `apps/gpuix/.cache/native-source/rust-toolchain.toml` sets `channel = "1.97.1"`. The live `cargo`/`rustc` processes for the addon were `/Users/sergio/.rustup/toolchains/1.97.1-aarch64-apple-darwin/bin/cargo` and the matching `rustc`. That toolchain was already installed. It was not installed by this step. Default `rustc --version` stayed 1.96.1.

## Install

Command, from the checkout, with pinned bun on `PATH`:

```sh
bun install --frozen-lockfile
```

- Start/end: `2026-10-27T03:49:20Z` (same second).
- Exit code: `0`.
- Output: `bun install v1.4.2 (744846f84)`; `Resolved, downloaded and extracted [1]`; `+ @stylistic/eslint-plugin@5.10.0`; `2 packages installed [154.00ms]`.
- `bun.lock` SHA-256 before and after: `9104e046d3fe98c1fa2ba22b75a8badcac6946f9a4c35dfbb09d87e8d4e7ca29`. Lockfile was not refreshed and did not need `git checkout`.

## Launch

Documented command: `bun run dev:app` (`turbo run dev --filter=@1git/gpuix`). Stdout and stderr: `/tmp/mac-001b-stock-build.log`.

### Attempt 1 — pre-existing native cache, failed

- Start: `2026-10-27T03:50:24Z` (epoch `1793073024.080188`), HEAD `5b88d4c7caccef523f14ecd54e7fa372fe34fa92`, pinned bun `1.4.2`.
- Exit: code `1` at `2026-10-27T03:50:25Z`. Log lines `DEV_APP_EXIT 1` and `DEV_APP_EXIT_DATE 2026-10-27T03:50:25Z`. Turbo reported `Time: 1.183s`.
- No ready signal. No window. No app process left running.
- Failure quote:

```text
error: patch failed: packages/native/src/renderer.rs:5257
error: packages/native/src/renderer.rs: patch does not apply
error: Native build failed: git apply --check /Users/sergio/Documents/Developer/BoringInfraCo/campfire-desktop/apps/gpuix/native/element-bounds.patch
error: script "build:native" exited with code 1
ERROR  run failed: command  exited (1)
error: script "dev:app" exited with code 1
```

`apps/gpuix/.cache/native-source` already existed and is gitignored (`.gitignore` rule `.cache`). Its HEAD was the pinned GPUIX revision `9fcd628863e354e9c58019fc3bf38981a1e64158`, but the tree was dirty (modified `packages/native/src/renderer.rs` and other native files, plus untracked `.changeset/1git-*.md` and `packages/native/src/context_menu.rs`). `apps/gpuix/.cache/native/build-id` mtime was `2026-10-26 19:27:34` local, before this step. The stock `build.ts` path did not print `Local GPUIX native build is up to date.` This attempt’s patch unwind/apply is what the script does; it then failed the `element-bounds.patch` check. Whether every dirty path was already dirty before this attempt is **unobserved** (no pre-launch `git status` of that cache). The cache directory mtime moved to `2026-10-26 23:50` local during the attempt.

### Attempt 2 — cache moved aside, window observed

The gitignored `apps/gpuix/.cache/native-source` directory was moved to `/tmp/mac-001b-preexisting-native-source` so the stock script could clone a clean tree. Checkout source was not edited. This is a second `bun run dev:app`, not a second source change.

- Start: `2026-10-27T03:53:00.314513Z` (epoch `1793073180.314513`).
- The script cloned `https://github.com/remorses/gpuix.git` into the gitignored cache and checked out `9fcd628` (`HEAD is now at 9fcd628 test: resolve Solid consumer build entry with fileURLToPath`), then submodule `zed` at `81c99f816b4a5f69d3c014774068034c24d1d7af`. That clone is the stock native build, not an app “open repository” action.
- Cargo: `Finished release profile [optimized] target(s) in 1m 54s`.
- Addon quote: `Built local GPUIX addon: /Users/sergio/Documents/Developer/BoringInfraCo/campfire-desktop/apps/gpuix/.cache/native/gpuix-native.node`
- Dev command quote: `MallocLargeCache=0 MallocAggressiveMadvise=1 bun --preload ./native/preload.ts --hot src/main.tsx`
- Ready-signal quote (log): `[gpuix] created native window` followed by `[gpuix] mount complete`.
- Ready-signal quote (window): `pid=54630 layer=0 owner=bun name=1git` from `CGWindowListCopyWindowInfo` (`/tmp/mac-001b-windows`). That was the only bun/1git window in that sample.
- Observed startup wall time: **127.507 seconds** from attempt-2 process start to the first window sample (`2026-10-27T03:55:07.821513Z`). The sampler interval was 5 seconds, so the window can have appeared up to about 5 seconds earlier. The log lines have no timestamps. Exact sub-second time of `[gpuix] created native window` is **unobserved**.
- Processes at observation: turbo `run dev --filter=@1git/gpuix`, `bun run dev`, and `bun --preload ./native/preload.ts --hot src/main.tsx` (pid 54630, the window owner).
- Bun exit code for attempt 2: **unobserved**. The wrapper was signalled with the process group before it could append `DEV_APP_EXIT_2`. Turbo then wrote `Shutting down Turborepo tasks...`, `Force killed Turborepo tasks: @1git/gpuix#dev`, and `Time: 2m44.921s`. That turbo time includes the window staying up until quit. It is not the time-to-ready.

A System Events `osascript` scan of every process’s windows timed out at 15 seconds and was not used as the ready signal. A later `osascript` asking for processes named `1git` or `bun` exited `1` with error `-1728` and did not list those names. That query raced the quit. It did not show a window.

## Repository, account, onboarding

- No folder was chosen and no GitHub/GitLab (or other host) sign-in was performed.
- No separate file-dialog window owned by `bun` was in the CGWindow sample that showed `name=1git`. Whether welcome/onboarding content was drawn inside that window is **unobserved** (the window was not read with Accessibility, and it was not clicked). The app was quit instead of advancing any onboarding step.
- `com.apple.appkit.xpc.openAndSavePanelService` appeared in an unrelated System Events process dump. It was **not** attributed to this app.

## Quit and leftovers

The attempt-2 launcher process group was sent `SIGTERM` (`kill` on the turbo/bun group, and the tracking shell was terminated). After that:

- `CGWindow` count of `name=1git` was `0`.
- No remaining processes matched `bun-darwin-aarch64`, `turbo run dev --filter=@1git/gpuix`, `native/preload.ts --hot src/main.tsx`, `bun native/build.ts`, or the native-source cargo target.

Leftover dev processes: **none observed**.

## Git status after

```text
git status -sb
## master...origin/master

git status --short
(empty)

git rev-parse HEAD
5b88d4c7caccef523f14ecd54e7fa372fe34fa92

git diff --stat
(empty)
```

Tracked source and `bun.lock` are unchanged. `node_modules` (`.gitignore` line `node_modules`) and `apps/gpuix/.cache` (`.gitignore` rule `.cache`) are gitignored and present, including the new native clone and `gpuix-native.node`. Ignored dirty detail beyond that was not enumerated.

## Not done

No commit, push, new remote, hosting login, in-app repository open, or release/signing/notarization/deploy script. Global bun was not replaced. This note is not a toolkit verdict.
