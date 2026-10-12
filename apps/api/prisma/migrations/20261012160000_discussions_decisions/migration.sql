ALTER TYPE "ActivityKind" ADD VALUE 'DECISION_CREATED';
ALTER TYPE "ActivityKind" ADD VALUE 'DECISION_STATUS_CHANGED';
ALTER TYPE "ActivityKind" ADD VALUE 'DISCUSSION_MESSAGE_REMOVED';
ALTER TABLE "Branch" ADD COLUMN "discussionSequence" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "discussionBytes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "decisionSequence" INTEGER NOT NULL DEFAULT 0;
CREATE TYPE "DecisionStatus" AS ENUM ('OPEN', 'DECIDED', 'SUPERSEDED');
CREATE TABLE "DiscussionMessage" (
  "id" TEXT NOT NULL, "branchId" TEXT NOT NULL, "number" INTEGER NOT NULL,
  "authorId" TEXT, "authorName" TEXT NOT NULL, "body" TEXT NOT NULL,
  "byteLength" INTEGER NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3), "requestId" TEXT NOT NULL, "requestHash" TEXT NOT NULL,
  CONSTRAINT "DiscussionMessage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DiscussionMessage_requestId_key" ON "DiscussionMessage"("requestId");
CREATE UNIQUE INDEX "DiscussionMessage_branchId_number_key" ON "DiscussionMessage"("branchId", "number");
ALTER TABLE "DiscussionMessage" ADD CONSTRAINT "DiscussionMessage_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscussionMessage" ADD CONSTRAINT "DiscussionMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE TABLE "DecisionBookmark" (
  "id" TEXT NOT NULL, "branchId" TEXT NOT NULL, "number" INTEGER NOT NULL,
  "title" TEXT NOT NULL, "explanation" TEXT NOT NULL,
  "status" "DecisionStatus" NOT NULL DEFAULT 'OPEN', "createdById" TEXT,
  "createdByName" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "checkpointId" TEXT NOT NULL, "blockId" TEXT NOT NULL, "anchorGeneration" INTEGER NOT NULL,
  "anchorIdentity" TEXT NOT NULL, "unavailableAt" TIMESTAMP(3), "discussionMessageId" TEXT,
  "requestId" TEXT NOT NULL, "requestHash" TEXT NOT NULL,
  CONSTRAINT "DecisionBookmark_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DecisionBookmark_requestId_key" ON "DecisionBookmark"("requestId");
CREATE UNIQUE INDEX "DecisionBookmark_branchId_number_key" ON "DecisionBookmark"("branchId", "number");
CREATE INDEX "DecisionBookmark_checkpointId_idx" ON "DecisionBookmark"("checkpointId");
ALTER TABLE "DecisionBookmark" ADD CONSTRAINT "DecisionBookmark_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DecisionBookmark" ADD CONSTRAINT "DecisionBookmark_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DecisionBookmark" ADD CONSTRAINT "DecisionBookmark_checkpointId_fkey" FOREIGN KEY ("checkpointId") REFERENCES "Checkpoint"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "DecisionBookmark" ADD CONSTRAINT "DecisionBookmark_discussionMessageId_fkey" FOREIGN KEY ("discussionMessageId") REFERENCES "DiscussionMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- Still protect referenced checkpoints, but allow a whole workspace's cascades
-- to finish before checking references within that same deleted workspace.
ALTER TABLE "Branch" DROP CONSTRAINT "Branch_baseCheckpointId_fkey";
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_baseCheckpointId_fkey" FOREIGN KEY ("baseCheckpointId") REFERENCES "Checkpoint"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
