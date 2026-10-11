"use client";

import { useEffect, useState, useRef, useCallback, type ReactNode, type FormEvent } from "react";
import Link from "next/link";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { documentExtensions } from "@flux/document-model";
import * as Y from "yjs";
import { ArrowLeft, Bold, Italic, List, ListOrdered, Heading2, Quote, Table2, GitBranch, Wifi, WifiOff, Check, LoaderCircle, AlertCircle, Strikethrough, Download, Maximize2, Minimize2 } from "lucide-react";
import { branchRoom, can, type FileDetail, type PublicUser, type CheckpointSummary } from "@flux/shared";
import { api, errorMessage } from "../lib/api";
import { BlockIds } from "../lib/block-ids";
import { useSession } from "./session";
import { Avatar, ErrorNotice, FluxMark, Modal } from "./ui";
import { ThemeToggle } from "./theme";
import { CheckpointArtwork, DocumentArtwork, HistoryArtwork } from "./work-art";

type SaveStatus = "connecting" | "syncing" | "saved" | "offline" | "error";
type Connection = { document: Y.Doc; provider: HocuspocusProvider };

export function DocumentPage({ fileId }: { fileId: string }) {
  const [file, setFile] = useState<FileDetail | null>(null);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<SaveStatus>("connecting");
  const [error, setError] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);
  const [people, setPeople] = useState<PublicUser[]>([]);
  const [connectionVersion, setConnectionVersion] = useState(0);
  const [retired, setRetired] = useState(false);
  const [checkpointOpen, setCheckpointOpen] = useState(false);
  const [checkpointBusy, setCheckpointBusy] = useState(false);
  const [checkpointError, setCheckpointError] = useState("");
  const [lastCheckpoint, setLastCheckpoint] = useState<CheckpointSummary | null>(null);
  const [wide, setWide] = useState(false);
  const dirty = useRef(false);
  const editorRef = useRef<Editor | null>(null);
  const checkpointRequestId = useRef("");
  const setEditor = useCallback((editor: Editor | null) => { editorRef.current = editor; }, []);
  const retrySave = useRef<() => void>(() => {});
  const { user } = useSession();

  useEffect(() => {
    if (!user) return;
    let active = true;
    let provider: HocuspocusProvider | undefined;
    let document: Y.Doc | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let generation = 0;
    let pendingId = "";
    let pendingGeneration = -1;
    let online = false;
    setFile(null); setConnection(null); setReady(false); setStatus("connecting"); setError(""); setAccessDenied(false); setRetired(false);
    dirty.current = false;

    function handleRestore() {
      if (!active) return;
      online = false; clearTimeout(timer); provider?.disconnect();
      if (dirty.current) {
        setRetired(true); setStatus("offline");
        setError("Main was restored while this draft had unacknowledged changes. Your local text is still visible below. Download a copy before opening the current revision.");
      } else setConnectionVersion(value => value + 1);
    }

    function scheduleSave() {
      clearTimeout(timer);
      if (!online || !provider?.synced) return;
      timer = setTimeout(() => {
        if (!provider || !online) return;
        pendingGeneration = generation;
        pendingId = crypto.randomUUID();
        provider.sendStateless(JSON.stringify({ type: "flush", requestId: pendingId }));
      }, 600);
    }
    retrySave.current = scheduleSave;

    async function connect() {
      try {
        const detail = await api<FileDetail>(`/files/${fileId}`);
        if (!active) return;
        setFile(detail);
        document = new Y.Doc();
        provider = new HocuspocusProvider({
          url: process.env.NEXT_PUBLIC_COLLABORATION_URL ?? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/sync`,
          name: branchRoom(detail.mainBranchId, detail.generation),
          document,
          token: async () => {
            try {
              const credential = await api<{ token: string; room: string }>(`/files/${fileId}/collaboration-token`, { method: "POST" });
              if (credential.room !== branchRoom(detail.mainBranchId, detail.generation)) { handleRestore(); return ""; }
              return credential.token;
            }
            catch (error) {
              if (active) { setError(errorMessage(error)); setStatus("error"); setAccessDenied(true); }
              return "";
            }
          },
          onStatus({ status }) {
            if (!active) return;
            online = status === "connected";
            setStatus(online ? "syncing" : status === "connecting" ? "connecting" : "offline");
            if (online) scheduleSave();
          },
          onSynced() { if (active) { setReady(true); scheduleSave(); } },
          onAuthenticationFailed() {
            if (active) { setError("Document access was denied. Return to the workspace or sign in again."); setStatus("error"); setAccessDenied(true); }
          },
          onAwarenessChange() {
            if (!active || !provider) return;
            const unique = new Map<string, PublicUser>();
            for (const state of provider.awareness?.getStates().values() ?? []) {
              const person = state.user;
              if (person && typeof person.id === "string" && typeof person.name === "string") unique.set(person.id, person);
            }
            setPeople([...unique.values()]);
          },
          onStateless({ payload }) {
            if (!active) return;
            try {
              const message = JSON.parse(payload);
              if (message.type === "document-restored") { handleRestore(); return; }
              if (message.requestId !== pendingId) return;
              if (message.type === "save-failed") {
                setStatus("error"); setError("Saving failed. Keep this page open and retry when the server is available.");
              } else if (message.type === "saved" && pendingGeneration === generation && online) {
                dirty.current = false; setStatus("saved"); setError("");
              }
            } catch { /* Ignore unknown stateless messages. */ }
          },
        });
        provider.setAwarenessField("user", { id: user!.id, name: user!.name, color: user!.color });
        document.on("update", () => {
          generation += 1;
          dirty.current = true;
          if (active) setStatus(online ? "syncing" : "offline");
          scheduleSave();
        });
        setConnection({ document, provider });
      } catch (error) { if (active) { setError(errorMessage(error)); setStatus("error"); } }
    }
    void connect();
    return () => {
      active = false; clearTimeout(timer); retrySave.current = () => {};
      provider?.destroy(); document?.destroy();
    };
  }, [fileId, user, connectionVersion]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  async function saveCheckpoint(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = String(new FormData(event.currentTarget).get("title") ?? "");
    setCheckpointBusy(true); setCheckpointError("");
    try {
      const checkpoint = await api<CheckpointSummary>(`/files/${fileId}/checkpoints`, {
        method: "POST", body: JSON.stringify({ title, requestId: checkpointRequestId.current }),
      });
      setLastCheckpoint(checkpoint); setCheckpointOpen(false);
    } catch (error) { setCheckpointError(errorMessage(error)); }
    finally { setCheckpointBusy(false); }
  }

  function downloadDraft() {
    const editor = editorRef.current;
    if (!editor) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ fileName: file?.name, content: editor.getJSON() }, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "flux-local-draft.json"; link.click(); URL.revokeObjectURL(url);
  }

  const statusLabel = { connecting: "Connecting", syncing: "Saving…", saved: "Saved", offline: "Offline — keep this page open", error: "Not saved / access unavailable" }[status];
  return <main className={`editor-shell ${wide ? "wide-editor" : ""}`}>
    <header className="editor-topbar"><div className="editor-heading"><Link href={file ? `/workspaces/${file.workspaceId}` : "/"} className="icon-button" aria-label="Back to workspace" onClick={event => { if (dirty.current && !window.confirm("Some changes are not saved yet. Leave this document?")) event.preventDefault(); }}><ArrowLeft size={20} /></Link><Link href="/" className="editor-brand"><FluxMark /></Link><span className="header-divider" /><div className="editor-document-identity" data-tone="orchid"><DocumentArtwork /><div><span className="document-workspace">{file?.workspaceName ?? "Workspace"}</span><h1>{file?.name ?? "Opening document…"}</h1></div></div></div><div className="editor-header-tools"><div className="editor-collaborators" aria-label="Active collaborators">{people.map(person => <Avatar user={person} key={person.id} size="small" />)}<span>{people.length ? `${people.length} here` : "Connecting"}</span></div><ThemeToggle /></div></header>
    <div className="document-subbar"><span className="branch-label"><GitBranch size={15} />main</span><span className="document-mode">{file && !can(file.role, "edit") ? "Read-only" : "Shared document"}</span><div className="document-history-actions">{file && can(file.role, "edit") && <button className="history-action artwork-trigger" disabled={!ready || status !== "saved" || retired || accessDenied} onClick={() => { checkpointRequestId.current = crypto.randomUUID(); setCheckpointError(""); setCheckpointOpen(true); }}><span className="action-artwork"><CheckpointArtwork /></span>Save checkpoint</button>}<Link href={`/files/${fileId}/history`} className="history-action artwork-trigger" onClick={event => { if (dirty.current && !window.confirm("Some changes are not saved. Keep editing until Saved, or leave this draft?")) event.preventDefault(); }}><span className="action-artwork"><HistoryArtwork /></span>History</Link></div><span className={`save-status ${status}`} role="status">{status === "saved" ? <Check size={15} /> : status === "offline" ? <WifiOff size={15} /> : status === "error" ? <AlertCircle size={15} /> : <LoaderCircle size={15} className="spin" />}{statusLabel}</span></div>
    {error && <div className="editor-error"><ErrorNotice message={error} />{retired ? <div className="draft-recovery-actions"><button className="button secondary" onClick={downloadDraft}><Download size={16} />Download local draft</button><button className="button primary" onClick={() => { if (!dirty.current || window.confirm("Open the restored revision? Download a copy first if you want to keep this local draft.")) setConnectionVersion(value => value + 1); }}>Open current revision</button></div> : connection && !accessDenied && <button className="button secondary" onClick={() => { setStatus("syncing"); retrySave.current(); }}>Retry save</button>}</div>}
    {lastCheckpoint && <div className="checkpoint-notice" role="status"><Check size={16} />Checkpoint {lastCheckpoint.number} saved: {lastCheckpoint.title}<Link href={`/files/${fileId}/history`}>View history</Link></div>}
    {connection && ready && file && user ? <RichTextEditor key={file.id} connection={connection} editable={can(file.role, "edit") && !accessDenied && !retired} user={user} onEditor={setEditor} wide={wide} onToggleWide={() => setWide(current => !current)} /> : <div className="editor-loading" role="status"><Wifi size={27} /><p>{error ? "The document could not be opened." : "Connecting to your shared document…"}</p></div>}
    <footer className="editor-footer"><span>Documents & history preview</span><span>Branching, chat, and calls are coming in later milestones.</span></footer>
    {checkpointOpen && <Modal title="Save a checkpoint" artwork={<CheckpointArtwork />} onClose={() => { if (!checkpointBusy) setCheckpointOpen(false); }}><form className="stack-form" onSubmit={saveCheckpoint}><p className="muted">Save an immutable version of main, including changes accepted from your collaborators.</p><label>Checkpoint name<input name="title" maxLength={120} placeholder="e.g. Initial submission draft" required /></label><ErrorNotice message={checkpointError} /><div className="form-actions"><button type="button" className="button secondary" disabled={checkpointBusy} onClick={() => setCheckpointOpen(false)}>Cancel</button><button className="button primary" disabled={checkpointBusy || status !== "saved"}>{checkpointBusy ? "Saving checkpoint…" : "Save checkpoint"}</button></div></form></Modal>}
  </main>;
}

function Tool({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" title={label} aria-label={label} aria-pressed={Boolean(active)} className={`tool-button ${active ? "active" : ""}`} onClick={onClick}>{children}</button>;
}

function Toolbar({ editor, wide, onToggleWide }: { editor: Editor; wide: boolean; onToggleWide: () => void }) {
  const state = useEditorState({ editor, selector: ({ editor }) => ({
    bold: editor.isActive("bold"), italic: editor.isActive("italic"), strike: editor.isActive("strike"),
    heading: editor.isActive("heading", { level: 2 }), bullet: editor.isActive("bulletList"), ordered: editor.isActive("orderedList"), quote: editor.isActive("blockquote"), table: editor.isActive("table"),
  }) });
  return <div className="editor-toolbar" role="toolbar" aria-label="Document formatting">
    <Tool label="Bold" active={state.bold} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={18} /></Tool>
    <Tool label="Italic" active={state.italic} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={18} /></Tool>
    <Tool label="Strikethrough" active={state.strike} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough size={18} /></Tool><span className="toolbar-divider" />
    <Tool label="Heading" active={state.heading} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 size={19} /></Tool>
    <Tool label="Bullet list" active={state.bullet} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={19} /></Tool>
    <Tool label="Numbered list" active={state.ordered} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={19} /></Tool>
    <Tool label="Quote" active={state.quote} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote size={18} /></Tool><span className="toolbar-divider" />
    <Tool label="Insert table" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table2 size={18} /></Tool>
    {state.table && <><button className="text-button" onClick={() => editor.chain().focus().addRowAfter().run()}>Add row</button><button className="text-button" onClick={() => editor.chain().focus().addColumnAfter().run()}>Add column</button><button className="text-button danger" onClick={() => editor.chain().focus().deleteTable().run()}>Delete table</button></>}
    <button className="text-button editor-width-toggle" aria-pressed={wide} aria-label="Wide page" onClick={onToggleWide}>{wide ? <Minimize2 size={15} /> : <Maximize2 size={15} />}<span>{wide ? "Reading width" : "Wide page"}</span></button>
  </div>;
}

function RichTextEditor({ connection, editable, user, onEditor, wide, onToggleWide }: { connection: Connection; editable: boolean; user: PublicUser; onEditor: (editor: Editor | null) => void; wide: boolean; onToggleWide: () => void }) {
  const editor = useEditor({
    immediatelyRender: false,
    editable,
    extensions: [
      ...documentExtensions(),
      BlockIds,
      Collaboration.configure({ document: connection.document }),
      CollaborationCaret.configure({ provider: connection.provider, user: { id: user.id, name: user.name, color: user.color } }),
    ],
    editorProps: { attributes: { class: "document-content", "aria-label": "Document content", role: "textbox", "aria-multiline": "true", "aria-readonly": String(!editable) } },
  }, [connection, editable]);
  const words = useEditorState({ editor, selector: ({ editor }) => {
    const text = editor?.state.doc.textBetween(0, editor.state.doc.content.size, " ").trim() ?? "";
    return text ? text.split(/\s+/).length : 0;
  } });
  useEffect(() => { onEditor(editor); return () => onEditor(null); }, [editor, onEditor]);
  if (!editor) return <div className="editor-loading">Opening editor…</div>;
  return <>{editable ? <Toolbar editor={editor} wide={wide} onToggleWide={onToggleWide} /> : <div className="readonly-toolbar">You can read this document. An owner or admin can grant editing access.</div>}<div className="document-stage"><div className="document-paper"><div className="paper-hint">{editable ? "Write together. Changes save automatically." : "Shared document · read-only"}</div><EditorContent editor={editor} /><div className="document-meter"><span>{words ?? 0} {(words ?? 0) === 1 ? "word" : "words"}</span><span>{editable ? "Ctrl / ⌘ B for bold · Ctrl / ⌘ I for italic" : "Read-only"}</span></div></div></div></>;
}
