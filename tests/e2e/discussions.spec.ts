import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { config } from "dotenv";
import { test, expect, type BrowserContext } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";
import { blockIdentities, yDocFromContent } from "@flux/document-model";
import { SnapshotStorage } from "@flux/storage";
import type { CheckpointDetail, DecisionBookmark, DecisionPage, DiscussionPage, FileDetail } from "@flux/shared";

config({ path: resolve(process.cwd(), ".env"), quiet: true });
const origin = "http://localhost:3000", db = new PrismaClient(), storage = new SnapshotStorage();
const users: string[] = [], workspaces: string[] = [];
async function account(context: BrowserContext, name: string) {
  const email = `${name.toLowerCase().replace(/\s/g, "-")}-${randomUUID()}@flux.test`;
  const response = await context.request.post("/api/auth/register", { headers: { origin }, data: { name, email, password: "a secure decision test password" } });
  expect(response.ok(), await response.text()).toBe(true); const user = await response.json(); users.push(user.id); return { ...user, email };
}
async function fixture(context: BrowserContext) {
  const workspace = await (await context.request.post("/api/workspaces", { headers: { origin }, data: { name: `Discussion test ${randomUUID().slice(0, 8)}` } })).json(); workspaces.push(workspace.id);
  const created = await context.request.post(`/api/workspaces/${workspace.id}/files`, { headers: { origin }, data: { name: "Decision proposal" } }); expect(created.ok(), await created.text()).toBe(true);
  const file = await (await context.request.get(`/api/files/${(await created.json()).id}`)).json() as FileDetail;
  const page = await context.newPage(); await page.goto(`/files/${file.id}`);
  const editor = page.getByRole("textbox", { name: "Document content" }); await expect(editor).toBeVisible(); await editor.fill("The budget is 50,000.");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  const saved = await context.request.post(`/api/files/${file.id}/checkpoints`, { headers: { origin }, data: { title: "Budget proposal", requestId: randomUUID() } }); expect(saved.ok(), await saved.text()).toBe(true);
  const checkpoint = await (await context.request.get(`/api/files/${file.id}/checkpoints/${(await saved.json()).id}`)).json() as CheckpointDetail;
  return { file, page, checkpoint, blockId: String(checkpoint.content.content![0].attrs!.blockId), prefix: `/api/files/${file.id}/branches/${file.mainBranchId}` };
}
async function invite(owner: BrowserContext, member: BrowserContext, workspaceId: string, email: string, role = "REVIEWER") {
  const response = await owner.request.post(`/api/workspaces/${workspaceId}/invitations`, { headers: { origin }, data: { email, role } }); expect(response.ok(), await response.text()).toBe(true);
  const { url } = await response.json(); expect((await member.request.post(`/api/invitations/${url.split("/").at(-1)}/accept`, { headers: { origin } })).ok()).toBe(true);
}
const decisionBody = (checkpointId: string, blockId: string, extra = {}) => ({ title: "Keep the smaller budget", explanation: "We agreed this is enough for the prototype.", checkpointId, blockId, requestId: randomUUID(), ...extra });
test.afterAll(async () => {
  const objects = await db.checkpoint.findMany({ where: { file: { workspaceId: { in: workspaces } } }, select: { objectKey: true } });
  if (objects.length) await storage.client.send(new DeleteObjectsCommand({ Bucket: storage.bucket, Delete: { Objects: objects.map(object => ({ Key: object.objectKey })) } }));
  await db.workspace.deleteMany({ where: { id: { in: workspaces } } }); await db.user.deleteMany({ where: { id: { in: users } } }); await db.$disconnect(); storage.client.destroy();
});

