import { defineConfig, devices } from "@playwright/test";

const remote = process.env.FLUX_SHOWCASE_URL;

export default defineConfig({
  testDir: "./tests/showcase",
  outputDir: process.env.FLUX_SHOWCASE_ARTIFACTS ?? "test-results/showcase",
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: { baseURL: remote ?? "http://127.0.0.1:3000", trace: "retain-on-failure", screenshot: "only-on-failure", ignoreHTTPSErrors: process.env.FLUX_SHOWCASE_FIXTURE_TLS === "true" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  ],
  webServer: remote ? undefined : {
    command: "npm run dev -w @flux/web",
    url: "http://127.0.0.1:3000/demo",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
