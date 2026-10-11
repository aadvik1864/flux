import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword, opaqueToken, tokenHash } from "../../apps/api/src/security";
import { safeRedirect } from "../../apps/web/lib/api";

describe("credentials", () => {
  it("salts passwords and validates them", async () => {
    const first = await hashPassword("a long test password");
    const second = await hashPassword("a long test password");
    expect(first).not.toBe(second);
    expect(first).not.toContain("password");
    expect(await verifyPassword("a long test password", first)).toBe(true);
    expect(await verifyPassword("an incorrect password", first)).toBe(false);
  });
  it("rejects corrupt password hashes", async () => {
    expect(await verifyPassword("password", "invalid")).toBe(false);
  });
  it("stores deterministic hashes, not raw session and invitation tokens", () => {
    const token = opaqueToken();
    expect(token).not.toBe(opaqueToken());
    expect(tokenHash(token)).toBe(tokenHash(token));
    expect(tokenHash(token)).not.toBe(token);
    expect(tokenHash(token)).toHaveLength(64);
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
