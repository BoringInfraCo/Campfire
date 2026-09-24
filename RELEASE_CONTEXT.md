# Campfire 1.1.0 release context

This public source snapshot was exported on 2026-09-24 from private canonical source commit `fc8c0f8f04aa39de56e0929a8a1dc657813805dd` (dated 2026-09-15T17:42:38-04:00). The identifier is retained for provenance; the private development history and private workspace data are intentionally not mirrored.

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

## Artifacts

- This source snapshot and its manifest.
- Darwin and Linux release archives for ARM64 and x64.
- SHA-256 checksum files for every archive.

## Verification

The publication gate runs `npm ci`, type checking, the production build, and the full test suite. Release packaging smoke-tests the staged CLI, and every published archive is verified against its SHA-256 checksum.

Raw agent transcripts, local Campfire databases, credentials, internal runbooks, private evidence captures, and unshipped development history are not part of this release.
