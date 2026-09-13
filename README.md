# Campfire

**The shared workspace where people and their agents work together.**

Campfire is a secure, harness-independent collaboration layer for teams working with AI agents.

Today, useful context is often trapped inside individual human-agent relationships. One engineer may spend hours with Codex discovering how a system works, why an approach failed, or what should happen next. Another teammate using Claude Code, OpenCode, Cursor, or an internal agent often starts again from their own context boundary.

Campfire gives the team a durable place for the **work state that belongs to the team**.

> **Make agents work like they are part of the team.**

---

## The Problem

The dominant agent experience is still:

```text
Human A <----> Agent A <----> Session A

Human B <----> Agent B <----> Session B
```

Even when both people belong to the same team and both agents can access the same repository or company tools, the useful state accumulated while doing the work is fragmented.

Teams repeatedly reconstruct:

- what was discovered,
- what was attempted,
- what failed,
- what was decided,
- why a decision was made,
- what artifacts matter,
- what remains unresolved,
- and what should happen next.

Campfire changes the collaboration boundary:

```text
Human A + Agent A
        |
        v
     Campfire
  Shared Work State
        |
        v
Human B + Agent B
```

The second agent can continue from authorized team state without requiring the first human to forward a private transcript or manually prepare a handoff.

---

## What Campfire Stores

Campfire is built around **structured collaboration state**, not shared chat history.

A workspace can contain:

```text
Workspace
├── Goal
├── Participants
├── Tasks
├── Findings
├── Decisions
├── Artifacts
└── Contributions / Provenance
```

Example:

```text
Workspace: billing-deploy-failure

Goal
└── Determine why billing deployments are failing

Findings
├── Migration 284 introduces a long database lock
└── Deploy timeout occurs after 120 seconds

Decisions
├── Do not increase the global timeout
└── Split the migration into two phases

Tasks
├── [done] inspect deployment logs
├── [open] prepare migration fix
└── [open] review fix

Provenance
├── Codex / Sergio discovered migration lock
├── Alice confirmed previous incident pattern
└── Claude Code produced proposed fix
```

The conversations that produced those contributions can remain private.

The useful team state remains durable.

---

## Core Principles

### Shared work state, not shared transcripts

The unit of collaboration is the work produced by humans and agents, not every token exchanged while producing it.

### Humans and agents are distinct actors

Campfire preserves whether a contribution came from a person or an agent and, when applicable, which human the agent operated on behalf of.

### Workspaces are explicit boundaries

Context belongs to a piece of collaborative work rather than one universal company memory pool.

### Authorization precedes retrieval

Agents receive the team context they are permitted to access—not everything the organization knows.

### Provenance is first-class

Meaningful shared state retains who or what contributed it and when.

### Harnesses are clients

Campfire should work across Codex, Claude Code, OpenCode, Cursor, internal agents, and future harnesses.

### MCP is an interface, not the product

MCP provides a natural agent-facing interface. Campfire's durable value is the collaboration model and state underneath it.

---

## Architecture

The initial architecture is deliberately small:

```text
Agent Harness A -----+
                     |
Agent Harness B -----+----> MCP (stdio; local SQLite or CAMPFIRE_URL adapter)
                           |
                           v
                    Campfire Application
                           |
                     Authorization
                           |
                     Domain Model
                           |
                         SQLite

Hosted: CLI / MCP adapter --POST /v1/call--> HTTP server (Bearer token is
the actor) --> same application service. Viewer: loopback-only
read-only projection over the same backend (browser never holds a token;
non-loopback --host requires --allow-remote).
```

Core identity hierarchy:

```text
Organization
└── Team
    ├── Human
    │   └── Agent
    └── Workspace
```

Campfire's domain model remains independent of any individual agent harness.

---

## Sprint 001

The first sprint proves one behavior:

> **Can one human-agent relationship produce durable work state that another human and a different agent harness can use to continue the work?**

The reference flow:

```text
Human A + Agent A
        |
        | investigate
        | contribute finding
        v
     Campfire
        |
        | authorized retrieval
        v
Human B + Agent B
        |
        | continue work
        v
      Outcome
```

Sprint 001 succeeds only if Agent B can continue productively without receiving:

- Agent A's conversation transcript,
- a manually prepared summary,
- copied session state,
- or a prompt containing the answer.

The handoff must happen through Campfire's structured work state.

See [`docs/SPRINT_001.md`](docs/SPRINT_001.md) for the execution plan and
[`docs/SPRINT_001_RESULT.md`](docs/SPRINT_001_RESULT.md) for the acceptance
evidence and GO/CONDITIONAL GO/NO-GO recommendation.

---

## Running Campfire Locally

Requirements: Node.js 22+.

```bash
npm ci && npm run build && npm test
npm run typecheck
npm test                 # unit + integration + acceptance tests
npm run acceptance       # Sprint 001 deterministic two-harness run + evidence
npm run acceptance:002   # Sprint 002 real-harness run (requires Codex + OpenCode CLIs)
```

