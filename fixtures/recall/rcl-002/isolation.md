# RCL-002 isolation

Freeze date: October 11, 2026. Scored runs have not started. A repository read by a recipient is a failed arm. Do not describe that arm as packet-only continuation.

## Process boundary

Each arm runs under `sandbox-exec`. The profile denies reads of `fixtures/`, `docs/`, `evidence/`, the seed directory, other arms' run directories, the operator Campfire profile, and the user Codex memories, sessions, skills, and rules.

Recipient profiles deny file reads and file writes of the Campfire checkout for both the original path and the lowercased path. The first write rule covered only the original spelling. That gap was closed on October 11, 2026, before any scored arm. OpenCode follows `PWD`. The runner sets `PWD` to the arm directory and deletes `OLDPWD` before launch. Matched Codex arms still read the checkout so they can launch the local MCP server. Recipient profiles do not.

The RCL-001 free model returned `FreeTierError` 403 from `opencode run` on October 11, 2026: the free tier can only be used from within OpenCode. An early unscored diagnostic left the host OpenCode data directory readable to avoid `provider.no-route`; that was insufficient isolation for scoring because the directory also holds prior sessions. Before the first scored arm, the runner was changed to deny host OpenCode config, data, and state directories and give the recipient an isolated data directory. It copies only authentication files and creates a new SQLite database from schema with allowlisted routing and authentication rows; it asserts that session and message tables are empty. The exact locked recipient model then replied READY under that profile.

The matched profiles also deny the checkout's `.git` directory in both path spellings. The unscored preflight proved that a direct answer-key read and `git show HEAD:fixtures/recall/rcl-002/ground-truth.md` fail under each actual profile. It also proved that the recipient can read `packet.json` but cannot read or write the checkout, and that every arm is denied the RCL-001 pilot and host OpenCode state. The runner used bundled Node `24.19.0` to load the package's native SQLite module. These are October 11 preregistration corrections, before any scored arm; they do not change the frozen task, key, model, order, or budget.

The final pre-score review added original-case and lowercase denies for key paths, earlier preflight packets, model probes, diagnostics, other and invalid arm directories, and host Codex history. The control sees only control source; the treatment sees only treatment source; the recipient sees neither checkout. All three profiles deny writes to the checkout, seed, other arms, prior pilot, and host harness state. The latest full preflight exercised the direct and lowercase reads, Git key read, cross-arm reads and writes, packet read, and both locked model READY probes; it finished `PREFLIGHT_OK` with no scored arms present. Final arm metadata marks tool-count or elapsed-time overshoot invalid for scoring.

`CAMPFIRE_URL`, `CAMPFIRE_TOKEN`, `CAMPFIRE_DB`, `CAMPFIRE_ACTOR_ID`, and `CAMPFIRE_ACTOR_TYPE` are unset in the recipient process. The matched arm's token and database are visible only to that arm's Codex MCP server configuration.

Control MCP is `src/mcp/stdio.ts` from `bb3bb61d716f52bb36e5f1c6e6514ece71abc555`. Treatment MCP is `src/mcp/stdio.ts` from the treatment commit named in `RUN-LOCK.md`. The recipient config registers no MCP server.

## Unscored diagnostic

On October 11, 2026, `npx tsx fixtures/recall/rcl-002/diagnose.ts` printed `DIAGNOSE_OK`. The recipient made one tool call, a completed read of `packet.json` in its work directory. The answer was the decision rationale and nothing else. The event log contained no checkout path and no Campfire tool call. The model was `opencode-go/glm-5.2#max`. The packet had one decision. Output stays under `~/.campfire-pilot/rcl-002/diagnose` and is not committed.

The same command was rerun on October 11, 2026, after the lowercase write deny and after the diagnostic script closes the database if setup fails. The rerun printed `SANDBOX_WRITE_DENY_OK` and `DIAGNOSE_OK`. The recipient again made one read of `packet.json` and replied with the decision rationale. The event log showed no checkout read and no Campfire tool call. That rerun is unscored. It does not score RCL-001 or RCL-002, and it does not authorize a scored run. The RCL-001 lock stays on `opencode/space-bunny-free#xhigh`.

## Failed arms

Score a recipient as a packet failure when any of these are true:

- `packet.json` was never read.
- A tool path, command, or output names the Campfire checkout, unless the output is an operating-system denial.
- A Campfire MCP tool was called.
- The answer depends on `fixtures/`, `docs/`, or `tests/`.

Record the deviation. Do not edit the answer key and do not rerun a completed answer.
