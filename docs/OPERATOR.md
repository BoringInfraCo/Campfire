# Operator runbook

Requirements: Node.js 22+.

The source tree targets v1.10.0. The v1.9.3 telemetry patch keeps telemetry schema version 1
and writes one Analytics Engine index, the event name. The seven dimensions
and the installation id are blobs. v1.9.2 sent seven indexes, so those writes
were rejected and stored nothing. The versioned installer in this tag matches
the v1.9.2 script. The independent two-human acceptance trace remains pending;
see `SPRINT_020_RESULT.md` for that verdict.

Install the CLI on an operator or teammate machine (curl path):

```bash
curl -fsSL https://boringinfra.company/campfire/install.sh | sh
```

Pinned / explicit variants (the versioned URL works after the Workers asset
deploy; `--help` for all flags; env equivalents
`CAMPREFIX`, `CAMPFIRE_VERSION`, `CAMPFIRE_URL`):

```bash
curl -fsSL https://boringinfra.company/campfire/install.sh | sh -s -- --version 1.0.0
curl -fsSL https://boringinfra.company/campfire/v1.8.0/install.sh | sh -s -- --version 1.8.0
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
the installed package metadata (for example `1.8.0`), not the word `latest`.
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

Once a workspace exists, `campfire status` prints the live, authorized
overview: goal, work counts, decisions, participants, attention, and the
newest contribution cursor. The local profile only selects the workspace; it
is not the source of truth. Output follows `--output auto|human|json`:
`auto` renders text on a TTY and JSON when piped, `--json` is a compatibility
alias for `--output json`, and `CAMPFIRE_OUTPUT` sets the default. Explicit
JSON is one compact value on stdout; failures are structured JSON on stderr
and exit 1. Read output adds no tokens; only the credential-minting commands
(`onboard --output json`, `issue-token`, `create-human`, `create-agent`, and
`bootstrap --human-name`) can print a one-time token, and `onboard` requires
explicit `--json` or `--output json` for its credential receipt so a pipe
cannot capture tokens by default.

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

`--json` prints each credential once. Human-mode onboard does not. Because the
receipt carries one-time credentials, `onboard` stays human under `auto` even
when piped: a non-interactive onboard without `--json` or `--output json`
prints the token-free human receipt, and only an explicit JSON request emits
the one-time receipt. The human
token is for the operator CLI and administration. The agent token is for
exactly one harness process. Do not put an actor id in hosted auth.

`campfire up` writes a Codex or OpenCode MCP block for each harness it
finds. A second harness is another connection, not another wizard. Tokens
are stored locally and are not printed. Reload the harness so tools appear.
The session instructions tell the agent to call `list_workspaces` and
`get_workspace_context` before it builds, and to call
`register_agent_session` before a goal, finding, decision, task, artifact,
or workspace update. Process start does not register a session. The Viewer
lists workspaces that exist. With none yet, it says it is waiting for an
agent to start work. When the harness MCP block points at loopback and
nothing is listening, that session starts the same API and Viewer as
`campfire up` and leaves that process owning the database. A later session
reuses it. A reboot clears it. A non-loopback URL is not started from the
session.

A second onboard refuses when humans or workspaces already exist and points at
`create-human`, `create-agent`, `create-workspace`, `create-goal`, `invite`,
and `join`. There is no reset flag.

## Enroll a new teammate into existing work

The instance must already be provisioned, reachable over HTTPS, and running
the candidate API/schema. Invitation creation does not provision hosting or
expose a local service. The owner uses their existing human credentials for
that exact endpoint; another-machine invitations cannot use the owner's
localhost URL. A path prefix such as `/campfire` is supported.

An authenticated human owner of the active workspace runs:

```bash
campfire invite-teammate <workspaceId> --out ./alice.invitation.json
# Optional expiry override, from 1 through 168 hours:
campfire invite-teammate <workspaceId> --out ./bob.invitation.json --expires-in-hours 48
```

The file is written with mode 0600, never silently replaces an existing file,
and contains an expiring enrollment secret. Transfer it through a private
channel of your choice. Campfire sends no message or email. Possession grants
one new-person enrollment; a display name is not verified email/account identity.
The receipt reports safe metadata, not the secret, in both human and JSON output.

On the teammate's machine:

```bash
campfire join --invitation-file ./alice.invitation.json \
  --human-name "Alice" --harness opencode
