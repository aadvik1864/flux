"use client";

import { useEffect, useMemo, useState, useRef, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, FolderOpen, LogOut, Plus, Users, UserPlus, Check, Copy, Search, List, LayoutGrid, ChevronDown, Command, Bookmark, ArrowRight, X, Menu, PanelLeftClose } from "lucide-react";
import { can, type WorkspaceSummary, type WorkspaceDetail } from "@flux/shared";
import { api, errorMessage } from "../lib/api";
import { useSession } from "./session";
import { Avatar, ErrorNotice, FluxMark, Modal } from "./ui";
import { ThemeToggle } from "./theme";
import { ClickSpark, SpotlightCard } from "./effects";
import { findDocuments, type DocumentSort } from "../lib/document-list";
import { CheckpointArtwork, DocumentArtwork, PeopleArtwork, SearchArtwork, WorkspaceArtwork, documentTone } from "./work-art";

export function Dashboard({ workspaceId }: { workspaceId?: string }) {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [workspace, setWorkspace] = useState<WorkspaceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<"workspace" | "file" | "invite" | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<DocumentSort>("updated");
  const [view, setView] = useState<"list" | "grid">("grid");
  const [teamOpen, setTeamOpen] = useState(true);
  const [quickOpen, setQuickOpen] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const navigationButton = useRef<HTMLButtonElement>(null);
  const { user, signOut } = useSession();
  const router = useRouter();
  const visibleFiles = useMemo(() => findDocuments(workspace?.files ?? [], query, sort), [workspace, query, sort]);
  const commandFiles = findDocuments(workspace?.files ?? [], commandQuery).slice(0, 8);
  const commandWorkspaces = workspaces.filter(item => item.name.toLocaleLowerCase().includes(commandQuery.trim().toLocaleLowerCase())).slice(0, 6);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && navigationOpen) { setNavigationOpen(false); navigationButton.current?.focus(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        if (modal) return;
        event.preventDefault(); setCommandQuery(""); setQuickOpen(current => !current);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [modal, navigationOpen]);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true); setError(""); setWorkspace(null); setQuery("");
      try {
        const list = await api<WorkspaceSummary[]>("/workspaces");
        if (!active) return;
        setWorkspaces(list);
        const id = workspaceId ?? list[0]?.id;
        if (id) {
          const detail = await api<WorkspaceDetail>(`/workspaces/${id}`);
          if (active) setWorkspace(detail);
        }
      } catch (error) { if (active) setError(errorMessage(error)); }
      finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; };
  }, [workspaceId]);

  function openModal(kind: typeof modal) { setQuickOpen(false); setModal(kind); setFormError(""); setInviteUrl(""); setCopied(false); }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setFormError("");
    try {
      if (modal === "workspace") {
        const created = await api<{ id: string }>("/workspaces", { method: "POST", body: JSON.stringify({ name: form.get("name"), description: form.get("description") }) });
        setModal(null); router.push(`/workspaces/${created.id}`);
      } else if (modal === "file" && workspace) {
        const created = await api<{ id: string }>(`/workspaces/${workspace.id}/files`, { method: "POST", body: JSON.stringify({ name: form.get("name") }) });
        setModal(null); router.push(`/files/${created.id}`);
      } else if (modal === "invite" && workspace) {
        const invitation = await api<{ url: string }>(`/workspaces/${workspace.id}/invitations`, { method: "POST", body: JSON.stringify({ email: form.get("email"), role: form.get("role") }) });
        setInviteUrl(invitation.url);
      }
    } catch (error) { setFormError(errorMessage(error)); }
    finally { setBusy(false); }
  }

  async function removeMember(userId: string, name: string) {
    if (!workspace || !window.confirm(`Remove ${name} from this workspace? Their document access will be revoked.`)) return;
    try {
      await api(`/workspaces/${workspace.id}/members/${userId}`, { method: "DELETE" });
      setWorkspace(await api<WorkspaceDetail>(`/workspaces/${workspace.id}`));
    } catch (error) { setError(errorMessage(error)); }
  }

  return <div className={`workspace-shell ${navigationOpen ? "navigation-open" : ""}`}>
    <aside className="sidebar" id="workspace-navigation">
      <div className="sidebar-brand"><Link href="/" aria-label="Flux home" className="brand-link"><FluxMark /></Link><span className="preview-chip">Preview</span><button className="icon-button mobile-navigation-close" aria-label="Close workspace navigation" onClick={() => { setNavigationOpen(false); navigationButton.current?.focus(); }}><PanelLeftClose size={18} /></button></div>
      <button className="quick-open-button" onClick={() => { setCommandQuery(""); setQuickOpen(true); }}><Search size={16} /><span>Quick open</span><kbd>Ctrl K</kbd></button>
      <div className="sidebar-section-heading">Your workspaces<button className="icon-button" onClick={() => openModal("workspace")} aria-label="Create workspace"><Plus size={18} /></button></div>
      <nav aria-label="Workspaces" className="workspace-nav">
        {workspaces.map(item => <Link href={`/workspaces/${item.id}`} key={item.id} className={workspace?.id === item.id ? "active" : ""} aria-current={workspace?.id === item.id ? "page" : undefined} onClick={() => setNavigationOpen(false)}><span className="workspace-initial">{item.name.slice(0, 1).toUpperCase()}</span><span>{item.name}</span></Link>)}
        {!loading && !workspaces.length && <p className="sidebar-hint">Your first workspace will appear here.</p>}
      </nav>
      <div className="sidebar-roadmap artwork-trigger"><WorkspaceArtwork /><strong>Room to make progress</strong><p>Write together. Save checkpoints. Revisit earlier work.</p><button className="sidebar-start" onClick={() => openModal("workspace")}>Create a workspace<Plus size={14} /></button></div>
      <div className="sidebar-profile">{user && <><Avatar user={user} /><div><strong>{user.name}</strong><span>{user.email}</span></div></>}<button className="icon-button" aria-label="Sign out" onClick={() => void signOut().catch(error => setError(errorMessage(error)))}><LogOut size={17} /></button></div>
    </aside>
    <main className="workspace-main">
      <header className="workspace-topbar"><div className="workspace-location"><button ref={navigationButton} className="icon-button mobile-navigation-toggle" aria-label="Workspace navigation" aria-expanded={navigationOpen} aria-controls="workspace-navigation" onClick={() => setNavigationOpen(current => !current)}><Menu size={19} /></button><Link href="/" className="mobile-workspace-brand" aria-label="Flux home"><FluxMark /></Link><span className="workspace-location-name"><FolderOpen size={15} />{workspace ? workspace.name : "Your workspaces"}</span></div><div className="workspace-topbar-tools"><button className="icon-button header-quick-open" aria-label="Quick open" onClick={() => { setCommandQuery(""); setQuickOpen(true); }}><Search size={17} /></button><ThemeToggle /></div></header>
      <div className="workspace-content">
        <ErrorNotice message={error} />
        {loading ? <div className="empty-state" role="status">Loading your workspace…</div> : workspace ? <>
          <div className="workspace-heading artwork-trigger"><div className="workspace-title-group"><WorkspaceArtwork /><div><h1>{workspace.name}</h1><p>{workspace.description || "Your team’s documents, with the context kept close."}</p><div className="workspace-metadata"><span><Users size={13} />{workspace.members.length} {workspace.members.length === 1 ? "teammate" : "teammates"}</span><span className="workspace-role">{workspace.role.toLowerCase()}</span></div></div></div><ClickSpark className="workspace-actions">{can(workspace.role, "manageMembers") && <button className="button secondary" onClick={() => openModal("invite")}><UserPlus size={16} />Invite teammate</button>}{can(workspace.role, "edit") && <button className="button primary liquid-button" onClick={() => openModal("file")}><Plus size={16} /><span>New document</span></button>}</ClickSpark></div>
          <div className="workspace-grid"><section className="document-list" aria-labelledby="documents-heading">
            <div className="section-heading"><h2 id="documents-heading">Documents <span className="count">{workspace.files.length}</span></h2><div className="view-switch" aria-label="Document layout"><button aria-label="List view" aria-pressed={view === "list"} onClick={() => setView("list")}><List size={16} /></button><button aria-label="Grid view" aria-pressed={view === "grid"} onClick={() => setView("grid")}><LayoutGrid size={16} /></button></div></div>
            <div className="document-filters"><div className="document-search"><Search size={15} /><input ref={searchInput} aria-label="Find documents" placeholder="Find a document…" value={query} onChange={event => setQuery(event.target.value)} />{query && <button className="icon-button" aria-label="Clear document search" onClick={() => { setQuery(""); searchInput.current?.focus(); }}><X size={14} /></button>}</div><select aria-label="Sort documents" value={sort} onChange={event => setSort(event.target.value as DocumentSort)}><option value="updated">Recently edited</option><option value="name">Name A–Z</option></select></div>
            {visibleFiles.length ? <div className={`file-list ${view === "grid" ? "file-grid" : ""}`}>{visibleFiles.map(file => <Link key={file.id} href={`/files/${file.id}`} className="file-row" data-tone={documentTone(file.id)}><DocumentArtwork /><div><strong>{file.name}</strong></div><span className="file-date"><span>Edited </span>{new Date(file.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span><ArrowUpRight className="file-arrow" size={16} /></Link>)}</div> : query ? <div className="empty-state search-empty artwork-trigger"><SearchArtwork /><h3>No matching documents</h3><p>Try a different name or clear your search.</p><button className="text-button" onClick={() => setQuery("")}>Clear search</button></div> : <div className="empty-state artwork-trigger"><WorkspaceArtwork /><h3>A blank page is a good place to start</h3><p>{can(workspace.role, "edit") ? "Create a document, invite someone, and write together." : "Documents your teammates create will appear here."}</p>{can(workspace.role, "edit") && <button className="button secondary" onClick={() => openModal("file")}>Create your first document</button>}</div>}
            {!!workspace.files.length && <div className="document-list-footer">{visibleFiles.length} of {workspace.files.length} documents<span><Bookmark size={13} />History inside every document</span></div>}
          </section><aside className="workspace-rail"><section className="team-section" aria-labelledby="team-heading"><div className="section-heading"><h2 id="team-heading"><Users size={16} />In this workspace</h2><button className="icon-button" aria-label={teamOpen ? "Collapse team" : "Expand team"} aria-expanded={teamOpen} aria-controls="workspace-team" onClick={() => setTeamOpen(current => !current)}><ChevronDown size={17} className={teamOpen ? "" : "collapsed"} /></button></div>{teamOpen && <div className="member-list" id="workspace-team">{workspace.members.map(member => <div className="member-row" key={member.user.id}><Avatar user={member.user} size="small" /><div><strong>{member.user.name}{member.user.id === user?.id ? " (you)" : ""}</strong><span>{member.user.email}</span><span className="member-role">{member.role.toLowerCase()}</span></div>{can(workspace.role, "manageMembers") && member.role !== "OWNER" && <button className="text-button danger" onClick={() => void removeMember(member.user.id, member.user.name)}>Remove</button>}</div>)}</div>}</section><SpotlightCard className="workspace-tip artwork-trigger"><CheckpointArtwork /><strong>Keep a version worth keeping.</strong><p>Open a document, wait for Saved, then name a checkpoint. Later edits won’t erase it.</p>{workspace.files[0] && <Link href={`/files/${workspace.files[0].id}/history`}>Explore document history<ArrowRight size={14} /></Link>}</SpotlightCard></aside></div>
        </> : !error && <div className="onboarding-layout"><div className="first-workspace artwork-trigger"><WorkspaceArtwork /><h1>Your ideas need a place to land.</h1><p>Create a private workspace, bring in your teammates, and start your first shared document.</p><ClickSpark><button className="button primary liquid-button" onClick={() => openModal("workspace")}><Plus size={17} /><span>Create workspace</span></button></ClickSpark><span className="muted">Only invited teammates can access your work.</span></div><SpotlightCard className="onboarding-preview artwork-trigger"><div className="preview-caption">Connected work. Kept safe.</div><CheckpointArtwork /><div className="onboarding-feature"><Users size={17} /><div><strong>Write in the same space</strong><p>Live editing, cursors, and your team nearby.</p></div></div><div className="onboarding-feature"><Bookmark size={17} /><div><strong>Keep earlier versions</strong><p>Named checkpoints you can revisit and restore.</p></div></div><button className="text-button onboarding-start" onClick={() => openModal("workspace")}>Set up your workspace<ArrowRight size={15} /></button></SpotlightCard></div>}
      </div>
    </main>
    {quickOpen && <Modal title="Quick open" artwork={<SearchArtwork />} onClose={() => setQuickOpen(false)}><form className="command-search" onSubmit={event => { event.preventDefault(); const href = commandFiles[0] ? `/files/${commandFiles[0].id}` : commandWorkspaces[0] ? `/workspaces/${commandWorkspaces[0].id}` : null; if (href) { setQuickOpen(false); router.push(href); } }}><Search size={18} /><input aria-label="Quick-open search" autoFocus placeholder="Find documents or workspaces…" value={commandQuery} onChange={event => setCommandQuery(event.target.value)} /></form><nav className="command-results" aria-label="Quick-open results">{commandFiles.length > 0 && <p>Documents in {workspace?.name}</p>}{commandFiles.map(file => <Link key={file.id} href={`/files/${file.id}`} className="artwork-trigger" data-tone={documentTone(file.id)} onClick={() => setQuickOpen(false)}><DocumentArtwork /><span>{file.name}</span><ArrowUpRight size={14} /></Link>)}{commandWorkspaces.length > 0 && <p>Workspaces</p>}{commandWorkspaces.map(item => <Link key={item.id} href={`/workspaces/${item.id}`} onClick={() => setQuickOpen(false)}><FolderOpen size={17} /><span>{item.name}</span><ArrowUpRight size={14} /></Link>)}{!commandFiles.length && !commandWorkspaces.length && <div className="command-empty">No results. Try another name.</div>}</nav><div className="command-footer"><Command size={13} /><span>Tab to navigate · Enter to open · Esc to close</span></div></Modal>}
    {modal && <Modal title={modal === "workspace" ? "Create a workspace" : modal === "file" ? "New document" : "Invite a teammate"} artwork={modal === "workspace" ? <WorkspaceArtwork /> : modal === "file" ? <DocumentArtwork /> : <PeopleArtwork />} onClose={() => { if (!busy) setModal(null); }}>
      {inviteUrl ? <div className="invite-result"><div className="success-line"><Check size={19} />Invitation link is ready</div><p>Share this link with the invited person. They must sign in with the matching email address. The link expires in 48 hours.</p><label>Invitation link<input value={inviteUrl} readOnly /></label><button className="button primary" onClick={async () => { try { await navigator.clipboard.writeText(inviteUrl); setCopied(true); } catch { setFormError("Copy the link from the field above."); } }}><Copy size={16} />{copied ? "Copied" : "Copy link"}</button><ErrorNotice message={formError} /></div> : <form className="stack-form" onSubmit={submit}>
        {modal !== "invite" ? <label>{modal === "workspace" ? "Workspace name" : "Document name"}<input name="name" maxLength={120} placeholder={modal === "workspace" ? "e.g. Startup competition" : "e.g. Project proposal"} required /></label> : <><p className="muted">Invite links are email-bound. Email delivery is not configured in this preview.</p><label>Email address<input name="email" type="email" required /></label><label>Role<select name="role" defaultValue="EDITOR"><option value="EDITOR">Editor — can write and create documents</option><option value="REVIEWER">Reviewer — read-only until reviews are available</option><option value="VIEWER">Viewer — read-only access</option></select></label></>}
        {modal === "workspace" && <label>Description <span className="muted">(optional)</span><textarea name="description" rows={3} maxLength={500} placeholder="What are you working on together?" /></label>}
        <ErrorNotice message={formError} /><div className="form-actions"><button type="button" className="button secondary" disabled={busy} onClick={() => setModal(null)}>Cancel</button><button className="button primary" disabled={busy}>{busy ? "Please wait…" : modal === "workspace" ? "Create workspace" : modal === "file" ? "Create document" : "Create invitation"}</button></div>
      </form>}
    </Modal>}
  </div>;
}