test("saved discussion and linked Decision Bookmarks survive reopen, stay read-only in context, and fit night/mobile layouts", async ({ browser }, testInfo) => {
  const owner = await browser.newContext({ baseURL: origin }), reviewer = await browser.newContext({ baseURL: origin });
  try {
    await account(owner, "Discussion owner"); const teammate = await account(reviewer, "Discussion reviewer"); const { file, page, prefix } = await fixture(owner);
    await invite(owner, reviewer, file.workspaceId, teammate.email);
    await page.getByRole("link", { name: "Discussion & decisions", exact: true }).click();
    await page.getByLabel("Your message").fill("Let's use the smaller budget for our prototype."); await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.getByRole("list", { name: "Saved messages" })).toContainText("smaller budget");
    const other = await reviewer.newPage(); await other.goto(`/files/${file.id}/discuss`); await expect(other.getByRole("list", { name: "Saved messages" })).toContainText("smaller budget");
    await other.getByLabel("Your message").fill("Agreed. We can revisit it after testing."); await other.getByRole("button", { name: "Send message", exact: true }).click();
    await page.getByRole("button", { name: "New Decision Bookmark", exact: true }).click();
    await page.getByLabel("Decision title").fill("Keep the smaller budget"); await page.getByLabel("Explanation", { exact: true }).fill("We agreed this is enough for the prototype.");
    const messages = await (await owner.request.get(`${prefix}/messages`)).json() as DiscussionPage;
    await page.getByLabel("Linked discussion (optional)").selectOption(messages.messages[0].id);
    await page.getByRole("button", { name: "Save Decision Bookmark", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Keep the smaller budget", exact: true })).toBeVisible();
    await page.getByLabel("Status for Keep the smaller budget").selectOption("DECIDED");
    await expect(page.locator(".decision-status")).toHaveText("Decided");
    await page.reload(); await expect(page.locator(".decision-status")).toHaveText("Decided"); await expect(page.getByRole("list", { name: "Saved messages" })).toContainText("after testing");
    await page.getByRole("button", { name: "View saved context", exact: true }).click();
    const historical = page.getByRole("textbox", { name: "Decision checkpoint content" }); await expect(historical).toContainText("50,000"); await expect(historical).toHaveAttribute("contenteditable", "false");
    await expect(historical.locator(".decision-anchor-highlight")).toHaveCount(1);
    await page.getByRole("button", { name: "Close dialog", exact: true }).click();
    await page.emulateMedia({ reducedMotion: "reduce" }); await page.getByRole("switch", { name: "Night mode" }).check(); await page.setViewportSize({ width: 320, height: 740 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("discussion-night-mobile.png"), fullPage: true });
    await page.getByRole("button", { name: "View saved context", exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await owner.close(); await reviewer.close(); }
});

test("lost send responses keep the draft and retries cannot duplicate messages; concurrent sends and moderation are serialized", async ({ browser }) => {
  const owner = await browser.newContext({ baseURL: origin });
  try {
    await account(owner, "Send owner"); const { file, page, prefix } = await fixture(owner); await page.goto(`/files/${file.id}/discuss`);
    let lost = false;
    await page.route(`**${prefix}/messages`, async route => {
      if (route.request().method() === "POST" && !lost) { lost = true; const response = await route.fetch(); expect(response.ok()).toBe(true); await route.abort("failed"); }
      else await route.continue();
    });
    await page.getByLabel("Your message").fill("Only one committed reply."); await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "unsent message is still here" })).toBeVisible(); await expect(page.getByLabel("Your message")).toHaveValue("Only one committed reply.");
    page.once("dialog", dialog => dialog.dismiss()); await page.getByRole("link", { name: "Back to document", exact: true }).click();
    await expect(page).toHaveURL(`/files/${file.id}/discuss`); await expect(page.getByLabel("Your message")).toHaveValue("Only one committed reply.");
    await page.getByRole("button", { name: "Send message", exact: true }).click(); await expect(page.getByLabel("Your message")).toHaveValue("");
    expect(await db.discussionMessage.count({ where: { branchId: file.mainBranchId } })).toBe(1);
    const data = { body: "One retry identity", requestId: randomUUID() };
    const duplicate = await Promise.all([1, 2].map(() => owner.request.post(`${prefix}/messages`, { headers: { origin }, data })));
    expect(duplicate.every(response => response.ok())).toBe(true); expect((await duplicate[0].json()).id).toBe((await duplicate[1].json()).id);
    expect((await owner.request.post(`${prefix}/messages`, { headers: { origin }, data: { ...data, body: "Different text" } })).status()).toBe(409);
    const simultaneous = await Promise.all(["First", "Second", "Third"].map(body => owner.request.post(`${prefix}/messages`, { headers: { origin }, data: { body, requestId: randomUUID() } })));
    expect(simultaneous.every(response => response.ok())).toBe(true);
    const numbers = await Promise.all(simultaneous.map(async response => (await response.json()).number)); expect(new Set(numbers).size).toBe(3);
    const message = (await (await owner.request.get(`${prefix}/messages?limit=1`)).json() as DiscussionPage).messages[0];
    const removals = await Promise.all([1, 2].map(() => owner.request.delete(`${prefix}/messages/${message.id}`, { headers: { origin } }))); expect(removals.every(response => response.ok())).toBe(true);
    const branch = await db.branch.findUniqueOrThrow({ where: { id: file.mainBranchId } });
    const stored = await db.discussionMessage.aggregate({ where: { branchId: branch.id }, _sum: { byteLength: true } }); expect(branch.discussionBytes).toBe(stored._sum.byteLength);
    expect(await db.activityEvent.count({ where: { fileId: file.id, type: "DISCUSSION_MESSAGE_REMOVED" } })).toBe(1);
    const latest = await (await owner.request.get(`${prefix}/messages?limit=2`)).json() as DiscussionPage; expect(latest.hasOlder).toBe(true);
    const previous = await (await owner.request.get(`${prefix}/messages?limit=2&before=${latest.messages[0].number}`)).json() as DiscussionPage;
    expect(previous.messages.every(message => message.number < latest.messages[0].number)).toBe(true);
  } finally { await owner.close(); }
});

