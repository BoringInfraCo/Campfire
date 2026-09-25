# Campfire — Sprint 014 Result: Trust the Operator Path

**Status:** Complete (**GO**)
**Date:** September 24, 2026
**Patch candidate:** `v1.2.1` (local only; not tagged, not published, not deployed)
**Depends on:** Sprint 013 — Public Release `v1.2.0` (**GO**)

---

## 1. Result

An operator can trust the documented migrate, deploy, install, and upgrade
paths. `npm run db:migrate` now uses the same credential-safe Wrangler wrapper
as deploy. Remote migrate and deploy fail locally, before Wrangler starts,
when no non-placeholder D1 id is available. A `latest` install reports the
version stored in the installed package, and a pinned install refuses an
archive whose package version differs before it replaces an existing prefix.

Recommendation: **GO**.

This is operator-path evidence. Gate B repeat usage, Gate C external
multi-participant value, retention, and product-market fit remain unmeasured.
`v1.2.1` is not a public release.

The live production command `npm run db:migrate` was not run. Sprint 014
requires separate authorization for that remote mutation, and this
implementation did not receive it. Do not treat the remote apply path as
re-proven against Cloudflare. The wrapper's migrate arguments, id precedence,
fail-closed behavior, ephemeral-config cleanup, and exit-status propagation
are deterministic test evidence.

---

## 2. What changed

- `package.json` and `package-lock.json` are `1.2.1`.
- `npm run db:migrate` runs `node scripts/wrangler-deploy.mjs d1 migrations apply campfire --remote`.
- `scripts/wrangler-deploy.mjs` keeps `$CAMPFIRE_D1_DATABASE_ID` ahead of
  gitignored `wrangler.local.toml`. The placeholder
  `00000000-0000-0000-0000-000000000000` and
  `REPLACE_ME_WITH_OUTPUT_OF_WRANGLER_D1_CREATE` are not real ids. An explicit
  sentinel in the environment does not fall through to the local file. Any
  invocation without `--dry-run` fails closed before spawning Wrangler when
  no real id is available. A real id is injected into an ephemeral config
  whose `main`, `migrations_dir`, and assets directory are absolute. That
  directory is removed after Wrangler exits, including failure. Logs name the
  configuration source and do not print the id.
- `npm run deploy` and `npm run deploy:dry-run` keep their previous argument
  shapes. Dry-run still runs against the committed placeholder when no real
  id is set.
- `public/campfire/install.sh` reads `lib/campfire/package.json` after unpack
  and before copying into the prefix. Success text uses that version. A pin
  that disagrees fails before replacement. Checksum verification and the Node
  22 guard are unchanged.
- Packaging created `public/campfire/v1.2.1/install.sh` from the current
  installer. `v1.0.0`, `v1.1.0`, and `v1.2.0` installers are unchanged.
- README, operator guidance, and `wrangler.toml` comments describe the shared
  wrapper. They no longer say remote migration resolves by database name.

Test-only seams `CAMPFIRE_WRANGLER_BIN` and `CAMPFIRE_CONFIG_ROOT` let the
suite stub Wrangler and avoid the operator's gitignored local config. Production
npm scripts set neither, so the wrapper still runs `npx wrangler` from the
repository root.

No domain, schema, authorization, MCP, HTTP, Worker behavior, or Viewer change.

---

## 3. Validation evidence

Node `22.23.2`:

```text
npm run typecheck                 PASS
npm run test:unit                 PASS — 15 files / 225 tests
npm run test:integration          PASS — 8 files / 80 tests
npm run test:acceptance           PASS — 3 files / 8 tests
npm test                          PASS — 29 files / 337 tests
npm run build                     PASS
npm run pack:tarball              PASS — darwin-arm64
npm run deploy:dry-run            PASS — id source wrangler.local.toml; no id printed
```

Focused wrapper tests: 11 passed. Focused installer tests: 13 passed. Those
counts are included in the 225 unit tests.

