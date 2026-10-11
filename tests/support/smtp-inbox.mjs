// Test-only SMTP sink. It is never part of the production runtime images.
import { SMTPServer } from "smtp-server";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const messages = [];
const server = new SMTPServer({
  secure: true,
  key: readFileSync("/certs/key.pem"), cert: readFileSync("/certs/cert.pem"),
  authMethods: ["PLAIN", "LOGIN"], logger: false,
  onAuth(auth, _session, callback) { callback(auth.username === "smoke" && auth.password === "smoke-password" ? null : new Error("Invalid test credentials"), { user: "smoke" }); },
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
  else { response.writeHead(404); response.end("{}"); }
}).listen(8080, "0.0.0.0");
