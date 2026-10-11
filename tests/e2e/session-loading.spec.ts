import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { config } from "dotenv";
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

config({ path: resolve(process.cwd(), ".env"), quiet: true });
const db = new PrismaClient();
const users: string[] = [];
const origin = "http://localhost:3000";

test.afterAll(async () => {
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
});

test("a stalled account check offers retry instead of leaving the workspace loading forever", async ({ page }) => {
  await page.clock.install();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/auth/me", async route => {
    await held;
    await route.fulfill({ status: 401, json: { message: "Sign in to continue" } }).catch(() => {});
  });
  try {
    const request = page.waitForRequest("**/api/auth/me");
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await request;
    await expect(page.getByRole("status")).toHaveText("Opening your workspace…");
    await page.clock.fastForward(11_000);
    await expect(page.getByRole("main").getByRole("alert")).toHaveText("Your account check timed out. Check your connection and try again.");
    await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
    release();
    await page.unroute("**/api/auth/me");
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(page).toHaveURL(/\/login\?next=%2F$/);
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  } finally { release(); }
});

test("successful login cancels an older account check and opens the workspace immediately", async ({ page }) => {
  const email = `session-${randomUUID()}@flux.test`;
  const password = "a secure session test password";
  const registered = await page.request.post("/api/auth/register", { headers: { origin }, data: { name: "Session test", email, password } });
  expect(registered.ok()).toBe(true);
  users.push((await registered.json()).id);
  expect((await page.request.post("/api/auth/logout", { headers: { origin } })).ok()).toBe(true);

  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/auth/me", async route => {
    await held;
    // This response reflects the account before the user signed in.
    await route.fulfill({ status: 401, json: { message: "Sign in to continue" } }).catch(() => {});
  });
  try {
    const request = page.waitForRequest("**/api/auth/me");
    await page.goto("/login");
    await request;
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Your ideas need a place to land." })).toBeVisible();
    release();
    await page.unroute("**/api/auth/me");
    await expect(page.locator(".sidebar-profile")).toContainText(email);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Your ideas need a place to land." })).toBeVisible();
  } finally { release(); }
});

test("loading recovery remains usable when browser JavaScript chunks fail to load", async ({ page }) => {
  const chunks = /\/_next\/static\/.*\.js(?:\?.*)?$/;
  await page.route(chunks, route => route.abort());
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("status")).toHaveText("Opening your workspace…");
  await expect(page.getByRole("link", { name: "Reload page", exact: true })).toBeVisible();
  await page.unroute(chunks);
  await page.getByRole("link", { name: "Reload page", exact: true }).click();
  await expect(page).toHaveURL(/\/login\?next=%2F$/);
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
});
