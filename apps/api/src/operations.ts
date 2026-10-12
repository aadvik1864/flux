import "reflect-metadata";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { env } from "./config";
import { opaqueToken, tokenHash } from "./security";
import { queueMail } from "./mail";
import nodemailer from "nodemailer";
import { manageQuarantinedMail } from "./mail-operations";

const db = new PrismaClient();
async function main() {
  const [operation, address, confirmation] = process.argv.slice(2);
  if (operation === "invite") {
    const email = z.email().max(254).parse(address).toLowerCase();
    const token = opaqueToken();
    const expiresAt = new Date(Date.now() + 48 * 3600_000);
    await db.$transaction(async tx => {
      await tx.signupInvitation.create({ data: { email, tokenHash: tokenHash(token), expiresAt } });
      await queueMail(tx, email, "Your Flux invitation", `Create your private Flux account:\n${env.APP_ORIGIN}/login?invitation=${token}\n\nUse the email address receiving this message. This invitation expires in 48 hours.`, expiresAt);
      await tx.securityEvent.create({ data: { type: "operator_signup_invitation_created" } });
    });
    // Operators get no raw bearer token in terminal/CI logs. SMTP delivers it.
    console.log("Invitation queued. It expires in 48 hours.");
  } else if (operation === "smtp-check") {
    const smtp = nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE, requireTLS: !env.SMTP_SECURE, auth: { user: env.SMTP_USER!, pass: env.SMTP_PASSWORD! }, connectionTimeout: 10_000, socketTimeout: 15_000 });
    try { await smtp.verify(); console.log("SMTP TLS/authentication check passed. Send a real invitation to verify delivery."); } finally { smtp.close(); }
  } else if (operation === "mail-status") {
    const [pending, quarantined] = await Promise.all([
      db.emailMessage.count({ where: { sentAt: null, quarantinedAt: null } }),
      db.emailMessage.findMany({ where: { sentAt: null, quarantinedAt: { not: null }, acknowledgedAt: null }, select: { id: true, failureKind: true, attempts: true, retryRequests: true, expiresAt: true, quarantinedAt: true }, orderBy: { quarantinedAt: "asc" }, take: 100 }),
    ]);
    console.log(JSON.stringify({ pending, quarantined }));
  } else if (operation === "mail-retry" || operation === "mail-acknowledge") {
    const id = z.string().regex(/^[a-z0-9]{20,40}$/).parse(address);
    if (confirmation !== (operation === "mail-retry" ? "--confirm-resend" : "--confirm-close")) throw new Error("Explicit confirmation is required");
    await manageQuarantinedMail(db, id, operation === "mail-retry" ? "retry" : "acknowledge");
    console.log(JSON.stringify({ event: operation === "mail-retry" ? "operator_mail_retry" : "operator_mail_acknowledged", id }));
  } else if (operation === "maintenance") {
    await db.emailMessage.updateMany({ where: { quarantinedAt: { not: null }, payload: { not: null }, OR: [{ expiresAt: { lte: new Date() } }, { expiresAt: null }] }, data: { payload: null } });
    const now = new Date();
    const old = new Date(Date.now() - 30 * 86400_000);
    const counts = await db.$transaction([
      db.session.deleteMany({ where: { expiresAt: { lt: now } } }),
      db.accountToken.deleteMany({ where: { expiresAt: { lt: now } } }),
      db.authThrottle.deleteMany({ where: { expiresAt: { lt: now } } }),
      db.signupInvitation.deleteMany({ where: { expiresAt: { lt: old } } }),
      db.emailMessage.deleteMany({ where: { createdAt: { lt: old } } }),
      db.securityEvent.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 90 * 86400_000) } } }),
    ]);
    console.log(JSON.stringify({ event: "maintenance_finished", removed: counts.map(result => result.count) }));
  } else throw new Error("Usage: node dist/operations.js invite EMAIL | smtp-check | maintenance | mail-status | mail-retry ID --confirm-resend | mail-acknowledge ID --confirm-close");
}
main().catch(() => { console.error("Operation failed. Check the message state, confirmation flag, configuration, and database connectivity. Expired links need a fresh request."); process.exitCode = 1; }).finally(() => db.$disconnect());
