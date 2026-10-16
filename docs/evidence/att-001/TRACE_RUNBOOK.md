# ATT-001 controlled trace runbook — two-human comprehension trace

Recorder-only. Never shown to participants; it contains no expected answers.
Contract: `docs/Campfire-v1.19-ATT-001-Trustworthy-Team-Attention.md` §6 (human observation rubric H1–H6) and §4 (frozen evaluation).

**FIXTURE EVIDENCE — cannot establish Gate B, C, E, or F; no human trace has been run.** Placeholders marked *to be filled from the frozen fixture receipt* are supplied by the sprint owner from the frozen fixture (`fixtures/attention/att-001/`) before the session. Do not improvise IDs, and never edit the frozen key after a participant begins.

## 0. Eligibility and prerequisites

- **Two different people**; at least one did not build the candidate (contract §6). If two eligible humans are unavailable, record the trace **NOT OBSERVED** with the reason — **do not substitute agents or the builder** (see §10).
- Node ≥ 22 and `npx tsx` available; run everything from the repository root.
- The frozen fixture lives in `fixtures/attention/att-001/` (`seed.ts`, `dump.ts`, `capture-viewer.ts`); all outputs stay under its gitignored `.tmp/` directory.
- Each participant uses **their own** actor-bound loopback Viewer for the frozen workspace, on its own port, in its own process. Never share one listener between participants and never hand a teammate's token to another participant.
- Participants never see this runbook, `SCENARIO_KEY.md`, `baseline/`, or any expected facts.

## 1. Seed the frozen scenario

```bash
npx tsx fixtures/attention/att-001/seed.ts --out fixtures/attention/att-001/.tmp/trace --force
```

- Tokens stay in the gitignored `fixtures/attention/att-001/.tmp/` directory (`tokens.json`, mode 0600). No token value, hash, or invitation secret ever enters a committed file, the participant packet, or a screenshot. The seed prints raw tokens to stdout — treat stdout as sensitive and never paste it into committed evidence.
- From the seed output / receipt / `tokens.json`, record on the scoring form: fixture label, candidate commit, workspace ID `ws_att001_lab`, both human actor IDs (`hum_att001_ana`, `hum_att001_ben`), and the two participant token keys: **`ana`** (P1) and **`ben`** (P2). Outputs are `campfire.db`, `tokens.json` (mode 0600), and `seed-receipt.json` in the output directory.
- Re-seeding into a fresh output directory must reproduce the frozen **records** (the seed asserts them). At the candidate commit the attention lists intentionally include the new coverage and review cues; compare them against `SCENARIO_KEY.md`, never against the v1.18.0 baseline captures.

## 2. Start two actor-bound Viewers (one per participant)

Modeled on the verified SWH-001 flow (`docs/evidence/swh-001/TRACE_RUNBOOK.md`). Terminal A — Participant P1 on port 9415:

```bash
CAMPFIRE_DB="$PWD/fixtures/attention/att-001/.tmp/trace/campfire.db" \
  npx tsx src/cli/index.ts view --port 9415 \
  --token "$(node -p "require('$PWD/fixtures/attention/att-001/.tmp/trace/tokens.json').ana")"
```

Terminal B — Participant P2 on port 9416 (a distinct, recorded port), same shape with the `ben` token key.

- Each Viewer is its own foreground process with its own token; the browser receives no token. Point P1's browser at `http://127.0.0.1:9415` and P2's at `http://127.0.0.1:9416`.
- If a Viewer fails to bind the token at startup (`Unauthorized`), stop and fix the token source; do not run a trace on an unverified identity.
- The database file is `fixtures/attention/att-001/.tmp/trace/campfire.db` (confirmed from the frozen fixture receipt).

## 3. Verify actor binding with the `whoami` proxy check (before the trace)

```bash
curl -s http://127.0.0.1:9415/api/call -d '{"method":"whoami"}' -H 'content-type: application/json'
# expected: {"ok":true,"result":{"actor":{"actorId":"hum_att001_ana","actorType":"human"}}}
```

