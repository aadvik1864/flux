import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { analyzeMerge, resolveMerge, prepareContentUpdate, validateDocument, contentFromYDoc, yDocFromContent } from "@flux/document-model";
import type { DocumentContent } from "@flux/shared";

const paragraph = (id: string, text: string): DocumentContent => ({ type: "paragraph", attrs: { blockId: id }, content: [{ type: "text", text }] });
const doc = (...blocks: DocumentContent[]): DocumentContent => validateDocument({ type: "doc", content: blocks });
const base = doc(paragraph("a", "Original introduction"), paragraph("b", "Original budget"), paragraph("c", "Original conclusion"));

describe("conservative stable-block merging", () => {
  it("preserves main-only changes and proposes independent experiment edits", () => {
    const main = doc(paragraph("a", "Introduction on main"), ...base.content!.slice(1));
    const experiment = doc(base.content![0], paragraph("b", "Budget experiment"), base.content![2]);
    expect(analyzeMerge(base, main, experiment).result).toEqual(doc(main.content![0], experiment.content![1], base.content![2]));
    expect(analyzeMerge(base, main, experiment).conflicts).toEqual([]);
  });
  it("requires an explicit decision for competing edits and rejects unknown choices", () => {
    const main = doc(paragraph("a", "Main introduction"), ...base.content!.slice(1));
    const source = doc(paragraph("a", "Other introduction"), ...base.content!.slice(1));
    expect(analyzeMerge(base, main, source).unresolved).toEqual(["a"]);
    expect(() => resolveMerge(base, main, source, {})).toThrow(/Resolve all/);
    expect(resolveMerge(base, main, source, { a: "experiment" })).toEqual(source);
    expect(resolveMerge(base, main, source, { a: "main" })).toEqual(main);
    expect(resolveMerge(base, main, source, { a: "delete" }).content).toEqual(base.content!.slice(1));
    expect(() => resolveMerge(base, main, source, { b: "main" })).toThrow(/non-conflicting/);
    expect(() => resolveMerge(base, main, source, { a: "arbitrary" as never })).toThrow(/Invalid/);
  });
  it("never treats an edit/delete conflict as an automatic deletion", () => {
    const main = doc(paragraph("a", "Changed on main"), ...base.content!.slice(1));
    const source = doc(...base.content!.slice(1));
    expect(analyzeMerge(base, main, source).conflicts[0].reason).toBe("EDIT_DELETE");
    expect(analyzeMerge(base, source, main).conflicts[0].reason).toBe("EDIT_DELETE");
    expect(resolveMerge(base, main, source, { a: "main" })).toEqual(main);
  });
  it("merges single-side additions and deletions when their order is unambiguous", () => {
    const source = doc(base.content![0], paragraph("new", "Inserted"), base.content![1], base.content![2]);
    expect(resolveMerge(base, base, source, {})).toEqual(source);
    const deletion = doc(...base.content!.slice(1));
    expect(resolveMerge(base, base, deletion, {})).toEqual(deletion);
    expect(resolveMerge(base, deletion, base, {})).toEqual(deletion);
  });
  it("requires explicit ordering for simultaneous insertions or moved blocks", () => {
    const main = doc(base.content![0], paragraph("main-new", "Main insertion"), ...base.content!.slice(1));
    const source = doc(base.content![0], paragraph("source-new", "Other insertion"), ...base.content!.slice(1));
    expect(analyzeMerge(base, main, source).orderConflict).toBe(true);
    expect(() => resolveMerge(base, main, source, {})).toThrow(/explicit block order/);
    const order = ["a", "source-new", "main-new", "b", "c"];
    expect(resolveMerge(base, main, source, {}, order).content!.map(node => node.attrs!.blockId)).toEqual(order);
    expect(() => resolveMerge(base, main, source, {}, ["a", "b", "c"])).toThrow(/every retained/);
    expect(() => resolveMerge(base, main, source, {}, ["a", "a", "main-new", "b", "c"])).toThrow(/every retained/);
    const moved = doc(base.content![1], base.content![0], base.content![2]);
    expect(analyzeMerge(base, base, moved).orderConflict).toBe(true);
  });
  it("requires review of experiment-side list/table structures without flattening them", () => {
    const list: DocumentContent = { type: "bulletList", attrs: { blockId: "list" }, content: [{ type: "listItem", attrs: { blockId: "item" }, content: [paragraph("nested", "List choice")] }] };
    const source = doc(...base.content!, list);
    const analysis = analyzeMerge(base, base, source);
    expect(analysis.conflicts).toEqual([{ blockId: "list", reason: "STRUCTURE" }]);
    expect(resolveMerge(base, base, source, { list: "experiment" })).toEqual(source);
    expect(resolveMerge(base, source, base, {})).toEqual(source);
  });
  it("refuses duplicate IDs, unbounded reviews, and an empty merged document", () => {
    expect(() => analyzeMerge(base, { type: "doc", content: [paragraph("a", "one"), paragraph("a", "two")] }, base)).toThrow(/unique/);
    expect(() => analyzeMerge(base, { type: "doc", content: Array.from({ length: 1001 }, (_, index) => paragraph(String(index), "block")) }, base)).toThrow(/1,000/);
    const one = doc(paragraph("a", "base")), main = doc(paragraph("a", "main")), source = doc(paragraph("a", "source"));
    expect(() => resolveMerge(one, main, source, { a: "delete" })).toThrow(/at least one/);
  });
  it("does not use inherited properties as conflict resolutions", () => {
    const before = doc(paragraph("constructor", "base")), main = doc(paragraph("constructor", "main")), source = doc(paragraph("constructor", "source"));
    expect(analyzeMerge(before, main, source).unresolved).toEqual(["constructor"]);
  });
});

