"use client";

import { useEffect, useRef, useState } from "react";
import { Rotate3D } from "lucide-react";
import type { RibbonScene } from "../lib/ribbon-scene";

export function RibbonArt({ mode = "draft" }: { mode?: "draft" | "checkpoint" }) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<RibbonScene | null>(null);
  const modeRef = useRef(mode);
  const [interactive, setInteractive] = useState(false);

  useEffect(() => { modeRef.current = mode; scene.current?.setMode(mode); }, [mode]);

  useEffect(() => {
    const element = host.current!;
    const target = canvas.current!;
    const media = window.matchMedia("(min-width: 900px) and (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)");
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    let active = true;
    let visible = false;
    let loading = false;
    let failed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const eligible = () => media.matches && !connection?.saveData && !["slow-2g", "2g"].includes(connection?.effectiveType ?? "");
    const reset = () => {
      clearTimeout(timer);
      scene.current?.dispose(); scene.current = null;
      if (active) setInteractive(false);
    };
    async function load() {
      if (!active || !visible || !eligible() || scene.current || loading || failed) return;
      loading = true;
      try {
        const { createRibbonScene } = await import("../lib/ribbon-scene");
        if (!active || !visible || !eligible()) return;
        scene.current = createRibbonScene(target, element, () => { failed = true; reset(); });
        scene.current.setMode(modeRef.current);
        setInteractive(true);
      } catch {
        // Artwork is optional. Keep the server-rendered poster if WebGL or its
        // chunk is unavailable; never delay or obscure the account form.
        failed = true;
      } finally { loading = false; }
    }
    function update() {
      clearTimeout(timer);
      if (!eligible()) { reset(); return; }
      scene.current?.setVisible(visible);
      if (visible) timer = setTimeout(() => void load(), 180);
    }
    const observer = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? false; update(); });
    observer.observe(element);
    media.addEventListener("change", update);
    return () => { active = false; reset(); observer.disconnect(); media.removeEventListener("change", update); };
  }, []);

  return <div ref={host} className="ribbon-art" data-renderer={interactive ? "webgl" : "poster"} data-art-mode={mode}>
    <div className="ribbon-visual" aria-hidden="true">
      {/* A local render of the same sculpture is visible before the first 3D frame. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/art/flux-ribbons.webp" className="ribbon-poster" alt="" width="700" height="820" fetchPriority="high" />
      <canvas ref={canvas} />
    </div>
    {interactive && <button type="button" className="ribbon-rotate" aria-label="Rotate ribbon sculpture" onClick={() => scene.current?.rotate()}><Rotate3D size={17} /><span>Change perspective</span></button>}
  </div>;
}
