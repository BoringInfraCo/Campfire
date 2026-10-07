import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { hostname, tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildTelemetryEvent,
  isTelemetryEventName,
  isTelemetryInstallationId,
  normalizeTelemetryArch,
  normalizeTelemetryOs,
  parseTelemetryEventV1,
  serializeTelemetryEvent,
  TELEMETRY_EVENTS,
  TELEMETRY_FIELDS,
  TELEMETRY_MAX_PAYLOAD_BYTES,
  TELEMETRY_SCHEMA_VERSION,
  type TelemetryEventV1,
} from "../../src/telemetry/contract.js";
import {
  claimActivation,
  claimActiveEvent,
  claimInstallCompleted,
  ensureInstallationId,
  loadTelemetryState,
  resolveTelemetryPreference,
  setTelemetryEnabled,
  TELEMETRY_ENV_VAR,
  TELEMETRY_STATE_VERSION,
  telemetryStatePath,
  utcDay,
} from "../../src/telemetry/state.js";
import { postTelemetryEvent, TELEMETRY_TIMEOUT_MS } from "../../src/telemetry/post.js";
import {
  DEFAULT_TELEMETRY_ENDPOINT,
  reportActivated,
  reportActive,
  reportInstallCompleted,
  reportTelemetryEvent,
  resolveTelemetryTarget,
  TELEMETRY_ENDPOINT_ENV_VAR,
  telemetryInBackground,
} from "../../src/telemetry/report.js";

/**
 * TEL-001 unit + transport coverage (sprint section 18).
 *
 * Three guarantees are defended here:
 *
 *   1. The event contract is closed. `serializeTelemetryEvent` copies named
 *      fields only, so a field that is not in the allow-list cannot leave the
 *      machine, and the server refuses an undocumented key rather than dropping
 *      it (section 17: "server accepts only documented events/fields").
 *   2. Local identity and preference are deterministic: a random installation
 *      UUID that survives upgrades, an env-over-stored-over-default precedence
 *      order, and one-shot activation claims (section 10, section 12).
 *   3. Transport is total. Every failure mode resolves to `{ ok: false }` and
 *      never rejects, because a dead endpoint cannot be allowed to fail an
 *      install or a command (section 13, section 17).
 */

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Two fixed, obviously synthetic installation ids. Neither is a real person. */
const ID_A = "11111111-2222-4333-8444-555555555555";
const ID_B = "99999999-8888-4777-8666-555555555555";

const DAY_ONE = new Date("2026-03-01T09:00:00.000Z");
const DAY_ONE_LATER = new Date("2026-03-01T23:59:59.000Z");
const DAY_TWO = new Date("2026-03-02T00:00:01.000Z");

let dir: string;
let env: NodeJS.ProcessEnv;

function profileEnv(root: string, name: string): NodeJS.ProcessEnv {
  const base = join(root, name);
  return {
    CAMPFIRE_CONFIG_DIR: join(base, "config"),
    CAMPFIRE_DATA_DIR: join(base, "data"),
  };
}

function stateFile(target: NodeJS.ProcessEnv = env): string {
  return telemetryStatePath(target);
}

function readState(target: NodeJS.ProcessEnv = env): Record<string, unknown> {
  const path = stateFile(target);
  if (!existsSync(path)) throw new Error(`expected telemetry state at ${path}`);
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function writeState(contents: string, target: NodeJS.ProcessEnv = env): string {
  const path = stateFile(target);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, contents);
  return path;
}

interface CapturedCall {
  url: string;
  init: RequestInit | undefined;
}