describe("incremental approved-result updates", () => {
  it("prepares without changing main, updates connected replicas, and is idempotent", () => {
    const main = yDocFromContent(base), connected = new Y.Doc();
    Y.applyUpdate(connected, Y.encodeStateAsUpdate(main));
    const desired = doc(base.content![0], paragraph("b", "Approved budget"), base.content![2]);
    const prepared = prepareContentUpdate(main, desired);
    expect(contentFromYDoc(main)).toEqual(base);
    Y.applyUpdate(main, prepared.update); Y.applyUpdate(connected, prepared.update); Y.applyUpdate(connected, prepared.update);
    expect(contentFromYDoc(main)).toEqual(desired); expect(contentFromYDoc(connected)).toEqual(desired);
    const recovered = new Y.Doc(); Y.applyUpdate(recovered, prepared.state); expect(contentFromYDoc(recovered)).toEqual(desired);
    main.destroy(); connected.destroy(); recovered.destroy();
  });
  it("preserves CRDT identities and unsent edits to an unaffected main block", () => {
    const main = yDocFromContent(base), offline = new Y.Doc();
    Y.applyUpdate(offline, Y.encodeStateAsUpdate(main));
    const original = Y.encodeStateVector(main);
    const first = offline.getXmlFragment("default").get(0) as Y.XmlElement;
    (first.get(0) as Y.XmlText).insert(0, "Unsent main note. ");
    const desired = doc(base.content![0], paragraph("b", "Approved budget"), base.content![2]);
    const prepared = prepareContentUpdate(main, desired);
    Y.applyUpdate(main, prepared.update); Y.applyUpdate(offline, prepared.update);
    Y.applyUpdate(main, Y.encodeStateAsUpdate(offline, original));
    expect(contentFromYDoc(main)).toEqual(contentFromYDoc(offline));
    expect(JSON.stringify(contentFromYDoc(main))).toContain("Unsent main note.");
    expect(JSON.stringify(contentFromYDoc(main))).toContain("Approved budget");
    expect((main.getXmlFragment("default").get(0) as Y.XmlElement)._item!.id).toEqual(first._item!.id);
    main.destroy(); offline.destroy();
  });
});
