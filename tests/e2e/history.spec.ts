import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { config } from "dotenv";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { DeleteObjectsCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { SnapshotStorage } from "@flux/storage";
import type { CheckpointDetail, CheckpointPage, CheckpointSummary, HistoryHead, RestoreResult } from "@flux/shared";

config({ path: resolve(process.cwd(), ".env"), quiet: true });
const origin = "http://localhost:3000";
const db = new PrismaClient();
const storage = new SnapshotStorage();
const users: string[] = [];
const workspaces: string[] = [];

async function account(context: BrowserContext, name: string) {
  const email = `${name.toLowerCase().replace(/\s/g, "-")}-${randomUUID()}@flux.test`;
  const response = await context.request.post("/api/auth/register", { headers: { origin }, data: { name, email, password: "a secure history test password" } });
  expect(response.ok(), await response.text()).toBe(true);
  const user = await response.json(); users.push(user.id);
  return { ...user, email };
}

async function createDocument(context: BrowserContext) {
  const workspace = await (await context.request.post("/api/workspaces", { headers: { origin }, data: { name: `History test ${randomUUID().slice(0, 8)}` } })).json();
  workspaces.push(workspace.id);
  const response = await context.request.post(`/api/workspaces/${workspace.id}/files`, { headers: { origin }, data: { name: "Project proposal" } });
  expect(response.ok()).toBe(true);
  const file = await response.json();
  return { ...file, workspaceId: workspace.id };
}

async function invite(owner: BrowserContext, member: BrowserContext, workspaceId: string, email: string, role = "EDITOR") {
  const response = await owner.request.post(`/api/workspaces/${workspaceId}/invitations`, { headers: { origin }, data: { email, role } });
  const { url } = await response.json();
  expect((await member.request.post(`/api/invitations/${url.split("/").at(-1)}/accept`, { headers: { origin } })).ok()).toBe(true);
}

async function write(page: Page, fileId: string, text: string) {
  await page.goto(`/files/${fileId}`);
  const content = page.getByRole("textbox", { name: "Document content" });
  await expect(content).toBeVisible(); await content.fill(text);
  await expect(page.locator(".save-status")).toHaveText("Saved");
  return content;
}

async function checkpoint(context: BrowserContext, fileId: string, title: string) {
  const response = await context.request.post(`/api/files/${fileId}/checkpoints`, { headers: { origin }, data: { title, requestId: randomUUID() } });
  expect(response.ok(), await response.text()).toBe(true);
  return await response.json() as CheckpointSummary;
}

async function head(context: BrowserContext, fileId: string) {
  const response = await context.request.get(`/api/files/${fileId}/history-head`);
  expect(response.ok(), await response.text()).toBe(true);
  return await response.json() as HistoryHead;
}

function restoreBody(current: HistoryHead, requestId = randomUUID()) {
  return { requestId, expectedGeneration: current.generation, expectedRevision: current.revision, expectedContentHash: current.contentHash };
}

test.afterAll(async () => {
  const objects = await db.checkpoint.findMany({ where: { file: { workspaceId: { in: workspaces } } }, select: { objectKey: true } });
  if (objects.length) await storage.client.send(new DeleteObjectsCommand({ Bucket: storage.bucket, Delete: { Objects: objects.map(object => ({ Key: object.objectKey })) } }));
  await db.workspace.deleteMany({ where: { id: { in: workspaces } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect(); storage.client.destroy();
});

test("named history previews are read-only and restore appends a revision while preserving later work", async ({ browser }, testInfo) => {
  const context = await browser.newContext({ baseURL: origin });
  try {
    await account(context, "History owner"); const file = await createDocument(context); const page = await context.newPage();
    const content = await write(page, file.id, "Original proposal for our team.");
    await content.press("ControlOrMeta+a"); await page.getByRole("button", { name: "Bold", exact: true }).click();
    await expect(page.locator(".save-status")).toHaveText("Saved");
    await page.getByRole("button", { name: "Save checkpoint", exact: true }).click();
    await page.getByLabel("Checkpoint name").fill("Initial draft");
    await page.getByRole("dialog").getByRole("button", { name: "Save checkpoint", exact: true }).click();
    await expect(page.locator(".checkpoint-notice")).toContainText("Initial draft");
    const initial = (await (await context.request.get(`/api/files/${file.id}/checkpoints`)).json() as CheckpointPage).checkpoints[0];
    const initialSnapshot = await (await context.request.get(`/api/files/${file.id}/checkpoints/${initial.id}`)).json() as CheckpointDetail;
    await content.fill("The newer proposal should remain recoverable.");
    await expect(page.locator(".save-status")).toHaveText("Saved");
    await checkpoint(context, file.id, "Revised draft");
    const beforePreview = await head(context, file.id);
    await page.getByRole("link", { name: "History", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Historical document content" })).toContainText("newer proposal");
    await page.getByRole("button", { name: /Checkpoint 1.*Initial draft/ }).click();
    const historical = page.getByRole("textbox", { name: "Historical document content" });
    await expect(historical).toContainText("Original proposal");
    await expect(historical).toHaveAttribute("contenteditable", "false");
    await expect(historical.locator("strong")).toContainText("Original proposal");
    expect(await head(context, file.id)).toEqual(beforePreview);
    await page.screenshot({ path: testInfo.outputPath("history.png"), fullPage: true });
    await page.getByRole("button", { name: "Restore as new revision", exact: true }).click();
    await page.getByRole("button", { name: "Confirm restore", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/files/${file.id}$`));
    await expect(page.getByRole("textbox", { name: "Document content" })).toContainText("Original proposal");
    await expect(page.locator(".save-status")).toHaveText("Saved");
    const history = await (await context.request.get(`/api/files/${file.id}/checkpoints`)).json() as CheckpointPage;
    expect(history.checkpoints).toHaveLength(4);
    expect(history.checkpoints[0].kind).toBe("RESTORE"); expect(history.checkpoints[1].kind).toBe("BEFORE_RESTORE");
    const preserved = await (await context.request.get(`/api/files/${file.id}/checkpoints/${history.checkpoints[1].id}`)).json() as CheckpointDetail;
    expect(JSON.stringify(preserved.content)).toContain("newer proposal");
    const originalAgain = await (await context.request.get(`/api/files/${file.id}/checkpoints/${initial.id}`)).json();
    expect(originalAgain.content).toEqual(initialSnapshot.content);
    expect((await head(context, file.id)).generation).toBe(beforePreview.generation + 1);
    const timeline = await (await context.request.get(`/api/files/${file.id}/timeline`)).json();
    expect(timeline[0].type).toBe("DOCUMENT_RESTORED");
    const olderPage = await (await context.request.get(`/api/files/${file.id}/checkpoints?limit=2`)).json() as CheckpointPage;
    const finalPage = await (await context.request.get(`/api/files/${file.id}/checkpoints?limit=2&cursor=${olderPage.nextCursor}`)).json() as CheckpointPage;
    expect(finalPage.checkpoints).toHaveLength(2); expect(finalPage.nextCursor).toBeNull();
    await page.goto(`/files/${file.id}/history`); await expect(historical).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("history-mobile.png"), fullPage: true });
  } finally { await context.close(); }
});

test("live edits invalidate stale restores; retries and simultaneous restores cannot duplicate commits", async ({ browser }) => {
  const owner = await browser.newContext({ baseURL: origin }); const editor = await browser.newContext({ baseURL: origin });
  try {
    await account(owner, "Restore owner"); const teammate = await account(editor, "Restore editor"); const file = await createDocument(owner);
    await invite(owner, editor, file.workspaceId, teammate.email);
    const ownerPage = await owner.newPage(); await write(ownerPage, file.id, "Approved original text.");
    const source = await checkpoint(owner, file.id, "Original"); const staleHead = await head(owner, file.id);
    const editorPage = await editor.newPage(); await write(editorPage, file.id, "A teammate changed main during review.");
    const stale = await owner.request.post(`/api/files/${file.id}/checkpoints/${source.id}/restore`, { headers: { origin }, data: restoreBody(staleHead) });
    expect(stale.status()).toBe(409);
    await expect(editorPage.getByRole("textbox", { name: "Document content" })).toContainText("changed main");
    expect(await db.checkpoint.count({ where: { fileId: file.id } })).toBe(1);
    const current = await head(owner, file.id); const data = restoreBody(current);
    const restored = await owner.request.post(`/api/files/${file.id}/checkpoints/${source.id}/restore`, { headers: { origin }, data });
    expect(restored.ok(), await restored.text()).toBe(true);
    const result = await restored.json() as RestoreResult;
    await expect(editorPage.getByRole("textbox", { name: "Document content" })).toContainText("Approved original");
    await expect(editorPage.locator(".save-status")).toHaveText("Saved");
    const retry = await owner.request.post(`/api/files/${file.id}/checkpoints/${source.id}/restore`, { headers: { origin }, data });
    expect(retry.ok(), await retry.text()).toBe(true); expect((await retry.json()).checkpoint.id).toBe(result.checkpoint.id);
    expect(await db.checkpoint.count({ where: { fileId: file.id } })).toBe(3);
    const fresh = await head(owner, file.id);
    const simultaneous = await Promise.all([1, 2].map(() => owner.request.post(`/api/files/${file.id}/checkpoints/${source.id}/restore`, { headers: { origin }, data: restoreBody(fresh) })));
    expect(simultaneous.map(response => response.status()).sort()).toEqual([201, 409]);
    expect(await db.checkpoint.count({ where: { fileId: file.id } })).toBe(5);
  } finally { await owner.close(); await editor.close(); }
});

test("history permissions, private objects, and service-token scope are enforced", async ({ browser }) => {
  const owner = await browser.newContext({ baseURL: origin }); const viewer = await browser.newContext({ baseURL: origin }); const outsider = await browser.newContext({ baseURL: origin });
  try {
    await account(owner, "Permission owner"); const reader = await account(viewer, "History reader"); await account(outsider, "History outsider");
    const file = await createDocument(owner); await invite(owner, viewer, file.workspaceId, reader.email, "VIEWER");
    const source = await checkpoint(owner, file.id, "Private checkpoint"); const current = await head(owner, file.id);
    expect((await viewer.request.get(`/api/files/${file.id}/checkpoints/${source.id}`)).ok()).toBe(true);
    expect((await viewer.request.post(`/api/files/${file.id}/checkpoints`, { headers: { origin }, data: { title: "Not allowed", requestId: randomUUID() } })).status()).toBe(403);
    expect((await viewer.request.post(`/api/files/${file.id}/checkpoints/${source.id}/restore`, { headers: { origin }, data: restoreBody(current) })).status()).toBe(403);
    expect((await outsider.request.get(`/api/files/${file.id}/checkpoints`)).status()).toBe(404);
    expect((await outsider.request.get(`/api/files/${file.id}/checkpoints/${source.id}`)).status()).toBe(404);
    const stored = await db.checkpoint.findUniqueOrThrow({ where: { id: source.id } });
    const original = await storage.get(stored.objectKey, stored.checksum);
    await expect(storage.put(stored.objectKey, original)).rejects.toThrow();
    expect(await storage.get(stored.objectKey, stored.checksum)).toEqual(original);
    expect((await owner.request.get(`${process.env.S3_ENDPOINT}/${storage.bucket}/${stored.objectKey}`)).ok()).toBe(false);
    expect((await owner.request.post("http://localhost:1234/internal/history")).status()).toBe(401);
    const credentials = await (await owner.request.post(`/api/files/${file.id}/collaboration-token`, { headers: { origin } })).json();
    expect((await owner.request.post("http://localhost:1234/internal/history", { headers: { authorization: `Bearer ${credentials.token}` } })).status()).toBe(401);
  } finally { await owner.close(); await viewer.close(); await outsider.close(); }
});

test("a damaged snapshot cannot be previewed or restored", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: origin });
  try {
    await account(context, "Integrity owner"); const file = await createDocument(context); const page = await context.newPage();
    await write(page, file.id, "Current work must survive."); const source = await checkpoint(context, file.id, "Snapshot to verify");
    const current = await head(context, file.id); const stored = await db.checkpoint.findUniqueOrThrow({ where: { id: source.id } });
    // A metadata/schema mismatch must fail before main changes, even when the
    // object's checksum is still valid.
    await db.checkpoint.update({ where: { id: source.id }, data: { schemaVersion: 99 } });
    expect((await context.request.get(`/api/files/${file.id}/checkpoints/${source.id}`)).status()).toBe(503);
    expect((await context.request.post(`/api/files/${file.id}/checkpoints/${source.id}/restore`, { headers: { origin }, data: restoreBody(current) })).status()).toBe(409);
    expect(await head(context, file.id)).toEqual(current);
    await db.checkpoint.update({ where: { id: source.id }, data: { schemaVersion: 1 } });
    // Simulate corruption of this test's own object by a storage administrator.
    await storage.client.send(new PutObjectCommand({ Bucket: storage.bucket, Key: stored.objectKey, Body: "corrupted" }));
    expect((await context.request.get(`/api/files/${file.id}/checkpoints/${source.id}`)).status()).toBe(503);
    expect((await context.request.post(`/api/files/${file.id}/checkpoints/${source.id}/restore`, { headers: { origin }, data: restoreBody(current) })).status()).toBe(409);
    expect(await head(context, file.id)).toEqual(current);
    expect(await db.checkpoint.count({ where: { fileId: file.id } })).toBe(1);
    await expect(page.getByRole("textbox", { name: "Document content" })).toContainText("must survive");
  } finally { await context.close(); }
});

test("offline drafts survive reconnecting after main was restored", async ({ browser }) => {
  const owner = await browser.newContext({ baseURL: origin }); const editor = await browser.newContext({ baseURL: origin });
  try {
    await account(owner, "Offline owner"); const teammate = await account(editor, "Offline editor"); const file = await createDocument(owner);
    await invite(owner, editor, file.workspaceId, teammate.email);
    const ownerPage = await owner.newPage(); await write(ownerPage, file.id, "Original saved main.");
    const source = await checkpoint(owner, file.id, "Original saved version");
    const editorPage = await editor.newPage();
    await editorPage.goto(`/files/${file.id}`);
    const content = editorPage.getByRole("textbox", { name: "Document content" });
    await expect(content).toContainText("Original saved main"); await expect(editorPage.locator(".save-status")).toHaveText("Saved");
    await editor.setOffline(true);
    await content.fill("An offline draft that was never sent to the server.");
    const current = await head(owner, file.id);
    const restored = await owner.request.post(`/api/files/${file.id}/checkpoints/${source.id}/restore`, { headers: { origin }, data: restoreBody(current) });
    expect(restored.ok(), await restored.text()).toBe(true);
    await editor.setOffline(false);
    await expect(editorPage.getByRole("button", { name: "Download local draft", exact: true })).toBeVisible();
    await expect(content).toContainText("never sent to the server"); await expect(content).toHaveAttribute("contenteditable", "false");
    await ownerPage.reload();
    await expect(ownerPage.getByRole("textbox", { name: "Document content" })).toContainText("Original saved main");
    await expect(ownerPage.getByRole("textbox", { name: "Document content" })).not.toContainText("offline draft");
    expect((await head(owner, file.id)).generation).toBe(current.generation + 1);
  } finally { await owner.close(); await editor.close(); }
});

test("unacknowledged drafts remain visible for recovery instead of replaying into a restored session", async ({ browser }) => {
  const owner = await browser.newContext({ baseURL: origin }); const editor = await browser.newContext({ baseURL: origin });
  let holdAcknowledgements = false;
  try {
    await account(owner, "Draft owner"); const teammate = await account(editor, "Draft editor"); const file = await createDocument(owner);
    await invite(owner, editor, file.workspaceId, teammate.email);
    const ownerPage = await owner.newPage(); await write(ownerPage, file.id, "Original main.");
    const source = await checkpoint(owner, file.id, "Before experiment"); const originalHead = await head(owner, file.id);
    const editorPage = await editor.newPage();
    await editorPage.routeWebSocket(/localhost:1234/, socket => {
      const server = socket.connectToServer();
      server.onMessage(message => {
        const bytes = typeof message === "string" ? Buffer.from(message) : message;
        if (holdAcknowledgements && bytes.includes(Buffer.from('"type":"saved"'))) return;
        socket.send(message);
      });
    });
    await editorPage.goto(`/files/${file.id}`);
    const content = editorPage.getByRole("textbox", { name: "Document content" });
    await expect(content).toContainText("Original main"); await expect(editorPage.locator(".save-status")).toHaveText("Saved");
    holdAcknowledgements = true;
    await content.fill("My unacknowledged draft remains recoverable.");
    await expect.poll(async () => (await head(owner, file.id)).contentHash).not.toBe(originalHead.contentHash);
    const current = await head(owner, file.id);
    const restored = await owner.request.post(`/api/files/${file.id}/checkpoints/${source.id}/restore`, { headers: { origin }, data: restoreBody(current) });
    expect(restored.ok(), await restored.text()).toBe(true);
    await expect(editorPage.getByRole("button", { name: "Download local draft", exact: true })).toBeVisible();
    await expect(content).toContainText("unacknowledged draft"); await expect(content).toHaveAttribute("contenteditable", "false");
    const downloaded = editorPage.waitForEvent("download"); await editorPage.getByRole("button", { name: "Download local draft", exact: true }).click();
    expect((await downloaded).suggestedFilename()).toBe("flux-local-draft.json");
    holdAcknowledgements = false;
    editorPage.once("dialog", dialog => dialog.accept());
    await editorPage.getByRole("button", { name: "Open current revision", exact: true }).click();
    await expect(content).toContainText("Original main"); await expect(editorPage.locator(".save-status")).toHaveText("Saved");
  } finally { await owner.close(); await editor.close(); }
});
