# Campfire — Sprint 020: Bring the Next Teammate In

**Status:** Implemented candidate — engineering verification and independent real acceptance tracked in `SPRINT_020_RESULT.md`

**Date:** October 1, 2026

**Company:** Boring Infra Co.

**Depends on:** Sprint CLI-001 (**GO**), published `v1.8.0`; Sprints 015–018 onboarding, connection, and session-entry boundaries

**Target release:** `v1.9.0`

**Release theme:** **Campfire v1.9 — Bring the Next Teammate In**

**Product promise:** Make joining existing work, connecting your agents, understanding what happened, and contributing back feel like one continuous experience.

**Primary success measure:** A second independently operating human and their agent join an existing workspace, correctly continue from authorized work state, and contribute something the original participant subsequently uses.

---

## 1. Sprint question

> Can a teammate arrive on another machine, bring their own agents into existing
> work, understand what the team already learned, and contribute back without
> an operator assembling identities, credentials, and a handoff for them?

Campfire v1.8 has a reliable interface to structured work. It has not yet made
the transition from one participant to the next a coherent product journey.
This sprint delivers that journey, including recovery and reciprocal continuation.

The defining flow is:

    Human A + Agent A
        |
        | existing goal, findings, decisions, tasks, artifact references
        v
    Existing shared Campfire workspace
        |
        | owner-authorized enrollment invitation
        v
    Human B on another machine
        |
        | own human identity, own agent identities, explicit membership
        v
    Agent B reads authorized work before acting
        |
        | explicit session registration before contribution
        v
    Useful contribution with B's provenance
        |
        v
    Human A + a fresh agent process use B's contribution

A working invite command alone is insufficient. The deliverable runs through
joining, connection, understanding, contribution, and return.

## 2. Product context and evidence boundary

The initial wedge remains **two humans, two different harnesses, one shared
workspace**. The initial users remain small engineering teams already doing
meaningful work with agents. An incident, migration, or multiday delivery is
a suitable acceptance scenario; do not expand into several unrelated workflows.

The roadmap's Phase 2 ongoing-work questions remain the frontier. Sprint 020
also adds the minimum enrollment authority needed to exercise the existing
team model. It is not completion of Phase 3, Phase 4, or hosted Stage C.

Existing evidence:

- Cross-harness continuity, structured state, authorization, and provenance
  have engineering and controlled acceptance evidence.
- Sprints 015–018 improved first-person setup, harness connection, and entry.
- Sprint 019 added vendor-neutral outbound facts.
- CLI-001 made the CLI a first-class human/agent interface over existing state.
- Gate B voluntary repeat usage and Gate C ordinary multi-participant value
  remain unmeasured. Field Trace 001 was cancelled before a qualifying run.

The hypothesis is that removing second-person setup friction makes useful
team continuation attainable without founder assistance. A scored invited
team trace demonstrates this surface. An instructed return demonstrates
return operability, not voluntary retention. Record qualifying voluntary
later-day behavior separately; do not infer demand or PMF from test success.

## 3. Read before implementing

Follow `AGENTS.md` and `skills/build-campfire/SKILL.md`. Read the Canon, this
contract, and the relevant implementation in that order:

1. `README.md`
2. `docs/PRODUCT_DEFINITION.md` — identities, initial user, and initial wedge
3. `docs/VISION.md` — shared work state, privacy, and harness independence
4. `docs/ARCHITECTURE.md` — application boundaries, authorization, persistence
5. `docs/ROADMAP.md` — Phase 2/3 direction and Gates B/C
6. `docs/SPRINT_015_RESULT.md`, `docs/SPRINT_016_RESULT.md`,
   `docs/SPRINT_017_RESULT.md`, `docs/SPRINT_018_RESULT.md`
7. `docs/SPRINT_CLI_001.md` and its result/compatibility audit
8. `docs/OPERATOR.md` and the code/tests mapped below

Use `Campfire-Internal` as canonical development source. The adjacent public
`Campfire` checkout was at v1.5 during planning; remote public main matched the
recorded v1.8 snapshot. Do not derive current behavior from that stale checkout.

Produce the repository understanding report and implementation plan required
by the engineering constitution before coding. Reconfirm the actual tree;
paths below are orientation, not permission to bypass discovery.

## 4. Repository understanding and implementation map

