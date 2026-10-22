# ACT-001 schema bounds, idempotency, pagination, errors (frozen, §§3–6)

**Label: FIXTURE EVIDENCE.** Proposed contract, not implemented behavior.

## Bounds

| Field | Bound |
| --- | --- |
| intent (canonical bytes) | ≤ 4 KiB |
| reason | ≤ 500 characters |
| each receipt | ≤ 2 KiB |
| proposal projection (get) | ≤ 16 KiB |
| read pages | default 20, max 100, ≤ 64 KiB |
| raw webhook body | stream-limit 256 KiB, then reject 413 |
| body read deadline | 10 s via existing server primitives, then 408 |
| webhook content | `application/json` with identity encoding only |

Receipt/history pages are separate from the selected proposal summary. Long histories must not silently expand an orientation read. All user/provider labels are untrusted display text.

## Idempotency keys

- Caller-generated `requestKey`, `1–128 printable ASCII`: `^[\x20-\x7E]{1,128}$`.
- Scope: workspace + actor + method + key. Equal normalized input returns the prior result; unequal input conflicts.
- Authenticate and recheck current access before returning a replay; after that, a committed replay does not rerun transitions or fail merely because the revision advanced.
- The reservation itself is the one dispatch identity. Concurrent callers cannot reserve twice, approve two revisions, or append the same receipt twice.

## Pagination shape (lists)

```json
{ "total": 0, "returned": 0, "truncated": false, "nextCursor": null, "items": [] }
```

Lists are workspace-scoped, cursor-bound to actor/query/workspace and a frozen traversal tip, and never scan another workspace. Cursor misuse fails closed.

## Error envelopes

- Ordinary actor paths reuse the existing `ValidationError` envelope (`{error:{code,message,details}}` on CLI stderr; MCP `fail()` text with `isError: true`).
- Ingress outcomes for known configured sources: `200` accepted/duplicate/ignored, `400` malformed or inadmissible timestamp, `401` signature failure, `408` read timeout, `409` conflicting identity/conclusion, `413` too large, `415` unsupported content type/encoding, `503` unavailable store or integration authority. Unknown sources return `404`. Responses expose no workspace or record content.
- Signed payload timestamps are an admission bound, not a cryptographic delivery timestamp: reject first-seen completion timestamps more than 24 h old or over 5 min in the future.
