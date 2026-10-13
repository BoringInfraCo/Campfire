# Gate E evidence helpers

**These helpers emit records. They record nothing themselves, and they do not
produce evidence of a handoff.**

`docs/GATE_E_PROTOCOL.md` §1 defines three claim shapes. Only claim **N** can
close Gate E. This directory serves claim **H — portable handoff**: *"an offline
recipient acted from a handoff packet and their resulting work matches packet
contents."*

§9 says what an H observation must retain:

> For H, retain a sanitized account of the packet fields used and a checkable
> reference to the recipient's resulting work. A packet alone, or a model answer
> without resulting work, is insufficient. Keep private packet bytes outside
> the repository.

The first half of that pairing had no producer. The recheck in
`fixtures/recall/decision-set-recheck/` proved a recipient can *read* a packet;
it produced no recipient work and is recorded `verdict: null`. The tool here
produces the sanitized packet-field account. The second half — recipient work —
is still unproduced, and this tool cannot produce it.

## `packet-evidence.ts`

```
npx tsx scripts/gate-e/packet-evidence.ts <packet-file> [--output auto|human|json]
npx tsx scripts/gate-e/packet-evidence.ts <packet-file> --json      # alias
npx tsx scripts/gate-e/packet-evidence.ts --help
```

Reads one **already-written** handoff packet file and prints a sanitized,
committable evidence record on stdout. Exit codes: `0` record emitted, `1`
invalid packet or unreadable file, `2` refused (well formed, but must not be
committed). `--output auto` prints human on a TTY and JSON otherwise, matching
the `campfire` CLI convention.

It does **not**: spawn an agent or harness, write a Campfire record, create a
Contribution, touch `~/.campfire-pilot/`, write any file, or modify the packet.
The only side effect is stdout.

### What it reads, and what it checks

Reuse, not re-implementation:

| Check | Delegated to |
| --- | --- |
| Byte cap and JSON re-serializability | `serializeHandoffPacket`, `HANDOFF_PACKET_MAX_BYTES` |
| Schema and ordering version | `HANDOFF_PACKET_SCHEMA_VERSION`, `RECALL_ORDERING_VERSION` |
| Decision-set safety claim | `deriveDecisionSetState`, re-derived and compared |
| Superseded member projection | superseded members must be historical, omit rationale, and explain their history |
| Pre-action cursor | `decodeContextCursor`, `assertCursorWorkspace` |
| Every copied text bound | `boundRecallText` with `RECALL_*_MAX_*` |
| Relation id caps | `capIdList` |
| Workspace id shape | `ID_PREFIXES` |

The packet is **not trusted about its own decision safety**. Its `state`,
`operativeDecisionId`, `beforeActing`, and `linkedNextStep` are re-derived from
its own members and recorded transitions by `deriveDecisionSetState` and then
compared. A packet that under- or over-claims is rejected, because an H record
repeating an unauthenticated safety claim would be worse than no record.

Alongside those, a shape guard reads untrusted input: required fields must be
present and correctly typed, and **an unknown key is refused** at the packet,
record, provenance, goal, decision-set, transition, and count levels. The record
copies nothing it has not read.

### Redaction rules

The record is built from structure and provenance. **It copies no record text and
no decision rationale at all.** For every record it keeps `id`, `kind`,
`section`, `lifecycle`, the byte size and truncation flag of `text` and
`rationale`, whether a rationale is present at all, whether a
`historicalExplanation` is present, `needsReview` and its finding ids, full
provenance (creator actor ref, agent session id, created at), and the
`predecessorId` / `successorId` / `basisFindingIds` / `evidenceArtifactIds`
relation ids. Sizes are kept because a reviewer checking a recipient's work
against the packet needs to know whether the field the recipient claims to have
relied on was whole or was cut by a byte cap.

Text the record *does* copy is bounded by the domain's own constants and marked
when truncated. Nothing is ever silently shortened:

| Field | Bound |
| --- | --- |
| `query.text` | `RECALL_QUERY_MAX_CHARS` |
| `workspace.name` | `RECALL_NAME_MAX_BYTES` |
| `goal.title`, `goal.description` | `RECALL_GOAL_TEXT_MAX_BYTES` |
| each `omissions` line | `RECALL_EXCERPT_MAX_BYTES` |

### Refusal rules

The tool refuses to emit, prints why on stderr, and writes nothing, when the
packet contains any of:

1. **A Campfire credential shape** — `\bcf[te]_[A-Za-z0-9]+`. `cft_` is the raw
   token from `generateRawToken`; `cfe_` is the enrollment secret the service
   derives the same way. Both are the same class of leak.
