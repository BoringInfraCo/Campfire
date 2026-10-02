# Campfire — Verification 002 Result

**Classification:** Independent engineering verification of the Sprint 020 candidate
**Date:** October 2, 2026
**Target:** Campfire `v1.9.0` candidate (uncommitted working tree), packaged tarball `release/campfire-darwin-arm64.tar.gz`
**Gate status:** Not a field trace. Gate B and Gate C are not evaluated.
**Evidence:** `evidence/verification-002/` (gitignored, private)

---

## 1. Scope and independence boundary

This run exercises the Sprint 020 teammate-enrollment journey end to end against
the packaged candidate, with two genuinely different harnesses and three real
identities, and captures the real Viewer.

What was independent:

- a fresh database at `/tmp/cfv2/owner/data/verification-002.db`, created with
  `campfire init` on a path that did not exist before this run;
- a fresh workspace `ws_e49d6286eeca4e45` created by `campfire onboard`;
- three fresh human identities and four fresh agents; no reuse of
  `.campfire/campfire.db`, `.campfire/demo.db`, `.campfire/verification-001.db`,
  any `seed` fixture, or any prior sprint workspace;
- two separately rooted "machines" (`/tmp/cfv2/owner` and `/tmp/cfv2/recip`),
  each with its own `HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`,
  `CAMPFIRE_CONFIG_DIR`, `CAMPFIRE_DB`, `CODEX_HOME`, and harness
  configuration. The developer's real `~/.codex`, `~/.config/opencode`, and
  Campfire profiles were not read or written; only a copy of the Codex `auth.json`
  was placed in each isolated `CODEX_HOME` so a real harness could authenticate;
- the installed binary from the staged tarball, not `npm run campfire`.

**This is still one human operator.** Sergio drove both sides from one machine.
That is a rehearsal of the journey, not the Sprint 020 §16 team trace. A
founder simulating a second person does not satisfy two independently operating
humans. The recipient identity "Dana Teammate" is a created identity, not a
second person. Gate B and Gate C remain unmeasured.

| Layer | Real? |
| --- | --- |
| Campfire candidate | Real, packaged v1.9.0 tarball |
| Harnesses | Real Codex 0.150.1 and real OpenCode 1.18.34 |
| Agent sessions | Real: 6 registered sessions across 3 harness identities |
| Viewer | Real, live loopback HTTP, captured by headless Chromium |
| Humans | **One.** Two participant identities, one operator |
| Machines | Two isolated roots on **one** physical machine |
| Shared instance | Local SQLite + HTTP on loopback; no HTTPS, no hosted Workers/D1 |

---

## 2. What the run produced

Real work was recorded, then continued by a different identity, then retrieved
and acted on by the first identity.

### 2.1 Owner human and Codex agent (workspace `ws_e49d6286eeca4e45`)

`campfire onboard` created human `hum_0d370ad14a384fb2` (owner) and agent
`agt_842c0cc412d04c38` (`Sergio Codex`). Session `ses_b85ecca5fde44649`
contributed, all through MCP with no CLI shortcut:

- finding `find_82339d65abb4457b` — the Node version it actually observed;
- decision `dec_6012f827f9924109` (proposed, later accepted by the human) — pin
  the run to Node 22 LTS, treating any other runtime as a candidate defect;
- three tasks and one file artifact pointing at `docs/SPRINT_020.md`.

A second Codex session `ses_21879de8e7ed4d5e` answered the open D1-vs-SQLite
question by reading the real store sources, and recorded finding
`find_7ea…` naming the mechanism: `executeEnrollment()` in `sqlite-store.ts`
runs statements sequentially inside an immediate transaction and takes the first
statement's change count as the claim result, while `d1-store.ts` refuses to run
inside the buffered transaction and submits the whole statement list to
`db.batch`. Every dependent insert is `INSERT … SELECT … WHERE EXISTS` on the
winning claim's nonce, so a losing conditional consume makes every dependent
guard false.

### 2.2 Owner issues an enrollment invitation

```text
campfire invite-teammate ws_e49d6286eeca4e45 --out ver002.invitation.json \
  --url http://127.0.0.1:9601 --allow-loopback --expires-in-hours 24
```

