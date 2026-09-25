# Campfire — Sprint 014: Trust the Operator Path

**Status:** Complete (**GO**) — see `SPRINT_014_RESULT.md`. `v1.2.1` is released and deployed.
**Date:** September 25, 2026
**Company:** Boring Infra Co.
**Depends on:** Sprint 013 — Public Release `v1.2.0` (**GO**)
**Release:** `v1.2.1` (promotion authorized separately after the sprint GO decision)
**Primary metric:** Documented operator-path accuracy. Every documented
production command must either use the intended D1 configuration safely or
fail closed before contacting a remote placeholder; installation must report
the version actually installed.

---

## 1. Sprint question

> Can an operator trust the documented migrate, deploy, install, and upgrade
> paths without an undocumented workaround, a placeholder production target,
> ambiguous installed-version output, or loss of existing local state?

Sprint 013 proved that the released application, public snapshot, production
Worker, D1 database, release assets, and clean installer all work. It also
revealed a narrow operator-path inconsistency:

- `npm run deploy` correctly resolves the real D1 identifier through the
  credential-safe ephemeral-config wrapper;
- `npm run db:migrate` bypasses that wrapper and therefore attempted the
  committed placeholder identifier;
- the wrapper worked when invoked directly and D1 reported no pending
  migrations;
- the default installer correctly installed the latest GitHub Release, but
  its success text retained the request label `latest` instead of reporting
  the resolved package version.

These are release-confidence defects, not collaboration-model defects. Fix
them without changing Campfire's domain, persistence schema, authorization,
MCP, HTTP API, Worker behavior, or Viewer.

---

## 2. Evidence boundary

This sprint is selected by observed Sprint 013 release evidence, not by a
speculative platform plan.

| Observed evidence | Sprint 014 consequence |
| --- | --- |
| `npm run db:migrate` contacted the placeholder D1 identifier. | Route remote migration through the same safe configuration boundary as deploy. |
| Direct wrapper invocation resolved the gitignored real identifier and D1 reported current. | Reuse the existing wrapper; do not create a second configuration system. |
| `npm run deploy` successfully used the wrapper and deployed production. | Preserve the working deploy behavior. |
| Latest and pinned production installers both passed checksum and clean-install verification. | Keep distribution behavior; improve truthful version reporting and mismatch detection only. |
| The installer rejected Node 20 and succeeded on Node 22. | Preserve the Node 22 guard unchanged. |
| The v1.2.0 package passed init, seed, help, and workspace read checks. | Add an upgrade smoke that proves existing state remains usable after replacing the installed package. |

Sprint 014 does not claim external adoption, repeat usage, multi-participant
value, retention, or product-market fit.

---

## 3. Smallest implementation

Before changing the current installer, set `package.json` and
`package-lock.json` to the unreleased patch candidate `1.2.1`. Packaging must
create `public/campfire/v1.2.1/install.sh`; it must not overwrite any published
versioned installer.

### A. One safe Wrangler execution boundary

Use the existing Wrangler wrapper for both deploy and remote D1 migration.

Required behavior:

1. `npm run db:migrate` invokes the wrapper rather than Wrangler directly.
2. `$CAMPFIRE_D1_DATABASE_ID` retains precedence over gitignored
   `wrangler.local.toml`.
3. Remote migration and real deployment require a non-placeholder D1
   identifier and fail before invoking Wrangler when none is available.
4. `npm run deploy:dry-run` remains usable without a real identifier so public
   clones can validate the Worker bundle safely.
5. The ephemeral configuration continues to absolutize config-relative source,
   migrations, and asset paths.
6. Temporary configuration is removed after Wrangler exits on success or
   failure.
7. Logs may identify the configuration source, but never print credentials,
   bearer tokens, or the contents of secret-bearing files.
8. Wrangler's exit status remains the command's exit status.

Prefer the smallest testable refactor of `scripts/wrangler-deploy.mjs`. Do not
introduce a deployment framework, hosted control plane, or new dependency.

### B. Truthful installer version reporting

After unpacking a release archive, inspect the installed package metadata.

Required behavior:

- a `latest` install reports the resolved package version, such as `1.2.0`;
- a pinned install fails if the archive package version differs from the
  requested version;
- checksum verification remains mandatory and occurs before installation;
- Node 22+ enforcement remains unchanged;
- existing prefix, server URL, local-tarball, dry-run, and npm-fallback
  behavior remains compatible;
- immutable `v1.0.0`, `v1.1.0`, and `v1.2.0` versioned installer files are not
  rewritten;
- packaging creates a matching `v1.2.1` installer candidate and still refuses
  to overwrite a differing existing versioned copy; and
- the improved current and versioned `v1.2.1` installers remain unreleased
  until a separately authorized promotion publishes them.

### C. Operator documentation truthfulness

Update only documentation that currently describes the broken assumption:

- `README.md`;
- `docs/OPERATOR.md`;
- comments in `wrangler.toml` and the wrapper;
- command help or installer text if implementation requires it.

The docs must say that both remote migration and deploy resolve the D1 ID from
the environment or gitignored local configuration. They must not claim that a
database name alone bypasses the committed placeholder.

Harness support claims remain truthful and unchanged: Codex and OpenCode have
real cross-harness evidence; Claude Code and Cursor/internal agents remain
MCP-compatible with live handoff validation pending.

---

## 4. Deterministic test contract

Add focused tests that run without Cloudflare credentials or network access.
Use an isolated temporary repository/config fixture and a stubbed Wrangler
process boundary where practical.

The tests must prove:

1. environment ID wins over local-file ID;
2. local-file ID is used when the environment ID is absent;
3. placeholder and documented replacement sentinel values are rejected for
   remote mutation;
