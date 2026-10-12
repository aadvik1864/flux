import { Body, Controller, Get, Inject, Module, NotFoundException, Param, Post, Query, Req, UseGuards, ForbiddenException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { branchRoom, colorForUser, type FileDetail } from "@flux/shared";
import { Database } from "./database";
import { SessionGuard, type AuthenticatedRequest } from "./auth";
import { AccessService, WorkspacesModule } from "./workspaces";
import { input, resourceName } from "./validation";
import { env } from "./config";

@Controller()
@UseGuards(SessionGuard)
class FilesController {
  constructor(@Inject(Database) private readonly db: Database, @Inject(AccessService) private readonly access: AccessService) {}

  @Post("workspaces/:id/files")
  async create(@Param("id") workspaceId: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    await this.access.workspace(workspaceId, request.identity.user.id, "edit");
    const data = input(z.object({ name: resourceName }), body);
    return this.db.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Workspace" WHERE "id" = ${workspaceId} FOR UPDATE`);
      await this.access.workspace(workspaceId, request.identity.user.id, "edit", tx);
      if (await tx.file.count({ where: { workspaceId } }) >= 100) throw new ForbiddenException("This workspace has reached its 100-document limit");
      const file = await tx.file.create({ data: { workspaceId, name: data.name } });
      const branch = await tx.branch.create({ data: { fileId: file.id, name: "main" } });
      return tx.file.update({ where: { id: file.id }, data: { mainBranchId: branch.id }, select: { id: true, name: true } });
    });
  }

  @Get("files/:id")
  async detail(@Param("id") id: string, @Req() request: AuthenticatedRequest, @Query() query?: unknown): Promise<FileDetail> {
    const file = await this.db.file.findUnique({ where: { id }, include: { workspace: true, mainBranch: true } });
    if (!file || !file.mainBranchId) throw new NotFoundException("Document not found");
    const role = await this.access.workspace(file.workspaceId, request.identity.user.id);
    const data = input(z.object({ branchId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).optional() }), query ?? {});
    const branch = data.branchId ? await this.db.branch.findFirst({ where: { id: data.branchId, fileId: id } }) : file.mainBranch;
    if (!branch) throw new NotFoundException("Editing branch not found");
    return {
      id, name: file.name, mainBranchId: file.mainBranchId, updatedAt: file.updatedAt.toISOString(),
      workspaceId: file.workspaceId, workspaceName: file.workspace.name, role,
      generation: branch.generation, editingBranchId: branch.id, branchName: branch.name, branchArchived: Boolean(branch.archivedAt),
    };
  }

  @Post("files/:id/collaboration-token")
  async token(@Param("id") id: string, @Req() request: AuthenticatedRequest, @Query() query?: unknown) {
    const file = await this.detail(id, request, query);
    const user = request.identity.user;
    const token = jwt.sign({
      room: branchRoom(file.editingBranchId!, file.generation),
      sessionId: request.identity.sessionId,
      name: user.name,
      color: colorForUser(user.id),
    }, env.COLLABORATION_SECRET, {
      subject: user.id, issuer: "flux-api", audience: "flux-collaboration", expiresIn: "2m", algorithm: "HS256",
    });
    return { token, room: branchRoom(file.editingBranchId!, file.generation) };
  }
}

@Module({ imports: [WorkspacesModule], controllers: [FilesController] })
export class FilesModule {}
