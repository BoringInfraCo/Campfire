import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveDatabasePath } from "../../src/config.js";
import {
  formatStatus,
  loadCredentials,
  loadProfile,
  persistOnboardProfile,
  readOperatorAgentToken,
  readOperatorHumanToken,
  resolveProfilePaths,
} from "../../src/bootstrap/profile.js";

const originalCwd = process.cwd();
const previousDb = process.env.CAMPFIRE_DB;

const SAMPLE = {
  databasePath: "/tmp/campfire-profile-sample.db",
  workspaceId: "ws_billing",
  workspaceName: "billing deploy",
  goalTitle: "Ship the billing migration safely",
  humanId: "hum_sergio",
  humanName: "Sergio",
  agentId: "agt_codex",
  agentName: "Codex",
  harness: "codex",
  humanToken: "cft_human_secret_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  agentToken: "cft_agent_secret_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
};

beforeEach(() => {
  delete process.env.CAMPFIRE_DB;
});

afterEach(() => {
  process.chdir(originalCwd);
  if (previousDb === undefined) delete process.env.CAMPFIRE_DB;
  else process.env.CAMPFIRE_DB = previousDb;
});

describe("operator profile", () => {
  it("persists config.json without secrets and credentials.json mode 0600", () => {
    const paths = persistOnboardProfile(SAMPLE);

    const configText = readFileSync(paths.configPath, "utf8");
    const credentialsText = readFileSync(paths.credentialsPath, "utf8");
    expect(configText).not.toContain(SAMPLE.humanToken);
    expect(configText).not.toContain(SAMPLE.agentToken);
    expect(configText).not.toMatch(/cft_/);
    expect(credentialsText).toContain(SAMPLE.humanToken);
    expect(credentialsText).toContain(SAMPLE.agentToken);
    expect(statSync(paths.credentialsPath).mode & 0o777).toBe(0o600);
  });

  it("round-trips loadProfile and loadCredentials", () => {
    persistOnboardProfile(SAMPLE);

    expect(loadProfile()).toEqual({
      version: 1,
      databasePath: SAMPLE.databasePath,
      url: "http://127.0.0.1:9414",
      workspaceId: SAMPLE.workspaceId,
      workspaceName: SAMPLE.workspaceName,
      goalTitle: SAMPLE.goalTitle,
      humanId: SAMPLE.humanId,
      humanName: SAMPLE.humanName,
      agentId: SAMPLE.agentId,
      agentName: SAMPLE.agentName,
      harness: SAMPLE.harness,
    });
    expect(loadCredentials()).toEqual({
      humanToken: SAMPLE.humanToken,
      agentToken: SAMPLE.agentToken,
    });
  });

  it("keeps tokens out of formatStatus and config.json", () => {
    const paths = persistOnboardProfile(SAMPLE);
    const profile = loadProfile();
    expect(profile).toBeDefined();
    const status = formatStatus(profile!);
    expect(status).toContain(SAMPLE.workspaceName);
    expect(status).toContain(SAMPLE.goalTitle);
    expect(status).toContain("campfire up");
    expect(status).not.toContain(SAMPLE.humanToken);
    expect(status).not.toContain(SAMPLE.agentToken);
    expect(status).not.toMatch(/cft_/);
    expect(readFileSync(paths.configPath, "utf8")).not.toMatch(/cft_/);
  });

  it("returns stored operator tokens", () => {
    persistOnboardProfile(SAMPLE);
    expect(readOperatorHumanToken()).toBe(SAMPLE.humanToken);
    expect(readOperatorAgentToken()).toBe(SAMPLE.agentToken);
  });
});

describe("resolveDatabasePath", () => {
  it("prefers CAMPFIRE_DB over the operator profile", () => {
    persistOnboardProfile(SAMPLE);
    const override = join(mkdtempSync(join(tmpdir(), "campfire-db-override-")), "override.db");
    process.env.CAMPFIRE_DB = override;
    expect(resolveDatabasePath()).toBe(override);
  });

  it("uses profile.databasePath when CAMPFIRE_DB is unset", () => {
    persistOnboardProfile(SAMPLE);
    expect(resolveDatabasePath()).toBe(SAMPLE.databasePath);
  });

  it("uses an existing $CWD/.campfire/campfire.db when there is no profile", () => {
    const cwd = mkdtempSync(join(tmpdir(), "campfire-legacy-cwd-"));
    const legacy = join(cwd, ".campfire", "campfire.db");
    mkdirSync(join(cwd, ".campfire"), { recursive: true });
    writeFileSync(legacy, "");
    try {
      process.chdir(cwd);
      // macOS canonicalizes /var to /private/var when reporting process.cwd().
      expect(resolveDatabasePath()).toBe(join(process.cwd(), ".campfire", "campfire.db"));
    } finally {
      process.chdir(originalCwd);
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("falls back to defaultDatabasePath under CAMPFIRE_DATA_DIR", () => {
    const cwd = mkdtempSync(join(tmpdir(), "campfire-default-cwd-"));
    try {
      process.chdir(cwd);
      expect(resolveDatabasePath()).toBe(resolveProfilePaths().defaultDatabasePath);
      expect(resolveDatabasePath()).toBe(join(process.env.CAMPFIRE_DATA_DIR!, "campfire.db"));
    } finally {
      process.chdir(originalCwd);
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
