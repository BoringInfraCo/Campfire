# Campfire — Sprint 007 Result

**Status:** Complete (GO)  
**Sprint:** 007 — Harness Readiness Preflight  
**Date:** September 24, 2026  
**Company:** Boring Infra Co.  
**Depends on:** Founder Dogfood 001 exploratory evidence  

---

## 1. Result

Sprint 007 now provides a read-only, workspace-scoped readiness contract for
hosted Campfire. The CLI, MCP tool, synchronous HTTP path, and Workers/D1 path
require a workspace ID, resolve the token-bound actor, verify workspace
authorization, and validate an agent session for that exact workspace.

Missing, ended, wrong-actor, and wrong-workspace sessions direct the caller to
the existing explicit `register_agent_session` operation. Workspace existence
and participant requirements remain distinct errors. Preflight does not
register a session or mutate Campfire state.

## 2. What landed

| Surface | Behavior |
| --- | --- |
| CLI | `campfire preflight <workspaceId>` with `--workspace` support, human output, `--json`, and deterministic hosted errors |
| MCP | Required `workspaceId` input and workspace-scoped `preflight` tool |
| HTTP | Required-workspace dispatch and actionable preflight error details |
| Application service | Actor/workspace authorization followed by exact active-session validation |
| Workers/D1 | Async dispatch and service parity through the same readiness semantics |
| Hosted error safety | Remote preflight and MCP identity/startup errors keep safe codes but replace remote messages/details with deterministic text |
| Harness evidence | Equivalent Codex and OpenCode readiness through real token-authenticated hosted HTTP and remote MCP resolution |

## 3. Validation

```text
npm run typecheck
PASS

npx vitest run tests/unit/cli.test.ts tests/integration/http.test.ts \
  tests/integration/mcp.test.ts tests/integration/hosted-mcp.test.ts \
  tests/worker/async-service.test.ts
PASS — 5 files, 62 tests

npm test
PASS — 24 files, 242 tests

git diff --check
PASS
```

Focused coverage verifies:

- required workspace IDs at CLI, MCP schema, HTTP, sync service, and async
  service boundaries;
- human-readable and JSON preflight output;
- no local SQLite fallback from hosted preflight;
- actionable missing, ended, wrong-actor, and wrong-workspace session failures;
- accurate workspace-not-found and participant-required failures;
- no contribution mutation during readiness;
- token-bearing remote message/details are not re-emitted by hosted preflight
  or remote MCP identity/startup handling;
- equivalent Codex and OpenCode MCP readiness through a hosted HTTP endpoint,
  token resolution, and remote MCP tool calls;
- Workers/D1 dispatch, service, and handler parity.

## 4. Architecture and scope

- No schema or migration changed.
- No domain object or lifecycle was added.
- No authorization policy changed.
- No automatic session registration or hidden mutation was introduced.
- No Viewer, orchestration, scheduling, analytics, or Field Trace work was added.
- Harness names remain adapter metadata and do not enter the domain.

## 5. Limitations

1. Codex and OpenCode were exercised through deterministic hosted HTTP/MCP
   configuration and fixture identities. Vendor binaries were not run for this
   implementation.
2. Workers/D1 behavior was covered through the repository's async service and
   handler test structure; no live Cloudflare D1 deployment was exercised.
3. Preflight reports readiness only. It deliberately does not repair
   configuration or register an agent session.
4. Field Trace 001 was paused during Sprint 007 and was later cancelled by
   founder decision. This result makes no Gate B or Gate C field claim.

## 6. Recommendation

```text
GO
```

The review blockers are resolved with focused hosted and parity evidence. Stop
here; select later work from new evidence rather than extending preflight into
setup automation.
