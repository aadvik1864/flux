import "reflect-metadata";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { env } from "./config";
import { opaqueToken, tokenHash } from "./security";
import { queueMail } from "./mail";
import nodemailer from "nodemailer";

const db = new PrismaClient();
async function main() {
  const [operation, address] = process.argv.slice(2);
  if (operation === "invite") {
    const email = z.email().max(254).parse(address).toLowerCase();
    const token = opaqueToken();
    await db.$transaction(async tx => {
      await tx.signupInvitation.create({ data: { email, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + 48 * 3600_000) } });
      await queueMail(tx, email, "Your Flux invitation", `Create your private Flux account:\n${env.APP_ORIGIN}/login?invitation=${token}\n\nUse the email address receiving this message. This invitation expires in 48 hours.`);
      await tx.securityEvent.create({ data: { type: "operator_signup_invitation_created" } });
    });
    // Operators get no raw bearer token in terminal/CI logs. SMTP delivers it.
    console.log("Invitation queued. It expires in 48 hours.");
  } else if (operation === "smtp-check") {
    const smtp = nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE, requireTLS: !env.SMTP_SECURE, auth: { user: env.SMTP_USER!, pass: env.SMTP_PASSWORD! }, connectionTimeout: 10_000, socketTimeout: 15_000 });
    try { await smtp.verify(); console.log("SMTP TLS/authentication check passed. Send a real invitation to verify delivery."); } finally { smtp.close(); }
  } else if (operation === "maintenance") {
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
  } else throw new Error("Usage: node dist/operations.js invite EMAIL | smtp-check | maintenance");
}
main().catch(() => { console.error("Operation failed. Check configuration and database connectivity."); process.exitCode = 1; }).finally(() => db.$disconnect());
