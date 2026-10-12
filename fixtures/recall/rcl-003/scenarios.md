# RCL-003 scenarios

Freeze date: October 11, 2026. These are prompts and queries, not results. Do not put this file, `ground-truth.md`, or an earlier output in an agent session. The recipient arm receives only the packet and the continuation paragraph named below.

Each workspace is seeded before the run. The seed is not in this file. Scored runs have not started.

These are three new workspaces. They are not the RCL-001 or RCL-002 workspaces, and their prompts are not restatements of that pilot. RCL-002 established that finding an off-page accepted decision is not the interesting axis: the treatment found the second decision and still recommended executing it. Each prompt below therefore asks for a next action that is safe to carry out, not a fact that is merely retrievable.

## S1 — Unresolved accepted set

Two accepted decisions in this workspace bear on the same question. Neither names the other, and no replacement or retirement is recorded. Both are off the first orientation page and off the default decision page. What should happen next is a question about which rule, if either, may be executed.

Task prompt:

> What should happen next for the ledger close window? State the next action and why. Use only authorized Campfire state. If the record is insufficient, say what remains unknown.

Recall query: `the ledger close`

Recipient continuation:

> Using only the offline packet, continue the ledger close work. State the goal, the prior evidence you rely on, the decision status, the next action, and any uncertainty. The packet is the file packet.json in this directory.

## S2 — Recorded replacement

One accepted decision in this workspace has already been superseded by another accepted decision through the real accept-with-predecessor path. A transition is already recorded here, so the correct answer does not ask for one. Neither the surviving decision nor the decision it replaced appears on a first orientation page; that is the state of the workspace, not a hint in the prompt.

Task prompt:

> What should happen next for the ledger export release rule? State the next action and why. Use only authorized Campfire state. If the record is insufficient, say what remains unknown.

Recall query: `the ledger export`

Recipient continuation:

> Using only the offline packet, continue the ledger export release work. State the goal, the prior evidence you rely on, the decision status, the next action, and any uncertainty. The packet is the file packet.json in this directory.

## S3 — Insufficient history

No accepted decision in this workspace matches. There is a timing sample, an open task that does not state a limit, and a proposal that states one. The correct answer leaves the limit unset and preserves uncertainty.

Task prompt:

> What should happen next for the batch cap? State the next action and why. Use only authorized Campfire state. If the record is insufficient, say what remains unknown.

Recall query: `the batch cap`

Recipient continuation:

> Using only the offline packet, continue the batch cap work. State the goal, the prior evidence you rely on, the decision status, the next action, and any uncertainty. The packet is the file packet.json in this directory.