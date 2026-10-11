import {
  Body, Controller, Delete, ForbiddenException, Get, GoneException, Inject,
  Injectable, Module, NotFoundException, Param, Post, Req, UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { can, type Permission, type Role, type WorkspaceDetail, type WorkspaceSummary } from "@flux/shared";
import { Database } from "./database";
import { publicUser, SessionGuard, type AuthenticatedRequest } from "./auth";
import { email, input, resourceName } from "./validation";
import { opaqueToken, tokenHash } from "./security";
import { env } from "./config";

@Injectable()
export class AccessService {
  constructor(@Inject(Database) private readonly db: Database) {}

  async workspace(workspaceId: string, userId: string, permission?: Permission): Promise<Role> {
    const member = await this.db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } });
    if (!member) throw new NotFoundException("Workspace not found");
    if (permission && !can(member.role, permission)) throw new ForbiddenException("Your role cannot perform this action");
    return member.role;
  }
}

@Controller()
@UseGuards(SessionGuard)
class WorkspacesController {
  constructor(@Inject(Database) private readonly db: Database, @Inject(AccessService) private readonly access: AccessService) {}

  @Get("workspaces")
  async list(@Req() request: AuthenticatedRequest): Promise<WorkspaceSummary[]> {
    const members = await this.db.workspaceMember.findMany({
      where: { userId: request.identity.user.id },
      orderBy: { joinedAt: "desc" },
      include: { workspace: { include: { _count: { select: { members: true, files: true } } } } },
    });
    return members.map(({ role, workspace }) => ({
      id: workspace.id, name: workspace.name, description: workspace.description, role,
      fileCount: workspace._count.files, memberCount: workspace._count.members,
    }));
  }

  @Post("workspaces")
  async create(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const data = input(z.object({ name: resourceName, description: z.string().trim().max(500).default("") }), body);
    return this.db.workspace.create({ data: {
      ...data, members: { create: { userId: request.identity.user.id, role: "OWNER" } },
    }, select: { id: true, name: true } });
  }

  @Get("workspaces/:id")
  async detail(@Param("id") id: string, @Req() request: AuthenticatedRequest): Promise<WorkspaceDetail> {
    const role = await this.access.workspace(id, request.identity.user.id);
    const workspace = await this.db.workspace.findUniqueOrThrow({ where: { id }, include: {
      files: { orderBy: { updatedAt: "desc" } },
      members: { include: { user: true }, orderBy: { joinedAt: "asc" } },
    } });
    return {
      id, name: workspace.name, description: workspace.description, role,
      files: workspace.files.map(file => ({ id: file.id, name: file.name, updatedAt: file.updatedAt.toISOString(), mainBranchId: file.mainBranchId! })),
      members: workspace.members.map(member => ({ role: member.role, user: publicUser(member.user) })),
    };
  }

  @Post("workspaces/:id/invitations")
  async invite(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    await this.access.workspace(id, request.identity.user.id, "manageMembers");
    const data = input(z.object({ email, role: z.enum(["EDITOR", "REVIEWER", "VIEWER"]).default("EDITOR") }), body);
    const token = opaqueToken();
    const invitation = await this.db.invitation.create({ data: {
      workspaceId: id, ...data, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    } });
    return { url: `${env.APP_ORIGIN}/invite/${token}`, expiresAt: invitation.expiresAt.toISOString() };
  }

  @Get("invitations/:token")
  async invitation(@Param("token") token: string, @Req() request: AuthenticatedRequest) {
    const invitation = await this.db.invitation.findUnique({ where: { tokenHash: tokenHash(token) }, include: { workspace: true } });
    if (!invitation || invitation.acceptedAt || invitation.expiresAt <= new Date()) throw new GoneException("This invitation expired or has already been used");
    if (invitation.email !== request.identity.user.email) throw new ForbiddenException("Sign in with the email address this invitation was sent to");
    return { workspaceName: invitation.workspace.name, role: invitation.role, expiresAt: invitation.expiresAt.toISOString() };
  }

  @Post("invitations/:token/accept")
  async accept(@Param("token") token: string, @Req() request: AuthenticatedRequest) {
    return this.db.$transaction(async tx => {
      const invitation = await tx.invitation.findUnique({ where: { tokenHash: tokenHash(token) } });
      if (!invitation || invitation.acceptedAt || invitation.expiresAt <= new Date()) throw new GoneException("This invitation expired or has already been used");
      if (invitation.email !== request.identity.user.email) throw new ForbiddenException("This invitation belongs to a different email address");
      const claimed = await tx.invitation.updateMany({
        where: { id: invitation.id, acceptedAt: null, expiresAt: { gt: new Date() } },
        data: { acceptedAt: new Date() },
      });
      if (!claimed.count) throw new GoneException("This invitation has already been used");
      // Existing members keep their role; an invitation must never demote an owner.
      await tx.workspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId: request.identity.user.id } },
        create: { workspaceId: invitation.workspaceId, userId: request.identity.user.id, role: invitation.role },
        update: {},
      });
      return { workspaceId: invitation.workspaceId };
    });
  }

  @Delete("workspaces/:id/members/:userId")
  async remove(@Param("id") id: string, @Param("userId") userId: string, @Req() request: AuthenticatedRequest) {
    await this.access.workspace(id, request.identity.user.id, "manageMembers");
    const member = await this.db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: id, userId } } });
    if (member?.role === "OWNER") throw new ForbiddenException("The workspace owner cannot be removed");
    await this.db.workspaceMember.deleteMany({ where: { workspaceId: id, userId } });
    return { ok: true };
  }
}

@Module({ controllers: [WorkspacesController], providers: [AccessService], exports: [AccessService] })
export class WorkspacesModule {}
