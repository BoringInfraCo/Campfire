# Campfire — Sprint 005: Team Identity + Hosted Instance

**Status:** Complete (GO)  
**Sprint:** 005 — Team Identity + Hosted Instance  
**Date:** September 12, 2026  
**Company:** Boring Infra Co.  
**Depends on:** Sprint 004 — Living Workspace (**GO**)  
**Gate:** Deployment Stage B (partial) — one shared process, actor tokens, invite membership

---

## 1. Sprint Thesis

Sprint 004 made a workspace livable on one machine.

Sprint 005 must prove:

> **Two actors on two processes can share one Campfire without spoofing `CAMPFIRE_ACTOR_ID` and without copying a SQLite file.**

The Viewer is **not** in this sprint.

---

## 2. In Scope

1. **Register humans and agents** through the service and CLI. Agents require `humanId`. First human may bootstrap when the database has no humans.
2. **Actor tokens.** High-entropy secret shown once. SHA-256 hash at rest. HTTP and CLI resolve the actor from the token. MCP tools still never accept an actor id.
3. **Invite-only membership.** `create_workspace` still adds the creator as owner. Everyone else needs an invite. `join_workspace` consumes the invite; role comes from the invite, not the joiner. Owner and member may invite; viewer and agent may not.
4. **Session principal.** `register_agent_session` uses `agents.human_id`. Ignore/reject tool-supplied `humanId` if it does not match. `endAgentSession` must `assertAllowed`.
5. **HTTP** in front of `CampfireService` using Node `node:http` (no Express). One writer process. SQLite stays on local disk with WAL.
6. **MCP adapter mode.** If `CAMPFIRE_URL` is set, stdio MCP forwards tool calls over HTTP with the bearer token. If unset, current in-process SQLite remains (Sprint 001).
7. **Allow/deny logs** as JSON lines on stderr.

## 3. Out of Scope

SSO, SCIM, OAuth, Viewer, fx, Postgres, multi-tenant, capability grants, React UI, finding lifecycle.

## 4. Schema v2

```sql
actor_tokens (
  id, actor_id, actor_type, token_hash UNIQUE, created_at, revoked_at
)

workspace_invites (
  id, workspace_id, actor_id, actor_type, role,
  invited_by_actor_id, invited_by_actor_type,
  created_at, consumed_at
)
```

Fixture tokens (seed, labeled fixtures):

```text
cft_fixture_hum_sergio
cft_fixture_hum_alice
cft_fixture_agt_codex_sergio
cft_fixture_agt_opencode_alice
```

## 5. HTTP

```text
campfire serve [--host 127.0.0.1] [--port 9414]

POST /v1/call
Authorization: Bearer <token>
{ "method": "<mcp tool name>", "params": { ... } }
```

Token required. Actor id in the body is ignored.

## 6. Exit

- Token A cannot act as token B over HTTP.
- Uninvited actor cannot join or list a workspace.
- Agent session `humanId` matches `agents.human_id`.
- Two HTTP clients share one server process / one SQLite file.
- Sprint 001 `npm run acceptance` remains GO (in-process MCP, no `CAMPFIRE_URL`).
- `docs/SPRINT_005_RESULT.md` with GO / CONDITIONAL GO / NO-GO.

No Viewer files.
