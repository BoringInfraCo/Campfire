# Campfire v1.26.2 — candidate record (unreleased)

**Date:** October 24, 2026  
**Status:** **CANDIDATE / UNRELEASED / ISOLATED REHEARSAL ONLY**  
**Package:** `1.26.2`  
**Source position:** `b68b93c44de6965a3940dd713ef36dc5d7dfc750`  
**Archive:** `~/campfire-rehearsal/v1.26.2/artifacts/campfire-1.26.2-darwin-arm64.tar.gz`  
**SHA-256:** `439f51dfff899bd8fdaaa0a1213a0e895b5c7c0fb5a47459a88361b49cf90283`  
**Isolated endpoint:** `https://campfire-shr001-rehearsal.sunbeam-redraft-7j.workers.dev`

No public tag, GitHub Release, installer-channel update, or production
deployment was created. This record is not a release decision and does not claim
a completed two-Mac rehearsal.

## Source and archive

- The source commit was created before packaging. The archive was built in a clean
  worktree at `b68b93c`; it contains no untracked billing-capture scripts and
  no ` 2.js` duplicate files from the development tree.
- `npm run pack:tarball` built Darwin ARM64 from `1.26.2` in that worktree.
- The archive was checksum-verified against its `.sha256` after being copied to
  the private rehearsal directory and after extraction.
- The archive contains `1.26.2` with `campfire.releaseStatus = "candidate"` and
  includes `publish`, `publish-status`, and `publish-recover`.
- The archive contains no `.env`, credentials, publication receipt, SQLite
  database, or `.campfire` directory.

## Version-linked metadata

- `package.json` and `package-lock.json` are `1.26.2`.
- `campfire.releaseStatus` is `candidate`; `campfire.releaseNote` states that no
  public tag, release, channel, or production deployment exists.
- `src/telemetry/releases.ts` remains at the last released versions. An
  unreleased candidate is allowed through telemetry as `unknown_release`.
- Homebrew and Nix channel files remain pinned to the last released `1.26.1`.
  The install-channel **test** treats a candidate as a non-release and does not
  loosen the released-version guard. The channel sync script itself has no
  candidate branch; channel files remain at `1.26.1` and were not updated.
- The Arbora snapshot digest was recomputed because the package version is part
  of the digest:
  - v1.26.1 capture: `4bb1b5fac9e284dd55fa8d185860aa771719993b420853424690ed9ecf7a477d`
  - v1.26.2 candidate: `4c8496e92290db32d1efe21411686e87bb6c0e26e4706dfaf9bf0091e5bba757`

## Verification battery

| Check | Result |
| --- | --- |
| Full suite | **PASS** — 127 files / 1,538 tests (1,537 passed, 1 opt-in skip) |
| Typecheck | **PASS** |
| Build | **PASS** |
| Isolated Worker deployment dry run | **PASS** — 595.12 KiB, D1 `campfire_shr001_rehearsal`, no assets binding |
| `pack:tarball` | **PASS** — Darwin ARM64, package `1.26.2` |
| Archive checksum | **PASS** — `439f51dfff899bd8fdaaa0a1213a0e895b5c7c0fb5a47459a88361b49cf90283` |
| Installed archive version | **PASS** — `1.26.2`, candidate status |
| Installed `campfire status` with pinned profile | **PASS** — workspace `ws_df6794f33efc459b` |
| Installed `campfire up --no-open` smoke | **PASS** — local API on `127.0.0.1:9414`; no registration was performed |
| Installed-candidate `publish --dry-run` | **PASS** — tip 8, candidate digest `4c8496e9…a757`; no network, temporary receipt only |
| Production Worker unchanged | **PASS** — live production version remains `785c8415-5d58-4cd9-9a57-97aef22b78ad` |

## Isolated hosted target

