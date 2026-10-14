import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@vercel/blob", () => ({ put: vi.fn(), get: vi.fn(), list: vi.fn() }));
import { put, get, list } from "@vercel/blob";
import { SnapshotStorage, digest, MAX_SNAPSHOT_BYTES, type SnapshotPayload } from "../../packages/storage/src/index";
const snapshot: SnapshotPayload = { format: "flux.document", schemaVersion: 1, content: { type: "doc", content: [] }, yjsState: "" };
const token = "test-token-" + "a".repeat(40);
const storage = () => new SnapshotStorage({ SNAPSHOT_STORAGE: "vercel-blob", BLOB_READ_WRITE_TOKEN: token });
beforeEach(() => vi.clearAllMocks());
describe("private Blob checkpoints", () => {
  it("writes immutable private snapshots with stable keys and a checksum", async () => {
    vi.mocked(put).mockResolvedValue({} as never);
    const result = await storage().put("checkpoints/one.json", snapshot);
    expect(put).toHaveBeenCalledWith("checkpoints/one.json", expect.any(Buffer), expect.objectContaining({ access: "private", addRandomSuffix: false, allowOverwrite: false }));
    expect(result.checksum).toBe(digest(JSON.stringify(snapshot)));
  });
  it("verifies integrity after an authenticated private read", async () => {
    const bytes = Buffer.from(JSON.stringify(snapshot));
    vi.mocked(get).mockResolvedValue({ statusCode: 200, blob: { size: bytes.length }, stream: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }) } as never);
    expect(await storage().get("checkpoints/one.json", digest(bytes))).toEqual(snapshot);
    expect(get).toHaveBeenCalledWith("checkpoints/one.json", expect.objectContaining({ access: "private", useCache: false }));
  });
  it("rejects missing and oversized checkpoints before reading their contents", async () => {
    vi.mocked(get).mockResolvedValue(null);
    await expect(storage().get("missing", "bad")).rejects.toThrow("missing");
    vi.mocked(get).mockResolvedValue({ statusCode: 200, blob: { size: MAX_SNAPSHOT_BYTES + 1 } } as never);
    await expect(storage().get("large", "bad")).rejects.toThrow("too large");
  });
  it("checks authenticated storage access without exposing a public file", async () => {
    vi.mocked(list).mockResolvedValue({ blobs: [] } as never);
    await storage().ready();
    expect(list).toHaveBeenCalledWith({ token, limit: 1 });
  });
});
