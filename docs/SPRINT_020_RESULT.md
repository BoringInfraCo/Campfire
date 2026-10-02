# Campfire — Sprint 020 Result: Bring the Next Teammate In

**Status:** Implemented candidate; engineering validation complete; real acceptance pending

**Decision:** CONDITIONAL GO — engineering candidate, not release-ready GO

**Date:** October 2, 2026

**Candidate version:** `v1.9.0`

**Source release:** `v1.9.0` private canonical tag; public release and deployment remain `v1.8.0`
**Contract:** `docs/SPRINT_020.md`

## 1. Outcome and evidence boundary

The candidate implements the continuous owner-to-teammate journey: an owner
creates a protected enrollment invitation; the recipient joins existing shared
work with their own human and agent identities, prepares Codex/OpenCode
connections, reads authorized state, explicitly registers a session before
contributing, and returns through the same saved remote identity.

The independent two-human/two-machine reciprocal continuation trace is **not
complete**. Both supported recipient harnesses still require the live packaged
journey specified in Sprint 020. Automated state/transport/connection checks
are engineering evidence, not proof that two independently operating humans
have used the result in real work. No retention, ordinary team-value, PMF,
Gate B, Gate C, or Gate F claim is made.

The user can arrange the participating teammate and separate machine for this
acceptance. A founder simulating a second person or a same-machine fixture does
not substitute for it. CONDITIONAL GO records an implemented candidate with
outstanding acceptance; it does not declare the complete product journey proven
or authorize public release.

## 2. Implemented scope

- `src/domain/enrollment.ts` defines bounded enrollment inputs, strict pure
  normalization, safe receipts, and complete provisioning plans. Human and
  agent identities and ownership remain separate.
- Sync and Workers application services implement owner-only invitation
  issue/inspection/revocation, capability-only redemption, exact-request replay,
  and explicit additional-owned-agent enrollment. Server-derived team,
  workspace, role and ownership cannot be overridden by the claimant.
- SQLite and D1 share guarded enrollment SQL. Every dependent write requires
  the successful execution's claim; initial and additional-agent enrollment
  commit memberships, credential hashes and administrative history atomically.
  Migrations preserve existing collaboration state and local profiles.
- A separate enrollment redemption route accepts the invitation credential.
  Ordinary API/MCP/Viewer boundaries still require actor identity; enrollment
  secrets cannot become actor tokens or authorize workspace reads.
- The CLI writes private invitation files and prepares raw actor credentials
  locally before redemption. Private pending state supports retries and local
  finalization; server records contain hashes and nonsecret request-bound receipts.
- Remote profiles route normal CLI reads to the shared instance. Remote `up`
  serves only the local authorized read-only Viewer proxy and prepares enrolled
  harness connections. It does not bootstrap/open a collaboration SQLite file
  or start another shared API.
- Recipient identity selection flows through connect, doctor and handoff.
  Each Codex/OpenCode configuration receives its own agent token; unrelated
  configuration is preserved and conflicting profiles/blocks are refused.
- Existing context, attention, alignment, Findings/Tasks/Decisions/Artifacts,
  provenance and caller-held cursors support orientation and contribution.
  Startup, enrollment and read paths do not silently register sessions.
- The recipient CLI reports the truthful local stage it reached
  (`enrolled`, `credentials_saved`, `connection_prepared`, `reload_required`)
  instead of one success flag, and every Sprint 020 recovery code resolves to a
  concrete next command.

Enrollment-specific replay/atomicity is the narrow new infrastructure. Finding
lifecycle, decision supersession, context budget redesign, broad conflict
handling, presence, notifications, new harness adapters, writable Viewer,
account switching, hosting provisioning and orchestration remain outside this
sprint. The closed outbound webhook vocabulary is unchanged.

## 3. Engineering validation

Full consolidated validation of the candidate working tree on October 2, 2026
(macOS, darwin/arm64, Node 22, `better-sqlite3` local store):

