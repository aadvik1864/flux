import { describe, expect, it } from "vitest";
import { credentialBucket, hashPassword, needsPasswordUpgrade, PasswordCapacityError, verifyPassword, opaqueToken, tokenHash } from "../../apps/api/src/security";
import { scryptSync } from "node:crypto";
import { safeRedirect } from "../../apps/web/lib/api";

describe("credentials", () => {
  it("salts passwords and validates them", async () => {
    const first = await hashPassword("a long test password");
    const second = await hashPassword("a long test password");
    expect(first).not.toBe(second);
    expect(first).not.toContain("password");
    expect(first).toMatch(/^scrypt-v1:/);
    expect(needsPasswordUpgrade(first)).toBe(false);
    expect(await verifyPassword("a long test password", first)).toBe(true);
    expect(await verifyPassword("an incorrect password", first)).toBe(false);
  });
  it("rejects corrupt password hashes", async () => {
    expect(await verifyPassword("password", "invalid")).toBe(false);
    expect(await verifyPassword("password", "scrypt-v1:invalid")).toBe(false);
  });
  it("keeps legacy hashes readable until they are upgraded", async () => {
    const salt = "a".repeat(32);
    const legacy = `${salt}:${scryptSync("legacy password", salt, 64).toString("hex")}`;
    expect(needsPasswordUpgrade(legacy)).toBe(true);
    expect(await verifyPassword("legacy password", legacy)).toBe(true);
    expect(await verifyPassword("wrong password", legacy)).toBe(false);
  });
  it("bounds password work and recovers after the queue fills", async () => {
    const salt = "b".repeat(32);
    const legacy = `${salt}:${scryptSync("legacy password", salt, 64).toString("hex")}`;
    // Even the cheaper legacy checks share the same two-active/16-waiting limit.
    const results = await Promise.allSettled(Array.from({ length: 19 }, () => verifyPassword("legacy password", legacy)));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(18);
    expect(results[18].status).toBe("rejected");
    if (results[18].status === "rejected") expect(results[18].reason).toBeInstanceOf(PasswordCapacityError);
    expect(results.slice(0, 18)).toEqual(Array.from({ length: 18 }, () => ({ status: "fulfilled", value: true })));
    expect(await verifyPassword("legacy password", legacy)).toBe(true);
  });
  it("stores deterministic hashes, not raw session and invitation tokens", () => {
    const token = opaqueToken();
    expect(token).not.toBe(opaqueToken());
    expect(tokenHash(token)).toBe(tokenHash(token));
    expect(tokenHash(token)).not.toBe(token);
    expect(tokenHash(token)).toHaveLength(64);
    expect(credentialBucket("/AUTH/LOGIN/", "User@EXAMPLE.COM")).toBe(credentialBucket("/auth/login", "user@example.com"));
    expect(credentialBucket("/auth/login", "user@example.com")).not.toBe(credentialBucket("/auth/register", "user@example.com"));
  });
});

describe("login redirect", () => {
  it.each([null, "https://evil.example", "//evil.example", "/\\evil.example", "/\nevil.example"])("rejects an unsafe redirect: %s", path => {
    expect(safeRedirect(path)).toBe("/");
  });
  it("preserves an internal invitation path", () => {
    expect(safeRedirect("/invite/safe-token")).toBe("/invite/safe-token");
  });
});
