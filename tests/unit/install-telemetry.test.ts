import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Installer-side telemetry (TEL-001D).
 *
 * These tests drive the real `public/campfire/install.sh` against a loopback
 * HTTP server, so the actual curl invocation is observed rather than mocked. The
 * installer is spawned asynchronously on purpose: `spawnSync` would block this
 * process's event loop, the server could never accept the request, and every
 * case would degrade into a connection timeout that proves nothing.
 *
 * The assertions that matter are the privacy allow-list and the exit-code
 * guarantee: measurement must never be able to change an install.
 */

const installer = fileURLToPath(new URL("../../public/campfire/install.sh", import.meta.url));

/** Exactly the keys `serializeTelemetryEvent` in src/telemetry/contract.ts writes. */
const ALLOWED_KEYS = [
  "schemaVersion",
  "event",
  "installationId",
  "campfireVersion",
  "os",
  "arch",
  "installMethod",
];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface Received {
  body: string;
  contentType: string | undefined;
  method: string | undefined;
}

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

let root: string;
let server: Server;
let requests: Received[] = [];
let respond: (req: IncomingMessage, res: ServerResponse) => void = (_req, res) => void res.writeHead(202).end("");

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "campfire-tel-"));
  requests = [];
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      requests.push({
        body: Buffer.concat(chunks).toString("utf8"),
        contentType: req.headers["content-type"],
        method: req.method,
      });
      respond(req, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(root, { recursive: true, force: true });
});

