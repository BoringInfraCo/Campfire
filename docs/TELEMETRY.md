# Telemetry

Campfire sends a small number of anonymous counters so it can tell whether the
project is being installed, activated, and used again. This document is the
complete disclosure: what is collected, what is not, why it exists, and how to
turn it off.

The short version: no workspace content, no code, no prompts, no file paths, no
credentials, and no identity ever leave your machine. The only persistent
identifier is a random UUID generated locally that names **one Campfire
installation** — not you, and not anyone else.

---

## What is collected

Campfire records four events. Nothing else is ever sent, and the server rejects
any payload containing a field that is not in this table.

| Event | Recorded when | Carries an installation id |
| --- | --- | --- |
| `install_requested` | the official installer URL is fetched | no — it is anonymous by contract |
| `install_completed` | the installer finishes successfully | yes |
| `activated` | Campfire first does something meaningful | yes |
| `active` | Campfire is used after activation | yes |

`activated` is emitted at most once per installation, `install_completed` is
claimed at most once per installation, and `active` at most once per
installation per UTC day. Those bounds are decided locally, so a repeated
command, a polling Viewer, or an agent loop cannot inflate the counters.

Every payload carries these seven dimensions:

| Field | Values | Meaning |
| --- | --- | --- |
| `schemaVersion` | `1` | payload contract version |
| `event` | the four names above | which event this is |
| `campfireVersion` | for example `1.8.0`, or `unknown` | the installed release |
| `os` | `darwin`, `linux`, `win32`, or `unknown` | normalized platform |
| `arch` | `arm64`, `x64`, or `unknown` | normalized architecture |
| `installMethod` | `curl`, `brew`, `nix`, or absent | how Campfire was installed |
| `surface` | `cli`, `agent`, `mcp`, or absent | where the event came from |

plus `installationId`: a random UUIDv4 created on your machine, described below.

`os` and `arch` are normalized from the same platform list the installer uses,
so the installer and the CLI report identical strings for the same machine.
Anything outside the allow-list becomes `unknown` rather than being sent raw.

### Exact payload shape

A completed installation sends exactly this, and nothing else:

```json
{"schemaVersion":1,"event":"install_completed","installationId":"3f6b0e2a-1c4d-4a7e-9b8f-0d2e5c7a91b3","campfireVersion":"1.8.0","os":"darwin","arch":"arm64","installMethod":"curl"}
```

Activation and later use add `surface`:

```json
{"schemaVersion":1,"event":"active","installationId":"3f6b0e2a-1c4d-4a7e-9b8f-0d2e5c7a91b3","campfireVersion":"1.8.0","os":"darwin","arch":"arm64","surface":"agent"}
```

The contract additionally accepts one optional field, `installToken`, on
`install_completed` only: the single-use UUID the Worker baked into the served
installer bytes. The guard consumes it once and forgets it. It is not a
dimension — it never reaches Analytics Engine storage — and a token on any
other event is malformed. Because every served installer carries a token,
`enforce` mode treats a tokenless `install_completed` on the `curl` channel
(explicit `curl`, or an absent/unknown method) as a forgery, a replay,
or an unmeasured fetch rather than as honest traffic. The closed rule is:
a tokenless install is accepted IFF the method is `brew` or `nix`
(see "Package-manager bootstrap" below).

Payloads are hard-capped at 2 KB by the receiving endpoint. A larger body is
refused rather than stored.

`install_requested` is never sent by a client. It is written by the Worker when
an installer script is served — the short route, the asset path, and versioned
snapshots alike, each recording one request per served 2xx — and it
deliberately carries no installation id and no platform: at that moment the
requester is an anonymous shell pipeline, and the installer reports its real
platform truthfully a moment later.

Every served installer script also carries a baked-in single-use install
token. The Worker mints the token, stores only its SHA-256 digest, and rewrites
the first occurrence of the completion-body marker in the served bytes; the
stored scripts are never modified, so current and versioned snapshots are all
covered by the same replacement. The token authenticates one
`install_completed` funnel step — it grants nothing, identifies no person or
machine, and expires after fifteen minutes. A tokenized response carries
`cache-control: no-store` so a shared cache can never hand one installation's
token to another machine. Serving the bytes unchanged (no marker, a refused
mint, no guard) is always safe: the install still succeeds and only its
measurement is lost.

