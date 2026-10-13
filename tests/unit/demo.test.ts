import { describe, expect, it } from "vitest";
import { analyzeMerge, validateDocument } from "@flux/document-model";
import { demoDecision, demoDocuments, demoDiscussion } from "../../apps/web/lib/demo";

describe("public demo content", () => {
  it("uses valid documents with stable block IDs", () => {
    for (const content of Object.values(demoDocuments)) expect(validateDocument(content)).toEqual(content);
  });

  it("shows a real non-conflicting merge and preserves the main-only note", () => {
    const review = analyzeMerge(demoDocuments.base, demoDocuments.main, demoDocuments.experiment);
    expect(review.conflicts).toEqual([]);
    expect(review.orderConflict).toBe(false);
    expect(review.result).toEqual(demoDocuments.merged);
    expect(demoDocuments.merged.content.find(block => block.attrs?.blockId === "access")).toEqual(demoDocuments.main.content.find(block => block.attrs?.blockId === "access"));
  });

  it("links the decision to the original experiment paragraph", () => {
    const anchor = demoDocuments.experiment.content.find(block => block.attrs?.blockId === demoDecision.blockId);
    expect(anchor?.content?.[0].text).toContain("9:30 am");
    expect(demoDiscussion.map(message => message.name)).toEqual(["Ravi", "Hana"]);
    expect(demoDecision.checkpoint).toBe("Later opening proposal");
  });
});
