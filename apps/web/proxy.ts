import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
function isAsset(path: string) {
  return path.startsWith("/_next/static/") || path.startsWith("/art/") || path === "/icon.svg";
}

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const headers = new Headers(request.headers);
  const passthrough = isAsset(path) || path === "/api" || path.startsWith("/api/") || path.startsWith("/_next/");
  if (passthrough || process.env.NODE_ENV !== "production") return NextResponse.next({ request: { headers } });
  const nonce = randomBytes(18).toString("base64");
  const host = new URL(process.env.APP_ORIGIN ?? request.url).host;
  const collaborationOrigin = process.env.NEXT_PUBLIC_COLLABORATION_URL
    ? new URL(process.env.NEXT_PUBLIC_COLLABORATION_URL).origin
    : `wss://${host}`;
  if (process.env.NODE_ENV === "production" && !collaborationOrigin.startsWith("wss://")) {
    throw new Error("Production collaboration requires WSS");
  }
  const connect = `'self' ${collaborationOrigin}`;
  const csp = `default-src 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src ${connect}; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`;
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return response;
}
export const config = { matcher: ["/:path*"] };
