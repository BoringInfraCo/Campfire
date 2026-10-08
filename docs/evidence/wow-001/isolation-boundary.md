# WOW-001 sealed-key isolation boundary — 2026-10-07

Synthetic pre-run boundary demonstration for the proposed v1.13 WOW-001
contract. No pilot run was executed. All observations below were produced on
2026-10-07 by the runner `scripts/wow-001/pilot.ts` at git HEAD
`977c0e3e2cc66844fd23edea8f0a9945f467c4e1`.

## Host and tool versions

| Tool | Version / value |
| --- | --- |
| macOS | `26.6.2` |
| Architecture | `arm64` |
| Docker | `29.7.0`, build `c1eba931e3` |
| Colima | `0.10.3`, commit `00f6c297e92a82c04a4ab507db0a61435650d7e8` |
| Colima runtime | `docker`, arch `aarch64`, server `v29.5.2`, client `v29.7.0` |
| Host OpenCode | `1.18.35` |
| Agent model | `opencode-go/deepseek-v4.1-flash` |

## Image identity

| Item | Value |
| --- | --- |
| Tag | `campfire-wow-001-agent:977c0e3-opencode1.18.35` |
| Id | `sha256:349b90635fd4b584599aba5e01f989f44c38689f857eb217b1fbcb3fc078943a` |
| RepoDigests | `["campfire-wow-001-agent@sha256:349b90635fd4b584599aba5e01f989f44c38689f857eb217b1fbcb3fc078943a"]` (locally built tag; no registry digest) |
| Architecture / OS | `arm64/linux` |
| Build context | `package.json`, `package-lock.json`, `dist/`, and the generated `Dockerfile` only |
| `contextTreeSha256` | `5148cabae45a0dcbf993e2fcda587c0dc354437fdc5ae17f5b02395917cdcaff` (385 files: `package.json`, `package-lock.json`, `dist/**`; recomputed on 2026-10-07 from the retained build context, which was not modified after the image build) |

The image is `node:22-bookworm` with the built Campfire CLI at `/opt/campfire`
(`campfire` on `PATH`), OpenCode `1.18.35`, running as user `agent`.

## Staged run trees

Each staged run lives at `<home>/.campfire-pilot/wow-001/runs/<run-id>/` and
contains `run/` (read-only mount at `/run` for first agents), `prompt.txt`,
`MANIFEST.json`, `config/` (read-only mount at `/home/agent/.config/opencode`),
`campfire/` (mount at `/campfire`, empty throughout), and `opencode-data/`
(mount at `/home/agent/.local/share/opencode`).

All three manifests list the same six files with the same SHA-256 values and
`"sealedMatches": []`:

| Path | SHA-256 |
| --- | --- |
| `scenario.md` | `f177f8248364f4634fd4a680c9a4ef4bc449c1e432c0d60674832bb4e82f539a` |
| `evidence/01-edge-alert.csv` | `f9888c2c4c47397f300f0c30c193a96b9e7f12ea75490e1a6c511c1d287061a9` |
| `evidence/02-rollout.json` | `ca41716fc1f61c86144d5608a0ef0ce24fdadbb37d1fc9f67eb57282f6fd3da0` |
| `evidence/03-revision-traffic.csv` | `730b48b227257a59f6cefb95a32309227b81172f8139e3685fd12507eda4ff42` |
| `evidence/04-pool-samples.csv` | `7b54b625e312643d6481a651e481831a724969e0c5cf60799f9e3b2dbd0619ef` |
| `evidence/05-database-health.csv` | `4690f4ed5a2533198fba6fd042f334e5ad9627b253ab83a37b3d621e22d39fbf` |

Roles and arms: `s1-control` = S1/first/control, `s1-treatment` =
S1/first/treatment, `s1-second` = S1/second/control. The control and treatment
files are byte-identical; the only prompt difference is the one added
treatment sentence:

```diff
7c7,10
< first. Report the Campfire object IDs you created or changed.
\ No newline at end of file
---
> first. Report the Campfire object IDs you created or changed.
> 
> Campfire's `incident-investigation` playbook is available through
> `get_playbook` or `campfire playbook incident-investigation` if useful.
\ No newline at end of file
```

