# RCL-002 result — Recall over orientation

**Verdict:** NO-GO / REFRAME on the frozen synthetic pilot. v1.16 stays held.

**Date:** October 11, 2026 (run timestamps cross into October 12 UTC).

**Package:** `1.15.0` unchanged. No tag, public snapshot, push, or deployment.

**Contract:** `docs/Campfire-v1.16-RCL-002-Recall-Over-Orientation.md`.

**Frozen sources:** control `bb3bb61d716f52bb36e5f1c6e6514ece71abc555`; treatment `da6030ab73ab764bbd8478274c12565e8c227ba6`; runner and dated preregistration amendment `6f47f96` before scoring. The RCL-001 NO-GO and its nine original runs are unchanged.

## Verdict against the preregistered bar

The synthetic pass required **both** S1 and S2 treatment to make a better justified next-action choice than control, S3 treatment to be no worse, and all three offline recipients to pass the packet rubric. The observed result was zero qualified treatment wins, S3 no worse, and two of three recipient passes. Therefore the synthetic pass and CONDITIONAL GO are unavailable. Full GO is also unavailable because no ordinary-work Gate E observation was made. Gate B and Gate C remain unmeasured.

- **S1:** Both matched answers chose raw-body HMAC with a 24-hour previous-secret overlap. The control stated that constraint despite its absence from the first orientation payload; its answer did not cite a source id. Under the frozen comparison rule, the pair is **same**, not a Recall win.
- **S2:** The control requested review/replacement of the visible no-guard decision but missed the second accepted attempt-id decision. The treatment found the second decision, then directed that its rule be set as the retry policy while the conflicting no-guard decision remained accepted. It did not seek the explicit retire or predecessor-named accepted replacement required by the key. This is **not a qualified treatment win** and is an unsafe next-action recommendation.
- **S3:** Both matched answers left the limit unset and treated 100 requests/second as a proposal. This satisfies the no-worse check but is not a Recall win.
- **Offline packets:** S1 and S3 recipients passed all five fields. S2 reported both accepted decisions and the off-page attempt-id rationale, but its next action proposed revising the policy and then setting it without requiring an explicit decision transition. It failed the next-action field and therefore the whole packet rubric.

No score, prompt, key, scenario, budget, or arm order was changed after a scored answer. Completed answers were not rerun or replaced.

## Execution and validity

The final unscored preflight passed before the runner was committed: S1–S3 seed and packet checks, direct and Git answer-key denials, lowercase-path and cross-arm probes, recipient checkout read/write denial, and READY probes from locked Codex and OpenCode. `npm run typecheck` and `git diff --check` passed. The runner then repeated the preflight and printed `PREFLIGHT_OK` before the first scored arm. After the pilot, `npm test` passed **1002 tests in 84 files** and `npm run build` passed with bundled Node `24.19.0` first on `PATH`. Host Node `20.11.1` is below the package's `>=22` requirement and caused installer-test failures in an earlier environment-only attempt; the supported-runtime rerun was green.

All nine arms ran once in the frozen order from `2026-10-12T00:12:58Z` to `2026-10-12T00:25:37Z`. Every arm exited 0 with a nonempty answer, stayed under its 20-minute/40-call or 10-minute/20-call budget, and recorded an empty `invalidForScoring` list. There were no empty-answer retries. No matched arm called `get_workspace` or a Campfire write tool. Each treatment called `recall_workspace` once; no control did.

| Order | Arm | Stop | Tool calls | Recall calls | Answer bytes |
| ---: | --- | --- | ---: | ---: | ---: |
| 1 | S1 control | completed | 8 | 0 | 555 |
| 2 | S1 treatment | completed | 7 | 1 | 582 |
| 3 | S1 recipient | completed | 8 | 0 | 4283 |
| 4 | S2 treatment | completed | 7 | 1 | 476 |
| 5 | S2 control | completed | 7 | 0 | 498 |
| 6 | S2 recipient | completed | 4 | 0 | 3798 |
| 7 | S3 control | completed | 6 | 0 | 459 |
| 8 | S3 treatment | completed | 3 | 1 | 468 |
| 9 | S3 recipient | completed | 6 | 0 | 2868 |

Each recipient's event trace includes a `read` of its own `packet.json`; none includes a Campfire MCP call or a checkout-path attempt. Each packet was issued as mode `0600`, targeted `hum_rcl002_reader` in only its scenario workspace, and contained no bearer token, local checkout path, artifact path, or foreign-workspace record. The recipient run directories held no Campfire token or database. The matched arms used separate database copies and credentials.

## Blind scores

Two subagents independently read the same anonymized answer packet, frozen rubric, and ground truth without the arm mapping or private run directories. The blinded packet SHA-256 was `553a66e964a68574f169024992b736e97edba3fce121e54c6ded1539447efc9e`. The A/B mapping was opened after both score sheets: S1 A=treatment/B=control; S2 A=control/B=treatment; S3 A=treatment/B=control. The scores below are resolved against the frozen key. P means pass; F means fail.

| Matched arm | R1 source id | R2 lifecycle/provenance | R3 next action | R4 no promotion |
| --- | :---: | :---: | :---: | :---: |
| S1 control | F | P | P | P |
| S1 treatment | F | P | P | P |
| S2 control | F | F | F | P |
| S2 treatment | F | F | F | P |
| S3 control | F | P | P | P |
| S3 treatment | F | P | P | P |

Both scorers agreed on every verdict-relevant call. One scorer initially marked S2 treatment R4 failed; the other marked it passed. Resolved **pass** under R4's narrow wording: the answer flags the no-guard decision for review and does not say it was revoked or replaced. Its directive to carry out the competing attempt-id rule while both remain accepted fails R3. Both scorers marked R1 failed for every matched answer because no keyed object id was cited.

| Recipient | Goal | Prior evidence | Decision status | Next action | Uncertainty | Whole rubric |
| --- | :---: | :---: | :---: | :---: | :---: | :---: |
| S1 | P | P | P | P | P | pass |
| S2 | P | P | P | F | P | fail |
| S3 | P | P | P | P | P | pass |

The S2 recipient's “review/revise” language was the borderline field. Both scorers failed it because the preregistered key requires an explicit retire or a replacement that names its predecessor and is accepted with a reason. General review followed by setting a policy does not record that transition.

## Evidence and limits

The nine verbatim answers, exact synthetic packet bytes, and a derived execution summary are retained in `docs/evidence/rcl-002/`. Raw event streams and credentials remain in the private pilot directory; the event hashes in the derived summary are identifiers, not a preservation mechanism. The retained record supports review of answer content and packet contents. The private logs are needed to independently replay tool-use claims.

This pilot does not show that Recall changes a next action in ordinary work. It does show that the bounded decision rationale made two of three synthetic offline continuations usable while the S2 conflict remained mishandled. The result does not authorize a v1.16 release. RCL-001 stays NO-GO, and Gate B, Gate C, and Gate E stay open.
