# Campfire TEL-001 --- Anonymous Product Telemetry

**Status:** Proposed\
**Priority:** P0\
**Release position:** Pre-v1.9 infrastructure sprint\
**Scope:** Small, infrastructure-first

## 1. Sprint Thesis

Campfire needs a small, privacy-preserving measurement layer before the
next collaboration milestone.

The immediate need is to count curl-based installation activity. The
more important need is to distinguish download interest from successful
installation, activation, active use, return use, and eventually
cross-person continuation.

TEL-001 must **not** become a general analytics platform. It should
create the minimum trustworthy instrumentation needed to answer whether
Campfire is being installed, activated, and repeatedly used while
collecting no workspace content, code, prompts, repository names, paths,
credentials, or human identity.

## 2. Why Now

-   The current curl installation path does not provide an npm-style
    download counter.
-   The product audit identified later-day voluntary return and useful
    cross-person continuation as unresolved behavioral evidence gates.
-   v1.9 --- **Bring the Next Teammate In** --- will be substantially
    easier to evaluate if measurement exists before that experience
    ships.
-   Launch-period interest is perishable. Events that are not
    instrumented cannot be reconstructed later.

## 3. Goals

-   Count requests for the official curl installer.
-   Count successful installations separately from installer requests.
-   Create an anonymous local installation identifier for deduplicated
    installation-level activity.
-   Measure a deliberately small activation/retention funnel.
-   Provide transparent telemetry controls and documentation.
-   Make telemetry failure non-blocking.
-   Expose internal queries for launch, daily, weekly, version,
    OS/architecture, activation, and return metrics.

## 4. Non-Goals

-   No session replay or behavioral recording.
-   No prompt, message, code, diff, artifact, finding, decision, goal,
    or task-content collection.
-   No file paths, filenames, repository names, workspace names, branch
    names, or remote URLs.
-   No credentials, tokens, API keys, secrets, email addresses,
    usernames, or hostnames.
-   No third-party product analytics SDK.
-   No customer-facing analytics dashboard in TEL-001.
-   No billing or metering system.
-   No attempt to equate an installer request with a unique human.
-   No organizational analytics, team scoring, or agent productivity
    scoring.
-   No instrumentation of every CLI command.

## 5. Measurement Model

  -----------------------------------------------------------------------
  Metric            Meaning           Identity          Safe external
                                                        wording
  ----------------- ----------------- ----------------- -----------------
  Installer         Official          None required     Installer
  requests          `/install`                          requests
                    endpoint fetched

  Successful        Installer reaches Anonymous install Successful
  installs          successful        ID                installations
                    completion

  Activated         First meaningful  Anonymous install Activated
  installs          successful        ID                installations
                    Campfire use

  Active installs   Meaningful        Anonymous install Active
                    Campfire use      ID                installations
                    during a period

  Returning         Same anonymous    Anonymous install Returning
  installs          install ID active ID                installations
                    on a later UTC
                    day
  -----------------------------------------------------------------------

**Important:** installer requests or anonymous installations must not be
reported as "people" or "users."

## 6. Funnel

``` text
install_requested
      ↓
install_completed
      ↓
activated
      ↓
active
      ↓
returned
```

Cross-person continuation remains a later product event tied to v1.9.

## 7. Architecture

``` text
curl campfire.dev/install
          │
          ▼
Cloudflare Worker
  ├── record install_requested
  └── return install.sh
          │
          ▼
Campfire installer
  ├── generate/preserve anonymous install ID
  └── install_completed
          │
          ▼
Campfire CLI / agent surface
  ├── activated
  └── active
          │
          ▼
Telemetry Worker endpoint
  ├── schema validation
  └── allow-listed fields
          │
          ▼
Workers Analytics Engine
          │
          ▼
Founder metrics / queries
```

### Request flow

1.  `GET /install` records `install_requested` and returns the official
    installer.
2.  Successful installer execution ensures an anonymous installation ID
    exists and best-effort POSTs `install_completed`.
3.  First meaningful Campfire success best-effort POSTs `activated`
    once.
4.  Subsequent meaningful usage emits locally bounded/rate-limited
    `active` events.
5.  Internal measurement queries Analytics Engine. No public metrics
    endpoint is required.

## 8. Event Contract

Use a versioned, allow-listed schema. Never serialize arbitrary Campfire
domain objects.

  ---------------------------------------------------------------------------
  Event                 Trigger           Required          Install ID
                                          dimensions
  --------------------- ----------------- ----------------- -----------------
  `install_requested`   Official          schema version,   No
                        `/install`        install method
                        fetched

  `install_completed`   Installer         schema version,   Yes
                        succeeds          version, OS,
                                          arch, install
                                          method

  `activated`           First meaningful  schema version,   Yes
                        Campfire success  version, OS, arch

  `active`              Meaningful use    schema version,   Yes
                        after activation  version, OS,
                                          arch, surface
  ---------------------------------------------------------------------------

Suggested logical client schema:

