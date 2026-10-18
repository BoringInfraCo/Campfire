# Campfire v1.22.1 — ONB-001: First-Run Handoff

**Date:** October 18, 2026  
**Status:** Proposed sprint contract. No ONB-001 implementation, result, version bump, or release decision is recorded here. Freeze the baseline and this contract before product code changes.  
**Baseline:** Published and deployed `v1.22.0` (private annotated tag `83d0602` → commit `1b9432d`; package `1.22.0`). The later channel-pin and release-record commits do not redefine the product baseline. See `docs/RELEASE_V1_22_DECISION.md`.  
**Roadmap:** `docs/ROADMAP.md`, post-v1.21 Navigator sequence.  
**Release shape:** Candidate patch `v1.22.1` only while this remains a presentation and recovery repair over the existing commands. A release requires a separate recorded founder decision.

## 0. Sprint question

> After Campfire prepares a human profile and a supported harness, can a person tell exactly what is ready, what still requires a harness reload, and how to start or join authorized work without treating an example configuration file or three commands as mandatory setup?

This sprint repairs the last handoff of the existing first-run flow. It does not remove the harness's reload or approval step, create a workspace before the person starts work, or change enrollment authority. The product claim to earn is **clear next action and truthful readiness**, not one-click activation or observed team adoption.

The current interactive `campfire` already asks for the human once and calls `up` in the same invocation. `campfire up` is the later/manual listener command. `campfire onboard` is the one-shot scripted path that creates one human, agent, workspace, and goal; it is not the next command after `campfire`. The v1.22.0 docs/help correction states this, but the live terminal still says `Agents none connected yet` or prints agent names after merely writing harness configuration. A person can mistake *configured* for *loaded in a running agent*. The no-workspace Viewer and status surfaces say only that they are waiting for an agent. The join path is a separate invitation flow and must be chosen on a fresh or isolated recipient profile, before creating a local first-run profile.

## 1. Target journeys and screen contract

### A. Fresh local operator with Codex or OpenCode installed

The user runs `campfire` once. Name confirmation, local credential storage, harness detection, `up`, Viewer launch, and the first-run server lifetime retain their v1.22.0 behavior. After the API and Viewer actually bind, the human receipt reports:

```text
Campfire is running for Sergio.
Workspace  None yet
Codex      Config prepared — restart Codex to load Campfire tools
Viewer     http://127.0.0.1:<actual-port>

Next: Restart Codex. In that session, describe the work you want to do;
your agent can create a Campfire workspace and goal with you.
```

This is illustrative wording, not a requirement to hard-code Codex or a port. Show only detected and successfully prepared supported harnesses, using their real names. If both are prepared, name both and give one next action. A written MCP block is **configuration prepared**, never proof that a live harness loaded the tools, registered a Campfire session, or read a workspace. The receipt must not say `connected`, `online`, `ready to work`, or `workspace created` for unobserved steps. Existing tokens, actor IDs, and local credential paths stay out of human output.

### B. No supported harness, or connection deliberately skipped

If no supported Codex/OpenCode installation is detected, Campfire may still start the local API and Viewer. Say `No supported harness detected` and give the bounded recovery: install one, then restart Campfire with `campfire up`; do not imply an agent was created or configured. If `--no-connect` was passed, say connection setup was skipped by that flag and give the same manual next step without calling it a detection failure. If a supported harness is detected but configuration is not prepared, report that state and a specific safe recovery; do not print a success receipt or suggest a reload will fix an unwritten block. An actual setup error remains a nonzero error, with any prior profile/credential state recoverable through the existing `campfire up` path; no reset or duplicate `onboard` advice.

### C. Returning local operator

Plain `campfire` continues to print status without silently starting a long-lived listener or rewriting harness configuration. With no workspace, it says `No workspace yet` and gives `campfire up` as the way to reopen/reprepare Campfire, followed by the agent-side work instruction. With a stored workspace selection, it labels that name/goal as local profile data and gives a primary route to current authorized work (`campfire status` or `campfire dashboard`), plus `campfire up` when the listener/Viewer is needed. The profile is only a selector; the receipt must not claim current service state, live agent presence, or complete workspace coverage from a stored profile.

### D. Teammate joining existing work

The invitation path remains `campfire join --invitation-file <private-file> --human-name <name> --harness codex|opencode` on a fresh or isolated recipient profile. Installer, quick-start, and help text distinguish this from starting a new local workspace **before** recommending `campfire`. After a successful join, the human receipt distinguishes `joined workspace` from `harness config prepared`; it instructs the recipient to run `campfire up`, reload the named harness, approve Campfire tools if asked, and begin from the joined workspace. No invitation secret, bearer token, or private file contents appear in a human receipt or Viewer. An invalid/expired/used invitation remains a failure with the existing recovery rules and creates no misleading local first-run success screen.

### E. Read-only Viewer with no workspace

