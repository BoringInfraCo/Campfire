/**
 * ACT-001 Step 2 CLI family: propose, human review, reserve, receipt, inspect.
 *
 * Input files are structured JSON and are never executed. Agent tokens cannot
 * approve. Not a harness trace.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXTURE, seedFixture } from "../../src/bootstrap/seed.js";
import { runCli, runCliEntry } from "../../src/cli/index.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import { openSqliteStore } from "../../src/store/sqlite-store.js";
import type { ActionProposalView } from "../../src/service/service.js";
import type { ActionReceipt } from "../../src/domain/action-proposal.js";

const WORKSPACE = FIXTURE.workspaces.billing;
const TARGET = {
  repositoryId: "123",
  repositoryName: "acme/api",
  workflowId: "456",
  runId: "789",
  commitSha: "a".repeat(40),
  expectedAttempt: 1,
};

let dir: string;
let dbPath: string;
let logs: string[];
let errors: string[];
const previousDb = process.env.CAMPFIRE_DB;
const previousUrl = process.env.CAMPFIRE_URL;
const previousToken = process.env.CAMPFIRE_TOKEN;
const previousSession = process.env.CAMPFIRE_SESSION_ID;

function stdout(): string {
  return logs.join("\n");
}

function cli(args: string[]): Promise<void> {
  return runCli(["--db", dbPath, "--output", "json", ...args]);
}

function entry(args: string[]): Promise<number> {
  return runCliEntry(["--db", dbPath, "--output", "json", ...args]);
}

function lastJson<T>(): T {
  return JSON.parse(logs[logs.length - 1] ?? "") as T;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "campfire-act001-cli-"));
  dbPath = join(dir, "campfire.db");
  const store = openSqliteStore(dbPath);
  seedFixture(store);
  store.close();
  logs = [];
  errors = [];
  delete process.env.CAMPFIRE_URL;
  delete process.env.CAMPFIRE_TOKEN;
  delete process.env.CAMPFIRE_SESSION_ID;
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
  if (previousDb === undefined) delete process.env.CAMPFIRE_DB;
  else process.env.CAMPFIRE_DB = previousDb;
  if (previousUrl === undefined) delete process.env.CAMPFIRE_URL;
  else process.env.CAMPFIRE_URL = previousUrl;
  if (previousToken === undefined) delete process.env.CAMPFIRE_TOKEN;
  else process.env.CAMPFIRE_TOKEN = previousToken;
  if (previousSession === undefined) delete process.env.CAMPFIRE_SESSION_ID;
  else process.env.CAMPFIRE_SESSION_ID = previousSession;
});

async function arrangeWork(): Promise<{ taskId: string; findingId: string }> {
  await cli(["create-task", "--workspace", WORKSPACE, "--title", "retry verification"]);
  const taskId = (lastJson<{ id: string }>() ).id;
  await cli(["add-finding", "--workspace", WORKSPACE, "--summary", "failed verification run"]);
  const findingId = (lastJson<{ id: string }>() ).id;
  return { taskId, findingId };
}

function writeProposeInput(taskId: string, findingId: string, requestKey: string, extra: Record<string, unknown> = {}): string {
  const path = join(dir, `${requestKey}.json`);
  writeFileSync(
    path,
    JSON.stringify({
      target: { ...TARGET, ...((extra.target as object | undefined) ?? {}) },
      executor: extra.executor ?? { actorId: FIXTURE.humans.sergio, actorType: "human" },
      reason: extra.reason ?? "retry the failed verification",
      taskId,
      findingIds: [findingId],
      requestKey,
      ...Object.fromEntries(Object.entries(extra).filter(([key]) => key !== "target" && key !== "executor" && key !== "reason")),
    }),
  );
  return path;
}

describe("campfire actions", () => {
  it("proposes, inspects, lists, approves, reserves, and records a receipt", async () => {
    const { taskId, findingId } = await arrangeWork();
    const input = writeProposeInput(taskId, findingId, "propose-1");

    await cli(["actions", "propose", "--workspace", WORKSPACE, "--input", input]);
    const proposed = lastJson<ActionProposalView>();
    expect(proposed.proposal.status).toBe("proposed");
    expect(proposed.proposal.target.repositoryName).toBe("acme/api");
    expect(proposed.proposal.proposedBy).toEqual({ actorId: FIXTURE.humans.sergio, actorType: "human" });

    await cli(["actions", "inspect", proposed.proposal.id, "--workspace", WORKSPACE]);
    expect(lastJson<ActionProposalView>().proposal.id).toBe(proposed.proposal.id);

    await cli(["actions", "list", "--workspace", WORKSPACE]);
    const page = lastJson<{ items: Array<{ id: string }> }>();
    expect(page.items.map((item) => item.id)).toContain(proposed.proposal.id);

    await cli([
      "actions",
      "approve",
      proposed.proposal.id,
      "--workspace",
      WORKSPACE,
      "--revision",
      String(proposed.proposal.revision),
      "--digest",
      proposed.proposal.intentDigest,
      "--request-key",
      "approve-1",
    ]);
    const approved = lastJson<ActionProposalView>();
    expect(approved.proposal.status).toBe("approved");
    expect(approved.proposal.review?.actor.actorId).toBe(FIXTURE.humans.sergio);

    await cli([
      "actions",
      "reserve",
      approved.proposal.id,
      "--workspace",
      WORKSPACE,
      "--revision",
      String(approved.proposal.revision),
      "--digest",
      approved.proposal.intentDigest,
      "--request-key",
      "reserve-1",
    ]);
    const reserved = lastJson<ActionProposalView>();
    expect(reserved.proposal.status).toBe("dispatch_reserved");

    const receiptPath = join(dir, "receipt.json");
    writeFileSync(
      receiptPath,
      JSON.stringify({
        revision: reserved.proposal.revision,
        intentDigest: reserved.proposal.intentDigest,
        outcome: "accepted",
        providerRef: { repositoryId: "123", workflowId: "456", runId: "789" },
        requestKey: "receipt-1",
      }),
    );
    await cli(["actions", "receipt", reserved.proposal.id, "--workspace", WORKSPACE, "--input", receiptPath]);
    const receipt = lastJson<ActionReceipt>();
    expect(receipt.outcome).toBe("accepted");
    expect(receipt.proposalId).toBe(reserved.proposal.id);

    await cli(["actions", "receipts", reserved.proposal.id, "--workspace", WORKSPACE]);
    const receipts = lastJson<{ items: Array<{ id: string }> }>();
    expect(receipts.items.map((item) => item.id)).toContain(receipt.id);
  });

  it("rejects and cancels through the human CLI", async () => {
    const { taskId, findingId } = await arrangeWork();
    const rejectInput = writeProposeInput(taskId, findingId, "propose-reject", {
      target: { runId: "790" },
    });
    await cli(["actions", "propose", "--workspace", WORKSPACE, "--input", rejectInput]);
    const toReject = lastJson<ActionProposalView>().proposal;
    await cli([
      "actions",
      "reject",
      toReject.id,
      "--workspace",
      WORKSPACE,
      "--revision",
      String(toReject.revision),
      "--digest",
      toReject.intentDigest,
      "--request-key",
      "reject-1",
      "--reason",
      "wrong run",
    ]);
    expect(lastJson<ActionProposalView>().proposal.status).toBe("rejected");

    const cancelInput = writeProposeInput(taskId, findingId, "propose-cancel", {
      target: { runId: "791" },
    });
    await cli(["actions", "propose", "--workspace", WORKSPACE, "--input", cancelInput]);
    const toCancel = lastJson<ActionProposalView>().proposal;
    await cli([
      "actions",
      "cancel",
      toCancel.id,
      "--workspace",
      WORKSPACE,
      "--revision",
      String(toCancel.revision),
      "--digest",
      toCancel.intentDigest,
      "--request-key",
      "cancel-1",
      "--reason",
      "no longer needed",
    ]);
    expect(lastJson<ActionProposalView>().proposal.status).toBe("cancelled");
  });

  it("requires --reason on reject and does not execute input files", async () => {
    const { taskId, findingId } = await arrangeWork();
    const input = writeProposeInput(taskId, findingId, "propose-reason");
    await cli(["actions", "propose", "--workspace", WORKSPACE, "--input", input]);
    const proposed = lastJson<ActionProposalView>().proposal;
    expect(await entry([
      "actions",
      "reject",
      proposed.id,
      "--workspace",
      WORKSPACE,
      "--revision",
      String(proposed.revision),
      "--digest",
      proposed.intentDigest,
      "--request-key",
      "reject-missing",
    ])).toBe(1);
    expect(errors.join("\n")).toMatch(/reason/i);
  });

  it("denies approval when the CLI uses an agent token", async () => {
    const { taskId, findingId } = await arrangeWork();
    const input = writeProposeInput(taskId, findingId, "propose-agent");
    await cli(["actions", "propose", "--workspace", WORKSPACE, "--input", input]);
    const proposed = lastJson<ActionProposalView>().proposal;

    const store = openSqliteStore(dbPath);
    const service = createCampfireService({ store });
    const session = service.registerAgentSession(
      { actor: { actorId: FIXTURE.agents.codexSergio, actorType: "agent" } },
      { agentId: FIXTURE.agents.codexSergio, workspaceId: WORKSPACE, harness: "codex" },
    );
    service.close();

    expect(
      await entry([
        "actions",
        "approve",
        proposed.id,
        "--workspace",
        WORKSPACE,
        "--revision",
        String(proposed.revision),
        "--digest",
        proposed.intentDigest,
        "--request-key",
        "agent-approve",
        "--token",
        FIXTURE.tokens.codexSergio,
        "--session",
        session.id,
      ]),
    ).toBe(1);
    expect(errors.join("\n")).toMatch(/Unauthorized|human/i);
  });

  it("renders the inspected effect in human mode without executing the input file", async () => {
    const { taskId, findingId } = await arrangeWork();
    const input = writeProposeInput(taskId, findingId, "propose-human");
    logs = [];
    await runCli(["--db", dbPath, "actions", "propose", "--workspace", WORKSPACE, "--input", input, "--output", "human"]);
    const text = stdout();
    expect(text).toContain("acme/api");
    expect(text).toContain(TARGET.workflowId);
    expect(text).toContain(TARGET.runId);
    expect(text).toContain(TARGET.commitSha);
    expect(text).toContain(FIXTURE.humans.sergio);
    expect(text.trimStart().startsWith("{")).toBe(false);
  });

  it("never prints secrets or raw JSON from actions inspect output", async () => {
    const { taskId, findingId } = await arrangeWork();
    const input = writeProposeInput(taskId, findingId, "propose-redact");
    await cli(["actions", "propose", "--workspace", WORKSPACE, "--input", input]);
    const proposed = lastJson<ActionProposalView>().proposal;
    await cli([
      "actions", "approve", proposed.id, "--workspace", WORKSPACE,
      "--revision", String(proposed.revision),
      "--digest", proposed.intentDigest,
      "--request-key", "approve-redact",
    ]);
    const approved = lastJson<ActionProposalView>();
    await cli([
      "actions", "reserve", approved.proposal.id, "--workspace", WORKSPACE,
      "--revision", String(approved.proposal.revision),
      "--digest", approved.proposal.intentDigest,
      "--request-key", "reserve-redact",
    ]);
    const reserved = lastJson<ActionProposalView>();
    // A caller-supplied secret smuggled into the receipt input must not
    // survive: the service keeps only the bounded safe provider reference.
    const secret = "cli-redact-secret-001";
    const receiptPath = join(dir, "receipt-redact.json");
    writeFileSync(
      receiptPath,
      JSON.stringify({
        revision: reserved.proposal.revision,
        intentDigest: reserved.proposal.intentDigest,
        outcome: "accepted",
        providerRef: { repositoryId: "123", workflowId: "456", runId: "789", attempt: 2, conclusion: "success", token: secret },
        requestKey: "receipt-redact",
      }),
    );
    await cli(["actions", "receipt", reserved.proposal.id, "--workspace", WORKSPACE, "--input", receiptPath]);
    expect(JSON.stringify(lastJson())).not.toContain(secret);

    await cli(["actions", "inspect", reserved.proposal.id, "--workspace", WORKSPACE]);
    const inspected = JSON.stringify(lastJson());
    expect(inspected).not.toContain(secret);
    expect(inspected).toContain(TARGET.runId);

    logs = [];
    await runCli(["--db", dbPath, "actions", "inspect", reserved.proposal.id, "--workspace", WORKSPACE, "--output", "human"]);
    const text = stdout();
    expect(text).not.toContain(secret);
    expect(text).toContain(TARGET.runId);
    expect(text.trimStart().startsWith("{")).toBe(false);

    logs = [];
    await runCli(["--db", dbPath, "actions", "receipts", reserved.proposal.id, "--workspace", WORKSPACE, "--output", "human"]);
    const receiptsText = stdout();
    expect(receiptsText).not.toContain(secret);
    expect(receiptsText).toContain("accepted");
  });
});
