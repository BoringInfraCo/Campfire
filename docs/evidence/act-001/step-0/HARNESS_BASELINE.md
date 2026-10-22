# ACT-001 harness baseline

**Date:** 2026-10-21
**Label: FIXTURE EVIDENCE.** Not a sprint verdict. No conversation text is stored here.

| Path | Binary | Result |
| --- | --- | --- |
| Codex | `command -v codex` resolved to `[path]` | **NOT OBSERVED** |
| OpenCode | `command -v opencode` resolved to `[path]` | **NOT OBSERVED** |

Both binaries are installed. No clean non-interactive v1.25.0 discovery or
continuation session was run for ACT-001. Starting one would use the operator's
existing harness config rather than an isolated released context, and this step
does not start an agent. No tool-call trace, elapsed time, output size, or
inference was invented.

Contract §10 D7 stays limited by that gap until a later step runs the real
paths against the frozen fixture. Scripted seed reads are not that observation.
The two-harness continuation prompt is frozen in `continuation-task.md`.
