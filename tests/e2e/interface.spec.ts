import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { config } from "dotenv";
import { test, expect, type BrowserContext } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

config({ path: resolve(process.cwd(), ".env"), quiet: true });
const origin = "http://localhost:3000";
const db = new PrismaClient();
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
  await db.workspace.deleteMany({ where: { id: { in: workspaces } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
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
  await expect(page.locator("body")).toHaveCSS("color", "rgb(225, 233, 245)");
  await page.getByRole("button", { name: "Checkpoint", exact: true }).click();
  await expect(page.getByRole("heading", { name: "First draft, kept safe" })).toBeVisible();
  await page.getByLabel("Password", { exact: true }).fill("sample-password");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Hide password" }).click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "password");
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
  await expect(page.locator("body")).toHaveCSS("color", "rgb(25, 40, 61)");
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
  await expect(page.locator(".spotlight-light")).toHaveCSS("display", "none");
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
