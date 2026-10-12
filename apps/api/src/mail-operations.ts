import { Prisma, type PrismaClient } from "@prisma/client";
import { MAX_MAIL_RESENDS } from "./mail-policy";

export async function manageQuarantinedMail(db: PrismaClient, id: string, action: "retry" | "acknowledge", now = new Date()) {
  return db.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "EmailMessage" WHERE "id" = ${id} FOR UPDATE`);
    const message = await tx.emailMessage.findUnique({ where: { id } });
    if (!message || message.sentAt || !message.quarantinedAt) throw new Error("This message is not quarantined");
    if (action === "retry") {
      if (!message.payload || !message.expiresAt || message.expiresAt <= now || message.failureKind === "payload_unreadable") throw new Error("Queue a fresh invitation or recovery link instead");
      if (message.retryRequests >= MAX_MAIL_RESENDS) throw new Error("Manual resend limit reached; queue a fresh link instead");
      await tx.emailMessage.update({ where: { id }, data: { quarantinedAt: null, acknowledgedAt: null, failureKind: null, attempts: 0, retryRequests: { increment: 1 }, nextAttempt: now } });
    } else {
      if (message.acknowledgedAt) return;
      // An acknowledged failure is closed, not silently put back into delivery.
      await tx.emailMessage.update({ where: { id }, data: { acknowledgedAt: now, payload: null } });
    }
    await tx.securityEvent.create({ data: { type: action === "retry" ? "operator_mail_retry" : "operator_mail_acknowledged", details: { messageId: id, previousFailure: message.failureKind, resendNumber: message.retryRequests + (action === "retry" ? 1 : 0) } } });
  });
}
