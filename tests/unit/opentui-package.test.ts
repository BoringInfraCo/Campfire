import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const scratch: string[] = [];
afterEach(() => { for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function fixture(withTui: boolean, withBun = true) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "campfire-pack-test-")));
  scratch.push(root);
  for (const dir of ["scripts", "dist/src/cli", "public/campfire", "mock-bin"]) mkdirSync(join(root, dir), { recursive: true });
  copyFileSync(resolve("scripts/package.sh"), join(root, "scripts/package.sh"));
  writeFileSync(join(root, "package.json"), '{\n  "version": "0.0.1",\n  "type": "module"\n}\n');
  writeFileSync(join(root, "package-lock.json"), "{}\n");
  writeFileSync(join(root, "LICENSE"), "fixture\n");
  writeFileSync(join(root, "public/campfire/install.sh"), "#!/bin/sh\n");
  writeFileSync(join(root, "dist/src/cli/index.js"), 'console.log("fixture help")\n');
  const npm = join(root, "mock-bin/npm");
  writeFileSync(npm, `#!/bin/sh\nif [ "$1" = run ]; then exit 0; fi\nif [ "$PWD" = "$PACK_ROOT" ]; then printf '%s\\n' "$PWD"; else printf '%s\\n' "$PWD" "$PWD/node_modules/bun" "$PWD/node_modules/@opentui/core"; fi\n`);
  chmodSync(npm, 0o755);
  if (withTui) {
    for (const dir of ["tui/src", "tui/assets", "tui/node_modules/bun/bin", "tui/node_modules/@opentui/core"]) mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, "tui/package.json"), "{}\n");
    writeFileSync(join(root, "tui/package-lock.json"), "{}\n");
    writeFileSync(join(root, "tui/src/main.ts"), "// fixture\n");
    writeFileSync(join(root, "tui/assets/mark.png"), "fixture\n");
    writeFileSync(join(root, "tui/node_modules/@opentui/core/index.js"), "// fixture\n");
    if (withBun) {
      const bun = join(root, "tui/node_modules/bun/bin/bun.exe");
      writeFileSync(bun, '#!/bin/sh\nif [ "$1" = --version ]; then echo 1.3.14; fi\nexit 0\n');
      chmodSync(bun, 0o755);
    }
  }
  const run = () => spawnSync("sh", ["scripts/package.sh"], { cwd: root, encoding: "utf8", env: { ...process.env, PACK_ROOT: root, PATH: `${join(root, "mock-bin")}:${process.env.PATH}` } });
  return { root, run };
}

describe("OpenTUI release staging", () => {
  it("preserves historical release packaging when no sidecar exists", () => {
    const { root, run } = fixture(false);
    const result = run();
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(join(root, "public/campfire/v0.0.1/install.sh"), "utf8")).toContain("#!/bin/sh");
  });

  it("includes sidecar source, assets, and runtime in the staged archive", () => {
    const { root, run } = fixture(true);
    const result = run();
    expect(result.status, result.stderr).toBe(0);
    const os = process.platform === "darwin" ? "darwin" : "linux";
    const arch = process.arch === "arm64" ? "arm64" : "x64";
    const entries = execFileSync("tar", ["-tzf", join(root, `release/campfire-${os}-${arch}.tar.gz`)], { encoding: "utf8" });
    expect(entries).toContain("lib/campfire/tui/src/main.ts");
    expect(entries).toContain("lib/campfire/tui/assets/mark.png");
    expect(entries).toContain("lib/campfire/tui/node_modules/bun/bin/bun.exe");
    expect(entries).toContain("lib/campfire/tui/node_modules/@opentui/core/index.js");
  });

  it("fails closed if the sidecar runtime is missing", () => {
    const { run } = fixture(true, false);
    const result = run();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("staged Bun is missing");
  });

  it("fails closed if the staged Bun is too old", () => {
    const { root, run } = fixture(true);
    writeFileSync(join(root, "tui/node_modules/bun/bin/bun.exe"), "#!/bin/sh\necho 1.3.5\n");
    const result = run();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("staged Bun must be at least 1.3.14");
  });
});
