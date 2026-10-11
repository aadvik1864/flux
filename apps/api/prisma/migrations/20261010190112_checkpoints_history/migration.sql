-- CreateEnum
CREATE TYPE "CheckpointKind" AS ENUM ('MANUAL', 'BEFORE_RESTORE', 'RESTORE');

-- CreateEnum
CREATE TYPE "ActivityKind" AS ENUM ('CHECKPOINT_CREATED', 'DOCUMENT_RESTORED');

-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "checkpointNumber" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "generation" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "DocumentState" ADD COLUMN     "generation" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Checkpoint" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "CheckpointKind" NOT NULL DEFAULT 'MANUAL',
    "generation" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "objectKey" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "byteLength" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL,
    "requestId" TEXT,
    "requestHash" TEXT,
    "sourceCheckpointId" TEXT,
    "preservedCheckpointId" TEXT,

    CONSTRAINT "Checkpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "fileId" TEXT,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "type" "ActivityKind" NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Checkpoint_objectKey_key" ON "Checkpoint"("objectKey");

-- CreateIndex
CREATE UNIQUE INDEX "Checkpoint_requestId_key" ON "Checkpoint"("requestId");

-- CreateIndex
CREATE INDEX "Checkpoint_fileId_createdAt_idx" ON "Checkpoint"("fileId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Checkpoint_branchId_number_key" ON "Checkpoint"("branchId", "number");

-- CreateIndex
CREATE INDEX "ActivityEvent_workspaceId_createdAt_idx" ON "ActivityEvent"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityEvent_fileId_createdAt_idx" ON "ActivityEvent"("fileId", "createdAt");

-- AddForeignKey
ALTER TABLE "Checkpoint" ADD CONSTRAINT "Checkpoint_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Checkpoint" ADD CONSTRAINT "Checkpoint_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Checkpoint" ADD CONSTRAINT "Checkpoint_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Checkpoint" ADD CONSTRAINT "Checkpoint_sourceCheckpointId_fkey" FOREIGN KEY ("sourceCheckpointId") REFERENCES "Checkpoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Checkpoint" ADD CONSTRAINT "Checkpoint_preservedCheckpointId_fkey" FOREIGN KEY ("preservedCheckpointId") REFERENCES "Checkpoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
