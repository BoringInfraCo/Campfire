/**
 * Authorization traces are for redirected logs. A terminal shows the
 * Campfire receipt, so a successful workspace list must not print JSON.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { CampfireStore } from "../../src/store/store.js";
import { createSimpleAuthorizer } from "../../src/service/simple-authorizer.js";

const actor = { actorId: "hum_test", actorType: "human" as const };

function store(): CampfireStore {
  return {
    getHuman: () => ({ id: actor.actorId }),
    getAgent: () => undefined,
  } as unknown as CampfireStore;
}

describe("simple authorizer traces", () => {
  const stderr = process.stderr;
  const chunks: string[] = [];
  let previousIsTTY: boolean | undefined;

  afterEach(() => {
    Object.defineProperty(process, "stderr", { value: stderr, configurable: true });
    Object.defineProperty(stderr, "isTTY", { value: previousIsTTY, configurable: true });
    chunks.length = 0;
  });

  function capture(isTTY: boolean): void {
    previousIsTTY = stderr.isTTY;
    const captured = {
      isTTY,
      write(chunk: string | Uint8Array): boolean {
        chunks.push(String(chunk));
        return true;
      },
    };
    Object.defineProperty(process, "stderr", { value: captured, configurable: true });
  }

  it("does not print an authorization trace on a terminal", () => {
    capture(true);
    createSimpleAuthorizer(store()).assertAllowed({ actor }, "workspace:list");
    expect(chunks).toEqual([]);
  });

  it("records the authorization trace when stderr is redirected", () => {
    capture(false);
    createSimpleAuthorizer(store()).assertAllowed({ actor }, "workspace:list");
    expect(chunks.join("")).toBe(
      `${JSON.stringify({ event: "authz", allow: true, actorId: "hum_test", operation: "workspace:list" })}\n`,
    );
  });

  it("does not print a denied authorization trace on a terminal", () => {
    capture(true);
    const empty = { getHuman: () => undefined, getAgent: () => undefined } as unknown as CampfireStore;
    expect(() => createSimpleAuthorizer(empty).assertAllowed({ actor }, "workspace:list")).toThrow(
      /Actor not found/,
    );
    expect(chunks).toEqual([]);
  });
});
