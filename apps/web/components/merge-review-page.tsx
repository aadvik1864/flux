"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EditorContent, useEditor } from "@tiptap/react";
import { analyzeMerge, documentExtensions, validateDocument } from "@flux/document-model";
import { can, type BlockResolution, type DocumentContent, type FileDetail, type MergeApprovalSummary, type MergePreview } from "@flux/shared";
import { ArrowLeft, ArrowUp, ArrowDown, GitMerge, RefreshCw } from "lucide-react";
import { api, errorMessage } from "../lib/api";
import { ErrorNotice, FluxMark, Modal } from "./ui";
import { useSession } from "./session";
import { ThemeToggle } from "./theme";
import { HistoryArtwork } from "./work-art";

function text(node?: DocumentContent): string { return !node ? "Deleted / not present" : node.text ?? node.content?.map(child => text(child)).join(" ") ?? node.type; }
const find = (document: DocumentContent, id: string) => document.content?.find(node => node.attrs?.blockId === id);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function MergeReviewPage({ fileId, branchId }: { fileId: string; branchId: string }) {
  const [file, setFile] = useState<FileDetail | null>(null); const [preview, setPreview] = useState<MergePreview | null>(null);
  const [approvals, setApprovals] = useState<MergeApprovalSummary[]>([]); const [selected, setSelected] = useState("");
  const [resolutions, setResolutions] = useState<Record<string, BlockResolution>>({}); const [order, setOrder] = useState<string[] | undefined>();
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [page, setPage] = useState(0);
  const [view, setView] = useState<{ title: string; content: DocumentContent } | null>(null); const [confirmMerge, setConfirmMerge] = useState(false);
  const [approvedContent, setApprovedContent] = useState<DocumentContent | null>(null);
  const approvalRequest = useRef(""); const mergeRequest = useRef(""); const { user } = useSession(); const router = useRouter();
  const load = useCallback(async () => {
    setError(""); setBusy(true);
    try { const [detail, comparison, experiment] = await Promise.all([api<FileDetail>(`/files/${fileId}`), api<MergePreview>(`/files/${fileId}/branches/${branchId}/compare`), api<{ approvals: MergeApprovalSummary[] }>(`/files/${fileId}/branches/${branchId}`)]);
      setFile(detail); setPreview(comparison); setApprovals(experiment.approvals); setSelected(experiment.approvals[0]?.id ?? "");
      setResolutions({}); setOrder(undefined); setPage(0); approvalRequest.current = ""; mergeRequest.current = ""; }
    catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }, [fileId, branchId]);
  useEffect(() => { void load(); }, [load]);
  const analysis = useMemo(() => {
    if (!preview) return null;
    try { const result = analyzeMerge(preview.base, preview.main, preview.experiment, resolutions, order); if (result.result) result.result = validateDocument(result.result); return { value: result, error: "" }; }
    catch (error) { return { value: null, error: errorMessage(error) }; }
  }, [preview, resolutions, order]);
  const approval = approvals.find(item => item.id === selected);
  const currentApproval = approval && preview && same(approval.sourceHead, preview.sourceHead) && same(approval.mainHead, preview.mainHead);
  async function approve() {
    if (!preview || !analysis?.value?.result) return;
    setBusy(true); setError(""); if (!approvalRequest.current) approvalRequest.current = crypto.randomUUID();
    try { const result = await api<MergeApprovalSummary>(`/files/${fileId}/branches/${branchId}/approvals`, { method: "POST", body: JSON.stringify({ requestId: approvalRequest.current, sourceHead: preview.sourceHead, mainHead: preview.mainHead, resolutions, ...(order ? { order } : {}) }) });
      setApprovals(current => [result, ...current.filter(item => item.approvedById !== result.approvedById)]); setSelected(result.id); mergeRequest.current = ""; }
    catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  async function merge() {
    if (!approval) return;
    setBusy(true); setError(""); if (!mergeRequest.current) mergeRequest.current = crypto.randomUUID();
    try { await api(`/files/${fileId}/branches/${branchId}/merge`, { method: "POST", body: JSON.stringify({ approvalId: approval.id, requestId: mergeRequest.current }) }); router.push(`/files/${fileId}`); }
    catch (error) { setConfirmMerge(false); setError(errorMessage(error)); } finally { setBusy(false); }
  }
  async function reviewApprovedMerge() {
    if (!approval) return;
    setBusy(true); setError(""); setApprovedContent(null);
    try {
      const result = await api<MergeApprovalSummary & { content: DocumentContent }>(`/files/${fileId}/branches/${branchId}/approvals/${approval.id}`);
      if (result.resultHash !== approval.resultHash) throw new Error("The approval changed. Refresh the review");
      setApprovedContent(result.content); setConfirmMerge(true);
    } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  const reviewable = file && user && preview && can(file.role, "review") && user.id !== preview.branch.createdById;
  const value = analysis?.value;
  return <main className="history-shell"><header className="editor-topbar"><div className="editor-heading"><Link href={`/files/${fileId}/branches`} className="icon-button" aria-label="Back to experiments"><ArrowLeft size={20} /></Link><Link href="/" className="editor-brand"><FluxMark /></Link><div><span className="document-workspace">{file?.name ?? "Document"}</span><h1>{preview?.branch.name ?? "Review experiment"}</h1></div></div><ThemeToggle /></header><div className="merge-review-layout"><section className="merge-review-intro artwork-trigger"><HistoryArtwork /><div><h2>Review before main changes.</h2><p>Compare the base checkpoint, current main, and this experiment. Main-only changes stay; conflicting blocks and ambiguous ordering need your decision.</p></div><button className="button secondary" disabled={busy} onClick={() => void load()}><RefreshCw size={15} />Refresh review</button></section><ErrorNotice message={error} />{analysis?.error && <ErrorNotice message={analysis.error} />}
    {preview && <><div className="merge-preview-actions">{([['Base checkpoint', preview.base], ['Reviewed main', preview.main], ['Reviewed experiment', preview.experiment]] as const).map(([title, content], index) => <button key={title} className="button secondary" data-tone={["slate", "coral", "orchid"][index]} onClick={() => setView({ title, content })}>{title}</button>)}{value?.result && <button className="button secondary" onClick={() => setView({ title: "Reviewed result", content: value.result! })}>Preview merged result</button>}</div><p className="muted">Main session {preview.mainHead.generation + 1}, revision {preview.mainHead.revision}; experiment revision {preview.sourceHead.revision}. Refreshing replaces this review with the latest heads.</p>
      {preview.conflicts.length ? <section aria-label="Merge conflicts" className="merge-conflicts"><h2>{preview.conflicts.length} {preview.conflicts.length === 1 ? "block needs" : "blocks need"} a decision</h2>{preview.conflicts.slice(page * 20, (page + 1) * 20).map((conflict, index) => <fieldset key={conflict.blockId} className="merge-conflict"><legend>Block {page * 20 + index + 1}: {conflict.reason === "STRUCTURE" ? "Review the full structure" : conflict.reason === "EDIT_DELETE" ? "Edit / delete conflict" : "Both sides changed"}</legend><div className="merge-conflict-sides"><div><strong>Main</strong><p>{text(find(preview.main, conflict.blockId))}</p></div><div><strong>Experiment</strong><p>{text(find(preview.experiment, conflict.blockId))}</p></div></div><div className="merge-resolution-options">{([['main', 'Keep main'], ['experiment', 'Use experiment'], ['delete', 'Remove block']] as const).map(([choice, label]) => <label key={choice}><input type="radio" name={`resolution-${conflict.blockId}`} value={choice} checked={resolutions[conflict.blockId] === choice} disabled={busy} onChange={() => { setResolutions(current => ({ ...current, [conflict.blockId]: choice })); setOrder(undefined); approvalRequest.current = ""; }} />{label}</label>)}</div></fieldset>)}{preview.conflicts.length > 20 && <div className="merge-pagination"><button className="button secondary" disabled={!page} onClick={() => setPage(current => current - 1)}>Previous conflicts</button><span>Page {page + 1} of {Math.ceil(preview.conflicts.length / 20)}</span><button className="button secondary" disabled={(page + 1) * 20 >= preview.conflicts.length} onClick={() => setPage(current => current + 1)}>Next conflicts</button></div>}</section> : <p className="merge-safe-note">These block changes combine without a content conflict. A teammate must still approve the exact result.</p>}
      {value?.orderConflict && !value.unresolved.length && <section className="merge-order" aria-label="Explicit merged block order"><h2>Choose the resulting order.</h2><p>Ordering is ambiguous. Review this list, move blocks if needed, then explicitly confirm it.</p><ol>{(order ?? value.blockIds).map((id, index, sequence) => <li key={id}><span>{text(find(preview.main, id) ?? find(preview.experiment, id)).slice(0, 140)}</span><button className="icon-button" aria-label={`Move block ${index + 1} up`} disabled={busy || index === 0} onClick={() => { const next = [...sequence]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; setOrder(next); approvalRequest.current = ""; }}><ArrowUp size={17} /></button><button className="icon-button" aria-label={`Move block ${index + 1} down`} disabled={busy || index === sequence.length - 1} onClick={() => { const next = [...sequence]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; setOrder(next); approvalRequest.current = ""; }}><ArrowDown size={17} /></button></li>)}</ol>{!order && <button className="button secondary" disabled={busy} onClick={() => { setOrder(value.blockIds); approvalRequest.current = ""; }}>Use displayed order</button>}</section>}
      <section className="merge-approval" aria-label="Merge approval">
        <h2>Approval & finalization</h2>
        {!reviewable && <p className="muted">The experiment creator cannot approve their own merge. A different owner, admin, or reviewer must review it.</p>}
        {reviewable && <button className="button primary" disabled={busy || !value?.result} onClick={() => void approve()}>Approve reviewed result</button>}
        {approvals.length > 0 && <>
          <label>Approved review<select value={selected} disabled={busy} onChange={event => { setSelected(event.target.value); mergeRequest.current = ""; }}>{approvals.map(item => <option value={item.id} key={item.id}>{item.approvedByName} · {new Date(item.createdAt).toLocaleString()}</option>)}</select></label>
          <p className="muted">{currentApproval ? "This approval matches the displayed heads. Finalization previews its exact approved result and the server rechecks both heads and reviewer access." : "This approval is outdated. Refresh and obtain a new approval before merging."}</p>
          {file && can(file.role, "merge") && <button className="button primary" disabled={busy || !currentApproval} onClick={() => void reviewApprovedMerge()}><GitMerge size={17} />Finalize approved merge</button>}
        </>}
        <Link className="text-button" href={`/files/${fileId}/branches/${branchId}`}>Return to experiment</Link>
        <Link className="text-button" href={`/files/${fileId}/discuss?branchId=${encodeURIComponent(branchId)}`}>Discuss this experiment</Link>
      </section></>}
    {!preview && !error && <p role="status">Loading the authoritative comparison…</p>}</div>
    {view && <Modal title={view.title} artwork={<HistoryArtwork />} onClose={() => setView(null)}><ReviewEditor key={view.title} content={view.content} /></Modal>}
    {confirmMerge && approvedContent && <Modal title="Merge the approved experiment" artwork={<HistoryArtwork />} onClose={() => { if (!busy) setConfirmMerge(false); }}><div className="stack-form"><p>This is the exact result approved by {approval?.approvedByName}, not your current unapproved resolution choices. Flux preserves main and the experiment as checkpoints, applies this result to live main, then archives the experiment. New edits or revoked review access reject the action.</p><ReviewEditor content={approvedContent} /><div className="form-actions"><button className="button secondary" disabled={busy} onClick={() => setConfirmMerge(false)}>Cancel</button><button className="button primary" disabled={busy} onClick={() => void merge()}>{busy ? "Merging…" : "Confirm approved merge"}</button></div></div></Modal>}
  </main>;
}

function ReviewEditor({ content }: { content: DocumentContent }) {
  const editor = useEditor({ immediatelyRender: false, editable: false, extensions: documentExtensions(), content, editorProps: { attributes: { class: "document-content", role: "textbox", "aria-label": "Review document content", "aria-readonly": "true" } } });
  return <div className="draft-preview"><EditorContent editor={editor} /></div>;
}
