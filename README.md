# Campfire

**The shared workspace where people and their agents work together.**

Campfire is a secure, harness-independent collaboration layer for durable work state: goals, tasks, findings, decisions, artifacts, and provenance. It lets another authorized human-agent pair continue the work without receiving the originating private transcript.

## About this repository

This is Campfire's public release mirror. Development happens in a private canonical repository, and each release is exported here as a reviewed source snapshot. Public Git history therefore records what Campfire shipped, not every intermediate development commit.

Git is excellent at recording changes to code. Agent-native development also depends on why work changed: the goal, alternatives, findings, failures, decisions, evidence, produced artifacts, and verification. Campfire is evolving to preserve that richer record as structured, authorized work state. Each public snapshot includes a concise [release context](RELEASE_CONTEXT.md), without private transcripts or internal workspace data.

## Install

Campfire requires Node.js 22 or newer.

```bash
curl -fsSL https://boringinfra.company/campfire/install.sh | sh
campfire init
campfire seed --reset
campfire show ws_billing_deploy
```

For a version-pinned install:

```bash
curl -fsSL https://boringinfra.company/campfire/v1.2.1/install.sh | sh -s -- --version 1.2.1
```

## Build and verify

```bash
npm ci
npm run typecheck
npm run build
npm test
```

Campfire remains `private: true` in `package.json` and is not published to npm. Distribution uses the install script and checksummed GitHub Release archives.

## Contributing

Campfire currently benefits most from concrete problems, use cases, constraints, evidence, interoperability reports, and desired behavior. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before proposing implementation work. Report security issues privately as described in [SECURITY.md](SECURITY.md).

## License

Apache-2.0. See [LICENSE](LICENSE).
