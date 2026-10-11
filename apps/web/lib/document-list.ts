import type { FileSummary } from "@flux/shared";

export type DocumentSort = "updated" | "name";

export function findDocuments(files: FileSummary[], query: string, sort: DocumentSort = "updated"): FileSummary[] {
  const term = query.trim().toLocaleLowerCase();
  return files.filter(file => file.name.toLocaleLowerCase().includes(term)).sort((a, b) => {
    const byName = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    return sort === "name" ? byName : Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || byName;
  });
}
