import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { config } from "dotenv";
import { test, expect, type BrowserContext } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { SnapshotStorage } from "@flux/storage";

config({ path: resolve(process.cwd(), ".env"), quiet: true });
const origin = "http://localhost:3000";
const db = new PrismaClient();
const storage = new SnapshotStorage();
const users: string[] = [];
const workspaces: string[] = [];

async function setup(context: BrowserContext) {
  const registered = await context.request.post("/api/auth/register", { headers: { origin }, data: {
    name: "Interface test owner", email: `interface-${randomUUID()}@flux.test`, password: "a secure interface test password",
  } });
  expect(registered.ok(), await registered.text()).toBe(true);
  users.push((await registered.json()).id);
  const created = await context.request.post("/api/workspaces", { headers: { origin }, data: {
    name: "Launch planning", description: "Shared proposals and the decisions behind them.",
  } });
  expect(created.ok(), await created.text()).toBe(true);
  const workspace = await created.json(); workspaces.push(workspace.id);
  const files: { id: string; name: string }[] = [];
  for (const name of ["Proposal 10", "Proposal 2", "Budget"]) {
    const response = await context.request.post(`/api/workspaces/${workspace.id}/files`, { headers: { origin }, data: { name } });
    expect(response.ok(), await response.text()).toBe(true);
    files.push(await response.json());
  }
  return { workspace, files };
}

test.afterAll(async () => {
  const objects = await db.checkpoint.findMany({ where: { file: { workspaceId: { in: workspaces } } }, select: { objectKey: true } });
  if (objects.length) await storage.client.send(new DeleteObjectsCommand({ Bucket: storage.bucket, Delete: { Objects: objects.map(object => ({ Key: object.objectKey })) } }));
  await db.workspace.deleteMany({ where: { id: { in: workspaces } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
  storage.client.destroy();
});

test("day/night mode follows the system, persists, synchronizes tabs, and keeps login interactive", async ({ page, context }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    // Signed-out /auth/me returns 401 by design; other console errors,
    // including React's recoverable hydration warnings, are regressions.
    if (message.type() === "error" && !message.text().includes("status of 401 (Unauthorized)")) errors.push(message.text());
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/login");
  const toggle = page.getByRole("switch", { name: "Night mode" });
  await expect(toggle).toBeEnabled();
  await expect(toggle).toBeChecked();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("body")).toHaveCSS("color", "rgb(237, 242, 248)");
  await page.getByRole("button", { name: "Checkpoint", exact: true }).click();
  await expect(page.getByRole("heading", { name: "First draft, kept safe" })).toBeVisible();
  await expect(page.locator(".ribbon-art")).toHaveAttribute("data-art-mode", "checkpoint");
  await page.getByLabel("Password", { exact: true }).fill("sample-password");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Hide password" }).click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "password");
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator(".auth-headline-line").last()).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
  await page.screenshot({ path: testInfo.outputPath("login-night.png"), fullPage: true });

  const second = await context.newPage();
  await second.emulateMedia({ colorScheme: "dark" });
  await second.goto("/login");
  await expect(second.getByRole("switch", { name: "Night mode" })).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme-reveal", "active");
  await expect(second.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await page.evaluate(() => localStorage.getItem("flux-theme"))).toBe("light");
  await page.reload();
  await expect(toggle).not.toBeChecked();
  await expect(page.locator("body")).toHaveCSS("color", "rgb(38, 52, 73)");
  await expect(page.locator(".auth-headline-line").last()).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
  await expect(page.locator(".ribbon-poster")).toHaveJSProperty("naturalWidth", 700);
  await page.screenshot({ path: testInfo.outputPath("login-day.png"), fullPage: true });
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(toggle).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("login-mobile.png"), fullPage: true });
  expect(errors).toEqual([]);
  await second.close();
});

test("theme changes support reduced motion, keyboard activation, and unsupported browsers", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto("/login");
  const toggle = page.getByRole("switch", { name: "Night mode" });
  await expect(toggle).toBeEnabled();
  await toggle.focus(); await page.keyboard.press("Space");
  await expect(toggle).toBeChecked();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme-reveal", "active");
  await expect(page.locator(".ribbon-art")).toHaveAttribute("data-renderer", "poster");
  await expect(page.getByRole("button", { name: "Rotate ribbon sculpture" })).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(() => Object.defineProperty(document, "startViewTransition", { value: undefined, configurable: true }));
  await toggle.press("Enter");
  await expect(toggle).not.toBeChecked();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await page.evaluate(() => localStorage.getItem("flux-theme"))).toBe("light");
});

