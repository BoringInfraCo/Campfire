# ARH-001 trace runbook — ordinary-work reference handoff

Recorder-only. Never shown to participants; contains no expected answers. Contract: `docs/Campfire-v1.21-ARH-001-Artifact-Reference-Handoff.md` §3.2 (ordinary-work attempt), §3.3 (bounded change), §4 (authorization and evidence handling), §5 (D1–D6), §6 (H1–H6).

**FIXTURE EVIDENCE — cannot establish ordinary use or external access. The fixture exercises in §1 are rehearsal and material calibration only; they are never evidence.** The eligible §3.2 attempt (§2) and the eligible §6 handoff (§3) use **real work and a real target**, not the fixture.

## 0. Eligibility and prerequisites

- **§3.2**: one real human doing their own ordinary work, with a real externally stored output they have reason to inspect. The owner may count, with their role disclosed (founder or not; whether the work was prompted for evaluation). A synthetic fixture, a fabricated URL, a scripted builder walkthrough, or an agent acting as the sole "human" does not qualify.
- **§6**: two distinct people and two different agent harnesses; at least one human did not build the candidate; the founder's participation is disclosed. A case whose reference was never expected to be available to B is an access-boundary observation, not an eligible full handoff.
- If the required humans are unavailable, record **NOT OBSERVED** with the reason (§7). Do not substitute agents, subagents, or the builder.
- Node ≥ 22 and `npx tsx`, run from the repository root. Each participant uses **their own** actor-bound identity, credential, and Viewer; never share one listener, token, or profile between participants.
- Participants never see this runbook, `SCENARIO_KEY.md`, `SCORING_FORM.md`, `baseline/`, or any expected fact. Tokens never enter a committed file, the participant packet, or a screenshot.

## 1. Fixture rehearsal (rehearsal and material calibration ONLY — never evidence)

Use this to verify a fresh environment, the Viewer flow, and the recorder's handling of the materials. A fixture-only run with participants is still a **rehearsal**: it scores zero §3.2/H1–H6 observations because the `example.com` targets are synthetic and their external state is never asserted.

```bash
# 1. Seed the frozen scenario (deterministic ids and clock; outputs stay gitignored).
npx tsx fixtures/artifact-handoff/arh-001/seed.ts --out fixtures/artifact-handoff/arh-001/.tmp/rehearsal --force

# 2. (Optional) dump the served state and check determinism against a second seed.
npx tsx fixtures/artifact-handoff/arh-001/dump.ts \
  --db fixtures/artifact-handoff/arh-001/.tmp/rehearsal/campfire.db \
  --tokens fixtures/artifact-handoff/arh-001/.tmp/rehearsal/tokens.json \
  --out fixtures/artifact-handoff/arh-001/.tmp/rehearsal/dump
#   seed a second time into .tmp/run-b, dump it, then: diff -r <run-a>/dump <run-b>/dump   (expect no output)

# 3. Two actor-bound Viewers (one per rehearsal participant, distinct ports).
#    Terminal A — Ana:
CAMPFIRE_DB="$PWD/fixtures/artifact-handoff/arh-001/.tmp/rehearsal/campfire.db" \
  npx tsx src/cli/index.ts view --port 9417 \
  --token "$(node -p "require('$PWD/fixtures/artifact-handoff/arh-001/.tmp/rehearsal/tokens.json').ana")"
#    Terminal B — Ben:
CAMPFIRE_DB="$PWD/fixtures/artifact-handoff/arh-001/.tmp/rehearsal/campfire.db" \
  npx tsx src/cli/index.ts view --port 9418 \
  --token "$(node -p "require('$PWD/fixtures/artifact-handoff/arh-001/.tmp/rehearsal/tokens.json').ben")"

# 4. Actor-binding check per listener (record the observed output).
curl -s http://127.0.0.1:9417/api/call -d '{"method":"whoami"}' -H 'content-type: application/json'
# expected on 9417: {"ok":true,"result":{"actor":{"actorId":"hum_arh001_ana","actorType":"human"}}}
curl -s http://127.0.0.1:9418/api/call -d '{"method":"whoami"}' -H 'content-type: application/json'
# expected on 9418: {"ok":true,"result":{"actor":{"actorId":"hum_arh001_ben","actorType":"human"}}}

# 5. (Optional) the terminal dashboard rehearsal surface (interactive TTY only).
CAMPFIRE_DB="$PWD/fixtures/artifact-handoff/arh-001/.tmp/rehearsal/campfire.db" \
  npx tsx src/cli/index.ts dashboard ws_arh001_lab \
  --token "$(node -p "require('$PWD/fixtures/artifact-handoff/arh-001/.tmp/rehearsal/tokens.json').ana")"
```

