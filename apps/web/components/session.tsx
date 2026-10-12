"use client";

import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { PublicUser } from "@flux/shared";
import { api, ApiError, errorMessage } from "../lib/api";
import { WorkspaceArtwork } from "./work-art";
import { allowAccountDrafts, blockAccountDrafts, clearAccountDrafts } from "../lib/local-drafts";

const SessionContext = createContext<{
  user: PublicUser | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  setUser: (user: PublicUser | null) => void;
  signOut: () => Promise<void>;
} | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const pendingCheck = useRef<AbortController | null>(null);
  const cancelCheck = useCallback(() => {
    const controller = pendingCheck.current;
    pendingCheck.current = null;
    controller?.abort();
  }, []);
  const refresh = useCallback(async () => {
    cancelCheck();
    const controller = new AbortController();
    pendingCheck.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 10_000);
    setLoading(true); setError("");
    try {
      const account = await api<PublicUser>("/auth/me", { signal: controller.signal });
      if (pendingCheck.current !== controller) return;
      if (!account || typeof account.id !== "string") throw new Error("The server returned an invalid account response");
      allowAccountDrafts(account.id);
      setUser(account);
    }
    catch (error) {
      if (pendingCheck.current !== controller) return;
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) setUser(null);
      else if (controller.signal.aborted) setError("Your account check timed out. Check your connection and try again.");
      else setError(`Could not check your account. ${errorMessage(error)}`);
    } finally {
      window.clearTimeout(timer);
      if (pendingCheck.current === controller) { pendingCheck.current = null; setLoading(false); }
    }
  }, [cancelCheck]);
  useEffect(() => { void refresh(); return cancelCheck; }, [refresh, cancelCheck]);
  const setAccount = (account: PublicUser | null) => {
    // Login/logout is newer than a check started before that action. Do not let
    // its delayed response overwrite the account or keep navigation loading.
    if (account) allowAccountDrafts(account.id);
    cancelCheck(); setError(""); setUser(account); setLoading(false);
  };
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel("flux-account-lifecycle");
    channel.onmessage = event => {
      if (user && event.data?.type === "signed-out" && event.data.userId === user.id) {
        blockAccountDrafts(user.id); cancelCheck(); setUser(null); setError(""); setLoading(false);
        void clearAccountDrafts(user.id).catch(() => {});
      }
    };
    return () => channel.close();
  }, [user, cancelCheck]);
  const signOut = async () => {
    const accountId = user?.id;
    await api("/auth/logout", { method: "POST" });
    if (accountId) {
      blockAccountDrafts(accountId);
      if (typeof BroadcastChannel !== "undefined") {
        const channel = new BroadcastChannel("flux-account-lifecycle");
        channel.postMessage({ type: "signed-out", userId: accountId }); channel.close();
      }
    }
    setAccount(null);
    if (accountId) await clearAccountDrafts(accountId).catch(() => {});
  };
  return <SessionContext.Provider value={{ user, loading, error, refresh, setUser: setAccount, signOut }}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("SessionProvider is required");
  return value;
}

export function Protected({ children }: { children: ReactNode }) {
  const { user, loading, error, refresh } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (!loading && !user && !error) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [loading, user, error, router, pathname]);
  if (error) return <main className="session-unavailable"><WorkspaceArtwork /><p role="alert">{error}</p><button className="button primary" onClick={() => void refresh()}>Try again</button><a className="text-button" href={pathname}>Reload page</a></main>;
  if (loading || !user) return <div className="loading-screen"><WorkspaceArtwork /><p role="status">Opening your workspace…</p><p className="loading-recovery">If this screen stays here, <a className="text-button" href={pathname}>Reload page</a> to load the latest app.</p><noscript><p>JavaScript is disabled. Enable it for this site to open Flux.</p></noscript></div>;
  return children;
}
