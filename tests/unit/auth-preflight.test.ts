import "reflect-metadata";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../../apps/api/src/database";
import type { Response } from "express";
import { AuthController } from "../../apps/api/src/auth";
import { hashPassword } from "../../apps/api/src/security";

vi.mock("../../apps/api/src/config", () => ({ env: { NODE_ENV: "production", AUTH_MODE: "invite-only", REQUIRE_EMAIL_VERIFICATION: true } }));
vi.mock("../../apps/api/src/security", async importOriginal => ({ ...await importOriginal<typeof import("../../apps/api/src/security")>(), hashPassword: vi.fn(async () => "hashed-password") }));
vi.mock("../../apps/api/src/mail", () => ({ queueMail: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

describe("credential preflights", () => {
  it("rejects invalid signup invitations without hashing a password", async () => {
    const db = { signupInvitation: { findFirst: vi.fn(async () => null) }, invitation: { findFirst: vi.fn(async () => null) }, $transaction: vi.fn() };
    await expect(new AuthController(db as unknown as Database).register({ name: "Invited", email: "person@example.com", invitationToken: "a".repeat(43) }, {} as Response)).rejects.toThrow("invitation");
    expect(hashPassword).not.toHaveBeenCalled(); expect(db.$transaction).not.toHaveBeenCalled();
  });
  it.each([null, { userId: "person", purpose: "VERIFY_EMAIL", expiresAt: new Date(Date.now() + 60_000) }, { userId: "person", purpose: "RESET_PASSWORD", expiresAt: new Date(0) }])("rejects unknown, wrong-purpose, or expired recovery links before hashing", async token => {
    const db = { accountToken: { findUnique: vi.fn(async () => token) }, $transaction: vi.fn() };
    await expect(new AuthController(db as unknown as Database).resetPassword({ token: "a".repeat(43), password: "a secure new password" }, {} as Response)).rejects.toThrow("expired");
    expect(hashPassword).not.toHaveBeenCalled(); expect(db.$transaction).not.toHaveBeenCalled();
  });
  it("rechecks consumption after taking the user lock", async () => {
    const initial = { userId: "person", purpose: "RESET_PASSWORD", expiresAt: new Date(Date.now() + 60_000) };
    const tx = { $queryRaw: vi.fn(async () => []), accountToken: { findUnique: vi.fn(async () => null), deleteMany: vi.fn() }, session: { deleteMany: vi.fn() }, user: { update: vi.fn() } };
    const db = { accountToken: { findUnique: vi.fn(async () => initial) }, $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)) };
    await expect(new AuthController(db as unknown as Database).resetPassword({ token: "a".repeat(43), password: "a secure new password" }, {} as Response)).rejects.toThrow("expired");
    expect(hashPassword).toHaveBeenCalledOnce(); expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(tx.user.update).not.toHaveBeenCalled(); expect(tx.session.deleteMany).not.toHaveBeenCalled();
  });
});
