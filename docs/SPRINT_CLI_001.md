# Campfire — CLI-001: Agent-Native Interface Contract

**Status:** Complete (GO)
**Date:** September 28, 2026
**Company:** Boring Infra Co.
**Depends on:** Sprint 019 — Carry the Work Out (**GO**); `v1.7.1`
**Target release:** `v1.8.0` minor release; selected after the compatibility
audit and not yet tagged, published, or deployed
**Primary metric:** A human and a cold agent can independently inspect the same authorized workspace through the CLI and recover the same goal, current work, decisions, participants, and change cursor from one canonical structured result without reading Campfire internals or receiving invented live-agent state.

---

## 1. Sprint question

> Can the Campfire CLI become a first-class interface for both humans and
> agents by presenting the existing authorized workspace model through stable
> structured results and small, product-oriented commands?

Campfire already has the important architectural pieces:

- one application service shared by CLI, MCP, HTTP, and the Viewer;
- workspace-scoped authorization before retrieval;
- a compact `WorkspaceContext` projection;
- append-only Contributions and return cursors;
- human renderers for selected inspection commands;
- JSON output for every data-producing command;
- structured JSON failures under `--json`;
- agent session-start instructions over MCP.

The current CLI still exposes two different personalities. Its primary setup
and inspection commands are product-oriented, while much of its help surface is
a flat list of lower-level administration and mutation operations. Output
defaults are also mixed: some commands always emit JSON, while `show`,
`activity`, and `status` require an explicit flag for machine-readable output.

Most importantly, `campfire status` is currently a local-profile summary. It
does not retrieve the live authorized workspace projection, so it can be stale
or materially less useful than `get_workspace_context`.

CLI-001 makes the CLI a coherent Campfire client. It does not make the CLI the
Campfire control plane. Campfire Core remains the collaboration and
authorization boundary:

```text
                    Campfire Core
          authorization + structured work state
                         |
             +-----------+-----------+
             |           |           |
            CLI         MCP        Viewer
       human + agent    agent        human
```

---

## 2. Motivation and external signal

Cloudflare's September 28, 2026 launch of its new `cf` CLI is a useful external
signal: agents are becoming primary CLI users, and command consistency,
structured output, compact machine results, and command discovery should be
designed intentionally rather than added as flags after the fact.