test("deleting and recreating a block with its old ID never reattaches a decision; removing discussion text retains the bookmark", async ({ browser }) => {
  const owner = await browser.newContext({ baseURL: origin }); let provider: HocuspocusProvider | undefined; const document = new Y.Doc();
  try {
    await account(owner, "Anchor owner"); const { file, page, prefix, checkpoint, blockId } = await fixture(owner);
    const sent = await owner.request.post(`${prefix}/messages`, { headers: { origin }, data: { body: "Why this budget?", requestId: randomUUID() } }); const message = await sent.json();
    const data = decisionBody(checkpoint.id, blockId, { discussionMessageId: message.id });
    const created = await owner.request.post(`${prefix}/decisions`, { headers: { origin }, data }); expect(created.ok(), await created.text()).toBe(true); const bookmark = await created.json() as DecisionBookmark; expect(bookmark.anchorAvailable).toBe(true);
    expect((await (await owner.request.post(`${prefix}/decisions`, { headers: { origin }, data })).json()).id).toBe(bookmark.id);
    const credential = await (await owner.request.post(`/api/files/${file.id}/collaboration-token`, { headers: { origin } })).json();
    await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error("Anchor test did not sync")), 15_000); provider = new HocuspocusProvider({ url: "ws://localhost:1234", document, name: credential.room, token: credential.token,
      onSynced() { clearTimeout(timer); resolve(); }, onAuthenticationFailed() { clearTimeout(timer); reject(new Error("Anchor test denied")); } }); });
    document.transact(() => {
      const fragment = document.getXmlFragment("default"), replacement = new Y.XmlElement("paragraph"), text = new Y.XmlText();
      replacement.setAttribute("blockId", blockId); text.insert(0, "Unrelated recreated content."); replacement.insert(0, [text]); fragment.delete(0, 1); fragment.insert(0, [replacement]);
    });
    await new Promise<void>((resolve, reject) => { const requestId = randomUUID(), timer = setTimeout(() => reject(new Error("Anchor update was not saved")), 15_000); provider!.on("stateless", ({ payload }: { payload: string }) => { const message = JSON.parse(payload); if (message.type === "saved" && message.requestId === requestId) { clearTimeout(timer); resolve(); } }); provider!.sendStateless(JSON.stringify({ type: "flush", requestId })); });
    const decisions = await (await owner.request.get(`${prefix}/decisions`)).json() as DecisionPage; expect(decisions.bookmarks[0].anchorAvailable).toBe(false);
    expect((await db.decisionBookmark.findUniqueOrThrow({ where: { id: bookmark.id } })).unavailableAt).not.toBeNull();
    await owner.request.delete(`${prefix}/messages/${message.id}`, { headers: { origin } });
    await page.goto(`/files/${file.id}/discuss`); await expect(page.locator(".decision-anchor-state")).toContainText("Anchor unavailable"); await expect(page.getByRole("list", { name: "Saved messages" })).toContainText("Message removed");
    await page.getByRole("button", { name: "View saved context", exact: true }).click(); await expect(page.getByRole("textbox", { name: "Decision checkpoint content" })).toContainText("50,000");
    expect((await db.decisionBookmark.findUniqueOrThrow({ where: { id: bookmark.id } })).discussionMessageId).toBe(message.id);
  } finally { provider?.destroy(); document.destroy(); await owner.close(); }
});

