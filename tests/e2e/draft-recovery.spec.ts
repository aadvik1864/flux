import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { SnapshotStorage } from "@flux/storage";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import type { HistoryHead } from "@flux/shared";

config({ path: resolve(process.cwd(), ".env"), quiet: true });
const origin = "http://localhost:3000";
const db = new PrismaClient();
const storage = new SnapshotStorage();
const users: string[] = [];
const workspaces: string[] = [];

async function setup(context: BrowserContext) {
  const response = await context.request.post("/api/auth/register", { headers: { origin }, data: { name: "Draft owner", email: `draft-${randomUUID()}@flux.test`, password: "a secure browser recovery password" } });
  expect(response.ok(), await response.text()).toBe(true);
  const user = await response.json(); users.push(user.id);
  const workspace = await (await context.request.post("/api/workspaces", { headers: { origin }, data: { name: `Draft recovery ${randomUUID().slice(0, 8)}` } })).json(); workspaces.push(workspace.id);
  const file = await (await context.request.post(`/api/workspaces/${workspace.id}/files`, { headers: { origin }, data: { name: "Recovery proposal" } })).json();
  return { file, user };
}

async function open(page: Page, fileId: string) {
  await page.goto(`/files/${fileId}`);
  await expect(page.getByRole("textbox", { name: "Document content", exact: true })).toBeVisible();
  await expect(page.locator(".save-status")).toHaveText("Saved");
  return page.getByRole("textbox", { name: "Document content", exact: true });
}

async function drafts(page: Page) {
  return page.evaluate(() => new Promise<Array<{ version: number; userId: string; generation: number }>>((resolve, reject) => {
    const request = indexedDB.open("flux-local-drafts", 1);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction("drafts", "readonly"); const records = transaction.objectStore("drafts").getAll();
      transaction.oncomplete = () => { db.close(); resolve(records.result); };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
    };
    request.onerror = () => reject(request.error);
  }));
}

test.afterAll(async () => {
  const objects = await db.checkpoint.findMany({ where: { file: { workspaceId: { in: workspaces } } }, select: { objectKey: true } });
  if (objects.length) await storage.client.send(new DeleteObjectsCommand({ Bucket: storage.bucket, Delete: { Objects: objects.map(object => ({ Key: object.objectKey })) } }));
  await db.workspace.deleteMany({ where: { id: { in: workspaces } } }); await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect(); storage.client.destroy();
});

test("transient token failures retry without denying access or losing edits", async ({ context, page }) => {
  const { file } = await setup(context);
  let fail = true;
  await page.route(`**/files/${file.id}/collaboration-token`, route => fail ? route.fulfill({ status: 503, contentType: "application/json", body: '{"message":"Temporarily unavailable"}' }) : route.continue());
  await page.goto(`/files/${file.id}`);
  await expect(page.getByRole("button", { name: "Retry connection", exact: true })).toBeVisible();
  await expect(page.locator(".editor-error")).not.toContainText("denied");
  fail = false;
  await page.getByRole("button", { name: "Retry connection", exact: true }).click();
  const content = page.getByRole("textbox", { name: "Document content", exact: true });
  await expect(content).toBeVisible(); await expect(page.locator(".save-status")).toHaveText("Saved");
  await context.setOffline(true); await content.fill("My offline changes survive a token outage.");
  await expect(page.locator(".browser-backup-status")).toContainText("Browser backup saved");
  fail = true; await context.setOffline(false);
  await expect(page.getByRole("button", { name: "Retry connection", exact: true })).toBeVisible();
  await expect(content).toHaveAttribute("contenteditable", "true"); await expect(content).toContainText("survive a token outage");
  fail = false; await page.getByRole("button", { name: "Retry connection", exact: true }).click();
  await expect(page.locator(".save-status")).toHaveText("Saved"); await expect.poll(() => drafts(page)).toHaveLength(0);
});

test("offline drafts survive closing a tab and require explicit review before resuming", async ({ context, page }, testInfo) => {
  const { file } = await setup(context); const content = await open(page, file.id);
  await content.fill("Shared version before offline work."); await expect(page.locator(".save-status")).toHaveText("Saved");
  await context.setOffline(true); await content.fill("Recovered work that was never sent.");
  await expect(page.locator(".browser-backup-status")).toContainText("Browser backup saved");
  await page.close(); await context.setOffline(false);
  const reopened = await context.newPage(); const current = await open(reopened, file.id);
  await expect(current).toContainText("Shared version before offline"); await expect(current).not.toContainText("Recovered work");
  await reopened.getByRole("button", { name: /Review browser draft/ }).click();
  await expect(reopened.getByRole("textbox", { name: "Browser draft content" })).toContainText("Recovered work");
  await expect(reopened.getByRole("textbox", { name: "Browser draft content" })).toHaveAttribute("contenteditable", "false");
  await reopened.screenshot({ path: testInfo.outputPath("draft-review.png"), fullPage: true });
  await reopened.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await reopened.setViewportSize({ width: 320, height: 740 });
  await expect(reopened.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await reopened.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await reopened.getByRole("dialog").evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth)).toBe(true);
  await reopened.screenshot({ path: testInfo.outputPath("draft-review-mobile-night.png"), fullPage: true });
  await reopened.getByRole("button", { name: "Resume browser draft", exact: true }).click();
  await expect(current).toContainText("Recovered work"); await expect(reopened.locator(".save-status")).toHaveText("Saved");
  await expect.poll(() => drafts(reopened)).toHaveLength(0); await reopened.reload();
  await expect(current).toContainText("Recovered work");
});