2. **A filesystem path or URI** — a URI with an authority
   (`https://…`, `file://…`, any scheme), a URI without an authority
   (`mailto:`, `tel:`, `data:`), a Windows drive path (`C:\`), a UNC path
   (`\\server\share`), a home directory reference (`~/…`, a bare `~`), an
   absolute POSIX path (including `/`), or a relative path segment (`../x`,
   `./x`, `src/file.ts`).
3. **A foreign workspace id** — any `\bws_…` token that is not this packet's own
   `workspace.id`, plus a pre-action cursor whose workspace does not match.

Refusal reasons **never quote the matched text**. A reason that printed the
string it refused would put the credential on stderr and into whatever captured
it; only the field path is reported (`packet.records[0].rationale`). Field
names are scanned too, and unknown or unsafe field names are shown as
`<field>`. Malformed packet errors show only a checked field path, when one is
available, because imported validators may include input text in their messages.

The emitted **record** carries no path at all — not the input path, not a file
name, not a directory. A read error on stderr names the file the operator typed;
that is the operator's own argument echoed back, and it never reaches the
record.

Every detector is deliberately conservative. A false refusal costs one edited
text field; a false pass puts a credential or a private path into a committed
file. A legitimate workspace name or decision summary containing a URL is
refused, and the operator has to decide what to do about it.

The detectors are patterns, not a parser. They are tuned against the shapes a
packet writer can produce, not against every string a hostile file can contain.
The writer (`src/cli/handoff-file.ts`) never puts a credential or a path in a
packet, so in normal operation no detector fires.

### Belt and braces

The emitted record — in **both** renderings — is scanned by the same detectors
before it is printed, with the record's own workspace id as the only permitted
one. And every packet `text` / `rationale` string of 16 bytes or more is checked
for verbatim appearance in the output. Neither can fire given how the record is
built; both exist so that a future edit that copies something it should not
fails loudly instead of quietly.

### Determinism

The record is a pure function of the packet. It carries **no run timestamp, no
input path, no file name, and no machine identity**, so the same packet always
produces byte-identical output. That is what makes the record checkable later: a
reviewer can re-run the tool and compare.

Two consequences worth stating: the record does not say *when* it was produced,
and it does not say *which file* it came from. Both would break determinism.
Where an observation file names the packet, that naming is the observation
recorder's job, not this tool's.

## How the output maps onto a protocol §9 H observation

The record supplies the sanitized packet-field account. It does **not** supply
the other half.

| §6 field | Supplied by this record | Supplied by the observation file |
| --- | --- | --- |
| Observation id, open/close timestamps | no | yes |
| Participant | issuer and recipient actor refs only | actor ids, actor types, harness, model, agent session |
| Workspace | workspace id and bounded name | the `workspace:read` basis for every read |
| Build | schema and ordering versions | Campfire package version and git commit |
| **[plan-time]** Pre-action position | `sourcePosition`, and the decoded cursor position/phase/tip | the operator's plan-time entry |
| **[plan-time]** Task | no | the ordinary handoff request, verbatim |
| Reused sources | every record and anchor id with kind, section, lifecycle | the surface each was reached through |
| **Resulting work (H)** | **no** | **the dated, recipient-authored work product or action, its location or id, and how it corresponds to the packet fields above** |

So: the record makes **structural packet fields** checkable. It does not carry
decision, finding, or rationale text, so an observation must separately retain
the selected, sanitized excerpts needed to compare the recipient's work with
what the packet said. The bottom-right cell is exactly the cell §3.1.4 and
§5.4 require, and it is not filled by anything in this directory.

## What this tool cannot establish about a handoff

Stated plainly, because the temptation is to read a record as an observation.

1. **It is not recipient work.** A sanitized packet summary is the *packet* half
   of the pairing. §3.1.4 requires a dated, recipient-authored work product or
   action; §5.4 says a packet plus an answer is insufficient. This record is
   neither. It carries `notEvidenceOf` in its own body so a reader who only sees
   the JSON still sees the limit.
2. **It does not check semantic correspondence.** Nothing here compares the
   recipient's output to the packet, and text lengths cannot establish what a
   decision or finding said. The observation must retain the selected,
   sanitized source excerpts and a reviewable comparison. The comparison is
   manual and is not performed here.
3. **It does not show that a recipient read the packet, acted on it, or acted
   differently.** §3.2 says reading, retrieving, paging past, or citing without
   acting differently does not qualify. A packet that was opened and ignored
   produces a perfectly valid record and a null observation.
4. **It does not verify that ids resolve.** Record ids are copied from the
   packet. Whether they still resolve in the workspace is a Campfire read, and
   this tool performs none. §9's "readable by a reviewer" requirement is not
   discharged by this record.
5. **It does not verify packet provenance.** It reads a file. It cannot know
   which workspace produced it, by whom, or whether it was written by
   `campfire handoff-packet` at all.
6. **It is not attributable to a claim-N counterfactual.** §4 is untouched. H
   needs no counterfactual and this tool records none.
7. **A record does not count toward Gate E.** §1: H is recorded, not scored, and
   §8: a claim-P observation plus a claim-H observation is two honest facts and
   not a Gate E pass.
8. **It cannot record a packet written by an older build of the same schema
   version.** The re-derivation check is strict by design, and it has a real
   consequence: `docs/evidence/rcl-003/packet-S2.json` is rejected by this build
   with `packet.decisionSet.linkedNextStep does not match the guidance its own
   members derive`, because that frozen packet predates the projection fix that
   added `linkedNextStep` to the offline packet
   (`fixtures/recall/decision-set-recheck/RESULT.md`). Its S1 and S3 siblings
   still record. A v2 packet written before a v2 projection change is not
   vouchable by a later v2 build, and this tool says so rather than emitting a
   record it cannot stand behind.
9. **The path detectors can be wrong in both directions.** Conservative by
   design, but a pattern is not a proof. A path that looks nothing like a path
   will pass; a legitimate URL in a workspace name will be refused.
10. **It emits; it does not file.** Where the record goes is a separate
    decision. Nothing here writes to `docs/evidence/`.

## Discipline

- Nothing under `src/`, `tests/`, `docs/`, or any `fixtures/` tree is edited.
  The tool reads domain code and imports it; it does not change it.
- No npm script entry is added. Run it with
  `npx tsx scripts/gate-e/packet-evidence.ts`.
- It is not added to `scripts/export-public-release.mjs`.
- It is not a pilot, a replay, or a rerun of any RCL pilot. It scores nothing and
  reports no verdict.
