# Synthetic evidence 04 — Failed request traces

**Observed:** 2026-10-06 09:27 UTC

**Source:** Edge trace export for the three alert request IDs

| Request ID | Time (UTC) | Selected upstream | Edge outcome | `checkout-api` span |
| --- | --- | --- | --- | --- |
| `req-eu-7314` | 09:17:11 | `checkout-v2-eu` | `no_healthy_upstream`, HTTP 503 | none |
| `req-eu-7340` | 09:18:04 | `checkout-v2-eu` | `no_healthy_upstream`, HTTP 503 | none |
| `req-eu-7392` | 09:20:39 | `checkout-v2-eu` | `no_healthy_upstream`, HTTP 503 | none |

All three responses were emitted by the edge before an application span began. The trace export contains no database span for these requests. It does not show why the selected upstream had no healthy endpoint.
