import { z } from "zod";

export const messageInput = z.object({ body: z.string().trim().min(1).max(4000).refine(value => !value.includes("\0"), "Messages cannot contain NUL characters"), requestId: z.uuid() });
export const decisionInput = z.object({
  title: z.string().trim().min(1).max(120), explanation: z.string().trim().min(1).max(4000),
  checkpointId: z.uuid(), blockId: z.string().min(1).max(100), discussionMessageId: z.uuid().optional(), requestId: z.uuid(),
}).refine(value => !value.title.includes("\0") && !value.explanation.includes("\0") && !value.blockId.includes("\0"), "Decision text cannot contain NUL characters");

export function anchorAvailable(bookmark: { anchorGeneration: number; anchorIdentity: string; blockId: string; unavailableAt: Date | null },
  branch: { generation: number; archivedAt: Date | null }, identities: Map<string, string>): boolean {
  if (bookmark.unavailableAt) return false;
  const sameGeneration = bookmark.anchorGeneration === branch.generation
    || Boolean(branch.archivedAt && bookmark.anchorGeneration + 1 === branch.generation);
  return sameGeneration && identities.get(bookmark.blockId) === bookmark.anchorIdentity;
}
