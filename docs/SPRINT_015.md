# Campfire — Sprint 015: Zero-to-Shared-Workspace Onboarding

**Status:** Complete (**GO**) — see `SPRINT_015_RESULT.md`
**Date:** September 25, 2026
**Company:** Boring Infra Co.
**Depends on:** Sprint 014 — Trust the Operator Path (**GO**); `v1.2.1`
released and deployed
**Primary metric:** Time to First Shared Workspace. A cold operator should be
able to move from an installed Campfire binary to one real, authorized
human-and-agent workspace without demo fixtures, undocumented commands, or
manual identifier plumbing.

---

## 1. Sprint question

> Can a first-time operator create a real Campfire team, human identity,
> agent identity, shared workspace, initial Goal, credentials, and usable
> harness connection through one understandable setup path?

Sprint 014 proved that Campfire can be installed, migrated, deployed, and
upgraded through the documented operator path. The clean-install smoke still
used `seed --reset`, which loads a deterministic demonstration workspace. It
did not prove that a new operator can create their own first shared workspace.

The production primitives already exist, but the operator must currently
assemble them manually:

```text
init / bootstrap organization and team
        ↓
create first human + retain one-time token
        ↓
create agent + retain a different one-time token
        ↓
create workspace
        ↓
create Goal
        ↓
invite agent
        ↓
join as agent
        ↓
start campfire serve
        ↓
configure harness URL + agent token + harness name
        ↓
register agent session
        ↓
preflight + retrieve workspace context
```

Each operation is individually available and tested. Their composition is not
yet a coherent first-run product experience. This sprint closes that gap
without changing the collaboration model.

"Zero" means a clean Campfire data path after installation. It does not mean
provisioning Cloudflare, opening a public multi-tenant account, installing an
agent harness, or discovering organization policy automatically.

"Shared workspace" means one human owner and one attributable agent are both
participants in a workspace with an explicit Goal. It does not claim a second
human, repeat usage, external team adoption, Gate B, Gate C, or PMF.

---

## 2. Baseline audit

Audited after the `v1.2.1` release across the CLI, bootstrap module,
application service, authorization boundary, MCP, HTTP, operator guide, and
existing readiness tests.

| Question | Baseline |
| --- | --- |
| Can a blank data path initialize automatically? | Yes. Runtime startup applies the SQLite schema; `campfire init` exposes it explicitly. |
| Can organization and team records be created without fixtures? | Yes. `campfire bootstrap` idempotently creates the configured organization and team. |
| Can the first human be created safely? | Yes. Empty-human bootstrap is the only tokenless identity creation path; it returns a one-time human token. |
| Can a human create an attributable agent? | Yes. `create-agent` requires a human owner and returns a separate one-time agent token. |
| Can the human create a Workspace and Goal? | Yes. Existing service operations create both with contribution provenance. |
| Can the agent become a participant? | Yes. The human invites it and the agent joins with the invite's `agent` role. |
| Can hosted readiness be checked? | Yes. `preflight` validates URL, token, identity, membership, workspace, and active agent session without mutation. |
| Does preflight repair a missing session? | No, deliberately. The agent must explicitly call `register_agent_session`. |
| Is there a single first-run path for all of the above? | No. README quick start uses `seed --reset`, and the operator guide requires manual IDs and many separate commands. |
| Is a schema or new collaboration object required? | No. The required state and authorization semantics already exist. |

### Observed onboarding risks

- `seed --reset` is useful for evaluation but is not a real user's workspace.
- Raw IDs must be copied between multiple JSON responses and commands.
- Human and agent tokens are easy to confuse even though they carry different
  identities and authority.
- The agent must be invited and joined; a human's membership must not be
  inherited implicitly by their agent.
- Local and hosted modes are easy to mix accidentally. A hosted harness needs
  `CAMPFIRE_URL` plus the agent-specific token, never an actor-id override.
- Readiness still requires explicit session registration. Onboarding must not
  weaken Sprint 007 by silently registering a future harness session.
- A rerun must not mint duplicate identities, credentials, or workspaces into
  an already initialized installation.

---

## 3. Smallest implementation

Add one deterministic, non-interactive CLI onboarding action over the existing
bootstrap and application-service operations. The expected public shape is:

```bash
campfire onboard \
  --human-name "Sergio" \
  --agent-name "Codex" \
  --harness codex \
  --workspace-name "billing deploy" \
  --goal "Ship the billing migration safely"
```

Exact internal function names are implementation details. The user-facing
command name and flags above are the contract unless implementation evidence
shows a concrete conflict that requires amending this document first.

### A. One setup composition, existing semantics

On a clean Campfire data path, the command must:

1. ensure the configured Organization and Team exist through the existing
   bootstrap behavior;
2. create the first Human through the existing empty-human bootstrap boundary;
3. create one Agent owned by that Human with the supplied harness label;
4. create one active Workspace owned by the Human;
5. create one active Goal in that Workspace;
6. invite the Agent with role `agent` as the Human owner;
7. consume that invite as the Agent so membership is explicit;
8. return the resulting IDs and the human and agent bearer tokens exactly once;
9. report the resolved absolute database path so server startup cannot silently
   select a different working-directory database; and
