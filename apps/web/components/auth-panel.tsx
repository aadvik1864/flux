"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, FileText, Users, Bookmark, Check, Eye, EyeOff } from "lucide-react";
import type { PublicUser } from "@flux/shared";
import { api, errorMessage, safeRedirect } from "../lib/api";
import { useSession } from "./session";
import { ErrorNotice, FluxMark } from "./ui";
import { ThemeToggle } from "./theme";
import { SpotlightCard } from "./effects";

export function AuthPanel() {
  const [registering, setRegistering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [preview, setPreview] = useState<"draft" | "checkpoint">("draft");
  const { user, loading, setUser } = useSession();
  const router = useRouter();
  const search = useSearchParams();
  const next = safeRedirect(search.get("next"));
  useEffect(() => { if (!loading && user) router.replace(next); }, [loading, user, router, next]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      const account = await api<PublicUser>(registering ? "/auth/register" : "/auth/login", {
        method: "POST", body: JSON.stringify({ name: form.get("name"), email: form.get("email"), password: form.get("password") }),
      });
      setUser(account); router.replace(next);
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }

  return <main className="auth-layout">
    <section className="auth-story">
      <FluxMark />
      <div className="auth-story-content">
        <h1>Good work starts<br />with shared space.</h1>
        <p>A place for your team’s working documents, unfinished thoughts, and next big idea.</p>
        <SpotlightCard className="auth-preview"><div className="preview-tabs" role="group" aria-label="Explore Flux preview"><button aria-pressed={preview === "draft"} onClick={() => setPreview("draft")}><Users size={14} />Live draft</button><button aria-pressed={preview === "checkpoint"} onClick={() => setPreview("checkpoint")}><Bookmark size={14} />Checkpoint</button></div><div className="auth-preview-document" key={preview}><div className="preview-document-heading"><FileText size={16} /><strong>Project proposal</strong><span>Example</span></div><h3>{preview === "draft" ? "A shared starting point" : "First draft, kept safe"}</h3><p>{preview === "draft" ? "Bring your team’s ideas into the same document. Edit together, without passing files back and forth." : "Keep a named version of your work. Explore later changes knowing you can revisit this moment."}</p><div className="preview-status">{preview === "draft" ? <><span className="preview-collaborator">J</span><span className="preview-collaborator alternate">M</span><span>Writing together</span></> : <><Check size={14} /><span>Read-only checkpoint</span></>}</div></div></SpotlightCard>
        <p className="story-footnote">Live documents and checkpoints, together. Experiments and reviews are next.</p>
      </div>
      <span className="auth-footer">Shared work. Room to think.</span>
    </section>
    <section className="auth-form-area">
      <div className="auth-tools"><ThemeToggle /></div>
      <div className="auth-form-wrap">
        <div className="auth-mobile-logo"><FluxMark /></div>
        <h2>{registering ? "Make room for your team" : "Welcome back"}</h2>
        <p>{registering ? "Create your account, then open a workspace." : "Sign in to pick up where your team left off."}</p>
        <form className="stack-form" onSubmit={submit}>
          {registering && <label>Your name<input name="name" autoComplete="name" maxLength={120} required /></label>}
          <label>Email address<input name="email" type="email" autoComplete="email" maxLength={254} required /></label>
          <div className="password-field"><label htmlFor="password">Password</label><div className="password-input"><input id="password" name="password" type={showPassword ? "text" : "password"} aria-describedby={registering ? "password-hint" : undefined} autoComplete={registering ? "new-password" : "current-password"} minLength={registering ? 12 : 1} maxLength={128} required /><button type="button" className="icon-button" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onClick={() => setShowPassword(current => !current)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>{registering && <span id="password-hint" className="field-hint">At least 12 characters.</span>}</div>
          <ErrorNotice message={error} />
          <button className="button primary full-width" disabled={busy}>{busy ? "Please wait…" : registering ? "Create account" : "Sign in"}<ArrowRight size={17} /></button>
        </form>
        <p className="auth-switch">{registering ? "Already have an account?" : "New to Flux?"} <button onClick={() => { setRegistering(!registering); setError(""); }}>{registering ? "Sign in" : "Create an account"}</button></p>
        <div className="early-access-note">Development preview · Documents and history are ready. Branching, calls, and other formats are still being built.</div>
      </div>
    </section>
  </main>;
}