| Boundary | Existing implementation | What this sprint must address |
| --- | --- | --- |
| Human/agent identity and state | `src/domain/types.ts`, `src/service/service.ts`, `src/service/campfire-service.ts` | Keep separate identities, owning human, and explicit workspace membership. |
| Existing invites | `inviteToWorkspace` / `joinWorkspace`; `WorkspaceInvite` | These require an already-existing target ActorRef. Preserve them; add a distinct new-person enrollment capability. |
| Identity bootstrap | `src/bootstrap/onboard.ts`, `src/bootstrap/listen.ts` | First-person composition is local and refuses populated installations. Do not weaken that guard or rerun bootstrap on a teammate machine. |
| Authorization | `src/service/simple-authorizer.ts`, `src/worker/async-authorizer.ts` | Existing targeted invitations permit owners/members. New-person invitation issuance requires a human owner explicitly. |
| Actor credentials | `src/service/tokens.ts`, `src/worker/crypto.ts` | Existing persistence stores hashes. Extend this discipline to enrollment and recoverable provisioning. |
| Local profile | `src/bootstrap/profile.ts`, `src/config.ts` | Current profile requires a database path. Add an explicit remote profile without inventing a local database. Preserve old local profiles. |
| CLI backend/startup | `src/cli/index.ts` (`withBackend`, `cmdUp`, `cmdView`, `cmdConnect`, `cmdDoctor`, `cmdHandoff`) | Current normal remote selection follows CAMPFIRE_URL; up opens local SQLite. Joined remote profiles must work without environment plumbing. |
| Connection | `src/bootstrap/connect.ts` | Reuse Codex/OpenCode adapters, preserve unrelated config, and select the correct recipient-owned agent token. |
| Session entry | `src/mcp/context.ts`, `src/mcp/stdio.ts`, `src/mcp/instructions.ts`, `src/mcp/listener.ts` | Agent-only credentials, read before act, explicit session before write, and no remote listener auto-start. |
| Understanding/return | `src/service/service.ts`, `src/cli/projections.ts`, `src/bootstrap/doctor.ts`, `src/bootstrap/handoff.ts` | Reuse current context, attention, alignment, provenance, and caller-held cursors. Do not create a second collaboration model. |
| HTTP | `src/http/server.ts`, `src/http/client.ts`, `src/http/dispatch.ts` | Ordinary v1/call requires an existing actor token. Redemption needs its own narrow credential boundary. |
| Workers | `src/worker/handler.ts`, `async-service.ts`, `async-dispatch.ts`, `d1-store.ts` | Same authority, atomic provisioning, recovery, and route-prefix behavior as team-hosted SQLite. |
| Persistence | `src/store/store.ts`, `sqlite-store.ts`, `schema.sql`, `migrations.ts`; `migrations/`, `src/worker/schema.ts` | Add bounded enrollment records and migrations in both stores. D1 cannot read its buffered uncommitted writes. |
| Viewer | `src/viewer/server.ts`, `src/viewer/static/` | Existing read-only loopback proxy over the recipient's authorized backend. Browser receives no credential. |
| CLI contract | `src/cli/catalog.ts`, `args.ts`, `output.ts`, `recovery.ts` | Catalog-driven discovery, human/JSON parity, structured recovery, and preserved v1.8 behavior. |

Relevant regression coverage includes identity, onboard, profile, sprint-016,
sprint-017, sprint-018, cli-001, hosted onboarding/CLI/MCP, isolation, Viewer
hardening, worker handler, async-service, D1 store, and existing acceptance tests.

Two implementation traps deserve explicit attention:

1. New humans cannot call ordinary `createHuman` in a populated team without
   existing human authority. `createAgent` also checks the owning human.
   Sending an inviter's token to the recipient is not a solution.
2. D1 buffers writes and rejects reads after queued writes. Nesting
   `createHuman → createAgent → invite → join` inside its transaction does
   not provide a portable provisioning operation. Construct and validate the
   new rows before a guarded atomic write.

## 5. Scope and user-facing command contract

Use the existing CLI as the setup boundary. MCP cannot configure a harness
that has not yet connected. The expected new/extended public surface is:

    # Owner, already connected to a reachable shared instance:
    campfire invite-teammate <workspaceId> --out <private-invitation-file>

    # Recipient, in a fresh or isolated Campfire profile:
    campfire join --invitation-file <private-invitation-file> \
      --human-name "Alice" --harness opencode

    # Optional: select both validated harnesses at enrollment:
    campfire join --invitation-file <private-invitation-file> \
      --human-name "Alice" --harness codex --harness opencode

    # Inspect existing shared work; then launch the local human journal:
    campfire status
    campfire up

    # Repair/reapply an existing connection:
    campfire connect --harness opencode

    # Explicitly add the other validated harness later:
    campfire connect --harness codex --enroll

    # Owner can cancel enrollment or disable a consumed invitation's receipt replay:
    campfire revoke-invitation <invitationId> --workspace <workspaceId>

These are contract names. If repository discovery demonstrates a materially
smaller compatible surface, amend this document before implementing a different
public contract. Do not maintain parallel journeys.

- Legacy `join <workspaceId>` and `invite <workspaceId> --actor ...` retain
  their current actor-targeted behavior and output contract.
- Invitation-file enrollment and legacy join arguments are mutually exclusive.
- At least one explicit supported harness is selected. Permit one or both of
  Codex/OpenCode, once each; reject duplicates or unsupported selections before
  consuming the invitation. Default agent display names may use existing names.
