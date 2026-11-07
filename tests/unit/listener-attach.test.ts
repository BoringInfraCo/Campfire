import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isAddrInUse,
  openLocalListener,
  probeCampfireVersion,
  type OpenLocalListenerInput,
} from "../../src/bootstrap/listener-attach.js";
import type { RunningLocalWorkspace } from "../../src/bootstrap/local-workspace.js";
import { ValidationError } from "../../src/domain/errors.js";
import type { CampfireRuntime } from "../../src/runtime.js";
import type { ActorContext } from "../../src/service/authorization.js";

const HOST = "127.0.0.1";
const HTTP_PORT = 18080;
const VIEWER_PORT = 18081;

function addrInUse(): NodeJS.ErrnoException {
  const error = new Error("listen EADDRINUSE: address already in use 127.0.0.1:18080") as NodeJS.ErrnoException;
  error.code = "EADDRINUSE";
  return error;
}

function running(close: () => Promise<void> = async () => undefined): RunningLocalWorkspace {
  return {
    apiUrl: "http://127.0.0.1:44001",
    viewerUrl: "http://127.0.0.1:44002",
    close,
  };
}

function baseInput(overrides: Partial<OpenLocalListenerInput> = {}): OpenLocalListenerInput {
  return {
    runtime: {} as CampfireRuntime,
    human: {} as ActorContext,
    httpHost: HOST,
    httpPort: HTTP_PORT,
    viewerPort: VIEWER_PORT,
    portPinned: false,
    viewerPortPinned: false,
    ...overrides,
  };
}

describe("isAddrInUse", () => {
  it("is true only when error.code is EADDRINUSE", () => {
    expect(isAddrInUse(addrInUse())).toBe(true);
    expect(isAddrInUse({ code: "EADDRINUSE" })).toBe(true);
    expect(isAddrInUse(new Error("listen EADDRINUSE: address already in use"))).toBe(false);
    expect(isAddrInUse(Object.assign(new Error("busy"), { code: "EACCES" }))).toBe(false);
    expect(isAddrInUse("EADDRINUSE")).toBe(false);
    expect(isAddrInUse(null)).toBe(false);
  });
});

describe("probeCampfireVersion", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a non-empty version and sends no token", async () => {
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      expect(String(url)).toBe("http://campfire.invalid:18080/health");
      expect(String(url)).not.toContain("9414");
      expect(String(url)).not.toContain("9415");
      expect(init?.method ?? "GET").toBe("GET");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(init?.headers).toBeUndefined();
      return new Response(JSON.stringify({ version: "1.26.2" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(probeCampfireVersion("http://campfire.invalid:18080/")).resolves.toBe("1.26.2");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("returns undefined for an empty version, HTML, a thrown fetch, or a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ version: "" }), { status: 200 })));
    await expect(probeCampfireVersion("http://campfire.invalid:18080")).resolves.toBeUndefined();

    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>no</html>", { status: 200 })));
    await expect(probeCampfireVersion("http://campfire.invalid:18080")).resolves.toBeUndefined();

    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("down");
    }));
    await expect(probeCampfireVersion("http://campfire.invalid:18080")).resolves.toBeUndefined();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ version: "1.26.2" }), { status: 503 })),
    );
    await expect(probeCampfireVersion("http://campfire.invalid:18080")).resolves.toBeUndefined();
  });
});

