# Synthetic evidence 01 — Customer error alert

**Observed:** 2026-10-06 09:21 UTC

**Source:** Checkout edge alert `eu-orders-submit-5xx`

The five-minute 503 rate for `POST /orders/submit` in `eu-west-1` rose from below 0.2% to 21.8% for the window 09:17–09:21 UTC. The first 503 in the alert sample is at 09:17:11 UTC. Other regions remain below 0.2%. Affected customers receive the error before an order confirmation page appears.

Sample failed request IDs: `req-eu-7314`, `req-eu-7340`, `req-eu-7392`. The alert records the HTTP status and route, but does not identify the failing component.
