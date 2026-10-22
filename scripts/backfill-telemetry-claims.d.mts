/**
 * Type declarations for `scripts/backfill-telemetry-claims.mjs` (node, no
 * deps). Kept beside the script so unit tests can import the hashing/SQL
 * generation with types; the CLI entry itself is guarded by an
 * `import.meta.url` check and never runs on import.
 */
export function isInstallationId(value: unknown): boolean;
export function hashInstallationId(installationId: string): string;
export function claimKeyForInstallationId(installationId: string): string;
export function backfillStatementFor(claimKey: string, claimedAt: string): string;
export function buildBackfillStatements(ids: unknown[], claimedAt: string): string[];
export function wranglerExecuteInvocation(options: {
  database: string;
  local: boolean;
  sqlFile: string;
}): string;
export interface BackfillOptions {
  ids: string[];
  fromJson: string | undefined;
  claimedAt: string | undefined;
  database: string;
  local: boolean;
  executeSql: boolean;
  help: boolean;
}
export function parseArgs(argv: string[]): BackfillOptions;
