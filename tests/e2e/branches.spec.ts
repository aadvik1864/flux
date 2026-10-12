import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { config } from "dotenv";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { DeleteObjectsCommand } from "@aws-sdk/client-s3";
import * as Y from "yjs";
import { contentFromYDoc, yDocFromContent, validateDocument } from "@flux/document-model";
import { SnapshotStorage } from "@flux/storage";
import type { DocumentContent, ExperimentSummary, MergePreview, MergeApprovalSummary, MergeResult } from "@flux/shared";

config({ path: resolve(process.cwd(), ".env"), quiet: true });
const origin = "http://localhost:3000";
const db = new PrismaClient(), storage = new SnapshotStorage();
const users: string[] = [], workspaces: string[] = [];
const paragraph = (id: string, text: string): DocumentContent => ({ type: "paragraph", attrs: { blockId: id }, content: [{ type: "text", text }] });

async function account(context: BrowserContext, name: string) {
  const email = `${name.toLowerCase().replace(/\s/g, "-")}-${randomUUID()}@flux.test`;
  const response = await context.request.post("/api/auth/register", { headers: { origin }, data: { name, email, password: "a secure branch test password" } });
  expect(response.ok(), await response.text()).toBe(true);
  const user = await response.json(); users.push(user.id); return { ...user, email };
}
async function fixture(context: BrowserContext, content?: DocumentContent) {
  const workspace = await (await context.request.post("/api/workspaces", { headers: { origin }, data: { name: `Branch test ${randomUUID().slice(0, 8)}` } })).json(); workspaces.push(workspace.id);
  const created = await context.request.post(`/api/workspaces/${workspace.id}/files`, { headers: { origin }, data: { name: "Branch proposal" } });
  expect(created.ok(), await created.text()).toBe(true);
  const file = await db.file.findUniqueOrThrow({ where: { id: (await created.json()).id } });
  const document = yDocFromContent(validateDocument(content ?? { type: "doc", content: [paragraph("intro", "Original introduction."), paragraph("budget", "Original budget."), paragraph("end", "Original conclusion.")] }));
  await db.documentState.create({ data: { branchId: file.mainBranchId!, state: new Uint8Array(Y.encodeStateAsUpdate(document)) } }); document.destroy();
  const response = await context.request.post(`/api/files/${file.id}/checkpoints`, { headers: { origin }, data: { title: "Shared base", requestId: randomUUID() } });
  expect(response.ok(), await response.text()).toBe(true);
  return { ...file, workspaceId: workspace.id, base: await response.json() };
}
async function invite(owner: BrowserContext, member: BrowserContext, workspaceId: string, email: string, role = "REVIEWER") {
  const response = await owner.request.post(`/api/workspaces/${workspaceId}/invitations`, { headers: { origin }, data: { email, role } });
  expect(response.ok(), await response.text()).toBe(true); const { url } = await response.json();
  expect((await member.request.post(`/api/invitations/${url.split("/").at(-1)}/accept`, { headers: { origin } })).ok()).toBe(true);
}
async function fork(context: BrowserContext, fileId: string, checkpointId: string, name = "Different direction", requestId: string = randomUUID()) {
  const response = await context.request.post(`/api/files/${fileId}/branches`, { headers: { origin }, data: { checkpointId, name, requestId } });
  expect(response.ok(), await response.text()).toBe(true); return await response.json() as ExperimentSummary;
}
async function open(page: Page, fileId: string, branchId?: string) {
  await page.goto(`/files/${fileId}${branchId ? `/branches/${branchId}` : ""}`);
  await expect(page.getByRole("textbox", { name: "Document content" })).toBeVisible();
  await expect(page.locator(".save-status")).toHaveText("Saved");
}
async function fillBlock(page: Page, id: string, text: string) {
  const block = page.locator(`.document-content [data-block-id="${id}"]`);
  // Firefox's contenteditable fill can select the outer editor instead of this
  // nested paragraph. Select only this block's contents, then use real input.
  await block.evaluate(element => {
    (element.closest('[contenteditable="true"]') as HTMLElement).focus();
    const range = document.createRange(); range.selectNodeContents(element);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  });
  await page.keyboard.insertText(text);
  await expect(block).toHaveText(text);
}
async function change(page: Page, id: string, text: string) {
  await fillBlock(page, id, text);
  await expect(page.locator(".save-status")).toHaveText("Saved");
}
async function compare(context: BrowserContext, fileId: string, branchId: string) {
  const response = await context.request.get(`/api/files/${fileId}/branches/${branchId}/compare`);
  expect(response.ok(), await response.text()).toBe(true); return await response.json() as MergePreview;
}
async function approve(context: BrowserContext, fileId: string, branchId: string, preview: MergePreview, resolutions = {}, requestId: string = randomUUID()) {
  return context.request.post(`/api/files/${fileId}/branches/${branchId}/approvals`, { headers: { origin }, data: { mainHead: preview.mainHead, sourceHead: preview.sourceHead, resolutions, requestId } });
}
async function merge(context: BrowserContext, fileId: string, branchId: string, approvalId: string, requestId: string = randomUUID()) {
  return context.request.post(`/api/files/${fileId}/branches/${branchId}/merge`, { headers: { origin }, data: { approvalId, requestId } });
}
test.afterAll(async () => {
  const objects = await db.checkpoint.findMany({ where: { file: { workspaceId: { in: workspaces } } }, select: { objectKey: true } });
  if (objects.length) await storage.client.send(new DeleteObjectsCommand({ Bucket: storage.bucket, Delete: { Objects: objects.map(object => ({ Key: object.objectKey })) } }));
  // Bases remain protected while experiments reference them.
  await db.branch.deleteMany({ where: { file: { workspaceId: { in: workspaces } }, baseCheckpointId: { not: null } } });
  await db.workspace.deleteMany({ where: { id: { in: workspaces } } }); await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect(); storage.client.destroy();
});

