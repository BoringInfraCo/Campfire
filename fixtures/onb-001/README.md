# ONB-001 Step 0 capture tooling (fixture evidence)

FIXTURE EVIDENCE TOOLING — not product code. These scripts drive the published
v1.22.0 CLI and Viewer in isolated installations and write the dated baseline
packet under `docs/evidence/onb-001/`. A scripted PTY run or headless-browser
dump is a debugging rehearsal, never human-observation evidence.

## Requirements

- A clean v1.22.0 worktree (`git describe` = `v1.22.0`, package `1.22.0`,
  `src/` identical to the tag) with `node_modules` installed (`npm ci` or an
  equivalent local install providing `node_modules/.bin/tsx`).
- `python3` for the PTY driver.
- Optional: a `chrome-headless-shell` binary for the Viewer DOM dumps. The
  Viewer tool looks for `ONB001_CHROME`, then the local Playwright cache; when
  neither exists the DOM cases record themselves as not-captured instead of
  failing.

Every tool refuses to run when the worktree is dirty or not `v1.22.0`.

## Reproduce the packet

```sh
npx tsx fixtures/onb-001/capture-first-run.ts --root <v1.22.0-worktree>
npx tsx fixtures/onb-001/capture-return.ts    --root <v1.22.0-worktree>
npx tsx fixtures/onb-001/capture-join.ts      --root <v1.22.0-worktree>
npx tsx fixtures/onb-001/capture-viewer.ts    --root <v1.22.0-worktree>
npx tsx fixtures/onb-001/verify-evidence.ts   --root <v1.22.0-worktree>
```

`--out` defaults to `docs/evidence/onb-001/`. Each capture tool prints a JSON
result (`cases`, `failed`, `files`, `failedWrites`) and exits nonzero when any
case failed. The verify tool re-scans every evidence byte, cross-checks hashes
against the summaries, and rewrites `MANIFEST.json`.

## Case map

| Tool | Cases | Covers |
| --- | --- | --- |
| `capture-first-run.ts` | A1–A10 | fresh interactive both/one/no harness, `--no-connect`, piped no-name error (human and explicit JSON), explicit JSON fresh run, bare piped with name, `up --no-open` JSON, `up` browser branch under an `open` shim |
| `capture-return.ts` | C1–C14 | returning no-workspace (PTY/piped/JSON/status), returning stored workspace (PTY/piped/JSON/status), `up --no-connect` human and JSON, onboard JSON vs human credential surfaces |
| `capture-join.ts` | D1–D18 | invitation receipt and file, join success (PTY/JSON/human/opencode), used/expired/wrong-endpoint/non-JSON/wrong-shape/0644 invitations, initialized-profile refusal, recipient bare/status/up return surfaces |
| `capture-viewer.ts` | E1–E4 | fresh-profile Viewer surfaces, local-profile empty Viewer, headless DOM dumps of both |

## Isolation (every run)

- Fresh temp dirs per scenario for `HOME`, `XDG_CONFIG_HOME`,
  `CAMPFIRE_CONFIG_DIR`, `CAMPFIRE_DATA_DIR`, and `TMPDIR`. Scenario roots use
  a short `cfo-XXXXXXXX` base because tsx's IPC pipe would otherwise exceed the
  104-byte unix-socket path limit; `assertTsxPipeFits` fails fast instead of
  letting pipes collide.
- `CAMPFIRE_URL` and `CAMPFIRE_TOKEN` are deleted from every child environment;
  `CAMPFIRE_TELEMETRY=0`, `NO_COLOR=1`, `TZ=UTC`, `USER=LOGNAME=owner`, plus a
  per-scenario `bin/` first on `PATH` for the `open` shim.
- Listeners bind loopback only (`--port 0` / `--viewer-port 0`); every daemon
  is stopped with a real SIGINT to its process group and no listener outlives
  the run.
- Harness "presence" is a simulated marker directory at the v1.22.0 detector's
  config paths inside the isolated HOME/XDG. No codex or opencode process is
  launched and no real `~/.codex`, `~/.config/opencode`, `~/.campfire*`, or
  browser profile is touched. Headless Chromium runs with its own
  `--user-data-dir` inside the scenario.

## Masking (deterministic, recorded)

Applied BEFORE any file is written; a write is refused (and nothing written)
when a forbidden string survives. Every written file is read back and re-scanned.

| Rule | Replacement |
| --- | --- |
| `cft~`-shaped bearer tokens | `[redacted]` |
| `cfe~`-shaped invitation secrets | `[one-time-credential: redacted]` |
| `/Users/`, `/private/`, `/var/folders/`, `tmp`-absolute paths | `[path]` |
| `127.0.0.1:<port>`, `localhost:<port>` | `127.0.0.1:[port]`, `localhost:[port]` |
| ISO timestamps | `[timestamp]` |
| UUIDs | `[uuid]` |
| `<prefix>_<16 hex>` object ids | `<prefix>_[id]` |
| `ein_inv_<16 hex>` invitation ids | `ein_inv_[id]` |

(`cft~`/`cfe~` in this document stand for the literal underscore-prefixed
token shapes; the tilde follows `safeMention` in `lib/capture.ts`, which keeps
this README itself free of the forbidden needles.)

Exit codes are never masked. PTY files keep their raw CRLF bytes; assertion
comparison normalizes `\r\n` to `\n` only.

## Library layout

- `lib/capture.ts` — redaction/masking, leak checks, isolated scenario env,
  piped runner, daemon runner, `Evidence` (write + verify + hash), tsx pipe
  guard.
- `lib/pty.ts` — python3 PTY driver (real controlling terminal, real `^C`,
  step expectations with send delays).
- `lib/tool.ts` — `--root`/`--out` parsing, baseline verification,
  case records, summary shape, machine facts.