Reference: [Introducing cf: the agentic CLI for the entire Cloudflare API](https://blog.cloudflare.com/cloudflare-cf-cli-launch/)

Campfire should adopt the relevant principle, not Cloudflare's scale or exact
implementation. Cloudflare needs search across thousands of API operations.
Campfire should keep a small conceptual surface over a bounded collaboration
model.

The Campfire-specific hypothesis is:

> If the CLI exposes the same authorized work state through stable structured
> results and human renderers, it becomes a universal fallback and automation
> surface for humans, agents, scripts, and CI without competing with MCP or
> creating a second product model.

---

## 3. Roadmap relationship

CLI-001 belongs to the existing **Make the Workspace Useful** work and supports
the Roadmap's transition toward a persistent operational workspace. It improves
inspection and orientation over state Campfire already owns.

It does not establish:

- Gate B repeat usage;
- Gate C ordinary multi-participant value;
- Gate D sophisticated authorization need;
- Gate F controlled action;
- Phase 4 participant presence;
- Phase 6 team memory;
- Phase 8 coordination or capabilities;
- adoption, retention, or product-market fit.

A successful CLI trace is interface evidence. It is not evidence that teams
voluntarily return to Campfire over time.

---

## 4. Architectural boundary

Campfire Core owns:

- workspace-scoped collaboration state;
- identity and participant membership;
- authorization before retrieval or mutation;
- lifecycle rules;
- Contributions and provenance;
- the canonical `WorkspaceContext` and `WorkspaceView` service projections.

The CLI owns:

- command discovery and argument parsing;
- workspace selection from authorized choices;
- command-specific read projections over service results;
- output-mode selection;
- human rendering;
- serialization of stable machine results;
- actionable, credential-safe recovery guidance.

The CLI must not:

- read SQLite directly for ordinary collaboration commands;
- reimplement authorization or lifecycle rules;
- infer work state from a private harness transcript;
- infer presence from an unended session;
- claim that an agent is `working`, `idle`, or `blocked` without a durable
  Campfire primitive that supports that statement;
- inspect files, processes, or proprietary harness state to manufacture an
  agent activity view;
- make a human rendering semantically richer than the corresponding structured
  result.

The dependency direction remains:

```text
CLI command
    |
CLI projection + renderer
    |
Application service / hosted HTTP client
    |
Authorization
    |
Domain + persistence
```

Local and hosted CLI use must produce equivalent command results for equivalent
authorized state.

---

## 5. Output contract

### 5.1 Output modes

CLI-001 introduces one explicit vocabulary:

```text
--output auto|human|json
```

`--json` remains supported as a compatibility alias for `--output json`.

Resolution order is:

1. explicit `--output`;
2. explicit `--json`;
3. `CAMPFIRE_OUTPUT` when set to a valid mode;
4. `auto`.

Supplying conflicting explicit modes is a validation error. The CLI does not
guess that a caller is an agent from its harness name, environment, process
tree, or terminal implementation.

Under `auto`:

- a dual-surface command uses the human renderer when stdout is a TTY;
- the same command emits JSON when stdout is not a TTY;
- an existing JSON-only data command remains JSON;
- `help` remains text;
- `mcp` remains MCP JSON-RPC on stdio;
- `serve`, `view`, and other long-running processes keep operational notices on
  stderr and do not acquire a synthetic result document.

TTY detection is presentation behavior only. It never changes identity,
authorization, retrieved fields, or mutation semantics.

JSON Lines is deferred until Campfire has a real streaming or high-volume
result that earns it.

### 5.2 Machine-output rules

For `--output json`:

- stdout contains exactly one valid JSON value and no wordmark, color, spinner,
  hint, or progress prose;
- output is compact by default so agents do not pay for decorative whitespace;
- operational notices go to stderr;
- failures retain the existing
  `{"error":{"code","message"[,"details"]}[,"next":[]]}` contract on
  stderr and exit non-zero;
- no result includes an actor token, operator token, webhook secret, raw
  webhook URL, private transcript, or unrequested unrelated workspace state;
- command-specific result shapes are tested as public contracts.

CLI-001 does not wrap every existing successful result in a new universal
envelope. That would break scripts without adding product semantics. New
read projections carry their own `version: 1` and `kind` fields. Existing
machine results remain compatible unless the compatibility audit explicitly
identifies and documents a required break.

### 5.3 Human-output rules

Human output is a renderer over the same command result returned by JSON mode.
It may change layout, labels, color, and whitespace. It may not add facts absent
from the structured result or omit warnings that materially change the meaning
of the result.

Color remains disabled when output is not a TTY or `NO_COLOR` is set.

---

## 6. Workspace resolution

The primary read commands need one consistent way to select a workspace.

Resolution order is:

1. explicit positional workspace id or `--workspace <id>`;
2. the workspace id in the local Campfire profile;
3. the sole workspace returned by authorized `list_workspaces`;
4. otherwise fail with an actionable, credential-safe list/select instruction.

An explicit workspace id is still authorized through the application service.
The CLI must not search an unscoped database or reveal whether an unauthorized
workspace exists.

The profile is a selector and local convenience record. It is not the source
of truth for workspace status, goal state, participants, tasks, decisions, or
activity.

---

## 7. Primary command surface

CLI-001 adds or regularizes a small read-oriented surface:

```text
campfire status [workspace] [--output auto|human|json]
campfire agents [workspace] [--output auto|human|json]
campfire decisions [workspace] [--output auto|human|json]
campfire changes [workspace] [--since <contributionId>] [--output auto|human|json]
campfire inspect <kind> <id> --workspace <workspaceId> [--output auto|human|json]
campfire activity [workspace] [--limit N] [--before <contributionId>] [--output auto|human|json]
campfire doctor ...
campfire handoff ...
campfire capabilities [--output json]
```

Existing lower-level commands remain available for compatibility. The default
help menu groups them under an advanced/administration section instead of
presenting every operation as an equally likely first action. Direct
`campfire <existing-command> --help` remains supported.

This sprint does not rename or remove existing commands.

### 7.1 `campfire status`

`status` becomes the live workspace overview. When a workspace is selected, it
retrieves authorized `WorkspaceContext` and builds one result containing:

- workspace id, name, and lifecycle status;
- current goal and goal status when present;
- human and agent participant counts;
- open, in-progress, and blocked-work summary available from the existing
  projection;
- proposed and accepted decision counts;
- `needsYou` and `needsAttention` counts and items;
- recent activity count and newest available contribution cursor;
- whether recent provenance was truncated.

It does not print the local database path as part of the workspace's product
status. Local diagnostics may expose that path through an explicitly
diagnostic command where appropriate.

When a local profile contains a human but no workspace, `status` returns an
explicit `awaiting_workspace` state. It does not invent a workspace or fail as
though the installation were corrupt.

Logical JSON shape:

```json
{
  "version": 1,
  "kind": "workspace_status",
  "workspace": {
    "id": "ws_...",
    "name": "billing deploy",
    "status": "active"
  },
  "goal": {
    "id": "goal_...",
    "title": "Ship the migration safely",
    "status": "active"
  },
  "participants": {
    "humans": 1,
    "agents": 2
  },
  "work": {
    "open": 1,
    "inProgress": 1,
    "blocked": 1
  },
  "decisions": {
    "proposed": 1,
    "accepted": 2
  },
  "attention": {
    "needsYou": [],
    "needsAttention": []
  },
  "activity": {
    "total": 14,
    "newestContributionId": "contrib_...",
    "truncated": false
  }
}
```

The exact field spelling is finalized in tests before implementation. The
semantics above are required.

### 7.2 `campfire agents`

`agents` is a workspace participant roster filtered to agent actors. It may
show only facts Campfire durably knows:

- agent id and name;
- participant role;
- harness when recorded;
- human owner id when recorded;
- joined timestamp.

It must not label an agent `online`, `idle`, `working`, `blocked`, or `dead`.
An agent session with no `endedAt` is not sufficient evidence of live presence.
No heartbeat or presence model is added in this sprint.

### 7.3 `campfire decisions`

`decisions` is a read projection of the existing decision lifecycle. It groups
or filters proposed, accepted, and superseded decisions without introducing a
new approval model.

It preserves ids, summaries, rationale when authorized and recorded, status,
timestamps, and existing provenance fields. Decision acceptance remains a
Campfire lifecycle transition, not permission for an external action.

### 7.4 `campfire changes`

`changes` is a product-oriented projection over existing Contribution and
`show --since` behavior. It does not create a second event log.

With `--since`, it returns Contributions strictly after the supplied cursor,
preserves existing validation for unknown or foreign-workspace cursors, states
whether the result was truncated, and returns the cursor the caller should
retain for the next request.

Without `--since`, it returns the existing bounded recent provenance window and
the newest available cursor. It does not claim to be a Git diff or report files
an agent touched unless those files were recorded as Campfire Artifacts or
Contribution payload data.

Logical JSON shape:

```json
{
  "version": 1,
  "kind": "workspace_changes",
  "workspaceId": "ws_...",
  "fromCursor": "contrib_...",
  "toCursor": "contrib_...",
  "items": [],
  "truncated": false
}
```

When there are no changes after a valid cursor, `items` is empty and
`toCursor` remains that valid cursor.

### 7.5 `campfire inspect`

`inspect` is explicit rather than magical:

```text
campfire inspect workspace <workspaceId>
campfire inspect agent <agentId> --workspace <workspaceId>
campfire inspect goal <goalId> --workspace <workspaceId>
campfire inspect task <taskId> --workspace <workspaceId>
campfire inspect finding <findingId> --workspace <workspaceId>
campfire inspect decision <decisionId> --workspace <workspaceId>
campfire inspect artifact <artifactId> --workspace <workspaceId>
campfire inspect contribution <contributionId> --workspace <workspaceId>
```

Except for the workspace itself, object inspection requires the workspace id.
The CLI retrieves that authorized workspace and selects the object from the
existing full projection. It does not scan every workspace, infer an object's
workspace from an unauthorized global index, or add generic cross-workspace
lookup.

An inspected agent is still a static participant record, not a live process
inspection.

### 7.6 `campfire capabilities`

`capabilities` returns the CLI's command manifest. It is command discovery, not
the future Campfire Capability domain object.

To prevent terminology confusion, its JSON `kind` is `cli_command_manifest`
and its help text explicitly says that it describes installed CLI operations.

The manifest includes, at minimum:

- manifest version;
- installed Campfire version;
- command name;
- one-sentence description;
- usage;
- whether it reads or mutates Campfire state;
- whether it is workspace-scoped;
- supported output modes;
- related commands where useful.

`capabilities` performs no semantic or natural-language search. `campfire find`
is deferred until command count or observed agent failures justify it.

---

## 8. Command catalog and help

CLI command metadata currently lives primarily in help definitions while
dispatch behavior lives elsewhere. CLI-001 introduces one typed CLI command
catalog as the source for:

- command recognition;
- primary vs advanced help grouping;
- usage and short descriptions;
- mutability classification;
- workspace-scoping metadata;
- supported output modes;
- the `capabilities` manifest.

The catalog does not become a generalized schema generator and does not move
business logic into CLI metadata. It does not generate the MCP server in this
sprint. MCP tools remain thin adapters over the same application service.

Tests must fail when a dispatched CLI command is absent from the catalog or a
catalogued command has no dispatch path.

The default help experience emphasizes the conceptual product surface:

```text
Start and connect
  campfire
  campfire up
  campfire setup
  campfire connect

Understand the workspace
  campfire status
  campfire agents
  campfire activity
  campfire changes
  campfire decisions
  campfire inspect

Recover and hand off
  campfire doctor
  campfire handoff

Discover the CLI
  campfire capabilities
  campfire help [command]

Administration
  ...existing create/update/invite/token/bridge commands...
```

This is progressive disclosure, not command removal.

---

## 9. Agent guidance

Campfire already provides MCP session instructions and an agent-readable setup
contract. CLI-001 updates those existing surfaces only as needed so an agent
can discover the CLI fallback:

```text
To inspect Campfire from a shell:
  campfire capabilities --output json
  campfire status --output json
```

The guidance stays small. It does not teach Campfire architecture or enumerate
every mutation.

CLI-001 does not automatically create, append to, or rewrite a repository's
`AGENTS.md`. A future explicitly requested export command may produce a snippet,
but repository mutation is not part of this sprint.

---

## 10. Compatibility requirements

Before changing defaults, implementation must inventory the current command
matrix and record for every command:

- current stdout behavior;
- current stderr behavior;
- current exit status;
- current `--json` behavior;
- whether output is documented as machine-readable;
- whether the command is long-running or protocol-owned.

Required compatibility rules:

1. `--json` continues to work wherever it works today.
2. Existing command names and arguments remain accepted.
3. Existing successful JSON field semantics do not change silently.
4. Existing structured error envelopes remain accepted.
5. Token, profile, local/hosted, and single-writer behavior remain unchanged.
6. `serve`, `view`, and `mcp` keep their existing stdout/stderr protocol
   boundaries.
7. A documented output-default change is allowed only where `--output human`
   restores the prior human rendering and automated tests cover the change.
8. Release classification is chosen from the completed audit, not assumed in
   advance.

Whitespace compaction in explicit JSON mode is not a semantic breaking change,
but snapshot and installer documentation must not rely on indentation.

---

## 11. In scope

- A typed CLI command catalog.
- `--output auto|human|json` and the `--json` compatibility alias.
- Machine-output stdout/stderr and exit-code discipline.
- Live, authorized `campfire status` built from `WorkspaceContext`.
- Workspace resolution rules shared by the primary read commands.
- `agents`, `decisions`, `changes`, explicit workspace-scoped `inspect`, and
  `capabilities` commands.
- Human renderers derived from the same structured command results.
- Primary vs advanced help grouping.
- Small updates to existing setup/MCP guidance for CLI discovery.
- Local SQLite/listener and hosted HTTP behavioral parity.
- Unit and integration contract tests.
- One cold-agent CLI-only read trace and one human-terminal trace.
- README/help/release documentation required by the implemented behavior.

---

## 12. Out of scope

- A `Huddle` domain object or persistence table.
- Treating “huddle” as anything more than possible future product language for
  a view of an existing Workspace.
- Checkpoints or a `campfire checkpoint` mutation.
- Agent presence, heartbeats, liveness, idle/working state, or process control.
- Tracking which file an agent is currently editing.
- Importing Git status, harness transcripts, terminal history, or private model
  state to enrich CLI output.
- Agent scheduling, delegation, orchestration, or automatic task execution.
- Natural-language command search or `campfire find`.
- JSON Lines or streaming output.
- Shell completion generation.
- A generated CLI/MCP/HTTP SDK framework.
- A TypeScript configuration format.
- New collaboration objects, database tables, SQLite migrations, or D1
  migrations.
- Changing workspace authorization, roles, or token semantics.
- Replacing MCP as the primary in-harness agent interface.
- Automatically editing repository `AGENTS.md` files.
- Removing or renaming existing low-level CLI commands.
- Claiming repeat use, multi-participant value, presence, coordination, or PMF.

---

## 13. Implementation areas

The implementation should remain concentrated at the interface boundary.
Expected areas are:

- `src/cli/help.ts` or a replacement typed command catalog;
- `src/cli/index.ts` command parsing, workspace resolution, and dispatch;
- `src/cli/ui.ts` human renderers and TTY behavior;
- small CLI-focused projection/output modules if they reduce rather than add
  duplication;
- `src/mcp/instructions.ts` and the existing setup contract only for the tiny
  CLI discovery hint;
- `tests/unit/cli.test.ts` and focused new CLI contract tests;
- integration coverage for hosted parity;
- README and release documentation when implementation is accepted.

The following should remain untouched unless an acceptance test demonstrates a
hard requirement:

- domain object definitions;
- SQLite and D1 schemas;
- authorization rules;
- Contribution semantics;
- DomainEvent/outbox semantics;
- Viewer behavior;
- MCP tool semantics.

No new runtime dependency is expected.

---

## 14. Acceptance tests

### Output selection

- `--output json` emits one compact valid JSON value on stdout.
- `--json` produces the same value as `--output json`.
- conflicting explicit output flags fail with a structured validation error.
- `CAMPFIRE_OUTPUT` is honored below explicit flags.
- `auto` selects human rendering for a dual-surface command on a TTY and JSON
  when stdout is not a TTY.
- JSON contains no ANSI escape, wordmark, spinner, or progress prose.
- `NO_COLOR` continues to disable human color.
- `help`, `mcp`, `serve`, and `view` preserve their documented protocol
  behavior.

### Canonical projection parity

- Human and JSON modes for each new read command are produced from the same
  command result object.
- Local and hosted calls over equivalent state return semantically equivalent
  results.
- A profile with stale goal or workspace labels cannot override live service
  state.
- A profile containing only a human produces `awaiting_workspace` without
  creating state.
- An explicit unauthorized workspace is denied before state crosses the
  boundary.
- Ambiguous workspace selection fails with an actionable selection instruction
  and reveals only authorized workspace summaries.

### Command semantics

- `status` includes the current workspace, goal, work, decision, attention, and
  cursor facts required in section 7.1.
- `agents` lists recorded agent participants and never emits an ungrounded live
  state label.
- `decisions` preserves proposed, accepted, and superseded distinctions.
- `changes --since` returns only Contributions strictly after the cursor.
- an empty valid delta retains the supplied cursor;
- unknown and foreign-workspace cursors fail without leaking rows;
- `inspect` requires a workspace for non-workspace objects and cannot retrieve
  an object from another workspace;
- `capabilities` exactly matches the installed command catalog;
- every catalogued command has a dispatch path and every dispatched command is
  catalogued.

### Security and privacy

- No primary read result contains an actor token, operator token, webhook
  secret, raw webhook URL, private transcript sentinel, or unrelated workspace
  sentinel.
- Human mode does not reveal fields absent from JSON mode.
- Hosted mode continues to require the existing actor credential.
- CLI command discovery does not expose future Capability grants or imply that
  an installed command is authorized for the current actor.

### Regression

- Existing command names, `--json`, help-by-command, and structured failures
  remain compatible.
- Existing MCP, HTTP, Viewer, onboarding, continuation, lifecycle, bridge, and
  installer tests pass.
- `npm run typecheck` passes.
- `npm test` passes.
- Existing acceptance tests pass without relying on a TTY.

---

## 15. Manual and real traces

### Human terminal trace

Using a real local Campfire listener and seeded or freshly created authorized
workspace:

1. Run `campfire status` in a TTY.
2. Run `campfire agents`, `campfire decisions`, and `campfire changes`.
3. Inspect one decision and one Contribution with an explicit workspace.
4. Confirm the output is concise, readable, credential-safe, and consistent
   with the Viewer and `show --json`.
5. Pipe each dual-surface command to another process and confirm `auto` emits
   valid JSON with no presentation text.
6. Repeat the read path against `CAMPFIRE_URL` and confirm equivalent meaning.

### Cold-agent CLI-only trace

Use one real supported agent harness in a fresh session with Campfire MCP tools
disabled for the trace and the installed `campfire` binary on `PATH`.

The prompt names Campfire and the information needed, but does not name a CLI
subcommand:

> Use the installed Campfire CLI to report the current workspace goal, blocked
> work, accepted decisions, participating agents, and everything recorded after
> contribution `<cursor>`. Do not mutate Campfire and do not read its database
> directly.

The agent must:

1. discover commands through `campfire --help` or
   `campfire capabilities --output json`;
2. select only an authorized workspace;
3. use machine-readable CLI output;
4. identify the requested state accurately;
5. retain and report the returned resume cursor;
6. perform no mutation;
7. make no claim about live agent presence or current file editing;
8. receive no private transcript or hidden answer in the prompt.

Record the harness, prompt, commands invoked, outputs with secrets redacted,
result accuracy, and observed failure/recovery behavior. This proves CLI
discoverability and interface usability only; it is not Gate B or Gate C.

---

## 16. GO / CONDITIONAL GO / NO-GO

**GO:** The new primary commands are backed by existing authorized service
projections; `status` reflects live state rather than stale profile facts;
human and JSON output derive from one result; explicit JSON is compact and
clean; `auto` behaves deterministically; existing `--json` and command
contracts remain compatible; local and hosted semantics match; the command
catalog drives help and discovery; the human trace and cold-agent trace pass;
all tests pass; no presence, huddle, checkpoint, orchestration, or new domain
model is introduced; no Gate B/C/F or PMF claim is made.

**CONDITIONAL GO:** The structured contract, live status, compatibility, and
security tests pass, but either hosted parity, the human renderer, or the
cold-agent trace remains incomplete. Record the missing evidence. Do not claim
the CLI is a proven first-class surface for both humans and agents, and do not
begin checkpoint, presence, or command-search work.

**NO-GO:** Human and JSON modes can disagree semantically; `status` still uses
stale profile state as truth; machine output mixes prose with JSON; a command
bypasses authorization or reads SQLite directly; workspace resolution leaks an
unauthorized workspace; existing scripts lose `--json` compatibility without
an explicit release decision; `agents` invents presence or file activity;
`changes` creates a second history model; `inspect` performs unscoped
cross-workspace discovery; CLI metadata becomes a second business-logic layer;
the implementation adds Huddle, Checkpoint, presence, orchestration, or a
generic schema-generation platform; or the result claims product adoption from
an interface trace.

---

## 17. Canon and documentation impact

This sprint is an interface-contract refinement over existing collaboration
semantics. The proposed document does not by itself change Product Definition,
Vision, Architecture, or Roadmap.

If CLI-001 is implemented and accepted:

- `README.md` and CLI help must document the primary command surface and output
  rules;
- `AGENTS.md` must point to CLI-001 while it is active and later record its
  result;
- release notes must state any output-default change and compatibility impact;
- `docs/ARCHITECTURE.md` changes only if implementation evidence changes the
  interface boundary rather than merely using it;
- `docs/ROADMAP.md` changes only to record sequencing/result evidence;
- Product Definition and Vision remain unchanged unless implementation evidence
  changes product semantics.

This proposed document does not authorize implementation, commit, push,
release tagging, public-repository promotion, or deployment.
