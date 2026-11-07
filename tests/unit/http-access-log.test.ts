/**
 * Request logs are for redirected stderr. A terminal is the work shell, so
 * those JSON lines must not land on it.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startCampfireHttpServer } from "../../src/http/server.js";
import { createRuntimeFromPath } from "../../src/runtime.js";

describe("http access log", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function postHealth(isTTY: boolean): Promise<string[]> {
    const dir = mkdtempSync(join(tmpdir(), "campfire-access-"));
    dirs.push(dir);
    const runtime = createRuntimeFromPath(join(dir, "campfire.db"));
    const lines: string[] = [];
    const previous = process.stderr.isTTY;
    Object.defineProperty(process.stderr, "isTTY", { value: isTTY, configurable: true });
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
    const server = await startCampfireHttpServer({ runtime, host: "127.0.0.1", port: 0 });
    try {
      const response = await fetch(`${server.url}/health`, { method: "POST" });
      expect(response.status).toBe(405);
    } finally {
      await server.close();
      runtime.close();
      spy.mockRestore();
      Object.defineProperty(process.stderr, "isTTY", { value: previous, configurable: true });
    }
    return lines;
  }

  it("does not print request JSON on a terminal", async () => {
    expect(await postHealth(true)).toEqual([]);
  });

  it("records request JSON when stderr is redirected", async () => {
    expect((await postHealth(false)).join("\n")).toContain('"error":"ValidationError"');
  });
});
