import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { mailFailure, mailRetryDelay } from "../../apps/api/src/mail-policy";
import { manageQuarantinedMail } from "../../apps/api/src/mail-operations";

describe("mail failure policy", () => {
  it("quarantines permanent SMTP errors without retrying them indefinitely", () => {
    expect(mailFailure({ responseCode: 550 }, 1)).toEqual({ quarantine: true, kind: "smtp_rejected" });
    expect(mailFailure({ code: "EAUTH" }, 1)).toEqual({ quarantine: true, kind: "smtp_auth" });
    expect(mailFailure({ responseCode: 451 }, 1).quarantine).toBe(false);
    expect(mailFailure({ code: "ETIMEDOUT" }, 12)).toEqual({ quarantine: true, kind: "retry_exhausted" });
    expect(mailRetryDelay(1)).toBe(2000); expect(mailRetryDelay(100)).toBe(3600_000);
  });
  function database(overrides: Record<string, unknown> = {}) {
    const row = { id: "message", sentAt: null, quarantinedAt: new Date(), acknowledgedAt: null, payload: "encrypted", expiresAt: new Date(Date.now() + 60_000), failureKind: "smtp_rejected", attempts: 1, retryRequests: 0, ...overrides };
    const tx = { $queryRaw: vi.fn(async () => []), emailMessage: { findUnique: vi.fn(async () => row), update: vi.fn(async () => row) }, securityEvent: { create: vi.fn() } };
    const db = { $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)) } as unknown as PrismaClient;
    return { db, tx };
  }
  it("requeues an eligible quarantined message under a lock and records the resend", async () => {
    const { db, tx } = database();
    await manageQuarantinedMail(db, "message", "retry");
    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(tx.emailMessage.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ quarantinedAt: null, retryRequests: { increment: 1 } }) }));
    expect(tx.securityEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: "operator_mail_retry" }) }));
  });
  it.each([{ expiresAt: new Date(0) }, { payload: null }, { failureKind: "payload_unreadable" }, { retryRequests: 3 }, { quarantinedAt: null }, { sentAt: new Date() }])("refuses unsafe or unbounded resends", async overrides => {
    const { db, tx } = database(overrides);
    await expect(manageQuarantinedMail(db, "message", "retry")).rejects.toThrow();
    expect(tx.emailMessage.update).not.toHaveBeenCalled();
  });
  it("acknowledges and erases a failed payload without resending it", async () => {
    const { db, tx } = database();
    await manageQuarantinedMail(db, "message", "acknowledge");
    expect(tx.emailMessage.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ payload: null, acknowledgedAt: expect.any(Date) }) }));
    expect(tx.securityEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: "operator_mail_acknowledged" }) }));
  });
});
