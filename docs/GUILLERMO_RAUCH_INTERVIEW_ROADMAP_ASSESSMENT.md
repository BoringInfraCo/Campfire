# Campfire roadmap assessment: Guillermo Rauch interview

**Date:** October 16, 2026  
**Status:** Product assessment, not a sprint contract or release decision  
**Source:** User-supplied auto-transcript at `/Users/sergio/.codex/attachments/7e976feb-8a62-4915-aea6-f647fa773418/Pasted text.txt` (33,414 bytes, no timestamps). References below use the speaker turns obtained by splitting the transcript at `>>`; transcription of names and product terms is imperfect. Interview statistics and customer examples are speaker claims, not independently verified evidence for Campfire.

## Assessment

Rauch describes an agent stack of model/harness, tools and data access, durable execution, and files. His Vercel Drive example is a persistent file workspace that agents can share across compute instances (turns 43–55, 93–100). Campfire's differentiated job is the **shared, authorized account of the work**: the goal, current tasks, findings, decisions, evidence references, and who contributed them. A Drive-like file store could hold an output; Campfire should explain why that output exists, who may use it, what decision it supports, and what the next teammate should do. This is a product boundary, not a claim that the file store solves continuation.

The interview supports Campfire's existing thesis more than a new architecture. It does sharpen three questions: Can agents across harnesses use the *same current team understanding*? Can they refer to files and production signals without importing private or unauthorized content? Can people see and correct what agents concluded before another agent acts on it?

**Strategic read:** Vercel's combination of execution, files, and production context could make its own agents effective inside Vercel. That is an inference from the interview, not a verified product comparison. Campfire's opportunity is team continuity across providers and harnesses, with people able to inspect and correct the shared record. If that difference does not matter to real teams, adding a file store will not make Campfire distinct.

## Ideas translated into product bets

| Interview signal | Campfire interpretation | Assessment |
| --- | --- | --- |
| Vercel Drive as shared files across agent instances (turns 46–52, 93–100) | A team needs durable outputs as well as durable understanding. Existing `Artifact` references can point to an external file, report, PR, or deployment. | **Test access to a real reference.** Do not build file storage or automatic ingestion now. An artifact reference is not proof the recipient can open the file. |
| Enterprise data, identity, governance, and audit trails are hard (turns 37–45, 54–55, 78–92) | Campfire's identity, membership, authorization-before-retrieval, provenance, and decision lifecycle are central to the value proposition. | **Deepen the existing wedge.** Show exactly which actor contributed a claim, what evidence supports it, and whether it remains current. Avoid broad connector/IAM work until a concrete access failure is observed. |
| More autonomous agents need production context and event signals (turns 29–35) | A crash or deploy event could become a cited finding or proposed task in a workspace. It should retain source and human/agent attribution. | **Later, narrow integration experiment.** First observe a real incident handoff. Do not turn a log event directly into an authoritative decision or autonomous remediation. |
| Many employees receive different agent answers to the same question (turns 89–92) | The useful common layer is an inspectable team decision and its evidence, including corrections and competing accepted decisions. | **High relevance now.** Test whether two humans and two agents identify the same current state without a private recap. Never silently choose one of conflicting accepted decisions. |
| Agent-facing discovery through CLI, MCP, and machine-readable material (turns 118–124) | Campfire already has CLI and MCP. Agent discovery and a reliable first authorized read may matter more than adding another interface. | **Measure the existing path.** Check whether a cold agent finds and uses Campfire correctly, then whether a teammate returns. Marketplace placement is a distribution option, not evidence of product value. |
| Long-running agents, swarms, wallets, budgets, sandboxes, ephemeral apps (turns 40–52, 60–75, 80–86, 104–116) | These are execution, storage, deployment, and spend-control concerns around Campfire. | **Compose later.** Campfire can record work and decisions produced by these systems. It should not become the agent runner, Drive clone, sandbox, billing wallet, or app host to follow the interview's breadth. |

## Recommended sequence

### 1. Prove that the current shared state works in ordinary team use

Run the already specified two-person observations for Shared Work Home, WCO-001, ATT-001, and the UIX-001 console, plus the real reference-open attempt. In one ordinary task, have Person A and Agent A record a finding, a decision with evidence, an open task, and an artifact reference. Person B and Agent B should enter from a different harness without the first transcript, locate the current decision, open the cited output if authorized, complete or correct the task, and leave a useful state for Person A's return.

Record time to first correct next action, wrong or conflicting answers, missing access to cited references, private recaps required, and whether both people voluntarily return on a later day. This targets Gate B (repeat use) and Gate C (ordinary multi-participant value). The frozen controlled studies and an ordinary-work trace have distinct rubrics; do not collapse their results.

**Decision rule:** If the handoff fails, repair the smallest observed gap in orientation, attention, reference access, or contribution flow. If it succeeds but nobody returns, investigate the recurring workflow before expanding infrastructure.

### 2. If a real reference-open attempt fails, test a provider-neutral artifact handoff

Use one actual externally stored file or generated report, whether on Vercel Drive or another provider. Campfire stores a typed reference, source system, contributor, and relationship to a finding/decision/task; the external system retains the bytes and its own access rules. Test the same reference from two authorized human-agent pairs and from an unauthorized actor. Record stale links, denied access, leakage risk, and whether the reference improves continuation.

This is a candidate Phase 5 integration slice, conditional on the outstanding VIS-001 condition 4 observation. It may be just a safe inspect/open affordance rather than a provider connector. A link that appears in Campfire must not imply Campfire has fetched or verified its target.

### 3. After repeated value, test one production-signal-to-workflow loop

Choose one source event from an existing system (for example, a failed deployment) and one workspace. Capture the event as a cited, reviewable finding and perhaps a proposed task. Measure whether a teammate and a different agent resolve the issue with fewer recaps or missed steps. Keep the external system the source of truth for the event and require an explicit actor for decisions and actions. Controlled action, automatic assignment, and agent execution stay behind Gate F.

### 4. Only then consider hosted-team economics and broader connectors

The interview's budgets and governance claims are a reminder to measure costs, but Campfire needs its own repeat-use, team-value, and retention evidence first. A hosted allowance, quotas, budgets, connector catalog, or file store needs its own product and architecture decision. Adoption counts, deployment volume, and vendor case studies cannot substitute for Campfire's Gate B/C observations.

## Positioning to test

> **Files are where agents leave outputs. Campfire is where a team keeps the meaning of the work: what is current, why it was decided, who can see it, and what happens next.**

Test that sentence with teams using multiple agents. A compelling demo is a real handoff between two people and two harnesses, with a cited external output and no transcript forwarding. If viewers mistake Campfire for another file drive or agent orchestrator, the product story is not yet clear.

## Relationship to the current roadmap

This assessment fits the existing near-term order in `ROADMAP.md`: work continuity, team attention, historical reuse, then a hosted offering if repeat team value appears. The artifact experiment belongs under Phase 5's rule that external systems own native artifacts. The production-signal experiment is a later integration and controlled-action question. The Vercel Drive example highlights the role of durable files in the surrounding stack, while Campfire's own product definition explicitly excludes becoming an artifact host. No gate, sprint verdict, release claim, or architecture decision changes because of this interview.
