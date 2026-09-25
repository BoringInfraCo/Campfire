# Campfire — Sprint 015 Result: Zero-to-Shared-Workspace Onboarding

**Status:** Complete (**GO**)
**Date:** September 25, 2026
**Release:** `v1.3.0`
**Depends on:** Sprint 014 — Trust the Operator Path (**GO**); `v1.2.1` released
**Primary metric:** Time to First Shared Workspace

---

## 1. Result

A first-run operator can create one real human, one agent that human owns, one
workspace, and one goal with `campfire onboard`. The receipt separates the
operator token from the harness token and names the absolute database path.
Server startup and agent-session registration stay explicit. A fresh Codex
process, given only the agent connection and the workspace id, registered a
session, passed preflight, and reported the goal and both participants.

Recommendation: **GO**.

Onboard on a clean temporary database took 0.41 seconds. The successful Codex
entry, including server startup, took about 23 seconds. Operator interventions
inside Campfire: none. One harness-side intervention: Codex's non-interactive
approval policy `never` refused the MCP tool call. The same fresh Codex home,
allowed to run tools, completed the entry. That is a Codex approval setting,
not Campfire identifier plumbing.

This is one setup proof. Gate B, Gate C, retention, adoption, and
product-market fit remain unmeasured.

The operator authorized publication as minor release `v1.3.0`. Onboarding is
new user-facing capability, existing commands and installations stay
compatible, and there is no schema or breaking change, so this is not a patch
and not a major version. Promotion evidence is in section 5.

OpenCode was not given a second live trace. The Codex trace showed no
harness-specific onboarding behavior. The command stores the supplied harness
label and the hosted path is the same for every harness.

---

## 2. What changed

`campfire onboard` composes the existing bootstrap and service operations
inside one database transaction:

1. refuse when a human or workspace already exists;
2. ensure the configured organization and team;
3. create the first human through the tokenless empty-human boundary;
4. create one agent owned by that human, with the supplied harness label;
5. create one active workspace (the human joins as owner);
6. create one active goal whose title is the supplied text;
7. invite the agent with role `agent` and consume that invite as the agent.

A throw rolls the transaction back, so a later failure does not leave a human,
a token, or a workspace. Blank flags fail before the database file is created.
There is no `--force` or reset. The command does not register an agent session
and does not start the server.

Default output is a short receipt. `--json` returns the ids, actor types,
workspace and goal state, absolute database path, both one-time tokens, and
the next-step metadata. Each raw token is printed once. The next-step text
says to use the agent token printed above.

README, the public snapshot README quick start, operator guidance, and CLI
help now lead with onboard. `seed --reset` stays labeled as the deterministic
demo fixture.

No schema, domain type, authorization rule, or package version change.

---

## 3. Validation

Node 22.23.2:

```text
npm run typecheck                 PASS
npm run test:unit                 PASS — 16 files / 231 tests
npm run test:integration          PASS — 9 files / 81 tests
npm run test:acceptance           PASS — 3 files / 8 tests
npm test                          PASS — 31 files / 344 tests
npm run build                     PASS
npm run pack:tarball              PASS — darwin-arm64
                                  sha256 f46d18601797555e046c8488b88130ac910ae9bb6485bc612e28b12ea6f1e77b
```

Focused tests cover the created rows, owner and agent roles, provenance,
token resolution, token absence from stored rows and stderr, the text and
JSON receipts, missing flags, rerun and seeded-database refusal, transaction
rollback, and the hosted path: no token is unauthorized, an actor id is not a
bearer token, agent preflight fails before `register_agent_session` and
succeeds after it, and context retrieval returns the goal and both
participants.

### Cold packaged smoke

A temporary prefix installed the local `v1.2.1` archive. The installed binary
was 1.2.1. `onboard --help` listed the command. One onboard created workspace
`ws_35f88b78366f4eab`, human `hum_05ec0105fb804570`, and agent
`agt_5df803d6e08a4e27`, with goal "Ship the billing migration safely". Stderr
did not contain either token. A second onboard exited 1 and named the granular
commands. The operator's normal database was not used.

Before any session existed, hosted checks showed:

- missing bearer token: 401
- an actor id used as a bearer token: 401
- human token `whoami`: human
- agent token `whoami`: agent
- agent `preflight`: not ready, and the message names `register_agent_session`
- human context read: the same goal title

