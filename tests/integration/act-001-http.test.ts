/**
 * ACT-001 HTTP surface smoke: human-only review on /v1/call, unknown ingress 404.
 * Isolated fixture. Not live GitHub.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ACT001, seedAct001Database } from "../../fixtures/act-001/seed.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import { startCampfireHttpServer, type RunningHttpServer } from "../../src/http/server.js";
import { loadConfig } from "../../src/config.js";
import { openSqliteStore } from "../../src/store/sqlite-store.js";
import type { ActionProposalView } from "../../src/service/service.js";

const SIGNED = JSON.parse(
  readFileSync(new URL("../../fixtures/act-001/step-0/proposal/signed-payloads.json", import.meta.url), "utf8"),
) as { testOnlySecret: string; cases: Array<{ id: string; body: string; signature: string }> };

const NOW = "2026-10-21T12:10:00.000Z";

let dir: string | undefined;
let running: RunningHttpServer | undefined;

afterEach(async () => {
  if (running !== undefined) {
    await running.close();
    running = undefined;
  }
  vi.restoreAllMocks();
  if (dir !== undefined) {
    rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  }
});

async function call(
  token: string,
  method: string,
  params: Record<string, unknown>,
): Promise<{ status: number; body: { ok: boolean; error?: string; result?: unknown } }> {
  if (running === undefined) throw new Error("HTTP server is not running");
  const response = await fetch(`${running.url}/v1/call`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ method, params }),
  });
  return { status: response.status, body: (await response.json()) as { ok: boolean; error?: string; result?: unknown } };
}

describe("ACT-001 HTTP /v1/call and ingress", () => {
  it("allows a human owner to review_action and denies the same call with an agent token; unknown source is 404", async () => {
    dir = mkdtempSync(join(tmpdir(), "act001-http-"));
    const databasePath = join(dir, "campfire.db");
    const seeded = seedAct001Database(databasePath);
    const store = openSqliteStore(databasePath);
    const service = createCampfireService({ store, clock: () => NOW });
    vi.spyOn(console, "error").mockImplementation(() => {});
    running = await startCampfireHttpServer({
      runtime: {
        config: { ...loadConfig(), databasePath },
        store,
        service,
        close: () => service.close(),
      },
      host: "127.0.0.1",
      port: 0,
      sourceEnv: {
        CAMPFIRE_GITHUB_SOURCE_ID: ACT001.sourceId,
        CAMPFIRE_GITHUB_SOURCE_WORKSPACE_ID: seeded.workspaceId,
        CAMPFIRE_GITHUB_SOURCE_REPOSITORY_ID: ACT001.target.repositoryId,
        CAMPFIRE_GITHUB_SOURCE_REPOSITORY_NAME: ACT001.target.repositoryName,
        CAMPFIRE_GITHUB_SOURCE_WORKFLOW_ID: ACT001.target.workflowId,
        CAMPFIRE_GITHUB_SOURCE_KIND: "ci.retry_verification",
        CAMPFIRE_GITHUB_SOURCE_SECRET: SIGNED.testOnlySecret,
        CAMPFIRE_GITHUB_SOURCE_AGENT_ID: ACT001.agents.integration,
        CAMPFIRE_GITHUB_SOURCE_SESSION_ID: seeded.sessions.integration,
      },
      clock: () => NOW,
    });

    const proposed = service.propose_action(
      { actor: { actorId: ACT001.agents.proposing, actorType: "agent" }, agentSessionId: ACT001.sessions.proposing },
      {
        workspaceId: ACT001.workspace,
        target: { ...ACT001.target },
        executor: { actorId: ACT001.agents.executing, actorType: "agent" },
        reason: "Retry the failed verification run after inspecting the failed job logs",
        taskId: ACT001.task,
        findingIds: [ACT001.findings.logs],
        requestKey: "http-propose",
      },
    );

    const agentReview = await call(seeded.tokens.proposing, "review_action", {
      workspaceId: ACT001.workspace,
      proposalId: proposed.proposal.id,
      revision: proposed.proposal.revision,
      intentDigest: proposed.proposal.intentDigest,
      decision: "approve",
      requestKey: "http-agent-review",
      agentSessionId: ACT001.sessions.proposing,
    });
    expect(agentReview.status).toBe(403);
    expect(agentReview.body.ok).toBe(false);
    expect(agentReview.body.error).toBe("Unauthorized");

    const humanReview = await call(seeded.tokens.owner, "review_action", {
      workspaceId: ACT001.workspace,
      proposalId: proposed.proposal.id,
      revision: proposed.proposal.revision,
      intentDigest: proposed.proposal.intentDigest,
      decision: "approve",
      requestKey: "http-human-review",
    });
    expect(humanReview.status).toBe(200);
    expect(humanReview.body.ok).toBe(true);
    expect((humanReview.body.result as ActionProposalView).proposal.status).toBe("approved");

    const matching = SIGNED.cases.find((entry) => entry.id === "completed-matching")!;
    const unknown = await fetch(`${running.url}/v1/integrations/github/src_missing`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "workflow_run",
        "x-github-delivery": "http-unknown",
        "x-hub-signature-256": matching.signature,
      },
      body: matching.body,
    });
    expect(unknown.status).toBe(404);
    const unknownBody = await unknown.json();
    expect(JSON.stringify(unknownBody)).not.toContain(ACT001.workspace);
    expect(JSON.stringify(unknownBody)).not.toContain(ACT001.humans.owner);
  });
});
