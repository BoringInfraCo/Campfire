import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCli, runCliEntry } from "../../src/cli/index.js";
import { buildTelemetryStatus, formatTelemetryStatus } from "../../src/cli/projections.js";
import { DEFAULT_TELEMETRY_ENDPOINT } from "../../src/telemetry/report.js";
import { TELEMETRY_STATE_VERSION } from "../../src/telemetry/state.js";
import { isTelemetryInstallationId } from "../../src/telemetry/contract.js";

/**
 * TEL-001 CLI UX (sprint section 12, section 17).
 *
 * `campfire telemetry status|enable|disable` is the operator's only window into
 * this feature, so three properties are defended here:
 *
 *   1. `status` is a pure read. It must not create an installation id, because
 *      inspecting telemetry must not be an observable act about this
 *      installation.
 *   2. The reported preference shows where it came from, so an ambient
 *      `CAMPFIRE_TELEMETRY` cannot hide behind a stored value.
 *   3. The command is purely local: no SQLite runtime, no token, no network, so
 *      it works on a fresh install and cannot fail on an unreachable endpoint.
 */

const ENV_KEYS = ["CAMPFIRE_TELEMETRY", "CAMPFIRE_TELEMETRY_URL", "CAMPFIRE_URL", "CAMPFIRE_TOKEN", "CAMPFIRE_DB", "CAMPFIRE_OUTPUT"] as const;

/** A closed port on loopback: any real connection attempt fails immediately. */
const CLOSED_ENDPOINT = "http://127.0.0.1:9/v1/telemetry";

interface TelemetryStatusJson {
  version: number;
  kind: string;
  enabled: boolean;
  source: "env" | "preference" | "default";
  installation?: { id: string; activatedOn?: string; lastActiveOn?: string };
  endpoint: { url?: string; source?: string; valid: boolean };
  next: Array<{ command: string; when: string }>;
}

let dir: string;
let configDir: string;
let logs: string[];
let errors: string[];
const saved: Record<string, string | undefined> = {};

function stdout(): string {
  return logs.join("\n");
}

function stderr(): string {
  return errors.join("\n");
}

function statePath(): string {
  return join(configDir, "telemetry.json");
}

function readState(): Record<string, unknown> {
  return JSON.parse(readFileSync(statePath(), "utf8")) as Record<string, unknown>;
}

function cli(args: string[]): Promise<void> {
  return runCli(args);
}

function entry(args: string[]): Promise<number> {
  return runCliEntry(args);
}

