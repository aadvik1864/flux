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
  assert.equal(await db.checkpoint.count(), 1);
  console.log("Restored shared and recovered-draft documents/hashes/checkpoint verified; sessions revoked and generations fenced.");
} finally { await db.$disconnect(); }
