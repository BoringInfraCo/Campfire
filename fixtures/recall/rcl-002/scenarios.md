# RCL-002 scenarios

Freeze date: October 11, 2026. These are prompts and queries, not results. Do not put this file, `ground-truth.md`, or an earlier output in an agent session. The recipient arm receives only the packet and the continuation paragraph named below.

Each workspace is seeded before the run. The seed is not in this file. Scored runs have not started.

## S1 — Off-page accepted decision

Task prompt:

> What should happen next for the partner callback? State the next action and why. Use only authorized Campfire state. If the record is insufficient, say what remains unknown.

Recall query: `partner callback`

Recipient continuation:

> Using only the offline packet, continue the partner callback work. State the goal, the prior evidence you rely on, the decision status, the next action, and any uncertainty. The packet is the file packet.json in this directory.

## S2 — Two accepted checkout decisions

Task prompt:

> What should happen next for the checkout retry? State the next action and why. Use only authorized Campfire state. If the record is insufficient, say what remains unknown.

Recall query: `checkout retry`

Recipient continuation:

> Using only the offline packet, continue the checkout retry work. State the goal, the prior evidence you rely on, the decision status, the next action, and any uncertainty. The packet is the file packet.json in this directory.

## S3 — Insufficient history

Task prompt:

> What should happen next for the partner callback limit? State the next action and why. Use only authorized Campfire state. If the record is insufficient, say what remains unknown.

Recall query: `partner callback limit`

Recipient continuation:

> Using only the offline packet, continue the partner callback limit work. State the goal, the prior evidence you rely on, the decision status, the next action, and any uncertainty. The packet is the file packet.json in this directory.
