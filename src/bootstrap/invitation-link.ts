/** Private invitation link. The capability lives in the URL fragment, which HTTP clients do not send. */
import { ValidationError } from "../domain/errors.js";
import { canonicalEndpoint } from "./endpoint.js";

const JOIN_PATH = "/join";

export const INVITATION_LANDING_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<title>Campfire invitation</title>
</head>
<body>
<p>This page cannot see the private part of a Campfire invitation.</p>
<p>Paste the full link into the Campfire 1.26.2 candidate on this computer. The released 1.26.1 <code>campfire</code> command cannot accept it.</p>
<pre>campfire join --invitation-link '&lt;link&gt;'</pre>
<p>Keep the # in the link and do not type a backslash before it. Campfire shows the workspace and inviter before anything is joined. Accept or decline explicitly. Opening this page does not create a membership.</p>
</body>
</html>
`;

export interface ParsedInvitationLink {
  url: string;
  invitationId: string;
  secret: string;
}

function reject(message = "Invitation link is invalid. Paste the full link from the owner."): never {
  throw new ValidationError(message, { field: "invitation-link", nextAction: "paste_invitation_link" });
}

function payloadObject(value: unknown): value is { invitationId: string; secret: string } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes("invitationId") || !keys.includes("secret")) return false;
  const record = value as Record<string, unknown>;
  return typeof record.invitationId === "string" && typeof record.secret === "string";
}

export function formatInvitationLink(
  endpoint: string,
  invitation: { invitationId: string; secret: string },
  allowLoopback = false,
): string {
  const base = canonicalEndpoint(endpoint, { allowLoopbackHttp: allowLoopback });
  if (!/^ein_[A-Za-z0-9_.-]+$/.test(invitation.invitationId) || !/^cfe_[a-f0-9]{32}$/.test(invitation.secret)) {
    reject();
  }
  const encoded = Buffer.from(JSON.stringify({
    invitationId: invitation.invitationId,
    secret: invitation.secret,
  }), "utf8").toString("base64url");
  return `${base}${JOIN_PATH}#v1.${encoded}`;
}

export function parseInvitationLink(value: string, allowLoopback = false): ParsedInvitationLink {
  if (typeof value !== "string") reject();
  // A shell often escapes the fragment marker as \#. That slash is not part of the link.
  const normalized = value.replace(/\\#/g, "#");
  if (normalized.length === 0 || normalized.length > 4096 || normalized.trim() !== normalized || /[\s\u0000-\u001f\u007f]/.test(normalized)) {
    reject();
  }
  if (normalized.includes("?") || normalized.includes("\\")) reject();
  value = normalized;
  const hash = value.indexOf("#");
  if (hash <= 0 || value.indexOf("#", hash + 1) !== -1) reject();
  const before = value.slice(0, hash);
  const fragment = value.slice(hash + 1);
  let url: URL;
  try { url = new URL(before); } catch { return reject(); }
  if (url.username || url.password || url.search || !url.pathname.endsWith(JOIN_PATH)) reject();
  const prefix = url.pathname.slice(0, -JOIN_PATH.length);
  let endpoint: string;
  try { endpoint = canonicalEndpoint(`${url.origin}${prefix}`, { allowLoopbackHttp: allowLoopback }); }
  catch { return reject(); }
  const encoded = /^v1\.([A-Za-z0-9_-]+)$/.exec(fragment);
  if (encoded === null) reject();
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(encoded[1]!, "base64url").toString("utf8")); }
  catch { return reject(); }
  if (!payloadObject(parsed) || !/^ein_[A-Za-z0-9_.-]+$/.test(parsed.invitationId) || !/^cfe_[a-f0-9]{32}$/.test(parsed.secret)) {
    reject();
  }
  const again = formatInvitationLink(endpoint, parsed, allowLoopback);
  if (again !== value) reject();
  return { url: endpoint, invitationId: parsed.invitationId, secret: parsed.secret };
}

/** An invitation id or raw capability is not a workspace id. */
export function invitationCapabilityShape(value: string): "link" | "id" | undefined {
  if (value.includes("/join#") || value.includes("/join\\#") || value.includes("/campfire/join") || value.includes("#v1.") || value.includes("\\#v1.")) return "link";
  if (/^ein_[A-Za-z0-9_.-]+$/.test(value) || /^cfe_[a-f0-9]{32}$/.test(value)) return "id";
  return undefined;
}
