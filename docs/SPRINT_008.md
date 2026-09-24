# Campfire — Sprint 008: Enter the Room

**Status:** Next product sprint — implementation not started  
**Date:** September 24, 2026  
**Company:** Boring Infra Co.  
**Depends on:** Sprint 007 — Harness Readiness Preflight (**GO**)  
**Primary metric:** Time to Context  

---

## 1. Sprint thesis

A human or agent entering an active workspace cold should understand the work
within 30 seconds without a transcript, prepared handoff, or private context.

The workspace—not the session—is the durable unit. Campfire owns shared
understanding, not execution. Agents execute elsewhere and meet at Campfire.

The sprint improves the existing orientation projection and the read-only Viewer.
It does not add a new domain object or make Campfire an agent runtime.

---

## 2. Product surface

The existing model must answer, in a compact projection:

- goal and current intent;
- participating humans and agents;
- active and blocked tasks;
- proposed decisions needing attention;
- accepted decisions constraining execution;
- important findings and artifacts;
- recent changes;
- the most sensible next action.

Improve both:

- `get_workspace_context` for incoming agents;
- Viewer 003 for incoming humans.

Viewer 003 is the "enter the room" experience: **What's happening, Needs You,
Since You Were Here, and Current Work**. It remains a read-only projection, not
chat, orchestration, or an agent dashboard.

---

## 3. Acceptance test

Introduce a cold agent with no private transcript and ask it to answer:

1. What are we trying to accomplish?
2. What has happened?
3. What have we learned?
4. Which decisions constrain the work?
5. What is blocked or needs attention?
6. What should happen next?

Measure:

- time from first Campfire read to a correct context statement;
- number of orientation calls;
- whether the projection is sufficient without manual explanation;
- whether proposed decisions, blockers, and next action are unmistakable.

The 30-second target is a product metric and acceptance signal, not a claim of
universal comprehension.

---

## 4. Doctrine

> The workspace—not the session—is the durable unit.

> Campfire owns shared understanding, not execution.

> Agents execute elsewhere and meet at Campfire.

Campfire is not:

- an agent harness;
- a shared IDE;
- a cloud sandbox;
- agent chat;
- an orchestration engine;
- a replacement for GitHub or existing coding tools.

These statements formalize existing product boundaries; they do not introduce a
new runtime or domain model.

---

## 5. Out of scope

- Schema or migration changes.
- New domain objects, including an `Alignment` object.
- Viewer writes or writable Viewer functionality.
- Orchestration, scheduling, delegation, capability management, or shared
  compute.
- Embeddings, semantic retrieval, or organizational memory.
- Changes to authorization policy.
- Field Trace 001 gate claims.
- Sprint 009–011 implementation.

Any writable Viewer functionality requires a separate explicit sprint
authorization.

---

## 6. Definition of done

Sprint 008 is complete only when:

1. The existing context projection answers the six cold-entry questions.
2. Agent and Viewer surfaces expose the same bounded understanding.
3. The cold-agent acceptance test records Time to Context and orientation calls.
4. Proposed decisions, blocked tasks, and next action are visible without
   transcript access.
5. Viewer 003 remains read-only and authorization-scoped.
6. No schema, domain-object, orchestration, or unrelated product work is added.
7. A result document records evidence, limitations, and the next decision.