- Raw tokens live only in the gitignored `.tmp/` directory (`tokens.json`, mode 0600); the seed prints raw tokens to stdout — treat stdout as sensitive and never paste it into any file.
- Compare served facts against `SCENARIO_KEY.md` (recorder-side only, for serving checks). If anything diverges, stop and re-check the fixture revision; never adjust the key to match a rehearsal.
- `fixtures/artifact-handoff/arh-001/.tmp/` is gitignored: seeds, dumps, and rehearsal databases never get committed. If a rehearsal output is ever copied anywhere, it is labeled "FIXTURE EVIDENCE — rehearsal, not ordinary use".

## 2. Eligible §3.2 procedure — ordinary-work reference-open attempt (real work)

1. **Pick the case** (per `PARTICIPANT_PACKET.md` Part A): an existing real task of the participant; an actual externally stored output the task depends on; the participant must have reason to inspect it. The participant receives no special instructions — they work normally.
2. **Preflight, before the recipient starts** (recorder only): identify the workspace records and source position; the external system; whether the recipient should have external access (verified by the recorder's own means); a checkable safe next step. **Verify the target exists and never open it for the recipient or show them the answer.**
3. **Blind recipient rules:** do not direct the participant to the Artifact ID, the external URL, or a preferred action. They get only their own normal credentials and tools.
4. **Observe and record** in the ledger (`EVIDENCE_PLAN.md` §7): first Campfire read; path to the reference; attempted open; external outcome (opened / denied / stale / unavailable); manual help; verbatim interpretation (their own words); dependent work. Preserve a denied attempt as denied — never silently substitute another link.
5. **Classify** the attempt in `SCORING_FORM.md` §2 (exactly one of the five rows) and write the VIS-001 attribution note: a later review against VIS-001 condition 4 happens under VIS-001's own rule and record; ARH-001 never declares condition 4 met.
6. **No eligible attempt occurred** (the participant never needed to open anything, or the attempt was not a real one): mark NOT OBSERVED with the dated reason. No product repair follows from a fabricated attempt.

## 3. Eligible §6 procedure — two-human/two-harness handoff (real work)

1. **Confirm eligibility:** two distinct humans; Human B did not build the candidate (for a baseline case with no candidate: record roles); Agent B runs on a different harness from Agent A; founder participation and whether the work was prompted for evaluation are recorded.
2. **Frozen records before B begins:** the recorder captures (a) the real workspace's relevant records — task, artifact, finding evidence, decision citations and lifecycle states — at a frozen source position; (b) the preflight access expectation: the recorder verifies the real target exists and documents whether B should have access, **without showing B and without opening it for B**; (c) the checkable safe outcomes. The frozen capture is the scoring key for this case; sanitize it before it enters `docs/evidence/arh-001/` (external contents are never retained).
3. **Two actor-bound Viewers for the humans, one each:** each human runs their own Viewer bound to their own actor with their own credential — locally (`CAMPFIRE_DB=<the real database> npx tsx src/cli/index.ts view --port <recorded port> --token <their own token>`) or against the team's endpoint (`npx tsx src/cli/index.ts view --url <team URL> --token <their own token>`). Never share one listener or token. **Per-actor `whoami` checks** (same `curl … /api/call` call as §1 step 4) before the session; record both observed outputs. If either actor is wrong, stop.
4. **Prompts:** give Human B and Agent B only the frozen prompts and session rules from `PARTICIPANT_PACKET.md` Part B, with only the authorized workspace reference filled in. Agent B uses its own harness, its own Campfire access, and its own external credentials.
5. **No hints before the first interpretation is recorded.** Capture B's first interpretation verbatim before any debrief or help; note every later hint and what it supplied.
6. **H6 return read:** A or Agent A reads B's contribution later, in a **fresh process**, and takes a dependent action or correctly records why work remains blocked. Do not instruct the return; a later voluntary return is logged separately under Gate B rules and never counts for H6.
7. **Score before debrief** (`SCORING_FORM.md` §4): immediately after the session, against the frozen key. The second reviewer independently checks H2–H5 and any ambiguous pass; disagreements are retained with both readings and **resolved against the pre-run key**.
8. **Preserve the attempt.** A repair or a protocol error requires a **fresh, dated attempt**; never rescore or edit the frozen records. The first attempt and its score stay in place.

## 4. Reset and debrief

- Stop Viewers with `Ctrl-C` (or `kill <pid>` / `pkill -f "tsx src/cli/index.ts view"`).
- Rehearsal reset: `rm -rf fixtures/artifact-handoff/arh-001/.tmp/rehearsal` and re-seed per §1.
- Eligible attempt: the real workspace records are **never reset, edited, or replayed**. Preserve what happened (including failures and denials); debrief only after scoring.

## 5. Sanitization checklist — run before any evidence is committed

- [ ] No token values, token hashes, or invitation secrets anywhere (search for `cft_` and `tokens.json` content).
- [ ] No absolute home paths (`/Users/`).
- [ ] No `UNRELATED_FINDING_SENTINEL_arh001_do_not_leak` and no unrelated-workspace content.
- [ ] No raw prompts, raw transcripts (human or agent), private messages.
- [ ] No external contents — never fetch or store the target's bytes to "prove" an attempt.
- [ ] No credentials, signed URLs, or sensitive query strings; the external work-product reference is retained only at the minimum sanitized level needed to audit the claim.
- [ ] No customer data.
- [ ] Every screenshot checked for tokens, private URLs, and unrelated content; if in doubt, leave it out and note the omission.
- [ ] Denied attempts preserved as denied; no substituted links.
- [ ] Rehearsal outputs (if any) labeled "FIXTURE EVIDENCE — rehearsal, not ordinary use".

## 6. Explicit prohibitions

- **No agent-as-human substitution.** A subagent, an agent, or one operator playing two people is a rehearsal, never an observation (contract §3.2, §6).
- **No builder as Human B** for the full handoff claim.
- **No transcript and no prepared recap** given to B or Agent B; Campfire's recorded state is the only transfer medium.
- **No hints before B's first interpretation is recorded**; a hint that supplies an expected answer means that item cannot be scored PASS.
- **No instructed "voluntary" return** (H6 is A/Agent A's fresh-process read; later voluntary returns are logged separately).
- **No opening the target for the recipient**, no revealing the artifact ID, external URL, or preferred action, and no confirmations of expected access.
- **No silent substitution** when a target denies, is stale, or is unavailable.
- **No re-scoring**; the pre-run frozen key is never edited after a participant begins.
- **No fixture run scored as evidence**; a fixture-only run with participants is a rehearsal.
- **No fabricated URL, synthetic fixture, or scripted walkthrough** as the §3.2 attempt.

## 7. If the case cannot run

If eligible participants are unavailable, or a participant withdraws, or no eligible ordinary-work attempt occurs, record **NOT OBSERVED** with the dated reason (in `docs/SPRINT_ARH_001_RESULT.md`, or on the scoring form while the result record does not yet exist). Agents, fixtures, and rehearsals are never substituted. A publication with an open or failed human observation requires a separate, recorded release decision; an override cannot turn NOT OBSERVED or FAIL into PASS.

---

**Provenance:** frozen with the ARH-001 materials on October 16, 2026, before any product change, attempt, or score. Rehearsal commands match the frozen fixture at `fixtures/artifact-handoff/arh-001/`; real-work procedures follow contract §3.2, §4, and §6.
