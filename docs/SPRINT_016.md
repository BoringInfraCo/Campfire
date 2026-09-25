# Campfire — Sprint 016: Agent-Led Setup & Human Handoff

**Status:** Complete (**CONDITIONAL GO**) — see `SPRINT_016_RESULT.md`
**Date:** September 25, 2026
**Company:** Boring Infra Co.
**Depends on:** Sprint 015 — Zero-to-Shared-Workspace Onboarding (**GO**);
published as `v1.3.0`
**Primary metric:** Prompt-to-Ready Handoff accuracy. A cold agent should be
able to turn a human's plain-language setup request into a verified Campfire
workspace and a working human Viewer without exposing credentials. Elapsed
time, tool-call count, and harness-side interventions are diagnostic; this
contract defines no pass/fail latency or zero-intervention threshold.

---

## 1. Sprint question

> Can a cold agent take a human's plain-language request, install Campfire,
> create and verify the shared workspace, prepare the correct MCP connection,
> and hand the human a working Viewer without exposing credentials?

Sprint 015 proved the underlying first-run product path. One command creates a
real Human, the Agent they own, a Workspace, an initial Goal, separate
credentials, and explicit membership. A fresh Codex process then registered an
Agent Session, passed preflight, and retrieved the correct context.

That proof still began after an operator had translated the product into
commands and prepared the harness connection. The ordinary user request is
closer to:

```text
"Set up Campfire for me and this agent, create a workspace for this work,
and show me where we can see it."
```

The desired path is:

```text
plain-language request
        ↓
agent installs or verifies Campfire
        ↓
campfire onboard --json
        ↓
agent starts campfire serve
        ↓
agent prepares the harness MCP connection
        ↓
fresh harness process registers a session
        ↓
one read-only readiness diagnosis passes
        ↓
agent starts campfire view
        ↓
human receives a safe URL + workspace summary
```

This is an agent-operated setup flow, not Campfire orchestration. The harness
still executes shell commands, edits its own supported configuration, manages
its process or terminal, and obtains any required human approval. Campfire
provides deterministic setup facts, readiness checks, shared state, and the
Viewer. It does not schedule agents, supervise runtimes, or hide permission
boundaries.

"Cold agent" means a new real harness process with no repository history,
private transcript, fixture answer, or undocumented Campfire knowledge. It may
receive the public install location, the human's requested names and Goal, and
normal permission to use its terminal and MCP tools.

"Working Viewer" means the existing read-only, loopback-bound team journal is
reachable and shows the created Workspace, Goal, Human, and Agent. It does not
mean a hosted browser product, writable dashboard, embedded harness panel, or
public URL.

This sprint improves setup usability and verifies the boundary. It does not
establish repeat usage, multi-participant value, retention, Gate B, Gate C, or
product-market fit.

---

## 2. Baseline audit

Audited after the `v1.3.0` release across onboarding, CLI, MCP, HTTP,
preflight, Viewer, operator documentation, and the Sprint 015 cold Codex trace.

| Question | Baseline |
| --- | --- |
| Can an agent install Campfire from the public distribution? | Yes, when its harness permits network and shell execution. The installer and pinned release path are live. |
| Can one command create the initial collaboration state? | Yes. `campfire onboard` creates one Human, one owned Agent, one Workspace, one Goal, invite, membership, and one-time credentials. |
| Is onboarding machine-readable? | Yes. `campfire onboard --json` returns stable IDs, credentials, the database path, and high-level next steps. |
| Can an Agent verify hosted readiness without mutation? | Yes. `preflight` checks endpoint, token, identity, Workspace access, and Agent Session readiness. |
| Can a real agent enter the new Workspace? | Yes. A fresh Codex process completed `whoami`, `register_agent_session`, `preflight`, and `get_workspace_context`. |
| Can the human inspect the same state? | Yes. `campfire view` presents the existing read-only Viewer and keeps the bearer token out of the browser. |
| Does Campfire provide exact, current setup material for each validated harness? | Not as one agent-consumable contract. The operator guide contains a generic MCP example; reload and approval behavior remain harness-specific. |
| Is there one setup diagnosis that reports every relevant boundary and next action? | Not yet. `preflight` covers the core remote boundary, but first-run diagnosis is spread across version, process, configuration, identity, session, and Viewer checks. |
| Has a complete prompt-to-Viewer flow been demonstrated in two real harnesses? | No. Sprint 015 proved fresh Codex entry after connection preparation. OpenCode was not given a second live onboarding trace. |

