"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PublicUser } from "@flux/shared";
import { api, errorMessage } from "../lib/api";
import { useSession } from "./session";
import { ErrorNotice, FluxMark } from "./ui";
import { ThemeToggle } from "./theme";
import { PeopleArtwork } from "./work-art";

export function AccountLink({ action }: { action: "verify-email" | "reset-password" }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const read = useRef(false);
  const { setUser } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (read.current) return;
    read.current = true;
    const value = window.location.hash.slice(1);
    if (/^[A-Za-z0-9_-]{43}$/.test(value)) setToken(value);
    else setError("The email link is incomplete. Request a new link from sign in.");
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const form = new FormData(event.currentTarget);
      if (form.get("password") !== form.get("confirmation")) throw new Error("The passwords don’t match");
      const user = await api<PublicUser>(`/auth/${action}`, { method: "POST", body: JSON.stringify({ token, password: form.get("password") }) });
      setUser(user); router.replace("/");
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <main className="invite-page"><header className="invite-heading"><Link href="/login" className="brand-link"><FluxMark /></Link><ThemeToggle /></header><section className="invite-card account-link-card artwork-trigger"><PeopleArtwork /><h1>{action === "verify-email" ? "Your email. Your workspace." : "Choose a new password"}</h1><p>{action === "verify-email" ? "Verify your email by choosing your own password. No workspace access is granted before verification." : "This signs out your other sessions. Keep any unsaved document drafts open until they show Saved."}</p><form className="stack-form" onSubmit={submit}><label>New password<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label><label>Confirm password<input name="confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label><ErrorNotice message={error} /><button className="button primary" disabled={busy || !token}>{busy ? "Please wait…" : action === "verify-email" ? "Verify email and continue" : "Reset password"}</button></form><Link className="text-button" href="/login">Back to sign in</Link></section></main>;
}