Token minting is bounded per source: each mint consumes one unit of the same
120/min IP limiter the ingestion route uses, under a distinct `install-token:`
key prefix, so a mint never consumes the ingestion-budget key and vice versa.
Farming tokens costs one installer fetch per fake id and at most 120 mints per
minute per source address — and that budget is NAT-shared on purpose, so it
stays generous rather than dropping honest installs behind one address. Over
budget the Worker serves the bytes unchanged (no token, still one
`install_requested`, no `no-store`) and a legit fetch is never broken: only
its telemetry proof is deferred to a retry. Limiter errors fail open, minting
as today. No address is stored anywhere; only an opaque derived key reaches
the binding.

### Package-manager bootstrap (brew/nix)

Homebrew and Nix install the same release archives as the curl installer,
but they never fetch `install.sh`, so they never receive a single-use
install token. Without a bootstrap path the live `enforce` gate would reject
their `activated`/`active` events as `no_install` forever.

Channel trust levels:

- `curl` — **token-proven.** The Worker baked a single-use token into the
  served installer bytes; the guard consumed it exactly once. This is the
  official shell installer channel.
- `brew` / `nix` — **labeled, unverified.** The claim is self-reported: the
  server records the install (`INSERT OR IGNORE`, no token touched) so the
  later `activated`/`active` gate passes, and stores the declared method in
  `blob6` so dashboards can label the channel. It is never presented as
  token-proven.

Rules:

- A tokenless `install_completed` is accepted IFF the method is `brew` or
  `nix`. Absent/unknown method follows the `curl` channel and still requires
  a valid token in `enforce`.
- A token riding a `brew`/`nix` payload is ignored and deliberately NOT
  consumed: a package-manager client has no legitimate way to hold one, and
  consuming it would let token theft burn installer tokens.
- A duplicated bootstrap install is deduplicated (`recorded: false`), never
  an error. A guard outage fails open.
- Ops outcomes record `accepted` with reason `bootstrap_brew` or
  `bootstrap_nix` (no id, no address, no token). Queries that need
  token-proven installs only must filter `blob6 = 'curl'`; counts over all
  three methods include the self-reported bootstrap channel.

Which client reports which method: `curl` installs report from `install.sh`
itself, on every successful install, and the CLI never reports for that
channel. `brew`/`nix` installs never fetch `install.sh`, so the first CLI run
claims `install_completed` instead (`detectInstallMethod` in
`src/telemetry/install-method.ts`, hooked in `runCli` for every command except
`telemetry` and `help`): `brew` for a Homebrew prefix (`/Cellar/`,
`/Homebrew/`, `/homebrew/` in the executable path), `nix` for `/nix/store`,
and nothing for anything else. Both writers share the one
`installCompletedReported` claim in the same `telemetry.json` (the shell
writes it when it creates the file; the CLI claims it via
`claimInstallCompleted`), so whichever runs second sends nothing locally, and
the server deduplicates any replayed id regardless.

### Where a recorded event is stored

The table above is the client payload. It is not the Analytics Engine column
layout. Workers Analytics Engine accepts one index per data point. That index
is only the sampling key, and the sampling key is the event name. Founder
queries do not read `index1`. They read `blob1` through `blob8`.

| Column | What is stored |
| --- | --- |
| `index1` | event name — sampling key only; queries must not read it |
| `blob1` | event name — filter here (`install_requested`, `install_completed`, `activated`, `active`) |
| `blob2` | schema version, `"1"` |
| `blob3` | Campfire version |
| `blob4` | OS |
| `blob5` | architecture |
| `blob6` | install method, or `"none"` when the payload omits it |
| `blob7` | surface, or `"none"` when the payload omits it |
| `blob8` | installation id, or `""` when absent. `count(DISTINCT blob8)` is the deduplicated installation count |

Schema version remains `1`. The payload contract did not change, and the
rejected writes that sent seven indexes stored no rows, so nothing was migrated
and no new field is collected. `"none"` and `""` are how an already-optional
payload field is stored when it is absent. They are not extra dimensions.

---

## What is not collected

This is the prohibited list from the telemetry contract, reproduced verbatim:

- [ ] persisted IP address as a Campfire telemetry dimension
- [ ] precise location
- [ ] human name or email
- [ ] GitHub handle or organization name
- [ ] hostname or machine fingerprint
- [ ] workspace/team/project/repository names
- [ ] repository URL or branch
- [ ] file paths or filenames
- [ ] prompts or messages
- [ ] source code or diffs
- [ ] artifacts, findings, decisions, goals, or task contents
- [ ] tokens, API keys, secrets, or credentials
- [ ] raw command arguments capable of containing user content

None of these is a matter of policy. **They are enforced by an allow-list in
code.** Every telemetry payload in Campfire is built by one serializer that
copies named fields out of a fixed list; it never spreads a Campfire object, a
command argument, an error message, or an environment value into a payload. A
field that is not named there cannot leave the machine. The receiving endpoint
applies the same list again and rejects a payload containing any undocumented
key, so a future client cannot smuggle content past the list while being told
it succeeded.