### Observed risks

- MCP cannot bootstrap a harness that has not yet been told how to launch the
  MCP server. Initial setup is necessarily CLI/terminal first and MCP second.
- Codex, OpenCode, and Claude Code do not share one configuration file or one
  reload/approval model. Harness-specific behavior must stay at the adapter and
  documentation boundary.
- Onboarding output contains one-time credentials. An agent must consume those
  facts without copying tokens into its final answer, logs, contributions,
  screenshots, or Viewer URL.
- A current agent may be able to prepare configuration only for a fresh or
  reloaded process. Requiring a human to approve tools or reload a harness is a
  truthful boundary, not a Campfire failure.
- Starting `serve` and `view` creates long-running processes. The harness owns
  those terminal processes; Campfire must not silently install daemons or
  pretend to supervise them.
- A generic "supports MCP" claim is weaker than a real setup trace. Only
  harnesses actually exercised by this sprint may be called validated for the
  prompt-to-Viewer path.

---

## 3. Smallest implementation

Build the smallest interface-layer slice that lets a capable agent discover
and complete the existing setup path. Reuse `onboard`, `serve`, MCP,
`register_agent_session`, `preflight`, context retrieval, and `view`. Do not
change collaboration semantics.

### A. Agent-readable setup contract

Provide one authoritative, installed setup contract that an agent can obtain
without cloning the private repository or reading historical sprint docs.
It must describe, in stable machine-readable form where appropriate:

- installed Campfire version;
- required onboarding inputs;
- the resolved database path;
- Human, Agent, Workspace, and Goal identifiers;
- the local server command and intended endpoint;
- the MCP command and required environment names;
- the Workspace ID needed for registration and preflight;
- the ordered Agent operations:
  `register_agent_session` → `preflight` → `get_workspace_context`;
- the Viewer startup command and expected loopback URL behavior;
- whether a harness reload or explicit approval is required; and
- the safe facts that belong in the final human handoff.

Prefer extending the existing onboarding receipt and installed CLI help over
creating a second setup model. Exact internal types are implementation details.
If a small setup-plan command is required, it must compose existing facts and
must not create domain state.

The contract must distinguish:

```text
operator credential  → human administration / Viewer backend
harness credential   → exactly one Agent harness process
public handoff        → no credential of either kind
```

### B. Harness-aware connection preparation

Add exact connection preparation for the two harnesses used in the acceptance
run: Codex and one genuinely different harness, preferably OpenCode. Claude
Code may substitute only if the result records why OpenCode could not run.

The implementation may use harness-native registration commands, generated
configuration fragments, or a narrowly scoped config writer, according to
what the real harnesses support. Whichever path the evidence selects must:

1. invoke the installed `campfire mcp` entrypoint;
2. supply `CAMPFIRE_URL`, the Agent-specific `CAMPFIRE_TOKEN`, and the correct
   `CAMPFIRE_HARNESS` value;
3. never use the Human token or a hosted actor-ID override;
4. keep harness-specific syntax outside the domain, service, authorization,
   store, and schema layers;
5. preserve unrelated harness configuration;
6. refuse ambiguous or unsupported configuration targets rather than guessing;
7. never print the token in generated instructions, logs, errors, or the final
   human handoff;
8. state truthfully when a reload or new harness process is required; and
9. remain useful when config application needs an explicit human approval.

Do not invent a universal harness abstraction. Implement only the adapters or
templates proven by the two real traces. Other harnesses may receive truthful
manual guidance, but must not be labeled validated by inference.

### C. One read-only setup diagnosis

Provide one user-facing diagnostic action for the agent-led path. The expected
public shape is:

