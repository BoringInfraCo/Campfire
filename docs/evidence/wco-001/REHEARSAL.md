# WCO-001 rehearsal — October 15, 2026

**This is a rehearsal. It produced zero C1–C7 observations. Nothing in this file
may be cited as a sprint case, counted toward C1–C7, or used to close Gate B,
Gate C, or Gate E.** By contract §6.1, a single operator impersonating two
humans, two subagents, or an agent answering for a human is a rehearsal only.
The file exists to record the observed friction that justified the dated
Contract Amendment 1, and the confounds that limit what it proves.

## 1. Why a rehearsal, and its eligibility

The eligible case requires two different people on two different agent
harnesses doing ordinary work (§6.1). Only one person (the repository operator)
was available in this engineering session, so the human case is **NOT
OBSERVED** (`BASELINE_V1_17.md` §3). To keep engineering progress, the operator
ran a labeled rehearsal on shipped v1.17.0 with:

- two distinct human actors created through the real product enrollment path
  (`onboard` for Human A; `invite-teammate` + `join` for Human B; loopback
  `--allow-loopback` developer exception);
- two distinct agent actors, one run per actor, both driven as **OpenCode
  subagent sessions on one machine** (declared limitation: the
  different-harness wedge is not exercised);
- one isolated workspace `ws_a74b590d1b2e4c54` ("wco-001-rehearsal") in a fresh
  SQLite database under the gitignored `.campfire/traces/wco-001/`;
- one `campfire serve` process (single writer, `127.0.0.1:19414`) and per-actor
  tokens; each agent called the real MCP stdio server per action through a
  rehearsal wrapper (`.campfire/traces/wco-001/bin/mcp-call.mjs`, rehearsal
  tooling only).

Actors: Human A `hum_5750c8e7706b4da9` (owner) + Agent A
`agt_4b4c704997344406` (harness `opencode`); Human B `hum_e7530a05741546f6`
(member) + Agent B `agt_1c870ea7f26a4188` (harness `opencode`). Every actor had
its own credential; no token was shared across actors.

## 2. Frozen scenario key (recorder-held; never given to Agent B)

- Goal `goal_850d58a03c6040d1` "Produce a trustworthy WCO-001 baseline for the
  shipped v1.17.0 tree".
- Task `task_c95fe1ec031e4ecc` "Confirm the v1.17.0 release archive matches the
  committed tag tree" — status `blocked`, assigned to Agent A.
- Finding `find_ce839e059deb4f38` (tag-side facts and exact hash values).
- Decision `dec_c38aa3216b294aec`, later accepted by Human A: "WCO-001 baseline
  hash values come from committed refs via git show, not from a dirty working
  tree or an extracted archive" (basis citation to the finding).
- Artifacts `art_83a5123e2a764d02` (the archive) and `art_956c63213a61404e`
  (its checksum file).
- Frozen blocker: the archive-vs-tag comparison had not been performed. Keyed
  safe outcome: perform the comparison from the archive, record the result as a
  finding with the actor's own provenance, and update the task truthfully;
  acceptable escalation if it could not be performed.
- Frozen source position before Agent B's first read: orientation cursor from
  `served-state/pre-b-agent-b-context.json`.

**Staged split disclosed:** the recorder instructed Agent A to record the setup
and stop before the comparison, so the "blocked" state is a staged unresolved
dependency, not an organically discovered one. Everything else — the actors,
authorization, records, orientation rendering, writes, provenance, and return —
was produced by the unmodified shipped product.

## 3. Run log (contribution positions in the workspace ledger)

| # | UTC | Actor | Event |
| --- | --- | --- | --- |
| 1–9 | 22:35:11–22:35:29 | Human A, Human B | workspace, goal, invite, enrollment, memberships (real enrollment path) |
| 10–16 | 22:37:21–22:37:58 | Agent A | session, task, finding, two artifacts, proposed decision, task set `blocked` |
| 17 | 22:37:58 | Agent A | decision basis citation |
| 18 | 22:38:29 | Human A (CLI) | accepted the decision with a reason |
| 19 | 22:39:00 | Agent B | session registration |
| 20–22 | 22:40:07–22:40:21 | Agent B | new finding: archive viewer assets match the tag; two evidence citations (`supports`) |
| 23 | 22:40:25 | Agent B | task updated to `completed` with truthful description |
| 24 | 22:41:17 | Agent A (fresh process) | new session |
| 25–26 | 22:45:55–22:45:59 | Agent A | additive finding re-verifying B's result; added basis citation to the accepted decision |

