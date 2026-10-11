import { randomUUID } from "node:crypto";
import type { Checkpoint, PrismaClient } from "@prisma/client";
import * as Y from "yjs";
import { z } from "zod";
import { can, branchRoom, type CheckpointSummary, type HistoryHead, type RestoreResult } from "@flux/shared";
import { DOCUMENT_SCHEMA_VERSION, contentFromYDoc, validateDocument, yDocFromContent } from "@flux/document-model";
import { digest, SnapshotStorage, type SnapshotPayload } from "@flux/storage";
import type { Document, Hocuspocus } from "@hocuspocus/server";
import { RoomGate } from "./room-gate.js";

export const historyCommandSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("head"), fileId: z.string().max(100) }),
  z.object({ operation: z.literal("checkpoint"), fileId: z.string().max(100), title: z.string().trim().min(1).max(120), requestId: z.uuid() }),
  z.object({
    operation: z.literal("restore"), fileId: z.string().max(100), checkpointId: z.uuid(), requestId: z.uuid(),
    expectedGeneration: z.number().int().nonnegative(), expectedRevision: z.number().int().nonnegative(),
    expectedContentHash: z.string().regex(/^[a-f0-9]{64}$/),
  }),
]);

export type HistoryCommand = z.infer<typeof historyCommandSchema>;
export type RoomState = { generation: number; revision: number };

export class HistoryError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export function checkpointSummary(checkpoint: Checkpoint): CheckpointSummary {
  return {
    id: checkpoint.id, number: checkpoint.number, title: checkpoint.title, kind: checkpoint.kind,
    createdAt: checkpoint.createdAt.toISOString(), createdByName: checkpoint.createdByName,
    generation: checkpoint.generation, revision: checkpoint.revision, schemaVersion: checkpoint.schemaVersion,
    sourceCheckpointId: checkpoint.sourceCheckpointId, preservedCheckpointId: checkpoint.preservedCheckpointId,
  };
}

async function requireAccess(db: Pick<PrismaClient, "session" | "workspaceMember">, workspaceId: string, userId: string, sessionId: string, edit: boolean) {
  const [session, member] = await Promise.all([
    db.session.findUnique({ where: { id: sessionId } }),
    db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } }),
  ]);
  if (!session || session.userId !== userId || session.expiresAt <= new Date()) throw new HistoryError(401, "Your session expired");
  if (!member) throw new HistoryError(404, "Document not found");
  if (edit && !can(member.role, "edit")) throw new HistoryError(403, "Your role cannot change document history");
}

export class HistoryCoordinator {
  constructor(
    private readonly db: PrismaClient,
    private readonly storage: SnapshotStorage,
    private readonly rooms: Map<string, RoomState>,
    private readonly gate: RoomGate,
    private readonly persist: (room: string, document: Document) => Promise<void>,
  ) {}

  async execute(instance: Hocuspocus, command: HistoryCommand, userId: string, sessionId: string): Promise<HistoryHead | CheckpointSummary | RestoreResult> {
    const file = await this.db.file.findUnique({ where: { id: command.fileId }, include: { mainBranch: true } });
    if (!file?.mainBranch) throw new HistoryError(404, "Document not found");
    await requireAccess(this.db, file.workspaceId, userId, sessionId, command.operation !== "head");
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user) throw new HistoryError(401, "Your session expired");