The file was written mode 0600 and contained only the endpoint descriptor, the
`cfe_`-prefixed secret, the workspace id/name/team, expiry, and the permitted
harness list. It contained no owner token, no agent token, no work snapshot, and
no database path.

### 2.3 Recipient joins with OpenCode (isolated recipient root)

```text
campfire join --invitation-file ver002.invitation.json \
  --human-name "Dana Teammate" --harness opencode --allow-loopback
```

Receipt:

```json
{"kind":"workspace_enrollment","human":{"id":"hum_8dec470370e34ddc"},
 "agents":[{"id":"agt_a41be386e8644803","harness":"opencode"}],
 "stages":["enrolled","credentials_saved","connection_prepared","reload_required"]}
```

No local collaboration database was created on the recipient machine. The saved
profile is `mode: "remote"` with the endpoint, human, workspace, and agent
references; credentials stayed in the private bundle.

### 2.4 Recipient agent orients, registers explicitly, and contributes

A cold OpenCode process received only: *"Help me understand this work, what the
team decided, what is blocked, and take the next useful step."* No tool
sequence, no expected findings, and no part of the owner's transcript was
supplied.

Its first `preflight` returned `Unauthorized` with
`nextAction: register_agent_session` — proving enrollment granted authorized read
but did **not** silently create a session. It then registered session
`ses_90bb83096f3c4372` explicitly and recorded three findings:

1. enrollment grants authorized read and requires explicit session
   registration;
2. stored evidence `v20.11.1` conflicts with the accepted Node 22 pin and with a
   re-observed `v22.23.2` runtime — surfaced as a new task rather than by
   silently editing the owner's finding;
3. an enrolled `agent` cannot issue an invitation: refused 403 before any state
   was created.

It closed the "other harness" task and opened
`task_f0876ec7e0ce4e71` for the owner. Every contribution carries
`agentSessionId: ses_90bb83096f3c4372` and the agent's real identity; the Viewer
attributes them to `OpenCode` under `Dana Teammate`.

This is a genuine reciprocal-value moment, not a synthetic one: the teammate
found a real inconsistency in the owner's evidence that the owner had not
noticed, and escalated it instead of overwriting it.

### 2.5 Owner uses a fresh agent process to act on it

A new Codex process (`ses_b6396dab92fa4685`) was given: *"Another person joined
this workspace and contributed to it. Use your Campfire MCP tools to pick up
where the team left off."*

It read the context, found the teammate-opened task, and investigated both shell
environments rather than treating the teammate's re-observation as a
correction. It found the actual cause: the inherited Codex shell resolves `node`
to NVM `v22.23.2`, while a fresh login zsh puts `/usr/local/bin` first and
resolves `v20.11.1`. Both stored observations were correct for their
environment. It recorded the resolution as a finding and completed the
teammate's task.

That is the §11 requirement satisfied in substance: the original participant
retrieved the teammate's contribution and it changed what they did next. It is
not satisfied in §16 form, because both sides are one human.

### 2.6 Recipient adds the second harness, and returns

`campfire connect --harness codex --enroll` created managed agent
`agt_3a3286fadba14a75`, owned by the recipient human, membership role `agent`.
A second `--enroll` for the same harness was refused with
`reconnect_selected_harness` rather than creating a duplicate identity. Plain
`connect` without `--enroll` re-applied the existing identity and minted
nothing.

A later fresh OpenCode process read intervening state under the same identity
and correctly reported the owner's Codex contribution and the resolution.

---

## 3. Recovery rehearsal

A third isolated root joined through a local proxy that forwarded the enrollment
request upstream and then dropped the response, so the server committed while
the client could not know it.

| Step | Result |
| --- | --- |
| First `join` | Exit non-zero: `Enrollment commit is uncertain: the response was lost. Retry the same invitation with the saved request` |
| Local state | `pending-enrollment.json` present at mode 0600 |
| Server state | Invitation consumed; human `hum_d4e93c28372e4488` and agent `agt_97ede2dc38464748` committed |
| Second `join`, same file/name/harness/config | Exit 0, same request id `4f08be73-…`, same human and agent ids, stages complete |
| Identity count | Unchanged: 3 humans, 4 agents. `Robin Recovery` appears exactly once |
| Third `join` | Identical receipt. Still 3 humans, 4 agents, 38 contributions |
| Pending file | Removed only after local finalization succeeded |

