import {
  Body, Controller, Get, HttpException, Inject, Module, NotFoundException, Param, Post, Query, Req,
  ServiceUnavailableException, UseGuards,
} from "@nestjs/common";
import type { Checkpoint } from "@prisma/client";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { SnapshotStorage } from "@flux/storage";
import { DOCUMENT_SCHEMA_VERSION, type CheckpointDetail, type CheckpointPage, type CheckpointSummary, type HistoryHead, type RestoreResult } from "@flux/shared";
import { Database } from "./database";
import { SessionGuard, type AuthenticatedRequest } from "./auth";
import { AccessService, WorkspacesModule } from "./workspaces";
import { env } from "./config";
import { input } from "./validation";

function summary(checkpoint: Checkpoint): CheckpointSummary {
  return {
    id: checkpoint.id, number: checkpoint.number, title: checkpoint.title, kind: checkpoint.kind,
    createdAt: checkpoint.createdAt.toISOString(), createdByName: checkpoint.createdByName,
    generation: checkpoint.generation, revision: checkpoint.revision, schemaVersion: checkpoint.schemaVersion,
    sourceCheckpointId: checkpoint.sourceCheckpointId, preservedCheckpointId: checkpoint.preservedCheckpointId,
  };
}

@Controller("files/:fileId")
@UseGuards(SessionGuard)
class CheckpointsController {
  private readonly storage = new SnapshotStorage();
  constructor(@Inject(Database) private readonly db: Database, @Inject(AccessService) private readonly access: AccessService) {}

  private async file(fileId: string, request: AuthenticatedRequest, edit = false) {
    const file = await this.db.file.findUnique({ where: { id: fileId } });
    if (!file?.mainBranchId) throw new NotFoundException("Document not found");
    await this.access.workspace(file.workspaceId, request.identity.user.id, edit ? "edit" : undefined);
    return file;
  }

  private async call<T>(command: Record<string, unknown>, request: AuthenticatedRequest): Promise<T> {
    const token = jwt.sign({ command, sessionId: request.identity.sessionId }, env.COLLABORATION_SECRET, {
      subject: request.identity.user.id, issuer: "flux-api", audience: "flux-history", expiresIn: "45s", algorithm: "HS256",
    });
    let response: Response;
    try {
      response = await fetch(`${env.COLLABORATION_INTERNAL_URL}/internal/history`, {
        method: "POST", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(40_000),
      });
    } catch { throw new ServiceUnavailableException("The history service is unavailable. Keep your document open and try again"); }
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new HttpException(body?.message ?? "History operation failed", response.status);
    return body as T;
  }

  @Get("history-head")
  async head(@Param("fileId") fileId: string, @Req() request: AuthenticatedRequest): Promise<HistoryHead> {
    await this.file(fileId, request);
    return this.call({ operation: "head", fileId }, request);
  }

  @Post("checkpoints")
  async create(@Param("fileId") fileId: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<CheckpointSummary> {
    await this.file(fileId, request, true);
    const data = input(z.object({ title: z.string().trim().min(1).max(120), requestId: z.uuid() }), body);
    return this.call({ operation: "checkpoint", fileId, ...data }, request);
  }

  @Get("checkpoints")
  async list(@Param("fileId") fileId: string, @Query() query: unknown, @Req() request: AuthenticatedRequest): Promise<CheckpointPage> {
    const file = await this.file(fileId, request);
    const data = input(z.object({ cursor: z.uuid().optional(), limit: z.coerce.number().int().min(1).max(50).default(25) }), query);
    if (data.cursor && !await this.db.checkpoint.findFirst({ where: { id: data.cursor, fileId } })) throw new NotFoundException("Checkpoint cursor not found");
    const items = await this.db.checkpoint.findMany({
      where: { fileId, branchId: file.mainBranchId! }, orderBy: { number: "desc" }, take: data.limit + 1,
      ...(data.cursor ? { cursor: { id: data.cursor }, skip: 1 } : {}),
    });
    return { checkpoints: items.slice(0, data.limit).map(summary), nextCursor: items.length > data.limit ? items[data.limit - 1].id : null };
  }

  @Get("checkpoints/:checkpointId")
  async detail(@Param("fileId") fileId: string, @Param("checkpointId") checkpointId: string, @Req() request: AuthenticatedRequest): Promise<CheckpointDetail> {
    await this.file(fileId, request);
    const checkpoint = await this.db.checkpoint.findFirst({ where: { id: checkpointId, fileId } });
    if (!checkpoint) throw new NotFoundException("Checkpoint not found");
    try {
      const snapshot = await this.storage.get(checkpoint.objectKey, checkpoint.checksum);
      if (snapshot.schemaVersion !== checkpoint.schemaVersion || snapshot.schemaVersion !== DOCUMENT_SCHEMA_VERSION) throw new Error("Unsupported document schema");
      return { ...summary(checkpoint), content: snapshot.content };
    } catch { throw new ServiceUnavailableException("This checkpoint could not be loaded or verified. Current content was not changed"); }
  }

  @Post("checkpoints/:checkpointId/restore")
  async restore(@Param("fileId") fileId: string, @Param("checkpointId") checkpointId: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<RestoreResult> {
    await this.file(fileId, request, true);
    const data = input(z.object({
      requestId: z.uuid(), expectedGeneration: z.number().int().nonnegative(), expectedRevision: z.number().int().nonnegative(),
      expectedContentHash: z.string().regex(/^[a-f0-9]{64}$/),
    }), body);
    return this.call({ operation: "restore", fileId, checkpointId, ...data }, request);
  }

  @Get("timeline")
  async timeline(@Param("fileId") fileId: string, @Req() request: AuthenticatedRequest) {
    await this.file(fileId, request);
    return this.db.activityEvent.findMany({ where: { fileId }, orderBy: { createdAt: "desc" }, take: 50,
      select: { id: true, type: true, actorName: true, details: true, createdAt: true },
    });
  }
}

@Module({ imports: [WorkspacesModule], controllers: [CheckpointsController] })
export class CheckpointsModule {}
