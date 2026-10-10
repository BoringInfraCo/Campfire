# Campfire 1.14.0 release context

This public source snapshot was exported on 2026-10-10 from private canonical source commit `1274c0b9283de0f5648bbc99430c9d4dd480ab09` (dated 2026-10-09T21:25:37-04:00). The identifier is retained for provenance; the private development history and private workspace data are intentionally not mirrored.

## Goal

Ship a harness-independent shared workspace where people and authorized agents can continue work from structured team state without sharing private transcripts.

## Decisions

- The workspace remains the collaboration and authorization boundary.
- Humans and agents remain distinct identities with inspectable provenance.
- Public Git history represents shipped snapshots, while intermediate development stays private.
- Campfire remains Apache-2.0, is not published to npm, and is distributed through checksummed release archives.

## Findings reflected in this release

- Structured goals, tasks, findings, decisions, artifacts, and contributions are sufficient for the demonstrated cross-harness continuation flow.
- Authorization must occur before state reaches a harness.
- A read-only journal makes current state and provenance inspectable without exposing an actor token to the browser.
- Agents orient more reliably when readiness, compact context, attention, alignment, and the next honest action are explicit at the interface boundary.
- A caller-held contribution cursor supports truthful return without storing read state or treating the cursor as a summary.
- Contribution and Workspace lifecycle writes preserve actor and active agent-session provenance across local and Workers services.
- Completed Workspaces remain readable with their structured state and contribution history intact.
- Anonymous product telemetry measures installation, activation, and return with an enforced field allow-list, a locally generated installation id, and no identity, content, or credentials; a fetch of the installer is recorded by the Worker and cannot be suppressed from the client.
- Orientation and catch-up stay bounded. Catch-up follows a durable per-workspace append position and a frozen stream tip, so a later contribution that shares a timestamp remains reachable.
- A finding can be corrected or withdrawn in place, and a decision can name one predecessor. The old text stays on the old row. Orientation keeps the current record and marks a decision that still cites a non-current finding.
- The read-only Viewer separates accepted decisions needing review, lists open tasks, labels cited references, and shows completeness for bounded sections even when no rows are displayed. Human comprehension on this updated surface is unverified. Artifact previews and shared highlights remain deferred. Gate B and Gate C remain unmeasured. Production deployment is separate.
- One opt-in, static incident-investigation playbook is available through read-only CLI and MCP surfaces. It changes no workspace schema, default tool list, Viewer permission, or write path. A frozen synthetic pilot met its GO rubric through better recording in three matched pairs; continuation quality stayed at the baseline ceiling. This is not Gate B/C or ordinary team-use evidence.
- One generated workspace page is rendered at read time from the authorized orientation read. It is sandboxed, stored nowhere, and holds no Campfire credential. The release is a founder override. The human comprehension trace, the reference-open observation, and the presentation-defect finding remain open. This is not Gate B or Gate C.

## Artifacts

- This source snapshot and its manifest.
- Darwin and Linux release archives for ARM64 and x64.
- SHA-256 checksum files for every archive.

## Verification

The private 1.14.0 candidate passed `npm ci`, type checking, the production build,
Darwin ARM64 packaging, and a deployment dry run. The full suite's install-channel
version assertion fails while Homebrew and Nix still point at the published v1.13.0
archives. The other checks in that test pass. After the four 1.14.0 archives
exist, pin their actual checksums and run the complete suite. Packaging
smoke-tests the staged CLI, and each published archive must be verified against
its SHA-256 checksum. The generated page has deterministic authorization,
completeness, currentness, non-persistence, and hostile-content checks. No human
comprehension trace or Gate B/C claim follows from it.

Raw agent transcripts, local Campfire databases, credentials, internal runbooks, private evidence captures, and unshipped development history are not part of this release.
