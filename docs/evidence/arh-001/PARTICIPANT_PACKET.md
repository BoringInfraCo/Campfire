# ARH-001 participant packet — ordinary-work reference handoff

**Recorder note: this file has two parts.** Part A is recorder-only instructions for the §3.2 ordinary-work attempt; the participant in that attempt receives nothing from this file — they simply do their own work while the recorder observes. Part B holds the §6 prompts and session rules; copy only the blocks marked *for the participant* into the participant's context. This packet contains **no artifact IDs, no URLs, no expected access answers, and no preferred actions**; expected facts live only in the restricted `SCENARIO_KEY.md`, which participants never see.

Contract: `docs/Campfire-v1.21-ARH-001-Artifact-Reference-Handoff.md` §3.2, §4, §6.

---

## Part A — §3.2 ordinary-work reference-open attempt (recorder instructions)

Goal: observe **one real human** attempting to open **one real external output** they have reason to inspect while doing their own ordinary work. The attempt is theirs, unprompted in its specifics. This is not the fixture, and it is not a scripted walkthrough: a synthetic fixture, a fabricated URL, a builder demonstration, or an agent acting as the sole "human" does not qualify.

### A1. Choosing the case

- Use an **existing task** from the participant's real work — something already on their plate, not created for the sprint.
- The task must depend on an **actual externally stored output** (a report, file, PR, deployment, dashboard) that already exists in its external system.
- The participant must be someone who has **reason to inspect that output** and whose ordinary tools and credentials are their own. The owner may count as the participant, with their role disclosed (founder or not; whether the work was prompted for evaluation).
- If the participant would not naturally reach the open step during the observed interval, do not manufacture it: record what actually happens, up to and including NOT OBSERVED (no eligible attempt).

### A2. Preflight — before the recipient starts

The recorder, without the participant watching:

1. Identifies the relevant **Campfire workspace records** (the task; any task/finding/decision/artifact that the work depends on) and the **source position** (record IDs and the served position used).
2. Identifies the **external system** (which system holds the target) and the **expected access boundary**: should this recipient have external access, from their own identity?
3. **Verifies the target exists** by the recorder's own means, and documents how that was verified and whether the recipient should have access — **without showing the recipient the answer and without opening it for them**. Do not stage the target open, do not pre-load it in the recipient's browser or profile, do not demonstrate the open.
4. Identifies a **checkable safe next step** the recipient could take after using the output (or the specific safe block if access is expected to fail).
5. Records all of it in the ledger (`EVIDENCE_PLAN.md` §7) before the recipient starts.

### A3. What not to reveal

Do not direct the recipient to the **Artifact ID**, the **external URL**, or a **preferred action**. Do not confirm or deny whether the open will work. Do not mention this packet, the key, the scoring form, or any expected fact.

### A4. What the recipient gets

Only their own normal credentials and work tools, in their own normal environment — nothing staged, nothing shared, no teammate's token or session.

### A5. Recorder observation duties

Record, in order: the recipient's **first Campfire read**; the **path** from the recorded work to the stored reference; the **attempted open** (what action, on which surface); the **external outcome** (opened / denied / stale / unavailable, with the visible reason); any **manual help** (who, when, what it supplied); their **verbatim interpretation** of what they found (their own words); and any **dependent work** they took. A denied attempt is preserved as denied — **never silently substitute a different link**. Classify the attempt per the §3.2 table in `SCORING_FORM.md` §2 and write the VIS-001 attribution note. If no eligible attempt occurs, mark the observation NOT OBSERVED with the reason; no product repair is justified by a fabricated attempt.

### A6. Recorder checklist (fill per attempt; mirrors the ledger)

| Field | Entry |
| --- | --- |
| Attempt id / date | |
| Participant role disclosure (founder or not; prompted for evaluation or not) | |
| Recorder | |
| Workspace / source position | |
| Target system | |
| Preflight access expectation + how verified | |
| Recipient's first Campfire read | |
| Path to reference | |
| Attempted open | |
| External outcome (opened / denied / stale / unavailable) | |
| Manual help | |
| Verbatim interpretation (own words, sanitized) | |
| Dependent work | |
| Classification per §3.2 table | |
| VIS-001 attribution note | |
| Second reviewer + disagreements | |