10. provide the next steps for `campfire serve`, harness configuration,
   `register_agent_session`, `preflight`, and first context retrieval.

The composition must use existing service and authorization behavior. It must
not insert collaboration rows directly, impersonate an actor, grant membership
without an invite, or treat the Agent as the Human.

The initial Workspace contains only the supplied Goal and the provenance
earned by setup. Do not manufacture demo Findings, Decisions, Tasks,
Artifacts, or success claims.

### B. Fail closed on non-clean state

The command is a first-run path, not a general workspace template or bulk
provisioner.

- Validate required input before durable mutation.
- Refuse an installation that already contains user identity or workspace
  state, with an actionable message directing the operator to the granular
  `create-*`, `invite`, and `join` commands.
- Do not add `--force`, reset, deletion, overwrite, merge, or best-effort
  duplicate behavior.
- A validation failure must not mint a token or leave a partial onboarding
  workspace.
- A second invocation after success must fail clearly and leave counts and
  state unchanged.

If composing the existing service calls cannot prevent partial state for an
observed failure path without a large refactor, stop and amend the contract.
Do not add a generic workflow engine or distributed transaction abstraction.

### C. One-time credential receipt

The successful command must make the identity boundary unmistakable:

```text
human token  → operator CLI / administration
agent token  → exactly one harness process
```

Default output should be a concise human-readable onboarding receipt.
`--json` must return the same facts through a stable machine-readable object.
Both may contain the newly minted raw tokens because they are the existing
one-time credential delivery boundary.

The command must not:

- write raw tokens to a tracked file, shell profile, harness config, log, or
  Campfire contribution;
- echo tokens in errors;
- put the human token in the agent configuration;
- put actor IDs in hosted authentication configuration; or
- claim that a copied example placeholder is a usable credential.

Next-step examples may refer to "the agent token printed above" rather than
repeating it. Documentation and tests must treat captured onboarding output as
secret-bearing.

### D. Explicit runtime boundary

Onboarding prepares durable state; it does not launch or daemonize Campfire.
The operator explicitly starts:

```bash
CAMPFIRE_DB=<resolved path from receipt> campfire serve
```

The harness explicitly receives:

```text
CAMPFIRE_URL
CAMPFIRE_TOKEN   (agent token)
CAMPFIRE_HARNESS
```

The Agent explicitly calls `register_agent_session`, then `preflight`, then
`get_workspace_context`. This preserves the existing session-provenance and
readiness boundaries. No session is pre-created, inferred, or repaired by the
onboarding command.

### E. Documentation boundary

Replace the fixture-led primary quick start with the real onboarding path.
Keep `seed --reset`, but label it as a deterministic demo/evaluation fixture.

Update only:

- CLI usage/help;
- `README.md` quick start and command table;
- `docs/OPERATOR.md` first-run section; and
- focused implementation comments where needed.

No Product Definition, Vision, or Architecture change is expected. This sprint
exposes the existing product model more coherently; it does not redefine it.

---

## 4. Deterministic acceptance contract

Use temporary data paths and captured output. No production database,
Cloudflare mutation, GitHub mutation, or live third-party harness credential is
required for the deterministic suite.

Tests must prove:

1. a clean data path plus the required flags creates exactly one Organization,
   Team, Human, Agent, Workspace, Goal, invite, and Human/Agent participation;
2. the Human owns the Workspace and the Agent joins with role `agent`;
3. the Agent references the created Human as its owner and retains the supplied
   harness label;
4. the Workspace Goal exactly matches operator input;
5. invite, join, Workspace, and Goal contribution provenance records the
   correct actor types and IDs;
6. the human token resolves only to the Human and the agent token resolves only
   to the Agent;
7. neither token appears in stored objects, contributions, logs, or errors;
8. default output clearly distinguishes credentials and next steps;
9. `--json` exposes stable IDs, identity types, workspace/goal state,
   the resolved database path, one-time tokens, and non-secret next-step metadata;
10. missing or invalid required input fails before mutation;
11. a rerun or non-clean installation fails without changing state or minting
    additional credentials;
12. the command does not create an Agent Session;
13. a hosted Agent is not preflight-ready before explicit session
    registration, then becomes ready after registration; and
14. existing bootstrap, identity, token, invite, authorization, CLI, HTTP,
    MCP, Workers, Viewer, and transcript-isolation tests remain green.

Do not assert exact prose beyond the security and next-action semantics. Test
the receipt as data and behavior, not as a brittle wall of copy.

---

## 5. Cold acceptance flow

Run from a clean temporary directory with a packaged or built Node 22 binary.
Do not use `seed`, an existing Campfire database, the operator's normal data,
or hidden repository knowledge.

### Operator setup

A cold operator receives only:

- the install command or already installed binary;
- `campfire onboard --help`; and
- a short statement of the workspace and Goal they want.

They must be able to:

