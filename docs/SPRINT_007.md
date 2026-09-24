# Campfire — Sprint 007: Harness Readiness Preflight

**Status:** Complete (GO)
**Sprint:** 007 — Harness Readiness Preflight  
**Date:** September 24, 2026  
**Company:** Boring Infra Co.  
**Depends on:** Founder Dogfood 001 exploratory evidence  
**Substrate:** Stage B team-hosted SQLite/HTTP  

---

## 1. Sprint thesis

A harness should fail fast, with an actionable message, when its Campfire
connection or agent-session setup is not ready.

The preflight must be deterministic and harness-neutral. It must validate the
boundary before normal work begins without changing authorization policy,
persisting new domain state, or silently repairing configuration.

Supporting evidence is private Founder Dogfood 001 material under
`evidence/founder-dogfood-001/`; that evidence is exploratory and is not the
implementation contract.

---

## 2. Scope

Implement one narrow readiness check at the CLI/MCP boundary:

1. **Endpoint reachability**
   - Validate that a configured hosted Campfire endpoint is reachable.
   - Fail before workspace retrieval when the endpoint is unavailable.
   - Do not expose bearer-token values in errors or logs.

2. **Token and resolved actor identity**
   - Validate that a remote token is present and usable.
   - Resolve and report the authenticated actor identity through the existing
     identity path.
   - Do not accept a local fallback identity when hosted mode was explicitly
     configured.

3. **Agent-session readiness**
   - Require an explicit workspace ID at the service, CLI, MCP, and HTTP
     boundaries.
   - Check actor/workspace authorization and detect whether an agent has an
     active session for that exact workspace, ready for its first workspace
     write.
   - Return an actionable message identifying the existing explicit
     `register_agent_session` step when readiness is missing.
   - Do not automatically register a session or mutate Campfire state during a
     read-only preflight.

4. **Actionable errors**
   - Human output must state what failed and the next corrective action.
   - `--json` output must expose the same condition through a stable structured
     error code and message, with no token material.
   - The same readiness condition must not produce harness-specific error
     contracts.

5. **Cross-harness consistency**
   - Codex and OpenCode configurations that satisfy the same endpoint, token,
     identity, and session conditions must pass.
   - Harness-specific configuration remains outside the domain and application
     layers.

---

## 3. Acceptance criteria

- A missing hosted endpoint fails before normal workspace work with an
  actionable human error and a structured `--json` error.
- An unreachable hosted endpoint fails before unauthorized or unrelated state
  retrieval.
- A missing or invalid token fails with an actionable identity/authentication
  error; the token is never printed or logged.
- Hosted mode never silently falls back to a local SQLite identity.
- An agent without a required registered session for the requested workspace
  receives an actionable preflight error before its first write and is directed
  to the existing explicit session-registration operation. Missing, ended,
  wrong-actor, and wrong-workspace sessions fail the same readiness check.
- A valid Codex configuration passes.
- A valid OpenCode configuration passes.
- Equivalent failures produce equivalent human and JSON error shapes regardless
  of harness.
- Existing authorization checks remain in force before retrieval and mutation.
- No preflight operation creates or changes a workspace, Goal, Task, Finding,
  Decision, Artifact, Contribution, token, or agent session.
- No schema, migration, domain-object, Viewer, orchestration, scheduling, or
  hidden automatic mutation is added.
- Typecheck, the full test suite, and relevant acceptance checks pass.

---

## 4. Out of scope

- Schema or migration changes.
- New domain objects or generalized lifecycle abstractions.
- Automatic `register_agent_session` or other write-capable repair behavior.
- Changes to authorization policy or token semantics.
- Viewer 003.
- Orchestration, scheduling, delegation, capability management, or shared
  compute.
- New analytics or durable retrieval telemetry.
- Field Trace 001 gate claims or changes to its qualification requirements.
- Release packaging or unrelated CLI features.

---

## 5. Implementation boundary

The preflight belongs at the CLI/MCP adapter boundary and may reuse existing
application, authorization, identity, and session operations. It must not put
harness-specific knowledge into the domain, change persistence, or introduce a
second readiness state.

The implementation must remain reversible and boring: deterministic checks,
typed errors, focused tests, and no speculative abstraction.

---

## 6. Definition of done

Sprint 007 is complete only when:

1. The readiness check is implemented at the CLI/MCP boundary.
2. Endpoint, token, actor identity, and agent-session cases have focused tests.
3. Human and `--json` failures are actionable and token-safe.
4. Codex and OpenCode pass equivalent valid configurations.
5. Existing authorization and transcript-isolation behavior remains intact.
6. No out-of-scope product surface is changed.
7. A result document records evidence, limitations, and the explicit follow-up
   decision.

Implementation may begin only after this contract is reviewed and explicitly
authorized. Field Trace 001 remained paused during Sprint 007 and was later
cancelled by founder decision.
