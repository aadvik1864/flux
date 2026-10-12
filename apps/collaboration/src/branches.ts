import { randomUUID } from "node:crypto";
import { Prisma, type Branch, type MergeApproval, type PrismaClient } from "@prisma/client";
import type { Document, Hocuspocus } from "@hocuspocus/server";
import * as Y from "yjs";
import { z } from "zod";
import { branchRoom, can, type ExperimentSummary, type HistoryHead, type MergeApprovalSummary, type MergePreview, type MergeResult, type DocumentContent } from "@flux/shared";
import { DOCUMENT_SCHEMA_VERSION, analyzeMerge, resolveMerge, contentFromYDoc, prepareContentUpdate, validateDocument, yDocFromContent } from "@flux/document-model";
import { digest, encodeSnapshot, type SnapshotStorage, type SnapshotPayload } from "@flux/storage";
import { checkpointSummary, HistoryError, requireAccess, type RoomState } from "./history.js";
import { RoomGate } from "./room-gate.js";

export const reviewedHeadSchema = z.object({ generation: z.number().int().nonnegative(), revision: z.number().int().nonnegative(), contentHash: z.string().regex(/^[a-f0-9]{64}$/) });
export const branchCommandSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("fork"), fileId: z.string().min(1).max(100), checkpointId: z.uuid(), name: z.string().trim().min(1).max(60).refine(name => !/^main$/i.test(name)), requestId: z.uuid() }),
  z.object({ operation: z.literal("compare"), fileId: z.string().min(1).max(100), branchId: z.string().min(1).max(100) }),
  z.object({ operation: z.literal("approve"), fileId: z.string().min(1).max(100), branchId: z.string().min(1).max(100), requestId: z.uuid(),
    sourceHead: reviewedHeadSchema, mainHead: reviewedHeadSchema,
    resolutions: z.record(z.string().min(1).max(100), z.enum(["main", "experiment", "delete"])).refine(value => Object.keys(value).length <= 1000), order: z.array(z.string().min(1).max(100)).max(1000).optional() }),
  z.object({ operation: z.literal("merge"), fileId: z.string().min(1).max(100), branchId: z.string().min(1).max(100), approvalId: z.uuid(), requestId: z.uuid() }),
]);
type BranchCommand = z.infer<typeof branchCommandSchema>;
export function experimentSummary(branch: Branch): ExperimentSummary {
  return { id: branch.id, name: branch.name, createdAt: branch.createdAt.toISOString(), archivedAt: branch.archivedAt?.toISOString() ?? null,
    baseCheckpointId: branch.baseCheckpointId!, createdById: branch.createdById, createdByName: branch.createdByName };
}
export function approvalSummary(approval: MergeApproval): MergeApprovalSummary {
  return { id: approval.id, approvedById: approval.approvedById, approvedByName: approval.approvedByName, createdAt: approval.createdAt.toISOString(),
    sourceHead: reviewedHeadSchema.parse(approval.sourceHead), mainHead: reviewedHeadSchema.parse(approval.mainHead), resultHash: approval.resultHash };
}
const sameHead = (a: HistoryHead, b: HistoryHead) => a.generation === b.generation && a.revision === b.revision && a.contentHash === b.contentHash;
const snapshot = (document: Y.Doc, content = contentFromYDoc(document)): SnapshotPayload => ({ format: "flux.document", schemaVersion: DOCUMENT_SCHEMA_VERSION, content, yjsState: Buffer.from(Y.encodeStateAsUpdate(document)).toString("base64") });

export class BranchCoordinator {
  private pending = 0;
  constructor(private readonly db: PrismaClient, private readonly storage: SnapshotStorage, private readonly rooms: Map<string, RoomState>,
    private readonly gate: RoomGate, private readonly persist: (room: string, document: Document) => Promise<void>) {}

  async execute(instance: Hocuspocus, command: BranchCommand, userId: string, sessionId: string): Promise<ExperimentSummary | MergePreview | MergeApprovalSummary | MergeResult> {
    if (this.pending >= 16) throw new HistoryError(503, "Branch review is busy. Try again shortly");
    this.pending += 1;
    try { return await this.gate.run("branch-operation", () => this.executeSerial(instance, command, userId, sessionId)); }
    finally { this.pending -= 1; }
  }