Agent A's return used its own prior orientation cursor and `get_workspace_changes`
to read B's contribution; it then independently re-extracted the archive and
re-derived the hashes before writing, and it deliberately did not supersede its
own earlier finding (doing so would have flagged the accepted decision
`needsReview` through the recorded correction semantics) and did not mark the
goal complete.

## 4. What worked

- The full loop A → B → A completed using only shared state: B oriented from
  authorized reads, found the blocked task and its recorded pending step, honored
  the accepted decision's constraint, performed a real checkable action, and
  left findings, evidence citations, and a truthful task update with its own
  identity and session.
- A's fresh-process return read exactly B's contribution from the cursor delta
  and took a dependent, checkable action (independent re-verification + additive
  finding + added decision basis).
- Distinct authority held: four distinct actors, per-actor tokens, agent writes
  stamped with the owning human's session; no cross-workspace reads occurred.
- No private transcript was consulted by B; its decisive facts came from
  Campfire reads and its own commands.

## 5. Observed friction that justified the amendment

1. **Availability of teammate-owned blocked work was not stated by the
   surfaces.** At the frozen position, Agent B's orientation showed
   `needsYou: []` and `suggestedNextAction: {kind: "none"}`; the only actionable
   task appeared in `needsAttention` with reason `team_blocked_task`. The
   service type documents `needsAttention` as "Team-level items the caller
   cannot act on directly", but the authorization model permits any *writing*
   participant to take the task up (`task:update`), and B did exactly that.
   Agent B's own report: completing another agent's task "was unambiguous only
   because the task description explicitly delegated the step to whoever
   performed it". The product therefore depended on prose in the task
   description — a hand-prepared element — rather than on recorded guidance that
   the work was open.
2. **Evidence-relation vocabulary was not documented at the MCP boundary.**
   `cite_finding_evidence.relation` (and `correct_finding.evidence[].relation`)
   declare a free-form string; the service accepts only `supports|contradicts`.
   Agent B's first citation call failed validation. Agent B's report: "the
   closed vocabulary should be documented in the tool description".

Both are guidance/schema-level frictions; neither requires a new object,
relationship, or read. See Contract Amendment 1.

## 6. Confounds and limitations (not product findings)

- **Rehearsal wrapper hides tool schemas.** A real harness receives MCP
  `inputSchema`; the wrapper did not, so one agent discovered the
  `get_workspace_changes` argument name by trial. This is a rehearsal-tooling
  artifact.
- **Shell truncation.** Long JSON responses were truncated in the agent's
  terminal view and re-read from saved files. Environment artifact.
- **Correction semantics friction.** Agent A wanted to close a stale clause in
  its own earlier finding and found that `correct_finding` supersedes the
  predecessor and flags citing decisions `needsReview` by design (COR-001);
  the additive finding was the correct tool. Working as designed; recorded for
  completeness.
- **Same harness for both agents; one operator; one machine.** See §1.
- **Isolation is by instruction.** Both agent sessions ran on one filesystem;
  the recorder key and the other actor's state directory were protected by
  instruction, not enforcement. An eligible case requires separate machines or
  enforced boundaries.
- **Reference-open.** Agent B did open and extract the stored archive reference
  during the rehearsal. Because this is a rehearsal (one operator), it is not
  eligible evidence for VIS-001 condition 4.

## 7. Sanitization

No token value, token hash, invitation secret, raw prompt, private message, or
tool argument appears here. Participant reports are quoted from the agents' own
final summaries of what they recorded in Campfire. Raw captures, credentials,
and the trace database remain in the gitignored `.campfire/traces/wco-001/`;
only the sanitized served-state captures were copied into `served-state/`.

*(This record creates no sprint observation and changes no gate.)*
