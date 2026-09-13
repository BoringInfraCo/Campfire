# Campfire — Sprint 005 Result

**Status:** Complete  
**Sprint:** 005 — Team Identity + Hosted Instance  
**Date:** September 12, 2026  
**Company:** Boring Infra Co.  
**Depends on:** Sprint 004 — Living Workspace (**GO**)  
**Recommendation:** **GO**

---

## 1. Result

Sprint 005 asked:

> **Two actors on two processes can share one Campfire without spoofing
> `CAMPFIRE_ACTOR_ID` and without copying a SQLite file.**

Yes, on the HTTP path. `campfire serve` is the single writer. Clients send
`Authorization: Bearer <token>`. The token is the actor; a body `actorId` is
ignored. Uninvited join is denied. Session `humanId` comes from `agents.human_id`.

Sprint 001 in-process MCP (no `CAMPFIRE_URL`) remains **GO** (19/19).

No Viewer was added.

---

## 2. What landed

| Surface | Behavior |
|---|---|
| Schema v2 | `actor_tokens` (SHA-256 at rest), `workspace_invites` |
| `createHuman` / `createAgent` | Product identity; first human may bootstrap; agent bound to owning human |
| `issueToken` / `resolveToken` | `cft_<hex>` shown once |
| Invite-only join | Owner/member invite; joiner cannot pick role; agents/viewers cannot invite |
| `register_agent_session` | `humanId` from the agent row; mismatch is `Unauthorized` |
| `endAgentSession` | Authorized (session agent or owning human) |
| HTTP | `POST /v1/call` on `node:http`, default `127.0.0.1:9414` |
| MCP | `CAMPFIRE_URL` + `CAMPFIRE_TOKEN` adapter; otherwise local SQLite |
| Authz log | JSON lines on stderr |

---

## 3. Tests

```bash
npm run typecheck     # clean
npm test              # 16 files, 156 tests, all passing
npm run acceptance    # Sprint 001: GO, 19/19
```

New: `tests/unit/identity.test.ts`, `tests/integration/http.test.ts`.

HTTP checks: missing/invalid bearer → 401; Alice cannot read Sergio-only workspace; Sergio token cannot act as Alice; uninvited join denied; invite+join lists the workspace; spoofed session `humanId` rejected.

---

## 4. Limitations

1. Local stdio without `CAMPFIRE_URL` still accepts `CAMPFIRE_ACTOR_ID` so Sprint 001 stays deterministic. **HTTP mode does not.** The team-share path is `campfire serve` + tokens.
2. Fixture tokens are labeled secrets in seed (`cft_fixture_*`), not production credentials.
3. Two-machine proof is two HTTP clients against one server process, not a week of real laptops.
4. No TLS, SSO, or invite expiry.
5. Viewer was not built (intentionally).

---

## 5. Recommendation

```text
GO
```

The hosted identity boundary is real: tokens, invites, one writer. Local file mode remains the test/dev path.

---

## 6. Next

Sprint 006 is Gate C (multi-participant value on the hosted instance). Viewer 001 should wait until this HTTP/token architecture is the one the UI talks to. Do not start Viewer in this tree until a Viewer sprint doc exists.
