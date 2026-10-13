"use client";

import { useState, type ReactNode } from "react";
import { Bookmark, Check, FileText, GitBranch, GitMerge, History, LockKeyhole, MessageSquare } from "lucide-react";
import type { DocumentContent } from "@flux/shared";
import { demoDecision, demoDiscussion, demoDocuments } from "../lib/demo";
import { Avatar, FluxMark } from "./ui";
import { ThemeToggle } from "./theme";
import { DocumentArtwork, WorkspaceArtwork } from "./work-art";

const views = [
  { id: "main", label: "Shared document", icon: FileText },
  { id: "experiment", label: "Experiment", icon: GitBranch },
  { id: "review", label: "Reviewed merge", icon: GitMerge },
  { id: "decisions", label: "Discussion & decision", icon: MessageSquare },
  { id: "history", label: "Saved checkpoints", icon: History },
] as const;
type View = typeof views[number]["id"];

const explanations: Record<View, { title: string; text: string }> = {
  main: { title: "One shared plan", text: "The team starts here. In the live app, invited teammates write together and wait for server-confirmed Saved before leaving." },
  experiment: { title: "Try a different opening time", text: "Ravi starts from a checkpoint and changes the opening time in a separate experiment. Main stays untouched." },
  review: { title: "Keep both contributions", text: "Hana reviews Ravi’s change before the merge. The later start comes across, and her accessibility note from main stays in place." },
  decisions: { title: "Keep the reason with the work", text: "A Decision Bookmark connects the explanation, discussion, and original checkpoint. It is more than a comment that gets lost in chat." },
  history: { title: "Revisit without rewriting", text: "Choose a saved moment to read it. In the live app, restoring creates a new revision and preserves the current document first." },
};

function DocumentNode({ node }: { node: DocumentContent }): ReactNode {
  const children = node.content?.map((child, index) => <DocumentNode key={typeof child.attrs?.blockId === "string" ? child.attrs.blockId : index} node={child} />);
  const id = typeof node.attrs?.blockId === "string" ? `demo-${node.attrs.blockId}` : undefined;
  switch (node.type) {
    case "text": return node.text;
    case "heading": return <h2 id={id}>{children}</h2>;
    case "paragraph": return <p id={id}>{children}</p>;
    case "bulletList": return <ul id={id}>{children}</ul>;
    case "listItem": return <li id={id}>{children}</li>;
    default: return <>{children}</>;
  }
}

function Paper({ content }: { content: DocumentContent }) {
  return <article className="demo-paper" aria-label="Sample document">
    <div className="demo-paper-heading">
      <span>Garden open day</span>
      <LockKeyhole size={14} />
      <span>Read-only sample</span>
    </div>
    <div className="document-content"><DocumentNode node={content} /></div>
  </article>;
}

function Note({ title, children }: { title: string; children: ReactNode }) {
  return <section className="demo-note"><h3>{title}</h3>{children}</section>;
}