Replace the bare waiting text with a short, truthful next action: this Viewer has no workspace to show yet; after reloading a configured agent, describe the work so the agent can create the workspace and goal. Do not add a Viewer write control, fake sample workspace, silent import, or terminal/agent presence indicator. If the Viewer is opened for a joined remote profile, it must not suggest creating a local workspace. Keep the selected actor's authorization and the current read allowlist unchanged.

## 2. Scope and implementation map

| Surface | Bounded change |
| --- | --- |
| `src/cli/index.ts` / small presentation helper | Render accurate human receipts for fresh `campfire`/local `up`, returning local status, `--no-connect`, and successful recipient `join`/remote `up`. Use actual detection/preparation results and actual bound Viewer URL. Keep commands and JSON contracts intact. |
| `src/bootstrap/profile.ts` / `src/cli/projections.ts` as needed | Correct no-workspace and existing-workspace status guidance without treating cached profile data as proof of service readiness. Prefer one reusable human next-step vocabulary over copied strings. |
| `src/viewer/static/app.js` and synced `public/` assets | Correct only the no-workspace empty state; keep Viewer read-only, escaped, actor-bound, and visually compact. |
| Installer/help/README/`docs/OPERATOR.md` | Present two entry paths: local `campfire`, or invitation-file `campfire join` on a fresh/isolated recipient profile. Treat `onboard` as the scripted alternative. Avoid a TOML permissions example in first-run guidance. |
| Tests and evidence | Focus on actual terminal output, join recovery, the empty Viewer, cross-surface wording, and packaging of the published copy. |

Prefer a small pure receipt formatter if it prevents copy drift. Do not add a domain object, new CLI command, new HTTP/MCP method, new telemetry field, or a generalized setup-state machine.

## 3. Explicit boundaries

1. **No automatic harness reload or approval.** Campfire writes supported MCP configuration. It cannot assert that Codex/OpenCode has reloaded or that the user approved tools. Do not kill, restart, or control a harness process.
2. **No automatic agent session registration or work creation.** The agent reads the authorized workspace state before work and calls `register_agent_session` before contributing. With no workspace, it may create one and a goal through the existing authorized path when the person starts work. The CLI and Viewer do not invent a goal, infer it from a repository, or ingest past transcripts.
3. **No enrollment shortcut.** Do not make an invitation work inside an already initialized local profile by bypassing the recipient-owned join boundary. Do not relax expiry, single-use, endpoint, actor, or workspace checks.
4. **No pretend capability policy.** `repo:read`, `repo:write`, `tests:run`, and `deploy:prod` in the screenshot are not an enforceable v1.22.0 Campfire policy surface. No TOML capability block, deploy guarantee, or agent sandbox claim enters onboarding.
5. **No protocol drift.** Existing `--output json`, `--json`, non-TTY output, token-printing rules, MCP, HTTP, Viewer allowlist, database schema, and installer channels retain their contracts. Human-only guidance must not contaminate machine-readable stdout. No raw terminal controls in a pipe.
6. **Patch stop rule.** If a proposed repair needs new persisted state, automatic workspace creation, new join semantics, an agent runtime hook, broader Viewer writes, or a new public API, stop and re-scope it as a separate minor sprint. Do not smuggle that work into `v1.22.1`.

## 4. Step 0 — freeze the released comparison

Before product code changes, commit a dated baseline packet under `docs/evidence/onb-001/`:

- Resolve and record the private `v1.22.0` tag object/commit, package version, published archive/install channel, and current source HEAD. Capture the v1.22.0 human text and explicit JSON outputs separately.
- Use isolated `CAMPFIRE_CONFIG_DIR`, database, temporary harness config paths, and loopback ports. Never touch a developer's real profile or print/persist actual bearer tokens in evidence.
- Capture the four journey states above plus `--no-connect`, `--no-open`, no supported harness, a prepared configuration whose harness has **not** reloaded, a returning profile, and an invalid/expired invitation. Label simulated harness detection as simulated, and a real Codex/OpenCode launch as real.
- Freeze an answer key for each state: what Campfire knows, what it cannot know, the correct next command or human action, whether a workspace exists, and which output may contain a one-time credential. Mask dynamic ports, clock lines, and random IDs only with recorded deterministic rules.
- Record that the screenshot's TOML configuration is an illustrative example, not a supported first-run input. Pin the exact user-facing strings in the released CLI/Viewer/installer that caused ambiguity.

The baseline packet is engineering evidence, not a user-study result. No screenshot or fixture may contain an invitation secret, token, private transcript, or unrelated workspace data.

## 5. Build sequence

| Step | Work | Exit |
| --- | --- | --- |
| **0 — baseline** | Freeze the published v1.22.0 paths and the state/next-action key above. | Another engineer can reproduce every path without a real profile or guessing what was simulated. |
| **1 — receipt language** | Implement local/remote human receipt and status wording from actual preparation results; retain the existing command dispatch and JSON shape. | Each state has one truthful primary next action and no false `connected` or `ready` claim. |
| **2 — empty Viewer and guidance** | Align the no-workspace Viewer with the receipt; fix installer, help, README, and operator examples. Sync public assets. | The first-run paths agree on local start versus invitation join, with no Viewer write path. |
| **3 — verification** | Run focused tests and direct TTY/Viewer inspection, then typecheck, full suite, build, packaging, export comparison, and deployment dry run. Record a separate human-use outcome when eligible. | `docs/SPRINT_ONB_001_RESULT.md` states exact candidate, deterministic checks, deviations, and observed or NOT OBSERVED human result. |

