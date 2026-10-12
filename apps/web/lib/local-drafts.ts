import { DOCUMENT_SCHEMA_VERSION } from "@flux/shared";

export const DRAFT_DATABASE = "flux-local-drafts";
export const MAX_DRAFT_BYTES = 8 * 1024 * 1024;
export const MAX_ACCOUNT_DRAFT_BYTES = 32 * 1024 * 1024;
const MAX_BROWSER_DRAFT_BYTES = 64 * 1024 * 1024;
const MAX_DRAFTS = 64;
const blockedAccounts = new Set<string>();

export function allowAccountDrafts(userId: string) { blockedAccounts.delete(userId); }
export function blockAccountDrafts(userId: string) { blockedAccounts.add(userId); }

export type LocalDraft = {
  id: string; userId: string; fileId: string; branchId: string; fileName: string;
  generation: number; schemaVersion: number; version: number; updatedAt: number;
  state: Uint8Array;
};

function openDrafts(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("Browser backups are unavailable")); return; }
    const request = indexedDB.open(DRAFT_DATABASE, 1);
    let finished = false;
    const fail = (error: Error) => { if (!finished) { finished = true; clearTimeout(timer); reject(error); } };
    const timer = setTimeout(() => fail(new Error("Browser backup storage timed out")), 3000);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore("drafts", { keyPath: "id" });
      store.createIndex("account", "userId");
      store.createIndex("document", ["userId", "fileId"]);
    };
    request.onsuccess = () => {
      if (finished) { request.result.close(); return; }
      finished = true; clearTimeout(timer);
      request.result.onversionchange = () => request.result.close(); resolve(request.result);
    };
    request.onerror = () => fail(request.error ?? new Error("Browser backups are unavailable"));
    request.onblocked = () => fail(new Error("Close other Flux tabs to update browser backups"));
  });
}

export function validateLocalDraft(value: LocalDraft): LocalDraft {
  if (!value || [value.id, value.userId, value.fileId, value.branchId].some(id => typeof id !== "string" || !id || id.length > 200)
    || typeof value.fileName !== "string" || value.fileName.length > 120
    || !Number.isSafeInteger(value.generation) || value.generation < 0
    || !Number.isSafeInteger(value.version) || value.version < 1
    || !Number.isSafeInteger(value.updatedAt) || value.updatedAt < 0 || value.updatedAt > 8.64e15
    || value.schemaVersion !== DOCUMENT_SCHEMA_VERSION
    || !(value.state instanceof Uint8Array) || !value.state.byteLength || value.state.byteLength > MAX_DRAFT_BYTES) {
    throw new Error("A browser draft is damaged or uses an unsupported format");
  }
  return value;
}

export async function readLocalDrafts(userId: string, fileId: string): Promise<LocalDraft[]> {
  const db = await openDrafts();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("drafts", "readonly");
    const request = transaction.objectStore("drafts").index("document").getAll(IDBKeyRange.only([userId, fileId]));
    transaction.oncomplete = () => {
      db.close();
      try { resolve((request.result as LocalDraft[]).map(validateLocalDraft).sort((a, b) => b.updatedAt - a.updatedAt)); }
      catch (error) { reject(error); }
    };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
    transaction.onabort = transaction.onerror;
  });
}

export async function writeLocalDraft(draft: LocalDraft): Promise<void> {
  validateLocalDraft(draft);
  if (blockedAccounts.has(draft.userId)) throw new Error("This account has signed out");
  const db = await openDrafts();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("drafts", "readwrite");
    const store = transaction.objectStore("drafts");
    const request = store.getAll();
    let failure: Error | null = null;
    request.onsuccess = () => {
      if (blockedAccounts.has(draft.userId)) { failure = new Error("This account has signed out"); transaction.abort(); return; }
      const others = (request.result as LocalDraft[]).filter(record => record.id !== draft.id);
      const bytes = others.reduce((sum, record) => sum + (record.state?.byteLength ?? MAX_DRAFT_BYTES), draft.state.byteLength);
      const accountBytes = others.filter(record => record.userId === draft.userId).reduce((sum, record) => sum + (record.state?.byteLength ?? MAX_DRAFT_BYTES), draft.state.byteLength);
      if (others.length >= MAX_DRAFTS || bytes > MAX_BROWSER_DRAFT_BYTES || accountBytes > MAX_ACCOUNT_DRAFT_BYTES) {
        failure = new Error("Browser backup space is full. Download or discard older drafts before closing this page");
        transaction.abort(); return;
      }
      const existing = (request.result as LocalDraft[]).find(record => record.id === draft.id);
      if (!existing || existing.version < draft.version) store.put(draft);
    };
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(failure ?? transaction.error ?? new Error("Browser backup could not be written")); };
    transaction.onabort = transaction.onerror;
  });
}

export async function removeLocalDraft(id: string, expectedVersion: number): Promise<void> {
  const db = await openDrafts();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("drafts", "readwrite");
    const store = transaction.objectStore("drafts");
    const request = store.get(id);
    request.onsuccess = () => { if ((request.result as LocalDraft | undefined)?.version === expectedVersion) store.delete(id); };
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
    transaction.onabort = transaction.onerror;
  });
}

export async function clearAccountDrafts(userId: string): Promise<void> {
  blockAccountDrafts(userId);
  const db = await openDrafts();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("drafts", "readwrite");
    const store = transaction.objectStore("drafts");
    const request = store.index("account").getAllKeys(IDBKeyRange.only(userId));
    request.onsuccess = () => { for (const key of request.result) store.delete(key); };
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
    transaction.onabort = transaction.onerror;
  });
}

// Each mounted editing session owns a distinct record. Ordered writes and a
// version-checked acknowledgement cannot erase newer work or another tab's draft.
export class LocalDraftWriter {
  private pending: Promise<void> = Promise.resolve();
  private savedVersion = 0;
  private queued: LocalDraft | null = null;
  private failure: unknown;
  constructor(private readonly metadata: Omit<LocalDraft, "state" | "version" | "updatedAt" | "schemaVersion">) {}
  save(state: Uint8Array, version: number): Promise<void> {
    // Keep at most one in-flight snapshot and one latest snapshot, not one large
    // byte array per keystroke when IndexedDB is slow or blocked.
    this.queued = { ...this.metadata, state, version, updatedAt: Date.now(), schemaVersion: DOCUMENT_SCHEMA_VERSION };
    this.pending = this.pending.catch(() => {}).then(async () => {
      const draft = this.queued;
      if (!draft) {
        if (this.savedVersion < version) throw this.failure ?? new Error("Browser backup could not be written");
        return;
      }
      this.queued = null;
      try { await writeLocalDraft(draft); this.savedVersion = Math.max(this.savedVersion, draft.version); this.failure = undefined; }
      catch (error) { this.failure = error; throw error; }
    });
    return this.pending;
  }
  acknowledge(version: number): Promise<void> {
    this.pending = this.pending.catch(() => {}).then(async () => {
      if (!this.savedVersion || this.savedVersion > version) return;
      // A newer acknowledged generation also covers a backup written earlier,
      // including when the final debounced backup was cancelled by Saved.
      await removeLocalDraft(this.metadata.id, this.savedVersion);
      this.savedVersion = 0;
    });
    return this.pending;
  }
}
