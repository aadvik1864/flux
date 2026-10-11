"use client";

import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { PublicUser } from "@flux/shared";
import { api, ApiError, errorMessage } from "../lib/api";

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
      setUser(account);
    }
    catch (error) {
      if (pendingCheck.current !== controller) return;
      if (error instanceof ApiError && error.status === 401) setUser(null);
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
    cancelCheck(); setError(""); setUser(account); setLoading(false);
  };
  const signOut = async () => { await api("/auth/logout", { method: "POST" }); setAccount(null); };
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
  if (error) return <main className="session-unavailable"><p role="alert">{error}</p><button className="button primary" onClick={() => void refresh()}>Try again</button><a className="text-button" href={pathname}>Reload page</a></main>;
  if (loading || !user) return <div className="loading-screen"><p role="status">Opening your workspace…</p><p className="loading-recovery">If this screen stays here, <a className="text-button" href={pathname}>Reload page</a> to load the latest app.</p><noscript><p>JavaScript is disabled. Enable it for this site to open Flux.</p></noscript></div>;
  return children;
}
