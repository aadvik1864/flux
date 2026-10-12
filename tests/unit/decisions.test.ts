import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { blockIdentities, inspectDocumentState, yDocFromContent } from "@flux/document-model";
import { can } from "@flux/shared";
import { anchorAvailable, decisionInput, messageInput } from "../../apps/api/src/discussion-policy";

const content = { type: "doc", content: [{ type: "paragraph", attrs: { blockId: "proposal" }, content: [{ type: "text", text: "Original proposal" }] }] };
const requestId = "240d2424-8e55-4b27-a0db-209c9e2222e1";

describe("discussion inputs and permissions", () => {
  it("permits participants but keeps viewers read-only", () => {
    for (const role of ["OWNER", "ADMIN", "EDITOR", "REVIEWER"] as const) expect(can(role, "discuss")).toBe(true);
    expect(can("VIEWER", "discuss")).toBe(false);
  });
  it("trims text, rejects empty/NUL/unbounded messages, and requires a retry ID", () => {
    expect(messageInput.parse({ body: "  A choice to discuss  ", requestId }).body).toBe("A choice to discuss");
    for (const body of [" ", "x".repeat(4001), "text\0"]) expect(messageInput.safeParse({ body, requestId }).success).toBe(false);
    expect(messageInput.safeParse({ body: "hello" }).success).toBe(false);
  });
  it("requires a bounded explanation, saved checkpoint, and block reference", () => {
    const valid = { title: "Budget choice", explanation: "The team agreed this fits our limit.", checkpointId: requestId, blockId: "proposal", requestId };
    expect(decisionInput.safeParse(valid).success).toBe(true);
    for (const patch of [{ title: "" }, { explanation: "" }, { blockId: "" }, { checkpointId: "not-saved" }, { explanation: "x".repeat(4001) }, { title: "invalid\0" }]) expect(decisionInput.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
});

describe("decision anchor identity", () => {
  it("decodes content and identities through one bounded module boundary", () => {
    const document = yDocFromContent(content), state = Y.encodeStateAsUpdate(document);
    const inspected = inspectDocumentState(state);
    expect(inspected.content).toEqual(content); expect(inspected.identities).toEqual(blockIdentities(document));
    expect(() => inspectDocumentState(new Uint8Array(8 * 1024 * 1024 + 1))).toThrow(/8 MiB/);
    expect(() => inspectDocumentState(new Uint8Array([255]))).toThrow(); document.destroy();
  });
  it("keeps the same identity through ordinary text edits and replica round-trips", () => {
    const document = yDocFromContent(content), original = blockIdentities(document).get("proposal")!;
    ((document.getXmlFragment("default").get(0) as Y.XmlElement).get(0) as Y.XmlText).insert(0, "Revised ");
    const replica = new Y.Doc(); Y.applyUpdate(replica, Y.encodeStateAsUpdate(document));
    expect(blockIdentities(replica).get("proposal")).toBe(original);
    document.destroy(); replica.destroy();
  });
  it("never reattaches to a newly created block with a copied stable ID", () => {
    const document = yDocFromContent(content), original = blockIdentities(document).get("proposal")!;
    const fragment = document.getXmlFragment("default"); fragment.delete(0, 1);
    const other = new Y.XmlElement("paragraph"); other.setAttribute("blockId", "proposal"); fragment.insert(0, [other]);
    expect(blockIdentities(document).get("proposal")).not.toBe(original);
    expect(anchorAvailable({ anchorGeneration: 0, anchorIdentity: original, blockId: "proposal", unavailableAt: null }, { generation: 0, archivedAt: null }, blockIdentities(document))).toBe(false);
    document.destroy();
  });
  it("fences restores and backup rollback, while retaining an unchanged archived experiment", () => {
    const bookmark = { anchorGeneration: 0, anchorIdentity: "1:2", blockId: "proposal", unavailableAt: null }, index = new Map([["proposal", "1:2"]]);
    expect(anchorAvailable(bookmark, { generation: 0, archivedAt: null }, index)).toBe(true);
    expect(anchorAvailable(bookmark, { generation: 1, archivedAt: null }, index)).toBe(false);
    expect(anchorAvailable(bookmark, { generation: 1, archivedAt: new Date() }, index)).toBe(true);
    expect(anchorAvailable(bookmark, { generation: 2, archivedAt: new Date() }, index)).toBe(false);
    expect(anchorAvailable({ ...bookmark, unavailableAt: new Date() }, { generation: 0, archivedAt: null }, index)).toBe(false);
  });
  it("includes nested block identities and rejects duplicate IDs", () => {
    const document = yDocFromContent({ type: "doc", content: [{ type: "blockquote", attrs: { blockId: "quote" }, content: content.content }] });
    expect([...blockIdentities(document).keys()]).toEqual(["quote", "proposal"]);
    const fragment = document.getXmlFragment("default"), duplicate = new Y.XmlElement("paragraph"); duplicate.setAttribute("blockId", "proposal"); fragment.insert(1, [duplicate]);
    expect(() => blockIdentities(document)).toThrow(/duplicate/); document.destroy();
  });
});
