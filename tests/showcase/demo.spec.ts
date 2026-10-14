import { test, expect } from "@playwright/test";

test("standalone deployments expose only read-only demo routes", async ({ request, baseURL }) => {
  test.skip(process.env.FLUX_SHOWCASE_BOUNDARY_TEST !== "true", "Full-app previews intentionally retain account routes");
  const root = await request.get("/", { maxRedirects: 0 });
  expect(root.status()).toBe(308);
  expect(new URL(root.headers().location, baseURL).pathname).toBe("/demo");
  const demo = await request.get("/demo", { headers: { cookie: "flux_session=sample" } });
  expect(demo.status()).toBe(200);
  expect(demo.headers()["content-security-policy"]).toContain("strict-dynamic");
  expect(demo.headers()["set-cookie"]).toBeUndefined();
  const script = (await demo.text()).match(/src="(\/_next\/static\/[^"]+)"/)?.[1];
  expect(script).toBeDefined();
  expect((await request.get(script!)).status()).toBe(200);
  expect((await request.head("/demo")).status()).toBe(200);
  for (const path of ["/login", "/account/help", "/files/example", "/api/auth/me", "/sync", "/internal/rooms", "/invite/example", "/demoevil"]) {
    expect((await request.get(path)).status(), path).toBe(404);
  }
  const imagePaths = ["/_next/image?url=https://example.com/image.png&w=640&q=75", "/_next/image?url=%2Fart%2Fflux-ribbons.webp&w=640&q=75"];
  for (const path of imagePaths) {
    const response = await request.get(path);
    // Vercel handles its native optimizer before application routing. Empty
    // image allowlists must reject even valid, previously cached local assets.
    const native = response.headers()["x-vercel-error"] === "INVALID_IMAGE_OPTIMIZE_REQUEST";
    expect(response.status(), path).toBe(native ? 400 : 404);
  }
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    for (const path of ["/demo", "/api/auth/register", script!, "/art/flux-ribbons.webp", "/icon.svg"]) {
      const response = await request.fetch(path, { method });
      expect(response.status(), `${method} ${path}`).toBe(405);
      expect(response.headers().allow).toBe("GET, HEAD");
    }
    const image = await request.fetch(imagePaths[1], { method });
    const nativeOptions = method === "OPTIONS" && image.headers()["x-vercel-error"] === "INVALID_IMAGE_OPTIMIZE_REQUEST";
    expect(image.status()).toBe(nativeOptions ? 400 : 405);
    if (!nativeOptions) {
      if (image.headers().allow) expect(image.headers().allow).toBe("GET, HEAD");
      else expect(image.headers()["x-vercel-error"]).toBe("INVALID_REQUEST_METHOD");
    }
  }
});

test("visitors can explore the workflow without accounts or document writes", async ({ page }, testInfo) => {
  const errors: string[] = [];
  const backendRequests: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("request", request => {
    if (/\/(api|sync)(\/|$)/.test(new URL(request.url()).pathname)) backendRequests.push(request.url());
  });
  page.on("websocket", socket => { if (new URL(socket.url()).pathname.startsWith("/sync")) backendRequests.push(socket.url()); });
  await page.route("**/api/**", route => route.abort());
  const response = await page.goto("/demo");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "See how a draft becomes a decision." })).toBeVisible();
  const paper = page.getByRole("article", { name: "Sample document" });
  await expect(paper).toContainText("at 9 am");
  await expect(paper).toContainText("step-free route");
  await page.getByRole("button", { name: "Experiment", exact: true }).click();
  await expect(paper).toContainText("at 9:30 am");
  await expect(paper).not.toContainText("step-free route");
  await page.getByRole("button", { name: "See the reviewed result" }).click();
  await expect(paper).toContainText("at 9:30 am");
  await expect(paper).toContainText("step-free route");
  await expect(page.getByText("Sample review by Hana, not the experiment’s author.")).toBeVisible();
  await page.getByRole("button", { name: "Discussion & decision", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Open at 9:30 am", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Read the linked paragraph" }).click();
  await expect(page.locator("#demo-opening")).toBeVisible();
  await page.getByRole("button", { name: "Read the first checkpoint" }).click();
  await expect(paper).toContainText("at 9 am");
  await page.getByRole("button", { name: "After the reviewed merge", exact: true }).click();
  await expect(paper).toContainText("at 9:30 am");
  await expect(paper).toContainText("step-free route");
  await expect(page.locator('[contenteditable="true"], input, textarea, form')).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^(approve|restore|finalize|save checkpoint)/i })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("showcase-desktop.png"), fullPage: true });
  await page.reload();
  await expect(page.getByRole("button", { name: "Shared document", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(backendRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test("the demo supports keyboard navigation, themes, reduced motion, and narrow screens", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await page.goto("/demo");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to sample document" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "Sample workflow" })).toBeFocused();
  const toggle = page.getByRole("switch", { name: "Night mode" });
  await expect(toggle).toBeEnabled();
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).toBeChecked();
  await page.reload();
  await expect(toggle).toBeChecked();
  await page.getByRole("button", { name: "Experiment", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("article", { name: "Sample document" })).toContainText("at 9:30 am");
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(toggle).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("showcase-mobile-night.png"), fullPage: true });
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await page.screenshot({ path: testInfo.outputPath("showcase-mobile-day.png"), fullPage: true });
});

test("the sample document is readable without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, ignoreHTTPSErrors: process.env.FLUX_SHOWCASE_FIXTURE_TLS === "true" });
  const page = await context.newPage();
  await page.goto(`${process.env.FLUX_SHOWCASE_URL ?? "http://127.0.0.1:3000"}/demo`);
  const paper = page.getByRole("article", { name: "Sample document" });
  await expect(paper).toBeVisible();
  await expect(paper).toContainText("step-free route");
  const hint = page.locator(".demo-noscript");
  await expect(hint).toBeVisible();
  expect(await hint.textContent()).toContain("JavaScript is needed to switch views.");
  await expect(page.getByRole("button", { name: "Experiment", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Read the decision", exact: true })).toBeDisabled();
  await context.close();
});