- TTY prompts may collect missing nonsecret inputs. Non-TTY operation requires
  explicit inputs and returns structured missing-input guidance.
- Successful join stores credentials, prepares selected connections, and
  prints a nonsecret receipt. It does not launch a daemon or register sessions.
- Up remains the deliberate startup step. A harness reload/new process and its
  approvals remain visible external boundaries.
- Existing connect without `--enroll` remains configuration preparation.
  Enrollment of an additional owned agent is an explicit mutation.
- Every command is discoverable through help and the CLI manifest. Human and
  JSON renderers share one versioned result. No new raw-secret stdout mode is
  required; invitation delivery uses the protected file.
- Join's new enrollment variant uses the dual human/JSON contract; legacy actor
  join remains JSON-only, including its rejection of explicit human output.
  Resolve that distinction through typed catalog variant metadata (or an
  equivalent catalog-driven resolver), not a prose-only help exception.

## 6. Owner invitation and deployment prerequisites

An owner operates on an already provisioned shared Campfire instance. This
sprint does not provision hosting, DNS, TLS, Cloudflare accounts, or databases.

**SHR-001 note (Oct 2026):** this sprint's prerequisite is unchanged. SHR-001
adds a separate, optional local-owner publication path that creates the first
private hosted namespace before this invitation path is used. Do not treat the
Sprint 020 enrollment endpoint as a workspace migration endpoint.

An enrollment invitation is a narrowly scoped administrative capability,
distinct from an existing-actor WorkspaceInvite. It authorizes **one new human**
to join one workspace and bring bounded supported agent identities.

Issuance requires an authenticated human with role `owner` in that workspace.
Agents, members, viewers, nonparticipants, and foreign-team actors cannot issue
or revoke these invitations. Do not silently reuse the broader existing
`invite:create` authorization.

The server fixes:

- workspace and its team;
- issuer human identity;
- recipient human role `member`;
- owned agent role `agent`;
- permitted supported harnesses, at most Codex and OpenCode;
- issuance and expiry timestamps;
- consumption/revocation metadata and the successful claim binding.

The recipient chooses a display name and selected permitted harnesses, not
their team, workspace, role, owner, or an existing human ID. A display name
is not a verified email or an account identity.

Owner revocation may cancel an unused invitation or disable receipt replay for
a consumed invitation. It does not revoke the already enrolled Human/Agents,
actor credentials, or workspace memberships. The receipt must state which
authority was revoked; this command is not teammate offboarding.

Use a cryptographically random enrollment secret distinct from actor tokens;
persist only its hash. Default expiry is 24 hours. If an expiry override is
offered, it must be bounded to no more than seven days and validated using
server time. Issuance never creates placeholder humans/agents.

The versioned invitation file contains only the endpoint descriptor,
invitation ID/secret, workspace ID, safe workspace label, expiry, and enrollment
instructions/schema version. No work-state snapshot, private transcript,
owner credential, existing agent credential, or database path is included.

The endpoint must be HTTPS for another-machine use. An explicit loopback HTTP
exception is allowed for isolated developer tests, clearly identified as
same-machine-only. Never distribute the owner's localhost URL as a remotely
usable workspace. Reject URL userinfo, secret-bearing query/fragment values,
unsupported schemes, and ambiguous endpoints; preserve legitimate API path
prefixes such as `/campfire`. No automatic local host exposure or remote
provisioning is introduced.

The CLI writes the invitation file restrictively (0600), without replacing an
existing file silently, and reports only its path, workspace, expiry, and next
command. The owner transfers that credential-bearing file using a channel
they choose. Campfire does not send email/messages or provide public share URLs.
Warn once that anyone holding the file can claim its enrollment authority;
do not imply identity verification. The recipient deliberately trusts the
declared endpoint before submitting enrollment; files cannot contain executable
commands, arbitrary config targets, or installation scripts.

## 7. Redemption, credentials, and recovery

Add a narrow `POST /v1/enrollment/redeem` boundary (including the existing
Worker prefix handling). It authenticates the enrollment secret and exposes
only the redemption operation. It is not an unauthenticated generic dispatch
endpoint. Issuance and revocation remain normal authenticated actor operations.

An enrollment secret cannot authenticate ordinary calls, Viewer, MCP, session
registration, token administration, workspace reads, or arbitrary identity
creation. Do not add redemption to the browser Viewer allowlist or agent tools.

### Credential preparation

Choose a recoverable hash-only protocol rather than storing server-side raw
actor credentials for later replay:

1. Before the first request, the recipient CLI generates its own fresh human
   token and one agent token per selected harness using Campfire's CSPRNG
   credential generation.
