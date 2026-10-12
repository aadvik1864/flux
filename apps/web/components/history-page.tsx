"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EditorContent, useEditor } from "@tiptap/react";
import { documentExtensions } from "@flux/document-model";
import { can, type CheckpointDetail, type CheckpointPage, type CheckpointSummary, type FileDetail, type HistoryHead } from "@flux/shared";
import { ArrowLeft, Bookmark, History, LockKeyhole, RotateCcw, RefreshCw } from "lucide-react";
import { api, errorMessage, ApiError } from "../lib/api";
import { ErrorNotice, FluxMark, Modal } from "./ui";
import { ThemeToggle } from "./theme";
import { CheckpointArtwork, DocumentArtwork, HistoryArtwork } from "./work-art";

function kindLabel(checkpoint: CheckpointSummary): string {
  return checkpoint.kind === "RESTORE" ? "Restored revision" : checkpoint.kind === "BEFORE_RESTORE" ? "Preserved before restore" : checkpoint.kind === "MERGE" ? "Reviewed merge" : checkpoint.kind === "BEFORE_MERGE" ? "Preserved before merge" : checkpoint.kind === "MERGED_EXPERIMENT" ? "Archived experiment" : "Named checkpoint";
}

export function HistoryPage({ fileId }: { fileId: string }) {
  const [file, setFile] = useState<FileDetail | null>(null);
  const [checkpoints, setCheckpoints] = useState<CheckpointSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const [snapshot, setSnapshot] = useState<CheckpointDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [head, setHead] = useState<HistoryHead | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState("");
  const [requestId, setRequestId] = useState("");
  const [stale, setStale] = useState(false);
  const router = useRouter();

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [detail, page] = await Promise.all([api<FileDetail>(`/files/${fileId}`), api<CheckpointPage>(`/files/${fileId}/checkpoints`)]);
      setFile(detail); setCheckpoints(page.checkpoints); setCursor(page.nextCursor);
      setSelected(current => page.checkpoints.some(checkpoint => checkpoint.id === current) ? current : page.checkpoints[0]?.id ?? "");
    } catch (error) { setError(errorMessage(error)); }
    finally { setLoading(false); }
  }, [fileId]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    let active = true;
    setSnapshot(null); setPreviewError("");
    if (!selected) return;
    setPreviewLoading(true);
    api<CheckpointDetail>(`/files/${fileId}/checkpoints/${selected}`).then(snapshot => {
      if (active) setSnapshot(snapshot);
    }).catch(error => { if (active) setPreviewError(errorMessage(error)); }).finally(() => { if (active) setPreviewLoading(false); });
    return () => { active = false; };
  }, [selected, fileId]);

  async function loadMore() {
    if (!cursor) return;
    try {
      const page = await api<CheckpointPage>(`/files/${fileId}/checkpoints?cursor=${encodeURIComponent(cursor)}`);
      setCheckpoints(current => [...current, ...page.checkpoints]); setCursor(page.nextCursor);
    } catch (error) { setError(errorMessage(error)); }
  }

  async function refreshHead() {
    setHead(null); setRestoreError(""); setStale(false); setRequestId(crypto.randomUUID());
    try { setHead(await api<HistoryHead>(`/files/${fileId}/history-head`)); }
    catch (error) { setRestoreError(errorMessage(error)); }
  }

  async function restore() {
    if (!head || !snapshot) return;
    setRestoring(true); setRestoreError("");
    try {
      await api(`/files/${fileId}/checkpoints/${snapshot.id}/restore`, {
        method: "POST", body: JSON.stringify({
          requestId, expectedGeneration: head.generation, expectedRevision: head.revision, expectedContentHash: head.contentHash,
        }),
      });
      setRestoreOpen(false); router.push(`/files/${fileId}`);
    } catch (error) {
      setRestoreError(errorMessage(error));
      if (error instanceof ApiError && error.status === 409) setStale(true);
    } finally { setRestoring(false); }
  }

  return <main className="history-shell">
    <header className="editor-topbar"><div className="editor-heading"><Link href={`/files/${fileId}`} className="icon-button" aria-label="Back to current document"><ArrowLeft size={20} /></Link><Link href="/" className="editor-brand"><FluxMark /></Link><span className="header-divider" /><div><span className="document-workspace">{file?.workspaceName ?? "Workspace"}</span><h1>{file?.name ?? "Document history"}</h1></div></div><div className="editor-header-tools"><ThemeToggle /><Link href={`/files/${fileId}`} className="button secondary">Open current document</Link></div></header>
    <div className="history-layout"><aside className="history-sidebar"><div className="history-intro artwork-trigger"><HistoryArtwork /><div className="history-title"><History size={22} /><h2>History</h2></div><p className="history-description">Saved moments, not a live replay. Opening a checkpoint never changes main.</p><button className="text-button history-refresh" onClick={() => void load()} disabled={loading}><RefreshCw size={14} />Refresh history</button></div><ErrorNotice message={error} />
      {loading ? <p className="history-loading" role="status">Loading checkpoints…</p> : checkpoints.length ? <nav className="checkpoint-timeline" aria-label="Saved checkpoints">{checkpoints.map(checkpoint => <button key={checkpoint.id} className={`checkpoint-choice ${selected === checkpoint.id ? "selected" : ""}`} data-kind={checkpoint.kind} onClick={() => setSelected(checkpoint.id)} aria-pressed={selected === checkpoint.id}><span className="timeline-marker">{checkpoint.kind === "RESTORE" ? <RotateCcw size={15} /> : <Bookmark size={15} />}</span><span className="checkpoint-choice-content"><span className="checkpoint-number">Checkpoint {checkpoint.number}</span><strong>{checkpoint.title}</strong><span>{kindLabel(checkpoint)}</span><time dateTime={checkpoint.createdAt}>{new Date(checkpoint.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time><span>{checkpoint.createdByName}</span></span></button>)}</nav> : !error && <div className="history-empty-sidebar"><Bookmark size={26} /><strong>No saved checkpoints yet</strong><p>Return to the document and choose Save checkpoint after your changes are saved.</p></div>}
      {cursor && <button className="button secondary" onClick={() => void loadMore()}>Load older checkpoints</button>}
    </aside><section className="history-preview" aria-label="Historical preview"><ErrorNotice message={previewError} />{previewLoading ? <div className="editor-loading" role="status">Loading the saved document…</div> : snapshot ? <><div className="historical-banner"><div className="historical-identity" data-tone="coral"><DocumentArtwork /><div><span className="historical-label"><LockKeyhole size={15} />Read-only checkpoint</span><h2>{snapshot.title}</h2><p>Checkpoint {snapshot.number} · Saved by {snapshot.createdByName}</p></div></div>{file && can(file.role, "edit") && <button className="button secondary" onClick={() => { setRestoreOpen(true); void refreshHead(); }}><RotateCcw size={16} />Restore as new revision</button>}</div><SnapshotEditor key={snapshot.id} snapshot={snapshot} /></> : !previewError && <div className="history-empty-preview artwork-trigger"><CheckpointArtwork /><h2>Your document’s story starts here.</h2><p>Named checkpoints will let you revisit earlier work without disturbing the current document.</p><Link href={`/files/${fileId}`} className="button primary">Return to document</Link></div>}</section></div>
    {restoreOpen && snapshot && <Modal title="Restore as a new revision" artwork={<HistoryArtwork />} onClose={() => { if (!restoring) setRestoreOpen(false); }}><div className="stack-form"><p>You’re restoring <strong>{snapshot.title}</strong> to main.</p><div className="restore-explanation"><Bookmark size={20} /><p>Flux first saves the current main as a checkpoint, then appends the restored version. Existing checkpoints remain available.</p></div><p className="muted">Connected editors will move to a new editing session. Unacknowledged drafts are kept visible for manual recovery instead of replaying into the restored revision.</p>{head && <p className="restore-head">Current main: session {head.generation + 1}, revision {head.revision}</p>}<ErrorNotice message={restoreError} />{stale && <button className="button secondary" onClick={() => void refreshHead()}><RefreshCw size={15} />Refresh current revision</button>}<div className="form-actions"><button className="button secondary" disabled={restoring} onClick={() => setRestoreOpen(false)}>Cancel</button><button className="button primary" disabled={!head || restoring || stale} onClick={() => void restore()}>{restoring ? "Restoring…" : !head && !restoreError ? "Checking current revision…" : "Confirm restore"}</button></div></div></Modal>}
  </main>;
}

function SnapshotEditor({ snapshot }: { snapshot: CheckpointDetail }) {
  const editor = useEditor({
    immediatelyRender: false, editable: false, extensions: documentExtensions(), content: snapshot.content,
    editorProps: { attributes: { class: "document-content historical-content", "aria-label": "Historical document content", role: "textbox", "aria-multiline": "true", "aria-readonly": "true" } },
  });
  return <div className="document-stage"><div className="document-paper"><div className="paper-hint">Saved {new Date(snapshot.createdAt).toLocaleString()} · Read-only</div><EditorContent editor={editor} /></div></div>;
}