| Step | Command | Result |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | clean, exit 0 |
| Full suite | `npm test` | 55 files, 595 tests, all passing |
| Build | `npm run build` | exit 0, `dist/src/cli/index.js` produced and executable |
| Package | `npm run pack:tarball` | `release/campfire-darwin-arm64.tar.gz` plus checksum and `public/campfire/v1.9.0/install.sh` |

No test was skipped, filtered, or excluded. The suite includes the pre-existing
identity, onboard, profile, Sprint 016–019, CLI-001, hosted onboarding/CLI/MCP,
isolation, Viewer hardening, Worker handler, async-service, and D1 store suites,
so v1.8 behavior remains covered rather than only the new surfaces.

### Staged packaged-candidate check

The tarball was extracted to a clean prefix and exercised as an installed CLI
with isolated `HOME`, `XDG_CONFIG_HOME`, `CAMPFIRE_DATA_DIR` and
`CAMPFIRE_CONFIG_DIR` roots. No developer identity, credential store, harness
configuration, or real database was touched.

- `--help` and `capabilities --output json` report `1.9.0` and expose both
  invitation variants from the catalog.
- Owner `init` + `onboard` created a real workspace on an isolated database;
  `serve` exposed it on loopback.
- `invite-teammate` wrote an invitation at mode 0600 and reported only path,
  workspace, expiry and next command, plus an explicit possession warning.
- Recipient `join --invitation-file` in separate isolated roots enrolled the
  recipient's human and OpenCode agent, returned the truthful stage list
  `enrolled, credentials_saved, connection_prepared, reload_required`, and
  created no local collaboration database.
- `status`, `list` and a fresh-process `status` all read the shared backend and
  resolved the same recipient identity; participant counts grew only when
  `connect --harness codex --enroll` added the second owned agent.
- `doctor` selected the recipient's OpenCode agent and truthfully reported the
  outstanding session-registration step rather than claiming readiness.
- `up` served the Viewer on local loopback at the existing endpoint and reported
  `mode: remote`; it did not open SQLite or bind a second shared API.
- Viewer remained read-only (`add_finding` returned 403 "Viewer is read-only"),
  `get_workspace_context` succeeded, and no served HTML/JS/CSS resource contained
  a bearer token. The OpenCode configuration contained exactly one token: its
  own agent credential.
- `revoke-invitation` returned `unclaimed_enrollment` for an unused invitation
  and `consumed_receipt_replay` for the consumed one; already enrolled
  identities remained intact.
- Legacy `join <workspaceId> --output human` still rejects human output.

This is a same-machine rehearsal of the packaged journey with one operator. It
is engineering evidence, not the required two-human, two-machine trace.

### Test coverage of the new surface

Targeted application tests have passed during implementation:

- `tests/unit/enrollment-service.test.ts` covers new identities/membership,
  inert exact replay, fixed authority, invitation expiry/revocation, explicit
  contribution sessions, added-agent ownership, and revoked-token recovery.
- `tests/worker/enrollment-service.test.ts` exercises matching sync/async
  application behavior against a real atomic SQLite store: both supported
  agent memberships, authorization, reciprocal structured-state use, strict
  validation, issuer authority loss, secret-free inspection, consumed-invitation
  revocation, simultaneous exact retries, and managed-slot replacement denial.
- `tests/unit/sprint-020-persistence.test.ts` executes the shared guarded SQL
  on both SQLite and the D1-compatible path: two different concurrent claimants
  produce exactly one enrollment, an injected uniqueness failure rolls back the
  consumption and every earlier insert, and issuer authority loss between
  precheck and claim blocks the write.
- `tests/integration/enrollment-http.test.ts` and `enrollment-worker.test.ts`
  prove the enrollment secret cannot authenticate ordinary calls, redemption is
  not reachable through `/v1/call`, the Worker route prefix still applies, and a
  recipient can read, contribute with an explicitly registered session, and be
  read by the original owner — with no workspace or goal created and no secret
  in Contributions.
