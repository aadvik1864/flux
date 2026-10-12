"use client";

import { useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { contentFromYDoc, documentExtensions } from "@flux/document-model";
import type { DocumentContent } from "@flux/shared";
import * as Y from "yjs";
import type { LocalDraft } from "../lib/local-drafts";
import { ErrorNotice, Modal } from "./ui";
import { HistoryArtwork } from "./work-art";

export function localDraftContent(draft: LocalDraft): DocumentContent {
  const document = new Y.Doc();
  try { Y.applyUpdate(document, draft.state); return contentFromYDoc(document); }
  finally { document.destroy(); }
}

export function downloadLocalDraft(draft: LocalDraft) {
  let content: Blob;
  let name = "flux-local-draft.json";
  try { content = new Blob([JSON.stringify({ fileName: draft.fileName, generation: draft.generation, content: localDraftContent(draft) }, null, 2)], { type: "application/json" }); }
  catch { content = new Blob([new Uint8Array(draft.state).buffer], { type: "application/octet-stream" }); name = "flux-local-draft.yjs"; }
  const url = URL.createObjectURL(content);
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function DraftRecovery({ drafts, branchId, generation, editable, onResume, onDiscard }: {
  drafts: LocalDraft[]; branchId: string; generation: number; editable: boolean;
  onResume: (draft: LocalDraft) => Promise<void>; onDiscard: (draft: LocalDraft) => Promise<void>;
}) {
  const [selected, setSelected] = useState<LocalDraft | null>(null);
  const [content, setContent] = useState<DocumentContent | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!drafts.length) return null;
  const resumable = selected && selected.branchId === branchId && selected.generation === generation && editable && content;
  async function act(action: "resume" | "discard") {
    if (!selected) return;
    if (action === "discard" && !window.confirm("Discard this browser draft? Download a copy first if you want to keep it.")) return;
    setBusy(true); setError("");
    try { await (action === "resume" ? onResume : onDiscard)(selected); setSelected(null); }
    catch { setError("The browser draft could not be updated. Keep this page open and download a copy."); }
    finally { setBusy(false); }
  }
  return <section className="draft-recovery" aria-label="Browser draft recovery"><strong>Unsaved work was found in this browser.</strong><p>Review a draft before using it. Current shared work stays unchanged until you choose to resume.</p><div className="draft-recovery-list">{drafts.map(draft => <button key={draft.id} className="button secondary" onClick={() => {
    setSelected(draft); setError("");
    try { setContent(localDraftContent(draft)); } catch { setContent(null); setError("This draft could not be previewed. Download its recovery data before discarding it."); }
  }}>Review browser draft <time dateTime={new Date(draft.updatedAt).toISOString()}>{new Date(draft.updatedAt).toLocaleString()}</time></button>)}</div>
    {selected && <Modal title="Review your browser draft" artwork={<HistoryArtwork />} onClose={() => { if (!busy) setSelected(null); }}><div className="stack-form"><p>This is a local recovery copy, not a server checkpoint.</p>{selected.generation !== generation || selected.branchId !== branchId ? <p className="muted">Main has moved to a different editing session. This draft is download-only and will not be replayed into the restored document.</p> : <p className="muted">Resuming combines this draft with the current shared document. Review it first; later shared edits may also be present.</p>}<ErrorNotice message={error} />{content && <DraftPreview key={selected.id} content={content} />}<div className="draft-recovery-actions"><button className="button secondary" disabled={busy} onClick={() => downloadLocalDraft(selected)}>Download browser draft</button>{resumable && <button className="button primary" disabled={busy} onClick={() => void act("resume")}>Resume browser draft</button>}<button className="text-button danger" disabled={busy} onClick={() => void act("discard")}>Discard browser draft</button></div></div></Modal>}
  </section>;
}

function DraftPreview({ content }: { content: DocumentContent }) {
  const editor = useEditor({ immediatelyRender: false, editable: false, extensions: documentExtensions(), content,
    editorProps: { attributes: { class: "document-content", role: "textbox", "aria-label": "Browser draft content", "aria-readonly": "true" } },
  });
  return <div className="draft-preview"><EditorContent editor={editor} /></div>;
}
