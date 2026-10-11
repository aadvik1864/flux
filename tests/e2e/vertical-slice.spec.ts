import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { config } from "dotenv";
import { test, expect, type BrowserContext } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";
import { parseBranchRoom } from "@flux/shared";

config({ path: resolve(process.cwd(), ".env"), quiet: true });
const db = new PrismaClient();
const users: string[] = [];
const workspaces: string[] = [];
const origin = "http://localhost:3000";
const password = "a secure e2e password";

async function account(context: BrowserContext, name: string) {
  const email = `${name.toLowerCase().replace(/\s+/g, "-")}-${randomUUID()}@flux.test`;
  const response = await context.request.post("/api/auth/register", { headers: { origin }, data: { name, email, password } });
  expect(response.ok(), await response.text()).toBe(true);
  const user = await response.json();
  users.push(user.id);
  return { ...user, email };
}

async function workspace(context: BrowserContext) {
  const response = await context.request.post("/api/workspaces", { headers: { origin }, data: { name: `Flux e2e ${randomUUID().slice(0, 8)}`, description: "Automated collaboration check" } });
  expect(response.ok()).toBe(true);
  const item = await response.json();
  workspaces.push(item.id);
  return item;
}

async function invite(owner: BrowserContext, member: BrowserContext, workspaceId: string, email: string, role = "EDITOR") {
  const response = await owner.request.post(`/api/workspaces/${workspaceId}/invitations`, { headers: { origin }, data: { email, role } });
  expect(response.ok()).toBe(true);
  const { url } = await response.json();
  const token = url.split("/").at(-1);
  const accepted = await member.request.post(`/api/invitations/${token}/accept`, { headers: { origin } });
  expect(accepted.ok(), await accepted.text()).toBe(true);
  return token;
}

