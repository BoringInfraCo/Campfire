/**
 * Out-of-process webhook receiver for the Sprint 019 trace.
 *
 * Prints one JSON line per request. The first line is the listening port.
 * FAIL_FIRST=1 answers 500 to the first POST and 204 after that.
 * The signing secret is used only to validate. It is not printed.
 */
import { createHmac } from "node:crypto";
import { createServer } from "node:http";

const secret = process.env.CAMPFIRE_WEBHOOK_SECRET ?? "";
const failFirst = process.env.FAIL_FIRST === "1";
let seen = 0;

const server = createServer((req, res) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");
    const timestamp = String(req.headers["x-campfire-timestamp"] ?? "");
    const signature = String(req.headers["x-campfire-signature"] ?? "");
    const expected = `v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
    seen += 1;
    const status = failFirst && seen === 1 ? 500 : 204;
    process.stdout.write(
      `${JSON.stringify({
        eventId: String(req.headers["x-campfire-event-id"] ?? ""),
        eventType: String(req.headers["x-campfire-event-type"] ?? ""),
        valid: signature === expected,
        status,
        body,
      })}\n`,
    );
    res.writeHead(status);
    res.end();
  });
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  process.stdout.write(`${JSON.stringify({ listening: port })}\n`);
});