test("discussion permissions, tenant boundaries, deleted references, status races, and limits fail closed", async ({ browser }) => {
  const owner = await browser.newContext({ baseURL: origin }), viewer = await browser.newContext({ baseURL: origin }), editor = await browser.newContext({ baseURL: origin }), outsider = await browser.newContext({ baseURL: origin });
  try {
    await account(owner, "Policy owner"); const reader = await account(viewer, "Policy viewer"), participant = await account(editor, "Policy editor"); await account(outsider, "Policy outsider");
    const { file, prefix, checkpoint, blockId } = await fixture(owner); await invite(owner, viewer, file.workspaceId, reader.email, "VIEWER"); await invite(owner, editor, file.workspaceId, participant.email, "EDITOR");
    expect((await viewer.request.get(`${prefix}/messages`)).ok()).toBe(true);
    expect((await viewer.request.post(`${prefix}/messages`, { headers: { origin }, data: { body: "Forbidden", requestId: randomUUID() } })).status()).toBe(403);
    expect((await viewer.request.post(`${prefix}/decisions`, { headers: { origin }, data: decisionBody(checkpoint.id, blockId) })).status()).toBe(403);
    expect((await outsider.request.get(`${prefix}/messages`)).status()).toBe(404); expect((await outsider.request.get(`${prefix}/decisions`)).status()).toBe(404);
    const messageResponse = await owner.request.post(`${prefix}/messages`, { headers: { origin }, data: { body: '<script>throw "untrusted"</script>', requestId: randomUUID() } }); const message = await messageResponse.json();
    expect((await editor.request.delete(`${prefix}/messages/${message.id}`, { headers: { origin } })).status()).toBe(403);
    const created = await owner.request.post(`${prefix}/decisions`, { headers: { origin }, data: decisionBody(checkpoint.id, blockId) }); expect(created.ok(), await created.text()).toBe(true); const bookmark = await created.json();
    expect((await editor.request.patch(`${prefix}/decisions/${bookmark.id}`, { headers: { origin }, data: { status: "DECIDED", expectedStatus: "OPEN" } })).status()).toBe(403);
    const races = await Promise.all(["DECIDED", "SUPERSEDED"].map(status => owner.request.patch(`${prefix}/decisions/${bookmark.id}`, { headers: { origin }, data: { status, expectedStatus: "OPEN" } }))); expect(races.map(response => response.status()).sort()).toEqual([200, 409]);
    expect((await owner.request.post(`${prefix}/decisions`, { headers: { origin }, data: decisionBody(checkpoint.id, "missing") })).status()).toBe(404);
    const other = await fixture(outsider); expect((await owner.request.post(`${prefix}/decisions`, { headers: { origin }, data: decisionBody(other.checkpoint.id, blockId) })).status()).toBe(404);
    const viewerPage = await viewer.newPage(); await viewerPage.goto(`/files/${file.id}/discuss`); await expect(viewerPage.getByRole("list", { name: "Saved messages" })).toContainText('<script>throw "untrusted"</script>');
    await expect(viewerPage.getByLabel("Your message")).toHaveCount(0); expect(await viewerPage.locator(".discussion-messages script").count()).toBe(0);
    const removed = await owner.request.delete(`/api/workspaces/${file.workspaceId}/members/${reader.id}`, { headers: { origin } }); expect(removed.ok()).toBe(true);
    await expect(viewerPage.getByRole("list", { name: "Saved messages" })).not.toContainText("untrusted");
    await db.branch.update({ where: { id: file.mainBranchId }, data: { discussionSequence: 10_000, decisionSequence: 500 } });
    expect((await owner.request.post(`${prefix}/messages`, { headers: { origin }, data: { body: "Over limit", requestId: randomUUID() } })).status()).toBe(403);
    expect((await owner.request.post(`${prefix}/decisions`, { headers: { origin }, data: decisionBody(checkpoint.id, blockId) })).status()).toBe(403);
  } finally { await owner.close(); await viewer.close(); await editor.close(); await outsider.close(); }
});

