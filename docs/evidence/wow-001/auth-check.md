# auth-check (disposable authenticated verification)

Dated 2026-10-07.

## Purpose

A disposable authenticated verification of the locked real-run path for
WOW-001, **not a scored run**. No scenario was investigated, no scoring
occurred, and the six pilot runs remain unexecuted. The check builds a
throwaway Campfire universe (human, owned agent, authorized workspace with a
goal, agent invite and join, one issued agent token, and a second workspace the
agent is never invited to), runs **one real OpenCode session** in the locked
agent image through the real MCP configuration
(`CAMPFIRE_DB=/campfire/campfire.db`, `CAMPFIRE_TOKEN={file:/campfire/agent.token}`,
database and token mounted read-only at `/campfire`), and then verifies the
result independently from the host.

## Command

```text
npx tsx scripts/wow-001/pilot.ts auth-check
```

- exit code: `0` (`ok: true`, `failedChecks: []`)
- image (asserted by the runner before the session):
  `campfire-wow-001-agent:977c0e3-opencode1.18.35`
  (`sha256:349b90635fd4b584599aba5e01f989f44c38689f857eb217b1fbcb3fc078943a`)
- model: `opencode-go/deepseek-v4.1-flash`
- disposable root: `<home>/.campfire-pilot/wow-001/auth-check/`
- session completed with stop reason `completed`; the container command and
  sanitized transcript are in `<auth-check>/auth-check.log`

## Exact sanitized report

Runner stdout (exit 0):

```json
{"ok":true,"agentId":"agt_b6107e8fac7b42c9","workspaceId":"ws_abc33b1d54d44de1","goalPresent":true,"findingId":"find_a405c4fafc0c4e4a","sessionId":"ses_d94ee609e5ae4d98","unauthorizedError":"ParticipantRequired: Actor agt_b6107e8fac7b42c9 is not a participant of workspace ws_d8677f1c540d4330","checks":{"sessionCompleted":true,"goalPresent":true,"findingPresent":true,"findingByAgent":true,"sessionRegistered":true,"sessionOnFinding":true,"unauthorizedDenied":true,"unauthorizedHasNoAgentContent":true},"failedChecks":[]}
```

`<auth-check>/auth-check.json` (runner-sanitized before writing):

```json
{
  "ok": true,
  "agentId": "agt_b6107e8fac7b42c9",
  "workspaceId": "ws_abc33b1d54d44de1",
  "goalPresent": true,
  "findingId": "find_a405c4fafc0c4e4a",
  "sessionId": "ses_d94ee609e5ae4d98",
  "unauthorizedError": "ParticipantRequired: Actor agt_b6107e8fac7b42c9 is not a participant of workspace ws_d8677f1c540d4330",
  "checks": {
    "sessionCompleted": true,
    "goalPresent": true,
    "findingPresent": true,
    "findingByAgent": true,
    "sessionRegistered": true,
    "sessionOnFinding": true,
    "unauthorizedDenied": true,
    "unauthorizedHasNoAgentContent": true
  }
}
```

## What the model session did

The session made exactly five Campfire MCP calls and stopped. Its own final
summary (sanitized transcript):

```text
1. whoami — acting actor: `agt_b6107e8fac7b42c9` (type `agent`), harness `opencode`.
2. list_workspaces — one workspace: `ws_abc33b1d54d44de1` ("Disposable Auth Check Workspace", active, goal "Disposable authenticated check goal", 0 open tasks).
3. get_workspace_context `ws_abc33b1d54d44de1` — goal: "Disposable authenticated check goal" (id `goal_c3937a5eb0ad429d`, status active).
4. register_agent_session — session id: `ses_d94ee609e5ae4d98`.
5. add_finding — created `find_a405c4fafc0c4e4a` with summary "Disposable authenticated check" (current).
6. get_workspace_context `ws_d8677f1c540d4330` — error code `ParticipantRequired`, message: "Actor agt_b6107e8fac7b42c9 is not a participant of workspace ws_d8677f1c540d4330". Not retried.
```

Tool calls observed in the JSONL capture: `campfire_whoami` x1,
`campfire_list_workspaces` x1, `campfire_get_workspace_context` x2,
`campfire_register_agent_session` x1, `campfire_add_finding` x1.

## Independent host-side verification

After the session, the runner read the disposable database from the host with
the host CLI (isolated config/data dirs, no operator profile):

- `campfire show <workspace> --full` with the **agent token** returned the
  goal, and the finding `find_a405c4fafc0c4e4a` with
  `createdBy.actorId = agt_b6107e8fac7b42c9` (the acting agent) and
  `agentSessionId = ses_d94ee609e5ae4d98`; the registration activity for the
  session is attributed to the same agent.
- `campfire show <unauthorized workspace>` with the **agent token** failed with
  the typed error `ParticipantRequired` and no content.
- `campfire show <unauthorized workspace> --full` with the **human token**
  showed no agent finding, session, or activity in that workspace
  (`unauthorizedHasNoAgentContent: true`).

The disposable workspace, actors, and tokens lived only in
`<home>/.campfire-pilot/wow-001/auth-check/` and were deleted after this
capture; nothing was added to the repository database or any production
workspace.

## Sanitization

The JSON above is runner-sanitized or was re-run through
`pilot.ts sanitize`; it contains no credential-shaped strings, no home path,
and no repository path.
