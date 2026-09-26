# Operator runbook

Requirements: Node.js 22+.

Install the CLI on an operator or teammate machine (curl path):

```bash
curl -fsSL https://boringinfra.company/campfire/install.sh | sh
```

Pinned / explicit variants (the versioned URL works after the Workers asset
deploy; `--help` for all flags; env equivalents
`CAMPREFIX`, `CAMPFIRE_VERSION`, `CAMPFIRE_URL`):

```bash
curl -fsSL https://boringinfra.company/campfire/install.sh | sh -s -- --version 1.0.0
curl -fsSL https://boringinfra.company/campfire/v1.5.0/install.sh | sh -s -- --version 1.5.0
CAMPREFIX=~/.local sh install.sh --dry-run
```

The Worker serves only installer downloads from `public/` (see `wrangler.toml`
and `public/_headers`); its root page, `app.js`, `app.css`, and logomark are
not public Viewer routes. `npm run pack:tarball` creates the tracked
`public/campfire/vX.Y.Z/install.sh` file. Commit that versioned copy and deploy
it to Workers before its URL is live. The release workflow builds
platform tarballs (`campfire-{os}-{arch}.tar.gz` plus `.sha256`) from `dist/`
and attaches them to GitHub Releases. The installer verifies the SHA-256
digest before unpacking. A `latest` install reports the version stored in
the installed package metadata (for example `1.5.0`), not the word `latest`.
A pinned `--version` refuses the archive before replacing an existing install
when package metadata differs. A GitHub Release upload alone does not deploy
the versioned installer URL.

Reproducible install from a clean checkout (source path):

```bash
npm ci && npm run build && npm test
```

## First shared workspace

After install, run `campfire` in a terminal. That records the human once.
The suggested name comes from `git config user.name` or the login. It does
not ask for an agent, a workspace, or a goal. Credentials are stored under
`$CAMPFIRE_CONFIG_DIR` or `~/.config/campfire` (credentials mode 0600).
`campfire up` starts the local API and Viewer in this process and connects
each installed Codex or OpenCode as an agent that human owns. It says plainly
that past sessions are not imported. It does not register an agent session
and does not provision Cloudflare. The agent creates the workspace and goal
when work starts. A second workspace is a normal `create_workspace`.

```bash
campfire
campfire up
```

Agents and scripts keep flags:

```bash
campfire onboard \
  --human-name "Sergio" \
  --agent-name "Codex" \
  --harness codex \
  --workspace-name "billing deploy" \
  --goal "Ship the billing migration safely" \
  --json
```

`--json` prints each credential once. Human-mode onboard does not. The human
token is for the operator CLI and administration. The agent token is for
exactly one harness process. Do not put an actor id in hosted auth.

`campfire up` writes a Codex or OpenCode MCP block for each harness it
finds. A second harness is another connection, not another wizard. Tokens
are stored locally and are not printed. Reload the harness so tools appear.
The agent calls `register_agent_session` before creating a goal, then
`preflight`, then reads workspace context. The Viewer lists workspaces that
exist. With none yet, it says it is waiting for an agent to start work.

A second onboard refuses when humans or workspaces already exist and points at
`create-human`, `create-agent`, `create-workspace`, `create-goal`, `invite`,
and `join`. There is no reset flag.

`campfire seed --reset` stays available. It loads a deterministic
demo/evaluation fixture. It is not how a new operator creates their
workspace.

## Deploy (Workers + D1)

The public repo never contains a real D1 `database_id` — `wrangler.toml`
keeps the `00000000-…` placeholder so clones validate without secrets.
`$CAMPFIRE_D1_DATABASE_ID` wins over gitignored `wrangler.local.toml`. Both
`npm run db:migrate` and `npm run deploy` run `scripts/wrangler-deploy.mjs`
and fail locally, before Wrangler starts, when the id is missing, the
placeholder `00000000-0000-0000-0000-000000000000`, or
`REPLACE_ME_WITH_OUTPUT_OF_WRANGLER_D1_CREATE`; a database name alone does
not bypass the committed placeholder, while `npm run deploy:dry-run` stays
usable with that placeholder when no real id is set.

One-time provisioning (operator machine, never committed):

