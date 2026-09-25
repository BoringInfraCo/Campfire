/**
 * Sprint 014 part A: one safe Wrangler execution boundary.
 *
 * Spawns scripts/wrangler-deploy.mjs against an isolated fixture and a stub
 * binary. Never reads the operator's wrangler.local.toml and never uses a
 * real-looking production D1 id.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const wrapper = join(repoRoot, "scripts/wrangler-deploy.mjs");

const ENV_ID = "11111111-1111-1111-1111-111111111111";
const LOCAL_ID = "22222222-2222-2222-2222-222222222222";
const PLACEHOLDER = "00000000-0000-0000-0000-000000000000";
const REPLACE_ME = "REPLACE_ME_WITH_OUTPUT_OF_WRANGLER_D1_CREATE";

const FIXTURE_TOML = `name = "campfire"
main = "src/worker/index.ts"
[[d1_databases]]
binding = "DB"
database_name = "campfire"
database_id = "${PLACEHOLDER}"
migrations_dir = "migrations"

[assets]
directory = "./public"
binding = "ASSETS"
`;

const STUB_SOURCE = `#!${process.execPath}
import { copyFileSync, writeFileSync } from "node:fs";
const argv = process.argv.slice(2);
const log = process.env.STUB_ARGV_LOG;
if (log) writeFileSync(log, JSON.stringify(argv));
const idx = argv.indexOf("--config");
const configPath = idx === -1 ? undefined : argv[idx + 1];
const copyTo = process.env.STUB_CONFIG_COPY;
if (configPath && copyTo) copyFileSync(configPath, copyTo);
const raw = process.env.STUB_EXIT;
const code = raw === undefined || raw === "" ? 0 : Number(raw);
process.exit(Number.isInteger(code) ? code : 1);
`;

let fixture = "";

function writeLocal(id: string) {
  writeFileSync(join(fixture, "wrangler.local.toml"), `database_id = "${id}"\n`);
}

function run(args: string[], extra: Record<string, string> = {}) {
  const env: Record<string, string> = {
    TMPDIR: join(fixture, "tmp"),
    CAMPFIRE_WRANGLER_BIN: join(fixture, "stub-wrangler.mjs"),
    CAMPFIRE_CONFIG_ROOT: fixture,
    STUB_ARGV_LOG: join(fixture, "argv.json"),
    STUB_CONFIG_COPY: join(fixture, "copied.toml"),
    ...extra,
  };
  return spawnSync(process.execPath, [wrapper, ...args], {
    encoding: "utf8",
    env,
    cwd: fixture,
  });
}

function outputOf(res: { stdout: string | null; stderr: string | null }): string {
  return `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
}

function assertNoIds(res: { stdout: string | null; stderr: string | null }, ids: string[]) {
  const out = outputOf(res);
  for (const id of ids) {
    expect(out).not.toContain(id);
  }
}

function readArgv(): string[] {
  const parsed: unknown = JSON.parse(readFileSync(join(fixture, "argv.json"), "utf8"));
  if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === "string")) {
    throw new Error("stub argv log is not a string array");
  }
  return parsed;
}

function configPathFrom(argv: string[]): string {
  const idx = argv.indexOf("--config");
  const path = argv[idx + 1];
  if (idx === -1 || path === undefined) {
    throw new Error("expected --config in stub argv");
  }
  return path;
}

afterEach(() => {
  if (fixture) rmSync(fixture, { recursive: true, force: true });
  fixture = "";
});

function setup() {
  fixture = mkdtempSync(join(tmpdir(), "campfire-wrangler-test-"));
  writeFileSync(join(fixture, "wrangler.toml"), FIXTURE_TOML);
  const stub = join(fixture, "stub-wrangler.mjs");
  writeFileSync(stub, STUB_SOURCE);
  chmodSync(stub, 0o755);
  mkdirSync(join(fixture, "tmp"));
}

describe("wrangler-deploy", () => {
  it("prefers a trimmed env id over a different local-file id", () => {
    setup();
    writeLocal(LOCAL_ID);
    const res = run(["deploy"], { CAMPFIRE_D1_DATABASE_ID: `  ${ENV_ID}  ` });
    expect(res.status).toBe(0);
    const argv = readArgv();
    expect(argv.slice(0, 1)).toEqual(["deploy"]);
    expect(argv).toContain("--config");
    const copied = readFileSync(join(fixture, "copied.toml"), "utf8");
    expect(copied).toContain(`database_id = "${ENV_ID}"`);
    expect(copied).not.toContain(LOCAL_ID);
    expect(res.stderr ?? "").toContain("[campfire] using D1 id from $CAMPFIRE_D1_DATABASE_ID via ephemeral config");
    assertNoIds(res, [ENV_ID, LOCAL_ID, PLACEHOLDER, REPLACE_ME]);
  });

  it("uses the local-file id when the env id is absent", () => {
    setup();
    writeLocal(LOCAL_ID);
    const res = run(["deploy"]);
    expect(res.status).toBe(0);
    const copied = readFileSync(join(fixture, "copied.toml"), "utf8");
    expect(copied).toContain(`database_id = "${LOCAL_ID}"`);
    expect(copied).not.toContain(ENV_ID);
    expect(res.stderr ?? "").toContain("[campfire] using D1 id from wrangler.local.toml via ephemeral config");
    assertNoIds(res, [ENV_ID, LOCAL_ID, PLACEHOLDER, REPLACE_ME]);
  });

  it("treats whitespace-only env as absent and uses the local-file id", () => {
    setup();
    writeLocal(LOCAL_ID);
    const res = run(["deploy"], { CAMPFIRE_D1_DATABASE_ID: " \n\t " });
    expect(res.status).toBe(0);
    const copied = readFileSync(join(fixture, "copied.toml"), "utf8");
    expect(copied).toContain(`database_id = "${LOCAL_ID}"`);
    assertNoIds(res, [ENV_ID, LOCAL_ID, PLACEHOLDER, REPLACE_ME]);
  });

  it("rejects sentinel ids for remote mutation without spawning or falling through", () => {
    const cases: Array<{ env?: string; local?: string; args: string[] }> = [
      { env: PLACEHOLDER, local: LOCAL_ID, args: ["deploy"] },
      { env: `  ${REPLACE_ME}  `, local: LOCAL_ID, args: ["deploy"] },
      { local: PLACEHOLDER, args: ["d1", "migrations", "apply", "campfire", "--remote"] },
      { local: REPLACE_ME, args: ["deploy"] },
      { args: ["deploy"] },
    ];
    for (const entry of cases) {
      setup();
      if (entry.local) writeLocal(entry.local);
      const extra: Record<string, string> = {};
      if (entry.env !== undefined) extra.CAMPFIRE_D1_DATABASE_ID = entry.env;
      const res = run(entry.args, extra);
      expect(res.status).toBe(1);
      expect(existsSync(join(fixture, "argv.json"))).toBe(false);
      expect(existsSync(join(fixture, "copied.toml"))).toBe(false);
      expect(readdirSync(join(fixture, "tmp"))).toEqual([]);
      expect(res.stderr ?? "").toContain(
        "[campfire] error: remote mutation requires a non-placeholder D1 id from $CAMPFIRE_D1_DATABASE_ID or wrangler.local.toml",
      );
      assertNoIds(res, [ENV_ID, LOCAL_ID, PLACEHOLDER, REPLACE_ME]);
      rmSync(fixture, { recursive: true, force: true });
      fixture = "";
    }
  });

  it("passes migrate args and the generated --config path to the stub", () => {
    setup();
    const res = run(["d1", "migrations", "apply", "campfire", "--remote"], {
      CAMPFIRE_D1_DATABASE_ID: ENV_ID,
    });
    expect(res.status).toBe(0);
    const argv = readArgv();
    const configPath = configPathFrom(argv);
    expect(argv).toEqual([
      "d1",
      "migrations",
      "apply",
      "campfire",
      "--remote",
      "--config",
      configPath,
    ]);
    expect(isAbsolute(configPath)).toBe(true);
    expect(dirname(configPath).split(/[\\/]/).pop()?.startsWith("campfire-wrangler-")).toBe(true);
    assertNoIds(res, [ENV_ID, LOCAL_ID, PLACEHOLDER, REPLACE_ME]);
  });

  it("passes deploy plus --config to the stub", () => {
    setup();
    const res = run(["deploy"], { CAMPFIRE_D1_DATABASE_ID: ENV_ID });
    expect(res.status).toBe(0);
    const argv = readArgv();
    const configPath = configPathFrom(argv);
    expect(argv).toEqual(["deploy", "--config", configPath]);
    assertNoIds(res, [ENV_ID, LOCAL_ID, PLACEHOLDER, REPLACE_ME]);
  });

  it("dry-run with no id spawns the stub without --config", () => {
    setup();
    const res = run(["deploy", "--dry-run"]);
    expect(res.status).toBe(0);
    expect(readArgv()).toEqual(["deploy", "--dry-run"]);
    expect(existsSync(join(fixture, "copied.toml"))).toBe(false);
    expect(readdirSync(join(fixture, "tmp"))).toEqual([]);
    expect(res.stderr ?? "").toContain(
      "[campfire] no D1 id found (env/local file); using committed placeholder config (local dev / --dry-run only)",
    );
    assertNoIds(res, [ENV_ID, LOCAL_ID, PLACEHOLDER, REPLACE_ME]);
  });

  it("does not let an env sentinel fall through to a local id on dry-run", () => {
    setup();
    writeLocal(LOCAL_ID);
    const res = run(["deploy", "--dry-run"], { CAMPFIRE_D1_DATABASE_ID: PLACEHOLDER });
    expect(res.status).toBe(0);
    expect(readArgv()).toEqual(["deploy", "--dry-run"]);
    expect(existsSync(join(fixture, "copied.toml"))).toBe(false);
    assertNoIds(res, [ENV_ID, LOCAL_ID, PLACEHOLDER, REPLACE_ME]);
  });

  it("absolutizes main, migrations_dir, and directory against the fixture", () => {
    setup();
    const res = run(["deploy"], { CAMPFIRE_D1_DATABASE_ID: ENV_ID });
    expect(res.status).toBe(0);
    const copied = readFileSync(join(fixture, "copied.toml"), "utf8");
    const main = join(fixture, "src/worker/index.ts");
    const migrations = join(fixture, "migrations");
    const directory = join(fixture, "public");
    expect(isAbsolute(main)).toBe(true);
    expect(isAbsolute(migrations)).toBe(true);
    expect(isAbsolute(directory)).toBe(true);
    expect(copied).toContain(`main = "${main}"`);
    expect(copied).toContain(`migrations_dir = "${migrations}"`);
    expect(copied).toContain(`directory = "${directory}"`);
    expect(copied).not.toContain('main = "src/worker/index.ts"');
    expect(copied).not.toContain('migrations_dir = "migrations"');
    expect(copied).not.toContain('directory = "./public"');
    assertNoIds(res, [ENV_ID, LOCAL_ID, PLACEHOLDER, REPLACE_ME]);
  });

  it("removes the temp config directory after exit 0 and after a non-zero stub exit", () => {
    setup();
    const ok = run(["deploy"], { CAMPFIRE_D1_DATABASE_ID: ENV_ID, STUB_EXIT: "0" });
    expect(ok.status).toBe(0);
    const okPath = configPathFrom(readArgv());
    expect(existsSync(join(fixture, "copied.toml"))).toBe(true);
    expect(existsSync(okPath)).toBe(false);
    expect(existsSync(dirname(okPath))).toBe(false);
    expect(readdirSync(join(fixture, "tmp"))).toEqual([]);
    assertNoIds(ok, [ENV_ID, LOCAL_ID]);

    rmSync(fixture, { recursive: true, force: true });
    setup();
    const failed = run(["deploy"], { CAMPFIRE_D1_DATABASE_ID: LOCAL_ID, STUB_EXIT: "3" });
    expect(failed.status).toBe(3);
    const failedPath = configPathFrom(readArgv());
    expect(existsSync(join(fixture, "copied.toml"))).toBe(true);
    expect(existsSync(failedPath)).toBe(false);
    expect(existsSync(dirname(failedPath))).toBe(false);
    expect(readdirSync(join(fixture, "tmp"))).toEqual([]);
    assertNoIds(failed, [ENV_ID, LOCAL_ID, PLACEHOLDER, REPLACE_ME]);
  });

  it("propagates the stub exit status", () => {
    setup();
    const res = run(["deploy"], { CAMPFIRE_D1_DATABASE_ID: ENV_ID, STUB_EXIT: "7" });
    expect(res.status).toBe(7);
    expect(existsSync(dirname(configPathFrom(readArgv())))).toBe(false);
    assertNoIds(res, [ENV_ID, LOCAL_ID, PLACEHOLDER, REPLACE_ME]);
  });
});
