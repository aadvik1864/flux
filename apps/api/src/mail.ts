import { Global, Inject, Injectable, Module, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import nodemailer from "nodemailer";
import type { Prisma } from "@prisma/client";
import { env } from "./config";
import { Database } from "./database";
import { decryptMail, encryptMail } from "./mail-crypto";

export async function queueMail(tx: Prisma.TransactionClient, to: string, subject: string, text: string) {
  if (env.MAIL_MODE !== "smtp") return;
  await tx.emailMessage.create({ data: { payload: encryptMail({ to, subject, text }, env.MAIL_ENCRYPTION_KEY!) } });
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

  private async deliver() {
    try {
      const messages = await this.db.emailMessage.findMany({ where: { sentAt: null, payload: { not: null }, nextAttempt: { lte: new Date() } }, orderBy: { createdAt: "asc" }, take: 10 });
      for (const message of messages) {
        try {
          await this.transport!.sendMail({ from: env.MAIL_FROM, ...decryptMail(message.payload!, env.MAIL_ENCRYPTION_KEY!), messageId: `<${message.id}@flux>` });
          await this.db.emailMessage.update({ where: { id: message.id }, data: { sentAt: new Date(), payload: null } });
          console.log(JSON.stringify({ event: "mail_delivered", id: message.id }));
        } catch {
          // Never log recipient addresses, credentials, or bearer links.
          console.error(JSON.stringify({ event: "mail_delivery_failed", id: message.id, attempts: message.attempts + 1 }));
          await this.db.emailMessage.update({ where: { id: message.id }, data: { attempts: { increment: 1 }, nextAttempt: new Date(Date.now() + Math.min(3600, 2 ** Math.min(message.attempts + 1, 12)) * 1000) } });
        }
      }
    } catch { console.error(JSON.stringify({ event: "mail_queue_unavailable" })); }
  }
}

@Global()
@Module({ providers: [MailWorker], exports: [MailWorker] })
export class MailModule {}
