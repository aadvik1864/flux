export function isShowcaseDeployment() {
  return process.env.FLUX_SHOWCASE_ONLY === "true" || (process.env.VERCEL === "1" && process.env.FLUX_DEPLOYMENT_MODE !== "live");
}