test("compact workspace search, sorting, layouts, and quick open work on desktop and mobile", async ({ page, context }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  const { workspace, files } = await setup(context);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/workspaces/${workspace.id}`);
  await expect(page.getByRole("heading", { name: workspace.name, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Grid view", exact: true })).toHaveAttribute("aria-pressed", "true");
  const rows = page.locator(".file-list .file-row strong");
  await expect(rows).toHaveCount(3);
  await page.getByLabel("Sort documents").selectOption("name");
  await expect(rows).toHaveText(["Budget", "Proposal 2", "Proposal 10"]);
  await page.getByLabel("Find documents").fill(" PROPOSAL ");
  await expect(rows).toHaveText(["Proposal 2", "Proposal 10"]);
  await page.getByLabel("Find documents").fill("nothing matches");
  await expect(page.getByRole("heading", { name: "No matching documents" })).toBeVisible();
  await page.getByRole("button", { name: "Clear document search" }).click();
  await expect(page.getByLabel("Find documents")).toBeFocused();
  await expect(rows).toHaveCount(3);
  await page.getByRole("button", { name: "Grid view", exact: true }).click();
  await expect(page.locator(".file-list")).toHaveClass(/file-grid/);
  await expect(page.getByRole("button", { name: "Grid view" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "List view", exact: true }).click();
  await expect(page.locator(".file-list")).not.toHaveClass(/file-grid/);
  await page.getByRole("button", { name: "Collapse team" }).click();
  await expect(page.locator("#workspace-team")).toHaveCount(0);
  await page.getByRole("button", { name: "Expand team" }).click();
  await expect(page.locator("#workspace-team")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("workspace-day.png"), fullPage: true });
  await page.getByRole("switch", { name: "Night mode" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme-reveal", "active");
  await page.screenshot({ path: testInfo.outputPath("workspace-night.png"), fullPage: true });
  await page.locator(".workspace-tip").hover();
  await expect(page.locator(".workspace-tip .spotlight-light")).toHaveCSS("opacity", "1");

  await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog", { name: "Quick open" });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel("Quick-open search")).toBeFocused();
  await page.getByLabel("Quick-open search").fill("Proposal 2");
  await expect(dialog.getByRole("link")).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("quick-open.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "New document", exact: true }).click();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(page.getByRole("dialog", { name: "New document" })).toBeVisible();
  await page.keyboard.press("Escape");

  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByLabel("Find documents")).toBeVisible();
  }
  await page.screenshot({ path: testInfo.outputPath("workspace-mobile.png"), fullPage: true });
  await expect(page.getByRole("navigation", { name: "Workspaces", exact: true })).not.toBeVisible();
  await page.getByRole("button", { name: "Workspace navigation", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Workspaces", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Workspace navigation", exact: true })).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("button", { name: "Workspace navigation", exact: true })).toBeFocused();
  await expect(page.getByRole("navigation", { name: "Workspaces", exact: true })).not.toBeVisible();
  await page.getByRole("button", { name: /Quick open/ }).click();
  await page.getByLabel("Quick-open search").fill("Proposal 2");
  await page.getByLabel("Quick-open search").press("Enter");
  await expect(page).toHaveURL(`/files/${files[1].id}`);
  await expect(page.getByRole("textbox", { name: "Document content" })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Night mode" })).toBeChecked();
  expect(errors).toEqual([]);
});

test("word counts and wide-page controls leave live document content intact", async ({ page, context }, testInfo) => {
  const { files } = await setup(context);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/files/${files[0].id}`);
  const content = page.getByRole("textbox", { name: "Document content" });
  await expect(content).toBeVisible();
  await expect(page.locator(".document-meter")).toContainText("0 words");
  await content.fill("One");
  await expect(page.locator(".document-meter")).toContainText("1 word");
  await content.press("End"); await content.press("Enter");
  await page.keyboard.insertText("Two three");
  await expect(page.locator(".document-meter")).toContainText("3 words");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  const before = await content.innerHTML();
  const head = await (await page.request.get(`/api/files/${files[0].id}/history-head`)).json();
  const readingWidth = await page.locator(".document-paper").evaluate(element => element.getBoundingClientRect().width);
  await page.getByRole("button", { name: "Wide page", exact: true }).click();
  await expect(page.getByRole("button", { name: "Wide page" })).toHaveAttribute("aria-pressed", "true");
  expect(await page.locator(".document-paper").evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(readingWidth);
  await page.getByRole("switch", { name: "Night mode" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme-reveal", "active");
  expect(await content.innerHTML()).toBe(before);
  expect(await (await page.request.get(`/api/files/${files[0].id}/history-head`)).json()).toEqual(head);
  await page.screenshot({ path: testInfo.outputPath("editor-wide-night.png"), fullPage: true });
  await page.getByRole("button", { name: "Wide page" }).click();
  await page.reload();
  await expect(content).toContainText("Two three");
  await expect(page.locator(".document-meter")).toContainText("3 words");
  await expect(page.getByRole("switch", { name: "Night mode" })).toBeChecked();
});

test("the entry composition stays usable without WebGL and at narrow tablet widths", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      if (type === "webgl2" || type === "webgl") return null;
      return original.call(this, type as "2d", ...args);
    } as typeof original;
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
  await expect(page.locator(".ribbon-poster")).toBeVisible();
  await expect(page.locator(".ribbon-poster")).toHaveJSProperty("naturalWidth", 700);
  await expect(page.locator(".ribbon-art")).toHaveAttribute("data-renderer", "poster");
  await page.getByLabel("Email address").fill("poster-test@flux.test");
  await expect(page.getByLabel("Email address")).toHaveValue("poster-test@flux.test");
  await page.screenshot({ path: testInfo.outputPath("entry-poster.png"), fullPage: true });
  for (const width of [900, 768, 701, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.getByRole("heading", { name: /Shared work/ })).toBeVisible();
  }
});

