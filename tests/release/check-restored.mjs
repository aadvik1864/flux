import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import * as Y from "yjs";
import { contentFromYDoc } from "@flux/document-model";
import { digest } from "@flux/storage";

const state = JSON.parse(await readFile(process.argv[2], "utf8"));
const db = new PrismaClient();
try {
  const file = await db.file.findUniqueOrThrow({ where: { id: state.fileId }, include: { mainBranch: { include: { state: true } } } });
  assert.equal(file.mainBranch.generation, state.generation + 1);
  assert.equal(file.mainBranch.state.generation, state.generation + 1);
  const document = new Y.Doc();
  Y.applyUpdate(document, new Uint8Array(file.mainBranch.state.state));
  assert.equal(digest(JSON.stringify(contentFromYDoc(document))), state.contentHash);
  document.destroy();
  assert.equal(await db.session.count(), 0);
  assert.equal(await db.accountToken.count(), 0);
  assert.equal(await db.invitation.count(), 0);
  assert.equal(await db.emailMessage.count(), 0);
  assert.equal(await db.checkpoint.count(), 1);
  console.log("Restored document/hash/checkpoint verified; sessions revoked and generation fenced.");
} finally { await db.$disconnect(); }
