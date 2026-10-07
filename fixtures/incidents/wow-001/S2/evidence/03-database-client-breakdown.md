# Synthetic evidence 03 — Database client breakdown

**Observed:** 2026-10-06 09:25 UTC

**Source:** The same dashboard query split by `service`

For 09:17–09:24 UTC, `settlement-export` has a connection acquisition wait p95 of 790–830 ms and 64 active clients. `checkout-api` has a connection acquisition wait p95 of 17–23 ms and 12–16 active clients. The `checkout-api` wait rate and client count are in their normal range for this hour. The aggregate panel in evidence 02 includes both services.

This breakdown reports client measurements. It does not by itself identify the origin of the HTTP 503 responses.
