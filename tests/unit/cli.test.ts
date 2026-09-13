import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXTURE, seedFixture } from "../../src/bootstrap/seed.js";
import { runCli } from "../../src/cli/index.js";
import { ValidationError } from "../../src/domain/errors.js";
import { openSqliteStore } from "../../src/store/sqlite-store.js";

const BILLING_GOAL_TITLE =
  "Determine why billing-service deploys fail and prepare the correct remediation.";

let dir: string;
let dbPath: string;
let logs: string[];
const previousDb = process.env.CAMPFIRE_DB;
const previousUrl = process.env.CAMPFIRE_URL;
const previousToken = process.env.CAMPFIRE_TOKEN;

function stdout(): string {
  return logs.join("\n");
}

function cli(args: string[]): Promise<void> {
  return runCli(["--db", dbPath, ...args]);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "campfire-cli-"));
  dbPath = join(dir, "campfire.db");
  const store = openSqliteStore(dbPath);
  seedFixture(store);
  store.close();
  logs = [];
  delete process.env.CAMPFIRE_URL;
  delete process.env.CAMPFIRE_TOKEN;
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
  if (previousDb === undefined) {
    delete process.env.CAMPFIRE_DB;
  } else {
    process.env.CAMPFIRE_DB = previousDb;
  }
  if (previousUrl === undefined) {
    delete process.env.CAMPFIRE_URL;
  } else {
    process.env.CAMPFIRE_URL = previousUrl;
  }
  if (previousToken === undefined) {
    delete process.env.CAMPFIRE_TOKEN;
  } else {
    process.env.CAMPFIRE_TOKEN = previousToken;
  }
});

describe("runCli", () => {
  it("prints orientation text for show, not a JSON dump", async () => {
    await cli(["show", FIXTURE.workspaces.billing]);

    const output = stdout();
    expect(output).toContain("Workspace");
    expect(output).toContain("Goal");
    expect(output).toContain(FIXTURE.workspaces.billing);
    expect(output).toContain(BILLING_GOAL_TITLE);
    expect(output.trimStart().startsWith("{")).toBe(false);
  });

  it("lists workspaces", async () => {
    await cli(["list"]);

    const listed = JSON.parse(stdout()) as Array<{ id: string }>;
    expect(listed.map((workspace) => workspace.id)).toContain(FIXTURE.workspaces.billing);
  });

  it("prints a workspace id from create-workspace", async () => {
    await cli(["create-workspace", "--team", FIXTURE.teamId, "--name", "cli-living"]);

    const created = JSON.parse(stdout()) as { id: string; name: string };
    expect(created.id).toMatch(/^ws_/);
    expect(created.name).toBe("cli-living");
  });

  it("prints at most --limit activity lines", async () => {
    await cli(["activity", FIXTURE.workspaces.billing, "--limit", "2"]);

    const lines = stdout()
      .split("\n")
      .filter((line) => line.trim().length > 0);
    expect(lines.length).toBeLessThanOrEqual(2);
  });

  it("rejects an unknown command", async () => {
    await expect(cli(["definitely-not-a-command"])).rejects.toThrow(ValidationError);
  });

  it("prints usage including serve, invite, identity, and contribution commands", async () => {
    await cli(["help"]);
    const output = stdout();
    expect(output).toContain("campfire serve");
    expect(output).toContain("create-human");
    expect(output).toContain("create-agent");
    expect(output).toContain("issue-token");
    expect(output).toContain("campfire invite");
    expect(output).toContain("create-task");
    expect(output).toContain("add-finding");
    expect(output).toContain("add-decision");
    expect(output).toContain("add-artifact");
  });

  it("shows a workspace with the fixture sergio token", async () => {
    await cli(["show", FIXTURE.workspaces.billing, "--token", FIXTURE.tokens.sergio]);

    const output = stdout();
    expect(output).toContain("Workspace");
    expect(output).toContain(FIXTURE.workspaces.billing);
    expect(output).toContain(BILLING_GOAL_TITLE);
  });

  it("issues a token JSON payload that includes the raw token once", async () => {
    await cli(["issue-token", "--actor", FIXTURE.humans.sergio, "--type", "human"]);

    const issued = JSON.parse(stdout()) as { token: string; actor: { actorId: string } };
    expect(issued.token.startsWith("cft_")).toBe(true);
    expect(issued.actor.actorId).toBe(FIXTURE.humans.sergio);
  });

  it("adds a finding on the billing workspace as the default human", async () => {
    await cli([
      "add-finding",
      "--workspace",
      FIXTURE.workspaces.billing,
      "--summary",
      "CLI finding from sergio",
    ]);

    const finding = JSON.parse(stdout()) as { summary: string; createdBy: { actorId: string } };
    expect(finding.summary).toBe("CLI finding from sergio");
    expect(finding.createdBy.actorId).toBe(FIXTURE.humans.sergio);
  });

  it("creates a task whose id starts with task_", async () => {
    await cli(["create-task", "--workspace", FIXTURE.workspaces.billing, "--title", "CLI task"]);

    const task = JSON.parse(stdout()) as { id: string; title: string };
    expect(task.id.startsWith("task_")).toBe(true);
    expect(task.title).toBe("CLI task");
  });
});
