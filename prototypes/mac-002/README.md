# MAC-002 Surface Parity Harness

`parity.ts` is the Gate S1 semantic-parity tooling: it proves the desktop
(GPUIX) client, the Viewer, and the CLI/TUI surface show the same authorized
Campfire data for the same actor and workspace — ids, statuses, currentness,
counts, truncation, attention reason codes, and alignment — without sharing a
pixel of layout.

## What it compares (three snapshots, one workspace)

| Leg | Source | Notes |
| --- | --- | --- |
| A `viewer-raw` | Direct `POST /api/call` reads of the running Viewer (`campfire up`), read allowlist only | The factual baseline |
| B `desktop-client` | The GPUIX shell's own boundary class (`CampfireViewerClient`) | Proves the desktop narrowing adds nothing and removes nothing |
| C `cli` | `tsx src/cli/index.ts <cmd> --output json` for the same workspace | Same profile decides local SQLite vs hosted `CAMPFIRE_URL` |

Cells include `workspace.{id,name,status,goal*}`, per-slice ids/counts/
truncation for tasks/findings/decisions/artifacts/blockers/recentChanges,
`attention.needsYou` / `needsAttention` tuples with **raw Sprint 008 reason
codes**, `alignment.*`, `provenanceSummary`, paging cursors, and identity
cells. PASS / DIFF / SKIP per cell: a visual difference is fine; a factual
difference (DIFF) is a blocker.

## Safety

- READS ONLY. No `campfire` write command is invoked by this script.
- It never reads credential files and never sets `CAMPFIRE_TOKEN` (or any
  credential env var). The CLI child inherits the caller's environment.
- The Viewer leg must run only against the operator's started Viewer; the
  script never starts Campfire services, except `--selfcheck`, which serves
  canned envelopes from an ephemeral port-0 server and skips the CLI leg.

## Run

```bash
# offline harness self-check (no Campfire, no profile, no listener)
bun prototypes/mac-002/parity.ts --selfcheck

# the real check, after the operator has started Campfire (`campfire up`)
bun prototypes/mac-002/parity.ts                      # default http://127.0.0.1:9415
bun prototypes/mac-002/parity.ts --workspace ws_x     # pin a workspace
bun prototypes/mac-002/parity.ts --json               # machine output
```

Artifacts land in `prototypes/mac-002/out/` (`*.json` snapshots + verdicts,
git-ignored). Exit code `0` means every compared cell agreed; `1` records a
DIFF or an unparseable leg, listing it on stdout and in the artifact.

The desktop client leg imports the shell's real source from the sibling
checkout:
`../campfire-desktop/apps/gpuix/src/campfire/step1/viewer-client.ts`
(override with `--client-path`). If that file is mid-rewrite, re-run after it
lands.

## Recorded history

- `scripts/mac-002-surface-parity.ts` records an earlier freeze: a captured
  NAV-002 baseline response replayed through the same client + section
  mapping. It predates the live three-snapshot harness and stays as a
  deterministic regression record.