| Fact | Value |
| --- | --- |
| Worker name | `campfire-shr001-rehearsal` |
| Worker URL | `https://campfire-shr001-rehearsal.sunbeam-redraft-7j.workers.dev` |
| Current Worker version | `faf8edce-425f-4927-84c8-4f66633cfa58` |
| Route | none; `workers.dev` only, `preview_urls = false` |
| D1 database | `campfire_shr001_rehearsal` (id retained only in gitignored `wrangler.rehearsal.local.toml`) |
| D1 migration | 10 applied through `0010_workspace_publication.sql` |
| Publication tables | `publication_enrollments`, `publication_admission_attempts`, `workspace_publications` present |
| Initial publication rows | `enrollments = 0`, admission attempts = 10 after the gate probe |
| Assets binding | omitted; API-only rehearsal surface |

The deploy and migration commands were run only with
`--config wrangler.rehearsal.local.toml` and explicit database/target arguments.
The repository production scripts `npm run deploy` and `npm run db:migrate`
were not used.

## Rehearsal admission gate matrix

| Condition | HTTP result |
| --- | --- |
| Alpha `0` | `403` publication routes |
| Alpha `1`, admission hash unset | `403` “admission is not configured” |
| Alpha `1`, hash set, no code | `403` “rehearsal admission code is required” |
| Alpha `1`, hash set, wrong code | `403` “code was rejected” |
| Alpha `1`, hash set, correct code, invalid body | `400` validation; no enrollment row |
| `/v1/call` without bearer | `401` |
| `/` on API-only Worker | `404` |
| Production Worker version | unchanged `785c8415…` |

The raw rehearsal code is not in this record. It is stored mode `0600` at
`~/campfire-rehearsal/v1.26.2/rehearsal.env` for the MacBook operator. The Worker
stores only its SHA-256 as `CAMPFIRE_PUBLICATION_REHEARSAL_CODE_HASH` (secret).

## MacBook installation and profile

```bash
export CAMPFIRE_CONFIG_DIR="$HOME/.config/campfire-arbora"
export CAMPFIRE_TELEMETRY=0
export CAMPFIRE_PUBLICATION_REHEARSAL_CODE="$(sed -n 's/^CAMPFIRE_PUBLICATION_REHEARSAL_CODE=//p' "$HOME/campfire-rehearsal/v1.26.2/rehearsal.env")"

# Archive already extracted at:
#   $HOME/campfire-rehearsal/v1.26.2/install
$HOME/campfire-rehearsal/v1.26.2/install/bin/campfire status --output json
# workspace.id must be ws_df6794f33efc459b

# When the local service is down, start it in a continuing terminal:
$HOME/campfire-rehearsal/v1.26.2/install/bin/campfire up --no-open
# Then verify status again in another shell and reload the harness.
# Starting the service does not register an agent session.
```

The stale default `~/.config/campfire` Ada profile is not used. The candidate
binary is outside the source checkout; it is not installed over
`~/.local/bin/campfire` (which remains the released `1.26.1`).

## iMac archive

The same Darwin ARM64 archive is available privately at
`~/campfire-rehearsal/v1.26.2/artifacts/`. Transfer it privately (AirDrop,
USB, or an access-controlled share), verify the SHA-256 above, and extract it
outside the source checkout. If the iMac is not ARM64, build from source commit
`b68b93c44de6965a3940dd713ef36dc5d7dfc750`:

```bash
git worktree add /tmp/campfire-1.26.2 b68b93c44de6965a3940dd713ef36dc5d7dfc750
cd /tmp/campfire-1.26.2
npm ci
npm run typecheck
npm run build
sh scripts/package.sh
# Verify the produced architecture archive and checksum.
```

Do not use that build to update public install channels.

## What is not claimed

- No physical MacBook → hosted → iMac → fresh MacBook run has occurred.
- No hosted Arbora copy exists yet.
- No public v1.26.2 tag, GitHub Release, archive publication, Homebrew/Nix pin,
  installer-channel update, or production deployment exists.
- The rehearsal admission gate is not public-alpha admission or public
  self-service approval.
- The stale default profile is not the rehearsal profile.
