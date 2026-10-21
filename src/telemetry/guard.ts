/**
 * Server-side telemetry idempotency guard (telemetry integrity).
 *
 * The client already bounds `activated` (once per installation) and `active`
 * (once per installation per UTC day) locally, and `install_completed` is
 * claimed at most once per installation. Local bookkeeping stops honest
 * replays; it does nothing against a prober replaying payloads with fresh
 * installation ids or re-sending the same id. This guard is the server-side
 * half: single-use install tokens plus idempotency claims in D1.
 *
 * Privacy shape: the tables store only SHA-256 hex digests — of the token,
 * of the installation id, of the id-plus-day — never a raw id or token, and
 * no address. A digest cannot be turned back into an installation, and the
 * guard never reads one. The ops dataset likewise records only the outcome,
 * the reason, and the event name.
 *
 * Every method fails open. A D1 error returns `"error"` and the caller treats
 * it as "no information": measurement must never become a new way for a
 * Campfire operation to fail, and a guard outage must not be able to silence
 * telemetry for everyone.
 */

/** Minimal D1 surface the guard uses. Structural so tests can adapt SQLite. */
export interface GuardD1Database {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
      run(): Promise<{ success: boolean; meta?: { changes?: number } }>;
    };
  };
}

export type InstallCompletion = "accepted" | "duplicate" | "invalid_token" | "error";
export type IdempotencyClaim = "claimed" | "duplicate" | "no_install" | "error";

export interface TelemetryGuard {
  /** Store the digest of a freshly issued single-use install token. Idempotent. */
  issueInstallToken(input: { token: string; issuedAt: string; expiresAt: string }): Promise<"issued" | "error">;
  /**
   * Consume one single-use token and claim the installation, atomically in
   * that order: the token UPDATE runs first so a replayed token finds nothing
   * to consume, then the claim INSERT makes a replayed installation id a
   * duplicate rather than a second count.
   */
  completeInstall(input: {
    installationId: string;
    installToken?: string;
    now: string;
  }): Promise<InstallCompletion>;
  /** Claim the one activation for an installation that completed install. */
  claimActivation(input: { installationId: string }): Promise<IdempotencyClaim>;
  /**
   * Claim an install without touching any token: the package-manager
   * bootstrap path (`brew`/`nix`). Homebrew/Nix users never fetch the
   * installer, so they hold no single-use token; this INSERTs the install
   * claim directly (`INSERT OR IGNORE` semantics via `insertClaim`) and never
   * reads, writes, or consumes the token table.
   */
  claimInstallDirect(input: { installationId: string; now: string }): Promise<"claimed" | "duplicate" | "error">;
  /** Claim one active day (`YYYY-MM-DD` UTC) for an installed installation. */
  claimActive(input: { installationId: string; date: string }): Promise<IdempotencyClaim>;
}

/** SHA-256 hex of a value. The only form in which ids/tokens touch storage. */
export async function telemetryClaimHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** UTC calendar day for an `active` claim key. Deterministic across zones. */
export function activeClaimDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

const INSTALL_KIND = "install";
const ACTIVATION_KIND = "activation";
const ACTIVE_KIND = "active";

function installClaimKey(digest: string): string {
  return `install:${digest}`;
}

function activationClaimKey(digest: string): string {
  return `activation:${digest}`;
}

function activeClaimKey(digest: string, date: string): string {
  return `active:${date}:${digest}`;
}

export function createD1TelemetryGuard(db: GuardD1Database): TelemetryGuard {
  /** Best-effort expiry sweep. Failures are swallowed: pruning is hygiene. */
  async function pruneExpired(now: string): Promise<void> {
    try {
      await db.prepare("DELETE FROM telemetry_install_tokens WHERE expires_at <= ?").bind(now).run();
    } catch {
      // Opportunistic only; a failed sweep must not change any verdict.
    }
  }

  async function hasClaim(kind: string, claimKey: string): Promise<boolean> {
    const row = await db
      .prepare("SELECT 1 AS present FROM telemetry_claims WHERE kind = ? AND claim_key = ?")
      .bind(kind, claimKey)
      .first<{ present: number }>();
    return row !== null;
  }

  /** INSERT the claim; a conflicting row reads back as a duplicate. */
  async function insertClaim(kind: string, claimKey: string, now: string): Promise<"claimed" | "duplicate" | "error"> {
    try {
      await db
        .prepare("INSERT INTO telemetry_claims (kind, claim_key, claimed_at) VALUES (?, ?, ?)")
        .bind(kind, claimKey, now)
        .run();
      return "claimed";
    } catch {
      try {
        return (await hasClaim(kind, claimKey)) ? "duplicate" : "error";
      } catch {
        return "error";
      }
    }
  }

  return {
    async issueInstallToken(input): Promise<"issued" | "error"> {
      try {
        const tokenHash = await telemetryClaimHash(input.token);
        await db
          .prepare(
            "INSERT OR IGNORE INTO telemetry_install_tokens (token_hash, issued_at, expires_at, consumed_at) VALUES (?, ?, ?, NULL)",
          )
          .bind(tokenHash, input.issuedAt, input.expiresAt)
          .run();
        return "issued";
      } catch {
        return "error";
      }
    },

    async completeInstall(input): Promise<InstallCompletion> {
      try {
        await pruneExpired(input.now);
        if (input.installToken === undefined || input.installToken.length === 0) {
          // No token rides the payload: either the install predates token
          // issuance or the script was fetched outside the measured routes.
          return "invalid_token";
        }
        const tokenHash = await telemetryClaimHash(input.installToken);
        const consumed = await db
          .prepare(
            "UPDATE telemetry_install_tokens SET consumed_at = ? WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?",
          )
          .bind(input.now, tokenHash, input.now)
          .run();
        if ((consumed.meta?.changes ?? 0) !== 1) return "invalid_token";
        const digest = await telemetryClaimHash(input.installationId);
        const inserted = await insertClaim(INSTALL_KIND, installClaimKey(digest), input.now);
        if (inserted === "claimed") return "accepted";
        if (inserted === "duplicate") return "duplicate";
        return "error";
      } catch {
        return "error";
      }
    },

    async claimInstallDirect(input): Promise<"claimed" | "duplicate" | "error"> {
      try {
        const digest = await telemetryClaimHash(input.installationId);
        return insertClaim(INSTALL_KIND, installClaimKey(digest), input.now);
      } catch {
        return "error";
      }
    },

    async claimActivation(input): Promise<IdempotencyClaim> {
      try {
        const digest = await telemetryClaimHash(input.installationId);
        if (!(await hasClaim(INSTALL_KIND, installClaimKey(digest)))) return "no_install";
        return insertClaim(ACTIVATION_KIND, activationClaimKey(digest), new Date().toISOString());
      } catch {
        return "error";
      }
    },

    async claimActive(input): Promise<IdempotencyClaim> {
      try {
        const digest = await telemetryClaimHash(input.installationId);
        if (!(await hasClaim(INSTALL_KIND, installClaimKey(digest)))) return "no_install";
        return insertClaim(ACTIVE_KIND, activeClaimKey(digest, input.date), new Date().toISOString());
      } catch {
        return "error";
      }
    },
  };
}
