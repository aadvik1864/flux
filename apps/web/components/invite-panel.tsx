"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Users } from "lucide-react";
import { api, errorMessage } from "../lib/api";
import { useSession } from "./session";
import { ErrorNotice, FluxMark } from "./ui";
import { ThemeToggle } from "./theme";

export function InvitePanel({ token }: { token: string }) {
  const [invitation, setInvitation] = useState<{ workspaceName: string; role: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const { user, signOut } = useSession();
  useEffect(() => {
    let active = true;
    api<{ workspaceName: string; role: string }>(`/invitations/${token}`).then(data => { if (active) setInvitation(data); }).catch(error => { if (active) setError(errorMessage(error)); });
    return () => { active = false; };
  }, [token]);
  async function accept() {
    setBusy(true); setError("");
    try {
      const data = await api<{ workspaceId: string }>(`/invitations/${token}/accept`, { method: "POST" });
      router.push(`/workspaces/${data.workspaceId}`);
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <main className="invite-page"><div className="invite-heading"><Link href="/" className="brand-link"><FluxMark /></Link><ThemeToggle /></div><section className="invite-card"><div className="empty-icon"><Users size={29} /></div><h1>{invitation ? `Join ${invitation.workspaceName}` : error ? "Invitation unavailable" : "Opening invitation…"}</h1>{invitation && <p>You’ve been invited as an {invitation.role.toLowerCase()}. Join to see your team’s shared documents.</p>}<ErrorNotice message={error} />{invitation && <button className="button primary" disabled={busy} onClick={() => void accept()}>{busy ? "Joining…" : "Join workspace"}</button>}<p className="muted">Signed in as {user?.email}</p><button className="text-button" onClick={() => void signOut().catch(error => setError(errorMessage(error)))}>Use a different account</button></section></main>;
}