/** A `fetch` stand-in that records what the telemetry client actually sent. */
function stubFetch(
  respond: (url: string, init?: RequestInit) => Response | Promise<Response>,
): { fetchImpl: typeof fetch; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return respond(url, init);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function jsonOk(): Response {
  return new Response(JSON.stringify({ ok: true, result: { recorded: true } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "campfire-tel-001-"));
  env = profileEnv(dir, "primary");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("telemetry event contract", () => {
  it("emits exactly the allow-listed keys and no others", () => {
    const full = buildTelemetryEvent({
      event: "active",
      installationId: ID_A,
      campfireVersion: "1.9.1",
      os: "darwin",
      arch: "arm64",
      installMethod: "curl",
      surface: "cli",
    });
    expect(JSON.parse(serializeTelemetryEvent(full))).toEqual({
      schemaVersion: 1,
      event: "active",
      installationId: ID_A,
      campfireVersion: "1.9.1",
      os: "darwin",
      arch: "arm64",
      installMethod: "curl",
      surface: "cli",
    });
    expect(Object.keys(JSON.parse(serializeTelemetryEvent(full)) as object).sort()).toEqual(
      [...TELEMETRY_FIELDS].sort(),
    );
  });

  it("omits optional dimensions that do not apply instead of sending them empty", () => {
    const requested = serializeTelemetryEvent(
      buildTelemetryEvent({ event: "install_requested", installMethod: "curl" }),
    );
    const payload = JSON.parse(requested) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(
      ["arch", "campfireVersion", "event", "installationId", "installMethod", "os", "schemaVersion"].sort(),
    );
    // No surface, and no installation id: an installer fetch is anonymous.
    expect(payload.surface).toBeUndefined();
    expect(payload.installationId).toBe("");
  });

  it("drops an unexpected extra property on the input instead of forwarding it", () => {
    const hostile = {
      event: "activated",
      installationId: ID_A,
      campfireVersion: "1.9.1",
      os: "linux",
      arch: "x64",
      workspaceName: "example-repo",
      prompt: "please review the diff",
      token: "REDACTED",
      campfireVersionRaw: "not-a-field",
    } as unknown as TelemetryEventV1;
    const payload = JSON.parse(serializeTelemetryEvent(hostile)) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual([...TELEMETRY_FIELDS].filter((field) => field !== "installMethod" && field !== "surface").sort());
    for (const leak of ["workspaceName", "prompt", "token", "example-repo", "REDACTED"]) {
      expect(serializeTelemetryEvent(hostile)).not.toContain(leak);
    }
  });

  it("normalizes os and arch to the documented vocabulary", () => {
    expect(normalizeTelemetryOs("darwin")).toBe("darwin");
    expect(normalizeTelemetryOs("linux")).toBe("linux");
    expect(normalizeTelemetryOs("win32")).toBe("win32");
    for (const garbage of ["freebsd", "", "DARWIN", "linux ", "../../etc"]) {
      expect(normalizeTelemetryOs(garbage)).toBe("unknown");
    }
    expect(normalizeTelemetryArch("aarch64")).toBe("arm64");
    expect(normalizeTelemetryArch("arm64")).toBe("arm64");
    expect(normalizeTelemetryArch("amd64")).toBe("x64");
    expect(normalizeTelemetryArch("x64")).toBe("x64");
    for (const garbage of ["riscv64", "", "AMD64", "arm"]) {
      expect(normalizeTelemetryArch(garbage)).toBe("unknown");
    }
  });

  it("normalizes a garbage platform on the built event rather than sending it raw", () => {
    const event = buildTelemetryEvent({
      event: "install_completed",
      installationId: ID_A,
      campfireVersion: "1.9.1",
      os: "sunos5",
      arch: "mips",
    });
    expect(event.os).toBe("unknown");
    expect(event.arch).toBe("unknown");
  });

  it("bounds an over-long version string so a broken client cannot inflate a dimension", () => {
    const event = buildTelemetryEvent({
      event: "install_completed",
      installationId: ID_A,
      campfireVersion: "v".repeat(10_000),
    });
    expect(event.campfireVersion).toHaveLength(32);
  });

  it("drops an install method or surface outside the closed vocabulary", () => {
    const event = buildTelemetryEvent({
      event: "active",
      installationId: ID_A,
      installMethod: "homebrew",
      surface: "vscode",
    });
    expect(event.installMethod).toBeUndefined();
    expect(event.surface).toBeUndefined();
  });

  it("blanks an installation id that is not the documented UUID shape", () => {
    const event = buildTelemetryEvent({ event: "activated", installationId: "user@example.invalid" });
    expect(event.installationId).toBe("");
    expect(isTelemetryInstallationId(ID_A)).toBe(true);
    expect(isTelemetryInstallationId("not-a-uuid")).toBe(false);
  });

  it("recognises only the four documented event names", () => {
    expect([...TELEMETRY_EVENTS].sort()).toEqual(["activated", "active", "install_completed", "install_requested"]);
    for (const name of TELEMETRY_EVENTS) expect(isTelemetryEventName(name)).toBe(true);
    for (const name of ["session_replay", "", "Activated", 7]) {
      expect(isTelemetryEventName(name)).toBe(false);
    }
  });
});

describe("parseTelemetryEventV1", () => {
  function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      schemaVersion: TELEMETRY_SCHEMA_VERSION,
      event: "activated",
      installationId: ID_A,
      campfireVersion: "1.9.1",
      os: "darwin",
      arch: "arm64",
      surface: "cli",
      ...overrides,
    };
  }

  it("accepts a valid v1 event and re-normalizes its dimensions", () => {
    const parsed = parseTelemetryEventV1(valid({ os: "sunos", arch: "amd64", campfireVersion: "v".repeat(500) }));
    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok) throw new Error("expected acceptance");
    expect(parsed.event.os).toBe("unknown");
    expect(parsed.event.arch).toBe("x64");
    expect(parsed.event.campfireVersion).toHaveLength(32);
    expect(parsed.event.surface).toBe("cli");
  });

  it("rejects a payload carrying an undocumented field so nothing can be smuggled through", () => {
    const parsed = parseTelemetryEventV1(valid({ workspaceName: "example-repo" }));
    expect(parsed).toEqual({ ok: false, reason: "unknown_field" });
  });

  it("rejects a body that is not a plain object, including arrays", () => {
    for (const raw of ["[]", [valid()], "nope", 7, null, true]) {
      expect(parseTelemetryEventV1(raw)).toEqual({ ok: false, reason: "not_an_object" });
    }
  });

  it("rejects a payload declaring another schema version", () => {
    for (const version of [0, 2, "1", null, undefined]) {
      expect(parseTelemetryEventV1(valid({ schemaVersion: version })).ok).toBe(false);
    }
  });

  it("rejects an event outside the closed vocabulary", () => {
    const parsed = parseTelemetryEventV1(valid({ event: "session_replay" }));
    expect(parsed).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects a non-uuid installation id on an identified event", () => {
    for (const id of ["", "user@example.invalid", "11111111-2222-4333-8444-55555555555", 42, undefined]) {
      expect(parseTelemetryEventV1(valid({ installationId: id })).ok).toBe(false);
    }
  });

  it("rejects an install_requested that carries an installation id", () => {
    const parsed = parseTelemetryEventV1(
      valid({ event: "install_requested", installationId: ID_A, surface: undefined }),
    );
    expect(parsed).toEqual({ ok: false, reason: "invalid" });
  });

  it("accepts an install_requested with no installation id at all", () => {
    const anonymous = { schemaVersion: 1, event: "install_requested", campfireVersion: "1.9.1", os: "unknown", arch: "unknown", installMethod: "curl" };
    const parsed = parseTelemetryEventV1(anonymous);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("expected acceptance");
    expect(parsed.event.installationId).toBe("");
  });
});