2. It durably and atomically saves a private pending receipt containing the
   original endpoint/invitation binding, stable request ID, exact enrollment
   inputs, and prepared credentials. Use 0600 files and restrictive containing
   directories. No secret enters the nonsecret profile.
3. Redemption transmits the invitation credential through a credential header;
   names, harness selections, request ID, and actor-token hashes are bounded
   request fields. Raw actor tokens stay on the recipient machine.
4. Core validates credential hash shape/uniqueness, derives all principal and
   membership relationships, and commits the enrollment.
5. The response contains nonsecret identity IDs and scope, not actor tokens.
   The CLI finalizes the matching profile/credential files before applying
   harness configuration.

Hash registration is available only inside this validated provisioning
operation. Do not expose arbitrary token-hash injection through ordinary
identity/token methods.

### Exact retry

Bind a successful enrollment to one stable request ID and a deterministic
digest of the exact normalized inputs, including all prepared token hashes.
Persist its nonsecret result.

- An exact retry by that original claimant returns the same result and creates
  no new identities, tokens, memberships, or Contributions.
- Reusing the invitation with a different request/credential binding fails.
- Exact receipt recovery may remain available after invitation consumption
  until the original expiry; revocation cancels it. It never authorizes another
  enrollment, extends expiry, or resurrects revoked actor credentials.
- After successful commit, locally prepared actor credentials can authenticate
  ordinary identity/workspace reads. Recover local finalization with those
  credentials when invitation recovery is unavailable; verify actual authorized
  state and the expected identities, rather than trusting a pending file.
- Complete loss of all prepared credentials is not account recovery. Give an
  honest owner-contact path; do not reuse the invitation to mint a new principal.

A dropped response, CLI restart, profile write failure, or harness-config write
failure must be recoverable from the pending receipt and same prepared identity.
Do not consume a second invitation, repeat bootstrap, or ask the owner to send
an actor token. Preserve recovery until finalization succeeds; cleanup must not
remove the only surviving credentials prematurely.

A server commit and the recipient filesystem cannot be one transaction.
Expose truthful stages such as `enrolled`, `credentials_saved`,
`connection_prepared`, and `reload_required`. Partial local completion is
not server rollback and must not be reported as a fully working connection.
Bound network timeouts, reject redirects on credential-bearing enrollment
requests, sanitize failures, and preserve pending recovery on ambiguity.

## 8. Atomic enrollment and persistence contract

One successful initial enrollment commits together:

- conditional invitation consumption and exact-request binding;
- one new Human in the stored team;
- one actor-token hash for that Human;
- one owned Agent and token hash per selected supported harness;
- a managed connection slot per selected Agent, unique by enrolled Human,
  workspace, and harness;
- explicit Human membership (`member`) and each Agent membership (`agent`);
- truthful workspace Contributions for administrative enrollment/membership;
- the nonsecret enrollment result needed for exact replay.

It does not create an Organization, Team, Workspace, Goal, or AgentSession.
Existing work state is unchanged.

Precompute stable IDs/rows, validate ownership/scope, and implement a narrow
application/store provisioning operation. Do not bypass service rules by
putting the workflow in CLI or HTTP handlers. Shared pure validation and
projections may be reused; a broad service refactor is not a prerequisite.

Invitation validity, expiry, revocation, eligible active workspace, and issuer
owner authority must hold at the atomic claim boundary. Two different
concurrent claimants must produce exactly one enrollment. A rejected or rolled
back claim creates no orphan identity, token, membership, receipt, or history.

A conditional consume UPDATE followed by unconditional inserts is insufficient
if the losing update affects zero rows. Every provisioning write must depend on
the successful claim, or use another demonstrably atomic claim-and-provision
design. Checking row counts after an already committed unsafe batch is too late.
Account for D1's buffered transaction semantics explicitly.

Add compatible SQLite/D1 migrations, constraints, and indexes. Test the actual
guarded SQL and rollback behavior on SQLite and a D1-compatible execution path;
a mock that merely reports successful batch execution is insufficient.

Use the existing Contribution log for inspectable administrative history.
Enrollment issuance/revocation/consumption and membership records identify the
issuer/recipient truthfully; never label these as an agent contribution or
invent a session. If a narrow Contribution object type/action is needed,
document and implement it consistently across both stores and projections.
No invitation secret, token hash, raw credential, or pending request body goes
into Contribution payloads.

Enrollment does not extend Sprint 019's closed event vocabulary. Administrative
enrollment records must not automatically become webhook payloads.

## 9. Remote profile and recipient startup

Introduce an explicit local-versus-remote profile representation. Read existing
v1 local profiles compatibly. A remote profile holds endpoint, authenticated
human ID/name, selected workspace, and recipient-owned agent references; its
credentials remain in the private credential store. It has no required local
shared-state database path.

