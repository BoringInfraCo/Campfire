# ONB-001 Step 0 — pinned user-facing strings (v1.22.0)

**Date:** October 18, 2026.
**Baseline:** tag `v1.22.0` (object `83d0602ac43c801390f8001b5330c2c237814621`) → commit
`1b9432dca9e2900bee2378e2672ca93df07200de`. Every `file:line` below is at that
commit; `src/` at capture HEAD `bf8d6ac…` is identical to the tag
(`git diff v1.22.0 HEAD -- src` is empty).

**Scope:** the exact user-facing strings that produced the ONB-001 ambiguity —
whether "configured" is confused with "loaded", and what the no-workspace
status and Viewer actually say. Values that vary at runtime (`<name>`, ports,
ids) are shown in their masked/canonical form.

## The ambiguity this pins (from the sprint contract)

The contract observes that the terminal can print `Agents     none connected
yet` **or** agent names after merely writing harness configuration; that the
no-workspace Viewer and status surfaces "say only that they are waiting for an
agent"; and that a screenshot's TOML block can read as a supported setup
surface. The strings below are the released text behind each claim.

## First-run and `up` receipts (local)

| String | Source at tag | Captured in |
| --- | --- | --- |
| `Your name [owner]: ` | `src/cli/first-run.ts:46` | A1–A4, A10 (PTY prompt) |
| `  Agents     none connected yet` | `src/cli/index.ts:2430` | A3, A4, C11 |
| `  Agents     Codex, OpenCode` / `  Agents     Codex` (prepared list) | `src/cli/index.ts:2430` (dynamic join) | A1, A2 |
| `  Waiting for an agent to start work.` | `src/cli/index.ts:2423` | A1–A4 |
| `  Past sessions are not imported.` | `src/cli/index.ts:2432` | A1–A4 |
| `  You        http://127.0.0.1:[port]` (the actual Viewer URL) | `src/cli/index.ts:2434` | A1–A4, C11 |
| `  Agent      reload the harness, then continue in that session` | `src/cli/index.ts:2437` | A1, A2 |
| `[campfire] HTTP http://127.0.0.1:[port]  viewer http://127.0.0.1:[port]` | `src/cli/index.ts:2442` | A1–A4, C11 |
| `[campfire] received SIGINT, shutting down` | `src/cli/index.ts:2446` (local `up`); `2141` (`serve`); `2166` (`view`) | A1–A4, C11, E1–E4 |
| `  Workspace  <name>  <goal>` (stored selection in the `up` receipt) | `src/cli/index.ts:2426` | C11 |

Observed identity: **A3 (no harness) and A4 (`--no-connect`) print the same
`none connected yet` receipt**; v1.22.0 names neither "absent" nor "skipped",
and no line distinguishes the two. `none connected yet` is the only
connection statement in both.

## Bare `campfire`, local status, and `status`

| String | Source at tag | Captured in |
| --- | --- | --- |
| `Run campfire in a terminal to confirm your name, or pass --human-name. Agents and workspaces appear when a harness connects.` | `src/cli/index.ts:2524` | A5 (stderr, human), A6 (stderr, JSON error) |
| `  campfire up     start the local API and Viewer` | `src/bootstrap/profile.ts:438` | A8, C1, C2, C6, C7 |
| `  campfire --help` | `src/bootstrap/profile.ts:438` | A8, C1, C2, C6, C7 |
| `  You        Ada` (stored local name; profile data) | `src/bootstrap/profile.ts:427` | C1, C2, C6, C7 |
| `  Workspace  billing-deploy-failure` / `  Goal       …` (stored selection, labeled as local profile data) | `src/bootstrap/profile.ts:429-433` | C6, C7 |
| `Waiting for an agent to start work.` / `Past sessions are not imported.` (projection form, no leading spaces) | `src/cli/projections.ts:279` | C4 |
| `campfire up  Start the local API and Viewer so an agent can connect` | `src/cli/projections.ts:224` | C4, C5 next steps |
| `Workspace  <name>  [active]  ws_[id]` (status read view) | `src/cli/projections.ts:235` | C9, D15 |
| `Goal       <title>  [active]` | `src/cli/projections.ts:238` | C9, D15 |
| `Participants  1 human  1 agent` (counted form; pluralizes) | `src/cli/projections.ts:241` | C9 (1/1), D15 (5/5) |
| `Activity   <n> contributions  newest con_[id]  (recent window truncated)` | `src/cli/projections.ts:262` and `:268` | D15 |
| `Waiting for an agent to start work.` (dashboard, TTY only) | `src/cli/index.ts:1413` | not captured in this packet (requires the interactive dashboard); source-pinned only |
| bare local JSON: `{"human":"Ada","databasePath":"…"}` — JSON.stringify omits undefined workspace fields | `src/cli/index.ts:2471-2477` | C3, D11 |
| fresh-creation JSON: `{"human":"Ada","humanId":"hum_[id]","databasePath":"…","waiting":"agent","pastSessionsImported":false}` | `src/cli/index.ts:2530-2537` | A7, E2 prep |