campfire status
campfire up
```

To select both validated harnesses, repeat `--harness codex --harness opencode`.
The endpoint and workspace come from the invitation. Do not pass a workspace,
URL, or actor token override. Review the declared endpoint before submitting
the credential-bearing invitation. Only an explicitly enabled loopback HTTP
exception is available for same-machine developer tests; it is not a remotely
usable workspace.

Join creates the recipient's human identity and supported owned agent identities,
token hashes, explicit memberships and administrative history in one guarded
server operation. The recipient CLI prepares and stores raw actor credentials
locally; the server stores their hashes. No Goal, Workspace or AgentSession is
created. Each harness configuration contains only its own agent token.

The saved remote profile makes normal CLI reads use the shared backend without
exported environment variables. Remote `up` prepares the enrolled connections
and serves the read-only Viewer on local loopback; it does not open SQLite,
run another shared API, or start a process on the owner's machine. Reload or
restart each harness and approve its normal tool access. Preparing configuration
does not prove that a harness has retrieved context. Incoming agents read before
acting and explicitly register their own sessions before contributing.

To add the other supported harness or reapply an existing connection:

```bash
campfire connect --harness codex --enroll
campfire connect --harness codex
```

`--enroll` creates one additional managed agent for this human/harness/workspace
with explicit membership. Ordinary reconnect does not mint or rotate an identity.
Doctor and handoff select the recipient's own agent for the requested harness.
For hosted doctor, supply the session ID returned by explicit session registration.

A successful join reports the local stages it actually reached —
`enrolled`, `credentials_saved`, `connection_prepared`, `reload_required` — so a
partial local run is never reported as a working connection. The server commit
and this machine's filesystem are separate transactions.

If enrollment is interrupted, retry the same join command with the original
file, human name, harness selection and profile directory. Protected pending
state holds the original request binding and prepared credentials. A consumed
invitation's exact replay may recover its nonsecret receipt before its original
expiry; valid prepared actor credentials support local completion afterward.
No retry creates a replacement human/agent. Keep pending files until local
credential/profile/connection finalization completes. Total loss of all actor
credentials requires owner assistance; this is not an account recovery system.

A preexisting unrelated profile or conflicting harness block is refused rather
than replaced. Choose an isolated `CAMPFIRE_CONFIG_DIR` and an isolated harness
configuration for evaluation; account switching and profile merging are outside
this flow. Never copy the owner's human/agent token or their database.

Invitation files, pending enrollment state, the saved receipt, and the private
credential bundle are gitignored by pattern (`*.invitation.json`,
`pending-enrollment.json`, `pending-agent-*.json`, `enrollment-receipt.json`,
`credentials.json`). Do not commit them or paste them into evidence.

The workspace owner may cancel invitation authority:

```bash
campfire revoke-invitation <invitationId> --workspace <workspaceId>
```

Revocation reports which authority it withdrew: `unclaimed_enrollment` cancels an
invitation nobody claimed, and `consumed_receipt_replay` stops the original
claimant's receipt replay for an invitation that was already enrolled. It does
not remove already enrolled identities or revoke their actor tokens.
Existing actor-targeted `invite` / `join <workspaceId>` keep their previous
roles and semantics. The new invitation path grants a human `member` role and
each explicitly enrolled owned agent the `agent` role; members/agents cannot
issue new-person invitations.

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

## Telemetry (Workers Analytics Engine)

Anonymous product telemetry is a second, independent Worker binding in
`wrangler.toml`:

```toml
[[analytics_engine_datasets]]
binding = "TELEMETRY"
dataset = "campfire_telemetry"
```

Unlike D1 this binding holds no secret. There is no `database_id`, no
placeholder, and nothing for `$CAMPFIRE_D1_DATABASE_ID` or
`wrangler.local.toml` to resolve: `scripts/wrangler-deploy.mjs` patches only the
D1 id, so `npm run deploy`, `npm run deploy:dry-run`, and `npm run db:migrate`
all carry the telemetry binding through unchanged.

One-time provisioning (nothing to create by hand — the platform provisions the
dataset on the first write):

```bash
npm run deploy                          # publishes the Worker with the TELEMETRY binding
curl -fsSL https://boringinfra.company/campfire/install | head -c 1 >/dev/null
# controlled check: that fetch records one install_requested data point
```

A Worker deployed without the binding, or one whose Analytics Engine write
throws, accepts telemetry and answers
`200 {"ok":true,"result":{"recorded":false}}`. That is intentional: the
installer's best-effort POST must not look like a failure and must not be
retried. `recorded: false` means the Worker did not accept a write;
`recorded: true` means the binding accepted it, not that Analytics Engine has
confirmed durable storage. A misnamed binding can create a different dataset,
so verify the deployed
binding name and query `campfire_telemetry` after the first controlled event.

Client-side controls are operator/environment configuration:

```bash
export CAMPFIRE_TELEMETRY=0        # 0|off|false|no disables product events; 1|on|true|yes enables
export CAMPFIRE_TELEMETRY_URL=https://boringinfra.company/campfire/v1/telemetry
```

`CAMPFIRE_TELEMETRY=0` guarantees silence without changing operator state.
For CLI and MCP events, the environment override has precedence over the
recorded `campfire telemetry disable|enable` preference. The shell installer
also honors a recorded disable on reinstall, even if the environment requests
`CAMPFIRE_TELEMETRY=1`. `CAMPFIRE_TELEMETRY_URL` selects the
ingestion endpoint for a local or staged deployment; an endpoint that fails
validation disables delivery rather than falling back to a guessed host. The
official installer honors both environment variables before it reports
completion, and reads the recorded preference on reinstall. The installer *fetch* is
recorded by the Worker and cannot be disabled from the client — see
`docs/TELEMETRY.md` for the full disclosure.

Read-only measurement queries (dataset, definitions, sampling caveats):

```bash
node scripts/telemetry-queries.mjs --list                     # query catalogue
node scripts/telemetry-queries.mjs --dry-run                  # plan and exact SQL, sends nothing
node scripts/telemetry-queries.mjs --since 2026-10-02 --confirm
node scripts/telemetry-queries.mjs --output json --confirm    # reproducible document
```

The script needs `CLOUDFLARE_ACCOUNT_ID` and a read-only API token with
`Account | Account Analytics | Read` in `CLOUDFLARE_API_TOKEN` — the same names
Wrangler uses. It never hard-codes a credential, never places one in argv, and
refuses to send anything without `--confirm`. It defaults to the documented
Analytics Engine SQL API; `--runner wrangler` uses
`npx wrangler analytics-engine sql` on Wrangler builds that ship that
subcommand.

Analytics Engine accepts one index. On `campfire_telemetry`, `index1` is the
event name and is only the sampling key. Do not query `index2`–`index7`: those
columns are not written. Read the blobs instead: `blob1` event name
(`install_requested`, `install_completed`, `activated`, `active`), `blob2`
schema version (`"1"`), `blob3` Campfire version, `blob4` OS, `blob5`
architecture, `blob6` install method or `"none"`, `blob7` surface or `"none"`,
`blob8` installation id or `""`. Deduplicate installations with
`count(DISTINCT blob8)`.

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

The handoff lists the version, workspace, goal, participant names, readiness, and Viewer URL. It does not include a bearer token. `campfire serve` and `campfire view` stay in the process that started them. `campfire up` in a terminal is that process. A Codex or OpenCode session may also start it when its loopback URL is down, and that process keeps the database after `campfire mcp` exits. Campfire does not install them as operating-system daemons.

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
permission to execute. `show` and `activity` render text on a TTY under
`auto` and one compact JSON value when piped or with `--output json` (`--json`
is an alias for `--output json`).

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

## Webhook bridge

One outbound webhook per Campfire process. It is operator configuration, not
an agent tool and not a workspace mutation. Nothing is subscribed until every
value below is set. Agents cannot create, change, or read the signing secret.

```bash
export CAMPFIRE_WEBHOOK_ID=bridge_local
export CAMPFIRE_WEBHOOK_URL=https://example.com/campfire
export CAMPFIRE_WEBHOOK_SECRET=...          # env or Worker secret; never a file in the repo
export CAMPFIRE_WEBHOOK_EVENTS=finding.recorded,decision.proposed,decision.accepted,task.blocked
export CAMPFIRE_WEBHOOK_WORKSPACES=ws_billing_deploy
```

`CAMPFIRE_WEBHOOK_URL` must be `https`. `http` is accepted only for
`127.0.0.1`, `localhost`, or `::1`, for local development and acceptance.
URLs with a username or password are rejected. Redirects are not followed.

The closed event names are `finding.recorded`, `decision.proposed`,
`decision.accepted`, `task.blocked`, `task.completed`, `goal.completed`,
`artifact.attached`, and `workspace.completed`. A mutation outside that list
still saves its Campfire state and Contribution. It does not emit a domain
event.

Each request is JSON with:

```text
Content-Type: application/json
X-Campfire-Event-Id
X-Campfire-Event-Type
X-Campfire-Timestamp          # unix seconds
X-Campfire-Signature          # v1=<hex hmac-sha256 of "<timestamp>.<exact body>">
```

Receivers should deduplicate on the event id and reject stale timestamps.
A `2xx` response marks the delivery delivered. Timeouts, network errors, and
other statuses keep the same event id. Five attempts are allowed. After each
of the first four failures the next attempt waits 1s, 2s, 4s, then 8s. The
fifth failure is exhausted and stays inspectable. The request timeout is 10
seconds.
The Campfire mutation stays committed if delivery fails. A claim held longer
than 30 seconds can be retried by another dispatcher. Retries send the same
event id and the same body.

The local listener (`campfire up` / `campfire serve`) pumps pending deliveries.
It does not install launchd, systemd, or another machine daemon. The Worker
sends during the request and retries on its scheduled trigger. Removing the
configuration stops the next send. Each queued row stores a non-secret
fingerprint of the bridge id, URL, and signing secret it was queued for.
Changing the URL or secret leaves queued rows pending and unsent; restoring the
exact same bridge id, URL, and secret resumes them. This prevents reusing a
bridge id from sending previously queued events to a different destination.
Rows queued before the fingerprint migration are marked `exhausted` instead of
being sent to a destination they were not queued for.

`campfire bridge` prints whether the webhook is configured, the workspace and
event filters, and pending, delivering, delivered, and exhausted counts, then
lists each delivery with event id, event type, workspace id, attempt count,
timestamps, status, and a short error. The destination is reported as its
origin only: paths and query strings can carry credentials, so the raw URL is
never printed, and neither is the signing secret.

With `CAMPFIRE_URL` set the command inspects the hosted instance instead of the
local database. The hosted route is `GET /v1/bridge` and takes the
instance-operator credential `CAMPFIRE_BRIDGE_TOKEN` (`--token` also works):

```bash
CAMPFIRE_URL=https://campfire.example.com CAMPFIRE_BRIDGE_TOKEN=<operator-token> campfire bridge --json
```

`CAMPFIRE_BRIDGE_TOKEN` is not an actor token. It resolves to no human or agent
identity and grants no workspace access; conversely, no actor token — human or
agent — can read the report. Bridge filters and delivery metadata are
instance-level operator state, so they are never exposed through workspace
authorization. When the token is unset on the server, the hosted route fails
closed. The local command needs no token because it reads the SQLite file
directly. This command and route are not MCP tools. The Viewer does not
administer the bridge.

The Worker accepts API routes both at the origin root and under the
`/campfire` zone-route prefix, so a hosted `CAMPFIRE_URL` may be either
`https://campfire.example.com` or `https://boringinfra.company/campfire`. The
installer stays at `/campfire/install.sh`.

On Workers, set the webhook secret and `CAMPFIRE_BRIDGE_TOKEN` with
`wrangler secret put`, and the five non-secret names as vars. Do not put secrets
in `wrangler.toml`.

## Upgrade notes

- SQLite file upgrades run through versioned `schema_migrations` at startup.
  Back up the SQLite file (`CAMPFIRE_DB`, `$CWD/.campfire/campfire.db`, or
  `~/.local/share/campfire/campfire.db`) before upgrading binaries.
- Sprint 019 v4 adds `webhook_deliveries.config_fingerprint` and marks any
  delivery queued before the fingerprint existed as `exhausted`. Those rows
  stay inspectable with `campfire bridge`; repeat the underlying mutation if
  one still needs to reach the bridge.
- `view --host` behavior is now explicit: loopback by default, `--allow-remote`
  required otherwise. Scripts binding `0.0.0.0` must add the flag.
