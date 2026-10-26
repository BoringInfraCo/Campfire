# Campfire v1.26.3 — UPD-001: notice, confirm, update, restart

**Status:** Implemented. The v1.26.3 release decision is separate from this contract.
**Baseline:** Public v1.26.2 CLI with a controlled Cloud alpha.
**Owner decision:** Make an available stable update visible in the human terminal experience, let the person request `/update`, confirm the exact version, and return them to a working Campfire session.

## User outcome

When a newer public stable release is available, a person using Campfire sees one quiet notice: `Campfire 1.26.3 is available. Run /update to review it.` Entering `/update` in the interactive Campfire dashboard, or `campfire update` in a shell, shows installed and target versions, install method, and the effect on the current session. Nothing is installed before an explicit yes. Declining leaves the current version and session running. On success, Campfire shows the installed version and returns to a usable local or remote workspace view. A running local API/Viewer must not keep serving an old version while the CLI claims the update is complete.

Campfire does not currently have a general chat prompt: `/` starts dashboard filtering, and slash commands typed in Codex or OpenCode belong to those agents. UPD-001 reserves the **exact** `/update` plus Return in the Campfire dashboard, while retaining other slash text as filters. It also accepts `campfire /update` as an alias for shell users. Help and the capabilities catalog name the canonical `campfire update` command.

## Implementation boundary

1. **Discover:** Read only the latest published, non-prerelease Campfire release from the canonical public release channel. Compare semantic versions with the installed package, not the Worker version or a repository checkout. Use a short timeout and a locally cached result (at most one network check per day). Human TTY output may show the notice on startup; JSON, MCP, pipes, CI, and noninteractive `campfire up` output keep their existing machine-readable behavior. A failed or offline check is silent and never blocks Campfire. Provide `campfire update --check` for an explicit read-only check. No workspace IDs, tokens, file paths, or usage data go to the update endpoint.
2. **Confirm:** Show the exact target version and release notes link before a `y/N` prompt. Default to no. No automatic download, sudo, or restart from the notice. Noninteractive `campfire update` reports the version and a safe next action without prompting or mutating; any automation option requires a separate explicit design and is outside this sprint.
3. **Install:** For the direct installer channel, download the version-pinned archive and its published SHA-256, validate both before replacement, stage on the same filesystem, preserve the previous runnable installation until the new one passes a version/help smoke check, and roll back on failure. Do not use the installer's current optional-checksum or npm fallback path for an in-place update. Homebrew and Nix installs show their package-manager upgrade instruction and never overwrite a managed prefix. An unknown/source install reports the supported install method and makes no change. Detect architecture before offering the update.
4. **Restart:** For a Campfire process whose lifecycle this invocation safely owns, close the local API/Viewer cleanly, start the newly installed executable with the same profile and startup flags, wait for its health check, and show the new version. If a separate terminal, harness, or process manager owns the service, do not kill it by PID guess or impersonate a successful restart; show the exact restart action and report `restart required` until its reported version changes. A remote profile does not restart the hosted Worker. No update changes workspace records, agent identity, credentials, or session provenance.

## Acceptance

- New version, current version, older/candidate release, offline, slow endpoint, and malformed release response produce the right notice or no notice without delaying ordinary CLI use.
- `/update` plus Return works in the Campfire dashboard; `/anything-else` remains a filter. `campfire update` and `campfire /update` show the same version and confirmation. JSON/MCP output stays parseable.
- No confirmation, EOF, or `n` makes zero install/restart changes. The target is pinned before confirmation, so a later moving `latest` cannot change what gets installed.
- Direct-install checksum mismatch, interrupted download, insufficient write permission, failed smoke check, and failed restart leave the prior working version available and report a truthful recovery step.
- Direct install on local and remote profiles, Homebrew, Nix, and source/unknown installs follow the channel rules above. A local running service reports the new version only after its own health check; an externally owned service explicitly reports `restart required`.
- An installed v1.26.2 → v1.26.3 upgrade preserves the profile, the original workspace and contributions, and the admitted Cloud alpha access. A fresh install and a declined update still work.

## Release boundary

This is a CLI/distribution patch. It adds no Cloud signup, billing, managed execution, database migration, or native Mac app updater. It must not be slipped into the already published v1.26.2 artifacts or deployed Worker. Record the source pin, archive checksums, upgrade matrix, and separate v1.26.3 GO/HOLD decision before release. If safe in-place replacement or restart cannot pass, reduce the release claim to notice plus guided upgrade in a newly approved contract; do not describe it as automatic restart.