describe("telemetry preference precedence", () => {
  it("treats every documented off spelling as disabled, case- and whitespace-insensitively", () => {
    for (const value of ["0", "off", "false", "no", "OFF", " False ", "NO"]) {
      expect(resolveTelemetryPreference({ ...env, [TELEMETRY_ENV_VAR]: value }), value).toEqual({
        enabled: false,
        source: "env",
      });
    }
  });

  it("treats every documented on spelling as enabled from the environment", () => {
    for (const value of ["1", "on", "true", "yes", "ON", " True "]) {
      expect(resolveTelemetryPreference({ ...env, [TELEMETRY_ENV_VAR]: value }), value).toEqual({
        enabled: true,
        source: "env",
      });
    }
  });

  it("defaults to enabled with no state file and no override", () => {
    expect(resolveTelemetryPreference(env)).toEqual({ enabled: true, source: "default" });
  });

  it("lets the environment override a stored preference in both directions", () => {
    setTelemetryEnabled(true, env);
    expect(resolveTelemetryPreference(env)).toEqual({ enabled: true, source: "preference" });
    expect(resolveTelemetryPreference({ ...env, [TELEMETRY_ENV_VAR]: "0" })).toEqual({
      enabled: false,
      source: "env",
    });

    setTelemetryEnabled(false, env);
    expect(resolveTelemetryPreference(env)).toEqual({ enabled: false, source: "preference" });
    expect(resolveTelemetryPreference({ ...env, [TELEMETRY_ENV_VAR]: "1" })).toEqual({
      enabled: true,
      source: "env",
    });
  });

  it("falls through an unrecognised or blank override instead of silently disabling telemetry", () => {
    setTelemetryEnabled(false, env);
    for (const value of ["maybe", "off-ish", "2", "", "   "]) {
      expect(resolveTelemetryPreference({ ...env, [TELEMETRY_ENV_VAR]: value }), value).toEqual({
        enabled: false,
        source: "preference",
      });
    }
    const fresh = profileEnv(dir, "blank");
    expect(resolveTelemetryPreference({ ...fresh, [TELEMETRY_ENV_VAR]: "perhaps" })).toEqual({
      enabled: true,
      source: "default",
    });
  });

  it("round-trips enable then disable through the stored preference", () => {
    const enabledState = setTelemetryEnabled(true, env);
    expect(enabledState.enabled).toBe(true);
    expect(enabledState.version).toBe(TELEMETRY_STATE_VERSION);
    expect(readState().enabled).toBe(true);

    const disabledState = setTelemetryEnabled(false, env);
    expect(disabledState.enabled).toBe(false);
    expect(readState().enabled).toBe(false);
    expect(resolveTelemetryPreference(env).enabled).toBe(false);

    // The identity is a side effect of writing the preference and must survive it.
    expect(disabledState.installationId).toBe(enabledState.installationId);
    expect(loadTelemetryState(env)?.installationId).toBe(enabledState.installationId);
  });
});