```bash
wrangler d1 create campfire   # save the returned id; `wrangler d1 list` to confirm
export CAMPFIRE_D1_DATABASE_ID=<id>   # local shell, or CI secret of the same name
# optional persistent local file instead of env (gitignored):
cp wrangler.example.toml wrangler.local.toml  # paste the id there
```

Repeatable release (CI or operator — id resolves env > `wrangler.local.toml`):

```bash
npm run db:migrate     # same wrapper as deploy; fails closed without a real id
npm run deploy:dry-run # validates with the placeholder when no id is set
npm run pack:tarball   # builds release/campfire-{os}-{arch}.tar.gz + .sha256
npm run deploy         # injects the real id via an ephemeral --config; deploys public/ assets
gh release create …    # publish matching platform assets; install.sh verifies SHA-256
```

Versioned installer files are tracked in git; keep the generated
`public/campfire/vX.Y.Z/install.sh` in the release commit before the Workers
deploy. Verify the versioned URL, each published tarball/checksum pair, and a
clean installation from the release. Packaging on an operator machine builds
only that machine's platform; the release workflow builds the supported
platform assets on their respective runners. Keep the `vX.Y.Z` script and
published release tag aligned.

The Worker/D1 entrypoint provides remote state and bearer-token API routes
plus installer downloads. It does not serve a hosted browser journal;
`campfire view` is the supported read-only Viewer path on loopback. This remote
deployment slice is not evidence of the roadmap's full hosted-team Stage C
gate.

`wrangler dev` always uses the placeholder (D1 simulated locally).

One process owns SQLite. CLI and MCP call it over HTTP with an actor token.

## 1. Initialize

`campfire onboard` (above) creates the first workspace. The source-checkout
commands below are the granular path. `seed --reset` loads the deterministic
demo/evaluation fixture; it is not how a new operator creates their workspace.

```bash
npx tsx src/cli/index.ts init
npx tsx src/cli/index.ts seed --reset
npx tsx src/cli/index.ts create-human --name "Sergio" --team team_engineering
```

`create-human` / `create-agent` / `issue-token` print the raw token once.

## 2. Serve

```bash
npx tsx src/cli/index.ts serve --host 127.0.0.1 --port 9414
```

## 3. Point CLI at the host

```bash
export CAMPFIRE_URL=http://127.0.0.1:9414
export CAMPFIRE_TOKEN=<token from issue-token>
npx tsx src/cli/index.ts whoami
npx tsx src/cli/index.ts list
```

The bearer token is the actor. Do not set `CAMPFIRE_ACTOR_ID` against HTTP.

## 4. Invite teammates and their agents

Workspace creator is owner. Everyone else is invited.

```bash
npx tsx src/cli/index.ts create-workspace --team team_engineering --name billing-deploy
npx tsx src/cli/index.ts create-human --name "Alice" --team team_engineering
npx tsx src/cli/index.ts create-agent --name Codex --human <humanId> --harness codex
npx tsx src/cli/index.ts issue-token --actor <id> --type human
npx tsx src/cli/index.ts invite <workspaceId> --actor <id> --type human --role member
npx tsx src/cli/index.ts invite <workspaceId> --actor <id> --type agent --role agent
# invited actor, with their token:
npx tsx src/cli/index.ts join <workspaceId>
```

## 5. MCP for Codex and OpenCode

Each harness process uses `CAMPFIRE_URL` and that actor's `CAMPFIRE_TOKEN`.
Do not put `CAMPFIRE_ACTOR_ID` on the hosted adapter.

```jsonc
{
  "mcpServers": {
    "campfire": {
      "command": "npx",
      "args": ["tsx", "src/mcp/stdio.ts"],
      "env": {
        "CAMPFIRE_URL": "http://127.0.0.1:9414",
        "CAMPFIRE_TOKEN": "<agent token>",
        "CAMPFIRE_HARNESS": "codex"
      }
    }
  }
}
```

OpenCode uses the same server with its own token and `CAMPFIRE_HARNESS=opencode`.

## Agent-led connection and handoff

`campfire setup` prints the installed setup contract. It creates no rows and includes no credential. After `campfire onboard`, prepare one harness:

```bash
campfire connect --harness codex --config <codex-config.toml> --url http://127.0.0.1:9414 --token <agent-token> --workspace <workspaceId>
campfire connect --harness opencode --config <opencode.json> --url http://127.0.0.1:9414 --token <agent-token> --workspace <workspaceId>
```

