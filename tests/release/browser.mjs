import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const origin = "https://flux.example.com:9443";
const directory = process.env.FLUX_SMOKE_DIRECTORY;
const inviteOnly = process.env.FLUX_SMOKE_INVITE_ONLY === "true";
const diagnostics = `${directory}/diagnostics`;
await mkdir(diagnostics, { recursive: true, mode: 0o700 });
const browser = await chromium.launch({ args: ["--no-proxy-server"] });
const violations = [];
const networkFailures = [];
let mergeComparison;
async function newContext() {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: origin });
  context.on("requestfailed", request => networkFailures.push({
    method: request.method(), path: new URL(request.url()).pathname.replace(/[A-Za-z0-9_-]{43}/g, "<token>"),
    error: request.failure()?.errorText,
  }));
  context.on("page", page => {
    page.on("pageerror", error => violations.push(error.message));
    page.on("console", message => { if (message.type() === "error" && /Content Security Policy|Refused to/.test(message.text())) violations.push(message.text()); });
  });
  return context;
}
const context = await newContext();
const page = await context.newPage();

async function request(page, path, body, method = "POST") {
  return page.evaluate(async ({ path, body, method }) => {
    const response = await fetch(`/api${path}`, { method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json().catch(() => null) };
  }, { path, body, method });
}
async function caretAtEnd(block) {
  // Target the actual paragraph, not a coordinate in the editor's empty space.
  // This changes only the browser selection; all edits still use real input.
  await block.evaluate(element => {
    element.closest('[contenteditable="true"]').focus();
    const range = document.createRange(); range.selectNodeContents(element); range.collapse(false);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  });
}
async function authoredTexts(locator) {
  // Caret widgets display collaborator names inside paragraphs but are not part
  // of the authored document. Inspect a clone without changing the live editor.
  return locator.evaluateAll(elements => elements.map(element => {
    const copy = element.cloneNode(true);
    copy.querySelectorAll(".collaboration-carets__caret").forEach(caret => caret.remove());
    return copy.textContent;
  }));
}
async function emailLink(recipient, expression) {
  let link;
  await expect.poll(async () => {
    const messages = await (await fetch(process.env.FLUX_SMOKE_INBOX_URL ?? "http://127.0.0.1:8028/messages")).json();
    for (const message of messages.filter(message => message.to.includes(recipient)).reverse()) {
      const decoded = message.raw.replace(/=\r?\n/g, "").replace(/=([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
      link = decoded.match(expression)?.[0];
      if (link) return true;
    }
    return false;
  }, { timeout: 30_000 }).toBe(true);
  return link;
}
try {
  const response = await page.goto("/login");
  assert.match(response.headers()["content-security-policy"], /nonce-/);
  assert.ok(!response.headers()["content-security-policy"].includes("script-src 'self' 'unsafe-inline'"));
  assert.equal(response.headers()["referrer-policy"], "no-referrer");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  assert.equal((await context.request.post(`${origin}/api/auth/logout`, { headers: { Origin: "https://not-flux.example.com" } })).status(), 403);
  for (const path of ["/internal/history", "/api/internal/history", "/sync/internal/history", "/internal/branches", "/api/internal/branches", "/sync/internal/branches", "/sync/ready"]) assert.equal((await page.evaluate(async path => (await fetch(path)).status, path)), 404);
  if (inviteOnly) assert.equal((await request(page, "/auth/register", { name: "Uninvited", email: "uninvited@example.com" })).status, 403);
  assert.equal((await request(page, "/auth/options", undefined, "GET")).data.inviteOnly, inviteOnly);
  assert.equal((await request(page, "/auth/register", { name: "x".repeat(70_000), email: "large@example.com" })).status, 413);
  assert.equal((await page.evaluate(async () => (await fetch("/api/workspaces", { method: "POST", headers: { "Content-Type": "application/json" }, body: "not json" })).status)), 400);
  if (inviteOnly) {
    const invite = await emailLink("owner@example.com", /https:\/\/flux\.example\.com:9443\/login\?invitation=[A-Za-z0-9_-]{43}/);
    const invitationToken = new URL(invite).searchParams.get("invitation");
    assert.equal((await request(page, "/auth/register", { name: "Wrong email", email: "wrong@example.com", invitationToken })).status, 403);
    await page.goto(invite);
  }
  await page.getByRole("button", { name: "Create an account", exact: true }).click();
  if (!inviteOnly) await expect(page.getByText("Enter your email. Verify it, then choose your password.", { exact: true })).toBeVisible();
  await page.getByLabel("Your name").fill("Release owner");
  await page.getByLabel("Email address").fill("owner@example.com");
  await page.getByRole("button", { name: "Verify and create account", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("a link will arrive");
  assert.equal((await request(page, "/auth/me", undefined, "GET")).status, 401);
  const verify = await emailLink("owner@example.com", /https:\/\/flux\.example\.com:9443\/account\/verify-email#[A-Za-z0-9_-]{43}/);
  const verifyToken = new URL(verify).hash.slice(1);
  await page.goto(verify);
  await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
  assert.equal(new URL(page.url()).hash, "");
  // Opening the link (including mail scanners) did not consume it or create a session.
  assert.equal((await request(page, "/auth/me", undefined, "GET")).status, 401);
  const password = "ReleasePassword!2026";
  await page.getByLabel("New password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Verify email and continue" }).click();
  await expect(page.getByRole("heading", { name: "Your ideas need a place to land." })).toBeVisible();
  assert.equal((await request(page, "/auth/verify-email", { token: verifyToken, password })).status, 400);
  const cookie = (await context.cookies()).find(cookie => cookie.name === "__Host-flux_session");
  assert.ok(cookie?.secure && cookie?.httpOnly && cookie.sameSite === "Lax" && cookie.path === "/");
  assert.equal(await page.evaluate(() => document.cookie), "");
  const created = await request(page, "/workspaces", { name: "Release smoke workspace" });
  assert.equal(created.status, 201);
  const workspaceId = created.data.id;
  const file = await request(page, `/workspaces/${workspaceId}/files`, { name: "Deployment recovery" });
  assert.equal(file.status, 201);
  if (!inviteOnly) {
    const outsiderContext = await newContext(), outsiderPage = await outsiderContext.newPage();
    await outsiderPage.goto("/login");
    assert.equal((await request(outsiderPage, "/auth/register", { name: "Public outsider", email: "outsider@example.com" })).status, 201);
    assert.equal((await request(outsiderPage, "/workspaces", undefined, "GET")).status, 401);
    await outsiderPage.goto(await emailLink("outsider@example.com", /https:\/\/flux\.example\.com:9443\/account\/verify-email#[A-Za-z0-9_-]{43}/));
    await outsiderPage.getByLabel("New password", { exact: true }).fill(password);
    await outsiderPage.getByLabel("Confirm password").fill(password);
    await outsiderPage.getByRole("button", { name: "Verify email and continue" }).click();
    await expect(outsiderPage).toHaveURL(origin + "/");
    assert.deepEqual((await request(outsiderPage, "/workspaces", undefined, "GET")).data, []);
    assert.equal((await request(outsiderPage, `/workspaces/${workspaceId}`, undefined, "GET")).status, 404);
    assert.equal((await request(outsiderPage, `/files/${file.data.id}`, undefined, "GET")).status, 404);
    assert.equal((await request(outsiderPage, `/files/${file.data.id}/collaboration-token`)).status, 404);
    assert.equal((await request(outsiderPage, `/invitations/${"a".repeat(43)}/accept`)).status, 410);
    const privateWorkspace = await request(outsiderPage, "/workspaces", { name: "Public account private workspace" });
    assert.equal(privateWorkspace.status, 201);
    assert.equal((await request(page, `/workspaces/${privateWorkspace.data.id}`, undefined, "GET")).status, 404);
    await outsiderContext.close();
  }
  await page.goto(`/files/${file.data.id}`);
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toBeVisible();
  await editor.fill("Production container recovery baseline.");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  // Eight real WebSocket clients edit the same block, with the same authorized session.
  const collaborators = await Promise.all(Array.from({ length: 8 }, async (_, index) => {
    const other = await newContext();
    await other.addCookies(await context.cookies());
    const tab = await other.newPage();
    await tab.goto(`/files/${file.data.id}`);
    await expect.poll(() => authoredTexts(tab.getByRole("textbox", { name: "Document content" }))).toEqual(["Production container recovery baseline."]);
    await expect(tab.locator(".save-status")).toHaveText("Saved");
    return { context: other, page: tab, marker: ` contributor-${index} ` };
  }));
  await Promise.all(collaborators.map(async client => {
    await caretAtEnd(client.page.locator(".document-content > p").last());
    await client.page.keyboard.insertText(client.marker);
  }));
  for (const client of collaborators) await expect(editor).toContainText(client.marker.trim());
  await expect(page.locator(".save-status")).toHaveText("Saved");
  for (const client of collaborators) await client.context.close();
  await page.getByRole("button", { name: "Save checkpoint", exact: true }).click();
  await page.getByLabel("Checkpoint name").fill("Production deployment checkpoint");
  await page.getByRole("dialog").getByRole("button", { name: "Save checkpoint", exact: true }).click();
  await expect(page.locator(".checkpoint-notice")).toContainText("Production deployment checkpoint");
  let head = await request(page, `/files/${file.data.id}/history-head`, undefined, "GET");
  assert.equal(head.status, 200);
  await page.screenshot({ path: `${directory}/production-editor.png`, fullPage: true });
  // Exercise IndexedDB recovery under the actual HTTPS/CSP production build, not
  // just development. Closing a dirty tab must not replay its draft on reopening.
  const draftFile = await request(page, `/workspaces/${workspaceId}/files`, { name: "Browser recovery acceptance" });
  assert.equal(draftFile.status, 201);
  const draftPage = await context.newPage(); await draftPage.goto(`/files/${draftFile.data.id}`);
  const draftEditor = draftPage.getByRole("textbox", { name: "Document content", exact: true });
  await expect(draftEditor).toBeVisible(); await draftEditor.fill("Production browser recovery baseline.");
  await expect(draftPage.locator(".save-status")).toHaveText("Saved");
  await context.setOffline(true); await draftEditor.fill("A production browser draft requires explicit recovery.");
  await expect(draftPage.locator(".browser-backup-status")).toContainText("Browser backup saved");
  await draftPage.close(); await context.setOffline(false);
  const reviewPage = await context.newPage(); await reviewPage.goto(`/files/${draftFile.data.id}`);
  const sharedEditor = reviewPage.getByRole("textbox", { name: "Document content", exact: true });
  await expect(sharedEditor).toContainText("recovery baseline"); await expect(sharedEditor).not.toContainText("requires explicit recovery");
  await expect(reviewPage.locator(".save-status")).toHaveText("Saved");
  await reviewPage.getByRole("button", { name: /Review browser draft/ }).click();
  await expect(reviewPage.getByRole("textbox", { name: "Browser draft content" })).toContainText("requires explicit recovery");
  await expect(reviewPage.getByRole("textbox", { name: "Browser draft content" })).toHaveAttribute("contenteditable", "false");
  await reviewPage.getByRole("button", { name: "Resume browser draft", exact: true }).click();
  await expect(sharedEditor).toContainText("requires explicit recovery"); await expect(reviewPage.locator(".save-status")).toHaveText("Saved");
  await expect(reviewPage.getByRole("button", { name: /Review browser draft/ })).toHaveCount(0);
  const draftHead = await request(reviewPage, `/files/${draftFile.data.id}/history-head`, undefined, "GET");
  assert.equal(draftHead.status, 200); await reviewPage.close();
  const invitation = await request(page, `/workspaces/${workspaceId}/invitations`, { email: "member@example.com", role: "VIEWER" });
  assert.equal(invitation.status, 201);
  const memberLink = await emailLink("member@example.com", /https:\/\/flux\.example\.com:9443\/invite\/[A-Za-z0-9_-]{43}/);
  const memberContext = await newContext();
  const memberPage = await memberContext.newPage();
  await memberPage.goto(memberLink);
  await expect(memberPage).toHaveURL(/\/login\?next=/);
  await memberPage.getByRole("button", { name: "Create an account" }).click();
  await memberPage.getByLabel("Your name").fill("Invited viewer");
  await memberPage.getByLabel("Email address").fill("member@example.com");
  await memberPage.getByRole("button", { name: "Verify and create account" }).click();
  await expect(memberPage.getByRole("status")).toContainText("a link will arrive");
  const memberVerify = await emailLink("member@example.com", /https:\/\/flux\.example\.com:9443\/account\/verify-email#[A-Za-z0-9_-]{43}/);
  await memberPage.goto(memberVerify);
  await memberPage.getByLabel("New password", { exact: true }).fill(password);
  await memberPage.getByLabel("Confirm password").fill(password);
  await memberPage.getByRole("button", { name: "Verify email and continue" }).click();
  await expect(memberPage).toHaveURL(origin + "/");
  await memberPage.goto(memberLink);
  await memberPage.getByRole("button", { name: "Join workspace", exact: true }).click();
  await expect(memberPage.getByRole("heading", { name: "Release smoke workspace", exact: true })).toBeVisible();
  assert.equal((await request(memberPage, `/workspaces/${workspaceId}/files`, { name: "forbidden" })).status, 403);
  const detail = await request(page, `/files/${file.data.id}`, undefined, "GET");
  assert.equal(detail.status, 200);
  assert.equal((await request(memberPage, `/files/${file.data.id}/branches/${detail.data.mainBranchId}/messages`, { body: "Viewer cannot post", requestId: crypto.randomUUID() })).status, 403);
  await memberPage.goto(`/files/${file.data.id}/discuss`);
  await expect(memberPage.getByRole("heading", { name: "Decision Bookmarks", exact: true })).toBeVisible();
  await expect(memberPage.getByLabel("Your message")).toHaveCount(0);
  await memberContext.close();

  // A separately verified teammate approves the exact live comparison. No shared
  // owner cookie can stand in for independent review.
  assert.equal((await request(page, `/workspaces/${workspaceId}/invitations`, { email: "reviewer@example.com", role: "REVIEWER" })).status, 201);
  const reviewerLink = await emailLink("reviewer@example.com", /https:\/\/flux\.example\.com:9443\/invite\/[A-Za-z0-9_-]{43}/);
  const reviewerContext = await newContext(), reviewerPage = await reviewerContext.newPage();
  await reviewerPage.goto("/login");
  assert.equal((await request(reviewerPage, "/auth/register", { name: "Release reviewer", email: "reviewer@example.com", invitationToken: new URL(reviewerLink).pathname.split("/").at(-1) })).status, 201);
  const reviewerVerify = await emailLink("reviewer@example.com", /https:\/\/flux\.example\.com:9443\/account\/verify-email#[A-Za-z0-9_-]{43}/);
  await reviewerPage.goto(reviewerVerify);
  await reviewerPage.getByLabel("New password", { exact: true }).fill(password); await reviewerPage.getByLabel("Confirm password").fill(password);
  await reviewerPage.getByRole("button", { name: "Verify email and continue" }).click();
  await expect(reviewerPage).toHaveURL(origin + "/");
  assert.equal((await request(reviewerPage, `/invitations/${new URL(reviewerLink).pathname.split("/").at(-1)}/accept`, undefined)).status, 201);
  const baseline = (await request(page, `/files/${file.data.id}/checkpoints`, undefined, "GET")).data.checkpoints[0];
  const baselineContext = await request(page, `/files/${file.data.id}/checkpoints/${baseline.id}`, undefined, "GET");
  assert.equal(baselineContext.status, 200); assert.equal(baselineContext.data.content.content.length, 1);
  const baselineBlock = baselineContext.data.content.content[0];
  assert.equal(typeof baselineBlock.attrs.blockId, "string");
  const baselineText = (await authoredTexts(editor))[0];
  const experiment = await request(page, `/files/${file.data.id}/branches`, { name: "Release experiment", checkpointId: baseline.id, requestId: crypto.randomUUID() });
  assert.equal(experiment.status, 201);
  const branchId = experiment.data.id, branchPath = `/files/${file.data.id}/branches/${branchId}`;
  const experimentPage = await context.newPage(); await experimentPage.goto(branchPath);
  const experimentEditor = experimentPage.getByRole("textbox", { name: "Document content" });
  await expect.poll(() => authoredTexts(experimentEditor)).toEqual([baselineText]); await expect(experimentPage.locator(".save-status")).toHaveText("Saved");
  const experimentBlocks = experimentEditor.locator(":scope > p");
  await caretAtEnd(experimentBlocks.last()); await experimentPage.keyboard.press("Enter");
  await expect.poll(() => authoredTexts(experimentBlocks)).toEqual([baselineText, ""]);
  await experimentPage.keyboard.insertText("Approved experiment conclusion.");
  await expect.poll(() => authoredTexts(experimentBlocks)).toEqual([baselineText, "Approved experiment conclusion."]);
  await expect(experimentPage.locator(".save-status")).toHaveText("Saved"); await expect(editor).not.toContainText("Approved experiment conclusion");
  await caretAtEnd(editor.locator(":scope > p").last()); await page.keyboard.insertText(" Main-only note preserved.");
  await expect.poll(() => authoredTexts(editor)).toEqual([`${baselineText} Main-only note preserved.`]); await expect(page.locator(".save-status")).toHaveText("Saved");
  const branchCheckpoint = await request(experimentPage, `/files/${file.data.id}/checkpoints`, { branchId, title: "Experiment decision context", requestId: crypto.randomUUID() }); assert.equal(branchCheckpoint.status, 201);
  const savedContext = await request(experimentPage, `/files/${file.data.id}/checkpoints/${branchCheckpoint.data.id}`, undefined, "GET"); assert.equal(savedContext.status, 200);
  assert.equal(savedContext.data.content.content.length, 2); assert.deepEqual(savedContext.data.content.content[0], baselineBlock);
  assert.notEqual(savedContext.data.content.content[1].attrs.blockId, baselineBlock.attrs.blockId);
  const sendBody = { body: "Keep the main note and add the conclusion.", requestId: crypto.randomUUID() };
  const discussion = await request(experimentPage, `${branchPath}/messages`, sendBody); assert.equal(discussion.status, 201);
  assert.equal((await request(experimentPage, `${branchPath}/messages`, sendBody)).data.id, discussion.data.id);
  const bookmark = await request(experimentPage, `${branchPath}/decisions`, { title: "Add the conclusion", explanation: "The reviewer agreed to keep current main and the experiment's addition.", checkpointId: branchCheckpoint.data.id,
    blockId: savedContext.data.content.content.at(-1).attrs.blockId, discussionMessageId: discussion.data.id, requestId: crypto.randomUUID() });
  assert.equal(bookmark.status, 201); assert.equal(bookmark.data.anchorAvailable, true);
  assert.equal((await request(experimentPage, `${branchPath}/decisions/${bookmark.data.id}`, { expectedStatus: "OPEN", status: "DECIDED" }, "PATCH")).status, 200);
  const comparison = await request(reviewerPage, `${branchPath}/compare`, undefined, "GET");
  mergeComparison = comparison; assert.equal(comparison.status, 200); assert.deepEqual(comparison.data.conflicts, []);
  assert.equal((await request(experimentPage, `${branchPath}/approvals`, { requestId: crypto.randomUUID(), mainHead: comparison.data.mainHead, sourceHead: comparison.data.sourceHead, resolutions: {} })).status, 403);
  await reviewerPage.goto(`${branchPath}/review`);
  await reviewerPage.getByRole("button", { name: "Approve reviewed result", exact: true }).click();
  const finalize = reviewerPage.getByRole("button", { name: "Finalize approved merge", exact: true }); await expect(finalize).toBeEnabled(); await finalize.click();
  await expect(reviewerPage.getByRole("textbox", { name: "Review document content" })).toContainText("Main-only note preserved");
  await expect(reviewerPage.getByRole("textbox", { name: "Review document content" })).toContainText("Approved experiment conclusion");
  await reviewerPage.getByRole("button", { name: "Confirm approved merge", exact: true }).click();
  await expect(reviewerPage).toHaveURL(`${origin}/files/${file.data.id}`);
  await expect(editor).toContainText("Main-only note preserved"); await expect(editor).toContainText("Approved experiment conclusion"); await expect(page.locator(".save-status")).toHaveText("Saved");
  await expect(experimentEditor).toHaveAttribute("contenteditable", "false");
  assert.equal((await request(experimentPage, `${branchPath}/messages`, { body: "Archived", requestId: crypto.randomUUID() })).status, 409);
  await experimentPage.goto(`/files/${file.data.id}/discuss?branchId=${branchId}`);
  await expect(experimentPage.getByRole("list", { name: "Saved messages" })).toContainText("Keep the main note");
  await experimentPage.getByRole("button", { name: "View saved context", exact: true }).click();
  await expect(experimentPage.getByRole("textbox", { name: "Decision checkpoint content" })).toHaveAttribute("contenteditable", "false");
  await expect(experimentPage.getByRole("textbox", { name: "Decision checkpoint content" })).toContainText("Approved experiment conclusion");
  await experimentPage.getByRole("button", { name: "Close dialog", exact: true }).click();
  await experimentPage.screenshot({ path: `${directory}/production-decisions.png`, fullPage: true });
  head = await request(page, `/files/${file.data.id}/history-head`, undefined, "GET"); assert.equal(head.status, 200); assert.equal(head.data.generation, comparison.data.mainHead.generation);
  const mainCheckpoints = (await request(page, `/files/${file.data.id}/checkpoints`, undefined, "GET")).data.checkpoints;
  const branchCheckpoints = (await request(page, `/files/${file.data.id}/checkpoints?branchId=${branchId}`, undefined, "GET")).data.checkpoints;
  assert.equal(mainCheckpoints.length, 3); assert.equal(branchCheckpoints.length, 2);
  // A pending approval must not survive a backup rollback as an actionable review.
  const pendingExperiment = await request(page, `/files/${file.data.id}/branches`, { name: "Pending backup review", checkpointId: baseline.id, requestId: crypto.randomUUID() }); assert.equal(pendingExperiment.status, 201);
  const pendingPath = `/files/${file.data.id}/branches/${pendingExperiment.data.id}`;
  const pendingComparison = await request(reviewerPage, `${pendingPath}/compare`, undefined, "GET"); assert.equal(pendingComparison.status, 200);
  const pendingApproval = await request(reviewerPage, `${pendingPath}/approvals`, { requestId: crypto.randomUUID(), sourceHead: pendingComparison.data.sourceHead, mainHead: pendingComparison.data.mainHead, resolutions: {} }); assert.equal(pendingApproval.status, 201);
  await reviewerContext.close(); await experimentPage.close();
  // Recovery notices don't reveal whether an account exists.
  const unknown = await request(page, "/auth/forgot-password", { email: "unknown@example.com" });
  const recovery = await request(page, "/auth/forgot-password", { email: "owner@example.com" });
  assert.deepEqual(unknown.data, recovery.data);
  const reset = await emailLink("owner@example.com", /https:\/\/flux\.example\.com:9443\/account\/reset-password#[A-Za-z0-9_-]{43}/);
  const resetToken = new URL(reset).hash.slice(1);
  const recoveryContext = await newContext();
  const recoveryPage = await recoveryContext.newPage();
  await recoveryPage.goto(reset);
  const newPassword = "RecoveredPassword!2026";
  const attempts = await Promise.all([request(recoveryPage, "/auth/reset-password", { token: resetToken, password: newPassword }), request(recoveryPage, "/auth/reset-password", { token: resetToken, password: newPassword })]);
  assert.deepEqual(attempts.map(attempt => attempt.status).sort(), [201, 400]);
  assert.equal((await request(page, "/auth/me", undefined, "GET")).status, 401);
  assert.equal((await request(recoveryPage, "/auth/login", { email: "owner@example.com", password })).status, 401);
  assert.equal((await request(recoveryPage, "/auth/login", { email: "owner@example.com", password: newPassword })).status, 201);
  await recoveryPage.goto(`/files/${file.data.id}`);
  for (const client of collaborators) await expect(recoveryPage.getByRole("textbox", { name: "Document content" })).toContainText(client.marker.trim());
  await expect(recoveryPage.locator(".save-status")).toHaveText("Saved");
  for (let attempt = 0; attempt < 10; attempt += 1) assert.equal((await request(recoveryPage, "/auth/login", { email: "throttled@example.com", password: "wrong password" })).status, 401);
  assert.equal((await request(recoveryPage, "/auth/login", { email: "throttled@example.com", password: "wrong password" })).status, 429);
  assert.equal((await request(recoveryPage, "/AUTH/LOGIN/", { email: "Throttled@EXAMPLE.com", password: "wrong password" })).status, 429);
  const result = { workspaceId, fileId: file.data.id, contentHash: head.data.contentHash, generation: head.data.generation,
    draftFileId: draftFile.data.id, draftContentHash: draftHead.data.contentHash, draftGeneration: draftHead.data.generation,
    branchId, bookmarkId: bookmark.data.id, discussionId: discussion.data.id, pendingApprovalId: pendingApproval.data.id, checkpointCount: mainCheckpoints.length + branchCheckpoints.length };
  await writeFile(`${directory}/state.json`, JSON.stringify(result), { mode: 0o600 });
  assert.deepEqual(violations, []);
  await recoveryContext.close();
  console.log("Production HTTPS/browser checks passed: identity/recovery, CSP/roles, eight-client convergence, durable saves, browser drafts, live reviewed merging, archived discussions, and linked Decision Bookmarks.");
} catch (error) {
  const pages = browser.contexts().flatMap(context => context.pages());
  const editingDocuments = await Promise.allSettled(pages.map(async page => ({
    path: new URL(page.url()).pathname.replace(/[A-Za-z0-9_-]{43}/g, "<token>"),
    blocks: await page.locator(".document-content > *").evaluateAll(elements => elements.map(element => ({
      type: element.tagName, blockId: element.getAttribute("data-block-id"), text: element.textContent,
    }))),
  })));
  await writeFile(`${diagnostics}/browser.json`, JSON.stringify({ networkFailures, violations, editingDocuments, mergeComparison }, null, 2), { mode: 0o600 });
  await Promise.allSettled(browser.contexts().flatMap(context => context.pages()).map((page, index) => page.screenshot({ path: `${diagnostics}/failure-page-${index}.png`, fullPage: true })));
  console.error("Production browser failure diagnostics:", JSON.stringify({ networkFailures, violations }));
  throw error;
} finally { await browser.close(); }
