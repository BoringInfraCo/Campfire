# WOW-001 run lock — 2026-10-07

Dated addendum to this packet's "Run lock to complete before the first pilot
run" section. It freezes the environment for the six pilot runs. **No pilot run
has been executed as of this date.** The sealed-key isolation demonstration is
`docs/evidence/wow-001/isolation-boundary.md`.

## Frozen settings

| Item | Value |
| --- | --- |
| Implementation commit | `977c0e3e2cc66844fd23edea8f0a9945f467c4e1` ("feat: add opt-in incident investigation playbook") |
| Playbook | `incident-investigation` version `1.0.0` (`src/playbooks/incident-investigation.ts` at that commit) |
| First-agent harness | OpenCode `1.18.35` |
| Second-agent harness | OpenCode `1.18.35` |
| Model, both roles | `opencode-go/deepseek-v4.1-flash` |
| Agent image | `campfire-wow-001-agent:977c0e3-opencode1.18.35` |
| Agent image id / digest | `sha256:349b90635fd4b584599aba5e01f989f44c38689f857eb217b1fbcb3fc078943a` |
| Image context | `package.json`, `package-lock.json`, `dist/` from the implementation commit; `contextTreeSha256` `5148cabae45a0dcbf993e2fcda587c0dc354437fdc5ae17f5b02395917cdcaff` (385 files) |
| Image base | `node:22-bookworm`, `opencode-ai@1.18.35`, built Campfire CLI at `/opt/campfire`, non-root user `agent` |
| Isolation | one Docker container per agent run (Docker `29.7.0`; colima `0.10.3`, server `29.5.2`; macOS `26.6.2` arm64) |
| Pilot root | `~/.campfire-pilot/wow-001` (outside the repository) |
| Runner | `scripts/wow-001/pilot.ts` (`npx tsx scripts/wow-001/pilot.ts <command>`) |
| Arm order | from this packet: S1 control→treatment; S2 treatment→control; S3 control→treatment |
| Budgets / stop rule | from this packet: first agent 30 min or 100 tool calls; second agent 10 min or 30 tool calls; the earlier limit stops the run; an infrastructure failure is invalid |

## Tool allowlist (identical across arms for a role)

- OpenCode permissions: `bash: deny`, `edit: deny`, `webfetch: deny`,
  `websearch: deny`, `external_directory: { "*": "deny", "/run/**": "allow" }`.
- First agent: read/glob/grep/list inside `/run` (read-only mount of
  `scenario.md` + `evidence/**`) plus the Campfire MCP tools. No shell, no web.
- Second agent: same permissions, no `/run` mount, no scenario or transcript,
  Campfire MCP only. Its database is a throwaway copy of the frozen run
  database, and the prompt forbids writes.
- Treatment first agent only: container env `CAMPFIRE_PLAYBOOK=1`, so the MCP
  server registers `get_playbook` and the CLI command is enabled. The harness
  config is identical across arms; the playbook switch is never in the config.
- Control and all second agents: `CAMPFIRE_PLAYBOOK` unset and no
  `--with-playbook`.
- Because `bash` is denied, agents reach Campfire through MCP only. The CLI
  path exists in the installed build but is not reachable from an agent; this
  is recorded, not hidden.

## Setup procedure for one run

1. From the implementation commit: `npm ci && npm run build`; then
   `npx tsx scripts/wow-001/pilot.ts build-image`; confirm the image id and
   `contextTreeSha256` above.
2. Create one fresh workspace and its actor memberships for the run, plus the
   first- and second-agent identities and tokens. For S2, seed the single
   prior-shift false-lead finding exactly as `S2/setup.md` specifies. Record the
   workspace id and the stream tip, and do no other preparation.
3. Stage the run, for example:
   `npx tsx scripts/wow-001/pilot.ts stage --scenario S1 --arm control --role first --run-id <id> --workspace-id <ws> --deadline "<time>" --campfire-db /campfire/campfire.db --campfire-token-file /campfire/agent.token`
   The defaults (`/tmp/campfire-probe.db`, no token) are for the isolation
   probes only. Before starting, place the run database at
   `<runDir>/campfire/campfire.db` and the acting agent token at
   `<runDir>/campfire/agent.token` (mode 600). Never commit either file.
4. Start the first agent with the staged prompt (`<runDir>/prompt.txt`) in its
   container. Enforce the budget as the hard timeout and stop at the earlier
   limit. Capture CLI and MCP invocations in the runner's local log.
5. On stop: freeze the workspace with a read-only export and stream tip, take
   no later write to it, and copy its database for the second agent. Start the
   second agent in a fresh container with `CAMPFIRE_PLAYBOOK` unset, no `/run`
   mount, and the neutral prompt.
6. Preserve per-run evidence as contract section 6 requires. A run stopped
   outside the frozen rule is invalid; repeat that arm once with a fresh
   workspace and session, and preserve the invalid attempt.

## Isolation check (demonstrated 2026-10-07)

`docs/evidence/wow-001/` records the pre-run demonstration:

- The staged run tree contains only `scenario.md` and `evidence/**`; each
  `MANIFEST.json` lists those hashes with `sealedMatches: []`.
- The sanitized image contains no repository, fixture, contract, or playbook
  source tree; a whole-container search for the sealed basenames returned
  nothing.
- Control cannot obtain the playbook through MCP or the CLI; treatment can
  through both; `--with-playbook` opens the MCP tool only.
- Real OpenCode boundary probes could not read sealed material in control-first,
  control-second, or treatment-first, and fetched the playbook only in
  treatment.

If any run's boundary check fails, that run is invalid and the exposure is
preserved in the result. No pilot run has started as of this lock.

## Runner follow-up before the first run

After this lock was committed, review found that `pilot.ts` derived its image
tag from the current Git HEAD. Committing the lock changed HEAD from
`977c0e3` to `41cf786`, so later runner commands would select an unverified
image tag. The runner now uses the locked tag above and checks the image ID
before probes. A rebuild uses a candidate tag and is accepted only if its ID
matches this lock. The model, prompts, image, scoring rules, and arm order did
not change. No scored pilot run preceded this correction.