test("the optional sculpture responds to keyboard input, stops when idle, and falls back on context loss", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/login");
  const available = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2");
    if (context) context.getExtension("WEBGL_lose_context")?.loseContext();
    return Boolean(context);
  });
  test.skip(!available, "This browser has no WebGL2; poster coverage still runs.");
  const art = page.locator(".ribbon-art");
  const canvas = art.locator("canvas");
  await expect(art).toHaveAttribute("data-renderer", "webgl");
  await expect(canvas).toHaveAttribute("data-motion", "idle");
  const draft = await canvas.screenshot();
  await page.getByRole("button", { name: "Checkpoint", exact: true }).click();
  await expect(art).toHaveAttribute("data-art-mode", "checkpoint");
  await expect(canvas).toHaveAttribute("data-motion", "idle");
  expect((await canvas.screenshot()).equals(draft)).toBe(false);
  await page.getByRole("button", { name: "Live draft", exact: true }).click();
  await expect(art).toHaveAttribute("data-art-mode", "draft");
  await expect(canvas).toHaveAttribute("data-motion", "idle");
  const before = await canvas.screenshot();
  await page.getByRole("button", { name: "Rotate ribbon sculpture" }).focus();
  await page.keyboard.press("Space");
  await expect(canvas).toHaveAttribute("data-motion", "active");
  await expect(canvas).toHaveAttribute("data-motion", "idle");
  expect((await canvas.screenshot()).equals(before)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("entry-interactive.png"), fullPage: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(art).toHaveAttribute("data-renderer", "poster");
  await expect(art.locator(".ribbon-poster")).toBeVisible();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(art).toHaveAttribute("data-renderer", "webgl");
  await canvas.evaluate(element => element.dispatchEvent(new Event("webglcontextlost", { cancelable: true })));
  await expect(art).toHaveAttribute("data-renderer", "poster");
  await expect(art.locator(".ribbon-poster")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
});

