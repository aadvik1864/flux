export const roles = ["OWNER", "ADMIN", "EDITOR", "REVIEWER", "VIEWER"] as const;
export type Role = (typeof roles)[number];
export type Permission = "edit" | "branch" | "review" | "merge" | "manageMembers";

const grants: Record<Role, readonly Permission[]> = {
  OWNER: ["edit", "branch", "review", "merge", "manageMembers"],
  ADMIN: ["edit", "branch", "review", "merge", "manageMembers"],
  EDITOR: ["edit", "branch"],
  REVIEWER: ["review", "merge"],
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

export type CheckpointKind = "MANUAL" | "BEFORE_RESTORE" | "RESTORE";
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
