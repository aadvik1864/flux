"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { EditorContent, useEditor } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { documentExtensions } from "@flux/document-model";
import { can, type CheckpointDetail, type CheckpointPage, type DecisionBookmark, type DecisionPage, type DecisionStatus, type DiscussionMessage, type DiscussionPage as MessagePage, type DocumentContent, type FileDetail } from "@flux/shared";
import { ArrowLeft, Bookmark, MessageCircle, RefreshCw, Send } from "lucide-react";
import { api, ApiError, errorMessage } from "../lib/api";
import { useSession } from "./session";
import { ErrorNotice, FluxMark, Modal } from "./ui";
import { ThemeToggle } from "./theme";
import { CheckpointArtwork, PeopleArtwork } from "./work-art";

const statusLabel: Record<DecisionStatus, string> = { OPEN: "Open", DECIDED: "Decided", SUPERSEDED: "Superseded" };
const nodeText = (node: DocumentContent): string => node.text ?? node.content?.map(nodeText).join(" ") ?? node.type;

export function DiscussionPage({ fileId, branchId }: { fileId: string; branchId?: string }) {
  const { user } = useSession();
  const [file, setFile] = useState<FileDetail | null>(null), [messages, setMessages] = useState<DiscussionMessage[]>([]), [bookmarks, setBookmarks] = useState<DecisionBookmark[]>([]);
  const [before, setBefore] = useState<number | undefined>(), [decisionBefore, setDecisionBefore] = useState<number | undefined>();
  const [hasOlder, setHasOlder] = useState(false), [nextDecision, setNextDecision] = useState<number | null>(null);
  const [error, setError] = useState(""), [actionError, setActionError] = useState(""), [denied, setDenied] = useState(false), [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState(""), [sending, setSending] = useState(false), [actionBusy, setActionBusy] = useState(false);
  const [newDecision, setNewDecision] = useState(false), [modalBusy, setModalBusy] = useState(false), [modalError, setModalError] = useState("");
  const [checkpoints, setCheckpoints] = useState<CheckpointPage | null>(null), [snapshot, setSnapshot] = useState<CheckpointDetail | null>(null);
  const [context, setContext] = useState<{ bookmark: DecisionBookmark; checkpoint: CheckpointDetail } | null>(null);
  const [linkedMessage, setLinkedMessage] = useState("");
  const messageRequest = useRef(""), decisionRequest = useRef(""), selection = useRef(0), refresh = useRef<() => Promise<void>>(async () => {});
  const editingBranch = file?.editingBranchId ?? file?.mainBranchId;
  const prefix = editingBranch ? `/files/${fileId}/branches/${editingBranch}` : "";
  const documentPath = `/files/${fileId}${branchId ? `/branches/${branchId}` : ""}`;
  const writable = file && !file.branchArchived && !denied && can(file.role, "discuss");

  useEffect(() => {
    let active = true, pending = false, stopped = false;
    const cancelled = new AbortController();
    setLoading(true); setDenied(false);
    async function load() {
      if (!active || pending || stopped) return;
      pending = true;
      const signal = AbortSignal.any([cancelled.signal, AbortSignal.timeout(12_000)]);
      try {
        const detail = await api<FileDetail>(`/files/${fileId}${branchId ? `?branchId=${encodeURIComponent(branchId)}` : ""}`, { signal });
        const branch = detail.editingBranchId ?? detail.mainBranchId;
        const [discussion, decisions] = await Promise.all([
          api<MessagePage>(`/files/${fileId}/branches/${branch}/messages${before ? `?before=${before}` : ""}`, { signal }),
          api<DecisionPage>(`/files/${fileId}/branches/${branch}/decisions${decisionBefore ? `?before=${decisionBefore}` : ""}`, { signal }),
        ]);
        if (active) { setFile(detail); setMessages(discussion.messages); setHasOlder(discussion.hasOlder); setBookmarks(decisions.bookmarks); setNextDecision(decisions.nextBefore); setError(""); }
      } catch (error) {
        if (active) {
          if (error instanceof ApiError && [401, 403, 404].includes(error.status)) { stopped = true; setDenied(true); setMessages([]); setBookmarks([]); setContext(null); setNewDecision(false); }
          setError(errorMessage(error));
        }
      } finally { pending = false; if (active) setLoading(false); }
    }
    refresh.current = load; void load();
    const timer = setInterval(() => { if (document.visibilityState === "visible" && navigator.onLine) void load(); }, 5000);
    const visible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", visible); window.addEventListener("online", visible);
    return () => { active = false; cancelled.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", visible); window.removeEventListener("online", visible); refresh.current = async () => {}; };
  }, [fileId, branchId, before, decisionBefore, user]);

  useEffect(() => { if (linkedMessage) document.getElementById(`message-${linkedMessage}`)?.scrollIntoView({ block: "center" }); }, [linkedMessage, messages]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (draft.trim()) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [draft]);

  async function send(event: FormEvent) {
    event.preventDefault(); if (!prefix || !writable || !draft.trim()) return;
    setSending(true); setActionError(""); if (!messageRequest.current) messageRequest.current = crypto.randomUUID();
    try {
      await api(`${prefix}/messages`, { method: "POST", body: JSON.stringify({ body: draft, requestId: messageRequest.current }) });
      setDraft(""); messageRequest.current = ""; await refresh.current();
    } catch (error) { setActionError(`${errorMessage(error)} Your unsent message is still here; retry without changing it to confirm the same send.`); }
    finally { setSending(false); }
  }
  async function remove(message: DiscussionMessage) {
    if (!window.confirm("Remove this message? Its text will be erased, while linked decisions keep their discussion reference.")) return;
    setActionBusy(true); setActionError("");
    try { await api(`${prefix}/messages/${message.id}`, { method: "DELETE" }); await refresh.current(); }
    catch (error) { setActionError(errorMessage(error)); } finally { setActionBusy(false); }
  }
  async function selectCheckpoint(id: string) {
    const version = ++selection.current; setSnapshot(null); setModalBusy(true); setModalError(""); decisionRequest.current = "";
    try { const detail = await api<CheckpointDetail>(`/files/${fileId}/checkpoints/${id}`); if (version === selection.current) setSnapshot(detail); }
    catch (error) { if (version === selection.current) setModalError(errorMessage(error)); }
    finally { if (version === selection.current) setModalBusy(false); }
  }
  async function startDecision() {
    setNewDecision(true); setModalBusy(true); setModalError(""); setCheckpoints(null); setSnapshot(null); decisionRequest.current = "";
    try {
      const page = await api<CheckpointPage>(`/files/${fileId}/checkpoints?branchId=${editingBranch}`); setCheckpoints(page);
      if (page.checkpoints[0]) await selectCheckpoint(page.checkpoints[0].id);
    } catch (error) { setModalError(errorMessage(error)); } finally { setModalBusy(false); }
  }
  async function createDecision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!snapshot) return;
    const values = new FormData(event.currentTarget); setModalBusy(true); setModalError("");
    if (!decisionRequest.current) decisionRequest.current = crypto.randomUUID();
    try {
      await api(`${prefix}/decisions`, { method: "POST", body: JSON.stringify({ title: values.get("title"), explanation: values.get("explanation"), checkpointId: snapshot.id, blockId: values.get("blockId"), ...(values.get("discussionMessageId") ? { discussionMessageId: values.get("discussionMessageId") } : {}), requestId: decisionRequest.current }) });
      setNewDecision(false); if (decisionBefore) setDecisionBefore(undefined); else await refresh.current();
    } catch (error) { setModalError(errorMessage(error)); } finally { setModalBusy(false); }
  }
  async function changeStatus(bookmark: DecisionBookmark, status: DecisionStatus) {
    setActionBusy(true); setActionError("");
    try { await api(`${prefix}/decisions/${bookmark.id}`, { method: "PATCH", body: JSON.stringify({ status, expectedStatus: bookmark.status }) }); await refresh.current(); }
    catch (error) { setActionError(errorMessage(error)); } finally { setActionBusy(false); }
  }
  async function viewContext(bookmark: DecisionBookmark) {
    setActionBusy(true); setActionError("");
    try { setContext({ bookmark, checkpoint: await api<CheckpointDetail>(`/files/${fileId}/checkpoints/${bookmark.checkpointId}`) }); }
    catch (error) { setActionError(errorMessage(error)); } finally { setActionBusy(false); }
  }
  async function openDiscussion(bookmark: DecisionBookmark) {
    if (!bookmark.discussionMessageId) return;
    setActionBusy(true); setActionError("");
    try {
      const message = await api<DiscussionMessage>(`${prefix}/messages/${bookmark.discussionMessageId}`);
      setLinkedMessage(message.id);
      if (!messages.some(current => current.id === message.id)) setBefore(message.number + 1);
    } catch (error) { setActionError(errorMessage(error)); } finally { setActionBusy(false); }
  }
  function confirmNavigation(event: { preventDefault(): void }) {
    if (draft.trim() && !window.confirm("Your message has not been confirmed as sent. Leave and discard this draft?")) event.preventDefault();
  }
  return <main className="discussion-shell">
    <header className="editor-topbar"><div className="editor-heading"><Link href={documentPath} className="icon-button" aria-label="Back to document" onNavigate={confirmNavigation}><ArrowLeft size={20} /></Link><Link href="/" className="editor-brand" onNavigate={confirmNavigation}><FluxMark /></Link><div><span className="document-workspace">{file?.workspaceName ?? "Workspace"}</span><h1>{file?.name ?? "Discussion"}</h1></div></div><ThemeToggle /></header>
    <div className="discussion-heading artwork-trigger"><PeopleArtwork /><div><h2>Keep the reason next to the work.</h2><p>{file?.branchName ?? "main"} discussion{file?.branchArchived ? " · Merged, read-only" : ""}. Messages and decisions stay separate from document edits.</p></div><button className="button secondary" disabled={loading || denied} onClick={() => void refresh.current()}><RefreshCw size={15} />Refresh discussion</button></div>
    <div className="discussion-notices"><ErrorNotice message={error} /><ErrorNotice message={actionError} /></div>
    <div className="discussion-layout"><section className="discussion-thread" aria-label="Branch discussion">
      <h2><MessageCircle size={20} />Discussion</h2>
      {before ? <p className="discussion-reading-note">Reading earlier messages. <button className="text-button" onClick={() => setBefore(undefined)}>Return to latest messages</button></p> : <p className="muted">Updates appear while this page is open. Unsent messages are not backed up; send before leaving.</p>}
      {hasOlder && <button className="text-button" disabled={loading} onClick={() => setBefore(messages[0]?.number)}>Read earlier messages</button>}
      <ol className="discussion-messages" aria-label="Saved messages">{messages.map(message => <li key={message.id} id={`message-${message.id}`} data-linked={linkedMessage === message.id}><div className="discussion-message-heading"><strong>{message.authorName}</strong><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString()}</time>{!message.deletedAt && file && user && can(file.role, "discuss") && (message.authorId === user.id || can(file.role, "review")) && <button className="text-button danger" aria-label={`Remove message ${message.number}`} disabled={actionBusy || denied} onClick={() => void remove(message)}>Remove</button>}</div><p className={message.deletedAt ? "muted" : ""}>{message.deletedAt ? "Message removed" : message.body}</p></li>)}</ol>
      {!messages.length && !loading && !denied && <p className="discussion-empty">No messages yet. Share what needs a decision, or explain an experiment.</p>}
      {loading && !file && <p role="status">Loading discussion…</p>}
      {writable && !before ? <form className="discussion-composer" onSubmit={send}><label>Your message<textarea name="message" value={draft} maxLength={4000} required rows={3} disabled={sending} onChange={event => { setDraft(event.target.value); messageRequest.current = ""; }} placeholder="What should the team consider?" /></label><div><span className="muted">{draft.length}/4,000</span><button className="button primary" disabled={sending || !draft.trim()}><Send size={16} />{sending ? "Sending…" : "Send message"}</button></div></form> : !denied && <p className="muted">{file?.branchArchived ? "This experiment's discussion is archived." : before ? "Return to latest messages to reply." : "You can read this discussion. An owner can grant participation access."}</p>}
    </section><aside className="decision-notebook" aria-label="Decision Bookmarks"><div className="decision-notebook-heading artwork-trigger"><CheckpointArtwork /><h2>Decision Bookmarks</h2></div><p className="muted">Save the explanation, discussion, and checkpoint behind a choice.</p>{writable && <button className="button secondary" onClick={() => void startDecision()}><Bookmark size={16} />New Decision Bookmark</button>}
      {decisionBefore && <button className="text-button" onClick={() => setDecisionBefore(undefined)}>Return to latest decisions</button>}
      <ol className="decision-list">{bookmarks.map(bookmark => <li key={bookmark.id}>
        <div className="decision-status" data-status={bookmark.status}>{statusLabel[bookmark.status]}</div><h3>{bookmark.title}</h3><p>{bookmark.explanation}</p>
        <span className="decision-byline">{bookmark.createdByName} · {new Date(bookmark.createdAt).toLocaleDateString()}</span>
        <p className="decision-anchor-state" data-available={bookmark.anchorAvailable}>{bookmark.anchorAvailable ? "Anchor present in last saved state" : "Anchor unavailable — saved context is retained"}</p>
        <div className="decision-actions">
          <button className="text-button" disabled={actionBusy || denied} onClick={() => void viewContext(bookmark)}>View saved context</button>
          {bookmark.discussionMessageId && <button className="text-button" disabled={actionBusy || denied} onClick={() => void openDiscussion(bookmark)}>Linked discussion</button>}
          {writable && user && (bookmark.createdById === user.id || can(file!.role, "review")) && <label>Status for {bookmark.title}<select value={bookmark.status} disabled={actionBusy} onChange={event => void changeStatus(bookmark, event.target.value as DecisionStatus)}>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
        </div>
      </li>)}</ol>
      {!bookmarks.length && !loading && !denied && <p className="discussion-empty">No decisions bookmarked. Start from a saved checkpoint when the team reaches a choice.</p>}
      {nextDecision && <button className="text-button" disabled={loading} onClick={() => setDecisionBefore(nextDecision)}>Read earlier decisions</button>}
    </aside></div>
    {newDecision && <Modal title="New Decision Bookmark" artwork={<CheckpointArtwork />} onClose={() => { if (!modalBusy) { selection.current += 1; setNewDecision(false); } }}><form className="stack-form" onSubmit={createDecision} onChange={() => { decisionRequest.current = ""; }}>
      <p>Choose a checkpoint and a block. The saved explanation stays even if that block is later deleted.</p>
      <label>Decision title<input name="title" maxLength={120} required disabled={modalBusy} /></label><label>Explanation<textarea name="explanation" maxLength={4000} required rows={3} disabled={modalBusy} /></label>
      {checkpoints?.checkpoints.length ? <><label>Saved checkpoint<select name="checkpointId" value={snapshot?.id ?? ""} disabled={modalBusy} onChange={event => void selectCheckpoint(event.target.value)}>{!snapshot && <option value="">Loading checkpoint…</option>}{checkpoints.checkpoints.map(moment => <option key={moment.id} value={moment.id}>Checkpoint {moment.number}: {moment.title}</option>)}</select></label>{snapshot && <label>Content anchor<select key={snapshot.id} name="blockId" required disabled={modalBusy}>{snapshot.content.content?.filter(node => typeof node.attrs?.blockId === "string").map(node => <option value={String(node.attrs!.blockId)} key={String(node.attrs!.blockId)}>{nodeText(node).slice(0, 160)}</option>)}</select></label>}{checkpoints.nextCursor && <button type="button" className="text-button" disabled={modalBusy} onClick={() => { setModalBusy(true); void api<CheckpointPage>(`/files/${fileId}/checkpoints?branchId=${editingBranch}&cursor=${checkpoints.nextCursor}`).then(page => setCheckpoints(current => ({ checkpoints: [...(current?.checkpoints ?? []), ...page.checkpoints], nextCursor: page.nextCursor }))).catch(error => setModalError(errorMessage(error))).finally(() => setModalBusy(false)); }}>Load older checkpoints</button>}</> : !modalBusy && <p><Link className="text-button" href={documentPath}>Save a checkpoint in this document first.</Link></p>}
      <label>Linked discussion (optional)<select name="discussionMessageId" disabled={modalBusy}><option value="">No linked message</option>{messages.map(message => <option value={message.id} key={message.id}>{message.authorName}: {message.deletedAt ? "Message removed" : message.body.slice(0, 100)}</option>)}</select></label><ErrorNotice message={modalError} /><div className="form-actions"><button type="button" className="button secondary" disabled={modalBusy} onClick={() => setNewDecision(false)}>Cancel</button><button className="button primary" disabled={modalBusy || !snapshot}>{modalBusy ? "Saving…" : "Save Decision Bookmark"}</button></div>
    </form></Modal>}
    {context && <Modal title={context.bookmark.title} artwork={<CheckpointArtwork />} onClose={() => setContext(null)}><div className="stack-form"><p>{context.bookmark.explanation}</p><p className="muted">Checkpoint {context.checkpoint.number}: {context.checkpoint.title}. {context.bookmark.anchorAvailable ? "Current availability is based on the last saved state." : "The live anchor is unavailable; this is its original saved context."}</p><DecisionPreview content={context.checkpoint.content} blockId={context.bookmark.blockId} /></div></Modal>}
  </main>;
}

function DecisionPreview({ content, blockId }: { content: DocumentContent; blockId: string }) {
  const highlight = Extension.create({ name: "decisionHighlight", addProseMirrorPlugins() {
    return [new Plugin({ props: { decorations(state) {
      const decorations: Decoration[] = [];
      state.doc.descendants((node, position) => { if (node.attrs.blockId === blockId) decorations.push(Decoration.node(position, position + node.nodeSize, { class: "decision-anchor-highlight" })); });
      return DecorationSet.create(state.doc, decorations);
    } } })];
  } });
  const editor = useEditor({ immediatelyRender: false, editable: false, extensions: [...documentExtensions(), highlight], content, editorProps: { attributes: { class: "document-content", role: "textbox", "aria-label": "Decision checkpoint content", "aria-readonly": "true" } } }, [content, blockId]);
  return <div className="draft-preview"><EditorContent editor={editor} /></div>;
}