  private async executeSerial(instance: Hocuspocus, command: BranchCommand, userId: string, sessionId: string) {
    const file = await this.db.file.findUnique({ where: { id: command.fileId }, include: { mainBranch: true } });
    if (!file?.mainBranch) throw new HistoryError(404, "Document not found");
    const permission = command.operation === "fork" ? "branch" : command.operation === "approve" ? "review" : command.operation === "merge" ? "merge" : false;
    await requireAccess(this.db, file.workspaceId, userId, sessionId, permission);
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    return this.gate.run(`history-workspace:${file.workspaceId}`, async () => {
      await requireAccess(this.db, file.workspaceId, userId, sessionId, permission);
      const requestHash = digest(JSON.stringify(command));
      if (command.operation === "fork") {
        const previous = await this.db.branch.findUnique({ where: { requestId: command.requestId } });
        if (previous) {
          if (previous.fileId !== file.id || previous.createdById !== userId || previous.requestHash !== requestHash) throw new HistoryError(409, "This request ID was used for a different experiment");
          return experimentSummary(previous);
        }
        const base = await this.db.checkpoint.findFirst({ where: { id: command.checkpointId, fileId: file.id, branchId: file.mainBranch!.id } });
        if (!base) throw new HistoryError(404, "Main checkpoint not found");
        let content: DocumentContent;
        try { const data = await this.storage.get(base.objectKey, base.checksum); content = validateDocument(data.content, base.schemaVersion); if (data.schemaVersion !== base.schemaVersion) throw new Error("Schema mismatch"); }
        catch { throw new HistoryError(409, "The base checkpoint could not be verified"); }
        const document = yDocFromContent(content);
        try {
          const state = new Uint8Array(Y.encodeStateAsUpdate(document));
          const created = await this.db.$transaction(async tx => {
            await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Workspace" WHERE "id" = ${file.workspaceId} FOR UPDATE`);
            await requireAccess(tx, file.workspaceId, userId, sessionId, "branch");
            if (await tx.branch.count({ where: { fileId: file.id } }) >= 101 || await tx.branch.count({ where: { fileId: file.id, archivedAt: null, baseCheckpointId: { not: null } } }) >= 20) throw new HistoryError(403, "This document has reached its experiment limit");
            if (await tx.branch.findUnique({ where: { fileId_name: { fileId: file.id, name: command.name } } })) throw new HistoryError(409, "An experiment already uses this name");
            const branch = await tx.branch.create({ data: { fileId: file.id, name: command.name, baseCheckpointId: base.id, createdById: userId, createdByName: user.name,
              requestId: command.requestId, requestHash, state: { create: { state, generation: 0, revision: 0 } } } });
            await tx.activityEvent.create({ data: { workspaceId: file.workspaceId, fileId: file.id, actorId: userId, actorName: user.name, type: "BRANCH_CREATED", details: { branchId: branch.id, name: branch.name, baseCheckpointId: base.id } } });
            return branch;
          });
          return experimentSummary(created);
        } finally { document.destroy(); }
      }
      const branch = await this.db.branch.findFirst({ where: { id: command.branchId, fileId: file.id, baseCheckpointId: { not: null } } });
      if (!branch || branch.id === file.mainBranch!.id) throw new HistoryError(404, "Experiment not found");
      if (command.operation === "merge") {
        const previous = await this.db.checkpoint.findUnique({ where: { requestId: command.requestId } });
        if (previous) {
          if (previous.fileId !== file.id || previous.createdById !== userId || previous.requestHash !== requestHash || previous.kind !== "MERGE") throw new HistoryError(409, "This request ID was used for a different action");
          return { checkpoint: checkpointSummary(previous), preservedCheckpointId: previous.preservedCheckpointId!, sourceCheckpointId: previous.sourceCheckpointId! };
        }
      }
      if (branch.archivedAt) throw new HistoryError(409, "This experiment was already merged and is read-only");
      const mainBranch = await this.db.branch.findUniqueOrThrow({ where: { id: file.mainBranch!.id } });
      const names = [branchRoom(branch.id, branch.generation), branchRoom(mainBranch.id, mainBranch.generation)].sort();
      return this.gate.run(names[0], () => this.gate.run(names[1], async () => {
        await requireAccess(this.db, file.workspaceId, userId, sessionId, permission);
        const [freshMain, freshSource] = await Promise.all([this.db.branch.findUniqueOrThrow({ where: { id: mainBranch.id } }), this.db.branch.findUniqueOrThrow({ where: { id: branch.id } })]);
        if (freshMain.generation !== mainBranch.generation || freshSource.generation !== branch.generation || freshSource.archivedAt) throw new HistoryError(409, "An editing session changed. Refresh the review");
        const base = await this.db.checkpoint.findUnique({ where: { id: branch.baseCheckpointId! } });
        if (!base || base.fileId !== file.id || base.branchId !== mainBranch.id) throw new HistoryError(409, "The experiment base is unavailable");
        let baseContent: DocumentContent;
        try { const data = await this.storage.get(base.objectKey, base.checksum); baseContent = validateDocument(data.content, base.schemaVersion); if (data.schemaVersion !== base.schemaVersion) throw new Error("Schema mismatch"); }
        catch { throw new HistoryError(409, "The base checkpoint could not be verified"); }
        const targetRoom = branchRoom(mainBranch.id, mainBranch.generation), sourceRoom = branchRoom(branch.id, branch.generation);
        const targetConnection = await instance.openDirectConnection(targetRoom);
        let sourceConnection: Awaited<ReturnType<Hocuspocus["openDirectConnection"]>> | undefined;
        try {
          sourceConnection = await instance.openDirectConnection(sourceRoom);
          const mainDocument = targetConnection.document as Document, sourceDocument = sourceConnection.document as Document;
          const mainContent = contentFromYDoc(mainDocument), sourceContent = contentFromYDoc(sourceDocument);
          const mainVersion = this.rooms.get(targetRoom), sourceVersion = this.rooms.get(sourceRoom);
          if (!mainVersion || !sourceVersion) throw new HistoryError(503, "Document state is unavailable");
          // Copy version values: room revisions are mutable while retained documents live.
          const mainHead: HistoryHead = { ...mainVersion, contentHash: digest(JSON.stringify(mainContent)) };
          const sourceHead: HistoryHead = { ...sourceVersion, contentHash: digest(JSON.stringify(sourceContent)) };
          if (command.operation === "compare") {
            try { return { ...analyzeMerge(baseContent, mainContent, sourceContent), branch: experimentSummary(branch), mainHead, sourceHead }; }
            catch (error) { throw new HistoryError(409, error instanceof Error ? error.message : "The comparison needs manual handling"); }
          }
          if (command.operation === "approve") {
            if (branch.createdById === userId) throw new HistoryError(403, "The experiment creator cannot approve their own merge");
            const previous = await this.db.mergeApproval.findUnique({ where: { requestId: command.requestId } });
            if (previous) {
              if (previous.branchId !== branch.id || previous.approvedById !== userId || previous.requestHash !== requestHash) throw new HistoryError(409, "This request ID was used for a different approval");
              if (previous.supersededAt) throw new HistoryError(409, "That approval was superseded. Refresh the review");
              return approvalSummary(previous);
            }
            if (!sameHead(mainHead, command.mainHead) || !sameHead(sourceHead, command.sourceHead)) throw new HistoryError(409, "Main or the experiment changed. Refresh and review again");
            let result: DocumentContent;
            try { result = validateDocument(resolveMerge(baseContent, mainContent, sourceContent, command.resolutions, command.order)); }
            catch (error) { throw new HistoryError(409, error instanceof Error ? error.message : "Resolve the comparison before approving"); }
            const prepared = prepareContentUpdate(mainDocument, result);
            encodeSnapshot({ format: "flux.document", schemaVersion: DOCUMENT_SCHEMA_VERSION, content: result, yjsState: Buffer.from(prepared.state).toString("base64") });
            const created = await this.db.$transaction(async tx => {
              await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Workspace" WHERE "id" = ${file.workspaceId} FOR UPDATE`);
              await requireAccess(tx, file.workspaceId, userId, sessionId, "review");
              // Keep the audit/fingerprint, but release old result payloads when an
              // approver explicitly submits a replacement review.
              await tx.mergeApproval.updateMany({ where: { branchId: branch.id, approvedById: userId, supersededAt: null }, data: { supersededAt: new Date(), resultContent: Prisma.DbNull, byteLength: 0, resolutions: {} } });
              if (await tx.mergeApproval.count({ where: { branchId: branch.id, supersededAt: null } }) >= 10) throw new HistoryError(403, "This experiment has reached its active-approval limit");
              const byteLength = Buffer.byteLength(JSON.stringify({ result, resolutions: command.resolutions, order: command.order, mainHead, sourceHead }));
              const usage = await tx.mergeApproval.aggregate({ where: { branch: { file: { workspaceId: file.workspaceId } } }, _sum: { byteLength: true } });
              if (byteLength + (usage._sum.byteLength ?? 0) > 64 * 1024 * 1024 || await tx.mergeApproval.count({ where: { branch: { file: { workspaceId: file.workspaceId } } } }) >= 1000) throw new HistoryError(403, "This workspace has reached its review-storage limit");
              const approval = await tx.mergeApproval.create({ data: { branchId: branch.id, approvedById: userId, approvedByName: user.name,
                sourceHead: { ...sourceHead }, mainHead: { ...mainHead }, baseChecksum: base.checksum, resultContent: result as unknown as Prisma.InputJsonValue, byteLength,
                resultHash: digest(JSON.stringify(result)), resolutions: { blocks: command.resolutions, order: command.order ?? null }, requestId: command.requestId, requestHash } });
              await tx.activityEvent.create({ data: { workspaceId: file.workspaceId, fileId: file.id, actorId: userId, actorName: user.name, type: "MERGE_APPROVED", details: { branchId: branch.id, approvalId: approval.id, resultHash: approval.resultHash } } });
              return approval;
            });
            return approvalSummary(created);
          }
          const approval = await this.db.mergeApproval.findFirst({ where: { id: command.approvalId, branchId: branch.id } });
          if (!approval || approval.supersededAt || !approval.resultContent || !approval.approvedById || approval.approvedById === branch.createdById) throw new HistoryError(409, "A current non-author approval is required");
          const approver = await this.db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: file.workspaceId, userId: approval.approvedById } } });
          if (!approver || !can(approver.role, "review")) throw new HistoryError(409, "The approver no longer has review access");
          if (approval.baseChecksum !== base.checksum || !sameHead(mainHead, reviewedHeadSchema.parse(approval.mainHead)) || !sameHead(sourceHead, reviewedHeadSchema.parse(approval.sourceHead))) throw new HistoryError(409, "Main or the experiment changed after approval. Refresh and obtain a new approval");
          const result = validateDocument(approval.resultContent as unknown as DocumentContent);
          if (digest(JSON.stringify(result)) !== approval.resultHash) throw new HistoryError(409, "The approved result could not be verified");
          const prepared = prepareContentUpdate(mainDocument, result);
          const nextMain = { generation: mainHead.generation, revision: mainHead.revision + 1 };
          const nextSource = { generation: sourceHead.generation + 1, revision: sourceHead.revision + 1 };
          const beforeId = randomUUID(), mergedId = randomUUID(), sourceId = randomUUID();
          const beforeKey = `${file.workspaceId}/${file.id}/${mainBranch.id}/${beforeId}.json`, mergedKey = `${file.workspaceId}/${file.id}/${mainBranch.id}/${mergedId}.json`, sourceKey = `${file.workspaceId}/${file.id}/${branch.id}/${sourceId}.json`;
          const before = snapshot(mainDocument, mainContent), source = snapshot(sourceDocument, sourceContent);
          const merged: SnapshotPayload = { format: "flux.document", schemaVersion: DOCUMENT_SCHEMA_VERSION, content: result, yjsState: Buffer.from(prepared.state).toString("base64") };
          const used = await this.db.checkpoint.aggregate({ where: { file: { workspaceId: file.workspaceId } }, _sum: { byteLength: true } });
          if (mainBranch.checkpointNumber + 2 > 1000 || branch.checkpointNumber + 1 > 1000 || [before, source, merged].reduce((total, value) => total + encodeSnapshot(value).byteLength, used._sum.byteLength ?? 0) > 256 * 1024 * 1024) throw new HistoryError(403, "Checkpoint limits prevent this merge. Main was not changed");
          const beforeStored = await this.storage.put(beforeKey, before), sourceStored = await this.storage.put(sourceKey, source), mergedStored = await this.storage.put(mergedKey, merged);
          await this.persist(targetRoom, mainDocument); await this.persist(sourceRoom, sourceDocument);
          const checkpoint = await this.db.$transaction(async tx => {
            await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Workspace" WHERE "id" = ${file.workspaceId} FOR UPDATE`);
            await requireAccess(tx, file.workspaceId, userId, sessionId, "merge");
            const stillApproved = await tx.mergeApproval.findFirst({ where: { id: approval.id, branchId: branch.id, supersededAt: null, resultHash: approval.resultHash } });
            if (!stillApproved?.resultContent) throw new HistoryError(409, "The approval was revoked or superseded before merge");
            const currentApprover = await tx.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: file.workspaceId, userId: approval.approvedById! } } });
            if (!currentApprover || !can(currentApprover.role, "review")) throw new HistoryError(409, "Review access was revoked before merge");
            const target = await tx.branch.update({ where: { id: mainBranch.id }, data: { checkpointNumber: { increment: 2 } } });
            const archived = await tx.branch.updateMany({ where: { id: branch.id, archivedAt: null, generation: sourceHead.generation }, data: { archivedAt: new Date(), generation: nextSource.generation, checkpointNumber: { increment: 1 } } });
            if (!archived.count) throw new HistoryError(409, "The experiment changed or was already merged");
            const sourceBranch = await tx.branch.findUniqueOrThrow({ where: { id: branch.id } });
            await tx.checkpoint.create({ data: { id: beforeId, fileId: file.id, branchId: mainBranch.id, number: target.checkpointNumber - 1, title: `Before merging “${branch.name}”`.slice(0, 160), kind: "BEFORE_MERGE", generation: mainHead.generation, revision: mainHead.revision,
              schemaVersion: DOCUMENT_SCHEMA_VERSION, objectKey: beforeKey, ...beforeStored, createdById: userId, createdByName: user.name } });
            await tx.checkpoint.create({ data: { id: sourceId, fileId: file.id, branchId: branch.id, number: sourceBranch.checkpointNumber, title: `Merged experiment “${branch.name}”`.slice(0, 160), kind: "MERGED_EXPERIMENT", generation: sourceHead.generation, revision: sourceHead.revision,
              schemaVersion: DOCUMENT_SCHEMA_VERSION, objectKey: sourceKey, ...sourceStored, createdById: userId, createdByName: user.name } });
            const created = await tx.checkpoint.create({ data: { id: mergedId, fileId: file.id, branchId: mainBranch.id, number: target.checkpointNumber, title: `Merged “${branch.name}”`.slice(0, 160), kind: "MERGE", ...nextMain,
              schemaVersion: DOCUMENT_SCHEMA_VERSION, objectKey: mergedKey, ...mergedStored, createdById: userId, createdByName: user.name,
              sourceCheckpointId: sourceId, preservedCheckpointId: beforeId, requestId: command.requestId, requestHash } });
            await tx.documentState.update({ where: { branchId: mainBranch.id }, data: { state: new Uint8Array(prepared.state), ...nextMain } });
            await tx.documentState.update({ where: { branchId: branch.id }, data: { ...nextSource } });
            await tx.mergeApproval.updateMany({ where: { branchId: branch.id, supersededAt: null }, data: { supersededAt: new Date(), resultContent: Prisma.DbNull, byteLength: 0, resolutions: {} } });
            await tx.file.update({ where: { id: file.id }, data: { updatedAt: new Date() } });
            await tx.activityEvent.create({ data: { workspaceId: file.workspaceId, fileId: file.id, actorId: userId, actorName: user.name, type: "BRANCH_MERGED", details: { branchId: branch.id, approvalId: approval.id, checkpointId: mergedId, sourceCheckpointId: sourceId, preservedCheckpointId: beforeId, resultHash: approval.resultHash } } });
            return created;
          });
          // Publish only the incremental, prevalidated update after the commit.
          // Main keeps its existing CRDT identities and connected editing session.
          try { Y.applyUpdate(mainDocument, prepared.update, "approved-merge"); this.rooms.set(targetRoom, nextMain); }
          catch {
            // Continuing with any old in-memory head could overwrite the committed
            // result. Fail-stop without flushing; restart reloads the committed CRDT.
            console.error(JSON.stringify({ event: "committed_merge_publish_failed", checkpointId: checkpoint.id }));
            process.exit(1);
          }
          sourceDocument.broadcastStateless(JSON.stringify({ type: "document-restored", generation: nextSource.generation }));
          for (const connection of sourceDocument.getConnections()) connection.close({ code: 4409, reason: "Experiment was merged and archived" });
          return { checkpoint: checkpointSummary(checkpoint), preservedCheckpointId: beforeId, sourceCheckpointId: sourceId };
        } finally {
          await sourceConnection?.disconnect().catch(() => { console.error(JSON.stringify({ event: "branch_room_cleanup_failed" })); });
          await targetConnection.disconnect().catch(() => { console.error(JSON.stringify({ event: "branch_room_cleanup_failed" })); });
        }
      }));
    });
  }
}
