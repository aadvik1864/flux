import { Body, ConflictException, Controller, Delete, ForbiddenException, Get, Inject, Module, NotFoundException, Param, Patch, Post, Query, Req, ServiceUnavailableException, UnauthorizedException, UseGuards } from "@nestjs/common";
import { Prisma, type Branch, type DiscussionMessage, type DecisionBookmark } from "@prisma/client";
import { z } from "zod";
import { inspectDocumentState, validateDocument } from "@flux/document-model";
import { digest, SnapshotStorage } from "@flux/storage";
import { can, type Permission, type DiscussionPage, type DecisionPage } from "@flux/shared";
import { Database } from "./database";
import { SessionGuard, type AuthenticatedRequest } from "./auth";
import { AccessService, WorkspacesModule } from "./workspaces";
import { env } from "./config";
import { input } from "./validation";
import { anchorAvailable, decisionInput, messageInput } from "./discussion-policy";

const messageSummary = (message: DiscussionMessage) => ({ id: message.id, number: message.number, authorId: message.authorId, authorName: message.authorName,
  body: message.body, createdAt: message.createdAt.toISOString(), deletedAt: message.deletedAt?.toISOString() ?? null });
const decisionSummary = (decision: DecisionBookmark, available: boolean) => ({ id: decision.id, number: decision.number, branchId: decision.branchId, checkpointId: decision.checkpointId,
  title: decision.title, explanation: decision.explanation, status: decision.status, createdById: decision.createdById, createdByName: decision.createdByName,
  createdAt: decision.createdAt.toISOString(), blockId: decision.blockId, discussionMessageId: decision.discussionMessageId, anchorAvailable: available, unavailableAt: decision.unavailableAt?.toISOString() ?? null });

function identities(state: Uint8Array) {
  if (state.byteLength > 8 * 1024 * 1024) throw new ServiceUnavailableException("This saved document cannot be inspected safely");
  try { return inspectDocumentState(state).identities; }
  catch { throw new ServiceUnavailableException("Saved anchor availability could not be verified"); }
}

