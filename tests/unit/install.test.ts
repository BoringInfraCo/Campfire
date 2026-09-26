import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const installer = fileURLToPath(new URL("../../public/campfire/install.sh", import.meta.url));

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "campfire-install-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeExecutable(path: string, body: string): void {
  writeFileSync(path, body, { mode: 0o755 });
  chmodSync(path, 0o755);
}

function makeTarball(version: string): string {
  const stage = join(root, `stage-${version.replace(/[^0-9A-Za-z._-]/g, "_")}-${Math.random().toString(16).slice(2)}`);
  const binDir = join(stage, "bin");
  const libDir = join(stage, "lib", "campfire");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(libDir, { recursive: true });
  writeExecutable(
    join(binDir, "campfire"),
    "#!/bin/sh\nprintf '%s\\n' 'campfire help'\n",
  );
  writeFileSync(
    join(libDir, "package.json"),
    `{\n  "name": "campfire",\n  "version": "${version}"\n}\n`,
  );
  const tarball = join(root, `campfire-${version.replace(/[^0-9A-Za-z._-]/g, "_")}.tar.gz`);
  const packed = spawnSync("tar", ["-czf", tarball, "-C", stage, "bin", "lib"], { encoding: "utf8" });
  if (packed.status !== 0) {
    throw new Error(`tar failed: ${packed.stderr}`);
  }
  return tarball;
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function run(args: string[], extra: Record<string, string | undefined> = {}, pathPrefix?: string) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.CAMPFIRE_TARBALL;
  delete env.CAMPFIRE_VERSION;
  delete env.CAMPFIRE_URL;
  delete env.CAMPFIRE_DRY_RUN;
  delete env.CAMPFIRE_RELEASE_BASE;
  delete env.CAMPREFIX;
  if (pathPrefix) {
    env.PATH = `${pathPrefix}${delimiter}${env.PATH ?? ""}`;
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }
  const result = spawnSync("sh", [installer, ...args], { encoding: "utf8", env });
  if (result.error) {
    throw result.error;
  }
  return result;
}

