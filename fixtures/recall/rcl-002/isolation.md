# RCL-002 isolation

Freeze date: October 11, 2026. Scored runs have not started. A repository read by a recipient is a failed arm. Do not describe that arm as packet-only continuation.

## Process boundary

Each arm runs under `sandbox-exec`. The profile denies reads of `fixtures/`, `docs/`, `evidence/`, the seed directory, other arms' run directories, the operator Campfire profile, and the user Codex memories, sessions, skills, and rules.

Recipient profiles also deny file reads and file writes of the Campfire checkout and of that path lowercased. OpenCode follows `PWD`. The runner sets `PWD` to the arm directory and deletes `OLDPWD` before launch. Matched Codex arms still read the checkout so they can launch the local MCP server. Recipient profiles do not.

The RCL-001 free model returned `FreeTierError` 403 from `opencode run` on October 11, 2026: the free tier can only be used from within OpenCode. Isolating `~/.local/share/opencode` then made `opencode-go/glm-5.2` return `provider.no-route`. The RCL-002 recipient profile leaves provider auth and that data directory readable so the locked model can start. It still denies the checkout and the RCL-001 pilot runs and seed, so this pilot cannot read the scored RCL-001 packets or answers.

`CAMPFIRE_URL`, `CAMPFIRE_TOKEN`, `CAMPFIRE_DB`, `CAMPFIRE_ACTOR_ID`, and `CAMPFIRE_ACTOR_TYPE` are unset in the recipient process. The matched arm's token and database are visible only to that arm's Codex MCP server configuration.

Control MCP is `src/mcp/stdio.ts` from `bb3bb61d716f52bb36e5f1c6e6514ece71abc555`. Treatment MCP is `src/mcp/stdio.ts` from the treatment commit named in `RUN-LOCK.md`. The recipient config registers no MCP server.

## Unscored diagnostic

On October 11, 2026, `npx tsx fixtures/recall/rcl-002/diagnose.ts` printed `DIAGNOSE_OK`. The recipient made one tool call, a completed read of `packet.json` in its work directory. The answer was the decision rationale and nothing else. The event log contained no checkout path and no Campfire tool call. The model was `opencode-go/glm-5.2#max`. The packet had one decision. Output stays under `~/.campfire-pilot/rcl-002/diagnose` and is not committed.

That diagnostic does not score RCL-001 or RCL-002. It does not authorize a scored run. The RCL-001 lock stays on `opencode/space-bunny-free#xhigh`.

## Failed arms

Score a recipient as a packet failure when any of these are true:

- `packet.json` was never read.
- A tool path, command, or output names the Campfire checkout, unless the output is an operating-system denial.
- A Campfire MCP tool was called.
- The answer depends on `fixtures/`, `docs/`, or `tests/`.

Record the deviation. Do not edit the answer key and do not rerun a completed answer.