The retried request reused the original prepared credential hashes and request
id, so the server returned the recorded receipt instead of provisioning again.
No owner credential was forwarded, and the owner's own token was never needed.

Revocation was then exercised on both kinds:

- `ein_inv_b9b0474a61394c67`, never claimed →
  `revokedAuthority: "unclaimed_enrollment"`;
- `ein_inv_e10a550462cb4148`, already consumed →
  `revokedAuthority: "consumed_receipt_replay"`.

After both revocations all seven participants remained enrolled with their
credentials intact, which is the intended non-offboarding behavior.

---

## 4. Authorization and isolation checks

| Check | Result |
| --- | --- |
| `agent` role issues enrollment invitation | 403 `Only a human workspace owner may administer enrollment invitations` |
| recipient `member` human issues invitation | 403, same message |
| Enrollment secret authenticates `/v1/call` `whoami` | 401 `Invalid or revoked token` |
| Enrollment secret reaches `redeem_enrollment` via `/v1/call` | 400 `Unknown method: redeem_enrollment` |
| Viewer `add_finding` | 403 `Viewer is read-only` |
| Viewer `issue_enrollment_invitation` | 403 `Viewer is read-only` |
| Viewer `get_workspace_context` | 200 |
| Recipient lists workspaces | Only `verification-002` |
| Recipient reads sibling workspace `ws_0b6b89845134457b` | `ParticipantRequired` |
| Endpoint override to a different API base path on the same host | Rejected before network activity: `Endpoint override requires an explicit credential` |
| Recipient `status` after join, no env vars set | Reads the shared backend |
| Fresh process recovery | Same endpoint, human, workspace, and per-harness identity |

A column scan of all 31 contributions plus every column of every table found no
invitation secret and no 64-hex token hash in any Contribution payload.

---

## 5. Viewer capture

Captured by headless Chromium 1.63 against the live loopback Viewer served by
the recipient's remote `up` at `http://127.0.0.1:9603/`.

| File | Content |
| --- | --- |
| `00-ENTIRE-viewer-unclipped.png` | Whole Viewer in one 1440×2200 @2x image: masthead, alignment, needs-you, needs-attention, current work, since-you-were-here, and the complete cross-harness history including both enrollment records and all four agents |
| `01-native-1440x1000.png` | The real operator viewport |
| `02-tall-1440x1400.png` | Taller viewport |
| `03-stream-scrolled-to-top.png` | Stream scrolled away from the pinned bottom, oldest history at the top |
| `06-inspect-finding-detail.png` | Inspect expanded on the Node finding; shows the `detail` line |
| `07-inspect-d1-mechanism.png` | Inspect expanded on the D1 finding; shows the full mechanism with concrete function names |
| `08-inspect-resolved-runtime.png` | Inspect expanded on the owner's resolution; names the teammate's task and both shell paths |
| `*.txt` | Full rendered text of each capture |
| `capture-report.json` | Viewport and scroll metrics per capture |
| `token-leak-check.json` | Credential-isolation record (section 6) |

Console errors: none. No failed request. The Viewer masthead reads
`Dana Teammate human`, which is correct: the Viewer was served inside the
recipient's local backend using that human's credential.

Capture method note, unchanged from Verification 001: the Viewer scrolls inside
`#stream`, not the document, so Playwright's `fullPage: true` alone clips the
workstream. `00-ENTIRE` grows the viewport in 200px steps until
`#stream.clientHeight >= #stream.scrollHeight`, reaching 2200px, and verified
that `#orientation` also does not clip (`client === scroll === 267`).
Selecting a row with `j`/`k` and then clicking it toggles inspect expansion.

---

## 6. Token isolation

Recorded in `evidence/verification-002/viewer/token-leak-check.json`. Across 25
requests on a full page load:

- zero matches for `cft_[0-9a-f]{16,}` or `cfe_[0-9a-f]{32}` in any request URL
  or POST body;
