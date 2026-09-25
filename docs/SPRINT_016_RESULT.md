# Campfire — Sprint 016 Result: Agent-Led Setup & Human Handoff

**Status:** Complete (**CONDITIONAL GO**)
**Date:** September 25, 2026
**Depends on:** Sprint 015 — Zero-to-Shared-Workspace Onboarding (**GO**); `v1.3.0`
**Primary metric:** Prompt-to-Ready Handoff accuracy

---

## 1. Result

A cold agent can discover `campfire setup`, create one real workspace with
`campfire onboard`, prepare a Codex or OpenCode MCP connection, and produce a
token-free Viewer handoff. `campfire doctor` is a read-only diagnosis. Campfire
still does not run or supervise the agent.

Recommendation: **CONDITIONAL GO**.

OpenCode completed an independent prompt-to-Viewer run: one human, one agent,
one workspace, one goal, an explicit session, a ready doctor report, a
loopback Viewer, and a final reply with no token. Codex, given the same kind
of request, created the correct workspace twice and named the right goal and
participants, but it did not write an MCP connection, did not register a
session, and did not leave a Viewer listening. Only OpenCode is validated for
the full prompt-to-Viewer path.

Gate B, Gate C, retention, adoption, and product-market fit remain unmeasured.

The operator separately authorized publication as minor release `v1.4.0`.
The four new backward-compatible interface commands make this a minor release,
not a patch. Publication does not change this sprint's CONDITIONAL GO decision
or establish the missing Codex prompt-to-Viewer evidence.

---

## 2. What changed

The installed binary now exposes four interface commands. They sit beside
onboarding and do not add schema, domain objects, or authorization rules.

- `campfire setup` prints the setup contract: version, required inputs,
  credential roles, serve and MCP environment names, the agent step order,
  loopback Viewer behavior, and the fact that a reload or approval may be
  required. It creates no state and includes no credential.
- `campfire onboard --json` still delivers the one-time tokens and now embeds
  that same contract with the resolved database path and workspace id.
- `campfire connect --harness codex|opencode` writes only that harness's
  Campfire MCP block. Codex uses a marked block in the named TOML file.
  OpenCode merges `mcp.campfire` into strict JSON. The command uses
  `campfire mcp`, the agent token, and `CAMPFIRE_HARNESS`. It preserves
  unrelated settings, refuses any other harness or unparseable OpenCode JSON,
  stores the token in the file at mode `0600`, and does not print the token.
  The result says a reload or new process is required.
- `campfire doctor <workspaceId> --harness <name>` reports version, mode,
  token, actor type, workspace access, harness, session, preflight, and
  context. It does not register a session or write collaboration state.
  Hosted doctor does not share the MCP process's in-memory session. The
  caller captures the id from `register_agent_session` and passes `--session`
  or `CAMPFIRE_SESSION_ID` (`--session` wins). Omitting it returns
  `register_agent_session_then_pass_session` rather than claiming no session
  exists. The session id and both tokens stay out of the human handoff.
- `campfire handoff` prints the version, workspace, goal, names, readiness,
  and a loopback Viewer URL. A non-loopback URL is rejected. The receipt has
  no token.

---

## 3. Deterministic evidence

Node 22.23.2, package `1.3.0`:

```text
npm run typecheck    PASS
npm test             PASS — 32 files / 347 tests
npm run build        PASS
npm run pack:tarball PASS — local darwin-arm64 candidate
                     sha256 1c9b72c698337a9c5559ceb0cd5877ef23cb125fa870fb3ba46be17446135491
```

The focused tests cover the token-free setup contract, Codex and OpenCode
config preservation, fail-closed malformed and unsupported targets, doctor
before and after session registration, human-token rejection, missing
workspace, non-participant, harness mismatch, read-only contribution counts,
and a handoff that rejects a public URL and omits both tokens.

The candidate tarball was not published. The live `v1.3.0` release does not
yet contain these commands.

---

## 4. Real harness evidence

Both runs used the local release candidate, an empty working directory, and an
isolated harness home. The prompt named the human, agent, workspace, and goal.
It did not list Campfire commands or expected ids.

### OpenCode 1.18.32 — validated

About 249 seconds. Exit 0. The final reply contained no token.