Normal human CLI operations use the remote profile without exported environment
variables or copied credential flags. Bind stored credentials to the canonical
endpoint, including its API base path, not merely its hostname. A documented
environment/flag override matching that endpoint may use the stored credential.
A different endpoint requires an explicitly supplied credential; without one,
reject before network activity. For example, /team-a and /team-b on the same
host are different credential destinations. Overrides do not rewrite the
enrolled profile. Apply this rule consistently to normal commands, up/Viewer,
doctor, handoff, and connection preparation, and reject redirects on their
credential-bearing requests. Preserve legacy explicit-credential override
behavior. MCP must not load the human profile credential as a fallback.

For a joined remote profile:

- `status`, `agents`, `decisions`, `changes`, and `inspect` read the
  actual authorized shared backend.
- `up` prepares recipient-owned harness connections and runs the local
  read-only Viewer proxy to the existing endpoint.
- Up does not open/bootstrap SQLite, bind a second shared API, or attempt to
  start a listener on the owner's machine. A non-loopback endpoint stays remote.
- Viewer retains existing read-only methods, loopback binding, and browser
  token isolation. The human token exists only in its local backend process.
- Doctor selects the agent token for the requested harness and checks the
  exact recipient identity, workspace, and supplied session. It remains read-only.
- Handoff names the recipient human and their selected agent, not merely the
  workspace's first owner or first participant with that harness.
- A fresh process recovers the same endpoint, participant, workspace selection,
  and harness-specific identity. It never re-redeems an invitation implicitly.

A preexisting unrelated local/remote profile, pending enrollment, or conflicting
Campfire harness block must not be silently replaced. Refuse before redemption
where detectable and show how to use the existing CAMPFIRE_CONFIG_DIR isolation
path and explicit harness config selection. Adoption/merging of arbitrary
existing identities, an account switcher, and multi-instance profile management
are outside this sprint. The accepted first path uses a fresh/isolated profile.

## 10. Connecting and adding the recipient's agents

At initial join, provision only the explicitly selected validated harnesses.
Prepare their existing adapters after credentials are safely stored. Each
harness receives its corresponding agent token, shared endpoint, and harness
label. It receives neither the human token nor another harness's token.

Connection must preserve unrelated settings, fail on ambiguity, and report
reload/new-process and approval requirements truthfully. Preparing a config
does not establish runtime readiness.

After joining, `connect --harness <supported> --enroll` may add the other
supported harness through a narrow authenticated application operation:

- The acting Human must have eligible membership in this workspace and existing
  authority to create their own agent and invite it under current rules.
- Core derives the agent's owning Human and team from the authenticated actor,
  not caller-supplied owner/team IDs.
- Provision that owned Agent, its prepared credential hash, explicit membership,
  Contributions, and request-bound receipt atomically.
- Use private pre-request credential preparation and exact replay as for initial
  enrollment. A retry or ordinary reconnect does not create duplicate agents.
- Reuse the recorded managed agent identity for that recipient/harness/workspace.
  Initial join and subsequent enrollment populate the same database-enforced
  unique slot keyed by enrolled Human, workspace, and harness. Two different
  simultaneous requests for that slot cannot each create an Agent.
- An occupied slot is recoverable only through its matching request/receipt or
  existing authenticated identity and locally held credential. A new request
  must not bind its newly prepared token hash to an existing slot, overwrite it,
  or return apparent connection success. Report an occupied-slot/reconnect
  action; complete credential loss requires explicit credential recovery.
  Do not impose a global one-agent-per-harness invariant on unrelated data.
- Existing connect without enrollment, reconnecting either harness, and remote
  up do not mint replacement identities or rotate credentials silently.

Limit this helper to the two supported connection slots needed by this journey.
It is not a generalized agent registry, delegated capability system, or arbitrary
identity-management API. The human's workspace membership still does not grant
an un-enrolled agent access.

## 11. Understanding, contribution, and return

Reuse current WorkspaceContext and CLI projections. A newly connected agent
must retrieve authorized state before editing or answering about the work.

The incoming experience must make these existing facts discoverable:

- workspace and current goal;
- accepted/proposed decisions and their rationale;
- open/in-progress/blocked work, ownership, and attention;
- findings and supporting artifact references;
- who contributed the relevant state and on whose behalf;
- a truthful next useful action or an explanation of missing context.

Readiness labels distinguish enrolled membership, prepared connection,
successful context retrieval, and an active registered session for contribution.
An agent can read before registration; it must explicitly call
`register_agent_session` for itself and this workspace before writing.
No join, up, connect, doctor, handoff, or read creates a session silently.

MCP instructions/help may be amended to point at this journey. Enrollment
secrets and administrative provisioning remain outside ordinary agent tools.

One useful contribution must use existing Finding, Task, Decision, or Artifact
semantics and preserve the actual AgentSession/owning Human. Do not write a
synthetic "joined successfully" finding to manufacture product value.