test("experiment checkpoints and discussions remain branch-scoped, then archive together after merge", async ({ browser }) => {
  const owner = await browser.newContext({ baseURL: origin }), reviewer = await browser.newContext({ baseURL: origin });
  try {
    await account(owner, "Scope owner"); const teammate = await account(reviewer, "Scope reviewer"); const { file, page, prefix, checkpoint, blockId } = await fixture(owner); await invite(owner, reviewer, file.workspaceId, teammate.email);
    const mainDecision = await owner.request.post(`${prefix}/decisions`, { headers: { origin }, data: decisionBody(checkpoint.id, blockId) }); expect(mainDecision.ok()).toBe(true);
    const forked = await owner.request.post(`/api/files/${file.id}/branches`, { headers: { origin }, data: { checkpointId: checkpoint.id, name: "Budget experiment", requestId: randomUUID() } }); expect(forked.ok(), await forked.text()).toBe(true); const branch = await forked.json();
    const branchPrefix = `/api/files/${file.id}/branches/${branch.id}`;
    await page.goto(`/files/${file.id}/branches/${branch.id}`); await expect(page.locator(".save-status")).toHaveText("Saved");
    await page.getByRole("button", { name: "Save checkpoint", exact: true }).click(); await page.getByLabel("Checkpoint name").fill("Experiment decision context"); await page.getByRole("dialog").getByRole("button", { name: "Save checkpoint", exact: true }).click();
    await expect(page.locator(".checkpoint-notice")).toContainText("Experiment decision context");
    const moments = await (await owner.request.get(`/api/files/${file.id}/checkpoints?branchId=${branch.id}`)).json(); expect(moments.checkpoints).toHaveLength(1);
    expect((await owner.request.post(`${branchPrefix}/decisions`, { headers: { origin }, data: decisionBody(checkpoint.id, blockId) })).status()).toBe(404);
    const sent = await owner.request.post(`${branchPrefix}/messages`, { headers: { origin }, data: { body: "Only in this experiment", requestId: randomUUID() } }); expect(sent.ok()).toBe(true);
    expect((await (await owner.request.get(`${prefix}/messages`)).json()).messages).toHaveLength(0);
    const decision = await owner.request.post(`${branchPrefix}/decisions`, { headers: { origin }, data: decisionBody(moments.checkpoints[0].id, blockId) }); expect(decision.ok(), await decision.text()).toBe(true);
    const preview = await (await reviewer.request.get(`${branchPrefix}/compare`)).json();
    const approved = await reviewer.request.post(`${branchPrefix}/approvals`, { headers: { origin }, data: { requestId: randomUUID(), mainHead: preview.mainHead, sourceHead: preview.sourceHead, resolutions: {} } }); expect(approved.ok(), await approved.text()).toBe(true);
    const merged = await owner.request.post(`${branchPrefix}/merge`, { headers: { origin }, data: { requestId: randomUUID(), approvalId: (await approved.json()).id } }); expect(merged.ok(), await merged.text()).toBe(true);
    expect((await owner.request.post(`${branchPrefix}/messages`, { headers: { origin }, data: { body: "After archive", requestId: randomUUID() } })).status()).toBe(409);
    expect((await (await owner.request.get(`${branchPrefix}/decisions`)).json()).bookmarks[0].anchorAvailable).toBe(true);
    expect((await owner.request.post(`/api/files/${file.id}/checkpoints`, { headers: { origin }, data: { branchId: branch.id, title: "Archived", requestId: randomUUID() } })).status()).toBe(409);
    const head = await (await owner.request.get(`/api/files/${file.id}/history-head`)).json();
    const restored = await owner.request.post(`/api/files/${file.id}/checkpoints/${checkpoint.id}/restore`, { headers: { origin }, data: { requestId: randomUUID(), expectedGeneration: head.generation, expectedRevision: head.revision, expectedContentHash: head.contentHash } }); expect(restored.ok(), await restored.text()).toBe(true);
    expect((await (await owner.request.get(`${prefix}/decisions`)).json()).bookmarks[0].anchorAvailable).toBe(false);
    // The independent experiment's saved anchor is unaffected by a main restore.
    expect((await (await owner.request.get(`${branchPrefix}/decisions`)).json()).bookmarks[0].anchorAvailable).toBe(true);
  } finally { await owner.close(); await reviewer.close(); }
});