### Codex entry

A fresh Codex home had only Campfire's MCP server, pointed at the installed
`campfire mcp` binary with `CAMPFIRE_URL`, the agent token, and
`CAMPFIRE_HARNESS=codex`. Its working directory was an empty temporary
directory, not this repository.

The first invocation, with approval policy `never`, saw the server and stopped
when `whoami` required approval. No Campfire write occurred.

The second invocation allowed tools. Codex called `whoami`,
`register_agent_session` for that workspace as harness `codex`, `preflight`,
and `get_workspace_context`. Preflight was ready with session
`ses_20e3d92037a34734`. Codex reported goal "Ship the billing migration safely"
and participants Sergio (owner) and Codex (agent). The only new contribution
was that session registration. Findings, tasks, and decisions stayed empty.
The captured Codex output did not contain either raw token.

---

## 4. Deviations

None in the collaboration model. The outer database transaction is the
existing SQLite transaction, used so the composition cannot leave a partial
workspace. It is not a workflow engine.

---

## 5. Release promotion

- Private tag `v1.3.0` points to
  `377cb71cc416efdac1650d6f67ccb88bed621e40`.
- The audited export of that tag wrote 141 files and passed the
  forbidden-path and forbidden-content audit. The four new paths since the
  137-file `v1.2.1` snapshot are `public/campfire/v1.3.0/install.sh`,
  `src/bootstrap/onboard.ts`, `tests/unit/onboard.test.ts`, and
  `tests/integration/onboard-hosted.test.ts`.
- Public snapshot commit `7748ce1324032b1c45b3a13193cee9ea4dbdd57d` is tagged
  `v1.3.0`.
- Public main CI run `36135981161` and tag CI run `36135983122` both passed
  typecheck, build, the full test suite, and the blank-database bootstrap smoke.
- The GitHub Release is
  <https://github.com/BoringInfraCo/Campfire/releases/tag/v1.3.0>.
- Release-tarball run `36136081817` built and checksum-verified Darwin ARM64,
  Darwin x64, Linux ARM64, and Linux x64. All four archives and all four
  `.sha256` files are attached.
- Live migration through the credential-safe wrapper reported no migrations
  to apply. No D1 identifier was printed.
- Production deploy succeeded as Cloudflare Worker version
  `13275140-aad5-4b96-abf2-d937c1bdf61a`.
- `https://boringinfra.company/campfire/install.sh`,
  `https://boringinfra.company/campfire/v1.3.0/install.sh`, and
  `https://boringinfra.company/campfire/v1.2.1/install.sh` each matched the
  tracked installer bytes (sha256
  `c539f8a51e7f763ddd2e29b637add8f214dc8f7ff1329a6546d5e613dd4b5217`).
  The installer script is unchanged from `v1.2.1`; the package inside the
  `v1.3.0` archive is `1.3.0`.
- Clean latest and pinned production installs both verified Darwin ARM64
  archive sha256
  `9832aa7c916e95df9af3a1a9f225b1ca8f77ad0261164ded3410b5c1111f5954`,
  installed package metadata `1.3.0`, reported `Installed campfire 1.3.0`,
  and `campfire onboard --help` lists the new command.

The prior `v1.0.0`, `v1.1.0`, `v1.2.0`, and `v1.2.1` versioned installers and
release tags remain unchanged.

---

## 6. Acceptance decision

Sprint 015 is **GO** because:

1. one documented command creates a non-fixture human, agent, workspace, goal,
   invite, and memberships;
2. identities, ownership, credentials, and provenance stay distinct;
3. the goal is visible through normal context retrieval;
4. initial creation does not chain manual ids;
5. the receipt separates operator and harness credentials;
6. tokens are not stored in rows, contributions, or error text;
7. rerun and seeded state fail closed;
8. serve and session registration stay explicit;
9. a fresh Codex process reached ready and read the workspace from the receipt;
10. the quick start no longer presents `seed --reset` as the real first run;
11. no schema, authorization, or orchestration behavior was added; and
12. the Node 22 matrix passed.

Not claimed: OpenCode live entry, Gate B, Gate C, or product-market fit.

Sprint 016 is not defined or authorized by this result.