```bash
campfire doctor <workspaceId> --harness <name> [--json]
```

If implementation evidence shows that extending `preflight` is materially
smaller while preserving its existing contract, amend this document before
changing the public command name. Do not maintain two divergent readiness
engines.

The diagnosis must be read-only and report deterministic status for:

- installed binary/version;
- local versus hosted backend mode;
- hosted endpoint reachability when configured;
- token authentication and resolved Actor type;
- expected Agent identity rather than Human identity;
- Workspace existence and authorization;
- configured harness identity;
- active Agent Session for the exact Workspace;
- `preflight` readiness;
- first context retrieval readiness; and
- one actionable next step for every failed check.

It may report that `register_agent_session` is required. It must not register a
session, repair configuration, mint credentials, start a process, or mutate the
Workspace. Do not expose raw remote error details that could contain a token.

### D. Safe human handoff and Viewer

After readiness passes, the setup agent must be able to launch the existing
loopback Viewer through the supported CLI and give the human a concise receipt
containing only:

- Campfire version;
- Workspace name and ID;
- Goal title;
- Human and Agent display names;
- readiness result;
- Viewer loopback URL;
- whether a harness reload or approval remains; and
- the next safe action.

The receipt must not contain bearer tokens, raw environment dumps, harness
configuration contents, private transcript text, or unrelated Workspace state.
The Viewer remains read-only and the browser remains token-free.

Campfire itself does not daemonize or supervise `serve` or `view`. In the cold
acceptance run, the harness may keep those commands alive in managed terminal
sessions and open the resulting URL for the human.

### E. Permission, reload, and failure truthfulness

The flow must surface external harness boundaries accurately:

- If shell, network, file-write, MCP, or browser actions require approval, ask
  for the smallest relevant approval and continue after it is granted.
- If the current harness cannot reload newly written MCP configuration, prepare
  it safely and tell the human that a reload or fresh process is required.
- Do not claim MCP readiness until a fresh/reloaded process can see Campfire and
  the read-only diagnosis passes.
- A declined approval or unavailable external binary is a recorded limitation,
  not permission to bypass safeguards.
- A rerun must not repeat onboarding against initialized state, overwrite
  unrelated config, mint replacement credentials, or launch duplicate
  long-running processes blindly.

### F. Documentation boundary

Update only the interface documentation required to make the flow discoverable:

- CLI usage/help;
- `README.md` agent-led setup section and harness status table;
- `docs/OPERATOR.md` connection, diagnosis, and Viewer handoff steps; and
- focused implementation comments where needed.

No Product Definition, Vision, or Architecture change is expected. The product
already defines humans and agents as participants, MCP as an interface, and
the Viewer as a human inspection surface. The roadmap and `AGENTS.md` may point
at Sprint 016 as the active contract.

---

## 4. Deterministic acceptance contract

Use temporary installation prefixes, data paths, ports, home/config roots, and
captured output. The automated suite must not modify the developer's real
harness configuration, normal Campfire database, shell profile, or browser
state.

Tests must prove:

1. the installed setup contract contains every required step and preserves the
   existing Sprint 015 onboarding state and identity boundaries;
2. Codex and OpenCode connection preparation use the same Campfire MCP
   entrypoint and the correct harness label without leaking syntax into the
   domain or service layers;
3. connection preparation selects the Agent token and never the Human token;
4. configuration generation/application preserves unrelated settings and
   fails closed for ambiguous, malformed, or unsupported targets;
5. any generated secret-bearing file has restrictive permissions and is
   excluded from captured evidence and version control;
6. connection preparation, diagnosis, handoff, help, errors, and logs contain
   no raw token; the existing explicit one-time `onboard` receipt remains the
   only allowed stdout/JSON credential-delivery boundary;
7. `campfire doctor` is read-only and gives deterministic pass/fail status plus
   a stable next-action code for every check;
8. an unreachable endpoint, missing token, wrong token, Human token, unknown
   Workspace, non-participant, harness mismatch, and missing Agent Session each
   fail at the correct boundary without unrelated state disclosure;
