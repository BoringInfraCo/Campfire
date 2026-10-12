# RCL-002 run lock — October 11, 2026

Scored runs have not started. This file freezes the harnesses, models, budgets, and arm order before any scored run. It does not record a score. The seed and runner were written after the original lock. The contract's pre-run check passed before the first scored arm.

## Frozen settings

| Item | Value |
| --- | --- |
| Control source | `bb3bb61d716f52bb36e5f1c6e6514ece71abc555` (`recall_workspace` is absent) |
| Treatment source | `da6030ab73ab764bbd8478274c12565e8c227ba6` (`fix(recall): hold v1.16 and preregister RCL-002`). That commit adds `HANDOFF_RATIONALE_MAX_BYTES`. Do not score against `b6fc55865244ef4fc82db2d46c42b633f4017ab0`; that packet omitted decision rationale. |
| Package | `1.15.0` |
| Matched harness | Codex `0.150.1` at `/Users/sergio/.local/bin/codex` |
| Matched model | `gpt-5.6-sol` |
| Matched reasoning | `high` |
| Recipient harness | OpenCode `2.0.26` at `/Users/sergio/.opencode/bin/opencode` |
| Recipient model | `opencode-go/glm-5.2#max` |
| Pilot root | `~/.campfire-pilot/rcl-002` (outside the repository) |
| Arm order | S1 control, then treatment, then recipient; S2 treatment, then control, then recipient; S3 control, then treatment, then recipient |
| Matched budget | 20 minutes or 40 tool calls, whichever comes first |
| Recipient budget | 10 minutes or 20 tool calls, whichever comes first |

`~/.codex/config.toml` names `gpt-6-sol`. RCL-001 already recorded that this ChatGPT account rejects that id and that `gpt-5.6-sol` at `high` replied READY. Keep `gpt-5.6-sol`.

RCL-001 locked the recipient on `opencode/space-bunny-free#xhigh`. On October 11, 2026, `opencode run` with that id returned `FreeTierError` 403: the free tier can only be used from within OpenCode. This lock uses `opencode-go/glm-5.2#max` because the unscored diagnostic completed with it. Do not edit the RCL-001 lock.

An empty answer is an invalid attempt. The runner keeps that directory with an `-invalid` suffix and repeats the arm once. A second empty answer stops the pilot. A completed answer is not repeated. Do not delete a completed run to force a rerun.

## Seed process

The future seed opens a new sqlite file outside the repository and runs the real service with a caller-chosen id source. It pins every id in `ground-truth.md`. Seeded agents use harness `fixture` and no model. `hum_rcl002_reader` is the viewer recipient and authors nothing in the key.

The seed must reproduce the page facts in `docs/Campfire-v1.16-RCL-002-Recall-Over-Orientation.md` section 5. S1 and S2 each have eleven accepted decisions and one proposal. The older accepted decision has a strictly earlier `updated_at` than the ten newer ones. Equal timestamps are not sufficient, because a tie sorts by id ascending. S2 does not link its two checkout decisions with `replacesDecisionId`, a predecessor, or a successor. S3 has nine accepted decisions and one proposal, and its decision slice is complete. Later contributions push the older S1 and S2 ids out of the first orientation `recentChanges` slice and provenance summaries.

Replacing an existing seed requires `--force`. The seed writes no file inside the repository.

## Arm prompts

The runner reads `scenarios.md` and passes one string to the harness. It does not mount this directory. The control addendum omits the recall query. The treatment addendum names `recall_workspace` and the scenario query. Both addenda forbid `get_workspace` and writes. The recipient addendum names `packet.json` and forbids a Campfire credential.

The packet is produced by `campfire handoff-packet` from a copy of the seed database before the recipient starts. The issuer is the scenario owner. The recipient actor is `hum_rcl002_reader`.

## Isolation

Follow `isolation.md`. The runner refuses to start while `src/` or `package.json` disagrees with the treatment commit, or while the installed harness versions disagree with this file. This lock edit is not part of that treatment tree.

## Preregistration corrections — October 11, 2026

No scored arm has started.

- The S2 answer key was amended the same day it was preregistered. Both checkout decisions stay accepted. The next action is to surface the conflict and seek an explicit retire or an accepted replacement. The harness, model, budget, and arm-order rows above are unchanged.
- Recipient profiles now deny checkout writes for the lowercased path as well as the original path. The unscored diagnostic was rerun after that edit.
- The preflight exposed two additional read paths before scoring: a matched agent could use `git show` on the checkout's `.git` directory to read the committed answer key, and an OpenCode recipient with the host data directory visible could read earlier sessions. The runner now denies `.git` for both checkout spellings and denies the host OpenCode config, data, and state directories for every arm. The recipient receives an isolated OpenCode data directory with only routing and authentication material. Its SQLite database is created afresh from the host schema; only allowlisted routing and authentication rows are inserted, and all history tables are asserted empty. No full host database is copied into that directory.
- The runner uses the bundled Node `24.19.0`, because host Node `20.11.1` is below the package's `>=22` requirement and failed loading the native SQLite module. This changes neither harness nor model. The October 11 unscored preflight passed the S1–S3 seed assertions, packet mode and content checks, direct and Git answer-key denials, prior-pilot and checkout denials, and READY probes from the locked Codex and OpenCode models. The scored arms had not started when this amendment was recorded.
- The final pre-score review also closed reads of earlier preflight packets, model probes, diagnostic output, other and invalid arm directories, and host Codex history. Sensitive paths are denied under their original and lowercase spellings. Control cannot read treatment `src` or `dist`; treatment cannot read control source; recipient cannot read either checkout. All arms are denied writes to the checkout, seed, other arms, prior pilot, and host harness state. A fresh full preflight on the final runner printed `PREFLIGHT_SEED S1/S2/S3 OK`, `PREFLIGHT_SANDBOX control/treatment/recipient OK`, `PROBE_MODEL control/recipient ... READY`, and `PREFLIGHT_OK`. `npm run typecheck` and `git diff --check` passed. There were zero scored run directories at that freeze point.

## After the first scored run

Do not edit this file, `ground-truth.md`, `scenarios.md`, `rubric.md`, or `isolation.md` to fit an output. Record a deviation instead. Do not rescore or rerun RCL-001.
