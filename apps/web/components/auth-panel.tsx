"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { gsap } from "gsap";
import { ArrowUpRight, Users, Bookmark, Check, Eye, EyeOff, LockKeyhole } from "lucide-react";
import type { PublicUser } from "@flux/shared";
import { api, errorMessage, safeRedirect } from "../lib/api";
import { useSession } from "./session";
import { ErrorNotice, FluxMark } from "./ui";
import { ThemeToggle } from "./theme";
import { RibbonArt } from "./ribbon-art";
import { PeopleArtwork } from "./work-art";

export function AuthPanel() {
  const [mode, setMode] = useState<"login" | "register" | "forgot" | "resend">("login");
  const registering = mode === "register";
  const requesting = mode === "forgot" || mode === "resend";
  const [options, setOptions] = useState<{ inviteOnly: boolean; emailVerification: boolean } | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [preview, setPreview] = useState<"draft" | "checkpoint">("draft");
  const root = useRef<HTMLElement>(null);
  const { user, loading, setUser } = useSession();
  const router = useRouter();
  const search = useSearchParams();
  const next = safeRedirect(search.get("next"));
  const invitation = search.get("invitation") ?? next.match(/^\/invite\/([A-Za-z0-9_-]{43})$/)?.[1];
  useEffect(() => { let active = true; api<{ inviteOnly: boolean; emailVerification: boolean }>("/auth/options").then(value => { if (active) setOptions(value); }).catch(() => { if (active) setError("Account options could not be loaded. Reload before creating an account."); }); return () => { active = false; }; }, []);
  useEffect(() => { if (!loading && user) router.replace(next); }, [loading, user, router, next]);

  useEffect(() => {
    const motion = gsap.matchMedia(root);
    motion.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.timeline({ defaults: { ease: "power3.out" } })
        .from(".auth-headline-line", { yPercent: 105, duration: .85, stagger: .09 })
        .from(".auth-intro", { opacity: 0, y: 10, duration: .5 }, "-=.45");
    });
    return () => motion.revert();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError(""); setNotice("");
    try {
      const account = await api<PublicUser | { verificationRequired: true; message: string }>(mode === "forgot" ? "/auth/forgot-password" : mode === "resend" ? "/auth/request-verification" : registering ? "/auth/register" : "/auth/login", {
        method: "POST", body: JSON.stringify({ name: form.get("name") ?? undefined, email: form.get("email"), password: form.get("password") ?? undefined, invitationToken: invitation ?? undefined }),
      });
      if ("verificationRequired" in account) { setNotice(account.message); return; }
      setUser(account); router.replace(next);
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }

  function switchMode(mode: "login" | "register" | "forgot" | "resend") { setMode(mode); setError(""); setNotice(""); }

  return <main ref={root} className="auth-layout">
    <div className="auth-shell">
    <header className="auth-header"><a href="#sign-in" className="brand-link" aria-label="Flux sign in"><FluxMark /></a><span className="auth-header-note">A shared space for what’s next.</span><ThemeToggle /></header>
    <div className="auth-composition">
    <section className="auth-story" aria-labelledby="auth-headline">
      <RibbonArt mode={preview} />
      <div className="auth-story-content">
        <h1 id="auth-headline"><span><span className="auth-headline-line">Shared work.</span></span><span><span className="auth-headline-line">Room to</span></span><span><span className="auth-headline-line">explore.</span></span></h1>
        <p className="auth-intro">Good ideas don’t happen in isolation. Write together, keep your progress, and make room for what comes next.</p>
      </div>
      <div className="auth-preview"><div className="preview-tabs" role="group" aria-label="Explore Flux preview"><button aria-pressed={preview === "draft"} onClick={() => setPreview("draft")}><Users size={15} />Live draft</button><button aria-pressed={preview === "checkpoint"} onClick={() => setPreview("checkpoint")}><Bookmark size={15} />Checkpoint</button></div><div className="auth-preview-copy" key={preview}><h3>{preview === "draft" ? "Different minds. Same page." : "First draft, kept safe"}</h3><p>{preview === "draft" ? "Edit the same document, see your teammates’ cursors, and let the work move forward." : "Name a moment worth keeping. Later edits won’t erase it; revisit or restore it when you need to."}</p><span className="preview-status"><Check size={13} />{preview === "draft" ? "Live documents are ready" : "Read-only checkpoints are ready"}</span></div></div>
    </section>
    <section className="auth-form-area artwork-trigger" id="sign-in" aria-labelledby="sign-in-heading">
      <div className="auth-form-wrap">
        <div className="auth-form-art"><PeopleArtwork /></div>
        <h2 id="sign-in-heading">{registering ? "Make room for your team" : mode === "forgot" ? "Recover your account" : mode === "resend" ? "Verify your email" : "Welcome back"}</h2>
        <p>{registering ? options?.emailVerification ? options.inviteOnly ? "Use your invited email. Choose your password after verifying it." : "Enter your email. Verify it, then choose your password." : "Create your account, then open a workspace." : mode === "forgot" ? "We’ll email a link to choose a new password." : mode === "resend" ? "Request a fresh link for your registered email address." : "Sign in to pick up where your team left off."}</p>
        <form className="stack-form" onSubmit={submit}>
          {registering && <label>Your name<input name="name" autoComplete="name" maxLength={120} required /></label>}
          <label>Email address<input name="email" type="email" autoComplete="email" maxLength={254} required /></label>
          {!requesting && !(registering && options?.emailVerification) && <div className="password-field"><label htmlFor="password">Password</label><div className="password-input"><input id="password" name="password" type={showPassword ? "text" : "password"} aria-describedby={registering ? "password-hint" : undefined} autoComplete={registering ? "new-password" : "current-password"} minLength={registering ? 12 : 1} maxLength={128} required /><button type="button" className="icon-button" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onClick={() => setShowPassword(current => !current)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>{registering && <span id="password-hint" className="field-hint">At least 12 characters.</span>}</div>}
          <ErrorNotice message={error} />
          {notice && <p className="account-notice" role="status">{notice}{next.startsWith("/invite/") && " After verification, reopen your workspace invitation."}</p>}
          <button className="button primary full-width liquid-button" disabled={busy || (registering && !options)}><span>{busy ? "Please wait…" : requesting ? "Email a link" : registering ? options?.emailVerification ? "Verify and create account" : "Create account" : "Sign in"}</span><ArrowUpRight size={17} /></button>
        </form>
        <p className="auth-switch">{mode !== "login" ? <>Already have an account? <button onClick={() => switchMode("login")}>Sign in</button></> : options?.inviteOnly && !invitation ? "Account creation is invitation-only." : <>New to Flux? <button onClick={() => switchMode("register")}>Create an account</button></>}</p>
        {mode === "login" && <div className="account-help"><button className="text-button" onClick={() => switchMode("forgot")}>Forgot password?</button>{options?.emailVerification && <button className="text-button" onClick={() => switchMode("resend")}>Resend verification link</button>}</div>}
        {requesting && options && !options.emailVerification && <p className="field-hint">Email recovery requires SMTP configuration in this local preview.</p>}
        <div className="auth-privacy"><LockKeyhole size={12} />Private workspaces. Invited teammates only.</div>
      </div>
    </section>
    </div>
    <footer className="auth-footer">
      <span>Bring your people. Keep your progress.</span>
      <nav aria-label="About Flux">
        <Link href="/demo">Explore the demo</Link>
        <Link href="/account/help">Account and data help</Link>
      </nav>
    </footer>
    </div>
  </main>;
}