The receiving endpoint also never reads an address, host, or token header. It
does not need one.

One exception to "the endpoint never reads an address," and it is not a
collected field: to apply a per-source request budget, the ingestion route
hashes Cloudflare's own `CF-Connecting-IP` into an opaque key used only for
rate limiting. The address itself is not stored, logged, or written to a data
point, and it never appears in a payload. Without a limiter the route would be
open to anyone who learns the URL, and unbounded.

## What the endpoint refuses

The ingestion route drops two kinds of payload before writing anything.

**A version that predates telemetry.** Telemetry shipped in v1.9.1 — the client
library, the event contract, and the ingestion route were all added in that
release. A binary whose version reads below v1.9.1 contains no telemetry code
and cannot emit a schema-v1 event by any route, so such a payload is provably
fabricated rather than merely unusual. The endpoint drops it and answers
`recorded: false`, which is the same answer it gives when no dataset is bound:
an error would teach a prober which field gave it away, and a client that saw a
failure might retry.

This was added after production accumulated several hundred `install_completed`
rows per day, each under a distinct installation id, all declaring version 1.2.0,
with no downstream event and no relationship to any real usage.

The check is deliberately narrow. A version that does not parse — `unknown`, a
build string, a local checkout — is allowed through. The client resolves its
version by reading `package.json` and falls back to `unknown` when that read
fails, so an unparseable value is an honest possibility. Absence of proof is not
proof of forgery: the filter drops what is impossible and declines to guess
about what merely looks unusual.