@Controller("files/:fileId/branches/:branchId")
@UseGuards(SessionGuard)
class DiscussionsController {
  private readonly storage = new SnapshotStorage();
  constructor(@Inject(Database) private readonly db: Database, @Inject(AccessService) private readonly access: AccessService) {}
  private async branch(fileId: string, branchId: string, request: AuthenticatedRequest, permission?: Permission) {
    const branch = await this.db.branch.findFirst({ where: { id: branchId, fileId }, include: { file: true } });
    if (!branch) throw new NotFoundException("Document discussion not found");
    await this.access.workspace(branch.file.workspaceId, request.identity.user.id, permission); return branch;
  }
  private async lock(tx: Prisma.TransactionClient, workspaceId: string, request: AuthenticatedRequest, permission?: Permission) {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Workspace" WHERE "id" = ${workspaceId} FOR UPDATE`);
    const session = await tx.session.findUnique({ where: { id: request.identity.sessionId }, include: { user: { select: { emailVerifiedAt: true } } } });
    if (!session || session.userId !== request.identity.user.id || session.expiresAt <= new Date()) throw new UnauthorizedException("Your session expired");
    if (env.REQUIRE_EMAIL_VERIFICATION && !session.user.emailVerifiedAt) throw new ForbiddenException("Verify your email before joining the discussion");
    return this.access.workspace(workspaceId, request.identity.user.id, permission, tx);
  }
  private async writable(tx: Prisma.TransactionClient, branchId: string): Promise<Branch> {
    const branch = await tx.branch.findUniqueOrThrow({ where: { id: branchId } });
    if (branch.archivedAt) throw new ConflictException("Merged experiments are read-only");
    return branch;
  }
  @Get("messages")
  async messages(@Param("fileId") fileId: string, @Param("branchId") branchId: string, @Query() query: unknown, @Req() request: AuthenticatedRequest): Promise<DiscussionPage> {
    await this.branch(fileId, branchId, request);
    const data = input(z.object({ before: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(50).default(50) }), query);
    const messages = await this.db.discussionMessage.findMany({ where: { branchId, ...(data.before ? { number: { lt: data.before } } : {}) }, orderBy: { number: "desc" }, take: data.limit + 1 });
    return { messages: messages.slice(0, data.limit).reverse().map(messageSummary), hasOlder: messages.length > data.limit };
  }
  @Post("messages")
  async send(@Param("fileId") fileId: string, @Param("branchId") branchId: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const branch = await this.branch(fileId, branchId, request, "discuss"); const data = input(messageInput, body), requestHash = digest(JSON.stringify({ branchId, ...data }));
    return this.db.$transaction(async tx => {
      await this.lock(tx, branch.file.workspaceId, request, "discuss");
      const previous = await tx.discussionMessage.findUnique({ where: { requestId: data.requestId } });
      if (previous) {
        if (previous.branchId !== branchId || previous.authorId !== request.identity.user.id || previous.requestHash !== requestHash) throw new ConflictException("This request ID belongs to a different message");
        return messageSummary(previous);
      }
      const current = await this.writable(tx, branchId);
      const byteLength = Buffer.byteLength(data.body), usage = await tx.branch.aggregate({ where: { file: { workspaceId: branch.file.workspaceId } }, _sum: { discussionBytes: true } });
      if (current.discussionSequence >= 10_000 || byteLength + (usage._sum.discussionBytes ?? 0) > 64 * 1024 * 1024) throw new ForbiddenException("This discussion has reached its message or workspace storage limit");
      const numbered = await tx.branch.update({ where: { id: branchId }, data: { discussionSequence: { increment: 1 }, discussionBytes: { increment: byteLength } } });
      return messageSummary(await tx.discussionMessage.create({ data: { branchId, number: numbered.discussionSequence, body: data.body, byteLength,
        authorId: request.identity.user.id, authorName: request.identity.user.name, requestId: data.requestId, requestHash } }));
    });
  }
  @Get("messages/:messageId")
  async message(@Param("fileId") fileId: string, @Param("branchId") branchId: string, @Param("messageId") messageId: string, @Req() request: AuthenticatedRequest) {
    await this.branch(fileId, branchId, request);
    const message = await this.db.discussionMessage.findFirst({ where: { id: messageId, branchId } });
    if (!message) throw new NotFoundException("Linked discussion message not found");
    return messageSummary(message);
  }
  @Delete("messages/:messageId")
  async removeMessage(@Param("fileId") fileId: string, @Param("branchId") branchId: string, @Param("messageId") messageId: string, @Req() request: AuthenticatedRequest) {
    const branch = await this.branch(fileId, branchId, request, "discuss");
    return this.db.$transaction(async tx => {
      const role = await this.lock(tx, branch.file.workspaceId, request, "discuss");
      const message = await tx.discussionMessage.findFirst({ where: { id: messageId, branchId } }); if (!message) throw new NotFoundException("Message not found");
      if (message.authorId !== request.identity.user.id && !can(role, "review")) throw new ForbiddenException("Only the author or a reviewer can remove this message");
      if (message.deletedAt) return messageSummary(message);
      const removed = await tx.discussionMessage.update({ where: { id: message.id }, data: { body: "", deletedAt: new Date(), byteLength: 0 } });
      await tx.branch.update({ where: { id: branchId }, data: { discussionBytes: { decrement: message.byteLength } } });
      await tx.activityEvent.create({ data: { workspaceId: branch.file.workspaceId, fileId, actorId: request.identity.user.id, actorName: request.identity.user.name, type: "DISCUSSION_MESSAGE_REMOVED", details: { branchId, messageId } } });
      return messageSummary(removed);
    });
  }
  @Get("decisions")
  async decisions(@Param("fileId") fileId: string, @Param("branchId") branchId: string, @Query() query: unknown, @Req() request: AuthenticatedRequest): Promise<DecisionPage> {
    const branch = await this.branch(fileId, branchId, request);
    const data = input(z.object({ before: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(50).default(50) }), query);
    const bookmarks = await this.db.decisionBookmark.findMany({ where: { branchId, ...(data.before ? { number: { lt: data.before } } : {}) }, orderBy: { number: "desc" }, take: data.limit + 1 });
    if (!bookmarks.length) return { bookmarks: [], nextBefore: null };
    const state = await this.db.documentState.findUnique({ where: { branchId } });
    if (!state) throw new ServiceUnavailableException("Saved anchor availability is not ready");
    const index = identities(state.state);
    const missing = bookmarks.filter(bookmark => !bookmark.unavailableAt && !anchorAvailable(bookmark, branch, index)).map(bookmark => bookmark.id);
    if (missing.length) await this.db.$transaction(async tx => {
      await this.lock(tx, branch.file.workspaceId, request);
      const current = await tx.documentState.findUnique({ where: { branchId } });
      const currentBranch = await tx.branch.findUniqueOrThrow({ where: { id: branchId } });
      // Do not tombstone using a stale read if editing/persistence raced this check.
      if (current?.updatedAt.getTime() === state.updatedAt.getTime() && currentBranch.generation === branch.generation) {
        await tx.decisionBookmark.updateMany({ where: { id: { in: missing }, unavailableAt: null }, data: { unavailableAt: new Date() } });
      }
    });
    return { bookmarks: bookmarks.slice(0, data.limit).map(bookmark => decisionSummary(bookmark, anchorAvailable(bookmark, branch, index))), nextBefore: bookmarks.length > data.limit ? bookmarks[data.limit - 1].number : null };
  }
  @Post("decisions")
  async createDecision(@Param("fileId") fileId: string, @Param("branchId") branchId: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const branch = await this.branch(fileId, branchId, request, "discuss"), data = input(decisionInput, body);
    const requestHash = digest(JSON.stringify({ branchId, ...data }));
    const previous = await this.db.decisionBookmark.findUnique({ where: { requestId: data.requestId } });
    if (previous) {
      if (previous.branchId !== branchId || previous.createdById !== request.identity.user.id || previous.requestHash !== requestHash) throw new ConflictException("This request ID belongs to a different decision");
      return this.db.$transaction(async tx => {
        await this.lock(tx, branch.file.workspaceId, request, "discuss");
        const state = await tx.documentState.findUnique({ where: { branchId } }), current = await tx.branch.findUniqueOrThrow({ where: { id: branchId } });
        return decisionSummary(previous, Boolean(state && anchorAvailable(previous, current, identities(state.state))));
      });
    }
    const checkpoint = await this.db.checkpoint.findFirst({ where: { id: data.checkpointId, fileId, branchId } });
    if (!checkpoint) throw new NotFoundException("Choose a checkpoint from this editing branch");
    let identity: string | undefined;
    try {
      const snapshot = await this.storage.get(checkpoint.objectKey, checkpoint.checksum);
      const content = validateDocument(snapshot.content, checkpoint.schemaVersion);
      if (snapshot.schemaVersion !== checkpoint.schemaVersion) throw new Error("Schema mismatch");
      const inspected = inspectDocumentState(Buffer.from(snapshot.yjsState, "base64"));
      if (JSON.stringify(inspected.content) !== JSON.stringify(content)) throw new Error("Checkpoint identities do not match its content");
      identity = inspected.identities.get(data.blockId);
    } catch { throw new ServiceUnavailableException("This checkpoint's anchor could not be verified"); }
    if (!identity) throw new NotFoundException("This block is not present in the saved checkpoint");
    return this.db.$transaction(async tx => {
      await this.lock(tx, branch.file.workspaceId, request, "discuss"); const current = await this.writable(tx, branchId);
      const existing = await tx.decisionBookmark.findUnique({ where: { requestId: data.requestId } });
      if (existing) {
        if (existing.branchId !== branchId || existing.createdById !== request.identity.user.id || existing.requestHash !== requestHash) throw new ConflictException("This request ID belongs to a different decision");
        const state = await tx.documentState.findUnique({ where: { branchId } });
        return decisionSummary(existing, Boolean(state && anchorAvailable(existing, current, identities(state.state))));
      }
      if (current.decisionSequence >= 500 || await tx.decisionBookmark.count({ where: { branch: { file: { workspaceId: branch.file.workspaceId } } } }) >= 1000) throw new ForbiddenException("This branch or workspace has reached its decision-bookmark limit");
      if (data.discussionMessageId && !await tx.discussionMessage.findFirst({ where: { id: data.discussionMessageId, branchId } })) throw new NotFoundException("Linked discussion message not found in this branch");
      const state = await tx.documentState.findUnique({ where: { branchId } });
      if (!state) throw new ServiceUnavailableException("Saved anchor availability is not ready");
      const anchor = { anchorGeneration: checkpoint.generation, anchorIdentity: identity!, blockId: data.blockId, unavailableAt: null };
      const available = anchorAvailable(anchor, current, identities(state.state));
      const numbered = await tx.branch.update({ where: { id: branchId }, data: { decisionSequence: { increment: 1 } } });
      const bookmark = await tx.decisionBookmark.create({ data: { branchId, number: numbered.decisionSequence, ...data, requestHash,
        createdById: request.identity.user.id, createdByName: request.identity.user.name, ...anchor, unavailableAt: available ? null : new Date() } });
      await tx.activityEvent.create({ data: { workspaceId: branch.file.workspaceId, fileId, actorId: request.identity.user.id, actorName: request.identity.user.name, type: "DECISION_CREATED", details: { branchId, decisionId: bookmark.id, checkpointId: checkpoint.id, blockId: data.blockId } } });
      return decisionSummary(bookmark, available);
    });
  }
  @Patch("decisions/:decisionId")
  async status(@Param("fileId") fileId: string, @Param("branchId") branchId: string, @Param("decisionId") decisionId: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const branch = await this.branch(fileId, branchId, request, "discuss");
    const data = input(z.object({ status: z.enum(["OPEN", "DECIDED", "SUPERSEDED"]), expectedStatus: z.enum(["OPEN", "DECIDED", "SUPERSEDED"]) }), body);
    return this.db.$transaction(async tx => {
      const role = await this.lock(tx, branch.file.workspaceId, request, "discuss"); await this.writable(tx, branchId);
      const bookmark = await tx.decisionBookmark.findFirst({ where: { id: decisionId, branchId } }); if (!bookmark) throw new NotFoundException("Decision bookmark not found");
      if (bookmark.createdById !== request.identity.user.id && !can(role, "review")) throw new ForbiddenException("Only the creator or a reviewer can change this decision status");
      if (bookmark.status !== data.status && bookmark.status !== data.expectedStatus) throw new ConflictException("This decision changed. Refresh before changing its status");
      if (bookmark.status !== data.status) {
        await tx.decisionBookmark.update({ where: { id: bookmark.id }, data: { status: data.status } });
        await tx.activityEvent.create({ data: { workspaceId: branch.file.workspaceId, fileId, actorId: request.identity.user.id, actorName: request.identity.user.name, type: "DECISION_STATUS_CHANGED", details: { branchId, decisionId, before: bookmark.status, status: data.status } } });
      }
      return { id: bookmark.id, status: data.status };
    });
  }
}

@Module({ imports: [WorkspacesModule], controllers: [DiscussionsController] })
export class DiscussionsModule {}
