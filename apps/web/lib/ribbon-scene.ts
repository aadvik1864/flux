import * as THREE from "three";
import { ribbonMotionBlend } from "./ribbon-motion";

export type RibbonScene = { rotate: () => void; setMode: (mode: "draft" | "checkpoint") => void; setVisible: (visible: boolean) => void; dispose: () => void };

// Original parametric sculpture, not a remote scene or stock illustration.
function ribbonGeometry(rx: number, ry: number, width: number, phase: number): THREE.BufferGeometry {
  const segments = 240;
  const sides = 16;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const orchid = new THREE.Color("#d174d2");
  const coral = new THREE.Color("#e0563f");
  const slate = new THREE.Color("#3f567f");
  const center = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const radial = new THREE.Vector3();
  const binormal = new THREE.Vector3();
  const wide = new THREE.Vector3();
  const normal = new THREE.Vector3();

  for (let i = 0; i <= segments; i++) {
    const u = i / segments * Math.PI * 2;
    center.set(rx * Math.cos(u) + .12 * Math.sin(2 * u), ry * Math.sin(u), .3 * Math.sin(2 * u));
    tangent.set(-rx * Math.sin(u) + .24 * Math.cos(2 * u), ry * Math.cos(u), .6 * Math.cos(2 * u)).normalize();
    radial.set(Math.cos(u), Math.sin(u), 0);
    radial.addScaledVector(tangent, -radial.dot(tangent)).normalize();
    binormal.crossVectors(tangent, radial).normalize();
    const twist = u + phase;
    wide.copy(radial).multiplyScalar(Math.cos(twist)).addScaledVector(binormal, Math.sin(twist));
    normal.crossVectors(tangent, wide).normalize();
    const tint = orchid.clone().lerp(coral, (Math.sin(u + phase) + 1) / 2);
    tint.lerp(slate, Math.pow((Math.cos(u - .7) + 1) / 2, 3) * .85);
    for (let j = 0; j <= sides; j++) {
      const v = j / sides * Math.PI * 2;
      const point = center.clone().addScaledVector(wide, Math.cos(v) * width).addScaledVector(normal, Math.sin(v) * .047);
      positions.push(point.x, point.y, point.z);
      colors.push(tint.r, tint.g, tint.b);
      if (i < segments && j < sides) {
        const a = i * (sides + 1) + j;
        const b = a + sides + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function createRibbonScene(canvas: HTMLCanvasElement, host: HTMLElement, onLost: () => void): RibbonScene {
  const context = canvas.getContext("webgl2", { alpha: true, antialias: true, powerPreference: "low-power" });
  if (!context) throw new Error("WebGL unavailable");
  const renderer = new THREE.WebGLRenderer({ canvas, context, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(33, 1, .1, 30);
  camera.position.set(0, 0, 8.4);
  const sculpture = new THREE.Group();
  scene.add(sculpture);
  const material = new THREE.MeshPhysicalMaterial({ vertexColors: true, metalness: .28, roughness: .29, clearcoat: .75, clearcoatRoughness: .22, side: THREE.DoubleSide });
  const outer = new THREE.Mesh(ribbonGeometry(1.25, 1.75, .34, .1), material);
  outer.rotation.set(.25, -.45, -.3);
  const inner = new THREE.Mesh(ribbonGeometry(.9, 1.4, .29, 2.9), material);
  inner.rotation.set(-.45, .7, .45);
  inner.position.set(.25, -.3, .3);
  sculpture.add(outer, inner);
  sculpture.rotation.set(-.14, .2, -.24);
  scene.add(new THREE.HemisphereLight(0xfff5f9, 0x493451, 2.4));
  const key = new THREE.DirectionalLight(0xffe2d3, 5.4); key.position.set(-3, 4, 5); scene.add(key);
  const rim = new THREE.DirectionalLight(0xe8b8ff, 4); rim.position.set(4, 1, -2); scene.add(rim);
  const fill = new THREE.DirectionalLight(0xbad8ff, 2); fill.position.set(-2, -3, 3); scene.add(fill);

  let disposed = false;
  let visible = true;
  let frame = 0;
  let angle = .2;
  let arrangement = 0;
  let targetArrangement = 0;
  const target = { x: -.14, y: angle };
  let started = performance.now();
  let previous = started;
  const render = (now: number) => {
    frame = 0;
    if (disposed || !visible || document.hidden) return;
    const blend = ribbonMotionBlend(now - started, now - previous);
    previous = now;
    sculpture.rotation.x += (target.x - sculpture.rotation.x) * blend;
    sculpture.rotation.y += (target.y - sculpture.rotation.y) * blend;
    arrangement += (targetArrangement - arrangement) * blend;
    inner.rotation.z = .45 - arrangement * .75;
    inner.rotation.y = .7 - arrangement * .5;
    inner.position.x = .25 + arrangement * .25;
    outer.rotation.z = -.3 + arrangement * .3;
    renderer.render(scene, camera);
    if (Math.abs(target.x - sculpture.rotation.x) + Math.abs(target.y - sculpture.rotation.y) + Math.abs(targetArrangement - arrangement) > .0004) {
      frame = requestAnimationFrame(render); canvas.dataset.motion = "active";
    } else canvas.dataset.motion = "idle";
  };
  const wake = () => {
    started = performance.now(); previous = started;
    if (!frame && !disposed && visible && !document.hidden) { canvas.dataset.motion = "active"; frame = requestAnimationFrame(render); }
  };
  const resize = () => {
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false); camera.aspect = width / height;
    camera.updateProjectionMatrix(); wake();
  };
  const observer = new ResizeObserver(resize); observer.observe(canvas);
  const move = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    const rect = host.getBoundingClientRect();
    target.x = -.14 + (event.clientY - rect.top - rect.height / 2) / rect.height * .22;
    target.y = angle + (event.clientX - rect.left - rect.width / 2) / rect.width * .48;
    wake();
  };
  const leave = () => { target.x = -.14; target.y = angle; wake(); };
  const visibility = () => { if (document.hidden) { cancelAnimationFrame(frame); frame = 0; canvas.dataset.motion = "paused"; } else wake(); };
  const lost = (event: Event) => { event.preventDefault(); onLost(); };
  host.addEventListener("pointermove", move);
  host.addEventListener("pointerleave", leave);
  document.addEventListener("visibilitychange", visibility);
  canvas.addEventListener("webglcontextlost", lost);
  resize(); renderer.render(scene, camera);

  return {
    rotate() { angle += Math.PI / 4; target.y = angle; wake(); },
    setMode(mode) { targetArrangement = mode === "checkpoint" ? 1 : 0; wake(); },
    setVisible(value) { visible = value; if (value) wake(); else { cancelAnimationFrame(frame); frame = 0; canvas.dataset.motion = "paused"; } },
    dispose() {
      if (disposed) return;
      disposed = true; cancelAnimationFrame(frame); observer.disconnect();
      host.removeEventListener("pointermove", move); host.removeEventListener("pointerleave", leave);
      document.removeEventListener("visibilitychange", visibility); canvas.removeEventListener("webglcontextlost", lost);
      outer.geometry.dispose(); inner.geometry.dispose(); material.dispose(); renderer.dispose(); canvas.dataset.motion = "disposed";
    },
  };
}
