# Campfire — Sprint 019: Carry the Work Out

**Status:** Complete (GO)
**Date:** September 27, 2026
**Company:** Boring Infra Co.
**Depends on:** Sprint 018 — Enter With the Session (**GO**); `v1.6.0`
**Target release:** `v1.7.0`
**Primary metric:** A meaningful Campfire state transition reaches one explicitly configured webhook as a signed, provenance-backed event without coupling Core to the destination or weakening the originating mutation.

---

## 1. Sprint question

> Can Campfire surface meaningful shared work state outside Campfire through one
> reliable, secure, vendor-neutral boundary while keeping Campfire Core unaware
> of Slack, Linear, or any future integration?

Campfire already records structured workspace state and an append-only
Contribution for every meaningful mutation. That state remains inside the
Campfire interfaces and Viewer. A team that works primarily in another system
will not naturally see that a task became blocked, a decision was accepted, or
a goal completed.

This sprint introduces the smallest outward boundary:

```text
Authorized Campfire mutation
        |
        v
Materialized work state + Contribution
        |
        | same transaction
        v
Immutable domain event
        |
        | after commit
        v
Bridge dispatcher
        |
        v
Signed webhook delivery
```

The webhook proves the event and delivery primitives without teaching Core
about a vendor. Slack, Linear, GitHub, email, and other adapters are not part of
this sprint.

---

## 2. Product hypothesis and roadmap relationship

The hypothesis is:

> Surfacing a small set of meaningful Campfire transitions in a system the team
> already watches will make the shared workspace easier to keep in ordinary use.

This is a deliberately early, narrow slice of the Roadmap's integration
direction. It is not a claim that Campfire has completed Phase 4 or Phase 5.
It does not establish Gate B repeat usage, Gate C multi-participant value, or
Gate F controlled action. Its field trace may inform whether outward visibility
helps Gate B, but successful delivery alone is not repeat-usage evidence.

The sprint does not authorize external work creation or generic capability
execution. It establishes a one-way projection of facts that already became
authorized Campfire state.

---

## 3. Architectural boundary

Campfire Core owns:

- workspace-scoped collaboration state;
- lifecycle transitions;
- authorization before mutation and retrieval;
- actor, session, and human-agent provenance;
- Contributions;
- semantic domain events produced by successful state changes.

The bridge boundary owns:

- selecting configured event types and workspaces;
- projecting an event into an outbound request;
- signing and delivering that request;
- retry state and delivery inspection;
- destination-specific representation in future adapters.

Core must not import, name, or branch on Slack, Linear, GitHub, email, or any
other destination. A bridge must not redefine whether a Campfire transition is
valid or manufacture collaboration state that Core did not record.

The dependency direction is:

```text
Interface
   |
Application service
   |
Authorization + lifecycle rules
   |
State + Contribution + DomainEvent transaction
   |
Persistence

DomainEvent outbox
   |
Bridge dispatcher
   |
Webhook adapter
```

No network request occurs inside the mutation transaction.

---

## 4. Domain event contract

A domain event is an immutable fact about a successful Campfire state change.
It is not a command, a request to an agent, an instruction to a recipient, or a
replacement for the Contribution log.

Every event in this sprint must be traceable to exactly one Contribution. A
mutation may create no bridge event when it does not match the closed vocabulary.
Campfire does not become fully event-sourced.

### Event envelope

The serialized webhook body uses a versioned envelope with this logical shape:

```typescript
interface CampfireDomainEventV1 {
  specVersion: "1.0";
  id: string;
  type: CampfireEventType;
  occurredAt: string;
  workspace: {
    id: string;
  };
  actor: {
    actorId: string;
    actorType: "human" | "agent";
  };
  subject: {
    type: "workspace" | "goal" | "task" | "finding" | "decision" | "artifact";
    id: string;
  };
  summary: string;
  data: Record<string, unknown>;
  provenance: {
    contributionId: string;
    agentSessionId?: string;
    onBehalfOf?: {
      actorId: string;
      actorType: "human";
    };
  };
}
```

`data` is event-specific and allowlisted. It must not contain a complete
WorkspaceContext, participant list, bearer token, bridge secret, transcript,
artifact contents, arbitrary database row, or unrelated workspace state.

`onBehalfOf` is included only when it can be derived from the existing durable
agent/session relationship. The bridge must not infer it from a harness name or
free-form metadata.

