import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import * as Y from "yjs";
import { contentFromYDoc } from "@flux/document-model";
import { digest } from "@flux/storage";

const state = JSON.parse(await readFile(process.argv[2], "utf8"));
const db = new PrismaClient();
try {
  for (const expected of [
    { fileId: state.fileId, generation: state.generation, contentHash: state.contentHash },
    { fileId: state.draftFileId, generation: state.draftGeneration, contentHash: state.draftContentHash },
  ]) {
    const file = await db.file.findUniqueOrThrow({ where: { id: expected.fileId }, include: { mainBranch: { include: { state: true } } } });
    assert.equal(file.mainBranch.generation, expected.generation + 1);
    assert.equal(file.mainBranch.state.generation, expected.generation + 1);
    const document = new Y.Doc();
    Y.applyUpdate(document, new Uint8Array(file.mainBranch.state.state));
    assert.equal(digest(JSON.stringify(contentFromYDoc(document))), expected.contentHash);
    document.destroy();
  }
  assert.equal(await db.session.count(), 0);
  assert.equal(await db.accountToken.count(), 0);
  assert.equal(await db.invitation.count(), 0);
  assert.equal(await db.emailMessage.count(), 0);
  assert.equal(await db.checkpoint.count(), state.checkpointCount);
  const bookmark = await db.decisionBookmark.findUniqueOrThrow({ where: { id: state.bookmarkId } });
  assert.equal(bookmark.status, "DECIDED"); assert.equal(bookmark.discussionMessageId, state.discussionId);
  const message = await db.discussionMessage.findUniqueOrThrow({ where: { id: state.discussionId } }); assert.equal(message.body, "Keep the main note and add the conclusion.");
  const branch = await db.branch.findUniqueOrThrow({ where: { id: state.branchId } }); assert.ok(branch.archivedAt); assert.ok(branch.generation > bookmark.anchorGeneration + 1);
  const approval = await db.mergeApproval.findUniqueOrThrow({ where: { id: state.pendingApprovalId } });
  assert.ok(approval.supersededAt); assert.equal(approval.resultContent, null); assert.equal(approval.byteLength, 0);
  console.log("Restored document hashes, merge checkpoints, discussion, and decisions verified; credentials/approvals revoked and generations fenced.");
} finally { await db.$disconnect(); }