**An over-budget source.** See the rate limit in
[docs/OPERATOR.md](OPERATOR.md#ingestion-rate-limit). A refused request answers
`429`, which the client treats as a lost measurement and ignores — it never
affects the Campfire operation that produced the event.

### What the server-side integrity gate does

Local bookkeeping stops honest replays: `activated` is emitted at most once
per installation and `active` at most once per installation per UTC day. It
does nothing against a prober replaying payloads with fresh ids or re-sending
the same id, which is what the server-side gate exists for. The gate runs in
the Worker, after the version floor and before the write, and every integrity
drop answers `200 {"ok":true,"result":{"recorded":false}}` — the same silent
shape as the floor, for the same reason.

- **Release-time check.** The server holds a static table of release instants
  (1.9.1 through the current release). A declared version that is known but
  whose release instant is still in the future cannot have been emitted by a
  real binary, so it is dropped as provably forged. A version that is not in
  the table — `unknown`, a build string, a local checkout, or a release newer
  than the table — is allowed through and measured as `unknown_release`.
  Absence of proof is not proof of forgery.
- **Idempotency claims.** `install_completed` is counted at most once per
  installation, `activated` at most once per installation, and `active` at
  most once per installation per UTC day — decided by the server this time,
  in D1, so replays from any source collapse to one count. A replayed event
  is deduplicated (`recorded: false`), never an error.
- **Install tokens.** `install_completed` consumes a single-use token: the
  token row is marked consumed first, then the installation is claimed, so a
  replayed token finds nothing to consume and a replayed id finds an existing
  claim. Only SHA-256 digests are stored — of the token, of the installation
  id, of the id-plus-day — never a raw id or token, and no address. The digest
  tables cannot become an identity registry. The Worker bakes the token into
  every served installer script (see above), so tokenless installs are handled
  by the gate mode below.
- **Per-installation budget.** Beside the existing per-source budget there is
  a per-installation budget keyed by an opaque hash of the installation id.
  The raw id never reaches the limiter. Over-budget answers `429` like the
  source budget. Both limiters fail open.
- **Token-mint budget.** Minting the baked-in install token consumes the same
  per-source 120/min binding under a distinct `install-token:` prefix, so
  mints and ingestion share the binding without consuming each other's keys.
  Over budget the installer is served unchanged (no token, still counted);
  the install never fails for lack of a token.
- **Gate modes.** `TELEMETRY_GATE_MODE` selects `enforce`, `shadow`, or `off`
  (see [docs/OPERATOR.md](OPERATOR.md#ingestion-rate-limit)). Production runs
  `enforce`: the installer bakes a token into every served script, so a
  tokenless install on the `curl` channel (explicit `curl`, or an
  absent/unknown method) is a forgery, a replay, or an unmeasured fetch — not
  honest traffic waiting for issuance. Tokenless `brew`/`nix` installs are
  the admitted bootstrap exception (see "Package-manager bootstrap" above).
  `shadow` was the rollout mode and
  remains the code default when the var is unset: violations are measured but
  the event still flows. Duplicates are deduplicated in every mode —
  idempotency is not a policy decision. A guard outage fails open in every
  mode.

Gate decisions are measured in a second Analytics Engine dataset,
`campfire_telemetry_ops`: one point per decision with `index1`
`ingest_outcome` (the sampling key), `blob1` the outcome (`accepted`,
`deduplicated`, `dropped`, `rejected`, `would_reject`, `error`), `blob2` the
reason (`ok`, `unknown_release`, `floor`, `version_not_released`,
`duplicate_install`, `duplicate_activation`, `duplicate_active`,
`invalid_token`, `bootstrap_brew`, `bootstrap_nix`, `no_install`, `missing_dataset`, `write_error`,
`rate_limited_id`), and `blob3` the event name. Like the main dataset it
carries no installation id, no address, and no token.

The release-time table is generated, not hand-edited.
`npm run telemetry:sync-releases` (`scripts/sync-telemetry-releases.mjs`)
rebuilds `src/telemetry/releases.ts` from annotated release tags and prints
what changed (added, removed, or corrected versions). Re-run it on every
release, after tagging, and commit the result:
`tests/unit/telemetry-releases.test.ts` fails if the shipped `package.json`
version is missing from the map. A version newer than the table is allowed
through and measured as `unknown_release`, so a stale table weakens the
check silently instead of failing — the re-run is what keeps that window
short. There is no separate release checklist file; this paragraph is the
standing instruction.

---

## Why it exists

Campfire installs through a `curl` pipeline, which has no download counter. The
goal is to answer one narrow question honestly: **is Campfire being installed,
activated, and used again?**

Without instrumentation that question cannot be answered. Events that were not
measured before launch cannot be reconstructed afterwards, and the launch
period is perishable. The counters exist so that any published number — inside
or outside the project — can be reproduced from documented queries instead of
being remembered or estimated.

What telemetry is **not**:

- not a general analytics platform, and no dashboard
- not session replay or behavioral recording
- not a third-party product analytics SDK
- not a billing, metering, or team-scoring system
- not a way to observe what Campfire is being used for
- not a count of people

See the sprint contract
([docs/Campfire-TEL-001-Anonymous-Product-Telemetry-Sprint.md](Campfire-TEL-001-Anonymous-Product-Telemetry-Sprint.md))
for the full metric definitions, privacy contract, and metric-integrity rules.

---

## How to disable it

```bash
campfire telemetry status     # what is currently resolved, and from where
campfire telemetry disable    # stop sending runtime product events
campfire telemetry enable     # start again
```

For a single invocation, or for CI, set the environment override. It wins over
the stored preference and does not change it:

```bash
CAMPFIRE_TELEMETRY=0 campfire …      # 0, off, false, or no
CAMPFIRE_TELEMETRY=1 campfire …      # 1, on, true, or yes
```

Resolution order is: `CAMPFIRE_TELEMETRY`, then the recorded preference, then
enabled. `campfire telemetry status` prints which one applied.

One honest limitation you should know about:

1. **`install_requested` cannot be suppressed from your machine.** It is
   recorded by the Worker at fetch time, before any Campfire code exists on the
   machine, so there is no preference or environment variable that can stop it.
   Disabling telemetry removes every event Campfire itself sends; it does not
   remove the fact that the installer script was fetched. Installer-request
   counts are therefore documented as approximate, because automated fetches,
   previews, CI, and people reading the script also produce them.

`install.sh` honors both controls: `CAMPFIRE_TELEMETRY` for a single run, and a
recorded `telemetry disable` for a later reinstall.

```bash
curl -fsSL https://boringinfra.company/campfire/install.sh | CAMPFIRE_TELEMETRY=0 sh
```

Telemetry failure can never affect Campfire: delivery is best-effort, has a
short timeout, is not retried in a loop, and its result is never checked. A dead
or slow endpoint cannot fail an installation, a command, or a workspace write.

Events are sent to `https://boringinfra.company/campfire/v1/telemetry`. Set
`CAMPFIRE_TELEMETRY_URL` to point a local or staged deployment somewhere else;
an endpoint that fails validation disables delivery rather than being repaired
by guessing a different host.

---

## Where the local state lives

One file, `telemetry.json`, in the Campfire config directory — `CAMPFIRE_CONFIG_DIR`
if set, otherwise `~/.config/campfire`:

```text
~/.config/campfire/telemetry.json
```

It holds the random installation id, your enabled/disabled preference, and the
local bookkeeping that keeps `activated` and `active` from repeating. **It is
not a credential.** It grants nothing, authenticates nothing, and contains no
token. Deleting it resets the installation id and the local bookkeeping: the
next event is reported under a new id, and the installation counts as new
again. Deleting it does not disable telemetry by itself; use
`campfire telemetry disable` for that.

---

## How the anonymous installation id is created

On first use, Campfire generates a random UUIDv4 locally and stores it. The
generator is the operating system's cryptographic random source. The id is
never derived from a username, login name, hostname, MAC address, machine
serial, IP address, Git identity, or any hardware fingerprint — nothing about
the machine or the operator is an input to it.

It is preserved across ordinary upgrades and reinstalls, because the file
survives. A genuinely clean installation — no state file — produces a new id.

It identifies **one Campfire installation**, and nothing else. The same id can
in principle appear on a rebuilt machine or after an image restore, and one
person can own more than one installation. Deduplicated counts are therefore
reported as *anonymous installations*: they deduplicate installations, not
people. This distinction is a hard rule for anything published about the
project.

---

## The internal queries

The founder metrics — installer requests, successful installations, install
completion, activation, daily and weekly active installations, returning
installations, and the version / OS / architecture / install-method / surface
breakdowns — are produced by one script:

```bash
node scripts/telemetry-queries.mjs --list                  # the query catalogue
node scripts/telemetry-queries.mjs --dry-run               # print the plan and the exact SQL
node scripts/telemetry-queries.mjs --since 2026-10-02 --confirm
node scripts/telemetry-queries.mjs --output json --confirm # one reproducible document
```

The script is internal. It is documented here so the numbers are reproducible,
not because it is meant to be run by anyone else. It never runs without an
explicit `--confirm`, prints every command before it runs it, reads its
credential from the environment, and refuses to report a window that begins
before the first installer request was ever measured.

Founder counts omit client events whose declared Campfire version is below
v1.9.1. Telemetry did not exist before that release, so a row declaring an
older version cannot have been emitted by a Campfire binary. Those rows stay
in the dataset. The script lists them as `excluded_below_reporting_floor`
instead of folding them into successful installations. Installer requests are
unchanged: the Worker writes those with version `unknown`, and `unknown` does
not parse as a version below the floor.

The comparison is numeric in effect. A lexical `blob3 < '1.9.1'` would treat
`1.10.0` as older than `1.9.1` and drop every later install. Unparseable
versions (`unknown`, `latest`) stay in the counts. The ingestion route applies
the same floor before writing; this query filter is what keeps the rows
already stored from being read as installations.

Founder queries also exclude the shared test installation id
(`11111111-2222-4333-8444-555555555555`, the Vitest fixture id in
`src/telemetry/contract.ts`): rows under it are synthetic by construction,
so every client-event count carries `blob8 NOT IN (...)`. The predicate is
applied uniformly, including to `install_requested`, whose `blob8` is empty
by contract — `'' NOT IN (...)` is true, so installer-request counts are
unchanged and no query needs a per-event carve-out. Successful installations
drop the test id; from the last audit that moves the count from 2 to 1.

One caveat is worth stating plainly: Cloudflare Analytics Engine samples
adaptively, so a large dataset reports estimates rather than exact totals. The
script returns the sampling interval alongside every count and labels each
figure accordingly — sample-weighted event counts are estimates, and
deduplicated installation counts are lower bounds while sampling is active. It
never presents a raw row count as an exact total.

---

## A known boundary

Campfire's product definition assigns behavioral state to a separate Boring
Infra project rather than to Campfire: `Observability → behavioral state` is a
sibling primitive in the portfolio table, behavioral outcomes appear there as a
future *composition* opportunity, and observability sits in Campfire's
long-term-direction list rather than in its current scope. Adding measurement
to Campfire therefore sits in deliberate tension with that assignment, and the
tension is unresolved.

What TEL-001 actually is: anonymous **installation** measurement. It counts
installer interest, successful installation, activation, and return. It contains
no behavioral observability, no workspace state, no agent-activity signal, and
no way to observe what Campfire is being used for. This document does not claim
the assignment has been settled; it records what shipped and leaves that
decision to the product owner.

---

## References

- [docs/Campfire-TEL-001-Anonymous-Product-Telemetry-Sprint.md](Campfire-TEL-001-Anonymous-Product-Telemetry-Sprint.md) — the sprint contract: event contract, privacy contract, founder metrics, metric-integrity rules
- [docs/OPERATOR.md](OPERATOR.md) — provisioning the Analytics Engine dataset, deploying the Worker binding, and the telemetry environment variables
- [docs/ARCHITECTURE.md](ARCHITECTURE.md) — where telemetry sits in the system boundaries
