# WCO-001 baseline — shipped v1.17.0

**Date:** October 15, 2026
**Contract:** `docs/Campfire-v1.18-WCO-001-Continue-the-Work.md` §4.1
**Purpose:** record the exact source, package, and surface behavior used for the
first continuation attempt before any product code changed.

## 1. Source identity

| Item | Value |
| --- | --- |
| Release pin | private annotated tag `v1.17.0` → commit `2b98c752531116654871d285142a55a7441ab665` ("Prepare v1.17.0 Shared Work Home release under founder override") |
| Package version | `1.17.0` (`git show v1.17.0:package.json`) |
| Development HEAD at the attempt | `954fef93b07a9403be69dc1b45e90845b0c1704c`; uncommitted documentation edits at attempt time: `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, plus the untracked WCO-001 contract |
| Product-source equality | `git diff v1.17.0 -- src tests public fixtures migrations` was empty at the attempt: the attempt ran the shipped product source byte-for-byte. (After the Amendment 1 repair this diff shows exactly the repair; the attempt predates it.) |
| Node | v22.23.2 |

**Hash method:** `git show <ref>:<path> | shasum -a 256` on the committed tree
(never the working tree or an extracted archive).

| Path at `v1.17.0` | sha256 |
| --- | --- |
| `package.json` | `7eb2a8bf71037f70f94b9f0d3007ef7f50e9b94fdf3d601034eda1a01acabf62` |
| `src/cli/index.ts` | `b3e2108077e397841320a178d2e50ff29b6498fac4bccf28b3a5d728d02b0ff7` |
| `src/cli/catalog.ts` | `fb1eb2dda0ab641b65242481cb4a69cc46d3d68dd863c9ba0468c8ab9c5dc460` |
| `src/mcp/tools.ts` | `901717541beae9fe84215acf8fbd3137d4706e78e4e46923dbd1d38585d29748` |
| `src/mcp/instructions.ts` | `99072cc3720e5c24c9e9c190016f5a5d81df82e020929d01d444a26b05ba9f44` |
| `src/service/campfire-service.ts` | `be53361bc7d041a5e8d0b3ceb824f18e0f674ab5b1acb185bf77d2657ba26648` |
| `src/service/context-assembly.ts` | `83b765df170712b8eb42486d379eefa9244b6cd87ffce2fa48301f3c40e7868d` |
| `src/service/service.ts` | `d7be4eb4fe1bd55c635823fc3713bd9a7738305d4bef0e8fb3a3acdfd57ebd37` |
| `src/viewer/server.ts` | `0b3b982eb29d56878d7028103a915ad2958a2ada6a6570e3b4834540dbfae461` (allowlist `VIEWER_READ_METHODS` = `whoami`, `list_workspaces`, `get_workspace`, `get_workspace_context`, `get_activity`) |
| `src/viewer/static/index.html` | `74120d2f33dd4e0e8b3c3421fb8d32a45c313c3e38b2ce1120b1552b37fec5dd` |
| `src/viewer/static/app.js` | `1ab9c42a70e9377772d446e70f74e78bdd2c28e4095114b789c95071808da632` |
| `src/viewer/static/app.css` | `d543d210fa1e9b4b0782c26e2894a2601533274b840f1269a92f1255757c607b` |
| `src/store/schema.sql` | `ed66096ef4dec0aedf99f0c102cc12ebc46a034854f2c0c039d25e0c44e6177e` |
| `src/domain/types.ts` | `1a63cca200cd08c06bc1d7f968c9221058ae6e7882553d03d737b9ae8daee301` |

The local release archive used by the continuation attempt:
`release/campfire-darwin-arm64.tar.gz`, sha256
`f5105a00f5b844b32952b06a51336ee19a4ca58bfacf18ddcbec8b0a1b7cd151`, matching
`release/campfire-darwin-arm64.tar.gz.sha256`; it contains the package at
`lib/campfire/` with `dist/src/viewer/static/{index.html,app.js,app.css,mark.svg}`.

## 2. Shipped surface behavior relevant to continuation

- **Enrollment.** `campfire onboard` creates the first human, their owned agent,
  the workspace, and the goal. `campfire invite-teammate <ws> --out <file> --url
  <endpoint> [--allow-loopback]` issues a one-time invitation (owner only);
  `campfire join --invitation-file <file> --human-name <name> --harness
  codex|opencode` redeems it into recipient-owned credentials. Invitation
  authority is separate from actor credentials.
- **Task.** Title, description, status (`open`, `in_progress`, `blocked`,
  `completed`), optional assignee, provenance. `update_task` changes status,
  title, description, or assignee for any *writing* participant and records one
  Contribution; the `viewer` role is denied all task writes. There is no task
  dependency graph and no structured blocker field.
- **Decision.** `proposed → accepted | superseded`; `retire_decision` maps
  proposed→rejected, accepted→superseded; `add_decision --replaces` requires an
  accepted predecessor and `accept_decision` requires a reason when replacing.
  `needsReview` is computed at read time when a current decision cites a
  non-current finding. An accepted decision is not automatically the operative
  one.
- **Finding.** `current | superseded | withdrawn`; corrections record a
  successor and never edit the old assertion; evidence citations are explicit
  rows with relation `supports | contradicts`.
- **Orientation.** `get_workspace_context` (schema v1) returns bounded slices
  (`decisions`, `findings`, `tasks`, `blockers`, `artifacts`, `recentChanges`)
  each with `total`, `returned`, `truncated`; legacy arrays; provenance window;
  `needsYou` / `needsAttention`; `currentWork`; `suggestedNextAction`
  (`orientationHint: true`, never an instruction); `alignment`;
  `historicalCounts`; and an opaque `orientationCursor` for
  `get_workspace_changes` catch-up. Attention reasons are stable labels:
  `proposed_decision_actionable`, `assigned_blocked_task`, `assigned_open_task`,
  `team_proposed_decision`, `unassigned_blocked_task`, `team_blocked_task`,
  `team_open_task`.
- **CLI.** `campfire capabilities --output json` advertises 58 commands in this
  tree (start/workspace/recover/discover/admin groups). Continuation-relevant
  reads: `status`, `show`, `context`, `catch-up`, `tasks`, `findings`,
  `decisions`, `artifacts`, `inspect`, `activity`, `changes`, `recall`,
  `handoff-packet`; writes: `create-task`, `update-task`, `add-finding`,
  `correct-finding`, `withdraw-finding`, `cite-evidence`, `add-decision`,
  `cite-basis`, `accept-decision`, `retire-decision`, `add-artifact`.
- **MCP.** 36 tools by default plus opt-in `get_playbook`
  (`CAMPFIRE_PLAYBOOK=1`). The server binds one actor at startup; no tool accepts
  an acting actor id. Agent writes require `register_agent_session`; sessions
  may also be supplied via `CAMPFIRE_SESSION_ID` / `--session`. Session-start
  instructions (`SESSION_INSTRUCTIONS`) tell a connecting agent to read the
  workspace before acting and not to treat `suggestedNextAction` as an order.
- **Viewer.** Read-only, actor-bound, loopback by default; five-method
  allowlist; non-allowlisted `/api/call` methods return 403 before the service
  call; the browser holds no token. v1.17 adds My work / Team work perspectives
  over the same authorized reads.
- **Provenance.** Every meaningful mutation writes exactly one Contribution in
  the same transaction, carrying the acting `{actorId, actorType}` and, for
  agents, the `agentSessionId`; `who contributed this / through which agent / on
  whose behalf` is inspectable. Storage parity: local SQLite and hosted
  Worker/D1 share the method surface; D1 migrations are additive.

## 3. First continuation-attempt status

- **Human case: NOT OBSERVED.** No two-human pair was available in the
  engineering session. Contract §4.1: "If no eligible team or task is available,
  record **not observed** and continue only with engineering preparation. A
  simulated pair is a rehearsal, not the sprint's human result."
- **Engineering preparation performed:** one single-operator rehearsal on the
  shipped source above, recorded in `REHEARSAL.md`. It opened no C-item, and no
  product code changed before it ran.
- The rehearsal witnessed two frictions; the dated **Amendment 1** in the
  contract scopes the smallest repair. The baseline above is the unchanged
  before-position and is not rescored by any later run.

## 4. What this establishes / does not establish

- Establishes: the exact shipped tree and surfaces the first attempt used, and
  the not-observed status of the eligible human case, with a recorded reason.
- Does not establish: participant comprehension (C1–C6), voluntary return (C7),
  Gate B, Gate C, Gate E, or VIS-001 condition 4.
