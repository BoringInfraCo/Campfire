import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { FIXTURE, seedFixture } from "../../src/bootstrap/seed.js";
import {
  computeSprint011Checks,
  recommend011,
} from "../../src/acceptance/sprint-011/checks.js";
import {
  FIXTURE_TOKEN_SENTINEL,
  PRIVATE_TRANSCRIPT_SENTINEL_011,
} from "../../src/acceptance/sprint-011/prompts.js";
import { createCounterIdSource } from "../../src/domain/ids.js";
import { ParticipantRequired, Unauthorized } from "../../src/domain/errors.js";
import type { ActorRef, Contribution } from "../../src/domain/types.js";
import { createCampfireMcpServer } from "../../src/mcp/tools.js";
import type { ActorContext } from "../../src/service/authorization.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import type { CampfireService } from "../../src/service/service.js";
import { openInMemoryStore } from "../../src/store/sqlite-store.js";
import type { CampfireStore } from "../../src/store/store.js";

const NOW = "2026-09-24T00:00:00.000Z";
const WORKSPACE_ID = FIXTURE.workspaces.billing;
const UNRELATED_SENTINEL = FIXTURE.unrelatedFindingSentinel;

const CODEX_AGENT: ActorRef = { actorId: FIXTURE.agents.codexSergio, actorType: "agent" };
const OPENCODE_AGENT: ActorRef = { actorId: FIXTURE.agents.opencodeAlice, actorType: "agent" };
const SERGIO_HUMAN: ActorRef = { actorId: FIXTURE.humans.sergio, actorType: "human" };

const FINDING_SUMMARY =
  "Webhook delivery queue stalls when retry backoff exceeds the worker timeout, filling the dead-letter queue.";
const FINDING_DETAIL =
  "webhook.log shows repeated 504s followed by 30s backoff; queue-config.json sets maxRetries 5 with 30s backoff against a 20s worker timeout. Full trace captured in ./diagnosis.md.";
const TASK_TITLE = "Diagnose webhook queue stall and record diagnosis";
const ARTIFACT_TITLE = "Webhook queue diagnosis";
const ARTIFACT_PATH = "diagnosis.md";
const DECISION_SUMMARY = "Split the webhook retry queue into fast and slow lanes with bounded backoff";
const DECISION_RATIONALE =
  "Retry policy change needs team agreement before rollout; recording as a proposal only.";
const FACT_PATTERN = /webhook.*queue.*stall|dead-letter/i;

const FORBIDDEN = [PRIVATE_TRANSCRIPT_SENTINEL_011, FIXTURE_TOKEN_SENTINEL, UNRELATED_SENTINEL];

function createClock(startMs = Date.parse(NOW)): () => string {
  let current = startMs;
  return (): string => {
    current += 1000;
    return new Date(current).toISOString();
  };
}

let store: CampfireStore;
let service: CampfireService;
let clock: () => string;

function contributions(): Contribution[] {
  return store.listContributions(WORKSPACE_ID);
}

function newestId(): string {
  return contributions().at(-1)?.id ?? "";
}

function expectNoForbidden(value: string, scope: string): void {
  for (const token of FORBIDDEN) {
    expect(value.includes(token), `${scope} leaks forbidden string ${token}`).toBe(false);
  }
}

beforeEach(() => {
  store = openInMemoryStore();
  clock = createClock();
  service = createCampfireService({ store, idSource: createCounterIdSource(), clock });
  seedFixture(store, { clock });
});

afterEach(() => {
  service.close();
});

function registerCodexSession(): { ctx: ActorContext; sessionId: string } {
  const base: ActorContext = { actor: CODEX_AGENT };
  const session = service.registerAgentSession(base, {
    agentId: CODEX_AGENT.actorId,
    humanId: FIXTURE.humans.sergio,
    workspaceId: WORKSPACE_ID,
    harness: "codex",
  });
  return { ctx: { actor: CODEX_AGENT, agentSessionId: session.id }, sessionId: session.id };
}

function registerOpencodeSession(): { ctx: ActorContext; sessionId: string } {
  const base: ActorContext = { actor: OPENCODE_AGENT };
  const session = service.registerAgentSession(base, {
    agentId: OPENCODE_AGENT.actorId,
    humanId: FIXTURE.humans.alice,
    workspaceId: WORKSPACE_ID,
    harness: "opencode",
  });
  return { ctx: { actor: OPENCODE_AGENT, agentSessionId: session.id }, sessionId: session.id };
}

