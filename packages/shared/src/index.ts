export const roles = ["OWNER", "ADMIN", "EDITOR", "REVIEWER", "VIEWER"] as const;
export type Role = (typeof roles)[number];
export type Permission = "edit" | "branch" | "review" | "merge" | "manageMembers" | "discuss";

const grants: Record<Role, readonly Permission[]> = {
  OWNER: ["edit", "branch", "review", "merge", "manageMembers", "discuss"],
  ADMIN: ["edit", "branch", "review", "merge", "manageMembers", "discuss"],
  EDITOR: ["edit", "branch", "discuss"],
  REVIEWER: ["review", "merge", "discuss"],
  VIEWER: [],
};

export function can(role: Role, permission: Permission): boolean {
  return grants[role].includes(permission);
}

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  color: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  description: string;
  role: Role;
  fileCount: number;
  memberCount: number;
}

export interface FileSummary {
  id: string;
  name: string;
  updatedAt: string;
  mainBranchId: string;
}

export interface WorkspaceDetail {
  id: string;
  name: string;
  description: string;
  role: Role;
  files: FileSummary[];
  members: { user: PublicUser; role: Role }[];
}

export interface FileDetail extends FileSummary {
  workspaceId: string;
  workspaceName: string;
  role: Role;
  generation: number;
  editingBranchId?: string;
  branchName?: string;
  branchArchived?: boolean;
}

export const presenceColors = ["#254edb", "#147d64", "#9b3e78", "#98641e", "#495a99"];

export function colorForUser(id: string): string {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return presenceColors[hash % presenceColors.length];
}

export function branchRoom(branchId: string, generation = 0): string {
  return `branch:${branchId}:${generation}`;
}

export function parseBranchRoom(room: string): { branchId: string; generation: number } {
  const match = /^branch:([a-zA-Z0-9_-]{1,100}):(\d{1,10})$/.exec(room);
  if (!match) throw new Error("Invalid collaboration room");
  const generation = Number(match[2]);
  if (!Number.isSafeInteger(generation)) throw new Error("Invalid collaboration generation");
  return { branchId: match[1], generation };
}

export type CheckpointKind = "MANUAL" | "BEFORE_RESTORE" | "RESTORE" | "BEFORE_MERGE" | "MERGE" | "MERGED_EXPERIMENT";
export const DOCUMENT_SCHEMA_VERSION = 1;

export interface DocumentContent {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocumentContent[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
}

export interface HistoryHead {
  generation: number;
  revision: number;
  contentHash: string;
}

export interface CheckpointSummary {
  id: string;
  number: number;
  title: string;
  kind: CheckpointKind;
  createdAt: string;
  createdByName: string;
  generation: number;
  revision: number;
  schemaVersion: number;
  sourceCheckpointId: string | null;
  preservedCheckpointId: string | null;
}

export interface CheckpointDetail extends CheckpointSummary {
  content: DocumentContent;
}

export interface CheckpointPage {
  checkpoints: CheckpointSummary[];
  nextCursor: string | null;
}

export interface RestoreResult {
  checkpoint: CheckpointSummary;
  preservedCheckpointId: string;
}

export interface ExperimentSummary {
  id: string; name: string; createdById: string | null; createdByName: string;
  createdAt: string; archivedAt: string | null; baseCheckpointId: string;
}
export type BlockResolution = "main" | "experiment" | "delete";
export interface MergeAnalysis {
  base: DocumentContent; main: DocumentContent; experiment: DocumentContent;
  conflicts: { blockId: string; reason: "EDIT_EDIT" | "EDIT_DELETE" | "STRUCTURE"; resolution?: BlockResolution }[];
  unresolved: string[]; orderConflict: boolean; blockIds: string[];
  result: DocumentContent | null;
}
export interface MergePreview extends MergeAnalysis {
  branch: ExperimentSummary; sourceHead: HistoryHead; mainHead: HistoryHead;
}
export interface MergeApprovalSummary {
  id: string; approvedById: string | null; approvedByName: string; createdAt: string;
  sourceHead: HistoryHead; mainHead: HistoryHead; resultHash: string;
}
export interface MergeResult extends RestoreResult { sourceCheckpointId: string; }

export interface DiscussionMessage {
  id: string; number: number; authorId: string | null; authorName: string;
  body: string; createdAt: string; deletedAt: string | null;
}
export interface DiscussionPage { messages: DiscussionMessage[]; hasOlder: boolean; }
export type DecisionStatus = "OPEN" | "DECIDED" | "SUPERSEDED";
export interface DecisionBookmark {
  id: string; number: number; title: string; explanation: string; status: DecisionStatus;
  createdById: string | null; createdByName: string; createdAt: string;
  branchId: string; checkpointId: string; blockId: string; discussionMessageId: string | null;
  anchorAvailable: boolean; unavailableAt: string | null;
}
export interface DecisionPage { bookmarks: DecisionBookmark[]; nextBefore: number | null; }
