/**
 * CLI output-mode contract (CLI-001).
 *
 * Resolution order: explicit --output, explicit --json, CAMPFIRE_OUTPUT when
 * valid, then auto. auto renders text when stdout is a TTY and JSON otherwise.
 * TTY detection is presentation only: it never changes identity, authorization,
 * retrieved fields, or mutation semantics.
 *
 * Credential-bearing commands are the exception: under auto they stay human so
 * a pipe cannot silently capture a one-time token. The token receipt requires
 * an explicit --json or --output json on that invocation.
 */
import { ValidationError } from "../domain/errors.js";
import type { ParsedArgs } from "./args.js";
import {
  CLI_OUTPUT_MODES,
  commandSpecForArgs,
  isKnownCommand,
  type CliCommandSpec,
  type CliOutputMode,
} from "./catalog.js";

export type ResolvedOutput = "human" | "json";

interface OutputRequest {
  mode: CliOutputMode;
  source: "flag" | "env";
}

function isOutputMode(value: string): value is CliOutputMode {
  return (CLI_OUTPUT_MODES as readonly string[]).includes(value);
}

/**
 * The explicit output request, when one exists. Throws for an invalid or
 * internally conflicting request instead of guessing.
 */
function outputRequest(parsed: ParsedArgs): OutputRequest | undefined {
  const seen = parsed.occurrences.output ?? [];
  if (seen.some((value) => typeof value === "boolean")) {
    throw new ValidationError("--output requires a mode: auto|human|json", { field: "output" });
  }
  const values = seen.map(String);
  if (new Set(values).size > 1) {
    throw new ValidationError(`Conflicting --output values: ${values.join(", ")}`, {
      field: "output",
      values,
    });
  }
  const output = values.at(-1);
  if (output !== undefined) {
    if (!isOutputMode(output)) {
      throw new ValidationError(`Invalid --output mode: ${output}; expected auto|human|json`, {
        field: "output",
        value: output,
      });
    }
    if (parsed.flags.json === true && output === "human") {
      throw new ValidationError("Conflicting output modes: --output human with --json", {
        field: "output",
        value: "human",
      });
    }
    return { mode: output, source: "flag" };
  }
  if (parsed.flags.json === true) {
    return { mode: "json", source: "flag" };
  }
  const env = process.env.CAMPFIRE_OUTPUT?.trim();
  if (env !== undefined && env.length > 0 && isOutputMode(env)) {
    return { mode: env, source: "env" };
  }
  return undefined;
}

function isExplicitCredentialRequest(request: OutputRequest | undefined): boolean {
  // CAMPFIRE_OUTPUT is ambient configuration, not a per-invocation decision.
  return request !== undefined && request.source === "flag" && request.mode === "json";
}

export function resolveOutputMode(
  parsed: ParsedArgs,
  spec: CliCommandSpec,
  options?: { forError?: boolean },
): ResolvedOutput {
  const request = outputRequest(parsed);
  const explicit = request?.mode;
  if (spec.protocol) {
    return explicit === "json" ? "json" : "human";
  }
  if (spec.alwaysJson) {
    if (explicit === "human") {
      throw new ValidationError(
        `campfire ${spec.name} prints JSON only; --output human is not supported`,
        { field: "output", value: "human" },
      );
    }
    return "json";
  }
  if (
    !options?.forError &&
    spec.credentials &&
    !isExplicitCredentialRequest(request)
  ) {
    // A piped credential-bearing command must not leak tokens by default.
    return "human";
  }
  if (explicit !== undefined && explicit !== "auto") {
    return explicit;
  }
  return process.stdout.isTTY === true ? "human" : "json";
}

/** Explicit mode only, for commands outside the catalog (bare `campfire`). */
export function resolveExplicitOutput(parsed: ParsedArgs): CliOutputMode | undefined {
  return outputRequest(parsed)?.mode;
}

/** Best-effort explicit mode; never throws. Used when reporting pre-dispatch errors. */
function explicitRequest(parsed: ParsedArgs): ResolvedOutput | undefined {
  let request: OutputRequest | undefined;
  try {
    request = outputRequest(parsed);
  } catch {
    return parsed.flags.json === true ? "json" : undefined;
  }
  if (request?.mode === "human" || request?.mode === "json") {
    return request.mode;
  }
  return undefined;
}

/** Resolve the mode for the parsed command. Unknown commands fall back to human. */
export function resolveCommandOutput(parsed: ParsedArgs): ResolvedOutput {
  const command = parsed.command;
  if (command === undefined || !isKnownCommand(command)) {
    return explicitRequest(parsed) ?? "human";
  }
  return resolveOutputMode(parsed, commandSpecForArgs(command, parsed.flags));
}

/** Best-effort error mode: protocol commands stay human unless JSON was explicit. */
export function resolveErrorOutput(parsed: ParsedArgs): ResolvedOutput {
  try {
    const command = parsed.command;
    if (command !== undefined && isKnownCommand(command) && commandSpecForArgs(command, parsed.flags).protocol) {
      return explicitRequest(parsed) ?? "human";
    }
    if (command !== undefined && isKnownCommand(command)) {
      // Credential safety applies to success output; failures carry no token.
      return resolveOutputMode(parsed, commandSpecForArgs(command, parsed.flags), { forError: true });
    }
    return resolveCommandOutput(parsed);
  } catch {
    // An invalid or conflicting output request must not mask the real failure.
    return parsed.flags.json === true ? "json" : "human";
  }
}