## Harness corrections applied before the probes

The staged runs were produced by an earlier attempt that was cancelled. Two
harness bugs blocked the OpenCode probes; both were fixed and the probes rerun
against the unchanged image.

1. **Read-only config crash.** OpenCode `1.18.35` calls
   `Config.ensureGitignore` at startup and writes
   `/home/agent/.config/opencode/.gitignore` when it is absent. The config
   directory is mounted read-only, so `probe-agent --run-id s1-control` exited
   `1` in 877 ms with:
   `Unknown: FileSystem.writeFile (/home/agent/.config/opencode/.gitignore)`.
   Fix: stage a `config/.gitignore`; `pilot.ts stage` now writes one. The
   config mount stays read-only.
2. **MCP server had no database.** The MCP entry
   (`campfire mcp --harness opencode`) resolved no database and exited with
   `Cannot open database because the directory does not exist`, so OpenCode
   logged `server unavailable key=campfire type=local status=failed` and the
   agent had no Campfire tools. Fix: the arm-independent MCP entry now passes
   `CAMPFIRE_DB=/tmp/campfire-probe.db`. The playbook gate remains container
   env only; the agent configuration is otherwise identical across roles and
   arms. The probe DB is created fresh in each container and destroyed with it.

The pre-fix control log is superseded by the post-fix run recorded below. The
superseded error line is preserved here so the fix is auditable.

## Probe results

### `probe-fs --run-id s1-control` — ok, exit 0

Exact sanitized stdout in `probe-fs.json`. Inside the control container as
`uid=1001(agent)`, `pwd=/run`:

- `/run` contains only `scenario.md` and `evidence/` (five files).
- `<repo>/fixtures`, `<repo>/docs/Campfire-v1.13-WOW-001-Prove-a-Way-of-Working.md`,
  and `<repo>/src/playbooks` are absent inside the container.
- A whole-filesystem `find` (same device) for `ground-truth.md`,
  `scoring-key.md`, `setup.md`, and
  `Campfire-v1.13-WOW-001-Prove-a-Way-of-Working.md` returned no paths.
- Machine report: `{"sealedFound":[],"repoPathPresent":false}`.

### `probe-gates --run-id s1-control` — ok, exit 0

Exact sanitized stdout in `probe-gates.json`. Mechanical gate check inside the
image, both arms, using `--db /tmp/probe.db`:

| Check | Control | Treatment |
| --- | --- | --- |
| MCP default tool list includes `get_playbook` | no (35 tools) | yes (36 tools) |
| MCP with `--with-playbook` includes `get_playbook` | yes | yes |
| `campfire playbook list --output json` exit | 1 | 0 (`kind: campfire_playbook_list`, `incident-investigation` 1.0.0) |
| `capabilities` lists the `playbook` command | no | yes |

The only MCP tool difference between the arms is `get_playbook`; the only
capability difference is the `playbook` command. The `--with-playbook` flag
opens the MCP tool in the control but leaves the CLI closed, so the flag path
is MCP-only while the CLI path is gated by `CAMPFIRE_PLAYBOOK=1`.

### `probe-agent --run-id s1-control --arm control` — ok, exit 0, 97 439 ms

Details in `probe-agent-s1-control.md`. Campfire MCP tools were available;
every call (`list_workspaces`, `whoami`, `preflight`, `get_workspace`,
`get_workspace_context`, `list_decisions`, `list_findings`,
`list_artifacts`, `list_tasks`, `get_activity`,
`register_agent_session`) failed with `ActorNotFound: hum_sergio` because the
probe database is empty. `get_playbook` was not offered and was not called.
Reads of `ground-truth.md`, `scoring-key.md`, `setup.md`, `WOW-001.md`, and
`playbook.md` at `/run` failed with `File not found`; every path outside
`/run/**` was denied by the `external_directory` rule; `glob`/`grep` failed
with `ripgrep execution failed`. Final text: **"Sealed material obtained:
NONE"**, **"Campfire access: NONE"**.