``` ts
type TelemetryEventV1 = {
  schemaVersion: 1
  event: "install_completed" | "activated" | "active"
  installationId: string
  campfireVersion: string
  os: string
  arch: string
  installMethod?: "curl"
  surface?: "cli" | "agent" | "mcp"
}
```

## 9. Activation Definition

Activation means the first successful action demonstrating Campfire is
actually usable, not merely that the binary executed.

Preferred candidates are existing stable primitives such as successful
workspace bootstrap/join or the first successful authenticated
workspace-context operation.

Do not count:

-   `campfire --help`
-   `campfire --version`
-   telemetry commands
-   failed setup
-   failed authentication

Implementation should inspect current v1.8 command/service paths and
attach activation to an existing meaningful success boundary.

## 10. Anonymous Installation Identity

Generate a cryptographically random UUID locally after successful
installation and store it using Campfire's existing local state/config
conventions.

Requirements:

-   Never derive it from username, hostname, MAC address, machine
    serial, IP address, Git identity, or hardware fingerprint.
-   Preserve it during ordinary upgrades/reinstalls when Campfire state
    remains intact.
-   Generate a new ID after a genuinely clean installation.
-   Treat the identifier as an **installation**, never a person.

## 11. Privacy Contract

Campfire telemetry must never intentionally contain:

-   persisted IP address as a Campfire telemetry dimension
-   precise location
-   human name or email
-   GitHub handle or organization name
-   hostname or machine fingerprint
-   workspace/team/project/repository names
-   repository URL or branch
-   file paths or filenames
-   prompts or messages
-   source code or diffs
-   artifacts, findings, decisions, goals, or task contents
-   tokens, API keys, secrets, or credentials
-   raw command arguments capable of containing user content

Public documentation must state what Campfire collects, what it does not
collect, why telemetry exists, and how to disable it.

## 12. CLI UX

``` bash
campfire telemetry status
campfire telemetry enable
campfire telemetry disable
```

Also support a documented environment override for CI/automation,
following existing Campfire naming conventions.

Telemetry failure must never affect core functionality.

## 13. Installer Behavior

The official install remains compatible with:

``` bash
curl -fsSL https://campfire.dev/install | sh
```

Requirements:

-   Analytics must not alter expected installer behavior.
-   Completion POST uses a short timeout.
-   Completion POST failure is ignored.
-   Telemetry outage cannot cause a non-zero installer exit if Campfire
    installed correctly.
-   `install_requested` remains separate from `install_completed`.
-   Retries, CI, bots, previews, and script inspection may inflate
    installer-request counts.
-   Do not build complicated bot detection in TEL-001.

## 14. Analytics Engine Model

Keep field positions stable and schema-versioned.

Logical dimensions:

``` text
event_name
schema_version
campfire_version
os
arch
install_method
surface
anonymous_install_id (where necessary)
```

Queries must account for Analytics Engine sampling semantics. Do not
assume raw `COUNT(*)` always represents the underlying unsampled total.

## 15. Founder Metrics

TEL-001 must make these reproducible:

-   Installer requests: today, since launch, trailing 7/30 days.
-   Successful installations.
-   Install completion rate.
-   Activated installations and activation rate.
-   Daily/weekly active installations.
-   Returning installations.
-   Breakdown by Campfire version, OS, architecture, install method, and
    surface.

Example internal output:

``` text
CAMPFIRE — LAUNCH → TODAY

Installer requests           147
Successful installations     119
Activated installations       87
7-day active installations    54
Returning installations       31

Install completion           81%
Activation                   73%
```

No dashboard UI is required in TEL-001. Documented queries/scripts are
sufficient.

## 16. Work Breakdown

### TEL-001A --- Contract & Privacy Guardrails

Define schema v1, event allow-list, prohibited fields, activation
definition, local setting semantics, and documentation skeleton.

**Exit:** event contract is explicit before instrumentation is added.

### TEL-001B --- Local Identity & Preferences

Implement random installation UUID, persistence, upgrade preservation,
telemetry preference, CLI controls, and environment override.

**Exit:** identity and preferences are deterministic and independently
testable.

### TEL-001C --- Telemetry Client

Implement strict payload construction, schema versioning, short timeout,
best-effort delivery, no blocking retry loop, and no Campfire failure
propagation.

**Exit:** telemetry transport can fail completely without affecting
Campfire.

### TEL-001D --- Install Measurement

Implement `/install` instrumentation plus successful installer
completion reporting.

**Exit:** installer requests and successful installs are separately
measurable.

### TEL-001E --- Product Lifecycle Events

Wire `activated` and bounded `active` events into existing meaningful
success paths.

**Exit:** activation and ongoing use can be measured without
command-level surveillance.

### TEL-001F --- Cloudflare Ingestion

Implement validation, field allow-list, payload-size limit, dimension
normalization, Analytics Engine write, and fast response.

**Exit:** only the documented contract reaches storage.

### TEL-001G --- Measurement Queries

Provide reproducible queries/scripts for installer requests, completed
installs, activation, active/returning installations, versions, OS, and
architecture.

**Exit:** founder metrics can be generated without manually inspecting
logs.

### TEL-001H --- Documentation & Release

