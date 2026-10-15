import "reflect-metadata";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecutionContext } from "@nestjs/common";
import type { Response } from "express";
import type { Database } from "../../apps/api/src/database";
import { AuthController, SessionGuard } from "../../apps/api/src/auth";
import { AccessService } from "../../apps/api/src/workspaces";
import { queueMail } from "../../apps/api/src/mail";

vi.mock("../../apps/api/src/config", () => ({ env: { NODE_ENV: "production", AUTH_MODE: "open", REQUIRE_EMAIL_VERIFICATION: true, APP_ORIGIN: "https://flux.example.com" } }));
vi.mock("../../apps/api/src/security", async importOriginal => ({ ...await importOriginal<typeof import("../../apps/api/src/security")>(), hashPassword: vi.fn(async () => "hashed-password") }));
vi.mock("../../apps/api/src/mail", () => ({ queueMail: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

function database() {
  const tx = {
    user: { create: vi.fn(async () => ({ id: "public-user", name: "New user", email: "new@example.com" })) },
    accountToken: { deleteMany: vi.fn(), create: vi.fn() },
    securityEvent: { create: vi.fn() },
    session: { create: vi.fn() },
    workspaceMember: { create: vi.fn(), upsert: vi.fn() },
    signupInvitation: { findFirst: vi.fn(), updateMany: vi.fn() },
    invitation: { findFirst: vi.fn() },
  };
  const db = { ...tx, $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)) };
  return { db, tx };
}

describe("verified public signup", () => {
  it("advertises public signup while keeping email verification required", () => {
    const { db } = database();
    expect(new AuthController(db as unknown as Database).options()).toEqual({ inviteOnly: false, emailVerification: true });
  });

  it.each([undefined, "a".repeat(43)])("registers without requiring or consuming a workspace invitation (%s)", async invitationToken => {
    const { db, tx } = database();
    const response = { cookie: vi.fn(), setHeader: vi.fn() };
    const result = await new AuthController(db as unknown as Database).register({ name: "New user", email: "new@example.com", invitationToken }, response as unknown as Response);
    expect(result).toMatchObject({ verificationRequired: true });
    expect(tx.user.create).toHaveBeenCalledWith({ data: { name: "New user", email: "new@example.com", passwordHash: "hashed-password" } });
    expect(queueMail).toHaveBeenCalledWith(tx, "new@example.com", "Verify your Flux email", expect.stringContaining("https://flux.example.com/account/verify-email#"), expect.any(Date));
    expect(tx.signupInvitation.findFirst).not.toHaveBeenCalled();
    expect(tx.signupInvitation.updateMany).not.toHaveBeenCalled();
    expect(tx.invitation.findFirst).not.toHaveBeenCalled();
    expect(tx.workspaceMember.create).not.toHaveBeenCalled();
    expect(tx.workspaceMember.upsert).not.toHaveBeenCalled();
    expect(tx.session.create).not.toHaveBeenCalled();
    expect(response.cookie).not.toHaveBeenCalled();
  });

  it("rejects an unverified account even when it has a session", async () => {
    const db = { session: { findUnique: vi.fn(async () => ({ expiresAt: new Date(Date.now() + 60_000), user: { id: "unverified", emailVerifiedAt: null } })) } };
    const context = { switchToHttp: () => ({ getRequest: () => ({ cookies: { "__Host-flux_session": "sample-session" } }) }) };
    await expect(new SessionGuard(db as unknown as Database).canActivate(context as unknown as ExecutionContext)).rejects.toThrow("Verify your email");
  });

  it("does not grant existing-workspace access to a publicly registered account", async () => {
    const db = { workspaceMember: { findUnique: vi.fn(async () => null) } };
    await expect(new AccessService(db as unknown as Database).workspace("private-workspace", "public-user")).rejects.toThrow("Workspace not found");
  });
});
