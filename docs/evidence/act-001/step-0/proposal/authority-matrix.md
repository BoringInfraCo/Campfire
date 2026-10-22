# ACT-001 authority matrix (frozen, §4)

**Label: FIXTURE EVIDENCE.** Proposed contract, not implemented behavior.

| Caller | Read same-workspace records | Propose | Approve / reject / cancel before reservation | Reserve and report submission |
| --- | --- | --- | --- | --- |
| Human owner | Yes | Yes | Yes, with their own human credential | Only when designated executor |
| Human member | Yes | Yes | No | Only when designated executor |
| Registered agent member/owner (valid session) | Yes | Yes | No, including approval of its own proposal | Only when designated executor, with its own valid session |
| Viewer (incl. agent viewer) | Yes | No | No | No |
| Non-participant / wrong workspace / invalid credential | No | No | No | No |

Rules frozen with this matrix:

- An agent role named `owner` NEVER satisfies the human-only approval check.
- An instance-operator credential and a webhook signing secret are NEVER workspace human credentials.
- Every mutating commit rechecks membership, role, session, workspace `active` lifecycle, revision, digest, evidence snapshot, and source configuration. A check followed by an unguarded write is insufficient.
- Closed workspaces stay readable and accept no new ACT-001 mutations.
- Failed/denied requests create no Contribution.
- Forged authorship (client-supplied author ≠ authenticated actor) is rejected; clients cannot supply another actor as author.
- Membership revocation or expiry of approver/executor before reservation invalidates dispatch with a bounded recovery hint; no auto-reapproval.