4. migrate receives `d1 migrations apply campfire --remote` plus the generated
   `--config` path;
5. deploy receives the generated `--config` path;
6. dry-run remains possible without a real ID;
7. generated paths for Worker entrypoint, migrations, and assets are absolute;
8. temporary configuration is cleaned after success and failure;
9. subprocess failure is propagated;
10. logs and captured output contain no configured D1 value or credential;
11. latest installation reports the package metadata version;
12. pinned installation rejects a package-version mismatch; and
13. checksum, Node-version, local-tarball, and fallback behavior do not regress.

Do not make the deterministic suite depend on the current operator's
`wrangler.local.toml`, Wrangler login, GitHub, or production.

---

## 5. Manual acceptance

Use Node 22 and temporary directories outside both repository checkouts.

### Operator rehearsal

Verify:

```text
npm run deploy:dry-run
npm run db:migrate
```

The remote migration check requires separate explicit authorization at
execution time. It must resolve a real D1 identifier through the wrapper and
return either a successful migration result or `No migrations to apply`.
Sprint 014 does not implicitly authorize a production Worker deployment.

Also verify the fail-closed path with neither an environment ID nor
`wrangler.local.toml`: a remote migration or deploy attempt must stop locally
without contacting Cloudflare.

### Installation and upgrade rehearsal

In a clean temporary prefix:

1. install `v1.2.0` from its published pinned release;
2. create and seed a temporary database;
3. record a known workspace read;
4. install the locally packaged `v1.2.1` candidate over the same prefix;
5. verify installed package metadata reports `1.2.1`;
6. verify `campfire --help`;
7. read the same database and confirm the known workspace state remains;
8. exercise the improved current installer with a controlled local archive and
   confirm truthful resolved-version output; and
9. exercise a controlled mismatched pinned archive and confirm failure before
   replacement.

Do not use the operator's normal Campfire database for this rehearsal.

---

## 6. Validation matrix

```text
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:acceptance
npm test
npm run build
npm run pack:tarball
npm run deploy:dry-run
```

Also require:

- focused operator-wrapper tests;
- focused installer tests;
- fail-closed remote-mutation rehearsal;
- temporary-prefix `v1.2.0` → local `v1.2.1` candidate upgrade smoke;
- installed package metadata and preserved database-state checks;
- export-manifest and forbidden-content audit from the committed Sprint 014
  source into an empty temporary directory;
- complete diff review; and
- a clean private working tree after the result is recorded.

The export audit verifies future release eligibility only. It does not promote
the snapshot, create a tag, publish a GitHub Release, or deploy production.

---

## 7. Acceptance criteria

- The documented migration command uses the credential-safe wrapper.
- All real remote mutations fail closed without a non-placeholder D1 ID.
- Environment/local precedence is deterministic and tested.
- No real D1 ID, token, or secret enters Git, logs, fixtures, or test output.
- Ephemeral configuration is cleaned on every observed exit path.
- Deploy dry-run remains usable from a public clone without private config.
- Existing production deploy argument behavior is unchanged.
- Package and lockfile versions are `1.2.1`, and packaging creates the matching
  unreleased versioned installer without changing earlier versions.
- The current installer reports the installed package's actual version.
- A pinned request rejects an archive whose package version does not match.
- Checksum and Node 22 protections remain intact.
- A clean `v1.2.0` → local `v1.2.1` upgrade preserves the temporary Campfire
  database and can read its prior workspace state.
- Immutable released tags and versioned installer copies are unchanged.
- README, operator guidance, configuration comments, code, and tests agree.
- Full validation passes on Node 22.
- Gate B, Gate C, and external PMF remain explicitly unmeasured.

---

## 8. Non-goals

- A public `v1.2.1` tag, public snapshot promotion, GitHub Release, or
  production Worker deployment. The local version bump and release candidate
  are preparation, not publication.
- New D1 or SQLite migration content.
- Domain objects, lifecycle changes, authorization changes, or service behavior.
- MCP, HTTP API, Worker API, CLI collaboration commands, or Viewer features.
- Zero-to-workspace onboarding improvements; those remain a possible later
  sprint selected after this operator path is trustworthy.
- Claude Code live validation or a new harness abstraction.
- Design-partner recruitment, external field evaluation, or product analytics.
- Gate B/C claims, retention claims, revenue claims, or PMF claims.
- Cross-workspace memory, semantic search, integrations, notifications,
  orchestration, delegation, SSO, SCIM, or enterprise policy.
- Defining or implementing Sprint 015.

---

## 9. Rubric

### GO

The documented migrate/deploy boundary deterministically selects safe D1
configuration or fails closed, ephemeral configuration is cleaned, installer
output names the package version actually installed, mismatches are rejected,
the state-preserving upgrade rehearsal passes, the full suite passes, and no
secret or immutable release artifact changes.

If separately authorized, the real remote migration command also completes
through the same documented wrapper path. Record whether this evidence was
live or deterministic.

### CONDITIONAL GO

All deterministic behavior and the upgrade rehearsal pass, but the separately
authorized Cloudflare migration check is unavailable because of external
credentials or service state. Record that limitation; do not describe the
remote path as re-proven.

### NO-GO / REFRAME

Any placeholder can reach a remote mutation, a secret or D1 identifier is
committed or logged, config precedence is ambiguous, temporary configuration
persists, installer checksum/Node protections regress, a pinned mismatch is
accepted, existing state is lost during upgrade, or the fix requires product,
schema, authorization, or deployment-platform expansion.

This document defines Sprint 014 only. Implementation, any remote migration
check, release promotion, and production deployment remain separate actions.