`npm run acceptance:002` invokes real vendor agent harnesses against real model
providers, so it is run explicitly rather than in the deterministic suite. It
writes `evidence/sprint-002/` and prints the acceptance checks and
recommendation. See [`docs/SPRINT_002_RESULT.md`](docs/SPRINT_002_RESULT.md).

The default SQLite database lives at `.campfire/campfire.db`. Override it with
`CAMPFIRE_DB=/path/to/campfire.db` or `--db <path>`.

### Developer CLI

Identity prefers `--token` / `CAMPFIRE_TOKEN`. Locally, `--actor` still works
(default `hum_sergio`, `--type human`). Override with `--session`, `--harness`,
and `--db`.

```bash
npx tsx src/cli/index.ts init
npx tsx src/cli/index.ts seed --reset          # deterministic fixture
npx tsx src/cli/index.ts whoami
npx tsx src/cli/index.ts list
npx tsx src/cli/index.ts show ws_billing_deploy
npx tsx src/cli/index.ts show ws_billing_deploy --json
npx tsx src/cli/index.ts show ws_billing_deploy --full
npx tsx src/cli/index.ts activity ws_billing_deploy --limit 20
npx tsx src/cli/index.ts create-workspace --team team_engineering --name living-workspace
npx tsx src/cli/index.ts update-workspace <workspaceId> --status completed
npx tsx src/cli/index.ts create-goal --workspace <workspaceId> --title "Ship the fix"
npx tsx src/cli/index.ts update-goal <goalId> --status completed
npx tsx src/cli/index.ts accept-decision <decisionId>
npx tsx src/cli/index.ts create-task --workspace <workspaceId> --title "CLI task"
npx tsx src/cli/index.ts add-finding --workspace <workspaceId> --summary "Deploy fails after the lock"
npx tsx src/cli/index.ts add-decision --workspace <workspaceId> --summary "Split the migration"
npx tsx src/cli/index.ts add-artifact --workspace <workspaceId> --type log --title "Failed deploy" --uri artifacts/deploy.log
npx tsx src/cli/index.ts update-task <taskId> --status in_progress --assignee-id <id> --assignee-type agent
npx tsx src/cli/index.ts create-human --name "Sergio" --team team_engineering
npx tsx src/cli/index.ts create-agent --name Codex --human hum_sergio --harness codex
npx tsx src/cli/index.ts issue-token --actor hum_sergio --type human
npx tsx src/cli/index.ts invite <workspaceId> --actor agt_opencode_alice --type agent --role agent
npx tsx src/cli/index.ts join <workspaceId>
```

`show` prints the orientation projection as readable text. `--json` dumps that
projection; `--full` uses the inspector (`get_workspace`) instead.

`create-human` / `create-agent` / `issue-token` print JSON including the raw
`token` field once. The first human may be created with no token when the
database has no humans.

### Hosted instance

One process owns the SQLite file. Other processes (CLI, MCP stdio) call it over
HTTP with an actor token. See [`docs/OPERATOR.md`](docs/OPERATOR.md).

```bash
npm run serve                                 # campfire serve --host 127.0.0.1 --port 9414
# or: npx tsx src/cli/index.ts serve [--host 127.0.0.1] [--port 9414]
npm run view                                  # campfire view --host 127.0.0.1 --port 9415
```

```text
POST /v1/call
Authorization: Bearer <token>
{ "method": "<mcp tool name>", "params": { ... } }
```

The bearer token is the actor. An actor id in the body is not trusted.

When `CAMPFIRE_URL` is set, the CLI and MCP stdio adapter POST `/v1/call` with
`CAMPFIRE_TOKEN` / `--token` and do not open the local database for writes.
When `CAMPFIRE_URL` is unset, behavior stays in-process SQLite. If
`CAMPFIRE_TOKEN` is set without a URL, local MCP/CLI resolve the actor from the
token and ignore `CAMPFIRE_ACTOR_ID`.

```bash
export CAMPFIRE_URL=http://127.0.0.1:9414
export CAMPFIRE_TOKEN=cft_fixture_hum_sergio
npx tsx src/cli/index.ts list
```

### Connecting a real agent harness over MCP

The MCP server identifies the acting actor from its process environment or
token, so a harness never passes (or can spoof) an actor id per call. Each
harness runs its own server process.

Local SQLite (Sprint 001):

```jsonc
{
  "mcpServers": {
    "campfire": {
      "command": "npx",
      "args": ["tsx", "src/mcp/stdio.ts"],
      "env": {
        "CAMPFIRE_DB": "/absolute/path/to/campfire.db",
        "CAMPFIRE_ACTOR_ID": "agt_codex_sergio",
        "CAMPFIRE_ACTOR_TYPE": "agent",
        "CAMPFIRE_HARNESS": "codex"
      }
    }
  }
}
```

Hosted HTTP adapter (no local SQLite writes):

