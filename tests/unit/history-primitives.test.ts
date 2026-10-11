import { describe, expect, it, vi } from "vitest";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { RoomGate } from "../../apps/collaboration/src/room-gate";
import { contentFromYDoc, validateDocument, yDocFromContent } from "@flux/document-model";
import { decodeSnapshot, digest, encodeSnapshot, SnapshotStorage, MAX_SNAPSHOT_BYTES, type SnapshotPayload } from "@flux/storage";
import { parseBranchRoom, branchRoom, type DocumentContent } from "@flux/shared";

const content: DocumentContent = { type: "doc", content: [
  { type: "heading", attrs: { blockId: "heading-one", level: 2 }, content: [{ type: "text", text: "Proposal" }] },
  { type: "paragraph", attrs: { blockId: "paragraph-one" }, content: [{ type: "text", text: "Shared work", marks: [{ type: "bold" }] }] },
  { type: "bulletList", attrs: { blockId: "list-one" }, content: [
    { type: "listItem", attrs: { blockId: "item-one" }, content: [{ type: "paragraph", attrs: { blockId: "paragraph-two" }, content: [{ type: "text", text: "Budget" }] }] },
  ] },
  { type: "table", attrs: { blockId: "table-one" }, content: [{ type: "tableRow", attrs: { blockId: "row-one" }, content: [
    { type: "tableCell", attrs: { blockId: "cell-one" }, content: [{ type: "paragraph", attrs: { blockId: "paragraph-three" }, content: [{ type: "text", text: "50,000" }] }] },
  ] }] },
] };

describe("versioned document schema", () => {
  it("round-trips formatted content, lists, tables, and stable block IDs", () => {
    const normalized = validateDocument(content);
    const document = yDocFromContent(normalized);
    expect(contentFromYDoc(document)).toEqual(normalized);
    document.destroy();
  });
  it("rejects duplicate or missing IDs", () => {
    expect(() => validateDocument({ type: "doc", content: [content.content![0], content.content![0]] })).toThrow(/unique/);
    expect(() => validateDocument({ type: "doc", content: [{ type: "paragraph" }] })).toThrow(/stable IDs/);
  });
  it("refuses unknown schema versions rather than guessing", () => {
    expect(() => validateDocument(content, 99)).toThrow(/unsupported/);
  });
  it("rejects unsupported nodes", () => {
    expect(() => validateDocument({ type: "doc", content: [{ type: "executable" }] })).toThrow();
  });
});

describe("immutable snapshot envelope", () => {
  const snapshot: SnapshotPayload = { format: "flux.document", schemaVersion: 1, content, yjsState: "AA==" };
  it("round-trips content with a verified checksum", () => {
    const bytes = encodeSnapshot(snapshot);
    expect(decodeSnapshot(bytes, digest(bytes))).toEqual(snapshot);
  });
  it("detects modified objects", () => {
    const bytes = encodeSnapshot(snapshot);
    const corrupted = Buffer.from(bytes); corrupted[10] ^= 1;
    expect(() => decodeSnapshot(corrupted, digest(bytes))).toThrow(/integrity/);
  });
  it("enforces a bounded snapshot size", () => {
    expect(() => decodeSnapshot(new Uint8Array(MAX_SNAPSHOT_BYTES + 1), "unused")).toThrow();
    expect(() => encodeSnapshot({ ...snapshot, yjsState: "x".repeat(MAX_SNAPSHOT_BYTES) })).toThrow(/limit/);
  });
  it("uses conditional create, never an object overwrite", async () => {
    const storage = new SnapshotStorage({ S3_ACCESS_KEY: "test", S3_SECRET_KEY: "unit-test-secret" });
    const send = vi.spyOn(storage.client, "send").mockResolvedValue({} as never);
    await storage.put("workspace/file/checkpoint.json", snapshot);
    const command = send.mock.calls.map(call => call[0]).find(command => command instanceof PutObjectCommand) as PutObjectCommand;
    expect(command.input.IfNoneMatch).toBe("*");
    expect(command.input.Key).toBe("workspace/file/checkpoint.json");
    storage.client.destroy();
  });
});

describe("history barrier", () => {
  it("serializes live messages and history operations in FIFO order", async () => {
    const gate = new RoomGate();
    const release = await gate.acquire("main");
    const order: string[] = [];
    const edit = gate.run("main", async () => { order.push("edit"); });
    const checkpoint = gate.run("main", async () => { order.push("checkpoint"); });
    expect(order).toEqual([]);
    release();
    await Promise.all([edit, checkpoint]);
    expect(order).toEqual(["edit", "checkpoint"]);
  });
  it("releases the barrier after failed operations", async () => {
    const gate = new RoomGate();
    await expect(gate.run("main", async () => { throw new Error("unavailable"); })).rejects.toThrow("unavailable");
    await expect(gate.run("main", async () => "next")).resolves.toBe("next");
  });
  it("fences room generations without confusing the branch identity", () => {
    expect(branchRoom("file-main", 0)).not.toBe(branchRoom("file-main", 1));
    expect(parseBranchRoom(branchRoom("file-main", 2))).toEqual({ branchId: "file-main", generation: 2 });
    expect(() => parseBranchRoom("branch:main")).toThrow();
  });
});