function statusJson(): TelemetryStatusJson {
  return JSON.parse(stdout()) as TelemetryStatusJson;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "campfire-tel-001-cli-"));
  configDir = join(dir, "config");
  process.env.CAMPFIRE_CONFIG_DIR = configDir;
  process.env.CAMPFIRE_DATA_DIR = join(dir, "data");
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  logs = [];
  errors = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
  for (const key of ENV_KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("campfire telemetry status", () => {
  it("reports the default-enabled preference and creates no state file", async () => {
    await cli(["telemetry", "status", "--output", "json"]);

    const status = statusJson();
    expect(status.kind).toBe("telemetry_status");
    expect(status.enabled).toBe(true);
    expect(status.source).toBe("default");
    expect(status.endpoint).toEqual({ url: DEFAULT_TELEMETRY_ENDPOINT, source: "default", valid: true });
    expect(status.next).toEqual([
      { command: "campfire telemetry disable", when: "Stop anonymous product telemetry" },
    ]);

    // Reading telemetry must not mint an installation id.
    expect(status.installation).toBeUndefined();
    expect(existsSync(statePath())).toBe(false);
    expect(existsSync(configDir)).toBe(false);
  });

  it("is repeatable and still creates nothing on a second read", async () => {
    await cli(["telemetry", "status", "--output", "json"]);
    logs = [];
    await cli(["telemetry", "status", "--output", "json"]);
    expect(statusJson().source).toBe("default");
    expect(existsSync(statePath())).toBe(false);
  });

  it("renders the same facts in human output without echoing a configured url", async () => {
    process.env.CAMPFIRE_TELEMETRY_URL = "https://telemetry.example.invalid/v1/telemetry?token=secret";
    await cli(["telemetry", "status", "--output", "human"]);
    const text = stdout();
    expect(text).toContain("Telemetry");
    expect(text).toContain("enabled");
    expect(text).toContain("(default)");
    expect(text).toContain("none yet (created on the first reported event)");
    // The configured value fails validation, so it is never echoed: a URL can
    // carry an operator secret.
    expect(text).toContain("unusable; delivery is disabled");
    expect(text).not.toContain("secret");
    expect(text).not.toContain("telemetry.example.invalid");
  });

  it("reports an unusable endpoint as disabling delivery rather than repairing it", async () => {
    process.env.CAMPFIRE_TELEMETRY_URL = "not-a-url";
    await cli(["telemetry", "status", "--output", "json"]);
    const status = statusJson();
    expect(status.endpoint).toEqual({ source: "env", valid: false });
    expect(status.endpoint.url).toBeUndefined();
    expect(existsSync(statePath())).toBe(false);
  });

  it("honours an ambient environment override without storing it", async () => {
    process.env.CAMPFIRE_TELEMETRY = "0";
    await cli(["telemetry", "status", "--output", "json"]);
    expect(statusJson()).toMatchObject({ enabled: false, source: "env" });
    expect(existsSync(statePath())).toBe(false);
  });
});

describe("campfire telemetry enable and disable", () => {
  it("persists enable, then disable, and both are observable through status", async () => {
    expect(await entry(["telemetry", "enable", "--output", "json"])).toBe(0);
    expect(readState()).toMatchObject({ version: TELEMETRY_STATE_VERSION, enabled: true });
    const enabledId = String(readState().installationId);
    expect(isTelemetryInstallationId(enabledId)).toBe(true);

    logs = [];
    await cli(["telemetry", "status", "--output", "json"]);
    expect(statusJson()).toMatchObject({
      enabled: true,
      source: "preference",
      installation: { id: enabledId },
    });
    expect(statusJson().next[0]?.command).toBe("campfire telemetry disable");

    logs = [];
    expect(await entry(["telemetry", "disable", "--output", "json"])).toBe(0);
    expect(readState()).toMatchObject({ enabled: false, installationId: enabledId });

    logs = [];
    await cli(["telemetry", "status", "--output", "json"]);
    expect(statusJson()).toMatchObject({ enabled: false, source: "preference" });
    expect(statusJson().next[0]?.command).toBe("campfire telemetry enable");
  });

  it("keeps a stored preference visible under an ambient override", async () => {
    await cli(["telemetry", "disable"]);
    logs = [];
    process.env.CAMPFIRE_TELEMETRY = "1";
    await cli(["telemetry", "status", "--output", "json"]);
    expect(statusJson()).toMatchObject({ enabled: true, source: "env" });

    // The override was for one invocation only: the stored preference is intact.
    delete process.env.CAMPFIRE_TELEMETRY;
    logs = [];
    await cli(["telemetry", "status", "--output", "json"]);
    expect(statusJson()).toMatchObject({ enabled: false, source: "preference" });
  });

  it("surfaces recorded activation days without inventing any", async () => {
    await cli(["telemetry", "enable"]);
    const id = String(readState().installationId);
    const seeded = {
      version: 1,
      installationId: id,
      enabled: true,
      activatedOn: "2026-03-01",
      lastActiveOn: "2026-03-02",
    };
    const { writeFileSync } = await import("node:fs");
    writeFileSync(statePath(), `${JSON.stringify(seeded, null, 2)}\n`);

    logs = [];
    await cli(["telemetry", "status", "--output", "json"]);
    expect(statusJson().installation).toEqual({ id, activatedOn: "2026-03-01", lastActiveOn: "2026-03-02" });

    logs = [];
    await cli(["telemetry", "status", "--output", "human"]);
    expect(stdout()).toContain("activated 2026-03-01");
    expect(stdout()).toContain("last active 2026-03-02");
    expect(stdout()).toContain("(this installation, not a person)");
  });
});

describe("campfire telemetry rejects an unusable request", () => {
  it("exits non-zero with a structured error for an unknown subcommand", async () => {
    const code = await entry(["telemetry", "frobnicate", "--output", "json"]);
    expect(code).not.toBe(0);
    const failure = JSON.parse(stderr()) as {
      error: { code: string; message: string; details?: Record<string, unknown> };
    };
    expect(failure.error.code).toBe("ValidationError");
    expect(failure.error.message).toContain("telemetry");
    expect(failure.error.details?.field).toBe("telemetry");
    expect(stdout()).toBe("");
  });

  it("exits non-zero with a structured error when the subcommand is missing", async () => {
    const code = await entry(["telemetry", "--output", "json"]);
    expect(code).not.toBe(0);
    const failure = JSON.parse(stderr()) as { error: { message: string; details?: Record<string, unknown> } };
    expect(failure.error.message).toContain("telemetry");
    expect(failure.error.message).toContain("(none)");
    expect(failure.error.details?.field).toBe("telemetry");
  });

  it("names the three documented subcommands in the failure text", async () => {
    const code = await entry(["telemetry"]);
    expect(code).not.toBe(0);
    for (const subcommand of ["status", "enable", "disable"]) {
      expect(stderr()).toContain(`campfire telemetry ${subcommand}`);
    }
  });

  it("changes nothing on disk when the subcommand is rejected", async () => {
    await entry(["telemetry", "frobnicate"]);
    expect(existsSync(statePath())).toBe(false);
  });
});

describe("the telemetry command performs no network call", () => {
  it("exits zero against a closed endpoint", async () => {
    process.env.CAMPFIRE_TELEMETRY_URL = CLOSED_ENDPOINT;
    for (const args of [
      ["telemetry", "status", "--output", "json"],
      ["telemetry", "enable", "--output", "json"],
      ["telemetry", "disable", "--output", "json"],
    ]) {
      logs = [];
      errors = [];
      expect(await entry(args), args.join(" ")).toBe(0);
      expect(stderr(), args.join(" ")).toBe("");
    }
  });

  it("issues no fetch for status, enable, or disable", async () => {
    process.env.CAMPFIRE_TELEMETRY_URL = CLOSED_ENDPOINT;
    const calls: unknown[] = [];
    vi.stubGlobal("fetch", (async (...args: unknown[]) => {
      calls.push(args);
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch);

    await cli(["telemetry", "status", "--output", "json"]);
    await cli(["telemetry", "enable", "--output", "json"]);
    await cli(["telemetry", "disable", "--output", "json"]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls).toHaveLength(0);
    expect(stderr()).toBe("");
  });

  it("reports the configured endpoint in status without contacting it", async () => {
    process.env.CAMPFIRE_TELEMETRY_URL = CLOSED_ENDPOINT;
    await cli(["telemetry", "status", "--output", "json"]);
    expect(statusJson().endpoint).toEqual({ url: CLOSED_ENDPOINT, source: "env", valid: true });
  });
});

describe("telemetry status projection", () => {
  it("omits the installation block entirely when no id exists", () => {
    const result = buildTelemetryStatus({
      enabled: true,
      source: "default",
      endpoint: { url: DEFAULT_TELEMETRY_ENDPOINT, source: "default", valid: true },
    });
    expect(result).not.toHaveProperty("installation");
    expect(Object.keys(result).sort()).toEqual(["enabled", "endpoint", "kind", "next", "source", "version"]);
    expect(formatTelemetryStatus(result)).toContain("none yet (created on the first reported event)");
  });

  it("offers the inverse next step for the current state", () => {
    const disabled = buildTelemetryStatus({
      enabled: false,
      source: "env",
      endpoint: { source: "env", valid: false },
    });
    expect(disabled.next).toEqual([{ command: "campfire telemetry enable", when: "Send anonymous product telemetry" }]);
    const text = formatTelemetryStatus(disabled);
    expect(text).toContain("unusable; delivery is disabled");
    expect(text).toMatch(/disabled\s+\(env\)/);
  });
});
