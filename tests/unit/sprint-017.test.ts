import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultHarnessConfigPath, detectInstalledHarness } from "../../src/bootstrap/connect.js";
import { startLocalWorkspace } from "../../src/bootstrap/local-workspace.js";
import { loadCredentials } from "../../src/bootstrap/profile.js";
import { runCliEntry } from "../../src/cli/index.js";
import { createRuntimeFromPath } from "../../src/runtime.js";

const GOAL = "Ship the billing migration safely";
const WORKSPACE = "billing deploy";

let dir: string;
let dbPath: string;
let stdout: string[];
let stderr: string[];
const previousDb = process.env.CAMPFIRE_DB;
const previousUrl = process.env.CAMPFIRE_URL;
const previousToken = process.env.CAMPFIRE_TOKEN;
const previousNoninteractive = process.env.CAMPFIRE_NONINTERACTIVE;

function onboardArgs(extra: string[] = []): string[] {
  return [
    "onboard",
    "--db",
    dbPath,
    "--human-name",
    "Sergio",
    "--agent-name",
    "Codex",
    "--harness",
    "codex",
    "--workspace-name",
    WORKSPACE,
    "--goal",
    GOAL,
    ...extra,
  ];
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "campfire-s017-"));
  dbPath = join(dir, "campfire.db");
  stdout = [];
  stderr = [];
  delete process.env.CAMPFIRE_URL;
  delete process.env.CAMPFIRE_TOKEN;
  delete process.env.CAMPFIRE_DB;
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    stdout.push(args.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    stderr.push(args.map(String).join(" "));
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
  if (previousNoninteractive === undefined) delete process.env.CAMPFIRE_NONINTERACTIVE;
  else process.env.CAMPFIRE_NONINTERACTIVE = previousNoninteractive;
});

describe("sprint 017 first-run CLI", () => {
  it("exits 1 with a human-name hint when there is no profile and stdout is not a TTY", async () => {
    const code = await runCliEntry([]);
    expect(code).toBe(1);
    const err = stderr.join("\n");
    const combined = `${stdout.join("\n")}\n${err}`;
    expect(err).toMatch(/human-name/);
    expect(err).toMatch(/harness connects/);
    expect(combined).not.toContain("issue-token");
    expect(combined).not.toContain("export CAMPFIRE_TOKEN");
    expect(combined).not.toMatch(/"jsonrpc"/);
    expect(combined).not.toMatch(/\{"jsonrpc"/);
  });

  it("prints tokens only on json onboard and then status without tokens", async () => {
    expect(await runCliEntry(onboardArgs(["--json"]))).toBe(0);
    const receipt = JSON.parse(stdout.join("\n")) as {
      human: { token: string };
      agent: { token: string };
      next: { up: string; serve: string };
    };
    expect(receipt.human.token).toMatch(/^cft_/);
    expect(receipt.agent.token).toMatch(/^cft_/);
    expect(receipt.next.up).toBe("campfire up");
    expect(receipt.next.serve).toContain("campfire serve");

    stdout.length = 0;
    stderr.length = 0;
    expect(await runCliEntry(["status", "--json"])).toBe(0);
    const status = JSON.parse(stdout.join("\n")) as {
      workspace: string;
      goal: string;
    };
    expect(status.workspace).toBe(WORKSPACE);
    expect(status.goal).toBe(GOAL);
    expect(JSON.stringify(status)).not.toMatch(/cft_/);
    expect(stdout.join("\n")).not.toContain(receipt.human.token);
    expect(stdout.join("\n")).not.toContain(receipt.agent.token);

    stdout.length = 0;
    stderr.length = 0;
    expect(await runCliEntry([])).toBe(0);
    const text = stdout.join("\n");
    expect(text).toContain(WORKSPACE);
    expect(text).not.toMatch(/cft_/);
    expect(text).not.toContain(receipt.human.token);
    expect(text).not.toContain(receipt.agent.token);
  });

  it("prints a token-free human-mode onboard receipt that points at campfire up", async () => {
    expect(await runCliEntry(onboardArgs())).toBe(0);
    const text = stdout.join("\n");
    expect(text).not.toMatch(/cft_/);
    expect(text).toContain("campfire up");
    expect(text).toContain("Credentials are stored locally");
  });
});

describe("startLocalWorkspace", () => {
  it("serves Viewer HTML and answers whoami on the local API", async () => {
    expect(await runCliEntry(onboardArgs(["--json"]))).toBe(0);
    const credentials = loadCredentials();
    expect(credentials).toBeDefined();
    const runtime = createRuntimeFromPath(dbPath);
    const running = await startLocalWorkspace({
      runtime,
      human: { actor: runtime.service.resolveToken(credentials!.humanToken) },
      httpPort: 0,
      viewerPort: 0,
    });
    try {
      const page = await fetch(running.viewerUrl);
      expect(page.status).toBe(200);
      const contentType = page.headers.get("content-type") ?? "";
      expect(contentType).toMatch(/html/);
      const html = await page.text();
      expect(html).toMatch(/<html/i);

      const who = await fetch(`${running.apiUrl}/v1/call`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${credentials!.humanToken}`,
        },
        body: JSON.stringify({ method: "whoami", params: {} }),
      });
      const body = (await who.json()) as { ok: boolean };
      expect(who.status).toBe(200);
      expect(body.ok).toBe(true);
    } finally {
      await running.close();
      runtime.close();
    }
  });
});

describe("harness detection", () => {
  it("resolves the Codex config path under HOME/.codex", () => {
    expect(defaultHarnessConfigPath("codex")).toMatch(/\.codex\/config\.toml$/);
  });

  it("detects Codex when HOME contains .codex", () => {
    const home = mkdtempSync(join(tmpdir(), "campfire-home-"));
    mkdirSync(join(home, ".codex"));
    try {
      expect(detectInstalledHarness({ HOME: home })).toBe("codex");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