## 6. Deterministic acceptance checks

| Check | Required evidence |
| --- | --- |
| **D1 — fresh local truth** | A fresh interactive `campfire` still asks only for the human, starts `up` once, shows the actual Viewer URL, names only successfully prepared harness configs, and says reload is required. It does not claim a live agent, registered session, or created workspace. Both supported harnesses and one-harness cases pass. |
| **D2 — absent/skipped/recovery truth** | No-harness, `--no-connect`, config-preparation failure, returning no-workspace profile, and returning existing-workspace profile each receive a specific next step with no duplicate `onboard`, fabricated success, or hidden partial failure. Retry is idempotent under existing state rules. |
| **D3 — invitation boundary** | A fresh recipient can use the existing invitation-file join path and then `up`; success distinguishes membership from prepared config and reload. Invalid, expired, used, or wrong-endpoint invitations stay denied and do not fall back to local first-run. An initialized local profile receives the existing refusal/recovery rather than a covert merge. |
| **D4 — Viewer and source parity** | The no-workspace Viewer tells the same truth as CLI guidance, stays read-only and actor-bound, and escapes untrusted names. A joined remote profile is not told to create a new local workspace. Served `public/` assets match the edited `src/viewer/static/` files. |
| **D5 — credentials, output, compatibility** | Human receipts, help, Viewer, screenshots, and error paths contain no token/invitation secret. Explicit JSON and piped/non-TTY contracts are byte- or schema-compatible as applicable; `onboard` still requires explicit JSON to emit its one-time credential receipt, while other credential-minting commands retain their existing contracts. No MCP/HTTP/schema/auth/telemetry change or new session side effect appears. |
| **D6 — release hygiene** | Focused first-run/join/Viewer tests, typecheck, full relevant suite, build, `pack:tarball`, export/public-copy check, and `deploy:dry-run` pass from the candidate revision. Capture a real terminal frame and inspect a real served empty Viewer. Any expected pre-pin install-channel assertion is named and later closed after a separately approved release, not weakened. |

Use focused tests for the changed receipt states, not a test for every line of prose. A direct terminal/browser check is required because the confusion is in human-visible composition. Do not broaden testing after the checks above pass unless a concrete risk remains.

## 7. Human-use check and verdict

If eligible non-builder people are available, pre-register a cold comparison against the released v1.22.0 flow before showing either output. Give each person a fresh local scenario and a separate invitation scenario without telling them the correct command or preferred action. Ask them to (1) identify what has actually been configured versus what still needs reload/approval, (2) reach the correct first-work route, (3) distinguish `campfire`, `campfire up`, `onboard`, and invitation join, and (4) explain whether a workspace or agent session exists. Record commands attempted, time to correct next action, confusion, wrong authorization/presence claims, and the source line they relied on. Counterbalance baseline/candidate order when two participants are available. A builder rehearsal, scripted capture, or agent acting as a human is debugging evidence only.

- **GO — bounded onboarding clarity:** D1–D6 pass and the pre-registered cold participants choose the correct path in both scenarios without credential exposure, unauthorized join, false readiness, or an invented workspace/session. Report actual counts and times; do not generalize beyond those participants.
- **CONDITIONAL GO — engineering candidate:** D1–D6 pass but the human check is unavailable for a recorded reason. Claim only that the new receipts and empty state satisfy the tested truth and recovery rules; human comprehension is **NOT OBSERVED**.
- **NO-GO / REFRAME:** Any token/invitation leak, enrollment bypass, false connection or permission claim, JSON/protocol break, misleading recovery, or uncontained new behavior persists; or the patch stop rule is crossed.

ONB-001 does not close NAV-001's two-human comparison, WCO-001, ARH-001, ATT-001, SWH-001, UIX-001, VIS-001 condition 4, or Gate B/C/E/F. Each keeps its own frozen rubric. A `v1.22.1` bump, tag, public snapshot, installer pin, or deployment requires a **separate recorded founder release decision** naming the exact shipped behavior and human outcome; engineering PASS alone is not that decision.

## 8. Deliverables

1. A committed v1.22.0 baseline pin and sanitized first-run/return/join captures, frozen before implementation.
2. Patch-scoped CLI and Viewer guidance using the existing setup, workspace, and enrollment contracts.
3. Focused D1–D6 evidence, real terminal/served-Viewer inspection, and an independent review of credential and readiness wording.
4. `docs/SPRINT_ONB_001_RESULT.md` with the exact candidate commit, checks, deviations, human outcome or NOT OBSERVED reason, and verdict.
5. A separate release decision if the founder elects to publish `v1.22.1`.
