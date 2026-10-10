/**
 * The telemetry version floor.
 *
 * Telemetry shipped whole-clique in v1.9.1: the client library, the event
 * contract, and the ingestion route were all added in that release. A binary
 * whose version reads below the floor therefore contains no telemetry code and
 * cannot emit a schema-v1 event by any route, which makes a sub-floor payload
 * provably fabricated rather than merely suspicious.
 *
 * This exists because production carried several hundred `install_completed`
 * rows per day under a distinct installation id each, bearing version 1.2.0,
 * with no downstream event and no relationship to any real usage. It is a
 * server-side, stateless check, so it costs nothing to keep running and cannot
 * be evaded by rotating source addresses.
 */
import { describe, expect, it } from "vitest";
import {
  isTelemetryVersionBelowFloor,
  TELEMETRY_MIN_REPORTING_VERSION,
} from "../../src/telemetry/contract.js";

describe("telemetry version floor", () => {
  it("declares the release that introduced telemetry as the floor", () => {
    expect(TELEMETRY_MIN_REPORTING_VERSION).toBe("1.9.1");
  });

  it("rejects the version that polluted production", () => {
    expect(isTelemetryVersionBelowFloor("1.2.0")).toBe(true);
  });

  it("rejects every version below the floor across all three components", () => {
    for (const version of ["0.9.9", "1.0.0", "1.2.0", "1.8.9", "1.9.0"]) {
      expect(isTelemetryVersionBelowFloor(version)).toBe(true);
    }
  });

  it("allows the floor itself and everything above it", () => {
    for (const version of ["1.9.1", "1.9.2", "1.9.3", "1.10.0", "1.11.0", "1.12.0", "1.13.0", "2.0.0"]) {
      expect(isTelemetryVersionBelowFloor(version)).toBe(false);
    }
  });

  it("compares components numerically rather than lexically", () => {
    // The trap: as text, "1.10.0" < "1.9.1" because "1" < "9" at index 2.
    // v1.10.0 is newer than the floor and must be allowed through.
    expect("1.10.0" < "1.9.1").toBe(true);
    expect(isTelemetryVersionBelowFloor("1.10.0")).toBe(false);
    // Same trap in reverse: v1.9.10 is above the floor despite sorting low as text.
    expect(isTelemetryVersionBelowFloor("1.9.10")).toBe(false);
  });

  it("allows a version that does not parse rather than guessing", () => {
    // Absence of proof is not proof of forgery. The client resolves its version
    // by reading package.json and falls back to "unknown" when that read fails,
    // so an unparseable value is a real possibility for an honest installation.
    for (const version of ["unknown", "", "dev", "1.9", "v1.9.1", "1.9.1-rc.1+build", "next"]) {
      expect(isTelemetryVersionBelowFloor(version)).toBe(false);
    }
  });

  it("tolerates surrounding whitespace", () => {
    expect(isTelemetryVersionBelowFloor("  1.2.0  ")).toBe(true);
    expect(isTelemetryVersionBelowFloor("  1.12.0 ")).toBe(false);
  });
});