import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../../apps/web/proxy";
import { parseRuntimeConfig } from "../../apps/api/src/runtime-config";

afterEach(() => vi.unstubAllEnvs());
describe("live deployment isolation", () => {
  it("allows login and forwards API credentials in live mode", () => {
    vi.stubEnv("VERCEL", "1"); vi.stubEnv("FLUX_DEPLOYMENT_MODE", "live");
    vi.stubEnv("NODE_ENV", "production");
    const response = proxy(new NextRequest("https://flux-live.vercel.app/api/auth/me", { headers: { cookie: "__Host-flux_session=sample" } }));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-middleware-request-cookie")).toBe("__Host-flux_session=sample");
    expect(proxy(new NextRequest("https://flux-live.vercel.app/login")).status).toBe(200);
  });
  it("replaces a caller-supplied client proof with one signed by the Vercel proxy", () => {
    vi.stubEnv("VERCEL", "1");
    const key = "test-key";
    vi.stubEnv("FLUX_PROXY_KEY", key);
    const headers = { "x-flux-client": "untrusted", "x-vercel-forwarded-for": "203.0.113.42" };
    const url = "https://flux-live.vercel.app/api/auth/login";
    const forward = () => proxy(new NextRequest(url, { method: "POST", headers })).headers;
    const result = forward();
    const [timestamp, address, signature] = result.get("x-middleware-request-x-flux-client")!.split(",");
    expect(address).toBe(headers["x-vercel-forwarded-for"]);
    expect(signature).toBe(createHmac("sha256", key).update(`${timestamp},${address},POST,/api/auth/login`).digest("hex"));
    expect(result.has("x-flux-client")).toBe(false);
    vi.stubEnv("VERCEL", undefined);
    expect(forward().has("x-middleware-request-x-flux-client")).toBe(false);
  });
  it("allows only the configured secure collaboration origin in CSP", () => {
    vi.stubEnv("VERCEL", "1"); vi.stubEnv("FLUX_DEPLOYMENT_MODE", "live");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_COLLABORATION_URL", "wss://flux-backend.onrender.com/sync");
    const csp = proxy(new NextRequest("https://flux-live.vercel.app/login")).headers.get("content-security-policy");
    expect(csp).toContain("connect-src 'self' wss://flux-backend.onrender.com;");
    vi.stubEnv("NEXT_PUBLIC_COLLABORATION_URL", "ws://flux-backend.onrender.com/sync");
    expect(() => proxy(new NextRequest("https://flux-live.vercel.app/login"))).toThrow("WSS");
  });
});

describe("managed Neon credentials", () => {
  const base = { NODE_ENV: "production", APP_ORIGIN: "https://flux-live.vercel.app", COLLABORATION_SECRET: "a".repeat(64), AUTH_MODE: "invite-only", REQUIRE_EMAIL_VERIFICATION: "true", MAIL_MODE: "smtp", MAIL_ENCRYPTION_KEY: "b".repeat(64), MAIL_FROM: "flux@test.org", SMTP_HOST: "smtp.test.org", SMTP_USER: "user", SMTP_PASSWORD: "secret" };
  it("accepts a provider-generated Neon credential only with required TLS", () => {
    expect(() => parseRuntimeConfig({ ...base, DATABASE_URL: "postgresql://user:abcdefghijklmnopqrstuvwx@ep-live.neon.tech/db?sslmode=require" })).not.toThrow();
    for (const host of ["ep-live.neon.tech/db", "ep-live.neon.tech.evil.org/db?sslmode=require"]) {
      expect(() => parseRuntimeConfig({ ...base, DATABASE_URL: `postgresql://user:abcdefghijklmnopqrstuvwx@${host}` })).toThrow("PostgreSQL credentials");
    }
  });
});
