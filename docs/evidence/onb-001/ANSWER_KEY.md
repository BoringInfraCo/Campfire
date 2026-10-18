# ONB-001 Step 0 — answer key (published v1.22.0)

**Date:** October 18, 2026.
**Purpose:** for every captured first-run / return / join / Viewer state, what
Campfire knows, what it cannot know, the correct next command or human action,
whether a workspace exists, and which output may carry a one-time credential.
The key is derived from the captured evidence under this directory (see
`summaries/*.json` for the case-to-file map and the simulated/real labels), not
from intent.

**Credential rule of record (v1.22.0):** a bearer token leaves the process
only from `campfire onboard` with explicit JSON output (C13; the human receipt
says `Credentials are stored locally (mode 0600) and are not printed here.
Pass --json for one-time tokens.`). `invite-teammate` writes the `cfe~`-shaped
secret only into the private invitation file, never to stdout. `join` prints no
secret in any mode. The Viewer and its DOM never receive a token. Tokens in
this packet are masked as `[redacted]`, invitation secrets as
`[one-time-credential: redacted]`.

## A — Fresh local operator

| Case | What Campfire knows | What it cannot know | Correct next action | Workspace? |
| --- | --- | --- | --- | --- |
| A1 fresh, both harnesses (simulated presence) | name confirmed; MCP config written for Codex and OpenCode; API + Viewer bound (`[campfire] HTTP … viewer …`) | whether either harness reloaded or was approved; whether any agent is live; that no workspace exists yet | `Agent      reload the harness, then continue in that session` (then describe the work to the agent) | none |
| A2 fresh, Codex only | same, Codex named only (`Agents     Codex`) | same (OpenCode not prepared) | same, for Codex | none |
| A3 fresh, no harness | name confirmed; API + Viewer bound | anything about harnesses | install a harness / run the agent path; receipt shows `Agents     none connected yet` | none |
| A4 fresh, `--no-connect` with harnesses present | name confirmed; connection deliberately skipped | same as A3 — **v1.22.0 does not name the skipping flag**; the receipt is byte-identical to A3 | (v1.22.1 target: say setup was skipped by the flag and give the same manual step) | none |
| A5 piped, no name (human mode) | stdout is not a terminal; no name given | nothing about harnesses (run never reached them) | run in a terminal or pass `--human-name`; stderr: `Run campfire in a terminal to confirm your name, or pass --human-name. Agents and workspaces appear when a harness connects.` + `Next:` lines; exit 1 | none |
| A6 piped, no name, explicit JSON | same | same | same as A5 as `{"error":{"code":"ValidationError",…},"next":[…]}` on stderr; stdout empty; exit 1 | none |
| A7 piped, `--human-name Ada --output json` (fresh creation) | local profile created | nothing after creation | `{"human":"Ada","humanId":"hum_[id]","databasePath":"[path]","waiting":"agent","pastSessionsImported":false}` — `waiting:"agent"` is a label, not a live-agent claim | none |
| A8 piped, `--human-name Ada` (bare stays human when piped) | profile created | — | human receipt: `You  Ada` / `Waiting for an agent to start work.` / `Past sessions are not imported.` / `campfire up     start the local API and Viewer` | none |
| A9 `up --no-open --port 0 --viewer-port 0 --output json` | listener bound; browser branch suppressed by the flag | — | `{"human":"Ada","workspaces":[],"agents":[],"apiUrl":"http://127.0.0.1:[port]","viewerUrl":"http://127.0.0.1:[port]","openedBrowser":false,"pastSessionsImported":false}` | none |
| A10 `up` with the browser branch (PATH `open` shim) | listener bound; a browser launch was attempted | whether a person actually saw the page | same JSON with `"openedBrowser":true`; the shim log records the opened URL (nothing else was launched) | none |

Notes.
- A1/A2 name only *prepared* configs. The receipt never says `connected`; the
  reload line is the only follow-up and it is conditional on a prepared
  harness.
- A3 and A4 produce the same receipt in v1.22.0; distinguishing the
  deliberately-skipped case from the absent-harness case is ONB-001 work,
  not a captured behavior.
- A5/A6 stdout is empty; the diagnostic is stderr-only in both modes.

## B — No supported harness / connection deliberately skipped

Covered by A3 (absent) and A4 (skipped by flag). The key above applies: with
no prepared connection the only truthful statements are the waiting line, the
`Past sessions are not imported.` line, and the Viewer URL; `none connected
yet` must not be read as "an agent failed", and nothing claims an agent exists.
No workspace is created in either state.