describe("sprint-011 natural contribution", () => {
  it("records durable state with provenance, isolation, and an ordered delta", () => {
    const { ctx, sessionId } = registerCodexSession();
    const preWorkCursor = newestId();
    expect(preWorkCursor).not.toBe("");

    // Contributor orients before writing; the read itself records nothing.
    const beforeCount = contributions().length;
    service.getWorkspaceContext(ctx, WORKSPACE_ID);
    expect(contributions().length).toBe(beforeCount);

    // 1. Durable finding with conclusion plus evidence (no transcript/token).
    let before = contributions().length;
    const finding = service.addFinding(ctx, {
      workspaceId: WORKSPACE_ID,
      summary: FINDING_SUMMARY,
      detail: FINDING_DETAIL,
      confidence: 0.85,
    });
    let after = contributions();
    expect(after.length).toBe(before + 1);
    const findingCon = after[after.length - 1]!;
    expect(findingCon).toMatchObject({
      workspaceId: WORKSPACE_ID,
      actor: CODEX_AGENT,
      agentSessionId: sessionId,
      action: "create",
      objectType: "finding",
      objectId: finding.id,
    });
    expect(findingCon.createdAt).toBe(finding.createdAt);
    expect(finding.createdBy).toEqual(CODEX_AGENT);
    expect(finding.agentSessionId).toBe(sessionId);

    // 2. Owned work starts open, then moves truthfully.
    before = contributions().length;
    const task = service.createTask(ctx, { workspaceId: WORKSPACE_ID, title: TASK_TITLE });
    after = contributions();
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1]).toMatchObject({
      workspaceId: WORKSPACE_ID,
      actor: CODEX_AGENT,
      agentSessionId: sessionId,
      action: "create",
      objectType: "task",
      objectId: task.id,
    });
    expect(task.status).toBe("open");

    before = contributions().length;
    const started = service.updateTask(ctx, { taskId: task.id, status: "in_progress" });
    after = contributions();
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1]).toMatchObject({
      action: "update",
      objectType: "task",
      objectId: task.id,
      agentSessionId: sessionId,
    });
    expect(started.status).toBe("in_progress");

    // 3. Stable output attached as a reference (completion condition met).
    before = contributions().length;
    const artifact = service.addArtifact(ctx, {
      workspaceId: WORKSPACE_ID,
      type: "document",
      title: ARTIFACT_TITLE,
      uriOrPath: ARTIFACT_PATH,
    });
    after = contributions();
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1]).toMatchObject({
      workspaceId: WORKSPACE_ID,
      actor: CODEX_AGENT,
      agentSessionId: sessionId,
      action: "create",
      objectType: "artifact",
      objectId: artifact.id,
    });
    expect(artifact.uriOrPath).toBe(ARTIFACT_PATH);

    // 4. Truthful terminal state only now that the diagnosis artifact exists.
    before = contributions().length;
    const completed = service.updateTask(ctx, { taskId: task.id, status: "completed" });
    after = contributions();
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1]).toMatchObject({
      action: "update",
      objectType: "task",
      objectId: task.id,
      payload: { status: "completed" },
    });
    expect(completed.status).toBe("completed");

    // 5. Proposed direction stays proposed; never auto-accepted.
    before = contributions().length;
    const decision = service.addDecision(ctx, {
      workspaceId: WORKSPACE_ID,
      summary: DECISION_SUMMARY,
      rationale: DECISION_RATIONALE,
    });
    after = contributions();
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1]).toMatchObject({
      workspaceId: WORKSPACE_ID,
      actor: CODEX_AGENT,
      agentSessionId: sessionId,
      action: "create",
      objectType: "decision",
      objectId: decision.id,
    });
    expect(decision.status).toBe("proposed");
    expect(store.getDecision(decision.id)?.status).toBe("proposed");

    // Sync semantics: every write is already reflected in the store on return.
    const view = service.getWorkspace(ctx, WORKSPACE_ID);
    expect(view.findings.map((entry) => entry.id)).toContain(finding.id);
    expect(view.tasks.map((entry) => entry.id)).toContain(task.id);
    expect(view.artifacts.map((entry) => entry.id)).toContain(artifact.id);
    expect(view.decisions.map((entry) => entry.id)).toContain(decision.id);

    // Orientation projection carries the new objects.
    const context = service.getWorkspaceContext(ctx, WORKSPACE_ID);
    expect(context.findings.map((entry) => entry.id)).toContain(finding.id);
    expect(context.artifacts.map((entry) => entry.id)).toContain(artifact.id);
    expect(context.proposedDecisions.map((entry) => entry.id)).toContain(decision.id);

    // Pre-work cursor returns exactly the new contributions in order.
    const delta = service.getWorkspaceContext(ctx, WORKSPACE_ID, { since: preWorkCursor });
    expect(delta.since).toBeDefined();
    expect(delta.since!.items.map((entry) => [entry.action, entry.objectType, entry.objectId])).toEqual([
      ["create", "finding", finding.id],
      ["create", "task", task.id],
      ["update", "task", task.id],
      ["create", "artifact", artifact.id],
      ["update", "task", task.id],
      ["create", "decision", decision.id],
    ]);
    expect(delta.since!.items.every((entry) => entry.agentSessionId === sessionId)).toBe(true);

    // Isolation: no private transcript, fixture token, or unrelated state.
    const objectsBlob = JSON.stringify({ finding, task: completed, artifact, decision });
    expectNoForbidden(objectsBlob, "objects");
    expectNoForbidden(JSON.stringify(delta.since!.items), "contributions");
    expectNoForbidden(JSON.stringify(context), "workspace context");

    // Evaluator scores the deterministic outcome as GO.
    const snapshot = {
      workspaceId: WORKSPACE_ID,
      findings: view.findings,
      tasks: view.tasks,
      artifacts: view.artifacts,
      decisions: view.decisions,
      activity: contributions(),
    };
    const checks = computeSprint011Checks(snapshot, {
      factPattern: FACT_PATTERN,
      completionRequiresDiagnosis: true,
      hasDiagnosisArtifact: true,
      taskStatus: "completed",
      decisionStatus: "proposed",
      workspaceId: WORKSPACE_ID,
      forbidden: FORBIDDEN,
    });
    expect(checks.filter((entry) => !entry.passed)).toEqual([]);
    expect(recommend011(checks)).toBe("GO");
  });

  it("rejects writes without a session, from viewers, and from non-participants", () => {
    const { ctx } = registerCodexSession();

    // Agent without a registered session cannot write (sync service enforces it).
    expect(() =>
      service.addFinding({ actor: CODEX_AGENT }, { workspaceId: WORKSPACE_ID, summary: "No session write" }),
    ).toThrow(Unauthorized);

    // Viewer may read but cannot write; authorization happens before mutation.
    const sergioCtx: ActorContext = { actor: SERGIO_HUMAN };
    const { human: viewer } = service.createHuman(sergioCtx, {
      teamId: FIXTURE.teamId,
      displayName: "Viewer V",
    });
    const viewerRef: ActorRef = { actorId: viewer.id, actorType: "human" };
    service.inviteToWorkspace(sergioCtx, { workspaceId: WORKSPACE_ID, actor: viewerRef, role: "viewer" });
    service.joinWorkspace({ actor: viewerRef }, { workspaceId: WORKSPACE_ID });
    const viewerCtx: ActorContext = { actor: viewerRef };
    expect(service.getWorkspace(viewerCtx, WORKSPACE_ID).workspace.id).toBe(WORKSPACE_ID);
    expect(() =>
      service.addFinding(viewerCtx, { workspaceId: WORKSPACE_ID, summary: "Viewer write" }),
    ).toThrow(Unauthorized);
    expect(() =>
      service.createTask(viewerCtx, { workspaceId: WORKSPACE_ID, title: "Viewer task" }),
    ).toThrow(Unauthorized);

    // Non-participant cannot write and learns nothing through the write path.
    const { human: outsider } = service.createHuman(sergioCtx, {
      teamId: FIXTURE.teamId,
      displayName: "Outsider O",
    });
    const outsiderCtx: ActorContext = { actor: { actorId: outsider.id, actorType: "human" } };
    expect(() =>
      service.addFinding(outsiderCtx, { workspaceId: WORKSPACE_ID, summary: "Outsider write" }),
    ).toThrow(ParticipantRequired);

    // The contributor session itself remains valid after the rejected writes.
    expect(service.getWorkspaceContext(ctx, WORKSPACE_ID).workspace.id).toBe(WORKSPACE_ID);
  });

  it("lets a cold downstream agent continue from workspace state alone", () => {
    const { ctx } = registerCodexSession();
    const finding = service.addFinding(ctx, {
      workspaceId: WORKSPACE_ID,
      summary: FINDING_SUMMARY,
      detail: FINDING_DETAIL,
    });
    const task = service.createTask(ctx, { workspaceId: WORKSPACE_ID, title: TASK_TITLE });
    service.updateTask(ctx, { taskId: task.id, status: "in_progress" });
    const artifact = service.addArtifact(ctx, {
      workspaceId: WORKSPACE_ID,
      type: "document",
      title: ARTIFACT_TITLE,
      uriOrPath: ARTIFACT_PATH,
    });
    service.updateTask(ctx, { taskId: task.id, status: "completed" });
    const decision = service.addDecision(ctx, {
      workspaceId: WORKSPACE_ID,
      summary: DECISION_SUMMARY,
      rationale: DECISION_RATIONALE,
    });

    // Second agent with its own session reads only the workspace id.
    const { ctx: downstreamCtx } = registerOpencodeSession();
    const context = service.getWorkspaceContext(downstreamCtx, WORKSPACE_ID);

    // It can name the discovered fact, the task outcome, the artifact, and the proposal.
    expect(context.findings.map((entry) => entry.summary)).toContain(FINDING_SUMMARY);
    expect(context.findings.find((entry) => entry.id === finding.id)?.detail).toContain("webhook.log");
    expect(context.artifacts.map((entry) => entry.title)).toContain(ARTIFACT_TITLE);
    expect(context.artifacts.find((entry) => entry.id === artifact.id)?.uriOrPath).toBe(ARTIFACT_PATH);
    expect(context.proposedDecisions.map((entry) => entry.summary)).toContain(DECISION_SUMMARY);

    // It distinguishes recorded fact from proposal: the decision is proposed, not accepted.
    const downstreamDecision = context.proposedDecisions.find((entry) => entry.id === decision.id);
    expect(downstreamDecision?.status).toBe("proposed");
    expect(downstreamDecision?.status).not.toBe("accepted");
    expect(context.acceptedDecisions.map((entry) => entry.id)).not.toContain(decision.id);

    // Task outcome is recoverable as completed without the private transcript.
    expect(store.getTask(task.id)?.status).toBe("completed");
    expectNoForbidden(JSON.stringify(context), "downstream context");
  });

  it("exposes contribution boundaries in MCP tool descriptions", async () => {
    const server = createCampfireMcpServer({
      service,
      identity: { ctx: { actor: CODEX_AGENT }, harness: "codex" },
    });
    const client = new Client({ name: "sprint-011-test", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    try {
      const listed = await client.listTools();
      const byName = new Map(listed.tools.map((tool) => [tool.name, (tool.description ?? "").toLowerCase()]));

      const finding = byName.get("add_finding") ?? "";
      expect(finding).toContain("durable");
      expect(finding).toContain("transcript");

      const propose = byName.get("add_decision") ?? "";
      expect(propose).toContain("acceptance");
      expect(propose).toContain("does not approve");

      const accept = byName.get("accept_decision") ?? "";
      expect(accept).toContain("explicit approval");
      expect(accept).toContain("never");
      expect(accept).toContain("automatic");

      const updateTask = byName.get("update_task") ?? "";
      expect(updateTask).toContain("truthful");
      expect(updateTask).toContain("current");
      expect(updateTask).toContain("completed only when");

      const artifact = byName.get("add_artifact") ?? "";
      expect(artifact).toContain("reference");
      expect(artifact.includes("secret") || artifact.includes("private")).toBe(true);

      const goal = byName.get("update_goal") ?? "";
      expect(goal).toContain("only when");
      expect(goal).toContain("changed");
      expect(goal).toContain("narrate progress");
    } finally {
      await client.close();
      await server.close();
    }
  });
});