test("workspace colors and hover/focus artwork change without opening or modifying documents", async ({ page, context }, testInfo) => {
  const { workspace, files } = await setup(context);
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/workspaces/${workspace.id}`);
  const row = page.locator(`.file-row[href="/files/${files[0].id}"]`);
  await expect(row).toBeVisible();
  await expect(page.locator(".sidebar")).toHaveCSS("background-color", "rgb(63, 86, 127)");
  await expect(page.locator(".sidebar-profile strong")).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(page.getByRole("button", { name: "New document", exact: true })).toHaveCSS("background-color", "rgb(181, 59, 43)");
  await expect(page.locator(".workspace-tip")).toHaveCSS("background-color", "rgb(255, 240, 232)");
  const tone = await row.getAttribute("data-tone");
  const head = await (await context.request.get(`/api/files/${files[0].id}/history-head`)).json();
  const name = await row.locator("strong").textContent();
  await expect(row.locator(".document-art-cursor")).toHaveCSS("opacity", "0");
  const baseline = await row.locator(".document-art-page").evaluate(element => getComputedStyle(element).transform);
  await row.hover();
  await expect(row.locator(".document-art-cursor")).toHaveCSS("opacity", "1");
  expect(await row.locator(".document-art-page").evaluate(element => getComputedStyle(element).transform)).not.toBe(baseline);
  await page.getByRole("heading", { name: workspace.name, exact: true }).hover();
  await expect(row.locator(".document-art-cursor")).toHaveCSS("opacity", "0");
  await row.focus();
  await expect(row.locator(".document-art-cursor")).toHaveCSS("opacity", "1");
  await page.getByLabel("Sort documents").selectOption("name");
  await expect(row).toHaveAttribute("data-tone", tone!);
  await page.getByRole("button", { name: "Grid view", exact: true }).click();
  await row.hover();
  await expect(row.locator(".document-art-cursor")).toHaveCSS("opacity", "1");
  await page.screenshot({ path: testInfo.outputPath("workspace-color-grid-hover.png"), fullPage: true });
  const tip = page.locator(".workspace-tip");
  await tip.hover();
  await expect(tip.locator(".checkpoint-seal")).toHaveCSS("opacity", "1");
  await page.getByRole("heading", { name: workspace.name, exact: true }).hover();
  await expect(tip.locator(".checkpoint-seal")).toHaveCSS("opacity", "0");
  await tip.getByRole("link").focus();
  await expect(tip.locator(".checkpoint-seal")).toHaveCSS("opacity", "1");
  await page.screenshot({ path: testInfo.outputPath("workspace-checkpoint-focus.png"), fullPage: true });
  await expect(page).toHaveURL(`/workspaces/${workspace.id}`);
  await expect(row.locator("strong")).toHaveText(name!);
  expect(await (await context.request.get(`/api/files/${files[0].id}/history-head`)).json()).toEqual(head);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await row.focus();
  await row.hover();
  await expect(row.locator(".document-art-cursor")).toHaveCSS("opacity", "0");
  await expect(row.locator(".document-art-page")).toHaveCSS("transform", baseline);
  await tip.hover();
  await expect(tip.locator(".checkpoint-seal")).toHaveCSS("opacity", "0");
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(row.locator("strong")).toBeVisible();
  }
});

test("onboarding uses one reactive illustration and keeps workspace creation accessible on mobile", async ({ page, context }, testInfo) => {
  const registered = await context.request.post("/api/auth/register", { headers: { origin }, data: {
    name: "Onboarding test", email: `onboarding-${randomUUID()}@flux.test`, password: "a secure onboarding password",
  } });
  expect(registered.ok(), await registered.text()).toBe(true);
  users.push((await registered.json()).id);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your ideas need a place to land." })).toBeVisible();
  const illustration = page.locator(".onboarding-preview .checkpoint-seal");
  await expect(illustration).toHaveCSS("opacity", "0");
  await page.getByRole("button", { name: "Set up your workspace" }).focus();
  await expect(illustration).toHaveCSS("opacity", "1");
  await page.screenshot({ path: testInfo.outputPath("onboarding-color.png"), fullPage: true });
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Create a workspace" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole("button", { name: "Create workspace", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("onboarding-color-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Create a workspace" })).toBeVisible();
});

test("touch sessions keep graphic affordances static while document links still open", async ({ browser, browserName }) => {
  test.skip(browserName === "firefox", "Playwright Firefox cannot emulate mobile/touch contexts");
  const context = await browser.newContext({ baseURL: origin, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const { workspace, files } = await setup(context);
    const page = await context.newPage();
    await page.goto(`/workspaces/${workspace.id}`);
    const row = page.locator(`.file-row[href="/files/${files[0].id}"]`);
    await expect(row).toBeVisible();
    await expect(row.locator(".document-art-cursor")).toHaveCSS("opacity", "0");
    await expect(page.locator(".workspace-tip .checkpoint-seal")).toHaveCSS("opacity", "0");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await row.tap();
    await expect(page).toHaveURL(`/files/${files[0].id}`);
    await expect(page.getByRole("textbox", { name: "Document content" })).toBeVisible();
  } finally { await context.close(); }
});

test("illustrations are visible in the main workspace, navigation, search, and creation dialogs", async ({ page, context }, testInfo) => {
  const { workspace } = await setup(context);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/workspaces/${workspace.id}`);
  await expect(page.locator(".file-list")).toHaveClass(/file-grid/);
  await expect(page.locator(".sidebar-roadmap .workspace-artwork")).toBeVisible();
  const heading = page.locator(".workspace-heading");
  const folderPage = heading.locator(".workspace-art-page-left");
  await expect(folderPage).toBeVisible();
  const resting = await folderPage.evaluate(element => getComputedStyle(element).transform);
  await heading.hover();
  await expect.poll(() => folderPage.evaluate(element => getComputedStyle(element).transform)).not.toBe(resting);
  await page.screenshot({ path: testInfo.outputPath("illustrated-workspace-default.png"), fullPage: true });
  await page.getByRole("button", { name: "New document", exact: true }).focus();
  await page.keyboard.press("Enter");
  const documentDialog = page.getByRole("dialog", { name: "New document" });
  await expect(documentDialog.locator(".modal-artwork .document-artwork")).toBeVisible();
  await expect(page.getByLabel("Document name", { exact: true })).toBeFocused();
  await expect(documentDialog.locator(".document-art-cursor")).toHaveCSS("opacity", "1");
  await page.screenshot({ path: testInfo.outputPath("illustrated-new-document.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Invite teammate", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Invite a teammate" }).locator(".people-artwork")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("illustrated-invite-dialog.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Create a workspace" }).locator(".workspace-artwork")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+k");
  const quick = page.getByRole("dialog", { name: "Quick open" });
  await expect(quick.locator(".search-artwork")).toBeVisible();
  expect(await quick.locator(".command-results .document-artwork").first().evaluate(element => element.getBoundingClientRect().width)).toBe(35);
  await page.keyboard.press("Escape");
  await page.getByLabel("Find documents").fill("missing document");
  await expect(page.locator(".search-empty .search-artwork")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("illustrated-search-empty.png"), fullPage: true });
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await heading.hover();
  await expect(folderPage).toHaveCSS("transform", resting);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.getByRole("button", { name: "New document", exact: true }).click();
  await expect(documentDialog.locator(".document-artwork")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("illustrated-dialog-mobile.png"), fullPage: true });
});

