import { describe, expect, it } from "vitest";
import type { FileSummary } from "@flux/shared";
import { findDocuments } from "../../apps/web/lib/document-list";

const files: FileSummary[] = [
  { id: "z", name: "Proposal 10", mainBranchId: "branch-z", updatedAt: "2026-10-09T10:00:00Z" },
  { id: "a", name: "proposal 2", mainBranchId: "branch-a", updatedAt: "2026-10-10T10:00:00Z" },
  { id: "b", name: "Budget", mainBranchId: "branch-b", updatedAt: "2026-10-10T10:00:00Z" },
];

describe("document navigation", () => {
  it("filters by trimmed, case-insensitive name", () => {
    expect(findDocuments(files, " PROPOSAL ").map(file => file.id)).toEqual(["a", "z"]);
    expect(findDocuments(files, "missing")).toEqual([]);
  });
  it("sorts by recent edits with a deterministic name tie-breaker", () => {
    expect(findDocuments(files, "").map(file => file.id)).toEqual(["b", "a", "z"]);
  });
  it("sorts names naturally and leaves the source list unchanged", () => {
    const original = [...files];
    expect(findDocuments(files, "", "name").map(file => file.id)).toEqual(["b", "a", "z"]);
    expect(files).toEqual(original);
  });
  it("handles empty lists and whitespace-only searches", () => {
    expect(findDocuments([], "")).toEqual([]);
    expect(findDocuments(files, "   ")).toHaveLength(3);
  });
});
