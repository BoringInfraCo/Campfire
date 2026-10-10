# Campfire

**The shared workspace where people and their agents work together.**

Campfire is a secure, harness-independent collaboration layer for durable work state: goals, tasks, findings, decisions, artifacts, and provenance. It lets another authorized human-agent pair continue the work without receiving the originating private transcript.

## About this repository

This is Campfire's public release mirror. Development happens in a private canonical repository, and each release is exported here as a reviewed source snapshot. Public Git history therefore records what Campfire shipped, not every intermediate development commit.

Git is excellent at recording changes to code. Agent-native development also depends on why work changed: the goal, alternatives, findings, failures, decisions, evidence, produced artifacts, and verification. Campfire is evolving to preserve that richer record as structured, authorized work state. Each public snapshot includes a concise [release context](RELEASE_CONTEXT.md), without private transcripts or internal workspace data.

## Install

The curl and Homebrew installs require Node.js 22 or newer. Nix provides Node.js 22.

```bash
curl -fsSL https://boringinfra.company/campfire/install.sh | sh
campfire
```

`campfire` records the local human on first run. `campfire up` starts the local
API and read-only Viewer, and connects installed Codex or OpenCode harnesses.
The agent creates the workspace and goal when work begins. Past private
sessions are not imported.

Homebrew and Nix install the same checksummed GitHub Release archives. Homebrew uses its keg-only Node.js 22. Nix wraps Node.js 22 into the install. Neither sends install telemetry or starts a service.

```bash
brew install boringinfraco/campfire/campfire
nix profile install github:BoringInfraCo/Campfire
```

`onboard` remains the explicit, non-interactive setup path. Its JSON credential
receipt requires `--json` or `--output json`. `campfire seed --reset` loads a
deterministic demo fixture; it is not how a new operator creates a workspace.

After the release and Worker deployment, install from the versioned URL or the
latest published release:

```bash
curl -fsSL https://boringinfra.company/campfire/v1.15.0/install.sh | sh -s -- --version 1.15.0
curl -fsSL https://boringinfra.company/campfire/install.sh | sh
```

### Generated workspace view

`campfire view` links to one derived page for the selected workspace. The loopback server renders it from the authorized orientation read. The page is not stored, holds no credential, and is sandboxed so contributed text cannot call Campfire. The human comprehension trace and the reference-open observation remain open. This page does not establish Gate B or Gate C.

### Experimental incident playbook

The v1.13 playbook is disabled by default. To inspect its versioned,
read-only guidance in the CLI, run:

```bash
CAMPFIRE_PLAYBOOK=1 campfire playbook incident-investigation --output json
```

`campfire mcp --with-playbook` adds the same definition as the `get_playbook`
tool for that MCP session. Reading it does not change a workspace or run a
workflow. The synthetic pilot and its limits are summarized in
`CHANGELOG.md`.

## Build and verify

```bash
npm ci
npm run typecheck
npm run build
npm test
```

Campfire remains `private: true` in `package.json` and is not published to npm. Distribution uses the install script, the Homebrew tap, and the Nix flake. All three install checksummed GitHub Release archives.

## Telemetry

Campfire sends four anonymous events so it can tell whether it is being installed, activated, and used again: `install_requested`, `install_completed`, `activated`, and `active`. A payload contains a random installation id generated locally plus the Campfire version, OS, architecture, install method, and surface — no prompts, messages, code, diffs, file paths, repository, branch, workspace, or team names, no identity, and no credentials. The field list is enforced in code rather than by policy: every payload is built from a fixed allow-list and the endpoint rejects any undocumented field. Run `campfire telemetry status`, `campfire telemetry disable`, or set `CAMPFIRE_TELEMETRY=0` for one invocation. See [docs/TELEMETRY.md](docs/TELEMETRY.md) for the complete disclosure, and [docs/OPERATOR.md](docs/OPERATOR.md) for hosting the Analytics Engine dataset.

## Contributing

Campfire currently benefits most from concrete problems, use cases, constraints, evidence, interoperability reports, and desired behavior. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before proposing implementation work. Report security issues privately as described in [SECURITY.md](SECURITY.md).

## License

Apache-2.0. See [LICENSE](LICENSE).