- zero `Authorization` headers and zero `Cookie` headers;
- no token in the served HTML;
- `document.cookie` empty;
- `localStorage` holds only `campfire.viewer.lastSeen.ws_e49d6286eeca4e45`;
  `sessionStorage` holds only `campfire.viewer.workspaceId`.

The human credential that authorizes the Viewer exists only in the local
backend process that serves it.

The evidence tree was scanned for `cft_`/`cfe_` patterns after collection. The
one file that did match was `owner-onboard.json`, because `--output json` prints
each one-time token once by design; both tokens were redacted before the file
was placed in the tree, and the rescan came back clean.

### Live credentials created by this run

These exist only in this transcript, in the isolated roots under `/tmp/cfv2`,
and in that database. Revoke them before discarding the run:

| Token | Identity |
| --- | --- |
| owner human token | `hum_0d370ad14a384fb2` (owner, `ws_e49d6286eeca4e45`) |
| owner Codex agent token | `agt_842c0cc412d04c38` |
| recipient human token | `hum_8dec470370e34ddc` (member) |
| recipient OpenCode agent token | `agt_a41be386e8644803` |
| recipient Codex agent token | `agt_3a3286fadba14a75` |
| recovery human token | `hum_d4e93c28372e4488` (member) |
| recovery OpenCode agent token | `agt_97ede2dc38464748` |

---

## 7. Verdict

**GO** for the engineering claim. The packaged `v1.9.0` candidate completes the
owner-invitation → teammate-enrollment → orientation → explicit-session
contribution → reciprocal-use → return journey with real harnesses on both sides.
Authorization held at every checked boundary. The invitation secret never became
an actor token. Recovery from a genuinely dropped enrollment response reused the
original prepared identity and created nothing new. The Viewer stayed read-only
and token-free. Provenance attributed every contribution to the real agent,
session, owning human, and workspace.

**No product claim.** One human, one physical machine, no later-day return. Gate
B and Gate C remain unmeasured, exactly as `docs/FIELD_TRACE_001_RESULT.md` and
`docs/internal/` record. This run does not satisfy Sprint 020 §16 and does not
change the CONDITIONAL GO recorded in `docs/SPRINT_020_RESULT.md`.

---

## 8. Friction and observations, not defects

1. **A fresh login shell runs Node 20 on this machine.** `/usr/local/bin/node` is
   `v20.11.1` while NVM provides `v22.23.2`, and the candidate declares
   `engines.node >=22`. An installer-driven flow that starts from a login shell
   would run the whole stack on an unsupported runtime. This surfaced only
   because the teammate re-checked the owner's evidence; it is now recorded in
   the workspace as a finding with both reproduction commands.
2. **`provenanceTruncated` is true at 31 contributions**, with `provenanceTotal`
   reported alongside. Context retrieval caps its window while the Viewer shows
   the full activity list. Not a defect, but anyone using context as a summary
   must read the cursor rather than assume completeness.
3. **Two harnesses are required for any real recipient trace.** OpenCode's first
   `preflight` correctly refused writes until it registered a session. That is
   the intended boundary, but it means a recipient agent must be told, or must
   discover, that registration is its own first step.
4. **Non-interactive Codex still needs `--dangerously-bypass-approvals-and-sandbox`.**
   Unchanged from Verification 001. An `approval_policy = "never"` run rejects MCP
   calls.
5. **Two isolated roots on one disk is not two machines.** Filesystem isolation
   and separate harness configs are verified; network location, latency, and a
   genuinely separate operator are not.
6. **Loopback HTTP was used for the shared endpoint**, with the explicit
   `--allow-loopback` exception. No HTTPS endpoint, hosted Worker, or D1
   deployment was exercised, so this run says nothing about those paths.

---

## 9. Evidence hygiene

- The evidence tree contains no bearer token and no enrollment secret; verified
  by pattern scan after redaction.
- `/tmp/cfv2` holds the live database and both isolated profiles. It is outside
  the repository and can be deleted.
- No repository file was modified by any agent during this run. The only repo
  change is this document.
- Codex and OpenCode session transcripts were not captured as evidence. Only
  the Campfire-side structured contributions they produced are recorded.