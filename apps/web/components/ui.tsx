"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import type { PublicUser } from "@flux/shared";

export function FluxMark() {
  return <span className="wordmark"><svg width="26" height="28" viewBox="0 0 26 28" fill="none" aria-hidden="true"><path d="M5 22V7a3 3 0 0 1 3-3h13M5 13h12M14 22V13" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" /></svg>flux<span className="wordmark-dot" /></span>;
}

export function Avatar({ user, size = "normal" }: { user: Pick<PublicUser, "name" | "color">; size?: "normal" | "small" }) {
  return <span className={`avatar ${size}`} style={{ backgroundColor: user.color }} title={user.name}>{user.name.slice(0, 1).toUpperCase()}</span>;
}

export function ErrorNotice({ message }: { message: string }) {
  return message ? <div className="error-notice" role="alert">{message}</div> : null;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    // React autoFocus can run before a native dialog is opened. Focus fields
    // after showModal so quick open and creation forms are ready to type into.
    dialog?.querySelector<HTMLElement>("input:not([disabled]), textarea:not([disabled]), select:not([disabled])")?.focus();
    return () => dialog?.close();
  }, []);
  return <dialog ref={ref} className="modal" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="modal-heading"><h2 id={titleId}>{title}</h2><button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={20} /></button></div>
    {children}
  </dialog>;
}