    const room = branchRoom(file.mainBranch.id, file.mainBranch.generation);
    return this.gate.run(room, async () => {
      // A request may have waited behind a slow upload or a restore. Recheck
      // before exposing the head or returning an idempotent previous result.
      await requireAccess(this.db, file.workspaceId, userId, sessionId, command.operation !== "head");
      if (command.operation !== "head") {
        const existing = await this.db.checkpoint.findUnique({ where: { requestId: command.requestId } });
        if (existing) {
          if (existing.fileId !== file.id || existing.createdById !== userId || existing.requestHash !== digest(JSON.stringify(command))) {
            throw new HistoryError(409, "This request ID was already used for a different action");
          }
          return command.operation === "restore"
            ? { checkpoint: checkpointSummary(existing), preservedCheckpointId: existing.preservedCheckpointId! }
            : checkpointSummary(existing);
        }
      }
      const currentBranch = await this.db.branch.findUniqueOrThrow({ where: { id: file.mainBranch!.id } });
      if (currentBranch.generation !== file.mainBranch!.generation) throw new HistoryError(409, "Main changed. Refresh history and try again");

      // A direct connection pins the authoritative room while the operation runs.
      const direct = await instance.openDirectConnection(room);
      const document = direct.document as Document;
      try {
        const version = this.rooms.get(room);
        if (!version) throw new HistoryError(503, "Document state is unavailable");
        const content = contentFromYDoc(document);
        const contentHash = digest(JSON.stringify(content));
        if (command.operation === "head") return { ...version, contentHash };

        const snapshot: SnapshotPayload = {
          format: "flux.document", schemaVersion: DOCUMENT_SCHEMA_VERSION, content,
          yjsState: Buffer.from(Y.encodeStateAsUpdate(document)).toString("base64"),
        };
        const state = new Uint8Array(Y.encodeStateAsUpdate(document));

        if (command.operation === "checkpoint") {
          const id = randomUUID();
          const objectKey = `${file.workspaceId}/${file.id}/${currentBranch.id}/${id}.json`;
          const stored = await this.storage.put(objectKey, snapshot);
          const checkpoint = await this.db.$transaction(async tx => {
            await requireAccess(tx, file.workspaceId, userId, sessionId, true);
            const branch = await tx.branch.update({ where: { id: currentBranch.id }, data: { checkpointNumber: { increment: 1 } } });
            await tx.documentState.upsert({
              where: { branchId: branch.id }, create: { branchId: branch.id, state, ...version }, update: { state, ...version },
            });
            const created = await tx.checkpoint.create({ data: {
              id, fileId: file.id, branchId: branch.id, number: branch.checkpointNumber, title: command.title,
              kind: "MANUAL", ...version, schemaVersion: DOCUMENT_SCHEMA_VERSION,
              objectKey, ...stored, createdById: userId, createdByName: user.name,
              requestId: command.requestId, requestHash: digest(JSON.stringify(command)),
            } });
            await tx.activityEvent.create({ data: {
              workspaceId: file.workspaceId, fileId: file.id, actorId: userId, actorName: user.name,
              type: "CHECKPOINT_CREATED", details: { checkpointId: id, title: command.title, number: created.number },
            } });
            return created;
          });
          return checkpointSummary(checkpoint);
        }

        if (version.generation !== command.expectedGeneration || version.revision !== command.expectedRevision || contentHash !== command.expectedContentHash) {
          throw new HistoryError(409, "Main changed since you opened the restore dialog. Refresh the current revision and review again");
        }
        const source = await this.db.checkpoint.findFirst({ where: { id: command.checkpointId, fileId: file.id, branchId: currentBranch.id } });
        if (!source) throw new HistoryError(404, "Checkpoint not found");
        let target: SnapshotPayload;
        try {
          target = await this.storage.get(source.objectKey, source.checksum);
          if (target.schemaVersion !== source.schemaVersion) throw new Error("Checkpoint schema metadata does not match its object");
          target.content = validateDocument(target.content, target.schemaVersion);
        } catch {
          throw new HistoryError(409, "The selected checkpoint could not be verified. Main was not changed");
        }

        const nextDocument = yDocFromContent(target.content, target.schemaVersion);
        try {
          const nextVersion = { generation: version.generation + 1, revision: version.revision + 1 };
          const nextState = new Uint8Array(Y.encodeStateAsUpdate(nextDocument));
          const preservedId = randomUUID();
          const restoredId = randomUUID();
          const preservedKey = `${file.workspaceId}/${file.id}/${currentBranch.id}/${preservedId}.json`;
          const restoredKey = `${file.workspaceId}/${file.id}/${currentBranch.id}/${restoredId}.json`;
          const preservedBlob = await this.storage.put(preservedKey, snapshot);
          const restoredBlob = await this.storage.put(restoredKey, {
            format: "flux.document", schemaVersion: DOCUMENT_SCHEMA_VERSION, content: target.content,
            yjsState: Buffer.from(nextState).toString("base64"),
          });
          // Drain earlier debounced persistence before replacing the recovery epoch.
          await this.persist(room, document);
          const restored = await this.db.$transaction(async tx => {
            await requireAccess(tx, file.workspaceId, userId, sessionId, true);
            const updated = await tx.branch.updateMany({ where: { id: currentBranch.id, generation: version.generation }, data: {
              generation: nextVersion.generation, checkpointNumber: { increment: 2 },
            } });
            if (!updated.count) throw new HistoryError(409, "Main changed. Refresh history and try again");
            const branch = await tx.branch.findUniqueOrThrow({ where: { id: currentBranch.id } });
            await tx.checkpoint.create({ data: {
              id: preservedId, fileId: file.id, branchId: branch.id, number: branch.checkpointNumber - 1,
              title: `Before restoring “${source.title}”`.slice(0, 160), kind: "BEFORE_RESTORE", ...version,
              schemaVersion: DOCUMENT_SCHEMA_VERSION, objectKey: preservedKey, ...preservedBlob,
              createdById: userId, createdByName: user.name,
            } });
            const checkpoint = await tx.checkpoint.create({ data: {
              id: restoredId, fileId: file.id, branchId: branch.id, number: branch.checkpointNumber,
              title: `Restored “${source.title}”`.slice(0, 160), kind: "RESTORE", ...nextVersion,
              schemaVersion: DOCUMENT_SCHEMA_VERSION, objectKey: restoredKey, ...restoredBlob,
              createdById: userId, createdByName: user.name, sourceCheckpointId: source.id,
              preservedCheckpointId: preservedId, requestId: command.requestId, requestHash: digest(JSON.stringify(command)),
            } });
            await tx.documentState.update({ where: { branchId: branch.id }, data: { state: nextState, ...nextVersion } });
            await tx.file.update({ where: { id: file.id }, data: { updatedAt: new Date() } });
            await tx.activityEvent.create({ data: {
              workspaceId: file.workspaceId, fileId: file.id, actorId: userId, actorName: user.name,
              type: "DOCUMENT_RESTORED", details: { checkpointId: restoredId, sourceCheckpointId: source.id, preservedCheckpointId: preservedId, number: checkpoint.number },
            } });
            return checkpoint;
          });

          // New room generation prevents reconnecting clients from replaying stale CRDT state.
          document.broadcastStateless(JSON.stringify({ type: "document-restored", generation: nextVersion.generation }));
          for (const connection of document.getConnections()) connection.close({ code: 4409, reason: "Main was restored. Open the current revision" });
          return { checkpoint: checkpointSummary(restored), preservedCheckpointId: preservedId };
        } finally { nextDocument.destroy(); }
      } finally {
        // A retired room's final store is fenced by the generation check in persist.
        // Cleanup must not turn a committed action into a misleading failure.
        // Retrying the same request ID still retrieves the committed result.
        await direct.disconnect().catch(error => { console.error("History room cleanup failed", error); });
      }
    });
  }
}
