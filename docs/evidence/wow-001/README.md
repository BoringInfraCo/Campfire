# WOW-001 sealed-key isolation demonstration evidence

Sanitized primary evidence for the synthetic pre-run isolation boundary
demonstration supporting the proposed v1.13 WOW-001 contract
(`docs/Campfire-v1.13-WOW-001-Prove-a-Way-of-Working.md`).

**The evidence in this README's original section is a synthetic boundary check,
not a scored pilot run.** The six pilot arms and handoffs were later executed
on October 8, 2026; their sanitized records are under `runs/`, and the
execution status is in `docs/SPRINT_WOW_001_RESULT.md`. Independent scoring
is pending. Nothing here is Gate B or Gate C evidence. The pre-run check's
purpose was to show, before a first scored run, that the sanitized agent image
and the staged run trees cannot reach the
sealed material (ground truth, scoring key, setup notes, contract, playbook
source) and that the opt-in playbook gate behaves as designed. Two additional
disposable checks verify the locked real-run path itself: the authenticated
database/token path and the budget stop rule (see `auth-check.md` and
`budget-enforcement.md`).

## Harness / model / image / commit

| Item | Value |
| --- | --- |
| Git HEAD | `977c0e3e2cc66844fd23edea8f0a9945f467c4e1` |
| Runner | `scripts/wow-001/pilot.ts` (`npx tsx scripts/wow-001/pilot.ts <command>`) |
| Model | `opencode-go/deepseek-v4.1-flash` |
| Harness | OpenCode 1.18.35 (pinned in the image) |
| Image tag | `campfire-wow-001-agent:977c0e3-opencode1.18.35` |
| Image id | `sha256:349b90635fd4b584599aba5e01f989f44c38689f857eb217b1fbcb3fc078943a` |
| Image RepoDigests | `["campfire-wow-001-agent@sha256:349b90635fd4b584599aba5e01f989f44c38689f857eb217b1fbcb3fc078943a"]` |
| Image arch/os | `arm64/linux` |
| Pilot root | `<home>/.campfire-pilot/wow-001` (outside the repository) |
| Staged runs | `s1-control`, `s1-treatment`, `s1-second` |
| `contextTreeSha256` | `5148cabae45a0dcbf993e2fcda587c0dc354437fdc5ae17f5b02395917cdcaff` (385 files: `package.json`, `package-lock.json`, `dist/**`; recomputed on 2026-10-07 from the retained build context, which was not modified after the image build) |

### Harness corrections applied before the probes

The staged runs existed from an earlier cancelled attempt, but two harness bugs
prevented the OpenCode probes from running. They were fixed and the probes were
rerun. See `isolation-boundary.md` for exact errors; the one partial result is
recorded there.

1. OpenCode 1.18.35 runs `Config.ensureGitignore` at startup and writes
   `.gitignore` into its config directory. The config directory is mounted
   read-only, so the first control probe died after 877 ms with
   `FileSystem.writeFile (/home/agent/.config/opencode/.gitignore)`.
   Fix: stage a `config/.gitignore`; `pilot.ts stage` now writes one.
2. The agent MCP entry had no database, so `campfire mcp --harness opencode`
   failed with `Cannot open database because the directory does not exist`.
   Fix: the arm-independent MCP entry now carries
   `CAMPFIRE_DB=/tmp/campfire-probe.db`. The playbook gate remains container
   env only (`CAMPFIRE_PLAYBOOK=1`, treatment first agent only); the agent
   configuration is otherwise identical across roles and arms.

## Contents

| File | What it is |
| --- | --- |
| `isolation-boundary.md` | The dated record: versions, image identity, staged trees, what each probe ran, results, conclusions, limitations. |
| `probe-fs.json` | Exact runner stdout (sanitized) for `probe-fs --run-id s1-control`. |
| `probe-gates.json` | Exact runner stdout (sanitized) for `probe-gates --run-id s1-control`. |
| `probe-agent-s1-control.md` | Control first-agent boundary check: command, exit, duration, final text, key actions. |
| `probe-agent-s1-treatment.md` | Treatment first-agent boundary check: command, exit, duration, final text, key actions. |
| `probe-agent-s1-second.md` | Second-agent (control) boundary check: command, exit, duration, final text, key actions. |
| `auth-check.md` | Disposable authenticated verification of the locked real-run path (real database/token mounts, one OpenCode session, host-side checks); not a scored run. |
| `budget-enforcement.md` | Dry check that the runner stops a session at the locked tool-call budget with no overshoot; not a scored run. |
| `preparation-check.md` | Disposable fresh-workspace, S2 fixture, and frozen handoff setup checks. |
| `runs/` | Six sanitized pilot workspace exports, run receipts, logs, and verbatim agent answers. |
| `scoring/` | Twelve independent initial score sheets, attempt manifest, source-audit resolutions, and the computed pilot verdict. |

## Sanitization applied

- The runner replaces the repository path with `<repo>`, the operator home with
  `<home>`, and redacts credential-shaped strings before logs are written.
- Every file here was re-checked after writing: zero occurrences of
  credential-shaped strings, absolute home paths, or the repository path.
- In the pre-run boundary probes, the agent MCP database was an ephemeral
  `/tmp` file and no Campfire workspace was created. The later scored runs
  intentionally created synthetic workspaces; their sanitized exports are
  preserved under `runs/`.

## Repository note

`docs/evidence/wow-001/` is currently matched by the root `.gitignore` rule
`evidence/` (line 7), exactly as `docs/evidence/vis-001` was before it was
force-added. If these files are committed, use `git add -f`.

## What this evidence does not establish

- The original probe files in this directory are not pilot runs. For the later
  six run records, see `runs/` and the execution result document. No rubric
  verdict has yet been recorded.
- **Gate B and Gate C remain unmeasured.**
- The treatment agent's successful `get_playbook` call is the intended
  treatment, not a leak: the playbook is guidance, not sealed material.
- These are one-shot synthetic checks on one machine; no independent party
  reproduced them.
