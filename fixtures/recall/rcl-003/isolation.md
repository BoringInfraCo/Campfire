# RCL-003 isolation

Freeze date: October 11, 2026. Scored runs have not started. A repository read by a recipient is a failed arm. Do not describe that arm as packet-only continuation.

This file carries forward every correction the RCL-002 preregistration recorded on October 11, 2026, plus the answers this pilot's answer key makes visible. RCL-002 found those holes in preflight, after its original isolation text was written; they were found only because the preflight ran before scoring.

## Process boundary

Each arm runs under `sandbox-exec` with a profile built per arm by the runner from the real arm directory. The profile denies reads of `fixtures/`, `docs/`, `evidence/`, the seed directory, every other pilot's directory, the operator Campfire profile, and the user Codex memories, sessions, skills, and rules.

Recipient profiles deny file reads and file writes of the Campfire checkout for both the original path and the lowercased path. RCL-002's first write rule covered only the original spelling; that gap is closed here too. The runner applies both spellings to every denied path, not only to the checkout. OpenCode follows `PWD`, so the runner sets `PWD` to the arm directory and deletes `OLDPWD` before launch. Matched Codex arms still read the checkout so they can launch the local MCP server; recipient profiles do not.

Every arm is denied the checkout's `.git` directory in both path spellings. RCL-002's preflight proved that `git show HEAD:fixtures/recall/rcl-002/ground-truth.md` otherwise reads the committed answer key straight out of `.git`. The same probe is run here against `fixtures/recall/rcl-003/ground-truth.md`, and this key is not committed yet, so the preflight also fails loudly if the key is missing from the commit rather than proving a denial that proves nothing.

RCL-001 and RCL-002 both left their pilot roots readable to a later pilot's arms. Both `~/.campfire-pilot/rcl-001` and `~/.campfire-pilot/rcl-002` are denied here, along with their lowercase spellings: those directories hold prior packets, prior answers, and prior event streams. Only `~/.campfire-pilot/rcl-003/<this arm>` is readable.

Host OpenCode config, data, and state directories are denied for every arm. RCL-002's free-tier diagnostic left the host OpenCode data directory readable, and that directory holds prior sessions. The recipient now receives an isolated data directory that copies only authentication files and creates a new SQLite database from schema with allowlisted routing and authentication rows; session and message tables are asserted empty. Host Codex top-level entries are denied except `packages`, which the locked Codex binary resolves under; the needed auth is copied into the arm before launch.

Arm-correct source visibility is part of the contract: the control sees control source and not treatment source, the treatment sees treatment source and not control source, and the recipient sees neither checkout. The preflight asserts each direction with a real read, not by inspecting the profile text. The recipient can read its own `packet.json`; every other arm is denied the preflight packet and the lowercase spelling of its path.

## Arm isolation

Each scenario runs three arms against three separate copies of the seed database and three separate credentials. A matched arm's token and database live only in that arm's private directory and in that arm's Codex MCP server configuration. `CAMPFIRE_URL`, `CAMPFIRE_TOKEN`, `CAMPFIRE_DB`, `CAMPFIRE_ACTOR_ID`, and `CAMPFIRE_ACTOR_TYPE` are unset in the recipient process, and the recipient run directory is asserted to hold no token, database, or Codex auth file. The recipient registers no MCP server at all.

Both arms' prompts and answers stay out of each other: every other arm directory, its `-invalid` suffix directories, and its lowercase spellings are denied for reads and writes. All three profiles deny writes to the checkout, the seed, the other pilot roots, the prior arms' directories, and host harness state.

## Preflight

The runner completes the full preflight before any scored arm and prints `PREFLIGHT_OK`. It asserts the product tree against the implementation commit named in `RUN-LOCK.md` and the lockfile against the control commit, checks the seed facts including the decision set's state, members, recorded transitions, `operativeDecisionId`, and `beforeActing`, builds the real per-arm profile and exercises every denial above, and requires a `READY` reply from the locked Codex and OpenCode models under those same profiles. `assertSeedFacts` also asserts that the live recall JSON contains no artifact URI or filesystem path, so a packet cannot carry one.

## Failed arms

Score a recipient as a packet failure when any of these are true:

- `packet.json` was never read.
- A tool path, command, or output names the Campfire checkout, unless the output is an operating-system denial.
- A Campfire MCP tool was called.
- The answer depends on `fixtures/`, `docs/`, or `tests/`.
- The answer engages none of the decision set: no member id, no set state, no `operativeDecisionId`, and none of the frozen `beforeActing` wording.

The last condition is new in RCL-003 and is recorded in `invalidForScoring` as `recipient answer did not act on the decision set`. It is an evidence-validity flag, not a license to rerun: the answer is still scored by the rubric and still reported. It never upgrades an outcome and never removes a completed answer.

Record the deviation. Do not edit the answer key and do not rerun a completed answer.