```jsonc
{
  "mcpServers": {
    "campfire": {
      "command": "npx",
      "args": ["tsx", "src/mcp/stdio.ts"],
      "env": {
        "CAMPFIRE_URL": "http://127.0.0.1:9414",
        "CAMPFIRE_TOKEN": "cft_fixture_agt_codex_sergio",
        "CAMPFIRE_HARNESS": "codex"
      }
    }
  }
}
```

Harness B uses the same server with its own identity
(`CAMPFIRE_ACTOR_ID=agt_opencode_alice` locally, or its own `CAMPFIRE_TOKEN`
against `CAMPFIRE_URL`). Tools are short names (`list_workspaces`,
`get_workspace_context`, `add_finding`, `invite_workspace`, …) so a server
named `campfire` does not double-prefix in harness UIs. See
[`docs/SPRINT_003.md`](docs/SPRINT_003.md) and
[`docs/SPRINT_005.md`](docs/SPRINT_005.md).

---

## Roadmap

Campfire grows through evidence-backed stages:

```text
Cross-Agent Continuity
        ↓
Shared Team Workspaces
        ↓
Identity + Authorization
        ↓
Richer Collaboration
        ↓
Team Memory
        ↓
Organizational Memory
        ↓
Coordination + Capabilities
        ↓
Organizational Learning
```

The immediate priority is **continuity**.

Campfire should not prematurely become a generalized agent orchestration platform, universal memory system, or enterprise knowledge graph.

See [`docs/ROADMAP.md`](docs/ROADMAP.md).

---

## What Campfire Is Not

Campfire is not:

- a shared prompt library,
- transcript synchronization,
- a generic vector database,
- another agent harness,
- a replacement for GitHub,
- a replacement for Slack,
- a replacement for Linear,
- a multi-agent chat room,
- a general agent framework,
- or an orchestration engine.

Those systems may connect to Campfire.

Campfire owns the collaboration state that exists **across** humans, agents, harnesses, and organizational systems.

---

## Relationship to Boring Infra Co.

Campfire is part of the broader Boring Infra thesis that autonomous software agents need infrastructure for understanding, acting within, and learning from real software environments.

Other Boring Infra projects explore adjacent primitives:

```text
Combie
└── engineering context and relationships

Harnie
└── durable agent work state

Meno
└── verification state and evidence

Pico
└── authority, boundaries, and attack paths

Agent Observability
└── behavioral state, outcomes, loops, and recovery

Campfire
└── human + agent collaboration state
```

Campfire should remain independently useful.

Composition comes after each primitive proves itself.

---

## Documentation

The core product documents are:

```text
docs/
├── PRODUCT_DEFINITION.md
├── VISION.md
├── ARCHITECTURE.md
├── ROADMAP.md
├── SPRINT_001.md
├── SPRINT_001_RESULT.md
├── SPRINT_002.md
├── SPRINT_002_RESULT.md
├── SPRINT_003.md
├── SPRINT_004.md
├── SPRINT_004_RESULT.md
├── SPRINT_005.md
├── SPRINT_005_RESULT.md
├── SPRINT_006.md
├── SPRINT_006_RESULT.md
├── SPRINT_VIEWER_001.md
├── SPRINT_VIEWER_001_RESULT.md
├── SPRINT_VIEWER_002.md
├── SPRINT_VIEWER_002_RESULT.md
└── OPERATOR.md
```

Read them in roughly that order when deeper context is required.

---

## Current Status

Campfire is **1.0.0** (Sprint 006 complete).

- **001–002** continuity across harnesses. **GO** (deterministic fixtures;
  002 also ran real Codex + OpenCode harnesses — see `docs/SPRINT_002_RESULT.md`
  for exactly what was real vs synthetic).
- **003** orientation. **Partial:** deterministic exit met and in tree;
  real-harness orientation rerun and Claude Code coverage still outstanding
  (see `docs/SPRINT_003.md`).
- **004** living workspace. **GO** (Gate B product surface).
- **005** tokens, invite-only membership, `campfire serve`. **GO** (Stage B).
- **006** Gate C: a third human contributed on the hosted instance; a second
  harness continued from that state. **GO**. Week-long dogfood is not claimed.

See [`docs/SPRINT_006_RESULT.md`](docs/SPRINT_006_RESULT.md) and
[`docs/OPERATOR.md`](docs/OPERATOR.md).

**Viewer:** `campfire view` is a read-only team journal (loopback 127.0.0.1:9415
by default; non-loopback `--host` requires `--allow-remote`) over the
same backend as the CLI. Workstream is the page. No composer, no second store.
The browser never receives a token. History shows `showing latest N of total`
with an `older activity` affordance (paged via `before`/`nextBefore`), so
>50 contributions are not silently hidden.

---

## North Star

> **Make agents work like they are part of the team.**

The long-term goal is a world where a teammate can bring the agent they prefer, enter an authorized Campfire workspace, understand what the team already figured out, contribute useful work, and leave the organization with better shared state than it had before.

**The work that belongs to the team can belong to the team.**
