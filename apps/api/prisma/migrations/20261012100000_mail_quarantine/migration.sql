ALTER TABLE "EmailMessage"
  ADD COLUMN "expiresAt" TIMESTAMP(3),
  ADD COLUMN "quarantinedAt" TIMESTAMP(3),
  ADD COLUMN "acknowledgedAt" TIMESTAMP(3),
  ADD COLUMN "failureKind" TEXT,
  ADD COLUMN "retryRequests" INTEGER NOT NULL DEFAULT 0;

DROP INDEX "EmailMessage_sentAt_nextAttempt_idx";
CREATE INDEX "EmailMessage_sentAt_quarantinedAt_nextAttempt_idx"
  ON "EmailMessage"("sentAt", "quarantinedAt", "nextAttempt");

ALTER TABLE "SecurityEvent" ADD COLUMN "details" JSONB;
