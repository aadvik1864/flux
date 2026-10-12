import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout } from "node:timers/promises";
import { createRequire } from "node:module";
import { PrismaClient } from "@prisma/client";

const require = createRequire(import.meta.url);
const { decryptMail } = require("/app/apps/api/dist/mail-crypto.js");
const db = new PrismaClient();
const run = promisify(execFile);
const operation = (...args) => run(process.execPath, ["dist/operations.js", ...args]);
async function wait(check) {
  const end = Date.now() + 30_000;
  while (Date.now() < end) { const value = await check(); if (value) return value; await setTimeout(300); }
  throw new Error("Mail acceptance check timed out");
}
try {
  await operation("invite", "permanent-failure@example.com");
  const quarantined = await wait(async () => db.emailMessage.findFirst({ where: { failureKind: "smtp_rejected", quarantinedAt: { not: null } } }));
  assert.equal(quarantined.attempts, 1); assert.ok(quarantined.payload);
  assert.equal((await fetch("http://api:4000/ready")).status, 503);
  const { stdout } = await operation("mail-status");
  assert.ok(stdout.includes(quarantined.id)); assert.ok(!stdout.includes("@")); assert.ok(!stdout.includes(quarantined.payload));
  const alerts = await wait(async () => {
    const all = await (await fetch("http://inbox:8080/alerts")).json();
    return all.some(alert => alert.messageId === quarantined.id) ? all : null;
  });
  assert.ok(!JSON.stringify(alerts).includes("@")); assert.ok(!JSON.stringify(alerts).includes("invitation="));
  await assert.rejects(operation("mail-retry", quarantined.id));
  assert.equal((await db.emailMessage.findUniqueOrThrow({ where: { id: quarantined.id } })).retryRequests, 0);
  await operation("mail-retry", quarantined.id, "--confirm-resend");
  const delivered = await wait(async () => { const row = await db.emailMessage.findUniqueOrThrow({ where: { id: quarantined.id } }); return row.sentAt ? row : null; });
  assert.equal(delivered.payload, null); assert.equal(delivered.retryRequests, 1); assert.equal(delivered.quarantinedAt, null);
  assert.equal(await db.securityEvent.count({ where: { type: "operator_mail_retry", details: { path: ["messageId"], equals: quarantined.id } } }), 1);
  await operation("invite", "temporary-failure@example.com");
  const temporary = await wait(async () => db.emailMessage.findFirst({ where: { failureKind: "smtp_temporary", quarantinedAt: null } }));
  await wait(async () => (await db.emailMessage.findUniqueOrThrow({ where: { id: temporary.id } })).sentAt);
  const expired = await db.emailMessage.create({ data: { payload: quarantined.payload, expiresAt: new Date(0), nextAttempt: new Date(Date.now() + 3600_000) } });
  const closed = await wait(async () => { const row = await db.emailMessage.findUniqueOrThrow({ where: { id: expired.id } }); return row.quarantinedAt ? row : null; });
  assert.equal(closed.failureKind, "link_expired"); assert.equal(closed.payload, null);
  await assert.rejects(operation("mail-retry", closed.id, "--confirm-resend"));
  await operation("mail-acknowledge", closed.id, "--confirm-close");
  const legacy = await db.emailMessage.create({ data: { payload: quarantined.payload, nextAttempt: new Date(Date.now() + 3600_000) } });
  const legacyClosed = await wait(async () => { const row = await db.emailMessage.findUniqueOrThrow({ where: { id: legacy.id } }); return row.quarantinedAt ? row : null; });
  assert.equal(legacyClosed.failureKind, "link_expired"); assert.equal(legacyClosed.payload, null);
  await operation("mail-acknowledge", legacy.id, "--confirm-close");
  assert.equal((await fetch("http://api:4000/ready")).status, 200);
  const messages = await (await fetch("http://inbox:8080/messages")).json();
  assert.equal(messages.filter(message => message.to.includes("permanent-failure@example.com")).length, 1);
  assert.equal(messages.filter(message => message.to.includes("temporary-failure@example.com")).length, 1);
  // This is only a disposable fixture: ensure the outbox never exposed bearer data.
  assert.ok(decryptMail(quarantined.payload, process.env.MAIL_ENCRYPTION_KEY).text.includes("invitation="));
  console.log("Mail acceptance passed: permanent quarantine, redacted HTTPS alerts, explicit bounded resend, temporary retry, expiry erasure, and readiness recovery.");
} finally { await db.$disconnect(); }
