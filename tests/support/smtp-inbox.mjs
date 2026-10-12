// Test-only SMTP sink. It is never part of the production runtime images.
import { SMTPServer } from "smtp-server";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createSecureServer } from "node:https";

const messages = [];
const alerts = [];
const recipients = new Map();
const server = new SMTPServer({
  secure: true,
  key: readFileSync("/certs/key.pem"), cert: readFileSync("/certs/cert.pem"),
  authMethods: ["PLAIN", "LOGIN"], logger: false,
  onAuth(auth, _session, callback) { callback(auth.username === "smoke" && auth.password === "smoke-password" ? null : new Error("Invalid test credentials"), { user: "smoke" }); },
  onRcptTo(address, _session, callback) {
    const count = recipients.get(address.address) ?? 0; recipients.set(address.address, count + 1);
    if (count === 0 && ["permanent-failure@example.com", "temporary-failure@example.com"].includes(address.address)) {
      const error = new Error("Disposable test rejection"); error.responseCode = address.address.startsWith("permanent") ? 550 : 451;
      callback(error); return;
    }
    callback();
  },
  onData(stream, session, callback) {
    let raw = "";
    stream.on("data", bytes => { raw += bytes.toString("utf8"); });
    stream.on("end", () => { messages.push({ to: session.envelope.rcptTo.map(recipient => recipient.address), raw }); callback(); });
  },
});
server.listen(2525, "0.0.0.0");
createServer((request, response) => {
  response.setHeader("Content-Type", "application/json");
  if (request.url === "/messages") response.end(JSON.stringify(messages));
  else if (request.url === "/alerts") response.end(JSON.stringify(alerts));
  else { response.writeHead(404); response.end("{}"); }
}).listen(8080, "0.0.0.0");
createSecureServer({ key: readFileSync("/certs/key.pem"), cert: readFileSync("/certs/cert.pem") }, (request, response) => {
  if (request.url !== "/alerts" || request.method !== "POST") { response.writeHead(404); response.end(); return; }
  let body = "";
  request.on("data", bytes => { body += bytes.toString("utf8"); if (body.length > 65536) request.destroy(); });
  request.on("end", () => { try { alerts.push(JSON.parse(body)); response.writeHead(204); } catch { response.writeHead(400); } response.end(); });
}).listen(8443, "0.0.0.0");