describe("install.sh package metadata", () => {
  it("reports the archive version for a default latest install", () => {
    const prefix = join(root, "prefix");
    const tarball = makeTarball("1.2.0");
    const result = run(["--prefix", prefix], { CAMPFIRE_TARBALL: tarball });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Installed campfire 1.2.0");
    expect(result.stdout).not.toContain("Installed campfire latest");
    expect(readFileSync(join(prefix, "lib", "campfire", "package.json"), "utf8")).toContain('"version": "1.2.0"');
  });

  it("rejects a pinned archive mismatch before replacing an existing install", () => {
    const prefix = join(root, "prefix");
    const tarball = makeTarball("1.2.0");
    const installed = run(["--prefix", prefix, "--version", "1.2.0"], { CAMPFIRE_TARBALL: tarball });
    expect(installed.status).toBe(0);

    const bin = join(prefix, "bin", "campfire");
    const pkg = join(prefix, "lib", "campfire", "package.json");
    writeFileSync(bin, `${readFileSync(bin, "utf8")}\n# ORIGINAL\n`);
    chmodSync(bin, 0o755);
    const packageBefore = readFileSync(pkg, "utf8");

    const mismatch = run(["--prefix", prefix, "--version", "1.2.1"], { CAMPFIRE_TARBALL: tarball });
    expect(mismatch.status).not.toBe(0);
    expect(mismatch.stderr).toContain(
      "archive package version 1.2.0 does not match requested version 1.2.1",
    );
    expect(readFileSync(pkg, "utf8")).toBe(packageBefore);
    expect(readFileSync(bin, "utf8")).toContain("# ORIGINAL");
  });

  it("accepts a matching pin and reports that version", () => {
    const prefix = join(root, "prefix");
    const tarball = makeTarball("1.2.0");
    const result = run(["--prefix", prefix, "--version", "1.2.0"], { CAMPFIRE_TARBALL: tarball });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Installed campfire 1.2.0");
    expect(readFileSync(join(prefix, "lib", "campfire", "package.json"), "utf8")).toContain('"version": "1.2.0"');
  });

  it("fails before replacement when package metadata is missing", () => {
    const prefix = join(root, "prefix");
    mkdirSync(join(prefix, "bin"), { recursive: true });
    mkdirSync(join(prefix, "lib", "campfire"), { recursive: true });
    const bin = join(prefix, "bin", "campfire");
    const pkg = join(prefix, "lib", "campfire", "package.json");
    writeExecutable(bin, "#!/bin/sh\nprintf '%s\\n' 'campfire help'\n# ORIGINAL\n");
    writeFileSync(pkg, '{\n  "name": "campfire",\n  "version": "1.2.0"\n}\n');

    const stage = join(root, "bad-stage");
    mkdirSync(join(stage, "bin"), { recursive: true });
    mkdirSync(join(stage, "lib", "campfire"), { recursive: true });
    writeExecutable(join(stage, "bin", "campfire"), "#!/bin/sh\nprintf '%s\\n' 'replaced'\n");
    const missingJson = join(root, "missing-package.tar.gz");
    const packed = spawnSync("tar", ["-czf", missingJson, "-C", stage, "bin", "lib"], { encoding: "utf8" });
    expect(packed.status).toBe(0);

    const missing = run(["--prefix", prefix], { CAMPFIRE_TARBALL: missingJson });
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain("tarball missing lib/campfire/package.json");
    expect(readFileSync(bin, "utf8")).toContain("# ORIGINAL");
    expect(readFileSync(pkg, "utf8")).toContain('"version": "1.2.0"');

    writeFileSync(join(stage, "lib", "campfire", "package.json"), '{\n  "name": "campfire"\n}\n');
    const missingVersion = join(root, "missing-version.tar.gz");
    const packedVersion = spawnSync("tar", ["-czf", missingVersion, "-C", stage, "bin", "lib"], {
      encoding: "utf8",
    });
    expect(packedVersion.status).toBe(0);
    const noVersion = run(["--prefix", prefix, "--version", "1.2.0"], { CAMPFIRE_TARBALL: missingVersion });
    expect(noVersion.status).not.toBe(0);
    expect(noVersion.stderr).toContain("has no version field");
    expect(readFileSync(bin, "utf8")).toContain("# ORIGINAL");
    expect(readFileSync(pkg, "utf8")).toContain('"version": "1.2.0"');
  });
});

