# Campfire — Sprint 013 Result: Public Release

**Status:** Complete (**GO**)
**Date:** September 25, 2026
**Release:** `v1.2.0`
**Public release:** <https://github.com/BoringInfraCo/Campfire/releases/tag/v1.2.0>

---

## 1. Result

The reviewed Sprint 007–012 product state is published as a reproducible,
publicly installable `v1.2.0` release. The private source tag, audited public
snapshot, GitHub assets, production Worker, D1 state, and clean installation
all passed their release checks.

Recommendation: **GO**.

This is distribution evidence, not market evidence. By founder decision, the
design-partner requirement was removed from this sprint. Gate B repeat usage,
Gate C external multi-participant value, retention, and product-market fit
remain unmeasured.

---

## 2. Immutable provenance

- Private canonical repository: `BoringInfraCo/Campfire-internal`.
- Private source commit and annotated tag: `7bb2c035dc6ff3100f0b5d2c1eddaf18d1c3b4fd`
  (`v1.2.0`).
- Public release repository: `BoringInfraCo/Campfire`, maintained as a
  non-fork snapshot mirror.
- Public snapshot commit and annotated tag:
  `98ab0fdb12e6eb95a5034c6331b3b04c9c34a5ab` (`v1.2.0`).
- The audited export manifest contained exactly 134 paths. The promoted tree
  matched it with zero missing or extra files.
- The broad public `*.log` ignore rule initially hid the allowlisted
  `fixtures/sprint-011/webhook.log`; it was explicitly staged after confirming
  it was manifest-listed. The final public tree remained an exact 134-file
  match.
- No private Git history, raw sprint evidence, transcript, local database,
  credential, `AGENTS.md`, internal skill, or internal-only sprint document
  entered the public snapshot.
- Apache-2.0 is unchanged.

---

## 3. Validation evidence

The private release source passed on Node `22.23.2`:

```text
npm run typecheck                 PASS
npm run test:unit                 PASS — 201 tests
npm run test:integration          PASS — 80 tests
npm run test:acceptance           PASS — 8 tests
npm test                          PASS — 27 files / 313 tests
npm run build                     PASS
npm run pack:tarball              PASS
npm run deploy:dry-run            PASS
local darwin-arm64 checksum       PASS
```

An independent install of the exported public snapshot passed `npm ci` with
zero reported vulnerabilities, typecheck, build, and the full 313-test suite.

Public automation passed:

- public `main` CI run `36086897162` — success;
- public `v1.2.0` tag CI run `36086904783` — success;
- release-tarball run `36086921151` — success.

The GitHub Release contains all eight required non-empty assets: archives and
matching `.sha256` files for Darwin ARM64, Darwin x64, Linux ARM64, and Linux
x64.

---

## 4. Production evidence

- Wrangler identity was explicitly checked against Cloudflare account
  `1c1597c473c77c9ea49a53b4d62fdb2d` before mutation.
- Remote D1 migration verification reported `No migrations to apply`.
- The production Worker deployed successfully to
  `boringinfra.company/campfire/*` with version ID
  `cc1d2da1-4498-44e5-b049-1b6c1f447709`.
- `https://boringinfra.company/campfire/install.sh` returned HTTP 200.
- `https://boringinfra.company/campfire/v1.2.0/install.sh` returned HTTP 200.
- Both deployed installer bodies matched the tracked installer SHA-256:
  `126451441ea803087a67063fbeb4473d82a70e41601eb222b5c348cfb6728480`.
- A clean install from the production pinned URL verified archive SHA-256
  `40dc43d5b3b785792001af3379e323eff768d45ce66f045d4e1e8586f1089727`,
  installed Darwin ARM64 package version `1.2.0`, and passed `campfire --help`,
  fresh database initialization, seed, and `ws_billing_deploy` read checks.
- The installer's Node guard correctly rejected Node `20.11.1`; the accepted
  clean install ran with the required Node `22.23.2` runtime.

Operator note: the documented `npm run db:migrate` alias currently invokes
Wrangler directly and therefore used the committed placeholder D1 ID. No
remote mutation occurred on that failed attempt. Release verification instead
used the repository's credential-safe ephemeral-config wrapper with the real,
gitignored D1 ID, after which D1 reported current. This does not affect the
published CLI or installer, but the alias should be routed through the wrapper
in a separately authorized follow-up rather than changing an immutable release
tag.

---

## 5. Acceptance decision

Sprint 013 is **GO** because:

1. private and public tags resolve to their reviewed immutable commits;
2. the public tree is an exact audited export without private history or
   forbidden material;
3. all source, snapshot, CI, platform asset, checksum, deployment, and clean
   installation checks passed;
4. production deployment was explicit and separately authorized; and
5. the result makes no external validation, retention, adoption, revenue, or
   product-market-fit claim.

Sprint 014 is not defined or authorized by this result.