Update README, telemetry/privacy docs, CLI docs, environment-variable
docs, and release notes.

**Exit:** telemetry is transparent before broad release.

## 17. Acceptance Criteria

-   [ ] Official curl installer requests record `install_requested`.
-   [ ] Existing installer behavior remains unchanged.
-   [ ] Successful installation emits `install_completed`.
-   [ ] Telemetry network failure cannot fail installation.
-   [ ] Fresh installations receive a random anonymous installation ID.
-   [ ] ID is not derived from user/machine identity.
-   [ ] Ordinary upgrades preserve the installation ID.
-   [ ] `campfire telemetry status|enable|disable` works.
-   [ ] Disabled runtime telemetry sends no product events.
-   [ ] `activated` emits only after the selected meaningful success
    action.
-   [ ] `activated` emits at most once per installation.
-   [ ] Trivial/failed commands do not activate.
-   [ ] Active telemetry is locally bounded.
-   [ ] Agent/CLI loops cannot create event spam.
-   [ ] Server accepts only documented events/fields.
-   [ ] Server enforces payload-size limits.
-   [ ] Privacy tests prove prohibited data cannot enter serialized
    events.
-   [ ] Founder can query installer, completion, activation, active, and
    return metrics.
-   [ ] Queries account for Analytics Engine sampling.
-   [ ] README/docs accurately disclose collection.
-   [ ] Existing Campfire suite remains green.
-   [ ] Clean-install smoke remains green.

## 18. Test Plan

### Unit

Test event serialization, UUID generation/persistence, preference
precedence, enable/disable, activation-once state, active-event rate
limiting, and timeout behavior.

### Privacy Regression

Fixtures containing repository/workspace names, file paths, prompts,
code, API tokens, credentials, usernames, and emails must never appear
in serialized telemetry.

### Transport

Test 2xx, 4xx, 5xx, DNS/network failure, timeout, and malformed
responses. All client-side failures remain non-blocking.

### Installer

Test clean install, reinstall, upgrade, unavailable telemetry endpoint,
unsupported OS/architecture, and piped-shell execution.

### Worker

Test installer response, valid event, unknown event/schema/field,
oversized payload, malformed JSON, and Analytics Engine binding
behavior.

### Integration

Exercise:

``` text
install
  ↓
install_completed
  ↓
activation
  ↓
active
  ↓
later-day active
  ↓
return metric
```

The installation ID remains stable throughout.

### Regression

Run full Campfire tests, typecheck, build, clean-install smoke, and
existing CLI smoke tests.

## 19. Rollout Plan

1.  **Installer measurement:** deploy `/install` + `install_requested`
    and validate controlled counts.
2.  **Internal runtime telemetry:** enable completion/activation/active
    events on test installations and inspect payloads.
3.  **Public release:** publish implementation, privacy docs, CLI
    controls, and release notes.
4.  **48--72 hour validation:** watch duplication, inflated requests,
    unexpected cardinality, activation anomalies, and excessive active
    events.
5.  **Baseline:** freeze definitions for the first reporting window and
    use the same definitions externally.

## 20. Metric Integrity Rules

1.  Never call installer requests "users."
2.  Never combine `install_requested` and `install_completed`.
3.  Call deduplicated device-level counts **anonymous installations**,
    not unique humans.
4.  Include the reporting date range externally.
5.  Document metric-definition changes.
6.  Do not backfill values that were never measured.
7.  Keep investor-facing numbers reproducible from documented queries.

Good:

> Since October 2, Campfire has recorded 119 successful anonymous
> installations, 87 of which activated the product, with 31
> installations returning on a later day.

Avoid:

> Campfire has 119 users.

## 21. Definition of Done

TEL-001 is complete when Campfire can truthfully and reproducibly
measure:

``` text
official installer interest
        ↓
successful installation
        ↓
meaningful activation
        ↓
active installation
        ↓
return behavior
```

while:

-   users can inspect and disable runtime telemetry,
-   emitted telemetry is demonstrably content-free,
-   telemetry failure cannot break Campfire,
-   metrics are queryable from Cloudflare,
-   definitions are documented,
-   existing Campfire behavior remains green.

## 22. Release Position

``` text
v1.8
  ↓
TEL-001 — Anonymous Product Telemetry
  ↓
v1.9 — Bring the Next Teammate In
  ↓
v1.10 — Keep Shared Understanding Current
```

TEL-001 may ship as a v1.8.x release if that matches Campfire's release
conventions.

Do not delay v1.9 for analytics features beyond this scope.

## 23. Follow-On for v1.9

When **Bring the Next Teammate In** ships, extend this contract only
with collaboration events required to test that product thesis.

Candidate events:

``` text
workspace_joined
continuation_started
continuation_completed
```

Their exact semantics must be defined by v1.9 before implementation.

The eventual question is not merely:

> How many people downloaded Campfire?

It is:

> Did someone install Campfire, activate it, return to it, bring another
> participant into the workspace, and successfully continue shared work?

TEL-001 establishes the measurement foundation needed to answer that
question without turning Campfire into an analytics product.