## C — Returning local operator

| Case | What Campfire knows | What it cannot know | Correct next action | Workspace? |
| --- | --- | --- | --- | --- |
| C1/C2/C3 (bare `campfire`: PTY, piped, explicit JSON) | a stored local profile exists; it has no workspace selection | service state, live agents, current work | `campfire up     start the local API and Viewer`; JSON (C3): `{"human":"Ada","databasePath":"[path]"}` — workspace fields are omitted because they are undefined | none (profile only) |
| C4/C5 (`campfire status`) | same profile; nothing about current service truth | anything current | human: `You  Ada` / `Waiting for an agent to start work.` / `campfire up  Start the local API and Viewer so an agent can connect`; JSON (C5): `"state":"awaiting_workspace"` with the same `next` steps | none |
| C6/C7/C8 (bare with stored workspace) | a stored workspace selection (name/goal are local profile data) | whether the workspace is still current, who is in it, live agents | `campfire up     start the local API and Viewer`; the receipt labels the stored data but does not claim service state; JSON (C8): `{workspace, workspaceId, goal, human, agent, harness, databasePath}` | selection only; not proof of service |
| C9/C10 (`campfire status` with stored workspace, server reachable) | current authorized read: workspace, goal, participants, counters | — | human (C9): `Workspace  billing-deploy-failure  [active]  ws_[id]` / `Participants  1 human  1 agent` / `Activity   5 contributions  newest con_[id]`; JSON (C10): `"state":"ready"` with `participants`, `work`, `decisions`, `attention`, `activity` (`truncated:false` in this small fixture) | yes — read live |
| C11/C12 (`up --no-connect`, PTY / JSON) | listener bound for the stored workspace; no connection prepared | — | human: `Agents     none connected yet` / `Workspace  billing-deploy-failure  Restore the billing deploy pipeline` / `You  http://127.0.0.1:[port]`; JSON (C12): `workspaces:[{id,name,goal}]`, `agents:[]`, `openedBrowser:false` | yes — selection used for the listener |

Notes.
- The profile is a selector. C3's JSON shape (no workspace fields) is the
  returning entry point; A7's JSON shape (`humanId` + `waiting`) is the
  creation receipt. They are not interchangeable.
- C9 `Activity` numbers and newest ids are read results; the retained numbers
  in this packet are observations of one fixture, not constants of the CLI.

## D — Teammate joining existing work

| Case | What Campfire knows | What it cannot know | Correct next action | Workspace? |
| --- | --- | --- | --- | --- |
| D1 `invite-teammate … --out <private-file>` | invitation issued; single-use; `expiresAt`; permitted harnesses | whether the file is delivered or read | hand the private file to the teammate over a private channel | owner side |
| D2/D3/D4 join success (PTY / piped JSON / explicit human) | enrolled; credentials saved; connection prepared; reload required (stage strings `enrolled, credentials_saved, connection_prepared, reload_required`) | whether the harness reloaded or the tools were approved | `Next: campfire up` (JSON receipt carries `stages` and no token field) | joined remote workspace |
| D18 join success, `--harness opencode` | same stages; `Connected opencode.` | same | same | same |
| D5 used invitation | claim conflict from the server | — | `invitation_already_claimed` recovery: `campfire join --help` (ask the owner for a new invitation; the original request may retry) | none |
| D6 expired invitation | client-side expiry check fails before any claim | — | `Invitation has expired; ask the owner for a new invitation` (`request_new_invitation`); invitation stays unclaimed | none |
| D7 wrong endpoint | commit attempt to an address where nothing listens | whether the request ever reached a server | `Enrollment commit is uncertain: the response was lost. Retry the same invitation with the saved request` (`retry_saved_enrollment`); a following bare `campfire` shows the ordinary no-name error, **not** a success screen | none |
| D8 non-JSON file | file exists but is not parseable | — | `Enrollment file is missing or invalid; use the original private file` (`check_invitation_file`) | none |
| D9 wrong shape | JSON, but not an enrollment invitation | — | `Unsupported or invalid invitation file` (`check_invitation_file`) | none |
| D10 0644 file | permission check fails before the claim | — | observed: the same `missing or invalid` message — the intended private-file message is swallowed (see `PINNED_STRINGS.md` finding 1) | none |
| D11 initialized local profile | a local profile/credential bundle would be replaced | — | refused: `An existing profile or credential bundle would be replaced; use an isolated CAMPFIRE_CONFIG_DIR` (`use_isolated_profile`); the profile is unchanged (`{"human":"Rob","databasePath":"[path]"}` after the refusal, no workspace fields) | none — no covert merge |
| D12/D13 recipient bare | joined profile; agents as recorded in the enrollment | anything current | `campfire up     open the shared workspace journal and prepare your agents`; JSON (D13): `mode:"remote"`, agents, `nextAction:"campfire up"` | joined workspace |
| D14/D15 recipient `status` | authorized remote read (server-side authorization; **stderr empty**) | — | JSON (D14): `"state":"ready"` with the workspace/goal and counters; human (D15): same fields as C9 | joined workspace — read live |
| D16/D17 recipient `up --no-connect` | remote profile; listener bound; viewer URL | — | human: `Viewer     http://127.0.0.1:[port]` + `The Viewer is read-only; an agent registers its own session before contributing.`; JSON (D16): `mode:"remote"`, `agents:[]`, `connectionPrepared:false`, `viewerUrl` distinct from `apiUrl`, `openedBrowser:false`. Remote SIGINT shutdown is **silent** (no `received SIGINT` line) | yes |

