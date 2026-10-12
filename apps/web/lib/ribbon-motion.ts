// Wall-clock settling keeps the optional scene bounded even on software GPUs.
export function ribbonMotionBlend(elapsed: number, delta: number): number {
  return elapsed >= 1200 ? 1 : 1 - Math.exp(-Math.max(0, delta) / 140);
}