### Closed Sprint 019 vocabulary

| Event | Existing source | Required semantic condition |
| --- | --- | --- |
| `finding.recorded` | Finding creation | A Finding was successfully created. |
| `decision.proposed` | Decision creation | A Decision was successfully created in `proposed`. |
| `decision.accepted` | Decision update | Status transitioned from `proposed` to `accepted`. |
| `task.blocked` | Task update | Status transitioned from a non-blocked status to `blocked`. |
| `task.completed` | Task update | Status transitioned from a non-completed status to `completed`. |
| `goal.completed` | Goal update | Status transitioned from a non-completed status to `completed`. |
| `artifact.attached` | Artifact creation | An Artifact reference was successfully attached. |
| `workspace.completed` | Workspace update | Status transitioned from `active` to `completed`. |

No-op updates do not emit transition events. Repeated delivery of one persisted
event keeps the same event id; it does not create a new domain event.

### Explicitly absent vocabulary

The following names are not introduced:

- `blocker.created`: Sprint 019 uses the existing Task `blocked` transition;
  there is no Blocker domain object.
- `decision.recorded`: the existing proposed/accepted distinction remains
  visible and must not be flattened.
- `verification.failed`: Campfire has no verification-state primitive yet.
- `human.input_requested`: Campfire has no durable input-request primitive yet.
- `work.conflict_detected`: current Conflict errors are not durable workspace
  state and do not become domain events in this sprint.
- vendor or action events such as `linear.issue.create`, `slack.message.send`,
  or `email.send`.

---

## 5. Transactional outbox and delivery semantics

For every qualifying mutation, the materialized object change, Contribution,
and DomainEvent are committed atomically in SQLite or D1.

If that transaction rolls back, none of the three may remain. If it commits,
webhook failure must not undo or report failure for the Campfire mutation.

Delivery is **at least once**:

- a persisted event has a stable id;
- each webhook attempt sends that same event id;
- a `2xx` response marks the delivery successful;
- timeouts, network errors, and non-`2xx` responses schedule a bounded retry;
- retries use bounded exponential backoff with deterministic test control;
- an exhausted delivery remains inspectable and is not silently discarded;
- restart or Worker eviction does not erase pending delivery state;
- the dispatcher may claim work concurrently, but only one active claim may
  deliver a given event to the configured webhook at a time;
- the receiving system is expected to deduplicate by event id.

The exact retry intervals and attempt limit are implementation choices recorded
in code and tests. They must be finite and operator-readable.

Local/team-hosted Campfire and the Worker/D1 path must persist identical event
semantics. The existing listener may run the local delivery pump. The Worker may
use request-lifetime background work plus a scheduled retry trigger. Neither
path creates a second SQLite writer or a new always-on machine daemon.

Delivery attempts are operational records, not Contributions. They do not
appear as agent-authored collaboration activity.

---

## 6. Webhook bridge

Sprint 019 supports one operator-configured outbound webhook bridge per
Campfire instance. Configuration is deployment/operator configuration, not a
new MCP tool, agent capability, or workspace mutation.

The configuration must include:

- a stable bridge id;
- an HTTPS destination URL, with an explicit loopback exception for local
  development and acceptance testing;
- a signing secret supplied through the environment or deployment secret
  mechanism and never persisted in plaintext;
- an explicit event-type allowlist;
- an explicit workspace-id allowlist.

No event type or workspace is subscribed by default. An agent cannot create,
change, or reveal the webhook configuration through Campfire.

### Request contract

Each request includes:

```text
Content-Type: application/json
X-Campfire-Event-Id: <event id>
X-Campfire-Event-Type: <event type>
X-Campfire-Timestamp: <unix seconds>
X-Campfire-Signature: v1=<hex hmac-sha256>
```

The signature is computed over:

```text
<timestamp>.<exact raw request body>
```

Redirect following is disabled so a configured destination cannot redirect a
signed payload to another host. Delivery uses a finite timeout. Response bodies
are not stored; logs and inspectable errors retain only bounded, sanitized
diagnostics.

The adapter sends the domain-event envelope unchanged. Formatting a Slack
message, constructing a Linear issue, or translating into another vendor model
belongs to a future adapter.

---

## 7. Human approval boundary

Sprint 019 preserves a first-class distinction between observing an event and
causing a new external action:

