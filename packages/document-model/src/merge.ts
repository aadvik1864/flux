import type { BlockResolution, DocumentContent, MergeAnalysis } from "@flux/shared";

const simpleBlocks = new Set(["paragraph", "heading", "codeBlock", "horizontalRule"]);
const equal = (a: DocumentContent | undefined, b: DocumentContent | undefined) => JSON.stringify(a) === JSON.stringify(b);

function blocks(document: DocumentContent) {
  if (document.type !== "doc" || !Array.isArray(document.content) || document.content.length > 1000) throw new Error("Merge review supports at most 1,000 top-level document blocks");
  const result = new Map<string, DocumentContent>();
  for (const block of document.content) {
    const id = block.attrs?.blockId;
    if (typeof id !== "string" || !id || result.has(id)) throw new Error("Merge review needs unique stable block IDs");
    result.set(id, block);
  }
  return result;
}

function ordered(ids: Set<string>, sequences: string[][]): string[] | null {
  const edges = new Map([...ids].map(id => [id, new Set<string>()]));
  const incoming = new Map([...ids].map(id => [id, 0]));
  for (const sequence of sequences) {
    const retained = sequence.filter(id => ids.has(id));
    for (let index = 1; index < retained.length; index += 1) {
      const previous = retained[index - 1], next = retained[index];
      if (!edges.get(previous)!.has(next)) { edges.get(previous)!.add(next); incoming.set(next, incoming.get(next)! + 1); }
    }
  }
  const result: string[] = [];
  const remaining = new Set(ids);
  while (remaining.size) {
    const available = [...remaining].filter(id => incoming.get(id) === 0);
    // Neither cycles nor multiple possible orders are resolved by an arbitrary sort.
    if (available.length !== 1) return null;
    const id = available[0]; result.push(id); remaining.delete(id);
    for (const next of edges.get(id)!) incoming.set(next, incoming.get(next)! - 1);
  }
  return result;
}

/** Conservative top-level, stable-block three-way comparison; callers validate schema. */
export function analyzeMerge(base: DocumentContent, main: DocumentContent, experiment: DocumentContent,
  resolutions: Record<string, BlockResolution> = {}, explicitOrder?: string[]): MergeAnalysis {
  const b = blocks(base), m = blocks(main), s = blocks(experiment);
  const ids = new Set([...b.keys(), ...m.keys(), ...s.keys()]);
  const chosen = new Map<string, DocumentContent>();
  const conflicts: MergeAnalysis["conflicts"] = [];
  for (const id of ids) {
    const before = b.get(id), target = m.get(id), source = s.get(id);
    let node: DocumentContent | undefined;
    let reason: MergeAnalysis["conflicts"][number]["reason"] | undefined;
    if (equal(target, source)) node = target;
    else if (equal(source, before)) node = target;
    else if (equal(target, before) && [before, source].every(value => !value || simpleBlocks.has(value.type))) node = source;
    else reason = equal(target, before) ? "STRUCTURE" : !target || !source ? "EDIT_DELETE" : "EDIT_EDIT";
    if (reason) {
      const resolution = Object.hasOwn(resolutions, id) ? resolutions[id] : undefined;
      if (resolution && !["main", "experiment", "delete"].includes(resolution)) throw new Error("Invalid block resolution");
      conflicts.push({ blockId: id, reason, ...(resolution ? { resolution } : {}) });
      node = resolution === "main" ? target : resolution === "experiment" ? source : undefined;
    }
    if (node) chosen.set(id, node);
  }
  for (const id of Object.keys(resolutions)) if (!conflicts.some(conflict => conflict.blockId === id)) throw new Error("A resolution refers to an unknown or non-conflicting block");
  const unresolved = conflicts.filter(conflict => !conflict.resolution).map(conflict => conflict.blockId);
  const blockIds = [...chosen.keys()];
  const automaticOrder = ordered(new Set(blockIds), [[...m.keys()], [...s.keys()]]);
  let order = automaticOrder;
  if (explicitOrder) {
    if (explicitOrder.length !== chosen.size || new Set(explicitOrder).size !== chosen.size || explicitOrder.some(id => !chosen.has(id))) throw new Error("Explicit order must contain every retained block exactly once");
    order = explicitOrder;
  }
  return { base, main, experiment, conflicts, unresolved, orderConflict: !automaticOrder, blockIds,
    result: !unresolved.length && order && order.length ? { type: "doc", content: order.map(id => chosen.get(id)!) } : null };
}

export function resolveMerge(base: DocumentContent, main: DocumentContent, experiment: DocumentContent,
  resolutions: Record<string, BlockResolution>, order?: string[]): DocumentContent {
  const analysis = analyzeMerge(base, main, experiment, resolutions, order);
  if (analysis.unresolved.length) throw new Error("Resolve all conflicting blocks before approving");
  if (analysis.orderConflict && !order) throw new Error("Choose an explicit block order before approving");
  if (!analysis.result) throw new Error("Keep at least one document block in the merged result");
  return analysis.result;
}
