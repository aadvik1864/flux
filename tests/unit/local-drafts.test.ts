import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { allowAccountDrafts, clearAccountDrafts, LocalDraftWriter, MAX_DRAFT_BYTES, readLocalDrafts, removeLocalDraft, validateLocalDraft, writeLocalDraft, type LocalDraft } from "../../apps/web/lib/local-drafts";

function draft(overrides: Partial<LocalDraft> = {}): LocalDraft {
  return { id: "tab-one", userId: "account-one", fileId: "file-one", branchId: "main-one", fileName: "Proposal", generation: 0, schemaVersion: 1, version: 1, updatedAt: Date.now(), state: new Uint8Array([1, 2, 3]), ...overrides };
}

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory()); vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  allowAccountDrafts("account-one"); allowAccountDrafts("account-two");
});

describe("browser draft storage", () => {
  it("persists copies separately by account, document, tab, and generation", async () => {
    await Promise.all([
      writeLocalDraft(draft()), writeLocalDraft(draft({ id: "tab-two", generation: 1 })),
      writeLocalDraft(draft({ id: "other-user", userId: "account-two" })),
      writeLocalDraft(draft({ id: "other-file", fileId: "file-two" })),
    ]);
    const stored = await readLocalDrafts("account-one", "file-one");
    expect(stored).toHaveLength(2); expect(stored.map(value => value.generation).sort()).toEqual([0, 1]);
    expect(stored[0].state).toEqual(new Uint8Array([1, 2, 3]));
    expect(await readLocalDrafts("account-two", "file-one")).toHaveLength(1);
  });
  it("does not let a stale acknowledgement erase a newer version", async () => {
    await writeLocalDraft(draft({ version: 2 }));
    await writeLocalDraft(draft({ version: 1, state: new Uint8Array([9]) }));
    await removeLocalDraft("tab-one", 1);
    expect((await readLocalDrafts("account-one", "file-one"))[0].version).toBe(2);
    await removeLocalDraft("tab-one", 2);
    expect(await readLocalDrafts("account-one", "file-one")).toEqual([]);
  });
  it("serializes writes and acknowledgements without affecting another tab", async () => {
    const { state: _state, version: _version, updatedAt: _updated, schemaVersion: _schema, ...metadata } = draft();
    const writer = new LocalDraftWriter(metadata);
    await writeLocalDraft(draft({ id: "tab-two" }));
    await Promise.all([writer.save(new Uint8Array([1]), 1), writer.save(new Uint8Array([2]), 2), writer.acknowledge(1)]);
    expect((await readLocalDrafts("account-one", "file-one")).find(value => value.id === "tab-one")?.state).toEqual(new Uint8Array([2]));
    await writer.acknowledge(2);
    expect((await readLocalDrafts("account-one", "file-one")).map(value => value.id)).toEqual(["tab-two"]);
  });
  it("refuses full storage instead of silently evicting unsaved work", async () => {
    for (let index = 0; index < 4; index += 1) await writeLocalDraft(draft({ id: `full-${index}`, state: new Uint8Array(MAX_DRAFT_BYTES) }));
    await expect(writeLocalDraft(draft())).rejects.toThrow("space is full");
    expect(await readLocalDrafts("account-one", "file-one")).toHaveLength(4);
  });
  it("clears an earlier backup covered by a later durable acknowledgement", async () => {
    const { state: _state, version: _version, updatedAt: _updated, schemaVersion: _schema, ...metadata } = draft();
    const writer = new LocalDraftWriter(metadata);
    await writer.save(new Uint8Array([1]), 1); await writer.acknowledge(3);
    expect(await readLocalDrafts("account-one", "file-one")).toHaveLength(0);
  });
  it("coalesces queued snapshots without reporting a failed latest copy as saved", async () => {
    const { state: _state, version: _version, updatedAt: _updated, schemaVersion: _schema, ...metadata } = draft();
    const writer = new LocalDraftWriter(metadata);
    const open = vi.spyOn(indexedDB, "open");
    await Promise.all([writer.save(new Uint8Array([1]), 1), writer.save(new Uint8Array([2]), 2)]);
    expect(open).toHaveBeenCalledOnce();
    expect((await readLocalDrafts("account-one", "file-one"))[0].state).toEqual(new Uint8Array([2]));
    vi.stubGlobal("indexedDB", undefined);
    const results = await Promise.allSettled([writer.save(new Uint8Array([3]), 3), writer.save(new Uint8Array([4]), 4)]);
    expect(results.map(result => result.status)).toEqual(["rejected", "rejected"]);
  });
  it("rejects invalid formats and oversized recovery data", () => {
    for (const value of [draft({ generation: -1 }), draft({ schemaVersion: 99 }), draft({ version: 0 }), draft({ updatedAt: Number.MAX_SAFE_INTEGER }), draft({ state: new Uint8Array(MAX_DRAFT_BYTES + 1) })]) expect(() => validateLocalDraft(value)).toThrow();
  });
  it("clears only the signed-out account and blocks late writes", async () => {
    await writeLocalDraft(draft()); await writeLocalDraft(draft({ id: "other", userId: "account-two" }));
    const late = writeLocalDraft(draft({ id: "late" }));
    const results = await Promise.allSettled([late, clearAccountDrafts("account-one")]);
    expect(results[1].status).toBe("fulfilled");
    expect(await readLocalDrafts("account-one", "file-one")).toHaveLength(0);
    await expect(writeLocalDraft(draft())).rejects.toThrow("signed out");
    expect(await readLocalDrafts("account-two", "file-one")).toHaveLength(1);
  });
  it("reports unavailable browser storage without claiming persistence", async () => {
    vi.stubGlobal("indexedDB", undefined);
    await expect(writeLocalDraft(draft())).rejects.toThrow("unavailable");
  });
});