describe("openLocalListener", () => {
  it("reuses a probed Campfire without starting or closing a server", async () => {
    const close = vi.fn(async () => undefined);
    const start = vi.fn(async () => running(close));
    const probe = vi.fn(async (url: string) => (url === `http://${HOST}:${HTTP_PORT}` ? "1.26.2" : undefined));
    const result = await openLocalListener(baseInput({ probe, start, viewerPort: 0 }));
    expect(start).not.toHaveBeenCalled();
    expect(result.owned).toBe(false);
    expect(result.apiUrl).toBe(`http://${HOST}:${HTTP_PORT}`);
    expect(result.viewerUrl).toBe("");
    await result.close();
    expect(close).not.toHaveBeenCalled();
  });

  it("sets viewerUrl only when the viewer probe also returns a version", async () => {
    const start = vi.fn();
    const both = vi.fn(async () => "1.26.2");
    const withViewer = await openLocalListener(baseInput({ probe: both, start }));
    expect(start).not.toHaveBeenCalled();
    expect(withViewer.apiUrl).toBe(`http://${HOST}:${HTTP_PORT}`);
    expect(withViewer.viewerUrl).toBe(`http://${HOST}:${VIEWER_PORT}`);
    expect(both).toHaveBeenCalledTimes(2);

    const apiOnly = vi.fn(async (url: string) => (url.endsWith(`:${HTTP_PORT}`) ? "1.26.2" : undefined));
    const withoutViewer = await openLocalListener(baseInput({ probe: apiOnly, start }));
    expect(withoutViewer.viewerUrl).toBe("");
    expect(start).not.toHaveBeenCalled();
  });

  it("brackets an unbracketed host that contains a colon", async () => {
    const start = vi.fn();
    const probe = vi.fn(async () => "1.0.0");
    const result = await openLocalListener(baseInput({ httpHost: "::1", probe, start, viewerPort: 0 }));
    expect(probe).toHaveBeenCalledWith("http://[::1]:18080");
    expect(result.apiUrl).toBe("http://[::1]:18080");
    const bracketed = vi.fn(async () => "1.0.0");
    const again = await openLocalListener(baseInput({ httpHost: "[::1]", probe: bracketed, start, viewerPort: 0 }));
    expect(bracketed).toHaveBeenCalledWith("http://[::1]:18080");
    expect(again.apiUrl).toBe("http://[::1]:18080");
  });

  it("returns an owned listener when the probe misses and start succeeds", async () => {
    const close = vi.fn(async () => undefined);
    const started = running(close);
    const start = vi.fn(async () => started);
    const probe = vi.fn(async () => undefined);
    const result = await openLocalListener(baseInput({ probe, start }));
    expect(result.owned).toBe(true);
    expect(result.apiUrl).toBe(started.apiUrl);
    expect(result.viewerUrl).toBe(started.viewerUrl);
    expect(result.close).toBe(close);
    expect(start).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledWith(expect.objectContaining({
      httpHost: HOST,
      httpPort: HTTP_PORT,
      viewerHost: HOST,
      viewerPort: VIEWER_PORT,
    }));
    await result.close();
    expect(close).toHaveBeenCalledOnce();
  });

  it("retries once on an ephemeral port when the default port is in use", async () => {
    const close = vi.fn(async () => undefined);
    const started = running(close);
    const start = vi.fn()
      .mockRejectedValueOnce(addrInUse())
      .mockResolvedValueOnce(started);
    const result = await openLocalListener(baseInput({ probe: async () => undefined, start, portPinned: false }));
    expect(result.owned).toBe(true);
    expect(result.close).toBe(close);
    expect(start).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenNthCalledWith(2, expect.objectContaining({ httpPort: 0, viewerPort: 0 }));
  });

  it("keeps a pinned viewer port when the HTTP port moves", async () => {
    const start = vi.fn()
      .mockRejectedValueOnce(addrInUse())
      .mockResolvedValueOnce(running());
    await openLocalListener(baseInput({
      probe: async () => undefined,
      start,
      portPinned: false,
      viewerPortPinned: true,
    }));
    expect(start).toHaveBeenNthCalledWith(2, expect.objectContaining({ httpPort: 0, viewerPort: VIEWER_PORT }));
  });

  it("rejects a pinned port without the raw Node listen message", async () => {
    const start = vi.fn().mockRejectedValueOnce(addrInUse());
    const error = await openLocalListener(baseInput({
      probe: async () => undefined,
      start,
      portPinned: true,
    })).catch((caught: unknown) => caught);
    expect(start).toHaveBeenCalledOnce();
    expect(error).toBeInstanceOf(ValidationError);
    const validation = error as ValidationError;
    expect(validation.message).not.toContain("EADDRINUSE");
    expect(validation.message).toContain(HOST);
    expect(validation.message).toContain(String(HTTP_PORT));
    expect(validation.message).toBe(
      `Campfire cannot listen on ${HOST}:${HTTP_PORT}. Another process is using that address.`,
    );
    expect(validation.details).toEqual({ field: "port", host: HOST, port: HTTP_PORT });
  });

  it("names the viewer port when a pinned viewer bind is in use", async () => {
    const start = vi.fn()
      .mockRejectedValueOnce(addrInUse())
      .mockRejectedValueOnce(addrInUse());
    const error = await openLocalListener(baseInput({
      probe: async () => undefined,
      start,
      viewerPortPinned: true,
    })).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ValidationError);
    const validation = error as ValidationError;
    expect(validation.message).not.toContain("EADDRINUSE");
    expect(validation.message).toContain(String(VIEWER_PORT));
    expect(validation.details).toEqual({ field: "viewer-port", host: HOST, port: VIEWER_PORT });
  });

  it("reports the original port when an unpinned retry is also in use", async () => {
    const other = new Error("sqlite locked");
    const start = vi.fn()
      .mockRejectedValueOnce(addrInUse())
      .mockRejectedValueOnce(addrInUse());
    const error = await openLocalListener(baseInput({ probe: async () => undefined, start })).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).details).toEqual({ field: "port", host: HOST, port: HTTP_PORT });
    expect((error as ValidationError).message).not.toContain("EADDRINUSE");

    const rethrow = vi.fn()
      .mockRejectedValueOnce(addrInUse())
      .mockRejectedValueOnce(other);
    await expect(openLocalListener(baseInput({ probe: async () => undefined, start: rethrow }))).rejects.toBe(other);
  });

  it("does not probe port 0 and rethrows errors that are not address conflicts", async () => {
    const boom = new Error("no runtime");
    const probe = vi.fn(async () => "1.0.0");
    const start = vi.fn().mockRejectedValueOnce(boom);
    await expect(openLocalListener(baseInput({ httpPort: 0, probe, start }))).rejects.toBe(boom);
    expect(probe).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledOnce();
  });
});