```text
Domain event
   |
   +--> configured notification delivery
   |      authorization = operator configured this egress route
   |
   +--> future external mutation
          requires an explicit ExternalAction proposal/policy boundary
```

The webhook is an automatic notification projection after explicit operator
configuration. Sprint 019 does not add per-event human approval.

Future bridges that create or mutate external work must not reuse DomainEvent
as if it were an approved command. They must introduce an explicit action
proposal, policy decision, approval provenance where required, execution
record, and outcome. That later model is not scaffolded in this sprint.

Existing Decision acceptance remains a Campfire collaboration lifecycle. It is
not silently generalized into approval for arbitrary external side effects.

---

## 8. Security and privacy boundaries

Webhook delivery is authorized data egress. The following are required:

1. Only explicitly allowlisted workspaces and event types are eligible.
2. Event construction uses the already-authorized successful mutation; the
   dispatcher never retrieves broader workspace context for convenience.
3. Tokens, signing secrets, private transcripts, artifact contents, and
   unrelated workspace state never enter the event body, delivery record, or
   logs.
4. Artifact events contain references and safe metadata, not file contents.
5. URL credentials are rejected. Hosted destinations use HTTPS. Loopback HTTP
   is permitted only for explicit local development/test configuration.
6. Redirects are rejected, timeouts are finite, and response data is bounded.
7. Signatures cover the exact body and a timestamp so receivers can enforce a
   replay window.
8. Revoking or removing bridge configuration stops new attempts before another
   payload crosses the boundary; pending records remain inspectable.
9. The Viewer remains read-only and token-free.
10. Core mutation authorization is unchanged.

This sprint does not claim that possession of an artifact reference grants
permission to fetch the artifact.

---

## 9. Operator and inspection surface

The sprint must provide a small operator-facing inspection path that can show:

- whether the webhook bridge is configured without revealing its secret;
- configured workspace and event filters;
- pending, delivered, and exhausted counts;
- for a delivery: event id, event type, workspace id, attempt count, timestamps,
  status, and bounded sanitized error information.

This may be a CLI surface or an equivalent existing operator surface chosen
during implementation. It is not exposed as an agent MCP tool in Sprint 019.
The Viewer does not become a bridge administration UI.

---

## 10. In scope

- Versioned, harness-independent DomainEvent types.
- The closed event vocabulary in section 4.
- Atomic state + Contribution + DomainEvent writes.
- SQLite and D1 schema/migration parity.
- Durable webhook delivery state.
- One operator-configured outbound webhook adapter.
- Workspace and event-type filters.
- HMAC signing, finite timeouts, no redirects, bounded diagnostics.
- At-least-once delivery with stable ids and bounded retries.
- Local/listener and Worker/D1 dispatch behavior.
- Read-only operator inspection of configuration and delivery state.
- Deterministic unit, integration, and migration coverage.
- One real end-to-end trace against a receiver outside the Campfire process.
- Required updates to Architecture, Roadmap, operator documentation, and
  release documentation if the sprint is implemented and accepted.

---

## 11. Out of scope

- Slack, Linear, GitHub, Jira, Notion, Teams, Google Workspace, or email adapters.
- Inbound webhooks or bidirectional synchronization.
- Creating or mutating external issues, messages, documents, or email.
- A generic connector SDK, marketplace, plugin system, workflow builder, or
  notification hub.
- Agent-accessible bridge registration or secret management.
- Per-user notification preferences.
- A generic approval queue, policy language, capability engine, or delegated
  execution model.
- `ExternalAction`, action proposal, action approval, or action outcome domain
  objects.
- A Blocker domain object.
- Verification state, conflict state, or human-input-request state.
- Full event sourcing or reconstructing current state from DomainEvents.
- Cross-workspace aggregation or organizational event streams.
- Webhook payload customization or vendor-shaped payloads.
- Guaranteeing exactly-once network delivery.
- Claiming Gate B, Gate C, Gate F, Phase 5 completion, adoption, retention, or
  product-market fit.

---

## 12. Acceptance tests

### Domain and transaction

- Each vocabulary item emits exactly one event for its qualifying transition.
- Non-qualifying mutations still create their existing Contribution but no
  DomainEvent.
- A no-op update does not emit a transition event.
- Rejected authorization, invalid transition, validation failure, and rolled
  back persistence create no event or delivery.