Fail-closed rehearsal, with `CAMPFIRE_D1_DATABASE_ID` unset and
`wrangler.local.toml` temporarily absent, then restored:

```text
npm run db:migrate    exit 1 before Wrangler
npm run deploy        exit 1 before Wrangler
```

Both printed the local error and did not contact Cloudflare. The gitignored
local file was restored and compared equal.

Public-clone dry-run, same absent-id setup:

```text
npm run deploy:dry-run    exit 0
```

Wrangler validated the bundle with the committed placeholder and exited
`--dry-run: exiting now.` No D1 id appeared in the captured output.

Operator dry-run with the gitignored local file present also exited 0. The
wrapper logged `using D1 id from wrangler.local.toml` and the captured output
contained no D1 id.

### Installation and upgrade

Outside the repository, in a temporary prefix:

1. The immutable `v1.2.0` installer downloaded the published Darwin ARM64
   release, verified sha256
   `40dc43d5b3b785792001af3379e323eff768d45ce66f045d4e1e8586f1089727`
   (the Sprint 013 release checksum), and reported `Installed campfire 1.2.0`.
2. `campfire init` and `campfire seed` wrote a temporary database. `campfire
   show ws_billing_deploy --json` recorded that workspace.
3. The current installer unpacked the local `v1.2.1` candidate
   (sha256 `c705ddf595e6ae7971d3bb56af2fffc95bfc40b1378199fc10814c7c37c086d9`)
   over the same prefix and reported `Installed campfire 1.2.1`.
4. Installed package metadata was `1.2.1`. `campfire --help` printed usage.
5. The same `show` JSON matched the pre-upgrade bytes.
6. A fresh prefix installed from that local archive with no `--version` and
   reported `Installed campfire 1.2.1`, not `latest`.
7. `--version 9.9.9` against the `1.2.1` archive exited 1 with
   `archive package version 1.2.1 does not match requested version 9.9.9`.
   Package metadata stayed `1.2.1`, and the workspace JSON was unchanged.

The operator's normal Campfire database was not used.

---

## 4. Export audit

`npm run export:public -- --ref e9ef9c906fac7a35431e9dd6a1c5b19c012c3d29`
wrote 137 files into an empty directory outside the repository. The exporter's
forbidden-path and forbidden-content audit passed. The manifest version is
`1.2.1`, the exported migrate script uses the wrapper, the current installer
contains the pinned-mismatch check, and the `v1.2.0` installer does not.
`AGENTS.md` and this result document were not exported.

The three files added since the 134-file `v1.2.0` manifest are
`public/campfire/v1.2.1/install.sh`, `tests/unit/install.test.ts`, and
`tests/unit/wrangler-deploy.test.ts`.

This audit checks future release eligibility only. It does not promote the
snapshot, create a tag, publish a GitHub Release, or deploy production.

---

## 5. Acceptance decision

Sprint 014 is **GO** because:

1. documented remote migration uses the credential-safe wrapper;
2. real remote mutations fail closed without a non-placeholder D1 id;
3. environment-over-local precedence, sentinel rejection, absolute ephemeral
   paths, cleanup, and exit status are tested without Cloudflare credentials;
4. no real D1 id, token, or secret is in Git, fixtures, or captured test output;
5. deploy dry-run works with a real local id and with only the committed placeholder;
6. the installer reports the package version it installed and rejects a pinned mismatch before replacement;
7. checksum and Node 22 behavior stayed in place;
8. a clean `v1.2.0` to local `v1.2.1` upgrade preserved the temporary workspace;
9. published versioned installers and the `v1.2.0` tag were not rewritten;
10. README, operator guidance, configuration comments, code, and tests agree; and
11. the full Node 22 suite passed; and
12. the export of commit `e9ef9c906fac7a35431e9dd6a1c5b19c012c3d29` passed its
    forbidden-path and forbidden-content audit (137 files).

Not claimed: a live Cloudflare migration, a public `v1.2.1` release, a
production deploy, Gate B, Gate C, or product-market fit.

Sprint 015 is not defined or authorized by this result.