test.afterAll(async () => {
  // Only delete IDs created by this test run; never clear the database.
  await db.workspace.deleteMany({ where: { id: { in: workspaces } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
});

test("sign-up, create workspace and document, then reopen", async ({ page }, testInfo) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Create an account", exact: true }).click();
  await page.getByLabel("Your name").fill("UI test owner");
  await page.getByLabel("Email address").fill(`ui-${randomUUID()}@flux.test`);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your ideas need a place to land." })).toBeVisible();
  const user = await (await page.request.get("/api/auth/me")).json(); users.push(user.id);
  await page.getByRole("main").getByRole("button", { name: "Create workspace", exact: true }).click();
  await page.getByLabel("Workspace name").fill("UI test workspace");
  await page.getByRole("dialog").getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/workspaces\//);
  workspaces.push(page.url().split("/").at(-1)!);
  await expect(page.getByRole("heading", { name: "UI test workspace", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("workspace.png"), fullPage: true });
  await page.getByRole("button", { name: "New document", exact: true }).click();
  await page.getByLabel("Document name").fill("First shared proposal");
  await page.getByRole("button", { name: "Create document", exact: true }).click();
  const content = page.getByRole("textbox", { name: "Document content" });
  await expect(content).toBeVisible();
  await content.fill("This document belongs to our team.");
  await expect(page.getByRole("status", { name: "" }).filter({ hasText: /^Saved$/ })).toBeVisible();
  await page.reload();
  await expect(content).toContainText("This document belongs to our team.");
  await expect(content.locator("p").first()).toHaveAttribute("data-block-id", /.+/);
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await page.screenshot({ path: testInfo.outputPath("editor.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("editor-mobile.png"), fullPage: true });
});

test("three accounts co-edit different blocks, reconnect, and recover acknowledged content", async ({ browser }) => {
  const ownerContext = await browser.newContext({ baseURL: origin });
  const editorContext = await browser.newContext({ baseURL: origin });
  const thirdContext = await browser.newContext({ baseURL: origin });
  try {
    await account(ownerContext, "Owner");
    const editor = await account(editorContext, "Editor");
    const third = await account(thirdContext, "Third editor");
    const project = await workspace(ownerContext);
    const created = await ownerContext.request.post(`/api/workspaces/${project.id}/files`, { headers: { origin }, data: { name: "Shared proposal" } });
    const file = await created.json();
    await invite(ownerContext, editorContext, project.id, editor.email);
    await invite(ownerContext, thirdContext, project.id, third.email);
    const ownerPage = await ownerContext.newPage();
    const editorPage = await editorContext.newPage();
    const thirdPage = await thirdContext.newPage();
    await ownerPage.goto(`/files/${file.id}`);
    const ownerContent = ownerPage.getByRole("textbox", { name: "Document content" });
    await expect(ownerContent).toBeVisible();
    await ownerContent.fill("Proposal");
    await ownerContent.press("End"); await ownerContent.press("Enter");
    await ownerPage.keyboard.insertText("Budget");
    await ownerPage.keyboard.press("Enter"); await ownerPage.keyboard.insertText("Timeline");
    await expect(ownerPage.locator(".save-status")).toHaveText("Saved");
    await editorPage.goto(`/files/${file.id}`);
    await thirdPage.goto(`/files/${file.id}`);
    const editorContent = editorPage.getByRole("textbox", { name: "Document content" });
    const thirdContent = thirdPage.getByRole("textbox", { name: "Document content" });
    await expect(editorContent).toContainText("Budget");
    await expect(ownerPage.getByText("3 here", { exact: true })).toBeVisible();
    await ownerContent.locator("p").nth(1).click(); await ownerPage.keyboard.press("End");
    await editorContent.locator("p").first().click(); await editorPage.keyboard.press("End");
    await thirdContent.locator("p").last().click(); await thirdPage.keyboard.press("End");
    await Promise.all([ownerPage.keyboard.insertText(" approved"), editorPage.keyboard.insertText(" revised"), thirdPage.keyboard.insertText(" confirmed")]);
    for (const page of [ownerPage, editorPage, thirdPage]) {
      await expect(page.getByRole("textbox", { name: "Document content" })).toContainText("Proposal revised");
      await expect(page.getByRole("textbox", { name: "Document content" })).toContainText("Budget approved");
      await expect(page.getByRole("textbox", { name: "Document content" })).toContainText("Timeline confirmed");
      await expect(page.locator(".save-status")).toHaveText("Saved");
    }
    await editorContext.setOffline(true);
    await editorContent.locator("p").first().click(); await editorPage.keyboard.press("End");
    await editorPage.keyboard.insertText(" offline note");
    await editorContext.setOffline(false);
    await expect(ownerContent).toContainText("offline note");
    await expect(editorPage.locator(".save-status")).toHaveText("Saved");
    await Promise.all([ownerPage.reload(), editorPage.reload()]);
    await expect(ownerContent).toContainText("offline note");
    await expect(editorContent).toContainText("Budget approved");
  } finally { await ownerContext.close(); await editorContext.close(); await thirdContext.close(); }
});

test("an acknowledged document survives an abrupt collaboration-server restart", async ({ browser }) => {
  const owner = await browser.newContext({ baseURL: origin });
  let child: ChildProcess | undefined;
  let provider: HocuspocusProvider | undefined;
  let document = new Y.Doc();
  const port = await new Promise<number>((resolvePort, reject) => {
    const socket = createServer();
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const address = socket.address();
      if (!address || typeof address === "string") { socket.close(); reject(new Error("No test port available")); return; }
      socket.close(() => resolvePort(address.port));
    });
  });

  async function startServer() {
    // Load TS in the actual service process, not a CLI wrapper with a child PID.
    child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
      cwd: resolve("apps/collaboration"),
      env: { ...process.env, COLLABORATION_PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout?.on("data", chunk => { output += chunk.toString(); });
    child.stderr?.on("data", chunk => { output += chunk.toString(); });
    await expect.poll(() => output, { message: "Isolated collaboration server should start" }).toContain(`ws://127.0.0.1:${port}`);
  }

  async function connect(room: string, token: string) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Restart test socket did not synchronize")), 15_000);
      provider = new HocuspocusProvider({ url: `ws://127.0.0.1:${port}`, name: room, token, document,
        onSynced() { clearTimeout(timer); resolve(); },
        onAuthenticationFailed() { clearTimeout(timer); reject(new Error("Restart test authentication failed")); },
      });
    });
  }

  try {
    await account(owner, "Recovery owner");
    const project = await workspace(owner);
    const file = await (await owner.request.post(`/api/workspaces/${project.id}/files`, { headers: { origin }, data: { name: "Restart proof" } })).json();
    const credentials = await (await owner.request.post(`/api/files/${file.id}/collaboration-token`, { headers: { origin } })).json();
    await startServer();
    await connect(credentials.room, credentials.token);
    document.getMap("recovery-proof").set("content", "This state was acknowledged before the crash.");
    await new Promise<void>((resolve, reject) => {
      const requestId = randomUUID();
      const timer = setTimeout(() => reject(new Error("Recovery save acknowledgement missing")), 15_000);
      provider!.on("stateless", ({ payload }: { payload: string }) => {
        const message = JSON.parse(payload);
        if (message.requestId === requestId && message.type === "saved") { clearTimeout(timer); resolve(); }
      });
      provider!.sendStateless(JSON.stringify({ type: "flush", requestId }));
    });
    provider!.destroy(); provider = undefined; document.destroy();
    const stopped = once(child!, "exit"); child!.kill("SIGKILL"); await stopped;
    await startServer();
    document = new Y.Doc();
    await connect(credentials.room, credentials.token);
    expect(document.getMap("recovery-proof").get("content")).toBe("This state was acknowledged before the crash.");
  } finally {
    provider?.destroy(); document.destroy();
    if (child && child.exitCode === null && child.signalCode === null) {
      const stopped = once(child, "exit"); child.kill("SIGTERM"); await stopped;
    }
    await owner.close();
  }
});

test("tenant isolation, email-bound one-use invitations, and read-only server enforcement", async ({ browser }) => {
  const owner = await browser.newContext({ baseURL: origin });
  const viewer = await browser.newContext({ baseURL: origin });
  const outsider = await browser.newContext({ baseURL: origin });
  let provider: HocuspocusProvider | undefined;
  const maliciousDoc = new Y.Doc();
  try {
    await account(owner, "Security owner");
    const reader = await account(viewer, "Viewer");
    await account(outsider, "Outsider");
    const project = await workspace(owner);
    const created = await owner.request.post(`/api/workspaces/${project.id}/files`, { headers: { origin }, data: { name: "Private document" } });
    const file = await created.json();
    expect((await outsider.request.get(`/api/workspaces/${project.id}`)).status()).toBe(404);
    expect((await outsider.request.get(`/api/files/${file.id}`)).status()).toBe(404);
    const invitation = await owner.request.post(`/api/workspaces/${project.id}/invitations`, { headers: { origin }, data: { email: reader.email, role: "VIEWER" } });
    const { url } = await invitation.json(); const token = url.split("/").at(-1);
    expect((await outsider.request.post(`/api/invitations/${token}/accept`, { headers: { origin } })).status()).toBe(403);
    expect((await viewer.request.post(`/api/invitations/${token}/accept`, { headers: { origin } })).ok()).toBe(true);
    expect((await viewer.request.post(`/api/invitations/${token}/accept`, { headers: { origin } })).status()).toBe(410);
    expect((await viewer.request.post(`/api/workspaces/${project.id}/files`, { headers: { origin }, data: { name: "Forbidden" } })).status()).toBe(403);
    expect((await owner.request.post("/api/workspaces", { headers: { origin: "https://evil.example" }, data: { name: "CSRF" } })).status()).toBe(403);
    const credentials = await (await viewer.request.post(`/api/files/${file.id}/collaboration-token`, { headers: { origin } })).json();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Viewer socket did not synchronize")), 15_000);
      provider = new HocuspocusProvider({
        url: "ws://localhost:1234", name: credentials.room, token: credentials.token, document: maliciousDoc,
        onSynced() { clearTimeout(timer); resolve(); },
        onAuthenticationFailed() { clearTimeout(timer); reject(new Error("Viewer authentication failed")); },
      });
    });
    maliciousDoc.getMap("unauthorized").set("value", "A viewer tried to write this");
    await new Promise<void>((resolve, reject) => {
      const requestId = randomUUID();
      const timer = setTimeout(() => reject(new Error("Save acknowledgement missing")), 15_000);
      provider!.on("stateless", ({ payload }: { payload: string }) => {
        const message = JSON.parse(payload);
        if (message.requestId === requestId && message.type === "saved") { clearTimeout(timer); resolve(); }
      });
      provider!.sendStateless(JSON.stringify({ type: "flush", requestId }));
    });
    const state = await db.documentState.findUniqueOrThrow({ where: { branchId: parseBranchRoom(credentials.room).branchId } });
    const persisted = new Y.Doc(); Y.applyUpdate(persisted, new Uint8Array(state.state));
    expect(persisted.getMap("unauthorized").get("value")).toBeUndefined(); persisted.destroy();
    const disconnected = new Promise<void>(resolve => provider!.on("close", () => resolve()));
    expect((await owner.request.delete(`/api/workspaces/${project.id}/members/${reader.id}`, { headers: { origin } })).ok()).toBe(true);
    await disconnected;
    expect((await viewer.request.post(`/api/files/${file.id}/collaboration-token`, { headers: { origin } })).status()).toBe(404);
  } finally { provider?.destroy(); maliciousDoc.destroy(); await owner.close(); await viewer.close(); await outsider.close(); }
});
