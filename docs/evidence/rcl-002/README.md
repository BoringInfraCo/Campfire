# RCL-002 retained evidence

The October 11, 2026 pilot used synthetic workspaces and objects. `answers.md` preserves the nine scored answers in locked run order. `packet-S1.json`, `packet-S2.json`, and `packet-S3.json` are the exact synthetic packet bytes presented to the offline recipients. `execution.json` is a derived, credential-free summary of the private event logs and run metadata.

The issued packet files were mode `0600`. A Git checkout does not preserve that private-file mode; the tracked copies here are evidence fixtures, not live handoff files. The tracked files were checked for `cft_` bearer strings, local absolute paths, artifact paths, and foreign-workspace records before being added. No token, database, authentication file, or raw event stream is tracked here.

Raw event streams, per-arm databases, and credentials remain under the private pilot root `~/.campfire-pilot/rcl-002/`. The event-log hashes in `execution.json` identify those local streams but do not preserve them. The retained answers and packets support review of the scored content; the derived summary and result document record the tool-use and sandbox observations. A reviewer without the private run directory cannot independently replay the full tool trace.
