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
curl -fsSL https://boringinfra.company/campfire/v1.2.0/install.sh | sh -s -- --version 1.2.0
CAMPREFIX=~/.local sh install.sh --dry-run
```

The Worker serves only installer downloads from `public/` (see `wrangler.toml`
and `public/_headers`); its root page, `app.js`, `app.css`, and logomark are
not public Viewer routes. `npm run pack:tarball` creates the tracked
`public/campfire/vX.Y.Z/install.sh` file. Commit that versioned copy and deploy
it to Workers before its URL is live. The release workflow builds
platform tarballs (`campfire-{os}-{arch}.tar.gz` plus `.sha256`) from `dist/`
and attaches them to GitHub Releases. The installer verifies the SHA-256
digest before unpacking. A GitHub Release upload alone does not deploy the
versioned installer URL.

Reproducible install from a clean checkout (source path):

```bash
npm ci && npm run build && npm test
```

## Deploy (Workers + D1)

The public repo never contains a real D1 `database_id` — `wrangler.toml`
keeps the `00000000-…` placeholder so clones validate without secrets.

One-time provisioning (operator machine, never committed):

```bash
wrangler d1 create campfire   # save the returned id; `wrangler d1 list` to confirm
export CAMPFIRE_D1_DATABASE_ID=<id>   # local shell, or CI secret of the same name
# optional persistent local file instead of env (gitignored):
cp wrangler.example.toml wrangler.local.toml  # paste the id there
```

Repeatable release (CI or operator — id resolves env > `wrangler.local.toml`):

```bash
npm run db:migrate     # by database NAME; needs no id in the repo
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

`init` creates the database; `seed --reset` loads the deterministic fixture.
The first human may be created with no token (empty-human bootstrap); after
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
  Back up `.campfire/campfire.db` before upgrading binaries.
- `view --host` behavior is now explicit: loopback by default, `--allow-remote`
  required otherwise. Scripts binding `0.0.0.0` must add the flag.
