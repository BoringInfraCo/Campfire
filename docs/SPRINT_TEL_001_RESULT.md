# Campfire — Sprint TEL-001 Result: Anonymous Product Telemetry

**Status:** Implemented; engineering validation complete; deployment and public release pending

**Decision:** GO — engineering candidate; not deployed, not publicly released

**Date:** October 2, 2026

**Candidate version:** `v1.9.1`

**Contract:** `docs/Campfire-TEL-001-Anonymous-Product-Telemetry-Sprint.md`

**Disclosure:** `docs/TELEMETRY.md`

## 1. Outcome and evidence boundary

Campfire can now measure, truthfully and reproducibly, the path from official
installer interest to successful installation, meaningful activation, active
use, and later-day return — while collecting no workspace content, code,
prompts, repository names, paths, credentials, or human identity, and while
remaining unable to fail an installation, a command, or a workspace write.

This is **engineering evidence**. The Analytics Engine dataset is not yet
provisioned, so no real event has been ingested and no founder metric has been
produced. Nothing here is a usage, retention, PMF, Gate B, Gate C, or Gate F
claim, and no `install_requested` value is backfilled for any period before the
first measured event.

## 2. Implemented scope

| Item | Where |
| --- | --- |
| TEL-001A — event contract, allow-list, prohibited fields | `src/telemetry/contract.ts` |
| TEL-001B — installation id, preference, CLI controls, env override | `src/telemetry/state.ts`, `src/cli/index.ts`, `src/cli/catalog.ts`, `src/cli/projections.ts` |
| TEL-001C — strict payload, short timeout, total transport | `src/telemetry/post.ts`, `src/telemetry/report.ts` |
| TEL-001D — `/install` measurement, installer completion report | `src/worker/handler.ts`, `src/worker/telemetry.ts`, `public/campfire/install.sh` |
| TEL-001E — activation and bounded activity on real success paths | `src/cli/index.ts`, `src/mcp/tools.ts` |
| TEL-001F — ingestion, allow-list enforcement, size limit, AE write | `src/worker/telemetry.ts`, `src/worker/d1-types.ts`, `src/worker/index.ts`, `wrangler.toml` |
| TEL-001G — reproducible founder-metric queries | `scripts/telemetry-queries.mjs` |
| TEL-001H — disclosure, README, operator docs, export allowlist | `docs/TELEMETRY.md`, `README.md`, `docs/OPERATOR.md`, `scripts/export-public-release.mjs` |

### Design decisions worth recording

- **Allow-list, not deny-list.** `serializeTelemetryEvent` writes named fields
  from a closed list. A payload field that is not named in `TELEMETRY_FIELDS`
  cannot leave the machine. `PROHIBITED_FIELD_NAMES` is asserted disjoint from
  the allow-list, so a future dimension cannot reintroduce a prohibited name.
- **Unknown fields are rejected server-side, not dropped.** Silently ignoring an
  undocumented key would let a future client smuggle content past the boundary
  while being told it succeeded.
- **Local state lives in its own file.** `telemetry.json` sits beside
  `config.json` in the config directory rather than inside it, because
  `loadAnyProfile` validates a closed profile shape and would drop an added key
  on the next read-modify-write.
- **No telemetry outbox.** A retry queue would need to persist payloads, and
  persisted payloads are somewhere workspace content could later leak into.
  Delivery is best-effort with no retry loop.
- **Activation is bounded in state, not in code paths.** `claimActivation`
  answers once per installation and `claimActiveEvent` once per UTC day, so the
  hooks need no debounce and an agent loop cannot produce spam.
- **Four hook sites, not per-command instrumentation.** The CLI attaches to the
  single `withBackend` call funnel rather than to individual commands; MCP
  attaches to the single `run()` post-success funnel. The Viewer is deliberately
  not instrumented.
- **`install_requested` records no platform.** The requestor is a shell
  pipeline; inferring its OS from request headers would be fingerprinting to fill
  a dimension `install_completed` reports truthfully. The Worker reads no
  address, host, or token header at all.

## 3. Engineering validation

| Step | Command | Result |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | clean, exit 0 |
| Full suite | `npm test` | 61 files, 755 tests, all passing |
| Build | `npm run build` | exit 0, `dist/src/cli/index.js` executable |
| Deploy validation | `npm run deploy:dry-run` | Wrangler resolves `env.TELEMETRY (campfire_telemetry)`; committed placeholder-id path unchanged |
| Installer syntax | `sh -n public/campfire/install.sh` | OK |
| Installer dry run | `CAMPFIRE_DRY_RUN=1 sh public/campfire/install.sh` | exit 0, no network call, state file untouched |
| Blank-DB CLI smoke | `init` → `bootstrap --human-name` → `telemetry status/enable/disable` | exit 0; status/enable/disable and `CAMPFIRE_TELEMETRY=0` precedence verified on the built binary |

