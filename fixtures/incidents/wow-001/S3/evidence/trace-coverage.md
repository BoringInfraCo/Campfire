# Application trace coverage — synthetic evidence

All times are UTC on 2026-09-18.

At 10:06, the on-call telemetry check showed that application spans were sampled for approximately 10% of `/v1/exports` requests. Neither failed gateway request `gw-084` nor `gw-093` has a corresponding application span in the available trace export. This absence does not show whether either request failed before reaching the app or whether its spans were simply not sampled.

One sampled, successful IAD export request at 09:55 (`gw-101`) spent 420 ms in its database query and completed in 1,460 ms. No failed request in this evidence bundle has a correlated gateway, application, and database trace.