test("experiments isolate edits, require a teammate approval, and merge into connected main without replacing its room", async ({ browser }, testInfo) => {
  const owner = await browser.newContext({ baseURL: origin }), reviewer = await browser.newContext({ baseURL: origin });
  try {
    await account(owner, "Experiment owner"); const teammate = await account(reviewer, "Experiment reviewer"); const file = await fixture(owner);
    await invite(owner, reviewer, file.workspaceId, teammate.email);
    const main = await owner.newPage(); await open(main, file.id);
    const listing = await owner.newPage(); await listing.goto(`/files/${file.id}/branches`);
    await listing.getByLabel("Experiment name").fill("A revised budget");
    await listing.getByRole("button", { name: "Create experiment", exact: true }).click();
    await expect(listing).toHaveURL(new RegExp(`/files/${file.id}/branches/[^/]+$`));
    const branchId = listing.url().split("/").at(-1)!;
    await expect(listing.locator(".save-status")).toHaveText("Saved");
    await change(listing, "budget", "Budget proposed in the experiment.");
    await expect(main.getByRole("textbox", { name: "Document content" })).not.toContainText("Budget proposed");
    await change(main, "intro", "Introduction changed only on main.");
    const preview = await compare(owner, file.id, branchId);
    expect(preview.conflicts).toEqual([]); expect(JSON.stringify(preview.result)).toContain("Introduction changed only on main");
    expect((await approve(owner, file.id, branchId, preview)).status()).toBe(403);
    const review = await reviewer.newPage(); await review.goto(`/files/${file.id}/branches/${branchId}/review`);
    await review.getByRole("button", { name: "Preview merged result", exact: true }).click();
    const historical = review.getByRole("textbox", { name: "Review document content" });
    await expect(historical).toHaveAttribute("contenteditable", "false"); await expect(historical).toContainText("Budget proposed in the experiment");
    await review.getByRole("button", { name: "Close dialog" }).click();
    await review.setViewportSize({ width: 390, height: 844 });
    expect(await review.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await review.screenshot({ path: testInfo.outputPath("merge-review-mobile.png"), fullPage: true });
    await review.getByRole("button", { name: "Approve reviewed result", exact: true }).click();
    const finalize = review.getByRole("button", { name: "Finalize approved merge", exact: true }); await expect(finalize).toBeEnabled();
    await finalize.click(); await expect(review.getByRole("dialog")).toContainText("exact result approved");
    await review.getByRole("button", { name: "Confirm approved merge", exact: true }).click();
    await expect(review).toHaveURL(new RegExp(`/files/${file.id}$`));
    await expect(main.getByRole("textbox", { name: "Document content" })).toContainText("Budget proposed in the experiment");
    await expect(main.getByRole("textbox", { name: "Document content" })).toContainText("Introduction changed only on main");
    await expect(main.locator(".save-status")).toHaveText("Saved");
    expect((await (await owner.request.get(`/api/files/${file.id}/history-head`)).json()).generation).toBe(preview.mainHead.generation);
    const history = await db.checkpoint.findMany({ where: { fileId: file.id }, orderBy: { createdAt: "desc" } });
    expect(history.map(moment => moment.kind).sort()).toEqual(["BEFORE_MERGE", "MANUAL", "MERGE", "MERGED_EXPERIMENT"].sort());
    const preserved = history.find(moment => moment.kind === "BEFORE_MERGE")!;
    const preservedContent = await storage.get(preserved.objectKey, preserved.checksum);
    expect(JSON.stringify(preservedContent.content)).toContain("Introduction changed only on main");
    expect(JSON.stringify(preservedContent.content)).toContain("Original budget");
    await expect(listing.getByRole("textbox", { name: "Document content" })).toHaveAttribute("contenteditable", "false");
    await expect(listing.getByRole("link", { name: "Review merge", exact: true })).toHaveCount(0);
    await expect(listing.getByRole("button", { name: "Save checkpoint", exact: true })).toHaveCount(0);
    const archived = await db.branch.findUniqueOrThrow({ where: { id: branchId } }); expect(archived.archivedAt).not.toBeNull();
    expect(await db.mergeApproval.count({ where: { branchId, supersededAt: null } })).toBe(0);
  } finally { await owner.close(); await reviewer.close(); }
});

test("splitting a wrapped experiment paragraph keeps the base identity and merges its addition with a main-only edit", async ({ browser }) => {
  const owner = await browser.newContext({ baseURL: origin });
  try {
    await account(owner, "Paragraph split owner");
    const original = "Original introduction with enough words to wrap across several lines. ".repeat(4).trim();
    const file = await fixture(owner, { type: "doc", content: [paragraph("intro", original)] });
    const branch = await fork(owner, file.id, file.base.id);
    const main = await owner.newPage(), source = await owner.newPage();
    await source.setViewportSize({ width: 390, height: 844 });
    await open(main, file.id); await open(source, file.id, branch.id);
    const editor = source.getByRole("textbox", { name: "Document content" }), blocks = editor.locator(":scope > p");
    await expect(blocks).toHaveText([original]);
    await editor.click(); await source.keyboard.press("ControlOrMeta+End"); await source.keyboard.press("Enter");
    await expect(blocks).toHaveText([original, ""]);
    await expect(blocks.first()).toHaveAttribute("data-block-id", "intro");
    await source.keyboard.insertText("A separately added experiment conclusion.");
    await expect(blocks).toHaveText([original, "A separately added experiment conclusion."]);
    const addedId = await blocks.last().getAttribute("data-block-id");
    expect(addedId).toBeTruthy(); expect(addedId).not.toBe("intro");
    await expect(source.locator(".save-status")).toHaveText("Saved");
    await change(main, "intro", `${original} Main-only note.`);
    const preview = await compare(owner, file.id, branch.id);
    expect(preview.experiment.content).toEqual([paragraph("intro", original), paragraph(addedId!, "A separately added experiment conclusion.")]);
    expect(preview.conflicts).toEqual([]); expect(preview.orderConflict).toBe(false);
    expect(preview.result?.content).toEqual([paragraph("intro", `${original} Main-only note.`), paragraph(addedId!, "A separately added experiment conclusion.")]);
  } finally { await owner.close(); }
});

test("stale review heads, newer edits, revoked reviewers, and concurrent finalizations are fenced", async ({ browser }) => {
  const owner = await browser.newContext({ baseURL: origin }), reviewer = await browser.newContext({ baseURL: origin });
  try {
    await account(owner, "Fenced owner"); const teammate = await account(reviewer, "Fenced reviewer"); const file = await fixture(owner);
    await invite(owner, reviewer, file.workspaceId, teammate.email); const branch = await fork(owner, file.id, file.base.id);
    const main = await owner.newPage(), source = await owner.newPage(); await open(main, file.id); await open(source, file.id, branch.id);
    const stale = await compare(reviewer, file.id, branch.id); await change(source, "budget", "A later experiment budget.");
    expect((await approve(reviewer, file.id, branch.id, stale)).status()).toBe(409);
    const preview = await compare(reviewer, file.id, branch.id), requestId = randomUUID();
    const response = await approve(reviewer, file.id, branch.id, preview, {}, requestId); expect(response.ok(), await response.text()).toBe(true);
    const approval = await response.json() as MergeApprovalSummary;
    expect((await (await approve(reviewer, file.id, branch.id, preview, {}, requestId)).json()).id).toBe(approval.id);
    await change(main, "intro", "Changed main after approval.");
    expect((await merge(owner, file.id, branch.id, approval.id)).status()).toBe(409);
    const next = await compare(reviewer, file.id, branch.id); const newResponse = await approve(reviewer, file.id, branch.id, next); expect(newResponse.ok(), await newResponse.text()).toBe(true);
    const secondApproval = await newResponse.json() as MergeApprovalSummary;
    expect((await owner.request.get(`/api/files/${file.id}/branches/${branch.id}/approvals/${approval.id}`)).status()).toBe(404);
    expect((await merge(owner, file.id, branch.id, approval.id)).status()).toBe(409);
    const removed = await owner.request.delete(`/api/workspaces/${file.workspaceId}/members/${teammate.id}`, { headers: { origin } }); expect(removed.ok(), await removed.text()).toBe(true);
    expect((await merge(owner, file.id, branch.id, secondApproval.id)).status()).toBe(409);
    await invite(owner, reviewer, file.workspaceId, teammate.email);
    expect((await merge(owner, file.id, branch.id, secondApproval.id)).status()).toBe(409);
    const renewedResponse = await approve(reviewer, file.id, branch.id, await compare(reviewer, file.id, branch.id));
    expect(renewedResponse.ok(), await renewedResponse.text()).toBe(true); const renewed = await renewedResponse.json() as MergeApprovalSummary;
    const responses = await Promise.all([merge(owner, file.id, branch.id, renewed.id), merge(owner, file.id, branch.id, renewed.id)]);
    expect(responses.map(response => response.status()).sort()).toEqual([201, 409]);
    expect(await db.checkpoint.count({ where: { fileId: file.id, kind: "MERGE" } })).toBe(1);
    const success = responses.find(response => response.ok())!; const result = await success.json() as MergeResult;
    const stored = await db.checkpoint.findUniqueOrThrow({ where: { id: result.checkpoint.id } });
    // A retry of the winning action gets its one committed result, even archived.
    const idempotent = await merge(owner, file.id, branch.id, renewed.id, stored.requestId!);
    expect(idempotent.ok(), await idempotent.text()).toBe(true); expect((await idempotent.json()).checkpoint.id).toBe(stored.id);
  } finally { await owner.close(); await reviewer.close(); }
});

test("conflict choices bind the approved result, not later UI choices; archived offline drafts never replay", async ({ browser }) => {
  const owner = await browser.newContext({ baseURL: origin }), reviewer = await browser.newContext({ baseURL: origin }), offlineContext = await browser.newContext({ baseURL: origin });
  try {
    await account(owner, "Conflict owner"); const teammate = await account(reviewer, "Conflict reviewer"), editor = await account(offlineContext, "Offline experiment editor"); const file = await fixture(owner);
    await invite(owner, reviewer, file.workspaceId, teammate.email); await invite(owner, offlineContext, file.workspaceId, editor.email, "EDITOR");
    const branch = await fork(owner, file.id, file.base.id); const main = await owner.newPage(), source = await owner.newPage();
    await open(main, file.id); await open(source, file.id, branch.id);
    await change(main, "intro", "Main competing introduction."); await change(source, "intro", "Experiment competing introduction.");
    const offline = await offlineContext.newPage(); await open(offline, file.id, branch.id); await offlineContext.setOffline(true);
    await fillBlock(offline, "budget", "Never-sent offline experiment note.");
    await expect(offline.getByText("Browser backup saved — shared save is still pending.", { exact: true })).toBeVisible();
    const review = await reviewer.newPage(); await review.goto(`/files/${file.id}/branches/${branch.id}/review`);
    await expect(review.getByRole("button", { name: "Approve reviewed result", exact: true })).toBeDisabled();
    await review.getByLabel("Use experiment", { exact: true }).check();
    await review.getByRole("button", { name: "Approve reviewed result", exact: true }).click();
    const finalize = review.getByRole("button", { name: "Finalize approved merge", exact: true }); await expect(finalize).toBeEnabled();
    await review.getByLabel("Keep main", { exact: true }).check();
    await finalize.click(); await expect(review.getByRole("dialog").getByRole("textbox", { name: "Review document content" })).toContainText("Experiment competing introduction");
    await review.getByRole("button", { name: "Confirm approved merge", exact: true }).click();
    await expect(main.getByRole("textbox", { name: "Document content" })).toContainText("Experiment competing introduction");
    await offlineContext.setOffline(false);
    await expect(offline.getByRole("button", { name: "Download local draft", exact: true })).toBeVisible();
    await expect(offline.getByRole("textbox", { name: "Document content" })).toContainText("Never-sent offline");
    await expect(offline.getByRole("textbox", { name: "Document content" })).toHaveAttribute("contenteditable", "false");
    offline.once("dialog", dialog => dialog.accept()); await offline.reload();
    await expect(offline.getByRole("textbox", { name: "Document content" })).not.toContainText("Never-sent offline");
    await expect(offline.getByRole("button", { name: /^Review browser draft/ })).toBeVisible();
    await offline.getByRole("button", { name: /^Review browser draft/ }).click();
    await expect(offline.getByRole("button", { name: "Resume browser draft", exact: true })).toHaveCount(0);
    const recovered = new Y.Doc(); const state = await db.documentState.findUniqueOrThrow({ where: { branchId: branch.id } }); Y.applyUpdate(recovered, state.state);
    expect(JSON.stringify(contentFromYDoc(recovered))).not.toContain("Never-sent offline"); recovered.destroy();
  } finally { await owner.close(); await reviewer.close(); await offlineContext.close(); }
});

test("branch permissions, scoped tokens, request identity, and damaged bases/results fail closed", async ({ browser }) => {
  const owner = await browser.newContext({ baseURL: origin }), viewer = await browser.newContext({ baseURL: origin }), reviewer = await browser.newContext({ baseURL: origin }), outsider = await browser.newContext({ baseURL: origin });
  try {
    await account(owner, "Branch access owner"); const reader = await account(viewer, "Branch viewer"), teammate = await account(reviewer, "Branch reviewer"); await account(outsider, "Branch outsider");
    const file = await fixture(owner); await invite(owner, viewer, file.workspaceId, reader.email, "VIEWER"); await invite(owner, reviewer, file.workspaceId, teammate.email);
    const requestId = randomUUID(); const branch = await fork(owner, file.id, file.base.id, "Private experiment", requestId);
    expect((await fork(owner, file.id, file.base.id, "Private experiment", requestId)).id).toBe(branch.id);
    expect((await owner.request.post(`/api/files/${file.id}/branches`, { headers: { origin }, data: { checkpointId: file.base.id, name: "Changed request", requestId } })).status()).toBe(409);
    expect((await viewer.request.post(`/api/files/${file.id}/branches`, { headers: { origin }, data: { checkpointId: file.base.id, name: "Forbidden", requestId: randomUUID() } })).status()).toBe(403);
    expect((await outsider.request.get(`/api/files/${file.id}/branches/${branch.id}/compare`)).status()).toBe(404);
    expect((await outsider.request.post(`/api/files/${file.id}/collaboration-token?branchId=${branch.id}`, { headers: { origin } })).status()).toBe(404);
    const preview = await compare(viewer, file.id, branch.id); expect((await approve(viewer, file.id, branch.id, preview)).status()).toBe(403);
    const view = await viewer.newPage(); await open(view, file.id, branch.id); await expect(view.getByRole("textbox", { name: "Document content" })).toHaveAttribute("contenteditable", "false");
    const scoped = await (await owner.request.post(`/api/files/${file.id}/collaboration-token?branchId=${branch.id}`, { headers: { origin } })).json();
    expect((await owner.request.post("http://localhost:1234/internal/branches", { headers: { authorization: `Bearer ${scoped.token}` } })).status()).toBe(401);
    await db.checkpoint.update({ where: { id: file.base.id }, data: { schemaVersion: 99 } });
    expect((await owner.request.get(`/api/files/${file.id}/branches/${branch.id}/compare`)).status()).toBe(409);
    expect((await owner.request.post(`/api/files/${file.id}/branches`, { headers: { origin }, data: { checkpointId: file.base.id, name: "Damaged base", requestId: randomUUID() } })).status()).toBe(409);
    await db.checkpoint.update({ where: { id: file.base.id }, data: { schemaVersion: 1 } });
    const response = await approve(reviewer, file.id, branch.id, preview); expect(response.ok(), await response.text()).toBe(true); const approval = await response.json() as MergeApprovalSummary;
    await db.mergeApproval.update({ where: { id: approval.id }, data: { resultHash: "0".repeat(64) } });
    expect((await owner.request.get(`/api/files/${file.id}/branches/${branch.id}/approvals/${approval.id}`)).status()).toBe(503);
    expect((await merge(owner, file.id, branch.id, approval.id)).status()).toBe(409);
    expect(await db.checkpoint.count({ where: { fileId: file.id, kind: "MERGE" } })).toBe(0);
  } finally { await owner.close(); await viewer.close(); await reviewer.close(); await outsider.close(); }
});
