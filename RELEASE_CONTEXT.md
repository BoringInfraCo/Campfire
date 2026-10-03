# Campfire 1.9.2 release context

This public source snapshot was exported on 2026-10-03 from private canonical source commit `4150728952df3cc266cc6cb1fa2b1a3bbb56c2cb` (dated 2026-10-02T23:50:58-04:00). The identifier is retained for provenance; the private development history and private workspace data are intentionally not mirrored.

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

## Artifacts

- This source snapshot and its manifest.
- Darwin and Linux release archives for ARM64 and x64.
- SHA-256 checksum files for every archive.

## Verification

The publication gate runs `npm ci`, type checking, the production build, and the full test suite. Release packaging smoke-tests the staged CLI, and every published archive is verified against its SHA-256 checksum. Deterministic and cold-harness sprint evidence informed this release; external repeat usage, multi-participant retention, and product-market fit remain unmeasured.

Raw agent transcripts, local Campfire databases, credentials, internal runbooks, private evidence captures, and unshipped development history are not part of this release.