Artifact references must be meaningful to the recipient. In the real trace,
use a resource the recipient can independently access, such as an authorized
PR or shared document. A local path on the owner's machine is not proof that
the teammate received the artifact. No blob store or automatic fetching is added.

The original participant must subsequently retrieve and use the teammate's
contribution. Record what changed in their next action or what investigation
they avoided; storage presence alone is insufficient.

Return uses the same identities, fresh explicit sessions when needed, current
state, and existing caller-held cursors. Current change windows can truncate;
keep truncation visible and direct users to existing activity pagination when
necessary. Do not claim the cursor itself is a complete summary or add a new
checkpoint/read-receipt object.

## 12. Security, privacy, and failure truthfulness

Required properties:

1. Authorization precedes all workspace retrieval and mutation.
2. Invitation authority is limited to enrollment and never becomes an actor token.
3. Human/agent principals, owning Human, workspace, and sessions stay distinct.
4. Secret-bearing invitation, pending, credential, and harness config files use
   restrictive permissions and are excluded from version control/evidence.
5. Raw invitation/actor credentials never enter stdout, stderr, errors, URLs,
   shell arguments, Contributions, domain events, screenshots, Viewer resources,
   or final handoffs for the new journey. Transport credential headers and private
   local files are the deliberate secret-bearing boundaries.
6. Token hashes remain internal credential records, not user-visible provenance.
7. Before valid enrollment, failures reveal no workspace context or unrelated state.
8. File input is data only; validate schema/version, field sizes, endpoint, expiry,
   harness selection, and scope. Reject client attempts to escalate authority.
9. No shared database file, private session transcript, copied answer-bearing
   handoff, inviter credential, or harness session state is transferred.
10. Read-only actions do not mutate membership, mint credentials, repair setup,
    start remote infrastructure, or register sessions.
11. Failure reports distinguish network uncertainty, committed enrollment,
    local persistence, connection preparation, reload, context, and session.
12. Neither a Decision's accepted status nor suggestedNextAction grants external
    execution authority or guarantees human approval.

Use existing structured error conventions with stable recovery codes. Cover
invalid/expired/revoked invitation, claimed-by-another-request, unsupported file
version/harness, local profile conflict, endpoint unavailable, pending recovery,
config failure, reload required, and session required. Never include rejected
secret-bearing input in the error. Safe JSON receipts contain actual completion
facts and one next action; they do not return false readiness.

## 13. In scope

- Owner-issued, expiring, revocable new-person enrollment invitations.
- Protected invitation-file delivery and explicit recipient redemption.
- Atomic, request-bound initial enrollment and one additional supported owned
  harness slot, with safe retry/local recovery.
- Separate credentials/identities and explicit workspace memberships.
- SQLite/D1 migration, policy, service, transport, and persistence parity.
- Explicit remote profile/backend/startup support with local-profile compatibility.
- Reuse of existing Codex/OpenCode connections, read-only Viewer, diagnosis,
  context/attention/provenance, contribution, and return surfaces.
- Catalog/help/README/operator guidance and structured safe output.
- Deterministic failure/isolation/concurrency/rollback checks.
- A real two-human, two-machine reciprocal continuation trace.

## 14. Out of scope

- Hosting provisioning, production migration/deployment, managed multi-tenancy,
  SSO, verified email identities, SCIM, billing, or a general account recovery system.
- Automatic email/Slack delivery, public invitation pages, magic-login links,
  a writable/hosted Viewer, Electron, or a new onboarding web application.
- Arbitrary identity import/merging, multi-instance profile switching, or broad IAM.
- New harness adapters or unearned Claude Code/Cursor validation claims.
- Finding correction/freshness, decision supersession, bounded-context redesign,
  semantic retrieval, cross-workspace memory, or organizational learning.
- General mutation idempotency/versioning or a general concurrency framework.
  Enrollment-specific atomicity and retry safety remain mandatory.
- Presence, heartbeats, subscriptions, automatic transcript ingestion, automatic
  contributions, checkpoints, agent scheduling/delegation, or capability execution.
- Changes to decision approval semantics, external action policy, or event vocabulary.
- Required dependencies on other Boring Infra products.
- Claiming Gates B/C/F, broad adoption, retention, or PMF from a scored trace.

## 15. Deterministic and integration acceptance

Use isolated profile/home/config roots, databases, ports, and staged binaries.
Do not touch the developer's real identities, credentials, harness configuration,
normal Campfire database, or production instance.

### Authority and invitation

- Human owner can issue/revoke; agent, member, viewer, nonparticipant, and
  foreign-team principals cannot.
- Role/team/workspace/owner tampering cannot change stored invitation authority.
- Invalid, malformed, oversized, expired, revoked, unknown-version, or unknown
  invitations create nothing and disclose no work state.
