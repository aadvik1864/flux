"use client";

import { useEffect, useRef, type HTMLAttributes, type MouseEvent, type PointerEvent } from "react";

// Lightweight adaptations of React Bits SpotlightCard and ClickSpark, used as
// part of Flux (not redistributed as a component library). Source and license:
// docs/ui-sources.md and docs/licenses/react-bits.md.
export function SpotlightCard({ className = "", children, ...props }: HTMLAttributes<HTMLDivElement>) {
  function move(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--spotlight-x", `${event.clientX - rect.left}px`);
    event.currentTarget.style.setProperty("--spotlight-y", `${event.clientY - rect.top}px`);
  }
  return <div {...props} className={`spotlight-panel ${className}`} onPointerMove={move}>{children}<span className="spotlight-light" aria-hidden="true" /></div>;
}

type Spark = { x: number; y: number; angle: number; startTime: number };

export function ClickSpark({ className = "", children }: Pick<HTMLAttributes<HTMLDivElement>, "className" | "children">) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sparks = useRef<Spark[]>([]);
  const frame = useRef(0);
  const wake = useRef<() => void>(() => {});
  const reduced = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !parent || !ctx) return;
    let width = 0;
    let height = 0;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const stop = () => { cancelAnimationFrame(frame.current); frame.current = 0; sparks.current = []; ctx.clearRect(0, 0, width, height); };
    const updateMotion = () => { reduced.current = media.matches; if (media.matches) stop(); };
    updateMotion();
    media.addEventListener("change", updateMotion);
    const resize = () => {
      const rect = parent.getBoundingClientRect();
      width = rect.width; height = rect.height;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(parent); resize();
    const draw = (now: number) => {
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = getComputedStyle(parent).getPropertyValue("--accent").trim();
      ctx.lineWidth = 1.5;
      sparks.current = sparks.current.filter(spark => {
        const progress = (now - spark.startTime) / 380;
        if (progress >= 1) return false;
        const eased = progress * (2 - progress);
        const distance = eased * 20;
        const length = 7 * (1 - eased);
        ctx.globalAlpha = 1 - progress;
        ctx.beginPath();
        ctx.moveTo(spark.x + distance * Math.cos(spark.angle), spark.y + distance * Math.sin(spark.angle));
        ctx.lineTo(spark.x + (distance + length) * Math.cos(spark.angle), spark.y + (distance + length) * Math.sin(spark.angle));
        ctx.stroke();
        return true;
      });
      ctx.globalAlpha = 1;
      // Unlike the upstream demo, do not run an animation loop while idle.
      frame.current = sparks.current.length ? requestAnimationFrame(draw) : 0;
    };
    wake.current = () => { if (!frame.current) frame.current = requestAnimationFrame(draw); };
    return () => { stop(); observer.disconnect(); media.removeEventListener("change", updateMotion); wake.current = () => {}; };
  }, []);

  function click(event: MouseEvent<HTMLDivElement>) {
    if (reduced.current || event.detail === 0 || !(event.target as Element).closest("button, a")) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const now = performance.now();
    sparks.current = [...sparks.current.slice(-48), ...Array.from({ length: 8 }, (_, index) => ({
      x: event.clientX - rect.left, y: event.clientY - rect.top, angle: 2 * Math.PI * index / 8, startTime: now,
    }))];
    wake.current();
  }
  return <div className={`click-spark ${className}`} onClick={click}><canvas ref={canvasRef} aria-hidden="true" />{children}</div>;
}
