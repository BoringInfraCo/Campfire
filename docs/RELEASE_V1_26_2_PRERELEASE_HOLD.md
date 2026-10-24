# v1.26.2 pre-release rehearsal — HOLD

**Date:** October 24, 2026  
**Verdict:** **HOLD RESOLVED — repaired candidate; isolated rehearsal only**  
**Candidate:** SHR-001 private-alpha publication slice  
**Reviewed base:** `b172199f17ec21f8c29de7f8615c12f385699ce9` plus the uncommitted
SHR-001 working tree.  
**Resolution:** the blockers below were repaired and covered by focused tests;
see `docs/RELEASE_V1_26_2_CANDIDATE.md` for the candidate source position,
checksum, gate matrix, and isolated endpoint. This does not approve public Cloud
alpha admission, a public tag/release, a channel update, or production deployment.

## Resolution (October 24, 2026)

- Rehearsal admission control: the alpha flag alone now fails closed; every
  publication write route requires the operator-held `cfrh_` code whose SHA-256
  is a Worker secret. Wrong/missing attempts are rate-limited.
- Free text: every exported string is scanned for Campfire/provider token
  shapes, private-key headers, and absolute filesystem paths.
- Verification: read-only; a committed retry tolerates only extra owner-agent
  `register_session` rows from an older verifier attempt. A committed-retry
  acceptance test covers the crash window.
- Recovery: `campfire publish-recover` uses the saved `cfr_` secret and admission
  code, revokes the old owner token, verifies the replacement, and updates local
  state and remote credentials without printing a token.
- Provenance: owner human/agent rows are updated from the snapshot after
  enrollment. Unsupported action/GitHub state is checked exhaustively. Import is
  bound to the enrolled workspace id/name. Canonical JSON treats `__proto__` as
  data and rejects prototype keys in auxiliary objects.
- Local authority: `seed`, `bootstrap`, `onboard`, and first-run writes honor the
  finalization lock; after cutover a `publication.cutover` marker keeps the local
  database read-only.
- Version: `package.json` and `package-lock.json` are `1.26.2` with
  `campfire.releaseStatus = "candidate"`. Channel files remain at the last
  released `1.26.1`, as instructed. The Arbora digest was recomputed for the
  candidate; the v1.26.1 digest remains as capture evidence.

The original HOLD record is retained below for history.

---


## Why this stopped

The rehearsal requires a control that admits only the planned two-Mac run to
`/v1/publication/*`. The candidate has no per-rehearsal control:

- `wrangler.toml` sets only `CAMPFIRE_PUBLICATION_ALPHA = "0"`;
- `src/worker/index.ts` opens the route whenever that flag is exactly `"1"`;
- `src/worker/publication.ts` limits enrollment by a D1 count of prior
  enrollments from a hashed `CF-Connecting-IP` (default 5/day), with a fallback
  to `x-real-ip`;
- `deviceKeyHash` is stored but never compared;
- `maxEnrollmentAttemptsPerSourcePerDay` is defined but unused;
- one-human and one-workspace uniqueness do not admit a specific rehearsal;
- the route is anonymous and creates a fresh owner/org/team/agent/token set.

Once the flag is enabled on an internet-reachable Worker, any caller who learns
the hostname can create accounts up to the source budget. The endpoint family
is not restricted to the two rehearsal Macs. Per the instruction, the run stops
here rather than enabling publication enrollment.

## Additional blockers found in review

These independently prevent treating this tree as release-ready:

1. **Credential/path scanning is ineffective in free text.**
   `RAW_TOKEN_RE` is anchored to the start of the whole JSON string, and the
   auxiliary scan only applies to metadata/payloads. A `cft_`/`cfe_` token, a
   `cfr_` recovery secret, or an absolute filesystem path embedded in a finding
   summary/detail, decision rationale, task text, or note can be exported.
   `THREAT-MODEL.md` and `SNAPSHOT-MANIFEST.md` claim these are refused.
2. **Verification can strand a committed publication.**
   `verifyHosted()` registers new agent sessions after the source-tip check and
   before the `verified` receipt is saved. A crash or lost response in that
   window leaves the receipt `committed`; a retry then sees a hosted tip above
   the source tip and can never verify. The local write lock remains.
3. **Hosted credential recovery is not reachable from the CLI.**
   `recoverPublication()` exists but has no caller; there is no
   `publish-recover`/`--recover` command and no route test. Recovery guidance
   points at `publish-status`, and retry guidance points at `--dry-run`, which
   cannot resume an import.
4. **The default profile is not the Arbora profile.**
   `~/.config/campfire` selects a stale Ada profile with no workspace; the
   captured Arbora profile is `~/.config/campfire-arbora`. A rehearsal must pin
   `CAMPFIRE_CONFIG_DIR` for every command, or the documented ordinary-profile
   path will operate on the wrong database.
5. **Versioning is not a two-file change.**
   The tree is still `1.26.1`. A 1.26.2 candidate also touches
   `src/telemetry/releases.ts`, the hard-pinned baseline test, install-channel
   tests, public-release README/CHANGELOG/RELEASE_CONTEXT, and the release
   decision. The snapshot digest includes `source.packageVersion`, so the
   frozen Arbora answer-key digest must be recomputed or the digest contract
   changed for 1.26.2.
6. **Other recorded contract mismatches remain:** unguarded `seed`,
   `bootstrap`, and `onboard` writes during finalization; owner/agent
   `created_at`, `external_identity`, and `model` not preserved; no enforcement
   that the import workspace id equals the enrolled source workspace id;
   incomplete unsupported-table checks; and a `__proto__` canonical-JSON digest
   hole.

## Deployment target audit (nothing was run)

These repository commands target the configured production service and were
not executed:

| Command | Target |
| --- | --- |
| `npm run deploy` | production Worker `campfire` + `boringinfra.company/campfire/*` |
| `npm run db:migrate` | production D1 `campfire` (`--remote`) |
| `npx wrangler deploy` in repo root | production `wrangler.toml` |
| `npx wrangler d1 migrations apply campfire --remote` | production D1 |
| `npx wrangler secret put ...` without `--config`/`--name` | production Worker |
| `npm run deploy:dry-run` | validates the production config, even though no upload occurs |

`wrangler.local.toml` is an ID source for the production Worker and is not an
isolated environment. `wrangler.example.toml` also names the Worker `campfire`.
No `CAMPFIRE_D1_DATABASE_ID` was exported and no `wrangler` remote mutation was
issued.

## What would unblock the rehearsal

1. Implement and test a rehearsal-only gate: a Worker secret hash plus a
   required client header on enrollment/recovery, or an equivalent allowlist
   that admits only the planned owner. Do not rely on the alpha flag or source
   rate limit.
2. Fix the free-text credential/path scan and add a test with a token/path
   embedded in a finding summary/detail.
3. Make verification read-only before the `verified` receipt; move session
   registration after `verified` or make retry idempotent; add a
   `committed`-crash retry test.
4. Add a supported recovery/abandon CLI path and test the recovery route.
5. Pin the rehearsal profile and document the exact `CAMPFIRE_CONFIG_DIR`.
6. Version `package.json`, `package-lock.json`, telemetry release map, baseline
   tests, and public-release docs; decide explicitly whether package version is
   part of the snapshot digest.
7. Re-run the full suite, build, dry-run, package, checksum, and only then
   provision an isolated Worker/D1 with a distinct name, no custom route, and
   the publication gate closed until the single rehearsal is admitted.

Until then, the correct label is: **pre-release HOLD; no two-Mac test endpoint
or candidate package exists.**