describe("install.sh regressions", () => {
  it("verifies a matching sibling checksum before install", () => {
    const prefix = join(root, "prefix");
    const tarball = makeTarball("1.2.0");
    writeFileSync(`${tarball}.sha256`, `${sha256(tarball)}  campfire.tar.gz\n`);

    const result = run(["--prefix", prefix], { CAMPFIRE_TARBALL: tarball });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Checksum verified");
    expect(existsSync(join(prefix, "lib", "campfire", "package.json"))).toBe(true);
  });

  it("rejects a mismatched sibling checksum without installing", () => {
    const prefix = join(root, "prefix");
    const tarball = makeTarball("1.2.0");
    writeFileSync(
      `${tarball}.sha256`,
      "0000000000000000000000000000000000000000000000000000000000000000  campfire.tar.gz\n",
    );

    const result = run(["--prefix", prefix], { CAMPFIRE_TARBALL: tarball });
    expect(result.status).not.toBe(0);
    expect(existsSync(join(prefix, "lib", "campfire", "package.json"))).toBe(false);
  });

  it("rejects node 20 without installing", () => {
    const prefix = join(root, "prefix");
    const stubs = join(root, "stubs");
    mkdirSync(stubs);
    writeExecutable(join(stubs, "node"), "#!/bin/sh\nprintf '%s\\n' 'v20.0.0'\n");
    const tarball = makeTarball("1.2.0");

    const result = run(["--prefix", prefix], { CAMPFIRE_TARBALL: tarball }, stubs);
    expect(result.status).not.toBe(0);
    expect(`${result.stderr}`).toContain("node >= 22");
    expect(existsSync(join(prefix, "lib", "campfire", "package.json"))).toBe(false);
  });

  it("installs from a local CAMPFIRE_TARBALL", () => {
    const prefix = join(root, "prefix");
    const tarball = makeTarball("1.2.0");
    const result = run(["--prefix", prefix], { CAMPFIRE_TARBALL: tarball });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Installed campfire 1.2.0");
    expect(result.stdout).toContain("Run  campfire  to create your first workspace.");
    expect(result.stdout).not.toContain("Next steps:");
    expect(result.stdout).not.toContain("mcpServers");
    const help = spawnSync(join(prefix, "bin", "campfire"), ["--help"], { encoding: "utf8" });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("campfire help");
  });

  it("fails when CAMPFIRE_TARBALL does not exist", () => {
    const prefix = join(root, "prefix");
    const missing = join(root, "missing.tar.gz");
    const result = run(["--prefix", prefix], { CAMPFIRE_TARBALL: missing });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`CAMPFIRE_TARBALL file not found: ${missing}`);
    expect(existsSync(join(prefix, "lib", "campfire", "package.json"))).toBe(false);
  });

  it("prints a dry-run plan and does not create the prefix", () => {
    const prefix = join(root, "prefix");
    const result = run(["--dry-run", "--prefix", prefix]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Campfire install plan (dry run, nothing changed):");
    expect(result.stdout).toContain("version:      latest");
    expect(existsSync(prefix)).toBe(false);
  });

  it("falls back to npm for latest and a pinned version", () => {
    function stubPath(): { dir: string; args: string } {
      const dir = mkdtempSync(join(root, "npm-stubs-"));
      const args = join(dir, "npm-args");
      const campfire = join(dir, "campfire");
      writeExecutable(join(dir, "curl"), "#!/bin/sh\nexit 1\n");
      writeExecutable(
        join(dir, "npm"),
        `#!/bin/sh
printf '%s\\n' "$*" > '${args}'
cat > '${campfire}' << 'EOF'
#!/bin/sh
printf '%s\\n' "campfire help"
EOF
chmod +x '${campfire}'
exit 0
`,
      );
      return { dir, args };
    }

    const latest = stubPath();
    const latestResult = run(["--prefix", join(root, "unused-latest")], {}, latest.dir);
    expect(latestResult.status).toBe(0);
    expect(latestResult.stdout).toContain("Installed campfire via npm");
    expect(readFileSync(latest.args, "utf8").trim()).toBe("install -g github:BoringInfraCo/Campfire");

    const pinned = stubPath();
    const pinnedResult = run(["--prefix", join(root, "unused-pinned"), "--version", "1.2.0"], {}, pinned.dir);
    expect(pinnedResult.status).toBe(0);
    expect(pinnedResult.stdout).toContain("Installed campfire via npm");
    expect(readFileSync(pinned.args, "utf8").trim()).toBe(
      "install -g github:BoringInfraCo/Campfire#v1.2.0",
    );
  });

  it("installs under --prefix and mentions --url in next steps", () => {
    const prefix = join(root, "prefix");
    const url = "https://campfire.example.test/work";
    const tarball = makeTarball("1.2.0");
    const result = run(["--prefix", prefix, "--url", url], { CAMPFIRE_TARBALL: tarball });

    expect(result.status).toBe(0);
    expect(existsSync(join(prefix, "bin", "campfire"))).toBe(true);
    expect(result.stdout).toContain(url);
    expect(result.stdout).toContain("Run  campfire  to create your first workspace.");
    expect(result.stdout).not.toContain("export CAMPFIRE_URL");
    expect(result.stdout).not.toContain("issue-token");
    expect(result.stdout).not.toContain("mcpServers");
    expect(result.stdout).not.toContain("CAMPFIRE_TOKEN");
  });

  it("leaves immutable versioned installers without the mismatch sentence", () => {
    expect(readFileSync(installer, "utf8")).toContain("does not match requested version");
    for (const version of ["v1.0.0", "v1.1.0", "v1.2.0"]) {
      const text = readFileSync(new URL(`../../public/campfire/${version}/install.sh`, import.meta.url), "utf8");
      expect(text).not.toContain("does not match requested version");
    }
  });
});