- Event actor, session, subject, workspace, timestamp, and Contribution link
  match the originating mutation.
- Sync SQLite and async D1 services produce equivalent envelopes.

### Filtering and privacy

- A configured workspace/type pair creates a delivery.
- A non-allowlisted workspace or type creates no delivery attempt.
- Payload and logs contain no actor token, webhook secret, transcript content,
  unrelated workspace sentinel, or artifact contents.
- Removing configuration prevents a pending event from being sent until an
  authorized operator explicitly restores the same bridge configuration.

### Delivery

- The receiver validates the HMAC over the timestamp and exact body.
- A `2xx` response marks the delivery delivered.
- A timeout, network error, or non-`2xx` response leaves the Campfire mutation
  successful and schedules a retry.
- Retries reuse the same event id and increment the attempt count.
- Restart preserves pending retry state.
- Bounded retries end in an inspectable exhausted state.
- Redirect responses are not followed.
- Concurrent dispatchers do not concurrently send the same claimed delivery.

### Regression

- Existing MCP, CLI, HTTP, Viewer, onboarding, continuation, and lifecycle
  behavior remains unchanged.
- `npm run typecheck` passes.
- `npm test` passes.
- The existing acceptance suite passes without a configured webhook.

---

## 13. Real trace

The sprint requires one trace using a real Campfire runtime and a receiver
outside that Campfire process.

1. Configure one webhook for one workspace and selected event types.
2. Start with no pending events.
3. Through an authorized human or registered agent session, record a Finding,
   propose and accept a Decision, and move a Task to `blocked`.
4. The receiver obtains `finding.recorded`, `decision.proposed`,
   `decision.accepted`, and `task.blocked` with valid signatures and stable
   provenance links.
5. Force one delivery failure and show that the Campfire mutation remains
   committed, the delivery retries with the same event id, and the later
   attempt succeeds.
6. Show that a non-allowlisted event or workspace is not delivered.
7. Inspect delivery status without revealing the signing secret.
8. Confirm the receiver, logs, Viewer, and trace contain no bearer token,
   signing secret, private transcript, or unrelated workspace data.

The trace records delivery behavior. It does not count as Gate B repeat-use
evidence unless separate human behavior independently satisfies that gate.

---

## 14. GO / CONDITIONAL GO / NO-GO

**GO:** The closed vocabulary is emitted atomically with existing state and
Contribution writes on SQLite and D1. The webhook bridge filters explicit
workspaces and types, signs the exact payload, delivers at least once with
stable ids and bounded retries, survives restart, and exposes inspectable
delivery state. Bridge failure never changes the outcome of a successful
Campfire mutation. The real trace passes. Core contains no vendor concept.
Existing tests pass. No Gate B, Gate C, Gate F, or PMF claim is made.

**CONDITIONAL GO:** Event semantics, transactionality, signing, privacy, and
one runtime path pass, but the second persistence/runtime path or durable retry
trigger remains incomplete. Record the limitation. Do not call the webhook
primitive portable and do not begin Slack or Linear work.

**NO-GO:** A webhook request occurs inside the mutation transaction; webhook
failure fails or rolls back Campfire work; an event can exist without its
Contribution or qualifying state; retries create new event ids; payloads leak
tokens, secrets, transcripts, artifact contents, or unrelated workspace data;
redirects forward signed payloads; Core names or branches on a vendor; agents
can register webhook destinations; event generation differs silently between
SQLite and D1; the implementation adds a generic approval/capability engine;
or the result claims repeat usage or controlled action from delivery alone.

---

## 15. Canon and documentation impact

If Sprint 019 is accepted for implementation:

- `docs/ARCHITECTURE.md` must add the DomainEvent/outbox/Bridge boundary and
  preserve the distinction between Contributions and delivery attempts.
- `docs/ROADMAP.md` must record Sprint 019 as the narrow outward-visibility
  experiment after Sprint 018 and retain the unmeasured Gate B/C status.
- `docs/OPERATOR.md` must document webhook configuration, signing, filters,
  retries, inspection, and secret handling.
- `AGENTS.md` must point to Sprint 019 as the active sprint.
- Product Definition and Vision remain unchanged unless implementation evidence
  changes product semantics rather than merely adding the boundary.

This proposed document does not itself authorize implementation, commit, push,
release tagging, public-repository promotion, webhook delivery to a real third
party, or production deployment.