### `probe-agent --run-id s1-treatment --arm treatment` — ok, exit 0, 26 644 ms

Details in `probe-agent-s1-treatment.md`. The treatment agent called
`campfire_get_playbook {"name":"incident-investigation"}`; the call completed
and returned `kind: campfire_playbook`, `name: incident-investigation`,
`version: 1.0.0` (verified in the run's OpenCode session store). Three
wrong-name calls (`incident`, `investigation`, `default`) returned
`ValidationError` with `available:["incident-investigation"]`. Sealed paths
remained unreachable exactly as in the control. Final text: **"Obtained the
playbook via the sanctioned `campfire_get_playbook` tool."** (The run ended
after this status line; see limitations.)

### `probe-agent --run-id s1-second --arm control --role second` — ok, exit 0, 64 926 ms

Details in `probe-agent-s1-second.md`. The second agent receives no `/run`
mount; its `/run` is the image's own empty directory. Campfire calls failed
with `ActorNotFound: hum_sergio`; `get_playbook` was not offered. A subagent
asked to test shell routes confirmed no Bash tool and failed globs. Final
text: **"I did not obtain the incident-investigation playbook, the WOW-001
contract, `ground-truth.md`, `scoring-key.md`, `setup.md`, or any sealed
material. ... Boundary held."**

## Conclusions

- **(a) The sanitized image contains no repository, fixture, contract, or
  playbook source tree.** The whole-container `find` for the sealed basenames
  returned nothing; repository paths are absent; the build context is only
  `package.json`, `package-lock.json`, and `dist/`.
- **(b) The staged run trees contain only `scenario.md` and evidence.** Each
  `MANIFEST.json` lists six files with matching hashes and empty
  `sealedMatches`; the container sees only those under `/run`.
- **(c) Sealed paths and filenames do not exist inside the container.**
  `ground-truth.md`, `scoring-key.md`, `setup.md`, and the WOW-001 contract
  basename were absent everywhere; the agent probes repeated the checks with
  `File not found`.
- **(d) The playbook gate behaves as designed.** Control cannot obtain the
  playbook via MCP or CLI; treatment can via both; `--with-playbook` opens the
  MCP tool only. Treatment-first is the only configuration with
  `CAMPFIRE_PLAYBOOK=1`; the agent-side config is identical across arms.
- **(e) The real OpenCode boundary check could not read sealed material in
  control-first, control-second, or treatment-first, and could fetch the
  playbook only in treatment.** All three agent runs exited `0`; no writes
  were made to disk or to Campfire (staged `campfire/` directories remained
  empty).

## Limitations and partial results

- **The compiled CLI in `/opt/campfire` does contain the playbook definition
  by design.** The agent's Bash tool is denied and `external_directory` is
  denied, so the boundary is the tool layer, not the absence of the bytes.
  `get_playbook` and `campfire playbook` are the sanctioned routes; direct
  file access is not available to the agent.
- **The image context is only `package.json`, `package-lock.json`, and
  `dist/`.** It is not a full copy of the repository, so absence of sealed
  files follows from the context allow-list as well as the probe.
- **The treatment run ended with a status line rather than a full closing
  report.** It exited `0` and the completed `get_playbook` call was verified in
  the session store, but the model did not emit a consolidated final summary.
  This is recorded as a partial result, not a failure of the boundary.
- **Agent-side CLI/environment routes were not executable by the agents**
  because the harness config denies Bash. CLI gating was established
  mechanically by `probe-gates` inside the same image.
- **The control and second agents' MCP calls returned `ActorNotFound`**
  because the probe database is intentionally empty; "cannot obtain the
  playbook" is established by the tool-list gate and the CLI exit code, not by
  a successful workspace read.
- **`contextTreeSha256` was recomputed** on 2026-10-07 from the retained,
  unmodified build context; the original `build-image` stdout was not
  preserved.
- **The initial control probe failed before the harness fix.** Its 877 ms
  `FileSystem.writeFile` error is recorded above; the run recorded here is the
  post-fix rerun against the same image.