test("initial file outages automatically retry rather than becoming access denied", async ({ context, page }) => {
  const { file } = await setup(context); let calls = 0;
  await page.route(`**/api/files/${file.id}`, route => ++calls === 1 ? route.fulfill({ status: 503, contentType: "application/json", body: '{"message":"Temporarily unavailable"}' }) : route.continue());
  await page.goto(`/files/${file.id}`);
  await expect(page.getByRole("textbox", { name: "Document content", exact: true })).toBeVisible();
  await expect(page.locator(".save-status")).toHaveText("Saved"); expect(calls).toBeGreaterThan(1);
});

test("actual denied token access remains read-only and does not retry", async ({ context, page }) => {
  const { file } = await setup(context); let calls = 0;
  await page.route(`**/files/${file.id}/collaboration-token`, route => { calls += 1; return route.fulfill({ status: 403, contentType: "application/json", body: '{"message":"Access denied"}' }); });
  await page.goto(`/files/${file.id}`); await expect(page.locator(".editor-error")).toContainText("access was denied");
  await expect(page.getByRole("button", { name: "Retry connection", exact: true })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Document content", exact: true })).toHaveCount(0);
  expect(calls).toBe(1);
});

test("a refreshed draft from before a restore is download-only and cannot replay into main", async ({ context, page }) => {
  const { file } = await setup(context); const content = await open(page, file.id);
  await content.fill("Approved main survives recovery."); await expect(page.locator(".save-status")).toHaveText("Saved");
  const response = await context.request.post(`/api/files/${file.id}/checkpoints`, { headers: { origin }, data: { title: "Approved", requestId: randomUUID() } });
  expect(response.ok()).toBe(true); const checkpoint = await response.json();
  await context.setOffline(true); await content.fill("Old offline experiment must not change restored main.");
  await expect(page.locator(".browser-backup-status")).toContainText("Browser backup saved"); await page.close(); await context.setOffline(false);
  const head = await (await context.request.get(`/api/files/${file.id}/history-head`)).json() as HistoryHead;
  const restored = await context.request.post(`/api/files/${file.id}/checkpoints/${checkpoint.id}/restore`, { headers: { origin }, data: { requestId: randomUUID(), expectedGeneration: head.generation, expectedRevision: head.revision, expectedContentHash: head.contentHash } });
  expect(restored.ok(), await restored.text()).toBe(true);
  const reopened = await context.newPage(); const current = await open(reopened, file.id);
  await reopened.getByRole("button", { name: /Review browser draft/ }).click();
  await expect(reopened.getByRole("dialog")).toContainText("download-only");
  await expect(reopened.getByRole("button", { name: "Resume browser draft", exact: true })).toHaveCount(0);
  await expect(reopened.getByRole("textbox", { name: "Browser draft content" })).toContainText("Old offline experiment");
  const download = reopened.waitForEvent("download"); await reopened.getByRole("button", { name: "Download browser draft", exact: true }).click(); expect((await download).suggestedFilename()).toBe("flux-local-draft.json");
  await expect(current).toContainText("Approved main"); await expect(current).not.toContainText("Old offline");
  reopened.once("dialog", dialog => dialog.accept()); await reopened.getByRole("button", { name: "Discard browser draft", exact: true }).click();
  await expect.poll(() => drafts(reopened)).toHaveLength(0);
});

test("browser backup failures stay explicit while edits remain downloadable", async ({ context, page }) => {
  const { file } = await setup(context);
  await page.addInitScript(() => { Object.defineProperty(window, "indexedDB", { get() { throw new DOMException("Disabled", "SecurityError"); } }); });
  const content = await open(page, file.id);
  await expect(page.locator(".browser-backup-status")).toContainText("Browser backups are unavailable");
  await context.setOffline(true); await content.fill("Local text remains visible despite unavailable browser storage.");
  await expect(page.locator(".browser-backup-status")).toContainText("Browser backup could not be saved");
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Download local draft", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("flux-local-draft.json"); await expect(content).toContainText("Local text remains visible");
});

test("signing out in another tab stops late writes and clears that account's drafts", async ({ context, page }) => {
  const { file, user } = await setup(context); const content = await open(page, file.id);
  let hold = false;
  await page.routeWebSocket(/localhost:1234/, socket => { const server = socket.connectToServer(); server.onMessage(message => { const bytes = typeof message === "string" ? Buffer.from(message) : message; if (!hold || !bytes.includes(Buffer.from('"type":"saved"'))) socket.send(message); }); });
  await page.reload(); await expect(page.locator(".save-status")).toHaveText("Saved"); hold = true;
  await content.fill("A private unacknowledged draft."); await expect(page.locator(".browser-backup-status")).toContainText("Browser backup saved");
  expect((await drafts(page))[0].userId).toBe(user.id);
  const other = await context.newPage(); await other.goto("/"); await other.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login/); await expect.poll(() => drafts(page)).toHaveLength(0);
});
