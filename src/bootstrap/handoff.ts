/**
 * Non-secret human handoff.
 *
 * The Viewer URL must be loopback. Bearer tokens are not arguments and are
 * not fields of the receipt.
 */
import { ValidationError } from "../domain/errors.js";
import type { DoctorReport } from "./doctor.js";

export interface HandoffReceipt {
  version: string;
  workspaceName: string;
  workspaceId: string;
  goalTitle: string;
  humanName: string;
  agentName: string;
  readiness: "ready";
  viewerUrl: string;
  reloadOrApproval: true;
  nextAction: "open_viewer_url";
}

export function assertLoopbackViewerUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ValidationError("Viewer URL must be an http loopback address", { field: "viewer-url" });
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (url.protocol !== "http:" || (host !== "127.0.0.1" && host !== "localhost" && host !== "::1")) {
    throw new ValidationError("Viewer URL must stay on loopback", { field: "viewer-url" });
  }
  return url.toString();
}

export function buildHandoff(input: {
  version: string;
  workspaceName: string;
  workspaceId: string;
  goalTitle: string;
  humanName: string;
  agentName: string;
  viewerUrl: string;
  doctor: DoctorReport;
}): HandoffReceipt {
  if (!input.doctor.ready) {
    throw new ValidationError(`Setup is not ready: ${input.doctor.nextAction}`, {
      field: "handoff",
      nextAction: input.doctor.nextAction,
    });
  }
  return {
    version: input.version,
    workspaceName: input.workspaceName,
    workspaceId: input.workspaceId,
    goalTitle: input.goalTitle,
    humanName: input.humanName,
    agentName: input.agentName,
    readiness: "ready",
    viewerUrl: assertLoopbackViewerUrl(input.viewerUrl),
    reloadOrApproval: true,
    nextAction: "open_viewer_url",
  };
}

export function formatHandoff(receipt: HandoffReceipt): string {
  return [
    `Campfire ${receipt.version}`,
    `Workspace: ${receipt.workspaceName} (${receipt.workspaceId})`,
    `Goal: ${receipt.goalTitle}`,
    `Human: ${receipt.humanName}`,
    `Agent: ${receipt.agentName}`,
    `Readiness: ${receipt.readiness}`,
    `Viewer: ${receipt.viewerUrl}`,
    "A harness reload or approval may still be required before MCP tools appear.",
    "Next: open the Viewer URL. It is read-only and does not receive a token.",
    "",
  ].join("\n");
}