- Invitation credentials fail ordinary API/MCP/Viewer authentication.
- Expiry/revocation and issuer eligibility are checked at claim commit.
- File permissions, no-overwrite behavior, endpoint validation, prefix handling,
  and loopback-test-only behavior are exercised.

### Provisioning and replay

- One or two selected harnesses create one Human, corresponding owned Agents,
  token hashes, explicit memberships, expected administrative history, and one
  consumed invitation; no workspace/goal/session is created.
- Injected provisioning failure rolls back every server row and consumption.
- Two different simultaneous claimants result in exactly one complete enrollment.
- Same-request retries, including concurrent exact retries, return the same IDs
  and receipt without duplicate tokens/history. Altered requests fail.
- Dropped response after commit, CLI restart, profile write failure, and harness
  write failure recover the original prepared identity.
- Recovery never recreates revoked credentials or rotates tokens implicitly.
- Adding the second owned harness has the same authority, atomicity, retry,
  ownership, and no-duplicate guarantees, including two different simultaneous
  request IDs competing for the same managed slot and a slot created at join.
  An occupied-slot failure installs no new credential and changes no history.
- Tests execute the real guarded SQL on SQLite and a D1-compatible path; record
  exactly which environment proves batching/rollback/concurrency behavior.

### Remote profile and connection

- Fresh remote profile routes normal reads/writes to the shared service without
  exported environment variables and creates no local collaboration database.
- Remote up proxies the authorized read-only journal and prepares selected
  harnesses without starting a shared API or remote listener.
- Existing local profiles, onboarding, up, legacy invite/join, and explicit
  overrides remain compatible.
- Conflicting profiles/config blocks fail without destructive replacement.
- Each harness gets only its own agent credential; unrelated settings survive.
- Doctor/handoff resolve the recipient and selected agent correctly, including
  two humans owning agents of the same harness.
- A new process recovers the same identities/workspace; unsupported harness
  enrollment is rejected before mutation.
- Endpoint override mismatches cannot send stored credentials to another host.
- A different API base path on the same host is also a mismatch. An explicitly
  supplied override credential is used without modifying the enrolled profile;
  redirect responses do not forward credentials.

### Continuation and isolation

- Incoming agent retrieves prior authorized work before acting.
- Read/diagnosis has no mutation; missing session still rejects agent writes.
- Registered-session contribution records correct Agent, session, owning Human,
  workspace, and provenance.
- Original participant reads the new contribution; unrelated workspace sentinels
  remain absent from context, outputs, Viewer, and contributions.
- Secret sentinels are absent from safe outputs, logs/errors, JSON receipts,
  Contributions, domain events, browser resources, and captured evidence.
- v1.8 output/catalog contracts and existing webhook behavior remain covered.

## 16. Real two-human acceptance trace

Use a packaged release candidate and an already provisioned reachable shared
instance. Two independently operating humans use separate machines and genuinely
different supported harnesses. One operator simulating two humans is a rehearsal,
not the required team trace.

1. Human A and Agent A perform real work in an existing workspace. Record a goal,
   evidence-linked finding, accepted decision with rationale, unresolved task/
   blocker, accessible artifact reference, and inspectable provenance. No hidden
   answer or simulated gate evidence is supplied to B.
2. A creates an invitation through the shipped owner surface. Transfer only the
   invitation file plus ordinary public installation information.
3. B joins from a fresh/isolated profile and selects their own harness. Installed
   help/setup guidance, not private repo instructions, must explain the journey.
4. B prepares/reloads the harness and opens the local Viewer. Required normal
   harness approvals/reload are recorded; hidden evaluator command repair fails
   the scored run.
5. B's cold agent receives a natural request, for example: "Help me understand
   this work, what the team decided, what is blocked, and take the next useful
   step." Do not supply tool sequences, expected findings, or A's transcript.
6. Before work, B's agent retrieves state and correctly identifies the intent,
   decision rationale, blocker, artifact, and relevant contributor. It explicitly
   registers its own session before a meaningful contribution.
7. A uses a fresh agent process and natural continuation request to retrieve B's
   contribution. Demonstrate a changed next action or avoided repeated work.
8. B restarts in a fresh process, reads intervening state with the same participant
   identity, and explicitly registers a fresh session if contributing again.
9. Separately rehearse a dropped enrollment response or local config failure and
   show recovery without duplicated actors or owner credential forwarding.

Repeat the packaged journey with Codex and OpenCode as recipient harnesses;
one reciprocal trace may use one as the origin and the other as recipient, but
configuration tests alone do not validate the second recipient connection path.

Capture exact Campfire/harness versions, runtime/store path, safe stage receipts,
wall time to useful context, interventions, approvals/reloads, operation order,
before/after actor/membership counts, session/provenance links, Viewer screenshot,
artifact accessibility, recovery behavior, and the concrete continuation outcome.
Redact/exclude private transcripts and credentials from the result/public artifacts.
Synthetic fixtures and same-machine rehearsals must be labeled accurately.