describe("anonymous installation identity", () => {
  it("gives a fresh install a random uuidv4-shaped id and persists it", () => {
    const id = ensureInstallationId(env);
    expect(id).toMatch(UUID_V4);
    expect(isTelemetryInstallationId(id)).toBe(true);
    expect(readState()).toMatchObject({ version: 1, installationId: id });
    expect(statSync(stateFile()).mode & 0o777).toBe(0o644);
  });

  it("is stable across repeated ensureInstallationId calls", () => {
    const first = ensureInstallationId(env);
    expect(ensureInstallationId(env)).toBe(first);
    expect(ensureInstallationId(env)).toBe(first);
  });

  it("survives an ordinary upgrade that leaves the state file intact", () => {
    const before = ensureInstallationId(env);
    // An upgrade is a second run against the same config directory: the state
    // file is read, not replaced.
    const after = ensureInstallationId(env);
    expect(after).toBe(before);
    expect(readState().installationId).toBe(before);
  });

  it("mints a different id after a genuinely clean installation", () => {
    const before = ensureInstallationId(env);
    rmSync(stateFile());
    const after = ensureInstallationId(env);
    expect(after).toMatch(UUID_V4);
    expect(after).not.toBe(before);
  });

  it("derives nothing from the user or the machine", () => {
    const id = ensureInstallationId(env);
    const text = readFileSync(stateFile(), "utf8");
    expect(text).not.toContain(hostname());
    expect(text).not.toContain(userInfo().username);
    expect(text).not.toContain(userInfo().uid.toString());
    expect(text).not.toContain(env.CAMPFIRE_DATA_DIR!);
    expect(text).not.toContain(env.CAMPFIRE_CONFIG_DIR!);
    // The only machine-specific value is the random id itself.
    expect(text).toContain(id);
  });

  it("produces an unrelated id in an independent profile directory", () => {
    const other = profileEnv(dir, "secondary");
    const first = ensureInstallationId(env);
    const second = ensureInstallationId(other);
    expect(second).toMatch(UUID_V4);
    expect(second).not.toBe(first);
    expect(readState(other).installationId).toBe(second);
    expect(readState().installationId).toBe(first);
  });

  it("treats a corrupt state file as absent instead of blocking Campfire", () => {
    for (const garbage of ["{not json", "", "[]", JSON.stringify({ version: 1 }), JSON.stringify({ installationId: "user@example.invalid" })]) {
      rmSync(stateFile(), { force: true });
      writeState(garbage);
      expect(loadTelemetryState(env), garbage).toBeUndefined();
      const id = ensureInstallationId(env);
      expect(id, garbage).toMatch(UUID_V4);
      expect(readState().installationId, garbage).toBe(id);
      expect(resolveTelemetryPreference(env)).toEqual({ enabled: true, source: "default" });
    }
  });
});

