import { Body, Controller, Get, Inject, Module, NotFoundException, Param, Post, Req, UseGuards } from "@nestjs/common";
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
      const file = await tx.file.create({ data: { workspaceId, name: data.name } });
      const branch = await tx.branch.create({ data: { fileId: file.id, name: "main" } });
      return tx.file.update({ where: { id: file.id }, data: { mainBranchId: branch.id }, select: { id: true, name: true } });
    });
  }

  @Get("files/:id")
  async detail(@Param("id") id: string, @Req() request: AuthenticatedRequest): Promise<FileDetail> {
    const file = await this.db.file.findUnique({ where: { id }, include: { workspace: true, mainBranch: true } });
    if (!file || !file.mainBranchId) throw new NotFoundException("Document not found");
    const role = await this.access.workspace(file.workspaceId, request.identity.user.id);
    return {
      id, name: file.name, mainBranchId: file.mainBranchId, updatedAt: file.updatedAt.toISOString(),
      workspaceId: file.workspaceId, workspaceName: file.workspace.name, role,
      generation: file.mainBranch!.generation,
    };
  }

  @Post("files/:id/collaboration-token")
  async token(@Param("id") id: string, @Req() request: AuthenticatedRequest) {
    const file = await this.detail(id, request);
    const user = request.identity.user;
    const token = jwt.sign({
      room: branchRoom(file.mainBranchId, file.generation),
      sessionId: request.identity.sessionId,
      name: user.name,
      color: colorForUser(user.id),
    }, env.COLLABORATION_SECRET, {
      subject: user.id, issuer: "flux-api", audience: "flux-collaboration", expiresIn: "2m", algorithm: "HS256",
    });
    return { token, room: branchRoom(file.mainBranchId, file.generation) };
  }
}

@Module({ imports: [WorkspacesModule], controllers: [FilesController] })
export class FilesModule {}
