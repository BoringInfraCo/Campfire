# Campfire multi-surface product strategy

**Status:** Proposed companion strategy. `ROADMAP.md` remains the canonical
product roadmap; frozen sprint contracts and release decisions govern actual
implementation and publication.
**Date:** October 31, 2026
**Scope:** One Campfire product model across CLI/MCP, TUI, web, macOS, iPhone,
and iPad.

## Executive decision

Campfire should become available wherever a person or authorized agent needs
the team's work, while keeping one canonical workspace model and one security
boundary.

The product should not become a different application on every platform.
Campfire's surfaces may use platform-native presentation and interaction, but
they must share:

- information architecture and terminology;
- workspace and record identity;
- authorization and denial semantics;
- provenance, currentness, and source meaning;
- local-versus-Cloud state;
- and the distinction between durable work state and private agent sessions.

The immediate sequence remains CLI/MCP and Cloud continuity, trustworthy
multiplayer use, TUI maturity, and a macOS alpha. Mobile follows observed
cross-device demand and stable identity, recovery, notification, and API
boundaries. A local-dictation spike may run as a bounded desktop input-adapter
experiment; it does not change shared semantics or authorize an iPhone or iPad
sprint.

## Strategic context

[Superlogical](https://www.superlogical.com/) describes a "multiplexer for all
work" that begins with durable shared terminal sessions accessible through web
and native macOS/iOS applications. Its thesis is relevant evidence that
developer work increasingly spans people, agents, local machines, remote
hosts, automation, and production systems.

Campfire shares the continuity and multi-surface opportunity, but its product
primitive is different:

| Superlogical direction | Campfire direction |
| --- | --- |
| Durable session around execution | Durable workspace around shared understanding |
| Multiplex terminal/process streams | Preserve structured goals, work, findings, decisions, sources, and provenance |
| Keep a live environment reconnectable | Let work survive the originating application, agent, session, and device |
| Shared interactive session | Authorized multi-principal workspace |
| Terminal is the first foundation | Workspace state is the foundation; terminals are clients and sources |

The useful summary is:

> They multiplex streams of work. Campfire preserves the meaning of the work.

Campfire may integrate with terminal multiplexers or managed execution systems
later. It should not build a proprietary terminal, agent harness, or generalized
runtime merely because an adjacent company does.

[Coworkers](https://github.com/fayazara/coworkers/tree/f2580db4bf7e09e4336a52aafe40f1a4e54b7091)
is a second useful adjacent reference. It demonstrates a Cloudflare-native
user hub, per-bot Durable Objects, WebSockets, push, routines, approval cards,
masked secrets, and separate foreground/background model paths. Campfire should
borrow those interaction and delivery patterns selectively, but not its bot as
the primary data boundary. Campfire's primary unit remains the authorized
multi-human workspace; D1 remains canonical and external harnesses remain
clients. The [Cloud live coordination and Steward plan](Campfire-Cloud-Live-Coordination-and-Steward-Plan.md)
records the adapted architecture and evidence sequence.

[Atuin Threads](https://blog.atuin.sh/threads-agent-sessions/) is a third
adjacent reference. It makes private coding-agent sessions searchable,
encrypted and portable across machines, and can resume, fork, or continue them
in another harness. Campfire should not reproduce that transcript store. It
should integrate at the boundary: an optional local provider supplies private
session continuity, while Campfire supplies authorized current workspace state
and receives the resulting structured contribution. The
[external agent-session continuity plan](Campfire-External-Agent-Session-Continuity-Plan.md)
defines that separation and the post-native-alpha sequence.

## Product boundary

Campfire is the shared workspace where people and their agents work together.
The workspace is canonical. A session, application, device, dashboard, or
generated view is not.

```text
Human A + Agent A                    Human B + Agent B
        |                                    |
        | attributed contribution            | authorized continuation
        v                                    v
                 Campfire workspace
      goal · work · findings · decisions · sources
       participants · provenance · activity · state
```

Campfire multiplayer means multiple authorized principals can understand and
advance the same durable work without sharing private transcripts or manually
reconstructing context. It does not mean that every participant shares one
terminal, cursor, conversation, or agent process.

## Shared product grammar

Every human-facing surface should express the same top-level hierarchy:

```text
Workspaces  →  Needs You  →  People & Agents
                         ↓
        Overview · Work · Decisions · Sources · Activity
```

### Information architecture

| Area | Purpose | Must remain true on every surface |
| --- | --- | --- |
| **Workspaces** | Find and return to bounded units of work | Workspace identity, status, goal, local/Cloud location, and last successful refresh are explicit. |
| **Needs You** | Show authorized recorded work that requires the current human's attention | It is derived from trustworthy state; it does not invent ownership, urgency, approval, or presence. |
| **People & Agents** | Understand who participates and whose authority an agent uses | Humans and agents remain distinct, attribution is preserved, and membership is not inferred from activity. |
| **Overview** | Orient quickly | Counts disclose truncation and never summarize unauthorized records. |
| **Work** | Inspect tasks and current progress | Current state, assignment semantics, blockers, and source records remain explicit. |
| **Decisions** | Understand proposed, accepted, replaced, retired, or review-needed decisions | Campfire never silently selects an operative decision when the record is unresolved. |
| **Sources** | Follow findings, artifacts, citations, and evidence | References are not treated as fetched or verified content without an explicit safe path. |
| **Activity** | Catch up on attributed changes | Ordering and provenance come from the canonical contribution history. |
| **Continuations** | Inspect how recorded work moved into another Campfire agent session | Shared history contains minimal authorized continuation evidence, never an implicit transcript browser; private local candidates stay visibly private. |

The labels and ordering should stay stable enough that a person who learns one
surface can use another. Navigation mechanics may differ by platform.

## Surface roles

| Surface | Primary role | Near-term boundary |
| --- | --- | --- |
| **CLI** | Explicit human and automation commands; setup, recovery, inspection, and controlled contribution | Remains scriptable and truthful; no hidden UI-only capability. |
| **MCP** | Harness-independent agent access to authorized Campfire operations | MCP is an interface, not identity or the product. |
| **TUI** | Keyboard-first ongoing human workspace | Uses the shared hierarchy as panes, tabs, filters, and detail views; does not imitate graphical chrome. |
| **Web Viewer** | Lightweight, broadly reachable authorized projection | Remains a projection over Campfire state, not a second store or independent dashboard model. |
| **macOS** | High-quality persistent native workspace for orientation, attention, inspection, and later bounded contribution | Begin read-only through the actor-bound Viewer proxy; writes require a separate contract. |
| **iPhone** | Triage and continuity away from the primary computer | Initially prioritize Needs You, activity, decisions, sources, and bounded review; not a pocket IDE. |
| **iPad** | Adaptive workspace inspection and review | Use the same mobile application and contracts with a larger multi-column presentation; not a separate product. |

No surface becomes canonical merely because it is visually richer. A record
created through CLI or MCP must mean the same thing when inspected on macOS or
mobile.

## Platform expression

### CLI, MCP, and TUI

CLI and MCP remain the foundational human/agent contracts. The TUI should adopt
the shared information architecture after it is frozen:

| Native concept | TUI expression |
| --- | --- |
| Icon rail | Top-level tabs or stable shortcuts |
| Contextual sidebar | Navigable list pane |
| Workspace canvas | Record list and selected detail pane |
| Popover or menu | Command palette or action menu |
| Click selection | Arrow or `j`/`k` navigation and Enter |
| Visual status | Compact labels and symbols with textual meaning |

The TUI should feel native to a terminal while preserving the same locations,
names, selection model, and safety language.

### macOS

The current native plan is governed by
`Campfire-Native-Continuity-Alpha-Sprint-Plan.md`.

MAC-001 proved a SwiftUI app could read real authorized Campfire data through
the loopback Viewer proxy without holding a bearer token or opening SQLite. That
evidence remains valid.

The October 26 review of [1Git](https://github.com/1bye/1git) creates a new
implementation candidate. 1Git is a working MIT-licensed native macOS app built
with React, Bun, and pinned [GPUIX](https://github.com/remorses/gpuix)/GPUI
sources. It includes valuable native substrate: window chrome, sidebar
materials, focus and keyboard behavior, controls, packaging, and launch tests.
The source review used commit
[`6243465c2161769f162c5ccd528d32c6a37172a0`](https://github.com/1bye/1git/commit/6243465c2161769f162c5ccd528d32c6a37172a0);
that records the reviewed input, not an adopted Campfire dependency revision.

Campfire should test a 1Git-derived shell, not inherit the complete Git product.

**Candidate reuse:**

- GPUIX build and preload pipeline;
- native window and sidebar composition;
- design-token and stylesheet machinery;
- reusable controls, popovers, lists, and tooltips;
- focus, keyboard, and window-state behavior;
- local macOS bundle and launch-test pipeline.

**Replace or remove:**

- repository, branch, commit, diff, worktree, and stash domains;
- hosting-account and repository-publication flows;
- SSH machines and remote helper;
- AI commit generation;
- 1Git analytics configuration;
- 1Git update feeds, product identifiers, artwork, and release infrastructure.

The exact adopted revision must be recorded. Its MIT notice and all applicable
third-party notices must remain. The GPUIX/GPUI patch stack, accessibility,
signing, update, process, network, and credential boundaries require Campfire's
own review. Source availability and a permissive license are not a security or
maintenance verdict.

The desktop app remains a thin Campfire client:

```text
macOS presentation and view state
        |
        v
typed Campfire client adapter
        |
        v
local actor-bound Viewer proxy
        |
        v
installed local or hosted Campfire profile
```

The desktop renderer does not open SQLite, receive a bearer token, call the
hosted Worker directly, duplicate authorization, or invent another work schema.

### Local voice input

Local dictation is a macOS input adapter, not another product surface. It may
turn an explicit recording into an editable local draft. Only a subsequent
human-confirmed typed intent can enter the shared Campfire model.

```text
Campfire-owned recording
        ↓
pinned local transcription helper
        ↓
editable, discardable local draft
        ↓ explicit review and confirmation
existing typed action and service authority
```

The first candidate is Hex. DIC-000 evaluates its pinned SDK/helper, model,
privacy, OS, performance, licensing, accessibility, and packaging boundaries.
It changes no workspace schema, Viewer method, MCP method, production intent,
microphone permission, entitlement, or release build and makes no write.

A later DIC-001 may proceed only after DIC-000 GO and an equivalent typed
composer/action passes real-profile authorization, conflict, retry, denial,
revocation, and receipt checks. Product mode must use Campfire-owned capture and
a bundled signed helper; it cannot require the Hex app or silently use cloud
speech. Audio, raw transcripts, discarded drafts, model files, and helper
credentials remain local and non-canonical.

Dictation is distinct from Apple VoiceOver. Keyboard access, screen-reader
labels and announcements, focus behavior, Reduce Motion, and typed fallback
remain required. The product boundary and sprint are
[Campfire-Local-Voice-Dictation-Plan.md](Campfire-Local-Voice-Dictation-Plan.md)
and
[Campfire-DIC-000-Hex-Local-Dictation-Spike.md](Campfire-DIC-000-Hex-Local-Dictation-Spike.md).

### Private session continuity

After the read-only macOS workspace is useful independently, Campfire may add a
bounded **Continue in…** flow through an optional local provider such as Atuin.
It does not change the 1Git-derived shell. It appears inside the workspace and
selected-record experience:

```text
selected Task, Finding, Decision, or Source
        ↓
authorized current Campfire records
        ↓
Continue in…
        ├── Campfire context only
        ├── resume in the original harness
        ├── fork into a new private session
        └── continue in another installed harness
```

The chooser may show private local session candidates only to the current
person. It must label local/private versus shared Campfire evidence, disable
unsupported destinations with a reason, preview the Campfire record IDs and
completeness being transferred, and require explicit confirmation before an
external launch. A stable operation ID prevents an ambiguous retry from
silently launching twice.

The destination agent registers its own Campfire AgentSession and contributes
through the existing authorized service. The external provider retains the
transcript and its locator. A later continuation receipt is added only if
observed use proves that AgentSession, Contribution, and Activity cannot express
the needed provenance.

TUI and CLI may expose the same semantic action through a command palette or
explicit command. Mobile initially shows only authorized shared continuation
evidence; it does not browse or launch a developer's private desktop sessions.

### iPhone and iPad

If mobile reaches its entry gate, prefer one adaptive SwiftUI application for
iPhone and iPad rather than two products. The existing SwiftUI feasibility work
is useful evidence for Apple-native networking, accessibility, and the Viewer
projection even if GPUIX wins the macOS shell decision.

The initial mobile jobs should be deliberately bounded:

- see Needs You;
- inspect workspace state and recent activity;
- review a decision and the sources cited by it;
- inspect what a human or agent contributed and on whose behalf;
- receive privacy-preserving notifications;
- perform only separately authorized, bounded review or response actions;
- return to desktop or terminal with stable workspace and record identity.

Mobile does not initially host coding agents, clone repositories, expose a
terminal, ingest private transcripts, or reproduce every desktop action.
The [Shepherdr assessment](Campfire-Shepherdr-Assessment.md) reinforces this
existing attention-first scope; it does not create another mobile track.

## Local-first and Cloud continuity

Local and Cloud are deployment modes of the same Campfire model, not separate
products.

```text
                       Campfire contracts
                  identity · authorization · work
                              provenance
                                  |
                  +---------------+---------------+
                  |                               |
            Local profile                   Hosted profile
          local service/SQLite              Workers/D1 today
                  |                               |
                  +---------------+---------------+
                                  |
                       actor-bound interfaces
                                  |
                    CLI · MCP · TUI · app · web
```

The Cloud service must provide durable availability when an originating Mac is
offline. A desktop or mobile client cannot compensate for failed publication,
identity, invitation, authorization, recovery, or tenant isolation.

Realtime delivery is a later transport decision, not a new source of truth.
Begin with versioned refresh and catch-up. Evaluate WebSockets, Durable Objects,
or another push mechanism only when observed latency and multiplayer behavior
justify it. A dropped connection must recover from the durable contribution
position rather than silently losing state.

If that gate is met, the preferred first experiment is one authenticated,
hibernatable `WorkspaceLive` Durable Object per hosted workspace. It receives
only post-commit change envelopes and fans out workspace ID, event ID, and
contribution position. It does not own records, membership, authorization,
attention, or provenance. Each client re-reads through the actor-bound Campfire
contract, and polling/catch-up remains the rollback path.

Cross-device delivery follows its own gate. A D1 transactional outbox records
notification intent beside canonical records and a deterministic attention
key; an idempotent Queue
consumer handles retries and delivery. Push, email, or webhook payloads reveal
the minimum necessary data and reauthorize before opening a record. Delivery
failure cannot roll back or block a Campfire contribution.

Offline clients may preserve the last good projection for reading, but must
label it stale. Offline writes, merge semantics, and background synchronization
require a separate contract; a local cache is never authoritative merely
because a device is disconnected.

## Multiplayer capability model

Campfire multiplayer is complete only when it is secure, attributable, and
recoverable.

### Required foundation

- verified and recoverable human identity for open Cloud access;
- separate human, agent, and agent-session identity;
- workspace membership and role enforcement;
- explicit invitation, acceptance, revocation, and removal;
- server-side authorization before retrieval or mutation;
- attribution to the human principal on whose behalf an agent operates;
- conflict-safe or versioned concurrent writes;
- durable contribution ordering and catch-up;
- restart and reconnect behavior across devices;
- bounded denial that leaks neither objects nor counts;
- export, recovery, and tenant isolation.

### Presence

A stored participant or recent session timestamp is not proof that someone is
currently present. Any future presence surface needs an explicit short-lived
lease or heartbeat, clear freshness semantics, authorization, privacy review,
and a failure mode that degrades to unknown rather than falsely online.

Presence is not required for the first useful multiplayer product. Accurate
membership, attribution, activity, and catch-up come first.

### Notifications and Needs You

Notifications should project an already-authorized, recorded attention item.
They must not create new ownership or approval semantics. Mobile push content
should be minimal by default, avoid private workspace text on lock screens, and
deep-link only after the receiving device reauthorizes the workspace read.

Notifications are transport for an existing attention item, not a new product
object. Preferences, quiet hours, expiry, resolution, deduplication, device
revocation, membership revocation, and delivery audit are server-enforced. A
later approval card similarly projects the existing ActionProposal; it cannot
invent authority in a desktop or mobile client.

## Capability progression

| Stage | Product outcome | Entry evidence | Exit evidence |
| --- | --- | --- | --- |
| **1. Core continuity** | CLI and MCP preserve structured work across harnesses and sessions | Current released Campfire contracts | Local and hosted authorization, provenance, restart, and recovery checks pass. |
| **2. Trustworthy multiplayer** | Two people and their agents use one hosted workspace across machines | Controlled Cloud operations and identity boundary | Repeated two-human use, conflict/denial/revocation checks, and cross-machine persistence are observed. |
| **3. Shared interface grammar** | TUI and Viewer align on Workspaces, Needs You, People & Agents, and record detail | Stable context and attention semantics | People can find attention, decisions, sources, and attribution without builder guidance. |
| **4. macOS alpha** | A native app makes the same authorized work useful | MAC-001B toolkit verdict and released proxy contract | Real-data parity, stale/denied behavior, accessibility, two-Mac inspection, and packaged-app checks pass. |
| **4A. Local dictation evidence** | Speech may prepare an editable local draft without becoming shared state | Stable read-oriented desktop baseline and founder-approved DIC-000 | Pinned helper/model, privacy, OS, performance, cleanup, packaging, and accessibility verdict; DIC-001 still waits for a safe typed action. |
| **5. Private Continue in… integration** | A person may resume, fork, or continue private prior work through an optional provider while Campfire remains independently useful | Stable read-only native workspace, CON-000 compatibility GO, and observed need | One real local cross-harness trace preserves transcript isolation, uses explicit confirmation and replay-safe launch, and produces an authorized Campfire contribution. |
| **6. Bounded native contribution** | Desktop can advance work safely | Read-only alpha use and observed demand | Every write uses existing authorization/provenance, handles conflicts, and has recovery evidence. |
| **7. Cross-device continuity** | Remote clients reconnect reliably and attention can reach a person | Stable identity/recovery and measured refresh needs | Reconnect, catch-up, notification privacy, and device-revocation checks pass. |
| **8. Mobile alpha** | One adaptive iPhone/iPad app supports away-from-desk inspection and bounded response | Repeat multi-surface use and observed mobile demand | Ordinary users complete the chosen mobile jobs; security, accessibility, background, and revocation tests pass. |

Stages describe dependency and evidence, not promised dates. A later surface may
be prototyped for learning, but it cannot claim product readiness before its
entry gates pass.

## Evidence gates

### Gate S1 — semantic parity

For the same authorized actor and workspace, every surface agrees on record IDs,
currentness, attribution, decision state, counts, truncation, and source links.
No UI repairs or reinterprets a domain ambiguity locally.

### Gate S2 — human comprehension

Without builder coaching, a person can:

1. find what needs attention;
2. identify the current decision state and unresolved conflicts;
3. inspect the evidence a decision cites;
4. determine what an agent contributed and for whom;
5. return later and catch up from durable state.

Preference for a visual style is secondary to successful completion and accurate
understanding.

### Gate S3 — repeat cross-surface use

Teams choose to return to Campfire across sessions and use more than one surface
because it improves their work. Internal demonstrations and one operator on two
devices do not satisfy this gate.

### Gate S4 — remote and device safety

Identity recovery, device addition/removal, invitation revocation, tenant
isolation, stale/offline behavior, notification privacy, and lost-response
recovery pass before public cross-device claims.

### Gate S5 — mobile demand

Observed users need Campfire away from their primary computer and can name a
bounded job—such as triage, review, decision inspection, or incident follow-up.
“Every product needs an app” is not sufficient evidence.

### Gate S6 — external continuity value and safety

An optional provider materially improves a continuation over Campfire context
alone, without leaking a transcript, weakening workspace authorization,
duplicating a launch after ambiguity, or making Campfire unusable when the
provider is absent. One internal demonstration establishes engineering
feasibility, not repeat use or team value.

## Measures

Measure whether each surface improves the work, not how many surfaces exist.

- time to find the relevant workspace and record;
- time to identify what needs attention;
- correct interpretation of decision state and currentness;
- successful return after another participant or agent contributes;
- cross-device continuation without a pasted recap;
- denied or revoked access handled without leaked state;
- stale-state recognition and recovery;
- repeated team use across separate days and people;
- support burden and setup failures per surface;
- which mobile jobs are attempted before a native mobile app exists.

Downloads, builds, controlled fixtures, and the number of implemented clients do
not establish retention or multiplayer value.

## Security and privacy invariants

Every surface must preserve the existing Campfire invariants:

- authorization before retrieval;
- workspace as the collaboration boundary;
- human and agent identity remain distinct;
- provenance survives projection and mutation;
- private transcripts are not uploaded by default;
- external session locators, tool output, prompts, diffs, and provider
  credentials remain private/local unless a separately approved policy says
  otherwise;
- clients receive only the credentials they need, and browser/native renderers
  do not receive a bearer when the actor-bound local proxy can keep it
  server-side;
- caches and notifications contain the minimum necessary authorized data;
- local and hosted modes disclose where durable data lives;
- revoked access clears or visibly invalidates retained projections;
- no surface silently overwrites concurrent work;
- analytics never include workspace content, credentials, or private source
  material and remain governed by Campfire's own telemetry contract.

## Explicit non-goals

This strategy does not authorize:

- a Campfire terminal emulator or terminal multiplexer;
- managed agent execution;
- remote shell or SSH-machine management;
- a proprietary coding-agent harness;
- synchronized private transcripts;
- rebuilding an external provider's encrypted session store, search index, or
  harness reconstruction;
- a canonical UI-only store;
- separate domain models for web, desktop, and mobile;
- inferred presence from session timestamps;
- unrestricted offline writes;
- an iPhone or iPad code editor;
- simultaneous implementation of every surface;
- a mobile release before identity, recovery, and observed demand.

## Decision and document boundaries

- `ROADMAP.md` remains the canonical product and evidence roadmap.
- `Campfire-Native-Continuity-Alpha-Sprint-Plan.md` governs the current Cloud and
  native-alpha sequence.
- `Campfire-MAC-001-Native-Feasibility.md` and its result remain the historical
  SwiftUI feasibility record.
- MAC-001B must produce the GPUIX/1Git comparison before MAC-002 freezes a
  desktop toolkit.
- Every new mobile, realtime, notification, or native-write capability requires
  a separately frozen sprint contract and release decision.
- `Campfire-Cloud-Live-Coordination-and-Steward-Plan.md` governs the proposed
  FAC-001 → LIVE-001/NTF-001 → APR-001/STW-001 evidence sequence. It is a plan,
  not authorization to add Durable Objects, Queues, push, or model inference.
- `Campfire-External-Agent-Session-Continuity-Plan.md` governs the proposed
  CON-000 → CON-001 → possible CON-002 sequence after the native workspace is
  stable. It is not authorization to import transcripts or launch agents.
- `Campfire-Local-Voice-Dictation-Plan.md` and the DIC-000 contract govern the
  proposed local speech-to-text evidence path. They do not authorize a
  production microphone path, a canonical write, cloud transcription, or a
  replacement for VoiceOver accessibility.

The strategy succeeds when Campfire feels like one workspace across tools and
devices—not when Campfire has accumulated the largest number of applications.
