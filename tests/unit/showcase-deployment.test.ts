import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { isShowcaseDeployment } from "../../apps/web/lib/showcase-deployment";
import { proxy } from "../../apps/web/proxy";

afterEach(() => vi.unstubAllEnvs());

function setup(showcase = true) {
  vi.stubEnv("VERCEL", showcase ? "1" : undefined);
  vi.stubEnv("FLUX_DEPLOYMENT_MODE", undefined);
  vi.stubEnv("FLUX_SHOWCASE_ONLY", undefined);
  vi.stubEnv("NODE_ENV", "production");
}

function request(path: string, method = "GET") {
  return new NextRequest(`https://flux.example.com${path}`, {
    method, headers: { cookie: "flux_session=sample", authorization: "Bearer sample" },
  });
}

async function deploymentConfig() {
  vi.resetModules();
  return (await import("../../apps/web/next.config")).default;
}

describe("showcase deployment boundary", () => {
  it("defaults to showcase-only on Vercel and supports explicit local mode", () => {
    setup();
    vi.stubEnv("FLUX_SHOWCASE_ONLY", "false");
    expect(isShowcaseDeployment()).toBe(true);
    vi.stubEnv("VERCEL", undefined);
    expect(isShowcaseDeployment()).toBe(false);
    vi.stubEnv("FLUX_SHOWCASE_ONLY", "true");
    expect(isShowcaseDeployment()).toBe(true);
  });

  it("redirects the public root and canonicalizes the demo URL", () => {
    setup();
    for (const path of ["/", "/?private=ignored", "/demo/"]) {
      const response = proxy(request(path));
      expect(response.status).toBe(308);
      expect(response.headers.get("location")).toBe("https://flux.example.com/demo");
    }
  });

  it("denies accounts, APIs, collaboration, image proxying, and non-demo pages", async () => {
    setup();
    for (const path of ["/login", "/account/help", "/api", "/api/auth/me", "/sync", "/internal/rooms", "/files/example", "/invite/example", "/_next/image?url=http://private.invalid", "/demoevil", "/de%6do"]) {
      const response = proxy(request(path));
      expect(response.status, path).toBe(404);
      expect(await response.text()).toBe("Not found");
    }
  });

  it("rejects every write method before route or asset handling", () => {
    setup();
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      for (const path of ["/", "/demo", "/api/auth/register", "/_next/static/sample.js"]) {
        const response = proxy(request(path, method));
        expect(response.status).toBe(405);
        expect(response.headers.get("allow")).toBe("GET, HEAD");
      }
    }
  });

  it("serves the demo and assets without forwarding account credentials", () => {
    setup();
    for (const method of ["GET", "HEAD"]) {
      for (const path of ["/demo", "/_next/static/sample.js", "/art/flux-ribbons.webp", "/icon.svg"]) {
        const response = proxy(request(path, method));
        expect(response.headers.get("x-middleware-next")).toBe("1");
        expect(response.headers.has("x-middleware-request-cookie")).toBe(false);
        expect(response.headers.has("x-middleware-request-authorization")).toBe(false);
        expect(response.headers.has("set-cookie")).toBe(false);
      }
    }
    expect(proxy(request("/demo")).headers.get("content-security-policy")).toContain("connect-src 'self';");
  });

  it("does not change full-app account routing or collaboration CSP", async () => {
    setup(false);
    const api = proxy(request("/api/auth/me", "POST"));
    expect(api.headers.get("x-middleware-request-cookie")).toBe("flux_session=sample");
    expect(api.headers.has("content-security-policy")).toBe(false);
    expect(proxy(request("/login")).headers.get("content-security-policy")).toContain("wss://");
    const config = await deploymentConfig();
    expect(await config.rewrites!()).not.toEqual([]);
    expect(config.images).toBeUndefined();
  });

  it("disables API rewrites and platform image optimization in showcase builds", async () => {
    setup();
    const config = await deploymentConfig();
    expect(await config.rewrites!()).toEqual([]);
    expect(config.images).toEqual({ unoptimized: true, localPatterns: [], remotePatterns: [] });
  });
});
