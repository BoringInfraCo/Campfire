# RCL-003 retained evidence

The October 11–12, 2026 pilot used synthetic workspaces and decisions. `answers.md` preserves the nine verbatim scored answers in locked run order. `packet-S1.json`, `packet-S2.json`, and `packet-S3.json` preserve the exact packet bytes presented to the three offline recipients. `execution.json` is a derived, credential-free summary of the private run metadata and event-log hashes.

The issued packet files were mode `0600`. These tracked copies are evidence fixtures, not live handoff files. Before retention, all three packets were checked for `cft_` bearer strings and local home, private, and pilot paths; no match was found. No token, database, sandbox profile, authentication file, or raw event stream is tracked here.

Raw event streams, per-arm databases, and credentials remain under the private pilot root `~/.campfire-pilot/rcl-003/`. Hashes identify those local streams but do not preserve them. The retained answers and packets support review of scored content; a reviewer without the private run directory cannot independently replay every tool-use claim.