Repeat on port 9416 for P2. Record both observed outputs in the scoring form. If either actor is wrong, stop; do not proceed.

## 4. Record the start source position before either participant reads

```bash
curl -s http://127.0.0.1:9415/api/call -H 'content-type: application/json' \
  -d '{"method":"get_workspace_context","params":{"workspaceId":"ws_att001_lab"}}'
```

- Record on the scoring form: workspace ID, `generatedAt`, `orientationCursor`, and each slice's `total` / `returned` / `truncated`.
- Repeat on P2's listener; both must serve the same source position. If they differ, stop and re-seed.
- These recorded values frame scoring and stay recorder-side. Expected cue lists never appear in this runbook.

## 5. Perspective order (counterbalanced)

- **P1 opens My work first**, then moves to Team work.
- **P2 opens Team work first**, then moves to My work.
- The recorder notes the order actually followed and records any deviation.

## 6. During the session

- The participant works only in their Viewer: **no CLI, no MCP, no source code, no answer key, no external help**. Short personal notes are fine; anything supplied outside Campfire is a confound and is recorded.
- Up to **15 minutes** per participant for the six questions.
- The recorder does not coach, confirm, correct, reveal record IDs, or re-ask a failed item. Every hint is noted; a hint that supplies an answer **fails that item**.
- Preserve verbatim answers (the participant's own words) and the read path (which records were inspected, in order).
- Sanitized Viewer captures may be produced with the fixture capture script — exact flags *to be filled from the frozen fixture receipt*:

```bash
NODE_PATH=/private/var/folders/b5/wj2djqx569x96bjvf5wclxf80000gn/T/opencode/att-001-pw/node_modules \
  npx tsx fixtures/attention/att-001/capture-viewer.ts \
  --db fixtures/attention/att-001/.tmp/trace/campfire.db \
  --out fixtures/attention/att-001/.tmp/trace-capture --label candidate
```

## 7. Record and score before discussion

- Fill `SCORING_FORM.md` for each participant immediately after their session, **before any discussion** between the participants or with the builder.
- Expected facts are transcribed into the scoring form from the frozen `SCENARIO_KEY.md` by the scorer.
- The second reviewer independently signs H3, H4, H5, and any ambiguous pass.
- A defect repair, a protocol error affecting an item, or a key change requires a **fresh** trace; never rescore a prior run and never edit the key after a participant begins (contract §4, §6).

## 8. Stop and reset

Stop both Viewers with `Ctrl-C` (or `kill <pid>` / `pkill -f "tsx src/cli/index.ts view"`). For a fresh trace, delete and re-seed:

```bash
rm -rf fixtures/attention/att-001/.tmp/trace
npx tsx fixtures/attention/att-001/seed.ts --out fixtures/attention/att-001/.tmp/trace --force
```

## 9. Sanitize before copying anything into `docs/evidence/att-001/`

- **Copy:** item-level verbatim answers, cited source IDs, the read path, session times, perspective order, hints and confounds, the fixture label and candidate commit, sanitized served-state text, and sanitized Viewer screenshots (UI only).
- **Never copy:** token values or hashes, `tokens.json` or any invitation secret, terminal transcripts, raw agent prompts or private messages, customer data, other-workspace records, and the contents of artifacts the workspace cannot access. Check every screenshot for tokens, URLs, and unrelated workspace content before copying; if in doubt, leave it out and note the omission in the scoring form.
- Committed evidence is copied from a run, never regenerated in place.

## 10. If the trace cannot run

If two eligible humans are unavailable — or a participant withdraws — record the trace **NOT OBSERVED** with the dated reason in `docs/SPRINT_ATT_001_RESULT.md` (or on the scoring form while the result record does not yet exist). Do not substitute agents, subagents, or the builder; a single-operator or agent rehearsal may help debug but is not an observation (contract §6). A version bump, tag, or publication with an open human observation requires the separate, recorded release decision — never a silent substitution.
