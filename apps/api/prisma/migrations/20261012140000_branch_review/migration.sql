ALTER TYPE "CheckpointKind" ADD VALUE 'BEFORE_MERGE';
ALTER TYPE "CheckpointKind" ADD VALUE 'MERGE';
ALTER TYPE "CheckpointKind" ADD VALUE 'MERGED_EXPERIMENT';
ALTER TYPE "ActivityKind" ADD VALUE 'BRANCH_CREATED';
ALTER TYPE "ActivityKind" ADD VALUE 'MERGE_APPROVED';
ALTER TYPE "ActivityKind" ADD VALUE 'BRANCH_MERGED';

ALTER TABLE "Branch"
  ADD COLUMN "baseCheckpointId" TEXT,
  ADD COLUMN "createdById" TEXT,
  ADD COLUMN "createdByName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "requestId" TEXT,
  ADD COLUMN "requestHash" TEXT;
CREATE UNIQUE INDEX "Branch_requestId_key" ON "Branch"("requestId");
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_baseCheckpointId_fkey"
  FOREIGN KEY ("baseCheckpointId") REFERENCES "Checkpoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "MergeApproval" (
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "approvedById" TEXT,
  "approvedByName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sourceHead" JSONB NOT NULL,
  "mainHead" JSONB NOT NULL,
  "baseChecksum" TEXT NOT NULL,
  "resultContent" JSONB,
  "byteLength" INTEGER NOT NULL DEFAULT 0,
  "supersededAt" TIMESTAMP(3),
  "resultHash" TEXT NOT NULL,
  "resolutions" JSONB NOT NULL,
  "requestId" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  CONSTRAINT "MergeApproval_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MergeApproval_requestId_key" ON "MergeApproval"("requestId");
CREATE INDEX "MergeApproval_branchId_supersededAt_idx" ON "MergeApproval"("branchId", "supersededAt");
ALTER TABLE "MergeApproval" ADD CONSTRAINT "MergeApproval_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MergeApproval" ADD CONSTRAINT "MergeApproval_approvedById_fkey"
  FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