---

## Part B — §6 two-human / two-harness handoff (participant prompts and rules)

Roles: **Human A + Agent A** recorded the work (they may have already done so; simultaneous agents are not required). **Human B + Agent B** must find the source, reach it with their own authority, respect the recorded decision state, take a checkable next step, and leave the outcome with their provenance in the existing workspace records. Later, **A or Agent A return-reads in a fresh process** (H6). Two distinct humans on two different agent harnesses; at least one human did not build the candidate; the recorder discloses whether the founder is a participant and whether the work was prompted for evaluation.

### B1. Prompt for Human B (frozen — copy verbatim, placeholder `⟨workspace⟩` filled with the authorized workspace reference only)

> "A teammate and their agent recorded work in the Campfire workspace ⟨workspace⟩ that needs a second person to carry it forward. Please continue it. Find the source that the recorded handoff depends on, reach it with your own access if you can, respect what the recorded decisions say about how to proceed, and take one concrete next step that a teammate could check. If you cannot reach it or cannot proceed, record that honestly instead of substituting something else. Leave what you did — and anything that blocked you — in the workspace with your own name attached, so it can be read later without any private recap. You have only your own normal tools and credentials; no one will summarize the earlier session for you or walk you through it."

(Recorder: `⟨workspace⟩` receives only the workspace name/id the participant is authorized to see. Never fill it with an artifact ID, an external URL, or a preferred action.)

### B2. Prompt for Agent B (frozen — copy verbatim, placeholder `⟨workspace⟩` filled with the authorized workspace reference only)

> "Continue the handoff work recorded in the Campfire workspace ⟨workspace⟩. It was left by a different teammate and a different agent; you have not seen their session, and no recap will be provided. Find the source that the recorded handoff depends on, reach it with your own credentials and tools if you can, respect the recorded decision state, take one concrete next step that a teammate could check, and record your outcome — or an honest record of what blocked it — in the workspace with your own provenance. If you cannot reach it, record that truthfully instead of substituting something else."

(Recorder: `⟨workspace⟩` receives only the workspace name/id Agent B is authorized to use. Never fill it with an artifact ID, an external URL, or a preferred action.)

### B3. Session rules (read with the participant; recorder applies)

- **No transcript, no prepared recap.** B and Agent B receive no summary of A's session, no private messages, and no hand-prepared guide. Campfire's recorded state is the only transfer medium.
- **Two distinct people, two harnesses.** Human B is a different person from Human A; Agent B runs on a different harness from Agent A. At least one human did not build the candidate; the founder's participation is disclosed. The recorder records whether the work was prompted for evaluation.
- **No hints before the first interpretation is recorded.** B's first interpretation is captured verbatim before any debrief, clarification, or help. After that, any hint or manual help is noted with what it supplied; a hint that supplies an expected answer means the affected item cannot be scored PASS.
- **The recorder never opens the target for B.** The recorder does not reveal the artifact ID, external URL, or preferred action, does not confirm whether the open will work, and does not substitute another link if the target denies or fails.
- **Own authority only.** Each participant uses their own credentials, tokens, and tools; no shared account, no teammate's session, no recorder-held credential.
- **Score before debrief.** Items are scored immediately after the session, before discussion; never edit the frozen records or the key once B begins.
- **Return read.** A or Agent A reads B's contribution later, in a **fresh process**, and takes a dependent action or correctly records why work remains blocked. A later *voluntary* return is logged separately under Gate B rules and is **never instructed**; an instructed return does not count as one.
- **Real work only.** This case runs on a real workspace with a real target. Running it on the deterministic fixture is a rehearsal: it scores nothing.

---

**About this packet (recorder-facing):** frozen with the ARH-001 materials on October 16, 2026, before any product change, attempt, or score. FIXTURE EVIDENCE elsewhere in this directory cannot establish ordinary use or external access; this packet's real-work procedures are the only paths to an eligible §3.2 or §6 observation.
