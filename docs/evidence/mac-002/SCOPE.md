# MAC-002 local scope — 2026-10-27

**Status:** Started only for the local read-only first slice. The toolkit is not frozen. MAC-001B remains HOLD: [verdict](../mac-001b/VERDICT.md). A code change is not the two-Mac exit.

No test result is recorded here. `campfire up` was not run for MAC-001B, and this note does not add a real-profile read.

## This slice may implement

A local read-only screen for one authorized workspace:

- status and currentness
- attribution
- citations
- paging and truncation
- stale and unreachable states
- keyboard navigation

The app stays on the actor-bound loopback Viewer. It must not read SQLite, hold a bearer token, call the hosted Worker directly, or write workspace state.

## Unclaimed

These stay open and are not claimed:

- real-profile parity with SwiftUI on one fresh authorized response
- denied or revoked reads against a live profile
- the integrated two-Mac screen
- signing and notarization
- a toolkit freeze (`GPUIX` or `SwiftUI`)
- the branded Cloud handoff
- the two-Mac CLI update checks

MAC-003 distribution was not started when this scope was written. On October 31, 2026 the public decision is HOLD: [verdict](../mac-003/VERDICT.md). The readable GPUIX window body, an accessibility tree that reaches Refresh and a selected record, and one fresh authorized real-profile read on the same response as SwiftUI remain the missing MAC-001B gates.
