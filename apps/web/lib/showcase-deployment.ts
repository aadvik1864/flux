export function isShowcaseDeployment() {
  return process.env.VERCEL === "1" || process.env.FLUX_SHOWCASE_ONLY === "true";
}