Telemetry-specific coverage: 152 new tests across `tests/unit/telemetry.test.ts`,
`telemetry-privacy.test.ts`, `telemetry-cli.test.ts`,
`telemetry-lifecycle.test.ts`, `tests/worker/telemetry-worker.test.ts`, and
`tests/unit/install-telemetry.test.ts`. The privacy suite drives 21 hostile
fixtures containing repository names, workspace names, paths, prompts, code,
token-shaped strings, usernames, emails, hostnames, branch names, and git
remotes through three ingress paths and asserts none can reach a serialized
event.

## 4. Deviations and known limitations

1. **The npm fallback install path does not report `install_completed`.** It
   exits from inside its own function and is not the curl tarball install the
   event describes; labelling it `installMethod: "curl"` would corrupt that
   dimension. Recorded rather than silently chosen.
2. **`install_requested` cannot be suppressed client-side.** It is written by
   the Worker at fetch time. This is disclosed in `docs/TELEMETRY.md` and is why
   installer-request counts are documented as approximate.
3. **Deduplicated installation counts are lower bounds under sampling.** The
   installation id is deliberately a blob, so it never drives an index group;
   under sampling a sampled-away row can carry an id present in no surviving
   row. `scripts/telemetry-queries.mjs` labels every deduplicated figure as a
   lower bound and every row count as sample-weighted rather than presenting a
   raw `COUNT(*)` as exact.
4. **`campfireVersion` is the one caller-supplied free-text dimension.** It is
   bounded to 32 characters but not pattern-validated. Every current caller
   passes `installedCampfireVersion()`.
5. **A long-running `campfire up` Viewer poll can claim activation.** The Viewer
   receives the measured call wrapper from `campfire up`. The claim is bounded to
   once per installation and once per UTC day, so counts are unaffected, but a
   Viewer-driven claim is a weaker activation signal than a human read.
6. **The CI blank-DB smoke is broken at `HEAD`, independently of this sprint.**
   `.github/workflows/ci.yml` runs `create-human --name … --team …` after a
   bare `bootstrap`, but `bootstrap` creates no human without `--human-name` and
   `create-human` then has no acting token, so it fails `Unauthorized`. Verified
   against a clean `HEAD` worktree. Pre-existing and out of TEL-001 scope; not
   fixed here. The blank-DB smoke above uses `bootstrap --human-name`, which
   passes.

## 5. Unresolved contradiction for the founder

`docs/PRODUCT_DEFINITION.md` §18 and §19 assign "observability / behavioral
state" to a sibling Boring Infra product, and `docs/ARCHITECTURE.md` §23 shows
"Agent Observability → Campfire" as future composition. Shipping installation
measurement inside Campfire sits in tension with that assignment.

`docs/PRODUCT_DEFINITION.md` was **not** edited. The boundary is recorded in
`docs/TELEMETRY.md` and scoped in `docs/ARCHITECTURE.md` §21. Resolving the
portfolio placement is a product decision, not an implementation one.

## 6. Canon and release disposition

- `docs/TELEMETRY.md` and `scripts/telemetry-queries.mjs` are added to
  `EXACT_SOURCE_PATHS` in `scripts/export-public-release.mjs`. `docs/` is
  allowlist-exact, so without this the disclosure and the queries would be
  silently absent from every public snapshot — the same failure that cost
  `v1.7.0` its trace receiver.
- `package.json` moves `1.9.0` → `1.9.1`. `scripts/package.sh` refuses to
  overwrite an existing `public/campfire/vX.Y.Z/install.sh`, and editing the
  installer at `1.9.0` would have failed that guard. Published versioned
  installers are untouched; `public/campfire/v1.9.1/install.sh` is created by
  `pack:tarball` at release time.
- The README still pins the production-deployed installer at `v1.8.0`.
  `v1.9.0` was published as a public source snapshot and GitHub Release,
  but its Worker and versioned installer were not deployed in that promotion.
  This TEL-001 candidate is `v1.9.1` and has not been published or deployed.
- No public snapshot export, GitHub Release, production migration, deployment,
  dataset provisioning, or installer promotion is recorded here. Those are
  separate actions requiring operator authorization.
