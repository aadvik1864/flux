import { Global, Inject, Injectable, Module, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import nodemailer from "nodemailer";
import type { Prisma } from "@prisma/client";
import { env } from "./config";
import { Database } from "./database";
import { decryptMail, encryptMail } from "./mail-crypto";
import { mailFailure, mailRetryDelay } from "./mail-policy";

export async function queueMail(tx: Prisma.TransactionClient, to: string, subject: string, text: string, expiresAt: Date) {
  if (env.MAIL_MODE !== "smtp") return;
  await tx.emailMessage.create({ data: { payload: encryptMail({ to, subject, text }, env.MAIL_ENCRYPTION_KEY!), expiresAt } });
}

@Injectable()
export class MailWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private pending?: Promise<void>;
  private readonly transport = env.MAIL_MODE === "smtp" ? nodemailer.createTransport({
    host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE,
    // STARTTLS is mandatory outside isolated local/test mode. Certificate validation stays on.
    requireTLS: env.NODE_ENV === "production" && !env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
  }) : undefined;
  constructor(@Inject(Database) private readonly db: Database) {}

  onModuleInit() {
    if (!this.transport) return;
    this.timer = setInterval(() => { if (!this.pending) this.pending = this.deliver().finally(() => { this.pending = undefined; }); }, 3000);
    this.timer.unref();
  }
  async onModuleDestroy() { clearInterval(this.timer); await this.pending; this.transport?.close(); }

  private async quarantine(id: string, kind: string, attempts: number, erase = false) {
    await this.db.$transaction(async tx => {
      await tx.emailMessage.update({ where: { id }, data: { quarantinedAt: new Date(), acknowledgedAt: null, failureKind: kind, attempts, ...(erase ? { payload: null } : {}) } });
      await tx.securityEvent.create({ data: { type: "mail_quarantined", details: { messageId: id, kind, attempts } } });
    });
    const alert = { service: "flux-api", event: "mail_quarantined", messageId: id, kind, attempts };
    console.error(JSON.stringify(alert));
    if (env.MAIL_ALERT_WEBHOOK_URL) {
      try {
        const response = await fetch(env.MAIL_ALERT_WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(alert), signal: AbortSignal.timeout(5000), redirect: "error" });
        if (!response.ok) throw new Error("Alert rejected");
      } catch { console.error(JSON.stringify({ event: "mail_alert_failed", id })); }
    }
  }

  async deliver() {
    try {
      const now = new Date();
      const messages = await this.db.emailMessage.findMany({ where: { sentAt: null, quarantinedAt: null, payload: { not: null }, OR: [{ nextAttempt: { lte: now } }, { expiresAt: { lte: now } }, { expiresAt: null }] }, orderBy: { createdAt: "asc" }, take: 10 });
      for (const message of messages) {
        if (!message.expiresAt || message.expiresAt <= new Date()) {
          await this.quarantine(message.id, "link_expired", message.attempts, true);
          continue;
        }
        let contents: ReturnType<typeof decryptMail>;
        try { contents = decryptMail(message.payload!, env.MAIL_ENCRYPTION_KEY!); }
        catch { await this.quarantine(message.id, "payload_unreadable", message.attempts); continue; }
        try {
          await this.transport!.sendMail({ from: env.MAIL_FROM, ...contents, messageId: `<${message.id}@flux>` });
        } catch (error) {
          // Never log recipient addresses, credentials, or bearer links.
          const attempts = message.attempts + 1;
          const failure = mailFailure(error, attempts);
          if (failure.quarantine) await this.quarantine(message.id, failure.kind, attempts);
          else {
            console.error(JSON.stringify({ event: "mail_delivery_failed", id: message.id, attempts, kind: failure.kind }));
            await this.db.emailMessage.update({ where: { id: message.id }, data: { attempts, failureKind: failure.kind, nextAttempt: new Date(Date.now() + mailRetryDelay(attempts)) } });
          }
          continue;
        }
        await this.db.emailMessage.update({ where: { id: message.id }, data: { sentAt: new Date(), payload: null, failureKind: null } });
        console.log(JSON.stringify({ event: "mail_delivered", id: message.id }));
      }
    } catch { console.error(JSON.stringify({ event: "mail_queue_unavailable" })); }
  }
}

@Global()
@Module({ providers: [MailWorker], exports: [MailWorker] })
export class MailModule {}