`connect` writes only the Campfire MCP entry, preserves unrelated settings, stores the agent token in that file, and does not print the token. Codex and OpenCode need a reload or a new process before the tools appear. The harness may require approval. Other harnesses are refused rather than guessed.

`campfire doctor <workspaceId> --harness <name>` checks version, identity, workspace access, harness, session, preflight, and context. It does not register a session, look up an existing session, or change the workspace. A hosted doctor process cannot see the MCP process's in-memory session. Capture the id returned by `register_agent_session` and pass it with `--session <sessionId>` or `CAMPFIRE_SESSION_ID`. `--session` wins when both are set. Without that id, doctor asks for `register_agent_session_then_pass_session` and does not claim the session is missing. When the next action is `start_campfire_view`, start the journal and hand the human the loopback URL. Leave the session id and both tokens out of that handoff:

```bash
CAMPFIRE_DB=<absolute path> campfire view
campfire handoff <workspaceId> --harness <name> --viewer-url http://127.0.0.1:9415 --token <agent-token>
```

The handoff lists the version, workspace, goal, participant names, readiness, and Viewer URL. It does not include a bearer token. `campfire serve` and `campfire view` stay in the terminal that started them. Campfire does not install them as daemons.

## 6. Humans contribute without a harness

```bash
npx tsx src/cli/index.ts show <workspaceId>
npx tsx src/cli/index.ts show <workspaceId> --since <contributionId>
npx tsx src/cli/index.ts add-finding --workspace <workspaceId> --summary "..."
npx tsx src/cli/index.ts create-task --workspace <workspaceId> --title "..."
npx tsx src/cli/index.ts add-decision --workspace <workspaceId> --summary "..."
npx tsx src/cli/index.ts accept-decision <decisionId>
npx tsx src/cli/index.ts update-task <taskId> --status in_progress
```

Pass `--since <contributionId>` to print only the contributions recorded
strictly after that observation, a `truncated` flag when older post-cursor rows
were omitted, and the newest contribution id to retain as the next cursor. The
cursor is an observation pointer; it is not a summary of the changes and not
permission to execute.

## 7. Do not

- Copy the SQLite file between machines or teammates.
- Send an actor id in HTTP bodies or set `CAMPFIRE_ACTOR_ID` on the host.
- Paste private transcripts into another session. Contribute structured state.

## Viewer

Read-only loopback inspector. Same backend as the CLI (`CAMPFIRE_URL`+token or local SQLite). The browser never receives the token.

```bash
npx tsx src/cli/index.ts view --host 127.0.0.1 --port 9415
```

Loopback only (`127.0.0.1`, `::1`, `localhost`). A non-loopback `--host`
is refused unless `--allow-remote` is passed explicitly — the Viewer serves
with the operator's authority, so remote binds are opt-in. Writes
(`add_finding`, `update-task`, …) are rejected with 403.

Viewer boundary: the page shows titles/summaries, never raw object ids
unless no title/summary exists, and history is labeled
`showing latest N of total` with an `older activity` affordance — nothing
past the first 50 is silently hidden.

## First-run bootstrap

The installed first workspace is `campfire onboard` (see "First shared
workspace"). `init` creates an empty database. `seed --reset` loads the
deterministic demo/evaluation fixture; it is not how a new operator creates
their workspace. There is no onboard reset flag. The first human may still
be created with no token on an empty database (empty-human bootstrap); after
that, `create-human` requires a human actor and `issue-token` mints the raw
token printed once:

```bash
npx tsx src/cli/index.ts init
npx tsx src/cli/index.ts create-human --name "Sergio" --team team_engineering
npx tsx src/cli/index.ts issue-token --actor <id> --type human
```

## Token revocation

Tokens are bearer credentials. Revoke a compromised token with
`revoke_token` (a human may revoke their own tokens or tokens of agents
they own); revoked tokens are rejected with `Unauthorized`. Then issue a
replacement and give each harness process only its own actor's token.

## Upgrade notes

- SQLite file upgrades run through versioned `schema_migrations` at startup.
  Back up the SQLite file (`CAMPFIRE_DB`, `$CWD/.campfire/campfire.db`, or
  `~/.local/share/campfire/campfire.db`) before upgrading binaries.
- `view --host` behavior is now explicit: loopback by default, `--allow-remote`
  required otherwise. Scripts binding `0.0.0.0` must add the flag.