Caller-visible `status` JSON: `"state":"awaiting_workspace"` (C5) vs
`"state":"ready"` (C10, D14) with `next` entries in the awaiting state.

## `onboard` credential policy

| String | Source at tag | Captured in |
| --- | --- | --- |
| `Credentials are stored locally (mode 0600) and are not printed here.` | `src/bootstrap/onboard.ts:158` | C14 |
| `Pass --json for one-time tokens.` | `src/bootstrap/onboard.ts:159` | C14 |
| one-time credential fields `human.token` / `agent.token` (masked `[redacted]`) | emitted only with explicit JSON | C13 |

## Join

| String | Source at tag | Captured in |
| --- | --- | --- |
| `Joined <ws> as <name>.` / `Completed: enrolled, credentials_saved, connection_prepared, reload_required.` / `Connected codex. Reload the harness and approve Campfire tools.` / `Next: campfire up` | `src/cli/index.ts:2102` | D2, D4, D18 |
| `Invitation has expired; ask the owner for a new invitation` (next: `request_new_invitation`) | `src/bootstrap/enrollment-client.ts:175` | D6 |
| `Enrollment file is missing or invalid; use the original private file` (next: `check_invitation_file`) | `src/bootstrap/enrollment-client.ts:38` | D8, D10 |
| `Enrollment file must be a bounded private file` (next: `check_invitation_file`) — **never user-visible; see finding 1** | `src/bootstrap/enrollment-client.ts:35` | not reachable (D10 shows the swallowed message) |
| `Unsupported or invalid invitation file` (next: `check_invitation_file`) | `src/bootstrap/enrollment-client.ts:73` | D9 |
| `An existing profile or credential bundle would be replaced; use an isolated CAMPFIRE_CONFIG_DIR` (next: `use_isolated_profile`) | `src/bootstrap/enrollment-client.ts:174` | D11 |
| `Enrollment commit is uncertain: the response was lost. Retry the same invitation with the saved request` (next: `retry_saved_enrollment`) | `src/bootstrap/enrollment-client.ts:198` | D7 |
| `Invitation was claimed by a different enrollment request` (code `Conflict`, recovery `invitation_already_claimed`) | `src/service/campfire-service.ts:172` | D5 |

## Remote (recipient) surfaces

| String | Source at tag | Captured in |
| --- | --- | --- |
| `You`/`Workspace`/`Agents` remote bare human receipt | `src/cli/index.ts:2509-2512` | D12, D17 |
| `  campfire up     open the shared workspace journal and prepare your agents` | `src/cli/index.ts:2512` | D12 |
| `  campfire status read current authorized work` | `src/cli/index.ts:2512` | D12 |
| `  Agents     no connection prepared` | `src/cli/index.ts:2312` | D17 |
| `  Viewer     http://127.0.0.1:[port]` | `src/cli/index.ts:2314` | D17 |
| `  The Viewer is read-only; an agent registers its own session before contributing.` | `src/cli/index.ts:2315` | D17 |
| `[campfire] remote workspace  viewer http://127.0.0.1:[port]` | `src/cli/index.ts:2317` | D16, D17 |
| remote `up` human mode prints **no** `received SIGINT` line (silent shutdown) | `src/cli/index.ts:2318-2326` | D17 |
| remote bare JSON `{mode:"remote",…,"nextAction":"campfire up","pastSessionsImported":false}` | `src/cli/index.ts:2505-2507` | D13 |
| remote `up` JSON `{mode:"remote",…,"connectionPrepared":…,"reloadRequired":…,"sessionRegistered":false,"apiUrl","viewerUrl","openedBrowser","pastSessionsImported":false}` | `src/cli/index.ts:2306-2309` | D16 |

