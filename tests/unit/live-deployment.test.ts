import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { isShowcaseDeployment } from "../../apps/web/lib/showcase-deployment";
import { proxy } from "../../apps/web/proxy";
import { parseRuntimeConfig } from "../../apps/api/src/runtime-config";

afterEach(() => vi.unstubAllEnvs());
describe("live deployment isolation", () => {
  it("requires an explicit live setting and preserves an explicit showcase setting", () => {
    vi.stubEnv("VERCEL", "1");
    expect(isShowcaseDeployment()).toBe(true);
    vi.stubEnv("FLUX_DEPLOYMENT_MODE", "live");
    expect(isShowcaseDeployment()).toBe(false);
    vi.stubEnv("FLUX_SHOWCASE_ONLY", "true");
    expect(isShowcaseDeployment()).toBe(true);
  });
  it("allows login and forwards API credentials in live mode", () => {
    vi.stubEnv("VERCEL", "1"); vi.stubEnv("FLUX_DEPLOYMENT_MODE", "live");
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("FLUX_SHOWCASE_ONLY", undefined);
    const response = proxy(new NextRequest("https://flux-live.vercel.app/api/auth/me", { headers: { cookie: "__Host-flux_session=sample" } }));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-middleware-request-cookie")).toBe("__Host-flux_session=sample");
    expect(proxy(new NextRequest("https://flux-live.vercel.app/login")).status).toBe(200);
  });
  it("allows only the configured secure collaboration origin in CSP", () => {
    vi.stubEnv("VERCEL", "1"); vi.stubEnv("FLUX_DEPLOYMENT_MODE", "live");
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("FLUX_SHOWCASE_ONLY", undefined);
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