9. a valid Agent Session changes diagnosis from the expected missing-session
   state to ready without the diagnostic action performing that mutation;
10. the final human handoff contains only the allowlisted non-secret facts;
11. the Viewer remains loopback-bound, read-only, and token-free in the browser;
12. rerun behavior does not duplicate onboarding state or blindly overwrite
    config/processes; and
13. existing onboarding, bootstrap, identity, authorization, HTTP, MCP,
    Workers, Viewer, provenance, and transcript-isolation tests remain green.

Treat fake harness homes as deterministic adapter tests, not real-harness
evidence. Do not assert entire configuration files or prose walls when focused
behavioral assertions are sufficient.

---

## 5. Cold real-harness acceptance

Run from a clean temporary working directory and isolated harness config/home.
Use the published installer or a packaged release candidate. Do not provide the
private repository, implementation notes, credential values in the prompt, or
answers from an earlier trace.

### Human request

Give each setup agent only a natural request containing:

- the Human display name;
- the Agent display name;
- the desired Workspace name;
- the initial Goal; and
- permission to install and set up Campfire locally.

The prompt may include the public Campfire install URL. It must not list the
Campfire command sequence, MCP tool-call sequence, database path, expected IDs,
or evaluation answers.

### Setup Agent A — Codex

Codex must:

1. discover the installed setup contract;
2. install or verify the release;
3. onboard exactly once;
4. keep both credentials out of its conversation response and evidence;
5. start the server against the receipt's exact database path;
6. prepare a Codex MCP connection for a fresh/reloaded process;
7. register one Agent Session explicitly;
8. pass the setup diagnosis and retrieve context;
9. start the Viewer and confirm its read-only projection; and
10. hand the human the safe receipt and working loopback URL.

### Setup Agent B — independent harness

Repeat the same flow from another clean installation and isolated config using
OpenCode. Claude Code may substitute only if OpenCode is unavailable for a
documented external reason.

Agent B must not reuse Agent A's config, database, tokens, transcript, command
history, session, or generated answer. It must reach the same product outcome
through its own validated adapter path.

### Human verification

For each run, an evaluator with no credential access must be able to open the
provided Viewer URL and correctly identify:

- the Workspace;
- the Goal;
- the Human and Agent participants;
- that no work currently needs attention unless the setup intentionally added
  such state; and
- that the Viewer contains no bearer token or setup transcript.

### Evidence

Record:

- exact Campfire and harness versions;
- public/package source used;
- elapsed wall time by setup stage;
- tool and command counts;
- every human approval, reload, correction, or intervention;
- redacted diagnostic output;
- a Viewer screenshot with no secret-bearing UI or terminal content;
- config diff with values redacted and unrelated settings shown preserved;
- Workspace contribution counts before and after diagnosis; and
- explicit proof that raw tokens are absent from committed files, evidence,
  logs, final agent responses, screenshots, and Viewer resources.

Timing and intervention counts are diagnostic. A required, clearly explained
harness approval or reload does not fail the sprint. Hidden manual command
repair, copied credentials in chat, or evaluator knowledge that substitutes for
the installed setup contract does fail the scored trace.

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

- focused setup-contract, connection-adapter, diagnostic, rerun, and secret
  isolation tests;
- clean temporary-prefix install and version verification;
- clean `onboard --json` → serve → connection → session → diagnosis → context
  → Viewer rehearsals;
- real cold Codex and OpenCode (or documented Claude Code substitute) runs;
- Viewer visual inspection and screenshot;
- complete diff, config-preservation review, and secret scan; and
- `docs/SPRINT_016_RESULT.md` recording implementation, deviations, real versus
  deterministic evidence, timings, interventions, limitations, and the final
  GO decision.

Release tagging, public snapshot promotion, GitHub Release publication,
Cloudflare migration, and production deployment remain separate actions that
require explicit authorization after a GO result.

---

## 7. Acceptance criteria

Sprint 016 is complete only when:

- a cold agent can discover the supported setup path from the installed/public
  product rather than private repository knowledge;
- one plain-language request leads to exactly one real Human, Agent, Workspace,
  Goal, invite, and membership through the existing onboarding boundary;