## Viewer

| String | Source at tag | Captured in |
| --- | --- | --- |
| `Waiting for an agent to start work.` (stream hint, rendered) | `src/viewer/static/app.js:1747` | E3 |
| `Waiting for an agent to start work.` (workspace `<select>` option — **unreachable on the exact-empty first render; see finding 2**) | `src/viewer/static/app.js:749` (guard at `:66`, `:746`) | not rendered (E3 pins the empty `<select>` instead) |
| `Viewer is read-only` (403 on any non-read `/api/call`) | `src/viewer/server.ts:377` | E1 |
| `Request Host is not the viewer's listening address` (403 before any route) | `src/viewer/server.ts:265` | E1 |
| `Workspace unavailable` (404 for unreadable/unknown generated view) | `src/viewer/server.ts:298` (mapping at `:297`) | E2 |
| `Not found: <path>` (404) | `src/viewer/server.ts:310/319/343` | E1 (`/nope`) |
| `Unable to render workspace view` (500 fallback) | `src/viewer/server.ts:302` | E1 |
| `Actor not found: <actorId>` (domain error surfaced in the page banner) | `src/domain/errors.ts:52` | E1, E4 (`hum_sergio`) |
| Viewer read allowlist `whoami`, `list_workspaces`, `get_workspace`, `get_workspace_context`, `get_activity` | `src/viewer/server.ts:33-39` | E1 (`whoami` and `list_workspaces` exercised) |

## TOML note (contract requirement)

`repo:read`, `repo:write`, `tests:run`, and `deploy:prod` in the referenced
first-run screenshot are an **illustrative example of some other tool's
configuration, not a v1.22.0 Campfire surface**. v1.22.0 has no TOML
first-run input and no TOML capability/permission block: the only TOML Campfire
writes is the Codex harness MCP config at the harness-managed path
(`src/bootstrap/connect.ts:204`, `~/.codex/config.toml` in the harness home),
and `src/bootstrap/connect.ts:62` notes that an unmanaged table cannot be
appended to without producing ambiguous TOML. First-run inputs are CLI flags
and environment (`--human-name`, harness detection, etc.). No evidence file in
this packet reads or writes a Campfire TOML config.

## Findings (observed at the tag)

1. **D10 message swallow.** `src/bootstrap/enrollment-client.ts:35` fails
   with `Enrollment file must be a bounded private file`, but `failure()`
   throws inside the `try` and the `catch` at `:38` rewrites every failure to
   `Enrollment file is missing or invalid; use the original private file`.
   A 0644 invitation therefore reports a parse-style message (D10), and the
   specific private-file message is unreachable at v1.22.0.
2. **Viewer select placeholder is unreachable in the exact-empty state.**
   `selectKey` is initialized to `""` (`src/viewer/static/app.js:66`) and the
   guard at `:746` skips the option write when the (empty) workspace list key
   is also `""`, so `Waiting for an agent to start work.` never appears inside
   the `<select>`; only the stream hint at `:1747` renders (E3).
3. **Fresh-profile Viewer is an actor error, not an empty state.**
   `campfire view` on a fresh config binds the hardcoded default actor
   `hum_sergio` (`src/cli/index.ts:155`, `DEFAULT_ACTOR_ID`), which does not
   exist in the store. `list_workspaces` is `ActorNotFound` (404), the page
   banner shows `Actor not found: hum_sergio`, and the unknown generated view
   falls through to a 500 `InternalError` because `ActorNotFound` is not in
   the route's 404 mapping (`src/viewer/server.ts:297`). E1/E4 pin this.
4. **Remote `up` shuts down silently.** The remote SIGINT path
   (`src/cli/index.ts:2318-2326`) prints no `received SIGINT` line, unlike
   local `serve`/`view`/`up`. D17 pins the absence.
5. **No-harness and `--no-connect` are indistinguishable in the receipt**
   (A3 == A4; see the first-run table).
6. **Join is additive.** Every successful join creates a new human/agent pair
   (no name dedupe); D14/D15 see 5/5 because four joins (D2, D3, D4, shared
   D12) precede them — a capture-order fact recorded in the join summary.
