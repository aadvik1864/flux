"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, GitBranch, RefreshCw } from "lucide-react";
import { can, type CheckpointPage, type ExperimentSummary, type FileDetail } from "@flux/shared";
import { api, errorMessage } from "../lib/api";
import { ErrorNotice, FluxMark } from "./ui";
import { ThemeToggle } from "./theme";
import { HistoryArtwork } from "./work-art";

export function ExperimentsPage({ fileId }: { fileId: string }) {
  const [file, setFile] = useState<FileDetail | null>(null);
  const [branches, setBranches] = useState<ExperimentSummary[]>([]);
  const [checkpoints, setCheckpoints] = useState<CheckpointPage | null>(null);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const requestId = useRef(""); const router = useRouter();
  const load = useCallback(async () => {
    setError("");
    try { const [detail, experiments, moments] = await Promise.all([api<FileDetail>(`/files/${fileId}`), api<ExperimentSummary[]>(`/files/${fileId}/branches`), api<CheckpointPage>(`/files/${fileId}/checkpoints`)]);
      setFile(detail); setBranches(experiments); setCheckpoints(moments); }
    catch (error) { setError(errorMessage(error)); }
  }, [fileId]);
  useEffect(() => { void load(); }, [load]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const values = new FormData(event.currentTarget);
    if (!requestId.current) requestId.current = crypto.randomUUID();
    try { const created = await api<ExperimentSummary>(`/files/${fileId}/branches`, { method: "POST", body: JSON.stringify({ name: values.get("name"), checkpointId: values.get("checkpointId"), requestId: requestId.current }) }); router.push(`/files/${fileId}/branches/${created.id}`); }
    catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  return <main className="history-shell"><header className="editor-topbar"><div className="editor-heading"><Link href={`/files/${fileId}`} className="icon-button" aria-label="Back to main document"><ArrowLeft size={20} /></Link><Link href="/" className="editor-brand"><FluxMark /></Link><div><span className="document-workspace">{file?.workspaceName ?? "Workspace"}</span><h1>{file?.name ?? "Experiments"}</h1></div></div><ThemeToggle /></header>
    <div className="experiments-layout"><aside className="experiment-intro artwork-trigger"><HistoryArtwork /><h2>Try a different direction.</h2><p>An experiment starts from a saved main checkpoint. Editing it never changes main.</p>{file && can(file.role, "branch") && (checkpoints?.checkpoints.length ? <form className="stack-form" onSubmit={create} onChange={() => { requestId.current = ""; }}><label>Experiment name<input name="name" required maxLength={60} placeholder="e.g. A shorter introduction" disabled={busy} /></label><label>Start from checkpoint<select name="checkpointId" disabled={busy}>{checkpoints.checkpoints.map(moment => <option key={moment.id} value={moment.id}>Checkpoint {moment.number}: {moment.title}</option>)}</select></label><button className="button primary" disabled={busy}>{busy ? "Creating experiment…" : "Create experiment"}</button>{checkpoints.nextCursor && <button type="button" className="text-button" disabled={busy} onClick={() => { void api<CheckpointPage>(`/files/${fileId}/checkpoints?cursor=${checkpoints.nextCursor}`).then(page => setCheckpoints(current => ({ checkpoints: [...(current?.checkpoints ?? []), ...page.checkpoints], nextCursor: page.nextCursor }))).catch(error => setError(errorMessage(error))); }}>Load older checkpoints</button>}</form> : <p><Link href={`/files/${fileId}`} className="button secondary">Save a main checkpoint first</Link></p>)}<p className="muted">A teammate with review access must approve the exact comparison before a merge.</p></aside>
    <section className="experiment-list" aria-label="Document experiments"><div className="experiment-list-heading"><h2><GitBranch size={21} />Experiments</h2><button className="text-button" onClick={() => void load()}><RefreshCw size={15} />Refresh experiments</button></div><ErrorNotice message={error} />{!file && !error ? <p role="status">Loading experiments…</p> : !branches.length ? <p className="muted">No experiments yet. Main is still your shared starting point.</p> : branches.map(branch => <article key={branch.id} className="experiment-row"><div><h3>{branch.name}</h3><p>{branch.archivedAt ? "Merged · read-only" : "Active experiment"} · Created by {branch.createdByName}</p></div><div className="experiment-row-actions"><Link className="button secondary" href={`/files/${fileId}/branches/${branch.id}`}>{branch.archivedAt ? "Read experiment" : "Open experiment"}</Link>{!branch.archivedAt && <Link className="text-button" href={`/files/${fileId}/branches/${branch.id}/review`}>Compare with main</Link>}</div></article>)}</section></div></main>;
}