- the setup agent prepares a correct MCP connection for a fresh or reloaded
  harness without confusing Human and Agent authority;
- Codex and one genuinely different real harness complete independent scored
  prompt-to-Viewer runs;
- required approvals and reloads are explicit and truthful;
- one read-only diagnostic action explains readiness and the next action across
  version, endpoint, identity, authorization, harness, session, and context;
- the Agent explicitly registers its session before ready state;
- the Agent retrieves the expected Workspace context without unrelated writes;
- the human receives a working loopback Viewer URL and a concise non-secret
  setup receipt;
- the Viewer shows the correct Goal and participants, remains read-only, and
  never receives a bearer token;
- no credential appears in agent responses, logs, errors, screenshots,
  committed files, Campfire contributions, or Viewer resources;
- rerun and failure behavior preserve existing Campfire and harness state;
- harness-specific behavior remains outside the core application and domain;
- no schema, migration, domain object, authorization expansion, daemon,
  hosted UI, or orchestration behavior is added;
- the full Node 22 validation matrix passes; and
- the result makes no Gate B, Gate C, retention, adoption, or PMF claim.

---

## 8. Non-goals

- Turning Campfire into an agent runner, scheduler, supervisor, delegation
  engine, or autonomous orchestrator.
- Automatically approving shell, network, MCP, browser, or file-write actions.
- Pretending a harness can hot-reload MCP configuration when it cannot.
- Building a universal plugin/configuration framework for every MCP client.
- Claiming Claude Code, Cursor, or an internal harness is validated without a
  real scored trace.
- Starting or installing `campfire serve` or `campfire view` as an operating
  system daemon, launch agent, container platform, or managed service.
- A hosted, public, multi-tenant, writable, or embedded Viewer.
- Viewer writes, onboarding wizard, desktop app, account system, email invite,
  billing, telemetry, or analytics.
- Cloudflare account provisioning, D1 creation, DNS, or production deployment.
- New collaboration objects, schema, migrations, roles, token authority,
  authorization policy, or cross-workspace retrieval.
- Transcript ingestion, agent chat, automatic Goal/Task inference, embeddings,
  semantic memory, notifications, capabilities, or controlled action.
- Replacing `campfire onboard`, `preflight`, MCP, or Viewer with a parallel
  setup system.
- Gate B/C, retention, revenue, external adoption, or PMF claims.
- Selecting or publishing a release version.

---

## 9. Rubric

### GO

From one natural-language request, fresh Codex and one independent real harness
each discover and complete the supported setup path on isolated installations.
Each produces exactly one valid shared Workspace, prepares a correct MCP
connection, explicitly registers an Agent Session, passes one read-only setup
diagnosis, retrieves the expected context, launches the read-only Viewer, and
hands the human a working loopback URL plus an accurate non-secret receipt.
All credentials remain absent from responses, evidence, logs, contributions,
screenshots, and Viewer resources; configuration and rerun boundaries remain
safe; deterministic and full validation pass.

### CONDITIONAL GO

The deterministic contract, secret isolation, configuration preservation,
diagnosis, packaged rehearsal, Viewer handoff, and one real cold harness run
pass, but the second real harness cannot complete because of a documented
external binary, credential, approval, or service limitation. Record the exact
boundary, label only the completed harness validated, and do not claim the
two-harness prompt-to-Viewer experience is proven.

### NO-GO / REFRAME

The flow requires private repository knowledge, fixture seeding, copied command
lists in the scored prompt, hidden evaluator repair, credential disclosure,
Human-token use by the Agent, actor-ID hosted auth, automatic session creation,
authorization bypass, destructive config overwrite, duplicated onboarding,
unexplained background processes, or a writable/token-bearing Viewer; the
diagnostic mutates state or gives false readiness; only one harness design is
generalized without evidence; or implementation expands into orchestration,
daemon management, hosted UI, schema/domain changes, or a generic harness
framework.

This document authorizes Sprint 016 implementation only. It does not authorize
a commit, push, release tag, public-repository promotion, production migration,
or deployment.