function endpoint(): string {
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}/campfire/v1/telemetry`;
}

function makeTarball(version: string): string {
  const stage = join(root, `stage-${version}`);
  const binDir = join(stage, "bin");
  const libDir = join(stage, "lib", "campfire");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(libDir, { recursive: true });
  writeFileSync(join(binDir, "campfire"), "#!/bin/sh\nprintf '%s\\n' 'campfire help'\n", { mode: 0o755 });
  chmodSync(join(binDir, "campfire"), 0o755);
  writeFileSync(join(libDir, "package.json"), `{\n  "name": "campfire",\n  "version": "${version}"\n}\n`);
  const tarball = join(root, `campfire-${version}.tar.gz`);
  const packed = spawnSync("tar", ["-czf", tarball, "-C", stage, "bin", "lib"], { encoding: "utf8" });
  if (packed.status !== 0) throw new Error(`tar failed: ${packed.stderr}`);
  return tarball;
}

function run(args: string[], extra: Record<string, string | undefined> = {}): Promise<RunResult> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of [
    "CAMPFIRE_TARBALL",
    "CAMPFIRE_VERSION",
    "CAMPFIRE_URL",
    "CAMPFIRE_DRY_RUN",
    "CAMPFIRE_RELEASE_BASE",
    "CAMPFIRE_TELEMETRY",
    "CAMPFIRE_TELEMETRY_URL",
    "CAMPFIRE_CONFIG_DIR",
    "CAMPREFIX",
  ]) {
    delete env[key];
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawn("sh", [installer, ...args], { env });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ status: code, stdout, stderr }));
  });
}

function telemetryState(configDir: string): Record<string, unknown> {
  const path = join(configDir, "telemetry.json");
  if (!existsSync(path)) throw new Error(`expected ${path} to exist`);
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function acceptAll(): void {
  respond = (_req, res) => void res.writeHead(202).end("");
}

describe("install.sh install_completed report", () => {
  it("sends exactly the allow-listed contract fields", async () => {
    acceptAll();
    const configDir = join(root, "config");
    const tarball = makeTarball("1.9.1");
    const result = await run(["--prefix", join(root, "prefix")], {
      CAMPFIRE_TARBALL: tarball,
      CAMPFIRE_CONFIG_DIR: configDir,
      CAMPFIRE_TELEMETRY_URL: endpoint(),
    });

    expect(result.status).toBe(0);
    expect(requests.length).toBe(1);
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.contentType).toContain("application/json");

    const payload = JSON.parse(requests[0]!.body) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual([...ALLOWED_KEYS].sort());
    expect(payload.schemaVersion).toBe(1);
    expect(payload.event).toBe("install_completed");
    expect(payload.campfireVersion).toBe("1.9.1");
    expect(payload.installMethod).toBe("curl");
    expect(payload.os).toBe(process.platform);
    expect(payload.arch).toBe(process.arch);
    expect(String(payload.installationId)).toMatch(UUID_PATTERN);
  });

  it("never puts machine or operator identity in the body", async () => {
    acceptAll();
    const tarball = makeTarball("1.9.1");
    const result = await run(
      ["--prefix", join(root, "prefix"), "--url", "https://campfire.example.test/work"],
      {
        CAMPFIRE_TARBALL: tarball,
        CAMPFIRE_CONFIG_DIR: join(root, "config"),
        CAMPFIRE_TELEMETRY_URL: endpoint(),
        HOME: root,
      },
    );

    expect(result.status).toBe(0);
    expect(requests.length).toBe(1);
    const body = requests[0]!.body;
    for (const forbidden of [
      process.env.USER ?? "unset-user",
      process.env.LOGNAME ?? "unset-logname",
      process.env.HOSTNAME ?? "unset-hostname",
      root,
      tarball,
      "campfire.example.test",
    ]) {
      expect(body).not.toContain(forbidden);
    }
  });

  it("sends nothing when CAMPFIRE_TELEMETRY disables it", async () => {
    acceptAll();
    const configDir = join(root, "config");
    const tarball = makeTarball("1.9.1");
    for (const value of ["0", "off", "false", "no", "NO", " off "]) {
      requests = [];
      const result = await run(["--prefix", join(root, `prefix-${value.trim()}`)], {
        CAMPFIRE_TARBALL: tarball,
        CAMPFIRE_CONFIG_DIR: configDir,
        CAMPFIRE_TELEMETRY: value,
        CAMPFIRE_TELEMETRY_URL: endpoint(),
      });
      expect(result.status).toBe(0);
      expect(requests).toHaveLength(0);
    }
    // A disabled installation writes no state file either.
    expect(existsSync(join(configDir, "telemetry.json"))).toBe(false);
  });

  it("posts nothing and writes nothing on a dry run", async () => {
    acceptAll();
    const configDir = join(root, "config");
    const tarball = makeTarball("1.9.1");
    const result = await run(["--dry-run", "--prefix", join(root, "prefix")], {
      CAMPFIRE_TARBALL: tarball,
      CAMPFIRE_CONFIG_DIR: configDir,
      CAMPFIRE_TELEMETRY_URL: endpoint(),
    });

    expect(result.status).toBe(0);
    expect(requests).toHaveLength(0);
    expect(existsSync(configDir)).toBe(false);
  });

  it("reuses the installation id across reinstalls and mints a new one when state is gone", async () => {
    acceptAll();
    const configDir = join(root, "config");
    const tarball = makeTarball("1.9.1");
    const install = (prefix: string) =>
      run(["--prefix", prefix], {
        CAMPFIRE_TARBALL: tarball,
        CAMPFIRE_CONFIG_DIR: configDir,
        CAMPFIRE_TELEMETRY_URL: endpoint(),
      });

    expect((await install(join(root, "prefix-a"))).status).toBe(0);
    const first = String(telemetryState(configDir).installationId);
    expect(first).toMatch(UUID_PATTERN);

    expect((await install(join(root, "prefix-b"))).status).toBe(0);
    expect(String(telemetryState(configDir).installationId)).toBe(first);
    expect(requests.map((entry) => (JSON.parse(entry.body) as Record<string, unknown>).installationId)).toEqual([
      first,
      first,
    ]);

    rmSync(join(configDir, "telemetry.json"));
    expect((await install(join(root, "prefix-c"))).status).toBe(0);
    const afterClean = String(telemetryState(configDir).installationId);
    expect(afterClean).toMatch(UUID_PATTERN);
    expect(afterClean).not.toBe(first);
  });

  it("leaves a telemetry.json written by the TypeScript side untouched", async () => {
    acceptAll();
    const configDir = join(root, "config");
    mkdirSync(configDir, { recursive: true });
    const existing = {
      version: 1,
      installationId: "11111111-2222-4333-8444-555555555555",
      enabled: true,
      activatedOn: "2026-01-01",
      lastActiveOn: "2026-01-02",
      installCompletedReported: true,
    };
    const path = join(configDir, "telemetry.json");
    const serialized = `${JSON.stringify(existing, null, 2)}\n`;
    writeFileSync(path, serialized);

    const tarball = makeTarball("1.9.1");
    const result = await run(["--prefix", join(root, "prefix")], {
      CAMPFIRE_TARBALL: tarball,
      CAMPFIRE_CONFIG_DIR: configDir,
      CAMPFIRE_TELEMETRY_URL: endpoint(),
    });

    expect(result.status).toBe(0);
    expect(readFileSync(path, "utf8")).toBe(serialized);
    expect((JSON.parse(requests[0]!.body) as Record<string, unknown>).installationId).toBe(
      existing.installationId,
    );
  });

  it("honors a recorded `telemetry disable` so a reinstall does not resume reporting", async () => {
    // An operator who ran `campfire telemetry disable` must not see a later
    // reinstall start reporting again just because it re-read the environment.
    acceptAll();
    const configDir = join(root, "config");
    mkdirSync(configDir, { recursive: true });
    const path = join(configDir, "telemetry.json");
    const serialized = `${JSON.stringify({
      version: 1,
      installationId: "11111111-2222-4333-8444-555555555555",
      enabled: false,
    }, null, 2)}\n`;
    writeFileSync(path, serialized);

    const result = await run(["--prefix", join(root, "prefix")], {
      CAMPFIRE_TARBALL: makeTarball("1.9.1"),
      CAMPFIRE_CONFIG_DIR: configDir,
      CAMPFIRE_TELEMETRY_URL: endpoint(),
    });

    expect(result.status).toBe(0);
    expect(requests).toEqual([]);
    expect(readFileSync(path, "utf8")).toBe(serialized);
  });

  it("still reports when the recorded preference is explicitly enabled", async () => {
    // The opt-out check must be an exact negative, not an "any telemetry.json
    // present means stop" rule: an ordinary enabled installation keeps reporting.
    acceptAll();
    const configDir = join(root, "config");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "telemetry.json"), `${JSON.stringify({
      version: 1,
      installationId: "11111111-2222-4333-8444-555555555555",
      enabled: true,
    }, null, 2)}\n`);

    const result = await run(["--prefix", join(root, "prefix")], {
      CAMPFIRE_TARBALL: makeTarball("1.9.1"),
      CAMPFIRE_CONFIG_DIR: configDir,
      CAMPFIRE_TELEMETRY_URL: endpoint(),
    });

    expect(result.status).toBe(0);
    expect(requests).toHaveLength(1);
  });

  it("does not change the exit code when telemetry errors, drops the connection, or does not exist", async () => {
    const tarball = makeTarball("1.9.1");
    const cases: Array<{ name: string; handler: (req: IncomingMessage, res: ServerResponse) => void }> = [
      { name: "server-error", handler: (_req, res) => void res.writeHead(500).end("boom") },
      { name: "not-found", handler: (_req, res) => void res.writeHead(404).end("") },
      { name: "connection-dropped", handler: (req) => void req.socket.destroy() },
    ];

    for (const testCase of cases) {
      requests = [];
      respond = testCase.handler;
      const result = await run(["--prefix", join(root, `prefix-${testCase.name}`)], {
        CAMPFIRE_TARBALL: tarball,
        CAMPFIRE_CONFIG_DIR: join(root, `config-${testCase.name}`),
        CAMPFIRE_TELEMETRY_URL: endpoint(),
      });
      expect(result.status, testCase.name).toBe(0);
      expect(result.stdout, testCase.name).toContain("Installed campfire 1.9.1");
      expect(result.stderr, testCase.name).not.toContain("install.sh: error");
    }

    // A closed port: nothing is listening, so the connection is refused.
    const closed = await run(["--prefix", join(root, "prefix-closed")], {
      CAMPFIRE_TARBALL: tarball,
      CAMPFIRE_CONFIG_DIR: join(root, "config-closed"),
      CAMPFIRE_TELEMETRY_URL: "http://127.0.0.1:1/campfire/v1/telemetry",
    });
    expect(closed.status).toBe(0);
    expect(closed.stdout).toContain("Installed campfire 1.9.1");
  });

  it("keeps the human-visible installer output unchanged", async () => {
    acceptAll();
    const tarball = makeTarball("1.9.1");
    const result = await run(["--prefix", join(root, "prefix")], {
      CAMPFIRE_TARBALL: tarball,
      CAMPFIRE_CONFIG_DIR: join(root, "config"),
      CAMPFIRE_TELEMETRY_URL: endpoint(),
    });

    expect(result.stdout).toContain("Installed campfire 1.9.1");
    expect(result.stdout).toContain("Run  campfire  to create your first workspace.");
    // No measurement chatter: no event name, no dimension, no endpoint, no
    // mention of the reporting itself.
    for (const noise of ["install_completed", "installationId", "telemetry", "TARBALL"]) {
      expect(result.stdout).not.toContain(noise);
    }
  });
});