describe("activation and activity claims", () => {
  it("claims activation exactly once per installation", () => {
    const first = claimActivation(env, DAY_ONE);
    expect(first).toMatch(UUID_V4);
    expect(claimActivation(env, DAY_ONE_LATER)).toBe("");
    expect(claimActivation(env, DAY_TWO)).toBe("");
    expect(readState().activatedOn).toBe(utcDay(DAY_ONE));
  });

  it("claims one active event per utc day", () => {
    const first = claimActiveEvent(env, DAY_ONE);
    expect(first).toMatch(UUID_V4);
    expect(claimActiveEvent(env, DAY_ONE_LATER)).toBe("");
    expect(readState().lastActiveOn).toBe("2026-03-01");
    const second = claimActiveEvent(env, DAY_TWO);
    expect(second).toBe(first);
    expect(readState().lastActiveOn).toBe("2026-03-02");
  });

  it("keys the return window on utc days, not local days", () => {
    expect(utcDay(DAY_ONE)).toBe("2026-03-01");
    expect(utcDay(new Date("2026-03-01T23:59:59.999Z"))).toBe("2026-03-01");
    expect(utcDay(new Date("2026-03-02T00:00:00.000Z"))).toBe("2026-03-02");
    expect(utcDay()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("keeps activation and activity claims independent of each other", () => {
    claimActiveEvent(env, DAY_ONE);
    expect(readState().activatedOn).toBeUndefined();
    expect(claimActivation(env, DAY_ONE)).toMatch(UUID_V4);
    expect(claimActiveEvent(env, DAY_ONE)).toBe("");
  });

  it("claims install_completed exactly once per installation", () => {
    expect(claimInstallCompleted(env)).toMatch(UUID_V4);
    expect(claimInstallCompleted(env)).toBe("");
    expect(readState().installCompletedReported).toBe(true);
  });
});

describe("telemetry transport", () => {
  it("keeps the timeout short enough to be invisible to a command", () => {
    expect(TELEMETRY_TIMEOUT_MS).toBeGreaterThan(0);
    expect(TELEMETRY_TIMEOUT_MS).toBeLessThanOrEqual(5_000);
  });

  it("posts json with redirects refused and an abort signal", async () => {
    const { fetchImpl, calls } = stubFetch(() => jsonOk());
    const result = await postTelemetryEvent({
      endpoint: "https://example.invalid/v1/telemetry",
      event: "activated",
      installationId: ID_A,
      campfireVersion: "1.9.1",
      os: "darwin",
      arch: "arm64",
      surface: "cli",
      fetchImpl,
    });
    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe("https://example.invalid/v1/telemetry");
    expect(call.init?.method).toBe("POST");
    expect(call.init?.redirect).toBe("manual");
    expect((call.init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(call.init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(call.init?.body))).toEqual({
      schemaVersion: 1,
      event: "activated",
      installationId: ID_A,
      campfireVersion: "1.9.1",
      os: "darwin",
      arch: "arm64",
      surface: "cli",
    });
  });

  it("accepts any 2xx as delivered", async () => {
    for (const status of [200, 201, 202, 204]) {
      const { fetchImpl } = stubFetch(() => new Response(null, { status }));
      expect(await postTelemetryEvent({ endpoint: "https://example.invalid/v1/telemetry", event: "active", fetchImpl })).toEqual({ ok: true });
    }
  });

  it("reports a 4xx or 5xx as an undelivered event without throwing", async () => {
    for (const status of [400, 401, 404, 413, 429, 500, 502, 503]) {
      const { fetchImpl } = stubFetch(() => new Response("nope", { status }));
      expect(await postTelemetryEvent({ endpoint: "https://example.invalid/v1/telemetry", event: "active", fetchImpl })).toEqual({
        ok: false,
        error: `HTTP ${status}`,
      });
    }
  });

  it("refuses a redirect instead of moving the payload to an unvetted host", async () => {
    for (const status of [301, 302, 307, 308]) {
      const { fetchImpl, calls } = stubFetch(
        () => new Response(null, { status, headers: { location: "https://elsewhere.invalid/collect" } }),
      );
      const result = await postTelemetryEvent({ endpoint: "https://example.invalid/v1/telemetry", event: "active", fetchImpl });
      expect(result, String(status)).toEqual({ ok: false, error: "redirect refused" });
      expect(calls).toHaveLength(1);
    }

    // An opaque cross-origin response surfaces as status 0 and is refused too.
    const opaque = stubFetch(() => ({ status: 0, body: null }) as unknown as Response);
    expect(
      await postTelemetryEvent({ endpoint: "https://example.invalid/v1/telemetry", event: "active", fetchImpl: opaque.fetchImpl }),
    ).toEqual({ ok: false, error: "redirect refused" });
  });

  it("absorbs a thrown network error and reports it without rejecting", async () => {
    const { fetchImpl } = stubFetch(() => {
      throw new TypeError("fetch failed: getaddrinfo ENOTFOUND telemetry.invalid");
    });
    await expect(
      postTelemetryEvent({ endpoint: "https://telemetry.invalid/v1/telemetry", event: "active", fetchImpl }),
    ).resolves.toEqual({ ok: false, error: "fetch failed: getaddrinfo ENOTFOUND telemetry.invalid" });
  });

  it("collapses an abort or timeout error to a bounded diagnostic", async () => {
    for (const name of ["AbortError", "TimeoutError"]) {
      const { fetchImpl } = stubFetch(() => {
        const error = new Error("The operation was aborted");
        error.name = name;
        throw error;
      });
      await expect(
        postTelemetryEvent({ endpoint: "https://example.invalid/v1/telemetry", event: "active", fetchImpl }),
      ).resolves.toEqual({ ok: false, error: "timeout" });
    }
  });

  it("keeps the endpoint origin and drops the path and query from a diagnostic", async () => {
    const { fetchImpl } = stubFetch(() => {
      throw new Error("request to https://telemetry.invalid/v1/telemetry/collect?tenant=secret failed");
    });
    const result = await postTelemetryEvent({
      endpoint: "https://telemetry.invalid/v1/telemetry",
      event: "active",
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("request to https://telemetry.invalid failed");
    expect(result.error).not.toContain("secret");
    expect(result.error!.length).toBeLessThanOrEqual(120);
  });

  it("does not care about a malformed or non-json response body", async () => {
    const bodies = ["", "<html>not json</html>", "{broken", "null"];
    for (const body of bodies) {
      const accepted = stubFetch(
        () => new Response(body, { status: 200, headers: { "content-type": "text/html" } }),
      );
      await expect(
        postTelemetryEvent({ endpoint: "https://example.invalid/v1/telemetry", event: "active", fetchImpl: accepted.fetchImpl }),
      ).resolves.toEqual({ ok: true });

      const rejected = stubFetch(() => new Response(body, { status: 500 }));
      await expect(
        postTelemetryEvent({ endpoint: "https://example.invalid/v1/telemetry", event: "active", fetchImpl: rejected.fetchImpl }),
      ).resolves.toEqual({ ok: false, error: "HTTP 500" });
    }
  });

  it("never rejects, whatever the transport does", async () => {
    const behaviours: Array<() => Response | Promise<Response>> = [
      () => jsonOk(),
      () => new Response("boom", { status: 500 }),
      () => {
        throw new Error("socket hang up");
      },
      // A rejected promise from a hostile stub, not just a synchronous throw.
      () => Promise.reject(new Error("connection reset")),
    ];
    for (const behave of behaviours) {
      const { fetchImpl } = stubFetch(behave);
      const settled = await postTelemetryEvent({
        endpoint: "https://example.invalid/v1/telemetry",
        event: "active",
        installationId: ID_A,
        fetchImpl,
      }).then(
        (value) => ({ resolved: value }),
        (error: unknown) => ({ rejected: String(error) }),
      );
      expect(settled).toHaveProperty("resolved");
    }
  });

  it("bounds the serialized body well under the ingestion ceiling", async () => {
    const { fetchImpl, calls } = stubFetch(() => jsonOk());
    await postTelemetryEvent({
      endpoint: "https://example.invalid/v1/telemetry",
      event: "active",
      installationId: ID_A,
      campfireVersion: "v".repeat(10_000),
      fetchImpl,
    });
    const body = String(calls[0]!.init?.body);
    expect(new TextEncoder().encode(body).length).toBeLessThan(TELEMETRY_MAX_PAYLOAD_BYTES);
  });
});

describe("telemetry reporting entry points", () => {
  const loopback = "http://127.0.0.1:9/v1/telemetry";

  it("resolves a target from the documented endpoint and the local installation id", () => {
    const target = resolveTelemetryTarget({ env: { ...env, [TELEMETRY_ENDPOINT_ENV_VAR]: loopback } });
    expect(target).toBeDefined();
    expect(target?.endpoint).toBe(loopback);
    expect(target?.installationId).toBe(ensureInstallationId(env));
    expect(target?.campfireVersion).toBeTruthy();
    expect(target?.os).toBe(process.platform);
  });

  it("falls back to the documented production endpoint when none is configured", () => {
    expect(resolveTelemetryTarget({ env })).toMatchObject({ endpoint: DEFAULT_TELEMETRY_ENDPOINT });
  });

  it("sends nothing when telemetry is disabled, and writes no state", async () => {
    const { fetchImpl, calls } = stubFetch(() => jsonOk());
    const disabled = { ...env, [TELEMETRY_ENV_VAR]: "0" };
    await reportActivated("cli", { env: disabled, fetchImpl });
    await reportActive("cli", { env: disabled, fetchImpl });
    await reportInstallCompleted({ env: disabled, fetchImpl });
    expect(calls).toHaveLength(0);
    expect(existsSync(stateFile())).toBe(false);
    expect(await reportTelemetryEvent("activated", { surface: "cli" }, { env: disabled, fetchImpl })).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("sends nothing when the configured endpoint fails validation", async () => {
    const { fetchImpl, calls } = stubFetch(() => jsonOk());
    for (const bad of ["not a url", "http://telemetry.example.invalid/v1/telemetry", "https://example.invalid/v1/telemetry?token=secret"]) {
      const broken = { ...env, [TELEMETRY_ENDPOINT_ENV_VAR]: bad };
      expect(resolveTelemetryTarget({ env: broken }), bad).toBeUndefined();
      await reportActivated("cli", { env: broken, fetchImpl });
      await reportActive("cli", { env: broken, fetchImpl });
      await reportInstallCompleted({ env: broken, fetchImpl });
    }
    expect(calls).toHaveLength(0);
  });

  it("sends exactly one activated for a first meaningful use", async () => {
    const { fetchImpl, calls } = stubFetch(() => jsonOk());
    const options = { env: { ...env, [TELEMETRY_ENDPOINT_ENV_VAR]: loopback }, fetchImpl, now: DAY_ONE };
    await reportActivated("cli", options);
    await reportActivated("cli", options);
    await reportActivated("mcp", { ...options, now: DAY_TWO });

    const events = calls.map((call) => (JSON.parse(String(call.init?.body)) as { event: string }).event);
    expect(events).toEqual(["activated"]);
    const payload = JSON.parse(String(calls[0]!.init?.body)) as Record<string, unknown>;
    expect(payload).toMatchObject({ event: "activated", surface: "cli", installationId: ensureInstallationId(env) });
    expect(payload.os).toBe(process.platform);
  });

  it("sends one active per utc day and stays silent afterwards", async () => {
    const { fetchImpl, calls } = stubFetch(() => jsonOk());
    const base = { env: { ...env, [TELEMETRY_ENDPOINT_ENV_VAR]: loopback }, fetchImpl };
    for (let i = 0; i < 20; i += 1) await reportActive("cli", { ...base, now: DAY_ONE });
    await reportActive("mcp", { ...base, now: DAY_ONE_LATER });
    await reportActive("agent", { ...base, now: DAY_TWO });

    const events = calls.map((call) => (JSON.parse(String(call.init?.body)) as { event: string }).event);
    expect(events).toEqual(["active", "active"]);
    expect(JSON.parse(String(calls[1]!.init?.body))).toMatchObject({ surface: "agent" });
  });

  it("sends one install_completed with the curl install method", async () => {
    const { fetchImpl, calls } = stubFetch(() => jsonOk());
    const options = { env: { ...env, [TELEMETRY_ENDPOINT_ENV_VAR]: loopback }, fetchImpl };
    await reportInstallCompleted(options);
    await reportInstallCompleted(options);

    expect(calls).toHaveLength(1);
    const payload = JSON.parse(String(calls[0]!.init?.body)) as Record<string, unknown>;
    expect(payload).toMatchObject({ event: "install_completed", installMethod: "curl" });
    expect(payload.surface).toBeUndefined();
  });

  it("records the activation claim even when delivery fails", async () => {
    const { fetchImpl, calls } = stubFetch(() => {
      throw new Error("socket hang up");
    });
    await reportActivated("cli", { env: { ...env, [TELEMETRY_ENDPOINT_ENV_VAR]: loopback }, fetchImpl, now: DAY_ONE });
    expect(calls).toHaveLength(1);
    expect(readState().activatedOn).toBe("2026-03-01");
    // Activation is a statement about the installation, not about the network.
    await reportActivated("cli", { env: { ...env, [TELEMETRY_ENDPOINT_ENV_VAR]: loopback }, fetchImpl, now: DAY_ONE });
    expect(calls).toHaveLength(1);
  });

  it("never lets a background report surface as a rejection", async () => {
    expect(telemetryInBackground(Promise.reject(new Error("unreachable")))).toBeUndefined();
    expect(telemetryInBackground(Promise.resolve("done"))).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Even a synchronously throwing report stays contained.
    telemetryInBackground(
      (async () => {
        throw new Error("measurement exploded");
      })(),
    );
    await expect(new Promise((resolve) => setTimeout(resolve, 0))).resolves.toBeUndefined();
  });
});