## 17. Evaluation and product measurements

Primary sprint pass: B joins existing work and contributes useful state; A uses
it; both can return with correct identity and authorization.

Record installation-to-first-useful-continuation time, enrollment/config recovery,
manual intervention count, orientation correctness, artifact access, and work
avoided. These are diagnostics; do not invent a timing threshold after the run.

Record Gate B and Gate C separately using the roadmap definitions:

- A prompted later process proves operability, not voluntary later-day return.
- A real contribution changing another participant's action is causal team-value
  evidence for this trace; do not generalize one pair to ordinary team retention.
- Qualifying voluntary later-day use may inform Gate B when independently observed.
- Reads, session registrations, and contribution counts alone do not prove value.

No new telemetry platform or private prompt collection is required. Use a small
trace diary and safe operational/provenance records. Preserve the historical
cancelled Field Trace 001 result rather than rewriting it as successful.

## 18. Validation and implementation sequence

Implement as vertical slices, preserving existing behavior:

1. Freeze invitation/recovery/profile contracts and write failing authority,
   atomicity, replay, remote-selection, and secret-isolation tests.
2. Add narrow domain/service/persistence operations and migrations for both stores.
3. Add authenticated issuance/revocation and isolated redemption transports.
4. Add protected pending credential preparation and recoverable CLI join.
5. Add remote profile selection and remote up/Viewer/doctor/handoff behavior.
6. Connect initial agents and the explicit additional-owned-agent enrollment path.
7. Complete understanding/contribution/return guidance and regression checks.
8. Package, rehearse failures, run real independent traces, review the complete
   diff, and record the result. Do not continue into adjacent roadmap work.

Required checks:

    npm run typecheck
    npm test
    npm run build
    npm run pack:tarball

During development run focused relevant suites. After the final full suite
passes, avoid redundant reruns without changed code/failures. Packaging must
exercise a clean isolated installation, catalog/help, profile recovery, and the
shared-endpoint journey. No test may require an unrequested production deployment.

Write `docs/SPRINT_020_RESULT.md` with implementation scope, contract deviations,
validation/environment details, migration/compatibility results, actual versus
synthetic evidence, two-human outcomes, recovery/secret-isolation checks,
remaining limitations, gate status, and verdict.

## 19. GO / CONDITIONAL GO / NO-GO

**GO:** The packaged product completes owner invitation, new teammate enrollment,
recipient-owned connection, correct orientation, explicit-session contribution,
reciprocal useful continuation, and fresh-process return. The independent
two-human/two-machine trace and both supported recipient paths pass. SQLite/D1
authority, guarded atomicity, exact replay, local recovery, secret isolation,
and compatibility checks pass. Viewer stays read-only and token-free. Evidence
claims remain appropriately limited.

**CONDITIONAL GO:** Deterministic and persistence/authority/privacy/recovery
checks pass and one real path succeeds, but an independent human, second
recipient harness, or real runtime trace is unavailable for a recorded external
reason. Mark those acceptance items incomplete. Do not substitute a founder
simulation or mocked D1 result, call the full journey proven, or treat this as
release-ready GO.

**NO-GO / REFRAME:** Invitation credentials become general actor authority;
recipient scope can be escalated; owner/other-agent credentials are forwarded;
a losing or rolled-back claim leaves partial identities/history; retries create
new participants or leak the winner's credentials; recovery loses the only
credential copy or silently resurrects access; remote profiles target local
state or send credentials to a conflicting endpoint; configuration is destroyed;
sessions are registered implicitly; the incoming participant needs a transcript,
prepared answer, or hidden operator repair; or reciprocal useful continuation
does not occur.

Security/authorization/atomicity failures must be repaired before GO and cannot
be waived as a normal conditional limitation. Do not silently reduce v1.9 to an
invite-file feature if the continuous experience fails.

## 20. Documentation and release boundary

During implementation update only what this slice changes:

- Architecture: enrollment capability, guarded provisioning, credential recovery,
  and remote local-proxy boundaries.
- README/operator/help: owner and recipient journeys, protected invitation
  transfer, remote startup, recovery, added harness, and compatibility.
- Roadmap: planned/implemented status and accurate evidence gates.
- AGENTS.md: active sprint pointer and completed result when appropriate.
- Public-release templates/allowlist and versioned release context: at promotion,
  accurately export the completed v1.9 behavior and exclude private evidence.

Product Definition and Vision already support this journey. Do not expand
their long-term scope unless implementation exposes a real semantic conflict.

Target v1.9.0 is a backward-compatible feature release, contingent on the result.
Implementation follows this contract; the current verdict and remaining
acceptance are in `docs/SPRINT_020_RESULT.md`. A candidate version does not
authorize public promotion, production migration, or deployment. Release
promotion remains a separate action under the user's authorization at that time.