- `tests/unit/enrollment-client.test.ts` proves the recipient saves protected
  pending state before the first request and replays a byte-identical request
  after a lost response.
- `tests/unit/enrollment-recovery.test.ts` asserts every Sprint 020 recovery
  code resolves to a concrete next command, that secret-bearing file kinds are
  gitignored, and that the published stage vocabulary is stable.
- `tests/integration/enrollment-cli.test.ts` drives the shipped CLI surface:
  private issuance, join, dropped-response recovery, no local database, no
  pending file left behind, no token in output, and preserved legacy join mode.
- `tests/unit/migrations.test.ts` asserts the v4→v5 upgrade adds enrollment
  tables and indexes without touching existing collaboration state or local
  profiles.

Persistence tests execute shared guarded SQL through SQLite and the
SQLite-backed D1-compatible test adapter in `tests/helpers/sqlite-d1.ts`.
This adapter proves SQL guards/batching/rollback in the test environment; it is
not a live Cloudflare D1 deployment claim.

No production migration or deployment was performed. Runtime traces, user
machines, actual credentials and private transcript capture remain outside
published evidence.

## 4. Real acceptance still required

Follow Sprint 020 section 16 with a packaged candidate and an already
provisioned reachable instance running the matching API/schema:

1. Human A and Agent A perform real existing work with inspectable intent,
   decision rationale, blocker, evidence/artifact references and provenance.
2. A creates an invitation; B receives only that file and ordinary installation
   information on another machine.
3. B joins, prepares/reloads their own harness, opens the local journal, and
   asks a cold agent a natural continuation question without a tool sequence,
   original transcript or answer-bearing handoff.
4. B's agent reads authorized work before acting and explicitly registers its
   own session before a meaningful contribution.
5. A's fresh agent retrieves that contribution and uses it to change a next
   action or avoid repeated investigation. Storage presence alone is insufficient.
6. B returns through the same identity in a fresh process; rehearse interruption
   recovery separately. Complete both Codex and OpenCode recipient paths.

Record safe receipts, versions, approvals/reloads, interventions, operation
order, actual participant/session/provenance relationships, artifact access,
recovery, orientation correctness and the concrete work improved. A prompted
return proves operability, not voluntary later-day retention. Preserve the
cancelled Field Trace 001 result unchanged.

## 5. Compatibility and release disposition

Package metadata targets `1.9.0`; dependency versions are unchanged. The
candidate adds CLI capabilities and compatible schema/profile evolution.
Legacy actor-targeted `invite` / `join`, local first-person onboarding, local
listener startup, v1.8 output modes and the read-only token-free Viewer remain
the compatibility baseline. Invitation-based join uses safe human/JSON
receipts, while legacy join preserves its prior JSON-only result contract.

Invitation revocation stops unclaimed enrollment and invitation-based receipt
recovery, and its receipt states which of the two authorities was withdrawn. It
does not erase already enrolled principals or revoke their actor tokens. A
new-person invitation is possession-based enrollment authority, not verified
identity or general delegated agent authority.

## 6. Remaining limitations

- The independent two-human, two-machine reciprocal continuation trace has not
  been run. Section 4 remains open.
- The D1 guarantee is proven through a SQLite-backed D1-compatible adapter, not
  a live Cloudflare D1 deployment. Guarded SQL, batching, rollback and
  concurrency behavior are exercised; production D1 behavior is unverified.
- `getEnrollmentInvitation` has no CLI/HTTP/MCP surface. It is tested and
  secret-free, but no caller is exposed in this sprint.
- Recovery covers interrupted enrollment, dropped responses, and local write
  failures. Total loss of every prepared credential still requires owner
  assistance; this is deliberately not an account recovery system.
- No voluntary later-day use has been observed. Gate B and Gate C remain
  unmeasured.

The private canonical source is released as the annotated `v1.9.0` tag. No
public snapshot export, public GitHub Release, production migration, deployment,
or installer promotion is recorded here. Public promotion remains a separate
decision and must preserve the CONDITIONAL GO evidence boundary above.
