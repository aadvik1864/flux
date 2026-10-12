import { Body, Controller, Get, HttpException, Inject, Module, NotFoundException, Param, Post, Req, ServiceUnavailableException, UseGuards } from "@nestjs/common";
import type { Branch, MergeApproval } from "@prisma/client";
import jwt from "jsonwebtoken";
import { z } from "zod";
import type { DocumentContent, ExperimentSummary, HistoryHead, MergeApprovalSummary, MergePreview, MergeResult, Permission } from "@flux/shared";
import { validateDocument } from "@flux/document-model";
import { digest } from "@flux/storage";
import { Database } from "./database";
import { SessionGuard, type AuthenticatedRequest } from "./auth";
import { AccessService, WorkspacesModule } from "./workspaces";
import { env } from "./config";
import { input } from "./validation";

const head = z.object({ generation: z.number().int().nonnegative(), revision: z.number().int().nonnegative(), contentHash: z.string().regex(/^[a-f0-9]{64}$/) });
const summary = (branch: Branch): ExperimentSummary => ({ id: branch.id, name: branch.name, baseCheckpointId: branch.baseCheckpointId!, createdById: branch.createdById, createdByName: branch.createdByName, createdAt: branch.createdAt.toISOString(), archivedAt: branch.archivedAt?.toISOString() ?? null });
const approvalSummary = (approval: MergeApproval): MergeApprovalSummary => ({ id: approval.id, approvedById: approval.approvedById, approvedByName: approval.approvedByName, createdAt: approval.createdAt.toISOString(), sourceHead: head.parse(approval.sourceHead) as HistoryHead, mainHead: head.parse(approval.mainHead) as HistoryHead, resultHash: approval.resultHash });

@Controller("files/:fileId/branches")
@UseGuards(SessionGuard)
class BranchesController {
  constructor(@Inject(Database) private readonly db: Database, @Inject(AccessService) private readonly access: AccessService) {}
  private async file(fileId: string, request: AuthenticatedRequest, permission?: Permission) {
    const file = await this.db.file.findUnique({ where: { id: fileId } });
    if (!file?.mainBranchId) throw new NotFoundException("Document not found");
    await this.access.workspace(file.workspaceId, request.identity.user.id, permission); return file;
  }
  private async call<T>(command: Record<string, unknown>, request: AuthenticatedRequest): Promise<T> {
    const body = JSON.stringify(command);
    const token = jwt.sign({ commandHash: digest(body), sessionId: request.identity.sessionId }, env.COLLABORATION_SECRET, { subject: request.identity.user.id, issuer: "flux-api", audience: "flux-branches", algorithm: "HS256", expiresIn: "45s" });
    let response: Response;
    try { response = await fetch(`${env.COLLABORATION_INTERNAL_URL}/internal/branches`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(40_000) }); }
    catch { throw new ServiceUnavailableException("Branch review is unavailable. Keep editing or retry the same action"); }
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new HttpException(result?.message ?? "The branch action could not be confirmed", response.status);
    return result as T;
  }
  @Get()
  async list(@Param("fileId") fileId: string, @Req() request: AuthenticatedRequest) {
    await this.file(fileId, request);
    return (await this.db.branch.findMany({ where: { fileId, baseCheckpointId: { not: null } }, orderBy: { createdAt: "desc" }, take: 100 })).map(summary);
  }
  @Post()
  async fork(@Param("fileId") fileId: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<ExperimentSummary> {
    await this.file(fileId, request, "branch");
    const data = input(z.object({ name: z.string().trim().min(1).max(60).refine(value => !/^main$/i.test(value), "Choose an experiment name other than main"), checkpointId: z.uuid(), requestId: z.uuid() }), body);
    return this.call({ operation: "fork", fileId, ...data }, request);
  }
  @Get(":branchId")
  async detail(@Param("fileId") fileId: string, @Param("branchId") branchId: string, @Req() request: AuthenticatedRequest) {
    await this.file(fileId, request);
    const branch = await this.db.branch.findFirst({ where: { id: branchId, fileId, baseCheckpointId: { not: null } }, include: { approvals: { where: { supersededAt: null }, orderBy: { createdAt: "desc" }, take: 10 } } });
    if (!branch) throw new NotFoundException("Experiment not found");
    return { ...summary(branch), approvals: branch.approvals.map(approvalSummary) };
  }
  @Get(":branchId/compare")
  async compare(@Param("fileId") fileId: string, @Param("branchId") branchId: string, @Req() request: AuthenticatedRequest): Promise<MergePreview> {
    await this.file(fileId, request); return this.call({ operation: "compare", fileId, branchId }, request);
  }
  @Post(":branchId/approvals")
  async approve(@Param("fileId") fileId: string, @Param("branchId") branchId: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<MergeApprovalSummary> {
    await this.file(fileId, request, "review");
    const data = input(z.object({ requestId: z.uuid(), sourceHead: head, mainHead: head, resolutions: z.record(z.string().min(1).max(100), z.enum(["main", "experiment", "delete"])).refine(value => Object.keys(value).length <= 1000), order: z.array(z.string().min(1).max(100)).max(1000).optional() }), body);
    return this.call({ operation: "approve", fileId, branchId, ...data }, request);
  }
  @Get(":branchId/approvals/:approvalId")
  async approvedResult(@Param("fileId") fileId: string, @Param("branchId") branchId: string, @Param("approvalId") approvalId: string, @Req() request: AuthenticatedRequest) {
    await this.file(fileId, request);
    const approval = await this.db.mergeApproval.findFirst({ where: { id: approvalId, branchId, branch: { fileId }, supersededAt: null } });
    if (!approval?.resultContent) throw new NotFoundException("Current approval not found");
    try {
      const content = validateDocument(approval.resultContent as unknown as DocumentContent);
      if (digest(JSON.stringify(content)) !== approval.resultHash) throw new Error("Invalid result hash");
      return { ...approvalSummary(approval), content };
    } catch { throw new ServiceUnavailableException("This approved result could not be verified"); }
  }
  @Post(":branchId/merge")
  async merge(@Param("fileId") fileId: string, @Param("branchId") branchId: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<MergeResult> {
    await this.file(fileId, request, "merge");
    const data = input(z.object({ approvalId: z.uuid(), requestId: z.uuid() }), body);
    return this.call({ operation: "merge", fileId, branchId, ...data }, request);
  }
}

@Module({ imports: [WorkspacesModule], controllers: [BranchesController] })
export class BranchesModule {}