test("editor and history artwork stays outside document content and cannot change a revision", async ({ page, context }, testInfo) => {
  const { files } = await setup(context);
  const file = files[0];
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/files/${file.id}`);
  const content = page.getByRole("textbox", { name: "Document content" });
  await expect(content).toBeVisible();
  await content.fill("Illustrations belong to Flux, not to the shared document.");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await expect(page.locator(".editor-document-identity .document-artwork")).toBeVisible();
  await expect(content.locator("svg")).toHaveCount(0);
  const before = await content.innerHTML();
  const head = await (await context.request.get(`/api/files/${file.id}/history-head`)).json();
  const checkpoint = page.getByRole("button", { name: "Save checkpoint", exact: true });
  await expect(checkpoint.locator(".checkpoint-artwork")).toBeVisible();
  await checkpoint.focus();
  await expect(checkpoint.locator(".checkpoint-seal")).toHaveCSS("opacity", "1");
  expect(await content.innerHTML()).toBe(before);
  expect(await (await context.request.get(`/api/files/${file.id}/history-head`)).json()).toEqual(head);
  await checkpoint.click();
  const modal = page.getByRole("dialog", { name: "Save a checkpoint" });
  await expect(modal.locator(".checkpoint-artwork")).toBeVisible();
  await expect(page.getByLabel("Checkpoint name")).toBeFocused();
  await page.getByLabel("Checkpoint name").fill("Illustrated history test");
  await page.screenshot({ path: testInfo.outputPath("illustrated-checkpoint-dialog.png"), fullPage: true });
  await modal.getByRole("button", { name: "Save checkpoint", exact: true }).click();
  await expect(page.locator(".checkpoint-notice")).toContainText("Illustrated history test");
  const afterCheckpoint = await (await context.request.get(`/api/files/${file.id}/history-head`)).json();
  await page.getByRole("link", { name: "History", exact: true }).click();
  const historical = page.getByRole("textbox", { name: "Historical document content" });
  await expect(historical).toContainText("Illustrations belong to Flux");
  await expect(historical).toHaveAttribute("contenteditable", "false");
  await expect(historical.locator("svg")).toHaveCount(0);
  await expect(page.locator(".history-intro .history-artwork")).toBeVisible();
  await expect(page.locator(".historical-identity .document-artwork")).toBeVisible();
  const historyPage = page.locator(".history-intro .history-art-current");
  const resting = await historyPage.evaluate(element => getComputedStyle(element).transform);
  await page.locator(".history-intro").hover();
  await expect.poll(() => historyPage.evaluate(element => getComputedStyle(element).transform)).not.toBe(resting);
  await page.screenshot({ path: testInfo.outputPath("illustrated-history.png"), fullPage: true });
  await page.getByRole("button", { name: "Restore as new revision", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Restore as a new revision" }).locator(".history-artwork")).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await (await context.request.get(`/api/files/${file.id}/history-head`)).json()).toEqual(afterCheckpoint);
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.screenshot({ path: testInfo.outputPath("illustrated-history-mobile.png"), fullPage: true });
  await page.getByRole("link", { name: "Open current document", exact: true }).click();
  await expect(content).toContainText("Illustrations belong to Flux");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("illustrated-editor-mobile.png"), fullPage: true });
});

test("invitation artwork follows the same visual family and preserves the email-bound joining flow", async ({ context, browser }, testInfo) => {
  const { workspace } = await setup(context);
  const member = await browser.newContext({ baseURL: origin });
  try {
    const email = `illustrated-member-${randomUUID()}@flux.test`;
    const registered = await member.request.post("/api/auth/register", { headers: { origin }, data: { name: "Invited teammate", email, password: "a secure invitation password" } });
    expect(registered.ok(), await registered.text()).toBe(true);
    users.push((await registered.json()).id);
    const invitation = await context.request.post(`/api/workspaces/${workspace.id}/invitations`, { headers: { origin }, data: { email, role: "EDITOR" } });
    expect(invitation.ok(), await invitation.text()).toBe(true);
    const { url } = await invitation.json();
    const memberPage = await member.newPage();
    await memberPage.setViewportSize({ width: 1440, height: 900 });
    await memberPage.goto(url);
    await expect(memberPage.getByRole("heading", { name: `Join ${workspace.name}`, exact: true })).toBeVisible();
    const envelope = memberPage.locator(".invite-card .people-art-envelope");
    await expect(envelope).toBeVisible();
    const resting = await envelope.evaluate(element => getComputedStyle(element).transform);
    await memberPage.getByRole("button", { name: "Join workspace", exact: true }).focus();
    await expect.poll(() => envelope.evaluate(element => getComputedStyle(element).transform)).not.toBe(resting);
    await memberPage.screenshot({ path: testInfo.outputPath("illustrated-invitation.png"), fullPage: true });
    await memberPage.setViewportSize({ width: 320, height: 740 });
    expect(await memberPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await memberPage.screenshot({ path: testInfo.outputPath("illustrated-invitation-mobile.png"), fullPage: true });
    await memberPage.getByRole("button", { name: "Join workspace", exact: true }).click();
    await expect(memberPage).toHaveURL(`/workspaces/${workspace.id}`);
    await expect(memberPage.getByRole("heading", { name: workspace.name, exact: true })).toBeVisible();
  } finally { await member.close(); }
});
