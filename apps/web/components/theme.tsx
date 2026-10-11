"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ThemeProvider, useTheme } from "next-themes";
import { flushSync } from "react-dom";
import { Moon, Sun } from "lucide-react";

export function ColorThemeProvider({ children, nonce }: { children: ReactNode; nonce?: string }) {
  return <ThemeProvider nonce={nonce} attribute="data-theme" storageKey="flux-theme" defaultTheme="system" enableSystem disableTransitionOnChange>{children}</ThemeProvider>;
}

// Circular reveal adapted from Magic UI's AnimatedThemeToggler. See
// docs/ui-sources.md and docs/licenses/magic-ui.md for source and license.
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const transitionRef = useRef<ViewTransition | null>(null);
  const animationRef = useRef<Animation | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    setMounted(true);
    return () => {
      if (transitionRef.current) {
        transitionRef.current.skipTransition();
        transitionRef.current = null;
        animationRef.current?.cancel();
        delete document.documentElement.dataset.themeReveal;
        document.documentElement.style.removeProperty("--theme-reveal-origin");
      }
    };
  }, []);

  function toggle() {
    if (!mounted || busy.current) return;
    const next = resolvedTheme === "dark" ? "light" : "dark";
    const root = document.documentElement;
    const apply = () => {
      // Synchronize the snapshot with next-themes' persisted state.
      root.dataset.theme = next;
      root.style.colorScheme = next;
      setTheme(next);
    };
    if (!document.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches || root.dataset.themeReveal) {
      apply(); return;
    }
    const rect = button.current!.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const radius = Math.hypot(Math.max(x, width - x), Math.max(y, height - y));
    const point = `${x / width * 100}% ${y / height * 100}%`;
    const end = radius / (Math.hypot(width, height) / Math.SQRT2) * 100;
    root.dataset.themeReveal = "active";
    root.style.setProperty("--theme-reveal-origin", `circle(0% at ${point})`);
    busy.current = true;
    let transition: ViewTransition;
    try { transition = document.startViewTransition(() => flushSync(apply)); }
    catch {
      busy.current = false;
      delete root.dataset.themeReveal;
      root.style.removeProperty("--theme-reveal-origin");
      apply(); return;
    }
    transitionRef.current = transition;
    void transition.ready.then(() => {
      if (transitionRef.current !== transition) return;
      animationRef.current = root.animate({ clipPath: [`circle(0% at ${point})`, `circle(${end}% at ${point})`] }, {
        duration: 360, easing: "ease-out", fill: "forwards", pseudoElement: "::view-transition-new(root)",
      });
    }).catch(() => {});
    void transition.finished.finally(() => {
      if (transitionRef.current !== transition) return;
      busy.current = false;
      delete root.dataset.themeReveal;
      root.style.removeProperty("--theme-reveal-origin");
      animationRef.current?.cancel();
      animationRef.current = null;
      transitionRef.current = null;
    }).catch(() => {});
  }

  return <button ref={button} type="button" className="theme-toggle" role="switch" aria-label="Night mode" aria-checked={mounted && resolvedTheme === "dark"} disabled={!mounted} onClick={toggle} title={!mounted ? "Day and night mode" : resolvedTheme === "dark" ? "Switch to day mode" : "Switch to night mode"}>
    <Sun size={15} className="theme-sun" /><span className="theme-toggle-track" aria-hidden="true"><span /></span><Moon size={15} className="theme-moon" />
    <span className="theme-label"><span className="day-label">Day</span><span className="night-label">Night</span></span>
  </button>;
}