export function DemoPage() {
  const [view, setView] = useState<View>("main");
  const [checkpoint, setCheckpoint] = useState<"base" | "merged">("base");
  const explanation = explanations[view];
  const content = view === "experiment" || view === "decisions" ? demoDocuments.experiment
    : view === "review" ? demoDocuments.merged
    : view === "history" ? demoDocuments[checkpoint] : demoDocuments.main;

  function openCheckpoint() {
    setCheckpoint("base");
    setView("history");
  }

  return <main className="demo-shell">
    <a className="demo-skip" href="#demo-content">Skip to sample document</a>
    <header className="demo-header">
      <a href="/demo" aria-label="Flux demo"><FluxMark /></a>
      <span className="demo-badge"><LockKeyhole size={14} />Public demo</span>
      <ThemeToggle />
    </header>
    <div className="demo-intro">
      <div>
        <h1>See how a draft becomes a decision.</h1>
        <p>Explore a small team’s garden plan. The people and documents are fictional; nothing here is live or saved.</p>
      </div>
      <div className="demo-intro-art artwork-trigger" data-tone="coral"><WorkspaceArtwork /></div>
    </div>
    <div className="demo-layout">
      <aside className="demo-sidebar">
        <div className="demo-project">
          <DocumentArtwork />
          <div><strong>Garden open day</strong><span>Sample workspace</span></div>
        </div>
        <nav aria-label="Explore the sample workflow">
          {views.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)}>
              <Icon size={17} />{label}
            </button>
          ))}
        </nav>
        <p className="demo-sidebar-note">No account needed.<br />Your real workspaces are not part of this demo.</p>
      </aside>
      <section id="demo-content" className="demo-content" tabIndex={-1} aria-label="Sample workflow">
        <div className="demo-view-heading" aria-live="polite">
          <h2>{views.find(item => item.id === view)!.label}</h2>
          <span><LockKeyhole size={13} />Read-only</span>
        </div>
        {view === "history" && (
          <div className="demo-checkpoints" role="group" aria-label="Choose a checkpoint">
            <button type="button" aria-pressed={checkpoint === "base"} onClick={() => setCheckpoint("base")}>
              <Bookmark size={15} />First plan
            </button>
            <button type="button" aria-pressed={checkpoint === "merged"} onClick={() => setCheckpoint("merged")}>
              <GitMerge size={15} />After the reviewed merge
            </button>
          </div>
        )}
        {view === "review" && (
          <div className="demo-merge-summary">
            <div><Check size={16} /><span>Opening time: 9 am → 9:30 am</span></div>
            <div><Check size={16} /><span>Accessibility note from main: retained</span></div>
            <p>Sample review by Hana, not the experiment’s author.</p>
          </div>
        )}
        <Paper content={content} />
        <noscript><p className="demo-noscript">JavaScript is needed to switch views. You can still read this sample plan.</p></noscript>
      </section>
      <aside className="demo-context" aria-label="About this sample">
        <Note title={explanation.title}><p>{explanation.text}</p></Note>
        {view === "experiment" && (
          <Note title="What changed">
            <p>The experiment changes one paragraph: 9 am becomes 9:30 am. The team can review it before touching main.</p>
            <button className="text-button" type="button" onClick={() => setView("review")}>See the reviewed result</button>
          </Note>
        )}
        {view === "decisions" ? (
          <>
            <Note title="Sample discussion">
              <div className="demo-discussion">
                {demoDiscussion.map(message => (
                  <div key={message.name}>
                    <Avatar user={message} size="small" />
                    <div><strong>{message.name}</strong><p>{message.text}</p></div>
                  </div>
                ))}
              </div>
            </Note>
            <Note title={demoDecision.title}>
              <span className="demo-decision-status"><Bookmark size={14} />{demoDecision.status}</span>
              <p>{demoDecision.explanation}</p>
              <p className="demo-checkpoint-reference">Checkpoint: {demoDecision.checkpoint}</p>
              <a className="text-button" href={`#demo-${demoDecision.blockId}`}>Read the linked paragraph</a>
            </Note>
          </>
        ) : (
          <Note title="Explore next">
            <p>{view === "history"
              ? "Earlier checkpoints remain readable after a merge. Nothing in this preview can restore or overwrite a document."
              : "See the discussion behind the later start, and the decision kept alongside its checkpoint."}</p>
            <button className="text-button" type="button" onClick={() => setView(view === "history" ? "main" : "decisions")}>
              {view === "history" ? "Back to shared document" : "Read the decision"}
            </button>
          </Note>
        )}
        {view !== "history" && (
          <button className="button secondary demo-history-link" type="button" onClick={openCheckpoint}>
            <History size={16} />Read the first checkpoint
          </button>
        )}
      </aside>
    </div>
    <footer className="demo-footer">
      <span>Flux · Documents, experiments, and decisions.</span>
      <span>Built by Aadvik. Sample content only.</span>
    </footer>
  </main>;
}