1. run the onboarding command once;
2. identify the Human, Agent, Workspace, and Goal that were created;
3. correctly identify which token belongs to the operator and which belongs to
   the harness;
4. start `campfire serve`; and
5. configure a fresh harness without an actor-id override or transcript copy.

Record elapsed wall time and operator interventions as diagnostic evidence.
Do not invent a pass/fail latency threshold before observing the baseline.

### Agent entry

A fresh real harness process receives only the generated connection facts and
the Workspace ID. It must:

1. resolve as the created Agent;
2. register a session for the exact Workspace;
3. pass `preflight`;
4. retrieve the Workspace context;
5. name the Goal and both participants correctly; and
6. make no unrelated write.

The test passes without access to repository setup notes, another agent's
transcript, fixture answers, or the human token.

Use one supported real harness for the scored setup proof. A deterministic
Codex/OpenCode parity test is sufficient for the other supported harness
unless the first trace reveals harness-specific onboarding behavior.

### Security countercheck

Verify separately that:

- swapping the human and agent tokens resolves the wrong identity and is
  detectable rather than silently accepted;
- an actor ID without the bearer token cannot authenticate remotely;
- an unregistered Agent session fails preflight with the existing actionable
  next step; and
- an unrelated or uninvited actor cannot retrieve the Workspace.

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
```

Also require:

- focused onboarding CLI tests;
- a clean temporary-prefix install/onboard/serve smoke;
- default and `--json` receipt review with token-safe redaction in evidence;
- explicit-session preflight and context retrieval;
- rerun/non-clean fail-closed verification;
- one cold real-harness entry trace;
- complete diff and secret scan; and
- a result document recording implementation, deviations, evidence, timing,
  interventions, and the GO decision.

Release tagging, public snapshot promotion, GitHub Release publication, and
production deployment remain separately authorized actions after a GO result.

---

## 7. Acceptance criteria

Sprint 015 is complete only when:

- a first-time operator can create a non-fixture shared Workspace through one
  documented onboarding command;
- Human and Agent identities, ownership, credentials, membership, and
  provenance remain distinct and correct;
- the initial Goal is durable and visible through normal context retrieval;
- no manual ID chaining is required during initial state creation;
- the receipt clearly separates operator and harness credentials;
- no token is persisted or leaked outside the explicit one-time output;
- rerun and non-clean-state behavior fail closed without duplicates or reset;
- server startup and Agent Session registration remain explicit;
- a fresh real harness reaches ready state and retrieves the correct Workspace
  using only the onboarding output;
- fixture seeding is no longer presented as the primary real-user quick start;
- no schema, migration, domain object, authorization rule, hosted control
  plane, or orchestration behavior is added;
- the full Node 22 validation matrix passes; and
- the result makes no Gate B, Gate C, retention, adoption, or PMF claim.

---

## 8. Non-goals

- Interactive terminal UI, browser setup wizard, desktop application, or
  writable Viewer.
- Starting, daemonizing, supervising, or installing `campfire serve` as a
  system service.
- Automatic harness-file discovery or writing Codex/OpenCode/Claude/Cursor
  configuration files.
- Automatic Agent Session creation or preflight repair.
- Adding a teammate, second human-agent pair, email invitation, notifications,
  or account recovery.
- Cloudflare account provisioning, D1 creation, DNS, SaaS signup, billing, or
  a hosted multi-tenant control plane.
- New schema, migrations, domain objects, roles, token semantics, or
  authorization policy.
- Workspace templates, project import, repository scanning, GitHub sync, or
  automatic Goal/Task inference.
- Transcript ingestion, summaries, embeddings, cross-workspace memory,
  orchestration, delegation, capabilities, SSO, or SCIM.
- Product analytics or durable onboarding telemetry.
- Release version selection or automatic `v1.2.2` publication.
- External design-partner, Gate B, Gate C, retention, revenue, or PMF claims.

---

## 9. Rubric

### GO

One documented command creates the real first Human, attributable Agent,
Workspace, Goal, credentials, invite, and memberships on a clean installation.
Its one-time receipt leads a cold operator and fresh real harness through
explicit server startup, session registration, preflight, and correct context
retrieval with no manual ID plumbing, credential confusion, fixture data,
secret leakage, or unrelated writes. Deterministic and full validation pass.

### CONDITIONAL GO

The deterministic onboarding state, security boundaries, and packaged smoke
all pass, but the cold real-harness entry cannot run because of an external
harness credential or service issue. Record the limitation and do not claim
Time to First Shared Workspace has been proven end to end.

### NO-GO / REFRAME

Onboarding requires demo seeding, direct database writes, authorization
bypass, implicit Agent membership, silent session creation, token persistence,
manual ID chaining, destructive reset, a new schema/domain model, or hidden
operator knowledge; a rerun duplicates state; the generated connection path
cannot reach preflight/context; or the implementation expands into hosting,
orchestration, templates, integrations, or a general workflow engine.

This document authorizes Sprint 015 implementation only. It does not authorize
a release, public-repository promotion, production migration, or deployment.
