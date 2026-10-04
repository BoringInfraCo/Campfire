# Campfire 1.11.0 release context

This public source snapshot was exported on 2026-10-04 from private canonical source commit `67f9e2e73095f7e5ca5abd9c9b59da2873e1d88c` (dated 2026-10-03T21:05:37-04:00). The identifier is retained for provenance; the private development history and private workspace data are intentionally not mirrored.

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
- A finding can be corrected or withdrawn in place, and a decision can name one predecessor. The old text stays on the old row. Orientation keeps the current record and marks a decision that still cites a non-current finding. This release is conditional: one operator, one machine, and fixture participants. Gate B and Gate C remain unmeasured. Production deployment is separate.

## Artifacts

- This source snapshot and its manifest.
- Darwin and Linux release archives for ARM64 and x64.
- SHA-256 checksum files for every archive.

## Verification

The publication gate runs `npm ci`, type checking, the production build, and the full test suite. Release packaging smoke-tests the staged CLI, and every published archive is verified against its SHA-256 checksum. Deterministic and cold-harness sprint evidence informed this release; external repeat usage, multi-participant retention, and product-market fit remain unmeasured.

Raw agent transcripts, local Campfire databases, credentials, internal runbooks, private evidence captures, and unshipped development history are not part of this release.