- Workspace `ledger close`, goal "Close the ledger without losing the March invoices".
- Human Sergio (owner) and agent OpenCode (`opencode`).
- One `register_session` contribution. No findings or tasks.
- `empty/opencode.json` points `mcp.campfire.command` at `campfire mcp` and
  sets `CAMPFIRE_URL`, `CAMPFIRE_TOKEN`, and `CAMPFIRE_HARNESS=opencode`.
- `campfire doctor` for that workspace was ready, next action
  `start_campfire_view`, and its stdout did not contain the token.
- Viewer `http://127.0.0.1:9415` listed that workspace and goal. The API body
  and the page contained no bearer token.

### Codex 0.150.1 — not validated for the full path

Two attempts.

The parallel attempt (about 262 seconds) created workspace `billing deploy`
and the correct goal and participants, then reported Viewer port 9415. That
port belonged to the OpenCode Viewer started at the same time. Codex wrote no
Campfire MCP block and registered no session. Its final reply did not include
a token. The tool log contained a token because `onboard` prints the one-time
receipt to the tool stdout.

The sequential retry (about 65 seconds) was told that ports 9414 and 9415 were
taken. It again created the correct workspace, goal, and participants, and its
final reply named Viewer port 9417 without a token. Nothing was listening on
9417. There was still no MCP token block and no agent session.

Codex therefore showed that a cold agent can onboard from the plain request.
It did not show session registration, diagnosis, or a live Viewer.

---

## 5. Deviations

None in the domain model. Connection syntax stays in `src/bootstrap/connect.ts`.

The scored Codex runs did not finish the handoff. That is recorded as
CONDITIONAL GO rather than repaired by hand.

No desktop screenshot was captured. The OpenCode Viewer was checked through its
loopback API and page body.

---

## 6. Acceptance decision

Sprint 016 is **CONDITIONAL GO** because the deterministic setup contract,
connection adapters, read-only doctor, secret-free handoff, and full test
suite pass, and one real harness (OpenCode) completed prompt-to-Viewer.
Codex did not complete that path, so the two-harness experience is not claimed.

Not claimed in the pre-promotion evidence: a public snapshot, GitHub Release,
or production deploy. Those require separate verification after tag `v1.4.0`.
Also not claimed: Gate B, Gate C, or product-market fit.

Sprint 017 is not defined or authorized by this result.

---

## 7. Follow-up: hosted doctor session id

A later manual run showed that a separate hosted `campfire doctor` stayed
unready after `register_agent_session` succeeded. The CLI never read
`--session` or `CAMPFIRE_SESSION_ID`, and hosted diagnosis called `whoami` and
`preflight` without that id. A fresh CLI process cannot see the MCP process's
in-memory session.

The interface now requires the caller to capture the id returned by
`register_agent_session` and pass `--session` or `CAMPFIRE_SESSION_ID`
(`--session` wins). Without that id, hosted doctor returns
`register_agent_session_then_pass_session`. It does not claim the session is
missing, and it does not register, discover, or repair one. `whoami`,
`preflight`, and `get_workspace_context` use the supplied id. Unknown, other
agent, other workspace, ended, and wrong-harness sessions stay rejected.
Local doctor is unchanged. No domain, schema, role, or authorization change.

This does not change the sprint decision. Codex still has not completed a
fresh prompt-to-Viewer run, so Sprint 016 remains **CONDITIONAL GO**.

Validation of this fix, Node 22.23.2, package `1.3.0`, fresh temporary
database:

```text
npm run typecheck                         PASS
tests/integration/doctor-hosted.test.ts   PASS
tests/unit/sprint-016.test.ts             PASS
npm test                                  PASS — 33 files / 348 tests
npm run build                             PASS
```

Hosted doctor without a session id reported `ready: false` and
`register_agent_session_then_pass_session`. The same command with the
registered id reported `ready: true`, every check passing, and
`start_campfire_view`. Workspace context returned the goal. `campfire view`
on `CAMPFIRE_URL` with the human token showed the workspace, goal, human, and
agent. Doctor output, the handoff, the Viewer page, the Viewer API body, and
the serve and view logs contained neither token. The handoff did not contain
the session id. No desktop screenshot was captured; the Viewer was checked
through its loopback page and `/api/call`. Nothing was committed, tagged,
published, migrated, or deployed.
