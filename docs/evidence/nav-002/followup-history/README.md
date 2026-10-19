# NAV-002 narrow-history follow-up

**Date:** October 18, 2026 local (capture clock crossed October 19 UTC)  
**Label:** fixture and scripted PTY evidence, not human observation.

The committed NAV-002 candidate at `8552976` showed `returned 3 of 3` for
`dec_nav001_review` at 80×24, but only its newest contribution fit. `n/b`
traversed API pages and there was no next API page, so the two older loaded
contributions were unreachable at that viewport. The result document preserves
that limitation for the committed candidate.

This follow-up repair gives an open history panel its own focused frame.
`j/k` moves among contributions on the loaded API page; `n/b` still traverses
API pages. `h` or `esc` returns to the selected source. The heading retains the
API's `returned 3 of 3` coverage while `event 1/2/3 of 3 on this loaded page`
states which contribution is visible. The same authorized fixture database and
real `campfire dashboard` PTY harness produced these sanitized 80×24 frames:

| Frame | Visible contribution | SHA-256 |
| --- | --- | --- |
| `history-first-80x24.txt` | `con_nav001_0283` | `5755362e8f5854d74bac42a3fc04dbd295b7f27e63e330e2a91cb93023de4489` |
| `history-second-80x24.txt` | `con_nav001_0279` after `j` | `acb332e0a6059238cbc3f80e120b1894550aa69394a51c4724f12162c6d4660d` |
| `history-third-80x24.txt` | `con_nav001_0276` after a second `j` | `940c05c9139b98f557057845831495fc93efe8bdf87239dd070ac189dca57fd6` |

Each frame is 24 lines or fewer, 80 columns or fewer, retains the full selected
record and contribution IDs, and has no escape sequence, token, private path,
or unrelated-workspace sentinel. These are scripted captures, so human
comprehension remains **NOT OBSERVED**.