test("older linked messages are reachable, bookmark pagination is stable, and integrity/workspace quotas fail closed", async ({ browser }) => {
  const owner = await browser.newContext({ baseURL: origin });
  try {
    const user = await account(owner, "Pagination owner"); const { file, page, prefix, checkpoint, blockId } = await fixture(owner);
    const sent = await owner.request.post(`${prefix}/messages`, { headers: { origin }, data: { body: "The original reason on an earlier page.", requestId: randomUUID() } }); expect(sent.ok()).toBe(true); const message = await sent.json();
    const data = decisionBody(checkpoint.id, blockId, { discussionMessageId: message.id, title: "Original decision" });
    const responses = await Promise.all([1, 2].map(() => owner.request.post(`${prefix}/decisions`, { headers: { origin }, data })));
    expect(responses.every(response => response.ok())).toBe(true); const bookmark = await responses[0].json(); expect((await responses[1].json()).id).toBe(bookmark.id);
    expect((await owner.request.post(`${prefix}/decisions`, { headers: { origin }, data: { ...data, title: "A changed retry" } })).status()).toBe(409);
    // Bounded, explicitly scoped fixtures exercise pagination without hundreds
    // of network mutations or changing unrelated workspace data.
    const bodies = Array.from({ length: 52 }, (_, index) => ({ branchId: file.mainBranchId, number: index + 2, authorId: user.id, authorName: user.name,
      body: `Later message ${index + 2}`, byteLength: Buffer.byteLength(`Later message ${index + 2}`), requestId: randomUUID(), requestHash: "pagination-fixture" }));
    await db.discussionMessage.createMany({ data: bodies });
    const saved = await db.decisionBookmark.findUniqueOrThrow({ where: { id: bookmark.id } });
    await db.decisionBookmark.createMany({ data: Array.from({ length: 50 }, (_, index) => ({ ...saved, id: randomUUID(), number: index + 2,
      title: `Later decision ${index + 2}`, requestId: randomUUID(), requestHash: "pagination-fixture" })) });
    await db.branch.update({ where: { id: file.mainBranchId }, data: { discussionSequence: 53, decisionSequence: 51, discussionBytes: { increment: bodies.reduce((sum, body) => sum + body.byteLength, 0) } } });
    await page.goto(`/files/${file.id}/discuss`); await expect(page.getByRole("heading", { name: "Later decision 51", exact: true })).toBeVisible();
    await expect(page.getByRole("list", { name: "Saved messages" })).not.toContainText("original reason");
    await page.getByRole("button", { name: "Read earlier decisions", exact: true }).click(); await expect(page.getByRole("heading", { name: "Original decision", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Linked discussion", exact: true }).click();
    await expect(page.locator('.discussion-messages > li[data-linked="true"]')).toHaveText(/original reason/);
    await page.getByRole("button", { name: "Return to latest messages", exact: true }).click(); await expect(page.getByRole("list", { name: "Saved messages" })).toContainText("Later message 53");
    const latest = await (await owner.request.get(`${prefix}/decisions?limit=2`)).json() as DecisionPage;
    const earlier = await (await owner.request.get(`${prefix}/decisions?limit=2&before=${latest.nextBefore}`)).json() as DecisionPage;
    expect(latest.bookmarks.map(item => item.number)).toEqual([51, 50]); expect(earlier.bookmarks.map(item => item.number)).toEqual([49, 48]);
    expect((await owner.request.get(`${prefix}/messages?limit=0`)).status()).toBe(400); expect((await owner.request.get(`${prefix}/decisions?limit=51`)).status()).toBe(400);
    expect((await owner.request.post(`${prefix}/decisions`, { headers: { origin }, data: decisionBody(checkpoint.id, blockId, { discussionMessageId: randomUUID() }) })).status()).toBe(404);
    const different = yDocFromContent({ type: "doc", content: [{ type: "paragraph", attrs: { blockId }, content: [{ type: "text", text: "This state is not the saved content." }] }] });
    const corruptId = randomUUID(), key = `${file.workspaceId}/${file.id}/${file.mainBranchId}/${corruptId}.json`;
    const stored = await storage.put(key, { format: "flux.document", schemaVersion: 1, content: checkpoint.content, yjsState: Buffer.from(Y.encodeStateAsUpdate(different)).toString("base64") }); different.destroy();
    await db.checkpoint.create({ data: { id: corruptId, fileId: file.id, branchId: file.mainBranchId, number: 2, title: "Inconsistent fixture", generation: checkpoint.generation,
      revision: checkpoint.revision, schemaVersion: 1, objectKey: key, ...stored, createdById: user.id, createdByName: user.name } });
    expect((await owner.request.post(`${prefix}/decisions`, { headers: { origin }, data: decisionBody(corruptId, blockId) })).status()).toBe(503);
    expect(await db.decisionBookmark.count({ where: { branchId: file.mainBranchId } })).toBe(51);
    await db.branch.update({ where: { id: file.mainBranchId }, data: { discussionBytes: 64 * 1024 * 1024 } });
    expect((await owner.request.post(`${prefix}/messages`, { headers: { origin }, data: { body: "Past workspace bytes", requestId: randomUUID() } })).status()).toBe(403);
    for (const count of [475, 474]) {
      const otherFileResponse = await owner.request.post(`/api/workspaces/${file.workspaceId}/files`, { headers: { origin }, data: { name: `Workspace quota fixture ${count}` } }); expect(otherFileResponse.ok()).toBe(true);
      const otherFile = await (await owner.request.get(`/api/files/${(await otherFileResponse.json()).id}`)).json() as FileDetail;
      const captured = await owner.request.post(`/api/files/${otherFile.id}/checkpoints`, { headers: { origin }, data: { title: "Quota context", requestId: randomUUID() } }); expect(captured.ok()).toBe(true);
      const context = await captured.json();
      const state = await db.documentState.findUniqueOrThrow({ where: { branchId: otherFile.mainBranchId } }), document = new Y.Doc();
      Y.applyUpdate(document, state.state); const [anchorBlock, anchorIdentity] = [...blockIdentities(document)][0]; document.destroy();
      await db.decisionBookmark.createMany({ data: Array.from({ length: count }, (_, index) => ({ ...saved, id: randomUUID(), branchId: otherFile.mainBranchId,
        checkpointId: context.id, blockId: anchorBlock, anchorIdentity, anchorGeneration: state.generation, discussionMessageId: null, number: index + 1,
        requestId: randomUUID(), requestHash: "workspace-quota-fixture" })) });
      await db.branch.update({ where: { id: otherFile.mainBranchId }, data: { decisionSequence: count } });
    }
    expect((await owner.request.post(`${prefix}/decisions`, { headers: { origin }, data: decisionBody(checkpoint.id, blockId) })).status()).toBe(403);
  } finally { await owner.close(); }
});