Notes.
- Every failure case exits 1 with empty stdout; the diagnostics are stderr.
- Join never prints an invitation secret or token in any mode (D3 asserts no
  `token`/`secret`/`credential` field in the JSON receipt; the human receipt
  names only the workspace and harness).
- Each successful join adds a new human/agent pair to the workspace (no
  name-based dedupe); D14/D15 therefore observe 5 humans / 5 agents in this
  capture order — a bookkeeping fact, not a product constant.
- The recipient remote surfaces require a stored remote profile; a local
  profile can never silently become remote (D11 pins the refusal).

## E — Read-only Viewer with no workspace

| Case | What the Viewer knows | What it cannot know | Correct next action | Workspace? |
| --- | --- | --- | --- | --- |
| E1 fresh profile (`campfire view`, no profile) | no profile **and no actor in the store** — the CLI binds its default actor `hum_sergio`, which does not exist | — | `whoami` still answers `{"actor":{"actorId":"hum_sergio","actorType":"human"}}`; `list_workspaces` is `ActorNotFound` (404); the rendered page shows the raw error `Actor not found: hum_sergio` and the stream hint | none |
| E2 initialized local profile, no workspace | the profile's human; empty workspace list | — | `list_workspaces` → `{"ok":true,"result":[]}`; explicit empty state `Waiting for an agent to start work.` in the stream; unknown generated view → 404 `Workspace unavailable` | none |
| E3 headless DOM of E2 | same as E2 | — | rendered DOM pins the empty state; the workspace `<select>` is empty (the select placeholder is unreachable — see `PINNED_STRINGS.md` finding 2) | none |
| E4 headless DOM of E1 | same as E1 | — | rendered DOM pins the error banner plus the waiting hint | none |

Viewer invariants pinned by E1–E4.
- Read-only: `POST /api/call` with a non-read method is 403 `Viewer is
  read-only`; the browser never receives a token.
- Host guard: any request whose `Host` is not the listener's own
  address/port is 403 `Request Host is not the viewer's listening address`
  before any route runs (and returns no page bytes).
- Read allowlist: `whoami`, `list_workspaces`, `get_workspace`,
  `get_workspace_context`, `get_activity`.
- Served assets: `/`, `/app.css`, `/app.js`, `/campfire-mark.svg`; the served
  `app.js` is byte-identical (sha256 `2632df6c…067f6c`) to both
  `src/viewer/static/app.js` and `public/app.js` at the tag.
- The generated view for a workspace the actor cannot read is a 404 with no
  workspace details; for the fresh default actor it falls through to a 500
  `InternalError` because `ActorNotFound` is not in the route's 404 mapping
  (see `PINNED_STRINGS.md` finding 3).

## Cross-state summary — one-time credential surfaces

| Surface | May emit a one-time credential? |
| --- | --- |
| `campfire onboard` with explicit JSON | **yes** — `human.token` + `agent.token`, masked `[redacted]` here |
| `campfire onboard` human mode | no — prints `Pass --json for one-time tokens.` |
| `campfire invite-teammate` stdout | no — invitation id/path/url only; the secret lives in the private file (`cfe~`, masked) |
| `campfire join` (all modes) | no |
| bare `campfire` JSON (fresh creation A7 / returning C3 / D11) | no — ids and paths only |
| `status`, `up`, recipient surfaces | no |
| Viewer + DOM dumps | no — the browser never receives a token |
